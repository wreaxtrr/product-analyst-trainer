import { html, useState, useMemo } from '../lib.js';
import { Widget, Slider, Select, Readouts, Plot, path, mean, sd, quantile, fmt, pct, int, C } from './kit.js';
import { getData, dayToDate, END_DAY, DAYS } from '../data/generate.js';

// ═════ Слоёный пирог когорт: MAU как сумма когорт ═════
function LayerCake() {
  const [n, setN] = useState(2000);
  const [m1, setM1] = useState(0.5);
  const [floor, setFloor] = useState(0.15);
  const [stop, setStop] = useState('no');
  const T = 18;
  // Удержание по месяцам жизни: быстрая часть затухает за пару месяцев, «хвост» — медленно (−4% в месяц)
  const r = (k) => (k === 0 ? 1 : floor * Math.pow(0.96, k - 1) + (m1 - floor) * Math.pow(0.55, k - 1));
  const sizes = Array.from({ length: T }, (_, c) => (stop === 'yes' && c >= 12 ? 0 : n));
  const stack = useMemo(() => {
    const layers = [];
    const base = new Array(T).fill(0);
    for (let c = 0; c < T; c++) {
      const lo = [...base];
      for (let t = c; t < T; t++) base[t] += sizes[c] * r(t - c);
      layers.push({ c, lo, hi: [...base] });
    }
    return layers;
  }, [n, m1, floor, stop]);
  const total = stack[stack.length - 1].hi;
  const ymax = Math.max(...total) * 1.12 || 1;
  let life = 0;
  for (let k = 0; k < 600; k++) life += r(k);
  const last = total[T - 1];
  return html`<${Widget} title="Слоёный пирог: MAU как сумма когорт" tag="модель">
    <div class="controls">
      <${Slider} label="Новых пользователей в месяц" value=${n} min=${500} max=${4000} step=${100} onInput=${setN} show=${int} />
      <${Slider} label="Удержание на 2-м месяце" value=${m1} min=${0.2} max=${0.8} step=${0.01} onInput=${setM1} show=${(v) => pct(v, 0)} />
      <${Slider} label="Долгий хвост удержания" value=${floor} min=${0} max=${0.4} step=${0.01} onInput=${(v) => setFloor(Math.min(v, m1))} show=${(v) => pct(v, 0)} />
      <${Select} label="Привлечение" value=${stop} onChange=${setStop} options=${[['no', 'идёт всё время'], ['yes', 'остановлено с 13-го месяца']]} />
    </div>
    <${Plot} h=${250} x=${[0, T - 1]} y=${[0, ymax]} xTicks=${[0, 3, 6, 9, 12, 15]} xFmt=${(v) => `${v + 1} мес`} yFmt=${(v) => int(v)}>
      ${(sx, sy) => html`${stack.map(({ c, lo, hi }) => {
        const pts = [];
        for (let t = c; t < T; t++) pts.push(`${sx(t)},${sy(hi[t])}`);
        for (let t = T - 1; t >= c; t--) pts.push(`${sx(t)},${sy(lo[t])}`);
        return html`<polygon points=${pts.join(' ')} fill=${C.a} fill-opacity=${0.18 + 0.6 * ((c % 6) / 6)} stroke="var(--card)" stroke-width="0.6" />`;
      })}
      <path d=${path(total.map((v, t) => [t, v]), sx, sy)} fill="none" stroke="var(--text)" stroke-width="1.4" />`}
    <//>
    <${Readouts} items=${[
      ['MAU на 18-м месяце', int(last)],
      ['Средняя «жизнь» пользователя', `${fmt(life, 2)} мес`],
      ['Предел MAU = новые × жизнь', int(n * life)],
      ['Доля новых в последнем месяце', pct(sizes[T - 1] / (last || 1), 0)],
    ]} />
    <p class="small muted">Каждый слой — одна когорта. Остановите привлечение: MAU падает, но старые слои не меняются — так выглядит июль «Корзинки». Поднимите долгий хвост удержания: предел MAU растёт сильнее, чем от того же прироста привлечения.</p>
  <//>`;
}

// ═════ Детектор аномалий на данных «Корзинки» ═════
let opuCache = null;
function dailySeries() {
  if (opuCache) return opuCache;
  const { tables } = getData();
  const idx = new Map();
  for (let d = 0; d <= END_DAY; d++) idx.set(dayToDate(d), d);
  const users = Array.from({ length: END_DAY + 1 }, () => new Set());
  const orders = new Array(END_DAY + 1).fill(0);
  for (const e of tables.events) users[idx.get(e.ts.slice(0, 10))].add(e.user_id);
  for (const o of tables.orders) orders[idx.get(o.ts.slice(0, 10))]++;
  opuCache = { orders, opu: orders.map((o, d) => (users[d].size ? o / users[d].size : NaN)) };
  return opuCache;
}

function Anomaly() {
  const [metric, setMetric] = useState('opu');
  const [method, setMethod] = useState('robust');
  const [k, setK] = useState(3);
  const s = dailySeries();
  const vals = s[metric];
  const from = 60; // с 1 марта
  const res = useMemo(() => {
    const out = [];
    for (let d = from; d <= END_DAY; d++) {
      const hist = vals.slice(d - 28, d).filter(Number.isFinite);
      let center, scale;
      if (method === 'robust') {
        const sorted = [...hist].sort((a, b) => a - b);
        center = quantile(sorted, 0.5);
        const dev = hist.map((x) => Math.abs(x - center)).sort((a, b) => a - b);
        scale = 1.4826 * quantile(dev, 0.5);
      } else { center = mean(hist); scale = sd(hist); }
      const z = (vals[d] - center) / (scale || 1e-9);
      out.push({ d, v: vals[d], z, flag: Math.abs(z) > k });
    }
    return out;
  }, [metric, method, k]);
  const flags = res.filter((x) => x.flag);
  const caught = flags.some((x) => x.d === DAYS.androidIncident);
  const ys = res.map((x) => x.v);
  const ymin = Math.min(...ys) * 0.9, ymax = Math.max(...ys) * 1.08;
  const ticks = [60, 91, 121, 152, 182].filter((d) => d <= END_DAY);
  return html`<${Widget} title="Детектор аномалий на данных «Корзинки»" tag="живые данные">
    <div class="controls">
      <${Select} label="Метрика" value=${metric} onChange=${setMetric} options=${[['opu', 'заказы на активного пользователя'], ['orders', 'заказы, штук']]} />
      <${Select} label="Метод" value=${method} onChange=${setMethod} options=${[['robust', 'медиана и MAD'], ['z', 'среднее и SD']]} />
      <${Slider} label="Порог |z|" value=${k} min=${2} max=${5} step=${0.1} onInput=${setK} show=${(v) => fmt(v, 1)} />
    </div>
    <${Plot} h=${240} x=${[from, END_DAY]} y=${[ymin, ymax]} xTicks=${ticks} xFmt=${(d) => dayToDate(d).slice(5).split('-').reverse().join('.')} yFmt=${(v) => (metric === 'opu' ? fmt(v, 2) : int(v))}>
      ${(sx, sy) => html`
        <line x1=${sx(DAYS.androidIncident)} x2=${sx(DAYS.androidIncident)} y1=${sy(ymax)} y2=${sy(ymin)} stroke="var(--bad)" stroke-dasharray="3 4" stroke-opacity="0.6" />
        <path d=${path(res.map((x) => [x.d, x.v]), sx, sy)} fill="none" stroke=${C.a} stroke-width="1.5" />
        ${flags.map((x) => html`<circle cx=${sx(x.d)} cy=${sy(x.v)} r="4.5" fill="var(--bad)" />`)}`}
    <//>
    <${Readouts} items=${[
      ['Алертов с 1 марта', String(flags.length)],
      ['Поломка 14 мая', caught ? 'поймана' : 'пропущена'],
      ['Ложных алертов', String(flags.filter((x) => x.d !== DAYS.androidIncident).length)],
    ]} />
    <p class="small muted">Пунктир — день поломки оплаты на Android. Переключите метрику на «заказы, штук»: из-за роста аудитории алерты срабатывают на обычные дни. Переключите метод на «среднее и SD» при пороге 3: выброс 17 апреля раздувает SD, и поломка 14 мая проходит незамеченной.</p>
  <//>`;
}

// ═════ Погрешность NPS ═════
function NpsCi() {
  const [n, setN] = useState(400);
  const [p, setP] = useState(0.45);
  const [q, setQ] = useState(0.2);
  const qq = Math.min(q, 1 - p);
  const nps = 100 * (p - qq);
  const se = 100 * Math.sqrt((p + qq - (p - qq) ** 2) / n);
  const half = 1.96 * se;
  const diff = 1.96 * Math.SQRT2 * se;
  const curve = [50, 100, 200, 300, 500, 800, 1200, 2000, 3000, 5000].map((m) => [m, 196 * Math.sqrt((p + qq - (p - qq) ** 2) / m)]);
  return html`<${Widget} title="Погрешность NPS" tag="интерактив">
    <div class="controls">
      <${Slider} label="Ответов" value=${n} min=${50} max=${5000} step=${50} onInput=${setN} show=${int} />
      <${Slider} label="Промоутеры (9–10)" value=${p} min=${0.05} max=${0.9} step=${0.01} onInput=${setP} show=${(v) => pct(v, 0)} />
      <${Slider} label="Критики (0–6)" value=${qq} min=${0} max=${0.9} step=${0.01} onInput=${setQ} show=${(v) => pct(v, 0)} />
    </div>
    <${Plot} h=${200} x=${[50, 5000]} y=${[0, Math.max(...curve.map((c) => c[1])) * 1.1]} xTicks=${[50, 1000, 2000, 3000, 4000, 5000]} xFmt=${int} yFmt=${(v) => `±${fmt(v, 0)}`} xLabel="ответов" >
      ${(sx, sy) => html`<path d=${path(curve, sx, sy)} fill="none" stroke=${C.a} stroke-width="2" />
        <circle cx=${sx(n)} cy=${sy(half)} r="5" fill=${C.a} />`}
    <//>
    <${Readouts} items=${[
      ['NPS', fmt(nps, 0)],
      ['95% интервал', `${fmt(nps - half, 1)} … ${fmt(nps + half, 1)}`],
      ['Половина ширины', `±${fmt(half, 1)} п.`],
      ['Заметная разница двух волн', `≥ ${fmt(diff, 1)} п.`],
    ]} />
    <p class="small muted">Кривая — половина ширины 95% интервала в зависимости от числа ответов. Чтобы отличить изменение NPS на 3 пункта между двумя волнами, нужно, чтобы «заметная разница» опустилась ниже 3 — это тысячи ответов на волну.</p>
  <//>`;
}

export const SIDE_WIDGETS = { 'layer-cake': LayerCake, anomaly: Anomaly, 'nps-ci': NpsCi };
