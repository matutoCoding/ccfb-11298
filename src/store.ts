import { Order, Settings, DEFAULT_SETTINGS, createEmptyOrder } from './types';

const INDEX_KEY = 'carpet.orders.index';
const ORDER_PREFIX = 'carpet.order.';
const SETTINGS_KEY = 'carpet.settings';
const CURRENT_KEY = 'carpet.current';

type Listener = () => void;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class Store {
  private listeners = new Set<Listener>();
  settings: Settings = { ...DEFAULT_SETTINGS };
  private _currentOrderId: string | null = null;

  get currentOrderId(): string | null {
    return this._currentOrderId;
  }
  set currentOrderId(id: string | null) {
    this._currentOrderId = id;
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  }

  constructor() {
    this.loadSettings();
    this._currentOrderId = localStorage.getItem(CURRENT_KEY);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((f) => f());
  }

  // ---------- 设置 ----------
  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* 忽略损坏数据 */ }
  }
  saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    this.emit();
  }

  // ---------- 订单 ----------
  listIds(): string[] {
    try {
      return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    } catch {
      return [];
    }
  }

  list(): Order[] {
    return this.listIds()
      .map((id) => this.get(id))
      .filter((o): o is Order => !!o)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Order | null {
    try {
      const raw = localStorage.getItem(ORDER_PREFIX + id);
      return raw ? (JSON.parse(raw) as Order) : null;
    } catch {
      return null;
    }
  }

  current(): Order | null {
    return this.currentOrderId ? this.get(this.currentOrderId) : null;
  }

  save(order: Order) {
    order.updatedAt = Date.now();
    const ids = this.listIds();
    if (!ids.includes(order.id)) {
      ids.push(order.id);
      localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
    }
    try {
      localStorage.setItem(ORDER_PREFIX + order.id, JSON.stringify(order));
    } catch (e) {
      alert('保存失败:浏览器存储空间不足,可删除旧订单或导出的订单文件。');
      throw e;
    }
    this.emit();
  }

  create(): Order {
    const o = createEmptyOrder(uid());
    o.name = `订单 ${new Date().toLocaleDateString('zh-CN')}-${this.listIds().length + 1}`;
    this.save(o);
    this.currentOrderId = o.id;
    return o;
  }

  duplicate(id: string): Order | null {
    const src = this.get(id);
    if (!src) return null;
    const copy: Order = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.name = src.name + ' 副本';
    copy.createdAt = Date.now();
    this.save(copy);
    return copy;
  }

  remove(id: string) {
    localStorage.removeItem(ORDER_PREFIX + id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(this.listIds().filter((x) => x !== id)));
    if (this.currentOrderId === id) this.currentOrderId = null;
    this.emit();
  }

  // ---------- 导入导出 ----------
  exportOrder(id: string) {
    const o = this.get(id);
    if (!o) return;
    downloadJson(o, `地毯订单-${o.name}.json`);
  }

  exportAll() {
    downloadJson({ type: 'carpet-orders-backup', orders: this.list() }, `地毯订单备份-${new Date().toISOString().slice(0, 10)}.json`);
  }

  importJson(text: string): { ok: number; fail: number } {
    let ok = 0, fail = 0;
    try {
      const data = JSON.parse(text);
      const arr: Order[] = Array.isArray(data) ? data : data.orders ? data.orders : [data];
      for (const o of arr) {
        if (o && typeof o.id === 'string' && typeof o.name === 'string' && o.craft) {
          if (this.get(o.id)) o.id = uid(); // 避免覆盖已有订单
          this.save(o);
          ok++;
        } else fail++;
      }
    } catch {
      fail++;
    }
    this.emit();
    return { ok, fail };
  }

  clearAll() {
    for (const id of this.listIds()) localStorage.removeItem(ORDER_PREFIX + id);
    localStorage.removeItem(INDEX_KEY);
    this.currentOrderId = null;
    this.emit();
  }
}

export function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const store = new Store();
