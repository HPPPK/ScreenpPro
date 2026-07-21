import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, BootstrapData, ScreenSaverProject } from "./types";
export const api = {
 bootstrap: () => invoke<BootstrapData>("get_bootstrap"),
 createBlank: (name: string) => invoke<ScreenSaverProject>("create_blank_project", { name }),
 cloneTemplate: (templateId: string, name?: string) => invoke<ScreenSaverProject>("clone_template", { templateId, name }),
 saveProject: (project: ScreenSaverProject) => invoke<ScreenSaverProject>("save_project", { project }),
 deleteProject: (projectId: string) => invoke<void>("delete_project", { projectId }),
 setActive: (projectId: string) => invoke<void>("set_active_project", { projectId }),
 saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
 setupSecurity: (password: string, securityQuestion: string, securityAnswer: string) => invoke<void>("setup_security", { password, securityQuestion, securityAnswer }),
 verifyUnlock: (password: string) => invoke<boolean>("verify_unlock", { password }),
 verifySecurityAnswer: (answer: string) => invoke<boolean>("verify_security_answer", { answer }),
 resetSecurity: (answer: string, password: string, securityQuestion: string, securityAnswer: string) => invoke<void>("reset_security", { answer, password, securityQuestion, securityAnswer }),
 importAsset: (sourcePath: string) => invoke<string>("import_asset", { sourcePath }),
 getAssetPath: (assetId: string) => invoke<string>("get_asset_path", { assetId }),
 startSaver: (projectId?: string) => invoke<void>("start_saver", { projectId }),
 endSaver: () => invoke<void>("end_saver"),
 getSaverProjectId: () => invoke<string | null>("get_saver_project_id"),
 lockSystem: () => invoke<void>("lock_system"),
};
