import './ui/styles.css';
import { h, clear } from './ui/dom';
import { currentRoute, navigate, onRouteChange, type Route } from './ui/router';
import { store } from './state/store';
import { OrdersPage } from './pages/OrdersPage';
import { ConvertPage } from './pages/ConvertPage';
import { CarvePage } from './pages/CarvePage';
import { PreviewPage } from './pages/PreviewPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV: { route: Route; label: string }[] = [
  { route: 'orders', label: '订单列表' },
  { route: 'convert', label: '结图转换' },
  { route: 'carve', label: '剪花工艺' },
  { route: 'preview', label: '绒面预览' },
  { route: 'settings', label: '设置' },
];

function renderShell(route: Route): void {
  const app = document.getElementById('app')!;
  clear(app);
  const topbar = h('div.topbar', {}, [
    h('div.brand', {}, ['结毯工坊', h('small', {}, '打结地毯 · 剪花绒面工艺系统')]),
    ...NAV.map((n) =>
      h('button.nav-btn', { class: n.route === route ? 'nav-btn active' : 'nav-btn', onClick: () => navigate(n.route) }, n.label),
    ),
    h('div.order-chip', {},
      store.current ? ['当前订单：', h('b', {}, store.current.name)] : '未打开订单'),
  ]);
  const main = h('main', {});
  app.append(topbar, main);

  if ((route === 'convert' || route === 'carve' || route === 'preview') && !store.current) {
    main.append(h('div.empty', { style: { width: '100%' } }, [
      h('p', {}, '请先在订单列表中打开一个订单'),
      h('button.btn.primary', { onClick: () => navigate('orders') }, '去订单列表'),
    ]));
    return;
  }
  const page = h('div.page', {});
  main.append(page);
  switch (route) {
    case 'orders': new OrdersPage(page); break;
    case 'convert': new ConvertPage(page); break;
    case 'carve': new CarvePage(page); break;
    case 'preview': new PreviewPage(page); break;
    case 'settings': new SettingsPage(page); break;
  }
}

store.refreshOrders();
renderShell(currentRoute());
onRouteChange(renderShell);
