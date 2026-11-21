// 结图几何：道数(kpi, 每英尺结数) 与物理尺寸、网格行列的换算
// 这是"换道数后克重重算"与"沟深设多少量出来多少"两条硬约束的单一事实源

export const MM_PER_INCH = 25.4;

export interface KnotGrid {
  cols: number;
  rows: number;
  kpi: number;
  widthMm: number;
  heightMm: number;
  /** 结间距(mm)，水平/垂直分别计算（非方形结时不相等） */
  pitchXMm: number;
  pitchYMm: number;
}

/** 由成品尺寸与道数推算结网格，cols/rows 四舍五入后回推实际尺寸 */
export function gridFromSpec(widthMm: number, heightMm: number, kpi: number): KnotGrid {
  const pitch = MM_PER_INCH / kpi;
  const cols = Math.max(8, Math.round(widthMm / pitch));
  const rows = Math.max(8, Math.round(heightMm / pitch));
  const pitchX = widthMm / cols;
  const pitchY = heightMm / rows;
  return { cols, rows, kpi, widthMm, heightMm, pitchXMm: pitchX, pitchYMm: pitchY };
}

/** 换道数：保持物理尺寸不变，返回新网格；结图数据需要重采样 */
export function resampleGrid(oldGrid: KnotGrid, newKpi: number): KnotGrid {
  return gridFromSpec(oldGrid.widthMm, oldGrid.heightMm, newKpi);
}

/** 一行结的物理高度(mm) */
export function rowPitchMm(grid: KnotGrid): number {
  return grid.pitchYMm;
}

/** 染缸条带：条带物理宽度 -> 占多少行 */
export function bandRows(grid: KnotGrid, bandHeightMm: number): number {
  return Math.max(1, Math.round(bandHeightMm / grid.pitchYMm));
}

/** 总结数 */
export function totalKnots(grid: KnotGrid): number {
  return grid.cols * grid.rows;
}

/**
 * 纱线克重计算（物理真值，随道数/绒高自动重算）
 * 每个结是 U 形两臂：绒线长度 = 绒高 * foldFactor * 2 臂，再计入结头余量
 * lengthM  = sum(heights) / 1000 * foldFactor * 2 + 每结结头余量
 * grams    = lengthM * 线密度(g/m)，不同纱线分别按其线密度
 */
export function computeYarnUsage(
  heights: Float32Array,
  knotColor: Uint16Array,
  paletteIds: string[],
  yarnDensity: Record<string, number>,
  foldFactor: number,
  knotAllowanceMm: number,
) {
  const lengthPerColor = new Map<number, number>();
  const countPerColor = new Map<number, number>();
  for (let i = 0; i < heights.length; i++) {
    const c = knotColor[i];
    const lenMm = heights[i] * foldFactor * 2 + knotAllowanceMm;
    lengthPerColor.set(c, (lengthPerColor.get(c) ?? 0) + lenMm);
    countPerColor.set(c, (countPerColor.get(c) ?? 0) + 1);
  }
  return { lengthPerColor, countPerColor, paletteIds };
}
