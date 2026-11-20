// 颜色科学：RGB <-> Lab，用于按感知色差做纱线量化
export type RGB = [number, number, number];

export function clamp(v: number, lo = 0, hi = 255): number {
  return Math.min(hi, Math.max(lo, v));
}

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map((v) => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToLab(rgb: RGB): [number, number, number] {
  let [r, g, b] = rgb.map(srgbToLinear);
  r *= 100; g *= 100; b *= 100;
  // sRGB D65 -> XYZ
  let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  let z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  // D65 参考白
  x /= 95.047; y /= 100; z /= 108.883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 色差（对纱线选色足够稳定，计算快） */
export function deltaE(a: RGB, b: RGB): number {
  const la = rgbToLab(a), lb = rgbToLab(b);
  const dl = la[0] - lb[0], da = la[1] - lb[1], db = la[2] - lb[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** 在纱线色板中找感知最接近的颜色，返回色板下标 */
export function nearestYarnIndex(rgb: RGB, palette: RGB[]): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = deltaE(rgb, palette[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function rgbToLuma(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
