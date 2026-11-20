import type { Order } from '../types';
import { MATERIAL_LABEL } from '../types';
import { store } from '../core/store';
import {
  createDefaultMaps, decodeDirection, encodeDirection, mapCanvas, mapDimensions, paintStroke,
} from '../core/maps';
import { h, slider } from '../ui/dom';

type BrushMode = 'height' | 'low' | 'cut' | 'loop' | 'direction' | 'footprint' | 'erase';

interface Canvases {
  height: HTMLCanvasElement;
  type: HTMLCanvasElement;
  direction: HTMLCanvasElement;
}

export class CraftPage {
  el: HTMLElement;
  private order: Order;
  private cvs: Canvases | null = null;
  private mode: BrushMode = 'height';
  private radius = 34;
  private last: { x: number; y: number } | null = null;
  private painting = false;
  private overlay = document.createElement('canvas');
  private mainCanvas = document.createElement('canvas');
  private saveTimer = 0;
  private mapW = 0;
  private mapH = 0;
  private cursorPos: { x: number; y: number } | null = null;

  constructor() {
    this.overlay.className = 'craft-overlay';
    this.mainCanvas.className = 'craft-canvas';
    this.order = store.currentOrder!;
    this.el = h('div', { class: 'page' });
    void this.init();
  }

  private async init(): Promise<void> {
    const dims = mapDimensions(this.order.widthM, this.order.depthM);
    this.mapW = dims.w; this.mapH = dims.h;
    const [height, type, direction] = await Promise.all([
      mapCanvas(this.order.heightMap), mapCanvas(this.order.typeMap), mapCanvas(this.order.directionMap),
    ]);
    this.cvs = { height, type, direction };
    this.render();
    this.composite();
  }

  private modes: { id: BrushMode; label: string; tip: string }[] = [
    { id: 'height', label: '加高绒', tip: '刷出高绒区域' },
    { id: 'low', label: '压低绒', tip: '刷出低绒区域' },
    { id: 'cut', label: '割绒', tip: '直立长绒' },
    { id: 'loop', label: '圈绒', tip: '拱形短绒' },
    { id: 'direction', label: '顺毛刷', tip: '按拖动方向改变绒向' },
    { id: 'footprint', label: '脚印压痕', tip: '压倒伏绒毛' },
    { id: 'erase', label: '擦除压痕', tip: '恢复绒毛直立' },
  ];

  private render(): void {
    const o = this.order;
    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, '绒面工艺'), h('p', { class: 'page-desc' }, '在毯面上直接绘制绒高、割/圈绒、绒向和压痕，绘制结果同步到三维预览。')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => this.resetMaps() }, '重置工艺图'),
        h('button', { class: 'btn primary', onclick: () => this.flush(true) }, '保存并应用'),
      ),
    );

    const modeBtns = this.modes.map((m) =>
      h('button', {
        class: 'mode-btn' + (this.mode === m.id ? ' active' : ''),
        title: m.tip,
        onclick: () => { this.mode = m.id; this.render(); },
      }, m.label),
    );

    const brushPanel = h('div', { class: 'panel craft-tools' },
      h('h3', {}, '笔刷'),
      h('div', { class: 'mode-grid' }, ...modeBtns),
      slider({
        label: '笔刷大小', min: 6, max: 120, step: 1, value: this.radius, suffix: 'px',
        onInput: (v) => { this.radius = v; },
      }),
      h('h3', { style: 'margin-top:16px' }, '工艺参数'),
      slider({
        label: '割绒绒高', min: 4, max: 30, step: 0.5, value: o.pile.pileHeight, suffix: 'mm',
        onInput: (v) => this.patchPile({ pileHeight: v }),
      }),
      slider({
        label: '圈绒绒高', min: 2, max: 18, step: 0.5, value: o.pile.loopHeight, suffix: 'mm',
        onInput: (v) => this.patchPile({ loopHeight: v }),
      }),
      slider({
        label: '纤维密度', min: 6, max: 40, step: 1, value: o.pile.density, suffix: '根/cm²',
        onInput: (v) => this.patchPile({ density: v }),
      }),
      slider({
        label: '默认割绒占比', min: 0, max: 1, step: 0.05, value: o.pile.cutRatio,
        onInput: (v) => this.patchPile({ cutRatio: v }),
      }),
      slider({
        label: '顺逆毛色差', min: 0, max: 1, step: 0.05, value: o.pile.napStrength,
        onInput: (v) => this.patchPile({ napStrength: v }),
      }),
      h('div', { class: 'seg-group' },
        ...(Object.keys(MATERIAL_LABEL) as (keyof typeof MATERIAL_LABEL)[]).map((m) =>
          h('button', {
            class: 'seg-btn' + (o.pile.material === m ? ' active' : ''),
            onclick: () => this.patchPile({ material: m }),
          }, MATERIAL_LABEL[m])),
      ),
      h('div', { class: 'legend' },
        h('h4', {}, '图层说明'),
        h('div', { class: 'legend-row' }, h('span', { class: 'legend-dot', style: 'background:#fff' }), '绒高图（越亮越高）'),
        h('div', { class: 'legend-row' }, h('span', { class: 'legend-dot', style: 'background:#b53' }), '割绒 / 圈绒区域'),
        h('div', { class: 'legend-row' }, h('span', { class: 'legend-dot', style: 'background:#37c' }), '绒向（箭头）与压痕（红色）'),
      ),
    );

    // 画布尺寸按地图比例适配容器
    const maxW = 760;
    const scale = Math.min(1, maxW / this.mapW);
    this.mainCanvas.width = this.mapW;
    this.mainCanvas.height = this.mapH;
    this.mainCanvas.style.width = this.mapW * scale + 'px';
    this.mainCanvas.style.height = this.mapH * scale + 'px';
    this.overlay.width = this.mapW;
    this.overlay.height = this.mapH;
    this.overlay.style.width = this.mapW * scale + 'px';
    this.overlay.style.height = this.mapH * scale + 'px';

    this.mainCanvas.onpointerdown = (e) => {
      this.painting = true; this.last = null; this.stroke(e);
      this.mainCanvas.setPointerCapture(e.pointerId);
    };
    this.mainCanvas.onpointermove = (e) => {
      this.cursorPos = this.canvasPos(e);
      if (this.painting) this.stroke(e);
      this.drawCursor();
    };
    this.mainCanvas.onpointerup = () => this.onUp();
    this.mainCanvas.onpointerleave = () => { this.cursorPos = null; this.composite(); };

    const stage = h('div', { class: 'panel craft-stage' },
      h('h3', {}, `工艺绘制（${this.mapW}×${this.mapH}）`),
      h('div', { class: 'canvas-stack', style: `width:${this.mapW * scale}px;height:${this.mapH * scale}px` },
        this.mainCanvas, this.overlay),
      h('p', { class: 'hint' }, '拖动绘制；「顺毛刷」按鼠标拖动方向改变绒向，「脚印」压倒伏绒毛，三维预览中侧光下可见深浅变化。'),
    );

    this.el.innerHTML = '';
    this.el.append(head, h('div', { class: 'two-col craft-layout' }, brushPanel, stage));
  }

  private onUp = () => {
    this.painting = false;
    this.last = null;
    this.flush(false);
  };

  private canvasPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.mainCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.mapW,
      y: ((e.clientY - rect.top) / rect.height) * this.mapH,
    };
  }

  private stroke(e: PointerEvent): void {
    if (!this.cvs) return;
    const pos = this.canvasPos(e);
    const r = this.radius;
    const { height, type, direction } = this.cvs;
    let dirVec: [number, number] = [1, 0];
    if (this.mode === 'direction' && this.last) {
      const dx = pos.x - this.last.x, dy = pos.y - this.last.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.01) dirVec = [dx / len, dy / len];
    }
    const mode = this.mode;
    paintStroke(height, this.last, pos, r, (x, y, f, idx, d) => {
      if (mode === 'height') d[idx] = Math.min(255, d[idx] + 90 * f);
      if (mode === 'low') d[idx] = Math.max(20, d[idx] - 110 * f);
    });
    paintStroke(type, this.last, pos, r, (x, y, f, idx, d) => {
      if (mode === 'cut') { const v = Math.round(d[idx] * (1 - f) + 255 * f); d[idx] = d[idx + 1] = d[idx + 2] = v; }
      if (mode === 'loop') { const v = Math.round(d[idx] * (1 - f) + 0 * f); d[idx] = d[idx + 1] = d[idx + 2] = v; }
    });
    paintStroke(direction, this.last, pos, r, (x, y, f, idx, d) => {
      if (mode === 'direction') {
        const [er, eg] = encodeDirection(dirVec[0], dirVec[1]);
        d[idx] = Math.round(d[idx] * (1 - f) + er * f);
        d[idx + 1] = Math.round(d[idx + 1] * (1 - f) + eg * f);
      } else if (mode === 'footprint') {
        d[idx + 2] = Math.min(255, d[idx + 2] + 200 * f);
      } else if (mode === 'erase') {
        d[idx + 2] = Math.max(0, d[idx + 2] - 220 * f);
      }
    });
    this.last = pos;
    this.compositeThrottled();
    this.scheduleSave();
  }

  private compositeRaf = 0;
  private compositeThrottled(): void {
    if (this.compositeRaf) return;
    this.compositeRaf = requestAnimationFrame(() => {
      this.compositeRaf = 0;
      this.composite();
    });
  }

  dispose(): void {
    clearTimeout(this.saveTimer);
    if (this.compositeRaf) cancelAnimationFrame(this.compositeRaf);
  }

  /** 合成三图到主画布供编辑查看 */
  private composite(): void {
    if (!this.cvs) return;
    const { height, type, direction } = this.cvs;
    const ctx = this.mainCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, this.mapW, this.mapH);
    // 底：绒高灰度
    ctx.drawImage(height, 0, 0);
    // 割圈叠加：圈绒蓝色半透明
    const tCopy = document.createElement('canvas');
    tCopy.width = this.mapW; tCopy.height = this.mapH;
    tCopy.getContext('2d')!.drawImage(type, 0, 0);
    const tCtx2 = tCopy.getContext('2d', { willReadFrequently: true })!;
    const td = tCtx2.getImageData(0, 0, this.mapW, this.mapH);
    for (let i = 0; i < this.mapW * this.mapH; i++) {
      const cut = td.data[i * 4] / 255;
      td.data[i * 4] = Math.round(60 * (1 - cut));
      td.data[i * 4 + 1] = Math.round(110 * (1 - cut));
      td.data[i * 4 + 2] = Math.round(190 * (1 - cut));
      td.data[i * 4 + 3] = Math.round(150 * (1 - cut));
    }
    tCtx2.putImageData(td, 0, 0);
    ctx.drawImage(tCopy, 0, 0);
    // 压痕红色 + 方向箭头
    const dd = direction.getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, this.mapW, this.mapH);
    const octx = this.overlay.getContext('2d', { willReadFrequently: true })!;
    octx.clearRect(0, 0, this.mapW, this.mapH);
    const crush = document.createElement('canvas');
    crush.width = this.mapW; crush.height = this.mapH;
    const cctx = crush.getContext('2d')!;
    const cd = cctx.createImageData(this.mapW, this.mapH);
    for (let i = 0; i < this.mapW * this.mapH; i++) {
      const b = dd.data[i * 4 + 2];
      cd.data[i * 4] = 220; cd.data[i * 4 + 1] = 60; cd.data[i * 4 + 2] = 40;
      cd.data[i * 4 + 3] = Math.round(b * 0.75);
    }
    cctx.putImageData(cd, 0, 0);
    octx.drawImage(crush, 0, 0);
    // 稀疏方向箭头
    const step = Math.max(24, Math.round(this.mapW / 22));
    octx.strokeStyle = 'rgba(20,40,80,0.55)';
    octx.fillStyle = 'rgba(20,40,80,0.55)';
    octx.lineWidth = 1.4;
    for (let y = step / 2; y < this.mapH; y += step) {
      for (let x = step / 2; x < this.mapW; x += step) {
        const i = (Math.floor(y) * this.mapW + Math.floor(x)) * 4;
        const [dx, dy] = decodeDirection(dd.data[i], dd.data[i + 1]);
        const len = step * 0.34;
        const ex = x + dx * len, ey = y + dy * len;
        octx.beginPath(); octx.moveTo(x - dx * len * 0.5, y - dy * len * 0.5);
        octx.lineTo(ex, ey); octx.stroke();
        const a = Math.atan2(dy, dx);
        octx.beginPath();
        octx.moveTo(ex, ey);
        octx.lineTo(ex - 5 * Math.cos(a - 0.45), ey - 5 * Math.sin(a - 0.45));
        octx.lineTo(ex - 5 * Math.cos(a + 0.45), ey - 5 * Math.sin(a + 0.45));
        octx.closePath(); octx.fill();
      }
    }
  }

  private drawCursor(): void {
    const pos = this.cursorPos;
    if (!pos) return;
    const ctx = this.overlay.getContext('2d')!;
    // 仅重绘箭头层：保留 composite 内容较麻烦，直接整体重绘
    this.composite();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, this.radius + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(false), 600);
  }

  /** 把画布写回订单并持久化；geometryChanged 表示密度/尺寸变化需重建实例 */
  private flush(geometryChanged: boolean): void {
    if (!this.cvs) return;
    clearTimeout(this.saveTimer);
    store.updateOrder(this.order.id, {
      heightMap: this.cvs.height.toDataURL('image/png'),
      typeMap: this.cvs.type.toDataURL('image/png'),
      directionMap: this.cvs.direction.toDataURL('image/png'),
    });
    this.order = store.currentOrder!;
    if (geometryChanged) this.patchPile({});
    window.dispatchEvent(new CustomEvent('craft-maps-updated', {
      detail: { orderId: this.order.id, geometryChanged },
    }));
  }

  private patchPile(patch: Partial<Order['pile']>): void {
    const densityChanged = patch.density !== undefined && patch.density !== this.order.pile.density;
    store.updateOrder(this.order.id, { pile: { ...this.order.pile, ...patch } });
    this.order = store.currentOrder!;
    if (densityChanged) {
      window.dispatchEvent(new CustomEvent('craft-maps-updated', {
        detail: { orderId: this.order.id, geometryChanged: true },
      }));
    }
  }

  private resetMaps(): void {
    if (!confirm('重置全部工艺图？绒高、割圈、绒向和压痕都会恢复默认。')) return;
    const maps = createDefaultMaps(this.order.widthM, this.order.depthM, this.order.pile.cutRatio);
    store.updateOrder(this.order.id, maps);
    this.order = store.currentOrder!;
    void this.init();
    window.dispatchEvent(new CustomEvent('craft-maps-updated', {
      detail: { orderId: this.order.id, geometryChanged: false },
    }));
  }
}
