import { h, slider, toast, toggle, numberField } from '../ui/dom';
import { navigate } from '../ui/router';
import { store, DEFAULT_CARVE } from '../state/store';
import { gridFromSpec } from '../core/grid';
import { auditGrooveDepth, buildHeightField, measureSection } from '../core/carving';
import type { CarveSpec, HeightField } from '../core/types';

export class CarvePage {
  private spec: CarveSpec;
  private hf: HeightField | null = null;
  private sectionCanvas = document.createElement('canvas');
  private heatCanvas = document.createElement('canvas');
  private sectionRow = 0;
  private auditBox!: HTMLElement;

  constructor(private root: HTMLElement) {
    this.spec = store.runtime?.carve ?? structuredClone(DEFAULT_CARVE);
    this.hf = store.runtime?.heights ?? null;
    this.render();
    if (this.hf) this.refreshViews();
  }

  private get grid() {
    const o = store.current!;
    return gridFromSpec(o.widthMm, o.heightMm, o.kpi);
  }

  private render(): void {
    this.root.replaceChildren();
    const side = h('div.sidebar', {});
    const stage = h('div.stage', { style: { padding: '16px', overflowY: 'auto' } });

    side.append(h('div.section-title', {}, '绒头基准'));
    side.append(numberField('基准绒高', this.spec.basePile, 'mm', (v) => { this.spec.basePile = v; this.scheduleRebuild(); }));

    const g = this.spec.groove;
    side.append(
      h('div.section-title', {}, '片剪斜沟'),
      toggle('启用片剪沟', g.enabled, (v) => { g.enabled = v; this.scheduleRebuild(); }),
      slider('沟深', g.depth, 0, Math.max(6, this.spec.basePile - 1), 0.1, 'mm', (v) => { g.depth = v; this.scheduleRebuild(); }),
      slider('沟宽（单侧）', g.width, 1, 12, 0.1, 'mm', (v) => { g.width = v; this.scheduleRebuild(); }),
      slider('沟坡斜度', g.slope, 0, 1, 0.01, '', (v) => { g.slope = v; this.scheduleRebuild(); }),
      toggle('仅色号边界剪沟', g.colorBoundaryOnly, (v) => { g.colorBoundaryOnly = v; this.scheduleRebuild(); }),
    );

    // 高低绒浮雕：按使用中的色号列规则
    side.append(h('div.section-title', {}, '高低绒浮雕'));
    const reliefList = h('div', {});
    this.buildReliefList(reliefList);
    side.append(reliefList);

    side.append(
      h('div.section-title', {}, '物理校验'),
      (this.auditBox = h('div.callout', {}, '生成高度场后自动校验沟深')),
      h('div.btn-row', {}, [
        h('button.btn.primary', { onClick: () => this.rebuild() }, '生成高度场'),
        h('button.btn', { onClick: () => this.goPreview() }, '去绒面预览'),
      ]),
    );

    // 右侧：高度场热力图 + 剖面图
    this.heatCanvas.className = 'section-canvas';
    this.heatCanvas.style.maxHeight = '46%';
    this.sectionCanvas.className = 'section-canvas';
    this.sectionCanvas.style.maxHeight = '46%';
    const rowSlider = slider('剖面测量行', 0, 0, this.grid.rows - 1, 1, '', (v) => {
      this.sectionRow = v;
      this.drawSection();
    });
    stage.append(
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' } }, [
        h('div', {}, [h('div.progress-label', { style: { marginBottom: '6px' } }, '高度场热力图（深色=沟底，亮色=高绒）'), this.heatCanvas]),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, [
          h('div.progress-label', { style: { marginBottom: '6px' } }, '侧面剖开剖面（横轴 mm，纵轴绒高 mm）'),
          rowSlider,
          this.sectionCanvas,
        ]),
      ]),
    );
    this.root.append(side, stage);
  }

  private buildReliefList(container: HTMLElement): void {
    container.replaceChildren();
    const used = new Set(store.runtime!.knots);
    const palette = store.palette;
    for (let idx = 0; idx < palette.length; idx++) {
      if (!used.has(idx)) continue;
      const c = palette[idx];
      const rule = this.spec.relief.find((r) => r.colorId === c.id);
      const offset = rule?.offset ?? 0;
      const val = h('span.val', {}, `${offset}mm`);
      container.append(h('div.swatch-row', {}, [
        h('span.swatch', { style: { background: `rgb(${c.r},${c.g},${c.b})` } }),
        h('span.code', {}, c.code),
        h('span.name', {}, c.name),
        h('input', {
          type: 'range', min: -4, max: 6, step: 0.1, value: offset,
          style: { flex: 1, accentColor: 'var(--accent)' },
          onInput: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            val.textContent = `${v}mm`;
            const existing = this.spec.relief.find((r) => r.colorId === c.id);
            if (existing) existing.offset = v;
            else this.spec.relief.push({ colorId: c.id, offset: v });
            this.scheduleRebuild();
          },
        }),
        val,
      ]));
    }
  }

  private rebuildTimer = 0;
  private scheduleRebuild(): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 220);
  }

  private async rebuild(): Promise<void> {
    if (!store.runtime?.knots.length) { toast('缺少结图数据'); return; }
    const g = this.grid;
    const blob = store.knotBlob!;
    this.hf = buildHeightField({
      cols: g.cols, rows: g.rows, pitchXMm: g.pitchXMm, pitchYMm: g.pitchYMm,
      spec: this.spec, knots: blob.knots, paletteIds: blob.paletteIds,
    });
    store.runtime.heights = this.hf;
    store.runtime.carve = this.spec;
    await store.saveHeightField(this.hf);
    const o = store.current!;
    o.status = 'carved';
    await store.upsertOrder(o);
    this.refreshViews();
    toast('高度场已生成并保存', 'ok');
  }

  private refreshViews(): void {
    this.drawHeatmap();
    this.drawSection();
    this.runAudit();
  }

  private drawHeatmap(): void {
    if (!this.hf) return;
    const { cols, rows, heights } = this.hf;
    const cv = this.heatCanvas;
    cv.width = cols;
    cv.height = rows;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    let min = Infinity, max = 0;
    for (const v of heights) { if (v < min) min = v; if (v > max) max = v; }
    const range = Math.max(0.001, max - min);
    for (let i = 0; i < heights.length; i++) {
      const t = (heights[i] - min) / range;
      // 深蓝沟底 -> 驼色高绒
      img.data[i * 4] = 30 + t * 200;
      img.data[i * 4 + 1] = 36 + t * 150;
      img.data[i * 4 + 2] = 48 + t * 70;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  private drawSection(): void {
    if (!this.hf || !store.knotBlob) return;
    const g = this.grid;
    const row = Math.min(this.sectionRow, g.rows - 1);
    const { samples, measuredDepth } = measureSection(this.hf, store.knotBlob.knots, g.pitchXMm, row);
    const cv = this.sectionCanvas;
    const W = 900, H = 260;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    const maxH = Math.max(...samples.map((s) => s.heightMm)) * 1.15;
    const padL = 48, padB = 30, padT = 14;
    const xScale = (W - padL - 10) / samples[samples.length - 1].xMm;
    const yScale = (H - padB - padT) / maxH;
    // 网格与坐标
    ctx.strokeStyle = '#2a3038';
    ctx.fillStyle = '#8a939e';
    ctx.font = '10px monospace';
    for (let mm = 0; mm <= maxH; mm += 2) {
      const y = H - padB - mm * yScale;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 10, y); ctx.stroke();
      ctx.fillText(`${mm}mm`, 6, y + 3);
    }
    // 填充绒高剖面，颜色按色号
    const palette = store.palette;
    ctx.beginPath();
    ctx.moveTo(padL, H - padB);
    for (const s of samples) ctx.lineTo(padL + s.xMm * xScale, H - padB - s.heightMm * yScale);
    ctx.lineTo(padL + samples[samples.length - 1].xMm * xScale, H - padB);
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,150,78,.25)';
    ctx.fill();
    ctx.strokeStyle = '#d8a85e';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = padL + s.xMm * xScale, y = H - padB - s.heightMm * yScale;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    // 标注最深沟
    let minS = samples[0];
    for (const s of samples) if (s.heightMm < minS.heightMm) minS = s;
    const mx = padL + minS.xMm * xScale, my = H - padB - minS.heightMm * yScale;
    ctx.fillStyle = '#e06a5c';
    ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6e2d8';
    ctx.fillText(`实测最大落差 ${measuredDepth.toFixed(2)}mm（设定 ${this.spec.groove.enabled ? this.spec.groove.depth.toFixed(1) : '0'}mm）`, mx + 8, my - 6);
    ctx.fillStyle = '#8a939e';
    ctx.fillText(`第 ${row} 行 · 毯宽方向位置 (mm)`, W / 2 - 90, H - 8);
  }

  private runAudit(): void {
    if (!this.hf) return;
    const audit = auditGrooveDepth(this.hf, this.spec);
    this.auditBox.className = `callout ${audit.ok ? 'ok' : 'warn'}`;
    this.auditBox.innerHTML = audit.setting === 0
      ? '未启用片剪沟，当前为平绒高度场。'
      : `设定沟深 <code>${audit.setting.toFixed(2)} mm</code> · 高度场实测最大落差 <code>${audit.measuredMax.toFixed(2)} mm</code><br>容差 ±${audit.toleranceMm}mm（一个结距量化误差）· ${audit.ok ? '<b style="color:var(--ok)">物理一致 ✓</b>' : '<b style="color:var(--danger)">超出容差，请检查浮雕叠加</b>'}`;
  }

  private goPreview(): void {
    if (!this.hf) { toast('请先生成高度场'); return; }
    navigate('preview');
  }
}
