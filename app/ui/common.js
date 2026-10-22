import { html, useMemo, cls } from '../lib.js';
import { parseMd, inline } from '../md.js';
import { WIDGETS } from '../widgets/index.js';
import { level, XP_PER_LEVEL, setSetting, getState } from '../store.js';

export function Md({ src, className }) {
  const blocks = useMemo(() => parseMd(src), [src]);
  return html`<div class=${cls('md', className)}>
    ${blocks.map((b, i) => {
      if (b.type === 'widget') {
        const W = WIDGETS[b.name];
        return W ? html`<${W} key=${i} ...${b.props} />` : html`<div class="callout callout-warn" key=${i}>Неизвестный виджет: ${b.name}</div>`;
      }
      return html`<div key=${i} dangerouslySetInnerHTML=${{ __html: b.html }} />`;
    })}
  </div>`;
}

export function Inline({ text }) {
  return html`<span dangerouslySetInnerHTML=${{ __html: inline(String(text ?? '')) }} />`;
}

export function Bar({ value, max, color }) {
  const pct = max ? Math.round((100 * value) / max) : 0;
  return html`<div class="bar" title=${`${value}/${max}`}><div class="bar-fill" style=${{ width: pct + '%', background: color || 'var(--accent)' }} /></div>`;
}

export function Stars({ n, max = 3 }) {
  return html`<span class="stars" aria-label=${`${n} из ${max} звёзд`}>${Array.from({ length: max }, (_, i) => html`<span class=${i < n ? 'star on' : 'star'}>★</span>`)}</span>`;
}

const ICONS = {
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  sandbox: 'M4 5h16v14H4z M8 9l3 3-3 3 M13 15h4',
  metrics: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  review: 'M4 12a8 8 0 1 0 3-6.2 M4 4v4h4',
  practice: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01',
  progress: 'M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

export function Icon({ name, size = 18 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;
}

const NAV = [
  ['/', 'Карта', 'map'],
  ['/practice', 'Практика', 'practice'],
  ['/metrics', 'Метрики', 'metrics'],
  ['/sandbox', 'Песочница', 'sandbox'],
  ['/progress', 'Прогресс', 'progress'],
  ['/settings', 'Настройки', 'settings'],
];

export function MiniRing({ value, max, size = 30 }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, p = max ? value / max : 0;
  return html`<svg class="ring" width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="ring-bg" style="stroke-width:3.5" />
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="ring-fg" style="stroke-width:3.5" stroke-dasharray=${`${c * p} ${c}`} transform=${`rotate(-90 ${size / 2} ${size / 2})`} />
  </svg>`;
}

export function Header({ route, dueCount, xp }) {
  const active = (p) => (p === '/' ? route.parts.length === 0 || route.parts[0] === 'node' : '/' + route.parts[0] === p || (p === '/practice' && route.parts[0] === 'review'));
  const lvl = level(xp);
  const into = xp % XP_PER_LEVEL;
  const theme = getState().settings.theme;
  const cycleTheme = () => setSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  return html`
    <header class="topbar">
      <a class="brand" href="#/"><span class="logo">PA</span><span class="brand-name">Product Analyst Trainer</span></a>
      <nav class="nav-top">
        ${NAV.map(([p, t]) => html`<a class=${cls('nav-link', active(p) && 'active')} href=${'#' + p}>${t}${p === '/practice' && dueCount ? html`<span class="pill">${dueCount}</span>` : ''}</a>`)}
      </nav>
      <div class="top-right">
        <a class="lvl" href="#/progress" title=${`${into} из ${XP_PER_LEVEL} опыта до следующего уровня`}>
          <${MiniRing} value=${into} max=${XP_PER_LEVEL} /><span>LVL <span class="lvl-num">${lvl}</span></span>
        </a>
        <button class="icon-btn" onClick=${cycleTheme} title=${`Тема: ${theme === 'system' ? 'как в системе' : theme}`} aria-label="Переключить тему">◐</button>
      </div>
    </header>
    <nav class="nav-bottom">
      ${NAV.map(([p, t, ic]) => html`<a class=${cls('nb-link', active(p) && 'active')} href=${'#' + p}><${Icon} name=${ic} /><span>${t}</span>${p === '/practice' && dueCount ? html`<span class="dot" />` : ''}</a>`)}
    </nav>`;
}

export function Toast({ text }) {
  if (!text) return null;
  return html`<div class="toast">${text}</div>`;
}
