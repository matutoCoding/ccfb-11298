// 纱线用量清单估算
import type { Order, YarnColor } from '../types';
import { loadImage } from './maps';

export interface YarnUsageRow {
  color: YarnColor;
  areaM2: number;
  areaPercent: number;
  lengthM: number;   // 估算用纱长度（米）
  weightG: number;   // 估算重量（克）
}

export interface UsageReport {
  rows: YarnUsageRow[];
  totalAreaM2: number;
  totalWeightG: number;
  totalLengthM: number;
}

// 工程经验系数（可在设置中按真实打样数据校准）
const MATERIAL_DENSITY_G_PER_M3: Record<string, number> = {
  wool: 320,       // 羊毛体积密度（蓬松度折算）
  silk: 260,
  synthetic: 200,  // 化纤较轻
};
// 纤维在绒层中的填充率
const PACKING_FACTOR = 0.18;
// 圈绒用纱长度系数（拱形展开 + 底布固结）
const LOOP_LENGTH_FACTOR = 2.6;
const CUT_LENGTH_FACTOR = 1.15;
// 纱线等效直径（米），用于由重量反推长度
const YARN_RADIUS_M = 0.0009;

export async function computeUsage(order: Order, colors: YarnColor[]): Promise<UsageReport> {
  const totalArea = order.widthM * order.depthM;
  const counts = new Map<number, number>();
  let totalPx = 0;

  if (order.quantizedImage) {
    const img = await loadImage(order.quantizedImage);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < c.width * c.height; i++) {
      const idx = d[i * 4]; // 量化索引存在 R
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
      totalPx++;
    }
  }

  const avgHeightM = (order.pile.pileHeight * order.pile.cutRatio
    + order.pile.loopHeight * (1 - order.pile.cutRatio)) / 1000;
  const density = MATERIAL_DENSITY_G_PER_M3[order.pile.material] ?? 320;
  const yarnSection = Math.PI * YARN_RADIUS_M * YARN_RADIUS_M;

  const rows: YarnUsageRow[] = [];
  for (const [idxStr, px] of counts) {
    const idx = Number(idxStr);
    const colorId = order.colorMapping[idx];
    const color = colors.find((c) => c.id === colorId) ?? colors[idx];
    if (!color) continue;
    const fraction = totalPx ? px / totalPx : 0;
    const area = totalArea * fraction;
    // 该色覆盖区域的绒层体积（考虑填充率）
    const pileVolume = area * avgHeightM * PACKING_FACTOR;
    const weightG = pileVolume * density * 1000;
    const lengthFactor = order.pile.cutRatio * CUT_LENGTH_FACTOR + (1 - order.pile.cutRatio) * LOOP_LENGTH_FACTOR;
    const lengthM = (area * avgHeightM * lengthFactor * (order.pile.density / 18)) / yarnSection * PACKING_FACTOR * 0.01;
    rows.push({ color, areaM2: area, areaPercent: fraction * 100, lengthM, weightG });
  }
  rows.sort((a, b) => b.areaM2 - a.areaM2);

  return {
    rows,
    totalAreaM2: totalArea,
    totalWeightG: rows.reduce((s, r) => s + r.weightG, 0),
    totalLengthM: rows.reduce((s, r) => s + r.lengthM, 0),
  };
}
