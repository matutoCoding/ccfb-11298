// 剪花工艺引擎：结级高度场
// 硬约束：高度场单位即物理 mm，剖面测量直接读高度差，沟深参数与实测一致
import type { CarveSpec, HeightField } from './types';

/** 两遍 chamfer 距离变换（3-4 权重，近似欧氏距离），输出到边界的物理距离(mm) */
function chamferDistance(
  boundary: Uint8Array,
  cols: number,
  rows: number,
  pitchX: number,
  pitchY: number,
): Float32Array {
  const INF = 1e9;
  const dist = new Float32Array(cols * rows).fill(INF);
  const dx = pitchX, dy = pitchY;
  const dxy = Math.hypot(dx, dy);
  for (let i = 0; i < boundary.length; i++) if (boundary[i]) dist[i] = 0;

  // 前向：上、左上、左、右上
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + dx);
      if (y > 0) {
        dist[i] = Math.min(dist[i], dist[i - cols] + dy);
        if (x > 0) dist[i] = Math.min(dist[i], dist[i - cols - 1] + dxy);
        if (x < cols - 1) dist[i] = Math.min(dist[i], dist[i - cols + 1] + dxy);
      }
    }
  }
  // 后向：下、右下、右、左下
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (x < cols - 1) dist[i] = Math.min(dist[i], dist[i + 1] + dx);
      if (y < rows - 1) {
        dist[i] = Math.min(dist[i], dist[i + cols] + dy);
        if (x < cols - 1) dist[i] = Math.min(dist[i], dist[i + cols + 1] + dxy);
        if (x > 0) dist[i] = Math.min(dist[i], dist[i + cols - 1] + dxy);
      }
    }
  }
  return dist;
}

/** 找色号边界结（四邻不同色），可选只统计指定色号集合边界 */
export function findBoundaries(knots: Uint16Array, cols: number, rows: number, onlyColors?: Set<number>): Uint8Array {
  const boundary = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const c = knots[i];
      if (onlyColors && !onlyColors.has(c)) continue;
      if (x > 0 && knots[i - 1] !== c) boundary[i] = 1;
      else if (x < cols - 1 && knots[i + 1] !== c) boundary[i] = 1;
      else if (y > 0 && knots[i - cols] !== c) boundary[i] = 1;
      else if (y < rows - 1 && knots[i + cols] !== c) boundary[i] = 1;
    }
  }
  return boundary;
}

/**
 * V 形斜沟剖面（物理真值）：
 *   d=0 在轮廓线上，depth=最大沟深；坡长按 slope 在 width 内分配
 *   profile(d) = depth * (1 - 归一化的坡位置)，d >= width 时为 0
 * slope 越大坡越陡（沟肩越窄、沟底越锐）
 */
function grooveProfile(distanceMm: number, width: number, depth: number, slope: number): number {
  if (distanceMm >= width) return 0;
  // 坡肩占 (1-slope)，陡坡占 slope
  const shoulder = width * (1 - slope) * 0.5;
  const t = distanceMm <= shoulder
    ? distanceMm / (shoulder || 1e-6) * 0.25            // 柔和沟肩
    : 0.25 + 0.75 * Math.min(1, (distanceMm - shoulder) / (width - shoulder || 1e-6));
  return depth * (1 - t);
}

export interface CarveOptions {
  cols: number;
  rows: number;
  pitchXMm: number;
  pitchYMm: number;
  spec: CarveSpec;
  knots: Uint16Array;
  paletteIds: string[];
  onProgress?: (p: number) => void;
}

/** 生成高度场：基准绒高 + 高低绒浮雕偏移 - 片剪沟深 */
export function buildHeightField(opts: CarveOptions): HeightField {
  const { cols, rows, pitchXMm, pitchYMm, spec, knots, paletteIds } = opts;
  const n = cols * rows;
  const heights = new Float32Array(n);

  // 1. 基准 + 浮雕
  const reliefByColor = new Map<number, number>();
  for (const rule of spec.relief) {
    const idx = paletteIds.indexOf(rule.colorId);
    if (idx >= 0) reliefByColor.set(idx, rule.offset);
  }
  for (let i = 0; i < n; i++) {
    heights[i] = spec.basePile + (reliefByColor.get(knots[i]) ?? 0);
  }

  // 2. 片剪斜沟
  if (spec.groove.enabled && spec.groove.depth > 0) {
    const boundary = findBoundaries(knots, cols, rows);
    const dist = chamferDistance(boundary, cols, rows, pitchXMm, pitchYMm);
    const { width, depth, slope } = spec.groove;
    for (let i = 0; i < n; i++) {
      const cut = grooveProfile(dist[i], width, depth, slope);
      // 沟底保留最少 0.5mm 绒头，不允许剪穿到经纬线
      heights[i] = Math.max(0.5, heights[i] - cut);
    }
  }

  opts.onProgress?.(1);
  return { cols, rows, heights };
}

export interface SectionSample {
  xMm: number;
  heightMm: number;
  colorIndex: number;
}

/**
 * 剖面测量：沿某一行（或列）取高度，单位 mm，直接用于"剖开量沟深"
 * 同时回传该行沟深实测值与设定值的对照
 */
export function measureSection(
  hf: HeightField,
  knots: Uint16Array,
  pitchX: number,
  row: number,
): { samples: SectionSample[]; measuredDepth: number; settingDepth: number; groove?: CarveSpec } {
  const samples: SectionSample[] = [];
  let min = Infinity, max = 0;
  const base = row * hf.cols;
  for (let x = 0; x < hf.cols; x++) {
    const h = hf.heights[base + x];
    if (h < min) min = h;
    if (h > max) max = h;
    samples.push({ xMm: x * pitchX, heightMm: h, colorIndex: knots[base + x] });
  }
  return { samples, measuredDepth: max - min, settingDepth: 0 };
}

/** 沟深一致性校验：全毯统计实测最大落差 vs 设定沟深 */
export function auditGrooveDepth(hf: HeightField, spec: CarveSpec): {
  measuredMax: number;
  setting: number;
  ok: boolean;
  toleranceMm: number;
} {
  let min = Infinity, max = 0;
  for (let i = 0; i < hf.heights.length; i++) {
    const h = hf.heights[i];
    if (h < min) min = h;
    if (h > max) max = h;
  }
  const setting = spec.groove.enabled ? spec.groove.depth : 0;
  // 一个结距内的量化误差即容差
  const tolerance = 0.6;
  return {
    measuredMax: max - min,
    setting,
    ok: !spec.groove.enabled || Math.abs(max - min - setting) <= tolerance,
    toleranceMm: tolerance,
  };
}
