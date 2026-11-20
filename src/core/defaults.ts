import type { LightPreset, Order, YarnPalette } from '../types';
import { DEFAULT_PILE } from '../types';
import { uid } from './storage';
import { createDefaultMaps, loadImage, mapCanvas, paintDemoRelief, quantizeImage } from './maps';

export function defaultPalettes(): YarnPalette[] {
  return [
    {
      id: 'pal_classic',
      name: '经典羊毛色板',
      colors: [
        { id: uid('y'), name: '米白', rgb: [238, 231, 218] },
        { id: uid('y'), name: '燕麦', rgb: [214, 199, 174] },
        { id: uid('y'), name: '驼色', rgb: [181, 148, 108] },
        { id: uid('y'), name: '焦糖', rgb: [143, 96, 58] },
        { id: uid('y'), name: '砖红', rgb: [148, 72, 56] },
        { id: uid('y'), name: '酒红', rgb: [102, 43, 45] },
        { id: uid('y'), name: '墨绿', rgb: [58, 79, 65] },
        { id: uid('y'), name: '灰蓝', rgb: [91, 108, 120] },
        { id: uid('y'), name: '深灰', rgb: [74, 72, 70] },
        { id: uid('y'), name: '炭黑', rgb: [38, 36, 35] },
        { id: uid('y'), name: '赭黄', rgb: [196, 160, 84] },
        { id: uid('y'), name: '雾粉', rgb: [198, 158, 150] },
      ],
    },
    {
      id: 'pal_modern',
      name: '现代中性色板',
      colors: [
        { id: uid('y'), name: '雪白', rgb: [245, 245, 242] },
        { id: uid('y'), name: '银灰', rgb: [196, 197, 195] },
        { id: uid('y'), name: '石灰', rgb: [142, 144, 141] },
        { id: uid('y'), name: '石墨', rgb: [82, 84, 83] },
        { id: uid('y'), name: '藏青', rgb: [42, 53, 68] },
        { id: uid('y'), name: '暖棕', rgb: [126, 96, 72] },
        { id: uid('y'), name: '赤陶', rgb: [176, 104, 78] },
        { id: uid('y'), name: '苔绿', rgb: [116, 128, 102] },
      ],
    },
  ];
}

export function lightPresets(): LightPreset[] {
  return [
    {
      id: 'lt_warm_living', name: '暖黄客厅',
      ambient: [0.42, 0.36, 0.30], keyColor: [1.0, 0.86, 0.66], intensity: 1.15,
      azimuth: 35, elevation: 42,
    },
    {
      id: 'lt_daylight', name: '中性日光',
      ambient: [0.46, 0.48, 0.52], keyColor: [1.0, 0.97, 0.92], intensity: 1.25,
      azimuth: -20, elevation: 55,
    },
    {
      id: 'lt_cool_showroom', name: '冷白展厅',
      ambient: [0.5, 0.52, 0.58], keyColor: [0.92, 0.96, 1.0], intensity: 1.3,
      azimuth: 60, elevation: 48,
    },
    {
      id: 'lt_side_dusk', name: '傍晚侧光',
      ambient: [0.26, 0.24, 0.28], keyColor: [1.0, 0.68, 0.42], intensity: 1.35,
      azimuth: 82, elevation: 14,
    },
    {
      id: 'lt_overcast', name: '柔和阴天',
      ambient: [0.55, 0.57, 0.6], keyColor: [0.88, 0.92, 1.0], intensity: 0.8,
      azimuth: -45, elevation: 65,
    },
  ];
}

/** 程序化生成一张演示图案（几何纹样），避免依赖外部素材 */
export function createDemoPattern(): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#eee7da';
  ctx.fillRect(0, 0, S, S);
  // 边框
  ctx.strokeStyle = '#4a4846';
  ctx.lineWidth = 18;
  ctx.strokeRect(20, 20, S - 40, S - 40);
  ctx.strokeStyle = '#8f603a';
  ctx.lineWidth = 8;
  ctx.strokeRect(44, 44, S - 88, S - 88);
  // 中心菱形
  ctx.fillStyle = '#662b2d';
  ctx.beginPath();
  ctx.moveTo(S / 2, 90); ctx.lineTo(S - 90, S / 2);
  ctx.lineTo(S / 2, S - 90); ctx.lineTo(90, S / 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c4a054';
  ctx.beginPath();
  ctx.moveTo(S / 2, 150); ctx.lineTo(S - 150, S / 2);
  ctx.lineTo(S / 2, S - 150); ctx.lineTo(150, S / 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3a4f41';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 52, 0, Math.PI * 2);
  ctx.fill();
  // 四角装饰
  const corners: [number, number][] = [[110, 110], [S - 110, 110], [110, S - 110], [S - 110, S - 110]];
  for (const [x, y] of corners) {
    ctx.fillStyle = '#944838';
    ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5b6c78';
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
  }
  // 细碎纹理
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    ctx.fillStyle = `rgba(74,72,70,${Math.random() * 0.08})`;
    ctx.fillRect(x, y, 2, 2);
  }
  return c;
}

export function createOrder(partial: Partial<Order> = {}): Order {
  const now = Date.now();
  const widthM = partial.widthM ?? 2.0;
  const depthM = partial.depthM ?? 1.4;
  const maps = createDefaultMaps(widthM, depthM, DEFAULT_PILE.cutRatio);
  return {
    id: uid('ord'),
    name: partial.name ?? '新订单',
    customer: partial.customer ?? '',
    createdAt: now,
    updatedAt: now,
    widthM,
    depthM,
    patternImage: null,
    quantizedImage: null,
    heightMap: maps.heightMap,
    typeMap: maps.typeMap,
    directionMap: maps.directionMap,
    paletteId: partial.paletteId ?? 'pal_classic',
    colorMapping: {},
    unusedColorIds: [],
    pile: { ...DEFAULT_PILE },
    note: '',
    ...partial,
  };
}

export async function createDemoOrder(palettes: YarnPalette[]): Promise<Order> {
  const palette = palettes[0];
  const pattern = createDemoPattern();
  const q = quantizeImage(pattern, palette.colors.map((c) => c.rgb));
  const order = createOrder({
    name: '示例订单·几何花毯',
    customer: '演示客户',
    widthM: 2.4,
    depthM: 1.7,
    paletteId: palette.id,
    patternImage: pattern.toDataURL('image/png'),
    quantizedImage: q.dataURL,
    note: '系统生成的演示订单，可随意修改或删除。',
  });
  const mapping: Record<number, string> = {};
  for (const idx of Object.keys(q.counts)) mapping[Number(idx)] = palette.colors[Number(idx)].id;
  order.colorMapping = mapping;
  // 中心菱形刷高绒浮雕、角落刷一片圈绒
  const [hCvs, tCvs] = await Promise.all([mapCanvas(order.heightMap), mapCanvas(order.typeMap)]);
  paintDemoRelief(hCvs, tCvs);
  order.heightMap = hCvs.toDataURL('image/png');
  order.typeMap = tCvs.toDataURL('image/png');
  return order;
}
