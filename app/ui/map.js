import { html, cls, plural, useState } from '../lib.js';
import { course, nodeStats, isUnlocked, allNodesOrdered } from '../content.js';
import { useStore, level, XP_PER_LEVEL, streak, getState, today } from '../store.js';
import { Bar, Stars } from './common.js';
import { Ring } from './practice.js';
import { dueKeys } from './pages.js';
import { navigate } from '../router.js';

function reqTitles(node) {
  return node.reqs.map((r) => course.nodes[r].title).join(', ');
}

function NodeCard({ node, s }) {
  const st = nodeStats(node, s);
  const open = isUnlocked(node, s);
  const color = course.branches[node.branch].color;
  return html`<a class=${cls('ncard', !open && 'locked', st.done && 'done')} href=${`#/node/${node.id}`} style=${{ '--bc': color }}>
    <div class="ncard-top">
      <span class="ncard-idx">${String(node.indexInTrack).padStart(2, '0')}</span>
      <span class="ncard-title">${node.title}</span>
      ${!open ? html`<span class="badge">🔒</span>` : st.done ? html`<${Stars} n=${st.stars} />` : st.solved ? html`<span class="badge">${st.solved}/${st.total}</span>` : ''}
    </div>
    <div class="ncard-sum">${node.summary}</div>
    ${!open && html`<div class="ncard-req">Сначала: ${reqTitles(node)}${node.altLevel ? ` · или уровень ${node.altLevel}` : ''}</div>`}
  </a>`;
}

export function nextNode(s) {
  for (const n of allNodesOrdered()) {
    if (n.side) continue;
    if (!nodeStats(n, s).done && isUnlocked(n, s)) return n;
  }
  return null;
}

function Hero({ s }) {
  const nodes = allNodesOrdered();
  const done = nodes.filter((n) => nodeStats(n, s).done).length;
  const totalTasks = nodes.reduce((a, n) => a + n.tasks.length, 0);
  const solved = Object.values(s.tasks).filter((t) => t.solved).length;
  const lvl = level(s.xp);
  const due = dueKeys(s).length;
  const train = s.train && s.train.date === today() ? s.train : null;
  const trainDone = train ? Object.keys(train.results).length : 0;
  return html`<section class="hero">
    <div class="hero-level">
      <${Ring} value=${s.xp % XP_PER_LEVEL} max=${XP_PER_LEVEL} size=${84} />
      <div><div class="hero-cap">уровень</div><div class="hero-lv grad-text">${lvl}</div><div class="hero-cap">${s.xp % XP_PER_LEVEL}/${XP_PER_LEVEL} xp</div></div>
    </div>
    <div class="hero-stats">
      <div class="hero-stat"><b>${Math.round((100 * done) / nodes.length)}%</b><span>курса · ${done}/${nodes.length} узлов</span></div>
      <div class="hero-stat"><b>${solved}</b><span>из ${totalTasks} задач</span></div>
      <div class="hero-stat"><b>${streak()} 🔥</b><span>дней подряд</span></div>
      <div class="hero-stat"><b>${due}</b><span>к повторению</span></div>
    </div>
    <div class="hero-cta">
      <a class="btn primary" href="#/practice">${train && trainDone >= train.keys.length ? 'Тренировка закрыта ✓' : 'Тренировка дня →'}</a>
      ${due ? html`<a class="btn" href="#/practice/review">Повторить ${due}</a>` : html`<a class="btn" href="#/practice/exam">Пробный экзамен</a>`}
    </div>
  </section>`;
}

// ───────── Созвездие: каждый акт — схема треков с узлами-звёздами ─────────
function short(t, n = 24) { return t.length > n ? t.slice(0, n - 1) + '…' : t; }

function ActConstellation({ act, s, next }) {
  const W = 1000, laneH = 78, top = 34;
  const H = top + act.tracks.length * laneH + 10;
  const maxLen = Math.max(...act.tracks.map((t) => t.nodes.length));
  const x0 = 190, xTrial = 940, step = (xTrial - x0 - 130) / Math.max(1, maxLen - 1);
  const trial = course.nodes[act.trial];
  const ty = top + (act.tracks.length * laneH) / 2 - laneH / 2 + 18;
  const tSt = nodeStats(trial, s);
  const tOpen = isUnlocked(trial, s);
  const edges = [], stars = [];
  act.tracks.forEach((tr, li) => {
    const b = course.branches[tr.branch];
    const y = top + li * laneH + 18;
    stars.push(html`<text class="cs-lane" x="8" y=${y + 4}>${short(b.title, 20)}</text>`);
    tr.nodes.forEach((id, i) => {
      const n = course.nodes[id];
      const st = nodeStats(n, s);
      const open = isUnlocked(n, s);
      const x = x0 + i * step;
      if (i > 0) edges.push(html`<line class=${cls('cs-edge', st.done && 'lit')} style=${{ '--bc': b.color }} x1=${x - step + 15} y1=${y} x2=${x - 15} y2=${y} />`);
      if (i === tr.nodes.length - 1 && !tr.side) edges.push(html`<path class=${cls('cs-edge', st.done && 'lit')} style=${{ '--bc': b.color }} d=${`M${x + 15},${y} C${x + 90},${y} ${xTrial - 90},${ty} ${xTrial - 20},${ty}`} />`);
      const state = st.done ? 'done' : open ? 'open' : 'locked';
      stars.push(html`<g class=${cls('cs-node', state, next && next.id === id && 'next')} onClick=${() => navigate(`/node/${id}`)} role="link" tabindex="0" aria-label=${n.title}>
        <title>${n.title}${st.done ? ` — пройдено, ${st.stars}★` : open ? ` — ${st.solved}/${st.total}` : ' — закрыто'}</title>
        ${next && next.id === id && html`<circle class="halo" cx=${x} cy=${y} r="20" fill=${b.color} />`}
        <circle class="core" cx=${x} cy=${y} r="13" fill=${st.done ? b.color : 'var(--card-solid)'} stroke=${state === 'locked' ? 'var(--line2)' : b.color} stroke-width="2" style=${st.done ? { filter: `drop-shadow(0 0 8px ${b.color})` } : {}} />
        ${st.done ? html`<text x=${x} y=${y + 4} text-anchor="middle" style="fill:#04111a;font-weight:800;font-size:11px">${st.stars}★</text>` : html`<text x=${x} y=${y + 4} text-anchor="middle" style=${{ fill: state === 'locked' ? 'var(--faint)' : b.color, fontWeight: 700, fontSize: '10.5px', fontFamily: 'var(--mono)' }}>${state === 'locked' ? '·' : `${st.solved}/${st.total}`}</text>`}
        <text x=${x} y=${y + 31} text-anchor="middle">${short(n.title, 22)}</text>
      </g>`);
    });
  });
  stars.push(html`<g class=${cls('cs-node', tSt.done ? 'done' : tOpen ? 'open' : 'locked')} onClick=${() => navigate(`/node/${trial.id}`)} role="link" aria-label=${trial.title}>
    <title>${trial.title}</title>
    <polygon points=${[0, 1, 2, 3, 4].map((k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; const a2 = a + Math.PI / 5; return `${xTrial + 22 * Math.cos(a)},${ty + 22 * Math.sin(a)} ${xTrial + 10 * Math.cos(a2)},${ty + 10 * Math.sin(a2)}`; }).join(' ')}
      fill=${tSt.done ? 'var(--warn)' : 'var(--card-solid)'} stroke="var(--warn)" stroke-width="2" style=${tSt.done ? { filter: 'drop-shadow(0 0 10px var(--warn))' } : {}} />
    <text x=${xTrial} y=${ty + 40} text-anchor="middle" style="font-weight:700">Испытание</text>
  </g>`);
  return html`<div class="constellation"><svg class="tree-svg" viewBox=${`0 0 ${W} ${H}`}>${edges}${stars}</svg></div>`;
}

export function MapPage() {
  const s = useStore();
  const [view, setView] = useState(() => { try { return localStorage.getItem('pat-map-view') || 'list'; } catch (e) { return 'list'; } });
  const setV = (v) => { setView(v); try { localStorage.setItem('pat-map-view', v); } catch (e) { /* приватный режим */ } };
  const next = nextNode(s);
  const totalSolved = Object.values(s.tasks).filter((t) => t.solved).length;
  return html`<main class="page">
    <div class="page-head">
      <div>
        <h1 class="grad">Карта навыков</h1>
        <p class="muted">Пять актов от SQL до уровня мидла. Ветки внутри акта идут параллельно, между актами — испытания. Боковые ветки открываются испытанием или уровнем. Поиск по всему курсу — <a href="#" onClick=${(e) => { e.preventDefault(); dispatchEvent(new CustomEvent('open-palette')); }}>Ctrl+K</a>, термины — в <a href="#/glossary">глоссарии</a>.</p>
      </div>
    </div>
    <${Hero} s=${s} />
    ${next && html`<a class="continue" href=${`#/node/${next.id}${nodeStats(next, s).solved || totalSolved ? '?tab=tasks' : ''}`}>
      <span class="continue-label">${totalSolved ? 'Продолжить' : 'Начать'}</span>
      <span class="continue-title">${next.title}</span>
      <span class="continue-arrow">→</span>
    </a>`}
    <div class="seg view-toggle">${[['list', 'Список'], ['stars', 'Созвездие']].map(([v, t]) => html`<button class=${cls(view === v && 'active')} onClick=${() => setV(v)}>${t}</button>`)}</div>
    ${course.acts.map((act, k) => {
      const ids = [...act.tracks.flatMap((t) => t.nodes), act.trial];
      const done = ids.filter((id) => nodeStats(course.nodes[id], s).done).length;
      const trial = course.nodes[act.trial];
      const tOpen = isUnlocked(trial, s);
      const tSt = nodeStats(trial, s);
      return html`<section class="act">
        <div class="act-head">
          <div><div class="act-num">Акт ${['I', 'II', 'III', 'IV', 'V', 'VI'][k]}</div><h2>${act.title.replace(/^Акт [IVX]+ — /, '')}</h2><p class="muted">${act.summary}</p></div>
          <span class="badge">${done}/${ids.length}</span>
        </div>
        ${view === 'stars' ? html`<${ActConstellation} act=${act} s=${s} next=${next} />` : html`
          ${act.tracks.map((tr) => {
            const b = course.branches[tr.branch];
            const tdone = tr.nodes.filter((id) => nodeStats(course.nodes[id], s).done).length;
            return html`<div class="track">
              <div class="track-head">
                <span class="dot" style=${{ background: b.color, color: b.color }} />
                <span class="track-title">${b.title}</span>
                ${tr.side && html`<span class="badge">боковая</span>`}
                <span class="track-prog"><${Bar} value=${tdone} max=${tr.nodes.length} color=${b.color} /><span class="muted small">${tdone}/${tr.nodes.length}</span></span>
              </div>
              <div class="ncards">${tr.nodes.map((id) => html`<${NodeCard} node=${course.nodes[id]} s=${s} />`)}</div>
            </div>`;
          })}
          <a class=${cls('trial', !tOpen && 'locked', tSt.done && 'done')} href=${`#/node/${trial.id}`}>
            <span class="badge trial-badge">Испытание</span>
            <div class="trial-body">
              <div class="trial-title">${trial.title}</div>
              <div class="muted">${trial.summary}</div>
              <div class="small muted">Закрывает акт и открывает следующий. ${trial.tasks.length} ${plural(trial.tasks.length, 'задание', 'задания', 'заданий')}.${!tOpen ? ` Сначала закрой: ${reqTitles(trial)}.` : ''}</div>
            </div>
            ${tSt.done ? html`<${Stars} n=${tSt.stars} />` : !tOpen ? html`<span class="badge">🔒</span>` : html`<span class="badge">${tSt.solved}/${tSt.total}</span>`}
          </a>`}
      </section>`;
    })}
  </main>`;
}
