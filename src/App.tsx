import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-dialog";
import * as globalShortcut from "@tauri-apps/plugin-global-shortcut";
import { api } from "./api";
import { blankComponent, CANVAS, componentLabels, type AppSettings, type BootstrapData, type ComponentType, type SaverComponent, type ScreenSaverProject } from "./types";
import "./App.css";

type View = "home" | "library" | "market" | "settings";
type Notice = { kind: "ok" | "bad"; text: string } | null;
const nav: { id: View; label: string; icon: string }[] = [{ id: "home", label: "工作台", icon: "◈" }, { id: "library", label: "我的库", icon: "▦" }, { id: "market", label: "资源库", icon: "✦" }, { id: "settings", label: "设置", icon: "⚙" }];
const clockText = (format: string) => { const d = new Date(); return format.replace("HH", String(d.getHours()).padStart(2, "0")).replace("mm", String(d.getMinutes()).padStart(2, "0")).replace("ss", String(d.getSeconds()).padStart(2, "0")); };

function Asset({ id, className = "", alt = "图片" }: { id?: string | null; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let live = true; if (!id) { setSrc(null); return; } api.getAssetPath(id).then((path) => live && setSrc(convertFileSrc(path))).catch(() => live && setSrc(null)); return () => { live = false; }; }, [id]);
  return src ? <img src={src} alt={alt} className={className} /> : <div className={"image-placeholder " + className}><span>▧</span><small>选择图片</small></div>;
}

function Piece({ item, selected, editable, onPick }: { item: SaverComponent; selected?: boolean; editable?: boolean; onPick?: (event: MouseEvent<HTMLDivElement>) => void }) {
  const [, tick] = useState(0); useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const p = item.props; const style: CSSProperties = { left: (item.x / CANVAS.width) * 100 + "%", top: (item.y / CANVAS.height) * 100 + "%", width: (item.width / CANVAS.width) * 100 + "%", height: (item.height / CANVAS.height) * 100 + "%" };
  const cls = "piece " + (selected ? "selected " : "") + (editable ? "editable" : "");
  if (item.componentType === "text") return <div style={style} className={cls} onMouseDown={onPick}><div className="text-piece" style={{ color: String(p.color ?? "#fff"), fontSize: "clamp(11px, " + (Number(p.fontSize ?? 48) / CANVAS.width) * 100 + "vw, " + Number(p.fontSize ?? 48) + "px)", fontWeight: Number(p.fontWeight ?? 600), textAlign: (p.align as "left" | "center" | "right") ?? "center" }}>{String(p.content ?? "文字")}</div></div>;
  if (item.componentType === "clock") return <div style={style} className={cls} onMouseDown={onPick}><div className="clock-piece" style={{ color: String(p.color ?? "#fff"), textAlign: (p.align as "left" | "center" | "right") ?? "center" }}><strong style={{ fontSize: "clamp(20px, " + (Number(p.fontSize ?? 120) / CANVAS.width) * 100 + "vw, " + Number(p.fontSize ?? 120) + "px)" }}>{clockText(String(p.format ?? "HH:mm"))}</strong>{p.showDate !== false && <span>{new Intl.DateTimeFormat("zh-CN", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</span>}</div></div>;
  return <div style={style} className={cls} onMouseDown={onPick}><Asset id={p.assetId as string | null} className="image-piece" /></div>;
}

function Visual({ project, editable, selectedId, onPick }: { project: ScreenSaverProject; editable?: boolean; selectedId?: string | null; onPick?: (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => void }) {
  const bg = project.background ?? {}; const style: CSSProperties = bg.kind === "solid" ? { background: String(bg.start ?? "#0A1024") } : { background: "linear-gradient(135deg, " + String(bg.start ?? "#0A1024") + ", " + String(bg.end ?? "#243B6B") + ")" };
  return <div className="visual" style={style}>{bg.imageAssetId && <Asset id={bg.imageAssetId} className="background-image" alt="背景" />}{project.elements.map((item) => <Piece key={item.id} item={item} editable={editable} selected={item.id === selectedId} onPick={onPick ? (event) => onPick(event, item) : undefined} />)}</div>;
}

function SecuritySetup({ done }: { done: () => void }) {
  const [password, setPassword] = useState(""); const [again, setAgain] = useState(""); const [question, setQuestion] = useState("你最喜欢的城市是哪里？"); const [answer, setAnswer] = useState(""); const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (password !== again) return setError("两次密码不一致"); try { await api.setupSecurity(password, question, answer); done(); } catch (err) { setError(String(err)); } };
  return <main className="security-shell"><form className="security-card" onSubmit={submit}><div className="brand-mark">S</div><p className="eyebrow">WELCOME TO SCREENPRO</p><h1>设置屏幕保护密码</h1><p>退出屏保必须验证此密码；后台程序不会停止。</p><label>保护密码<input required minLength={4} type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>确认密码<input required minLength={4} type="password" value={again} onChange={(e) => setAgain(e.target.value)} /></label><label>安全问题<input required value={question} onChange={(e) => setQuestion(e.target.value)} /></label><label>安全问题答案<input required minLength={4} type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button">完成设置</button><small>凭据仅以 Argon2id 哈希形式存储在本机。</small></form></main>;
}

function Editor({ source, close, save }: { source: ScreenSaverProject; close: () => void; save: (project: ScreenSaverProject) => Promise<void> }) {
  const [project, setProject] = useState<ScreenSaverProject>(() => structuredClone(source)); const [selected, setSelected] = useState<string | null>(source.elements[0]?.id ?? null); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null); const canvas = useRef<HTMLDivElement>(null);
  const selectedItem = project.elements.find((item) => item.id === selected) ?? null;
  const patch = (next: Partial<SaverComponent>) => selectedItem && setProject((old) => ({ ...old, elements: old.elements.map((item) => item.id === selectedItem.id ? { ...item, ...next } : item) }));
  const props = (next: Record<string, unknown>) => selectedItem && patch({ props: { ...selectedItem.props, ...next } });
  const add = (type: ComponentType) => { const item = blankComponent(type); setProject((old) => ({ ...old, elements: [...old.elements, item] })); setSelected(item.id); };
  const pick = (event: MouseEvent<HTMLDivElement>, item: SaverComponent) => { event.stopPropagation(); const r = canvas.current!.getBoundingClientRect(); setSelected(item.id); setDrag({ id: item.id, dx: (event.clientX - r.left) * CANVAS.width / r.width - item.x, dy: (event.clientY - r.top) * CANVAS.height / r.height - item.y }); };
  const move = (event: MouseEvent<HTMLDivElement>) => { if (!drag || !canvas.current) return; const r = canvas.current.getBoundingClientRect(); setProject((old) => ({ ...old, elements: old.elements.map((item) => item.id !== drag.id ? item : { ...item, x: Math.max(0, Math.min(CANVAS.width - item.width, (event.clientX - r.left) * CANVAS.width / r.width - drag.dx)), y: Math.max(0, Math.min(CANVAS.height - item.height, (event.clientY - r.top) * CANVAS.height / r.height - drag.dy)) }) })); };
  const image = async () => { if (!selectedItem || selectedItem.componentType !== "image") return; const path = await open({ filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] }); if (typeof path === "string") props({ assetId: await api.importAsset(path) }); };
  const bg = project.background ?? {};
  return <main className="editor"><header className="editor-head"><button className="text-button" onClick={close}>← 返回我的库</button><div><input className="title-input" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /><small>1920 × 1080 逻辑画布，会自动适配每个显示器</small></div><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); await save(project); setBusy(false); }}>{busy ? "保存中…" : "保存作品"}</button></header><div className="editor-body"><aside className="editor-left"><p className="eyebrow">添加组件</p><h2>构建你的画面</h2>{(["text", "image", "clock"] as ComponentType[]).map((type) => <button className="add-component" key={type} onClick={() => add(type)}><b>{type === "text" ? "T" : type === "image" ? "▧" : "◷"}</b><span><strong>{componentLabels[type]}</strong><small>{type === "text" ? "文字内容" : type === "image" ? "本地图片" : "当前时间"}</small></span><em>＋</em></button>)}<div className="layers"><p className="eyebrow">图层</p>{project.elements.map((item, index) => <button key={item.id} className={selected === item.id ? "layer active" : "layer"} onClick={() => setSelected(item.id)}>{item.componentType === "text" ? "T" : item.componentType === "image" ? "▧" : "◷"} {componentLabels[item.componentType]} {index + 1}</button>)}</div></aside><section className="canvas-zone"><div className="canvas-label">预览画布 <span>● 拖动组件以重新布局</span></div><div ref={canvas} className="editor-canvas" onMouseMove={move} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)} onMouseDown={() => setSelected(null)}><Visual project={project} editable selectedId={selected} onPick={pick} /></div></section><aside className="editor-right"><p className="eyebrow">{selectedItem ? "组件属性" : "画布属性"}</p>{selectedItem ? <><h2>{componentLabels[selectedItem.componentType]}</h2><div className="pair"><label>X<input type="number" value={Math.round(selectedItem.x)} onChange={(e) => patch({ x: Number(e.target.value) })} /></label><label>Y<input type="number" value={Math.round(selectedItem.y)} onChange={(e) => patch({ y: Number(e.target.value) })} /></label></div><div className="pair"><label>宽度<input min="10" type="number" value={Math.round(selectedItem.width)} onChange={(e) => patch({ width: Number(e.target.value) })} /></label><label>高度<input min="10" type="number" value={Math.round(selectedItem.height)} onChange={(e) => patch({ height: Number(e.target.value) })} /></label></div>{selectedItem.componentType === "text" && <><label>文字内容<textarea value={String(selectedItem.props.content ?? "")} onChange={(e) => props({ content: e.target.value })} /></label><label>字体大小<input min="16" max="180" type="range" value={Number(selectedItem.props.fontSize ?? 58)} onChange={(e) => props({ fontSize: Number(e.target.value) })} /></label><label>颜色<input type="color" value={String(selectedItem.props.color ?? "#ffffff")} onChange={(e) => props({ color: e.target.value })} /></label><label>对齐<select value={String(selectedItem.props.align ?? "center")} onChange={(e) => props({ align: e.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></>}{selectedItem.componentType === "image" && <><Asset id={selectedItem.props.assetId as string | null} className="property-image" /><button className="ghost-button" onClick={image}>导入本地图片</button><label>圆角<input type="range" min="0" max="100" value={Number(selectedItem.props.radius ?? 28)} onChange={(e) => props({ radius: Number(e.target.value) })} /></label></>}{selectedItem.componentType === "clock" && <><label>时间格式<select value={String(selectedItem.props.format ?? "HH:mm")} onChange={(e) => props({ format: e.target.value })}><option value="HH:mm">24 小时</option><option value="HH:mm:ss">含秒钟</option></select></label><label>文字大小<input min="32" max="220" type="range" value={Number(selectedItem.props.fontSize ?? 120)} onChange={(e) => props({ fontSize: Number(e.target.value) })} /></label><label>颜色<input type="color" value={String(selectedItem.props.color ?? "#ffffff")} onChange={(e) => props({ color: e.target.value })} /></label><label className="check"><input type="checkbox" checked={selectedItem.props.showDate !== false} onChange={(e) => props({ showDate: e.target.checked })} /> 显示日期</label></>}<button className="danger-button" onClick={() => { setProject((old) => ({ ...old, elements: old.elements.filter((item) => item.id !== selectedItem.id) })); setSelected(null); }}>删除组件</button></> : <><h2>画布背景</h2><label>背景类型<select value={bg.kind ?? "gradient"} onChange={(e) => setProject({ ...project, background: { ...bg, kind: e.target.value as "solid" | "gradient" } })}><option value="gradient">渐变</option><option value="solid">纯色</option></select></label><label>起始颜色<input type="color" value={String(bg.start ?? "#0a1024")} onChange={(e) => setProject({ ...project, background: { ...bg, start: e.target.value } })} /></label>{bg.kind !== "solid" && <label>结束颜色<input type="color" value={String(bg.end ?? "#243b6b")} onChange={(e) => setProject({ ...project, background: { ...bg, end: e.target.value } })} /></label>}<p className="muted">选择一个组件后，可以编辑内容、尺寸和位置。</p></>}</aside></div></main>;
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
    const wake = () => setShowUnlock(true);
    window.addEventListener("keydown", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("pointermove", wake);
    return () => {
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

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
        window.location.hash = "";
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

  return <main className="saver-shell" onPointerDown={() => setShowUnlock(true)} onPointerMove={() => setShowUnlock(true)}>
    <Visual project={project} />
    {!showUnlock && <div className="saver-hint">移动鼠标、点击或按任意键以显示解锁界面</div>}
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
function SettingsPanel({ data, settings, setSettings, save, reset }: { data: BootstrapData; settings: AppSettings; setSettings: (s: AppSettings) => void; save: () => Promise<void>; reset: (answer: string, password: string, question: string, newAnswer: string) => Promise<void> }) {
 const [openReset, setOpenReset] = useState(false); const [answer, setAnswer] = useState(""); const [password, setPassword] = useState(""); const [question, setQuestion] = useState(data.securityQuestion ?? ""); const [newAnswer, setNewAnswer] = useState(""); const pairs = Object.entries(settings.libraryShortcuts);
 const updatePair = (index: number, isKey: boolean, value: string) => setSettings({ ...settings, libraryShortcuts: Object.fromEntries(pairs.map(([key, id], n) => n === index ? (isKey ? [value, id] : [key, value]) : [key, id])) });
 return <><header className="page-header"><div><p className="eyebrow">设置</p><h1>决定你的保护方式。</h1><p>快捷键在应用后台运行时仍可使用。请避开系统及其他软件占用的组合键。</p></div></header><div className="settings"><section><p className="eyebrow">启动快捷键</p><h2>当前屏保</h2><label>全局快捷键<input value={settings.launchShortcut} onChange={(e) => setSettings({ ...settings, launchShortcut: e.target.value })} /></label><small>例如：CommandOrControl+Alt+Shift+S</small><button className="primary-button" onClick={save}>保存并注册快捷键</button></section><section><p className="eyebrow">快捷键库</p><h2>一键启动特定作品</h2><p>可设置最多 9 个组合键，直接启动“我的库”中的指定屏保。</p>{pairs.map(([key, id], index) => <div className="shortcut" key={index}><input value={key} onChange={(e) => updatePair(index, true, e.target.value)} /><select value={id} onChange={(e) => updatePair(index, false, e.target.value)}>{data.projects.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select><button className="danger" onClick={() => setSettings({ ...settings, libraryShortcuts: Object.fromEntries(pairs.filter((_, n) => n !== index)) })}>×</button></div>)}<button className="ghost-button" disabled={pairs.length >= 9 || !data.projects.length} onClick={() => setSettings({ ...settings, libraryShortcuts: { ...settings.libraryShortcuts, ["CommandOrControl+Alt+Shift+" + (pairs.length + 1)]: data.projects[0].id } })}>＋ 添加作品快捷键</button></section><section><p className="eyebrow">退出验证</p><h2>应用独立密码</h2><p>安全问题：{data.securityQuestion}</p><button className="ghost-button" onClick={() => setOpenReset(!openReset)}>重设密码</button>{openReset && <div className="reset"><label>原安全问题答案<input type="password" value={answer} onChange={(e) => setAnswer(e.target.value)} /></label><label>新密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>新安全问题<input value={question} onChange={(e) => setQuestion(e.target.value)} /></label><label>新答案<input type="password" value={newAnswer} onChange={(e) => setNewAnswer(e.target.value)} /></label><button className="primary-button" onClick={() => reset(answer, password, question, newAnswer)}>确认重设</button></div>}</section><UpdatePanel /></div></>;
}

function App() {
  const [data, setData] = useState<BootstrapData | null>(null); const [view, setView] = useState<View>("home"); const [editor, setEditor] = useState<ScreenSaverProject | null>(null); const [showNew, setShowNew] = useState(false); const [name, setName] = useState("我的新屏保"); const [notice, setNotice] = useState<Notice>(null); const [settings, setSettings] = useState<AppSettings | null>(null);
  const refresh = async () => { const next = await api.bootstrap(); setData(next); setSettings(next.settings); };
  useEffect(() => { refresh().catch((e) => setNotice({ kind: "bad", text: String(e) })); }, []); useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);
  const error = (e: unknown) => setNotice({ kind: "bad", text: String(e).replace(/^Error:\s*/, "") });
  const register = async (next: AppSettings) => { await globalShortcut.unregisterAll(); const pairs = [{ key: next.launchShortcut, id: undefined }, ...Object.entries(next.libraryShortcuts).map(([key, id]) => ({ key, id }))]; for (const pair of pairs) await globalShortcut.register(pair.key, () => api.startSaver(pair.id).then(() => { window.location.hash = "#/saver"; }).catch(() => undefined)); };
  useEffect(() => { if (data?.hasSecurity) register(data.settings).catch(() => undefined); return () => { globalShortcut.unregisterAll().catch(() => undefined); }; }, [data?.hasSecurity]);
  const isSaverWindow = location.hash.startsWith("#/saver"); if (isSaverWindow) return <Saver />; if (!data) return <main className="loading"><div className="brand-mark">S</div>正在打开 ScreenPro…</main>; if (!data.hasSecurity) return <SecuritySetup done={refresh} />; if (editor) return <Editor source={editor} close={() => setEditor(null)} save={async (project) => { try { await api.saveProject(project); await refresh(); setEditor(null); setNotice({ kind: "ok", text: "作品已保存到我的库" }); } catch (e) { error(e); } }} />;
  const active = data.projects.find((p) => p.id === data.activeProjectId); const launch = async (id?: string) => { try { await api.startSaver(id); window.location.hash = "#/saver"; } catch (e) { error(e); } }; const make = async () => { try { const p = await api.createBlank(name); await refresh(); setShowNew(false); setEditor(p); } catch (e) { error(e); } }; const getTemplate = async (template: ScreenSaverProject) => { try { const p = await api.cloneTemplate(template.id); await refresh(); setEditor(p); setNotice({ kind: "ok", text: "已下载到我的库，可以开始编辑" }); } catch (e) { error(e); } };
  return <div className="app"><aside className="sidebar"><div className="app-brand"><div className="brand-mark">S</div><div><strong>ScreenPro</strong><small>Screen saver studio</small></div></div><nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "nav active" : "nav"} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav><div className="side-foot"><div>◉ <span><b>本地保护已启用</b><small>不终止后台程序</small></span></div><small>v0.1.4 · Windows MVP</small></div></aside><main className="content">{view === "home" && <><header className="page-header"><div><p className="eyebrow">工作台</p><h1>让屏幕在离开时，仍然有温度。</h1><p>选择一份作品，按下快捷键。覆盖式屏保会让当前工作台全屏显示，同时让后台工作继续运行；需要真正锁定时，请使用 Windows 系统锁定。</p></div><div className="launch-actions"><button className="secure-button" onClick={async () => { try { await api.lockSystem(); } catch (e) { error(e); } }}>🔒 安全锁定 Windows</button><button className="primary-button" disabled={!active} onClick={() => launch()}>▶ 启动覆盖式屏保</button></div></header><section className="home-grid"><article className="active-card"><div className="card-heading"><div><p className="eyebrow">当前屏幕保护</p><h2>{active?.name ?? "还没有作品"}</h2></div>{active && <button className="ghost-button" onClick={() => setEditor(active)}>编辑作品</button>}</div>{active ? <Visual project={active} /> : <div className="empty-visual">前往资源库下载模板，或创建空白项目。</div>}<footer><kbd>{data.settings.launchShortcut.replace("CommandOrControl", "Ctrl / ⌘")}</kbd><span>启动覆盖式屏保</span></footer></article><article className="info-card"><span>⌁</span><p className="eyebrow">保护方式</p><h2>展示保护，不替代系统锁屏</h2><p>当前稳定版复用工作台进入全屏覆盖，不会结束下载、渲染、同步或其他后台进程。多显示器独立窗口覆盖将在稳定后恢复。</p><hr /><small>它不能可靠拦截 Alt + Tab、任务管理器或其他 Windows 系统入口。需要安全锁定请使用上方“安全锁定 Windows”。</small></article></section><section className="section"><div className="section-title"><div><p className="eyebrow">最近作品</p><h2>我的屏保库</h2></div><button className="text-button" onClick={() => setView("library")}>查看全部 →</button></div>{data.projects.length ? <div className="cards">{data.projects.slice(0, 3).map((p) => <Card key={p.id} project={p} active={p.id === data.activeProjectId} edit={() => setEditor(p)} start={() => launch(p.id)} activate={async () => { await api.setActive(p.id); await refresh(); }} remove={() => {}} />)}</div> : <div className="empty">你的私人屏保库还是空的。<button className="primary-button" onClick={() => setView("market")}>探索资源库</button></div>}</section></>}
{view === "library" && <><header className="page-header"><div><p className="eyebrow">我的库</p><h1>每一份屏保，都是你的私有空间。</h1><p>从空白画布开始，或将资源库中的模板下载后继续编辑。</p></div><button className="primary-button" onClick={() => setShowNew(true)}>＋ 新建屏保</button></header>{data.projects.length ? <div className="cards library-cards">{data.projects.map((p) => <Card key={p.id} project={p} active={p.id === data.activeProjectId} edit={() => setEditor(p)} start={() => launch(p.id)} activate={async () => { await api.setActive(p.id); await refresh(); setNotice({ kind: "ok", text: "已设为当前屏保：" + p.name }); }} remove={async () => { if (confirm("删除“" + p.name + "”？")) { await api.deleteProject(p.id); await refresh(); } }} />)}</div> : <div className="empty tall"><h2>从一张空白画布开始</h2><p>添加文字、图片或时钟组件，构建自己的布局。</p><button className="primary-button" onClick={() => setShowNew(true)}>＋ 新建屏保</button></div>}</>}{view === "market" && <><header className="page-header"><div><p className="eyebrow">资源库</p><h1>从灵感开始，再变成你的。</h1><p>内置模板离线可用。下载到“我的库”后，便成为你可任意修改的私有作品。</p></div></header><div className="templates">{data.templates.map((p) => <article className="template" key={p.id}><Visual project={p} /><div><p className="eyebrow">内置模板</p><h2>{p.name}</h2><p>{p.description}</p><button className="primary-button" onClick={() => getTemplate(p)}>↓ 下载到我的库</button></div></article>)}</div></>}{view === "settings" && settings && <SettingsPanel data={data} settings={settings} setSettings={setSettings} save={async () => { try { await api.saveSettings(settings); await register(settings); await refresh(); setNotice({ kind: "ok", text: "快捷键已保存并注册" }); } catch (e) { error("快捷键没有保存：" + String(e)); await refresh(); } }} reset={async (a, p, q, n) => { await api.resetSecurity(a, p, q, n); await refresh(); setNotice({ kind: "ok", text: "保护密码已重设" }); }} />}</main>{showNew && <div className="modal-wrap"><form className="modal" onSubmit={(e) => { e.preventDefault(); make(); }}><button type="button" className="close" onClick={() => setShowNew(false)}>×</button><p className="eyebrow">从零开始</p><h2>新建屏幕保护</h2><p>创建后可以添加文字、图片和时钟组件。</p><label>屏保名称<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setShowNew(false)}>取消</button><button className="primary-button">创建空白项目</button></div></form></div>}{notice && <div className={"notice " + notice.kind}>{notice.kind === "ok" ? "✓" : "!"} {notice.text}</div>}</div>;
}

export default App;
