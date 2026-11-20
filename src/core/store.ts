// 轻量响应式状态管理（发布订阅，无框架依赖）
import type { AppState, Order, YarnColor } from '../types';
import { initialState, loadState, saveState, uid } from './storage';
import { createDefaultMaps, loadImage, mapCanvas } from './maps';

type Listener = () => void;

class Store {
  state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = loadState() ?? initialState();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    if (this.state.settings.autoSave) saveState(this.state);
    this.listeners.forEach((fn) => fn());
  }

  /** 批量修改，只触发一次更新 */
  batch(fn: () => void): void {
    const prev = this.state.settings.autoSave;
    this.state.settings.autoSave = false;
    fn();
    this.state.settings.autoSave = prev;
    this.emit();
  }

  get currentOrder(): Order | null {
    return this.state.orders.find((o) => o.id === this.state.currentOrderId) ?? null;
  }

  getPalette(id: string) {
    return this.state.palettes.find((p) => p.id === id) ?? this.state.palettes[0];
  }

  paletteColors(order: Order): YarnColor[] {
    return this.getPalette(order.paletteId).colors;
  }

  // ---------- 订单 ----------
  addOrder(order: Order): void {
    this.state.orders.unshift(order);
    this.state.currentOrderId = order.id;
    this.emit();
  }

  updateOrder(id: string, patch: Partial<Order>): void {
    const o = this.state.orders.find((x) => x.id === id);
    if (!o) return;
    Object.assign(o, patch, { updatedAt: Date.now() });
    this.emit();
  }

  /** 尺寸变更时同步重建工艺图尺寸 */
  resizeOrderMaps(order: Order, widthM: number, depthM: number): void {
    const old = order;
    const o = this.state.orders.find((x) => x.id === order.id);
    if (!o) return;
    o.widthM = widthM; o.depthM = depthM;
    this.rebuildMapsResized(o, old);
    o.updatedAt = Date.now();
    this.emit();
  }

  private rebuildMapsResized(o: Order, old: Order): void {
    // 新尺寸空白图保证尺寸正确，再异步把旧图缩放到新图上，保留已绘内容
    const maps = createDefaultMaps(o.widthM, o.depthM, o.pile.cutRatio);
    const oldMaps = { heightMap: old.heightMap, typeMap: old.typeMap, directionMap: old.directionMap };
    o.heightMap = maps.heightMap; o.typeMap = maps.typeMap; o.directionMap = maps.directionMap;
    const keys = ['heightMap', 'typeMap', 'directionMap'] as const;
    void (async () => {
      for (const k of keys) {
        const [nc, img] = await Promise.all([mapCanvas(maps[k]), loadImage(oldMaps[k])]);
        nc.getContext('2d')!.drawImage(img, 0, 0, nc.width, nc.height);
        o[k] = nc.toDataURL('image/png');
      }
      this.emit();
    })();
  }

  duplicateOrder(id: string): void {
    const src = this.state.orders.find((x) => x.id === id);
    if (!src) return;
    const copy: Order = {
      ...structuredClone(src),
      id: uid('ord'),
      name: src.name + ' 副本',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state.orders.unshift(copy);
    this.state.currentOrderId = copy.id;
    this.emit();
  }

  deleteOrder(id: string): void {
    this.state.orders = this.state.orders.filter((x) => x.id !== id);
    if (this.state.currentOrderId === id) {
      this.state.currentOrderId = this.state.orders[0]?.id ?? null;
    }
    this.emit();
  }

  selectOrder(id: string): void {
    this.state.currentOrderId = id;
    this.emit();
  }

  // ---------- 色板 ----------
  addPaletteColor(paletteId: string, color: Omit<YarnColor, 'id'>): void {
    this.getPalette(paletteId).colors.push({ ...color, id: uid('y') });
    this.emit();
  }

  updatePaletteColor(paletteId: string, colorId: string, patch: Partial<YarnColor>): void {
    const c = this.getPalette(paletteId).colors.find((x) => x.id === colorId);
    if (c) Object.assign(c, patch);
    this.emit();
  }

  removePaletteColor(paletteId: string, colorId: string): void {
    const p = this.getPalette(paletteId);
    p.colors = p.colors.filter((c) => c.id !== colorId);
    this.state.orders.forEach((o) => {
      if (o.paletteId !== paletteId) return;
      for (const k of Object.keys(o.colorMapping)) {
        if (o.colorMapping[Number(k)] === colorId) delete o.colorMapping[Number(k)];
      }
      o.unusedColorIds = o.unusedColorIds.filter((id) => id !== colorId);
    });
    this.emit();
  }

  // ---------- 设置 ----------
  updateSettings(patch: Partial<AppState['settings']>): void {
    Object.assign(this.state.settings, patch);
    this.emit();
  }

  importState(json: string): void {
    const data = JSON.parse(json);
    if (!Array.isArray(data.orders)) throw new Error('文件格式不正确：缺少 orders 数组');
    // 重新生成 id 防冲突
    const idMap = new Map<string, string>();
    data.orders.forEach((o: Order) => idMap.set(o.id, uid('ord')));
    data.orders = data.orders.map((o: Order) => ({ ...o, id: idMap.get(o.id)! }));
    this.state.orders = [...data.orders, ...this.state.orders];
    this.state.currentOrderId = data.orders[0].id;
    if (data.settings) this.state.settings = { ...this.state.settings, ...data.settings };
    this.emit();
  }
}

export const store = new Store();
