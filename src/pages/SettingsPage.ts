import type { AppSettings } from '../types';
import { store } from '../core/store';
import { downloadText, readTextFile } from '../core/storage';
import { h, slider } from '../ui/dom';

export class SettingsPage {
  el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'page' });
    this.render();
  }

  private get s(): AppSettings {
    return store.state.settings;
  }

  private render(): void {
    const s = this.s;
    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h2', {}, '设置'), h('p', { class: 'page-desc' }, '渲染质量、阴影与数据管理。修改后自动保存到浏览器。')),
    );

    const renderPanel = h('div', { class: 'panel' },
      h('h3', {}, '渲染质量'),
      slider({
        label: '纤维数量倍率', min: 0.5, max: 1.5, step: 0.25, value: s.fiberScale,
        onInput: (v) => store.updateSettings({ fiberScale: v }),
      }),
      h('div', { class: 'field-row' },
        h('label', {}, '纤维实例硬上限'),
        h('select', {
          onchange: ((e: Event) => store.updateSettings({
            maxFiberInstances: Number((e.target as HTMLSelectElement).value),
          })) as EventListener,
        },
          ...[100000, 150000, 220000, 300000].map((n) =>
            h('option', { value: n, selected: n === s.maxFiberInstances }, n.toLocaleString())),
        ),
      ),
      slider({
        label: '底布网格 X 分段', min: 60, max: 300, step: 10, value: s.baseSegmentsX,
        onInput: (v) => store.updateSettings({ baseSegmentsX: v }),
      }),
      slider({
        label: '底布网格 Y 分段', min: 60, max: 300, step: 10, value: s.baseSegmentsY,
        onInput: (v) => store.updateSettings({ baseSegmentsY: v }),
      }),
      h('div', { class: 'field-row' },
        h('label', {}, '阴影贴图分辨率'),
        h('select', {
          onchange: ((e: Event) => store.updateSettings({
            shadowSize: Number((e.target as HTMLSelectElement).value) as 1024 | 2048,
          })) as EventListener,
        },
          h('option', { value: 1024, selected: s.shadowSize === 1024 }, '1024（更快）'),
          h('option', { value: 2048, selected: s.shadowSize === 2048 }, '2048（更细）'),
        ),
      ),
      h('label', { class: 'check-row' },
        h('input', {
          type: 'checkbox', checked: s.shadowEnabled,
          onchange: ((e: Event) => store.updateSettings({
            shadowEnabled: (e.target as HTMLInputElement).checked,
          })) as EventListener,
        }),
        h('span', {}, '启用实时阴影（侧光下纤维投影的关键）'),
      ),
      h('label', { class: 'check-row' },
        h('input', {
          type: 'checkbox', checked: s.showFps,
          onchange: ((e: Event) => store.updateSettings({
            showFps: (e.target as HTMLInputElement).checked,
          })) as EventListener,
        }),
        h('span', {}, '显示 FPS 与纤维数'),
      ),
      h('p', { class: 'hint' }, '性能不足时优先降低纤维倍率与阴影分辨率；实例上限可防止低端显卡显存溢出。'),
    );

    const dataPanel = h('div', { class: 'panel' },
      h('h3', {}, '数据管理'),
      h('label', { class: 'check-row' },
        h('input', {
          type: 'checkbox', checked: s.autoSave,
          onchange: ((e: Event) => store.updateSettings({
            autoSave: (e.target as HTMLInputElement).checked,
          })) as EventListener,
        }),
        h('span', {}, '自动保存到浏览器 localStorage'),
      ),
      h('div', { class: 'btn-row wrap', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', onclick: () => this.exportAll() }, '导出全部数据'),
        h('button', { class: 'btn', onclick: () => this.importPrompt() }, '导入数据'),
        h('button', { class: 'btn danger', onclick: () => this.wipe() }, '清空浏览器数据'),
      ),
      h('input', {
        type: 'file', accept: '.json', hidden: true,
        onchange: ((e: Event) => this.importFile(e.target as HTMLInputElement)) as EventListener,
      }),
      h('h3', { style: 'margin-top:20px' }, '关于'),
      h('p', { class: 'hint' },
        '绒面预览工作台 v1.0 — TypeScript + WebGL2 自研着色器。纤维采用实例化扭曲丝带（Kajiya-Kay 各向异性高光），无壳层薄片，旋转视角无时间相关噪声。'),
    );

    this.el.innerHTML = '';
    this.el.append(head, h('div', { class: 'two-col' }, renderPanel, dataPanel));
  }

  private exportAll(): void {
    downloadText(`carpet-studio-backup-${Date.now()}.json`, JSON.stringify(store.state, null, 2));
  }

  private importPrompt(): void {
    (this.el.querySelector('input[type=file]') as HTMLInputElement)?.click();
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      store.importState(await readTextFile(file));
      alert('导入成功');
    } catch (e) {
      alert('导入失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  private wipe(): void {
    if (!confirm('确定清空全部订单与设置？建议先导出备份。')) return;
    localStorage.removeItem('carpet-studio-state-v1');
    location.reload();
  }
}
