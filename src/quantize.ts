import { YarnColor, UsedColor } from './types';
import { nearestYarn, hexToRgb, rgbToHex } from './yarnPalette';

export interface QuantizeResult {
  /** 量化后的图像(dataURL,RGB=纱线色) */
  indexedUrl: string;
  colors: UsedColor[];
  width: number;
  height: number;
}

/**
 * k-means 聚类到 k 个代表色,再映射到纱线色库。
 * 在缩小的采样图上聚类,最后对全尺寸图逐像素映射。
 */
export function quantizeToYarn(
  img: HTMLImageElement | HTMLCanvasElement,
  k: number,
  maxSize = 480
): QuantizeResult {
  const srcW = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
  const srcH = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
  const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // ---- k-means(Lab 空间) ----
  const n = w * h;
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pts[i * 3] = data[i * 4];
    pts[i * 3 + 1] = data[i * 4 + 1];
    pts[i * 3 + 2] = data[i * 4 + 2];
  }
  const centers = new Float32Array(k * 3);
  // k-means++ 初始化
  centers.set([pts[0], pts[1], pts[2]], 0);
  const dist = new Float32Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dx = pts[i * 3] - centers[(c - 1) * 3];
      const dy = pts[i * 3 + 1] - centers[(c - 1) * 3 + 1];
      const dz = pts[i * 3 + 2] - centers[(c - 1) * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let r = Math.random() * sum;
    let idx = 0;
    while (r > 0 && idx < n - 1) { r -= dist[idx]; idx++; }
    centers.set([pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2]], c * 3);
  }
  const assign = new Uint16Array(n);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = pts[i * 3] - centers[c * 3];
        const dy = pts[i * 3 + 1] - centers[c * 3 + 1];
        const dz = pts[i * 3 + 2] - centers[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const sum = new Float32Array(k * 3);
    const cnt = new Float32Array(k);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sum[c * 3] += pts[i * 3];
      sum[c * 3 + 1] += pts[i * 3 + 1];
      sum[c * 3 + 2] += pts[i * 3 + 2];
      cnt[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (cnt[c] > 0) {
        centers[c * 3] = sum[c * 3] / cnt[c];
        centers[c * 3 + 1] = sum[c * 3 + 1] / cnt[c];
        centers[c * 3 + 2] = sum[c * 3 + 2] / cnt[c];
      }
    }
  }

  // ---- 映射到纱线色库并合并重复 ----
  const yarnOf: (YarnColor | null)[] = [];
  const cnt = new Float32Array(k);
  for (let i = 0; i < n; i++) cnt[assign[i]]++;
  for (let c = 0; c < k; c++) {
    yarnOf.push(cnt[c] > 0 ? nearestYarn(centers[c * 3], centers[c * 3 + 1], centers[c * 3 + 2]) : null);
  }
  const yarnList: YarnColor[] = [];
  const yarnIdx: number[] = []; // cluster -> yarnList index
  for (let c = 0; c < k; c++) {
    const yc = yarnOf[c];
    if (!yc) { yarnIdx.push(-1); continue; }
    let idx = yarnList.findIndex((y) => y.code === yc.code);
    if (idx < 0) { yarnList.push(yc); idx = yarnList.length - 1; }
    yarnIdx.push(idx);
  }
  const yarnCnt = new Float32Array(yarnList.length);
  for (let i = 0; i < n; i++) {
    const yi = yarnIdx[assign[i]];
    if (yi >= 0) yarnCnt[yi]++;
  }
  const colors: UsedColor[] = yarnList.map((yc, i) => ({ ...yc, ratio: yarnCnt[i] / n }));
  colors.sort((a, b) => b.ratio - a.ratio);

  // ---- 生成量化图 ----
  const out = ctx.createImageData(w, h);
  const rgb = yarnList.map((yc) => hexToRgb(yc.hex));
  for (let i = 0; i < n; i++) {
    const yi = yarnIdx[assign[i]];
    const c = yi >= 0 ? rgb[yi] : [255, 255, 255];
    out.data[i * 4] = c[0];
    out.data[i * 4 + 1] = c[1];
    out.data[i * 4 + 2] = c[2];
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);

  return { indexedUrl: cv.toDataURL('image/png'), colors, width: w, height: h };
}

/** 用给定色板重绘索引图(替换/合并颜色后调用) */
export function redrawIndexed(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  map: Map<string, YarnColor>
): string {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  img.data.set(pixels);
  for (let i = 0; i < width * height; i++) {
    const hex = rgbToHex(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    const rep = map.get(hex);
    if (rep) {
      const [r, g, b] = hexToRgb(rep.hex);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
    }
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/** 读取索引图像素 */
export function readPixels(dataUrl: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      resolve({ width: cv.width, height: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
