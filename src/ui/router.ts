// Hash 路由：#/orders | #/convert | #/carve | #/preview | #/settings
export type Route = 'orders' | 'convert' | 'carve' | 'preview' | 'settings';

const routes: Route[] = ['orders', 'convert', 'carve', 'preview', 'settings'];

export function currentRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return routes.includes(r) ? r : 'orders';
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
