// localStorage 持久化与订单 JSON 导入导出
import type { AppState } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { defaultPalettes, lightPresets } from './defaults';

const STORAGE_KEY = 'carpet-studio-state-v1';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    // 合并默认设置，兼容旧版本
    parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
    return parsed;
  } catch (e) {
    console.error('读取本地状态失败', e);
    return null;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // dataURL 图可能超配额
    console.error('保存失败（可能是存储空间不足）', e);
    alert('浏览器本地存储空间不足，请导出订单后删除部分旧订单。');
  }
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function initialState(): AppState {
  return {
    orders: [],
    currentOrderId: null,
    palettes: defaultPalettes(),
    lightPresets: lightPresets(),
    settings: { ...DEFAULT_SETTINGS },
  };
}
