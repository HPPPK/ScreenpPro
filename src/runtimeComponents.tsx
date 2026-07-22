import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./api";
import QRCode from "qrcode";
import { CANVAS, type SaverComponent, type ScreenSaverProject } from "./types";

export function Asset({ id, className = "", alt = "图片" }: { id?: string | null; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!id) { setSrc(null); return () => { live = false; }; }
    api.getAssetPath(id).then((path) => { if (live) setSrc(convertFileSrc(path)); }).catch((error) => {
      console.error("无法读取 ScreenPro 私有图片资源", { assetId: id, error });
      if (live) setSrc(null);
    });
    return () => { live = false; };
  }, [id]);
  if (src && !failed) return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
  return <div className={"image-placeholder " + className}><span>▧</span><small>{id ? "图片无法加载" : "选择图片"}</small></div>;
}

export function formatClock(format: string, date: Date) {
  return format.replace("YYYY", String(date.getFullYear())).replace("MM", String(date.getMonth() + 1).padStart(2, "0"))
    .replace("DD", String(date.getDate()).padStart(2, "0")).replace("HH", String(date.getHours()).padStart(2, "0"))
    .replace("mm", String(date.getMinutes()).padStart(2, "0")).replace("ss", String(date.getSeconds()).padStart(2, "0"));
}
function textStyle(p: Record<string, unknown>, scale: number): CSSProperties { return { color: String(p.color ?? "#FFFFFF"), fontSize: Number(p.fontSize ?? 48) * scale, fontWeight: Number(p.fontWeight ?? 600), textAlign: (p.align as "left" | "center" | "right") ?? "center" }; }
function panelStyle(p: Record<string, unknown>): CSSProperties { return { color: String(p.color ?? "#FFFFFF"), textAlign: (p.align as "left" | "center" | "right") ?? "center" }; }
function remaining(target: string, now: number) { const ms = Math.max(0, new Date(target).getTime() - now); const total = Math.floor(ms / 1000); return { days: Math.floor(total / 86400), hours: Math.floor(total / 3600) % 24, minutes: Math.floor(total / 60) % 60, seconds: total % 60, done: ms <= 0 }; }
function useRemote<T>(loader: () => Promise<T>, refreshSeconds: number, poll = true) {
  const [state, setState] = useState<{ value: T | null; error: string; loading: boolean }>({ value: null, error: "", loading: true });
  useEffect(() => {
    let live = true;
    const run = async () => { try { const value = await loader(); if (live) setState({ value, error: "", loading: false }); } catch (error) { if (live) setState({ value: null, error: String(error).replace(/^Error:\s*/, ""), loading: false }); } };
    void run();
    if (!poll) return () => { live = false; };
    const timer = window.setInterval(() => void run(), Math.max(30, refreshSeconds || 600) * 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [loader, poll, refreshSeconds]);
  return state;
}
function DateRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const date = new Date(now); const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date); const value = formatClock(String(p.format ?? "YYYY年MM月DD日"), date); return <div className="data-panel date-panel" style={panelStyle(p)}><strong style={{ fontSize: Number(p.fontSize ?? 46) * scale }}>{value}</strong>{p.showWeekday !== false && <span>{weekday}</span>}</div>; }
function CountdownRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const r = remaining(String(p.target ?? ""), now); const value = r.done ? String(p.finishedText ?? "目标时间已到") : String(r.days) + "天 " + String(r.hours).padStart(2, "0") + ":" + String(r.minutes).padStart(2, "0") + ":" + String(r.seconds).padStart(2, "0"); return <div className="countdown-panel" style={panelStyle(p)}><small>{String(p.label ?? "距离目标还有")}</small><strong style={{ fontSize: Number(p.fontSize ?? 78) * scale }}>{value}</strong></div>; }
function ProgressRuntime({ item, scale }: RuntimeProps) { const p = item.props; const value = Math.max(0, Math.min(100, Number(p.value ?? 0))); return <div className="progress-panel"><div className="progress-caption" style={{ color: String(p.color ?? "#FFFFFF"), fontSize: 20 * scale }}><span>{String(p.label ?? "当前进度")}</span>{p.showPercent !== false && <b>{value}%</b>}</div><div className="progress-track" style={{ background: String(p.trackColor ?? "#FFFFFF33"), borderRadius: Number(p.radius ?? 20) * scale }}><i style={{ width: value + "%", background: String(p.color ?? "#9DE8BC"), borderRadius: Number(p.radius ?? 20) * scale }} /></div></div>; }
function WorldClockRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const zones: Record<string, string> = { 上海: "Asia/Shanghai", 北京: "Asia/Shanghai", 东京: "Asia/Tokyo", 伦敦: "Europe/London", 纽约: "America/New_York", 洛杉矶: "America/Los_Angeles", 巴黎: "Europe/Paris", 悉尼: "Australia/Sydney", Shanghai: "Asia/Shanghai", London: "Europe/London", Tokyo: "Asia/Tokyo", NewYork: "America/New_York" }; const cities = String(p.cities ?? "上海,伦敦,纽约").split(/[,，\n]/).map((x) => x.trim()).filter(Boolean); return <div className="world-clock-panel" style={panelStyle(p)}>{cities.map((city) => <div key={city}><span>{city}</span><strong style={{ fontSize: Number(p.fontSize ?? 42) * scale }}>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: zones[city] ?? "UTC" }).format(new Date(now))}</strong></div>)}</div>; }
function QrRuntime({ item, scale }: RuntimeProps) { const p = item.props; const value = String(p.value ?? "ScreenPro"); const size = Math.max(80, Number(p.size ?? 360) * scale); const [src, setSrc] = useState<string | null>(null); useEffect(() => { let live = true; setSrc(null); QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" }).then((next) => { if (live) setSrc(next); }).catch(() => { if (live) setSrc(null); }); return () => { live = false; }; }, [value, size]); if (!src) return <div className="simple-status">正在生成二维码…</div>; return <div className="qr-panel"><img src={src} alt="二维码" /><span>{String(p.label ?? "扫描访问")}</span></div>; }
function WebPreviewRuntime({ item, editable }: RuntimeProps) {
  const p = item.props;
  const raw = String(p.url ?? "").trim();
  let url = "";
  let domain = "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      url = parsed.toString();
      domain = parsed.hostname;
    }
  } catch { /* invalid URL */ }
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [errorText, setErrorText] = useState("");
  const refreshSeconds = Math.max(0, Number(p.refreshSeconds ?? 300));
  useEffect(() => { setReloadKey(0); }, [url]);
  useEffect(() => {
    if (!url || editable || refreshSeconds <= 0) return;
    const timer = window.setInterval(() => setReloadKey((value) => value + 1), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [editable, refreshSeconds, url]);
  useEffect(() => {
    let live = true;
    setThumbnail(null);
    setErrorText("");
    setState(url ? "loading" : "failed");
    if (!url) return () => { live = false; };
    api.captureWebThumbnail(url, 1280).then((image) => {
      if (!live) return;
      setThumbnail(image);
      setState("ready");
    }).catch((error) => {
      console.warn("ScreenPro web thumbnail capture failed", error);
      if (live) { setErrorText(String(error)); setState("failed"); }
    });
    return () => { live = false; };
  }, [url, reloadKey]);
  if (!url) return <div className="web-preview-fallback"><strong>网页地址无效</strong><small>请输入 http:// 或 https:// 开头的地址</small></div>;
  if (state === "failed") return <div className="web-preview-fallback"><strong>网页缩略图生成失败</strong><small>请确认已安装 Microsoft Edge 或 Google Chrome，并检查网络连接。{errorText && <><br />{errorText}</>}</small><span>{url}</span></div>;
  return <div className="web-preview"><div className="web-preview-viewport"><img className="web-preview-thumbnail" src={thumbnail ?? undefined} alt={"网页缩略图：" + domain} /></div><div className="web-preview-status">{state === "loading" ? "正在生成整页缩略图…" : "整页网页缩略图"} · {domain}</div></div>;
}
type GithubData = { full_name: string; description: string | null; stargazers_count: number; forks_count: number; open_issues_count: number; updated_at: string; html_url: string };
function GithubRuntime({ item, scale, editable }: RuntimeProps) { const p = item.props; const repo = String(p.repo ?? ""); const loader = useMemo(() => async () => { if (!repo.includes("/")) throw new Error("仓库格式应为 owner/name"); const response = await fetch("https://api.github.com/repos/" + repo); if (!response.ok) throw new Error("GitHub 仓库暂时不可用"); return await response.json() as GithubData; }, [repo]); const state = useRemote(loader, Number(p.refreshSeconds ?? 600), !editable); if (state.loading) return <div className="simple-status">正在读取 GitHub…</div>; if (state.error || !state.value) return <div className="simple-status">{state.error || "没有 GitHub 数据"}</div>; const value = state.value; return <div className="data-panel github-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><strong style={{ fontSize: 30 * scale }}>{value.full_name}</strong><p>{value.description || "暂无描述"}</p><div className="data-stats"><span>★ {value.stargazers_count}</span><span>⑂ {value.forks_count}</span><span>Issue {value.open_issues_count}</span></div><small>更新于 {new Date(value.updated_at).toLocaleString()}</small></div>; }
function RssRuntime({ item, scale, editable }: RuntimeProps) { const p = item.props; const url = String(p.url ?? ""); const maxItems = Number(p.maxItems ?? 5); const loader = useMemo(() => async () => { if (!url) throw new Error("请先设置 RSS 地址"); const response = await fetch(url); if (!response.ok) throw new Error("RSS 请求失败"); const xml = new DOMParser().parseFromString(await response.text(), "application/xml"); return Array.from(xml.querySelectorAll("item, entry")).slice(0, Math.max(1, maxItems)).map((node) => ({ title: node.querySelector("title")?.textContent?.trim() || "无标题", link: node.querySelector("link")?.getAttribute("href") || node.querySelector("link")?.textContent?.trim() || "", pubDate: node.querySelector("pubDate, updated, published")?.textContent?.trim() || "" })); }, [url, maxItems]); const state = useRemote(loader, Number(p.refreshSeconds ?? 600), !editable); if (state.loading) return <div className="simple-status">正在读取 RSS…</div>; if (state.error || !state.value) return <div className="simple-status">{state.error || "没有 RSS 条目"}</div>; return <div className="rss-panel" style={{ color: String(p.color ?? "#FFFFFF") }}>{state.value.map((entry, index) => <div key={entry.title + index}><strong style={{ fontSize: 22 * scale }}>{entry.title}</strong>{entry.pubDate && <small>{new Date(entry.pubDate).toLocaleDateString()}</small>}</div>)}</div>; }
function QuoteRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const quotes = String(p.quotes ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean); const value = quotes.length ? quotes[Math.floor(now / Math.max(1, Number(p.intervalSeconds ?? 20) * 1000)) % quotes.length] : "添加你的句子"; return <div className="quote-panel" style={textStyle(p, scale)}>“{value}”</div>; }
function PhotoWallRuntime({ item, now }: RuntimeProps) { const p = item.props; const ids = Array.isArray(p.assetIds) ? p.assetIds.filter((x): x is string => typeof x === "string") : []; const index = ids.length ? Math.floor(now / (Math.max(1, Number(p.intervalSeconds ?? 12)) * 1000)) % ids.length : -1; return ids[index] ? <Asset id={ids[index]} className="photo-wall-piece" /> : <div className="simple-status">在编辑器中添加照片后，这里会自动轮播</div>; }
function WeatherRuntime({ item, scale, editable }: RuntimeProps) { const p = item.props; const city = String(p.city ?? "Shanghai"); const loader = useMemo(() => async () => { const geo = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) + "&count=1&language=zh&format=json"); if (!geo.ok) throw new Error("城市查询失败"); const place = (await geo.json()).results?.[0]; if (!place) throw new Error("找不到这个城市"); const forecast = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + place.latitude + "&longitude=" + place.longitude + "&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto"); if (!forecast.ok) throw new Error("天气请求失败"); const current = (await forecast.json()).current; return { name: place.name, temperature: current.temperature_2m, wind: current.wind_speed_10m, code: current.weather_code }; }, [city]); const state = useRemote(loader, Number(p.refreshSeconds ?? 900), !editable); if (state.loading) return <div className="simple-status">正在读取天气…</div>; if (state.error || !state.value) return <div className="simple-status">{state.error || "天气不可用"}</div>; const value = state.value as { name: string; temperature: number; wind: number; code: number }; const icon = value.code <= 3 ? "☀" : value.code <= 48 ? "☁" : value.code <= 67 ? "☂" : "❄"; return <div className="weather-panel" style={{ color: String(p.color ?? "#FFFFFF"), textAlign: (p.align as "left" | "center" | "right") ?? "center" }}><span className="weather-icon">{icon}</span><strong style={{ fontSize: Number(p.fontSize ?? 54) * scale }}>{Math.round(value.temperature)}°C</strong><small>{value.name} · 风速 {Math.round(value.wind)} km/h</small></div>; }
function BatteryRuntime({ item, scale }: RuntimeProps) { const p = item.props; const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null); useEffect(() => { let live = true; const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (name: string, cb: () => void) => void; removeEventListener: (name: string, cb: () => void) => void }> }; const load = async () => { const b = nav.getBattery ? await nav.getBattery() : null; if (!b || !live) return; const update = () => setBattery({ level: b.level, charging: b.charging }); update(); b.addEventListener("levelchange", update); b.addEventListener("chargingchange", update); }; void load(); return () => { live = false; }; }, []); if (!battery) return <div className="simple-status">电池信息不可用</div>; return <div className="data-panel battery-panel" style={panelStyle(p)}><strong style={{ fontSize: Number(p.fontSize ?? 54) * scale }}>▣ {Math.round(battery.level * 100)}%</strong>{p.showCharging !== false && <span>{battery.charging ? "正在充电" : "未充电"}</span>}</div>; }
function SystemStatsRuntime({ item, scale, now }: RuntimeProps) { const p = item.props; const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory; return <div className="data-panel system-stats-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><div><span>CPU 线程</span><strong style={{ fontSize: Number(p.fontSize ?? 32) * scale }}>{navigator.hardwareConcurrency || "-"}</strong></div><div><span>视口</span><strong>{window.innerWidth} × {window.innerHeight}</strong></div><div><span>WebView 内存</span><strong>{memory ? Math.round(memory.usedJSHeapSize / 1048576) + " MB" : "不可用"}</strong></div><small>采样于 {new Date(now).toLocaleTimeString()}</small></div>; }
function NetworkRuntime({ item, scale }: RuntimeProps) { const p = item.props; const [online, setOnline] = useState(navigator.onLine); useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []); return <div className="data-panel network-panel" style={panelStyle(p)}><strong style={{ fontSize: Number(p.fontSize ?? 48) * scale }}>{online ? "● 在线" : "○ 离线"}</strong></div>; }

type RuntimeProps = { item: SaverComponent; scale: number; now: number; editable?: boolean };
function CalendarRuntime({ item, scale, now }: RuntimeProps) {
  const p = item.props; const date = new Date(now); date.setMonth(date.getMonth() + Number(p.monthOffset ?? 0));
  const year = date.getFullYear(); const month = date.getMonth(); const first = new Date(year, month, 1); const count = new Date(year, month + 1, 0).getDate(); const start = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: start + count }, (_, index) => index < start ? null : index - start + 1); const today = new Date(now); const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  return <div className="calendar-panel" style={{ color: String(p.color ?? "#FFFFFF"), "--calendar-accent": String(p.accentColor ?? "#9DE8BC") } as CSSProperties}><div className="calendar-heading"><strong style={{ fontSize: 30 * scale }}>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date)}</strong><span>{isCurrentMonth && p.showToday !== false ? "今天" : ""}</span></div><div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((day, index) => <span key={index} className={day !== null && isCurrentMonth && day === today.getDate() && p.showToday !== false ? "today" : ""}>{day}</span>)}</div></div>;
}
function PomodoroRuntime({ item, scale, now }: RuntimeProps) {
  const p = item.props; const focusMs = Math.max(1, Number(p.focusMinutes ?? 25)) * 60000; const breakMs = Math.max(1, Number(p.breakMinutes ?? 5)) * 60000; const cycleMs = focusMs + breakMs; const elapsed = Math.max(0, now - Number(p.startAt ?? now)) % cycleMs; const focus = elapsed < focusMs; const remainingMs = (focus ? focusMs : cycleMs) - elapsed; const totalSeconds = Math.ceil(remainingMs / 1000); const value = String(Math.floor(totalSeconds / 60)).padStart(2, "0") + ":" + String(totalSeconds % 60).padStart(2, "0"); const progress = Math.min(100, Math.max(0, elapsed / (focus ? focusMs : cycleMs) * 100));
  return <div className="pomodoro-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><small>{focus ? String(p.label ?? "专注中") : "休息中"}</small><strong style={{ fontSize: Number(p.fontSize ?? 94) * scale }}>{value}</strong><div className="pomodoro-track"><i style={{ width: progress + "%", background: String(p.accentColor ?? "#9DE8BC") }} /></div><span>{focus ? "专注阶段" : "休息阶段"}</span></div>;
}
function DayProgressRuntime({ item, scale, now }: RuntimeProps) {
  const p = item.props; const date = new Date(now); const start = new Date(date); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); const percent = Math.min(100, Math.max(0, (now - start.getTime()) / (end.getTime() - start.getTime()) * 100));
  return <div className="day-progress-panel" style={{ color: String(p.color ?? "#FFFFFF") }}><div><strong style={{ fontSize: 28 * scale }}>{String(p.label ?? "今天")}</strong><b>{percent.toFixed(1)}%</b></div><div className="progress-track" style={{ background: String(p.trackColor ?? "#FFFFFF33") }}><i style={{ width: percent + "%", background: String(p.color ?? "#9DE8BC") }} /></div>{p.showTime !== false && <small>现在是 {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>}</div>;
}
function MarkdownRuntime({ item, scale }: RuntimeProps) {
  const p = item.props; const lines = String(p.content ?? "").split(/\n/); const color = String(p.color ?? "#FFFFFF");
  return <div className="markdown-panel" style={{ color, textAlign: (p.align as "left" | "center" | "right") ?? "left", fontSize: Number(p.fontSize ?? 34) * scale, lineHeight: Number(p.lineHeight ?? 1.5) }}>{lines.map((line, index) => { const value = line.trim(); if (!value) return <div className="markdown-space" key={index} />; if (value.startsWith("### ")) return <h4 key={index}>{value.slice(4)}</h4>; if (value.startsWith("## ")) return <h3 key={index}>{value.slice(3)}</h3>; if (value.startsWith("# ")) return <h2 key={index}>{value.slice(2)}</h2>; if (value.startsWith("> ")) return <blockquote key={index}>{value.slice(2)}</blockquote>; if (value.startsWith("- ") || value.startsWith("* ")) return <p className="markdown-list" key={index}>• {value.slice(2)}</p>; return <p key={index}>{value}</p>; })}</div>;
}

function runtimeBody(item: SaverComponent, scale: number, now: number, editable = false) { switch (item.componentType) {
  case "text": return <div className="text-piece" style={textStyle(item.props, scale)}>{String(item.props.content ?? "文字")}</div>;
  case "image": return <Asset id={item.props.assetId as string | null} className="image-piece" />;
  case "clock": { const p = item.props; const fontSize = Number(p.fontSize ?? 120) * scale; return <div className="clock-piece" style={{ color: String(p.color ?? "#FFFFFF"), textAlign: (p.align as "left" | "center" | "right") ?? "center" }}><strong style={{ fontSize }}>{formatClock(String(p.format ?? "HH:mm"), new Date(now))}</strong>{p.showDate !== false && <span style={{ fontSize: fontSize * 0.17 }}>{new Intl.DateTimeFormat("zh-CN", { weekday: "long", month: "long", day: "numeric" }).format(new Date(now))}</span>}</div>; }
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
const Piece = memo(function Piece({ item, scale, now, editable, selected, onPick }: { item: SaverComponent; scale: number; now: number; editable?: boolean; selected?: boolean; onPick?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void }) {
  const style: CSSProperties = { left: item.x / CANVAS.width * 100 + "%", top: item.y / CANVAS.height * 100 + "%", width: item.width / CANVAS.width * 100 + "%", height: item.height / CANVAS.height * 100 + "%" };
  return <div className={"piece " + (editable ? "editable " : "") + (selected ? "selected" : "")} style={style} onMouseDown={(event) => onPick?.(event, item)}>{runtimeBody(item, scale, now, editable)}</div>;
});

export function Visual({ project, editable, selectedId, onPick }: { project: ScreenSaverProject; editable?: boolean; selectedId?: string | null; onPick?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void }) {
  const [now, setNow] = useState(() => Date.now()); const [scale, setScale] = useState(1); const visualRef = useRef<HTMLDivElement>(null);
  const needsClockTick = project.elements.some((item) => needsTick(item.componentType));
  useEffect(() => { if (!needsClockTick) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [needsClockTick]);
  useEffect(() => { const element = visualRef.current; if (!element) return; const update = () => { const rect = element.getBoundingClientRect(); setScale(Math.min(rect.width / CANVAS.width, rect.height / CANVAS.height) || 1); }; update(); const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect(); }, []);
  return <div ref={visualRef} className={"visual " + backgroundClass(project)} style={backgroundStyle(project)}>{project.background?.imageAssetId && <Asset id={project.background.imageAssetId} className="background-image" alt="背景" />}{project.elements.map((item) => <Piece key={item.id} item={item} scale={scale} now={needsTick(item.componentType) ? now : 0} editable={editable} selected={item.id === selectedId} onPick={onPick} />)}</div>;
}
