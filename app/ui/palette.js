import { html, useState, useEffect, useRef, useMemo, cls } from '../lib.js';
import { course, allNodesOrdered } from '../content.js';
import { navigate } from '../router.js';

// Командная палитра: Ctrl+K (или /) — поиск по урокам, их теории и страницам.
const PAGES = [
  ['Карта навыков', '/'], ['Тренировка дня', '/practice'], ['Повторение', '/practice/review'], ['Пробный экзамен', '/practice/exam'],
  ['SQL-марафон', '/practice/marathon'], ['Тренажёр выбора метрик', '/metrics'], ['Песочница SQL и Python', '/sandbox'],
  ['Прогресс', '/progress'], ['Настройки', '/settings'],
];

function strip(md) { return String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`|$\\]/g, ' ').replace(/\s+/g, ' ').toLowerCase(); }

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inp = useRef(null);
  const index = useMemo(() => {
    const items = PAGES.map(([t, p]) => ({ kind: 'страница', title: t, path: p, text: t.toLowerCase() }));
    for (const n of allNodesOrdered()) {
      items.push({ kind: n.isTrial ? 'испытание' : course.branches[n.branch].title, title: n.title, path: `/node/${n.id}`, text: `${n.title} ${n.summary} ${strip(n.theory)}`.toLowerCase(), color: course.branches[n.branch].color });
    }
    return items;
  }, []);
  useEffect(() => {
    const on = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'л')) { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === '/' && !typing && !open) { e.preventDefault(); setOpen(true); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    addEventListener('keydown', on);
    addEventListener('open-palette', onOpen);
    return () => { removeEventListener('keydown', on); removeEventListener('open-palette', onOpen); };
  }, [open]);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inp.current && inp.current.focus(), 10); } }, [open]);
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return index.slice(0, 9);
    return index
      .map((it) => {
        let score = 0;
        for (const w of words) {
          if (it.title.toLowerCase().includes(w)) score += 10;
          else if (it.text.includes(w)) score += 1;
          else return null;
        }
        return { ...it, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [q, index]);
  if (!open) return null;
  const go = (it) => { setOpen(false); navigate(it.path); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
    if (e.key === 'Enter' && results[sel]) go(results[sel]);
  };
  return html`<div class="palette-backdrop" onClick=${() => setOpen(false)}>
    <div class="palette" onClick=${(e) => e.stopPropagation()} role="dialog" aria-label="Поиск по тренажёру">
      <div class="palette-input"><span class="palette-icon">⌕</span>
        <input ref=${inp} value=${q} placeholder="Найти урок, тему или страницу… (например: CUPED, retention, ClickHouse)" onInput=${(e) => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} />
        <span class="badge">Esc</span></div>
      <div class="palette-list">
        ${results.length ? results.map((it, i) => html`<button class=${cls('palette-item', i === sel && 'sel')} onMouseEnter=${() => setSel(i)} onClick=${() => go(it)}>
          <span class="dot" style=${{ background: it.color || 'var(--accent)', color: it.color || 'var(--accent)' }} />
          <span class="palette-title">${it.title}</span>
          <span class="palette-kind">${it.kind}</span>
        </button>`) : html`<div class="empty">Ничего не нашлось</div>`}
      </div>
      <div class="palette-foot small muted">↑ ↓ — выбор · Enter — открыть · Ctrl+K или / — открыть палитру</div>
    </div>
  </div>`;
}
