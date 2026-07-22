use tungstenite::{connect, Message};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    AppHandle, Emitter, LogicalUnit, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent, WindowSizeConstraints,
};
use uuid::Uuid;

const STORE_FILE: &str = "screenpro-store.json";
const ASSETS_DIR: &str = "assets";
const CANVAS_WIDTH: f64 = 1920.0;
const CANVAS_HEIGHT: f64 = 1080.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Component {
    id: String,
    component_type: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    props: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreenSaverProject {
    id: String,
    schema_version: u32,
    name: String,
    description: String,
    #[serde(default = "default_background")]
    background: Value,
    #[serde(default)]
    elements: Vec<Component>,
    #[serde(default)]
    created_at: u64,
    #[serde(default)]
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecuritySettings {
    password_hash: Option<String>,
    security_question: Option<String>,
    security_answer_hash: Option<String>,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            password_hash: None,
            security_question: None,
            security_answer_hash: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    launch_shortcut: String,
    #[serde(default)]
    library_shortcuts: BTreeMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            launch_shortcut: "CommandOrControl+Alt+Shift+S".into(),
            library_shortcuts: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    schema_version: u32,
    #[serde(default)]
    projects: Vec<ScreenSaverProject>,
    active_project_id: Option<String>,
    #[serde(default)]
    settings: AppSettings,
    #[serde(default)]
    security: SecuritySettings,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            schema_version: 1,
            projects: Vec::new(),
            active_project_id: None,
            settings: AppSettings::default(),
            security: SecuritySettings::default(),
        }
    }
}

#[derive(Debug, Clone)]
struct WorkbenchWindowState {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
}

#[derive(Debug, Clone, Copy)]
struct SaverWindowBounds {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale_factor: f64,
}

struct AppState {
    store: Mutex<Store>,
    saver_active: Mutex<bool>,
    saver_project_id: Mutex<Option<String>>,
    workbench_window_state: Mutex<Option<WorkbenchWindowState>>,
    saver_windows: Mutex<BTreeMap<String, SaverWindowBounds>>,
    saver_starting: Mutex<bool>,
}

fn default_background() -> Value {
    json!({ "kind": "gradient", "start": "#0A1024", "end": "#243B6B", "imageAssetId": null })
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn text_component(content: &str, x: f64, y: f64, size: f64, color: &str) -> Component {
    Component {
        id: Uuid::new_v4().to_string(),
        component_type: "text".into(),
        x,
        y,
        width: 900.0,
        height: 120.0,
        props: json!({ "content": content, "fontSize": size, "color": color, "align": "center", "fontWeight": 600 }),
    }
}

fn clock_component(x: f64, y: f64, size: f64, color: &str) -> Component {
    Component {
        id: Uuid::new_v4().to_string(),
        component_type: "clock".into(),
        x,
        y,
        width: 700.0,
        height: 190.0,
        props: json!({ "format": "HH:mm", "fontSize": size, "color": color, "align": "center", "showDate": true }),
    }
}

fn image_component(x: f64, y: f64) -> Component {
    Component {
        id: Uuid::new_v4().to_string(),
        component_type: "image".into(),
        x,
        y,
        width: 540.0,
        height: 380.0,
        props: json!({ "assetId": null, "fit": "cover", "radius": 28 }),
    }
}

fn project(
    name: &str,
    description: &str,
    background: Value,
    elements: Vec<Component>,
) -> ScreenSaverProject {
    let timestamp = now();
    ScreenSaverProject {
        id: Uuid::new_v4().to_string(),
        schema_version: 1,
        name: name.into(),
        description: description.into(),
        background,
        elements,
        created_at: timestamp,
        updated_at: timestamp,
    }
}

fn builtin_templates() -> Vec<ScreenSaverProject> {
    let mut templates = vec![
        project(
            "极简文字",
            "让一句话留在屏幕中央",
            json!({ "kind": "gradient", "start": "#09090B", "end": "#1F2937" }),
            vec![text_component(
                "专注当下，享受此刻。",
                510.0,
                450.0,
                62.0,
                "#FFFFFF",
            )],
        ),
        project(
            "照片展示",
            "将你的照片变成安静的屏幕画面",
            json!({ "kind": "gradient", "start": "#28223E", "end": "#131827" }),
            vec![
                image_component(690.0, 300.0),
                text_component("选择一张照片，留住这一刻", 510.0, 775.0, 36.0, "#F4E8FF"),
            ],
        ),
        project(
            "数字时钟",
            "清晰、安静的时间显示",
            json!({ "kind": "gradient", "start": "#0B1D2A", "end": "#123A45" }),
            vec![clock_component(610.0, 350.0, 150.0, "#E9FFFC")],
        ),
        project(
            "深色专注",
            "深色背景与轻柔的专注提示",
            json!({ "kind": "solid", "start": "#09090B", "end": "#09090B" }),
            vec![
                clock_component(610.0, 280.0, 112.0, "#A7F3D0"),
                text_component("深呼吸，然后继续前进", 510.0, 665.0, 40.0, "#D1FAE5"),
            ],
        ),
    ];
    for (template, id) in templates.iter_mut().zip([
        "builtin-minimal-text",
        "builtin-photo-showcase",
        "builtin-digital-clock",
        "builtin-focus-dark",
    ]) {
        template.id = id.to_string();
    }
    templates
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录：{err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建数据目录：{err}"))?;
    fs::create_dir_all(dir.join(ASSETS_DIR)).map_err(|err| format!("无法创建资源目录：{err}"))?;
    Ok(dir)
}

fn load_store(app: &AppHandle) -> Result<Store, String> {
    let path = data_dir(app)?.join(STORE_FILE);
    if !path.exists() {
        return Ok(Store::default());
    }
    let raw = fs::read_to_string(&path).map_err(|err| format!("无法读取本地数据：{err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("本地数据格式无效：{err}"))
}

fn persist_store(app: &AppHandle, store: &Store) -> Result<(), String> {
    let path = data_dir(app)?.join(STORE_FILE);
    let tmp = path.with_extension("json.tmp");
    let content =
        serde_json::to_string_pretty(store).map_err(|err| format!("无法序列化本地数据：{err}"))?;
    fs::write(&tmp, content).map_err(|err| format!("无法写入本地数据：{err}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|err| format!("无法替换本地数据：{err}"))?;
    }
    fs::rename(&tmp, &path).map_err(|err| format!("无法保存本地数据：{err}"))
}

fn with_store<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut Store) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<AppState>();
    let mut store = state
        .store
        .lock()
        .map_err(|_| "本地数据正在被其他操作使用".to_string())?;
    let value = action(&mut store)?;
    persist_store(app, &store)?;
    Ok(value)
}

fn hash_secret(secret: &str) -> Result<String, String> {
    if secret.trim().len() < 4 {
        return Err("密码或答案至少需要 4 个字符".into());
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| format!("无法安全保存凭据：{err}"))
}

fn verify_secret(secret: &str, saved: &str) -> bool {
    PasswordHash::new(saved)
        .ok()
        .and_then(|hash| {
            Argon2::default()
                .verify_password(secret.as_bytes(), &hash)
                .ok()
        })
        .is_some()
}

fn validate_project(project: &ScreenSaverProject) -> Result<(), String> {
    if project.name.trim().is_empty() {
        return Err("请为屏保命名".into());
    }
    if project.name.chars().count() > 60 {
        return Err("屏保名称不能超过 60 个字符".into());
    }
    if project.elements.len() > 60 {
        return Err("一个屏保最多包含 60 个组件".into());
    }
    for component in &project.elements {
        if !matches!(
            component.component_type.as_str(),
            "text"
                | "image"
                | "clock"
                | "date"
                | "countdown"
                | "progress"
                | "worldClock"
                | "qr"
                | "webPreview"
                | "github"
                | "rss"
                | "quote"
                | "photoWall"
                | "weather"
                | "battery"
                | "systemStats"
                | "network"
                | "calendar"
                | "pomodoro"
                | "dayProgress"
                | "markdown"
        ) {
            return Err("包含当前版本不支持的组件".into());
        }
        if component.width <= 0.0 || component.height <= 0.0 {
            return Err("组件尺寸必须大于 0".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn get_bootstrap(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据正在被其他操作使用".to_string())?;
    Ok(json!({
        "hasSecurity": store.security.password_hash.is_some(),
        "securityQuestion": store.security.security_question,
        "projects": store.projects,
        "templates": builtin_templates(),
        "activeProjectId": store.active_project_id,
        "settings": store.settings,
        "canvas": { "width": CANVAS_WIDTH, "height": CANVAS_HEIGHT }
    }))
}

#[tauri::command]
fn create_blank_project(app: AppHandle, name: String) -> Result<ScreenSaverProject, String> {
    with_store(&app, |store| {
        let item = project(
            &name,
            "从空白画布开始创建",
            default_background(),
            Vec::new(),
        );
        validate_project(&item)?;
        store.projects.push(item.clone());
        if store.active_project_id.is_none() {
            store.active_project_id = Some(item.id.clone());
        }
        Ok(item)
    })
}

#[tauri::command]
fn clone_template(
    app: AppHandle,
    template_id: String,
    name: Option<String>,
) -> Result<ScreenSaverProject, String> {
    with_store(&app, |store| {
        let template = builtin_templates()
            .into_iter()
            .find(|item| item.id == template_id)
            .ok_or("找不到此内置模板")?;
        let item = ScreenSaverProject {
            id: Uuid::new_v4().to_string(),
            name: name.unwrap_or_else(|| format!("{} 副本", template.name)),
            created_at: now(),
            updated_at: now(),
            ..template
        };
        store.projects.push(item.clone());
        if store.active_project_id.is_none() {
            store.active_project_id = Some(item.id.clone());
        }
        Ok(item)
    })
}

#[tauri::command]
fn save_project(
    app: AppHandle,
    mut project: ScreenSaverProject,
) -> Result<ScreenSaverProject, String> {
    with_store(&app, |store| {
        project.schema_version = 1;
        project.updated_at = now();
        validate_project(&project)?;
        let existing = store
            .projects
            .iter_mut()
            .find(|item| item.id == project.id)
            .ok_or("找不到要保存的屏保")?;
        *existing = project.clone();
        Ok(project)
    })
}

#[tauri::command]
fn delete_project(app: AppHandle, project_id: String) -> Result<(), String> {
    with_store(&app, |store| {
        let before = store.projects.len();
        store.projects.retain(|item| item.id != project_id);
        if before == store.projects.len() {
            return Err("找不到要删除的屏保".into());
        }
        if store.active_project_id.as_deref() == Some(&project_id) {
            store.active_project_id = store.projects.first().map(|item| item.id.clone());
        }
        store
            .settings
            .library_shortcuts
            .retain(|_, id| id != &project_id);
        Ok(())
    })
}

#[tauri::command]
fn set_active_project(app: AppHandle, project_id: String) -> Result<(), String> {
    with_store(&app, |store| {
        if !store.projects.iter().any(|item| item.id == project_id) {
            return Err("找不到要设为当前的屏保".into());
        }
        store.active_project_id = Some(project_id);
        Ok(())
    })
}

fn validate_settings(
    settings: &AppSettings,
    projects: &[ScreenSaverProject],
) -> Result<(), String> {
    if settings.launch_shortcut.trim().is_empty() {
        return Err("请设置启动当前屏保的快捷键".into());
    }
    let mut values = vec![settings.launch_shortcut.clone()];
    values.extend(settings.library_shortcuts.keys().cloned());
    let mut canonical = values
        .iter()
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>();
    canonical.sort();
    if canonical.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("快捷键不能重复".into());
    }
    if settings.library_shortcuts.len() > 9 {
        return Err("最多可配置 9 个库快捷键".into());
    }
    if settings
        .library_shortcuts
        .values()
        .any(|id| !projects.iter().any(|project| &project.id == id))
    {
        return Err("快捷键关联了不存在的屏保".into());
    }
    Ok(())
}
#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    with_store(&app, |store| {
        validate_settings(&settings, &store.projects)?;

        store.settings = settings.clone();
        Ok(settings)
    })
}

#[tauri::command]
fn setup_security(
    app: AppHandle,
    password: String,
    security_question: String,
    security_answer: String,
) -> Result<(), String> {
    with_store(&app, |store| {
        if store.security.password_hash.is_some() {
            return Err("密码已经设置，请使用重设密码".into());
        }
        if security_question.trim().len() < 5 {
            return Err("请填写安全问题".into());
        }
        store.security = SecuritySettings {
            password_hash: Some(hash_secret(&password)?),
            security_question: Some(security_question.trim().to_string()),
            security_answer_hash: Some(hash_secret(&security_answer)?),
        };
        Ok(())
    })
}

#[tauri::command]
fn verify_unlock(app: AppHandle, password: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据正在被其他操作使用".to_string())?;
    let Some(hash) = store.security.password_hash.as_deref() else {
        return Err("请先设置保护密码".into());
    };
    Ok(verify_secret(&password, hash))
}

#[tauri::command]
fn verify_security_answer(app: AppHandle, answer: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据正在被其他操作使用".to_string())?;
    let Some(hash) = store.security.security_answer_hash.as_deref() else {
        return Err("尚未设置安全问题".into());
    };
    Ok(verify_secret(&answer, hash))
}

#[tauri::command]
fn reset_security(
    app: AppHandle,
    answer: String,
    password: String,
    security_question: String,
    security_answer: String,
) -> Result<(), String> {
    with_store(&app, |store| {
        let old_answer = store
            .security
            .security_answer_hash
            .as_deref()
            .ok_or("尚未设置安全问题")?;
        if !verify_secret(&answer, old_answer) {
            return Err("安全问题答案不正确".into());
        }
        if security_question.trim().len() < 5 {
            return Err("请填写安全问题".into());
        }
        store.security = SecuritySettings {
            password_hash: Some(hash_secret(&password)?),
            security_question: Some(security_question.trim().to_string()),
            security_answer_hash: Some(hash_secret(&security_answer)?),
        };
        Ok(())
    })
}

fn web_browser_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    {
        candidates.extend([
            PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        ]);
    }
    #[cfg(target_os = "macos")]
    {
        candidates.extend([
            PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        ]);
    }
    #[cfg(target_os = "linux")]
    {
        candidates.extend([
            PathBuf::from("/usr/bin/microsoft-edge"),
            PathBuf::from("/usr/bin/google-chrome"),
            PathBuf::from("/usr/bin/chromium"),
            PathBuf::from("/usr/bin/chromium-browser"),
        ]);
    }
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .collect()
}

fn read_local_json(port: u16, path: &str) -> Result<Value, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .map_err(|err| format!("browser debug connection failed: {err}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(300)))
        .map_err(|err| err.to_string())?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|err| err.to_string())?;
    let mut response = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut buffer = [0_u8; 8192];
    while Instant::now() < deadline {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                response.extend_from_slice(&buffer[..size]);
                if let Some(value) = parse_local_json_response(&response) {
                    return Ok(value);
                }
            }
            Err(err)
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(err) => return Err(err.to_string()),
        }
    }
    Err("browser debug response timed out".into())
}

fn parse_local_json_response(response: &[u8]) -> Option<Value> {
    let separator = b"\r\n\r\n";
    let body_start = response
        .windows(separator.len())
        .position(|window| window == separator)?
        + separator.len();
    let body = &response[body_start..];
    let start = body
        .iter()
        .position(|byte| *byte == b'[' || *byte == b'{')?;
    let end_byte = if body[start] == b'[' { b']' } else { b'}' };
    let end = body.iter().rposition(|byte| *byte == end_byte)?;
    serde_json::from_slice(&body[start..=end]).ok()
}

fn cdp_call<S: Read + Write>(
    socket: &mut tungstenite::WebSocket<S>,
    next_id: &mut u64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = *next_id;
    *next_id += 1;
    let payload = json!({ "id": id, "method": method, "params": params }).to_string();
    socket
        .send(Message::Text(payload.into()))
        .map_err(|err| format!("browser command failed: {err}"))?;
    loop {
        let message = socket
            .read()
            .map_err(|err| format!("browser response failed: {err}"))?;
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => {
                String::from_utf8(bytes.to_vec()).map_err(|err| err.to_string())?
            }
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Close(_) => return Err("browser closed the debug session".into()),
            Message::Frame(_) => continue,
        };
        let value: Value =
            serde_json::from_str(&text).map_err(|err| format!("browser JSON invalid: {err}"))?;
        if value.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(format!("browser command {method} failed: {error}"));
        }
        return Ok(value);
    }
}

fn normalize_cdp_websocket_url(raw: &str, port: u16) -> String {
    // Chromium occasionally returns a websocket URL without the ephemeral
    // debugging port (for example: ws://127.0.0.1/devtools/page/...).
    // Always rebuild the authority from the listener we created, while
    // preserving the websocket path. This avoids connecting to port 80.
    let raw = raw.trim();
    if let Some(path_start) = raw.find("/devtools/") {
        let scheme = if raw.starts_with("wss://") {
            "wss"
        } else {
            "ws"
        };
        return format!("{scheme}://127.0.0.1:{port}{}", &raw[path_start..]);
    }

    raw.replacen("localhost", "127.0.0.1", 1)
}

fn capture_web_thumbnail_impl(url: &str, viewport_width: u32) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http and https pages can be captured".into());
    }
    let browser = web_browser_candidates()
        .into_iter()
        .next()
        .ok_or("no Chromium-based browser found; install Microsoft Edge or Google Chrome")?;
    let port = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|err| err.to_string())?
        .local_addr()
        .map_err(|err| err.to_string())?
        .port();
    let profile = std::env::temp_dir().join(format!("screenpro-web-{}", Uuid::new_v4()));
    fs::create_dir_all(&profile).map_err(|err| format!("cannot create browser profile: {err}"))?;
    let mut child = Command::new(&browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--disable-extensions",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            "--remote-allow-origins=*",
            "--remote-debugging-address=127.0.0.1",
        ])
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        .arg(format!(
            "--window-size={},900",
            viewport_width.clamp(640, 2400)
        ))
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("cannot start browser: {err}"))?;

    let result = (|| {
        let deadline = Instant::now() + Duration::from_secs(12);
        let targets = loop {
            if let Ok(value) = read_local_json(port, "/json/list") {
                if value.as_array().is_some_and(|items| {
                    items
                        .iter()
                        .any(|item| item.get("webSocketDebuggerUrl").is_some())
                }) {
                    break value;
                }
            }
            if Instant::now() >= deadline {
                return Err("browser debug endpoint did not start".into());
            }
            if child.try_wait().map_err(|err| err.to_string())?.is_some() {
                return Err("browser exited before the page could be captured".into());
            }
            sleep(Duration::from_millis(150));
        };
        let websocket_url = targets
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item.get("type").and_then(Value::as_str) == Some("page"))
            })
            .or_else(|| targets.as_array().and_then(|items| items.first()))
            .and_then(|item| item.get("webSocketDebuggerUrl"))
            .and_then(Value::as_str)
            .ok_or("browser did not expose a page debug websocket")?
            .to_string();
        let websocket_url = normalize_cdp_websocket_url(&websocket_url, port);
        let (mut socket, _) =
            connect(websocket_url).map_err(|err| format!("cannot connect to browser: {err}"))?;
        let mut next_id = 1;
        cdp_call(&mut socket, &mut next_id, "Page.enable", json!({}))?;
        cdp_call(&mut socket, &mut next_id, "Runtime.enable", json!({}))?;
        cdp_call(
            &mut socket,
            &mut next_id,
            "Page.navigate",
            json!({ "url": url }),
        )?;
        sleep(Duration::from_secs(3));
        let metrics = cdp_call(
            &mut socket,
            &mut next_id,
            "Runtime.evaluate",
            json!({
                "expression": "JSON.stringify({width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)})",
                "returnByValue": true
            }),
        )?;
        let metrics_text = metrics
            .pointer("/result/result/value")
            .and_then(Value::as_str)
            .ok_or("browser did not return page dimensions")?;
        let metrics: Value = serde_json::from_str(metrics_text)
            .map_err(|err| format!("page dimensions invalid: {err}"))?;
        let width = metrics
            .get("width")
            .and_then(Value::as_f64)
            .unwrap_or(viewport_width as f64)
            .max(viewport_width as f64)
            .clamp(640.0, 8192.0);
        let height = metrics
            .get("height")
            .and_then(Value::as_f64)
            .unwrap_or(900.0)
            .max(900.0)
            .clamp(900.0, 12000.0);
        let screenshot = cdp_call(
            &mut socket,
            &mut next_id,
            "Page.captureScreenshot",
            json!({
                "format": "png",
                "fromSurface": true,
                "captureBeyondViewport": true,
                "clip": { "x": 0, "y": 0, "width": width, "height": height, "scale": 1 }
            }),
        )?;
        let data = screenshot
            .pointer("/result/data")
            .and_then(Value::as_str)
            .ok_or("browser did not return a screenshot")?;
        Ok(format!("data:image/png;base64,{data}"))
    })();
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_dir_all(&profile);
    result
}

#[tauri::command]
async fn capture_web_thumbnail(url: String, viewport_width: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capture_web_thumbnail_impl(&url, viewport_width))
        .await
        .map_err(|err| format!("web thumbnail worker failed: {err}"))?
}

#[tauri::command]
fn import_asset(app: AppHandle, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("选择的图片不存在".into());
    }
    let extension = source
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("png")
        .to_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
        return Err("仅支持 PNG、JPG、WEBP 或 GIF 图片".into());
    }
    let asset_id = Uuid::new_v4().to_string();
    let target = data_dir(&app)?
        .join(ASSETS_DIR)
        .join(format!("{asset_id}.{extension}"));
    fs::copy(&source, &target).map_err(|err| format!("无法导入图片：{err}"))?;
    Ok(asset_id)
}

#[tauri::command]
fn get_asset_path(app: AppHandle, asset_id: String) -> Result<String, String> {
    let dir = data_dir(&app)?.join(ASSETS_DIR);
    let entry = fs::read_dir(&dir)
        .map_err(|err| format!("无法读取资源目录：{err}"))?
        .flatten()
        .find(|entry| entry.file_name().to_string_lossy().starts_with(&asset_id))
        .ok_or("找不到图片资源")?;
    Ok(entry.path().to_string_lossy().to_string())
}

fn find_project(app: &AppHandle, project_id: &str) -> Result<ScreenSaverProject, String> {
    let state = app.state::<AppState>();
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据正在被其他操作使用".to_string())?;
    store
        .projects
        .iter()
        .find(|item| item.id == project_id)
        .cloned()
        .ok_or_else(|| "找不到屏保项目".into())
}

fn restore_workbench_window(
    main: &WebviewWindow,
    snapshot: Option<WorkbenchWindowState>,
) -> Result<(), String> {
    let _ = main.set_fullscreen(false);
    main.set_always_on_top(false)
        .map_err(|err| format!("无法恢复工作台窗口层级：{err}"))?;
    main.set_decorations(true)
        .map_err(|err| format!("无法恢复工作台窗口边框：{err}"))?;
    // Clear the fixed saver bounds before returning control to the workbench.
    main.set_size_constraints(WindowSizeConstraints::default())
        .map_err(|err| format!("无法清除工作台窗口尺寸约束：{err}"))?;
    main.set_resizable(true)
        .map_err(|err| format!("无法恢复工作台窗口尺寸：{err}"))?;

    if let Some(snapshot) = snapshot {
        let _ = main.unmaximize();
        main.set_size(snapshot.size)
            .map_err(|err| format!("无法恢复工作台窗口大小：{err}"))?;
        main.set_position(snapshot.position)
            .map_err(|err| format!("无法恢复工作台窗口位置：{err}"))?;
        if snapshot.maximized {
            main.maximize()
                .map_err(|err| format!("无法恢复工作台最大化状态：{err}"))?;
        }
    }

    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
    Ok(())
}

fn saver_constraints(monitor_size: PhysicalSize<u32>, scale_factor: f64) -> WindowSizeConstraints {
    let safe_scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let logical_width = monitor_size.width as f64 / safe_scale;
    let logical_height = monitor_size.height as f64 / safe_scale;

    WindowSizeConstraints {
        min_width: Some(LogicalUnit::new(logical_width).into()),
        min_height: Some(LogicalUnit::new(logical_height).into()),
        max_width: Some(LogicalUnit::new(logical_width).into()),
        max_height: Some(LogicalUnit::new(logical_height).into()),
    }
}

fn saver_bounds_from_monitor(monitor: &tauri::Monitor) -> SaverWindowBounds {
    SaverWindowBounds {
        position: *monitor.position(),
        size: *monitor.size(),
        scale_factor: monitor.scale_factor(),
    }
}

fn cover_window_to_bounds(main: &WebviewWindow, bounds: SaverWindowBounds) -> Result<(), String> {
    // On Windows, applying an exact min/max logical constraint before setting
    // the physical monitor size can make a newly-created WebView window fail
    // to show on fractional-DPI displays. The native non-resizable flag is
    // the primary guard; geometry constraints are best-effort hardening.
    let _ = main.set_fullscreen(false);
    let _ = main.unmaximize();
    main.set_decorations(false)
        .map_err(|err| format!("无法移除屏保窗口边框：{err}"))?;
    main.set_resizable(false)
        .map_err(|err| format!("无法锁定屏保窗口尺寸：{err}"))?;

    main.set_position(bounds.position)
        .map_err(|err| format!("无法归位屏保窗口：{err}"))?;
    main.set_size(bounds.size)
        .map_err(|err| format!("无法铺满屏保窗口：{err}"))?;

    // Do not make a constraint failure abort saver startup. Tauri's native
    // resizable=false flag and the geometry reassertion handlers still prevent
    // ordinary resize attempts, while this avoids a DPI-specific dead stop.
    let _ = main.set_size_constraints(saver_constraints(bounds.size, bounds.scale_factor));
    main.set_always_on_top(true)
        .map_err(|err| format!("无法置顶屏保窗口：{err}"))?;
    main.show()
        .map_err(|err| format!("无法显示屏保窗口：{err}"))?;
    let _ = main.unminimize();
    main.set_focus()
        .map_err(|err| format!("无法聚焦屏保窗口：{err}"))?;
    Ok(())
}

fn create_saver_windows(app: &AppHandle) -> Result<(), String> {
    let monitors = app
        .available_monitors()
        .map_err(|err| format!("无法枚举显示器：{err}"))?;
    if monitors.is_empty() {
        return Err("没有检测到可用显示器".into());
    }

    let mut created_labels: Vec<String> = Vec::with_capacity(monitors.len());
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("saver-{index}");
        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.close();
        }
        let bounds = saver_bounds_from_monitor(monitor);
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("ScreenPro 屏保")
            .decorations(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .visible(false)
            .build()
            .map_err(|err| format!("无法创建屏保窗口 {label}：{err}"))?;

        app.state::<AppState>()
            .saver_windows
            .lock()
            .map_err(|_| "屏保窗口状态异常".to_string())?
            .insert(label.clone(), bounds);

        if let Err(error) = cover_window_to_bounds(&window, bounds) {
            let _ = window.close();
            for created in &created_labels {
                if let Some(existing) = app.get_webview_window(created) {
                    let _ = existing.close();
                }
            }
            app.state::<AppState>()
                .saver_windows
                .lock()
                .map_err(|_| "屏保窗口状态异常".to_string())?
                .clear();
            return Err(error);
        }
        created_labels.push(label);
    }
    Ok(())
}

fn close_saver_windows(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut windows = state
        .saver_windows
        .lock()
        .map_err(|_| "屏保窗口状态异常".to_string())?;
    let labels = std::mem::take(&mut *windows)
        .into_keys()
        .collect::<Vec<_>>();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
    Ok(())
}

fn reassert_saver_window_after(app: AppHandle, label: String, delay: Duration) {
    std::thread::spawn(move || {
        if !delay.is_zero() {
            std::thread::sleep(delay);
        }
        let active = app
            .state::<AppState>()
            .saver_active
            .lock()
            .map(|active| *active)
            .unwrap_or(false);
        if !active {
            return;
        }
        let bounds = app
            .state::<AppState>()
            .saver_windows
            .lock()
            .ok()
            .and_then(|windows| windows.get(&label).copied());
        if let (Some(window), Some(bounds)) = (app.get_webview_window(&label), bounds) {
            let _ = cover_window_to_bounds(&window, bounds);
        }
    });
}

fn reassert_saver_window(app: AppHandle, label: String) {
    reassert_saver_window_after(app, label, Duration::from_millis(160));
}

fn reassert_saver_geometry(app: AppHandle, label: String) {
    reassert_saver_window_after(app, label, Duration::ZERO);
}

fn reassert_all_saver_windows(app: AppHandle) {
    let labels = app
        .state::<AppState>()
        .saver_windows
        .lock()
        .map(|windows| windows.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for label in labels {
        reassert_saver_window(app.clone(), label);
    }
}
fn activate_main_saver(app: &AppHandle, project_id: &str) -> Result<(), String> {
    find_project(app, project_id)?;
    let state = app.state::<AppState>();
    {
        let mut active = state
            .saver_active
            .lock()
            .map_err(|_| "屏保状态异常".to_string())?;
        let starting = *state
            .saver_starting
            .lock()
            .map_err(|_| "屏保状态异常".to_string())?;
        if *active {
            if starting {
                return Err("屏保正在启动，请稍候".into());
            }
            let saver_labels = state
                .saver_windows
                .lock()
                .map(|windows| windows.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let has_actual_saver_window = saver_labels
                .iter()
                .any(|label| app.get_webview_window(label).is_some());
            if has_actual_saver_window {
                return Err("屏保已经在运行".into());
            }
            if let Ok(mut windows) = state.saver_windows.lock() {
                windows.clear();
            }
            *active = false;
        }
        *active = true;
    }
    *state
        .saver_starting
        .lock()
        .map_err(|_| "屏保状态异常".to_string())? = true;
    *state
        .saver_project_id
        .lock()
        .map_err(|_| "屏保状态异常".to_string())? = Some(project_id.to_string());

    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let main = app_for_thread
                .get_webview_window("main")
                .ok_or("找不到主工作台窗口")?;
            let state = app_for_thread.state::<AppState>();
            let snapshot = WorkbenchWindowState {
                position: main
                    .outer_position()
                    .map_err(|err| format!("无法读取工作台窗口位置：{err}"))?,
                size: main
                    .inner_size()
                    .map_err(|err| format!("无法读取工作台窗口大小：{err}"))?,
                maximized: main
                    .is_maximized()
                    .map_err(|err| format!("无法读取工作台窗口状态：{err}"))?,
            };
            *state
                .workbench_window_state
                .lock()
                .map_err(|_| "屏保状态异常".to_string())? = Some(snapshot);

            // Dynamic WebviewWindow creation must run on a worker thread in
            // Wry. Calling the builder from the invoke/event-loop thread can
            // deadlock before the command returns.
            create_saver_windows(&app_for_thread)?;
            main.hide()
                .map_err(|err| format!("无法隐藏工作台窗口：{err}"))?;
            Ok(())
        })();

        let state = app_for_thread.state::<AppState>();
        match result {
            Ok(()) => {
                if let Ok(mut starting) = state.saver_starting.lock() {
                    *starting = false;
                }
                let _ = app_for_thread.emit("saver-started", ());
            }
            Err(error) => {
                let _ = close_saver_windows(&app_for_thread);
                let main = app_for_thread.get_webview_window("main");
                let snapshot = state
                    .workbench_window_state
                    .lock()
                    .ok()
                    .and_then(|mut value| value.take());
                if let Some(main) = main {
                    let _ = restore_workbench_window(&main, snapshot);
                }
                if let Ok(mut active) = state.saver_active.lock() {
                    *active = false;
                }
                if let Ok(mut starting) = state.saver_starting.lock() {
                    *starting = false;
                }
                if let Ok(mut project) = state.saver_project_id.lock() {
                    *project = None;
                }
                let _ = app_for_thread.emit("saver-start-error", error);
            }
        }
    });
    Ok(())
}
#[tauri::command]
fn start_saver(app: AppHandle, project_id: Option<String>) -> Result<(), String> {
    let selected = match project_id {
        Some(id) => id,
        None => {
            let state = app.state::<AppState>();
            let store = state
                .store
                .lock()
                .map_err(|_| "本地数据正在被其他操作使用".to_string())?;
            store
                .active_project_id
                .clone()
                .ok_or("请先在我的库中设置当前屏保")?
        }
    };
    activate_main_saver(&app, &selected)
}

#[tauri::command]
fn end_saver(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Mark inactive before closing native saver windows so their close events
    // cannot trigger a new reassertion while the password is already verified.
    *state
        .saver_active
        .lock()
        .map_err(|_| "屏保状态异常".to_string())? = false;
    if let Ok(mut starting) = state.saver_starting.lock() {
        *starting = false;
    }
    *state
        .saver_project_id
        .lock()
        .map_err(|_| "屏保状态异常".to_string())? = None;
    close_saver_windows(&app)?;
    let snapshot = state
        .workbench_window_state
        .lock()
        .map_err(|_| "屏保状态异常".to_string())?
        .take();

    let main = app.get_webview_window("main").ok_or("找不到主工作台窗口")?;
    restore_workbench_window(&main, snapshot)
}
#[tauri::command]
fn saver_status(app: AppHandle) -> Result<bool, String> {
    Ok(*app
        .state::<AppState>()
        .saver_active
        .lock()
        .map_err(|_| "屏保状态异常".to_string())?)
}

#[tauri::command]
fn get_saver_project_id(app: AppHandle) -> Result<Option<String>, String> {
    app.state::<AppState>()
        .saver_project_id
        .lock()
        .map(|project_id| project_id.clone())
        .map_err(|_| "屏保状态异常".to_string())
}

#[tauri::command]
fn lock_system() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let locked = unsafe { windows_sys::Win32::System::Shutdown::LockWorkStation() };
        if locked == 0 {
            return Err("Windows 未能启动系统锁定".into());
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前版本仅提供 Windows 系统锁定；macOS 支持将在 macOS 构建时加入".into())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            let app = window.app_handle().clone();
            let label = window.label().to_string();
            let saver_active = app
                .state::<AppState>()
                .saver_active
                .lock()
                .map(|active| *active)
                .unwrap_or(false);
            if !saver_active {
                return;
            }

            if label.starts_with("saver-") {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        // The password flow is the only supported way to close a saver.
                        api.prevent_close();
                        reassert_saver_window(app, label);
                    }
                    WindowEvent::Focused(false) => {
                        reassert_saver_window(app, label);
                    }
                    WindowEvent::Resized(_)
                    | WindowEvent::Moved(_)
                    | WindowEvent::ScaleFactorChanged { .. } => {
                        reassert_saver_geometry(app, label);
                    }
                    _ => {}
                }
            } else if label == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // The workbench is hidden during saver mode and cannot be used
                    // as a password bypass through Task View or a close request.
                    api.prevent_close();
                    reassert_all_saver_windows(app);
                }
            }
        })
        .setup(|app| {
            let store = load_store(&app.handle()).unwrap_or_else(|err| {
                eprintln!("无法加载本地数据：{err}");
                Store::default()
            });
            app.manage(AppState {
                store: Mutex::new(store),
                saver_active: Mutex::new(false),
                saver_project_id: Mutex::new(None),
                workbench_window_state: Mutex::new(None),
                saver_windows: Mutex::new(BTreeMap::new()),
                saver_starting: Mutex::new(false),
            });
            // A prior interrupted saver can leave the native main window minimized or hidden.
            // Always restore the workbench when a new process starts.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            create_blank_project,
            clone_template,
            save_project,
            delete_project,
            set_active_project,
            save_settings,
            setup_security,
            verify_unlock,
            verify_security_answer,
            reset_security,
            import_asset,
            capture_web_thumbnail,
            get_asset_path,
            start_saver,
            end_saver,
            saver_status,
            get_saver_project_id,
            lock_system
        ])
        .run(tauri::generate_context!())
        .expect("启动 ScreenPro 时发生错误");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdp_websocket_url_always_uses_the_owned_debug_port() {
        assert_eq!(
            normalize_cdp_websocket_url("ws://127.0.0.1/devtools/page/ABC", 19421),
            "ws://127.0.0.1:19421/devtools/page/ABC"
        );
        assert_eq!(
            normalize_cdp_websocket_url("ws://localhost:9222/devtools/page/XYZ", 19422),
            "ws://127.0.0.1:19422/devtools/page/XYZ"
        );
    }

    #[test]
    fn project_documents_round_trip_without_losing_components() {
        let original = project(
            "测试",
            "序列化",
            default_background(),
            vec![
                text_component("你好", 10.0, 20.0, 40.0, "#ffffff"),
                clock_component(50.0, 60.0, 88.0, "#00ffcc"),
            ],
        );
        let encoded = serde_json::to_string(&original).expect("project serializes");
        let decoded: ScreenSaverProject =
            serde_json::from_str(&encoded).expect("project deserializes");
        assert_eq!(decoded.schema_version, 1);
        assert_eq!(decoded.elements.len(), 2);
        assert_eq!(decoded.elements[0].component_type, "text");
        assert_eq!(decoded.elements[1].component_type, "clock");
    }

    #[test]
    fn default_templates_are_editable_mvp_templates() {
        let templates = builtin_templates();
        assert_eq!(templates.len(), 4);
        assert!(templates.iter().any(|item| item.name == "极简文字"));
        assert!(templates.iter().any(|item| item
            .elements
            .iter()
            .any(|element| element.component_type == "clock")));
        assert!(templates.iter().all(|item| validate_project(item).is_ok()));
        let second_read = builtin_templates();
        assert_eq!(
            templates.iter().map(|item| &item.id).collect::<Vec<_>>(),
            second_read.iter().map(|item| &item.id).collect::<Vec<_>>()
        );
    }

    #[test]
    fn secrets_use_hashes_and_verify_only_the_right_value() {
        let hash = hash_secret("correct horse battery staple").expect("hash secret");
        assert_ne!(hash, "correct horse battery staple");
        assert!(verify_secret("correct horse battery staple", &hash));
        assert!(!verify_secret("incorrect", &hash));
    }

    #[test]
    fn shortcut_validation_rejects_duplicate_or_missing_project() {
        let projects = vec![project("测试", "", default_background(), vec![])];
        let mut duplicate = AppSettings::default();
        duplicate
            .library_shortcuts
            .insert(duplicate.launch_shortcut.clone(), projects[0].id.clone());
        assert!(validate_settings(&duplicate, &projects).is_err());
        let mut missing = AppSettings::default();
        missing
            .library_shortcuts
            .insert("CommandOrControl+Alt+1".into(), "missing".into());
        assert!(validate_settings(&missing, &projects).is_err());
    }
}
