import { h, toast, numberField } from '../ui/dom';
import { downloadText } from '../core/report';
import { store, DEFAULT_SETTINGS } from '../state/store';
import { rgbToLab } from '../core/color';
import { buildUsage, totalGrams, usageToCsv } from '../core/report';
import { gridFromSpec } from '../core/grid';
import type { PaletteColor, YarnType } from '../core/types';

const YARN_TEXT: Record<YarnType, string> = { wool: '羊毛', silk: '丝', woolSilk: '羊毛夹丝' };

export class SettingsPage {
  constructor(private root: HTMLElement) {
    this.render();
  }

  private render(): void {
    this.root.replaceChildren();
    const side = h('div.sidebar', { style: { width: '380px', flexBasis: '380px' } });
    const stage = h('div.stage', { style: { padding: '20px', overflowY: 'auto' } });
    const s = store.settings;

    // 工艺参数
    side.append(h('div.section-title', {}, '工艺与克重参数'));
    side.append(numberField('默认道数', s.defaultKpi, '结/英寸', (v) => { s.defaultKpi = v; store.persistSettings(); }));
    side.append(numberField('羊毛线密度', s.yarnLinearDensity.wool, 'g/m', (v) => { s.yarnLinearDensity.wool = v; store.persistSettings(); }));
    side.append(numberField('丝线密度', s.yarnLinearDensity.silk, 'g/m', (v) => { s.yarnLinearDensity.silk = v; store.persistSettings(); }));
    side.append(numberField('夹丝线密度', s.yarnLinearDensity.woolSilk, 'g/m', (v) => { s.yarnLinearDensity.woolSilk = v; store.persistSettings(); }));
    side.append(numberField('打结折叠倍数', s.foldFactor, '×', (v) => { s.foldFactor = v; store.persistSettings(); }));

    side.append(h('div.section-title', {}, '渲染默认值'));
    side.append(numberField('默认壳层数', s.shellLayers, '层', (v) => { s.shellLayers = v; store.persistSettings(); }));
    side.append(numberField('鳍片密度倍率', s.finDensity, '×', (v) => { s.finDensity = v; store.persistSettings(); }));
    side.append(numberField('MSAA 采样', s.msaaSamples, 'x', (v) => { s.msaaSamples = v; store.persistSettings(); }));

    side.append(
      h('div.section-title', {}, '恢复'),
      h('button.btn.danger', {
        onClick: () => {
          if (confirm('恢复全部默认设置？自定义色卡会被重置。')) {
            store.settings = structuredClone(DEFAULT_SETTINGS);
            store.persistSettings();
            this.render();
          }
        },
      }, '恢复出厂设置'),
    );

    // 色卡管理
    const paletteBox = h('div', {});
    stage.append(
      h('div', { style: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' } }, [
        h('h2', { style: { margin: '0 0 12px' } }, '纱线色卡'),
        h('button.btn.primary', { onClick: () => this.addColor(paletteBox) }, '＋ 新增色号'),
      ]),
      paletteBox,
    );
    this.drawPalette(paletteBox);

    // 当前订单克重清单
    if (store.runtime?.heights && store.knotBlob) {
      stage.append(h('h2', { style: { margin: '24px 0 10px' } }, '当前订单纱线用量清单'));
      const g = gridFromSpec(store.current!.widthMm, store.current!.heightMm, store.current!.kpi);
      const items = buildUsage(store.runtime.heights, store.knotBlob.knots, store.palette, store.settings);
      const total = totalGrams(items);
      const table = h('table.data', {}, [
        h('thead', {}, h('tr', {}, ['色号', '颜色', '纱线', '结数', '绒线长度(m)', '克重(g)']
          .map((t) => h('th', {}, t)))),
        h('tbody', {}, items.map((i) => h('tr', {}, [
          h('td', {}, [h('span.swatch', { style: { background: `rgb(${store.palette.find((p) => p.id === i.colorId)?.r ?? 0},${store.palette.find((p) => p.id === i.colorId)?.g ?? 0},${store.palette.find((p) => p.id === i.colorId)?.b ?? 0})` } }), i.code]),
          h('td', {}, i.name),
          h('td', {}, YARN_TEXT[i.yarn]),
          h('td', {}, String(i.knots)),
          h('td', {}, i.lengthM.toFixed(2)),
          h('td', {}, i.grams.toFixed(1)),
        ]))),
      ]);
      stage.append(
        table,
        h('div.callout', {}, `总 ${g.cols * g.rows} 结 · 合计纱线 <code>${(total / 1000).toFixed(2)} kg</code>（按当前道数 ${store.current!.kpi} 与实际绒高计算，改道数重转后自动重算）`),
        h('button.btn.primary', {
          style: { marginTop: '10px' },
          onClick: () => {
            downloadText(`${store.current!.name}-纱线清单.csv`, usageToCsv(items));
            toast('CSV 清单已导出', 'ok');
          },
        }, '导出克重清单 CSV'),
      );
    } else {
      stage.append(h('div.callout', {}, '打开订单并完成结图转换、剪花后，这里按结数与绒高自动生成每色号克重清单。'));
    }
    this.root.append(side, stage);
  }

  private drawPalette(box: HTMLElement): void {
    box.replaceChildren();
    store.palette.forEach((c, idx) => {
      box.append(h('div.swatch-row', {}, [
        h('input', {
          type: 'color', value: this.rgbToHex(c),
          onChange: (e: Event) => {
            const hex = (e.target as HTMLInputElement).value;
            const { r, g, b } = this.hexToRgb(hex);
            const lab = rgbToLab({ r, g, b });
            Object.assign(store.settings.customPalette[idx], { r, g, b }, lab);
            store.persistSettings();
          },
        }),
        h('input', {
          value: c.code, style: { width: '84px', background: 'var(--panel-2)', color: 'var(--fg)', border: '1px solid var(--line)', padding: '4px' },
          onChange: (e: Event) => { c.code = (e.target as HTMLInputElement).value; store.persistSettings(); },
        }),
        h('input', {
          value: c.name, style: { flex: 1, background: 'var(--panel-2)', color: 'var(--fg)', border: '1px solid var(--line)', padding: '4px' },
          onChange: (e: Event) => { c.name = (e.target as HTMLInputElement).value; store.persistSettings(); },
        }),
        this.yarnSelect(c.yarn, (v) => { c.yarn = v; store.persistSettings(); this.drawPalette(box); }),
        h('span.cnt', {}, `Lab ${c.L.toFixed(0)} ${c.a.toFixed(0)} ${c.b.toFixed(0)}`),
        h('button.btn.danger', {
          style: { padding: '3px 8px' },
          onClick: () => {
            store.settings.customPalette.splice(idx, 1);
            store.persistSettings();
            this.drawPalette(box);
          },
        }, '删'),
      ]));
    });
  }

  private yarnSelect(value: YarnType, onChange: (v: YarnType) => void): HTMLElement {
    return h('select', {
      style: { width: '92px' },
      onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value as YarnType),
    }, (Object.keys(YARN_TEXT) as YarnType[]).map((y) =>
      h('option', { value: y, selected: y === value }, YARN_TEXT[y])));
  }

  private addColor(box: HTMLElement): void {
    const n = store.settings.customPalette.length;
    const rgb = { r: 180, g: 180, b: 180 };
    const lab = rgbToLab(rgb);
    const color: PaletteColor = {
      id: `C-${Date.now().toString(36)}`, code: `W-${900 + n}`, name: '自定义色',
      ...rgb, ...lab, yarn: 'wool',
    };
    store.settings.customPalette.push(color);
    store.persistSettings();
    this.drawPalette(box);
    toast('已新增色号，可点击色块取色', 'ok');
  }

  private rgbToHex(c: PaletteColor): string {
    const f = (v: number) => Math.round(v).toString(16).padStart(2, '0');
    return `#${f(c.r)}${f(c.g)}${f(c.b)}`;
  }
  private hexToRgb(hex: string) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
}
