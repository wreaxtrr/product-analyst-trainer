import { html, cls, plural } from '../lib.js';
import { course, nodeStats, isUnlocked, allNodesOrdered } from '../content.js';
import { useStore, level } from '../store.js';
import { Bar, Stars } from './common.js';

function reqTitles(node) {
  return node.reqs.map((r) => course.nodes[r].title).join(', ');
}

function NodeCard({ node, s }) {
  const st = nodeStats(node, s);
  const open = isUnlocked(node, s);
  const color = course.branches[node.branch].color;
  return html`<a class=${cls('ncard', !open && 'locked', st.done && 'done')} href=${`#/node/${node.id}`} style=${{ '--bc': color }}>
    <div class="ncard-top">
      <span class="ncard-idx">${node.indexInTrack}</span>
      <span class="ncard-title">${node.title}</span>
      ${!open ? html`<span class="badge">Закрыто</span>` : st.done ? html`<${Stars} n=${st.stars} />` : st.solved ? html`<span class="badge">${st.solved}/${st.total}</span>` : ''}
    </div>
    <div class="ncard-sum">${node.summary}</div>
    ${!open && html`<div class="ncard-req">Сначала нужно: ${reqTitles(node)}${node.altLevel ? ` · или уровень ${node.altLevel}` : ''}</div>`}
  </a>`;
}

export function nextNode(s) {
  for (const n of allNodesOrdered()) {
    if (n.side) continue;
    if (!nodeStats(n, s).done && isUnlocked(n, s)) return n;
  }
  return null;
}

export function MapPage() {
  const s = useStore();
  const next = nextNode(s);
  const totalSolved = Object.values(s.tasks).filter((t) => t.solved).length;
  return html`<main class="page">
    <div class="page-head">
      <div>
        <h1>Карта навыков</h1>
        <p class="muted">Акты идут по порядку, ветки внутри акта открыты параллельно. Между актами стоят испытания. Боковые ветки открываются испытанием или уровнем.</p>
      </div>
      <div class="head-side"><span class="badge big">Уровень ${level(s.xp)}</span></div>
    </div>
    ${next && html`<a class="continue" href=${`#/node/${next.id}${nodeStats(next, s).solved || totalSolved ? '?tab=tasks' : ''}`}>
      <span class="continue-label">${totalSolved ? 'Продолжить' : 'Начать'}</span>
      <span class="continue-title">${next.title}</span>
      <span class="continue-arrow">→</span>
    </a>`}
    ${course.acts.map((act) => {
      const ids = [...act.tracks.flatMap((t) => t.nodes), act.trial];
      const done = ids.filter((id) => nodeStats(course.nodes[id], s).done).length;
      const trial = course.nodes[act.trial];
      const tOpen = isUnlocked(trial, s);
      const tSt = nodeStats(trial, s);
      return html`<section class="act">
        <div class="act-head">
          <div><h2>${act.title}</h2><p class="muted">${act.summary}</p></div>
          <span class="muted small">${done}/${ids.length}</span>
        </div>
        ${act.tracks.map((tr) => {
          const b = course.branches[tr.branch];
          const tdone = tr.nodes.filter((id) => nodeStats(course.nodes[id], s).done).length;
          return html`<div class="track">
            <div class="track-head">
              <span class="dot" style=${{ background: b.color }} />
              <span class="track-title">${b.title}</span>
              ${tr.side && html`<span class="badge">Боковая ветка</span>`}
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
          ${tSt.done ? html`<${Stars} n=${tSt.stars} />` : !tOpen ? html`<span class="badge">Закрыто</span>` : html`<span class="badge">${tSt.solved}/${tSt.total}</span>`}
        </a>
      </section>`;
    })}
  </main>`;
}
