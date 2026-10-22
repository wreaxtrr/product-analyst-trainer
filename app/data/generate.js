// Детерминированный генератор логов вымышленного сервиса доставки продуктов «Корзинка».
// Один и тот же seed всегда даёт одни и те же таблицы, поэтому эталонные ответы стабильны.
//
// Заложенные истории (на них опираются задачи):
//  - эксперимент new_checkout (3–30 июня): в группе B выше конверсия checkout → purchase;
//  - эксперимент promo_banner (1–28 июля): баг логирования теряет часть android-пользователей группы B (SRM);
//  - 14 мая у android-приложения сломалась оплата: покупки на android резко просели на один день;
//  - с 15 апреля в Казани бесплатная доставка: конверсия в покупку там выросла (для diff-in-diff);
//  - 8 марта и выходные дают всплески заказов (сезонность).

export const START = Date.UTC(2024, 0, 1);
export const DAY_MS = 86400000;
export const LAST_SIGNUP_DAY = 181; // 2024-06-30
export const END_DAY = 212; // 2024-07-31

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(x, salt) {
  let h = (x * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const pad = (n) => String(n).padStart(2, '0');
const PAD2 = Array.from({ length: 60 }, (_, i) => pad(i));
const dateCache = new Map();
export function dayToDate(d) {
  let s = dateCache.get(d);
  if (!s) {
    const dt = new Date(START + d * DAY_MS);
    s = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    dateCache.set(d, s);
  }
  return s;
}
function tsStr(day, sec) {
  sec = Math.min(sec, 86399);
  return dayToDate(day) + ' ' + PAD2[Math.floor(sec / 3600)] + ':' + PAD2[Math.floor((sec % 3600) / 60)] + ':' + PAD2[sec % 60];
}
const weekday = (d) => (1 + d) % 7; // 2024-01-01 — понедельник; 0 = воскресенье, 6 = суббота

export const DAYS = {
  march8: 67,
  androidIncident: 134, // 2024-05-14
  kazanLaunch: 105, // 2024-04-15
  ncStart: 154, ncEnd: 181, // new_checkout
  pbStart: 182, pbEnd: 209, // promo_banner
};

export const SCHEMA = {
  users: [['user_id', 'INTEGER'], ['signup_date', 'DATE'], ['platform', 'VARCHAR'], ['city', 'VARCHAR'], ['channel', 'VARCHAR']],
  items: [['item_id', 'INTEGER'], ['category', 'VARCHAR'], ['price', 'DOUBLE']],
  events: [['event_id', 'INTEGER'], ['user_id', 'INTEGER'], ['ts', 'TIMESTAMP'], ['event_name', 'VARCHAR'], ['item_id', 'INTEGER']],
  orders: [['order_id', 'INTEGER'], ['user_id', 'INTEGER'], ['ts', 'TIMESTAMP'], ['revenue', 'DOUBLE'], ['promo_code', 'VARCHAR'], ['status', 'VARCHAR']],
  experiment_users: [['experiment', 'VARCHAR'], ['user_id', 'INTEGER'], ['grp', 'VARCHAR'], ['assigned_at', 'DATE']],
  marketing_spend: [['dt', 'DATE'], ['channel', 'VARCHAR'], ['spend', 'DOUBLE']],
  churn_features: [['customer_id', 'INTEGER'], ['platform', 'VARCHAR'], ['channel', 'VARCHAR'], ['tenure_days', 'INTEGER'], ['orders_90d', 'INTEGER'], ['avg_check', 'DOUBLE'], ['days_since_last_order', 'INTEGER'], ['support_tickets', 'INTEGER'], ['late_delivery_share', 'DOUBLE'], ['promo_share', 'DOUBLE'], ['churned', 'INTEGER']],
  promo_campaign: [['customer_id', 'INTEGER'], ['orders_prev_90d', 'INTEGER'], ['days_since_last_order', 'INTEGER'], ['avg_check', 'DOUBLE'], ['treatment', 'INTEGER'], ['converted', 'INTEGER']],
};

export const TABLE_DOCS = {
  users: 'Пользователи. Одна строка — один зарегистрировавшийся пользователь (регистрации с 1 января по 30 июня 2024).',
  items: 'Товары каталога.',
  events: 'Продуктовые события приложения с 1 января по 31 июля 2024: app_open, view_item, add_to_cart, checkout, purchase. item_id заполнен только у view_item и add_to_cart.',
  orders: 'Заказы. Каждой покупке (purchase) соответствует заказ. status: delivered или cancelled. promo_code может быть NULL.',
  experiment_users: 'Распределение пользователей по экспериментам: new_checkout (3–30 июня) и promo_banner (1–28 июля). assigned_at — дата первого захода в период эксперимента.',
  marketing_spend: 'Расходы на платные каналы привлечения по дням. У organic расходов нет, строк для него нет.',
  churn_features: 'Готовый датасет для модели оттока: признаки клиента на дату среза и таргет churned (1 — не сделал ни одного заказа в следующие 30 дней).',
  promo_campaign: 'Рандомизированная рассылка промокода: treatment = 1 — получил промокод. converted = 1 — сделал заказ в течение 14 дней.',
};

const CATEGORIES = ['Овощи и фрукты', 'Молочные продукты', 'Мясо и рыба', 'Выпечка', 'Напитки', 'Снеки', 'Бытовая химия', 'Готовая еда'];
const CITIES = [['Москва', 0.35], ['Санкт-Петербург', 0.2], ['Казань', 0.12], ['Екатеринбург', 0.12], ['Новосибирск', 0.11], ['Краснодар', 0.1]];
const PLATFORMS = [['ios', 0.38], ['android', 0.47], ['web', 0.15]];
const CHANNELS = [['organic', 0.5], ['ads', 0.35], ['referral', 0.15]];
const HOURS = [1, 1, 1, 1, 1, 2, 3, 5, 6, 6, 6, 7, 8, 7, 6, 6, 7, 8, 10, 12, 12, 10, 6, 3];

export function generate(seed = 20240101) {
  const rng = mulberry32(seed);
  const pick = (pairs) => { let u = rng(), acc = 0; for (const [v, w] of pairs) { acc += w; if (u < acc) return v; } return pairs[pairs.length - 1][0]; };
  const normal = () => { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const poisson = (lam) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };
  const hourTotal = HOURS.reduce((a, b) => a + b, 0);
  const pickHour = () => { let u = rng() * hourTotal; for (let h = 0; h < 24; h++) { u -= HOURS[h]; if (u <= 0) return h; } return 23; };

  // Товары
  const items = [];
  for (let i = 1; i <= 240; i++) {
    const category = CATEGORIES[Math.floor(rng() * CATEGORIES.length)];
    items.push({ item_id: i, category, price: Math.round(Math.exp(Math.log(220) + 0.6 * normal()) * 100) / 100 });
  }
  const itemCum = [];
  items.forEach((_, i) => itemCum.push((itemCum[i - 1] || 0) + 1 / Math.pow(i + 1, 0.8)));
  const itemTotal = itemCum[itemCum.length - 1];
  const pickItem = () => {
    const u = rng() * itemTotal;
    let lo = 0, hi = itemCum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (itemCum[mid] < u) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };

  const users = [], events = [], orders = [], expUsers = [];
  const activeDays = new Map();
  const signupsByDay = { ads: new Array(END_DAY + 1).fill(0), referral: new Array(END_DAY + 1).fill(0) };
  const N = 7000;
  let eventId = 0, orderId = 0;

  for (let uid = 1; uid <= N; uid++) {
    const signup = Math.min(LAST_SIGNUP_DAY, Math.floor((LAST_SIGNUP_DAY + 1) * Math.sqrt(rng())));
    const platform = pick(PLATFORMS);
    const city = pick(CITIES);
    const channel = pick(CHANNELS);
    users.push({ user_id: uid, signup_date: dayToDate(signup), platform, city, channel });
    if (channel !== 'organic') signupsByDay[channel][signup]++;

    // Устойчивые различия между пользователями: активность и склонность покупать
    let eng = Math.exp(1.0 * normal() - 0.4);
    const buyProp = Math.min(3, Math.exp(0.45 * normal()));
    if (channel === 'ads') eng *= 0.75;
    if (channel === 'referral') eng *= 1.15;
    if (platform === 'web') eng *= 0.8;
    const lifetime = -Math.log(1 - rng()) * 60 * Math.min(eng, 3);
    const ncGroup = hash01(uid, 11) < 0.5 ? 'A' : 'B';
    const pbGroup = hash01(uid, 29) < 0.5 ? 'A' : 'B';
    let ncAssigned = false, pbAssigned = false;
    let ordersSoFar = 0;
    const days = [];

    for (let d = signup; d <= END_DAY; d++) {
      const age = d - signup;
      let p;
      if (age === 0) p = 1;
      else {
        p = eng * (0.075 + 0.3 * Math.exp(-age / 9));
        if (age > lifetime) p *= 0.06;
        const wd = weekday(d);
        if (wd === 0 || wd === 6) p *= 1.18;
        if (d === DAYS.march8) p *= 1.6;
        p = Math.min(p, 0.9);
      }
      if (rng() >= p) continue;
      days.push(d);

      const inNC = d >= DAYS.ncStart && d <= DAYS.ncEnd;
      const inPB = d >= DAYS.pbStart && d <= DAYS.pbEnd;
      if (inNC && !ncAssigned) { ncAssigned = true; expUsers.push({ experiment: 'new_checkout', user_id: uid, grp: ncGroup, assigned_at: dayToDate(d) }); }
      if (inPB && !pbAssigned) {
        pbAssigned = true;
        // Баг логирования: часть android-пользователей группы B не попадает в таблицу назначений
        const lost = pbGroup === 'B' && platform === 'android' && hash01(uid, 53) < 0.35;
        if (!lost) expUsers.push({ experiment: 'promo_banner', user_id: uid, grp: pbGroup, assigned_at: dayToDate(d) });
      }

      const sessions = 1 + (rng() < 0.28 ? 1 : 0) + (rng() < 0.06 ? 1 : 0);
      for (let s = 0; s < sessions; s++) {
        let sec = pickHour() * 3600 + Math.floor(rng() * 3600);
        events.push({ event_id: ++eventId, user_id: uid, ts: tsStr(d, sec), event_name: 'app_open', item_id: null });
        const views = 1 + poisson(1.8);
        let pCart = Math.min(0.5, 0.15 * buyProp);
        if (inPB && pbGroup === 'B') pCart *= 1.12;
        let carts = 0;
        for (let v = 0; v < views; v++) {
          sec += 15 + Math.floor(rng() * 80);
          const item = pickItem();
          events.push({ event_id: ++eventId, user_id: uid, ts: tsStr(d, sec), event_name: 'view_item', item_id: item });
          if (rng() < pCart) {
            sec += 5 + Math.floor(rng() * 25);
            events.push({ event_id: ++eventId, user_id: uid, ts: tsStr(d, sec), event_name: 'add_to_cart', item_id: item });
            carts++;
          }
        }
        if (!carts) continue;
        let pCheckout = 0.6;
        if (inNC && ncGroup === 'B') pCheckout += 0.05;
        if (rng() >= pCheckout) continue;
        sec += 30 + Math.floor(rng() * 120);
        events.push({ event_id: ++eventId, user_id: uid, ts: tsStr(d, sec), event_name: 'checkout', item_id: null });
        let pBuy = platform === 'web' ? 0.7 : 0.79;
        if (inNC && ncGroup === 'B') pBuy += 0.08;
        if (city === 'Казань' && d >= DAYS.kazanLaunch) pBuy += 0.08;
        if (platform === 'android' && d === DAYS.androidIncident) pBuy *= 0.15;
        if (rng() >= pBuy) continue;
        sec += 10 + Math.floor(rng() * 60);
        events.push({ event_id: ++eventId, user_id: uid, ts: tsStr(d, sec), event_name: 'purchase', item_id: null });
        let promo = null;
        if (ordersSoFar === 0 && rng() < 0.45) promo = 'WELCOME';
        else if (rng() < 0.1) promo = 'SALE10';
        let revenue = Math.exp(Math.log(1250) + 0.55 * normal()) * (0.6 + 0.4 * Math.min(carts, 3)) / 1.0;
        if (platform === 'ios') revenue *= 1.12;
        if (promo) revenue *= 0.9;
        if (rng() < 0.002) revenue *= 18 + rng() * 10; // редкие оптовые заказы
        const status = rng() < 0.055 ? 'cancelled' : 'delivered';
        orders.push({ order_id: ++orderId, user_id: uid, ts: tsStr(d, sec), revenue: Math.round(revenue * 100) / 100, promo_code: promo, status });
        ordersSoFar++;
      }
    }
    activeDays.set(uid, days);
  }

  // Маркетинг: стоимость привлечения в платных каналах
  const spend = [];
  for (let d = 0; d <= END_DAY; d++) {
    for (const [ch, cac] of [['ads', 540], ['referral', 190]]) {
      const n = signupsByDay[ch][d];
      const base = d <= LAST_SIGNUP_DAY ? Math.max(n, 0.3) : 0.15;
      const s = base * cac * (1 + 0.18 * normal());
      spend.push({ dt: dayToDate(d), channel: ch, spend: Math.round(Math.max(s, 50) * 100) / 100 });
    }
  }

  // Датасет для модели оттока
  const churn = [];
  for (let i = 1; i <= 4000; i++) {
    const platform = pick(PLATFORMS), channel = pick(CHANNELS);
    const tenure = 30 + Math.floor(rng() * 700);
    const orders90 = poisson(channel === 'ads' ? 2.2 : 3.4);
    const avgCheck = orders90 ? Math.round(Math.exp(Math.log(1300) + 0.4 * normal())) : 0;
    const dsl = orders90 ? Math.floor(rng() * Math.min(90, 120 / (orders90 + 0.5))) : 90 + Math.floor(rng() * 90);
    const tickets = poisson(0.4);
    const late = Math.round(Math.min(1, Math.max(0, 0.12 + 0.12 * normal())) * 100) / 100;
    const promoShare = orders90 ? Math.round(rng() * (channel === 'ads' ? 0.8 : 0.4) * 100) / 100 : 0;
    const z = -1.1 + 0.028 * dsl - 0.32 * orders90 + 0.45 * tickets + 2.2 * late + 0.5 * (channel === 'ads') + 1.1 * promoShare - 0.0008 * tenure + 0.35 * (platform === 'web') + 0.6 * normal();
    const churned = rng() < 1 / (1 + Math.exp(-z)) ? 1 : 0;
    churn.push({ customer_id: i, platform, channel, tenure_days: tenure, orders_90d: orders90, avg_check: avgCheck, days_since_last_order: dsl, support_tickets: tickets, late_delivery_share: late, promo_share: promoShare, churned });
  }

  // Рандомизированная промо-рассылка для uplift
  const promo = [];
  for (let i = 1; i <= 10000; i++) {
    const prev = poisson(2.8);
    // чем чаще клиент заказывал, тем свежее его последний заказ
    const dsl = prev ? Math.floor(rng() * Math.min(90, 160 / (prev + 0.5))) : 60 + Math.floor(rng() * 120);
    const check = prev ? Math.round(Math.exp(Math.log(1200) + 0.4 * normal())) : 0;
    const treatment = rng() < 0.5 ? 1 : 0;
    let base = 0.06 + 0.07 * Math.min(prev, 6) - 0.0015 * dsl;
    base = Math.min(0.75, Math.max(0.02, base));
    let uplift = 0;
    if (dsl > 30 && prev > 0) uplift = 0.09;
    else if (prev === 0) uplift = 0.03;
    else if (prev >= 5) uplift = -0.03;
    else uplift = 0.01;
    const p = Math.min(0.95, Math.max(0.01, base + treatment * uplift));
    promo.push({ customer_id: i, orders_prev_90d: prev, days_since_last_order: dsl, avg_check: check, treatment, converted: rng() < p ? 1 : 0 });
  }

  const tables = { users, items, events, orders, experiment_users: expUsers, marketing_spend: spend, churn_features: churn, promo_campaign: promo };
  return { tables, activeDays, users };
}

export function toCsv(rows, cols) {
  const out = [cols.map((c) => c[0]).join(',')];
  for (const r of rows) {
    out.push(cols.map(([name]) => {
      const v = r[name];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && /[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
      return String(v);
    }).join(','));
  }
  return out.join('\n');
}

let cached = null;
export function getData() {
  if (!cached) cached = generate();
  return cached;
}

const csvCache = {};
export function getCsv(name) {
  if (!csvCache[name]) csvCache[name] = toCsv(getData().tables[name], SCHEMA[name]);
  return csvCache[name];
}
