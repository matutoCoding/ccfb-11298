// 绒面工艺页:俯视 2D 编辑绒高图与割绒/圈绒分区
import { store } from '../store';
import { el } from '../ui';
import { Order } from '../types';
import { loadImage } from '../gl/previewScene';

const MAP = 256;

type Tool = 'cut' | 'loop' | 'height' | 'erase';

export function renderCraft(root: HTMLElement) {
  root.innerHTML = '';
  const cur = store.current();
  if (!cur) {
    root.append(el('div', { class: 'empty' }, '请先在「订单」页新建或打开一个订单。'));
    return;
  }
  const order: Order = cur;

  // 编辑画布(离屏)
  const heightCv = document.createElement('canvas');
  const regionCv = document.createElement('canvas');
  heightCv.width = heightCv.height = MAP;
  regionCv.width = regionCv.height = MAP;
  const hctx = heightCv.getContext('2d', { willReadFrequently: true })!;
  const rctx = regionCv.getContext('2d', { willReadFrequently: true })!;
  hctx.fillStyle = '#ffffff';
  hctx.fillRect(0, 0, MAP, MAP);
  rctx.fillStyle = '#ffffff';
  rctx.fillRect(0, 0, MAP, MAP);

  let tool: Tool = 'cut';
  let brushSize = 24;
  let heightValue = 200; // 绒高刷强度 0-255
  let showLayer: 'mix' | 'height' | 'region' = 'mix';
  let patternImg: HTMLImageElement | null = null;
  let painting = false;

  // 载入已有数据
  const loads: Promise<void>[] = [];
  if (order.craft.heightMapUrl) {
    loads.push(loadImage(order.craft.heightMapUrl).then((img) => {
      hctx.drawImage(img, 0, 0, MAP, MAP);
    }).catch(() => {}));
  }
  if (order.craft.regionMapUrl) {
    loads.push(loadImage(order.craft.regionMapUrl).then((img) => {
      rctx.drawImage(img, 0, 0, MAP, MAP);
    }).catch(() => {}));
  }
  if (order.pattern?.indexedUrl) {
    loads.push(loadImage(order.pattern.indexedUrl).then((img) => { patternImg = img; }).catch(() => {}));
  }

  // ---------- 显示画布 ----------
  const view = el('canvas', { class: 'craft-canvas', width: '640', height: '640' }) as HTMLCanvasElement;
  const vctx = view.getContext('2d')!;

  function redraw() {
    const W = view.width;
    vctx.fillStyle = '#222';
    vctx.fillRect(0, 0, W, W);
    // 底:图案或灰底
    if (patternImg && showLayer === 'mix') {
      vctx.imageSmoothingEnabled = false;
      vctx.drawImage(patternImg, 0, 0, W, W);
    } else {
      vctx.fillStyle = '#3a3a3c';
      vctx.fillRect(0, 0, W, W);
    }
    // 形状遮罩提示
    vctx.save();
    vctx.beginPath();
    if (order.shape === 'rect') vctx.rect(0, 0, W, W);
    else { vctx.ellipse(W / 2, W / 2, W / 2, W / 2, 0, 0, Math.PI * 2); }
    vctx.clip();

    if (showLayer !== 'region') {
      // 绒高叠加:越矮越暗
      const hData = hctx.getImageData(0, 0, MAP, MAP).data;
      const overlay = vctx.createImageData(MAP, MAP);
      for (let i = 0; i < MAP * MAP; i++) {
        const h = hData[i * 4];
        const shade = 255 - h;
        overlay.data[i * 4] = 20;
        overlay.data[i * 4 + 1] = 20;
        overlay.data[i * 4 + 2] = 60;
        overlay.data[i * 4 + 3] = showLayer === 'height' ? 120 + shade / 3 : shade / 2;
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = MAP;
      tmp.getContext('2d')!.putImageData(overlay, 0, 0);
      vctx.drawImage(tmp, 0, 0, W, W);
    }
    if (showLayer !== 'height') {
      // 圈绒区域蓝色提示
      const rData = rctx.getImageData(0, 0, MAP, MAP).data;
      const overlay = vctx.createImageData(MAP, MAP);
      for (let i = 0; i < MAP * MAP; i++) {
        if (rData[i * 4] < 128) {
          overlay.data[i * 4] = 40;
          overlay.data[i * 4 + 1] = 120;
          overlay.data[i * 4 + 2] = 220;
          overlay.data[i * 4 + 3] = showLayer === 'region' ? 160 : 90;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = MAP;
      tmp.getContext('2d')!.putImageData(overlay, 0, 0);
      vctx.drawImage(tmp, 0, 0, W, W);
    }
    vctx.restore();
    // 形状外压暗
    if (order.shape !== 'rect') {
      vctx.save();
      vctx.beginPath();
      vctx.rect(0, 0, W, W);
      vctx.ellipse(W / 2, W / 2, W / 2, W / 2, 0, 0, Math.PI * 2, true);
      vctx.fillStyle = 'rgba(0,0,0,0.55)';
      vctx.fill();
      vctx.restore();
    }
  }

  function paintAt(clientX: number, clientY: number) {
    const rect = view.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * MAP;
    const y = ((clientY - rect.top) / rect.height) * MAP;
    const r = brushSize / 2;
    const paint = (ctx: CanvasRenderingContext2D, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (tool === 'cut') paint(rctx, 'rgba(255,255,255,0.9)');
    else if (tool === 'loop') paint(rctx, 'rgba(0,0,0,0.9)');
    else if (tool === 'height') {
      const v = Math.round(heightValue);
      paint(hctx, `rgba(${v},${v},${v},0.55)`);
    } else {
      paint(hctx, 'rgba(255,255,255,0.9)');
      paint(rctx, 'rgba(255,255,255,0.9)');
    }
    redraw();
  }

  view.addEventListener('pointerdown', (e) => {
    painting = true;
    view.setPointerCapture(e.pointerId);
    paintAt(e.clientX, e.clientY);
  });
  view.addEventListener('pointermove', (e) => { if (painting) paintAt(e.clientX, e.clientY); });
  view.addEventListener('pointerup', () => { painting = false; });

  // ---------- 工具栏 ----------
  const tools = el('div', { class: 'toolbar' });
  const mkTool = (id: Tool, label: string, title: string) => {
    const b = el('button', { class: 'btn tool' + (tool === id ? ' active' : ''), title }, label);
    b.addEventListener('click', () => {
      tool = id;
      tools.querySelectorAll('.tool').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    return b;
  };
  tools.append(
    mkTool('cut', '割绒', '刷成割绒区域'),
    mkTool('loop', '圈绒', '刷成圈绒区域'),
    mkTool('height', '绒高刷', '刷出高低绒浮雕(强度见滑杆)'),
    mkTool('erase', '恢复', '恢复满绒高 + 割绒'),
  );

  const sizeLabel = el('span', { class: 'slider-label' }, `笔刷 ${brushSize}px`);
  const sizeSlider = el('input', { type: 'range', min: '6', max: '80', value: String(brushSize) }) as HTMLInputElement;
  sizeSlider.addEventListener('input', () => {
    brushSize = parseInt(sizeSlider.value);
    sizeLabel.textContent = `笔刷 ${brushSize}px`;
  });
  const hLabel = el('span', { class: 'slider-label' }, `绒高刷 ${(heightValue / 255 * 100).toFixed(0)}%`);
  const hSlider = el('input', { type: 'range', min: '0', max: '255', value: String(heightValue) }) as HTMLInputElement;
  hSlider.addEventListener('input', () => {
    heightValue = parseInt(hSlider.value);
    hLabel.textContent = `绒高刷 ${(heightValue / 255 * 100).toFixed(0)}%`;
  });

  const layerSel = el('select', {},
    el('option', { value: 'mix' }, '叠加显示'),
    el('option', { value: 'height' }, '只看绒高'),
    el('option', { value: 'region' }, '只看工艺'),
  ) as HTMLSelectElement;
  layerSel.addEventListener('change', () => { showLayer = layerSel.value as typeof showLayer; redraw(); });

  const saveBtn = el('button', { class: 'btn primary' }, '保存工艺图');
  saveBtn.addEventListener('click', () => {
    order.craft.heightMapUrl = heightCv.toDataURL('image/png');
    order.craft.regionMapUrl = regionCv.toDataURL('image/png');
    store.save(order);
    alert('已保存,去「三维预览」查看效果。');
  });
  const clearBtn = el('button', { class: 'btn' }, '全部重置');
  clearBtn.addEventListener('click', () => {
    if (!window.confirm('重置绒高和工艺分区?')) return;
    hctx.fillStyle = '#ffffff'; hctx.fillRect(0, 0, MAP, MAP);
    rctx.fillStyle = '#ffffff'; rctx.fillRect(0, 0, MAP, MAP);
    redraw();
  });

  const bar2 = el('div', { class: 'toolbar' },
    sizeLabel, sizeSlider, hLabel, hSlider, layerSel, saveBtn, clearBtn,
  );

  root.append(
    el('div', { class: 'page-head' },
      el('h2', {}, `绒面工艺 — ${order.name}`),
      el('div', { class: 'hint' }, '蓝色 = 圈绒区,暗色 = 低绒(浮雕凹陷)。绒高百分比基于订单基础绒高。'),
    ),
    tools, bar2,
    el('div', { class: 'craft-wrap' }, view),
  );

  Promise.all(loads).then(redraw);
  redraw();
}
