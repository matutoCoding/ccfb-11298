// 默认纱线色卡（手纺羊毛常见色系，可在设置页增删）
import { rgbToLab } from './color';
import type { PaletteColor, YarnType } from './types';

const raw: { code: string; name: string; hex: string; yarn?: YarnType }[] = [
  { code: 'W-101', name: '本白', hex: '#f2ede1' },
  { code: 'W-102', name: '米白', hex: '#e3d9c3' },
  { code: 'W-201', name: '杏色', hex: '#d9b98c' },
  { code: 'W-202', name: '驼色', hex: '#b88d5e' },
  { code: 'W-203', name: '卡其', hex: '#9c8258' },
  { code: 'W-301', name: '浅驼', hex: '#c9a878' },
  { code: 'W-311', name: '砖红', hex: '#a4513c' },
  { code: 'W-312', name: '藏红', hex: '#7e2f28' },
  { code: 'W-321', name: '粉藕', hex: '#c99a94' },
  { code: 'W-401', name: '鹅黄', hex: '#d8b34a' },
  { code: 'W-402', name: '赭黄', hex: '#b8892f' },
  { code: 'W-501', name: '草绿', hex: '#6f7d49' },
  { code: 'W-502', name: '墨绿', hex: '#3d4f38' },
  { code: 'W-503', name: '豆绿', hex: '#8fa074' },
  { code: 'W-601', name: '天蓝', hex: '#6d8ba6' },
  { code: 'W-602', name: '靛蓝', hex: '#35506e' },
  { code: 'W-612', name: '藏青', hex: '#22303f' },
  { code: 'W-701', name: '茄紫', hex: '#5d4a63' },
  { code: 'W-801', name: '浅灰', hex: '#a7a39a' },
  { code: 'W-802', name: '深灰', hex: '#5d5b56' },
  { code: 'W-901', name: '炭黑', hex: '#2b2a28' },
  { code: 'S-101', name: '丝本白', hex: '#f6f3ea', yarn: 'silk' },
  { code: 'S-312', name: '丝绛红', hex: '#8c3530', yarn: 'silk' },
  { code: 'S-612', name: '丝宝蓝', hex: '#1f3d63', yarn: 'silk' },
  { code: 'M-202', name: '夹丝驼', hex: '#bd9263', yarn: 'woolSilk' },
  { code: 'M-502', name: '夹丝墨绿', hex: '#43573e', yarn: 'woolSilk' },
  { code: 'M-612', name: '夹丝藏青', hex: '#273748', yarn: 'woolSilk' },
];

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function defaultPalette(): PaletteColor[] {
  return raw.map((c) => {
    const rgb = hexToRgb(c.hex);
    const lab = rgbToLab(rgb);
    return { id: c.code, code: c.code, name: c.name, ...rgb, ...lab, yarn: c.yarn ?? 'wool' };
  });
}
