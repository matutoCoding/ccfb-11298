import type { FiberMaterial, LightPreset, Order } from '../types';
import { MATERIAL_LABEL } from '../types';
import { store } from '../core/store';
import { CarpetRenderer } from '../gl/renderer';
import { computeUsage, type UsageReport } from '../core/usage';
import { downloadText } from '../core/storage';
import { rgbToHex } from '../core/color';
import { downloadDataURL, fmt, h, slider, swatch } from '../ui/dom';

export class PreviewPage {
  el: HTMLElement;
  private order: Order;
  private renderer: CarpetRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private fpsLabel: HTMLElement;
  private report: UsageReport | null = null;
  private light: LightPreset;
  private mapHandler: (e: Event) => void;

  constructor() {
    this.order = store.currentOrder!;
    this.light = store.state.lightPresets[0];
    this.canvas = h('canvas', { class: 'gl-canvas' }) as HTMLCanvasElement;
    this.fpsLabel = h('span', { class: 'fps-label' }, '初始化中…');
    this.el = h('div', { class: 'page preview-page' });
    this.mapHandler = (e) => this.onCraftUpdate(e as CustomEvent);
    window.addEventListener('craft-maps-updated', this.mapHandler);
    this.render();
    void this.bootGL();
    void this.loadReport();
  }

  private async bootGL(): Promise<void> {
    try {
      const colors = store.paletteColors(this.order);
      this.renderer = new CarpetRenderer(this.canvas, store.state.settings, this.light);
      (window as unknown as { __renderer: CarpetRenderer }).__renderer = this.renderer;
      this.renderer.onFps = (fps, fibers) => {
        this.fpsLabel.textContent = `${fps} FPS · ${fibers.toLocaleString()} 根纤维`;
        this.fpsLabel.classList.toggle('bad', fps < 40);
      };
      await this.renderer.syncOrder(this.order, colors, true);
    } catch (err) {
      this.el.querySelector('.gl-stage')?.append(
        h('div', { class: 'gl-error' }, 'WebGL 初始化失败：' + (err instanceof Error ? err.message : String(err))),
      );
    }
  }

  private onCraftUpdate(e: CustomEvent): void {
    if (e.detail.orderId !== this.order.id || !this.renderer) return;
    const fresh = store.state.orders.find((o) => o.id === this.order.id);
    if (!fresh) return;
    this.order = fresh;
    if (e.detail.geometryChanged) {
      this.renderer.syncOrder(fresh, store.paletteColors(fresh), true);
    } else {
      this.renderer.syncOrder(fresh, store.paletteColors(fresh), false);
    }
  }

  private render(): void {
    const o = this.order;
    const head = h('div', { class: 'page-head compact' },
      h('div', {}, h('h2', {}, '三维预览'), h('p', { class: 'page-desc' }, `${o.name} · ${o.widthM}m × ${o.depthM}m · 绒高 ${o.pile.pileHeight}mm`)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => this.screenshot() }, '📷 截图（含订单参数）'),
        h('button', { class: 'btn primary', onclick: () => this.exportReport() }, '导出纱线用量清单'),
      ),
    );

    const lightBtns = store.state.lightPresets.map((p) =>
      h('button', {
        class: 'seg-btn' + (p.id === this.light.id ? ' active' : ''),
        onclick: () => { this.light = p; this.renderer?.applyLight(p); this.render(); },
      }, p.name),
    );

    const matBtns = (Object.keys(MATERIAL_LABEL) as FiberMaterial[]).map((m) =>
      h('button', {
        class: 'seg-btn' + (o.pile.material === m ? ' active' : ''),
        onclick: () => {
          store.updateOrder(o.id, { pile: { ...o.pile, material: m } });
          this.order = store.currentOrder!;
          this.render();
        },
      }, MATERIAL_LABEL[m]),
    );

    const panel = h('div', { class: 'panel preview-tools' },
      h('h3', {}, '室内光'),
      h('div', { class: 'seg-col' }, ...lightBtns),
      slider({
        label: '光源方位角', min: -90, max: 90, step: 1, value: this.light.azimuth, suffix: '°',
        onInput: (v) => this.tweakLight({ azimuth: v }),
      }),
      slider({
        label: '光源高度角', min: 5, max: 85, step: 1, value: this.light.elevation, suffix: '°',
        onInput: (v) => this.tweakLight({ elevation: v }),
      }),
      h('h3', { style: 'margin-top:14px' }, '材质'),
      h('div', { class: 'seg-col' }, ...matBtns),
      h('p', { class: 'hint' }, '丝：柔和双层高光；羊毛：绒感强、高光散；化纤：高光更锐更亮。'),
      h('h3', { style: 'margin-top:14px' }, '视角'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', onclick: () => this.renderer?.camera.frameRug(o.widthM, o.depthM) }, '复位视角'),
      ),
      h('h3', { style: 'margin-top:14px' }, '用量清单'),
      h('div', { class: 'usage-mini', id: 'usage-mini' }, '计算中…'),
    );

    const stage = h('div', { class: 'gl-stage panel' },
      this.canvas,
      h('div', { class: 'gl-hud' }, this.fpsLabel),
      h('div', { class: 'gl-hint' }, '左键旋转 · 滚轮缩放 · 右键平移'),
    );

    this.el.innerHTML = '';
    this.el.append(head, h('div', { class: 'preview-layout' }, stage, panel));
    this.renderUsageMini();
  }

  private tweakLight(patch: Partial<LightPreset>): void {
    this.light = { ...this.light, ...patch };
    this.renderer?.applyLight(this.light);
  }

  private async loadReport(): Promise<void> {
    this.report = await computeUsage(this.order, store.paletteColors(this.order));
    this.renderUsageMini();
  }

  private renderUsageMini(): void {
    const box = this.el.querySelector('#usage-mini');
    if (!box || !this.report) return;
    box.innerHTML = '';
    box.append(
      h('div', { class: 'muted small' },
        `总面积 ${fmt(this.report.totalAreaM2, 2)} m² · 估算总重 ${fmt(this.report.totalWeightG, 0)} g`),
      h('div', { class: 'usage-rows' },
        ...this.report.rows.slice(0, 6).map((r) =>
          h('div', { class: 'usage-row' },
            swatch(r.color.rgb),
            h('span', { class: 'usage-name' }, r.color.name),
            h('span', { class: 'usage-pct' }, fmt(r.areaPercent, 1) + '%'),
          )),
      ),
    );
  }

  private screenshot(): void {
    if (!this.renderer) return;
    const raw = this.renderer.screenshot();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height + 190;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#f7f5f1';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      // 参数条
      ctx.fillStyle = '#222';
      ctx.font = 'bold 30px sans-serif';
      const y0 = img.height + 42;
      ctx.fillText(`${this.order.name}${this.order.customer ? ' · ' + this.order.customer : ''}`, 28, y0);
      ctx.font = '22px sans-serif';
      ctx.fillStyle = '#555';
      const lines = [
        `尺寸 ${this.order.widthM}m × ${this.order.depthM}m ｜ 割绒高 ${this.order.pile.pileHeight}mm ｜ 圈绒高 ${this.order.pile.loopHeight}mm ｜ 密度 ${this.order.pile.density}根/cm²`,
        `材质 ${MATERIAL_LABEL[this.order.pile.material]} ｜ 光线 ${this.light.name} ｜ 截图时间 ${new Date().toLocaleString('zh-CN')}`,
      ];
      lines.forEach((line, i) => ctx.fillText(line, 28, y0 + 38 + i * 30));
      downloadDataURL(`${this.order.name}-预览截图.png`, c.toDataURL('image/png'));
    };
    img.src = raw;
  }

  private async exportReport(): Promise<void> {
    const report = await computeUsage(this.order, store.paletteColors(this.order));
    const lines: string[] = [];
    lines.push('纱线用量清单（估算）');
    lines.push('='.repeat(48));
    lines.push(`订单：${this.order.name}`);
    lines.push(`客户：${this.order.customer || '—'}`);
    lines.push(`尺寸：${this.order.widthM} m × ${this.order.depthM} m`);
    lines.push(`总面积：${fmt(report.totalAreaM2, 2)} m²`);
    lines.push(`材质：${MATERIAL_LABEL[this.order.pile.material]}　割绒高 ${this.order.pile.pileHeight}mm　圈绒高 ${this.order.pile.loopHeight}mm　密度 ${this.order.pile.density}根/cm²`);
    lines.push('-'.repeat(48));
    lines.push('颜色\tHEX\t面积m²\t占比%\t估算长度m\t估算重量g');
    for (const r of report.rows) {
      lines.push([
        r.color.name, rgbToHex(r.color.rgb), fmt(r.areaM2, 3), fmt(r.areaPercent, 2),
        fmt(r.lengthM, 1), fmt(r.weightG, 1),
      ].join('\t'));
    }
    lines.push('-'.repeat(48));
    lines.push(`合计估算重量：${fmt(report.totalWeightG, 1)} g`);
    lines.push('注：用量基于经验密度系数估算，量产前请以打样数据校准。');
    downloadText(`${this.order.name}-纱线用量清单.txt`, lines.join('\n'));
  }

  dispose(): void {
    window.removeEventListener('craft-maps-updated', this.mapHandler);
    this.renderer?.dispose();
    this.renderer = null;
  }
}
