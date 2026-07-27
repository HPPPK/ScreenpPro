import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./api";
import QRCode from "qrcode";
import { CANVAS, type SaverComponent, type ScreenSaverProject } from "./types";

export function Asset({ id, className = "", alt = "图片", style, onRetry }: { id?: string | null; className?: string; alt?: string; style?: CSSProperties; onRetry?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!id) { setSrc(null); return () => { live = false; }; }
    api.getAssetPath(id).then((path) => { if (live) setSrc(convertFileSrc(path)); }).catch((error) => {
      console.error("无法读取 ScreenPro 私有图片资源", { assetId: id, error });
      if (live) { setSrc(null); setFailed(true); }
    });
    return () => { live = false; };
  }, [id]);
  if (src && !failed) return <img src={src} alt={alt} className={className} style={style} onError={() => setFailed(true)} />;
  return <div className={"image-placeholder " + (failed ? "image-error " : "") + className} style={style}><span>▧</span><small>{failed ? "图片无法加载，请重新选择" : id ? "正在读取图片" : "选择图片"}</small>{failed && onRetry && <button type="button" className="image-retry" onClick={onRetry}>重新选择</button>}</div>;
}

function safeNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity) { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; }
function safeAlign(value: unknown, fallback: "left" | "center" | "right" = "center") { return value === "left" || value === "right" || value === "center" ? value : fallback; }
function safeFontSize(value: unknown, fallback: number, scale: number) { return safeNumber(value, fallback, 8, 320) * Math.max(0.01, scale); }
export function formatClock(format: string, date: Date) {
  const values: Record<string, string> = { YYYY: String(date.getFullYear()), MM: String(date.getMonth() + 1).padStart(2, "0"), DD: String(date.getDate()).padStart(2, "0"), HH: String(date.getHours()).padStart(2, "0"), mm: String(date.getMinutes()).padStart(2, "0"), ss: String(date.getSeconds()).padStart(2, "0") };
  const template = format.trim() || "HH:mm";
  return template.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => values[token]);
}
function textStyle(p: Record<string, unknown>, scale: number): CSSProperties { return { color: String(p.color ?? "#FFFFFF"), fontSize: safeFontSize(p.fontSize, 48, scale), fontWeight: safeNumber(p.fontWeight, 600, 100, 900), textAlign: safeAlign(p.align) }; }
function panelStyle(p: Record<string, unknown>): CSSProperties { return { color: String(p.color ?? "#FFFFFF"), textAlign: safeAlign(p.align) }; }
function remaining(target: string, now: number) { const targetMs = Date.parse(target); if (!Number.isFinite(targetMs)) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: false, invalid: true }; const ms = Math.max(0, targetMs - now); const total = Math.floor(ms / 1000); return { days: Math.floor(total / 86400), hours: Math.floor(total / 3600) % 24, minutes: Math.floor(total / 60) % 60, seconds: total % 60, done: ms <= 0, invalid: false }; }
type RemoteLoader<T> = (signal: AbortSignal) => Promise<T>;
type RemoteState<T> = { value: T | null; error: string; loading: boolean; updatedAt: number | null };

async function requestJson<T>(url: string, signal: AbortSignal, timeoutMs = 12000): Promise<T> {
  if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), timeoutMs);
  const onAbort = () => timeout.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) throw new Error("请求失败（HTTP " + response.status + "）");
    return await response.json() as T;
  } catch (error) {
    if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
    if (timeout.signal.aborted) throw new Error("请求超时，请稍后重试");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function requestText(url: string, signal: AbortSignal, timeoutMs = 12000): Promise<string> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), timeoutMs);
  const onAbort = () => timeout.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) throw new Error("请求失败（HTTP " + response.status + "）");
    return await response.text();
  } catch (error) {
    if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
    if (timeout.signal.aborted) throw new Error("请求超时，请稍后重试");
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function useRemote<T>(loader: RemoteLoader<T>, refreshSeconds: number, poll = true, enabled = true) {
  const [state, setState] = useState<RemoteState<T>>({ value: null, error: "", loading: true, updatedAt: null });
  useEffect(() => {
    if (!enabled) { setState((previous) => ({ ...previous, loading: false })); return; }
    let live = true;
    const controllers = new Set<AbortController>();
    const run = async () => {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const value = await loader(controller.signal);
        if (live) setState({ value, error: "", loading: false, updatedAt: Date.now() });
      } catch (error) {
        if (!live || ((error instanceof DOMException || error instanceof Error) && error.name === "AbortError")) return;
        setState((previous) => ({ ...previous, error: String(error).replace(/^Error:\s*/, ""), loading: false }));
      } finally {
        controllers.delete(controller);
      }
    };
    void run();
    if (!poll) return () => { live = false; controllers.forEach((controller) => controller.abort()); };
    const timer = window.setInterval(() => void run(), Math.max(30, refreshSeconds || 600) * 1000);
    return () => { live = false; window.clearInterval(timer); controllers.forEach((controller) => controller.abort()); };
  }, [loader, poll, refreshSeconds, enabled]);
  return state;
}

function remoteUpdatedAt(value: number | null) {
  return value ? "更新于 " + new Date(value).toLocaleTimeString() : "尚未成功更新";
}
function DateRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const date = new Date(now); const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date); const value = formatClock(String(p.format ?? "YYYY年MM月DD日"), date); return <div className="data-panel date-panel" style={panelStyle(p)}><strong style={{ fontSize: safeFontSize(p.fontSize, 46, scale) }}>{value}</strong>{p.showWeekday !== false && <span>{weekday}</span>}</div>; }
function CountdownRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const r = remaining(String(p.target ?? ""), now); const value = r.invalid ? "目标时间无效" : r.done ? String(p.finishedText ?? "目标时间已到") : String(r.days) + "天 " + String(r.hours).padStart(2, "0") + ":" + String(r.minutes).padStart(2, "0") + ":" + String(r.seconds).padStart(2, "0"); return <div className="countdown-panel" style={panelStyle(p)}><small>{r.invalid ? "请在属性面板设置有效目标时间" : r.done ? "倒计时已结束" : String(p.label ?? "距离目标还有")}</small><strong style={{ fontSize: safeFontSize(p.fontSize, 78, scale) }}>{value}</strong></div>; }
function ProgressRuntime({ item, scale }: RuntimeProps) { const p = item.props; const value = safeNumber(p.value, 0, 0, 100); const radius = safeNumber(p.radius, 20, 0, 50) * Math.max(0.01, scale); return <div className="progress-panel"><div className="progress-caption" style={{ color: String(p.color ?? "#FFFFFF"), fontSize: 20 * Math.max(0.01, scale) }}><span>{String(p.label ?? "当前进度")}</span>{p.showPercent !== false && <b>{value}%</b>}</div><div className="progress-track" style={{ background: String(p.trackColor ?? "#FFFFFF33"), borderRadius: radius }}><i style={{ width: value + "%", background: String(p.color ?? "#9DE8BC"), borderRadius: radius }} /></div></div>; }
function WorldClockRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const zones: Record<string, string> = { 上海: "Asia/Shanghai", 北京: "Asia/Shanghai", 东京: "Asia/Tokyo", 伦敦: "Europe/London", 纽约: "America/New_York", 洛杉矶: "America/Los_Angeles", 巴黎: "Europe/Paris", 悉尼: "Australia/Sydney", Shanghai: "Asia/Shanghai", London: "Europe/London", Tokyo: "Asia/Tokyo", NewYork: "America/New_York" }; const cities = [...new Set(String(p.cities ?? "上海,伦敦,纽约").split(/[,，\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 8); if (!cities.length) return <div className="simple-status">请添加至少一个城市</div>; return <div className="world-clock-panel" style={panelStyle(p)}>{cities.map((city) => { const zone = zones[city]; if (!zone) return <div key={city} className="world-clock-invalid"><span>{city}</span><strong>未知时区</strong></div>; return <div key={city}><span>{city}</span><strong style={{ fontSize: safeFontSize(p.fontSize, 42, scale) }}>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date(now))}</strong></div>; })}</div>; }
function QrRuntime({ item, scale }: RuntimeProps) { const p = item.props; const value = String(p.value ?? "").trim(); const requestedSize = safeNumber(p.size, 360, 64, 1200) * Math.max(0.01, scale); const maxSize = Math.max(64, Math.min(item.width, item.height) * scale * 0.82); const size = Math.max(64, Math.min(1200, requestedSize, maxSize)); const dark = String(p.color ?? "#111827"); const light = String(p.background ?? "#FFFFFF"); const [src, setSrc] = useState<string | null>(null); const [error, setError] = useState(""); useEffect(() => { let live = true; setSrc(null); setError(""); if (!value) { setError("请在属性面板输入二维码内容"); return () => { live = false; }; } QRCode.toDataURL(value, { width: Math.round(size), margin: 1, errorCorrectionLevel: "M", color: { dark, light } }).then((next) => { if (live) setSrc(next); }).catch((reason) => { if (live) setError(String(reason).replace(/^Error:\s*/, "二维码生成失败")); }); return () => { live = false; }; }, [value, size, dark, light]); if (error) return <div className="simple-status">{error}</div>; if (!src) return <div className="simple-status">正在生成二维码…</div>; return <div className="qr-panel"><img src={src} alt="二维码" style={{ width: "min(100%, 100%)", maxWidth: maxSize, maxHeight: maxSize, objectFit: "contain" }} /><span>{String(p.label ?? "扫描访问")}</span></div>; }
const webThumbnailCache = new Map<string, { image: string; storedAt: number }>();
const webThumbnailInflight = new Map<string, Promise<string>>();
const WEB_CACHE_TTL = 5 * 60 * 1000;

async function captureWebThumbnailCached(url: string, width: number, force = false): Promise<string> {
  const key = url + "|" + width;
  const cached = webThumbnailCache.get(key);
  if (!force && cached && Date.now() - cached.storedAt < WEB_CACHE_TTL) return cached.image;
  const running = webThumbnailInflight.get(key);
  if (running) return running;
  const task = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("网页截图超时（15 秒），请检查网络或稍后重试")), 15000);
    api.captureWebThumbnail(url, width, force).then(resolve).catch(reject).finally(() => window.clearTimeout(timer));
  }).then((image) => {
    if (image.length > 16_000_000) throw new Error("网页缩略图过大，已拒绝加载");
    webThumbnailCache.set(key, { image, storedAt: Date.now() });
    while (webThumbnailCache.size > 6) webThumbnailCache.delete(webThumbnailCache.keys().next().value as string);
    return image;
  }).finally(() => webThumbnailInflight.delete(key));
  webThumbnailInflight.set(key, task);
  return task;
}

function WebPreviewRuntime({ item, editable }: RuntimeProps) {
  const p = item.props;
  const raw = String(p.url ?? "").trim();
  let url = "";
  let domain = "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") { url = parsed.toString(); domain = parsed.hostname; }
  } catch { /* invalid URL */ }
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [reloadKey, setReloadKey] = useState(0);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [errorText, setErrorText] = useState("");
  const refreshSeconds = safeNumber(p.refreshSeconds, 300, 0, 86400);
  const fit = p.fit === "cover" ? "cover" : "contain";
  const opacity = safeNumber(p.opacity, 1, 0.2, 1);
  useEffect(() => { setReloadKey(0); setThumbnail(null); setState(editable ? "idle" : "loading"); }, [url, editable]);
  useEffect(() => {
    if (!url || editable || refreshSeconds <= 0) return;
    const timer = window.setInterval(() => setReloadKey((value) => value + 1), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [editable, refreshSeconds, url]);
  useEffect(() => {
    let live = true;
    if (!url || (editable && reloadKey === 0)) return () => { live = false; };
    setErrorText(""); setState("loading");
    captureWebThumbnailCached(url, 1280, reloadKey > 0).then((image) => {
      if (live) { setThumbnail(image); setState("ready"); }
    }).catch((error) => {
      if (live) { setErrorText(String(error).replace(/^Error:\s*/, "")); setState("failed"); }
    });
    return () => { live = false; };
  }, [url, reloadKey, editable]);
  if (!url) return <div className="web-preview-fallback"><strong>网页地址无效</strong><small>请输入 http:// 或 https:// 开头的地址</small></div>;
  if (state === "idle") return <div className="web-preview-fallback"><strong>网页预览已暂停</strong><small>编辑器不会自动加载网页，避免拖动和编辑时卡顿。</small><button className="web-preview-action" type="button" onClick={() => setReloadKey(1)}>生成预览</button></div>;
  if (state === "failed") return <div className="web-preview-fallback"><strong>网页缩略图生成失败</strong><small>{errorText || "请确认已安装 Microsoft Edge 或 Google Chrome，并检查网络连接。"}</small><button className="web-preview-action" type="button" onClick={() => setReloadKey((value) => value + 1)}>重试</button><span>{url}</span></div>;
  return <div className="web-preview"><div className="web-preview-viewport"><img className="web-preview-thumbnail" style={{ objectFit: fit, opacity }} src={thumbnail ?? undefined} alt={"网页缩略图：" + domain} /></div><div className="web-preview-status">{state === "loading" ? "正在生成整页缩略图…" : "整页网页缩略图"} · {domain}{state === "ready" && <small>{reloadKey > 0 ? " · 已刷新" : " · 来自缓存/新生成"}</small>}</div></div>;
}
type GithubData = { full_name: string; description: string | null; stargazers_count: number; forks_count: number; open_issues_count: number; updated_at: string; html_url: string };
function GithubRuntime({ item, scale, editable }: RuntimeProps) {
  const p = item.props; const repo = String(p.repo ?? "");
  const loader = useMemo(() => async (signal: AbortSignal) => { if (!repo.includes("/")) throw new Error("仓库格式应为 owner/name"); return requestJson<GithubData>("https://api.github.com/repos/" + repo, signal); }, [repo]);
  const state = useRemote(loader, safeNumber(p.refreshSeconds, 600, 30, 86400), !editable, !editable);
  if (state.loading && !state.value) return <div className="simple-status">正在读取 GitHub…</div>;
  if (!state.value) return <div className="simple-status">{state.error || "没有 GitHub 数据"}</div>;
  const value = state.value;
  return <div className="data-panel github-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><strong style={{ fontSize: 30 * scale }}>{value.full_name}</strong><p>{value.description || "暂无描述"}</p><div className="data-stats"><span>★ {value.stargazers_count}</span><span>⑂ {value.forks_count}</span><span>Issue {value.open_issues_count}</span></div><small>{state.error ? "更新失败，显示上次数据" : remoteUpdatedAt(state.updatedAt)}</small></div>;
}
function RssRuntime({ item, scale, editable }: RuntimeProps) {
  const p = item.props; const url = String(p.url ?? "").trim(); const maxItems = Math.round(safeNumber(p.maxItems, 5, 1, 12));
  const loader = useMemo(() => async (signal: AbortSignal) => {
    if (!url) throw new Error("请先设置 RSS 地址");
    const xml = new DOMParser().parseFromString(await requestText(url, signal), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("RSS 内容格式无法解析");
    return Array.from(xml.querySelectorAll("item, entry")).slice(0, Math.max(1, maxItems)).map((node) => ({ title: node.querySelector("title")?.textContent?.trim() || "无标题", link: node.querySelector("link")?.getAttribute("href") || node.querySelector("link")?.textContent?.trim() || "", pubDate: node.querySelector("pubDate, updated, published")?.textContent?.trim() || "" }));
  }, [url, maxItems]);
  const state = useRemote(loader, safeNumber(p.refreshSeconds, 600, 30, 86400), !editable, !editable);
  if (state.loading && !state.value) return <div className="simple-status">正在读取 RSS…</div>;
  if (!state.value) return <div className="simple-status">{state.error || "没有 RSS 条目"}</div>;
  return <div className="rss-panel" style={{ color: String(p.color ?? "#FFFFFF") }}>{state.value.map((entry, index) => <div key={entry.title + index}><strong style={{ fontSize: 22 * scale }}>{entry.title}</strong>{entry.pubDate && <small>{new Date(entry.pubDate).toLocaleDateString()}</small>}</div>)}<small className="remote-status">{state.error ? "更新失败，显示上次数据" : remoteUpdatedAt(state.updatedAt)}</small></div>;
}
function QuoteRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const quotes = String(p.quotes ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean); const intervalMs = safeNumber(p.intervalSeconds, 20, 1, 86400) * 1000; const value = quotes.length ? quotes[Math.floor(now / intervalMs) % quotes.length] : "添加你的句子"; return <div className="quote-panel" style={textStyle(p, scale)}>“{value}”</div>; }
function PhotoWallRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const ids = Array.isArray(p.assetIds) ? [...new Set(p.assetIds.filter((x): x is string => typeof x === "string" && Boolean(x.trim())))] : []; const intervalMs = safeNumber(p.intervalSeconds, 12, 1, 86400) * 1000; const index = ids.length ? Math.floor(now / intervalMs) % ids.length : -1; const fit = p.fit === "contain" ? "contain" : "cover"; return ids[index] ? <Asset id={ids[index]} className="photo-wall-piece" style={{ objectFit: fit, borderRadius: safeNumber(p.radius, 24, 0, 100) * Math.max(0.01, scale) }} /> : <div className="simple-status">在编辑器中添加照片后，这里会自动轮播</div>; }
function WeatherRuntime({ item, scale, editable }: RuntimeProps) {
  const p = item.props; const city = String(p.city ?? "Shanghai");
  const loader = useMemo(() => async (signal: AbortSignal) => {
    const geo = await requestJson<{ results?: Array<{ name: string; latitude: number; longitude: number }> }>("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) + "&count=1&language=zh&format=json", signal);
    const place = geo.results?.[0]; if (!place) throw new Error("找不到这个城市");
    const forecast = await requestJson<{ current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number } }>("https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude + "&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto", signal);
    const current = forecast.current; if (!current) throw new Error("天气数据为空");
    return { name: place.name, temperature: current.temperature_2m, wind: current.wind_speed_10m, code: current.weather_code };
  }, [city]);
  const state = useRemote(loader, safeNumber(p.refreshSeconds, 900, 30, 86400), !editable, !editable);
  if (state.loading && !state.value) return <div className="simple-status">正在读取天气…</div>;
  if (!state.value) return <div className="simple-status">{state.error || "天气不可用"}</div>;
  const value = state.value; const icon = value.code <= 3 ? "☀" : value.code <= 48 ? "☁" : value.code <= 67 ? "☂" : "❄";
  return <div className="weather-panel" style={{ color: String(p.color ?? "#FFFFFF"), textAlign: (p.align as "left" | "center" | "right") ?? "center" }}><span className="weather-icon">{icon}</span><strong style={{ fontSize: safeFontSize(p.fontSize, 54, scale) }}>{Math.round(value.temperature)}°C</strong><small>{value.name} · 风速 {Math.round(value.wind)} km/h</small><small className="remote-status">{state.error ? "更新失败，显示上次数据" : remoteUpdatedAt(state.updatedAt)}</small></div>;
}
function BatteryRuntime({ item, scale }: RuntimeProps) { const p = item.props; const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null); useEffect(() => { let live = true; const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (name: string, cb: () => void) => void; removeEventListener: (name: string, cb: () => void) => void }> }; const load = async () => { const b = nav.getBattery ? await nav.getBattery() : null; if (!b || !live) return; const update = () => setBattery({ level: b.level, charging: b.charging }); update(); b.addEventListener("levelchange", update); b.addEventListener("chargingchange", update); }; void load(); return () => { live = false; }; }, []); if (!battery) return <div className="simple-status">电池信息不可用</div>; return <div className="data-panel battery-panel" style={panelStyle(p)}><strong style={{ fontSize: safeFontSize(p.fontSize, 54, scale) }}>▣ {Math.round(battery.level * 100)}%</strong>{p.showCharging !== false && <span>{battery.charging ? "正在充电" : "未充电"}</span>}</div>; }
function SystemStatsRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory; return <div className="data-panel system-stats-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><div><span>CPU 线程</span><strong style={{ fontSize: safeFontSize(p.fontSize, 32, scale) }}>{navigator.hardwareConcurrency || "-"}</strong></div><div><span>视口</span><strong>{window.innerWidth} × {window.innerHeight}</strong></div><div><span>WebView 内存</span><strong>{memory ? Math.round(memory.usedJSHeapSize / 1048576) + " MB" : "不可用"}</strong></div><small>采样于 {new Date(now).toLocaleTimeString()}</small></div>; }
function NetworkRuntime({ item, scale }: RuntimeProps) { const p = item.props; const [online, setOnline] = useState(navigator.onLine); useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []); return <div className="data-panel network-panel" style={panelStyle(p)}><strong style={{ fontSize: safeFontSize(p.fontSize, 48, scale) }}>{online ? "● 在线" : "○ 离线"}</strong></div>; }

type RuntimeProps = { item: SaverComponent; scale: number; now: number; editable?: boolean };
function CalendarRuntime({ item, scale, now }: RuntimeProps) {
  const p = item.props; const date = new Date(now); date.setMonth(date.getMonth() + Math.round(safeNumber(p.monthOffset, 0, -120, 120)));
  const year = date.getFullYear(); const month = date.getMonth(); const first = new Date(year, month, 1); const count = new Date(year, month + 1, 0).getDate(); const start = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: start + count }, (_, index) => index < start ? null : index - start + 1); const today = new Date(now); const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  return <div className="calendar-panel" style={{ color: String(p.color ?? "#FFFFFF"), "--calendar-accent": String(p.accentColor ?? "#9DE8BC") } as CSSProperties}><div className="calendar-heading"><strong style={{ fontSize: 30 * scale }}>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date)}</strong><span>{isCurrentMonth && p.showToday !== false ? "今天" : ""}</span></div><div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((day, index) => <span key={index} className={day !== null && isCurrentMonth && day === today.getDate() && p.showToday !== false ? "today" : ""}>{day}</span>)}</div></div>;
}
function PomodoroRuntime({ item, scale, now }: RuntimeProps) {
  const p = item.props; const focusMs = safeNumber(p.focusMinutes, 25, 1, 240) * 60000; const breakMs = safeNumber(p.breakMinutes, 5, 1, 120) * 60000; const cycleMs = focusMs + breakMs; const startAt = safeNumber(p.startAt, now, 0); const elapsed = Math.max(0, now - startAt) % cycleMs; const focus = elapsed < focusMs; const remainingMs = (focus ? focusMs : cycleMs) - elapsed; const totalSeconds = Math.ceil(remainingMs / 1000); const value = String(Math.floor(totalSeconds / 60)).padStart(2, "0") + ":" + String(totalSeconds % 60).padStart(2, "0"); const progress = Math.min(100, Math.max(0, elapsed / (focus ? focusMs : cycleMs) * 100));
  return <div className="pomodoro-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><small>{focus ? String(p.label ?? "专注中") : "休息中"}</small><strong style={{ fontSize: safeFontSize(p.fontSize, 94, scale) }}>{value}</strong><div className="pomodoro-track"><i style={{ width: progress + "%", background: String(p.accentColor ?? "#9DE8BC") }} /></div><span>{focus ? "专注阶段" : "休息阶段"}</span></div>;
}
function DayProgressRuntime({ item, scale, now }: RuntimeProps) {
  const p = item.props; const date = new Date(now); const start = new Date(date); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); const percent = Math.min(100, Math.max(0, (now - start.getTime()) / (end.getTime() - start.getTime()) * 100));
  return <div className="day-progress-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><div><strong style={{ fontSize: 28 * scale }}>{String(p.label ?? "今天")}</strong><b>{percent.toFixed(1)}%</b></div><div className="progress-track" style={{ background: String(p.trackColor ?? "#FFFFFF33") }}><i style={{ width: percent + "%", background: String(p.color ?? "#9DE8BC") }} /></div>{p.showTime !== false && <small>现在是 {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>}</div>;
}
function MarkdownRuntime({ item, scale }: RuntimeProps) {
  const p = item.props; const maxLines = Math.round(safeNumber(p.maxLines, 12, 1, 40)); const lines = String(p.content ?? "").split(/\n/).slice(0, maxLines); const color = String(p.color ?? "#FFFFFF");
  return <div className="markdown-panel" title={String(p.content ?? "").split(/\n/).length > maxLines ? `内容已限制为 ${maxLines} 行` : undefined} style={{ color, textAlign: safeAlign(p.align, "left"), fontSize: safeFontSize(p.fontSize, 34, scale), lineHeight: safeNumber(p.lineHeight, 1.5, 1, 2.4) }}>{lines.map((line, index) => { const value = line.trim(); if (!value) return <div className="markdown-space" key={index} />; if (value.startsWith("### ")) return <h4 key={index}>{value.slice(4)}</h4>; if (value.startsWith("## ")) return <h3 key={index}>{value.slice(3)}</h3>; if (value.startsWith("# ")) return <h2 key={index}>{value.slice(2)}</h2>; if (value.startsWith("> ")) return <blockquote key={index}>{value.slice(2)}</blockquote>; if (value.startsWith("- ") || value.startsWith("* ")) return <p className="markdown-list" key={index}>• {value.slice(2)}</p>; return <p key={index}>{value}</p>; })}</div>;
}

function runtimeBody(item: SaverComponent, scale: number, now: number, editable = false) { switch (item.componentType) {
  case "text": return <div className="text-piece" style={textStyle(item.props, scale)}>{String(item.props.content ?? "文字")}</div>;
  case "image": { const fit = item.props.fit === "contain" ? "contain" : "cover"; return <Asset id={item.props.assetId as string | null} className="image-piece" style={{ objectFit: fit, borderRadius: Number(item.props.radius ?? 0) * scale }} />; }
  case "clock": { const p = item.props; const fontSize = safeFontSize(p.fontSize, 120, scale); return <div className="clock-piece" style={{ color: String(p.color ?? "#FFFFFF"), textAlign: safeAlign(p.align) }}><strong style={{ fontSize }}>{formatClock(String(p.format ?? "HH:mm"), new Date(now))}</strong>{p.showDate !== false && <span style={{ fontSize: fontSize * 0.17 }}>{new Intl.DateTimeFormat("zh-CN", { weekday: "long", month: "long", day: "numeric" }).format(new Date(now))}</span>}</div>; }
  case "date": return <DateRuntime item={item} scale={scale} now={now} />;
  case "countdown": return <CountdownRuntime item={item} scale={scale} now={now} />;
  case "progress": return <ProgressRuntime item={item} scale={scale} now={now} />;
  case "worldClock": return <WorldClockRuntime item={item} scale={scale} now={now} />;
  case "qr": return <QrRuntime item={item} scale={scale} now={now} />;
  case "webPreview": return <WebPreviewRuntime item={item} scale={scale} now={now} editable={editable} />;
  case "github": return <GithubRuntime item={item} scale={scale} now={now} editable={editable} />;
  case "rss": return <RssRuntime item={item} scale={scale} now={now} editable={editable} />;
  case "quote": return <QuoteRuntime item={item} scale={scale} now={now} />;
  case "photoWall": return <PhotoWallRuntime item={item} scale={scale} now={now} />;
  case "weather": return <WeatherRuntime item={item} scale={scale} now={now} editable={editable} />;
  case "battery": return <BatteryRuntime item={item} scale={scale} now={now} />;
  case "systemStats": return <SystemStatsRuntime item={item} scale={scale} now={now} />;
  case "network": return <NetworkRuntime item={item} scale={scale} now={now} />;
  case "calendar": return <CalendarRuntime item={item} scale={scale} now={now} />;
  case "pomodoro": return <PomodoroRuntime item={item} scale={scale} now={now} />;
  case "dayProgress": return <DayProgressRuntime item={item} scale={scale} now={now} />;
  case "markdown": return <MarkdownRuntime item={item} scale={scale} now={now} />;
} }

export function backgroundStyle(project: ScreenSaverProject): CSSProperties { const bg = project.background ?? {}; if (bg.kind === "solid") return { background: String(bg.start ?? "#0A1024") }; if (bg.kind === "aurora") return { background: "radial-gradient(circle at 20% 20%, #5de1b8 0, transparent 36%), radial-gradient(circle at 80% 10%, #7867ff 0, transparent 40%), linear-gradient(135deg, #07151f, #142d4a)", "--animation-speed": String(Math.max(0.5, Number(bg.speed ?? 1))) + "s" } as CSSProperties; if (bg.kind === "stars") return { background: "radial-gradient(circle at 20% 30%, #ffffff 0 1px, transparent 2px), radial-gradient(circle at 80% 20%, #ffffff 0 1px, transparent 2px), radial-gradient(circle at 45% 70%, #ffffff 0 1px, transparent 2px), linear-gradient(135deg, #030712, #101c35)", backgroundSize: "180px 180px, 240px 240px, 310px 310px, auto", "--animation-speed": String(Math.max(0.5, Number(bg.speed ?? 1))) + "s" } as CSSProperties; if (bg.kind === "waves") return { background: "linear-gradient(120deg, #0b1e31, #195875, #10263d)", "--animation-speed": String(Math.max(0.5, Number(bg.speed ?? 1))) + "s" } as CSSProperties; return { background: "linear-gradient(135deg, " + String(bg.start ?? "#0A1024") + ", " + String(bg.end ?? "#243B6B") + ")" }; }
function backgroundClass(project: ScreenSaverProject) { return project.background?.kind ? "visual-bg-" + project.background.kind : ""; }

function needsTick(type: SaverComponent["componentType"]) { return ["clock", "date", "countdown", "worldClock", "quote", "photoWall", "systemStats", "calendar", "pomodoro", "dayProgress"].includes(type); }
const Piece = memo(function Piece({ item, scale, now, editable, selected, layerIndex, onPick, onContextMenu }: { item: SaverComponent; scale: number; now: number; editable?: boolean; selected?: boolean; layerIndex: number; onPick?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void; onContextMenu?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void }) {
  const style: CSSProperties = { zIndex: layerIndex + 2, left: item.x / CANVAS.width * 100 + "%", top: item.y / CANVAS.height * 100 + "%", width: item.width / CANVAS.width * 100 + "%", height: item.height / CANVAS.height * 100 + "%" };
  return <div className={"piece " + (editable ? "editable " : "") + (selected ? "selected" : "")} style={style} onMouseDown={(event) => onPick?.(event, item)} onContextMenu={(event) => onContextMenu?.(event, item)}>{runtimeBody(item, scale, now, editable)}</div>;
});

export function Visual({ project, editable, selectedId, selectedIds, onPick, onContextMenu }: { project: ScreenSaverProject; editable?: boolean; selectedId?: string | null; selectedIds?: string[]; onPick?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void; onContextMenu?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void }) {
  const [now, setNow] = useState(() => Date.now()); const [scale, setScale] = useState(1); const visualRef = useRef<HTMLDivElement>(null);
  const needsClockTick = project.elements.some((item) => needsTick(item.componentType));
  useEffect(() => { if (!needsClockTick) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [needsClockTick]);
  useEffect(() => { const element = visualRef.current; if (!element) return; const update = () => { const rect = element.getBoundingClientRect(); setScale(Math.min(rect.width / CANVAS.width, rect.height / CANVAS.height) || 1); }; update(); const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect(); }, []);
  return <div ref={visualRef} className={"visual " + backgroundClass(project)} style={backgroundStyle(project)}>{project.background?.imageAssetId && <Asset id={project.background.imageAssetId} className="background-image" alt="背景" />}{project.elements.filter((item) => !item.hidden).map((item, index) => <Piece key={item.id} item={item} layerIndex={index} scale={scale} now={needsTick(item.componentType) ? now : 0} editable={editable} selected={(selectedIds ?? (selectedId ? [selectedId] : [])).includes(item.id)} onPick={onPick} onContextMenu={onContextMenu} />)}</div>;
}
