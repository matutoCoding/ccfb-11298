// 极简 DOM 构建工具：h('div.cls#id', {onClick}, [children])
export type VChild = Node | string | number | false | null | undefined;

export function h(
  tag: string,
  props: Record<string, unknown> = {},
  children: VChild | VChild[] = [],
): HTMLElement {
  const m = tag.match(/^([a-z0-9]+)((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m ? m[1] : tag);
  if (m && m[2]) {
    for (const part of m[2].split(/(?=[.#])/).filter(Boolean)) {
      if (part.startsWith('.')) el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class' && typeof v === 'string') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === false || c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  unit: string,
  onChange: (v: number) => void,
): HTMLElement {
  const num = h('span.val', {}, `${value}${unit}`);
  const input = h('input', {
    type: 'range', min, max, step, value,
    onInput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      num.textContent = `${v}${unit}`;
      onChange(v);
    },
  }) as HTMLInputElement;
  return h('label.ctl', {}, [h('span.lbl', {}, label), input, num]);
}

export function numberField(
  label: string,
  value: number,
  unit: string,
  onChange: (v: number) => void,
): HTMLElement {
  return h('label.ctl', {}, [
    h('span.lbl', {}, label),
    h('input', {
      type: 'number', value, step: 'any',
      onInput: (e: Event) => onChange(Number((e.target as HTMLInputElement).value)),
    }),
    h('span.unit', {}, unit),
  ]);
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  return h('label.ctl.toggle', {}, [
    h('span.lbl', {}, label),
    h('input', {
      type: 'checkbox', checked,
      onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
    }),
  ]);
}

export function select(
  label: string,
  options: { value: string; text: string }[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const sel = h('select', {
    onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.text)));
  return h('label.ctl', {}, [h('span.lbl', {}, label), sel]);
}

export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const t = h(`div.toast.${kind}`, {}, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}
