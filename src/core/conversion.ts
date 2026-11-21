// 结图转换引擎：设计稿 -> 结点精度网格
// 流程：按道数重采样 -> 色卡量化吸附 -> 锯齿风险标注 -> 区域分解 -> 边框角对齐
import { nearestPalette } from './color';
import type { ConversionResult, DesignRegion, PaletteColor } from './types';
import { hash2i } from './math';

export interface ConvertOptions {
  cols: number;
  rows: number;
  palette: PaletteColor[];
  /** 认为可接受的最大 ΔE，超过则在结果里报告 */
  dEThreshold: number;
  onProgress?: (p: number, label: string) => void;
}

export interface ConvertOutput {
  result: ConversionResult;
  knots: Uint16Array;
  maxDE: number;
  overThreshold: number;
}

function yieldToUi() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/** 把任意图片画到结网格尺寸，取出逐结平均色 */
export function imageToKnotColors(img: HTMLImageElement | HTMLCanvasElement, cols: number, rows: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cols, rows);
  return ctx.getImageData(0, 0, cols, rows).data;
}

/** 逐结吸附到最近色卡色，返回结索引数组与色差统计 */
async function snapToPalette(
  data: Uint8ClampedArray,
  cols: number,
  rows: number,
  palette: PaletteColor[],
  dEThreshold: number,
  onProgress?: (p: number) => void,
): Promise<{ knots: Uint16Array; maxDE: number; overThreshold: number }> {
  const knots = new Uint16Array(cols * rows);
  let maxDE = 0, over = 0;
  const chunk = Math.max(1, Math.floor(rows / 24));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const hit = nearestPalette({ r: data[i], g: data[i + 1], b: data[i + 2] }, palette);
      knots[y * cols + x] = hit.index;
      if (hit.distance > maxDE) maxDE = hit.distance;
      if (hit.distance > dEThreshold) over++;
    }
    if (y % chunk === 0) {
      onProgress?.(y / rows);
      await yieldToUi();
    }
  }
  return { knots, maxDE, overThreshold: over };
}

/**
 * 锯齿风险检测（两类作坊最常见问题）：
 *  A. 细笔画：宽度 < 2 结的前景条带，织出来必成虚线/锯齿
 *  B. 阶梯边：对角线边界上单结台阶连续出现（45° 斜线上的单像素楼梯）
 * 结果写入 0/1 掩码
 */
export function detectJagged(knots: Uint16Array, cols: number, rows: number): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(cols * rows);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : knots[y * cols + x]);
  let count = 0;
  const mark = (x: number, y: number) => {
    if (!mask[y * cols + x]) {
      mask[y * cols + x] = 1;
      count++;
    }
  };

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const c = at(x, y);
      // A. 细笔画：左右同色且与中心不同，同时上下也被异色夹住 -> 1 结宽竖条；横条同理
      const verticalHair = at(x - 1, y) !== c && at(x + 1, y) !== c &&
        at(x - 1, y) === at(x + 1, y) && at(x, y - 1) === c && at(x, y + 1) === c;
      const horizontalHair = at(x, y - 1) !== c && at(x, y + 1) !== c &&
        at(x, y - 1) === at(x, y + 1) && at(x - 1, y) === c && at(x + 1, y) === c;
      if (verticalHair || horizontalHair) {
        mark(x, y);
        continue;
      }
      // B. 阶梯边：边界结沿某一对角方向存在同色邻居，而该方向的两个正交邻居异色
      //    （对角线在结网格上只能走单结台阶，连续出现即人眼可见的锯齿）
      const onBoundary = at(x - 1, y) !== c || at(x + 1, y) !== c ||
        at(x, y - 1) !== c || at(x, y + 1) !== c;
      if (!onBoundary) continue;
      // 四个对角方向：对角同色且夹着它的两个正交结至少一个异色 -> 台阶拐角
      const stairSE = at(x + 1, y + 1) === c && (at(x + 1, y) !== c || at(x, y + 1) !== c);
      const stairNW = at(x - 1, y - 1) === c && (at(x - 1, y) !== c || at(x, y - 1) !== c);
      const stairNE = at(x + 1, y - 1) === c && (at(x + 1, y) !== c || at(x, y - 1) !== c);
      const stairSW = at(x - 1, y + 1) === c && (at(x - 1, y) !== c || at(x, y + 1) !== c);
      // 成对出现才是连续台阶，单个对角结不算
      if ((stairSE && stairNW) || (stairNE && stairSW)) mark(x, y);
    }
  }
  return { mask, count };
}

/** 默认区域分解：中心大花 + 四周边框 + 四角角花，按 12% 边距切 */
export function defaultRegions(cols: number, rows: number): DesignRegion[] {
  const bx = Math.max(2, Math.round(cols * 0.12));
  const by = Math.max(2, Math.round(rows * 0.12));
  const cx = Math.max(2, Math.round(cols * 0.06));
  const cy = Math.max(2, Math.round(rows * 0.06));
  return [
    { id: 'center', kind: 'center', name: '中心大花', rect: [bx, by, cols - bx, rows - by], cornerShift: 0, autoCorner: false },
    { id: 'border-top', kind: 'border', name: '上边框', rect: [bx, 0, cols - bx, by], cornerShift: 0, autoCorner: true },
    { id: 'border-bottom', kind: 'border', name: '下边框', rect: [bx, rows - by, cols - bx, rows], cornerShift: 0, autoCorner: true },
    { id: 'border-left', kind: 'border', name: '左边框', rect: [0, by, bx, rows - by], cornerShift: 0, autoCorner: true },
    { id: 'border-right', kind: 'border', name: '右边框', rect: [cols - bx, by, cols, rows - by], cornerShift: 0, autoCorner: true },
    { id: 'corner-tl', kind: 'corner', name: '左上角花', rect: [0, 0, bx, by], cornerShift: 0, autoCorner: true },
    { id: 'corner-tr', kind: 'corner', name: '右上角花', rect: [cols - bx, 0, cols, by], cornerShift: 0, autoCorner: true },
    { id: 'corner-bl', kind: 'corner', name: '左下角花', rect: [0, rows - by, bx, rows], cornerShift: 0, autoCorner: true },
    { id: 'corner-br', kind: 'corner', name: '右下角花', rect: [cols - bx, rows - by, cols, rows], cornerShift: 0, autoCorner: true },
  ];
}

/**
 * 边框四角自动对齐：
 * 沿边框条带取垂直于边方向的色号序列，搜索让"角部结行与角花边缘"色差最小的平移量。
 * 横向边框在 x 方向平移、纵向边框在 y 方向平移，搜索范围 ±条带宽度。
 * 返回写入 cornerShift 的区域列表与最佳错位分数(0=完全对上)。
 */
export function alignBorderCorners(
  knots: Uint16Array,
  cols: number,
  rows: number,
  regions: DesignRegion[],
): { regions: DesignRegion[]; score: number } {
  let totalScore = 0;
  let evaluated = 0;
  const next = regions.map((r) => ({ ...r }));

  const costAt = (get: (shift: number) => number, maxShift: number) => {
    let best = 0, bestCost = Infinity;
    for (let s = -maxShift; s <= maxShift; s++) {
      const c = get(s);
      if (c < bestCost) { bestCost = c; best = s; }
    }
    return { best, bestCost };
  };

  for (const r of next) {
    if (!r.autoCorner || r.kind !== 'border') continue;
    const [x0, y0, x1, y1] = r.rect;
    const horizontal = y1 - y0 <= x1 - x0;
    const maxShift = horizontal ? y1 - y0 : x1 - x0;
    const width = x1 - x0, height = y1 - y0;

    const { best, bestCost } = costAt((shift) => {
      let mismatch = 0, n = 0;
      if (horizontal) {
        // 比较边框靠角部的两行：上边第一条内容行 vs 角花邻接行
        for (let x = x0; x < x1; x++) {
          const sy = clamp(y0 + Math.max(0, shift), 0, rows - 2);
          const cy = clamp(y0 === 0 ? height : rows - height - 1, 0, rows - 1);
          mismatch += knots[sy * cols + x] === knots[cy * cols + x] ? 0 : 1;
          n++;
        }
      } else {
        for (let y = y0; y < y1; y++) {
          const sx = clamp(x0 + Math.max(0, shift), 0, cols - 2);
          const cx = clamp(x0 === 0 ? width : cols - width - 1, 0, cols - 1);
          mismatch += knots[y * cols + sx] === knots[y * cols + cx] ? 0 : 1;
          n++;
        }
      }
      return n ? mismatch / n : 1;
    }, maxShift);

    r.cornerShift = best;
    totalScore += bestCost;
    evaluated++;
  }
  return { regions: next, score: evaluated ? totalScore / evaluated : 0 };
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 主入口：图片 -> 完整转换结果 */
export async function convertDesign(img: HTMLImageElement | HTMLCanvasElement, opts: ConvertOptions): Promise<ConvertOutput> {
  const { cols, rows, palette, dEThreshold } = opts;
  opts.onProgress?.(0.05, '按道数重采样设计稿');
  const rgba = imageToKnotColors(img, cols, rows);

  opts.onProgress?.(0.2, '吸附纱线色卡');
  const snap = await snapToPalette(rgba, cols, rows, palette, dEThreshold, (p) =>
    opts.onProgress?.(0.2 + p * 0.5, '吸附纱线色卡'),
  );

  opts.onProgress?.(0.75, '检测细线与锯齿');
  const jag = detectJagged(snap.knots, cols, rows);

  opts.onProgress?.(0.85, '分解花型区域');
  let regionList = defaultRegions(cols, rows);
  const aligned = alignBorderCorners(snap.knots, cols, rows, regionList);
  regionList = aligned.regions;

  const knotCounts: Record<string, number> = {};
  for (let i = 0; i < snap.knots.length; i++) {
    const id = palette[snap.knots[i]].id;
    knotCounts[id] = (knotCounts[id] ?? 0) + 1;
  }

  const result: ConversionResult = {
    cols,
    rows,
    paletteIds: palette.map((p) => p.id),
    jagged: jag.mask,
    jaggedCount: jag.count,
    knotCounts,
    regionList,
    cornerAligned: true,
  };
  opts.onProgress?.(1, '转换完成');
  return { result, knots: snap.knots, maxDE: snap.maxDE, overThreshold: snap.overThreshold };
}

/** 色号合并：把 from 色号的结全部改成 to，并清理计数 */
export function mergeColor(
  knots: Uint16Array,
  paletteIds: string[],
  fromId: string,
  toId: string,
): { knots: Uint16Array; paletteIds: string[] } {
  const from = paletteIds.indexOf(fromId);
  const to = paletteIds.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return { knots, paletteIds };
  const out = new Uint16Array(knots);
  for (let i = 0; i < out.length; i++) if (out[i] === from) out[i] = to;
  return { knots: out, paletteIds };
}

/** 程序化生成一张演示设计稿（无图片也能跑全流程）：中心团花 + 边框 + 角花 */
export function generateSampleDesign(cols: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e3d9c3';
  ctx.fillRect(0, 0, cols, rows);
  const bx = cols * 0.12, by = rows * 0.12;
  ctx.fillStyle = '#35506e';
  ctx.fillRect(0, 0, cols, by);
  ctx.fillRect(0, rows - by, cols, by);
  ctx.fillRect(0, 0, bx, rows);
  ctx.fillRect(cols - bx, 0, bx, rows);
  ctx.fillStyle = '#d8b34a';
  const band = Math.max(1.2, Math.min(cols, rows) * 0.012);
  ctx.lineWidth = band;
  ctx.strokeRect(bx * 0.55, by * 0.55, cols - bx * 1.1, rows - by * 1.1);
  // 中心团花
  const cx = cols / 2, cy = rows / 2, R = Math.min(cols, rows) * 0.28;
  ctx.fillStyle = '#7e2f28';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a4513c';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, R * 0.3, R * 0.13, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#d8b34a';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2);
  ctx.fill();
  // 细卷草（故意做细，触发锯齿检测演示）
  ctx.strokeStyle = '#22303f';
  ctx.lineWidth = Math.max(0.8, band * 0.55);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8,
      cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R * 1.25,
    );
    ctx.stroke();
  }
  // 角花
  ctx.fillStyle = '#d8b34a';
  for (const [ox, oy] of [[bx * 0.5, by * 0.5], [cols - bx * 0.5, by * 0.5], [bx * 0.5, rows - by * 0.5], [cols - bx * 0.5, rows - by * 0.5]]) {
    ctx.beginPath();
    ctx.arc(ox, oy, Math.min(bx, by) * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  // 轻微噪点模拟手绘稿
  const img = ctx.getImageData(0, 0, cols, rows);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (hash2i(i, i >> 2, 7) - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
