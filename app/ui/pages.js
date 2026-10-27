import { html, cls, useState, useMemo, useRef, plural } from '../lib.js';
import { course, nodeStats, findTask, allNodesOrdered, taskKey } from '../content.js';
import {
  useStore, today, level, XP_PER_LEVEL, streak, bestStreak, setSetting, exportJson, importJson, resetAll,
  recordScenario, SRS_STEPS, getState, addDays, setDraft,
} from '../store.js';
import { Bar, Stars, Md, Inline } from './common.js';
import { TaskCard, ResultTable, SchemaPanel, CodeEditor, SqlError, SqlWarnings, PyError, toast, optionOrder } from './tasks.js';
import { runSql, sqlReady, compareResults } from '../engines/sql.js';
import { runPython } from '../engines/py.js';
import { DRILLS, makeDrill } from '../data/drills.js';
import { useSyncStatus, connect, disconnect, syncNow } from '../sync.js';

// ───────── Повторение ─────────
export function dueKeys(s) {
  const t = today();
  return Object.entries(s.srs).filter(([k, c]) => c.due <= t && findTask(k)).map(([k]) => k);
}

export function ReviewPage({ embedded = false }) {
  const s = useStore();
  const [queue] = useState(() => dueKeys(getState()));
  const [pos, setPos] = useState(0);
  const [answered, setAnswered] = useState(false);
  const total = Object.keys(s.srs).length;
  const upcoming = Object.values(s.srs).filter((c) => c.due > today()).length;
  const cur = queue[pos] ? findTask(queue[pos]) : null;
  return html`<${embedded ? 'div' : 'main'} class=${embedded ? '' : 'page'}>
    ${!embedded && html`<h1>Повторение</h1>`}
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${Math.max(queue.length - pos, 0)}</div><div class="stat-l">к повторению сегодня</div></div>
      <div class="stat"><div class="stat-v">${total}</div><div class="stat-l">карточек всего</div></div>
      <div class="stat"><div class="stat-v">${upcoming}</div><div class="stat-l">ждут своего дня</div></div>
      <div class="stat"><div class="stat-v small-v">${SRS_STEPS.join(' / ')} д</div><div class="stat-l">интервалы</div></div>
    </div>
    <p class="muted">Задачи, где первая попытка была неверной, возвращаются сюда через ${SRS_STEPS.join(', ')} дней. Верный ответ двигает карточку дальше, ошибка — возвращает к началу.</p>
    ${cur ? html`<div class="review-card">
        <div class="small muted">${pos + 1} из ${queue.length} · <a href=${`#/node/${cur.node.id}`}>${cur.node.title}</a></div>
        <${TaskCard} key=${queue[pos]} node=${cur.node} index=${cur.index} task=${cur.task} mode="review" onAnswered=${() => setAnswered(true)} />
        <div class="task-actions"><button class="btn primary" disabled=${!answered} onClick=${() => { setPos(pos + 1); setAnswered(false); window.scrollTo(0, 0); }}>Дальше →</button></div>
      </div>`
    : html`<div class="empty big">${queue.length ? 'Готово! На сегодня всё повторено.' : 'На сегодня повторять нечего.'}</div>`}
  <//>`;
}

// ───────── Прогресс ─────────
function Heatmap({ days }) {
  const set = new Set(days);
  const weeks = 16;
  const t = today();
  const end = new Date();
  const dow = (end.getDay() + 6) % 7;
  const start = addDays(t, -(weeks * 7 - 1) - (6 - dow));
  const cells = [];
  for (let i = 0; i < weeks * 7 + (6 - dow) + 1 && cells.length < weeks * 7 + 7; i++) {
    const d = addDays(start, i);
    if (d > t) break;
    cells.push(d);
  }
  return html`<div class="heatmap">${cells.map((d) => html`<span class=${cls('hm', set.has(d) && 'on')} title=${d} />`)}</div>`;
}

export const SKILLS = [
  ['SQL', ['sql']], ['Статистика', ['stats']], ['Метрики', ['metrics', 'unit', 'growth']], ['A/B-тесты', ['ab']],
  ['Python', ['python']], ['ML', ['ml']], ['Data Science', ['ds']], ['Причинность', ['causal']],
  ['Продукт', ['product', 'viz', 'voc', 'monitoring']], ['Данные', ['data', 'eng']], ['Собеседование', ['interview', 'tbank', 'trials']],
];

function Radar({ s }) {
  const vals = SKILLS.map(([name, brs]) => {
    let total = 0, solved = 0;
    for (const n of allNodesOrdered()) {
      if (!brs.includes(n.branch)) continue;
      n.tasks.forEach((_, i) => { total++; const t = s.tasks[taskKey(n.id, i)]; if (t && t.solved) solved++; });
    }
    return [name, total ? solved / total : 0];
  });
  const W = 520, H = 400, cx = W / 2, cy = H / 2 + 6, R = 140, k = vals.length;
  const pt = (i, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / k; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = vals.map(([, v], i) => pt(i, R * Math.max(0.02, v)).join(',')).join(' ');
  return html`<svg class="radar chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Радар навыков">
    
    ${[0.25, 0.5, 0.75, 1].map((f) => html`<polygon points=${vals.map((_, i) => pt(i, R * f).join(',')).join(' ')} fill="none" stroke="var(--line2)" stroke-dasharray=${f < 1 ? '3 4' : ''} />`)}
    ${vals.map((_, i) => { const [x, y] = pt(i, R); return html`<line x1=${cx} y1=${cy} x2=${x} y2=${y} stroke="var(--line)" />`; })}
    <polygon points=${poly} fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" />
    ${vals.map(([name, v], i) => { const [x, y] = pt(i, R + 26); return html`<text x=${x} y=${y} text-anchor="middle">${name} · ${Math.round(100 * v)}%</text>`; })}
  </svg>`;
}

export function ProgressPage() {
  const s = useStore();
  const nodes = allNodesOrdered();
  const stats = nodes.map((n) => ({ n, st: nodeStats(n, s) }));
  const stars = stats.reduce((a, x) => a + x.st.stars, 0);
  const passed = stats.filter((x) => x.st.done).length;
  const lvl = level(s.xp);
  const branchRows = Object.values(course.branches).map((b) => {
    const bn = stats.filter((x) => x.n.branch === b.id);
    return { b, done: bn.filter((x) => x.st.done).length, total: bn.length, stars: bn.reduce((a, x) => a + x.st.stars, 0) };
  });
  const weak = stats.map(({ n }) => {
    let tried = 0, first = 0, attempts = 0;
    n.tasks.forEach((_, i) => { const t = s.tasks[taskKey(n.id, i)]; if (t) { tried++; attempts += t.attempts; if (t.first) first++; } });
    return { n, tried, rate: tried ? first / tried : 1, attempts };
  }).filter((x) => x.tried && x.rate < 1).sort((a, b) => a.rate - b.rate).slice(0, 8);
  return html`<main class="page">
    <h1>Прогресс</h1>
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${lvl}</div><div class="stat-l">уровень</div><${Bar} value=${s.xp % XP_PER_LEVEL} max=${XP_PER_LEVEL} /><div class="small muted">${s.xp % XP_PER_LEVEL} / ${XP_PER_LEVEL}</div></div>
      <div class="stat"><div class="stat-v">${s.xp}</div><div class="stat-l">опыт</div></div>
      <div class="stat"><div class="stat-v">${streak()}</div><div class="stat-l">серия дней · лучшая ${bestStreak()}</div></div>
      <div class="stat"><div class="stat-v">${stars}<span class="muted small">/${nodes.length * 3}</span></div><div class="stat-l">звёзды</div></div>
      <div class="stat"><div class="stat-v">${passed}<span class="muted small">/${nodes.length}</span></div><div class="stat-l">узлов пройдено</div></div>
    </div>
    <h2>Радар навыков</h2>
    <p class="muted small">Доля решённых задач по направлениям. Цель мидла — заполненный многоугольник без провалов.</p>
    <${Radar} s=${s} />
    <h2>Активность</h2>
    <${Heatmap} days=${s.days} />
    <h2>По веткам</h2>
    <div class="branch-rows">${branchRows.map((r) => html`<div class="branch-row">
      <span class="dot" style=${{ background: r.b.color }} /><span class="br-title">${r.b.title}</span>
      <${Bar} value=${r.done} max=${r.total} color=${r.b.color} /><span class="small muted">${r.done}/${r.total} · ${r.stars}/${r.total * 3} ★</span>
    </div>`)}</div>
    <h2>Слабые места</h2>
    ${weak.length ? html`<p class="muted">Узлы, где больше всего ошибок с первой попытки.</p>
      <div class="table-wrap"><table><thead><tr><th>Узел</th><th>С первой попытки</th><th>Попыток</th></tr></thead><tbody>
      ${weak.map((w) => html`<tr><td><a href=${`#/node/${w.n.id}?tab=tasks`}>${w.n.title}</a></td><td>${Math.round(w.rate * 100)}%</td><td>${w.attempts}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Пока ошибок нет — или ты ещё не начинал.</p>`}
  </main>`;
}

// ───────── Синхронизация между устройствами ─────────
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Product%20Analyst%20Trainer';

function fmtTime(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `сегодня в ${hm}` : `${d.toLocaleDateString('ru-RU')} в ${hm}`;
}

function SyncPanel() {
  const st = useSyncStatus();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const onConnect = async () => {
    setBusy(true); setErr('');
    try { await connect(token); setToken(''); toast('Синхронизация включена'); } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  if (st.state === 'off') {
    return html`<section class="panel">
      <h3>Синхронизация между устройствами</h3>
      <p class="small muted">Прогресс будет храниться в приватном GitHub Gist и сам подтягиваться на телефоне и компьютере. Если решал на обоих, прогресс объединится: задачи, опыт, повторение и заметки не потеряются.</p>
      <ol class="small" style="padding-left:20px;margin:8px 0">
        <li>Открой <a href=${TOKEN_URL} target="_blank" rel="noopener">создание токена на GitHub</a> (нужно войти в аккаунт). Галочка уже стоит только на <b>gist</b> — больше ничего не отмечай.</li>
        <li>В поле <b>Expiration</b> выбери срок, например год, внизу нажми <b>Generate token</b> и скопируй токен (начинается с <code>ghp_</code>).</li>
        <li>Вставь его сюда и нажми «Подключить». На втором устройстве сделай то же самое — можно с тем же токеном.</li>
      </ol>
      <div class="num-row">
        <input class="input" type="password" autocomplete="off" placeholder="ghp_…" value=${token} onInput=${(e) => setToken(e.target.value)} style="flex:1;min-width:0" />
        <button class="btn primary" disabled=${busy || !token.trim()} onClick=${onConnect}>${busy ? 'Подключаю…' : 'Подключить'}</button>
      </div>
      ${err && html`<div class="verdict bad">${err}</div>`}
      <p class="small muted">Токен хранится только в этом браузере и не попадает в экспорт прогресса. Право gist даёт доступ только к твоим gist-заметкам, не к репозиториям и не к аккаунту. Отозвать токен можно в любой момент в настройках GitHub.</p>
    </section>`;
  }
  return html`<section class="panel">
    <h3>Синхронизация между устройствами</h3>
    <p>${st.state === 'busy' ? 'Синхронизирую…' : st.state === 'error' ? html`<span style="color:var(--bad)">${st.error}</span>` : st.last ? `Синхронизировано ${fmtTime(st.last)}` : 'Подключено'}</p>
    <p class="small muted">Прогресс подтягивается при открытии тренажёра и при возвращении на вкладку, а отправляется через несколько секунд после каждого изменения. Тема и эффекты у каждого устройства свои.${st.gistId ? html` Файл прогресса — <a href=${`https://gist.github.com/${st.gistId}`} target="_blank" rel="noopener">приватный gist</a>.` : ''}</p>
    <div class="task-actions">
      <button class="btn primary" disabled=${st.state === 'busy'} onClick=${() => syncNow()}>Синхронизировать сейчас</button>
      <button class="btn ghost" onClick=${() => { if (confirm('Отключить синхронизацию на этом устройстве? Прогресс здесь и в gist останется.')) disconnect(); }}>Отключить на этом устройстве</button>
    </div>
  </section>`;
}

// ───────── Настройки ─────────
export function SettingsPage() {
  const s = useStore();
  const onImport = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => { try { importJson(t); syncNow({ force: true }); toast('Прогресс загружен'); } catch (err) { toast(err.message); } });
    e.target.value = '';
  };
  const onExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `analyst-trainer-progress-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const seg = (k, opts) => html`<div class="seg">${opts.map(([v, t]) => html`<button class=${cls(s.settings[k] === v && 'active')} onClick=${() => setSetting(k, v)}>${t}</button>`)}</div>`;
  return html`<main class="page narrow">
    <h1>Настройки</h1>
    <section class="panel">
      <h3>Тема</h3>
      ${seg('theme', [['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Как в системе']])}
      <h3>Режим прохождения</h3>
      ${seg('free', [[false, 'По порядку'], [true, 'Свободный: всё открыто']])}
      <p class="small muted">В свободном режиме можно сразу решать любой узел — удобно, если часть тем уже знаешь.</p>
      <h3>Эффекты</h3>
      ${seg('fx', [[true, 'Анимации и конфетти'], [false, 'Спокойный режим']])}
    </section>
    <${SyncPanel} />
    <section class="panel">
      <h3>Прогресс</h3>
      <p class="small muted">Хранится в браузере (localStorage). Без синхронизации перенести его можно файлом: экспорт здесь, импорт на другом устройстве. Импорт заменяет прогресс, а не объединяет.</p>
      <div class="task-actions">
        <button class="btn primary" onClick=${onExport}>Экспорт прогресса</button>
        <label class="btn">Импорт прогресса<input type="file" accept="application/json" hidden onChange=${onImport} /></label>
        <button class="btn danger" onClick=${() => { if (confirm('Стереть весь прогресс? Это нельзя отменить. Если включена синхронизация, прогресс сотрётся и на других устройствах.')) { resetAll(); syncNow({ force: true }); toast('Прогресс стёрт'); } }}>Стереть прогресс</button>
      </div>
      <p class="small muted">Опыт ${s.xp} · задач с попытками ${Object.keys(s.tasks).length} · карточек повторения ${Object.keys(s.srs).length} · черновиков ${Object.keys(s.drafts).length}</p>
    </section>
    <section class="panel">
      <h3>Для автора</h3>
      <p class="small muted"><a href="#/selftest">Самопроверка контента</a> — прогоняет все эталонные решения и показывает, какие задачи сломаны.</p>
    </section>
  </main>`;
}

// ───────── Тренажёр выбора метрик ─────────
export function MetricsPage({ id }) {
  const s = useStore();
  const list = course.scenarios;
  if (id) {
    const sc = list.find((x) => x.id === id);
    if (!sc) return html`<main class="page"><a href="#/metrics">← ко всем сценариям</a><h1>Нет такого сценария</h1></main>`;
    return html`<${Scenario} key=${id} sc=${sc} />`;
  }
  const solved = list.filter((x) => s.scen[x.id]).length;
  return html`<main class="page">
    <h1>Тренажёр выбора метрик</h1>
    <p class="muted">Продуктовый сценарий и три решения: по какой метрике принимать решение, что смотреть как быструю прокси и что не должно сломаться. Самый частый вопрос на продуктовом собеседовании.</p>
    <div class="small muted">Разобрано: ${solved}/${list.length}</div>
    <div class="scen-list">${list.map((sc) => {
      const r = s.scen[sc.id];
      const from = sc.node && course.nodes[sc.node];
      return html`<a class="scen-card" href=${`#/metrics/${sc.id}`}>
        <div class="scen-top"><span class="scen-title">${sc.title}</span>${r ? html`<span class="badge ok">${r.score}/${r.max}</span>` : ''}</div>
        ${from && html`<div class="small muted">Из узла: ${from.title}</div>`}
        <div class="scen-text">${sc.text.replace(/\s+/g, ' ').slice(0, 220)}${sc.text.length > 220 ? '…' : ''}</div>
      </a>`;
    })}</div>
  </main>`;
}

function Scenario({ sc }) {
  const [ans, setAns] = useState({});
  const [done, setDone] = useState(false);
  const qs = sc.questions;
  const score = qs.filter((q, i) => ans[i] === q.answer).length;
  const submit = () => { setDone(true); recordScenario(sc.id, score, qs.length); };
  return html`<main class="page narrow">
    <a href="#/metrics" class="small">← ко всем сценариям</a>
    <h1>${sc.title}</h1>
    <${Md} src=${sc.text} className="theory" />
    ${qs.map((q, i) => html`<section class="task">
      <div class="task-head"><span class="task-num">${q.role}</span></div>
      ${q.q && html`<${Md} src=${q.q} />`}
      <div class="options">${optionOrder(q.options.length, `${sc.id}#${i}`).map((j) => {
        const o = q.options[j];
        const chosen = ans[i] === j;
        const mark = done ? (j === q.answer ? 'right' : chosen ? 'wrong' : '') : '';
        return html`<button class=${cls('option', chosen && 'chosen', mark)} disabled=${done} onClick=${() => setAns({ ...ans, [i]: j })}>
          <span class="opt-mark rd" /><span class="opt-text"><${Inline} text=${o} /></span></button>`;
      })}</div>
      ${done && q.explain && html`<div class="explain"><${Md} src=${q.explain} /></div>`}
    </section>`)}
    ${!done ? html`<div class="task-actions"><button class="btn primary" disabled=${Object.keys(ans).length < qs.length} onClick=${submit}>Проверить выбор</button></div>`
    : html`<div class=${cls('verdict', score === qs.length ? 'good' : score ? 'mid' : 'bad')}>Верно ${score} из ${qs.length}</div>
      ${sc.summary && html`<div class="explain"><div class="explain-title">Итог</div><${Md} src=${sc.summary} /></div>`}
      <div class="task-actions"><button class="btn" onClick=${() => { setAns({}); setDone(false); window.scrollTo(0, 0); }}>Пройти ещё раз</button><a class="btn ghost" href="#/metrics">К списку</a></div>`}
  </main>`;
}

// ───────── Песочница ─────────
const SANDBOX_SQL = `-- Песочница: любые SELECT-запросы к данным «Корзинки».
-- Ctrl+Enter — выполнить.
SELECT platform, COUNT(*) AS users
FROM users
GROUP BY platform
ORDER BY users DESC`;
const SANDBOX_PY = `# Все таблицы доступны как DataFrame: users, events, orders, items,
# experiment_users, marketing_spend, churn_features, promo_campaign,
# reviews, payments, delivery_fee_test, daily_orders.
# Ctrl+Enter — выполнить. Последнее значение result показывается ниже.
result = orders.groupby('status')['revenue'].describe()`;

let draftTimer = null;

export function SandboxPage() {
  const s = useStore();
  const [lang, setLang] = useState('sql');
  const [code, setCode] = useState({ sql: s.drafts['__sandbox_sql'] ?? SANDBOX_SQL, python: s.drafts['__sandbox_py'] ?? SANDBOX_PY });
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState(null);
  const ed = useRef(null);
  const run = async () => {
    setOut(null);
    const sel = lang === 'sql' && ed.current ? ed.current.selection() : null;
    const src = sel ? sel.text : (ed.current && lang === 'sql' ? ed.current.value() : code.sql);
    try {
      if (lang === 'sql') {
        setBusy(sqlReady() ? 'Выполняю…' : 'Загружаю движок…');
        const r = await runSql(src);
        setOut({ sql: r, partial: !!sel, src });
      } else {
        const r = await runPython({ code: code.python, variable: 'result', onlyRun: true, packages: /sklearn/.test(code.python) ? ['scikit-learn'] : /scipy/.test(code.python) ? ['scipy'] : [] }, setBusy);
        setOut({ py: r });
      }
    } catch (e) { setOut({ err: String(e.message || e), src, base: sel ? sel.from : 0 }); }
    setBusy('');
  };
  const change = (v) => {
    setCode((c) => ({ ...c, [lang]: v }));
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => setDraft(lang === 'sql' ? '__sandbox_sql' : '__sandbox_py', v), 400);
  };
  return html`<main class="page">
    <h1>Песочница</h1>
    <p class="muted">Свободные запросы к тем же данным, на которых построены задачи: сервис доставки продуктов «Корзинка», январь–июль 2024.</p>
    <div class="seg">${[['sql', 'SQL (DuckDB)'], ['python', 'Python (pandas)']].map(([v, t]) => html`<button class=${cls(lang === v && 'active')} onClick=${() => { setLang(v); setOut(null); }}>${t}</button>`)}</div>
    <${SchemaPanel} open=${false} />
    <${CodeEditor} value=${code[lang]} onChange=${change} onRun=${run} onCheck=${run} lang=${lang} api=${ed} name=${lang === 'sql' ? 'sandbox.sql' : 'sandbox.py'} />
    <div class="task-actions"><button class="btn primary" onClick=${run} disabled=${!!busy}>Выполнить</button>${busy && html`<span class="busy"><span class="spinner" />${busy}</span>`}</div>
    ${out && out.err && (lang === 'sql' ? html`<${SqlError} msg=${out.err} sql=${out.src} base=${out.base} api=${ed} />` : html`<div class="verdict bad"><${PyError} err=${out.err} api=${ed} /></div>`)}
    ${out && out.sql && html`<${SqlWarnings} sql=${out.src} /><div class="hint">${out.partial ? 'Выполнен выделенный фрагмент · ' : ''}${out.sql.rows.length} строк · ${Math.round(out.sql.ms)} мс</div><${ResultTable} cols=${out.sql.cols} rows=${out.sql.rows} limit=${200} />`}
    ${out && out.py && html`${out.py.err && html`<${PyError} err=${out.py.err} api=${ed} />`}${out.py.out && html`<div class="out-label">Вывод</div><pre class="out">${out.py.out}</pre>`}${out.py.preview && html`<div class="out-label">result =</div><pre class="out">${out.py.preview}</pre>`}`}
  </main>`;
}

// ───────── Глоссарий ─────────
export function GlossaryPage({ q: q0 = '' }) {
  const [q, setQ] = useState(q0);
  const terms = useMemo(() => [...course.glossary].sort((a, b) => a.term.localeCompare(b.term, 'ru')), []);
  const ql = q.trim().toLowerCase();
  const list = ql ? terms.filter((t) => t.term.toLowerCase().includes(ql) || t.def.toLowerCase().includes(ql)) : terms;
  return html`<main class="page narrow">
    <h1 class="grad">Глоссарий</h1>
    <p class="muted">${terms.length} терминов уровня мидла — коротко и со ссылкой на урок, где тема разобрана подробно. Удобно повторять перед собеседованием.</p>
    <input class="input glossary-search" placeholder="Поиск по терминам и определениям…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="glossary">${list.map((t) => {
      const n = course.nodes[t.node];
      return html`<div class="gl-item" id=${'t-' + t.term}>
        <div class="gl-term">${t.term}</div>
        <div class="gl-def"><${Inline} text=${t.def} /></div>
        ${n && html`<a class="gl-link small" href=${`#/node/${n.id}`}>→ ${n.title}</a>`}
      </div>`;
    })}</div>
    ${!list.length && html`<div class="empty">Ничего не нашлось</div>`}
  </main>`;
}

// ───────── Самопроверка контента ─────────
export function SelfTestPage() {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [withPy, setWithPy] = useState(true);
  const run = async () => {
    setRunning(true);
    const out = [];
    const push = (r) => { out.push(r); setRows([...out]); };
    for (const n of allNodesOrdered()) {
      if (!n.tasks.length) push({ id: n.id, i: '-', ok: false, msg: 'нет задач' });
      for (let i = 0; i < n.tasks.length; i++) {
        const t = n.tasks[i];
        try {
          if (t.type === 'single') {
            if (!(t.answer >= 0 && t.answer < t.options.length)) throw new Error('answer вне диапазона');
          } else if (t.type === 'multi') {
            if (!Array.isArray(t.answer) || t.answer.some((a) => a < 0 || a >= t.options.length)) throw new Error('answer вне диапазона');
          } else if (t.type === 'number') {
            if (typeof t.answer !== 'number') throw new Error('answer не число');
          } else if (t.type === 'sql') {
            const r = await runSql(t.solution);
            if (!r.rows.length) throw new Error('эталон вернул 0 строк');
            // Заготовка не должна сама по себе проходить проверку — иначе задача решается нажатием кнопки.
            if (t.starter) {
              let same = false;
              try { same = compareResults(await runSql(t.starter), r, { ordered: !!t.ordered, tol: t.tol ?? 1e-4 }).ok; } catch (e) { /* заготовка с ошибкой — это нормально */ }
              if (same) throw new Error('заготовка уже даёт верный ответ');
            }
            push({ id: n.id, i, ok: true, msg: `${r.rows.length} строк · ${r.cols.join(', ')} · первая: ${JSON.stringify(r.rows[0]).slice(0, 120)}` });
            continue;
          } else if (t.type === 'python') {
            if (!withPy) { push({ id: n.id, i, ok: true, msg: 'пропущено' }); continue; }
            const r = await runPython({ code: t.solution, solution: t.solution, test: t.test, variable: t.variable === undefined ? 'result' : t.variable, ordered: t.ordered !== false, tol: t.tol ?? 1e-4, packages: t.packages || [] }, () => {});
            if (!r.ok) throw new Error((r.msg || '') + ' ' + (r.err || ''));
            push({ id: n.id, i, ok: true, msg: (r.preview || '').split('\n').slice(0, 2).join(' | ').slice(0, 140) });
            continue;
          } else if (t.type === 'case') {
            if (!Array.isArray(t.steps) || !t.steps.length) throw new Error('у кейса нет шагов');
            t.steps.forEach((st, j) => { if (!(st.answer >= 0 && st.answer < st.options.length)) throw new Error(`шаг ${j + 1}: answer вне диапазона`); });
          } else if (t.type === 'order') {
            if (!Array.isArray(t.items) || t.items.length < 3) throw new Error('в order нужно хотя бы 3 элемента');
          } else throw new Error('неизвестный тип ' + t.type);
          push({ id: n.id, i, ok: true, msg: t.type });
        } catch (e) {
          push({ id: n.id, i, ok: false, msg: String(e.message || e) });
        }
      }
    }
    for (let i = 0; i < DRILLS.length; i++) {
      for (const seed of [11, 222, 3333]) {
        const d = makeDrill(i, seed);
        try {
          const r = await runSql(d.sql);
          if (!r.rows.length) throw new Error('эталон вернул 0 строк');
          if (r.rows.some((row) => row.some((v) => v === null || Number.isNaN(v)))) throw new Error('в эталоне NULL: ' + JSON.stringify(r.rows[0]));
          push({ id: 'drill:' + d.id, i: '-', ok: true, msg: `${r.rows.length} строк · ${JSON.stringify(r.rows[0]).slice(0, 100)}` });
        } catch (e) { push({ id: 'drill:' + d.id, i: '-', ok: false, msg: String(e.message || e) }); }
      }
    }
    for (const t of course.glossary) {
      if (!course.nodes[t.node]) push({ id: 'glossary:' + t.term, i: '-', ok: false, msg: `нет узла ${t.node}` });
    }
    push({ id: 'glossary', i: '-', ok: true, msg: `${course.glossary.length} терминов` });
    for (const sc of course.scenarios) {
      if (sc.node && !course.nodes[sc.node]) push({ id: 'scenario:' + sc.id, i: '-', ok: false, msg: `нет узла ${sc.node}` });
      const bad = sc.questions.filter((q) => !(q.answer >= 0 && q.answer < q.options.length));
      push({ id: 'scenario:' + sc.id, i: '-', ok: !bad.length, msg: bad.length ? 'answer вне диапазона' : `${sc.questions.length} вопроса` });
    }
    setRunning(false);
  };
  const fails = rows.filter((r) => !r.ok);
  return html`<main class="page">
    <h1>Самопроверка контента</h1>
    <p class="muted">Выполняет эталонные SQL- и Python-решения и проверяет, что у квизов корректные ответы.</p>
    <label class="small"><input type="checkbox" checked=${withPy} onChange=${(e) => setWithPy(e.target.checked)} /> Проверять Python (долго: грузится Pyodide и scikit-learn)</label>
    <div class="task-actions"><button class="btn primary" disabled=${running} onClick=${run}>Запустить</button>
      <span class="small muted" id="selftest-status">${running ? 'Идёт проверка…' : rows.length ? `Готово: ${rows.length} проверок, ошибок ${fails.length}` : ''}</span></div>
    ${fails.length ? html`<h2>Ошибки</h2><div class="table-wrap"><table><tbody>${fails.map((r) => html`<tr class="bad-row"><td>${r.id}</td><td>${r.i}</td><td><pre class="err">${r.msg}</pre></td></tr>`)}</tbody></table></div>` : ''}
    <h2>Все проверки</h2>
    <div class="table-wrap"><table><tbody>${rows.map((r) => html`<tr class=${r.ok ? '' : 'bad-row'}><td>${r.ok ? '✓' : '✗'}</td><td>${r.id}</td><td>${r.i}</td><td class="small">${r.msg}</td></tr>`)}</tbody></table></div>
  </main>`;
}
