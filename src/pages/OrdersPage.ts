import type { Order } from '../types';
import { downloadText, readTextFile, uid } from '../core/storage';
import { createOrder } from '../core/defaults';
import { store } from '../core/store';
import { navigate } from '../ui/router';
import { fmtDate, h, swatch } from '../ui/dom';

export class OrdersPage {
  el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'page' });
    this.render();
  }

  private render(): void {
    const state = store.state;
    const head = h('div', { class: 'page-head' },
      h('div', {},
        h('h2', {}, '订单列表'),
        h('p', { class: 'page-desc' }, `共 ${state.orders.length} 个订单，数据保存在本机浏览器，可导出备份或导入到其他电脑。`),
      ),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => this.create() }, '＋ 新建订单'),
        h('button', { class: 'btn', onclick: () => this.exportAll() }, '导出全部'),
        h('button', { class: 'btn', onclick: () => this.importPrompt() }, '导入订单'),
      ),
    );

    const fileInput = h('input', {
      type: 'file', accept: '.json,application/json', hidden: true,
      onchange: ((e: Event) => this.importFile(e.target as HTMLInputElement)) as EventListener,
    }) as HTMLInputElement;

    const list = state.orders.length === 0
      ? h('div', { class: 'empty-state' }, h('p', {}, '暂无订单，点击「新建订单」开始。'))
      : h('div', { class: 'order-grid' }, ...state.orders.map((o) => this.card(o)));

    this.el.innerHTML = '';
    this.el.append(head, fileInput, list);
  }

  private card(o: Order): HTMLElement {
    const colors = store.paletteColors(o);
    const chips = colors.slice(0, 8).map((c) => swatch(c.rgb));
    const isCurrent = o.id === store.state.currentOrderId;
    return h('div', { class: 'order-card' + (isCurrent ? ' current' : '') },
      h('div', { class: 'order-card-head' },
        h('div', { class: 'order-thumb' },
          o.quantizedImage
            ? h('img', { src: o.quantizedImage, alt: o.name })
            : h('div', { class: 'order-thumb-ph' }, '无图案'),
        ),
        h('div', { class: 'order-meta' },
          h('h3', {}, o.name),
          h('div', { class: 'muted' }, o.customer || '未填写客户'),
          h('div', { class: 'muted small' }, `${o.widthM}m × ${o.depthM}m · 绒高 ${o.pile.pileHeight}mm`),
          h('div', { class: 'muted small' }, '更新于 ' + fmtDate(o.updatedAt)),
        ),
      ),
      h('div', { class: 'chip-row' }, ...chips),
      h('div', { class: 'order-card-actions' },
        h('button', { class: 'btn primary sm', onclick: () => { store.selectOrder(o.id); navigate('pattern'); } }, '编辑'),
        h('button', {
          class: 'btn sm', onclick: () => { store.selectOrder(o.id); navigate('preview3d'); },
        }, '三维预览'),
        h('button', { class: 'btn sm', onclick: () => this.editInfo(o) }, '信息/尺寸'),
        h('button', { class: 'btn sm', onclick: () => this.duplicate(o.id) }, '复制'),
        h('button', { class: 'btn sm danger', onclick: () => this.remove(o) }, '删除'),
      ),
    );
  }

  private editInfo(o: Order): void {
    const name = prompt('订单名称', o.name);
    if (name === null) return;
    const customer = prompt('客户名称', o.customer) ?? o.customer;
    const wAns = prompt('毯面宽度（米，0.3–10）', String(o.widthM));
    if (wAns === null) return;
    const dAns = prompt('毯面深度（米，0.3–10）', String(o.depthM));
    if (dAns === null) return;
    const w = Number(wAns), d = Number(dAns);
    if (!Number.isFinite(w) || !Number.isFinite(d) || w < 0.3 || d < 0.3 || w > 10 || d > 10) {
      alert('尺寸无效，请输入 0.3–10 之间的数值');
      return;
    }
    store.selectOrder(o.id);
    if (w !== o.widthM || d !== o.depthM) {
      store.resizeOrderMaps(o, w, d);
    }
    store.updateOrder(o.id, { name: name || o.name, customer });
  }

  private create(): void {
    const name = prompt('订单名称', '新订单 ' + new Date().toLocaleDateString('zh-CN'));
    if (name === null) return;
    store.addOrder(createOrder({ name: name || '未命名订单' }));
    navigate('pattern');
  }

  private duplicate(id: string): void {
    store.duplicateOrder(id);
  }

  private remove(o: Order): void {
    if (confirm(`确定删除订单「${o.name}」？此操作不可恢复（可先导出备份）。`)) {
      store.deleteOrder(o.id);
    }
  }

  private exportAll(): void {
    const payload = {
      app: 'carpet-pile-studio',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: store.state.settings,
      orders: store.state.orders,
    };
    downloadText(`carpet-orders-${Date.now()}.json`, JSON.stringify(payload, null, 2));
  }

  private exportOne(o: Order): void {
    downloadText(`${o.name}-${uid('f')}.json`, JSON.stringify({
      app: 'carpet-pile-studio', version: 1, orders: [o],
    }, null, 2));
  }

  private importPrompt(): void {
    (this.el.querySelector('input[type=file]') as HTMLInputElement)?.click();
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const json = await readTextFile(file);
      store.importState(json);
      alert('导入成功');
    } catch (e) {
      alert('导入失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }
}
