import './styles.css';
import { store } from './core/store';
import { createDemoOrder } from './core/defaults';
import { currentRoute, navigate, onRouteChange, type Route } from './ui/router';
import { h, mount } from './ui/dom';
import { OrdersPage } from './pages/OrdersPage';
import { PatternPage } from './pages/PatternPage';
import { CraftPage } from './pages/CraftPage';
import { PreviewPage } from './pages/PreviewPage';
import { SettingsPage } from './pages/SettingsPage';

let currentPreview: PreviewPage | null = null;
let bootReady: Promise<void> = Promise.resolve();

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'orders', label: '订单列表', icon: '📋' },
  { route: 'pattern', label: '图案编辑', icon: '🎨' },
  { route: 'craft', label: '绒面工艺', icon: '🧵' },
  { route: 'preview3d', label: '三维预览', icon: '🧊' },
  { route: 'settings', label: '设置', icon: '⚙️' },
];

const view = document.getElementById('app')!;

function renderShell(): void {
  document.body.innerHTML = '';
  const route = currentRoute();
  const navButtons = NAV.map((n) =>
    h('button', {
      class: 'nav-item' + (n.route === route ? ' active' : ''),
      onclick: () => navigate(n.route),
    }, h('span', { class: 'nav-icon' }, n.icon), h('span', {}, n.label)),
  );
  const nav = h('nav', { class: 'sidebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark' }, '绒'),
      h('div', {}, h('div', { class: 'brand-title' }, '绒面预览工作台'),
        h('div', { class: 'brand-sub' }, 'Carpet Pile Studio')),
    ),
    h('div', { class: 'nav-list' }, ...navButtons),
    h('div', { class: 'nav-foot' }, 'WebGL2 实时渲染'),
  );
  const main = h('main', { class: 'content', id: 'view' });
  document.body.append(h('div', { class: 'layout' }, nav, main));
  renderPage(route);
}

function renderPage(route: Route): void {
  const el = document.getElementById('view');
  if (!el) return;
  // 工艺/图案/预览页需要先选中订单
  const needsOrder = route !== 'orders' && route !== 'settings';
  if (needsOrder && !store.currentOrder) {
    mount(el, h('div', { class: 'empty-state' }, h('p', {}, '正在加载订单…')));
    void bootReady.then(() => renderShell());
    return;
  }
  switch (route) {
    case 'orders': mount(el, new OrdersPage().el); break;
    case 'pattern': mount(el, new PatternPage().el); break;
    case 'craft': mount(el, new CraftPage().el); break;
    case 'preview3d': {
      currentPreview?.dispose();
      const p = new PreviewPage();
      currentPreview = p;
      mount(el, p.el);
      break;
    }
    case 'settings': mount(el, new SettingsPage().el); break;
  }
  if (route !== 'preview3d') {
    currentPreview?.dispose();
    currentPreview = null;
  }
}

function boot(): void {
  // 首次启动放一个演示订单，让三维预览立刻有东西看
  if (store.state.orders.length === 0) {
    bootReady = createDemoOrder(store.state.palettes).then((o) => store.addOrder(o));
  }
  renderShell();
  onRouteChange((r) => renderShell());
  // 数据变化时，订单页与设置页保持同步（3D 页面自行管理生命周期）
  store.subscribe(() => {
    const r = currentRoute();
    if (r === 'orders' || r === 'settings') renderShell();
  });
}

boot();
