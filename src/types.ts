export type ComponentType = "text" | "image" | "clock";
export interface SaverComponent { id: string; componentType: ComponentType; x: number; y: number; width: number; height: number; props: Record<string, unknown>; }
export interface ScreenSaverProject { id: string; schemaVersion: number; name: string; description: string; background: { kind?: "solid" | "gradient"; start?: string; end?: string; imageAssetId?: string | null }; elements: SaverComponent[]; createdAt: number; updatedAt: number; }
export interface AppSettings { launchShortcut: string; libraryShortcuts: Record<string, string>; }
export interface BootstrapData { hasSecurity: boolean; securityQuestion: string | null; projects: ScreenSaverProject[]; templates: ScreenSaverProject[]; activeProjectId: string | null; settings: AppSettings; canvas: { width: number; height: number }; }
export const CANVAS = { width: 1920, height: 1080 };
export const componentLabels: Record<ComponentType, string> = { text: "文字", image: "图片", clock: "时钟" };
export const blankComponent = (componentType: ComponentType): SaverComponent => {
 const id = crypto.randomUUID();
 if (componentType === "text") return { id, componentType, x: 510, y: 470, width: 900, height: 110, props: { content: "写下你的文字", fontSize: 58, color: "#FFFFFF", align: "center", fontWeight: 600 } };
 if (componentType === "clock") return { id, componentType, x: 610, y: 380, width: 700, height: 190, props: { format: "HH:mm", fontSize: 130, color: "#FFFFFF", align: "center", showDate: true } };
 return { id, componentType, x: 690, y: 320, width: 540, height: 380, props: { assetId: null, fit: "cover", radius: 28 } };
};
