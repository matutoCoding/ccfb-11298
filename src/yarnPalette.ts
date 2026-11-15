import { YarnColor, MaterialId } from './types';

// 内置纱线色库:羊毛 W / 真丝 S / 化纤 P
function y(code: string, name: string, hex: string, material: MaterialId): YarnColor {
  return { code, name, hex, material };
}

export const YARN_LIBRARY: YarnColor[] = [
  // 羊毛
  y('W-101', '本白', '#f2ede2', 0), y('W-102', '米白', '#e8dfc9', 0),
  y('W-103', '浅驼', '#d6c4a0', 0), y('W-104', '驼色', '#bfa172', 0),
  y('W-105', '咖啡', '#7d5a3c', 0), y('W-106', '深棕', '#4e3626', 0),
  y('W-107', '浅灰', '#c9c9c6', 0), y('W-108', '中灰', '#8f8f8c', 0),
  y('W-109', '炭灰', '#4a4a48', 0), y('W-110', '墨黑', '#232323', 0),
  y('W-111', '奶黄', '#eedda6', 0), y('W-112', '姜黄', '#d9a83f', 0),
  y('W-113', '橘红', '#c96a35', 0), y('W-114', '砖红', '#a3402f', 0),
  y('W-115', '酒红', '#7a2a33', 0), y('W-116', '玫粉', '#d497a8', 0),
  y('W-117', '雾粉', '#e3c4c4', 0), y('W-118', '豆绿', '#9db38a', 0),
  y('W-119', '墨绿', '#3c5a44', 0), y('W-120', '藏青', '#2c3a56', 0),
  y('W-121', '靛蓝', '#3f5a8a', 0), y('W-122', '天蓝', '#8fb3cf', 0),
  y('W-123', '藕紫', '#a58ba8', 0), y('W-124', '深紫', '#5a4468', 0),
  // 真丝
  y('S-201', '珍珠白', '#f6f2e8', 1), y('S-202', '香槟', '#e6d3ac', 1),
  y('S-203', '金色', '#d3ac5e', 1), y('S-204', '蜜棕', '#a67c4e', 1),
  y('S-205', '银灰', '#c6c8cc', 1), y('S-206', '铅灰', '#77797e', 1),
  y('S-207', '珊瑚', '#dd8a76', 1), y('S-208', '绯红', '#b03a44', 1),
  y('S-209', '翡翠', '#4e8a6e', 1), y('S-210', '孔雀蓝', '#2f6e8e', 1),
  y('S-211', '宝蓝', '#2e4d8f', 1), y('S-212', '紫罗兰', '#8a6fae', 1),
  // 化纤
  y('P-301', '漂白', '#f8f8f6', 2), y('P-302', '浅米', '#e5dcc6', 2),
  y('P-303', '沙色', '#cbb489', 2), y('P-304', '焦糖', '#a06a35', 2),
  y('P-305', '浅灰', '#c4c6c8', 2), y('P-306', '深灰', '#5c5e62', 2),
  y('P-307', '纯黑', '#1c1c1e', 2), y('P-308', '明黄', '#e8c53a', 2),
  y('P-309', '橙红', '#d4552f', 2), y('P-310', '大红', '#b02830', 2),
  y('P-311', '粉红', '#e5a9bc', 2), y('P-312', '草绿', '#7aa64b', 2),
  y('P-313', '湖绿', '#4ba692', 2), y('P-314', '湖蓝', '#5a9cc8', 2),
  y('P-315', '深蓝', '#2b3f6e', 2), y('P-316', '茄紫', '#6e4a80', 2),
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// sRGB -> Lab(D65),用于颜色匹配
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = f(r), G = f(g), B = f(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const yv = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = t(x), fy = t(yv), fz = t(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const labCache = new Map<string, [number, number, number]>();
function labOf(hex: string): [number, number, number] {
  let v = labCache.get(hex);
  if (!v) {
    const [r, g, b] = hexToRgb(hex);
    v = rgbToLab(r, g, b);
    labCache.set(hex, v);
  }
  return v;
}

/** 在纱线库中找最接近的颜色 */
export function nearestYarn(r: number, g: number, b: number): YarnColor {
  const target = rgbToLab(r, g, b);
  let best = YARN_LIBRARY[0];
  let bestD = Infinity;
  for (const yc of YARN_LIBRARY) {
    const l = labOf(yc.hex);
    const d = (l[0] - target[0]) ** 2 + (l[1] - target[1]) ** 2 + (l[2] - target[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = yc;
    }
  }
  return best;
}
