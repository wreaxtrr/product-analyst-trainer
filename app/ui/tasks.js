import { html, useState, useRef, useEffect, useMemo, cls } from '../lib.js';
import { Md, Inline } from './common.js';
import { taskKey, nodeStats } from '../content.js';
import { recordAttempt, recordReview, recordPractice, setDraft, getState, useStore } from '../store.js';
import { runSql, compareResults, sqlReady, fmtCell, resetDb } from '../engines/sql.js';
import { runPython, pyStarted } from '../engines/py.js';
import { SCHEMA, TABLE_DOCS, mulberry32 } from '../data/generate.js';

export function toast(text) { dispatchEvent(new CustomEvent('toast', { detail: text })); }

// Стабильная перестановка вариантов ответа: для одной задачи порядок всегда одинаковый,
// но правильный вариант не стоит на одном и том же месте во всём курсе.
export function optionOrder(n, key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rnd = mulberry32(h >>> 0);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

const TYPE_LABEL = { single: 'квиз', multi: 'квиз', number: 'расчёт', sql: 'SQL', python: 'Python', case: 'кейс', order: 'порядок' };

// mode: learn — обычное решение в узле; review — карточка повторения;
// practice — тренировка дня и марафон; exam — пробный экзамен (прогресс узлов не трогает).
export function TaskCard({ node, index, task, mode = 'learn', onAnswered, label, tkey }) {
  const s = useStore();
  const key = tkey || taskKey(node.id, index);
  const st = mode === 'exam' ? null : s.tasks[key];
  const answered = useRef(false);
  const report = (correct) => {
    if (mode === 'review') recordReview(key, correct);
    else if (mode === 'practice') { if (!answered.current) { const xp = recordPractice(key, correct); if (xp) toast(`+${xp} опыта`); } }
    else if (mode === 'learn') {
      const xp = recordAttempt(key, correct, { trial: node.isTrial });
      if (xp) toast(`+${xp} опыта`);
      if (correct) celebrateIfNodeDone(node);
    }
    if (!answered.current) { answered.current = true; onAnswered && onAnswered(correct); }
  };
  const reveal = () => {
    const t = getState().tasks[key];
    if (mode === 'learn' && (!t || !t.attempts)) recordAttempt(key, false, { trial: node.isTrial });
    if (mode === 'exam' && !answered.current) { answered.current = true; onAnswered && onAnswered(false); }
  };
  const Comp = { single: Choice, multi: Choice, number: NumberTask, sql: CodeTask, python: CodeTask, case: CaseTask, order: OrderTask }[task.type];
  return html`
    <section class=${cls('task', st && st.solved && 'solved')} id=${'task-' + index}>
      <div class="task-head">
        <span class="task-num">${label || `Задача ${index + 1}`}</span>
        <span class="badge">${TYPE_LABEL[task.type] || task.type}</span>
        ${task.bug && html`<span class="badge bug">найди баг</span>`}
        ${st && st.solved ? html`<span class=${cls('badge', st.first ? 'ok' : 'ok-soft')}>${st.first ? 'с первой попытки' : 'решено'}</span>` : ''}
        ${mode !== 'review' && s.srs[key] ? html`<span class="badge warn" title="Задача в очереди повторения">повторение</span>` : ''}
      </div>
      <${Md} src=${task.q} className="task-q" />
      ${Comp ? html`<${Comp} task=${task} tkey=${key} report=${report} reveal=${reveal} />` : html`<div class="callout callout-warn">Неизвестный тип задачи: ${task.type}</div>`}
    </section>`;
}

function Explain({ task }) {
  if (!task.explain) return null;
  return html`<div class="explain"><div class="explain-title">Разбор</div><${Md} src=${task.explain} /></div>`;
}

function celebrateIfNodeDone(node) {
  setTimeout(() => {
    const st = nodeStats(node, getState());
    if (st.done) dispatchEvent(new CustomEvent('celebrate', { detail: { title: node.title, stars: st.stars } }));
  }, 50);
}

// Кейс: несколько шагов-вопросов, которые открываются по очереди.
function CaseTask({ task, tkey, report }) {
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState(null);
  const [res, setRes] = useState(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const steps = task.steps || [];
  const cur = steps[step];
  const order = useMemo(() => (cur ? optionOrder(cur.options.length, `${tkey}/${step}`) : []), [tkey, step]);
  const submit = () => {
    const ok = sel === cur.answer;
    setRes(ok);
    if (!ok && !failed) { setFailed(true); report(false); }
    if (ok && step === steps.length - 1) { setDone(true); report(true); }
  };
  const next = () => { setStep(step + 1); setSel(null); setRes(null); };
  return html`
    <div class="case-steps">
      ${steps.slice(0, step).map((s, i) => html`<div class="case-done"><span class="case-n">Шаг ${i + 1}</span> <${Inline} text=${s.q} /> — <b><${Inline} text=${s.options[s.answer]} /></b></div>`)}
    </div>
    ${cur && html`<div class="case-cur">
      <div class="case-n">Шаг ${step + 1} из ${steps.length}</div>
      <${Md} src=${cur.q} />
      <div class="options">${order.map((i) => {
        const chosen = sel === i;
        const mark = res !== null && chosen ? (res ? 'right' : 'wrong') : '';
        return html`<button type="button" class=${cls('option', chosen && 'chosen', mark)} disabled=${res === true} onClick=${() => { if (res !== true) { setSel(i); setRes(null); } }}>
          <span class="opt-mark rd" /><span class="opt-text"><${Inline} text=${cur.options[i]} /></span></button>`;
      })}</div>
      <div class="task-actions">
        ${res !== true && html`<button class="btn primary" disabled=${sel === null} onClick=${submit}>Ответить</button>`}
        ${res === true && step < steps.length - 1 && html`<button class="btn primary" onClick=${next}>Следующий шаг →</button>`}
      </div>
      ${res === false && html`<div class="verdict bad">Не то. Подумай ещё — шаг можно ответить снова.</div>`}
      ${res === true && html`<div class="verdict good">Верно</div>${cur.explain && html`<div class="explain"><${Md} src=${cur.explain} /></div>`}`}
    </div>`}
    ${done && html`<${Explain} task=${task} />`}`;
}

// Расставить шаги в правильном порядке.
function OrderTask({ task, tkey, report }) {
  const init = useMemo(() => {
    let o = optionOrder(task.items.length, tkey);
    if (o.every((v, i) => v === i)) o = [...o.slice(1), o[0]];
    return o;
  }, [tkey]);
  const [ord, setOrd] = useState(init);
  const [res, setRes] = useState(null);
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= ord.length || res === true) return;
    const n = [...ord]; [n[i], n[j]] = [n[j], n[i]]; setOrd(n); setRes(null);
  };
  const submit = () => { const ok = ord.every((v, i) => v === i); setRes(ok); report(ok); };
  return html`
    <div class="hint">Расставь кнопками ↑ ↓ в правильном порядке</div>
    <ol class="order-list">${ord.map((v, i) => html`<li class=${cls('order-item', res !== null && (v === i ? 'right' : 'wrong'))}>
      <span class="order-pos">${i + 1}</span><span class="opt-text"><${Inline} text=${task.items[v]} /></span>
      <span class="order-btns"><button class="icon-btn small" onClick=${() => move(i, -1)} aria-label="Выше">↑</button><button class="icon-btn small" onClick=${() => move(i, 1)} aria-label="Ниже">↓</button></span>
    </li>`)}</ol>
    <div class="task-actions">${res !== true && html`<button class="btn primary" onClick=${submit}>Проверить порядок</button>`}</div>
    ${res === false && html`<div class="verdict bad">Есть ошибки — неверные позиции подсвечены. Попробуй переставить.</div>`}
    ${res === true && html`<div class="verdict good">Верно</div><${Explain} task=${task} />`}`;
}

function Choice({ task, tkey, report }) {
  const multi = task.type === 'multi';
  const order = useMemo(() => optionOrder(task.options.length, tkey), [tkey, task.options.length]);
  const [sel, setSel] = useState(multi ? [] : null);
  const [res, setRes] = useState(null); // null | true | false
  const [wrongs, setWrongs] = useState(0);
  const [showExp, setShowExp] = useState(false);
  const toggle = (i) => {
    if (res !== null) return;
    if (multi) setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]);
    else setSel(i);
  };
  const submit = () => {
    let ok;
    if (multi) {
      const a = [...task.answer].sort().join(','), b = [...sel].sort().join(',');
      ok = a === b;
    } else ok = sel === task.answer;
    setRes(ok);
    if (!ok) setWrongs(wrongs + 1);
    if (ok) setShowExp(true);
    report(ok);
  };
  const retry = () => { setRes(null); setSel(multi ? [] : null); };
  const empty = multi ? sel.length === 0 : sel === null;
  const correctSet = new Set(multi ? task.answer : [task.answer]);
  return html`
    ${multi ? html`<div class="hint">Можно выбрать несколько вариантов</div>` : ''}
    <div class="options">
      ${order.map((i) => {
        const o = task.options[i];
        const chosen = multi ? sel.includes(i) : sel === i;
        const mark = res !== null && chosen ? (res ? 'right' : 'wrong') : showExp && correctSet.has(i) ? 'right-soft' : '';
        return html`<button type="button" class=${cls('option', chosen && 'chosen', mark)} onClick=${() => toggle(i)} disabled=${res !== null}>
          <span class=${cls('opt-mark', multi ? 'sq' : 'rd')} />
          <span class="opt-text"><${Inline} text=${o} /></span>
        </button>`;
      })}
    </div>
    <div class="task-actions">
      ${res === null && html`<button class="btn primary" disabled=${empty} onClick=${submit}>Ответить</button>`}
      ${res === false && html`<button class="btn" onClick=${retry}>Ещё раз</button>`}
      ${res === false && !showExp && html`<button class="btn ghost" onClick=${() => setShowExp(true)}>Показать разбор</button>`}
    </div>
    ${res !== null && html`<div class=${cls('verdict', res ? 'good' : 'bad')}>${res ? 'Верно' : wrongs > 1 ? 'Снова мимо. Загляни в разбор.' : 'Неверно. Подумай ещё или открой разбор.'}</div>`}
    ${showExp && html`<${Explain} task=${task} />`}`;
}

function parseNum(s) {
  const t = String(s).replace(/\s/g, '').replace(',', '.').replace(/%$/, '');
  if (!t) return NaN;
  return Number(t);
}

function NumberTask({ task, report }) {
  const [val, setVal] = useState('');
  const [res, setRes] = useState(null);
  const [showExp, setShowExp] = useState(false);
  const submit = () => {
    const x = parseNum(val);
    if (Number.isNaN(x)) { toast('Введи число'); return; }
    const a = Number(task.answer);
    const tol = task.atol != null ? task.atol : Math.abs(a) * (task.tol != null ? task.tol : 0.02);
    const ok = Math.abs(x - a) <= tol + 1e-12;
    setRes(ok);
    if (ok) setShowExp(true);
    report(ok);
  };
  return html`
    <div class="num-row">
      <input class="input" inputmode="decimal" placeholder="Введи число" value=${val} disabled=${res === true}
        onInput=${(e) => { setVal(e.target.value); if (res === false) setRes(null); }}
        onKeyDown=${(e) => { if (e.key === 'Enter') submit(); }} />
      ${task.unit && html`<span class="unit">${task.unit}</span>`}
      ${res !== true && html`<button class="btn primary" onClick=${submit} disabled=${!val.trim()}>Ответить</button>`}
    </div>
    ${task.hint && res !== true && html`<div class="hint"><${Inline} text=${task.hint} /></div>`}
    ${res !== null && html`<div class=${cls('verdict', res ? 'good' : 'bad')}>${res ? 'Верно' : 'Не сходится. Проверь расчёт.'}</div>`}
    ${res === false && !showExp && html`<div class="task-actions"><button class="btn ghost" onClick=${() => setShowExp(true)}>Показать разбор</button></div>`}
    ${showExp && html`<${Explain} task=${task} />`}`;
}

export function ResultTable({ cols, rows, limit = 100 }) {
  return html`<div class="table-wrap result"><table>
    <thead><tr>${cols.map((c) => html`<th>${c}</th>`)}</tr></thead>
    <tbody>${rows.slice(0, limit).map((r) => html`<tr>${r.map((v) => html`<td class=${typeof v === 'number' ? 'num' : v === null ? 'null' : ''}>${fmtCell(v)}</td>`)}</tr>`)}</tbody>
  </table>${rows.length > limit ? html`<div class="hint">Показаны первые ${limit} строк из ${rows.length}</div>` : ''}</div>`;
}

export function SchemaPanel({ tables, open = false }) {
  const names = tables && tables.length ? tables : Object.keys(SCHEMA);
  return html`<details class="schema" open=${open}>
    <summary>Схема данных · ${names.join(', ')}</summary>
    <div class="schema-list">
      ${names.map((t) => html`<div class="schema-row">
        <div class="schema-name">${t}</div>
        <div><div class="schema-doc">${TABLE_DOCS[t] || ''}</div>
          <code class="schema-cols">${(SCHEMA[t] || []).map(([c, ty]) => `${c} ${ty}`).join(', ')}</code></div>
      </div>`)}
    </div>
  </details>`;
}

export function CodeEditor({ value, onChange, onRun, onCheck, lang }) {
  const ref = useRef(null);
  const lines = Math.max(7, Math.min(28, String(value).split('\n').length + 1));
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && onRun) onRun(); else (onCheck || onRun)();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.target, a = el.selectionStart, b = el.selectionEnd;
      const ind = lang === 'python' ? '    ' : '  ';
      const nv = el.value.slice(0, a) + ind + el.value.slice(b);
      onChange(nv);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + ind.length; });
    }
  };
  return html`<textarea ref=${ref} class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off"
    rows=${lines} value=${value} onInput=${(e) => onChange(e.target.value)} onKeyDown=${onKeyDown} />`;
}

const expCache = new Map();

function CodeTask({ task, tkey, report, reveal }) {
  const isSql = task.type === 'sql';
  const s = getState();
  const [code, setCode] = useState(s.drafts[tkey] ?? (task.starter || ''));
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState(null);
  const [showSol, setShowSol] = useState(false);
  const timer = useRef(null);
  const change = (v) => {
    setCode(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDraft(tkey, v), 400);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const exec = async (check) => {
    if (busy) return;
    setOut(null);
    try {
      if (isSql) {
        setBusy(sqlReady() ? 'Выполняю…' : 'Загружаю движок, первый запуск занимает несколько секунд…');
        const user = await runSql(code);
        let verdict = null;
        if (check) {
          let exp = expCache.get(tkey);
          if (!exp) { exp = await runSql(task.solution); expCache.set(tkey, exp); }
          verdict = compareResults(user, exp, { ordered: !!task.ordered, tol: task.tol ?? 1e-4 });
          report(verdict.ok);
        }
        setOut({ kind: 'sql', user, verdict });
      } else {
        setBusy(pyStarted() ? 'Выполняю…' : 'Загружаю Python, первый запуск занимает 10–20 секунд…');
        const r = await runPython({
          code, solution: task.solution, test: task.test, variable: task.variable === undefined ? 'result' : task.variable,
          ordered: task.ordered !== false, tol: task.tol ?? 1e-4, packages: task.packages || [], onlyRun: !check,
        }, (m) => setBusy(m));
        if (check) report(!!r.ok);
        setOut({ kind: 'py', r, check });
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (check && !/только SELECT|пустой|один запрос/.test(msg)) report(false);
      setOut({ kind: 'error', msg });
    } finally {
      setBusy('');
    }
  };
  const doReset = () => { change(task.starter || ''); setOut(null); };
  const showSolution = () => { reveal(); setShowSol(true); };

  return html`
    ${isSql ? html`<${SchemaPanel} tables=${task.tables} />` : task.tables ? html`<div class="hint">Доступные DataFrame: ${task.tables.map((t) => html`<code>${t}</code> `)}${task.packages && task.packages.length ? html` · пакеты: ${task.packages.join(', ')}` : ''}</div>` : ''}
    <div class="hint">${isSql ? (task.ordered ? 'Порядок строк важен' : 'Порядок строк не важен') + ' · DuckDB SQL' : `Ответ положи в переменную ${task.variable || 'result'}`} · Ctrl+Enter — проверить, Ctrl+Shift+Enter — просто выполнить</div>
    <${CodeEditor} value=${code} onChange=${change} onRun=${() => exec(false)} onCheck=${() => exec(true)} lang=${isSql ? 'sql' : 'python'} />
    <div class="task-actions">
      <button class="btn primary" onClick=${() => exec(true)} disabled=${!!busy}>Проверить</button>
      <button class="btn" onClick=${() => exec(false)} disabled=${!!busy}>Выполнить</button>
      <button class="btn ghost" onClick=${doReset} disabled=${!!busy}>Сбросить</button>
      ${!showSol && html`<button class="btn ghost" onClick=${showSolution}>Показать разбор</button>`}
      ${busy && html`<span class="busy"><span class="spinner" />${busy}</span>`}
    </div>
    ${out && out.kind === 'error' && html`<div class="verdict bad"><pre class="err">${out.msg}</pre>
      ${isSql && /does not exist|Catalog Error/.test(out.msg) ? html`<button class="btn ghost small" onClick=${() => resetDb().then(() => toast('База перезагружена'))}>Перезагрузить базу</button>` : ''}</div>`}
    ${out && out.kind === 'sql' && html`
      ${out.verdict && html`<div class=${cls('verdict', out.verdict.ok ? 'good' : 'bad')}>${out.verdict.ok ? 'Верно' : 'Не совпадает с эталоном'}${out.verdict.msg ? html`<div class="vmsg">${out.verdict.msg}</div>` : ''}</div>`}
      <div class="hint">${out.user.rows.length} ${out.user.rows.length === 1 ? 'строка' : 'строк'} · ${Math.round(out.user.ms)} мс</div>
      <${ResultTable} cols=${out.user.cols} rows=${out.user.rows} />`}
    ${out && out.kind === 'py' && html`
      ${out.check && html`<div class=${cls('verdict', out.r.ok ? 'good' : 'bad')}>${out.r.ok ? 'Верно' : 'Не сходится'}${out.r.msg ? html`<div class="vmsg">${out.r.msg}</div>` : ''}</div>`}
      ${out.r.err && html`<pre class="err">${out.r.err}</pre>`}
      ${out.r.out && html`<div class="out-label">Вывод</div><pre class="out">${out.r.out}</pre>`}
      ${out.r.preview && html`<div class="out-label">${task.variable || 'result'} =</div><pre class="out">${out.r.preview}</pre>`}`}
    ${showSol && html`<div class="explain">
      <div class="explain-title">Разбор</div>
      ${task.explain && html`<${Md} src=${task.explain} />`}
      <div class="out-label">Эталонное решение</div>
      <pre class="code"><code>${task.solution}</code></pre>
      ${task.clickhouse && html`<div class="out-label">То же самое в ClickHouse</div><pre class="code"><code>${task.clickhouse}</code></pre>`}
    </div>`}`;
}
