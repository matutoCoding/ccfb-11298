// DOM 小工具
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fileInput(accept: string, onFile: (f: File) => void) {
  const input = el('input', { type: 'file', accept, style: 'display:none' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

export function confirmBox(msg: string): boolean {
  return window.confirm(msg);
}
