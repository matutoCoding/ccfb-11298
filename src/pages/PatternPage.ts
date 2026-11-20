import type { Order, YarnColor } from '../types';
import { store } from '../core/store';
import { quantizeImage, loadImage } from '../core/maps';
import { rgbToHex } from '../core/color';
import { downloadText } from '../core/storage';
import { h, swatch } from '../ui/dom';

interface QStats { counts: Record<number, number>; total: number }

export class PatternPage {
  el: HTMLElement;
  private order: Order;
  private stats: QStats = { counts: {}, total: 0 };
  private selectedIdx = 0;
  private fileInput: HTMLInputElement;

  constructor() {
    this.order = store.currentOrder!;
    this.el = h('div', { class: 'page' });
    this.fileInput = h('input', {
      type: 'file', accept: 'image/png,image/jpeg', hidden: true,
      onchange: ((e: Event) => this.onFile(e.target as HTMLInputElement)) as EventListener,
    }) as HTMLInputElement;
    this.render();
    void this.loadStats();
  }

  private get colors(): YarnColor[] {
    return store.paletteColors(this.order);
  }

  private async loadStats(): Promise<void> {
    if (!this.order.quantizedImage) return;
    const img = await loadImage(this.order.quantizedImage);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const counts: Record<number, number> = {};
    for (let i = 0; i < c.width * c.height; i++) {
      const idx = d[i * 4];
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    this.stats = { counts, total: c.width * c.height };
    this.render();
  }

  private render(): void {
    const o = this.order;
    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, '图案编辑'), h('p', { class: 'page-desc' }, '导入 PNG 图案，按色板自动量化为纱线颜色，可手动合并或替换颜色。')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => this.fileInput.click() }, '导入 PNG'),
        h('button', { class: 'btn', onclick: () => this.requantize(), disabled: !o.patternImage }, '重新量化'),
      ),
    );

    const left = h('div', { class: 'panel' },
      h('h3', {}, '原图与量化结果'),
      h('div', { class: 'compare' },
        h('div', { class: 'compare-box' },
          h('div', { class: 'compare-title' }, '原始图案'),
          o.patternImage
            ? h('img', { class: 'pattern-img', src: o.patternImage })
            : h('div', { class: 'img-ph' }, '尚未导入图案'),
        ),
        h('div', { class: 'compare-box' },
          h('div', { class: 'compare-title' }, '纱线量化图'),
          o.quantizedImage
            ? h('img', { class: 'pattern-img', src: o.quantizedImage })
            : h('div', { class: 'img-ph' }, '导入后自动生成'),
        ),
      ),
      h('p', { class: 'hint' }, '量化采用 CIE Lab 感知色差，把每个像素映射到色板中最接近的纱线。量化图的红通道存储纱线索引。'),
    );

    const rows = this.colors.map((c, idx) => {
      const cnt = this.stats.counts[idx] ?? 0;
      const pct = this.stats.total ? (cnt / this.stats.total) * 100 : 0;
      const mappedId = o.colorMapping[idx];
      const mapped = this.colors.find((x) => x.id === mappedId);
      const unused = o.unusedColorIds.includes(c.id);
      const display = mapped ?? c;
      return h('div', {
        class: 'yarn-row' + (this.selectedIdx === idx ? ' selected' : '') + (unused ? ' unused' : ''),
        onclick: () => { this.selectedIdx = idx; this.render(); },
      },
        swatch(display.rgb),
        h('div', { class: 'yarn-info' },
          h('div', { class: 'yarn-name' }, `#${idx} ${display.name}`),
          h('div', { class: 'muted small' }, rgbToHex(display.rgb) + (mapped ? `（原：${c.name}）` : '')),
        ),
        h('div', { class: 'yarn-bar-wrap' },
          h('div', { class: 'yarn-bar', style: `width:${pct.toFixed(1)}%;background:rgb(${display.rgb.join(',')})` }),
          h('span', { class: 'yarn-pct' }, pct.toFixed(1) + '%'),
        ),
      );
    });

    const selColor = this.colors[this.selectedIdx];
    const right = h('div', { class: 'panel' },
      h('h3', {}, `纱线颜色（${this.colors.length} 色）`),
      h('div', { class: 'yarn-list' }, ...rows),
      h('div', { class: 'merge-box' },
        h('h4', {}, `对选中色 #${this.selectedIdx} ${selColor?.name ?? ''} 操作`),
        h('div', { class: 'btn-row wrap' },
          h('button', {
            class: 'btn sm', disabled: !selColor,
            onclick: () => this.mergeSelected(),
          }, '合并到另一色…'),
          h('button', {
            class: 'btn sm', disabled: !selColor,
            onclick: () => this.replaceSelected(),
          }, '替换为另一色…'),
          h('button', {
            class: 'btn sm', disabled: !selColor,
            onclick: () => this.renameColor(selColor),
          }, '重命名'),
          h('button', {
            class: 'btn sm danger', disabled: !selColor,
            onclick: () => this.removeColor(selColor),
          }, '从色板删除'),
        ),
        h('div', { class: 'btn-row wrap', style: 'margin-top:8px' },
          h('button', { class: 'btn sm', onclick: () => this.addColor() }, '色板新增颜色…'),
          h('button', { class: 'btn sm', onclick: () => this.exportReport() }, '导出量化数据 JSON'),
        ),
      ),
    );

    this.el.innerHTML = '';
    this.el.append(head, h('div', { class: 'two-col' }, left, right), this.fileInput);
  }

  private async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const src = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await loadImage(src);
    const q = quantizeImage(img, this.colors.map((c) => c.rgb));
    const mapping: Record<number, string> = {};
    for (const k of Object.keys(q.counts)) mapping[Number(k)] = this.colors[Number(k)].id;
    store.updateOrder(this.order.id, {
      patternImage: src,
      quantizedImage: q.dataURL,
      colorMapping: mapping,
      unusedColorIds: [],
    });
    this.order = store.currentOrder!;
    await this.loadStats();
  }

  private requantize(): void {
    if (!this.order.patternImage) return;
    void loadImage(this.order.patternImage).then((img) => {
      const q = quantizeImage(img, this.colors.map((c) => c.rgb));
      const mapping: Record<number, string> = {};
      for (const k of Object.keys(q.counts)) mapping[Number(k)] = this.colors[Number(k)].id;
      store.updateOrder(this.order.id, { quantizedImage: q.dataURL, colorMapping: mapping, unusedColorIds: [] });
      this.order = store.currentOrder!;
      void this.loadStats();
    });
  }

  private pickTarget(excludeIdx: number): number | null {
    const opts = this.colors
      .map((c, i) => `${i}: ${c.name} ${rgbToHex(c.rgb)}`)
      .filter((_, i) => i !== excludeIdx)
      .join('\n');
    const ans = prompt('选择目标颜色序号：\n' + opts);
    if (ans === null) return null;
    const idx = Number(ans);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.colors.length || idx === excludeIdx) {
      alert('序号无效');
      return null;
    }
    return idx;
  }

  /** 合并：把选中色的像素改写进目标色，并记录映射 */
  private async mergeSelected(): Promise<void> {
    const target = this.pickTarget(this.selectedIdx);
    if (target === null) return;
    await this.rewriteIndices((idx) => (idx === this.selectedIdx ? target : idx));
    const mapping = { ...this.order.colorMapping };
    mapping[this.selectedIdx] = this.colors[target].id;
    const unused = [...new Set([...this.order.unusedColorIds, this.colors[this.selectedIdx].id])];
    store.updateOrder(this.order.id, { colorMapping: mapping, unusedColorIds: unused });
    this.order = store.currentOrder!;
    await this.loadStats();
  }

  /** 替换：只换色板映射与 LUT，像素索引不动（渲染/用量直接走新颜色） */
  private replaceSelected(): void {
    const target = this.pickTarget(this.selectedIdx);
    if (target === null) return;
    const mapping = { ...this.order.colorMapping };
    mapping[this.selectedIdx] = this.colors[target].id;
    store.updateOrder(this.order.id, { colorMapping: mapping });
    this.order = store.currentOrder!;
    this.render();
  }

  private async rewriteIndices(fn: (idx: number) => number): Promise<void> {
    const q = this.order.quantizedImage;
    if (!q) return;
    const img = await loadImage(q);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < c.width * c.height; i++) {
      const nv = fn(data.data[i * 4]);
      data.data[i * 4] = nv;
      data.data[i * 4 + 1] = nv;
      data.data[i * 4 + 2] = nv;
    }
    ctx.putImageData(data, 0, 0);
    store.updateOrder(this.order.id, { quantizedImage: c.toDataURL('image/png') });
    this.order = store.currentOrder!;
  }

  private renameColor(c: YarnColor): void {
    const name = prompt('颜色名称', c.name);
    if (name) {
      store.updatePaletteColor(this.order.paletteId, c.id, { name });
      this.order = store.currentOrder!;
      this.render();
    }
  }

  private removeColor(c: YarnColor): void {
    if (!confirm(`从色板删除「${c.name}」？使用该色的索引将回退到色板同序号颜色。`)) return;
    store.removePaletteColor(this.order.paletteId, c.id);
    this.order = store.currentOrder!;
    this.selectedIdx = Math.min(this.selectedIdx, this.colors.length - 1);
    this.render();
  }

  private addColor(): void {
    const hex = prompt('新颜色 HEX（如 #c8a07a）', '#c8a07a');
    if (!hex) return;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) { alert('HEX 格式不正确'); return; }
    const n = parseInt(m[1], 16);
    const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const name = prompt('颜色名称', '自定义色') || '自定义色';
    store.addPaletteColor(this.order.paletteId, { name, rgb });
    this.order = store.currentOrder!;
    this.render();
  }

  private exportReport(): void {
    const rows = Object.entries(this.stats.counts).map(([idx, px]) => {
      const i = Number(idx);
      const c = this.colors[i];
      return {
        index: i,
        yarn: c?.name ?? `#${i}`,
        hex: c ? rgbToHex(c.rgb) : null,
        pixels: px,
        percent: this.stats.total ? (px / this.stats.total) * 100 : 0,
      };
    });
    downloadText(`${this.order.name}-量化数据.json`, JSON.stringify({
      order: this.order.name, size: [this.order.widthM, this.order.depthM], rows,
    }, null, 2));
  }
}
