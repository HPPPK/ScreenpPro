import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import * as globalShortcut from "@tauri-apps/plugin-global-shortcut";
import { api } from "./api";
import { blankComponent, CANVAS, componentLabels, type AppSettings, type BootstrapData, type ComponentType, type SaverComponent, type ScreenSaverProject } from "./types";
import { componentRegistry } from "./componentRegistry";
import { Asset, Visual, backgroundStyle } from "./runtimeComponents";
import "./App.css";

type View = "home" | "library" | "market" | "settings";
type Notice = { kind: "ok" | "bad"; text: string } | null;
const nav: { id: View; label: string; icon: string }[] = [{ id: "home", label: "工作台", icon: "◈" }, { id: "library", label: "我的库", icon: "▦" }, { id: "market", label: "资源库", icon: "✦" }, { id: "settings", label: "设置", icon: "⚙" }];

function SecuritySetup({ done }: { done: () => void }) {
  const [password, setPassword] = useState(""); const [again, setAgain] = useState(""); const [question, setQuestion] = useState("你最喜欢的城市是哪里？"); const [answer, setAnswer] = useState(""); const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (password !== again) return setError("两次密码不一致"); try { await api.setupSecurity(password, question, answer); done(); } catch (err) { setError(String(err)); } };
  return <main className="security-shell"><form className="security-card" onSubmit={submit}><div className="brand-mark">S</div><p className="eyebrow">WELCOME TO SCREENPRO</p><h1>设置屏幕保护密码</h1><p>退出屏保必须验证此密码；后台程序不会停止。</p><label>保护密码<input required minLength={4} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>确认密码<input required minLength={4} type="password" value={again} onChange={(e) => setAgain(e.target.value)} /></label><label>安全问题<input required value={question} onChange={(e) => setQuestion(e.target.value)} /></label><label>安全问题答案<input required minLength={4} type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button">完成设置</button><small>凭据仅以 Argon2id 哈希形式存储在本机。</small></form></main>;
}

function Editor({ source, close, save }: { source: ScreenSaverProject; close: () => void; save: (project: ScreenSaverProject) => Promise<void> }) {
  const [project, setProject] = useState<ScreenSaverProject>(() => structuredClone(source));
  const [selected, setSelected] = useState<string | null>(source.elements[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dragFrame = useRef<number | null>(null);
  const pointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const selectedItem = project.elements.find((item) => item.id === selected) ?? null;
  const patch = (next: Partial<SaverComponent>) => selectedItem && setProject((old) => ({ ...old, elements: old.elements.map((item) => item.id === selectedItem.id ? { ...item, ...next } : item) }));
  const props = (next: Record<string, unknown>) => selectedItem && patch({ props: { ...selectedItem.props, ...next } });
  const add = (type: ComponentType) => { const item = blankComponent(type); setProject((old) => ({ ...old, elements: [...old.elements, item] })); setSelected(item.id); };
  const pick = (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => { event.stopPropagation(); const r = canvas.current?.getBoundingClientRect(); if (!r) return; setSelected(item.id); setDrag({ id: item.id, dx: (event.clientX - r.left) * CANVAS.width / r.width - item.x, dy: (event.clientY - r.top) * CANVAS.height / r.height - item.y }); };
  const stopDrag = () => { if (dragFrame.current !== null) { cancelAnimationFrame(dragFrame.current); dragFrame.current = null; } pointer.current = null; setDrag(null); };
  const move = (event: MouseEvent<HTMLDivElement>) => {
    if (!drag || !canvas.current) return;
    pointer.current = { clientX: event.clientX, clientY: event.clientY };
    if (dragFrame.current !== null) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = null;
      const point = pointer.current;
      if (!point || !canvas.current) return;
      const r = canvas.current.getBoundingClientRect();
      setProject((old) => ({ ...old, elements: old.elements.map((item) => item.id !== drag.id ? item : { ...item, x: Math.max(0, Math.min(CANVAS.width - item.width, (point.clientX - r.left) * CANVAS.width / r.width - drag.dx)), y: Math.max(0, Math.min(CANVAS.height - item.height, (point.clientY - r.top) * CANVAS.height / r.height - drag.dy)) }) }));
    });
  };
  const importImage = async (asBackground = false) => { const path = await open({ multiple: false, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] }] }); if (typeof path !== "string") return; const id = await api.importAsset(path); if (asBackground) setProject((old) => ({ ...old, background: { ...old.background, imageAssetId: id } })); else props({ assetId: id }); };
  const addPhoto = async () => { const paths = await open({ multiple: true, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] }] }); const selectedPaths = Array.isArray(paths) ? paths : typeof paths === "string" ? [paths] : []; if (!selectedPaths.length || !selectedItem || selectedItem.componentType !== "photoWall") return; const ids = []; for (const path of selectedPaths) ids.push(await api.importAsset(path)); props({ assetIds: [...(Array.isArray(selectedItem.props.assetIds) ? selectedItem.props.assetIds : []), ...ids] }); };
  const bg = project.background ?? {};
  const setBg = (next: Partial<ScreenSaverProject["background"]>) => setProject((old) => ({ ...old, background: { ...(old.background ?? {}), ...next } }));
  const colorInput = (label: string, key: string, fallback: string) => <label>{label}<input type="color" value={String(selectedItem?.props[key] ?? fallback)} onChange={(event) => props({ [key]: event.target.value })} /></label>;
  const textInput = (label: string, key: string, fallback = "") => <label>{label}<input value={String(selectedItem?.props[key] ?? fallback)} onChange={(event) => props({ [key]: event.target.value })} /></label>;
  const numberInput = (label: string, key: string, fallback: number, min?: number, max?: number) => <label>{label}<input type="number" min={min} max={max} value={Number(selectedItem?.props[key] ?? fallback)} onChange={(event) => props({ [key]: Number(event.target.value) })} /></label>;
  const rangeInput = (label: string, key: string, fallback: number, min: number, max: number) => <label>{label}<input type="range" min={min} max={max} value={Number(selectedItem?.props[key] ?? fallback)} onChange={(event) => props({ [key]: Number(event.target.value) })} /></label>;
  const common = selectedItem ? <><div className="pair"><label>X<input type="number" value={Math.round(selectedItem.x)} onChange={(e) => patch({ x: Number(e.target.value) })} /></label><label>Y<input type="number" value={Math.round(selectedItem.y)} onChange={(e) => patch({ y: Number(e.target.value) })} /></label></div><div className="pair"><label>宽度<input min="10" type="number" value={Math.round(selectedItem.width)} onChange={(e) => patch({ width: Number(e.target.value) })} /></label><label>高度<input min="10" type="number" value={Math.round(selectedItem.height)} onChange={(e) => patch({ height: Number(e.target.value) })} /></label></div></> : null;
  const specific = selectedItem ? <>
    {selectedItem.componentType === "text" && <><label>文字内容<textarea value={String(selectedItem.props.content ?? "")} onChange={(e) => props({ content: e.target.value })} /></label>{rangeInput("字体大小", "fontSize", 58, 16, 180)}{colorInput("颜色", "color", "#ffffff")}<label>对齐<select value={String(selectedItem.props.align ?? "center")} onChange={(e) => props({ align: e.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></>}
    {selectedItem.componentType === "image" && <><Asset id={selectedItem.props.assetId as string | null} className="property-image" /><button className="ghost-button" onClick={() => importImage()}>导入本地图片</button>{rangeInput("圆角", "radius", 28, 0, 100)}<label>适配方式<select value={String(selectedItem.props.fit ?? "cover")} onChange={(e) => props({ fit: e.target.value })}><option value="cover">裁切填充</option><option value="contain">完整显示</option></select></label></>}
    {selectedItem.componentType === "clock" && <>{textInput("时间格式", "format", "HH:mm")}{rangeInput("文字大小", "fontSize", 130, 32, 220)}{colorInput("颜色", "color", "#ffffff")}<label>对齐<select value={String(selectedItem.props.align ?? "center")} onChange={(e) => props({ align: e.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><label className="check"><input type="checkbox" checked={selectedItem.props.showDate !== false} onChange={(e) => props({ showDate: e.target.checked })} /> 显示日期</label></>}
    {selectedItem.componentType === "date" && <>{textInput("日期格式", "format", "YYYY年MM月DD日")}{rangeInput("文字大小", "fontSize", 46, 16, 160)}{colorInput("颜色", "color", "#ffffff")}<label className="check"><input type="checkbox" checked={selectedItem.props.showWeekday !== false} onChange={(e) => props({ showWeekday: e.target.checked })} /> 显示星期</label></>}
    {selectedItem.componentType === "countdown" && <><label>目标时间<input type="datetime-local" value={String(selectedItem.props.target ?? "").slice(0, 16)} onChange={(e) => props({ target: new Date(e.target.value).toISOString() })} /></label>{textInput("说明文字", "label", "距离目标还有")}{textInput("结束文字", "finishedText", "目标时间已到")}{rangeInput("文字大小", "fontSize", 78, 24, 160)}{colorInput("颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "progress" && <>{textInput("标签", "label", "当前进度")}{rangeInput("进度百分比", "value", 65, 0, 100)}{colorInput("进度颜色", "color", "#9de8bc")}<label className="check"><input type="checkbox" checked={selectedItem.props.showPercent !== false} onChange={(e) => props({ showPercent: e.target.checked })} /> 显示百分比</label></>}
    {selectedItem.componentType === "worldClock" && <><label>城市列表<textarea value={String(selectedItem.props.cities ?? "上海,伦敦,纽约")} onChange={(e) => props({ cities: e.target.value })} /></label>{rangeInput("文字大小", "fontSize", 42, 16, 100)}{colorInput("颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "qr" && <>{textInput("二维码内容", "value", "https://github.com/HPPPK/ScreenpPro")}{textInput("说明文字", "label", "扫描访问")}{numberInput("二维码尺寸", "size", 360, 80, 800)}</>}
    {selectedItem.componentType === "webPreview" && <><label>网页地址<input type="url" value={String(selectedItem.props.url ?? "")} onChange={(e) => props({ url: e.target.value })} placeholder="https://example.com" /></label>{numberInput("刷新间隔（秒）", "refreshSeconds", 300, 30, 86400)}<label className="check"><input type="checkbox" checked={selectedItem.props.allowScripts !== false} onChange={(e) => props({ allowScripts: e.target.checked })} /> 允许网页脚本</label><label>透明度<input type="range" min="0.2" max="1" step="0.1" value={Number(selectedItem.props.opacity ?? 1)} onChange={(e) => props({ opacity: Number(e.target.value) })} /></label><p className="muted">网页只读、禁止交互，并限制为 http/https。</p></>}
    {selectedItem.componentType === "github" && <>{textInput("公开仓库", "repo", "HPPPK/ScreenpPro")}{numberInput("刷新间隔（秒）", "refreshSeconds", 600, 60, 86400)}{colorInput("文字颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "rss" && <><label>RSS 地址<input type="url" value={String(selectedItem.props.url ?? "")} onChange={(e) => props({ url: e.target.value })} placeholder="https://example.com/feed.xml" /></label>{numberInput("刷新间隔（秒）", "refreshSeconds", 600, 60, 86400)}{numberInput("显示条数", "maxItems", 5, 1, 12)}{colorInput("文字颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "quote" && <><label>句子（每行一句）<textarea value={String(selectedItem.props.quotes ?? "")} onChange={(e) => props({ quotes: e.target.value })} /></label>{numberInput("轮播间隔（秒）", "intervalSeconds", 20, 5, 86400)}{rangeInput("文字大小", "fontSize", 64, 18, 150)}{colorInput("颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "photoWall" && <><button className="ghost-button" onClick={addPhoto}>添加照片</button><p className="muted">已添加 {Array.isArray(selectedItem.props.assetIds) ? selectedItem.props.assetIds.length : 0} 张照片</p>{numberInput("轮播间隔（秒）", "intervalSeconds", 12, 5, 86400)}</>}
    {selectedItem.componentType === "weather" && <>{textInput("城市", "city", "Shanghai")}{numberInput("刷新间隔（秒）", "refreshSeconds", 900, 60, 86400)}{rangeInput("文字大小", "fontSize", 54, 18, 130)}{colorInput("颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "battery" && <>{rangeInput("文字大小", "fontSize", 54, 18, 130)}{colorInput("颜色", "color", "#ffffff")}<label className="check"><input type="checkbox" checked={selectedItem.props.showCharging !== false} onChange={(e) => props({ showCharging: e.target.checked })} /> 显示充电状态</label></>}
    {selectedItem.componentType === "systemStats" && <>{numberInput("刷新间隔（秒）", "refreshSeconds", 3, 1, 60)}{rangeInput("文字大小", "fontSize", 32, 16, 80)}{colorInput("颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "network" && <>{rangeInput("文字大小", "fontSize", 48, 18, 130)}{colorInput("颜色", "color", "#ffffff")}</>}
    {selectedItem.componentType === "calendar" && <>{numberInput("月份偏移", "monthOffset", 0, -12, 12)}{colorInput("文字颜色", "color", "#ffffff")}{colorInput("高亮颜色", "accentColor", "#9de8bc")}<label className="check"><input type="checkbox" checked={selectedItem.props.showToday !== false} onChange={(e) => props({ showToday: e.target.checked })} /> 显示今天</label></>}
    {selectedItem.componentType === "pomodoro" && <>{numberInput("专注分钟", "focusMinutes", 25, 1, 240)}{numberInput("休息分钟", "breakMinutes", 5, 1, 120)}{textInput("阶段标签", "label", "专注")}{rangeInput("文字大小", "fontSize", 94, 24, 180)}{colorInput("文字颜色", "color", "#ffffff")}{colorInput("高亮颜色", "accentColor", "#9de8bc")}<button className="ghost-button" onClick={() => props({ startAt: Date.now() })}>重置计时</button></>}
    {selectedItem.componentType === "dayProgress" && <>{textInput("标签", "label", "今天")}{colorInput("进度颜色", "color", "#9de8bc")}{colorInput("轨道颜色", "trackColor", "#ffffff33")}<label className="check"><input type="checkbox" checked={selectedItem.props.showTime !== false} onChange={(e) => props({ showTime: e.target.checked })} /> 显示当前时间</label></>}
    {selectedItem.componentType === "markdown" && <><label>内容<textarea rows={8} value={String(selectedItem.props.content ?? "")} onChange={(e) => props({ content: e.target.value })} /></label>{rangeInput("文字大小", "fontSize", 34, 16, 96)}{rangeInput("行高", "lineHeight", 1.5, 1, 2.4)}{colorInput("文字颜色", "color", "#ffffff")}<label>对齐<select value={String(selectedItem.props.align ?? "left")} onChange={(e) => props({ align: e.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><p className="muted">支持标题（#）、引用（&gt;）和列表（-）。</p></>}
  </> : null;
  return <main className="editor"><header className="editor-head"><button className="text-button" onClick={close}>← 返回我的库</button><div><input className="title-input" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /><small>1920 × 1080 逻辑画布，会自动适配每个显示器；编辑器和运行页共用同一套渲染器</small></div><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await save(project); } finally { setBusy(false); } }}>{busy ? "保存中…" : "保存作品"}</button></header><div className="editor-body"><aside className="editor-left"><p className="eyebrow">添加组件</p><h2>构建你的画面</h2>{componentRegistry.map((definition) => <button className="add-component" key={definition.type} onClick={() => add(definition.type)}><b>{definition.icon}</b><span><strong>{definition.label}</strong><small>{definition.description}</small></span><em>＋</em></button>)}<div className="layers"><p className="eyebrow">图层（按添加顺序渲染）</p>{project.elements.map((item, index) => <button key={item.id} className={selected === item.id ? "layer active" : "layer"} onClick={() => setSelected(item.id)}>{componentRegistry.find((definition) => definition.type === item.componentType)?.icon} {componentLabels[item.componentType]} {index + 1}</button>)}</div></aside><section className="canvas-zone"><div className="canvas-label">预览画布 <span>● 拖动组件以重新布局 · 实际运行使用相同渲染器</span></div><div ref={canvas} className="editor-canvas" onMouseMove={move} onMouseUp={stopDrag} onMouseLeave={stopDrag} onMouseDown={() => setSelected(null)}><Visual project={project} editable selectedId={selected} onPick={pick} /></div></section><aside className="editor-right"><p className="eyebrow">{selectedItem ? "组件属性" : "画布属性"}</p>{selectedItem ? <><h2>{componentLabels[selectedItem.componentType]}</h2>{common}{specific}<button className="danger-button" onClick={() => { setProject((old) => ({ ...old, elements: old.elements.filter((item) => item.id !== selectedItem.id) })); setSelected(null); }}>删除组件</button></> : <><h2>画布背景</h2><label>背景类型<select value={bg.kind ?? "gradient"} onChange={(e) => setBg({ kind: e.target.value as "solid" | "gradient" | "aurora" | "stars" | "waves" })}><option value="gradient">渐变</option><option value="solid">纯色</option><option value="aurora">极光</option><option value="stars">星空</option><option value="waves">波浪</option></select></label><label>起始颜色<input type="color" value={String(bg.start ?? "#0a1024")} onChange={(e) => setBg({ start: e.target.value })} /></label>{["gradient", "solid"].includes(bg.kind ?? "gradient") && bg.kind !== "solid" && <label>结束颜色<input type="color" value={String(bg.end ?? "#243b6b")} onChange={(e) => setBg({ end: e.target.value })} /></label>}{["aurora", "stars", "waves"].includes(bg.kind ?? "") && <label>动画速度<input type="range" min="0.5" max="3" step="0.1" value={Number(bg.speed ?? 1)} onChange={(e) => setBg({ speed: Number(e.target.value) })} /></label>}<Asset id={bg.imageAssetId} className="property-image" alt="背景图片" /><button className="ghost-button" onClick={() => importImage(true)}>导入背景图片</button>{bg.imageAssetId && <button className="text-button" onClick={() => setBg({ imageAssetId: null })}>移除背景图片</button>}<p className="muted">选择组件后，可以编辑内容、尺寸和位置。所有预览和屏保运行页使用相同的逻辑画布比例。</p></>}</aside></div></main>;
}


function Saver() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [saverProjectId, setSaverProjectId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [showUnlock, setShowUnlock] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoadError("");
    Promise.all([api.bootstrap(), api.getSaverProjectId()])
      .then(([nextData, projectId]) => { setData(nextData); setSaverProjectId(projectId); })
      .catch((reason) => setLoadError(String(reason).replace(/^Error:\s*/, "")));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const wake = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && showUnlock) {
        event.preventDefault();
        setPassword("");
        setError("");
        setShowUnlock(false);
        return;
      }
      if (!showUnlock) setShowUnlock(true);
    };
    window.addEventListener("keydown", wake);
    return () => window.removeEventListener("keydown", wake);
  }, [showUnlock]);

  if (loadError) return <main className="saver-shell saver-state"><div><div className="brand-mark">S</div><h1>屏保加载失败</h1><p>{loadError}</p><button className="ghost-button" onClick={load}>重试加载</button></div></main>;
  if (!data) return <main className="saver-shell saver-state"><div><div className="brand-mark">S</div><p>正在加载屏保…</p></div></main>;

  const project = data.projects.find((item) => item.id === saverProjectId) ?? data.projects.find((item) => item.id === data.activeProjectId) ?? data.projects[0];
  if (!project) return <main className="saver-shell saver-state"><div><div className="brand-mark">S</div><h1>没有可用的屏保项目</h1><p>请结束当前覆盖窗口后，在工作台中选择或创建一个项目。</p></div></main>;

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (await api.verifyUnlock(password)) {
        await api.endSaver();
      } else {
        setError("密码不正确，请重试");
        setPassword("");
      }
    } catch (reason) {
      setError("无法完成解锁：" + String(reason).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return <main className="saver-shell" style={backgroundStyle(project)}>
    <div className="saver-stage"><Visual project={project} /></div>
    {!showUnlock && <div className="saver-hint">按任意键以显示解锁界面</div>}
    {showUnlock && <div className="unlock-shade"><form className="unlock-card" onPointerDown={(event) => event.stopPropagation()} onSubmit={unlock}>
      <div className="brand-mark">S</div><p className="eyebrow">SCREENPRO 覆盖式屏保</p><h1>输入密码以退出</h1>
      <p>后台任务仍在继续运行。此模式不能替代 Windows 系统锁屏。</p>
      <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="保护密码" />
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "正在验证…" : "解锁并返回"}</button>
    </form></div>}
  </main>;
}

function Card({ project, active, edit, start, activate, remove }: { project: ScreenSaverProject; active: boolean; edit: () => void; start: () => void; activate: () => void; remove: () => void }) { return <article className="card"><Visual project={project} /><div className="card-body"><div><div className="card-name"><h3>{project.name}</h3>{active && <b>当前</b>}</div><p>{project.description || "自定义屏幕保护"}</p></div><div className="card-actions"><button title="编辑" onClick={edit}>✎</button><button title="立即启动" onClick={start}>▶</button><button title="设为当前" disabled={active} onClick={activate}>✓</button><button title="删除" className="danger" onClick={remove}>⌫</button></div></div></article>; }

function UpdatePanel() {
  const [version, setVersion] = useState("…");
  const [message, setMessage] = useState("通过 GitHub Releases 检查正式版本。");
  const [available, setAvailable] = useState<Awaited<ReturnType<typeof check>>>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getVersion().then(setVersion).catch(() => setVersion("0.1.0")); }, []);
  const checkForUpdate = async () => {
    setBusy(true); setMessage("正在检查 GitHub Releases…");
    try {
      const next = await check(); setAvailable(next);
      setMessage(next ? "发现新版本 v" + next.version + "，可以下载并安装。" : "已经是最新版本。");
    } catch (error) { setMessage("暂时无法检查更新：" + String(error).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  };
  const install = async () => {
    if (!available) return;
    setBusy(true); setMessage("正在下载并验证更新…");
    try { await available.downloadAndInstall(); setMessage("更新已安装。请退出并重新打开 ScreenPro 以使用新版本。"); setAvailable(null); }
    catch (error) { setMessage("安装更新失败：" + String(error).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  };
  return <section className="update-card"><p className="eyebrow">版本更新</p><h2>GitHub Releases</h2><p>当前版本：<b>v{version}</b></p><p className="update-message">{message}</p><div className="update-actions"><button className="primary-button" disabled={busy} onClick={checkForUpdate}>{busy ? "处理中…" : "检查更新"}</button>{available && <button className="ghost-button" disabled={busy} onClick={install}>下载并安装 v{available.version}</button>}</div><small>仅接受由 ScreenPro 发布密钥签名的更新包。</small></section>;
}
const shortcutLabels: Record<string, string> = {
  CommandOrControl: "Ctrl / ⌘",
  Alt: "Alt / ⌥",
  Shift: "Shift / ⇧",
  Space: "空格",
  Enter: "Enter",
  Tab: "Tab",
  Esc: "Esc",
  Backspace: "Backspace",
  Delete: "Delete",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"]);

function shortcutMainKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad\d$/.test(event.code)) return event.code;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key.toUpperCase();
  const aliases: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Escape: "Esc", Backspace: "Backspace", Delete: "Delete",
    Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
    NumpadAdd: "NumpadAdd", NumpadSubtract: "NumpadSubtract", NumpadMultiply: "NumpadMultiply", NumpadDivide: "NumpadDivide",
  };
  return aliases[event.code] ?? null;
}

function shortcutLabel(shortcut: string) {
  return shortcut.split("+").map((part) => shortcutLabels[part] ?? part).join(" + ");
}

function nextLibraryShortcut(pairs: [string, string][]) {
  return Array.from({ length: 9 }, (_, index) => `CommandOrControl+Alt+Shift+${index + 1}`)
    .find((shortcut) => !pairs.some(([key]) => key.toLowerCase() === shortcut.toLowerCase())) ?? "";
}

function ShortcutRecorder({ value, onChange, onCaptureChange, label }: { value: string; onChange: (value: string) => void; onCaptureChange?: (recording: boolean) => Promise<void>; label: string }) {
  const [recording, setRecording] = useState(false);
  const [arming, setArming] = useState(false);
  const [message, setMessage] = useState("");
  const finish = async () => { setRecording(false); await onCaptureChange?.(false); };
  const begin = async () => {
    setMessage("正在临时停用已注册的快捷键…");
    setArming(true);
    try {
      await onCaptureChange?.(true);
      setMessage("");
      setRecording(true);
    } catch {
      setMessage("无法开始录制，请稍后重试");
    } finally {
      setArming(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { void finish(); return; }
    const key = shortcutMainKey(event);
    if (!key) {
      if (modifierKeys.has(event.key)) return setMessage("继续按下一个字母、数字或功能键");
      return setMessage("此按键暂不支持，请使用字母、数字、F 键、方向键或常用功能键");
    }
    const modifiers = [
      ...(event.ctrlKey || event.metaKey ? ["CommandOrControl"] : []),
      ...(event.altKey ? ["Alt"] : []),
      ...(event.shiftKey ? ["Shift"] : []),
    ];
    if (!modifiers.length) return setMessage("请至少同时按下 Ctrl / ⌘、Alt 或 Shift 之一");
    onChange([...modifiers, key].join("+"));
    void finish();
  };
  return <div className="shortcut-recorder-wrap"><button type="button" disabled={arming} className={"shortcut-recorder " + (recording ? "recording" : "")} aria-label={label} onClick={() => { if (!arming) void (recording ? finish() : begin()); }} onKeyDown={onKeyDown} onBlur={() => { if (recording) void finish(); }}>
    {arming ? "正在准备录制…" : recording ? "正在录制… 按下组合键" : shortcutLabel(value)}
  </button><small>{message || (recording ? "按 Esc 取消录制" : "点击后直接按下新的组合键")}</small></div>;
}

function SettingsPanel({ data, settings, setSettings, save, reset, onCaptureChange }: { data: BootstrapData; settings: AppSettings; setSettings: (s: AppSettings) => void; save: () => Promise<void>; reset: (answer: string, password: string, question: string, newAnswer: string) => Promise<void>; onCaptureChange: (recording: boolean) => Promise<void> }) {
 const [openReset, setOpenReset] = useState(false); const [answer, setAnswer] = useState(""); const [password, setPassword] = useState(""); const [question, setQuestion] = useState(data.securityQuestion ?? ""); const [newAnswer, setNewAnswer] = useState(""); const [shortcutError, setShortcutError] = useState(""); const pairs = Object.entries(settings.libraryShortcuts) as [string, string][];
 const duplicate = (value: string, except?: number) => settings.launchShortcut.toLowerCase() === value.toLowerCase() || pairs.some(([key], index) => index !== except && key.toLowerCase() === value.toLowerCase());
 const updateLaunch = (launchShortcut: string) => { if (pairs.some(([key]) => key.toLowerCase() === launchShortcut.toLowerCase())) return setShortcutError(`“${shortcutLabel(launchShortcut)}” 已用于作品快捷键`); setShortcutError(""); setSettings({ ...settings, launchShortcut }); };
 const updatePair = (index: number, isKey: boolean, value: string) => { if (isKey && duplicate(value, index)) return setShortcutError(`“${shortcutLabel(value)}” 已被使用，请录制其他组合键`); setShortcutError(""); setSettings({ ...settings, libraryShortcuts: Object.fromEntries(pairs.map(([key, id], n) => n === index ? (isKey ? [value, id] : [key, value]) : [key, id])) }); };
 const addLibraryShortcut = () => { const shortcut = nextLibraryShortcut(pairs); if (shortcut) setSettings({ ...settings, libraryShortcuts: { ...settings.libraryShortcuts, [shortcut]: data.projects[0].id } }); };
 return <><header className="page-header"><div><p className="eyebrow">设置</p><h1>决定你的保护方式。</h1><p>快捷键在应用后台运行时仍可使用。请避开系统及其他软件占用的组合键。</p></div></header><div className="settings"><section><p className="eyebrow">启动快捷键</p><h2>当前屏保</h2><label>全局快捷键<ShortcutRecorder label="录制启动当前屏保的快捷键" value={settings.launchShortcut} onChange={updateLaunch} onCaptureChange={onCaptureChange} /></label><small>点击后直接按组合键；例如按住 Ctrl + Alt + Shift，再按 S。</small>{shortcutError && <p className="shortcut-error" role="alert">{shortcutError}</p>}<button className="primary-button" onClick={save}>保存并注册快捷键</button></section><section><p className="eyebrow">快捷键库</p><h2>一键启动特定作品</h2><p>可设置最多 9 个组合键，直接启动“我的库”中的指定屏保。</p>{pairs.map(([key, id], index) => <div className="shortcut" key={key}><ShortcutRecorder label={`录制第 ${index + 1} 个作品快捷键`} value={key} onChange={(value) => updatePair(index, true, value)} onCaptureChange={onCaptureChange} /><select value={id} aria-label={`选择第 ${index + 1} 个快捷键对应的屏保`} onChange={(e) => updatePair(index, false, e.target.value)}>{data.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select><button type="button" className="danger" aria-label="删除作品快捷键" onClick={() => setSettings({ ...settings, libraryShortcuts: Object.fromEntries(pairs.filter((_, n) => n !== index)) })}>×</button></div>)}{shortcutError && <p className="shortcut-error" role="alert">{shortcutError}</p>}<button className="ghost-button" disabled={pairs.length >= 9 || !data.projects.length} onClick={addLibraryShortcut}>＋ 添加作品快捷键</button></section><section><p className="eyebrow">退出验证</p><h2>应用独立密码</h2><p>安全问题：{data.securityQuestion}</p><button className="ghost-button" onClick={() => setOpenReset(!openReset)}>重设密码</button>{openReset && <div className="reset"><label>原安全问题答案<input type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} /></label><label>新密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>新安全问题<input value={question} onChange={(e) => setQuestion(e.target.value)} /></label><label>新答案<input type="password" value={newAnswer} onChange={(e) => setNewAnswer(e.target.value)} /></label><button className="primary-button" onClick={() => reset(answer, password, question, newAnswer)}>确认重设</button></div>}</section><UpdatePanel /></div></>;
}

function Workbench() {
  const [data, setData] = useState<BootstrapData | null>(null); const [view, setView] = useState<View>("home"); const [editor, setEditor] = useState<ScreenSaverProject | null>(null); const [showNew, setShowNew] = useState(false); const [name, setName] = useState("我的新屏保"); const [notice, setNotice] = useState<Notice>(null); const [settings, setSettings] = useState<AppSettings | null>(null);
  const refresh = async () => { const next = await api.bootstrap(); setData(next); setSettings(next.settings); };
  useEffect(() => { refresh().catch((e) => setNotice({ kind: "bad", text: String(e) })); }, []);
  useEffect(() => {
    let disposed = false;
    let stopStarted: (() => void) | undefined;
    let stopError: (() => void) | undefined;
    listen("saver-started", () => setNotice(null)).then((stop) => { if (disposed) stop(); else stopStarted = stop; }).catch(() => undefined);
    listen<string>("saver-start-error", ({ payload }) => setNotice({ kind: "bad", text: "屏保启动失败：" + payload })).then((stop) => { if (disposed) stop(); else stopError = stop; }).catch(() => undefined);
    return () => { disposed = true; stopStarted?.(); stopError?.(); };
  }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);
  const error = (e: unknown) => setNotice({ kind: "bad", text: String(e).replace(/^Error:\s*/, "") });
  const register = async (next: AppSettings) => {
    await globalShortcut.unregisterAll();
    try {
      const pairs = [{ key: next.launchShortcut, id: undefined }, ...Object.entries(next.libraryShortcuts).map(([key, id]) => ({ key, id }))];
      for (const pair of pairs) await globalShortcut.register(pair.key, () => api.startSaver(pair.id).catch((reason) => { console.error("快捷键启动屏保失败", reason); setNotice({ kind: "bad", text: "快捷键启动失败：" + String(reason).replace(/^Error:\s*/, "") }); }));
    } catch (reason) {
      await globalShortcut.unregisterAll().catch(() => undefined);
      throw reason;
    }
  };
  useEffect(() => { if (data?.hasSecurity) register(data.settings).catch(() => undefined); return () => { globalShortcut.unregisterAll().catch(() => undefined); }; }, [data?.hasSecurity]);
if (!data) return <main className="loading"><div className="brand-mark">S</div>正在打开 ScreenPro…</main>; if (!data.hasSecurity) return <SecuritySetup done={refresh} />; if (editor) return <Editor source={editor} close={() => setEditor(null)} save={async (project) => {
    const before = data;
    setData((current) => current ? { ...current, projects: current.projects.map((item) => item.id === project.id ? project : item) } : current);
    setEditor(null);
    setNotice({ kind: "ok", text: "正在保存作品…" });
    try {
      const saved = await api.saveProject(project);
      setData((current) => current ? { ...current, projects: current.projects.map((item) => item.id === saved.id ? saved : item) } : current);
      setNotice({ kind: "ok", text: "作品已保存到我的库" });
    } catch (e) {
      if (before) setData(before);
      setEditor(project);
      error(e);
    }
  }} />;
  const active = data.projects.find((p) => p.id === data.activeProjectId); const launch = async (id?: string) => { setNotice({ kind: "ok", text: "正在启动屏保…" }); try { await api.startSaver(id); } catch (e) { error(e); } }; const make = async () => { try { const p = await api.createBlank(name); await refresh(); setShowNew(false); setEditor(p); } catch (e) { error(e); } }; const getTemplate = async (template: ScreenSaverProject) => { try { const p = await api.cloneTemplate(template.id); await refresh(); setEditor(p); setNotice({ kind: "ok", text: "已下载到我的库，可以开始编辑" }); } catch (e) { error(e); } };
  return <div className="app"><aside className="sidebar"><div className="app-brand"><div className="brand-mark">S</div><div><strong>ScreenPro</strong><small>Screen saver studio</small></div></div><nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "nav active" : "nav"} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav><div className="side-foot"><div>◉ <span><b>本地保护已启用</b><small>不终止后台程序</small></span></div><small>v0.1.6 · Windows MVP</small></div></aside><main className="content">{view === "home" && <><header className="page-header"><div><p className="eyebrow">工作台</p><h1>让屏幕在离开时，仍然有温度。</h1><p>选择一份作品，按下快捷键。屏保会在每个显示器上创建独立的全屏窗口，同时让后台工作继续运行；需要真正锁定时，请使用 Windows 系统锁定。</p></div><div className="launch-actions"><button className="secure-button" onClick={async () => { try { await api.lockSystem(); } catch (e) { error(e); } }}>🔒 安全锁定 Windows</button><button className="primary-button" disabled={!active} onClick={() => launch()}>▶ 启动覆盖式屏保</button></div></header><section className="home-grid"><article className="active-card"><div className="card-heading"><div><p className="eyebrow">当前屏幕保护</p><h2>{active?.name ?? "还没有作品"}</h2></div>{active && <button className="ghost-button" onClick={() => setEditor(active)}>编辑作品</button>}</div>{active ? <Visual project={active} /> : <div className="empty-visual">前往资源库下载模板，或创建空白项目。</div>}<footer><kbd>{data.settings.launchShortcut.replace("CommandOrControl", "Ctrl / ⌘")}</kbd><span>启动覆盖式屏保</span></footer></article><article className="info-card"><span>⌁</span><p className="eyebrow">保护方式</p><h2>展示保护，不替代系统锁屏</h2><p>当前版本为每个显示器创建独立的无边框屏保窗口，不会结束下载、渲染、同步或其他后台进程。工作台窗口会在屏保期间隐藏，验证密码后恢复。</p><hr /><small>它不能可靠拦截 Alt + Tab、任务管理器或其他 Windows 系统入口。需要安全锁定请使用上方“安全锁定 Windows”。</small></article></section><section className="section"><div className="section-title"><div><p className="eyebrow">最近作品</p><h2>我的屏保库</h2></div><button className="text-button" onClick={() => setView("library")}>查看全部 →</button></div>{data.projects.length ? <div className="cards">{data.projects.slice(0, 3).map((p) => <Card key={p.id} project={p} active={p.id === data.activeProjectId} edit={() => setEditor(p)} start={() => launch(p.id)} activate={async () => { await api.setActive(p.id); await refresh(); }} remove={() => {}} />)}</div> : <div className="empty">你的私人屏保库还是空的。<button className="primary-button" onClick={() => setView("market")}>探索资源库</button></div>}</section></>}
{view === "library" && <><header className="page-header"><div><p className="eyebrow">我的库</p><h1>每一份屏保，都是你的私有空间。</h1><p>从空白画布开始，或将资源库中的模板下载后继续编辑。</p></div><button className="primary-button" onClick={() => setShowNew(true)}>＋ 新建屏保</button></header>{data.projects.length ? <div className="cards library-cards">{data.projects.map((p) => <Card key={p.id} project={p} active={p.id === data.activeProjectId} edit={() => setEditor(p)} start={() => launch(p.id)} activate={async () => { await api.setActive(p.id); await refresh(); setNotice({ kind: "ok", text: "已设为当前屏保：" + p.name }); }} remove={async () => { if (confirm("删除“" + p.name + "”？")) { await api.deleteProject(p.id); await refresh(); } }} />)}</div> : <div className="empty tall"><h2>从一张空白画布开始</h2><p>添加文字、图片或时钟组件，构建自己的布局。</p><button className="primary-button" onClick={() => setShowNew(true)}>＋ 新建屏保</button></div>}</>}{view === "market" && <><header className="page-header"><div><p className="eyebrow">资源库</p><h1>从灵感开始，再变成你的。</h1><p>内置模板离线可用。下载到“我的库”后，便成为你可任意修改的私有作品。</p></div></header><div className="templates">{data.templates.map((p) => <article className="template" key={p.id}><Visual project={p} /><div><p className="eyebrow">内置模板</p><h2>{p.name}</h2><p>{p.description}</p><button className="primary-button" onClick={() => getTemplate(p)}>↓ 下载到我的库</button></div></article>)}</div></>}{view === "settings" && settings && <SettingsPanel data={data} settings={settings} setSettings={setSettings} save={async () => { const previous = data.settings; try { await register(settings); await api.saveSettings(settings); await refresh(); setNotice({ kind: "ok", text: "快捷键已保存并注册" }); } catch (e) { await register(previous).catch(() => undefined); error("快捷键没有保存，已恢复原有绑定：" + String(e)); await refresh(); } }} onCaptureChange={async (recording) => { if (recording) await globalShortcut.unregisterAll(); else await register(data.settings); }} reset={async (a, p, q, n) => { await api.resetSecurity(a, p, q, n); await refresh(); setNotice({ kind: "ok", text: "保护密码已重设" }); }} />}</main>{showNew && <div className="modal-wrap"><form className="modal" onSubmit={(e) => { e.preventDefault(); make(); }}><button type="button" className="close" onClick={() => setShowNew(false)}>×</button><p className="eyebrow">从零开始</p><h2>新建屏幕保护</h2><p>创建后可以添加文字、图片和时钟组件。</p><label>屏保名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setShowNew(false)}>取消</button><button className="primary-button">创建空白项目</button></div></form></div>}{notice && <div className={"notice " + notice.kind}>{notice.kind === "ok" ? "✓" : "!"} {notice.text}</div>}</div>;
}

function App() {
  const [saverWindow, setSaverWindow] = useState<boolean | null>(null);

  useEffect(() => {
    setSaverWindow(getCurrentWindow().label.startsWith("saver-"));
  }, []);

  if (saverWindow === null) {
    return <main className="loading"><div className="brand-mark">S</div>正在启动 ScreenPro…</main>;
  }
  return saverWindow ? <Saver /> : <Workbench />;
}

export default App;
