// 全局状态仓库：当前订单、结图、高度场、设置，跨页面共享
import { defaultPalette } from '../core/palette';
import {
  deleteOrder, loadAllOrders, loadHeights, loadKnots, loadSettings, saveHeights, saveKnots, saveOrder, saveSettings,
  type KnotBlob,
} from '../core/storage';
import type {
  AppSettings, CarveSpec, HeightField, OrderMeta, PaletteColor, PreviewSpec,
} from '../core/types';

export const DEFAULT_SETTINGS: AppSettings = {
  defaultKpi: 100,
  shellLayers: 6,
  finDensity: 1,
  yarnLinearDensity: { wool: 0.55, silk: 0.42, woolSilk: 0.5 },
  foldFactor: 1.0,
  customPalette: defaultPalette(),
  msaaSamples: 4,
};

export const DEFAULT_CARVE: CarveSpec = {
  basePile: 10,
  groove: { width: 4, depth: 2.5, slope: 0.55, enabled: true, colorBoundaryOnly: false },
  relief: [],
};

export const DEFAULT_PREVIEW: PreviewSpec = {
  yarn: 'wool',
  dyeLot: { bandHeight: 60, strength: 0.4, phase: 0, seed: 42, enabled: false },
  lightAzimuth: 35,
  lightElevation: 28,
  lightIntensity: 1.05,
  shellLayers: 6,
  finDensity: 1,
  scene: 'floor',
  showBack: false,
  showDyeLines: false,
};

interface OrderRuntime {
  knots: Uint16Array;
  heights: HeightField | null;
  carve: CarveSpec;
  preview: PreviewSpec;
}

class AppStore {
  settings: AppSettings = loadSettings(DEFAULT_SETTINGS);
  orders: OrderMeta[] = [];
  currentId: string | null = null;
  current: OrderMeta | null = null;
  runtime: OrderRuntime | null = null;
  knotBlob: KnotBlob | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(): void {
    this.listeners.forEach((f) => f());
  }

  get palette(): PaletteColor[] {
    return this.settings.customPalette.length ? this.settings.customPalette : defaultPalette();
  }

  persistSettings(): void {
    saveSettings(this.settings);
  }

  async refreshOrders(): Promise<void> {
    this.orders = await loadAllOrders();
    this.emit();
  }

  async upsertOrder(meta: OrderMeta): Promise<void> {
    meta.updatedAt = Date.now();
    await saveOrder(meta);
    await this.refreshOrders();
  }

  async removeOrder(id: string): Promise<void> {
    await deleteOrder(id);
    if (this.currentId === id) {
      this.currentId = null;
      this.current = null;
      this.runtime = null;
      this.knotBlob = null;
    }
    await this.refreshOrders();
  }

  async openOrder(id: string): Promise<void> {
    const meta = this.orders.find((o) => o.id) ?? (await loadAllOrders()).find((o) => o.id === id);
    if (!meta) throw new Error('订单不存在');
    this.currentId = id;
    this.current = meta;
    const blob = await loadKnots(id);
    this.knotBlob = blob;
    const hf = await loadHeights(id);
    this.runtime = {
      knots: blob?.knots ?? new Uint16Array(0),
      heights: hf,
      carve: structuredClone(DEFAULT_CARVE),
      preview: structuredClone(DEFAULT_PREVIEW),
    };
    this.runtime.preview.shellLayers = this.settings.shellLayers;
    this.emit();
  }

  closeOrder(): void {
    this.currentId = null;
    this.current = null;
    this.runtime = null;
    this.knotBlob = null;
    this.emit();
  }

  async saveKnotData(blob: KnotBlob): Promise<void> {
    if (!this.currentId) return;
    await saveKnots(this.currentId, blob);
    this.knotBlob = blob;
    if (this.runtime) this.runtime.knots = blob.knots;
  }

  async saveHeightField(hf: HeightField): Promise<void> {
    if (!this.currentId) return;
    await saveHeights(this.currentId, hf);
    if (this.runtime) this.runtime.heights = hf;
  }

  newOrderId(): string {
    return 'ord-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
  }
}

export const store = new AppStore();
