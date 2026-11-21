import { h } from '../ui/dom';
import { navigate } from '../ui/router';
import { store } from '../state/store';
import type { OrderMeta } from '../core/types';

const STATUS_LABEL: Record<OrderMeta['status'], string> = {
  draft: '草稿', converted: '已转结图', carved: '已剪花', confirmed: '已定稿',
};

export class OrdersPage {
  constructor(private root: HTMLElement) {
    this.render();
  }

  private async render(): Promise<void> {
    await store.refreshOrders();
    this.root.replaceChildren();
    const grid = h('div.order-grid', {});
    const header = h('div', { style: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', marginBottom: '18px' } }, [
      h('h2', { style: { margin: 0 } }, '订单列表'),
      h('button.btn.primary', { onClick: () => this.editDialog() }, '＋ 新建订单'),
    ]);
    grid.append(header);

    if (!store.orders.length) {
      grid.append(h('div.empty', { style: { position: 'static', height: '300px' } }, [
        h('p', {}, '还没有订单，新建一张毯子开始上机前定版'),
      ]));
    }
    for (const o of store.orders) {
      grid.append(this.card(o));
    }
    this.root.append(grid);
  }

  private card(o: OrderMeta): HTMLElement {
    const sizeM = `${(o.widthMm / 1000).toFixed(2)} × ${(o.heightMm / 1000).toFixed(2)} m`;
    return h('div.order-card', {
      onClick: async () => {
        await store.openOrder(o.id);
        navigate(o.status === 'draft' ? 'convert' : 'preview');
      },
    }, [
      h('div', {}, [
        h('h3', {}, o.name),
        h('div.meta', {}, `${o.customer || '—'} · ${sizeM} · ${o.kpi} 道/英寸`),
        h('div.meta', { style: { marginTop: '4px' } },
          `创建 ${new Date(o.createdAt).toLocaleDateString('zh-CN')} · ${o.designName || '未导入设计稿'}`),
      ]),
      h('div', { style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-end', gap: '8px' } }, [
        h('span.status-pill', { class: `status-pill status-${o.status}` }, STATUS_LABEL[o.status]),
        h('button.btn.danger', {
          style: { padding: '3px 10px' },
          onClick: async (e: Event) => {
            e.stopPropagation();
            if (confirm(`确认删除订单「${o.name}」？结图与高度场一并删除。`)) {
              await store.removeOrder(o.id);
              this.render();
            }
          },
        }, '删除'),
      ]),
    ]);
  }

  private editDialog(existing?: OrderMeta): void {
    const wrap = h('div', {
      style: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 50,
        display: 'flex', 'align-items': 'center', 'justify-content': 'center',
      },
    });
    const data = existing ? { ...existing } : {
      id: store.newOrderId(), name: '', customer: '', widthMm: 1800, heightMm: 1200,
      kpi: store.settings.defaultKpi, designName: '', note: '',
      createdAt: Date.now(), updatedAt: Date.now(), status: 'draft' as const,
    };
    const panel = h('div', {
      style: { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', padding: '24px', width: '520px' },
    });
    panel.append(h('h3', { style: { margin: '0 0 16px' } }, existing ? '编辑订单' : '新建订单'));
    const form = h('div.form-grid', {}, [
      h('label', {}, ['订单名称', h('input', { value: data.name, placeholder: '如：客厅团花毯 A 款', onInput: (e: Event) => (data.name = (e.target as HTMLInputElement).value) })]),
      h('label', {}, ['客户', h('input', { value: data.customer, onInput: (e: Event) => (data.customer = (e.target as HTMLInputElement).value) })]),
      h('label', {}, ['成品宽 (mm)', h('input', { type: 'number', value: data.widthMm, onInput: (e: Event) => (data.widthMm = Number((e.target as HTMLInputElement).value)) })]),
      h('label', {}, ['成品高 (mm)', h('input', { type: 'number', value: data.heightMm, onInput: (e: Event) => (data.heightMm = Number((e.target as HTMLInputElement).value)) })]),
      h('label', {}, ['道数 (结/英寸)', h('input', { type: 'number', value: data.kpi, min: 40, max: 200, onInput: (e: Event) => (data.kpi = Number((e.target as HTMLInputElement).value)) })]),
      h('label', {}, ['设计稿名称', h('input', { value: data.designName, onInput: (e: Event) => (data.designName = (e.target as HTMLInputElement).value) })]),
      h('label', { style: { gridColumn: '1 / -1' } }, ['备注', h('textarea', { rows: 2, onInput: (e: Event) => (data.note = (e.target as HTMLTextAreaElement).value) }, data.note)]),
    ]);
    panel.append(form);
    const dimInfo = h('div.callout', {}, '');
    const updateDim = () => {
      const pitch = 25.4 / data.kpi;
      dimInfo.innerHTML = `结间距 <code>${pitch.toFixed(3)} mm</code> · 预估网格 <code>${Math.round(data.widthMm / pitch)} × ${Math.round(data.heightMm / pitch)}</code> 结 · 总 <code>${(Math.round(data.widthMm / pitch) * Math.round(data.heightMm / pitch) / 10000).toFixed(1)} 万结</code>`;
    };
    updateDim();
    form.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateDim));
    panel.append(dimInfo);
    panel.append(h('div.btn-row', { style: { 'justify-content': 'flex-end', marginTop: '16px' } }, [
      h('button.btn', { onClick: () => wrap.remove() }, '取消'),
      h('button.btn.primary', {
        onClick: async () => {
          if (!data.name.trim()) { alert('请填写订单名称'); return; }
          await store.upsertOrder(data as OrderMeta);
          wrap.remove();
          this.render();
        },
      }, '保存'),
    ]));
    wrap.append(panel);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.append(wrap);
  }
}
