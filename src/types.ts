// 全局数据模型与类型定义

export type FiberMaterial = 'wool' | 'silk' | 'synthetic';
export type PileType = 'cut' | 'loop';

export interface YarnColor {
  id: string;
  name: string;
  rgb: [number, number, number]; // 0-255
}

export interface YarnPalette {
  id: string;
  name: string;
  colors: YarnColor[];
}

/** 绒面工艺参数，可按区域绘制到纹理中 */
export interface PileParams {
  pileHeight: number;        // 绒高（毫米），割绒
  loopHeight: number;        // 圈绒高度（毫米）
  density: number;           // 纤维密度（根/平方厘米）
  cutRatio: number;          // 默认割绒占比 0..1（其余为圈绒）
  material: FiberMaterial;   // 材质
  napStrength: number;       // 顺逆毛色差强度 0..1
}

export interface LightPreset {
  id: string;
  name: string;
  ambient: [number, number, number];
  keyColor: [number, number, number];
  intensity: number;
  azimuth: number;   // 度
  elevation: number; // 度
}

export interface Order {
  id: string;
  name: string;
  customer: string;
  createdAt: number;
  updatedAt: number;
  // 尺寸（米）
  widthM: number;
  depthM: number;
  // 图案：原始 PNG（dataURL）+ 量化后的纱线索引图（PNG dataURL，RGB 存索引）
  patternImage: string | null;
  quantizedImage: string | null;
  // 工艺纹理（PNG dataURL，各为独立灰度/彩色图）
  heightMap: string;     // R=归一化绒高
  typeMap: string;       // R>127 割绒，否则圈绒
  directionMap: string;  // RG=方向向量，B=压痕强度（脚印），A 保留
  // 图案与色板
  paletteId: string;
  colorMapping: Record<number, string>; // 量化索引 -> yarnColorId
  unusedColorIds: string[];              // 合并/替换后不再使用的纱线
  // 工艺
  pile: PileParams;
  // 备注
  note: string;
}

export interface AppSettings {
  shadowEnabled: boolean;
  shadowSize: 1024 | 2048;
  fiberScale: number;          // 实例数量倍率 0.5 / 1 / 1.5
  maxFiberInstances: number;   // 硬上限
  showFps: boolean;
  baseSegmentsX: number;
  baseSegmentsY: number;
  autoSave: boolean;
}

export interface AppState {
  orders: Order[];
  currentOrderId: string | null;
  palettes: YarnPalette[];
  lightPresets: LightPreset[];
  settings: AppSettings;
}

export const DEFAULT_PILE: PileParams = {
  pileHeight: 12,
  loopHeight: 6,
  density: 18,
  cutRatio: 0.8,
  material: 'wool',
  napStrength: 0.55,
};

export const DEFAULT_SETTINGS: AppSettings = {
  shadowEnabled: true,
  shadowSize: 1024,
  fiberScale: 0.75,
  maxFiberInstances: 150000,
  showFps: true,
  baseSegmentsX: 128,
  baseSegmentsY: 128,
  autoSave: true,
};

export const MATERIAL_LABEL: Record<FiberMaterial, string> = {
  wool: '羊毛',
  silk: '丝',
  synthetic: '化纤',
};

export const PILE_TYPE_LABEL: Record<PileType, string> = {
  cut: '割绒',
  loop: '圈绒',
};
