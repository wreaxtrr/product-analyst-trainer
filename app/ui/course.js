import { html, cls, useState, useEffect, plural } from '../lib.js';
import yaml from 'js-yaml';
import { course, nodeStats, allNodesOrdered, estimateMinutes, fmtDuration, taskKey } from '../content.js';
import { useStore, toggleProject, setProfile, today } from '../store.js';
import { Bar, Md } from './common.js';
import { SKILLS } from './pages.js';
import { Dashboards } from './dashboards.js';
import { getCsv, SCHEMA, TABLE_DOCS } from '../data/generate.js';
import { navigate } from '../router.js';

const TABS = [['program', 'Программа'], ['project', 'Итоговый проект'], ['dashboards', 'Дашборды'], ['cheats', 'Шпаргалки'], ['cert', 'Сертификат']];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export function CoursePage({ tab = 'program' }) {
  const t = TABS.some(([k]) => k === tab) ? tab : 'program';
  useEffect(() => { window.scrollTo(0, 0); }, [t]);
  return html`<main class="page">
    <div class="tabs no-print" role="tablist" style="margin-top:0">
      ${TABS.map(([k, title]) => html`<button role="tab" class=${cls('tab', t === k && 'active')} onClick=${() => navigate(`/course/${k}`)}>${title}</button>`)}
    </div>
    ${t === 'program' && html`<${Program} />`}
    ${t === 'project' && html`<${Project} />`}
    ${t === 'dashboards' && html`<${Dashboards} />`}
    ${t === 'cheats' && html`<${Cheats} />`}
    ${t === 'cert' && html`<${Certificate} />`}
  </main>`;
}

// ═════════════ Программа ═════════════
function actNodes(act) { return [...act.tracks.flatMap((tr) => tr.nodes), act.trial].map((id) => course.nodes[id]); }

function Program() {
  const s = useStore();
  const nodes = allNodesOrdered();
  const core = nodes.filter((n) => !n.side);
  const minutes = (list) => list.reduce((a, n) => a + estimateMinutes(n), 0);
  const coreMin = minutes(core), allMin = minutes(nodes);
  const tasks = nodes.reduce((a, n) => a + n.tasks.length, 0);
  const code = nodes.reduce((a, n) => a + n.tasks.filter((t) => t.type === 'sql' || t.type === 'python').length, 0);
  const cases = nodes.reduce((a, n) => a + n.tasks.filter((t) => t.type === 'case').length, 0);
  const [pace, setPace] = useState(6);
  const weeks = Math.ceil(coreMin / 60 / pace);
  return html`
    <div class="eyebrow">Продуктовый аналитик · Junior → Middle</div>
    <h1>Программа курса</h1>
    <p class="lead" style="max-width:760px">Пять актов: от SQL по логам до A/B-тестов, ML и разбора продуктовых кейсов. Всё на данных одного вымышленного сервиса доставки продуктов «Корзинка» — с реальными инцидентами, экспериментами и грязными данными, как на работе.</p>
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${nodes.length}</div><div class="stat-l">уроков и испытаний</div></div>
      <div class="stat"><div class="stat-v">${tasks}</div><div class="stat-l">задач, из них ${code} с кодом и ${cases} ${plural(cases, 'кейс', 'кейса', 'кейсов')}</div></div>
      <div class="stat"><div class="stat-v">≈ ${Math.round(coreMin / 60)} ч</div><div class="stat-l">основная программа · ещё ${Math.round((allMin - coreMin) / 60)} ч в боковых ветках</div></div>
      <div class="stat"><div class="stat-v">${course.scenarios.length}</div><div class="stat-l">сценариев выбора метрик</div></div>
    </div>

    <div class="syllabus-act">
      <h2>Темп</h2>
      <p class="muted" style="margin:0 0 8px">Сколько часов в неделю готов уделять?</p>
      <div class="seg">${[3, 6, 10, 15].map((h) => html`<button class=${cls(pace === h && 'active')} onClick=${() => setPace(h)}>${h} ч</button>`)}</div>
      <p style="margin:6px 0 0">Основная программа займёт около <b>${weeks} ${plural(weeks, 'недели', 'недель', 'недель')}</b>${weeks > 4 ? html` (≈ ${Math.round(weeks / 4.3)} мес.)` : ''}. Плюс 15 минут в день на тренировку и повторение — без них к концу курса забудется начало.</p>
    </div>

    <div class="syllabus-act">
      <h2>Как устроено обучение</h2>
      <div class="syllabus-grid">
        <ol style="margin:0;padding-left:20px">
          <li><b>Теория</b> — коротко, с примерами на данных и интерактивными виджетами.</li>
          <li><b>Задачи</b> — SQL и Python выполняются прямо в браузере на тех же таблицах.</li>
          <li><b>Повторение</b> — ошибки возвращаются через 1, 3, 7 и 14 дней.</li>
          <li><b>Испытание</b> в конце акта — смешанные задачи и кейсы без подсказок.</li>
          <li><b>Итоговый проект</b> — полный аналитический разбор для портфолио.</li>
        </ol>
        <div>
          <b>Неделя по плану</b>
          <ul style="margin:4px 0 0;padding-left:20px">
            <li>2–3 урока: теория → задачи → заметка своими словами</li>
            <li>каждый день 10–15 минут тренировки дня</li>
            <li>раз в неделю — сценарий в тренажёре метрик или SQL-марафон</li>
            <li>после акта — пробный экзамен по пройденному</li>
          </ul>
        </div>
      </div>
    </div>

    ${course.acts.map((act, k) => {
      const list = actNodes(act);
      const done = list.filter((n) => nodeStats(n, s).done).length;
      const mins = minutes(list.filter((n) => !n.side));
      return html`<section class="syllabus-act">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div><div class="eyebrow">Акт ${ROMAN[k]} · ≈ ${fmtDuration(mins)}</div><h2>${act.title.replace(/^Акт [IVX]+ — /, '')}</h2><p class="muted" style="margin:0">${act.summary}</p></div>
          <span class="badge">${done}/${list.length}</span>
        </div>
        <div class="syllabus-grid">
          <div><b>После акта ты умеешь</b>
            <ul class="check-list">${(act.outcomes || []).map((o) => html`<li>✓ ${o}</li>`)}</ul>
          </div>
          <div>
            ${act.tracks.map((tr) => html`<div style="margin-bottom:8px"><div class="small" style=${{ color: course.branches[tr.branch].color, fontWeight: 650 }}>${course.branches[tr.branch].title}${tr.side ? ' · боковая ветка' : ''}</div>
              <ul class="syllabus-lessons">${tr.nodes.map((id) => { const n = course.nodes[id]; const st = nodeStats(n, s); return html`<li>
                <span style=${{ color: st.done ? 'var(--good)' : 'var(--faint)', width: '14px' }}>${st.done ? '✓' : '○'}</span>
                <a class="t" href=${`#/node/${id}`}>${n.title}</a><span class="m">${fmtDuration(estimateMinutes(n))}</span></li>`; })}</ul></div>`)}
            <ul class="syllabus-lessons"><li><span style=${{ color: nodeStats(course.nodes[act.trial], s).done ? 'var(--good)' : 'var(--warn)', width: '14px' }}>★</span>
              <a class="t" href=${`#/node/${act.trial}`}><b>${course.nodes[act.trial].title}</b></a><span class="m">${fmtDuration(estimateMinutes(course.nodes[act.trial]))}</span></li></ul>
          </div>
        </div>
      </section>`;
    })}

    <div class="syllabus-act">
      <h2>Финал</h2>
      <p style="margin:0">После пяти актов — <a href="#/course/project">итоговый проект</a> на всех данных «Корзинки»: от аудита данных до рекомендаций руководителю. Он закрывает вопрос «а что ты делал руками?» на собеседовании. Когда испытания пройдены, открывается <a href="#/course/cert">сертификат</a>.</p>
    </div>`;
}

// ═════════════ Итоговый проект ═════════════
const MILESTONES = [
  {
    id: 'm1', title: 'Аудит данных', lessons: ['sql.select', 'sql.joins', 'data.quality'],
    goal: 'Понять, каким данным можно верить, до того как считать метрики.',
    items: [
      'Описал зерно каждой таблицы: одна строка — это что',
      'Проверил диапазоны дат, пропуски (NULL) и значения категорий',
      'Нашёл дубли и битые записи в payments, описал правило очистки',
      'Сверил заказы с событиями purchase и платежами: где расходятся и почему',
    ],
    out: 'Таблица «проверка → результат → что делаем» и очищенные представления (CTE или views).',
  },
  {
    id: 'm2', title: 'Метрики и еженедельный дашборд', lessons: ['metrics.activity', 'metrics.tree', 'viz.dashboards'],
    goal: 'Договориться, по каким числам судим о здоровье продукта, и показать их динамику.',
    items: [
      'Выбрал North Star и разложил её в дерево из 4–6 драйверов',
      'Посчитал по неделям: активные, покупатели, конверсия, заказы, средний чек, GMV, доля отмен',
      'Собрал дашборд (DataLens, Metabase, Superset или matplotlib) с разбивкой по платформам и городам',
      'Подписал на графиках события: 8 марта, запуск Казани, инцидент 14 мая',
    ],
    out: 'Дашборд + один абзац «что происходило с продуктом за полгода».',
  },
  {
    id: 'm3', title: 'Удержание и юнит-экономика', lessons: ['metrics.retention', 'unit.ltv', 'metrics.attribution'],
    goal: 'Понять, какие каналы привлечения окупаются.',
    items: [
      'Построил когортную таблицу retention по месяцу регистрации',
      'Сравнил retention и выручку на клиента по каналам привлечения',
      'Посчитал CAC платных каналов по marketing_spend и срок окупаемости',
      'Сформулировал рекомендацию по бюджету каналов с оговорками о допущениях',
    ],
    out: 'Тепловая карта когорт, таблица LTV / CAC / окупаемость по каналам.',
  },
  {
    id: 'm4', title: 'Эксперименты', lessons: ['ab.srm', 'ab.ratio', 'ab.analysis', 'product.pricing'],
    goal: 'Принять решения по трём тестам и объяснить их продакту.',
    items: [
      'new_checkout: SRM, целевая метрика, guardrails, средний чек дельта-методом, вердикт',
      'promo_banner: нашёл перекос групп, локализовал его по платформе, объяснил, почему выводов нет',
      'delivery_fee_test: оценил, как плата за доставку меняет заказы и GMV, предложил размер платы',
      'Для каждого теста — одна страница: гипотеза, результат с интервалом, решение',
    ],
    out: 'Три отчёта по экспериментам в формате «вывод сверху».',
  },
  {
    id: 'm5', title: 'Модели: отток и uplift', lessons: ['ml.validation', 'ds.churn', 'ds.uplift'],
    goal: 'Найти, кого удерживать, и проверить, кому промокод действительно помогает.',
    items: [
      'Обучил модель оттока на churn_features, честно провалидировал (ROC-AUC, PR-AUC, калибровка)',
      'Объяснил главные признаки и проверил их на утечки',
      'На promo_campaign оценил uplift и сравнил «слать всем» с «слать топу по uplift»',
      'Перевёл результат в деньги: сколько стоит кампания и сколько она возвращает',
    ],
    out: 'Ноутбук с моделью и таблица «стратегия → охват → эффект → стоимость».',
  },
  {
    id: 'm6', title: 'Выводы и презентация', lessons: ['product.drop', 'product.prioritize', 'product.stakeholders'],
    goal: 'Превратить анализ в решения.',
    items: [
      'Написал одностраничный мемо: главный вывод в первом абзаце, затем аргументы',
      'Приоритизировал 5–7 рекомендаций (RICE или ICE) с оценкой эффекта',
      'Сделал 6–8 слайдов: каждый заголовок — вывод, а не тема',
      'Оформил репозиторий: README, структура, воспроизводимый запуск',
    ],
    out: 'Мемо, слайды и репозиторий на GitHub — ссылку можно ставить в резюме.',
  },
];

const RUBRIC = [
  ['Корректность', 'Числа сходятся с контрольными, нет двойного счёта', 'Сам находит расхождения и объясняет их источник'],
  ['Данные', 'Проверяет NULL и дубли', 'Описывает зерно, ограничения и влияние качества данных на выводы'],
  ['Статистика', 'Применяет подходящий тест, считает p-value', 'Интервалы, мощность, SRM, ratio-метрики; знает границы метода'],
  ['Бизнес-вывод', 'Описывает, что видно на графике', 'Даёт решение с оценкой эффекта в деньгах и рисками'],
  ['Код', 'Запросы работают', 'Читаемые CTE, функции, воспроизводимый запуск с нуля'],
  ['Коммуникация', 'Отчёт понятен аналитику', 'Мемо понятно руководителю за две минуты'],
];

const README_TEMPLATE = `# Разбор продукта «Корзинка»: январь–июль 2024

**Главное.** <один абзац: 2–3 вывода с числами и рекомендация>

## Задача
Кто заказчик, какой вопрос, какое решение зависит от ответа.

## Данные
Таблицы, период, найденные проблемы качества и как они обработаны.

## Что сделано
1. Аудит данных → notebooks/01_audit.ipynb
2. Метрики и дашборд → notebooks/02_metrics.ipynb, dashboard.png
3. Удержание и юнит-экономика → notebooks/03_retention_ltv.ipynb
4. Эксперименты → notebooks/04_experiments.ipynb
5. Модели → notebooks/05_churn_uplift.ipynb

## Результаты
Таблица рекомендаций: что делать → ожидаемый эффект → уверенность.

## Как запустить
pip install -r requirements.txt, затем ноутбуки по порядку.`;

function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Project() {
  const s = useStore();
  const total = MILESTONES.reduce((a, m) => a + m.items.length, 0);
  const done = MILESTONES.reduce((a, m) => a + m.items.filter((_, i) => s.project[`${m.id}.${i}`]).length, 0);
  return html`
    <div class="eyebrow">Финальная работа · для портфолио</div>
    <h1>Итоговый проект: полугодовой разбор «Корзинки»</h1>
    <div class="callout callout-key"><div class="callout-title">Задача от руководителя продукта</div>
      <p>«Через две недели планируем бюджет на второе полугодие. Нужен разбор: что происходило с продуктом с января, что сработало, что сломалось, какие эксперименты катить и куда вкладываться дальше. Мне нужны решения, а не графики».</p></div>
    <p class="muted" style="max-width:760px">Проект собирает весь курс в одну работу. Делай его в своей среде — Jupyter, DBeaver, DataLens — как на настоящей работе: данные ниже, в тех же таблицах, что и в задачах. Отмечай пункты по мере готовности — прогресс сохраняется.</p>
    <div class="tasks-progress"><${Bar} value=${done} max=${total} /><span class="small muted">${done} из ${total} пунктов</span></div>

    <div class="milestone">
      <h3>Данные</h3>
      <p class="small muted" style="margin:0 0 8px">CSV генерируются в браузере — те же строки, что в SQL-задачах.</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${Object.keys(SCHEMA).map((t) => html`<button class="btn small" title=${TABLE_DOCS[t]} onClick=${() => download(`${t}.csv`, getCsv(t))}>⇩ ${t}.csv</button>`)}
      </div>
    </div>

    ${MILESTONES.map((m, k) => {
      const md = m.items.filter((_, i) => s.project[`${m.id}.${i}`]).length;
      return html`<div class="milestone">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
          <h3>${k + 1}. ${m.title}</h3><span class=${cls('badge', md === m.items.length && 'ok')}>${md}/${m.items.length}</span>
        </div>
        <p style="margin:0 0 4px">${m.goal}</p>
        <div class="small muted">Опирается на: ${m.lessons.map((id, i) => html`${i ? ', ' : ''}<a href=${`#/node/${id}`}>${course.nodes[id] ? course.nodes[id].title : id}</a>`)}</div>
        <ul class="check-list">${m.items.map((it, i) => html`<li><label><input type="checkbox" checked=${!!s.project[`${m.id}.${i}`]} onChange=${() => toggleProject(`${m.id}.${i}`)} /><span>${it}</span></label></li>`)}</ul>
        <div class="small" style="margin-top:8px"><b>Результат:</b> ${m.out}</div>
      </div>`;
    })}

    <h2>Критерии оценки</h2>
    <p class="muted">Сравни свою работу с правой колонкой — это ожидания от мидла.</p>
    <div class="table-wrap"><table class="rubric"><thead><tr><th>Критерий</th><th>Junior</th><th>Middle</th></tr></thead>
      <tbody>${RUBRIC.map(([c, j, m]) => html`<tr><td>${c}</td><td>${j}</td><td>${m}</td></tr>`)}</tbody></table></div>

    <h2>Оформление в портфолио</h2>
    <div class="syllabus-grid">
      <div>
        <ul class="check-list" style="margin-top:0">
          <li>✓ Выводы в первом абзаце README, а не в конце</li>
          <li>✓ Ноутбуки запускаются сверху вниз без ошибок</li>
          <li>✓ SQL лежит в отдельных .sql-файлах</li>
          <li>✓ У графиков есть заголовок-вывод, подписи осей и единицы</li>
          <li>✓ В репозитории нет данных больше 50 МБ — только код генерации или ссылка</li>
          <li>✓ Ссылка на репозиторий — в резюме и в профиле</li>
        </ul>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline"><b>Шаблон README</b>
          <button class="btn small" onClick=${() => download('README.md', README_TEMPLATE, 'text/markdown')}>⇩ README.md</button></div>
        <pre class="code" style="max-height:260px;overflow:auto;font-size:12.5px;margin-top:6px;white-space:pre-wrap">${README_TEMPLATE}</pre>
      </div>
    </div>`;
}

// ═════════════ Шпаргалки ═════════════
let sheetsCache = null;
function Cheats() {
  const s = useStore();
  const [sheets, setSheets] = useState(sheetsCache);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (sheetsCache) return;
    fetch('content/cheatsheets.yaml', { cache: 'no-cache' })
      .then((r) => r.text())
      .then((t) => { sheetsCache = yaml.load(t).sheets; setSheets(sheetsCache); })
      .catch((e) => setErr(String(e.message || e)));
  }, []);
  const notes = allNodesOrdered().filter((n) => s.notes[n.id]);
  return html`
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
      <div><div class="eyebrow">Под рукой</div><h1 style="margin-bottom:4px">Шпаргалки</h1>
        <p class="muted" style="margin:0">Выжимки для работы и для повторения перед собеседованием. Печатаются в две колонки.</p></div>
      <button class="btn no-print" onClick=${() => print()}>Печать / PDF</button>
    </div>
    ${err && html`<div class="callout callout-warn">${err}</div>`}
    ${!sheets && !err && html`<p class="muted">Загружаю…</p>`}
    ${sheets && html`<div class="cheats">${sheets.map((sh) => html`<section class="cheat"><h2>${sh.title}</h2><${Md} src=${sh.md} className="theory" /></section>`)}</div>`}
    <h2>Мои заметки</h2>
    ${notes.length ? html`<div class="cheats">${notes.map((n) => html`<section class="cheat"><h2><a href=${`#/node/${n.id}`}>${n.title}</a></h2><div style="white-space:pre-wrap">${s.notes[n.id].text}</div></section>`)}</div>`
      : html`<p class="muted">Пока пусто. Под каждым уроком есть поле «Добавить заметку» — всё, что напишешь, соберётся здесь.</p>`}`;
}

// ═════════════ Сертификат ═════════════
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).toUpperCase(); }

function Certificate() {
  const s = useStore();
  const trials = course.acts.map((a) => ({ act: a, st: nodeStats(course.nodes[a.trial], s) }));
  const passed = trials.filter((t) => t.st.done).length;
  const ready = passed === trials.length;
  const nodes = allNodesOrdered();
  const solved = Object.values(s.tasks).filter((t) => t.solved).length;
  const doneNodes = nodes.filter((n) => nodeStats(n, s).done);
  const hours = Math.round(doneNodes.reduce((a, n) => a + estimateMinutes(n), 0) / 60);
  const bestExam = s.exams.length ? Math.max(...s.exams.map((e) => Math.round((100 * e.score) / (e.total || 1)))) : null;
  const skills = SKILLS.map(([name, brs]) => {
    let total = 0, ok = 0;
    for (const n of nodes) { if (!brs.includes(n.branch)) continue; n.tasks.forEach((_, i) => { total++; const t = s.tasks[taskKey(n.id, i)]; if (t && t.solved) ok++; }); }
    return [name, total ? ok / total : 0];
  }).filter(([, v]) => v >= 0.6).map(([n]) => n);
  const date = (s.profile.certDate || today()).split('-').reverse().join('.');
  const name = s.profile.name.trim();
  const id = hash(`${name}|${solved}|${s.profile.certDate || ''}`);
  return html`
    <div class="no-print">
      <div class="eyebrow">Финиш</div>
      <h1>Сертификат</h1>
      <p class="muted" style="max-width:760px">Открывается, когда пройдены все пять испытаний. Это подтверждение для себя и повод рассказать о проекте — не документ об образовании.</p>
      <div class="syllabus-act" style="margin-top:8px">
        <div class="syllabus-grid">
          <div><b>Испытания</b>
            <ul class="syllabus-lessons">${trials.map(({ act, st }, k) => html`<li><span style=${{ color: st.done ? 'var(--good)' : 'var(--faint)', width: '14px' }}>${st.done ? '✓' : '○'}</span>
              <a class="t" href=${`#/node/${act.trial}`}>${course.nodes[act.trial].title}</a><span class="m">${st.solved}/${st.total}</span></li>`)}</ul>
          </div>
          <div><b>Имя на сертификате</b>
            <input class="input" style="width:100%;margin-top:8px" value=${s.profile.name} onInput=${(e) => setProfile('name', e.target.value)} placeholder="Имя и фамилия" />
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
              <button class="btn primary" disabled=${!ready || !name} onClick=${() => { if (!s.profile.certDate) setProfile('certDate', today()); setTimeout(() => print(), 50); }}>Печать / сохранить PDF</button>
            </div>
            <p class="small muted">${ready ? (name ? 'В окне печати выбери «Сохранить как PDF».' : 'Впиши имя, чтобы распечатать.') : `Пройдено ${passed} из ${trials.length} испытаний. Ниже — как он будет выглядеть.`}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="certificate" style=${{ opacity: ready ? 1 : 0.6 }}>
      <div class="cert-top">Product Analyst Trainer</div>
      <h1>Сертификат о прохождении курса</h1>
      <p>«Продуктовый аналитик: Junior → Middle»</p>
      <div class="cert-name">${name || 'Имя Фамилия'}</div>
      <p>${ready ? 'Все пять испытаний пройдены' : `Пройдено испытаний: ${passed} из ${trials.length}`} · ${doneNodes.length} из ${nodes.length} уроков · ${solved} задач · ≈ ${hours} ч практики${bestExam !== null ? ` · лучший пробный экзамен ${bestExam}%` : ''}</p>
      <div class="cert-skills">${skills.length ? `Навыки: ${skills.join(' · ')}` : 'SQL · статистика · продуктовые метрики · A/B-тесты · Python · ML'}</div>
      <div class="cert-foot"><span>${date}</span><span>№ ${id}</span></div>
    </div>`;
}
