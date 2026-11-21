// 核心领域类型 —— 全系统物理单位统一为毫米(mm)，道数定义为每英尺结数(knots per inch, kpi)

export type YarnType = 'wool' | 'silk' | 'woolSilk';

export interface Rgb { r: number; g: number; b: number; }

/** 纱线色卡条目（色号 + 标定 RGB + Lab 缓存） */
export interface PaletteColor extends Rgb {
  id: string;
  code: string;      // 色号，如 W-312
  name: string;      // 中文名，如 藏青
  L: number; a: number; b: number;
  yarn: YarnType;
}

/** 订单上的区域分解：中心大花 / 边框 / 角花 */
export type RegionKind = 'center' | 'border' | 'corner';

export interface DesignRegion {
  id: string;
  kind: RegionKind;
  name: string;
  /** 以结为单位的像素矩形 [x0,y0,x1,y1) */
  rect: [number, number, number, number];
  /** 边框专用：四边镜像/平铺后的角部错位修正（结），自动对齐写入此值 */
  cornerShift: number;
  /** 是否参与边框四角自动对齐 */
  autoCorner: boolean;
}

/** 片剪沟槽参数：沿花型轮廓剪出的斜沟 */
export interface GrooveSpec {
  width: number;       // 沟宽(mm)，单侧水平跨度
  depth: number;       // 沟深(mm)，相对轮廓两侧绒面的物理落差
  slope: number;       // 沟坡斜度 0..1（控制 V 形沟两侧坡长占比）
  enabled: boolean;
  /** 只在指定色号边界剪沟；为空表示所有区域边界 */
  colorBoundaryOnly: boolean;
}

/** 高低绒浮雕规则：某色号区域抬升/压低 */
export interface ReliefRule {
  colorId: string;
  offset: number;      // 绒头高度偏移(mm)
}

/** 染缸批次横向色差条带 */
export interface DyeLotSpec {
  bandHeight: number;  // 条带宽度(mm)，换算成行
  strength: number;    // 色差强度 0..1（对应 ΔE 幅度）
  phase: number;       // 起始行偏移(结)
  seed: number;        // 批次随机种子（固定值，旋转不闪）
  enabled: boolean;
}

export interface CarveSpec {
  basePile: number;       // 基准绒头高度(mm)
  groove: GrooveSpec;
  relief: ReliefRule[];
}

export interface PreviewSpec {
  yarn: YarnType;
  dyeLot: DyeLotSpec;
  /** 侧光方位角(度)与仰角(度) */
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  /** 壳层数（绒头体积分层） */
  shellLayers: number;
  /** 鳍片密度倍率 */
  finDensity: number;
  scene: 'floor' | 'wall';
  showBack: boolean;
  showDyeLines: boolean;
}

export interface OrderMeta {
  id: string;
  name: string;
  customer: string;
  createdAt: number;
  updatedAt: number;
  /** 成品物理尺寸 mm */
  widthMm: number;
  heightMm: number;
  /** 道数：每英尺结数 */
  kpi: number;
  designName: string;
  note: string;
  status: 'draft' | 'converted' | 'carved' | 'confirmed';
}

/** 结图转换产物的摘要（大数组单独存 IndexedDB blob） */
export interface ConversionResult {
  cols: number;
  rows: number;
  paletteIds: string[];         // 结索引值 -> 色卡 id
  /** 锯齿高风险结掩码，每结 1 bit（Uint8 0/1） */
  jagged: Uint8Array;
  jaggedCount: number;
  /** 每色号结数 */
  knotCounts: Record<string, number>;
  regionList: DesignRegion[];
  cornerAligned: boolean;
}

export interface HeightField {
  cols: number;
  rows: number;
  /** 每结绒头高度 mm，Float32，物理真值（剖面测量直接读它） */
  heights: Float32Array;
}

/** 纱线用量清单项 */
export interface YarnUsageItem {
  colorId: string;
  code: string;
  name: string;
  yarn: YarnType;
  knots: number;
  /** 绒线总长 m（含每结实际绒高） */
  lengthM: number;
  /** 克重 g */
  grams: number;
}

/** 全局设置 */
export interface AppSettings {
  defaultKpi: number;
  shellLayers: number;
  finDensity: number;
  /** 每结绒线克重系数 g/m（手纺羊毛基准，丝与夹丝按密度换算） */
  yarnLinearDensity: Record<YarnType, number>;
  /** 每结绒线在绒高中的折叠倍数（打结 U 形两臂） */
  foldFactor: number;
  customPalette: PaletteColor[];
  msaaSamples: number;
}
