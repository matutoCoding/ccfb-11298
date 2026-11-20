// 通用 DOM 辅助
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | undefined> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function mount(el: HTMLElement, node: Node): void {
  clear(el);
  el.append(node);
}

export function swatch(rgb: [number, number, number], extraClass = ''): HTMLElement {
  return h('span', {
    class: 'swatch ' + extraClass,
    style: `background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
  });
}

export function slider(opts: {
  min: number; max: number; step: number; value: number;
  onInput: (v: number) => void; label: string; suffix?: string;
}): HTMLElement {
  const val = h('span', { class: 'slider-val' }, `${opts.value}${opts.suffix ?? ''}`);
  const input = h('input', {
    type: 'range', min: opts.min, max: opts.max, step: opts.step, value: opts.value,
    oninput: ((e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      val.textContent = `${v}${opts.suffix ?? ''}`;
      opts.onInput(v);
    }) as EventListener,
  }) as HTMLInputElement;
  return h('label', { class: 'slider-row' },
    h('span', { class: 'slider-label' }, opts.label),
    h('span', { class: 'slider-ctl' }, input, val),
  );
}

export function downloadDataURL(filename: string, dataURL: string): void {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  a.click();
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmt(n: number, digits = 1): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
