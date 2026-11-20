// 工艺纹理（绒高/割圈/方向）与图案量化
import type { RGB } from './color';
import { nearestYarnIndex } from './color';

export const MAP_LONG_SIDE = 512;
const PATTERN_LONG_SIDE = 1024;

export interface MapSet {
  heightMap: string;
  typeMap: string;
  directionMap: string;
  mapW: number;
  mapH: number;
}

export function mapDimensions(widthM: number, depthM: number): { w: number; h: number } {
  if (widthM >= depthM) {
    const w = MAP_LONG_SIDE;
    const h = Math.max(64, Math.round((MAP_LONG_SIDE * depthM) / widthM));
    return { w, h: h % 2 ? h + 1 : h };
  }
  const h = MAP_LONG_SIDE;
  const w = Math.max(64, Math.round((MAP_LONG_SIDE * widthM) / depthM));
  return { w: w % 2 ? w + 1 : w, h };
}

function canvasToURL(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png');
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function mapCanvas(dataURL: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataURL);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

/** 默认三张工艺图：统一绒高、按割绒比例随机割/圈、顺毛方向 +X、无压痕 */
export function createDefaultMaps(widthM: number, depthM: number, cutRatio: number): MapSet {
  const { w, h } = mapDimensions(widthM, depthM);

  const hc = document.createElement('canvas');
  hc.width = w; hc.height = h;
  const hctx = hc.getContext('2d')!;
  hctx.fillStyle = 'rgb(190,190,190)';
  hctx.fillRect(0, 0, w, h);

  const tc = document.createElement('canvas');
  tc.width = w; tc.height = h;
  const tctx = tc.getContext('2d')!;
  const tdata = tctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const isCut = Math.random() < cutRatio ? 255 : 0;
    tdata.data[i * 4] = isCut;
    tdata.data[i * 4 + 1] = isCut;
    tdata.data[i * 4 + 2] = isCut;
    tdata.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(tdata, 0, 0);

  const dc = document.createElement('canvas');
  dc.width = w; dc.height = h;
  const dctx = dc.getContext('2d')!;
  // 方向 (1, 0) 编码为 R=255,G=128；B=0 无压痕
  dctx.fillStyle = 'rgb(255,128,0)';
  dctx.fillRect(0, 0, w, h);

  return { heightMap: canvasToURL(hc), typeMap: canvasToURL(tc), directionMap: canvasToURL(dc), mapW: w, mapH: h };
}

export interface QuantizeResult {
  dataURL: string;
  width: number;
  height: number;
  counts: Record<number, number>;
}

/** 将任意图案按色板量化：输出 R 通道存纱线索引的 PNG，并统计各色用量像素 */
export function quantizeImage(source: HTMLImageElement | HTMLCanvasElement, palette: RGB[]): QuantizeResult {
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, PATTERN_LONG_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const inC = document.createElement('canvas');
  inC.width = w; inC.height = h;
  const inCtx = inC.getContext('2d', { willReadFrequently: true })!;
  inCtx.drawImage(source, 0, 0, w, h);
  const src = inCtx.getImageData(0, 0, w, h).data;

  const outC = document.createElement('canvas');
  outC.width = w; outC.height = h;
  const outCtx = outC.getContext('2d')!;
  const out = outCtx.createImageData(w, h);
  const counts: Record<number, number> = {};

  for (let i = 0; i < w * h; i++) {
    const rgb: RGB = [src[i * 4], src[i * 4 + 1], src[i * 4 + 2]];
    const idx = nearestYarnIndex(rgb, palette);
    out.data[i * 4] = idx;
    out.data[i * 4 + 1] = idx;
    out.data[i * 4 + 2] = idx;
    out.data[i * 4 + 3] = 255;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  outCtx.putImageData(out, 0, 0);
  return { dataURL: canvasToURL(outC), width: w, height: h, counts };
}

/** 通用软边笔刷：在 canvas 上按圆形 falloff 修改像素 */
export function paintCircle(
  c: HTMLCanvasElement,
  cx: number, cy: number, radius: number,
  apply: (x: number, y: number, falloff: number, idx: number, data: Uint8ClampedArray) => void,
): void {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const data = img.data;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(c.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(c.height - 1, Math.ceil(cy + radius));
  const r2 = radius * radius;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / radius;
      apply(x, y, falloff * falloff * (3 - 2 * falloff), (y * c.width + x) * 4, data);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 插值画线（拖笔时连续） */
export function paintStroke(
  c: HTMLCanvasElement,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  radius: number,
  apply: (x: number, y: number, falloff: number, idx: number, data: Uint8ClampedArray) => void,
): void {
  if (!from) { paintCircle(c, to.x, to.y, radius, apply); return; }
  const dx = to.x - from.x, dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (radius * 0.4)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    paintCircle(c, from.x + dx * t, from.y + dy * t, radius, apply);
  }
}

export function encodeDirection(dx: number, dy: number): [number, number] {
  return [Math.round((dx * 0.5 + 0.5) * 255), Math.round((dy * 0.5 + 0.5) * 255)];
}

export function decodeDirection(r: number, g: number): [number, number] {
  return [(r / 255) * 2 - 1, (g / 255) * 2 - 1];
}

/** 演示订单：在中心菱形区域刷高绒浮雕，并在角落做一片圈绒 */
export function paintDemoRelief(heightC: HTMLCanvasElement, typeC: HTMLCanvasElement): void {
  const S = heightC.width;
  // 中心菱形高绒
  paintCircle(heightC, S / 2, S / 2, S * 0.22, (x, y, f, idx, d) => {
    d[idx] = Math.max(d[idx], Math.round(120 + 135 * f));
  });
  // 外圈边框区域压低
  paintCircle(heightC, S * 0.12, S * 0.5, S * 0.09, (x, y, f, idx, d) => {
    d[idx] = Math.round(120 * (1 - f) + d[idx] * f);
  });
  // 左下角圈绒区
  paintCircle(typeC, S * 0.2, S * 0.78, S * 0.12, (x, y, f, idx, d) => {
    const v = 0;
    d[idx] = d[idx + 1] = d[idx + 2] = Math.round(d[idx] * (1 - f) + v * f);
  });
}
