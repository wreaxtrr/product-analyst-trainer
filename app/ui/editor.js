import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, cls } from '../lib.js';
import { SCHEMA, TABLE_DOCS, COLUMN_VALUES } from '../data/generate.js';
import { explainSqlError, explainPyError, literalWarnings } from '../engines/sqlerrors.js';

// Редактор кода в стиле IDE на CodeMirror 6: подсветка, номера строк, автодополнение по схеме
// «Корзинки» и функциям DuckDB, подсветка места ошибки, форматирование SQL, выполнение выделенного.
// Модули грузятся лениво; пока они грузятся (или если CDN недоступен), работает обычное текстовое поле.

let cmPromise = null;
function loadCm() {
  if (!cmPromise) {
    cmPromise = Promise.all([
      import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/language'),
      import('@codemirror/commands'), import('@codemirror/autocomplete'), import('@codemirror/search'),
      import('@codemirror/lint'), import('@codemirror/lang-sql'), import('@codemirror/lang-python'), import('@lezer/highlight'),
    ]).then(([state, view, language, commands, autocomplete, search, lint, langSql, langPy, highlight]) =>
      ({ state, view, language, commands, autocomplete, search, lint, langSql, langPy, highlight }));
    cmPromise.catch(() => { cmPromise = null; });
  }
  return cmPromise;
}

// Функции DuckDB для подсказок: имя, пример вызова, что делает.
const SQL_FUNCS = [
  ['date_trunc', "date_trunc('month', ts)", 'Обрезает дату до начала периода — day, week, month, quarter, year'],
  ['date_diff', "date_diff('day', start, end)", 'Разница между датами в днях, неделях, месяцах'],
  ['date_part', "date_part('dow', ts)", 'Часть даты числом — year, month, day, hour, dow (0 — воскресенье)'],
  ['extract', 'extract(hour FROM ts)', 'Часть даты — year, month, day, hour, dow'],
  ['strftime', "strftime(ts, '%Y-%m')", 'Дату в строку по формату'],
  ['strptime', "strptime('01.06.2024', '%d.%m.%Y')", 'Строку в дату по формату'],
  ['make_date', 'make_date(2024, 6, 1)', 'Дата из года, месяца и дня'],
  ['current_date', 'current_date', 'Сегодняшняя дата'],
  ['generate_series', "generate_series(DATE '2024-06-01', DATE '2024-06-30', INTERVAL 1 DAY)", 'Ряд значений — календарь дат или чисел'],
  ['count', 'count(*) · count(col) · count(DISTINCT col)', 'Число строк; count(col) не считает NULL'],
  ['count_if', 'count_if(status = \'cancelled\')', 'Число строк, где условие истинно'],
  ['sum', 'sum(x)', 'Сумма; NULL пропускаются, по пустому набору — NULL'],
  ['avg', 'avg(x)', 'Среднее; NULL пропускаются'],
  ['min', 'min(x)', 'Минимум'],
  ['max', 'max(x)', 'Максимум'],
  ['median', 'median(x)', 'Медиана'],
  ['quantile_cont', 'quantile_cont(x, 0.9)', 'Квантиль с интерполяцией (как percentile_cont)'],
  ['quantile_disc', 'quantile_disc(x, 0.9)', 'Квантиль — ближайшее значение из данных'],
  ['stddev_samp', 'stddev_samp(x)', 'Выборочное стандартное отклонение'],
  ['var_samp', 'var_samp(x)', 'Выборочная дисперсия'],
  ['corr', 'corr(x, y)', 'Корреляция Пирсона'],
  ['arg_max', 'arg_max(item, revenue)', 'Значение первого аргумента в строке с максимумом второго'],
  ['arg_min', 'arg_min(item, revenue)', 'Значение первого аргумента в строке с минимумом второго'],
  ['any_value', 'any_value(x)', 'Любое значение из группы'],
  ['string_agg', "string_agg(x, ', ')", 'Склеивает строки группы через разделитель'],
  ['list', 'list(x)', 'Собирает значения группы в список'],
  ['approx_count_distinct', 'approx_count_distinct(user_id)', 'Приблизительное число уникальных (HyperLogLog)'],
  ['row_number', 'row_number() OVER (PARTITION BY … ORDER BY …)', 'Номер строки в окне — 1, 2, 3…'],
  ['rank', 'rank() OVER (ORDER BY x DESC)', 'Ранг с пропусками — 1, 1, 3'],
  ['dense_rank', 'dense_rank() OVER (ORDER BY x DESC)', 'Ранг без пропусков — 1, 1, 2'],
  ['ntile', 'ntile(4) OVER (ORDER BY x)', 'Делит строки на n примерно равных групп'],
  ['lag', 'lag(x, 1) OVER (ORDER BY dt)', 'Значение из предыдущей строки окна'],
  ['lead', 'lead(x, 1) OVER (ORDER BY dt)', 'Значение из следующей строки окна'],
  ['first_value', 'first_value(x) OVER (PARTITION BY … ORDER BY …)', 'Первое значение окна'],
  ['last_value', 'last_value(x) OVER (… ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)', 'Последнее значение — без явной рамки вернёт текущую строку'],
  ['percent_rank', 'percent_rank() OVER (ORDER BY x)', 'Относительный ранг от 0 до 1'],
  ['cume_dist', 'cume_dist() OVER (ORDER BY x)', 'Доля строк со значением не больше текущего'],
  ['coalesce', 'coalesce(a, b, 0)', 'Первое не-NULL значение'],
  ['nullif', 'nullif(a, b)', 'NULL, если a = b — защита от деления на ноль'],
  ['ifnull', 'ifnull(a, 0)', 'a, а если NULL — второй аргумент'],
  ['greatest', 'greatest(a, b)', 'Наибольшее из значений'],
  ['least', 'least(a, b)', 'Наименьшее из значений'],
  ['round', 'round(x, 2)', 'Округление до n знаков'],
  ['floor', 'floor(x)', 'Округление вниз'],
  ['ceil', 'ceil(x)', 'Округление вверх'],
  ['abs', 'abs(x)', 'Модуль'],
  ['sqrt', 'sqrt(x)', 'Квадратный корень'],
  ['power', 'power(x, 2)', 'Степень'],
  ['ln', 'ln(x)', 'Натуральный логарифм'],
  ['exp', 'exp(x)', 'Экспонента'],
  ['lower', 'lower(s)', 'В нижний регистр'],
  ['upper', 'upper(s)', 'В верхний регистр'],
  ['length', 'length(s)', 'Длина строки'],
  ['trim', 'trim(s)', 'Убирает пробелы по краям'],
  ['concat', "concat(a, ' ', b)", 'Склеивает строки (или a || b)'],
  ['substring', 'substring(s, 1, 3)', 'Подстрока — с позиции, длиной n'],
  ['split_part', "split_part(s, ',', 1)", 'n-я часть строки по разделителю'],
  ['replace', "replace(s, 'a', 'b')", 'Замена подстроки'],
  ['contains', "contains(s, 'abc')", 'Есть ли подстрока'],
  ['regexp_matches', "regexp_matches(s, '^\\d+$')", 'Подходит ли строка под регулярное выражение'],
  ['regexp_extract', "regexp_extract(s, '(\\d+)', 1)", 'Извлекает часть строки по регулярному выражению'],
  ['cast', 'CAST(x AS DOUBLE)', 'Приведение типа; короче — x::DOUBLE'],
];

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'QUALIFY', 'WITH', 'AS', 'DISTINCT',
  'JOIN', 'LEFT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'USING',
  'AND', 'OR', 'NOT', 'IN', 'NOT IN', 'EXISTS', 'NOT EXISTS', 'IS NULL', 'IS NOT NULL', 'IS DISTINCT FROM', 'LIKE', 'ILIKE', 'BETWEEN',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT',
  'OVER', 'PARTITION BY', 'ROWS BETWEEN', 'RANGE BETWEEN', 'UNBOUNDED PRECEDING', 'UNBOUNDED FOLLOWING', 'CURRENT ROW', 'PRECEDING', 'FOLLOWING',
  'ASC', 'DESC', 'NULLS LAST', 'NULLS FIRST', 'NULL', 'TRUE', 'FALSE', 'INTERVAL', 'DATE', 'TIMESTAMP', 'FILTER', 'WITHIN GROUP',
  'INTEGER', 'BIGINT', 'DOUBLE', 'VARCHAR', 'BOOLEAN',
];

const PY_ATTRS = [
  ['groupby', "df.groupby('col')", 'Группировка'], ['agg', "agg(n=('col', 'count'))", 'Агрегаты по группам'],
  ['merge', "df.merge(other, on='user_id', how='left')", 'Соединение таблиц (JOIN)'], ['pivot_table', "pivot_table(index=…, columns=…, values=…, aggfunc='sum')", 'Сводная таблица'],
  ['value_counts', 'value_counts(normalize=True)', 'Частоты значений'], ['sort_values', "sort_values('col', ascending=False)", 'Сортировка'],
  ['reset_index', 'reset_index()', 'Индекс в колонку'], ['query', "query('platform == \"ios\"')", 'Фильтр выражением'],
  ['assign', 'assign(new=lambda d: d.a / d.b)', 'Новая колонка'], ['drop_duplicates', "drop_duplicates(['user_id'])", 'Убрать дубли'],
  ['isna', 'isna()', 'Маска пропусков'], ['fillna', 'fillna(0)', 'Заполнить пропуски'], ['nunique', 'nunique()', 'Число уникальных'],
  ['mean', 'mean()', 'Среднее'], ['median', 'median()', 'Медиана'], ['sum', 'sum()', 'Сумма'], ['count', 'count()', 'Число не-NULL'],
  ['quantile', 'quantile(0.9)', 'Квантиль'], ['std', 'std()', 'Стандартное отклонение'], ['describe', 'describe()', 'Сводка статистик'],
  ['head', 'head(10)', 'Первые строки'], ['shape', 'shape', 'Размер (строки, колонки)'], ['columns', 'columns', 'Имена колонок'],
  ['dt', "dt.to_period('M')", 'Методы дат'], ['to_datetime', "pd.to_datetime(df['ts'])", 'Строки в даты'],
  ['cumsum', 'cumsum()', 'Накопленная сумма'], ['shift', 'shift(1)', 'Сдвиг (как LAG)'], ['pct_change', 'pct_change()', 'Изменение к прошлой строке'],
  ['rolling', 'rolling(7).mean()', 'Скользящее окно'], ['apply', 'apply(func)', 'Применить функцию'], ['loc', "loc[mask, 'col']", 'Выбор по меткам'],
];

const relevantTables = (text, fallback) => {
  const used = [...text.matchAll(/\b(?:from|join)\s+([a-z_]\w*)/gi)].map((m) => m[1].toLowerCase()).filter((t) => SCHEMA[t]);
  return used.length ? [...new Set(used)] : (fallback && fallback.length ? fallback : Object.keys(SCHEMA));
};
const valuesInfo = (t, c) => { const v = COLUMN_VALUES[`${t}.${c}`]; return v ? `Значения: ${v.map((x) => (x === 'NULL' || /^\d+$/.test(x) ? x : `'${x}'`)).join(', ')}` : ''; };

function buildExtensions(cm, { lang, tables, cbs, onDoc, onPos, diagFlag }) {
  const { state: S, view: V, language: L, commands: C, autocomplete: A, search: Q, lint: Li, langSql, langPy, highlight: H } = cm;
  const t = H.tags;
  const style = L.HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: 'var(--syn-kw)', fontWeight: '600' },
    { tag: [t.string, t.special(t.string)], color: 'var(--syn-str)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-num)' },
    { tag: [t.lineComment, t.blockComment, t.comment], color: 'var(--syn-com)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.standard(t.name), t.function(t.propertyName)], color: 'var(--syn-fn)' },
    { tag: [t.typeName, t.className], color: 'var(--syn-type)' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--syn-op)' },
    { tag: t.special(t.name), color: 'var(--syn-type)' },
    { tag: t.propertyName, color: 'var(--text)' },
  ]);

  let language, extra = [];
  if (lang === 'sql') {
    const base = langSql.PostgreSQL;
    const spec = base.spec || {};
    const dialect = langSql.SQLDialect.define({ ...spec, keywords: `${spec.keywords || ''} qualify pivot unpivot`, builtin: `${spec.builtin || ''} ${SQL_FUNCS.map((f) => f[0]).join(' ')}` });
    const schema = {};
    for (const [tb, cols] of Object.entries(SCHEMA)) schema[tb] = cols.map(([c, ty]) => ({ label: c, type: 'property', detail: ty, info: valuesInfo(tb, c) || undefined }));
    // Язык собирается вручную: схема — из lang-sql, а ключевые слова — короткий список нужных аналитику,
    // вместо сотен слов стандарта (PLACING, WHENEVER…), которые только мешают в подсказках.
    const tablesOpts = Object.keys(SCHEMA).map((tb) => ({ label: tb, type: 'type', detail: 'таблица', info: TABLE_DOCS[tb] }));
    const kw = SQL_KEYWORDS.map((k) => ({ label: k, type: 'keyword', boost: k.includes(' ') ? 0 : -1 }));
    const keywordSource = (ctx) => {
      const w = ctx.matchBefore(/\w+/);
      if (!w && !ctx.explicit) return null;
      const before = ctx.state.sliceDoc(Math.max(0, (w ? w.from : ctx.pos) - 1), w ? w.from : ctx.pos);
      if (before === '.' || before === "'") return null;
      return { from: w ? w.from : ctx.pos, options: kw, validFor: /^\w*$/ };
    };
    language = [
      dialect.language,
      dialect.language.data.of({ autocomplete: langSql.schemaCompletionSource({ dialect, schema, tables: tablesOpts }) }),
      dialect.language.data.of({ autocomplete: keywordSource }),
    ];
    const funcs = SQL_FUNCS.map(([name, sig, info]) => ({
      label: name, type: 'function', detail: sig, info, boost: 1,
      apply: (view, c, from, to) => {
        const noArgs = name === 'current_date';
        view.dispatch({ changes: { from, to, insert: noArgs ? name : `${name}()` }, selection: { anchor: from + name.length + (noArgs ? 0 : 1) } });
      },
    }));
    // Колонки без префикса — из таблиц, упомянутых в запросе (или из таблиц задачи).
    const columnsSource = (ctx) => {
      const w = ctx.matchBefore(/[\w]+/);
      if (!w && !ctx.explicit) return null;
      const charBefore = ctx.state.sliceDoc(Math.max(0, (w ? w.from : ctx.pos) - 1), w ? w.from : ctx.pos);
      if (charBefore === '.' || charBefore === "'") return null;
      // После FROM и JOIN нужны таблицы — их предлагает подсказка по схеме.
      if (/\b(from|join)\s+$/i.test(ctx.state.sliceDoc(Math.max(0, (w ? w.from : ctx.pos) - 12), w ? w.from : ctx.pos))) return null;
      const text = ctx.state.doc.toString();
      const opts = [];
      for (const tb of relevantTables(text, tables)) for (const [c, ty] of SCHEMA[tb]) opts.push({ label: c, type: 'property', detail: `${tb} · ${ty}`, info: valuesInfo(tb, c) || undefined, boost: 2 });
      return { from: w ? w.from : ctx.pos, options: [...opts, ...funcs], validFor: /^\w*$/ };
    };
    // Значения колонки после `col =`, `col <>` или внутри `col IN (`.
    const valuesSource = (ctx) => {
      const line = ctx.state.doc.lineAt(ctx.pos);
      const before = line.text.slice(0, ctx.pos - line.from);
      const m = before.match(/(?:(\w+)\.)?(\w+)\s*(?:=|<>|!=|\bin\s*\((?:\s*'[^']*'\s*,)*)\s*('[^']*)?$/i);
      if (!m) return null;
      const col = m[2].toLowerCase();
      const text = ctx.state.doc.toString();
      const tbs = relevantTables(text, tables);
      const key = Object.keys(COLUMN_VALUES).find((k) => k.endsWith(`.${col}`) && tbs.includes(k.split('.')[0])) || Object.keys(COLUMN_VALUES).find((k) => k.endsWith(`.${col}`));
      if (!key) return null;
      const from = m[3] != null ? ctx.pos - m[3].length : ctx.pos;
      const numeric = (v) => v === 'NULL' || /^\d+$/.test(v);
      const vals = COLUMN_VALUES[key].filter((v) => v !== 'NULL');
      return { from, options: vals.map((v) => ({ label: numeric(v) ? v : `'${v}'`, type: 'constant', detail: key, boost: 5 })), validFor: /^'?[\w ]*'?$/ };
    };
    extra = [dialect.language.data.of({ autocomplete: valuesSource }), dialect.language.data.of({ autocomplete: columnsSource })];
  } else {
    language = langPy.python();
    const frames = (tables && tables.length ? tables : Object.keys(SCHEMA)).map((tb) => ({ label: tb, type: 'variable', detail: 'DataFrame', info: TABLE_DOCS[tb] }));
    const attrs = PY_ATTRS.map(([label, detail, info]) => ({ label, type: 'method', detail, info }));
    const pySource = (ctx) => {
      const w = ctx.matchBefore(/\.?\w*/);
      if (!w || (w.from === w.to && !ctx.explicit)) return null;
      if (w.text.startsWith('.')) return { from: w.from + 1, options: attrs, validFor: /^\w*$/ };
      return { from: w.from, options: [...frames, { label: 'pd', type: 'namespace', detail: 'pandas' }, { label: 'np', type: 'namespace', detail: 'numpy' }, { label: 'result', type: 'variable', detail: 'ответ задачи' }], validFor: /^\w*$/ };
    };
    extra = [language.language.data.of({ autocomplete: pySource })];
  }

  const runKeys = S.Prec.highest(V.keymap.of([
    { key: 'Mod-Enter', run: () => { (cbs.current.onCheck || cbs.current.onRun)?.(); return true; } },
    { key: 'Shift-Mod-Enter', run: () => { cbs.current.onRun?.(); return true; } },
    { key: 'Shift-Alt-f', run: () => { cbs.current.format?.(); return true; } },
  ]));

  return [
    runKeys,
    V.lineNumbers(), V.highlightActiveLineGutter(), V.highlightSpecialChars(), C.history(), L.foldGutter(),
    V.drawSelection(), V.dropCursor(), S.EditorState.allowMultipleSelections.of(true), L.indentOnInput(),
    L.syntaxHighlighting(style), L.bracketMatching(), A.closeBrackets(),
    A.autocompletion({ activateOnTyping: true, icons: true, maxRenderedOptions: 60 }),
    V.rectangularSelection(), V.crosshairCursor(), V.highlightActiveLine(), Q.highlightSelectionMatches(),
    S.EditorState.tabSize.of(lang === 'python' ? 4 : 2), L.indentUnit.of(lang === 'python' ? '    ' : '  '),
    V.keymap.of([...A.closeBracketsKeymap, ...C.defaultKeymap, ...Q.searchKeymap, ...C.historyKeymap, ...L.foldKeymap, ...A.completionKeymap, ...Li.lintKeymap, C.indentWithTab]),
    Li.lintGutter(),
    language, ...extra,
    matchMedia('(max-width: 640px)').matches ? V.EditorView.lineWrapping : [],
    V.EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': lang === 'sql' ? 'Редактор SQL' : 'Редактор Python' }),
    V.EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        onDoc(u.state.doc.toString());
        if (diagFlag.on) { diagFlag.on = false; setTimeout(() => u.view.dispatch(Li.setDiagnostics(u.view.state, [])), 0); }
      }
      if (u.docChanged || u.selectionSet) {
        const r = u.state.selection.main, line = u.state.doc.lineAt(r.head);
        onPos({ line: line.number, col: r.head - line.from + 1, sel: Math.abs(r.to - r.from) });
      }
    }),
  ];
}

export function CodeEditor({ value, onChange, onRun, onCheck, lang = 'sql', tables, api, name }) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const cmRef = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const cbs = useRef({});
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState({ line: 1, col: 1, sel: 0 });
  const [note, setNote] = useState('');
  const diagFlag = useRef({ on: false }).current;
  // Изменение пришло снаружи (через value) — его не нужно отправлять обратно в onChange,
  // иначе редактор и родитель начинают перекидывать друг другу разные версии текста.
  const syncing = useRef(false);
  const noteTimer = useRef(null);
  const flash = (m) => { setNote(m); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(''), 4000); };

  const format = async () => {
    const view = viewRef.current;
    if (!view || lang !== 'sql') return;
    try {
      const { format: fmt } = await import('sql-formatter');
      const src = view.state.doc.toString();
      const out = fmt(src, { language: 'duckdb', keywordCase: 'upper', functionCase: 'upper', tabWidth: 2, linesBetweenQueries: 1 });
      if (out !== src) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
      flash('Отформатировано');
    } catch (e) {
      flash('Не получилось отформатировать — сначала исправь синтаксис');
    }
  };
  cbs.current = { onChange, onRun, onCheck, format };

  useEffect(() => {
    let dead = false;
    loadCm().then((cm) => {
      if (dead || !host.current) return;
      cmRef.current = cm;
      const view = new cm.view.EditorView({
        parent: host.current,
        state: cm.state.EditorState.create({
          doc: valueRef.current || '',
          extensions: buildExtensions(cm, {
            lang, tables, cbs, diagFlag,
            onDoc: (v) => { if (!syncing.current) cbs.current.onChange?.(v); },
            onPos: setPos,
          }),
        }),
      });
      viewRef.current = view;
      setReady(true);
    }).catch((e) => { console.warn('Редактор кода не загрузился, работает простое поле:', e); });
    return () => { dead = true; if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null; } setReady(false); };
  }, [lang, (tables || []).join(',')]);

  // Значение поменяли снаружи (кнопка «Сбросить», переключение задачи). Layout-эффект выполняется сразу
  // после отрисовки — до того, как пользователь успеет набрать следующий символ.
  useLayoutEffect(() => {
    const v = viewRef.current;
    if (!v || (value || '') === v.state.doc.toString()) return;
    syncing.current = true;
    try { v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value || '' } }); } finally { syncing.current = false; }
  }, [value, ready]);

  if (api) {
    api.current = {
      // Текущий текст — прямо из редактора, даже если родитель ещё не перерисовался.
      value() { return viewRef.current ? viewRef.current.state.doc.toString() : valueRef.current; },
      // Выделенный фрагмент (для «Выполнить») — или null, если ничего не выделено.
      selection() {
        const v = viewRef.current;
        if (!v) return null;
        const r = v.state.selection.main;
        if (r.empty) return null;
        const text = v.state.sliceDoc(r.from, r.to);
        return text.trim() ? { text, from: r.from } : null;
      },
      // Подчёркивает ошибку и возвращает её строку и столбец в редакторе.
      showError(from, len, message) {
        const v = viewRef.current, cm = cmRef.current;
        if (!v || !cm) return null;
        const max = v.state.doc.length;
        const a = Math.max(0, Math.min(from, max)), b = Math.max(a, Math.min(a + Math.max(1, len || 1), max));
        diagFlag.on = true;
        v.dispatch(cm.lint.setDiagnostics(v.state, [{ from: a, to: b === a && a < max ? a + 1 : b, severity: 'error', message }]));
        const line = v.state.doc.lineAt(a);
        return { line: line.number, col: a - line.from + 1 };
      },
      showErrorLine(n, message) {
        const v = viewRef.current;
        if (!v || n < 1 || n > v.state.doc.lines) return null;
        const line = v.state.doc.line(n);
        const indent = line.text.match(/^\s*/)[0].length;
        return this.showError(line.from + indent, Math.max(1, line.length - indent), message);
      },
      focusLine(n) {
        const v = viewRef.current;
        if (v && n >= 1 && n <= v.state.doc.lines) this.focus(v.state.doc.line(n).from);
      },
      focus(offset) {
        const v = viewRef.current;
        if (!v) return;
        if (offset != null) v.dispatch({ selection: { anchor: Math.min(offset, v.state.doc.length) }, scrollIntoView: true });
        v.focus();
      },
      format,
    };
  }

  const fallbackKeys = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey && onRun) onRun(); else (onCheck || onRun)(); }
  };
  const rows = Math.max(7, Math.min(24, String(value || '').split('\n').length + 1));
  const file = name || (lang === 'sql' ? 'query.sql' : 'solution.py');
  return html`<div class=${cls('ide', ready && 'ready')}>
    <div class="ide-bar">
      <span class="ide-tab"><span class=${cls('ide-dot', lang)} />${file}</span>
      <span class="ide-sp" />
      ${lang === 'sql' && html`<button class="ide-btn" title="Форматировать (Shift+Alt+F)" onClick=${format} disabled=${!ready}>Формат</button>`}
      <button class="ide-btn" title="Отменить (Ctrl+Z)" onClick=${() => { const v = viewRef.current; if (v && cmRef.current) { cmRef.current.commands.undo(v); v.focus(); } }} disabled=${!ready}>↶</button>
      <button class="ide-btn" title="Повторить (Ctrl+Shift+Z)" onClick=${() => { const v = viewRef.current; if (v && cmRef.current) { cmRef.current.commands.redo(v); v.focus(); } }} disabled=${!ready}>↷</button>
    </div>
    ${!ready && html`<textarea class="code-editor ide-fallback" spellcheck="false" autocapitalize="off" autocomplete="off"
      rows=${rows} value=${value} onInput=${(e) => onChange(e.target.value)} onKeyDown=${fallbackKeys} />`}
    <div ref=${host} class="ide-host" />
    <div class="ide-status">
      <span>Стр ${pos.line}, стб ${pos.col}${pos.sel ? ` · выделено ${pos.sel}` : ''}</span>
      ${note ? html`<span class="ide-note">${note}</span>` : html`<span class="ide-keys">${onCheck && onCheck !== onRun ? `Ctrl+Enter — проверить · Ctrl+Shift+Enter — выполнить${pos.sel && lang === 'sql' ? ' выделенное' : ''}` : `Ctrl+Enter — выполнить${pos.sel && lang === 'sql' ? ' выделенное' : ''}`} · Ctrl+Space — подсказки</span>`}
      <span class="ide-sp" />
      <span>${lang === 'sql' ? 'DuckDB SQL' : 'Python 3 · pandas'}</span>
    </div>
  </div>`;
}

// Кусочки текста в обратных кавычках — как код, **…** — жирным.
function Rich({ text }) {
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p) => (p.startsWith('`') ? html`<code>${p.slice(1, -1)}</code>` : p.startsWith('**') ? html`<b>${p.slice(2, -2)}</b>` : p));
}

// Ошибка SQL: понятный заголовок, подсказка, ссылка на место в коде и исходное сообщение DuckDB.
// sql — текст, который выполнялся; base — его смещение в редакторе (при выполнении выделенного).
export function SqlError({ msg, sql = '', base = 0, api }) {
  const e = useMemo(() => explainSqlError(msg, sql), [msg, sql]);
  const [loc, setLoc] = useState(null);
  useEffect(() => {
    setLoc(null);
    if (e.offset == null || !api || !api.current) return;
    const r = api.current.showError(base + e.offset, e.len, e.title);
    if (r) setLoc(r);
  }, [e, base]);
  const where = loc || (e.line ? { line: e.line, col: e.col } : null);
  return html`<div class="verdict bad sql-err">
    <div class="err-title">${e.title}</div>
    ${where && html`<button class="err-loc" onClick=${() => api && api.current && api.current.focus(base + e.offset)}>строка ${where.line}, столбец ${where.col} — показать</button>`}
    ${e.hint && html`<div class="err-hint"><${Rich} text=${e.hint} /></div>`}
    ${e.raw && html`<details class="err-raw"><summary>Сообщение DuckDB</summary><pre class="err">${e.raw}</pre></details>`}
  </div>`;
}

// Предупреждения о строковых значениях, которых нет в данных (регистр, опечатка).
export function SqlWarnings({ sql }) {
  const list = useMemo(() => literalWarnings(sql), [sql]);
  if (!list.length) return null;
  return html`<div class="verdict mid sql-warn">${list.map((w) => html`<div><${Rich} text=${w} /></div>`)}</div>`;
}

// Ошибка Python: трейсбэк, подсказка по типу исключения и подсветка строки в редакторе.
export function PyError({ err, api }) {
  const e = useMemo(() => explainPyError(err), [err]);
  useEffect(() => {
    if (e.line && api && api.current) api.current.showErrorLine(e.line, String(err).split('\n').filter(Boolean).pop());
  }, [e]);
  return html`<div class="py-err">
    ${e.line && html`<button class="err-loc" onClick=${() => api && api.current && api.current.focusLine(e.line)}>строка ${e.line} — показать</button>`}
    ${e.hint && html`<div class="err-hint"><${Rich} text=${e.hint} /></div>`}
    <pre class="err">${err}</pre>
  </div>`;
}
