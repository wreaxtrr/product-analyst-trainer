import { useState, useEffect } from './lib.js';

// Хеш-роутинг: на GitHub Pages нет серверных редиректов, поэтому все пути живут после «#».
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path, parts, query };
}

export function navigate(to) {
  if (location.hash !== '#' + to) location.hash = to;
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => { setRoute(parseHash()); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
