// Понятные сообщения об ошибках DuckDB: заголовок и подсказка по-русски плюс место ошибки в тексте запроса.
// Исходное сообщение движка сохраняется (raw) — оно тоже полезно, его показывают свёрнутым.
import { SCHEMA, COLUMN_VALUES } from '../data/generate.js';

const KIND = {
  Parser: 'синтаксис', Binder: 'имена и типы', Catalog: 'нет такого объекта', Conversion: 'преобразование типов',
  'Out of Range': 'выход за диапазон', 'Invalid Input': 'неверные входные данные', 'Not implemented': 'не поддерживается',
};
const TYPE_RU = {
  DOUBLE: 'число', FLOAT: 'число', DECIMAL: 'число', INTEGER: 'целое число', INT32: 'целое число', INT64: 'целое число', BIGINT: 'целое число',
  DATE: 'дату', TIMESTAMP: 'дату и время', BOOLEAN: 'логическое значение', VARCHAR: 'строку',
};
const typeRu = (t) => TYPE_RU[String(t).toUpperCase()] || t;
const ORDER = 'SELECT → FROM → JOIN → WHERE → GROUP BY → HAVING → QUALIFY → ORDER BY → LIMIT';

// Строки и комментарии заменяются пробелами той же длины — позиции символов сохраняются.
function blank(sql) {
  return sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}
const quoted = (s) => [...String(s).matchAll(/"([^"]+)"/g)].map((m) => m[1]);

function lineCol(sql, offset) {
  const before = sql.slice(0, offset).split('\n');
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

// DuckDB печатает строку запроса и «^» под местом ошибки. Длинная строка обрезается «...» с краёв.
function caretOffset(msg, sql) {
  const m = msg.match(/LINE (\d+): (.*)\n( *)\^/);
  if (!m) return null;
  const lines = sql.split('\n');
  const text = lines[Number(m[1]) - 1];
  if (text == null) return null;
  let snippet = m[2], lead = 0;
  if (snippet.startsWith('...')) { snippet = snippet.slice(3); lead = 3; }
  if (snippet.endsWith('...')) snippet = snippet.slice(0, -3);
  const caret = m[3].length - `LINE ${m[1]}: `.length;
  let base = text.indexOf(snippet);
  if (base < 0) base = text.indexOf(snippet.trim());
  if (base < 0) base = 0;
  const col = Math.max(0, Math.min(text.length, base + caret - lead));
  let off = 0;
  for (let i = 0; i < Number(m[1]) - 1; i++) off += lines[i].length + 1;
  return off + col;
}

function wordLen(sql, offset) {
  const m = sql.slice(offset).match(/^("[^"\n]*"|'[^'\n]*'|[\w.]+|\S)/);
  return m ? m[0].length : 1;
}

function findWord(sql, word, { unqualified = false } = {}) {
  const b = blank(sql);
  const re = new RegExp(`${unqualified ? '(?<![\\w.])' : '\\b'}${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const m = re.exec(b);
  return m ? m.index : null;
}

function parens(sql) {
  const b = blank(sql);
  const open = (b.match(/\(/g) || []).length, close = (b.match(/\)/g) || []).length;
  if (open === close) return '';
  return `Скобок открыто ${open}, а закрыто ${close}.`;
}

const tablesInQuery = (sql) => [...blank(sql).matchAll(/\b(?:from|join)\s+([a-z_][\w]*)/gi)].map((m) => m[1].toLowerCase());

// Значение колонки, совпадающее со словом без учёта регистра: { col: 'users.platform', value: 'ios' }.
function valueColumn(word) {
  const w = String(word).toLowerCase();
  for (const [k, vals] of Object.entries(COLUMN_VALUES)) {
    const v = vals.find((x) => x !== 'NULL' && x.toLowerCase() === w);
    if (v) return { col: k, value: v };
  }
  return null;
}
const caseNote = (word, vc) => (vc && vc.value !== word ? ` В данных значение записано как \`'${vc.value}'\` — регистр важен.` : '');

const RULES = [
  [/Referenced column "(.+?)" not found in FROM clause!(?:\nCandidate bindings: (.+))?/, (m, c) => {
    const col = m[1];
    const cands = quoted(m[2] || '').map((x) => x.split('.').pop());
    const vc = valueColumn(col);
    const lit = vc ? vc.value : col;
    if (c.sql.includes(`"${col}"`)) {
      return { title: `Колонки «${col}» нет — это строка в двойных кавычках?`, hint: `В SQL строки пишутся в **одинарных** кавычках: \`'${lit}'\`. Двойные кавычки — это имя колонки, поэтому DuckDB ищет колонку \`${col}\`.${caseNote(col, vc)}` };
    }
    if (vc) return { title: `Колонки «${col}» нет — это значение без кавычек?`, hint: `Похоже на значение колонки \`${vc.col}\`. Строковые значения берут в одинарные кавычки: \`'${lit}'\`.${caseNote(col, vc)}` };
    const used = tablesInQuery(c.sql);
    const other = Object.entries(SCHEMA).find(([t, cols]) => !used.includes(t) && cols.some(([n]) => n === col.toLowerCase()));
    const parts = [];
    if (other) parts.push(`Колонка \`${col}\` есть в таблице \`${other[0]}\` — её нужно подключить через JOIN.`);
    if (cands.length) parts.push(`Похожие колонки в запросе: ${cands.map((x) => `\`${x}\``).join(', ')}.`);
    if (!parts.length) parts.push('Проверь написание и то, что нужная таблица есть в FROM или JOIN. Псевдоним из SELECT нельзя использовать внутри того же SELECT.');
    return { title: `Колонки «${col}» нет в таблицах запроса`, hint: parts.join(' ') };
  }],
  [/Table "(.+?)" does not have a column named "(.+?)"(?:\nCandidate bindings: (.+))?/, (m) => {
    const cands = quoted(m[3] || '').map((x) => x.split('.').pop());
    return { title: `В таблице «${m[1]}» нет колонки «${m[2]}»`, hint: cands.length ? `Похожие: ${cands.map((x) => `\`${x}\``).join(', ')}.` : 'Проверь написание колонки и псевдоним таблицы.' };
  }],
  [/Table with name (\S+?) does not exist!(?:\nDid you mean "(.+?)"\?)?/, (m) => ({
    title: `Таблицы «${m[1]}» нет`,
    hint: `${m[2] ? `Может, \`${m[2]}\`? ` : ''}Доступные таблицы: ${Object.keys(SCHEMA).map((t) => `\`${t}\``).join(', ')}. Имя CTE тоже должно совпадать буква в букву.`,
  })],
  [/Referenced table "(.+?)" not found!(?:\nCandidate tables: (.+))?/, (m) => {
    const cands = quoted(m[2] || '');
    return { title: `Нет таблицы или псевдонима «${m[1]}»`, hint: `Префикс перед точкой должен совпадать с именем таблицы или её псевдонимом из FROM/JOIN.${cands.length ? ` Доступны: ${cands.map((x) => `\`${x}\``).join(', ')}.` : ''}` };
  }],
  [/Ambiguous reference to column name "(.+?)"(?: \(use: (.+?)\))?/, (m) => {
    const opts = quoted(m[2] || '');
    return { title: `Колонка «${m[1]}» есть в нескольких таблицах`, hint: `Укажи, из какой таблицы её брать${opts.length ? `: ${opts.map((x) => `\`${x}\``).join(' или ')}` : ' — через псевдоним, например `o.user_id`'}. После JOIN ... USING (col) можно писать просто \`col\`.` };
  }, (m, sql) => findWord(sql, m[1], { unqualified: true })],
  [/column "(.+?)" must appear in the GROUP BY clause/, (m) => ({
    title: `«${m[1]}» не в GROUP BY и не внутри агрегата`,
    hint: `Когда в запросе есть агрегаты (COUNT, SUM, AVG…), каждая колонка в SELECT должна быть либо ключом группировки, либо внутри агрегата. Добавь \`${m[1]}\` в GROUP BY или оберни в агрегат — \`MAX(${m[1]})\`, \`ANY_VALUE(${m[1]})\`.`,
  })],
  [/WHERE clause cannot contain aggregates/, () => ({
    title: 'Агрегат в WHERE',
    hint: 'WHERE фильтрует строки **до** группировки — средних и сумм там ещё нет. Условие на агрегат переносят в `HAVING` после `GROUP BY`.',
  })],
  [/(WHERE|GROUP BY|HAVING) clause cannot contain window functions|window functions are not allowed in (\w+)/i, (m) => ({
    title: `Оконная функция в ${m[1] || m[2] || 'WHERE'}`,
    hint: 'Оконные функции считаются после WHERE, GROUP BY и HAVING. Отфильтровать по ним можно через `QUALIFY` или вынеся расчёт в CTE и фильтруя снаружи.',
  })],
  [/aggregate function calls cannot be nested/i, () => ({
    title: 'Агрегат внутри агрегата',
    hint: 'Например, `AVG(COUNT(*))` так не считается. Сначала посчитай внутренний агрегат в CTE с GROUP BY, потом примени внешний к его результату.',
  })],
  [/GROUP BY clause cannot contain aggregates/i, () => ({ title: 'Агрегат в GROUP BY', hint: 'Группируют по колонкам или выражениям над строками. Если нужен «бакет» по сумме — посчитай её в CTE, а группируй уже снаружи.' })],
  [/syntax error at end of input/, (m, c) => ({
    title: 'Запрос оборвался на середине',
    hint: [parens(c.sql), 'Похоже, не дописано выражение, не закрыта скобка или запрос заканчивается на запятую или ключевое слово.'].filter(Boolean).join(' '),
  }), (m, sql) => sql.trimEnd().length - 1],
  [/syntax error at or near "(.+?)"/, (m, c) => {
    const tok = m[1];
    const before = c.pos != null ? blank(c.sql).slice(0, c.pos).trimEnd() : '';
    const T = tok.toUpperCase();
    let hint;
    if (/,$/.test(before) && /^(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|QUALIFY|\)|UNION|JOIN|LEFT|INNER|ON)$/.test(T)) hint = `Лишняя запятая перед \`${tok}\`.`;
    else if (T === 'WHERE' && /\b(group\s+by|order\s+by|having)\b[^()]*$/i.test(before)) hint = `WHERE стоит не на своём месте. Порядок частей запроса: ${ORDER}. Условие на группы пишут в HAVING.`;
    else if (/^(FROM|WHERE|GROUP|ORDER)$/.test(T) && /\bselect\s*$/i.test(before)) hint = 'После SELECT не перечислены колонки.';
    else if (tok === '(' && /[\w"]\s+[a-z_]\w*$/i.test(before)) hint = 'Похоже, пропущена запятая между колонками — перед функцией.';
    else if (/^[a-z_]\w*$/i.test(tok) && /[\w)"']$/.test(before) && !/\b(as|select|from|join|by|on|and|or|where|when|then|else|case|not|is|in|distinct|over|partition)$/i.test(before)) hint = 'Похоже, пропущена запятая или оператор между двумя выражениями.';
    else if (tok === '"') hint = 'Строки пишут в одинарных кавычках, двойные — только для имён колонок.';
    const extra = parens(c.sql);
    return {
      title: `Синтаксическая ошибка рядом с «${tok}»`,
      hint: [hint || `Проверь запятые между колонками, скобки и порядок частей запроса: ${ORDER}.`, extra].filter(Boolean).join(' '),
    };
  }],
  [/No function matches the given name and argument types '(\w+)\((.*?)\)'/, (m, c) => {
    const cands = [...c.msg.matchAll(/^\t(\w+\(.*?\))(?: -> .+)?$/gm)].map((x) => x[1]);
    return {
      title: `Функция «${m[1]}» не принимает такие аргументы`,
      hint: `Передано: \`(${m[2]})\`.${cands.length ? ` Варианты вызова: ${cands.slice(0, 4).map((x) => `\`${x}\``).join(', ')}.` : ''} Возможно, не хватает аргумента или нужно привести тип — \`CAST(x AS DATE)\` или \`x::DATE\`.`,
    };
  }],
  [/(?:Scalar |Aggregate |Table )?Function with name (\w+) does not exist!(?:\nDid you mean "(.+?)"\?)?/, (m) => ({
    title: `Функции «${m[1]}» нет в DuckDB`,
    hint: `${m[2] ? `Может, \`${m[2]}\`? ` : ''}Имена функций в разных СУБД отличаются. Начни вводить имя в редакторе — подсказка покажет функции DuckDB с описанием.`,
  })],
  [/Could not convert string '(.*?)' to (\w+)/, (m) => ({
    title: `Строку '${m[1]}' нельзя превратить в ${typeRu(m[2])}`,
    hint: 'Обычно это сравнение колонки со значением не того типа. Числа пишут без кавычек, даты — в виде `\'2024-06-01\'`, а текстовые колонки сравнивают со строками.',
  })],
  [/(?:timestamp|date) field value out of range: "(.*?)"/, (m) => ({
    title: `'${m[1]}' — не дата`,
    hint: 'Дату пишут как `\'2024-06-01\'`, дату со временем — `\'2024-06-01 18:30:00\'`. Месяц и день — с ведущим нулём.',
  })],
  [/Cannot compare values of type (\S+) and(?: type)? (\S+)/, (m) => ({
    title: `Нельзя сравнить ${m[1]} и ${m[2]}`,
    hint: 'Приведи одну сторону к типу другой — `CAST(x AS DATE)` или `x::DATE`.',
  })],
  [/Cannot mix values of type (\S+) and (\S+)/, (m) => ({
    title: `Нельзя смешивать ${m[1]} и ${m[2]}`,
    hint: 'Все ветки CASE (или аргументы COALESCE) должны возвращать один тип. Приведи их явно, например `CAST(x AS VARCHAR)`.',
  })],
  [/Set operations can only apply to expressions with the same number of result columns/, () => ({
    title: 'В частях UNION разное число колонок',
    hint: 'Каждый SELECT в UNION / UNION ALL / EXCEPT должен возвращать одинаковое число колонок совместимых типов. Недостающую можно добить `NULL AS col`.',
  }), (m, sql) => findWord(sql, 'union') ?? findWord(sql, 'except') ?? findWord(sql, 'intersect')],
  [/(ORDER|GROUP) (?:BY )?term out of range - should be between (\d+) and (\d+)/, (m) => ({
    title: `Номер колонки в ${m[1]} BY вне диапазона`,
    hint: `Число в ${m[1]} BY — это номер колонки из SELECT, от ${m[2]} до ${m[3]}.`,
  })],
  [/SELECT clause without selection list/, () => ({ title: 'После SELECT ничего нет', hint: 'Перечисли колонки через запятую или напиши `*`.' })],
  [/Duplicate alias "(.+?)"/, (m) => ({ title: `Псевдоним «${m[1]}» используется дважды`, hint: 'У каждой таблицы и CTE в запросе должно быть своё имя.' })],
  [/Type with name (\w+) does not exist/, (m) => ({ title: `Типа «${m[1]}» нет`, hint: 'Частые типы DuckDB — `INTEGER`, `BIGINT`, `DOUBLE`, `VARCHAR`, `DATE`, `TIMESTAMP`, `BOOLEAN`.' })],
  [/Overflow/i, () => ({ title: 'Переполнение числа', hint: 'Результат не помещается в тип. Приведи к более широкому — `x::BIGINT` или `x::DOUBLE`.' })],
  [/Could not parse string "(.+?)" according to format specifier "(.+?)"/, (m) => ({ title: `Строка «${m[1]}» не подходит под формат ${m[2]}`, hint: 'Проверь формат в strptime — `%Y` год, `%m` месяц, `%d` день, `%H:%M:%S` время.' })],
];

// Возвращает { title, hint, raw, offset, len, line, col }. offset — позиция в sql (или null).
export function explainSqlError(msg, sql = '') {
  msg = String(msg || '');
  const head = msg.match(/^([A-Z][\w ]*?) Error: /);
  if (!head) return { title: msg, hint: '', raw: '', offset: null };
  const kind = head[1];
  let offset = caretOffset(msg, sql);
  let res = null;
  for (const [re, fn, locate] of RULES) {
    const m = msg.match(re);
    if (!m) continue;
    if (offset == null && locate) offset = locate(m, sql);
    res = fn(m, { sql, msg, pos: offset });
    break;
  }
  if (!res) res = { title: `Ошибка: ${KIND[kind] || kind}`, hint: '' };
  const out = { ...res, raw: msg, offset: null };
  if (offset != null && offset >= 0) {
    out.offset = Math.min(offset, Math.max(0, sql.length - 1));
    out.len = wordLen(sql, out.offset);
    Object.assign(out, lineCol(sql, out.offset));
  }
  return out;
}

// Запрос выполнился, но строковое значение не совпадает с данными: `platform = 'iOS'` вернёт 0 строк.
// Ищет сравнения колонок с известным набором значений и возвращает список предупреждений.
export function literalWarnings(sql = '') {
  const out = [];
  const seen = new Set();
  const noComments = String(sql).replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  const re = /(?:\w+\.)?(\w+)\s*(?:=|<>|!=|\bin\s*\(|\blike\s)\s*((?:'[^']*'\s*,?\s*)+)/gi;
  const used = tablesInQuery(noComments);
  for (const m of noComments.matchAll(re)) {
    const col = m[1].toLowerCase();
    // Колонка с таким именем может быть в нескольких таблицах запроса (status в orders и payments) —
    // тогда допустимы значения любой из них.
    const all = Object.keys(COLUMN_VALUES).filter((k) => k.endsWith(`.${col}`));
    const keys = all.filter((k) => used.includes(k.split('.')[0]));
    if (!all.length) continue;
    const vals = [...new Set((keys.length ? keys : all).flatMap((k) => COLUMN_VALUES[k]))].filter((v) => v !== 'NULL');
    if (vals.every((v) => /^\d+$/.test(v))) continue;
    for (const lm of m[2].matchAll(/'([^']*)'/g)) {
      const lit = lm[1];
      if (vals.includes(lit) || /[%_]/.test(lit) || seen.has(`${col}=${lit}`)) continue;
      seen.add(`${col}=${lit}`);
      const ci = vals.find((v) => v.toLowerCase() === lit.toLowerCase());
      out.push(ci
        ? `В колонке \`${col}\` значение записано как \`'${ci}'\`, а не \`'${lit}'\` — сравнение строк учитывает регистр.`
        : `Значения \`'${lit}'\` нет в колонке \`${col}\`. Возможные значения: ${vals.map((v) => `\`'${v}'\``).join(', ')}.`);
    }
  }
  return out;
}

// Python: строка ошибки из трейсбэка и короткое объяснение по типу исключения.
const PY_HINTS = [
  [/NameError: name '(\w+)' is not defined/, (m) => `Переменная или функция \`${m[1]}\` не определена — опечатка, не импортирован модуль (\`import pandas as pd\`) или переменная создаётся ниже.`],
  [/KeyError: '?(.+?)'?$/m, (m) => `Ключа \`${m[1]}\` нет. Если это колонка DataFrame — проверь \`df.columns\`, регистр и пробелы в названии.`],
  [/AttributeError: '(\w+)' object has no attribute '(\w+)'/, (m) => `У объекта типа \`${m[1]}\` нет атрибута \`${m[2]}\`. Если это колонка — обратись через \`df['${m[2]}']\`.`],
  [/IndentationError/, () => 'Ошибка отступов: внутри блока строки должны иметь одинаковый отступ (4 пробела), а после двоеточия — отступ больше.'],
  [/SyntaxError/, () => 'Синтаксическая ошибка: проверь скобки и кавычки, двоеточие после `if`/`for`/`def`, запятые в списках.'],
  [/ModuleNotFoundError: No module named '(\w+)'/, (m) => `Модуль \`${m[1]}\` недоступен в браузерном Python. Доступны pandas, numpy, scipy, scikit-learn.`],
  [/ZeroDivisionError/, () => 'Деление на ноль — проверь знаменатель.'],
  [/TypeError: (.+)/, () => 'Функции передан аргумент не того типа или не то число аргументов. Проверь, что складываешь числа с числами и строки со строками.'],
  [/ValueError: (.+)/, () => 'Значение подходящего типа, но недопустимое — например, разная длина массивов или неверный формат строки.'],
];

export function explainPyError(err) {
  const s = String(err || '');
  const lines = [...s.matchAll(/File "<твой код>", line (\d+)/g)];
  const line = lines.length ? Number(lines[lines.length - 1][1]) : null;
  let hint = '';
  for (const [re, fn] of PY_HINTS) { const m = s.match(re); if (m) { hint = fn(m); break; } }
  return { line, hint };
}
