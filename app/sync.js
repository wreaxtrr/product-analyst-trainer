import { useState, useEffect } from './lib.js';
import { getState, replaceState, subscribe } from './store.js';

// Синхронизация прогресса между устройствами через приватный GitHub Gist.
// Токен (с правом только на gist) хранится в localStorage этого браузера отдельно от прогресса
// и в экспорт не попадает. Своего сервера нет: браузер напрямую ходит в API GitHub.

const SKEY = 'pat-sync-v1';
const FILE = 'analyst-trainer-progress.json';
const API = 'https://api.github.com';

let cfg = readCfg();
let status = { state: cfg.token ? 'idle' : 'off', last: cfg.last || null, error: '' };
const watchers = new Set();
let running = null, again = false, pushTimer = null;

function readCfg() {
  try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { return {}; }
}
function writeCfg(next) {
  cfg = next;
  try { localStorage.setItem(SKEY, JSON.stringify(cfg)); } catch (e) { /* приватный режим */ }
}
function setStatus(patch) {
  status = { ...status, ...patch };
  watchers.forEach((w) => w(status));
}

export function useSyncStatus() {
  const [st, set] = useState(status);
  useEffect(() => { watchers.add(set); return () => watchers.delete(set); }, []);
  return { ...st, gistId: cfg.gistId || null };
}

// ───────── Слияние двух состояний ─────────
// local — это устройство, remote — сохранённое в gist. Правила подобраны так, чтобы ничего,
// сделанное на любом из устройств, не потерялось.
const maxBy = (a, b, f) => (b === undefined ? a : a === undefined ? b : f(b) > f(a) ? b : a);

export function mergeStates(local, remote) {
  if (!remote || remote.v !== 1) return local;
  const out = { ...local };

  out.tasks = { ...(remote.tasks || {}) };
  for (const [k, t] of Object.entries(local.tasks || {})) {
    const r = out.tasks[k];
    out.tasks[k] = !r ? t : {
      attempts: Math.max(t.attempts || 0, r.attempts || 0),
      solved: !!(t.solved || r.solved),
      first: !!(t.first || r.first),
      at: Math.max(t.at || 0, r.at || 0),
    };
  }

  // Опыт: у каждого устройства свой счётчик, берём максимум по каждому и складываем.
  out.xpBy = { ...(remote.xpBy || {}) };
  for (const [d, x] of Object.entries(local.xpBy || {})) out.xpBy[d] = Math.max(x, out.xpBy[d] || 0);
  out.xp = Object.values(out.xpBy).reduce((a, x) => a + x, 0);

  // Повторение: по каждой карточке побеждает самое позднее изменение (включая «выучена»).
  const srs = {}, done = {};
  const keys = new Set([...Object.keys(local.srs || {}), ...Object.keys(remote.srs || {}), ...Object.keys(local.srsDone || {}), ...Object.keys(remote.srsDone || {})]);
  for (const k of keys) {
    const card = maxBy((local.srs || {})[k], (remote.srs || {})[k], (c) => c.t || 0);
    const fin = Math.max((local.srsDone || {})[k] || 0, (remote.srsDone || {})[k] || 0);
    if (card && (card.t || 0) >= fin) srs[k] = card;
    else if (fin) done[k] = fin;
  }
  out.srs = srs; out.srsDone = done;

  out.days = [...new Set([...(local.days || []), ...(remote.days || [])])].sort().slice(-400);
  out.drafts = { ...(remote.drafts || {}), ...(local.drafts || {}) };

  out.scen = { ...(remote.scen || {}) };
  for (const [k, v] of Object.entries(local.scen || {})) out.scen[k] = maxBy(v, out.scen[k], (x) => x.score);

  out.practice = { ...(remote.practice || {}) };
  for (const [k, v] of Object.entries(local.practice || {})) out.practice[k] = maxBy(v, out.practice[k], (x) => x.day);

  const lt = local.train, rt = remote.train;
  if (lt && rt && lt.date === rt.date) out.train = { ...lt, results: { ...rt.results, ...lt.results } };
  else out.train = maxBy(lt || undefined, rt || undefined, (x) => x.date) || null;

  const ex = new Map();
  for (const e of [...(remote.exams || []), ...(local.exams || [])]) ex.set(e.at ? `at${e.at}` : JSON.stringify(e), e);
  out.exams = [...ex.values()].sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.date).localeCompare(String(b.date))).slice(-30);

  const ld = local.drills || {}, rd = remote.drills || {};
  out.drills = { solved: Math.max(ld.solved || 0, rd.solved || 0), tried: Math.max(ld.tried || 0, rd.tried || 0), streak: ld.streak || 0, best: Math.max(ld.best || 0, rd.best || 0) };

  out.notes = { ...(remote.notes || {}) };
  for (const [k, v] of Object.entries(local.notes || {})) out.notes[k] = maxBy(v, out.notes[k], (x) => x.at || 0);
  out.project = { ...(remote.project || {}), ...(local.project || {}) };
  const lp = local.profile || {}, rp = remote.profile || {};
  out.profile = { ...rp, ...lp, name: lp.name || rp.name || '', certDate: [lp.certDate, rp.certDate].filter(Boolean).sort()[0] };
  return out;
}

// Что уходит в gist: всё, кроме настроек конкретного устройства (тема, эффекты).
function payload(s) {
  const { settings, ...rest } = s;
  return rest;
}

// ───────── GitHub API ─────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 401) throw new Error('Токен не подходит или отозван. Создай новый и подключи заново.');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub временно ограничил запросы. Попробую позже.');
  if (res.status === 404) { const e = new Error('Gist не найден.'); e.notFound = true; throw e; }
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}.`);
  return res.json();
}

async function findGist() {
  for (let page = 1; page <= 5; page++) {
    const list = await api(`/gists?per_page=100&page=${page}`);
    const g = list.find((x) => x.files && x.files[FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return null;
}

async function readGist(id) {
  const g = await api(`/gists/${id}`);
  const f = g.files && g.files[FILE];
  if (!f) return null;
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function body(data) { return JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data) } } }); }

async function createGist(data) {
  const g = await api('/gists', { method: 'POST', body: JSON.stringify({ description: 'Product Analyst Trainer — прогресс (синхронизация)', public: false, files: { [FILE]: { content: JSON.stringify(data) } } }) });
  return g.id;
}

// ───────── Синхронизация ─────────
// force: true — не сливать, а записать прогресс этого устройства поверх (после импорта или сброса).
export function syncNow({ force = false } = {}) {
  if (!cfg.token) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    setStatus({ state: 'busy', error: '' });
    try {
      let id = cfg.gistId;
      let remote = null;
      if (id) {
        try { remote = await readGist(id); } catch (e) { if (e.notFound) id = null; else throw e; }
      }
      if (!id) {
        id = await findGist();
        if (id) remote = await readGist(id);
      }
      const local = getState();
      const merged = force ? local : mergeStates(local, remote);
      const next = payload(merged);
      if (JSON.stringify(payload(local)) !== JSON.stringify(next)) replaceState(merged);
      if (!id) id = await createGist(next);
      else if (!remote || JSON.stringify(payload(remote)) !== JSON.stringify(next)) await api(`/gists/${id}`, { method: 'PATCH', body: body(next) });
      const last = Date.now();
      writeCfg({ ...cfg, gistId: id, last });
      setStatus({ state: 'idle', last, error: '' });
    } catch (e) {
      setStatus({ state: 'error', error: navigator.onLine === false ? 'Нет сети — синхронизирую, когда появится.' : String(e.message || e) });
    } finally {
      running = null;
      if (again) { again = false; syncNow(); }
    }
  })();
  return running;
}

export async function connect(token) {
  const t = token.trim();
  if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]+$/.test(t)) throw new Error('Не похоже на токен GitHub — он начинается с ghp_ или github_pat_.');
  writeCfg({ token: t });
  await syncNow();
  if (status.state === 'error') { const msg = status.error; disconnect(); throw new Error(msg); }
}

export function disconnect() {
  writeCfg({});
  setStatus({ state: 'off', last: null, error: '' });
}

export function isConnected() { return !!cfg.token; }

// Автосинхронизация: при запуске, после изменений (с задержкой), при возвращении на вкладку и в сеть.
export function startSync() {
  subscribe((raw) => {
    if (raw || !cfg.token) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow(), 4000);
  });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  addEventListener('online', () => syncNow());
  addEventListener('pagehide', () => { if (pushTimer) { clearTimeout(pushTimer); syncNow(); } });
  syncNow();
}
