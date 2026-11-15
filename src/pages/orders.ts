import { store, downloadJson } from '../store';
import { el, fmtTime, fileInput } from '../ui';
import { Order } from '../types';

export function renderOrders(root: HTMLElement) {
  root.innerHTML = '';
  const head = el('div', { class: 'page-head' },
    el('h2', {}, '订单列表'),
    el('div', { class: 'head-actions' },
      button('＋ 新建订单', 'btn primary', () => {
        const o = store.create();
        location.hash = '#/pattern';
      }),
      button('导入订单', 'btn', () => {
        fileInput('.json', async (f) => {
          const r = store.importJson(await f.text());
          alert(`导入完成:成功 ${r.ok} 个,失败 ${r.fail} 个`);
          renderOrders(root);
        });
      }),
      button('导出全部', 'btn', () => store.exportAll()),
    ),
  );
  root.append(head);

  const orders = store.list();
  if (orders.length === 0) {
    root.append(el('div', { class: 'empty' }, '还没有订单,点击「新建订单」开始。'));
    return;
  }

  const grid = el('div', { class: 'order-grid' });
  for (const o of orders) {
    grid.append(orderCard(o, () => renderOrders(root)));
  }
  root.append(grid);
}

function button(text: string, cls: string, onclick: () => void) {
  const b = el('button', { class: cls }, text);
  b.addEventListener('click', onclick);
  return b;
}

function orderCard(o: Order, refresh: () => void) {
  const thumb = el('div', { class: 'order-thumb' });
  if (o.pattern) {
    const img = el('img', { src: o.pattern.indexedUrl, alt: '' });
    thumb.append(img);
  } else {
    thumb.append(el('span', { class: 'no-pattern' }, '未导入图案'));
  }
  const isCurrent = store.currentOrderId === o.id;
  const card = el('div', { class: 'order-card' + (isCurrent ? ' current' : '') },
    thumb,
    el('div', { class: 'order-info' },
      el('div', { class: 'order-name' }, o.name),
      el('div', { class: 'order-meta' }, `客户:${o.customer || '—'}`),
      el('div', { class: 'order-meta' }, `尺寸:${o.widthM}×${o.heightM} m · 绒高 ${o.pileHeightMm} mm`),
      el('div', { class: 'order-meta' }, `更新:${fmtTime(o.updatedAt)}`),
    ),
    el('div', { class: 'order-actions' },
      button(isCurrent ? '当前订单' : '打开', 'btn small primary', () => {
        store.currentOrderId = o.id;
        store.emit();
        location.hash = '#/pattern';
      }),
      button('复制', 'btn small', () => { store.duplicate(o.id); refresh(); }),
      button('导出', 'btn small', () => store.exportOrder(o.id)),
      button('删除', 'btn small danger', () => {
        if (window.confirm(`确定删除订单「${o.name}」?`)) {
          store.remove(o.id);
          refresh();
        }
      }),
    ),
  );
  // 双击卡片直接打开
  card.addEventListener('dblclick', () => {
    store.currentOrderId = o.id;
    store.emit();
    location.hash = '#/pattern';
  });
  return card;
}
