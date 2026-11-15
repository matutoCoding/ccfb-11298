// 三维预览页
import { store } from '../store';
import { el } from '../ui';
import { PreviewScene, BrushMode } from '../gl/previewScene';
import { LIGHT_PRESETS } from '../gl/room';
import { screenshotWithParams, calcUsage, showUsageModal } from '../export';

let scene: PreviewScene | null = null;
let fpsTimer: number | null = null;

export function destroyPreview() {
  scene?.stop();
  scene = null;
  if (fpsTimer !== null) { window.clearInterval(fpsTimer); fpsTimer = null; }
}

export function renderPreview(root: HTMLElement) {
  root.innerHTML = '';
  destroyPreview();
  const order = store.current();
  if (!order) {
    root.append(el('div', { class: 'empty' }, '请先在「订单」页新建或打开一个订单。'));
    return;
  }

  const canvas = el('canvas', { class: 'preview-canvas' }) as HTMLCanvasElement;
  const fpsEl = el('span', { class: 'fps' }, '');

  // ---------- 工具栏 ----------
  const toolbar = el('div', { class: 'toolbar' });
  const mkBrush = (id: BrushMode, label: string, title: string) => {
    const b = el('button', { class: 'btn tool' + (id === 'orbit' ? ' active' : ''), title }, label);
    b.addEventListener('click', () => {
      if (!scene) return;
      scene.brush = id;
      toolbar.querySelectorAll('.tool').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      canvas.style.cursor = id === 'orbit' ? 'grab' : 'crosshair';
    });
    return b;
  };
  toolbar.append(
    mkBrush('orbit', '旋转视角', '拖动旋转,滚轮缩放'),
    mkBrush('nap', '顺毛刷', '沿拖动方向倒伏绒毛'),
    mkBrush('footprint', '脚印', '压出脚印/踩踏痕迹'),
    mkBrush('erase', '恢复毛向', '恢复默认倒毛'),
  );

  const sizeLabel = el('span', { class: 'slider-label' }, '笔刷 30');
  const sizeSlider = el('input', { type: 'range', min: '8', max: '90', value: '30' }) as HTMLInputElement;
  sizeSlider.addEventListener('input', () => {
    if (scene) scene.brushSize = parseInt(sizeSlider.value);
    sizeLabel.textContent = `笔刷 ${sizeSlider.value}`;
  });

  const lightBar = el('div', { class: 'toolbar' });
  LIGHT_PRESETS.forEach((p, i) => {
    const b = el('button', { class: 'btn tool' + (i === 0 ? ' active' : '') }, p.name);
    b.addEventListener('click', () => {
      if (scene) { scene.lightIndex = i; }
      lightBar.querySelectorAll('.tool').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    lightBar.append(b);
  });
  const roomToggle = el('button', { class: 'btn tool active' }, '房间环境');
  roomToggle.addEventListener('click', () => {
    if (!scene) return;
    scene.roomVisible = !scene.roomVisible;
    roomToggle.classList.toggle('active', scene.roomVisible);
  });
  lightBar.append(roomToggle);

  const shotBtn = el('button', { class: 'btn primary' }, '截图(带参数)');
  shotBtn.addEventListener('click', () => {
    if (!scene || !order) return;
    const url = scene.screenshot();
    screenshotWithParams(url, order);
  });
  const usageBtn = el('button', { class: 'btn' }, '纱线用量清单');
  usageBtn.addEventListener('click', async () => {
    if (!order.pattern) { alert('请先在「图案」页导入并量化图案。'); return; }
    const rows = await calcUsage(order, store.settings);
    showUsageModal(rows, order);
  });

  root.append(
    el('div', { class: 'page-head' },
      el('h2', {}, `三维预览 — ${order.name}`),
      fpsEl,
    ),
    toolbar,
    el('div', { class: 'toolbar' }, sizeLabel, sizeSlider, lightBar),
    el('div', { class: 'preview-wrap' }, canvas),
    el('div', { class: 'toolbar' }, shotBtn, usageBtn,
      el('span', { class: 'hint' }, '拖动旋转 · 滚轮缩放 · 顺毛刷/脚印直接画在毯面上')),
  );

  try {
    scene = new PreviewScene(canvas, store.settings);
    scene.lightIndex = 0;
    scene.setOrder(order).then(() => scene?.start());
    scene.onMapSaved = () => {};
    (window as unknown as { __scene: PreviewScene }).__scene = scene; // 调试挂钩
  } catch (e) {
    root.append(el('div', { class: 'empty' }, String(e)));
    return;
  }

  fpsTimer = window.setInterval(() => {
    if (scene) fpsEl.textContent = `${scene.fps.toFixed(0)} fps · 壳层 ${store.settings.shellCount}`;
  }, 500);
}
