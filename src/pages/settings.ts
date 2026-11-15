// 设置页
import { store } from '../store';
import { el, fileInput } from '../ui';

export function renderSettings(root: HTMLElement) {
  root.innerHTML = '';
  const s = store.settings;

  const panel = el('div', { class: 'settings-panel' },
    el('h2', {}, '设置'),
    el('h3', {}, '渲染'),
    sliderField('壳层层数(越大越细腻,贴看不穿帮)', 16, 64, 1, s.shellCount, (v) => { s.shellCount = v; }),
    sliderField('渲染分辨率', 0.5, 2, 0.25, s.renderScale, (v) => { s.renderScale = v; }),
    el('h3', {}, '用量估算参数'),
    sliderField('割绒克重 (g/m²·mm)', 40, 200, 5, s.gramPerMmCut, (v) => { s.gramPerMmCut = v; }),
    sliderField('圈绒系数', 0.5, 1, 0.02, s.loopFactor, (v) => { s.loopFactor = v; }),
    sliderField('损耗率', 0, 0.2, 0.01, s.wastage, (v) => { s.wastage = v; }),
  );

  const saveBtn = el('button', { class: 'btn primary' }, '保存设置');
  saveBtn.addEventListener('click', () => { store.saveSettings(); alert('已保存'); });

  const dataBar = el('div', { class: 'toolbar' },
    (() => { const b = el('button', { class: 'btn' }, '导出全部订单'); b.addEventListener('click', () => store.exportAll()); return b; })(),
    (() => {
      const b = el('button', { class: 'btn' }, '导入订单');
      b.addEventListener('click', () => fileInput('.json', async (f) => {
        const r = store.importJson(await f.text());
        alert(`导入完成:成功 ${r.ok} 个,失败 ${r.fail} 个`);
      }));
      return b;
    })(),
    (() => {
      const b = el('button', { class: 'btn danger' }, '清空全部数据');
      b.addEventListener('click', () => {
        if (window.confirm('确定删除所有订单?此操作不可恢复!')) store.clearAll();
      });
      return b;
    })(),
  );

  panel.append(
    el('div', { class: 'toolbar' }, saveBtn),
    el('h3', {}, '数据管理'),
    dataBar,
    el('div', { class: 'hint' }, '订单保存在浏览器 localStorage 中,换电脑请先「导出全部订单」备份。'),
  );
  root.append(panel);
}

function sliderField(label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void) {
  const val = el('span', { class: 'slider-label' }, String(value));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  input.addEventListener('input', () => {
    val.textContent = input.value;
    onChange(parseFloat(input.value));
  });
  return el('label', { class: 'field slider-field' }, el('span', {}, label), input, val);
}
