import { h, slider, toast, toggle, select } from '../ui/dom';
import { navigate } from '../ui/router';
import { store } from '../state/store';
import { gridFromSpec } from '../core/grid';
import { RugRenderer } from '../render/RugRenderer';
import type { PreviewSpec, YarnType } from '../core/types';

const YARN_TEXT: Record<YarnType, string> = { wool: '羊毛', silk: '丝', woolSilk: '羊毛夹丝' };

export class PreviewPage {
  private renderer: RugRenderer | null = null;
  private canvas = document.createElement('canvas');
  private spec: PreviewSpec;
  private fpsBadge!: HTMLElement;
  private fpsTimer = 0;

  constructor(private root: HTMLElement) {
    this.spec = store.runtime!.preview;
    this.render();
    this.initGl();
  }

  private render(): void {
    this.root.replaceChildren();
    const side = h('div.sidebar', {});
    this.canvas.className = 'gl';
    const stage = h('div.stage', {}, [this.canvas]);

    side.append(
      h('div.section-title', {}, '纱线材质'),
      select('纱线类型',
        (Object.keys(YARN_TEXT) as YarnType[]).map((y) => ({ value: y, text: YARN_TEXT[y] })),
        this.spec.yarn, (v) => { this.spec.yarn = v as YarnType; this.sync(); }),
      h('div.callout', {}, '羊毛：绒面哑光各向异性 · 丝：柔和强高光 · 夹丝：换角度时夹丝纤维闪烁'),
    );

    const dye = this.spec.dyeLot;
    side.append(
      h('div.section-title', {}, '染缸批次色差'),
      toggle('启用横向色差条带', dye.enabled, (v) => { dye.enabled = v; this.sync(); }),
      slider('条带宽度', dye.bandHeight, 8, 200, 1, 'mm', (v) => { dye.bandHeight = v; this.sync(); }),
      slider('色差强度', dye.strength, 0, 1, 0.01, '', (v) => { dye.strength = v; this.sync(); }),
      slider('换缸起始行', dye.phase, 0, 200, 1, '行', (v) => { dye.phase = v; this.sync(); }),
      toggle('标注换缸行', this.spec.showDyeLines, (v) => { this.spec.showDyeLines = v; this.sync(); }),
    );

    side.append(
      h('div.section-title', {}, '侧光'),
      slider('方位角', this.spec.lightAzimuth, 0, 360, 1, '°', (v) => { this.spec.lightAzimuth = v; this.sync(); }),
      slider('仰角', this.spec.lightElevation, 5, 80, 1, '°', (v) => { this.spec.lightElevation = v; this.sync(); }),
      slider('光强', this.spec.lightIntensity, 0.3, 2, 0.01, '', (v) => { this.spec.lightIntensity = v; this.sync(); }),
    );

    side.append(
      h('div.section-title', {}, '绒头渲染'),
      slider('壳层数', this.spec.shellLayers, 2, 24, 1, '层', (v) => { this.spec.shellLayers = v; this.sync(); }),
      slider('鳍片密度', this.spec.finDensity, 0.2, 2, 0.1, '×', (v) => { this.spec.finDensity = v; this.sync(); }),
    );

    side.append(
      h('div.section-title', {}, '展示方式'),
      h('div.btn-row', {}, [
        h('button.btn', { class: this.spec.scene === 'floor' ? 'btn primary' : 'btn', onClick: () => this.setScene('floor') }, '平铺地面'),
        h('button.btn', { class: this.spec.scene === 'wall' ? 'btn primary' : 'btn', onClick: () => this.setScene('wall') }, '挂墙'),
      ]),
      h('div.btn-row', {}, [
        h('button.btn', { onClick: () => this.toggleBack() },
          this.spec.showBack ? '返回正面' : '翻看背面结点'),
        h('button.btn', { onClick: () => this.renderer?.resetView() }, '复位视角'),
      ]),
      h('div.section-title', {}, '输出'),
      h('div.btn-row', {}, [
        h('button.btn.primary', { onClick: () => this.screenshot() }, '截图（带订单参数）'),
        h('button.btn', { onClick: () => navigate('orders') }, '回订单列表'),
      ]),
    );

    const hud = h('div.hud', {}, [
      h('div.badge', {}, ['拖转视角 · 滚轮缩放']),
      (this.fpsBadge = h('div.badge', {}, ['FPS ', h('b', {}, '--')])),
    ]);
    const info = h('div.hud.hud-right', {}, [
      h('div.badge', {}, this.orderBadgeText()),
    ]);
    stage.append(hud, info);
    this.root.append(side, stage);
  }

  private orderBadgeText(): string {
    const o = store.current!;
    const g = gridFromSpec(o.widthMm, o.heightMm, o.kpi);
    return `${o.name} · ${o.kpi}道 · ${g.cols}×${g.rows}结 · ${YARN_TEXT[this.spec.yarn]}`;
  }

  private setScene(scene: 'floor' | 'wall'): void {
    this.spec.scene = scene;
    this.sync();
    this.renderer?.orientCameraToScene();
    this.render();
    this.initGl();
  }

  private toggleBack(): void {
    this.spec.showBack = !this.spec.showBack;
    this.sync();
    this.renderer?.orientToBack(this.spec.showBack);
  }

  private initGl(): void {
    try {
      if (this.renderer) this.renderer.dispose();
      const blob = store.knotBlob;
      const hf = store.runtime!.heights;
      if (!blob || !hf) {
        toast('缺少结图或高度场，请先完成转换与剪花', 'error');
        return;
      }
      const g = gridFromSpec(store.current!.widthMm, store.current!.heightMm, store.current!.kpi);
      this.renderer = new RugRenderer(this.canvas, this.spec);
      this.renderer.setData({
        cols: g.cols, rows: g.rows, pitchX: g.pitchXMm, pitchY: g.pitchYMm,
        knots: blob.knots, heights: hf.heights, palette: store.palette,
      });
      this.renderer.orientCameraToScene();
      this.renderer.start();
      this.startFpsMeter();
    } catch (err) {
      toast('WebGL 初始化失败：' + (err as Error).message, 'error');
    }
  }

  private startFpsMeter(): void {
    clearInterval(this.fpsTimer);
    this.fpsTimer = window.setInterval(() => {
      if (this.renderer && this.fpsBadge) {
        this.fpsBadge.innerHTML = `FPS <b>${this.renderer.fps.toFixed(0)}</b>`;
      }
    }, 500);
  }

  private sync(): void {
    if (!this.renderer) return;
    this.renderer.spec = this.spec;
    store.runtime!.preview = this.spec;
  }

  private screenshot(): void {
    if (!this.renderer) return;
    const dataUrl = this.renderer.screenshot();
    const o = store.current!;
    // 订单参数条：画到截图底部
    const probe = document.createElement('canvas');
    const src = this.canvas;
    probe.width = src.width;
    probe.height = src.height + 92;
    const ctx = probe.getContext('2d')!;
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, probe.width, probe.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = '#e6e2d8';
      ctx.font = '26px sans-serif';
      ctx.fillText(`${o.name}｜客户 ${o.customer || '—'}｜${(o.widthMm / 1000).toFixed(2)}×${(o.heightMm / 1000).toFixed(2)}m｜${o.kpi} 道/英寸`, 18, src.height + 38);
      ctx.fillStyle = '#c8964e';
      ctx.font = '22px monospace';
      ctx.fillText(`纱线 ${YARN_TEXT[this.spec.yarn]}｜沟深 ${store.runtime!.carve.groove.depth}mm｜染缸条带 ${this.spec.dyeLot.enabled ? this.spec.dyeLot.bandHeight + 'mm/强度' + this.spec.dyeLot.strength : '关'}｜${new Date().toLocaleString('zh-CN')}`, 18, src.height + 74);
      probe.toBlob((blob) => {
        const url = URL.createObjectURL(blob!);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${o.name}-绒面截图.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast('截图已保存（含订单参数）', 'ok');
      });
    };
    img.src = dataUrl;
  }
}
