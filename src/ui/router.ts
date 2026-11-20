// 极简哈希路由
export type Route = 'orders' | 'pattern' | 'craft' | 'preview3d' | 'settings';

const VALID: Route[] = ['orders', 'pattern', 'craft', 'preview3d', 'settings'];

export function currentRoute(): Route {
  const r = location.hash.replace('#/', '') as Route;
  return VALID.includes(r) ? r : 'orders';
}

export function navigate(route: Route): void {
  location.hash = '#/' + route;
}

export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
