import { html, render, useState, useEffect } from './lib.js';
import { loadCourse } from './content.js';
import { useRoute } from './router.js';
import { useStore, applyTheme } from './store.js';
import { Header, Toast } from './ui/common.js';
import { MapPage } from './ui/map.js';
import { NodePage } from './ui/node.js';
import { ReviewPage, ProgressPage, SettingsPage, MetricsPage, SandboxPage, SelfTestPage, dueKeys } from './ui/pages.js';

function App() {
  const route = useRoute();
  const s = useStore();
  const [toastText, setToast] = useState('');
  useEffect(() => {
    let t;
    const on = (e) => { setToast(e.detail); clearTimeout(t); t = setTimeout(() => setToast(''), 2200); };
    addEventListener('toast', on);
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onMq = () => applyTheme();
    mq.addEventListener('change', onMq);
    return () => { removeEventListener('toast', on); mq.removeEventListener('change', onMq); };
  }, []);
  const [p0, p1] = route.parts;
  let page;
  if (!p0) page = html`<${MapPage} />`;
  else if (p0 === 'node') page = html`<${NodePage} key=${p1 + (route.query.tab || '')} id=${p1} tab=${route.query.tab} />`;
  else if (p0 === 'review') page = html`<${ReviewPage} />`;
  else if (p0 === 'progress') page = html`<${ProgressPage} />`;
  else if (p0 === 'settings') page = html`<${SettingsPage} />`;
  else if (p0 === 'metrics') page = html`<${MetricsPage} id=${p1} />`;
  else if (p0 === 'sandbox') page = html`<${SandboxPage} />`;
  else if (p0 === 'selftest') page = html`<${SelfTestPage} />`;
  else page = html`<main class="page"><h1>Страница не найдена</h1><a href="#/">На карту</a></main>`;
  return html`<${Header} route=${route} dueCount=${dueKeys(s).length} xp=${s.xp} />${page}<${Toast} text=${toastText} />`;
}

loadCourse()
  .then(() => {
    const root = document.getElementById('app');
    root.textContent = '';
    render(html`<${App} />`, root);
  })
  .catch((e) => {
    console.error(e);
    document.getElementById('app').innerHTML = `<div class="boot error"><h2>Не удалось загрузить курс</h2><pre>${String(e.message || e).replace(/</g, '&lt;')}</pre>
      <p>Если открываешь index.html двойным кликом — запусти локальный сервер (см. README): браузер не даёт читать файлы курса по file://.</p></div>`;
  });
