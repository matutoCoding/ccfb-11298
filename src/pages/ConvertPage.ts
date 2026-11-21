import { h, toast } from '../ui/dom';
import { navigate } from '../ui/router';
import { store } from '../state/store';
import { gridFromSpec } from '../core/grid';
import { convertDesign, generateSampleDesign, mergeColor } from '../core/conversion';
import { closeColorPairs, deltaE } from '../core/color';
import type { ConversionResult, PaletteColor } from '../core/types';

export class ConvertPage {
  private sourceImage: HTMLImageElement | HTMLCanvasElement | null = null;
  private result: ConversionResult | null = null;
  private knots: Uint16Array = new Uint16Array(0);
  private previewCanvas: HTMLCanvasElement = document.createElement('canvas');
  private showJagged = true;
  private showRegions = true;

  constructor(private root: HTMLElement) {
    this.render();
    if (store.knotBlob) this.loadFromStore();
  }

  private loadFromStore(): void {
    const blob = store.knotBlob!;
    this.knots = blob.knots;
    this.result = {
      cols: blob.cols, rows: blob.rows, paletteIds: blob.paletteIds,
      jagged: blob.jagged, jaggedCount: blob.jagged.reduce((s, v) => s + v, 0),
      knotCounts: {}, regionList: [], cornerAligned: true,
    };
    this.drawKnotPreview();
  }

  private render(): void {
    this.root.replaceChildren();
    const side = h('div.sidebar', {});
    const stage = h('div.stage', {}, [
      h('div.knot-canvas-wrap', { style: { height: '100%', display: 'flex', 'align-items': 'center', 'justify-content': 'center' } },
        [this.previewCanvas]),
    ]);
    this.previewCanvas.className = 'section-canvas';
    this.previewCanvas.style.maxWidth = '100%';
    this.previewCanvas.style.maxHeight = '100%';

    side.append(
      h('div.section-title', {}, '设计稿输入'),
      h('div.btn-row', {}, [
        h('button.btn.primary', { onClick: () => this.fileInput.click() }, '导入设计稿'),
        h('button.btn', { onClick: () => this.useSample() }, '用示例花型'),
      ]),
    );
    this.fileInput = h('input', {
      type: 'file', accept: 'image/*', style: { display: 'none' },
      onChange: (e: Event) => this.onFile(e),
    }) as HTMLInputElement;
    side.append(this.fileInput);

    // 道数与网格信息
    const o = store.current!;
    const gridInfo = h('div.callout', {}, '');
    const refreshGrid = () => {
      const g = gridFromSpec(o.widthMm, o.heightMm, o.kpi);
      gridInfo.innerHTML = `道数 <code>${o.kpi} 结/英寸</code> · 结间距 <code>${g.pitchXMm.toFixed(3)} mm</code><br>结网格 <code>${g.cols} × ${g.rows}</code> · 共 <code>${(g.cols * g.rows / 10000).toFixed(1)} 万结</code>`;
    };
    refreshGrid();
    side.append(h('div.section-title', {}, '结点精度换算'), gridInfo);
    const kpiInput = h('input', {
      type: 'number', value: o.kpi, min: 40, max: 200,
      onChange: async (e: Event) => {
        o.kpi = Number((e.target as HTMLInputElement).value);
        await store.upsertOrder(o);
        refreshGrid();
      },
    });
    side.append(h('label.ctl', {}, [h('span.lbl', {}, '改道数重算'), kpiInput, h('span.unit', {}, 'kpi')]));

    // 转换按钮 + 进度
    const progressBar = h('div.progress-bar', {});
    const progressLabel = h('div.progress-label', {}, '');
    side.append(
      h('div.btn-row', {}, [
        h('button.btn.primary', { onClick: () => this.runConvert(progressBar, progressLabel) }, '开始转结图'),
      ]),
      h('div.progress-wrap', {}, [progressBar]),
      progressLabel,
    );

    // 显示开关
    side.append(
      h('div.section-title', {}, '结图标注'),
      h('label.ctl.toggle', {}, [h('span.lbl', {}, '高亮锯齿风险'), h('input', {
        type: 'checkbox', checked: this.showJagged,
        onChange: (e: Event) => { this.showJagged = (e.target as HTMLInputElement).checked; this.drawKnotPreview(); },
      })]),
      h('label.ctl.toggle', {}, [h('span.lbl', {}, '显示区域分解'), h('input', {
        type: 'checkbox', checked: this.showRegions,
        onChange: (e: Event) => { this.showRegions = (e.target as HTMLInputElement).checked; this.drawKnotPreview(); },
      })]),
    );

    // 色差与合并面板（转换后填充）
    this.mergePanel = h('div', {});
    side.append(h('div.section-title', {}, '色卡量化与合并'), this.mergePanel);
    side.append(
      h('div.section-title', {}, '上机输出'),
      h('div.btn-row', {}, [
        h('button.btn.primary', { onClick: () => this.confirmAndGo() }, '定版并去剪花'),
      ]),
    );

    this.root.append(side, stage);
    this.refreshMergePanel();
  }

  private fileInput!: HTMLInputElement;
  private mergePanel!: HTMLElement;

  private onFile(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this.sourceImage = img;
      store.current!.designName = file.name;
      store.upsertOrder(store.current!);
      toast('设计稿已载入', 'ok');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  private useSample(): void {
    const g = gridFromSpec(store.current!.widthMm, store.current!.heightMm, store.current!.kpi);
    this.sourceImage = generateSampleDesign(g.cols, g.rows);
    store.current!.designName = '内置示例团花';
    store.upsertOrder(store.current!);
    toast('已生成示例花型', 'ok');
  }

  private async runConvert(bar: HTMLElement, label: HTMLElement): Promise<void> {
    if (!this.sourceImage) {
      // 未导入时自动用示例，保证流程可演示
      this.useSample();
      await new Promise((r) => setTimeout(r, 60));
    }
    const o = store.current!;
    const g = gridFromSpec(o.widthMm, o.heightMm, o.kpi);
    try {
      const out = await convertDesign(this.sourceImage!, {
        cols: g.cols, rows: g.rows, palette: store.palette, dEThreshold: 6,
        onProgress: (p, text) => {
          bar.style.width = `${Math.round(p * 100)}%`;
          label.textContent = `${text} ${Math.round(p * 100)}%`;
        },
      });
      this.result = out.result;
      this.knots = out.knots;
      await store.saveKnotData({
        cols: g.cols, rows: g.rows, paletteIds: out.result.paletteIds,
        knots: out.knots, jagged: out.result.jagged,
      });
      o.status = 'converted';
      await store.upsertOrder(o);
      label.textContent = `完成：最大 ΔE ${out.maxDE.toFixed(1)}，超阈值结 ${out.overThreshold} 个，锯齿风险 ${out.result.jaggedCount} 结`;
      toast('结图转换完成', 'ok');
      this.drawKnotPreview();
      this.refreshMergePanel();
    } catch (err) {
      toast('转换失败：' + (err as Error).message, 'error');
    }
  }

  /** 2D 画布逐结上色，锯齿结描红边，区域画框 */
  private drawKnotPreview(): void {
    if (!this.result || !this.knots.length) return;
    const { cols, rows } = this.result;
    const cv = this.previewCanvas;
    cv.width = cols;
    cv.height = rows;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    const palette = store.palette;
    for (let i = 0; i < this.knots.length; i++) {
      const c = palette[this.knots[i]];
      img.data[i * 4] = c.r;
      img.data[i * 4 + 1] = c.g;
      img.data[i * 4 + 2] = c.b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    if (this.showJagged) {
      ctx.fillStyle = 'rgba(255, 60, 40, 0.85)';
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (this.result.jagged[y * cols + x]) ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    if (this.showRegions && this.result.regionList.length) {
      ctx.lineWidth = Math.max(1, Math.min(cols, rows) / 400);
      for (const r of this.result.regionList) {
        const [x0, y0, x1, y1] = r.rect;
        ctx.strokeStyle = r.kind === 'center' ? '#6fa8c9' : r.kind === 'border' ? '#c8964e' : '#7fb069';
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  private refreshMergePanel(): void {
    const panel = this.mergePanel;
    if (!panel) return;
    panel.replaceChildren();
    if (!this.result) {
      panel.append(h('div.progress-label', {}, '转换后显示每色号结数与相近色合并建议'));
      return;
    }
    const palette = store.palette;
    // 每色号结数
    const counts = new Map<number, number>();
    for (const k of this.knots) counts.set(k, (counts.get(k) ?? 0) + 1);
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    panel.append(h('div.progress-label', { style: { marginBottom: '6px' } }, `实际使用 ${rows.length} 个色号`));
    for (const [idx, cnt] of rows) {
      const c = palette[idx];
      panel.append(h('div.swatch-row', {}, [
        h('span.swatch', { style: { background: `rgb(${c.r},${c.g},${c.b})` } }),
        h('span.code', {}, c.code),
        h('span.name', {}, c.name),
        h('span.cnt', {}, `${cnt} 结`),
      ]));
    }
    // 相近色对合并
    const used = rows.map(([idx]) => palette[idx]);
    const pairs = closeColorPairs(used as PaletteColor[], 8);
    if (pairs.length) {
      panel.append(h('div.section-title', { style: { marginTop: '12px' } }, '相近色手动合并'));
      for (const pair of pairs.slice(0, 8)) {
        const a = used[pair.a], b = used[pair.b];
        panel.append(h('div.swatch-row', {}, [
          h('span.swatch', { style: { background: `rgb(${a.r},${a.g},${a.b})` } }),
          h('span.code', {}, a.code),
          h('span', {}, '↔'),
          h('span.swatch', { style: { background: `rgb(${b.r},${b.g},${b.b})` } }),
          h('span.code', {}, b.code),
          h('span.cnt', {}, `ΔE ${pair.dE.toFixed(1)}`),
          h('button.btn', {
            style: { padding: '3px 8px' },
            onClick: () => this.doMerge(a.id, b.id),
          }, '合并'),
        ]));
      }
    }
  }

  private async doMerge(fromId: string, toId: string): Promise<void> {
    const merged = mergeColor(this.knots, this.result!.paletteIds, fromId, toId);
    this.knots = merged.knots;
    // 重新统计
    const counts: Record<string, number> = {};
    for (const k of this.knots) {
      const id = store.palette[k].id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    this.result!.knotCounts = counts;
    await store.saveKnotData({
      cols: this.result!.cols, rows: this.result!.rows,
      paletteIds: this.result!.paletteIds, knots: this.knots, jagged: this.result!.jagged,
    });
    toast(`已把 ${fromId} 并入 ${toId}`, 'ok');
    this.drawKnotPreview();
    this.refreshMergePanel();
  }

  private async confirmAndGo(): Promise<void> {
    if (!this.result) { toast('请先完成结图转换'); return; }
    const o = store.current!;
    o.status = 'converted';
    await store.upsertOrder(o);
    navigate('carve');
  }
}
