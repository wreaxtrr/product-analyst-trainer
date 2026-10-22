// Python-движок: Pyodide (CPython в WebAssembly) с pandas, numpy, scipy и scikit-learn.
// Таблицы те же, что в SQL: каждая задача видит свежую копию DataFrame-ов.
import { SCHEMA, getCsv } from '../data/generate.js';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let pyPromise = null;
const loaded = new Set();

const DATE_COLS = {
  users: ['signup_date'], events: ['ts'], orders: ['ts'], experiment_users: ['assigned_at'], marketing_spend: ['dt'],
};

const SETUP = `
import io, contextlib, traceback, warnings, math
import numpy as np
import pandas as pd
warnings.filterwarnings('ignore')
pd.set_option('display.width', 140)
pd.set_option('display.max_columns', 30)
pd.set_option('display.max_rows', 40)

_DATE_COLS = ${JSON.stringify(DATE_COLS)}
_CACHE = {}

def _table(name):
    if name not in _CACHE:
        if name == 'daily_orders':
            o = _table('orders')
            o = o[o['status'] == 'delivered']
            d = o.groupby(o['ts'].dt.normalize()).agg(orders=('order_id', 'count'), revenue=('revenue', 'sum'))
            d = d.reindex(pd.date_range('2024-01-01', '2024-07-31', freq='D'), fill_value=0)
            d.index.name = 'dt'
            _CACHE[name] = d.reset_index()
        else:
            _CACHE[name] = pd.read_csv(f'/data/{name}.csv', parse_dates=_DATE_COLS.get(name, []))
    return _CACHE[name]

_TABLES = ${JSON.stringify([...Object.keys(SCHEMA), 'daily_orders'])}

def _ns(src):
    ns = {'pd': pd, 'np': np, 'math': math, '__name__': '__main__'}
    for t in _TABLES:
        if t in src:
            ns[t] = _table(t).copy()
    return ns

def _exec(src, ns):
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(src, '<твой код>', 'exec'), ns)
        return buf.getvalue(), None
    except Exception as e:
        tb = traceback.format_exc()
        lines = tb.splitlines()
        keep = [l for l in lines if 'File "<твой код>"' in l or not l.startswith('  File')]
        msg = '\\n'.join(keep[-6:])
        return buf.getvalue(), msg

def _norm(x):
    if isinstance(x, pd.Series):
        x = x.to_frame()
    if isinstance(x, pd.DataFrame):
        if isinstance(x.index, pd.RangeIndex):
            return x.reset_index(drop=True)
        return x.reset_index()
    if isinstance(x, (list, tuple, np.ndarray)):
        return pd.DataFrame({'value': np.asarray(x).ravel()})
    return x

def _is_num(s):
    return pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s)

def _fmt(v):
    if isinstance(v, float):
        return repr(round(v, 6))
    return repr(v)

def _cmp(u, r, ordered=True, tol=1e-4):
    u, r = _norm(u), _norm(r)
    if isinstance(r, pd.DataFrame):
        if not isinstance(u, pd.DataFrame):
            return False, f'Ожидалась таблица (DataFrame или Series), получено: {type(u).__name__}'
        if u.shape != r.shape:
            return False, f'Размер не совпадает: ожидалось {r.shape[0]} строк × {r.shape[1]} колонок, получено {u.shape[0]} × {u.shape[1]}. Ожидаемые колонки: {list(r.columns)}'
        uv, rv = u.copy(), r.copy()
        names = list(r.columns)
        uv.columns = range(uv.shape[1]); rv.columns = range(rv.shape[1])
        if not ordered:
            uv = uv.sort_values(by=list(uv.columns), key=lambda s: s.round(4).astype(str) if _is_num(s) else s.astype(str)).reset_index(drop=True)
            rv = rv.sort_values(by=list(rv.columns), key=lambda s: s.round(4).astype(str) if _is_num(s) else s.astype(str)).reset_index(drop=True)
        for j in range(rv.shape[1]):
            a, b = uv[j], rv[j]
            if _is_num(b) and (_is_num(a) or pd.api.types.is_bool_dtype(a)):
                ok = np.isclose(a.astype(float).values, b.astype(float).values, rtol=tol, atol=1e-9, equal_nan=True)
            else:
                ok = (a.astype(str).values == b.astype(str).values)
            if not ok.all():
                i = int(np.argmin(ok))
                return False, f'Строка {i + 1}, колонка «{names[j]}»: ожидалось {_fmt(b.iloc[i])}, получено {_fmt(a.iloc[i])}'
        return True, ''
    if isinstance(r, (bool, np.bool_)):
        return (bool(u) == bool(r)), f'Ожидалось {r}, получено {u}'
    if isinstance(r, (int, float, np.integer, np.floating)):
        try:
            uf = float(u)
        except Exception:
            return False, f'Ожидалось число, получено: {type(u).__name__}'
        ok = math.isclose(uf, float(r), rel_tol=tol, abs_tol=1e-9)
        return ok, ('' if ok else f'Ожидалось ≈ {_fmt(float(r))}, получено {_fmt(uf)}')
    ok = (u == r)
    return bool(ok), ('' if ok else f'Ожидалось {r!r}, получено {u!r}')

def _preview(x):
    try:
        if isinstance(x, (pd.DataFrame, pd.Series)):
            return x.head(15).to_string()
        if x is None:
            return ''
        return repr(x)[:2000]
    except Exception:
        return ''

def _run(user_src, sol_src, test_src, var, ordered, tol, only_run):
    uns = _ns(user_src + '\\n' + (test_src or ''))
    out, err = _exec(user_src, uns)
    res = {'ok': False, 'out': out[-6000:], 'err': err, 'msg': '', 'preview': ''}
    if err:
        res['msg'] = 'Код упал с ошибкой.'
        return res
    res['preview'] = _preview(uns.get(var)) if var else ''
    if only_run:
        res['ok'] = None
        return res
    expected = None
    if sol_src:
        rns = _ns(sol_src + '\\n' + (test_src or ''))
        _, serr = _exec(sol_src, rns)
        if serr:
            res['msg'] = 'Ошибка в эталонном решении: ' + serr
            return res
        expected = rns.get(var) if var else None
    if test_src:
        uns['expected'] = expected
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                exec(compile(test_src, '<проверка>', 'exec'), uns)
            res['ok'] = True
        except AssertionError as e:
            res['msg'] = str(e) or 'Проверка не прошла.'
        except Exception as e:
            res['msg'] = f'Проверка упала: {type(e).__name__}: {e}'
        return res
    if var not in uns:
        res['msg'] = f'Не найдена переменная {var}. Положи ответ в неё.'
        return res
    ok, msg = _cmp(uns[var], expected, ordered, tol)
    res['ok'] = bool(ok)
    res['msg'] = msg
    return res
`;

export function pyStarted() { return pyPromise !== null; }

export async function getPy(packages = [], onStatus = () => {}) {
  if (!pyPromise) {
    pyPromise = (async () => {
      onStatus('Загружаю Python (Pyodide)…');
      const { loadPyodide } = await import(PYODIDE + 'pyodide.mjs');
      const py = await loadPyodide({ indexURL: PYODIDE });
      onStatus('Ставлю pandas и numpy…');
      await py.loadPackage(['numpy', 'pandas']);
      py.FS.mkdirTree('/data');
      for (const name of Object.keys(SCHEMA)) py.FS.writeFile(`/data/${name}.csv`, getCsv(name));
      py.runPython(SETUP);
      return py;
    })();
    pyPromise.catch(() => { pyPromise = null; });
  }
  const py = await pyPromise;
  const need = packages.filter((p) => !loaded.has(p));
  if (need.length) {
    onStatus(`Ставлю ${need.join(', ')}…`);
    await py.loadPackage(need);
    need.forEach((p) => loaded.add(p));
  }
  return py;
}

export async function runPython({ code, solution = '', test = '', variable = 'result', ordered = true, tol = 1e-4, packages = [], onlyRun = false }, onStatus) {
  const py = await getPy(packages, onStatus);
  onStatus && onStatus('Выполняю…');
  const fn = py.globals.get('_run');
  try {
    const r = fn(code, solution || '', test || '', variable || '', ordered, tol, onlyRun);
    const js = r.toJs({ dict_converter: Object.fromEntries });
    r.destroy();
    return js;
  } finally {
    fn.destroy();
  }
}
