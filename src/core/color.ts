// 色彩科学：sRGB 线性化、CIE Lab、ΔE、中位切分量化
import type { PaletteColor, Rgb } from './types';

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToLab({ r, g, b }: Rgb): { L: number; a: number; b: number } {
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.0;
  let z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  // 标准 CIE Lab：L∈[0,100]，a/b 大致 ±128
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 ΔE，作坊色差判定足够直观；值即近似 NBS 色差感 */
export function deltaE(a: { L: number; a: number; b: number }, b: { L: number; a: number; b: number }): number {
  const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function deltaE_rgb(a: Rgb, b: Rgb): number {
  return deltaE(rgbToLab(a), rgbToLab(b));
}

function makeColor(r: number, g: number, b: number): Rgb {
  return {
    r: Math.round(Math.min(255, Math.max(0, r))),
    g: Math.round(Math.min(255, Math.max(0, g))),
    b: Math.round(Math.min(255, Math.max(0, b))),
  };
}

interface Box { pixels: number[]; rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number; }

function boxFrom(indices: number[], data: Uint8ClampedArray): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const i of indices) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { pixels: indices, rMin, rMax, gMin, gMax, bMin, bMax };
}

function averageColor(box: Box, data: Uint8ClampedArray): Rgb {
  let r = 0, g = 0, b = 0;
  for (const i of box.pixels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const n = box.pixels.length || 1;
  return makeColor(r / n, g / n, b / n);
}

/**
 * 中位切分量化：设计稿 -> 最多 maxColors 个代表色
 * 分块处理 + 进度回调，大图不卡 UI
 */
export async function medianCut(
  data: Uint8ClampedArray,
  pixelCount: number,
  maxColors: number,
  onProgress?: (p: number) => void,
): Promise<Rgb[]> {
  const all: number[] = new Array(pixelCount);
  const step = Math.max(1, Math.floor(pixelCount / 200000)); // 超大图抽样建箱，映射仍逐像素
  const sampled: number[] = [];
  for (let p = 0; p < pixelCount; p++) {
    all[p] = p * 4;
    if (p % step === 0) sampled.push(p * 4);
  }
  let boxes: Box[] = [boxFrom(sampled, data)];
  while (boxes.length < maxColors) {
    boxes.sort((a, b) => {
      const ra = Math.max(a.rMax - a.rMin, a.gMax - a.gMin, a.bMax - a.bMin);
      const rb = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
      return rb - ra;
    });
    const target = boxes[0];
    const rangeR = target.rMax - target.rMin;
    const rangeG = target.gMax - target.gMin;
    const rangeB = target.bMax - target.bMin;
    if (Math.max(rangeR, rangeG, rangeB) === 0) break;
    const channel = rangeR >= rangeG && rangeR >= rangeB ? 0 : rangeG >= rangeB ? 1 : 2;
    target.pixels.sort((i, j) => data[i + channel] - data[j + channel]);
    const mid = target.pixels.length >> 1;
    const left = boxFrom(target.pixels.slice(0, mid), data);
    const right = boxFrom(target.pixels.slice(mid), data);
    boxes = boxes.slice(1).concat(left, right);
    onProgress?.(boxes.length / maxColors);
    await yieldFrame();
  }
  return boxes.map((bx) => averageColor(bx, data));
}

/** 把任意 RGB 吸附到色卡上最近的色号（Lab ΔE 最近邻） */
export function nearestPalette(rgb: Rgb, palette: PaletteColor[]): { index: number; distance: number } {
  const lab = rgbToLab(rgb);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = deltaE(lab, palette[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, distance: bestD };
}

/** 色卡内相近色对，供"手动合并"面板排序使用 */
export function closeColorPairs(palette: PaletteColor[], threshold: number) {
  const pairs: { a: number; b: number; dE: number }[] = [];
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      const d = deltaE(palette[i], palette[j]);
      if (d <= threshold) pairs.push({ a: i, b: j, dE: d });
    }
  }
  return pairs.sort((x, y) => x.dE - y.dE);
}

let frameToken = 0;
function yieldFrame(): Promise<void> {
  return new Promise((res) => {
    frameToken++;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); res(); };
    ch.port2.postMessage(frameToken);
  });
}
