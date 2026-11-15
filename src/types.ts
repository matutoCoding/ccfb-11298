// ============ 全局数据类型 ============

export type PileType = 'cut' | 'loop';
/** 0 羊毛 1 丝 2 化纤 */
export type MaterialId = 0 | 1 | 2;

export const MATERIAL_NAMES: Record<MaterialId, string> = {
  0: '羊毛',
  1: '真丝',
  2: '化纤',
};

export interface YarnColor {
  /** 色号,如 W-101 */
  code: string;
  name: string;
  /** #rrggbb */
  hex: string;
  material: MaterialId;
}

/** 图案中实际用到的一格颜色(可与纱线库色号关联后被替换) */
export interface UsedColor extends YarnColor {
  /** 占比 0..1 */
  ratio: number;
}

export interface PatternData {
  /** 原始导入图 dataURL */
  sourceUrl: string;
  /** 量化后的索引图 dataURL(RGB=纱线颜色,PNG) */
  indexedUrl: string;
  width: number;
  height: number;
  colors: UsedColor[];
}

export interface CraftMaps {
  /** 绒高图 dataURL,R 通道 0-255 */
  heightMapUrl: string | null;
  /** 工艺图 dataURL,R=255 割绒 / 0 圈绒 */
  regionMapUrl: string | null;
  /** 倒顺毛图 dataURL,RG=方向编码 B=压痕 */
  napMapUrl: string | null;
}

export interface Order {
  id: string;
  name: string;
  customer: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  /** 成品尺寸(米) */
  widthM: number;
  heightM: number;
  shape: 'rect' | 'round' | 'oval';
  /** 基础绒高 mm */
  pileHeightMm: number;
  pattern: PatternData | null;
  craft: CraftMaps;
}

export interface Settings {
  /** 壳层层数 */
  shellCount: number;
  /** 渲染分辨率缩放 */
  renderScale: number;
  /** 每 mm 绒高每平方米克重(割绒) */
  gramPerMmCut: number;
  /** 圈绒系数(相对割绒) */
  loopFactor: number;
  /** 损耗率 */
  wastage: number;
  /** 毛簇密度(每平米簇数,用于显示) */
  tuftDensity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  shellCount: 40,
  renderScale: 1,
  gramPerMmCut: 95,
  loopFactor: 0.82,
  wastage: 0.06,
  tuftDensity: 320000,
};

export function createEmptyOrder(id: string): Order {
  const now = Date.now();
  return {
    id,
    name: '未命名订单',
    customer: '',
    note: '',
    createdAt: now,
    updatedAt: now,
    widthM: 2.0,
    heightM: 3.0,
    shape: 'rect',
    pileHeightMm: 10,
    pattern: null,
    craft: { heightMapUrl: null, regionMapUrl: null, napMapUrl: null },
  };
}
