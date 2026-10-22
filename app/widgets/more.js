import { html, useState, useMemo } from '../lib.js';
import { Widget, Slider, Select, Readouts, Plot, path, makeRng, mean, sd, quantile, fmt, pct, int, Phi, invPhi, C, niceTicks } from './kit.js';
import { getData, dayToDate, END_DAY } from '../data/generate.js';

const MONTHS = [['all', 'весь период'], ['2024-01', 'январь'], ['2024-02', 'февраль'], ['2024-03', 'март'], ['2024-04', 'апрель'], ['2024-05', 'май'], ['2024-06', 'июнь'], ['2024-07', 'июль']];
const STEPS = ['app_open', 'view_item', 'add_to_cart', 'checkout', 'purchase'];
const STEP_RU = { app_open: 'Открыл приложение', view_item: 'Посмотрел товар', add_to_cart: 'Добавил в корзину', checkout: 'Оформление', purchase: 'Покупка' };

// ═════ Воронка на данных ═════
function Funnel() {
  const [month, setMonth] = useState('2024-06');
  const [platform, setPlatform] = useState('all');
  const data = useMemo(() => {
    const { tables } = getData();
    const plat = new Map(tables.users.map((u) => [u.user_id, u.platform]));
    const sets = Object.fromEntries(STEPS.map((s) => [s, new Set()]));
    for (const e of tables.events) {
      if (month !== 'all' && e.ts.slice(0, 7) !== month) continue;
      if (platform !== 'all' && plat.get(e.user_id) !== platform) continue;
      sets[e.event_name].add(e.user_id);
    }
    return STEPS.map((s) => sets[s].size);
  }, [month, platform]);
  const max = data[0] || 1;
  return html`<${Widget} title="Воронка «Корзинки» по пользователям" tag="живые данные">
    <div class="controls">
      <${Select} label="Месяц" value=${month} onChange=${setMonth} options=${MONTHS} />
      <${Select} label="Платформа" value=${platform} onChange=${setPlatform} options=${[['all', 'все'], ['ios', 'iOS'], ['android', 'Android'], ['web', 'Web']]} />
    </div>
    <svg class="chart" viewBox="0 0 640 230">
      ${STEPS.map((s, i) => {
        const w = Math.max(4, (360 * data[i]) / max), y = 10 + i * 44;
        const conv = i ? data[i] / (data[i - 1] || 1) : 1;
        return html`<g>
          <text x="150" y=${y + 20} text-anchor="end" style="fill:var(--text)">${STEP_RU[s]}</text>
          <rect x="160" y=${y} width=${w} height="32" rx="8" fill=${[C.a, C.e, C.c, C.d, C.b][i]} opacity="0.85" />
          <text x=${166 + w} y=${y + 20}>${int(data[i])}${i > 0 ? ` · ${pct(conv, 0)} от шага` : ''}</text>
        </g>`;
      })}
    </svg>
    <${Readouts} items=${[['Сквозная конверсия', pct(data[4] / max)], ['Корзина → покупка', pct(data[4] / (data[2] || 1))], ['Пользователей в начале', int(data[0])]]} />
    <div class="widget-note">Справа — конверсия из предыдущего шага. Сравни web и приложения: разрыв появляется на шаге оплаты. А в мае на Android виден след поломки 14 мая.</div>
  <//>`;
}

// ═════ Парадокс Симпсона ═════
function Simpson() {
  const [w1, setW1] = useState(0.2), [w2, setW2] = useState(0.5);
  const [a1, setA1] = useState(0.1), [a2, setA2] = useState(0.11);
  const [b1, setB1] = useState(0.04), [b2, setB2] = useState(0.05);
  const t1 = (1 - w1) * a1 + w1 * b1, t2 = (1 - w2) * a2 + w2 * b2;
  const within = (1 - w2) * (a2 - a1) + w2 * (b2 - b1);
  const mix = (w2 - w1) * (b1 - a1);
  const bars = [['App, июнь', a1, C.a], ['App, июль', a2, C.a], ['Web, июнь', b1, C.e], ['Web, июль', b2, C.e], ['Всего, июнь', t1, C.d], ['Всего, июль', t2, C.d]];
  const ymax = Math.max(...bars.map((b) => b[1])) * 1.2;
  return html`<${Widget} title="Все сегменты растут, а среднее падает" tag="симуляция">
    <div class="controls">
      <${Slider} label="Доля web в июне" value=${w1} min=${0} max=${0.9} step=${0.05} onInput=${setW1} show=${(v) => pct(v, 0)} />
      <${Slider} label="Доля web в июле" value=${w2} min=${0} max=${0.9} step=${0.05} onInput=${setW2} show=${(v) => pct(v, 0)} />
      <${Slider} label="CR app: июнь" value=${a1} min=${0.02} max=${0.2} step=${0.005} onInput=${setA1} show=${(v) => pct(v)} />
      <${Slider} label="CR app: июль" value=${a2} min=${0.02} max=${0.2} step=${0.005} onInput=${setA2} show=${(v) => pct(v)} />
      <${Slider} label="CR web: июнь" value=${b1} min=${0.01} max=${0.2} step=${0.005} onInput=${setB1} show=${(v) => pct(v)} />
      <${Slider} label="CR web: июль" value=${b2} min=${0.01} max=${0.2} step=${0.005} onInput=${setB2} show=${(v) => pct(v)} />
    </div>
    <svg class="chart" viewBox="0 0 640 200">
      ${bars.map(([l, v, c], i) => { const h = (150 * v) / ymax, x = 20 + i * 102; return html`<g><rect x=${x} y=${170 - h} width="74" height=${h} rx="6" fill=${c} opacity=${i % 2 ? 0.95 : 0.55} /><text x=${x + 37} y=${165 - h} text-anchor="middle">${pct(v)}</text><text x=${x + 37} y="190" text-anchor="middle">${l}</text></g>`; })}
    </svg>
    <${Readouts} items=${[['Изменение общей CR', (100 * (t2 - t1)).toFixed(2) + ' пп'], ['Эффект внутри сегментов', (100 * within).toFixed(2) + ' пп'], ['Эффект микса', (100 * mix).toFixed(2) + ' пп']]} />
    <div class="widget-note">Разложение: изменение общей конверсии = изменение внутри сегментов (при новых долях) + сдвиг долей (при старых конверсиях). Двигай долю web — и смотри, как эффект микса перекрывает рост внутри каждой платформы.</div>
  <//>`;
}

// ═════ ЦПТ ═════
const CLT_D = {
  exp: ['Экспоненциальное', (r) => -Math.log(1 - r.u())],
  logn: ['Логнормальное (σ = 1)', (r) => Math.exp(r.normal())],
  bern: ['Бернулли, p = 5%', (r) => (r.u() < 0.05 ? 1 : 0)],
  unif: ['Равномерное', (r) => r.u()],
};
function Clt() {
  const [d, setD] = useState('exp');
  const [n, setN] = useState(5);
  const [seed, setSeed] = useState(1);
  const res = useMemo(() => {
    const r = makeRng(seed + 500);
    const f = CLT_D[d][1];
    const means = Array.from({ length: 3000 }, () => { let s = 0; for (let i = 0; i < n; i++) s += f(r); return s / n; });
    const m = mean(means), s = sd(means);
    const skew = means.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / means.length;
    return { means, m, s, skew };
  }, [d, n, seed]);
  const sorted = [...res.means].sort((a, b) => a - b);
  const lo = quantile(sorted, 0.002), hi = quantile(sorted, 0.998);
  const B = 40, bw = (hi - lo) / B || 1, cnt = new Array(B).fill(0);
  res.means.forEach((v) => { const i = Math.floor((v - lo) / bw); if (i >= 0 && i < B) cnt[i]++; });
  const dens = cnt.map((c) => c / (res.means.length * bw));
  const curve = Array.from({ length: 120 }, (_, i) => { const x = lo + ((hi - lo) * i) / 119; return [x, Math.exp(-((x - res.m) ** 2) / (2 * res.s * res.s)) / (res.s * Math.sqrt(2 * Math.PI))]; });
  const ymax = Math.max(...dens, ...curve.map((c) => c[1])) * 1.1;
  return html`<${Widget} title="Центральная предельная теорема вживую" tag="симуляция">
    <div class="controls">
      <${Select} label="Распределение одного наблюдения" value=${d} onChange=${setD} options=${Object.entries(CLT_D).map(([k, v]) => [k, v[0]])} />
      <${Slider} label="Наблюдений в среднем, n" value=${n} min=${1} max=${300} onInput=${setN} />
    </div>
    <${Plot} x=${[lo, hi]} y=${[0, ymax]} yLabel="плотность" yFmt=${(v) => +v.toFixed(2)}>
      ${(sx, sy) => html`${dens.map((v, i) => html`<rect x=${sx(lo + i * bw) + 0.5} y=${sy(v)} width=${Math.max(0, sx(lo + (i + 1) * bw) - sx(lo + i * bw) - 1)} height=${sy(0) - sy(v)} fill=${C.a} opacity="0.6" />`)}
        <path d=${path(curve, sx, sy)} fill="none" stroke=${C.b} stroke-width="2" />`}
    <//>
    <${Readouts} items=${[['Асимметрия средних', fmt(res.skew, 2)], ['SD средних', fmt(res.s, 4)], ['Ожидаемая асимметрия → 0', n >= 30 ? 'почти' : 'ещё нет']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Пересэмплировать</button></div>
    <div class="widget-note">3000 раз берём n наблюдений и считаем среднее. При n = 1 гистограмма повторяет исходное распределение, с ростом n становится нормальной (красная кривая). Для логнормального и редкого Бернулли нужно заметно больше n, чем для равномерного.</div>
  <//>`;
}

// ═════ Дельта-метод против наивной формулы ═════
function Delta() {
  const [het, setHet] = useState(1);
  const [seed, setSeed] = useState(2);
  const res = useMemo(() => {
    const r = makeRng(seed + 1200);
    const N = 400, M = 300;
    let fpNaive = 0, fpDelta = 0;
    const diffs = [], naiveSe = [], deltaSe = [];
    for (let k = 0; k < M; k++) {
      const grp = [[], []];
      for (let g = 0; g < 2; g++) {
        for (let i = 0; i < N; i++) {
          const lvl = Math.exp(het * r.normal());
          const n = r.poisson(1.5);
          let x = 0; const ords = [];
          for (let j = 0; j < n; j++) { const v = 1000 * lvl * Math.exp(0.3 * r.normal()); x += v; ords.push(v); }
          grp[g].push({ x, y: n, ords });
        }
      }
      const stat = grp.map((us) => {
        const X = us.map((u) => u.x), Y = us.map((u) => u.y);
        const mx = mean(X), my = mean(Y), R = mx / my;
        const vx = sd(X) ** 2, vy = sd(Y) ** 2;
        let cov = 0; for (let i = 0; i < N; i++) cov += (X[i] - mx) * (Y[i] - my); cov /= N - 1;
        const vDelta = (vx - 2 * R * cov + R * R * vy) / (N * my * my);
        const all = us.flatMap((u) => u.ords);
        const vNaive = (sd(all) ** 2) / all.length;
        return { R, vDelta, vNaive };
      });
      const d = stat[1].R - stat[0].R;
      const seN = Math.sqrt(stat[0].vNaive + stat[1].vNaive), seD = Math.sqrt(stat[0].vDelta + stat[1].vDelta);
      if (Math.abs(d / seN) > 1.96) fpNaive++;
      if (Math.abs(d / seD) > 1.96) fpDelta++;
      diffs.push(d); naiveSe.push(seN); deltaSe.push(seD);
    }
    return { fpNaive: fpNaive / M, fpDelta: fpDelta / M, trueSe: sd(diffs), naive: mean(naiveSe), delta: mean(deltaSe) };
  }, [het, seed]);
  return html`<${Widget} title="Средний чек в A/A-тесте: наивная SE против дельта-метода" tag="симуляция">
    <div class="controls"><${Slider} label="Насколько пользователи различаются по чеку" value=${het} min=${0} max=${1.2} step=${0.1} onInput=${setHet} show=${(v) => v.toFixed(1)} /></div>
    <${Readouts} items=${[['Истинный разброс разницы', int(res.trueSe)], ['Наивная SE (заказы независимы)', int(res.naive)], ['SE дельта-методом', int(res.delta)], ['Ложных побед: наивно', pct(res.fpNaive)], ['Ложных побед: дельта', pct(res.fpDelta)]]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Ещё 300 A/A-тестов</button></div>
    <div class="widget-note">Каждый из 300 A/A-тестов — по 400 пользователей в группе, у каждого свой «уровень чека». Наивная формула считает заказы независимыми и занижает SE: ложных побед больше 5%. Дельта-метод считает дисперсию по пользователям и держит α около 5%. Поставь различия = 0 — и формулы сойдутся.</div>
  <//>`;
}

// ═════ Байесовский A/B ═════
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const betaPdf = (x, a, b) => (x <= 0 || x >= 1 ? 0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lgamma(a) + lgamma(b) - lgamma(a + b))));
function Bayes() {
  const [na, setNa] = useState(2000), [ka, setKa] = useState(200);
  const [nb, setNb] = useState(2000), [kb, setKb] = useState(228);
  const a = [ka + 1, na - ka + 1], b = [kb + 1, nb - kb + 1];
  const res = useMemo(() => {
    const r = makeRng(9);
    const gamma = (k) => { // Marsaglia–Tsang
      if (k < 1) return gamma(k + 1) * Math.pow(r.u(), 1 / k);
      const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
      for (;;) { let x, v; do { x = r.normal(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = r.u(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
    };
    const beta = (p, q) => { const x = gamma(p); return x / (x + gamma(q)); };
    let win = 0, loss = 0; const S = 6000; const lifts = [];
    for (let i = 0; i < S; i++) { const pa = beta(...a), pb = beta(...b); if (pb > pa) win++; loss += Math.max(pa - pb, 0); lifts.push(pb / pa - 1); }
    lifts.sort((x, y) => x - y);
    return { pWin: win / S, loss: loss / S, lo: quantile(lifts, 0.025), hi: quantile(lifts, 0.975) };
  }, [na, ka, nb, kb]);
  const ma = a[0] / (a[0] + a[1]), mb = b[0] / (b[0] + b[1]);
  const spread = 5 * Math.sqrt((ma * (1 - ma)) / na + (mb * (1 - mb)) / nb) + Math.abs(mb - ma);
  const lo = Math.max(0, Math.min(ma, mb) - spread), hi = Math.min(1, Math.max(ma, mb) + spread);
  const ca = [], cb = [];
  for (let i = 0; i <= 200; i++) { const x = lo + ((hi - lo) * i) / 200; ca.push([x, betaPdf(x, ...a)]); cb.push([x, betaPdf(x, ...b)]); }
  const ymax = Math.max(...ca.map((c) => c[1]), ...cb.map((c) => c[1])) * 1.1;
  const z = (kb / nb - ka / na) / Math.sqrt(((ka + kb) / (na + nb)) * (1 - (ka + kb) / (na + nb)) * (1 / na + 1 / nb));
  return html`<${Widget} title="Байесовский A/B: вероятность, что B лучше" tag="калькулятор">
    <div class="controls">
      <${Slider} label="A: пользователей" value=${na} min=${100} max=${20000} step=${100} onInput=${(v) => { setNa(v); setKa(Math.min(ka, v)); }} show=${int} />
      <${Slider} label="A: конверсий" value=${ka} min=${0} max=${na} onInput=${setKa} show=${int} />
      <${Slider} label="B: пользователей" value=${nb} min=${100} max=${20000} step=${100} onInput=${(v) => { setNb(v); setKb(Math.min(kb, v)); }} show=${int} />
      <${Slider} label="B: конверсий" value=${kb} min=${0} max=${nb} onInput=${setKb} show=${int} />
    </div>
    <${Plot} x=${[lo, hi]} y=${[0, ymax]} xFmt=${(v) => (100 * v).toFixed(1) + '%'} yTicks=${[]} xLabel="истинная конверсия">
      ${(sx, sy) => html`<path d=${path(ca, sx, sy)} fill="none" stroke=${C.a} stroke-width="2.2" /><path d=${path(cb, sx, sy)} fill="none" stroke=${C.b} stroke-width="2.2" />`}
    <//>
    <div class="legend"><span><i style=${{ background: C.a }}></i>апостериорное A</span><span><i style=${{ background: C.b }}></i>апостериорное B</span></div>
    <${Readouts} items=${[['P(B > A)', pct(res.pWin)], ['Ожидаемая потеря, если выбрать B', (100 * res.loss).toFixed(3) + ' пп'], ['95% интервал прироста', `${pct(res.lo)} … ${pct(res.hi)}`], ['z частотного теста', fmt(z, 2)]]} />
    <div class="widget-note">Априорное распределение — Beta(1, 1), то есть «ничего не знаем». Байесовский ответ звучит как «с вероятностью 93% B лучше», а ожидаемая потеря говорит, сколько мы проиграем, если ошибёмся. При больших выборках выводы почти совпадают с частотным тестом.</div>
  <//>`;
}

// ═════ Последовательные границы ═════
const OBF = { 2: 1.977, 3: 2.004, 4: 2.024, 5: 2.04, 6: 2.053, 7: 2.063, 8: 2.072, 9: 2.08, 10: 2.087 };
const POC = { 2: 2.178, 3: 2.289, 4: 2.361, 5: 2.413, 6: 2.453, 7: 2.485, 8: 2.512, 9: 2.535, 10: 2.555 };
function Sequential() {
  const [K, setK] = useState(5);
  const [eff, setEff] = useState(0);
  const sims = useMemo(() => {
    const r = makeRng(77 + K * 3 + Math.round(eff * 100));
    const M = 2000;
    const res = { naive: 0, obf: 0, poc: 0, obfEarly: 0 };
    for (let m = 0; m < M; m++) {
      let s = 0, hitN = false, hitO = false, hitP = false;
      for (let k = 1; k <= K; k++) {
        s += r.normal() + eff * Math.sqrt(1);
        const z = s / Math.sqrt(k);
        if (Math.abs(z) > 1.96) hitN = true;
        if (!hitO && Math.abs(z) > OBF[K] * Math.sqrt(K / k)) { hitO = true; if (k < K) res.obfEarly++; }
        if (Math.abs(z) > POC[K]) hitP = true;
      }
      if (hitN) res.naive++; if (hitO) res.obf++; if (hitP) res.poc++;
    }
    return { naive: res.naive / M, obf: res.obf / M, poc: res.poc / M, early: res.obfEarly / M };
  }, [K, eff]);
  const ks = Array.from({ length: K }, (_, i) => i + 1);
  return html`<${Widget} title="Границы последовательного теста" tag="симуляция">
    <div class="controls">
      <${Slider} label="Число промежуточных проверок" value=${K} min=${2} max=${10} onInput=${setK} />
      <${Slider} label="Истинный эффект (в SE на одну порцию данных)" value=${eff} min=${0} max=${1.5} step=${0.1} onInput=${setEff} show=${(v) => (v ? v.toFixed(1) : 'нет')} />
    </div>
    <${Plot} x=${[1, K]} y=${[0, 7]} xLabel="номер проверки" yLabel="|z| для остановки" xTicks=${ks}>
      ${(sx, sy) => html`
        <path d=${path(ks.map((k) => [k, 1.96]), sx, sy)} fill="none" stroke=${C.d} stroke-width="2" stroke-dasharray="5 4" />
        <path d=${path(ks.map((k) => [k, POC[K]]), sx, sy)} fill="none" stroke=${C.e} stroke-width="2" />
        <path d=${path(ks.map((k) => [k, Math.min(7, OBF[K] * Math.sqrt(K / k))]), sx, sy)} fill="none" stroke=${C.a} stroke-width="2.5" />`}
    <//>
    <div class="legend"><span><i style=${{ background: C.d }}></i>наивно 1.96 каждый раз</span><span><i style=${{ background: C.e }}></i>Pocock</span><span><i style=${{ background: C.a }}></i>O'Brien–Fleming</span></div>
    <${Readouts} items=${[[eff ? 'Мощность: наивно' : 'Ложные победы: наивно', pct(sims.naive)], [eff ? 'Мощность: Pocock' : 'Ложные победы: Pocock', pct(sims.poc)], [eff ? 'Мощность: O’Brien–Fleming' : 'Ложные победы: OBF', pct(sims.obf)], ['OBF остановился досрочно', pct(sims.early)]]} />
    <div class="widget-note">O'Brien–Fleming ставит очень строгий порог в начале и почти обычный 1.96 в конце: если эффект огромный — тест закончится раньше, а итоговый α останется 5%. Pocock — одинаковый, но более высокий порог на каждой проверке.</div>
  <//>`;
}

// ═════ Difference-in-differences ═════
function Did() {
  const [effect, setEffect] = useState(3);
  const [trend, setTrend] = useState(0);
  const [noise, setNoise] = useState(0.8);
  const [seed, setSeed] = useState(4);
  const W = 16, L = 8;
  const d = useMemo(() => {
    const r = makeRng(seed + 31);
    const ctrl = [], trt = [];
    for (let w = 0; w < W; w++) {
      const common = 70 + 0.5 * w + (w % 4 === 3 ? 1.5 : 0);
      ctrl.push(common + noise * r.normal());
      trt.push(common + 6 + trend * w + (w >= L ? effect : 0) + noise * r.normal());
    }
    return { ctrl, trt };
  }, [effect, trend, noise, seed]);
  const m = (a, from, to) => mean(a.slice(from, to));
  const did = (m(d.trt, L, W) - m(d.trt, 0, L)) - (m(d.ctrl, L, W) - m(d.ctrl, 0, L));
  const naive = m(d.trt, L, W) - m(d.trt, 0, L);
  const truthAvg = effect;
  const all = [...d.ctrl, ...d.trt];
  return html`<${Widget} title="Difference-in-differences и параллельные тренды" tag="симуляция">
    <div class="controls">
      <${Slider} label="Истинный эффект запуска (пп)" value=${effect} min=${-3} max=${8} step=${0.5} onInput=${setEffect} />
      <${Slider} label="Нарушение параллельности (пп в неделю)" value=${trend} min=${-0.6} max=${0.6} step=${0.1} onInput=${setTrend} show=${(v) => v.toFixed(1)} />
      <${Slider} label="Шум" value=${noise} min=${0} max=${3} step=${0.1} onInput=${setNoise} show=${(v) => v.toFixed(1)} />
    </div>
    <${Plot} x=${[0, W - 1]} y=${[Math.min(...all) - 2, Math.max(...all) + 2]} xLabel="неделя" yLabel="конверсия, %">
      ${(sx, sy) => html`
        <line x1=${sx(L - 0.5)} x2=${sx(L - 0.5)} y1=${sy(Math.min(...all) - 2)} y2=${sy(Math.max(...all) + 2)} stroke="var(--line2)" stroke-dasharray="4 4" />
        <path d=${path(d.ctrl.map((v, i) => [i, v]), sx, sy)} fill="none" stroke=${C.a} stroke-width="2.2" />
        <path d=${path(d.trt.map((v, i) => [i, v]), sx, sy)} fill="none" stroke=${C.b} stroke-width="2.2" />
        <path d=${path(d.ctrl.map((v, i) => [i, v + (m(d.trt, 0, L) - m(d.ctrl, 0, L))]).slice(L - 1), sx, sy)} fill="none" stroke=${C.b} stroke-width="1.5" stroke-dasharray="4 3" opacity="0.7" />`}
    <//>
    <div class="legend"><span><i style=${{ background: C.a }}></i>контрольные города</span><span><i style=${{ background: C.b }}></i>город с запуском</span><span>пунктир — контрфакт по DiD</span></div>
    <${Readouts} items=${[['Оценка DiD', fmt(did, 2) + ' пп'], ['Наивно «до/после»', fmt(naive, 2) + ' пп'], ['Истина', fmt(truthAvg, 2) + ' пп']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новый шум</button></div>
    <div class="widget-note">Пока тренды параллельны, DiD находит истинный эффект, а «до/после» добавляет к нему общий рост рынка. Сдвинь «нарушение параллельности» — и DiD начнёт ошибаться. Поэтому pre-trends проверяют до запуска.</div>
  <//>`;
}

// ═════ Uplift-кривая на данных promo_campaign ═════
function Qini() {
  const [score, setScore] = useState('sleep');
  const curves = useMemo(() => {
    const rows = getData().tables.promo_campaign;
    const scorers = {
      random: (r) => (r.customer_id * 2654435761) % 1000,
      prop: (r) => r.orders_prev_90d * 100 - r.days_since_last_order,
      sleep: (r) => (r.orders_prev_90d > 0 && r.days_since_last_order > 30 ? 1000 : r.orders_prev_90d === 0 ? 500 : 0) + r.days_since_last_order,
    };
    const build = (f) => {
      const sorted = [...rows].sort((a, b) => f(b) - f(a));
      let nt = 0, nc = 0, kt = 0, kc = 0; const pts = [[0, 0]];
      sorted.forEach((r, i) => {
        if (r.treatment) { nt++; kt += r.converted; } else { nc++; kc += r.converted; }
        if ((i + 1) % 200 === 0 || i === sorted.length - 1) pts.push([(i + 1) / sorted.length, nt && nc ? (kt / nt - kc / nc) * (i + 1) : 0]);
      });
      return pts;
    };
    return { random: build(scorers.random), prop: build(scorers.prop), sleep: build(scorers.sleep) };
  }, []);
  const cur = curves[score];
  const all = Object.values(curves).flat().map((p) => p[1]);
  const ymax = Math.max(...all) * 1.1, ymin = Math.min(0, ...all);
  const at30 = cur.find((p) => p[0] >= 0.3)[1];
  return html`<${Widget} title="Uplift-кривая: кому отправлять промокод" tag="живые данные">
    <div class="controls"><${Select} label="Как ранжируем клиентов" value=${score} onChange=${setScore} options=${[['sleep', 'сначала «спящие» (uplift-логика)'], ['prop', 'сначала самые активные (вероятность покупки)'], ['random', 'случайно']]} /></div>
    <${Plot} x=${[0, 1]} y=${[ymin, ymax]} xFmt=${(v) => (100 * v).toFixed(0) + '%'} xLabel="доля клиентов, получивших промокод" yLabel="доп. заказы" yFmt=${(v) => int(v)}>
      ${(sx, sy) => html`
        ${['random', 'prop', 'sleep'].map((k) => html`<path d=${path(curves[k], sx, sy)} fill="none" stroke=${{ random: 'var(--faint)', prop: C.d, sleep: C.c }[k]} stroke-width=${k === score ? 3 : 1.4} opacity=${k === score ? 1 : 0.5} />`)}`}
    <//>
    <div class="legend"><span><i style=${{ background: C.c }}></i>спящие первыми</span><span><i style=${{ background: C.d }}></i>активные первыми</span><span><i style="background:var(--faint)"></i>случайно</span></div>
    <${Readouts} items=${[['Доп. заказов при охвате 30%', int(at30)], ['При охвате 100%', int(cur[cur.length - 1][1])]]} />
    <div class="widget-note">По оси Y — сколько дополнительных заказов дал промокод в отобранной доле клиентов (разница конверсий treatment и control × размер доли). Ранжирование «активные первыми» тратит промокоды на тех, кто купил бы и так: кривая растёт медленнее случайной.</div>
  <//>`;
}

// ═════ Дерево метрик ═════
function MetricTree() {
  const [du, setDu] = useState(0), [dc, setDc] = useState(0.05), [df, setDf] = useState(-0.02), [da, setDa] = useState(0.03);
  const base = { users: 50000, cr: 0.32, freq: 1.8, aov: 1650 };
  const gmv0 = base.users * base.cr * base.freq * base.aov;
  const gmv1 = gmv0 * (1 + du) * (1 + dc) * (1 + df) * (1 + da);
  const lt = Math.log(gmv1 / gmv0) || 1e-9;
  const parts = [['Активные', du], ['Конверсия', dc], ['Частота', df], ['Средний чек', da]].map(([n, d]) => [n, (Math.log(1 + d) / lt) * (gmv1 - gmv0)]);
  const scale = Math.max(...parts.map((p) => Math.abs(p[1])), Math.abs(gmv1 - gmv0), 1);
  return html`<${Widget} title="Дерево метрик: откуда изменение GMV" tag="калькулятор">
    <div class="controls">
      <${Slider} label="Активные пользователи" value=${du} min=${-0.2} max=${0.2} step=${0.01} onInput=${setDu} show=${(v) => (v > 0 ? '+' : '') + pct(v, 0)} />
      <${Slider} label="Конверсия в покупку" value=${dc} min=${-0.2} max=${0.2} step=${0.01} onInput=${setDc} show=${(v) => (v > 0 ? '+' : '') + pct(v, 0)} />
      <${Slider} label="Заказов на покупателя" value=${df} min=${-0.2} max=${0.2} step=${0.01} onInput=${setDf} show=${(v) => (v > 0 ? '+' : '') + pct(v, 0)} />
      <${Slider} label="Средний чек" value=${da} min=${-0.2} max=${0.2} step=${0.01} onInput=${setDa} show=${(v) => (v > 0 ? '+' : '') + pct(v, 0)} />
    </div>
    <svg class="chart" viewBox="0 0 640 210">
      <text x="10" y="18" style="font-weight:700;fill:var(--text)">GMV = активные × конверсия × частота × чек</text>
      ${[...parts, ['Итого', gmv1 - gmv0]].map(([n, v], i) => { const w = (250 * Math.abs(v)) / scale, y = 34 + i * 34; return html`<g>
        <text x="120" y=${y + 16} text-anchor="end">${n}</text>
        <line x1="380" x2="380" y1=${y} y2=${y + 24} stroke="var(--line2)" />
        <rect x=${v >= 0 ? 380 : 380 - w} y=${y + 2} width=${w} height="20" rx="5" fill=${i === 4 ? C.e : v >= 0 ? C.c : C.b} opacity="0.85" />
        <text x=${v >= 0 ? 386 + w : 374 - w} y=${y + 16} text-anchor=${v >= 0 ? 'start' : 'end'}>${(v >= 0 ? '+' : '−') + int(Math.abs(v) / 1000)} тыс. ₽</text>
      </g>`; })}
    </svg>
    <${Readouts} items=${[['GMV было', int(gmv0 / 1e6) + ' млн ₽'], ['GMV стало', (gmv1 / 1e6).toFixed(1) + ' млн ₽'], ['Изменение', pct(gmv1 / gmv0 - 1)]]} />
    <div class="widget-note">Множители перемножаются, поэтому вклад каждого считается через логарифмы: вклад_i = ln(1 + Δ_i) / ln(GMV₁ / GMV₀) × ΔGMV. Сумма вкладов в точности равна изменению GMV.</div>
  <//>`;
}

// ═════ LTV и окупаемость ═════
function Ltv() {
  const [m1, setM1] = useState(0.45), [plat, setPlat] = useState(0.2), [arpu, setArpu] = useState(1400), [margin, setMargin] = useState(0.09), [cac, setCac] = useState(540);
  const months = 24;
  const ret = Array.from({ length: months + 1 }, (_, t) => (t === 0 ? 1 : plat + (m1 - plat) * Math.exp(-(t - 1) / 3)));
  const cum = []; let acc = 0;
  ret.forEach((r, t) => { acc += r * arpu * margin; cum.push([t, acc]); });
  const payback = cum.find((p) => p[1] >= cac);
  const ymax = Math.max(acc, cac) * 1.15;
  return html`<${Widget} title="LTV по марже и окупаемость канала" tag="калькулятор">
    <div class="controls">
      <${Slider} label="Retention M1" value=${m1} min=${0.1} max=${0.9} step=${0.01} onInput=${setM1} show=${(v) => pct(v, 0)} />
      <${Slider} label="Плато удержания" value=${plat} min=${0} max=${Math.min(m1, 0.6)} step=${0.01} onInput=${setPlat} show=${(v) => pct(v, 0)} />
      <${Slider} label="Выручка на активного в месяц, ₽" value=${arpu} min=${300} max=${5000} step=${50} onInput=${setArpu} show=${int} />
      <${Slider} label="Маржинальность" value=${margin} min=${0.02} max=${0.4} step=${0.01} onInput=${setMargin} show=${(v) => pct(v, 0)} />
      <${Slider} label="CAC, ₽" value=${cac} min=${50} max=${3000} step=${10} onInput=${setCac} show=${int} />
    </div>
    <${Plot} x=${[0, months]} y=${[0, ymax]} xLabel="месяц жизни" yLabel="накопленная маржа, ₽" yFmt=${(v) => int(v)}>
      ${(sx, sy) => html`<line x1=${sx(0)} x2=${sx(months)} y1=${sy(cac)} y2=${sy(cac)} stroke=${C.b} stroke-dasharray="5 4" stroke-width="2" />
        <path d=${path(cum, sx, sy)} fill="none" stroke=${C.c} stroke-width="2.5" />
        ${payback && html`<circle cx=${sx(payback[0])} cy=${sy(payback[1])} r="6" fill=${C.d} />`}`}
    <//>
    <${Readouts} items=${[['LTV₁₂ по марже', int(cum[12][1]) + ' ₽'], ['LTV₂₄ по марже', int(acc) + ' ₽'], ['LTV₁₂ / CAC', fmt(cum[12][1] / cac, 2)], ['Окупаемость', payback ? `${payback[0]} мес.` : 'не окупается за 2 года']]} />
    <div class="widget-note">Зелёная кривая — накопленная маржа на привлечённого пользователя, красный пунктир — CAC. Главный рычаг — плато удержания: оно определяет, растёт ли кривая дальше или упирается в потолок ниже CAC.</div>
  <//>`;
}

// ═════ k-means ═════
function Kmeans() {
  const [k, setK] = useState(3);
  const [seed, setSeed] = useState(3);
  const [iters, setIters] = useState(0);
  const pts = useMemo(() => {
    const r = makeRng(seed + 90);
    const centers = [[0.2, 0.25], [0.75, 0.3], [0.5, 0.8], [0.2, 0.75]];
    return Array.from({ length: 260 }, (_, i) => { const c = centers[i % 4]; return [c[0] + 0.08 * r.normal(), c[1] + 0.08 * r.normal()]; });
  }, [seed]);
  const run = (K, n) => {
    const r = makeRng(seed + K * 13);
    let cs = Array.from({ length: K }, () => pts[Math.floor(r.u() * pts.length)].slice());
    let lab = pts.map(() => 0);
    for (let it = 0; it <= n; it++) {
      lab = pts.map((p) => { let b = 0, bd = Infinity; cs.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd) { bd = d; b = j; } }); return b; });
      if (it === n) break;
      cs = cs.map((c, j) => { const m = pts.filter((_, i) => lab[i] === j); return m.length ? [mean(m.map((p) => p[0])), mean(m.map((p) => p[1]))] : c; });
    }
    const inertia = pts.reduce((a, p, i) => a + (p[0] - cs[lab[i]][0]) ** 2 + (p[1] - cs[lab[i]][1]) ** 2, 0);
    return { cs, lab, inertia };
  };
  const cur = useMemo(() => run(k, iters), [k, iters, pts]);
  const elbow = useMemo(() => Array.from({ length: 7 }, (_, i) => [i + 1, run(i + 1, 25).inertia]), [pts]);
  const cols = [C.a, C.b, C.c, C.d, C.e, '#38bdf8', '#fb923c'];
  return html`<${Widget} title="k-means: кластеризация клиентов" tag="симуляция">
    <div class="controls">
      <${Slider} label="Число кластеров k" value=${k} min=${1} max=${7} onInput=${(v) => { setK(v); setIters(0); }} />
      <${Slider} label="Итераций алгоритма" value=${iters} min=${0} max=${10} onInput=${setIters} />
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px">
      <${Plot} w=${340} h=${280} x=${[-0.1, 1.1]} y=${[-0.1, 1.1]} xLabel="частота заказов (норм.)" yLabel="средний чек (норм.)" xTicks=${[]} yTicks=${[]} pad=${{ l: 20 }}>
        ${(sx, sy) => html`${pts.map((p, i) => html`<circle cx=${sx(p[0])} cy=${sy(p[1])} r="3" fill=${cols[cur.lab[i]]} opacity="0.75" />`)}
          ${cur.cs.map((c, j) => html`<g><circle cx=${sx(c[0])} cy=${sy(c[1])} r="9" fill="none" stroke=${cols[j]} stroke-width="3" /><circle cx=${sx(c[0])} cy=${sy(c[1])} r="3" fill="var(--text)" /></g>`)}`}
      <//>
      <${Plot} w=${340} h=${280} x=${[1, 7]} y=${[0, Math.max(...elbow.map((e) => e[1])) * 1.1]} xLabel="k" yLabel="внутрикластерный разброс" xTicks=${[1, 2, 3, 4, 5, 6, 7]} yFmt=${(v) => v.toFixed(1)}>
        ${(sx, sy) => html`<path d=${path(elbow, sx, sy)} fill="none" stroke=${C.e} stroke-width="2.5" />${elbow.map((e) => html`<circle cx=${sx(e[0])} cy=${sy(e[1])} r=${e[0] === k ? 6 : 3.5} fill=${e[0] === k ? C.d : C.e} />`)}`}
      <//>
    </div>
    <div class="task-actions"><button class="btn small" onClick=${() => { setSeed(seed + 1); setIters(0); }}>Новые данные</button></div>
    <div class="widget-note">Слева — шаги алгоритма: точки относятся к ближайшему центру, центр сдвигается в среднее своих точек. Справа — «локоть»: после правильного k разброс почти перестаёт падать. Признаки перед k-means обязательно стандартизуют, иначе чек в рублях задавит частоту в штуках.</div>
  <//>`;
}

// ═════ Сезонность на данных ═════
function Seasonality() {
  const [metric, setMetric] = useState('orders');
  const series = useMemo(() => {
    const o = getData().tables.orders.filter((x) => x.status === 'delivered');
    const by = new Map();
    for (const x of o) { const d = x.ts.slice(0, 10); const v = by.get(d) || [0, 0]; v[0]++; v[1] += x.revenue; by.set(d, v); }
    return Array.from({ length: END_DAY + 1 }, (_, d) => { const v = by.get(dayToDate(d)) || [0, 0]; return [d, v[0], v[1] / 1000]; });
  }, []);
  const idx = metric === 'orders' ? 1 : 2;
  const pts = series.map((s) => [s[0], s[idx]]);
  const ma = pts.map((p, i) => [p[0], i >= 6 ? mean(pts.slice(i - 6, i + 1).map((x) => x[1])) : NaN]);
  const dow = Array.from({ length: 7 }, (_, w) => { const vals = series.filter((s) => s[0] >= 120 && (1 + s[0]) % 7 === w).map((s) => s[idx]); return mean(vals); });
  const dowOrder = [1, 2, 3, 4, 5, 6, 0], dowRu = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const ymax = Math.max(...pts.map((p) => p[1])) * 1.05;
  const dmax = Math.max(...dow) * 1.15;
  return html`<${Widget} title="Ряд заказов «Корзинки»: тренд и недельная сезонность" tag="живые данные">
    <div class="controls"><${Select} label="Метрика" value=${metric} onChange=${setMetric} options=${[['orders', 'Заказы в день'], ['rev', 'Выручка, тыс. ₽']]} /></div>
    <${Plot} x=${[0, END_DAY]} y=${[0, ymax]} xTicks=${[0, 31, 60, 91, 121, 152, 182, 212]} xFmt=${(v) => dayToDate(v).slice(5)} yFmt=${(v) => int(v)}>
      ${(sx, sy) => html`<path d=${path(pts, sx, sy)} fill="none" stroke=${C.a} stroke-width="1.2" opacity="0.6" /><path d=${path(ma, sx, sy)} fill="none" stroke=${C.b} stroke-width="2.5" />`}
    <//>
    <div class="legend"><span><i style=${{ background: C.a }}></i>по дням</span><span><i style=${{ background: C.b }}></i>скользящее среднее за 7 дней</span></div>
    <svg class="chart" viewBox="0 0 640 150">
      <text x="10" y="16" style="fill:var(--text);font-weight:700">Средний день недели (май–июль)</text>
      ${dowOrder.map((w, i) => { const h = (100 * dow[w]) / dmax, x = 30 + i * 85; return html`<g><rect x=${x} y=${130 - h} width="60" height=${h} rx="6" fill=${w === 0 || w === 6 ? C.d : C.e} opacity="0.85" /><text x=${x + 30} y=${125 - h} text-anchor="middle">${int(dow[w])}</text><text x=${x + 30} y="146" text-anchor="middle">${dowRu[i]}</text></g>`; })}
    </svg>
    <div class="widget-note">Видно три вещи: рост до конца июня (новые пользователи), спад в июле (регистрации в данных закончились), всплеск 8 марта и провал 14 мая. Выходные дают больше заказов — поэтому дни сравнивают с тем же днём недели, а тренд смотрят по скользящему среднему.</div>
  <//>`;
}

// ═════ Порог по деньгам ═════
function ThresholdCost() {
  const [dp, setDp] = useState(1.3), [prev, setPrev] = useState(0.35), [cost, setCost] = useState(100), [save, setSave] = useState(0.3), [margin, setMargin] = useState(1000);
  const N = 10000;
  const curve = [];
  let best = [0, -Infinity];
  for (let t = -2.5; t <= 4; t += 0.05) {
    const tpr = 1 - Phi(t - dp), fpr = 1 - Phi(t);
    const contacted = N * (prev * tpr + (1 - prev) * fpr);
    const profit = N * prev * tpr * save * margin - contacted * cost;
    curve.push([t, profit / 1000]);
    if (profit > best[1]) best = [t, profit];
  }
  const share = prev * (1 - Phi(best[0] - dp)) + (1 - prev) * (1 - Phi(best[0]));
  const ys = curve.map((c) => c[1]);
  return html`<${Widget} title="Порог модели оттока: максимум прибыли" tag="калькулятор">
    <div class="controls">
      <${Slider} label="Качество модели (d′)" value=${dp} min=${0} max=${3} step=${0.1} onInput=${setDp} show=${(v) => v.toFixed(1) + ` · AUC ${Phi(v / Math.SQRT2).toFixed(2)}`} />
      <${Slider} label="Доля уходящих" value=${prev} min=${0.02} max=${0.6} step=${0.01} onInput=${setPrev} show=${(v) => pct(v, 0)} />
      <${Slider} label="Стоимость контакта, ₽" value=${cost} min=${10} max=${500} step=${10} onInput=${setCost} show=${int} />
      <${Slider} label="Доля удержанных кампанией" value=${save} min=${0.05} max=${0.8} step=${0.05} onInput=${setSave} show=${(v) => pct(v, 0)} />
      <${Slider} label="Маржа удержанного, ₽" value=${margin} min=${200} max=${5000} step=${100} onInput=${setMargin} show=${int} />
    </div>
    <${Plot} x=${[-2.5, 4]} y=${[Math.min(...ys, 0), Math.max(...ys) * 1.1 || 1]} xLabel="порог по скору модели" yLabel="прибыль, тыс. ₽ на 10 000" yFmt=${(v) => int(v)}>
      ${(sx, sy) => html`<line x1=${sx(-2.5)} x2=${sx(4)} y1=${sy(0)} y2=${sy(0)} stroke="var(--line2)" />
        <path d=${path(curve, sx, sy)} fill="none" stroke=${C.c} stroke-width="2.5" />
        <circle cx=${sx(best[0])} cy=${sy(best[1] / 1000)} r="6" fill=${C.d} />`}
    <//>
    <${Readouts} items=${[['Лучшая прибыль', int(Math.max(0, best[1])) + ' ₽'], ['Кому писать', pct(best[1] > 0 ? share : 0)], ['Порог по вероятности', fmt(cost / (save * margin), 3)]]} />
    <div class="widget-note">Порог «0.5 по умолчанию» почти никогда не оптимален. Оптимум зависит от экономики: чем дешевле контакт и дороже клиент, тем больше людей выгодно охватить. Если прибыль везде ниже нуля — кампанию не запускают.</div>
  <//>`;
}

// ═════ Винзоризация на данных ═════
function Winsor() {
  const [q, setQ] = useState(1);
  const vals = useMemo(() => getData().tables.orders.filter((o) => o.status === 'delivered').map((o) => o.revenue).sort((a, b) => a - b), []);
  const cap = quantile(vals, q);
  const w = vals.map((v) => Math.min(v, cap));
  const m0 = mean(vals), s0 = sd(vals), m1 = mean(w), s1 = sd(w);
  const lo = Math.log10(vals[0]), hi = Math.log10(vals[vals.length - 1]);
  const B = 50, bw = (hi - lo) / B, cnt = new Array(B).fill(0);
  vals.forEach((v) => { cnt[Math.min(B - 1, Math.floor((Math.log10(v) - lo) / bw))]++; });
  const ymax = Math.max(...cnt) * 1.1;
  return html`<${Widget} title="Выбросы выручки и винзоризация" tag="живые данные">
    <div class="controls"><${Slider} label="Порог усечения (перцентиль)" value=${q} min=${0.9} max=${1} step=${0.001} onInput=${setQ} show=${(v) => (v === 1 ? 'без усечения' : `p${(100 * v).toFixed(1)}`)} /></div>
    <${Plot} x=${[lo, hi]} y=${[0, ymax]} xFmt=${(v) => int(10 ** v)} xLabel="выручка заказа, ₽ (логарифмическая шкала)" yFmt=${(v) => int(v)}>
      ${(sx, sy) => html`${cnt.map((c, i) => html`<rect x=${sx(lo + i * bw) + 0.5} y=${sy(c)} width=${Math.max(0, sx(lo + (i + 1) * bw) - sx(lo + i * bw) - 1)} height=${sy(0) - sy(c)} fill=${lo + (i + 0.5) * bw > Math.log10(cap) ? C.b : C.a} opacity="0.7" />`)}
        <line x1=${sx(Math.log10(cap))} x2=${sx(Math.log10(cap))} y1=${sy(0)} y2=${sy(ymax)} stroke=${C.d} stroke-width="2" />`}
    <//>
    <${Readouts} items=${[['Порог', int(cap) + ' ₽'], ['Среднее: было → стало', `${int(m0)} → ${int(m1)}`], ['SD: было → стало', `${int(s0)} → ${int(s1)}`], ['Дисперсия упала на', pct(1 - (s1 * s1) / (s0 * s0), 0)], ['Нужно трафика вместо 100%', pct((s1 * s1) / (s0 * s0), 0)]]} />
    <div class="widget-note">Красное — заказы выше порога: их значения заменяются порогом. Посмотри, как сильно падает дисперсия от усечения всего 0.1–0.5% самых крупных заказов — ровно во столько же раз меньше трафика нужно тесту на выручку.</div>
  <//>`;
}

// ═════ Эластичность платы за доставку ═════
function Elasticity() {
  const [margin, setMargin] = useState(0.12);
  const [cost, setCost] = useState(150);
  const g = useMemo(() => {
    const rows = getData().tables.delivery_fee_test;
    return [0, 99, 199].map((f) => {
      const r = rows.filter((x) => x.fee === f);
      const orders = mean(r.map((x) => x.orders_30d)), gmv = mean(r.map((x) => x.gmv_30d));
      return { f, n: r.length, orders, gmv };
    });
  }, []);
  const profit = g.map((x) => x.gmv * margin + x.orders * (x.f - cost));
  const best = profit.indexOf(Math.max(...profit));
  const pmax = Math.max(...profit.map(Math.abs)) * 1.2;
  return html`<${Widget} title="Сколько брать за доставку" tag="живые данные">
    <div class="controls">
      <${Slider} label="Маржинальность товаров" value=${margin} min=${0.05} max=${0.3} step=${0.01} onInput=${setMargin} show=${(v) => pct(v, 0)} />
      <${Slider} label="Себестоимость доставки, ₽" value=${cost} min=${50} max=${300} step=${10} onInput=${setCost} show=${int} />
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Плата</th><th>Клиентов</th><th>Заказов на клиента</th><th>GMV на клиента</th><th>Прибыль на клиента</th></tr></thead>
      <tbody>${g.map((x, i) => html`<tr style=${i === best ? { background: 'var(--good-soft)' } : {}}><td>${x.f} ₽</td><td>${int(x.n)}</td><td>${fmt(x.orders, 2)}</td><td>${int(x.gmv)} ₽</td><td><b>${int(profit[i])} ₽</b></td></tr>`)}</tbody>
    </table></div>
    <svg class="chart" viewBox="0 0 640 130">
      ${g.map((x, i) => { const h = (90 * Math.abs(profit[i])) / pmax, X = 90 + i * 180; return html`<g><rect x=${X} y=${profit[i] >= 0 ? 105 - h : 105} width="110" height=${h} rx="7" fill=${i === best ? C.c : C.e} opacity="0.85" /><text x=${X + 55} y="124" text-anchor="middle">${x.f} ₽</text></g>`; })}
      <line x1="60" x2="600" y1="105" y2="105" stroke="var(--line2)" />
    </svg>
    <${Readouts} items=${[['Заказы на каждые +100 ₽ платы', pct(Math.pow(g[2].orders / g[0].orders, 100 / 199) - 1)], ['Заказы при 199 ₽ против 0 ₽', pct(g[2].orders / g[0].orders - 1)], ['Средний чек при 199 ₽', pct(g[2].gmv / g[2].orders / (g[0].gmv / g[0].orders) - 1)]]} />
    <div class="widget-note">Прибыль на клиента = GMV × маржа + заказы × (плата − себестоимость доставки). С платой клиенты заказывают реже, но крупнее. Какой вариант выгоднее, зависит от маржи и стоимости доставки — двигай ползунки.</div>
  <//>`;
}

export const MORE_WIDGETS = {
  funnel: Funnel, simpson: Simpson, clt: Clt, delta: Delta, bayes: Bayes, sequential: Sequential, did: Did,
  qini: Qini, 'metric-tree': MetricTree, ltv: Ltv, kmeans: Kmeans, seasonality: Seasonality,
  'threshold-cost': ThresholdCost, winsor: Winsor, elasticity: Elasticity,
};
