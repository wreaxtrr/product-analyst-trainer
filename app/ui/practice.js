import { html, useState, useEffect, useMemo, useRef, cls } from '../lib.js';
import { course, findTask, taskKey, allNodesOrdered, isUnlocked, nodeStats } from '../content.js';
import { useStore, getState, today, setTrain, recordExam, recordDrill } from '../store.js';
import { mulberry32 } from '../data/generate.js';
import { randomDrill } from '../data/drills.js';
import { runSql, compareResults, sqlReady } from '../engines/sql.js';
import { TaskCard, CodeEditor, ResultTable, SchemaPanel } from './tasks.js';
import { Md, Bar } from './common.js';
import { ReviewPage, dueKeys } from './pages.js';
import { navigate } from '../router.js';

const TABS = [['today', 'Тренировка дня'], ['review', 'Повторение'], ['exam', 'Экзамен'], ['marathon', 'SQL-марафон']];

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffle(arr, rnd) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function PracticePage({ tab = 'today' }) {
  const s = useStore();
  const due = dueKeys(s).length;
  return html`<main class="page">
    <div class="page-head"><div>
      <h1>Практика</h1>
      <p class="muted">Закрепление навыков: короткая тренировка каждый день, повторение ошибок по интервалам, пробные собеседования и бесконечный SQL-марафон на данных «Корзинки».</p>
    </div></div>
    <div class="tabs" role="tablist">${TABS.map(([id, t]) => html`<button role="tab" class=${cls('tab', tab === id && 'active')} onClick=${() => navigate(id === 'today' ? '/practice' : `/practice/${id}`)}>${t}${id === 'review' && due ? html` <span class="pill">${due}</span>` : ''}</button>`)}</div>
    ${tab === 'today' && html`<${DailyTraining} />`}
    ${tab === 'review' && html`<${ReviewPage} embedded=${true} />`}
    ${tab === 'exam' && html`<${Exam} />`}
    ${tab === 'marathon' && html`<${Marathon} />`}
  </main>`;
}

// ───────── Тренировка дня ─────────
function buildTraining(s) {
  const day = today();
  const rnd = mulberry32(hashStr(day));
  const all = allNodesOrdered();
  const keys = [];
  const add = (k) => { if (!keys.includes(k) && findTask(k)) keys.push(k); };
  // 1. карточки повторения на сегодня
  shuffle(dueKeys(s), rnd).slice(0, 3).forEach(add);
  // 2. давно не повторённые решённые задачи
  const solved = Object.entries(s.tasks).filter(([k, t]) => t.solved && findTask(k)).map(([k, t]) => {
    const p = s.practice[k];
    return { k, age: p ? (Date.parse(day) - Date.parse(p.day)) / 864e5 : 999, py: findTask(k).task.type === 'python' };
  });
  const stale = shuffle(solved.filter((x) => x.age >= 3 && !x.py), rnd).sort((a, b) => b.age - a.age);
  stale.slice(0, 8 - keys.length).forEach((x) => add(x.k));
  // 3. если мало — задачи из открытых, но ещё не пройденных узлов
  if (keys.length < 8) {
    const frontier = all.filter((n) => isUnlocked(n, s) && !nodeStats(n, s).done);
    const pool = [];
    frontier.forEach((n) => n.tasks.forEach((t, i) => { const k = taskKey(n.id, i); if (t.type !== 'python' && !(s.tasks[k] && s.tasks[k].solved)) pool.push(k); }));
    shuffle(pool, rnd).slice(0, 8 - keys.length).forEach(add);
  }
  return { date: day, keys, results: {} };
}

function DailyTraining() {
  const s = useStore();
  const [train, setLocal] = useState(() => {
    const t = getState().train;
    if (t && t.date === today() && t.keys.length) return t;
    const fresh = buildTraining(getState());
    setTrain(fresh);
    return fresh;
  });
  const [pos, setPos] = useState(() => Math.min(Object.keys(train.results).length, train.keys.length));
  const [answered, setAnswered] = useState(false);
  const modes = useRef({});
  const done = Object.keys(train.results).length;
  const correct = Object.values(train.results).filter(Boolean).length;
  const onAnswered = (key) => (ok) => {
    const t = { ...train, results: { ...train.results, [key]: ok } };
    setLocal(t); setTrain(t); setAnswered(true);
  };
  if (!train.keys.length) return html`<div class="empty big">Пока нечего тренировать — реши несколько задач на карте, и здесь появится ежедневная подборка.</div>`;
  const key = train.keys[pos];
  const cur = key && findTask(key);
  // Режим карточки фиксируется при показе: иначе ошибка (которая кладёт задачу в повторение)
  // переключала бы её в режим повторения, и повторная попытка засчитывалась как успешное повторение.
  if (key && !(key in modes.current)) modes.current[key] = s.srs[key] ? 'review' : 'practice';
  const inSrs = key && modes.current[key] === 'review';
  return html`
    <div class="train-head">
      <div class="ring-wrap"><${Ring} value=${done} max=${train.keys.length} /><div><div class="stat-v">${done}/${train.keys.length}</div><div class="stat-l">задач сегодня · верно ${correct}</div></div></div>
      <p class="muted small">Подборка обновляется каждый день: ошибки из повторения, давно решённые задачи (чтобы навык не выветривался) и новые задачи с текущего фронта карты. Ошибка здесь отправляет задачу в «Повторение».</p>
    </div>
    ${cur ? html`<div class="review-card">
        <div class="small muted">${pos + 1} из ${train.keys.length} · <a href=${`#/node/${cur.node.id}`}>${cur.node.title}</a>${inSrs ? ' · из повторения' : ''}</div>
        <${TaskCard} key=${key} node=${cur.node} index=${cur.index} task=${cur.task} mode=${inSrs ? 'review' : 'practice'} onAnswered=${onAnswered(key)} />
        <div class="task-actions"><button class="btn primary" disabled=${!answered && !(key in train.results)} onClick=${() => { setPos(pos + 1); setAnswered(false); window.scrollTo(0, 0); }}>Дальше →</button>
          ${!(key in train.results) && html`<button class="btn ghost" onClick=${() => { onAnswered(key)(false); setPos(pos + 1); setAnswered(false); }}>Пропустить</button>`}</div>
      </div>`
    : html`<div class="done-banner big">Тренировка дня закрыта: ${correct} из ${train.keys.length} верно. Возвращайся завтра — серия дней растёт.</div>`}`;
}

export function Ring({ value, max, size = 64 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, p = max ? value / max : 0;
  return html`<svg class="ring" width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`}>
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="ring-bg" />
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="ring-fg" stroke-dasharray=${`${c * p} ${c}`} transform=${`rotate(-90 ${size / 2} ${size / 2})`} />
  </svg>`;
}

// ───────── Экзамен ─────────
const FORMATS = [
  { id: 'sql', title: 'SQL-секция', desc: '5 SQL-задач разной сложности', minutes: 40, pick: { sql: 5 } },
  { id: 'stats', title: 'Статистика и A/B', desc: '12 вопросов и расчётов по статистике, экспериментам и метрикам', minutes: 25, pick: { quiz: 12 }, branches: ['stats', 'ab', 'metrics', 'unit', 'interview', 'causal', 'monitoring'] },
  { id: 'product', title: 'Продуктовый кейс', desc: '8 вопросов: метрики, кейсы, приоритизация, причинность', minutes: 25, pick: { quiz: 8 }, branches: ['metrics', 'product', 'causal', 'viz', 'unit', 'growth', 'voc', 'eng', 'tbank'] },
  { id: 'tbank', title: 'Тест Т-Банка', desc: '12 вопросов: SQL-ловушки, логика, вероятность, продуктовые кейсы', minutes: 20, pick: { quiz: 12 }, branches: ['tbank'] },
  { id: 'ml', title: 'ML и Data Science', desc: '8 вопросов + 1 задача на Python', minutes: 35, pick: { quiz: 8, python: 1 }, branches: ['ml', 'ds', 'python'] },
  { id: 'full', title: 'Полный мок-интервью', desc: '3 SQL + 10 вопросов + 1 Python', minutes: 70, pick: { sql: 3, quiz: 10, python: 1 } },
];

function buildExam(fmt, onlyLearned, seed) {
  const s = getState();
  const rnd = mulberry32(seed);
  const pools = { sql: [], quiz: [], python: [] };
  for (const n of allNodesOrdered()) {
    if (fmt.branches && !fmt.branches.includes(n.branch) && !n.isTrial) continue;
    if (onlyLearned && !isUnlocked(n, s)) continue;
    n.tasks.forEach((t, i) => {
      const k = taskKey(n.id, i);
      const kind = t.type === 'sql' ? 'sql' : t.type === 'python' ? 'python' : 'quiz';
      pools[kind].push(k);
    });
  }
  const keys = [];
  for (const [kind, n] of Object.entries(fmt.pick)) keys.push(...shuffle(pools[kind], rnd).slice(0, n));
  return shuffle(keys, rnd);
}

function Exam() {
  const s = useStore();
  const [run, setRun] = useState(null);
  const [onlyLearned, setOnlyLearned] = useState(() => Object.values(getState().tasks).filter((t) => t.solved).length >= 15);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!run || run.finished) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [run]);
  const start = (fmt) => {
    const keys = buildExam(fmt, onlyLearned && !getState().settings.free, Date.now() & 0xffffffff);
    if (!keys.length) { alert('В открытых узлах пока нет подходящих задач. Сними галочку «только открытые темы».'); return; }
    setRun({ fmt, keys, pos: 0, results: {}, started: Date.now(), finished: false });
    window.scrollTo(0, 0);
  };
  const finish = (r) => {
    const res = r || run;
    const total = res.keys.length;
    const score = Object.values(res.results).filter(Boolean).length;
    const byBranch = {};
    res.keys.forEach((k) => { const f = findTask(k); const b = f.node.branch; byBranch[b] = byBranch[b] || [0, 0]; byBranch[b][1]++; if (res.results[k]) byBranch[b][0]++; });
    recordExam({ fmt: res.fmt.id, date: today(), score, total, minutes: Math.round((Date.now() - res.started) / 60000) });
    setRun({ ...res, finished: true, score, total, byBranch });
  };
  if (run && !run.finished) {
    const left = run.fmt.minutes * 60000 - (now - run.started);
    if (left <= 0 && !run.timeout) { run.timeout = true; setTimeout(() => finish(), 0); }
    const key = run.keys[run.pos];
    const f = findTask(key);
    const mm = Math.max(0, Math.floor(left / 60000)), ss = Math.max(0, Math.floor((left % 60000) / 1000));
    const next = () => { if (run.pos + 1 >= run.keys.length) finish(); else { setRun({ ...run, pos: run.pos + 1 }); window.scrollTo(0, 0); } };
    return html`<div class="exam-bar">
        <span class="badge big">${run.fmt.title}</span>
        <span class="exam-timer ${left < 300000 ? 'hot' : ''}">⏱ ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</span>
        <span class="small muted">${run.pos + 1} / ${run.keys.length}</span>
        <button class="btn ghost small" onClick=${() => finish()}>Завершить</button>
      </div>
      <${Bar} value=${run.pos} max=${run.keys.length} />
      <${TaskCard} key=${key + run.started} node=${f.node} index=${f.index} task=${f.task} mode="exam" label=${`Вопрос ${run.pos + 1}`}
        onAnswered=${(ok) => setRun((r) => ({ ...r, results: { ...r.results, [key]: ok } }))} />
      <div class="task-actions"><button class="btn primary" onClick=${next}>${run.pos + 1 >= run.keys.length ? 'Закончить экзамен' : 'Следующий вопрос →'}</button>
        ${!(key in run.results) && html`<span class="small muted">Без ответа вопрос засчитается как неверный.</span>`}</div>`;
  }
  if (run && run.finished) {
    const pct = Math.round((100 * run.score) / run.total);
    const verdict = pct >= 80 ? 'Уровень собеседования пройден уверенно' : pct >= 60 ? 'Близко к проходному — подтяни слабые темы' : 'Пока рано — вернись к урокам из списка ниже';
    return html`<div class="exam-result">
      <div class="ring-wrap big"><${Ring} value=${run.score} max=${run.total} size=${110} /><div><div class="stat-v huge">${pct}%</div><div class="stat-l">${run.score} из ${run.total} · ${run.fmt.title}</div></div></div>
      <div class=${cls('verdict', pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad')}>${verdict}</div>
      <h3>По темам</h3>
      <div class="branch-rows">${Object.entries(run.byBranch).map(([b, [ok, n]]) => html`<div class="branch-row"><span class="dot" style=${{ background: course.branches[b].color }} /><span class="br-title">${course.branches[b].title}</span><${Bar} value=${ok} max=${n} color=${course.branches[b].color} /><span class="small muted">${ok}/${n}</span></div>`)}</div>
      <h3>Ошибки</h3>
      ${run.keys.filter((k) => !run.results[k]).length ? html`<ul>${run.keys.filter((k) => !run.results[k]).map((k) => { const f = findTask(k); return html`<li><a href=${`#/node/${f.node.id}?tab=tasks`}>${f.node.title}</a> — задача ${f.index + 1}</li>`; })}</ul>` : html`<p class="muted">Ошибок нет.</p>`}
      <div class="task-actions"><button class="btn primary" onClick=${() => setRun(null)}>К выбору формата</button></div>
    </div>`;
  }
  return html`
    <p class="muted">Пробное собеседование на время: задачи берутся случайно из всего курса. Ответ засчитывается по первой попытке, разбор можно открыть, но вопрос тогда считается неверным.</p>
    <label class="small"><input type="checkbox" checked=${onlyLearned} onChange=${(e) => setOnlyLearned(e.target.checked)} /> Только открытые темы</label>
    <div class="scen-list">${FORMATS.map((f) => html`<button class="scen-card exam-card" onClick=${() => start(f)}>
      <div class="scen-top"><span class="scen-title">${f.title}</span><span class="badge">${f.minutes} мин</span></div>
      <div class="scen-text">${f.desc}</div>
    </button>`)}</div>
    ${s.exams.length ? html`<h3>История</h3><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Формат</th><th>Результат</th><th>Время</th></tr></thead><tbody>
      ${[...s.exams].reverse().slice(0, 10).map((e) => html`<tr><td>${e.date}</td><td>${(FORMATS.find((f) => f.id === e.fmt) || {}).title || e.fmt}</td><td>${e.score}/${e.total} (${Math.round((100 * e.score) / e.total)}%)</td><td>${e.minutes} мин</td></tr>`)}
    </tbody></table></div>` : ''}`;
}

// ───────── SQL-марафон ─────────
function Marathon() {
  const s = useStore();
  const [seed, setSeed] = useState(() => (Date.now() & 0xfffffff) + 1);
  const drill = useMemo(() => randomDrill(seed), [seed]);
  const [code, setCode] = useState('SELECT\n');
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState('');
  const [showSol, setShowSol] = useState(false);
  const counted = useRef(false);
  const expRef = useRef(null);
  const reset = () => { setSeed(seed + 7919); setCode('SELECT\n'); setOut(null); setShowSol(false); counted.current = false; expRef.current = null; };
  const exec = async (check) => {
    setOut(null);
    try {
      setBusy(sqlReady() ? 'Выполняю…' : 'Загружаю движок…');
      const user = await runSql(code);
      let verdict = null;
      if (check) {
        if (!expRef.current) expRef.current = await runSql(drill.sql);
        verdict = compareResults(user, expRef.current, { ordered: drill.ordered });
        if (!counted.current) { counted.current = true; recordDrill(verdict.ok); }
      }
      setOut({ user, verdict });
    } catch (e) { setOut({ err: String(e.message || e) }); }
    setBusy('');
  };
  const d = s.drills;
  return html`
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${d.streak}</div><div class="stat-l">серия верных подряд</div></div>
      <div class="stat"><div class="stat-v">${d.best}</div><div class="stat-l">лучшая серия</div></div>
      <div class="stat"><div class="stat-v">${d.solved}<span class="muted small">/${d.tried}</span></div><div class="stat-l">решено всего</div></div>
    </div>
    <section class="task drill">
      <div class="task-head"><span class="task-num">${drill.topic}</span><span class="badge">${'★'.repeat(drill.level)}</span>${counted.current && out && out.verdict ? html`<span class=${cls('badge', out.verdict.ok ? 'ok' : 'warn')}>${out.verdict.ok ? 'засчитано' : 'серия сброшена'}</span>` : ''}</div>
      <${Md} src=${drill.q} className="task-q" />
      <${SchemaPanel} />
      <div class="hint">${drill.ordered ? 'Порядок строк важен' : 'Порядок строк не важен'} · засчитывается первая проверка · Ctrl+Enter — проверить</div>
      <${CodeEditor} value=${code} onChange=${setCode} onRun=${() => exec(false)} onCheck=${() => exec(true)} lang="sql" />
      <div class="task-actions">
        <button class="btn primary" onClick=${() => exec(true)} disabled=${!!busy}>Проверить</button>
        <button class="btn" onClick=${() => exec(false)} disabled=${!!busy}>Выполнить</button>
        ${!showSol && html`<button class="btn ghost" onClick=${() => { if (!counted.current) { counted.current = true; recordDrill(false); } setShowSol(true); }}>Показать решение</button>`}
        <button class="btn ghost" onClick=${reset}>Следующая задача →</button>
        ${busy && html`<span class="busy"><span class="spinner" />${busy}</span>`}
      </div>
      ${out && out.err && html`<div class="verdict bad"><pre class="err">${out.err}</pre></div>`}
      ${out && out.verdict && html`<div class=${cls('verdict', out.verdict.ok ? 'good' : 'bad')}>${out.verdict.ok ? 'Верно' : 'Не совпадает с эталоном'}${out.verdict.msg ? html`<div class="vmsg">${out.verdict.msg}</div>` : ''}</div>`}
      ${out && out.user && html`<div class="hint">${out.user.rows.length} строк · ${Math.round(out.user.ms)} мс</div><${ResultTable} cols=${out.user.cols} rows=${out.user.rows} />`}
      ${showSol && html`<div class="explain"><div class="explain-title">Эталонное решение</div><pre class="code"><code>${drill.sql}</code></pre></div>`}
    </section>`;
}
