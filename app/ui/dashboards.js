import { html, useState, useMemo, cls } from '../lib.js';
import { getData, dayToDate, END_DAY, DAYS } from '../data/generate.js';
import { Plot, path, C, mean, int, pct, fmt, Phi } from '../widgets/kit.js';
import { Md } from './common.js';
import { course } from '../content.js';

// Примеры дашбордов на данных «Корзинки». Всё считается в браузере из тех же таблиц,
// что и в задачах, — цифры совпадут с SQL-запросами.

const PLATS = ['ios', 'android', 'web'];
const P_IDX = { ios: 0, android: 1, web: 2 };

let cache = null;
function prepare() {
  if (cache) return cache;
  const { tables } = getData();
  const dayIdx = new Map();
  for (let d = 0; d <= END_DAY; d++) dayIdx.set(dayToDate(d), d);
  const plat = new Map(tables.users.map((u) => [u.user_id, P_IDX[u.platform]]));
  const W = Math.floor(END_DAY / 7) + 1;
  const mk = () => Array.from({ length: 4 }, () => Array.from({ length: W }, () => new Set()));
  const weekActive = mk(), weekBuyers = mk();
  const weekOrders = Array.from({ length: 4 }, () => new Array(W).fill(0));
  const weekGmv = Array.from({ length: 4 }, () => new Array(W).fill(0));
  const weekCancel = Array.from({ length: 4 }, () => new Array(W).fill(0));
  const weekAll = Array.from({ length: 4 }, () => new Array(W).fill(0));
  const day = () => Array.from({ length: 4 }, () => new Array(END_DAY + 1).fill(0));
  const dayOrders = day(), dayCheckout = day(), dayPurchase = day(), dayGmv = day();
  for (const e of tables.events) {
    const d = dayIdx.get(e.ts.slice(0, 10)); const w = Math.floor(d / 7); const p = plat.get(e.user_id);
    weekActive[3][w].add(e.user_id); weekActive[p][w].add(e.user_id);
    if (e.event_name === 'checkout') { dayCheckout[3][d]++; dayCheckout[p][d]++; }
    else if (e.event_name === 'purchase') { dayPurchase[3][d]++; dayPurchase[p][d]++; }
  }
  for (const o of tables.orders) {
    const d = dayIdx.get(o.ts.slice(0, 10)); const w = Math.floor(d / 7); const p = plat.get(o.user_id);
    for (const k of [3, p]) {
      weekAll[k][w]++;
      dayOrders[k][d]++;
      if (o.status === 'delivered') { weekOrders[k][w]++; weekGmv[k][w] += o.revenue; weekBuyers[k][w].add(o.user_id); dayGmv[k][d] += o.revenue; }
      else weekCancel[k][w]++;
    }
  }
  cache = { W, weekActive, weekBuyers, weekOrders, weekGmv, weekCancel, weekAll, dayOrders, dayCheckout, dayPurchase, dayGmv };
  return cache;
}

function Delta({ cur, prev, goodUp = true, fmtFn = (x) => pct(x, 1), abs = false }) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return html`<div class="kpi-d flat">—</div>`;
  const ch = abs ? cur - prev : cur / prev - 1;
  const dir = Math.abs(ch) < (abs ? 0.0005 : 0.005) ? 'flat' : (ch > 0) === goodUp ? 'up' : 'down';
  const arrow = ch > 0 ? '▲' : ch < 0 ? '▼' : '•';
  return html`<div class=${cls('kpi-d', dir)}>${arrow} ${abs ? (ch > 0 ? '+' : '') + (100 * ch).toFixed(1) + ' пп' : (ch > 0 ? '+' : '') + pct(ch, 1)} <span class="muted" style="font-weight:400">к прошлой неделе</span></div>`;
}

function Kpi({ label, value, children }) {
  return html`<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div>${children}</div>`;
}

// ═════ 1. Еженедельный дашборд руководителя ═════
function WeeklyExec() {
  const D = prepare();
  const weeks = Array.from({ length: D.W - 1 }, (_, w) => w).filter((w) => w >= 4); // последняя неделя неполная
  const [w, setW] = useState(Math.floor(DAYS.androidIncident / 7)); // неделя с инцидентом — есть что объяснять
  const [pf, setPf] = useState('all');
  const k = pf === 'all' ? 3 : P_IDX[pf];
  const m = (wk) => {
    const active = D.weekActive[k][wk].size, buyers = D.weekBuyers[k][wk].size, orders = D.weekOrders[k][wk], gmv = D.weekGmv[k][wk];
    return { active, buyers, orders, gmv, aov: orders ? gmv / orders : NaN, cr: active ? buyers / active : NaN, cancel: D.weekAll[k][wk] ? D.weekCancel[k][wk] / D.weekAll[k][wk] : NaN };
  };
  const cur = m(w), prev = m(w - 1);
  const trend = weeks.filter((x) => x <= w && x > w - 13).map((x) => [x, D.weekBuyers[k][x].size]);
  const ymax = Math.max(...trend.map((t) => t[1])) * 1.15;
  const byPlat = PLATS.map((p) => [p, D.weekGmv[P_IDX[p]][w], D.weekGmv[P_IDX[p]][w - 1]]);
  const gmax = Math.max(...byPlat.map((b) => Math.max(b[1], b[2]))) * 1.1 || 1;
  // авто-комментарий: самые заметные изменения
  const movers = [
    ['Покупатели', cur.buyers / prev.buyers - 1], ['Средний чек', cur.aov / prev.aov - 1], ['Конверсия в покупку', cur.cr / prev.cr - 1],
  ].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const wd = (x) => `${dayToDate(x * 7).slice(5).split('-').reverse().join('.')}–${dayToDate(x * 7 + 6).slice(5).split('-').reverse().join('.')}`;
  return html`<section class="dash">
    <div class="dash-head">
      <div><div class="eyebrow">Для руководителя · раз в неделю</div><h2>Здоровье продукта за неделю</h2><div class="small muted">Неделя ${wd(w)} 2024 · понедельник–воскресенье</div></div>
      <div class="dash-filters">
        <select value=${w} onChange=${(e) => setW(+e.target.value)}>${weeks.map((x) => html`<option value=${x}>${wd(x)}</option>`)}</select>
        <select value=${pf} onChange=${(e) => setPf(e.target.value)}><option value="all">Все платформы</option>${PLATS.map((p) => html`<option value=${p}>${p}</option>`)}</select>
      </div>
    </div>
    <div class="kpis six">
      <${Kpi} label="North Star: покупатели за неделю" value=${int(cur.buyers)}><${Delta} cur=${cur.buyers} prev=${prev.buyers} /><//>
      <${Kpi} label="GMV, ₽" value=${int(cur.gmv)}><${Delta} cur=${cur.gmv} prev=${prev.gmv} /><//>
      <${Kpi} label="Заказы (доставленные)" value=${int(cur.orders)}><${Delta} cur=${cur.orders} prev=${prev.orders} /><//>
      <${Kpi} label="Средний чек, ₽" value=${int(cur.aov)}><${Delta} cur=${cur.aov} prev=${prev.aov} /><//>
      <${Kpi} label="Конверсия активных в покупку" value=${pct(cur.cr)}><${Delta} cur=${cur.cr} prev=${prev.cr} abs=${true} /><//>
      <${Kpi} label="Доля отмен" value=${pct(cur.cancel)}><${Delta} cur=${cur.cancel} prev=${prev.cancel} abs=${true} goodUp=${false} /><//>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><h3>Покупатели по неделям (12 недель)</h3>
        <${Plot} w=${440} h=${230} x=${[trend[0][0], trend[trend.length - 1][0]]} y=${[0, ymax]} xTicks=${trend.filter((_, i) => i % 3 === 0).map((t) => t[0])} xFmt=${(x) => dayToDate(x * 7).slice(5).split('-').reverse().join('.')} yFmt=${(v) => int(v)}>
          ${(sx, sy) => html`<path d=${path(trend, sx, sy)} fill="none" stroke=${C.a} stroke-width="2.2" />
            ${trend.map(([x, v]) => html`<circle cx=${sx(x)} cy=${sy(v)} r=${x === w ? 4.5 : 2.5} fill=${x === w ? C.a : 'var(--card)'} stroke=${C.a} stroke-width="1.5" />`)}`}
        <//>
      </div>
      <div class="dash-card"><h3>GMV по платформам, ₽</h3>
        <svg class="chart" viewBox="0 0 320 200">
          ${byPlat.map(([p, v, pv], i) => { const y = 20 + i * 58; const wv = (200 * v) / gmax, wp = (200 * pv) / gmax; return html`<g>
            <text x="0" y=${y + 14} style="fill:var(--text);font-weight:600">${p}</text>
            <rect x="70" y=${y} width=${wv} height="16" rx="4" fill=${C.a} />
            <rect x="70" y=${y + 20} width=${wp} height="8" rx="3" fill="var(--line2)" />
            <text x=${76 + wv} y=${y + 13}>${int(v / 1000)} тыс.</text>
          </g>`; })}
          <text x="70" y="196" style="font-size:10.5px">серым — прошлая неделя</text>
        </svg>
      </div>
    </div>
    <div class="dash-note"><b>Что изменилось.</b> Сильнее всего сдвинулось: ${movers.map(([n, v], i) => html`${i ? ', ' : ''}${n.toLowerCase()} ${v > 0 ? '+' : ''}${pct(v, 1)}`)}. ${Math.abs(movers[0][1]) > 0.08 ? 'Стоит разобраться в причине — разбивка по платформам и новым/старым пользователям.' : 'Изменения в пределах обычных колебаний.'}</div>
  </section>`;
}

// ═════ 2. Операционный мониторинг ═════
function OpsDaily() {
  const D = prepare();
  const [d, setD] = useState(134); // 14 мая — день поломки Android
  const days = Array.from({ length: END_DAY - 13 }, (_, i) => i + 14);
  const baseline = (arr, dd) => { const v = [7, 14, 21, 28].map((l) => arr[dd - l]).sort((a, b) => a - b); return (v[1] + v[2]) / 2; };
  const rows = [3, 0, 1, 2].map((k) => {
    const orders = D.dayOrders[k][d], base = baseline(D.dayOrders[k], d);
    const cr = D.dayCheckout[k][d] ? D.dayPurchase[k][d] / D.dayCheckout[k][d] : NaN;
    const crBase = mean([7, 14, 21, 28].map((l) => D.dayPurchase[k][d - l] / Math.max(1, D.dayCheckout[k][d - l])));
    return { name: k === 3 ? 'Все' : PLATS[k], orders, base, dev: orders / base - 1, cr, crBase };
  });
  const alerts = rows.filter((r) => r.name !== 'Все').flatMap((r) => {
    const out = [];
    if (r.dev < -0.35) out.push({ sev: 'high', text: `${r.name}: заказов ${int(r.orders)} против обычных ~${int(r.base)} (${pct(r.dev, 0)})` });
    else if (r.dev < -0.2) out.push({ sev: 'mid', text: `${r.name}: заказов на ${pct(-r.dev, 0)} меньше обычного` });
    if (Number.isFinite(r.cr) && r.cr < r.crBase - 0.25) out.push({ sev: 'high', text: `${r.name}: конверсия оформления в оплату ${pct(r.cr, 0)} против ~${pct(r.crBase, 0)} — проверь платёжный шаг` });
    return out;
  });
  const series = days.filter((x) => x > d - 28 && x <= d).map((x) => [x, D.dayOrders[1][x]]);
  const seriesI = days.filter((x) => x > d - 28 && x <= d).map((x) => [x, D.dayOrders[0][x]]);
  const ymax = Math.max(...series.map((s) => s[1]), ...seriesI.map((s) => s[1])) * 1.15;
  return html`<section class="dash">
    <div class="dash-head">
      <div><div class="eyebrow">Для команды · каждый день утром</div><h2>Операционный мониторинг</h2><div class="small muted">Сравнение с тем же днём недели за 4 прошлые недели (медиана)</div></div>
      <div class="dash-filters">
        <select value=${d} onChange=${(e) => setD(+e.target.value)}>${days.map((x) => html`<option value=${x}>${dayToDate(x)}</option>`)}</select>
      </div>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><h3>Алерты</h3>
        ${alerts.length ? alerts.map((a) => html`<div class="alert-row"><span class=${cls('sev', a.sev)}>${a.sev === 'high' ? 'критично' : 'внимание'}</span><span>${a.text}</span></div>`) : html`<div class="muted small">Всё в пределах нормы.</div>`}
      </div>
      <div class="dash-card"><h3>Заказы по дням: Android и iOS</h3>
        <${Plot} w=${440} h=${220} x=${[series[0][0], d]} y=${[0, ymax]} xTicks=${series.filter((_, i) => i % 7 === 0).map((s) => s[0])} xFmt=${(x) => dayToDate(x).slice(5).split('-').reverse().join('.')} yFmt=${(v) => int(v)}>
          ${(sx, sy) => html`<path d=${path(seriesI, sx, sy)} fill="none" stroke=${C.d} stroke-width="1.6" /><path d=${path(series, sx, sy)} fill="none" stroke=${C.a} stroke-width="2.2" />`}
        <//>
        <div class="legend"><span><i style=${{ background: C.a }}></i>android</span><span><i style=${{ background: C.d }}></i>ios</span></div>
      </div>
    </div>
    <div class="table-wrap" style="margin-top:12px"><table>
      <thead><tr><th>Платформа</th><th>Заказы</th><th>Обычно</th><th>Отклонение</th><th>Оформление → оплата</th><th>Обычно</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td><b>${r.name}</b></td><td>${int(r.orders)}</td><td>${int(r.base)}</td>
        <td style=${{ color: r.dev < -0.2 ? 'var(--bad)' : r.dev > 0.2 ? 'var(--good)' : 'inherit', fontWeight: 600 }}>${r.dev > 0 ? '+' : ''}${pct(r.dev, 0)}</td>
        <td style=${{ color: r.cr < r.crBase - 0.25 ? 'var(--bad)' : 'inherit', fontWeight: r.cr < r.crBase - 0.25 ? 700 : 400 }}>${pct(r.cr, 0)}</td><td>${pct(r.crBase, 0)}</td></tr>`)}</tbody>
    </table></div>
  </section>`;
}

// ═════ 3. Отчёт по эксперименту ═════
const EXPS = {
  new_checkout: { title: 'new_checkout: новый экран оформления', period: '3–30 июня 2024', end: dayToDate(DAYS.ncEnd + 1) },
  promo_banner: { title: 'promo_banner: баннер с промокодом на главной', period: '1–28 июля 2024', end: dayToDate(DAYS.pbEnd + 1) },
};

function computeExperiment(exp) {
  const { tables } = getData();
  const plat = new Map(tables.users.map((u) => [u.user_id, u.platform]));
  const eu = tables.experiment_users.filter((e) => e.experiment === exp);
  const per = new Map(eu.map((e) => [e.user_id, { grp: e.grp, from: e.assigned_at, buyer: 0, n: 0, rev: 0, all: 0, canc: 0 }]));
  for (const o of tables.orders) {
    const u = per.get(o.user_id);
    if (!u || o.ts.slice(0, 10) < u.from || o.ts.slice(0, 10) >= EXPS[exp].end) continue;
    u.buyer = 1; u.all++;
    if (o.status === 'delivered') { u.n++; u.rev += o.revenue; } else u.canc++;
  }
  const g = { A: [], B: [] };
  const byPlat = {};
  per.forEach((u, id) => {
    g[u.grp].push(u);
    const p = plat.get(id); byPlat[p] = byPlat[p] || { A: 0, B: 0 }; byPlat[p][u.grp]++;
  });
  const srm = (a, b) => { const E = (a + b) / 2; const chi2 = ((a - E) ** 2 + (b - E) ** 2) / E; return { chi2, p: 2 * (1 - Phi(Math.sqrt(chi2))) }; };
  const nA = g.A.length, nB = g.B.length;
  const { chi2, p: srmP } = srm(nA, nB);
  const platSrm = PLATS.map((p) => { const x = srm(byPlat[p].A, byPlat[p].B); return { name: p, A: byPlat[p].A, B: byPlat[p].B, chi2: x.chi2, p: x.p }; });
  const meanM = (arr, f) => { const v = arr.map(f); const m = mean(v); const s2 = v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1); return { m, se2: s2 / v.length }; };
  const ratio = (arr, fx, fy) => {
    const X = arr.map(fx), Y = arr.map(fy), n = arr.length; const mx = mean(X), my = mean(Y), R = mx / my;
    let vx = 0, vy = 0, cxy = 0; for (let i = 0; i < n; i++) { vx += (X[i] - mx) ** 2; vy += (Y[i] - my) ** 2; cxy += (X[i] - mx) * (Y[i] - my); }
    vx /= n - 1; vy /= n - 1; cxy /= n - 1;
    return { m: R, se2: (vx - 2 * R * cxy + R * R * vy) / (n * my * my) };
  };
  const metrics = [
    ['Доля покупателей (цель)', (a) => meanM(a, (u) => u.buyer), true, 'pp'],
    ['Заказов на участника', (a) => meanM(a, (u) => u.n), true, 'num'],
    ['Выручка на участника, ₽', (a) => meanM(a, (u) => u.rev), true, 'rub'],
    ['Средний чек, ₽ (дельта-метод)', (a) => ratio(a, (u) => u.rev, (u) => u.n), true, 'rub'],
    ['Доля отмен (guardrail)', (a) => ratio(a, (u) => u.canc, (u) => u.all), false, 'pp'],
  ].map(([name, f, goodUp, unit]) => {
    const A = f(g.A), B = f(g.B);
    const diff = B.m - A.m, se = Math.sqrt(A.se2 + B.se2);
    const rel = diff / A.m, relLo = (diff - 1.96 * se) / A.m, relHi = (diff + 1.96 * se) / A.m;
    const sig = relLo > 0 || relHi < 0;
    return { name, a: A.m, b: B.m, rel, relLo, relHi, sig, good: sig ? (rel > 0) === goodUp : null, unit };
  });
  return { nA, nB, chi2, srmP, platSrm, metrics };
}

const pStr = (p) => (p < 1e-6 ? '< 0.000001' : '= ' + fmt(p, 4));

function verdict(r) {
  const [goal, , , aov, cancel] = r.metrics;
  if (r.srmP < 0.001) {
    const worst = [...r.platSrm].sort((a, b) => a.p - b.p)[0];
    return html`<b>Вывод: результатам верить нельзя.</b> Группы разного размера (${int(r.nA)} против ${int(r.nB)}, p ${pStr(r.srmP)}), а при честной рандомизации 50/50 такое почти не случается. Перекос сосредоточен на платформе <b>${worst.name}</b>: ${int(worst.A)} в A против ${int(worst.B)} в B. Значит, часть пользователей группы B потерялась — обычно это баг логирования или назначения. Эффект на метрики не интерпретируем. <b>Решение:</b> найти и починить причину, перезапустить тест.`;
  }
  const tail = aov.sig ? '' : ' Средний чек не изменился — эффект пришёл через число заказов, а не через их размер.';
  if (goal.sig && goal.rel > 0 && cancel.good !== false) return html`<b>Вывод.</b> Целевая метрика выросла на ${pct(goal.rel, 1)} (95% ДИ ${pct(goal.relLo, 1)} … ${pct(goal.relHi, 1)}).${tail} Guardrail «доля отмен» без значимого ухудшения, SRM нет. <b>Решение:</b> катить на 100%, через месяц сверить фактический эффект с прогнозом.`;
  if (goal.sig && goal.rel > 0) return html`<b>Вывод.</b> Целевая метрика выросла, но ухудшился guardrail — доля отмен. <b>Решение:</b> не катить сразу, разобраться в причине роста отмен.`;
  if (goal.sig) return html`<b>Вывод.</b> Целевая метрика значимо упала. <b>Решение:</b> не катить, разобрать, что сломалось в новом варианте.`;
  return html`<b>Вывод.</b> Значимого эффекта на целевую метрику не найдено: интервал содержит ноль. Это не доказательство отсутствия эффекта — проверь, хватало ли мощности. <b>Решение:</b> не катить ради этой метрики.`;
}

function ExperimentReport() {
  const [exp, setExp] = useState('new_checkout');
  const r = useMemo(() => computeExperiment(exp), [exp]);
  const okSrm = r.srmP >= 0.001;
  const lim = Math.max(...r.metrics.map((m) => Math.max(Math.abs(m.relLo), Math.abs(m.relHi)))) * 1.1;
  const fmtV = (v, u) => (u === 'pp' ? pct(v, 1) : u === 'rub' ? int(v) : fmt(v, 3));
  const goal = r.metrics[0];
  return html`<section class="dash">
    <div class="dash-head">
      <div><div class="eyebrow">Для продакта · по итогам теста</div><h2>Эксперимент ${EXPS[exp].title}</h2><div class="small muted">${EXPS[exp].period} · рандомизация по пользователям · метрики с даты назначения</div></div>
      <div class="dash-filters">
        <select value=${exp} onChange=${(e) => setExp(e.target.value)}>${Object.keys(EXPS).map((k) => html`<option value=${k}>${k}</option>`)}</select>
      </div>
    </div>
    <div class="kpis">
      <${Kpi} label="Участников в A" value=${int(r.nA)} />
      <${Kpi} label="Участников в B" value=${int(r.nB)} />
      <${Kpi} label="Проверка SRM (χ², 50/50)" value=${okSrm ? 'норма' : 'перекос'}><div class=${cls('kpi-d', okSrm ? 'flat' : 'down')}>χ² = ${fmt(r.chi2, 2)}, p ${pStr(r.srmP)}</div><//>
      <${Kpi} label="Эффект на цель" value=${(goal.rel > 0 ? '+' : '') + pct(goal.rel, 1)}><div class=${cls('kpi-d', goal.good === null ? 'flat' : goal.good ? 'up' : 'down')}>95% ДИ ${pct(goal.relLo, 1)} … ${pct(goal.relHi, 1)}</div><//>
    </div>
    ${!okSrm && html`<div class="alert-row" style="margin-bottom:12px"><span class="sev high">стоп</span><span>Sample Ratio Mismatch: эффекты ниже показаны для обучения, принимать по ним решение нельзя.</span></div>`}
    <div class="dash-card"><h3>Эффекты B относительно A с 95% интервалами</h3>
      <div class="forest" style=${{ opacity: okSrm ? 1 : 0.55 }}>
        ${r.metrics.map((m) => {
          const pos = (v) => (100 * (v + lim)) / (2 * lim);
          const col = m.good === null ? 'var(--muted)' : m.good ? 'var(--good)' : 'var(--bad)';
          return html`<div class="forest-row">
            <div class="forest-l"><b>${m.name}</b><span>A ${fmtV(m.a, m.unit)} → B ${fmtV(m.b, m.unit)}</span></div>
            <div class="forest-track">
              <span class="forest-zero" style=${{ left: pos(0) + '%' }} />
              <span class="forest-ci" style=${{ left: pos(m.relLo) + '%', width: pos(m.relHi) - pos(m.relLo) + '%', background: col }} />
              <span class="forest-pt" style=${{ left: pos(m.rel) + '%', background: col }} />
              <span class="forest-v" style=${{ left: pos(m.rel) + '%', color: col }}>${m.rel > 0 ? '+' : ''}${pct(m.rel, 1)}</span>
            </div>
          </div>`;
        })}
      </div>
      <div class="legend"><span><i style="background:var(--good)"></i>значимо лучше</span><span><i style="background:var(--bad)"></i>значимо хуже</span><span><i style="background:var(--muted)"></i>интервал содержит ноль</span></div>
    </div>
    <div class="dash-card" style="margin-top:12px"><h3>Размер групп по платформам</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Платформа</th><th>A</th><th>B</th><th>Доля B</th><th>p (SRM)</th></tr></thead>
        <tbody>${r.platSrm.map((x) => html`<tr><td><b>${x.name}</b></td><td>${int(x.A)}</td><td>${int(x.B)}</td><td>${pct(x.B / (x.A + x.B), 1)}</td>
          <td style=${{ color: x.p < 0.001 ? 'var(--bad)' : 'inherit', fontWeight: x.p < 0.001 ? 700 : 400 }}>${x.p < 1e-6 ? '< 0.000001' : fmt(x.p, 4)}</td></tr>`)}</tbody>
      </table></div>
    </div>
    <div class="dash-note">${verdict(r)}</div>
  </section>`;
}

const PRINCIPLES = `
## Почему они устроены именно так

- **Сверху — ответ на главный вопрос.** У руководителя — North Star и пять драйверов. У команды — алерты. У продакта — эффект на целевую метрику и вердикт.
- **Каждое число — со сравнением.** Неделя к неделе, день к тому же дню недели, B к A. Число без сравнения ничего не говорит.
- **Цвет означает «хорошо / плохо», а не «красиво».** Рост доли отмен — красный, хотя это рост. Нейтральные изменения — серые.
- **Интервалы вместо голых средних** в отчёте по эксперименту. Forest plot сразу показывает, что значимо, а что нет.
- **Вывод словами.** Блок «Что изменилось» или «Вывод» превращает дашборд из картинки в решение.
- **Мало графиков.** Каждый отвечает на конкретный вопрос. Если график нельзя подписать вопросом, его не должно быть.

> [!tip] Попробуй
> В операционном мониторинге поменяй дату с 14 мая на соседние дни — алерты пропадут. В отчёте по эксперименту переключись на promo_banner: группы разного размера, и дашборд честно говорит, что выводы делать нельзя.
`;

export function Dashboards() {
  return html`
    <div class="eyebrow">Примеры</div>
    <h1>Дашборды</h1>
    <p class="muted" style="max-width:760px">Три типовых дашборда продуктового аналитика на данных «Корзинки»: для руководителя, для команды и по эксперименту. Цифры считаются в браузере из тех же таблиц, что и в задачах, — их можно проверить SQL-запросом в <a href="#/sandbox">песочнице</a>. Принципы — в уроке <a href="#/node/viz.dashboards">${course.nodes['viz.dashboards'].title}</a>.</p>
    <${WeeklyExec} />
    <${OpsDaily} />
    <${ExperimentReport} />
    <${Md} src=${PRINCIPLES} className="theory" />`;
}
