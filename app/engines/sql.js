// SQL-движок: DuckDB-wasm прямо в браузере. Данные — синтетические логи из data/generate.js.
import { SCHEMA, getCsv } from '../data/generate.js';

const DUCKDB_URL = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';
let connPromise = null;

export function sqlReady() { return connPromise !== null; }

export function getConn() {
  if (!connPromise) {
    connPromise = (async () => {
      const duckdb = await import(DUCKDB_URL);
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
      const conn = await db.connect();
      for (const [name, cols] of Object.entries(SCHEMA)) {
        await db.registerFileText(`${name}.csv`, getCsv(name));
        const spec = cols.map(([c, t]) => `'${c}': '${t}'`).join(', ');
        await conn.query(`CREATE OR REPLACE TABLE ${name} AS SELECT * FROM read_csv('${name}.csv', header = true, columns = {${spec}}, nullstr = '')`);
      }
      return conn;
    })();
    connPromise.catch(() => { connPromise = null; });
  }
  return connPromise;
}

export async function resetDb() {
  if (!connPromise) return;
  const conn = await connPromise;
  for (const [name, cols] of Object.entries(SCHEMA)) {
    const spec = cols.map(([c, t]) => `'${c}': '${t}'`).join(', ');
    await conn.query(`CREATE OR REPLACE TABLE ${name} AS SELECT * FROM read_csv('${name}.csv', header = true, columns = {${spec}}, nullstr = '')`);
  }
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

// Пускаем только читающие запросы: так база не сломается от случайного DROP.
export function validateSql(sql) {
  const s = stripComments(sql).trim().replace(/;\s*$/, '');
  if (!s) return 'Запрос пустой.';
  if (s.includes(';')) return 'Нужен один запрос — без нескольких операторов через «;».';
  if (!/^(select|with|from|\()/i.test(s)) return 'Здесь можно выполнять только SELECT-запросы (можно начинать с WITH).';
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function fmtTs(ms) { const d = new Date(ms); return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }

function normValue(v, type) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (/^Date/.test(type)) return fmtDate(v instanceof Date ? v.getTime() : Number(v));
  if (/^Timestamp/.test(type)) return fmtTs(v instanceof Date ? v.getTime() : Number(v));
  if (v instanceof Date) return fmtTs(v.getTime());
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v && typeof v.toJSON === 'function') return JSON.stringify(v.toJSON(), (k, x) => (typeof x === 'bigint' ? Number(x) : x));
  if (v && typeof v.toArray === 'function') return JSON.stringify(Array.from(v.toArray()), (k, x) => (typeof x === 'bigint' ? Number(x) : x));
  return String(v);
}

export async function runSql(sql) {
  const err = validateSql(sql);
  if (err) throw new Error(err);
  const conn = await getConn();
  const t0 = performance.now();
  const table = await conn.query(stripComments(sql).trim().replace(/;\s*$/, ''));
  const fields = table.schema.fields.map((f) => ({ name: f.name, type: String(f.type) }));
  const vecs = fields.map((_, i) => table.getChildAt(i));
  const rows = [];
  for (let r = 0; r < table.numRows; r++) rows.push(vecs.map((v, i) => normValue(v.get(r), fields[i].type)));
  return { cols: fields.map((f) => f.name), types: fields.map((f) => f.type), rows, ms: performance.now() - t0 };
}

function eqVal(a, b, tol) {
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  const sa = String(a), sb = String(b);
  if (sa === sb) return true;
  // DATE против TIMESTAMP с нулевым временем — одно и то же
  if (sa + ' 00:00:00' === sb || sb + ' 00:00:00' === sa) return true;
  // число, пришедшее строкой
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a), y = Number(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
  }
  return false;
}

function rowKey(row) {
  return row.map((v) => (typeof v === 'number' ? v.toFixed(4) : v === null ? '\u0000' : String(v))).join('\u0001');
}

export function fmtCell(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return String(v);
}

export function compareResults(user, exp, { ordered = false, tol = 1e-4 } = {}) {
  if (user.cols.length !== exp.cols.length) {
    return { ok: false, msg: `Ожидалось колонок: ${exp.cols.length} (${exp.cols.join(', ')}), получено: ${user.cols.length}.` };
  }
  if (user.rows.length !== exp.rows.length) {
    return { ok: false, msg: `Ожидалось строк: ${exp.rows.length}, получено: ${user.rows.length}.` };
  }
  let u = user.rows, e = exp.rows;
  if (!ordered) {
    u = [...u].sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));
    e = [...e].sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));
  }
  for (let i = 0; i < e.length; i++) {
    for (let j = 0; j < e[i].length; j++) {
      if (!eqVal(u[i][j], e[i][j], tol)) {
        const where = ordered ? `Строка ${i + 1}` : 'Набор строк отличается (порядок не важен). Первое расхождение';
        return { ok: false, msg: `${where}, колонка «${exp.cols[j]}»: ожидалось ${fmtCell(e[i][j])}, получено ${fmtCell(u[i][j])}.` };
      }
    }
  }
  const names = user.cols.map((c) => c.toLowerCase()).join(',') === exp.cols.map((c) => c.toLowerCase()).join(',');
  return { ok: true, msg: names ? '' : `Значения совпали. Названия колонок в задании: ${exp.cols.join(', ')}.` };
}
