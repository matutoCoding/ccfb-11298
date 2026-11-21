// 纱线用量与清单：随道数/绒高重算的物理账
import type { HeightField, PaletteColor, YarnUsageItem } from './types';
import type { AppSettings } from './types';

/**
 * 每个结 = 一根绒线在经线上绕成 U 形（两臂），长度 = 2 * foldFactor * 绒高 + 结头余量
 * 克重 = 长度(m) * 线密度(g/m)
 * 换道数后 cols/rows 与 heights 全部重建，本函数自然按新结数重算
 */
export function buildUsage(
  hf: HeightField,
  knots: Uint16Array,
  palette: PaletteColor[],
  settings: AppSettings,
  knotAllowanceMm = 1.2,
): YarnUsageItem[] {
  const agg = new Map<number, { knots: number; lenMm: number }>();
  for (let i = 0; i < hf.heights.length; i++) {
    const c = knots[i];
    const lenMm = hf.heights[i] * settings.foldFactor * 2 + knotAllowanceMm;
    const cur = agg.get(c) ?? { knots: 0, lenMm: 0 };
    cur.knots++;
    cur.lenMm += lenMm;
    agg.set(c, cur);
  }
  const items: YarnUsageItem[] = [];
  for (const [colorIdx, v] of agg) {
    const color = palette[colorIdx];
    if (!color) continue;
    const lengthM = v.lenMm / 1000;
    const density = settings.yarnLinearDensity[color.yarn] ?? settings.yarnLinearDensity.wool;
    items.push({
      colorId: color.id,
      code: color.code,
      name: color.name,
      yarn: color.yarn,
      knots: v.knots,
      lengthM,
      grams: lengthM * density,
    });
  }
  return items.sort((a, b) => b.grams - a.grams);
}

export function totalGrams(items: YarnUsageItem[]): number {
  return items.reduce((s, i) => s + i.grams, 0);
}

const yarnLabel: Record<string, string> = { wool: '羊毛', silk: '丝', woolSilk: '羊毛夹丝' };

export function usageToCsv(items: YarnUsageItem[]): string {
  const head = '色号,颜色,纱线类型,结数,绒线长度(m),克重(g)';
  const rows = items.map((i) =>
    [i.code, i.name, yarnLabel[i.yarn], i.knots, i.lengthM.toFixed(2), i.grams.toFixed(1)].join(','),
  );
  const total = items.reduce(
    (acc, i) => ({ knots: acc.knots + i.knots, len: acc.len + i.lengthM, g: acc.g + i.grams }),
    { knots: 0, len: 0, g: 0 },
  );
  rows.push(['合计', '', '', total.knots, total.len.toFixed(2), total.g.toFixed(1)].join(','));
  // 加 BOM 让 Excel 正确识别中文
  return '﻿' + [head, ...rows].join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
