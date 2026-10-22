import { html, useState, useMemo } from '../lib.js';
import { Widget, Slider, Select, Readouts, Plot, path, makeRng, mean, sd, quantile, fmt, pct, int, Phi, invPhi, tQuantile, C, niceTicks } from './kit.js';
import { getData, dayToDate, END_DAY } from '../data/generate.js';

// ═════ 1. Распределения и выборочный шум ═════
const DISTS = {
  normal: { name: 'Нормальное', param: ['σ', 0.3, 3, 0.1, 1], mean: () => 0, sd: (s) => s, draw: (r, s) => r.normal() * s, pdf: (x, s) => Math.exp(-(x * x) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI)), range: (s) => [-4 * s, 4 * s] },
  uniform: { name: 'Равномерное [0, a]', param: ['a', 0.5, 5, 0.1, 1], mean: (a) => a / 2, sd: (a) => a / Math.sqrt(12), draw: (r, a) => r.u() * a, pdf: (x, a) => (x >= 0 && x <= a ? 1 / a : 0), range: (a) => [-0.1 * a, 1.1 * a] },
  exp: { name: 'Экспоненциальное (время до события)', param: ['λ', 0.2, 3, 0.1, 1], mean: (l) => 1 / l, sd: (l) => 1 / l, draw: (r, l) => -Math.log(1 - r.u()) / l, pdf: (x, l) => (x < 0 ? 0 : l * Math.exp(-l * x)), range: (l) => [0, 6 / l] },
  lognorm: { name: 'Логнормальное (выручка)', param: ['σ лога', 0.2, 1.5, 0.05, 0.8], mean: (s) => Math.exp(s * s / 2), sd: (s) => Math.sqrt((Math.exp(s * s) - 1) * Math.exp(s * s)), draw: (r, s) => Math.exp(s * r.normal()), pdf: (x, s) => (x <= 0 ? 0 : Math.exp(-(Math.log(x) ** 2) / (2 * s * s)) / (x * s * Math.sqrt(2 * Math.PI))), range: (s) => [0, Math.exp(2.3 * s)] },
  bern: { name: 'Бернулли (клик / не клик)', param: ['p', 0.01, 0.99, 0.01, 0.1], mean: (p) => p, sd: (p) => Math.sqrt(p * (1 - p)), draw: (r, p) => (r.u() < p ? 1 : 0), discrete: true, pmf: (k, p) => (k === 1 ? p : k === 0 ? 1 - p : 0), range: () => [0, 1] },
  pois: { name: 'Пуассона (заказов за день)', param: ['λ', 0.3, 12, 0.1, 2], mean: (l) => l, sd: (l) => Math.sqrt(l), draw: (r, l) => r.poisson(l), discrete: true, pmf: (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }, range: (l) => [0, Math.ceil(l + 4 * Math.sqrt(l) + 1)] },
};

function Sampling() {
  const [dist, setDist] = useState('normal');
  const D = DISTS[dist];
  const [param, setParam] = useState(D.param[4]);
  const [n, setN] = useState(500);
  const [seed, setSeed] = useState(1);
  const changeDist = (d) => { setDist(d); setParam(DISTS[d].param[4]); };
  const sample = useMemo(() => { const r = makeRng(seed); return Array.from({ length: n }, () => D.draw(r, param)); }, [dist, param, n, seed]);
  const [lo, hi] = D.range(param);
  const m = mean(sample), s = n > 1 ? sd(sample) : 0;
  let bars, curve, ymax;
  if (D.discrete) {
    const ks = []; for (let k = lo; k <= hi; k++) ks.push(k);
    const cnt = {}; sample.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
    bars = ks.map((k) => ({ x0: k - 0.4, x1: k + 0.4, y: (cnt[k] || 0) / n }));
    curve = ks.map((k) => [k, D.pmf(k, param)]);
    ymax = Math.max(...bars.map((b) => b.y), ...curve.map((c) => c[1])) * 1.1;
  } else {
    const B = 36, bw = (hi - lo) / B;
    const cnt = new Array(B).fill(0);
    sample.forEach((v) => { const i = Math.floor((v - lo) / bw); if (i >= 0 && i < B) cnt[i]++; });
    bars = cnt.map((c, i) => ({ x0: lo + i * bw, x1: lo + (i + 1) * bw, y: c / (n * bw) }));
    curve = Array.from({ length: 200 }, (_, i) => { const x = lo + ((hi - lo) * i) / 199; return [x, D.pdf(x, param)]; });
    ymax = Math.max(...bars.map((b) => b.y), ...curve.map((c) => c[1]).filter(Number.isFinite)) * 1.1;
  }
  const xr = D.discrete ? [lo - 0.6, hi + 0.6] : [lo, hi];
  return html`<${Widget} title="Исследователь распределений">
    <div class="controls">
      <${Select} label="Распределение" value=${dist} onChange=${changeDist} options=${Object.entries(DISTS).map(([k, v]) => [k, v.name])} />
      <${Slider} label=${D.param[0]} value=${param} min=${D.param[1]} max=${D.param[2]} step=${D.param[3]} onInput=${setParam} show=${(v) => v.toFixed(2)} />
      <${Slider} label="Размер выборки" value=${n} min=${10} max=${5000} step=${10} onInput=${setN} />
    </div>
    <${Plot} x=${xr} y=${[0, ymax || 1]} yLabel=${D.discrete ? 'доля' : 'плотность'} yFmt=${(v) => +v.toFixed(2)}>
      ${(sx, sy) => html`
        ${bars.map((b) => html`<rect x=${sx(b.x0) + 0.5} y=${sy(b.y)} width=${Math.max(0, sx(b.x1) - sx(b.x0) - 1)} height=${Math.max(0, sy(0) - sy(b.y))} fill=${C.a} opacity="0.55" />`)}
        ${D.discrete ? curve.map(([k, p]) => html`<circle cx=${sx(k)} cy=${sy(p)} r="4" fill=${C.b} />`) : html`<path d=${path(curve, sx, sy)} fill="none" stroke=${C.b} stroke-width="2" />`}
        <line x1=${sx(m)} x2=${sx(m)} y1=${sy(0)} y2=${sy(ymax)} stroke=${C.d} stroke-width="2" />`}
    <//>
    <div class="legend"><span><i style="background:${C.a}"></i>выборка</span><span><i style="background:${C.b}"></i>истинное распределение</span><span><i style="background:${C.d}"></i>среднее выборки</span></div>
    <${Readouts} items=${[['Среднее выборки', fmt(m)], ['Истинное среднее', fmt(D.mean(param))], ['SD выборки', fmt(s)], ['Истинное SD', fmt(D.sd(param))]]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новая выборка</button><span class="small muted">сид ${seed}</span></div>
    <div class="widget-note">Покрути размер выборки: при n = 30 гистограмма и среднее заметно «гуляют» от выборки к выборке, при n = 5000 почти совпадают с истиной. У логнормального распределения выборочное SD сильно скачет из-за редких больших значений.</div>
  <//>`;
}

// ═════ 2. Сходимость оценки конверсии ═════
function Convergence() {
  const [p, setP] = useState(0.2);
  const [seed, setSeed] = useState(3);
  const N = 3000;
  const pts = useMemo(() => {
    const r = makeRng(seed); let k = 0; const out = [];
    for (let i = 1; i <= N; i++) { if (r.u() < p) k++; if (i % 5 === 0 || i < 50) out.push([i, k / i]); }
    return out;
  }, [p, seed]);
  const at = (n) => pts.find((x) => x[0] >= n)[1];
  const band = (n) => 2 * Math.sqrt((p * (1 - p)) / n);
  const up = [], dn = [];
  for (let n = 10; n <= N; n += 10) { up.push([n, p + band(n)]); dn.push([n, p - band(n)]); }
  const ymax = Math.min(1, p * 2 + 0.05), ymin = Math.max(0, p - (ymax - p));
  return html`<${Widget} title="Как оценка сходится к истине">
    <div class="controls"><${Slider} label="Истинная конверсия p" value=${p} min=${0.01} max=${0.6} step=${0.01} onInput=${setP} show=${(v) => pct(v, 0)} /></div>
    <${Plot} x=${[0, N]} y=${[ymin, ymax]} yFmt=${(v) => (100 * v).toFixed(0) + '%'} xLabel="наблюдений, n">
      ${(sx, sy) => html`
        <path d=${path(up, sx, sy)} fill="none" stroke=${C.d} stroke-dasharray="4 3" />
        <path d=${path(dn, sx, sy)} fill="none" stroke=${C.d} stroke-dasharray="4 3" />
        <line x1=${sx(0)} x2=${sx(N)} y1=${sy(p)} y2=${sy(p)} stroke=${C.b} stroke-width="1.5" />
        <path d=${path(pts.map(([a, b]) => [a, Math.max(ymin, Math.min(ymax, b))]), sx, sy)} fill="none" stroke=${C.a} stroke-width="2" />`}
    <//>
    <div class="legend"><span><i style="background:${C.a}"></i>накопленная оценка p̂</span><span><i style="background:${C.b}"></i>истинное p</span><span><i style="background:${C.d}"></i>коридор ±2·SE</span></div>
    <${Readouts} items=${[['Оценка на n = 100', pct(at(100), 2)], ['Оценка на n = 3000', pct(at(3000), 2)], ['Коридор на n = 100', '±' + (100 * band(100)).toFixed(2) + ' пп'], ['Коридор на n = 3000', '±' + (100 * band(3000)).toFixed(2) + ' пп']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новый прогон</button></div>
    <div class="widget-note">Коридор сужается как 1/√n: чтобы сузить его вдвое, нужно в четыре раза больше данных.</div>
  <//>`;
}

// ═════ 3. Покрытие доверительных интервалов ═════
function CiCoverage() {
  const [dist, setDist] = useState('normal');
  const [n, setN] = useState(30);
  const [level, setLevel] = useState(0.95);
  const [useT, setUseT] = useState('z');
  const [seed, setSeed] = useState(1);
  const M = 100;
  const truth = dist === 'normal' ? 10 : dist === 'lognorm' ? Math.exp(1.2 * 1.2 / 2) : 0.05;
  const ints = useMemo(() => {
    const r = makeRng(seed + 1000);
    const draw = dist === 'normal' ? () => 10 + 3 * r.normal() : dist === 'lognorm' ? () => Math.exp(1.2 * r.normal()) : () => (r.u() < 0.05 ? 1 : 0);
    return Array.from({ length: M }, () => {
      const x = Array.from({ length: n }, draw);
      const m = mean(x), s = sd(x);
      const q = useT === 't' ? tQuantile(1 - (1 - level) / 2, n - 1) : invPhi(1 - (1 - level) / 2);
      const h = (q * s) / Math.sqrt(n);
      return { lo: m - h, hi: m + h, m };
    });
  }, [dist, n, level, useT, seed]);
  const covered = ints.filter((i) => i.lo <= truth && truth <= i.hi).length;
  const all = ints.flatMap((i) => [i.lo, i.hi]).filter(Number.isFinite);
  const span = Math.max(Math.abs(Math.max(...all) - truth), Math.abs(truth - Math.min(...all)));
  return html`<${Widget} title="Что обещает доверительный интервал">
    <div class="controls">
      <${Select} label="Данные" value=${dist} onChange=${setDist} options=${[['normal', 'Нормальные (время в приложении)'], ['lognorm', 'Логнормальные (выручка, тяжёлый хвост)'], ['bern', 'Бернулли, p = 5% (конверсия)']]} />
      <${Slider} label="Размер выборки n" value=${n} min=${5} max=${500} step=${5} onInput=${setN} />
      <${Select} label="Уровень доверия" value=${String(level)} onChange=${(v) => setLevel(Number(v))} options=${[['0.8', '80%'], ['0.9', '90%'], ['0.95', '95%'], ['0.99', '99%']]} />
      <${Select} label="Квантиль" value=${useT} onChange=${setUseT} options=${[['z', 'нормальный (z)'], ['t', 'Стьюдента (t)']]} />
    </div>
    <${Plot} h=${300} x=${[truth - span * 1.05, truth + span * 1.05]} y=${[0, M]} yTicks=${[]} pad=${{ l: 12 }}>
      ${(sx, sy) => html`
        ${ints.map((it, i) => { const ok = it.lo <= truth && truth <= it.hi; return html`<line x1=${sx(it.lo)} x2=${sx(it.hi)} y1=${sy(i + 0.5)} y2=${sy(i + 0.5)} stroke=${ok ? C.a : C.b} stroke-width=${ok ? 1.5 : 2.5} />`; })}
        <line x1=${sx(truth)} x2=${sx(truth)} y1=${sy(0)} y2=${sy(M)} stroke=${C.d} stroke-width="2" />`}
    <//>
    <${Readouts} items=${[['Накрыли истину', `${covered} из ${M}`], ['Обещано', pct(level, 0)], ['Средняя ширина', fmt(mean(ints.map((i) => i.hi - i.lo)), 3)]]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Ещё 100 экспериментов</button></div>
    <div class="widget-note">Каждая линия — интервал из отдельной выборки. Красные промахнулись мимо истинного среднего (жёлтая линия). Попробуй логнормальные данные или конверсию 5% при n = 20: интервалы промахиваются чаще обещанного, потому что нормальное приближение ещё не работает.</div>
  <//>`;
}

// ═════ 4. Калькулятор мощности и MDE ═════
export function sampleSize(p1, mdeRel, alpha, power) {
  const p2 = p1 * (1 + mdeRel);
  const za = invPhi(1 - alpha / 2), zb = invPhi(power);
  return ((za + zb) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p2 - p1) ** 2;
}
function Power() {
  const [p, setP] = useState(0.05);
  const [mde, setMde] = useState(0.05);
  const [alpha, setAlpha] = useState(0.05);
  const [power, setPower] = useState(0.8);
  const [traffic, setTraffic] = useState(5000);
  const n = sampleSize(p, mde, alpha, power);
  const curve = [];
  for (let m = 0.01; m <= 0.301; m += 0.005) curve.push([m * 100, Math.log10(sampleSize(p, m, alpha, power))]);
  const ymin = Math.floor(Math.min(...curve.map((c) => c[1]))), ymax = Math.ceil(Math.max(...curve.map((c) => c[1])));
  return html`<${Widget} title="Сколько трафика нужно эксперименту" tag="калькулятор">
    <div class="controls">
      <${Slider} label="Базовая конверсия" value=${p} min=${0.005} max=${0.5} step=${0.005} onInput=${setP} show=${(v) => pct(v, 1)} />
      <${Slider} label="MDE (относительный)" value=${mde} min=${0.01} max=${0.3} step=${0.005} onInput=${setMde} show=${(v) => pct(v, 1)} />
      <${Select} label="α (уровень значимости)" value=${String(alpha)} onChange=${(v) => setAlpha(Number(v))} options=${[['0.01', '0.01'], ['0.05', '0.05'], ['0.1', '0.10']]} />
      <${Select} label="Мощность 1 − β" value=${String(power)} onChange=${(v) => setPower(Number(v))} options=${[['0.8', '80%'], ['0.9', '90%'], ['0.95', '95%']]} />
      <${Slider} label="Трафик в день на группу" value=${traffic} min=${100} max=${50000} step=${100} onInput=${setTraffic} show=${int} />
    </div>
    <${Plot} x=${[1, 30]} y=${[ymin, ymax]} yTicks=${Array.from({ length: ymax - ymin + 1 }, (_, i) => ymin + i)} yFmt=${(v) => '10^' + v} xFmt=${(v) => v + '%'} xLabel="MDE, относительный" yLabel="n на группу">
      ${(sx, sy) => html`<path d=${path(curve, sx, sy)} fill="none" stroke=${C.a} stroke-width="2" />
        <circle cx=${sx(mde * 100)} cy=${sy(Math.log10(n))} r="5" fill=${C.b} />`}
    <//>
    <${Readouts} items=${[['Нужно на группу', int(n)], ['Всего (2 группы)', int(2 * n)], ['Дней теста', Math.ceil(n / traffic) + ' дн.'], ['Абсолютный эффект', ((p * mde) * 100).toFixed(3) + ' пп']]} />
    <div class="widget-note">Формула для двух долей: n = (z₁₋α/₂ + z₁₋β)² · (p₁(1−p₁) + p₂(1−p₂)) / (p₂ − p₁)². Уменьшишь MDE вдвое — трафика нужно примерно вчетверо больше. Чем ниже базовая конверсия, тем дороже тот же относительный эффект.</div>
  <//>`;
}

// ═════ 5. Подглядывание ═════
function Peeking() {
  const [days, setDays] = useState(20);
  const [perDay, setPerDay] = useState(400);
  const [seed, setSeed] = useState(1);
  const M = 500, p = 0.1;
  const sim = useMemo(() => {
    const r = makeRng(seed + 77);
    let fixedFp = 0, peekFp = 0;
    const traj = [];
    for (let e = 0; e < M; e++) {
      let na = 0, nb = 0, ka = 0, kb = 0, any = false; const tr = [];
      for (let d = 1; d <= days; d++) {
        na += perDay; nb += perDay; ka += r.binom(perDay, p); kb += r.binom(perDay, p);
        const pa = ka / na, pb = kb / nb, pp = (ka + kb) / (na + nb);
        const se = Math.sqrt(pp * (1 - pp) * (1 / na + 1 / nb));
        const z = se > 0 ? (pb - pa) / se : 0;
        const pv = 2 * (1 - Phi(Math.abs(z)));
        if (pv < 0.05) any = true;
        if (e < 25) tr.push([d, pv]);
        if (d === days && pv < 0.05) fixedFp++;
      }
      if (any) peekFp++;
      if (e < 25) traj.push(tr);
    }
    return { fixed: fixedFp / M, peek: peekFp / M, traj };
  }, [days, perDay, seed]);
  return html`<${Widget} title=${'Почему нельзя останавливать тест при первом p < 0.05'} tag="симуляция A/A">
    <div class="controls">
      <${Slider} label="Длительность теста" value=${days} min=${3} max=${40} onInput=${setDays} show=${(v) => v + ' дн.'} />
      <${Slider} label="Пользователей в день на группу" value=${perDay} min=${100} max=${3000} step=${100} onInput=${setPerDay} />
    </div>
    <${Plot} x=${[1, days]} y=${[0, 1]} xLabel="день теста" yLabel="p-value" yTicks=${[0, 0.05, 0.25, 0.5, 0.75, 1]}>
      ${(sx, sy) => html`
        ${sim.traj.map((t) => html`<path d=${path(t, sx, sy)} fill="none" stroke=${t.some((x) => x[1] < 0.05) ? C.b : C.a} stroke-width="1.2" opacity="0.65" />`)}
        <line x1=${sx(1)} x2=${sx(days)} y1=${sy(0.05)} y2=${sy(0.05)} stroke=${C.d} stroke-width="2" />`}
    <//>
    <${Readouts} items=${[['Ложных побед: смотрим 1 раз в конце', pct(sim.fixed)], ['Ложных побед: смотрим каждый день', pct(sim.peek)], ['Номинальный α', '5.0%']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новые ${M} A/A-тестов</button></div>
    <div class="widget-note">Здесь ${M} A/A-тестов: групп различий нет совсем. Если смотреть на p-value каждый день и останавливаться при первом ${'p < 0.05'}, ложных побед становится в разы больше 5%. Красные траектории хотя бы раз пересекли жёлтую линию.</div>
  <//>`;
}

// ═════ 6. Распределение p-value ═════
function PValues() {
  const [effect, setEffect] = useState(0);
  const [n, setN] = useState(2000);
  const [seed, setSeed] = useState(5);
  const M = 2000, p0 = 0.1;
  const pv = useMemo(() => {
    const r = makeRng(seed + 300);
    const p1 = p0 * (1 + effect);
    return Array.from({ length: M }, () => {
      const ka = r.binom(n, p0), kb = r.binom(n, p1);
      const pp = (ka + kb) / (2 * n), se = Math.sqrt(pp * (1 - pp) * (2 / n));
      const z = se > 0 ? (kb - ka) / n / se : 0;
      return 2 * (1 - Phi(Math.abs(z)));
    });
  }, [effect, n, seed]);
  const B = 20, cnt = new Array(B).fill(0);
  pv.forEach((v) => { cnt[Math.min(B - 1, Math.floor(v * B))]++; });
  const ymax = Math.max(...cnt) * 1.1;
  const share = pv.filter((v) => v < 0.05).length / M;
  return html`<${Widget} title="Как распределено p-value" tag="симуляция">
    <div class="controls">
      <${Slider} label="Истинный эффект (относительный)" value=${effect} min=${0} max=${0.2} step=${0.01} onInput=${setEffect} show=${(v) => (v ? '+' + pct(v, 0) : 'нет (H₀ верна)')} />
      <${Slider} label="Пользователей в группе" value=${n} min=${200} max=${20000} step=${200} onInput=${setN} show=${int} />
    </div>
    <${Plot} x=${[0, 1]} y=${[0, ymax]} xLabel="p-value" yFmt=${(v) => int(v)}>
      ${(sx, sy) => cnt.map((c, i) => html`<rect x=${sx(i / B) + 1} y=${sy(c)} width=${sx(1 / B) - sx(0) - 2} height=${sy(0) - sy(c)} fill=${i === 0 ? C.b : C.a} opacity="0.75" />`)}
    <//>
    <${Readouts} items=${[['Доля p < 0.05', pct(share)], [effect ? 'Это мощность теста' : 'Это частота ложных срабатываний', effect ? 'power' : 'α']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новые ${M} экспериментов</button></div>
    <div class="widget-note">Когда эффекта нет, p-value распределено равномерно: ${'p < 0.05'} выпадает ровно в 5% случаев. Когда эффект есть, распределение прижимается к нулю, и доля ${'p < 0.05'} — это мощность.</div>
  <//>`;
}

// ═════ 7. Бутстрап ═════
function Bootstrap() {
  const [n, setN] = useState(200);
  const [stat, setStat] = useState('median');
  const [seed, setSeed] = useState(2);
  const B = 1000;
  const res = useMemo(() => {
    const r = makeRng(seed + 900);
    const x = Array.from({ length: n }, () => Math.round(1300 * Math.exp(0.7 * r.normal())));
    const f = (a) => { if (stat === 'mean') return mean(a); const s = [...a].sort((p, q) => p - q); return quantile(s, stat === 'median' ? 0.5 : 0.9); };
    const est = f(x);
    const boots = [];
    const buf = new Array(n);
    for (let b = 0; b < B; b++) { for (let i = 0; i < n; i++) buf[i] = x[Math.floor(r.u() * n)]; boots.push(f(buf)); }
    boots.sort((p, q) => p - q);
    return { est, boots, lo: quantile(boots, 0.025), hi: quantile(boots, 0.975), se: sd(boots) };
  }, [n, stat, seed]);
  const lo = res.boots[0], hi = res.boots[B - 1];
  const K = 30, bw = (hi - lo) / K || 1, cnt = new Array(K).fill(0);
  res.boots.forEach((v) => { cnt[Math.min(K - 1, Math.floor((v - lo) / bw))]++; });
  const ymax = Math.max(...cnt) * 1.1;
  return html`<${Widget} title="Бутстрап: интервал для любой статистики">
    <div class="controls">
      <${Select} label="Статистика" value=${stat} onChange=${setStat} options=${[['mean', 'Среднее'], ['median', 'Медиана'], ['p90', '90-й перцентиль']]} />
      <${Slider} label="Размер выборки (заказов)" value=${n} min=${20} max=${2000} step=${20} onInput=${setN} />
    </div>
    <${Plot} x=${[lo, hi]} y=${[0, ymax]} xLabel="значение статистики на бутстрап-выборке, ₽" yFmt=${(v) => int(v)} xFmt=${(v) => int(v)}>
      ${(sx, sy) => html`${cnt.map((c, i) => { const x0 = lo + i * bw; const inCi = x0 + bw / 2 >= res.lo && x0 + bw / 2 <= res.hi; return html`<rect x=${sx(x0) + 0.5} y=${sy(c)} width=${Math.max(0, sx(x0 + bw) - sx(x0) - 1)} height=${sy(0) - sy(c)} fill=${inCi ? C.a : C.b} opacity="0.7" />`; })}
        <line x1=${sx(res.est)} x2=${sx(res.est)} y1=${sy(0)} y2=${sy(ymax)} stroke=${C.d} stroke-width="2" />`}
    <//>
    <${Readouts} items=${[['Оценка по выборке', int(res.est) + ' ₽'], ['95% ДИ (перцентильный)', `${int(res.lo)} – ${int(res.hi)}`], ['Бутстрап-SE', int(res.se)]]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новая выборка</button></div>
    <div class="widget-note">${B} раз берём из выборки ${n} значений с возвращением и считаем статистику. Разброс этих значений — оценка того, насколько статистика дрожит. Для медианы и перцентилей формулы SE нет, а бутстрап работает.</div>
  <//>`;
}

// ═════ 8. CUPED ═════
function Cuped() {
  const [rho, setRho] = useState(0.6);
  const [seed, setSeed] = useState(4);
  const pts = useMemo(() => {
    const r = makeRng(seed + 40);
    return Array.from({ length: 350 }, () => { const x = r.normal(); return [x, rho * x + Math.sqrt(1 - rho * rho) * r.normal()]; });
  }, [rho, seed]);
  const keep = 1 - rho * rho;
  return html`<${Widget} title="CUPED: дисперсия падает на ρ²">
    <div class="controls"><${Slider} label="Корреляция метрики до и во время теста, ρ" value=${rho} min=${0} max=${0.95} step=${0.05} onInput=${setRho} show=${(v) => v.toFixed(2)} /></div>
    <${Plot} h=${240} x=${[-3.5, 3.5]} y=${[-3.5, 3.5]} xLabel="метрика пользователя до теста (X)" yLabel="во время теста (Y)">
      ${(sx, sy) => html`${pts.map(([a, b]) => html`<circle cx=${sx(a)} cy=${sy(Math.max(-3.5, Math.min(3.5, b)))} r="2.2" fill=${C.a} opacity="0.55" />`)}
        <line x1=${sx(-3.5)} x2=${sx(3.5)} y1=${sy(-3.5 * rho)} y2=${sy(3.5 * rho)} stroke=${C.b} stroke-width="2" />`}
    <//>
    <${Readouts} items=${[['Остаток дисперсии', pct(keep, 0)], ['Сокращение выборки', pct(1 - keep, 0)], ['Тот же тест за', Math.max(1, Math.round(28 * keep)) + ' дн. вместо 28']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новые данные</button></div>
    <div class="widget-note">Y_cuped = Y − θ·(X − mean(X)), где θ = cov(X, Y) / var(X). Мы вычитаем ту часть Y, которую можно было предсказать ещё до теста. Эффект теста не меняется, а дисперсия становится Var(Y)·(1 − ρ²).</div>
  <//>`;
}

// ═════ 9. ROC и порог ═════
function Roc() {
  const [dp, setDp] = useState(1.5);
  const [prev, setPrev] = useState(0.1);
  const [thr, setThr] = useState(1);
  const auc = Phi(dp / Math.SQRT2);
  const roc = [], pr = [];
  for (let t = 5; t >= -5; t -= 0.05) {
    const tpr = 1 - Phi(t - dp), fpr = 1 - Phi(t);
    roc.push([fpr, tpr]);
    const prec = (tpr * prev) / (tpr * prev + fpr * (1 - prev));
    if (tpr > 0.001) pr.push([tpr, prec]);
  }
  const tpr = 1 - Phi(thr - dp), fpr = 1 - Phi(thr);
  const precision = (tpr * prev) / (tpr * prev + fpr * (1 - prev) || 1);
  const f1 = (2 * precision * tpr) / (precision + tpr || 1);
  const acc = tpr * prev + (1 - fpr) * (1 - prev);
  return html`<${Widget} title="ROC, precision и recall при разном пороге">
    <div class="controls">
      <${Slider} label="Разделимость классов (d′)" value=${dp} min=${0} max=${3.5} step=${0.1} onInput=${setDp} show=${(v) => v.toFixed(1)} />
      <${Slider} label="Доля положительного класса" value=${prev} min=${0.01} max=${0.5} step=${0.01} onInput=${setPrev} show=${(v) => pct(v, 0)} />
      <${Slider} label="Порог по скору" value=${thr} min=${-2} max=${4} step=${0.05} onInput=${setThr} show=${(v) => v.toFixed(2)} />
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px">
      <${Plot} w=${320} h=${260} x=${[0, 1]} y=${[0, 1]} xLabel="FPR" yLabel="TPR (recall)">
        ${(sx, sy) => html`<line x1=${sx(0)} y1=${sy(0)} x2=${sx(1)} y2=${sy(1)} stroke="var(--line2)" stroke-dasharray="4 3" />
          <path d=${path(roc, sx, sy)} fill="none" stroke=${C.a} stroke-width="2" /><circle cx=${sx(fpr)} cy=${sy(tpr)} r="5" fill=${C.b} />`}
      <//>
      <${Plot} w=${320} h=${260} x=${[0, 1]} y=${[0, 1]} xLabel="recall" yLabel="precision">
        ${(sx, sy) => html`<line x1=${sx(0)} y1=${sy(prev)} x2=${sx(1)} y2=${sy(prev)} stroke="var(--line2)" stroke-dasharray="4 3" />
          <path d=${path(pr, sx, sy)} fill="none" stroke=${C.c} stroke-width="2" /><circle cx=${sx(tpr)} cy=${sy(precision)} r="5" fill=${C.b} />`}
      <//>
    </div>
    <${Readouts} items=${[['ROC AUC', fmt(auc)], ['Recall (TPR)', pct(tpr)], ['FPR', pct(fpr)], ['Precision', pct(precision)], ['F1', fmt(f1)], ['Accuracy', pct(acc)]]} />
    <div class="widget-note">Уменьши долю положительного класса до 1–2%: ROC-кривая и AUC не меняются, а precision при том же пороге падает в разы. Accuracy при этом остаётся высокой: модель, которая всегда говорит «нет», уже права в 98% случаев.</div>
  <//>`;
}

// ═════ 10. Переобучение ═════
function polyFit(xs, ys, deg, lambda = 1e-6) {
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  xs.forEach((x, i) => {
    const pw = [1]; for (let k = 1; k < m; k++) pw.push(pw[k - 1] * x);
    for (let r = 0; r < m; r++) { b[r] += pw[r] * ys[i]; for (let c = 0; c < m; c++) A[r][c] += pw[r] * pw[c]; }
  });
  for (let r = 0; r < m; r++) A[r][r] += lambda;
  for (let c = 0; c < m; c++) {
    let piv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < m; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < m; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const w = b.map((v, i) => v / A[i][i]);
  return (x) => { let s = 0, p = 1; for (const c of w) { s += c * p; p *= x; } return s; };
}
function Overfit() {
  const [deg, setDeg] = useState(3);
  const [nTrain, setNTrain] = useState(20);
  const [seed, setSeed] = useState(6);
  const f = (x) => Math.sin(2.5 * x) + 0.3 * x;
  const data = useMemo(() => {
    const r = makeRng(seed + 60);
    const mk = (k) => Array.from({ length: k }, () => { const x = r.u() * 2 - 1; return [x, f(x) + 0.3 * r.normal()]; });
    return { train: mk(nTrain), test: mk(200) };
  }, [nTrain, seed]);
  const rmse = (g, pts) => Math.sqrt(mean(pts.map(([x, y]) => (g(x) - y) ** 2)));
  const curves = useMemo(() => Array.from({ length: 15 }, (_, d) => {
    const g = polyFit(data.train.map((p) => p[0]), data.train.map((p) => p[1]), d + 1);
    return { g, tr: rmse(g, data.train), te: rmse(g, data.test) };
  }), [data]);
  const cur = curves[deg - 1];
  const line = Array.from({ length: 200 }, (_, i) => { const x = -1 + (2 * i) / 199; return [x, Math.max(-3, Math.min(3, cur.g(x)))]; });
  const errMax = Math.min(2, Math.max(...curves.map((c) => c.te)) * 1.1);
  return html`<${Widget} title="Переобучение: ошибка на трейне и на тесте">
    <div class="controls">
      <${Slider} label="Сложность модели (степень полинома)" value=${deg} min=${1} max=${15} onInput=${setDeg} />
      <${Slider} label="Точек в обучении" value=${nTrain} min=${10} max=${200} step=${5} onInput=${setNTrain} />
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px">
      <${Plot} w=${340} h=${250} x=${[-1, 1]} y=${[-2.5, 2.5]}>
        ${(sx, sy) => html`${data.test.slice(0, 80).map(([x, y]) => html`<circle cx=${sx(x)} cy=${sy(y)} r="2" fill="var(--faint)" opacity="0.5" />`)}
          ${data.train.map(([x, y]) => html`<circle cx=${sx(x)} cy=${sy(y)} r="3.5" fill=${C.a} />`)}
          <path d=${path(line, sx, sy)} fill="none" stroke=${C.b} stroke-width="2" />`}
      <//>
      <${Plot} w=${340} h=${250} x=${[1, 15]} y=${[0, errMax]} xLabel="степень" yLabel="RMSE">
        ${(sx, sy) => html`<path d=${path(curves.map((c, i) => [i + 1, Math.min(errMax, c.tr)]), sx, sy)} fill="none" stroke=${C.a} stroke-width="2" />
          <path d=${path(curves.map((c, i) => [i + 1, Math.min(errMax, c.te)]), sx, sy)} fill="none" stroke=${C.b} stroke-width="2" />
          <line x1=${sx(deg)} x2=${sx(deg)} y1=${sy(0)} y2=${sy(errMax)} stroke=${C.d} stroke-dasharray="3 3" />`}
      <//>
    </div>
    <div class="legend"><span><i style="background:${C.a}"></i>обучение</span><span><i style="background:${C.b}"></i>модель / ошибка на тесте</span></div>
    <${Readouts} items=${[['RMSE на обучении', fmt(cur.tr)], ['RMSE на тесте', fmt(cur.te)], ['Шум в данных', '0.300']]} />
    <div class="task-actions"><button class="btn small" onClick=${() => setSeed(seed + 1)}>Новые данные</button></div>
    <div class="widget-note">Ошибка на обучении падает с ростом сложности всегда. Ошибка на тесте сначала падает, потом растёт: модель начинает запоминать шум. Добавь точек — и переобучение наступает позже.</div>
  <//>`;
}

// ═════ 11. Когортная таблица по данным «Корзинки» ═════
function Cohort() {
  const [platform, setPlatform] = useState('all');
  const [channel, setChannel] = useState('all');
  const [mode, setMode] = useState('month');
  const table = useMemo(() => {
    const { users, activeDays } = getData();
    const monthOf = (d) => Number(dayToDate(d).slice(5, 7)) - 1;
    const rows = [];
    if (mode === 'month') {
      for (let c = 0; c < 6; c++) rows.push({ label: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь'][c], size: 0, cnt: new Array(7 - c).fill(0) });
    } else {
      for (let w = 0; w < 26; w++) rows.push({ label: dayToDate(w * 7).slice(5), size: 0, cnt: new Array(8).fill(0) });
    }
    for (const u of users) {
      if (platform !== 'all' && u.platform !== platform) continue;
      if (channel !== 'all' && u.channel !== channel) continue;
      const days = activeDays.get(u.user_id);
      const sd0 = days[0];
      if (mode === 'month') {
        const c = monthOf(sd0); const row = rows[c]; if (!row) continue;
        row.size++;
        const seen = new Set(days.map((d) => monthOf(d) - c));
        seen.forEach((k) => { if (k >= 0 && k < row.cnt.length) row.cnt[k]++; });
      } else {
        const w = Math.floor(sd0 / 7); const row = rows[w]; if (!row) continue;
        row.size++;
        const seen = new Set(days.map((d) => Math.floor((d - sd0) / 7)));
        seen.forEach((k) => { if (k >= 0 && k < 8 && sd0 + k * 7 <= END_DAY) row.cnt[k]++; });
      }
    }
    return rows;
  }, [platform, channel, mode]);
  const cols = Math.max(...table.map((r) => r.cnt.length));
  const shade = (v) => `color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, v * 1.6) * 85)}%, var(--bg2))`;
  return html`<${Widget} title="Retention по когортам: данные «Корзинки»" tag="живые данные">
    <div class="controls">
      <${Select} label="Когорты" value=${mode} onChange=${setMode} options=${[['month', 'по месяцу регистрации'], ['week', 'по неделе регистрации']]} />
      <${Select} label="Платформа" value=${platform} onChange=${setPlatform} options=${[['all', 'все'], ['ios', 'iOS'], ['android', 'Android'], ['web', 'Web']]} />
      <${Select} label="Канал" value=${channel} onChange=${setChannel} options=${[['all', 'все'], ['organic', 'organic'], ['ads', 'ads (платный)'], ['referral', 'referral']]} />
    </div>
    <div class="table-wrap"><table class="cohort">
      <thead><tr><th>Когорта</th><th>Размер</th>${Array.from({ length: cols }, (_, k) => html`<th>${mode === 'month' ? 'M' : 'W'}${k}</th>`)}</tr></thead>
      <tbody>${table.filter((r) => r.size).map((r) => html`<tr><td>${r.label}</td><td>${r.size}</td>${Array.from({ length: cols }, (_, k) => {
        if (k >= r.cnt.length || (mode === 'week' && r.cnt[k] === 0 && k > 0)) return html`<td />`;
        const v = r.cnt[k] / r.size;
        return html`<td style=${{ background: shade(v), color: v > 0.45 ? 'var(--accent-ink)' : 'var(--text)' }}>${(100 * v).toFixed(0)}%</td>`;
      })}</tr>`)}</tbody>
    </table></div>
    <div class="widget-note">${mode === 'month' ? 'M0 — календарный месяц регистрации, M1 — следующий календарный месяц и так далее. Доля — пользователи когорты, которые хоть раз открыли приложение в этом месяце.' : 'W0 — первые 7 дней после регистрации, W1 — дни 7–13 и так далее.'} Сравни каналы: платный трафик (ads) удерживается заметно хуже — это потом всплывёт в LTV.</div>
  <//>`;
}

export const WIDGETS = {
  sampling: Sampling,
  convergence: Convergence,
  'ci-coverage': CiCoverage,
  power: Power,
  peeking: Peeking,
  pvalues: PValues,
  bootstrap: Bootstrap,
  cuped: Cuped,
  roc: Roc,
  overfit: Overfit,
  cohort: Cohort,
};
