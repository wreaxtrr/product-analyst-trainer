import { html, render, useState, useEffect, useRef } from './lib.js';
import { loadCourse } from './content.js';
import { useRoute } from './router.js';
import { useStore, applyTheme, getState } from './store.js';
import { Header, Toast, Stars } from './ui/common.js';
import { MapPage } from './ui/map.js';
import { NodePage } from './ui/node.js';
import { PracticePage } from './ui/practice.js';
import { CommandPalette } from './ui/palette.js';
import { CoursePage } from './ui/course.js';
import { startSync } from './sync.js';
import { ProgressPage, SettingsPage, MetricsPage, SandboxPage, SelfTestPage, GlossaryPage, dueKeys } from './ui/pages.js';

// Конфетти при прохождении узла — короткая анимация на canvas.
function Celebrate({ info, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!info) return;
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    const dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const colors = ['#6c9ef8', '#a58bf0', '#4cb88a', '#d6a64a', '#e07a7a'];
    const fx = getState().settings.fx !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parts = fx ? Array.from({ length: 140 }, () => ({
      x: innerWidth / 2, y: innerHeight / 2.4, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 3,
      s: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0],
    })) : [];
    let raf, t0 = performance.now();
    const tick = (t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (t - t0 < 2600) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const close = setTimeout(onClose, 3800);
    return () => { cancelAnimationFrame(raf); clearTimeout(close); };
  }, [info]);
  if (!info) return null;
  return html`<div class="celebrate" onClick=${onClose}>
    <canvas ref=${ref} />
    <div class="celebrate-card">
      <div class="hero-cap">узел пройден</div>
      <h2 class="grad-text">${info.title}</h2>
      <${Stars} n=${info.stars} />
      <div class="small muted">${info.stars < 3 ? 'Три звезды — все задачи с первой попытки.' : 'Идеально — все задачи с первой попытки.'}</div>
    </div>
  </div>`;
}

function App() {
  const route = useRoute();
  const s = useStore();
  const [toastText, setToast] = useState('');
  const [cele, setCele] = useState(null);
  useEffect(() => {
    let t;
    const on = (e) => { setToast(e.detail); clearTimeout(t); t = setTimeout(() => setToast(''), 2200); };
    const onCele = (e) => setCele(e.detail);
    addEventListener('toast', on);
    addEventListener('celebrate', onCele);
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onMq = () => applyTheme();
    mq.addEventListener('change', onMq);
    return () => { removeEventListener('toast', on); removeEventListener('celebrate', onCele); mq.removeEventListener('change', onMq); };
  }, []);
  useEffect(() => { document.documentElement.classList.toggle('no-fx', s.settings.fx === false); }, [s.settings.fx]);
  const [p0, p1] = route.parts;
  let page;
  if (!p0) page = html`<${MapPage} />`;
  else if (p0 === 'node') page = html`<${NodePage} key=${p1 + (route.query.tab || '')} id=${p1} tab=${route.query.tab} />`;
  else if (p0 === 'course') page = html`<${CoursePage} key=${p1 || 'program'} tab=${p1 || 'program'} />`;
  else if (p0 === 'dashboards') page = html`<${CoursePage} key="dashboards" tab="dashboards" />`;
  else if (p0 === 'practice') page = html`<${PracticePage} key=${p1 || 'today'} tab=${p1 || 'today'} />`;
  else if (p0 === 'review') page = html`<${PracticePage} key="review" tab="review" />`;
  else if (p0 === 'progress') page = html`<${ProgressPage} />`;
  else if (p0 === 'settings') page = html`<${SettingsPage} />`;
  else if (p0 === 'metrics') page = html`<${MetricsPage} id=${p1} />`;
  else if (p0 === 'sandbox') page = html`<${SandboxPage} />`;
  else if (p0 === 'selftest') page = html`<${SelfTestPage} />`;
  else if (p0 === 'glossary') page = html`<${GlossaryPage} key=${route.query.q || ''} q=${route.query.q || ''} />`;
  else page = html`<main class="page"><h1>Страница не найдена</h1><a href="#/">На карту</a></main>`;
  return html`<${Header} route=${route} dueCount=${dueKeys(s).length} xp=${s.xp} />${page}<${Toast} text=${toastText} /><${Celebrate} info=${cele} onClose=${() => setCele(null)} /><${CommandPalette} />`;
}

loadCourse()
  .then(() => {
    const root = document.getElementById('app');
    root.textContent = '';
    render(html`<${App} />`, root);
    startSync();
  })
  .catch((e) => {
    console.error(e);
    document.getElementById('app').innerHTML = `<div class="boot error"><h2>Не удалось загрузить курс</h2><pre>${String(e.message || e).replace(/</g, '&lt;')}</pre>
      <p>Если открываешь index.html двойным кликом — запусти локальный сервер (см. README): браузер не даёт читать файлы курса по file://.</p></div>`;
  });
