// SQL-марафон: шаблоны задач со случайными параметрами. Каждый шаблон возвращает
// условие, эталонный запрос и признак, важен ли порядок строк. Задач бесконечно много,
// а навыки — те же, что спрашивают на собеседованиях и в работе.
import { mulberry32 } from './generate.js';

const CITIES = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Краснодар'];
const PLATFORMS = ['ios', 'android', 'web'];
const CHANNELS = ['organic', 'ads', 'referral'];
const CATEGORIES = ['Овощи и фрукты', 'Молочные продукты', 'Мясо и рыба', 'Выпечка', 'Напитки', 'Снеки', 'Бытовая химия', 'Готовая еда'];
const MONTHS = [
  ['январе', '2024-01-01', '2024-02-01'], ['феврале', '2024-02-01', '2024-03-01'], ['марте', '2024-03-01', '2024-04-01'],
  ['апреле', '2024-04-01', '2024-05-01'], ['мае', '2024-05-01', '2024-06-01'], ['июне', '2024-06-01', '2024-07-01'], ['июле', '2024-07-01', '2024-08-01'],
];
const pad = (n) => String(n).padStart(2, '0');

function makeRand(seed) {
  const r = mulberry32(seed);
  return {
    one: (a) => a[Math.floor(r() * a.length)],
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    month: (from = 0) => MONTHS[from + Math.floor(r() * (MONTHS.length - from))],
    day: (lo = 15, hi = 205) => { const d = new Date(Date.UTC(2024, 0, 1) + (lo + Math.floor(r() * (hi - lo))) * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; },
  };
}

export const DRILLS = [
  {
    id: 'orders-city-month', topic: 'Фильтры и агрегаты', level: 1,
    gen: (R) => {
      const c = R.one(CITIES), [m, a, b] = R.month();
      return {
        q: `Сколько **доставленных** заказов сделали пользователи из города **${c}** в **${m}** 2024 и какая у них суммарная выручка? Колонки: \`orders\`, \`revenue\`.`,
        sql: `SELECT COUNT(*) AS orders, SUM(o.revenue) AS revenue\nFROM orders o\nJOIN users u USING (user_id)\nWHERE u.city = '${c}' AND o.status = 'delivered'\n  AND o.ts >= '${a}' AND o.ts < '${b}'`,
      };
    },
  },
  {
    id: 'cancel-rate', topic: 'Условная агрегация', level: 1,
    gen: (R) => {
      const [m, a, b] = R.month();
      return {
        q: `Посчитай долю отменённых заказов по платформам за **${m}** 2024. Колонки: \`platform\`, \`orders\`, \`cancel_rate\` (от 0 до 1).`,
        sql: `SELECT u.platform, COUNT(*) AS orders,\n       AVG(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancel_rate\nFROM orders o\nJOIN users u USING (user_id)\nWHERE o.ts >= '${a}' AND o.ts < '${b}'\nGROUP BY u.platform`,
      };
    },
  },
  {
    id: 'dau-day', topic: 'Даты', level: 1,
    gen: (R) => {
      const d = R.day();
      return {
        q: `Сколько уникальных пользователей с любым событием было **${d}** на каждой платформе? Колонки: \`platform\`, \`dau\`.`,
        sql: `SELECT u.platform, COUNT(DISTINCT e.user_id) AS dau\nFROM events e\nJOIN users u USING (user_id)\nWHERE e.ts >= DATE '${d}' AND e.ts < DATE '${d}' + 1\nGROUP BY u.platform`,
      };
    },
  },
  {
    id: 'top-categories', topic: 'JOIN и топ-N', level: 2,
    gen: (R) => {
      const p = R.one(PLATFORMS), [m, a, b] = R.month(), n = R.int(2, 4);
      return {
        q: `Топ-${n} категорий по числу добавлений в корзину (\`add_to_cart\`) на платформе **${p}** в **${m}** 2024. Колонки: \`category\`, \`carts\`. Сортировка по \`carts\` по убыванию.`,
        sql: `SELECT i.category, COUNT(*) AS carts\nFROM events e\nJOIN users u USING (user_id)\nJOIN items i ON i.item_id = e.item_id\nWHERE e.event_name = 'add_to_cart' AND u.platform = '${p}'\n  AND e.ts >= '${a}' AND e.ts < '${b}'\nGROUP BY i.category\nORDER BY carts DESC\nLIMIT ${n}`,
        ordered: true,
      };
    },
  },
  {
    id: 'checkout-cr', topic: 'Воронки', level: 2,
    gen: (R) => {
      const [m, a, b] = R.month(1), c = R.one(CITIES);
      return {
        q: `Конверсия из \`checkout\` в \`purchase\` (по числу событий) в городе **${c}** за **${m}** 2024. Колонки: \`checkouts\`, \`purchases\`, \`cr\`.`,
        sql: `SELECT COUNT(*) FILTER (WHERE e.event_name = 'checkout') AS checkouts,\n       COUNT(*) FILTER (WHERE e.event_name = 'purchase') AS purchases,\n       COUNT(*) FILTER (WHERE e.event_name = 'purchase') * 1.0 / COUNT(*) FILTER (WHERE e.event_name = 'checkout') AS cr\nFROM events e\nJOIN users u USING (user_id)\nWHERE u.city = '${c}' AND e.ts >= '${a}' AND e.ts < '${b}'`,
      };
    },
  },
  {
    id: 'first-order-share', topic: 'Оконные функции', level: 2,
    gen: (R) => {
      const [m, a, b] = R.month(1);
      return {
        q: `Какая доля заказов **${m}** 2024 (любой статус) была **первым** заказом пользователя за всё время? Одна колонка \`first_share\`.`,
        sql: `WITH o AS (\n  SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts, order_id) AS rn\n  FROM orders\n)\nSELECT AVG(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS first_share\nFROM o\nWHERE ts >= '${a}' AND ts < '${b}'`,
      };
    },
  },
  {
    id: 'retention-dn', topic: 'Retention', level: 2,
    gen: (R) => {
      const [m, a, b] = MONTHS[R.int(0, 5)], n = R.one([1, 3, 7, 14]);
      return {
        q: `Retention **дня ${n}** для пользователей, зарегистрированных в **${m}** 2024: доля тех, у кого есть событие ровно в день \`signup_date + ${n}\`. Колонки: \`users\`, \`retained\`, \`retention\`.`,
        sql: `WITH act AS (SELECT DISTINCT user_id, ts::DATE AS d FROM events)\nSELECT COUNT(*) AS users, COUNT(a.user_id) AS retained, COUNT(a.user_id) * 1.0 / COUNT(*) AS retention\nFROM users u\nLEFT JOIN act a ON a.user_id = u.user_id AND a.d = u.signup_date + ${n}\nWHERE u.signup_date >= '${a}' AND u.signup_date < '${b}'`,
      };
    },
  },
  {
    id: 'aov-promo', topic: 'Агрегаты и NULL', level: 1,
    gen: (R) => {
      const [m, a, b] = R.month();
      return {
        q: `Средний чек доставленных заказов в **${m}** 2024 с промокодом и без. Колонки: \`promo\` (код или \`'none'\`), \`orders\`, \`aov\`.`,
        sql: `SELECT COALESCE(promo_code, 'none') AS promo, COUNT(*) AS orders, AVG(revenue) AS aov\nFROM orders\nWHERE status = 'delivered' AND ts >= '${a}' AND ts < '${b}'\nGROUP BY 1`,
      };
    },
  },
  {
    id: 'channel-conv', topic: 'LEFT JOIN', level: 2,
    gen: (R) => {
      const [m, a, b] = MONTHS[R.int(0, 5)], k = R.one([7, 14, 30]);
      return {
        q: `Для пользователей, зарегистрированных в **${m}** 2024, посчитай по каналам долю сделавших заказ (любой статус) в первые **${k}** дней (\`ts < signup_date + ${k}\`). Колонки: \`channel\`, \`users\`, \`conversion\`.`,
        sql: `SELECT u.channel, COUNT(DISTINCT u.user_id) AS users,\n       COUNT(DISTINCT o.user_id) * 1.0 / COUNT(DISTINCT u.user_id) AS conversion\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.user_id AND o.ts < u.signup_date + ${k}\nWHERE u.signup_date >= '${a}' AND u.signup_date < '${b}'\nGROUP BY u.channel`,
      };
    },
  },
  {
    id: 'running-revenue', topic: 'Оконные функции', level: 2,
    gen: (R) => {
      const d = R.day(30, 195);
      return {
        q: `Выручка доставленных заказов по дням за 7 дней, начиная с **${d}**, с нарастающим итогом. Колонки: \`dt\`, \`revenue\`, \`cum_revenue\`. Сортировка по дате.`,
        sql: `SELECT ts::DATE AS dt, SUM(revenue) AS revenue,\n       SUM(SUM(revenue)) OVER (ORDER BY ts::DATE) AS cum_revenue\nFROM orders\nWHERE status = 'delivered' AND ts >= DATE '${d}' AND ts < DATE '${d}' + 7\nGROUP BY 1\nORDER BY 1`,
        ordered: true,
      };
    },
  },
  {
    id: 'experiment-cr', topic: 'A/B на SQL', level: 3,
    gen: (R) => {
      const p = R.one(PLATFORMS);
      return {
        q: `Эксперимент **new_checkout**, только пользователи платформы **${p}**: доля участников с заказом (любой статус) с \`assigned_at\` до 30 июня включительно, по группам. Колонки: \`grp\`, \`users\`, \`cr\`.`,
        sql: `WITH x AS (\n  SELECT e.grp, e.user_id, MAX(CASE WHEN o.order_id IS NOT NULL THEN 1 ELSE 0 END) AS buyer\n  FROM experiment_users e\n  JOIN users u USING (user_id)\n  LEFT JOIN orders o ON o.user_id = e.user_id AND o.ts >= e.assigned_at AND o.ts < '2024-07-01'\n  WHERE e.experiment = 'new_checkout' AND u.platform = '${p}'\n  GROUP BY 1, 2\n)\nSELECT grp, COUNT(*) AS users, AVG(buyer) AS cr FROM x GROUP BY grp`,
      };
    },
  },
  {
    id: 'cac-month', topic: 'Юнит-экономика', level: 2,
    gen: (R) => {
      const [m, a, b] = MONTHS[R.int(0, 5)], ch = R.one(['ads', 'referral']);
      return {
        q: `CAC канала **${ch}** за **${m}** 2024: расходы за месяц / регистрации из канала за месяц. Колонки: \`spend\`, \`new_users\`, \`cac\`.`,
        sql: `WITH s AS (SELECT SUM(spend) AS spend FROM marketing_spend WHERE channel = '${ch}' AND dt >= '${a}' AND dt < '${b}'),\n     n AS (SELECT COUNT(*) AS new_users FROM users WHERE channel = '${ch}' AND signup_date >= '${a}' AND signup_date < '${b}')\nSELECT spend, new_users, spend / new_users AS cac FROM s, n`,
      };
    },
  },
  {
    id: 'payments-dup', topic: 'Качество данных', level: 2,
    gen: (R) => {
      const pr = R.one(['card', 'sbp', 'applepay']);
      return {
        q: `Сколько заказов имеют **больше одного** успешного платежа (\`status = 'success'\`) у провайдера **${pr}**? Одна колонка \`orders_with_dups\`.`,
        sql: `SELECT COUNT(*) AS orders_with_dups\nFROM (\n  SELECT order_id FROM payments\n  WHERE status = 'success' AND provider = '${pr}'\n  GROUP BY order_id HAVING COUNT(*) > 1\n)`,
      };
    },
  },
  {
    id: 'reviews-rating', topic: 'Тексты и LIKE', level: 2,
    gen: (R) => {
      const [word, label] = R.one([['опозд', 'опоздания'], ['курьер', 'курьер'], ['свеж', 'свежесть продуктов'], ['оплат', 'оплата'], ['не привезли', 'недовоз']]);
      return {
        q: `Тема «**${label}**»: сравни среднюю оценку отзывов, в тексте которых есть подстрока \`'${word}'\` (без учёта регистра), и всех остальных. Колонки: \`mentions\` (true/false), \`reviews\`, \`avg_rating\`.`,
        sql: `SELECT text ILIKE '%${word}%' AS mentions, COUNT(*) AS reviews, AVG(rating) AS avg_rating\nFROM reviews\nGROUP BY 1`,
      };
    },
  },
  {
    id: 'category-share', topic: 'Доля от итога', level: 2,
    gen: (R) => {
      const c = R.one(CITIES), [m, a, b] = R.month();
      return {
        q: `Доля каждой категории в просмотрах товаров (\`view_item\`) пользователей из **${c}** в **${m}** 2024. Колонки: \`category\`, \`views\`, \`share\`.`,
        sql: `SELECT i.category, COUNT(*) AS views, COUNT(*) * 1.0 / SUM(COUNT(*)) OVER () AS share\nFROM events e\nJOIN users u USING (user_id)\nJOIN items i ON i.item_id = e.item_id\nWHERE e.event_name = 'view_item' AND u.city = '${c}' AND e.ts >= '${a}' AND e.ts < '${b}'\nGROUP BY i.category`,
      };
    },
  },
  {
    id: 'hour-peak', topic: 'Даты', level: 1,
    gen: (R) => {
      const p = R.one(PLATFORMS);
      return {
        q: `В какой **час суток** пользователи **${p}** делают больше всего заказов (за всё время, любой статус)? Колонки: \`hour\`, \`orders\` — одна строка.`,
        sql: `SELECT hour(o.ts) AS hour, COUNT(*) AS orders\nFROM orders o\nJOIN users u USING (user_id)\nWHERE u.platform = '${p}'\nGROUP BY 1\nORDER BY orders DESC, hour\nLIMIT 1`,
        ordered: true,
      };
    },
  },
  {
    id: 'repeat-buyers', topic: 'Когорты', level: 3,
    gen: (R) => {
      const [m, a, b] = MONTHS[R.int(0, 4)];
      return {
        q: `Среди пользователей, чей **первый** заказ (любой статус) был в **${m}** 2024, какая доля сделала **второй** заказ в течение 30 дней после первого? Колонки: \`buyers\`, \`repeat_30d\`.`,
        sql: `WITH o AS (\n  SELECT user_id, ts, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts, order_id) AS rn FROM orders\n),\nf AS (\n  SELECT a.user_id, a.ts AS t1, b.ts AS t2\n  FROM o a LEFT JOIN o b ON b.user_id = a.user_id AND b.rn = 2\n  WHERE a.rn = 1 AND a.ts >= '${a}' AND a.ts < '${b}'\n)\nSELECT COUNT(*) AS buyers,\n       AVG(CASE WHEN t2 IS NOT NULL AND t2 <= t1 + INTERVAL 30 DAY THEN 1 ELSE 0 END) AS repeat_30d\nFROM f`,
      };
    },
  },
  {
    id: 'fee-elasticity', topic: 'Эксперименты', level: 2,
    gen: (R) => {
      const f = R.one([99, 199]);
      return {
        q: `Тест платы за доставку: насколько изменилось среднее число заказов на клиента в группе **${f} ₽** относительно группы **0 ₽**? Колонки: \`orders_0\`, \`orders_fee\`, \`change\` (orders_fee / orders_0 − 1).`,
        sql: `SELECT AVG(orders_30d) FILTER (WHERE fee = 0) AS orders_0,\n       AVG(orders_30d) FILTER (WHERE fee = ${f}) AS orders_fee,\n       AVG(orders_30d) FILTER (WHERE fee = ${f}) / AVG(orders_30d) FILTER (WHERE fee = 0) - 1 AS change\nFROM delivery_fee_test`,
      };
    },
  },
];

export function makeDrill(index, seed) {
  const t = DRILLS[index % DRILLS.length];
  const d = t.gen(makeRand(seed));
  return { id: `${t.id}:${seed}`, topic: t.topic, level: t.level, ordered: !!d.ordered, ...d };
}

export function randomDrill(seed) {
  const r = mulberry32(seed);
  return makeDrill(Math.floor(r() * DRILLS.length), seed);
}
