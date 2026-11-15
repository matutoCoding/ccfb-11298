// 截图(带订单参数)与纱线用量清单
import { Order, Settings, MATERIAL_NAMES } from './types';
import { readPixels } from './quantize';
import { downloadBlob } from './store';
import { el } from './ui';
import { loadImage } from './gl/previewScene';

/** 截图并叠加订单参数条,下载 PNG */
export async function screenshotWithParams(glCanvasUrl: string, order: Order) {
  const img = await loadImage(glCanvasUrl);
  const barH = 110;
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight + barH;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  // 参数条
  ctx.fillStyle = '#1c1d20';
  ctx.fillRect(0, img.naturalHeight, cv.width, barH);
  ctx.fillStyle = '#f0ede6';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(`${order.name}   ${order.widthM}×${order.heightM} m`, 24, img.naturalHeight + 36);
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = '#b8b4a8';
  const shapeName = { rect: '矩形', round: '圆形', oval: '椭圆' }[order.shape];
  ctx.fillText(
    `客户:${order.customer || '—'}   形状:${shapeName}   绒高:${order.pileHeightMm} mm   ${new Date().toLocaleDateString('zh-CN')}`,
    24, img.naturalHeight + 68);
  // 色板
  if (order.pattern) {
    let x = 24;
    const y = img.naturalHeight + 80;
    for (const c of order.pattern.colors.slice(0, 14)) {
      ctx.fillStyle = c.hex;
      ctx.fillRect(x, y, 18, 18);
      ctx.fillStyle = '#9a968c';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(c.code, x + 22, y + 14);
      x += 22 + ctx.measureText(c.code).width + 18;
    }
  }
  cv.toBlob((b) => {
    if (b) downloadBlob(b, `地毯预览-${order.name}.png`);
  }, 'image/png');
}

export interface UsageRow {
  code: string;
  name: string;
  material: string;
  hex: string;
  ratio: number;
  areaM2: number;
  weightG: number;
}

/** 计算纱线用量 */
export async function calcUsage(order: Order, settings: Settings): Promise<UsageRow[]> {
  if (!order.pattern) return [];
  const { data } = await readPixels(order.pattern.indexedUrl);
  const n = data.length / 4;
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const hex = '#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      .map((v) => v.toString(16).padStart(2, '0')).join('');
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  // 形状填充系数
  const fill = order.shape === 'rect' ? 1 : Math.PI / 4;
  const totalArea = order.widthM * order.heightM * fill;
  // 平均绒高与圈绒占比(从工艺图采样)
  let heightFactor = 1;
  let loopRatio = 0;
  if (order.craft.heightMapUrl || order.craft.regionMapUrl) {
    try {
      let hSum = 0, hN = 0, loopN = 0;
      if (order.craft.heightMapUrl) {
        const h = await readPixels(order.craft.heightMapUrl);
        for (let i = 0; i < h.data.length / 4; i += 7) { hSum += h.data[i * 4] / 255; hN++; }
        heightFactor = hN ? hSum / hN : 1;
      }
      if (order.craft.regionMapUrl) {
        const r = await readPixels(order.craft.regionMapUrl);
        let rN = 0;
        for (let i = 0; i < r.data.length / 4; i += 7) { if (r.data[i * 4] < 128) loopN++; rN++; }
        loopRatio = rN ? loopN / rN : 0;
      }
    } catch { /* 用默认值 */ }
  }
  const avgHeightMm = order.pileHeightMm * heightFactor * (1 - loopRatio * 0.45);
  const gramPerMm = settings.gramPerMmCut * (1 - loopRatio * (1 - settings.loopFactor));

  const rows: UsageRow[] = [];
  for (const c of order.pattern.colors) {
    const cnt = counts.get(c.hex.toLowerCase()) || 0;
    const ratio = cnt / n;
    const area = totalArea * ratio;
    const weight = area * avgHeightMm * gramPerMm * (1 + settings.wastage);
    rows.push({
      code: c.code, name: c.name, material: MATERIAL_NAMES[c.material],
      hex: c.hex, ratio, areaM2: area, weightG: weight,
    });
  }
  rows.sort((a, b) => b.weightG - a.weightG);
  return rows;
}

/** 弹出用量清单 */
export function showUsageModal(rows: UsageRow[], order: Order) {
  const overlay = el('div', { class: 'modal-overlay' });
  const total = rows.reduce((s, r) => s + r.weightG, 0);
  const box = el('div', { class: 'modal wide' },
    el('h3', {}, `纱线用量清单 — ${order.name}`),
    el('div', { class: 'hint' }, `成品 ${order.widthM}×${order.heightM} m,绒高 ${order.pileHeightMm} mm,合计约 ${(total / 1000).toFixed(2)} kg(含损耗)`),
  );
  const table = el('table', { class: 'usage-table' });
  table.append(el('tr', {},
    el('th', {}, '色块'), el('th', {}, '色号'), el('th', {}, '名称'),
    el('th', {}, '材质'), el('th', {}, '占比'), el('th', {}, '面积 m²'), el('th', {}, '用量 g')));
  for (const r of rows) {
    const sw = el('span', { class: 'chip-color', style: `background:${r.hex}` });
    table.append(el('tr', {},
      el('td', {}, sw),
      el('td', {}, r.code),
      el('td', {}, r.name),
      el('td', {}, r.material),
      el('td', {}, (r.ratio * 100).toFixed(1) + '%'),
      el('td', {}, r.areaM2.toFixed(3)),
      el('td', {}, r.weightG.toFixed(0)),
    ));
  }
  const csvBtn = el('button', { class: 'btn primary' }, '导出 CSV');
  csvBtn.addEventListener('click', () => {
    const head = '色号,名称,材质,占比,面积m2,用量g\n';
    const body = rows.map((r) =>
      [r.code, r.name, r.material, (r.ratio * 100).toFixed(1) + '%', r.areaM2.toFixed(3), r.weightG.toFixed(0)].join(',')
    ).join('\n');
    downloadBlob(new Blob(['﻿' + head + body], { type: 'text/csv' }), `纱线用量-${order.name}.csv`);
  });
  const closeBtn = el('button', { class: 'btn' }, '关闭');
  closeBtn.addEventListener('click', () => overlay.remove());
  box.append(table, el('div', { class: 'modal-actions' }, csvBtn, closeBtn));
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}
