import { html, cls, plural, useEffect, useState } from '../lib.js';
import { course, nodeStats, isUnlocked, allNodesOrdered, estimateMinutes, fmtDuration, outline } from '../content.js';
import { useStore, setSetting, setNote } from '../store.js';
import { Md, Stars, Bar } from './common.js';
import { TaskCard } from './tasks.js';
import { navigate } from '../router.js';

const ACT_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI'];

// Личный конспект к уроку: сохраняется в прогрессе, собирается на странице «Курс → Шпаргалки».
function Notes({ id }) {
  const s = useStore();
  const saved = (s.notes[id] && s.notes[id].text) || '';
  const [text, setText] = useState(saved);
  const [open, setOpen] = useState(!!saved);
  useEffect(() => {
    if (text === saved) return undefined;
    const t = setTimeout(() => setNote(id, text), 500);
    return () => clearTimeout(t);
  }, [text]);
  if (!open) return html`<div class="notes no-print"><button class="btn small" onClick=${() => setOpen(true)}>✎ Добавить заметку к уроку</button>
    <span class="small muted" style="margin-left:8px">Своими словами — так запоминается лучше.</span></div>`;
  return html`<div class="notes">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><b>Мои заметки</b><span class="small muted">${text === saved ? (saved ? 'сохранено' : '') : 'сохраняю…'}</span></div>
    <textarea value=${text} onInput=${(e) => setText(e.target.value)} onBlur=${() => text !== saved && setNote(id, text)} placeholder="Главное из урока своими словами, свои примеры, на чём споткнулся. Все заметки собраны в «Курс → Шпаргалки»." />
  </div>`;
}

export function NodePage({ id, tab }) {
  const s = useStore();
  const node = course.nodes[id];
  useEffect(() => { window.scrollTo(0, 0); }, [id, tab]);
  if (!node) return html`<main class="page"><h1>Нет такого узла</h1><a href="#/">На карту</a></main>`;
  const b = course.branches[node.branch];
  const st = nodeStats(node, s);
  const open = isUnlocked(node, s);
  const hasTheory = !!(node.theory && node.theory.trim());
  const active = !hasTheory ? 'tasks' : tab === 'tasks' ? 'tasks' : 'theory';
  const order = allNodesOrdered();
  const idx = order.findIndex((n) => n.id === id);
  const next = order[idx + 1];
  const prev = order[idx - 1];
  const setTab = (t) => navigate(`/node/${id}${t === 'tasks' ? '?tab=tasks' : ''}`);
  const toc = outline(node);
  const kinds = [...new Set(node.tasks.map((t) => t.type))];
  const practical = node.tasks.filter((t) => t.type === 'sql' || t.type === 'python').length;

  return html`<main class="page node-page" style=${{ '--bc': b.color }}>
    <div class="node-meta">
      <a class="chip" href="#/" style=${{ borderColor: b.color, color: b.color }}>${node.isTrial ? 'Испытание' : b.title}</a>
      <span class="badge">${st.total} ${plural(st.total, 'задача', 'задачи', 'задач')}</span>
      ${st.done && html`<${Stars} n=${st.stars} />`}
    </div>
    <h1>${node.title}</h1>
    <p class="lead">${node.summary}</p>
    <div class="lesson-meta">
      ${node.act !== undefined && html`<span>Акт ${ACT_NAMES[node.act]}</span>`}
      <span>≈ ${fmtDuration(estimateMinutes(node))}</span>
      ${practical ? html`<span>${practical} ${plural(practical, 'задача', 'задачи', 'задач')} с кодом</span>` : ''}
      ${kinds.includes('case') ? html`<span>есть кейс</span>` : ''}
      ${node.side ? html`<span>боковая ветка</span>` : ''}
    </div>
    ${!open && html`<div class="callout callout-warn"><div class="callout-title">Узел пока закрыт</div>
      <p>Сначала нужно: ${node.reqs.map((r, i) => html`${i ? ', ' : ''}<a href=${`#/node/${r}`}>${course.nodes[r].title}</a>`)}${node.altLevel ? ` · или уровень ${node.altLevel}` : ''}.
      Теорию можно читать уже сейчас.</p>
      <button class="btn small" onClick=${() => setSetting('free', true)}>Включить свободный режим (открыть всё)</button></div>`}
    ${hasTheory && html`<div class="tabs" role="tablist">
      <button role="tab" class=${cls('tab', active === 'theory' && 'active')} onClick=${() => setTab('theory')}>Теория</button>
      <button role="tab" class=${cls('tab', active === 'tasks' && 'active')} onClick=${() => setTab('tasks')}>Задачи · ${st.total}</button>
    </div>`}
    ${active === 'theory' && html`
      ${toc.length > 2 && html`<div class="outcomes"><b>В уроке</b><ul>${toc.map((t) => html`<li>${t}</li>`)}</ul></div>`}
      <${Md} src=${node.theory} className="theory" />
      ${node.sources && node.sources.length && html`<div class="sources"><h3>Источники</h3><ul>
        ${node.sources.map((src) => html`<li><a href=${src.url} target="_blank" rel="noopener">${src.title}</a>${src.note ? html` — <span class="muted">${src.note}</span>` : ''}</li>`)}
      </ul></div>`}
      <div class="node-nav"><button class="btn primary" onClick=${() => setTab('tasks')}>К задачам →</button></div>`}
    ${active === 'tasks' && html`
      ${node.intro && html`<${Md} src=${node.intro} className="theory" />`}
      <div class="tasks-progress"><${Bar} value=${st.solved} max=${st.total} color=${b.color} /><span class="small muted">${st.solved} из ${st.total}</span></div>
      ${open ? node.tasks.map((t, i) => html`<${TaskCard} key=${node.id + i} node=${node} index=${i} task=${t} />`)
        : html`<div class="empty">Задачи откроются, когда будет пройден предыдущий узел.</div>`}
      ${st.done && html`<div class="done-banner">Узел пройден${st.stars ? html` · <${Stars} n=${st.stars} />` : ''}${st.stars < 3 ? html`<div class="small muted">Три звезды — все задачи с первой попытки. Ошибки вернутся в «Повторение».</div>` : ''}</div>`}`}
    <${Notes} key=${id} id=${id} />
    <div class="node-pager">
      ${prev ? html`<a href=${`#/node/${prev.id}`}>← ${prev.title}</a>` : html`<span />`}
      ${next ? html`<a href=${`#/node/${next.id}`}>${next.title} →</a>` : html`<span />`}
    </div>
  </main>`;
}
