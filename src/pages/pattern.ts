import { store } from '../store';
import { el, fileInput } from '../ui';
import { quantizeToYarn, redrawIndexed, readPixels } from '../quantize';
import { YARN_LIBRARY, hexToRgb } from '../yarnPalette';
import { Order, UsedColor, YarnColor, MATERIAL_NAMES } from '../types';

let selected: Set<string> = new Set(); // 选中的颜色 hex

export function renderPattern(root: HTMLElement) {
  root.innerHTML = '';
  selected = new Set();
  const order = store.current();
  if (!order) {
    root.append(el('div', { class: 'empty' }, '请先在「订单」页新建或打开一个订单。'));
    return;
  }

  const refresh = () => renderPattern(root);

  // ---------- 左侧:订单信息 + 图案操作 ----------
  const side = el('div', { class: 'side-panel' });
  side.append(el('h3', {}, '订单信息'));
  side.append(field('订单名称', input(order.name, (v) => { order.name = v; })));
  side.append(field('客户', input(order.customer, (v) => { order.customer = v; })));
  side.append(field('备注', input(order.note, (v) => { order.note = v; })));
  const sizeRow = el('div', { class: 'field-row' },
    field('宽 (m)', numInput(order.widthM, 0.3, 8, 0.1, (v) => { order.widthM = v; })),
    field('高 (m)', numInput(order.heightM, 0.3, 8, 0.1, (v) => { order.heightM = v; })),
  );
  side.append(sizeRow);
  const shapeSel = el('select', {},
    el('option', { value: 'rect' }, '矩形'),
    el('option', { value: 'round' }, '圆形'),
    el('option', { value: 'oval' }, '椭圆'),
  ) as HTMLSelectElement;
  shapeSel.value = order.shape;
  shapeSel.addEventListener('change', () => { order.shape = shapeSel.value as Order['shape']; });
  side.append(field('形状', shapeSel));
  side.append(field('基础绒高 (mm)', numInput(order.pileHeightMm, 4, 30, 1, (v) => { order.pileHeightMm = v; })));
  const saveBtn = el('button', { class: 'btn primary' }, '保存订单信息');
  saveBtn.addEventListener('click', () => { store.save(order); alert('已保存'); });
  side.append(saveBtn);

  side.append(el('hr', {}));
  side.append(el('h3', {}, '图案导入'));
  const importBtn = el('button', { class: 'btn' }, '导入 PNG 图片');
  importBtn.addEventListener('click', () => {
    fileInput('.png,image/png', (f) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          order.pattern = {
            sourceUrl: reader.result as string,
            indexedUrl: '',
            width: img.naturalWidth,
            height: img.naturalHeight,
            colors: [],
          };
          store.save(order);
          refresh();
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(f);
    });
  });
  side.append(importBtn);

  if (order.pattern && order.pattern.sourceUrl) {
    side.append(el('div', { class: 'hint' }, `原图 ${order.pattern.width}×${order.pattern.height}`));
    const kRow = el('div', { class: 'quant-row' });
    const kInput = numInput(8, 2, 16, 1, () => {});
    const qBtn = el('button', { class: 'btn primary' }, '按色板量化');
    qBtn.addEventListener('click', () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.round(parseFloat(kInput.value)) || 8;
        const r = quantizeToYarn(img, k);
        order.pattern!.indexedUrl = r.indexedUrl;
        order.pattern!.colors = r.colors;
        order.pattern!.width = r.width;
        order.pattern!.height = r.height;
        store.save(order);
        refresh();
      };
      img.src = order.pattern!.sourceUrl;
    });
    kRow.append(el('label', {}, '颜色数'), kInput, qBtn);
    side.append(kRow);
  }

  // ---------- 右侧:图案预览 + 色板 ----------
  const main = el('div', { class: 'main-panel' });
  if (order.pattern?.indexedUrl) {
    const p = order.pattern;
    main.append(el('h3', {}, '量化图案(纱线色)'));
    const imgWrap = el('div', { class: 'pattern-preview' });
    imgWrap.append(el('img', { src: p.indexedUrl, alt: '量化图案' }));
    main.append(imgWrap);

    main.append(el('h3', {}, `纱线颜色(${p.colors.length} 色)— 点选后可合并 / 替换`));
    const chips = el('div', { class: 'chip-list' });
    for (const c of p.colors) {
      chips.append(colorChip(c, order, refresh));
    }
    main.append(chips);

    const actions = el('div', { class: 'chip-actions' });
    const mergeBtn = el('button', { class: 'btn' }, '合并选中颜色');
    mergeBtn.addEventListener('click', () => {
      if (selected.size < 2) { alert('先点选两个或以上颜色'); return; }
      const keep = [...selected][0];
      const map = new Map<string, YarnColor>();
      const keepColor = p.colors.find((c) => c.hex === keep)!;
      for (const hex of selected) {
        if (hex !== keep) map.set(hex, keepColor);
      }
      applyColorMap(order, map, refresh);
    });
    const replaceBtn = el('button', { class: 'btn' }, '替换选中颜色…');
    replaceBtn.addEventListener('click', () => {
      if (selected.size !== 1) { alert('先点选一个要替换的颜色'); return; }
      showYarnPicker([...selected][0], (target) => {
        const map = new Map<string, YarnColor>();
        map.set([...selected][0], target);
        applyColorMap(order, map, refresh);
      });
    });
    actions.append(mergeBtn, replaceBtn);
    main.append(actions);
  } else if (order.pattern) {
    main.append(el('h3', {}, '原图预览'));
    const imgWrap = el('div', { class: 'pattern-preview' });
    imgWrap.append(el('img', { src: order.pattern.sourceUrl, alt: '原图' }));
    main.append(imgWrap, el('div', { class: 'hint' }, '在左侧选择颜色数,点击「按色板量化」生成纱线配色。'));
  } else {
    main.append(el('div', { class: 'empty' }, '还没有图案,请在左侧导入 PNG。'));
  }

  const layout = el('div', { class: 'two-col' }, side, main);
  root.append(layout);
}

function applyColorMap(order: Order, map: Map<string, YarnColor>, refresh: () => void) {
  const p = order.pattern!;
  readPixels(p.indexedUrl).then(({ width, height, data }) => {
    p.indexedUrl = redrawIndexed(width, height, data, map);
    // 更新色板:替换 + 合并占比
    const next: UsedColor[] = [];
    for (const c of p.colors) {
      const rep = map.get(c.hex);
      const target = rep ?? c;
      const exist = next.find((x) => x.code === target.code);
      if (exist) exist.ratio += c.ratio;
      else next.push({ ...target, ratio: c.ratio });
    }
    next.sort((a, b) => b.ratio - a.ratio);
    p.colors = next;
    store.save(order);
    refresh();
  });
}

function colorChip(c: UsedColor, order: Order, refresh: () => void) {
  const isSel = selected.has(c.hex);
  const chip = el('div', { class: 'chip' + (isSel ? ' selected' : '') },
    el('span', { class: 'chip-color', style: `background:${c.hex}` }),
    el('div', { class: 'chip-text' },
      el('div', { class: 'chip-code' }, `${c.code} ${c.name}`),
      el('div', { class: 'chip-meta' }, `${MATERIAL_NAMES[c.material]} · ${(c.ratio * 100).toFixed(1)}%`),
    ),
  );
  chip.addEventListener('click', () => {
    if (selected.has(c.hex)) selected.delete(c.hex);
    else selected.add(c.hex);
    chip.classList.toggle('selected');
  });
  return chip;
}

function showYarnPicker(_fromHex: string, onPick: (y: YarnColor) => void) {
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal' },
    el('h3', {}, '选择替换纱线颜色'),
  );
  const list = el('div', { class: 'chip-list' });
  for (const y of YARN_LIBRARY) {
    const item = el('div', { class: 'chip' },
      el('span', { class: 'chip-color', style: `background:${y.hex}` }),
      el('div', { class: 'chip-text' },
        el('div', { class: 'chip-code' }, `${y.code} ${y.name}`),
        el('div', { class: 'chip-meta' }, MATERIAL_NAMES[y.material]),
      ),
    );
    item.addEventListener('click', () => {
      overlay.remove();
      onPick(y);
    });
    list.append(item);
  }
  const close = el('button', { class: 'btn' }, '取消');
  close.addEventListener('click', () => overlay.remove());
  box.append(list, close);
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

// ---------- 表单小件 ----------
function field(label: string, inputEl: HTMLElement) {
  return el('label', { class: 'field' }, el('span', {}, label), inputEl);
}
function input(value: string, onChange: (v: string) => void) {
  const i = el('input', { type: 'text', value }) as HTMLInputElement;
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function numInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void) {
  const i = el('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  i.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, parseFloat(i.value) || min));
    i.value = String(v);
    onChange(v);
  });
  return i;
}
