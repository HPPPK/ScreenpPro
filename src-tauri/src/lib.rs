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
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
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

struct AppState {
    store: Mutex<Store>,
    saver_windows: Mutex<Vec<String>>,
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
            "text" | "image" | "clock"
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

fn create_saver_windows(app: &AppHandle, project_id: &str) -> Result<(), String> {
    find_project(app, project_id)?;
    let state = app.state::<AppState>();
    if !state
        .saver_windows
        .lock()
        .map_err(|_| "屏保状态异常".to_string())?
        .is_empty()
    {
        return Err("屏保已经在运行".into());
    }
    let monitors = app
        .available_monitors()
        .map_err(|err| format!("无法读取显示器：{err}"))?;
    let monitors = if monitors.is_empty() {
        vec![app
            .primary_monitor()
            .map_err(|err| format!("无法读取主显示器：{err}"))?
            .ok_or("没有可用显示器")?]
    } else {
        monitors
    };
    let mut labels = Vec::new();
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("saver-{index}");
        let size = monitor.size();
        let position = monitor.position();
        let window = WebviewWindowBuilder::new(
            app,
            &label,
            // Route selection is based on the Tauri window label in React. Keeping the
            // Webview URL to a plain packaged document avoids a second-window blank page.
            WebviewUrl::App("index.html".into()),
        )
        .title("ScreenPro")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .closable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(false)
        .position(position.x as f64, position.y as f64)
        .inner_size(size.width as f64, size.height as f64)
        .build()
        .map_err(|err| format!("无法创建屏保窗口：{err}"))?;
        // Apply the presentation properties once more after construction. On some Windows
        // WebView2 hosts, builder-time decoration flags are otherwise ignored for child windows.
        window
            .set_decorations(false)
            .map_err(|err| format!("无法移除屏保窗口边框：{err}"))?;
        window
            .set_resizable(false)
            .map_err(|err| format!("无法锁定屏保窗口尺寸：{err}"))?;
        window
            .set_fullscreen(true)
            .map_err(|err| format!("无法切换到全屏屏保：{err}"))?;
        window
            .show()
            .map_err(|err| format!("无法显示屏保窗口：{err}"))?;
        labels.push(label);
    }
    *state
        .saver_windows
        .lock()
        .map_err(|_| "屏保状态异常".to_string())? = labels;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
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
    create_saver_windows(&app, &selected)
}

#[tauri::command]
fn end_saver(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let labels = std::mem::take(
        &mut *state
            .saver_windows
            .lock()
            .map_err(|_| "屏保状态异常".to_string())?,
    );
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn saver_status(app: AppHandle) -> Result<bool, String> {
    Ok(!app
        .state::<AppState>()
        .saver_windows
        .lock()
        .map_err(|_| "屏保状态异常".to_string())?
        .is_empty())
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
        .setup(|app| {
            let store = load_store(&app.handle()).unwrap_or_else(|err| {
                eprintln!("无法加载本地数据：{err}");
                Store::default()
            });
            app.manage(AppState {
                store: Mutex::new(store),
                saver_windows: Mutex::new(Vec::new()),
            });
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
            get_asset_path,
            start_saver,
            end_saver,
            saver_status,
            lock_system
        ])
        .run(tauri::generate_context!())
        .expect("启动 ScreenPro 时发生错误");
}

#[cfg(test)]
mod tests {
    use super::*;

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
