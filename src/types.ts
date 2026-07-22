export type ComponentType =
  | "text"
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
  | "markdown";

export interface SaverComponent {
  id: string;
  componentType: ComponentType;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, unknown>;
}

export interface ScreenSaverProject {
  id: string;
  schemaVersion: number;
  name: string;
  description: string;
  background: {
    kind?: "solid" | "gradient" | "aurora" | "stars" | "waves";
    start?: string;
    end?: string;
    imageAssetId?: string | null;
    speed?: number;
  };
  elements: SaverComponent[];
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings { launchShortcut: string; libraryShortcuts: Record<string, string>; }
export interface BootstrapData { hasSecurity: boolean; securityQuestion: string | null; projects: ScreenSaverProject[]; templates: ScreenSaverProject[]; activeProjectId: string | null; settings: AppSettings; canvas: { width: number; height: number }; }
export const CANVAS = { width: 1920, height: 1080 };

export const componentTypes: ComponentType[] = [
  "text", "image", "clock", "date", "countdown", "progress", "worldClock", "qr",
  "webPreview", "github", "rss", "quote", "photoWall", "weather", "battery", "systemStats", "network",
  "calendar", "pomodoro", "dayProgress", "markdown"
];

export const componentLabels: Record<ComponentType, string> = {
  text: "文字", image: "图片", clock: "时钟", date: "日期", countdown: "倒计时",
  progress: "进度条", worldClock: "世界时钟", qr: "二维码", webPreview: "网页预览",
  github: "GitHub 动态", rss: "RSS 信息流", quote: "随机句子", photoWall: "照片墙",
  weather: "天气", battery: "电池", systemStats: "系统状态", network: "网络状态",
  calendar: "月历", pomodoro: "专注计时", dayProgress: "日进度", markdown: "信息卡片"
};

export const componentIcons: Record<ComponentType, string> = {
  text: "T", image: "▧", clock: "◷", date: "日", countdown: "⌛", progress: "▰",
  worldClock: "◌", qr: "▦", webPreview: "◎", github: "◉", rss: "◍", quote: "❝",
  photoWall: "▤", weather: "☼", battery: "▣", systemStats: "⌁", network: "⌁",
  calendar: "▦", pomodoro: "◷", dayProgress: "◒", markdown: "▤"
};

export const componentDescriptions: Record<ComponentType, string> = {
  text: "自定义文字内容", image: "托管到本地的图片", clock: "当前时间", date: "日期和星期",
  countdown: "距离目标时间的倒计时", progress: "项目或目标进度", worldClock: "多个城市的时间",
  qr: "网址或文本二维码", webPreview: "只读网页预览", github: "公开仓库动态", rss: "RSS 最新条目",
  quote: "随机显示自定义句子", photoWall: "多张图片轮播", weather: "城市天气信息",
  battery: "设备电池状态", systemStats: "浏览器可用的系统概览", network: "网络连接状态",
  calendar: "当前月份日历", pomodoro: "专注与休息循环", dayProgress: "今天已经过去了多少", markdown: "安全的多行信息卡片"
};

const baseText = (id: string): SaverComponent => ({ id, componentType: "text", x: 510, y: 470, width: 900, height: 110, props: { content: "写下你的文字", fontSize: 58, color: "#FFFFFF", align: "center", fontWeight: 600 } });

export const blankComponent = (componentType: ComponentType): SaverComponent => {
  const id = crypto.randomUUID();
  const defaults: Record<ComponentType, SaverComponent> = {
    text: baseText(id),
    image: { id, componentType, x: 690, y: 320, width: 540, height: 380, props: { assetId: null, fit: "cover", radius: 28 } },
    clock: { id, componentType, x: 610, y: 380, width: 700, height: 190, props: { format: "HH:mm", fontSize: 130, color: "#FFFFFF", align: "center", showDate: true } },
    date: { id, componentType, x: 650, y: 600, width: 620, height: 100, props: { format: "YYYY年MM月DD日", showWeekday: true, fontSize: 46, color: "#FFFFFF", align: "center" } },
    countdown: { id, componentType, x: 500, y: 380, width: 920, height: 190, props: { target: new Date(Date.now() + 86400000).toISOString(), label: "距离目标还有", finishedText: "目标时间已到", fontSize: 78, color: "#FFFFFF", align: "center" } },
    progress: { id, componentType, x: 460, y: 760, width: 1000, height: 70, props: { value: 65, label: "当前进度", color: "#9DE8BC", trackColor: "#FFFFFF33", showPercent: true, radius: 20 } },
    worldClock: { id, componentType, x: 560, y: 340, width: 800, height: 300, props: { cities: "上海,伦敦,纽约,东京", fontSize: 42, color: "#FFFFFF", align: "center" } },
    qr: { id, componentType, x: 760, y: 330, width: 400, height: 500, props: { value: "https://github.com/HPPPK/ScreenpPro", label: "扫描访问 ScreenPro", size: 360 } },
    webPreview: { id, componentType, x: 420, y: 180, width: 1080, height: 720, props: { url: "https://example.com", refreshSeconds: 300, opacity: 1, allowScripts: true, fit: "contain" } },
    github: { id, componentType, x: 480, y: 330, width: 960, height: 330, props: { repo: "HPPPK/ScreenpPro", refreshSeconds: 600, color: "#FFFFFF" } },
    rss: { id, componentType, x: 430, y: 270, width: 1060, height: 450, props: { url: "", refreshSeconds: 600, maxItems: 5, color: "#FFFFFF" } },
    quote: { id, componentType, x: 430, y: 390, width: 1060, height: 260, props: { quotes: "保持专注\n一步一步完成\n今天也值得被认真对待", intervalSeconds: 20, fontSize: 64, color: "#FFFFFF", align: "center" } },
    photoWall: { id, componentType, x: 350, y: 150, width: 1220, height: 780, props: { assetIds: [], intervalSeconds: 12, fit: "cover", radius: 24 } },
    weather: { id, componentType, x: 620, y: 350, width: 680, height: 320, props: { city: "Shanghai", refreshSeconds: 900, fontSize: 54, color: "#FFFFFF", align: "center" } },
    battery: { id, componentType, x: 720, y: 450, width: 480, height: 150, props: { fontSize: 54, color: "#FFFFFF", showCharging: true, align: "center" } },
    systemStats: { id, componentType, x: 580, y: 330, width: 760, height: 320, props: { refreshSeconds: 3, color: "#FFFFFF", fontSize: 32 } },
    network: { id, componentType, x: 700, y: 450, width: 520, height: 150, props: { fontSize: 48, color: "#FFFFFF", align: "center" } },
    calendar: { id, componentType, x: 540, y: 250, width: 840, height: 580, props: { monthOffset: 0, color: "#FFFFFF", accentColor: "#9DE8BC", showToday: true, showWeekNumber: false } },
    pomodoro: { id, componentType, x: 600, y: 340, width: 720, height: 400, props: { focusMinutes: 25, breakMinutes: 5, startAt: Date.now(), label: "专注中", fontSize: 94, color: "#FFFFFF", accentColor: "#9DE8BC" } },
    dayProgress: { id, componentType, x: 500, y: 700, width: 920, height: 180, props: { label: "今天", color: "#9DE8BC", trackColor: "#FFFFFF33", showTime: true } },
    markdown: { id, componentType, x: 400, y: 240, width: 1120, height: 600, props: { content: "# 今日计划\n\n- 保持专注\n- 适当休息\n- 完成最重要的一件事", color: "#FFFFFF", fontSize: 34, lineHeight: 1.5, align: "left" } }
  };
  return structuredClone(defaults[componentType]);
};
