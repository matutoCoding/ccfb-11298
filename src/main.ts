// 入口:导航 + 哈希路由
import './style.css';
import { el } from './ui';
import { store } from './store';
import { renderOrders } from './pages/orders';
import { renderPattern } from './pages/pattern';
import { renderCraft } from './pages/craft';
import { renderPreview, destroyPreview } from './pages/preview';
import { renderSettings } from './pages/settings';

const PAGES: { hash: string; label: string; render: (root: HTMLElement) => void }[] = [
  { hash: '#/orders', label: '订单', render: renderOrders },
  { hash: '#/pattern', label: '图案', render: renderPattern },
  { hash: '#/craft', label: '绒面工艺', render: renderCraft },
  { hash: '#/preview', label: '三维预览', render: renderPreview },
  { hash: '#/settings', label: '设置', render: renderSettings },
];

const app = document.getElementById('app')!;
const nav = el('nav', { class: 'top-nav' });
const content = el('main', { class: 'content' });
app.append(nav, content);

function renderNav(active: string) {
  nav.innerHTML = '';
  nav.append(el('span', { class: 'logo' }, '地毯绒面预览'));
  for (const p of PAGES) {
    const a = el('a', { href: p.hash, class: 'nav-link' + (active === p.hash ? ' active' : '') }, p.label);
    nav.append(a);
  }
  const cur = store.current();
  nav.append(el('span', { class: 'current-order' }, cur ? `当前订单:${cur.name}` : '未选择订单'));
}

function route() {
  destroyPreview();
  const hash = location.hash || '#/orders';
  const page = PAGES.find((p) => p.hash === hash) ?? PAGES[0];
  renderNav(page.hash);
  page.render(content);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
// 调试挂钩
(window as unknown as { __store: typeof store }).__store = store;
store.onChange(() => {
  // 只刷新导航上的订单名,页面内容由各自管理
  const cur = store.current();
  const span = nav.querySelector('.current-order');
  if (span) span.textContent = cur ? `当前订单:${cur.name}` : '未选择订单';
});

route();
