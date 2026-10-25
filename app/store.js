import { useState, useEffect } from './lib.js';

// Весь прогресс хранится в localStorage этого браузера. Перенос — через экспорт/импорт JSON в настройках.
const KEY = 'pat-progress-v1';
export const SRS_STEPS = [1, 3, 7, 14];
export const XP = { first: 10, trialFirst: 20, later: 4, review: 3, scenario: 15 };
export const XP_PER_LEVEL = 150;

function fresh() {
  return {
    v: 1, xp: 0, tasks: {}, srs: {}, days: [], drafts: {}, scen: {},
    practice: {}, train: null, exams: [], drills: { solved: 0, tried: 0, streak: 0, best: 0 },
    notes: {}, project: {}, profile: { name: '' },
    settings: { theme: 'system', free: false, fx: true },
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.v === 1) {
      const f = fresh();
      return { ...f, ...s, drills: { ...f.drills, ...(s.drills || {}) }, profile: { ...f.profile, ...(s.profile || {}) }, settings: { ...f.settings, ...(s.settings || {}) } };
    }
  } catch (e) { /* пустой или битый localStorage — начинаем заново */ }
  return fresh();
}

let state = load();
const listeners = new Set();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
  }, 150);
}

export function getState() { return state; }

export function update(fn) {
  fn(state);
  state = { ...state };
  save();
  listeners.forEach((l) => l());
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return state;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function level(xp = state.xp) { return 1 + Math.floor(xp / XP_PER_LEVEL); }

function markDay(s) {
  const t = today();
  if (!s.days.includes(t)) s.days = [...s.days, t].slice(-400);
}

// Записывает попытку решения. Возвращает начисленный опыт.
export function recordAttempt(key, correct, { trial = false } = {}) {
  let gained = 0;
  update((s) => {
    const t = { attempts: 0, solved: false, ...(s.tasks[key] || {}) };
    t.attempts += 1;
    if (t.attempts === 1) t.first = !!correct;
    if (correct && !t.solved) {
      t.solved = true;
      gained = t.first ? (trial ? XP.trialFirst : XP.first) : XP.later;
      s.xp += gained;
    }
    if (!correct && t.attempts === 1 && !s.srs[key]) {
      s.srs = { ...s.srs, [key]: { due: addDays(today(), SRS_STEPS[0]), step: 0 } };
    }
    t.at = Date.now();
    s.tasks = { ...s.tasks, [key]: t };
    markDay(s);
  });
  return gained;
}

export function recordReview(key, correct) {
  update((s) => {
    const c = s.srs[key];
    if (!c) return;
    const srs = { ...s.srs };
    if (correct) {
      const step = c.step + 1;
      if (step >= SRS_STEPS.length) delete srs[key];
      else srs[key] = { due: addDays(today(), SRS_STEPS[step]), step };
      s.xp += XP.review;
    } else {
      srs[key] = { due: addDays(today(), SRS_STEPS[0]), step: 0 };
    }
    s.srs = srs;
    markDay(s);
  });
}

// Практика (тренировка дня): ошибка отправляет задачу в повторение, верный ответ даёт немного опыта.
export function recordPractice(key, correct) {
  let gained = 0;
  update((s) => {
    const day = today();
    const p = s.practice[key] || {};
    if (correct && p.day !== day) { gained = XP.review; s.xp += gained; }
    s.practice = { ...s.practice, [key]: { day, ok: !!correct, n: (p.n || 0) + 1 } };
    if (!correct) s.srs = { ...s.srs, [key]: { due: addDays(day, SRS_STEPS[0]), step: 0 } };
    markDay(s);
  });
  return gained;
}

export function setTrain(train) { update((s) => { s.train = train; }); }

export function recordExam(result) {
  update((s) => {
    s.exams = [...s.exams, result].slice(-30);
    s.xp += Math.round(result.score * 2);
    markDay(s);
  });
}

export function recordDrill(correct) {
  update((s) => {
    const d = { ...s.drills };
    d.tried += 1;
    if (correct) { d.solved += 1; d.streak += 1; d.best = Math.max(d.best, d.streak); s.xp += 2; } else d.streak = 0;
    s.drills = d;
    markDay(s);
  });
}

export function recordScenario(id, score, max) {
  update((s) => {
    const prev = s.scen[id];
    if (!prev) s.xp += Math.round((XP.scenario * score) / max);
    s.scen = { ...s.scen, [id]: { score: Math.max(score, prev ? prev.score : 0), max } };
    markDay(s);
  });
}

export function setDraft(key, code) {
  update((s) => { s.drafts = { ...s.drafts, [key]: code }; });
}

// Заметки к урокам: пустая строка удаляет заметку.
export function setNote(id, text) {
  update((s) => {
    const notes = { ...s.notes };
    if (text.trim()) notes[id] = { text, at: Date.now() };
    else delete notes[id];
    s.notes = notes;
  });
}

// Чек-лист итогового проекта: ключ — id пункта.
export function toggleProject(id) {
  update((s) => {
    const p = { ...s.project };
    if (p[id]) delete p[id]; else p[id] = Date.now();
    s.project = p;
    markDay(s);
  });
}

export function setProfile(k, v) {
  update((s) => { s.profile = { ...s.profile, [k]: v }; });
}

export function setSetting(k, v) {
  update((s) => { s.settings = { ...s.settings, [k]: v }; });
  if (k === 'theme') applyTheme();
}

export function applyTheme() {
  let t = state.settings.theme;
  if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
}

export function streak() {
  const set = new Set(state.days);
  let d = today();
  if (!set.has(d)) d = addDays(d, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function bestStreak() {
  const days = [...state.days].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

export function exportJson() { return JSON.stringify(state, null, 2); }

export function importJson(text) {
  const s = JSON.parse(text);
  if (!s || s.v !== 1 || typeof s.tasks !== 'object') throw new Error('Это не файл прогресса тренажёра.');
  // Файл мог быть выгружен старой версией — недостающие поля и настройки берутся по умолчанию.
  const f = fresh();
  update((st) => {
    Object.assign(st, f, s, {
      drills: { ...f.drills, ...(s.drills || {}) },
      profile: { ...f.profile, ...(s.profile || {}) },
      settings: { ...f.settings, ...(s.settings || {}) },
    });
  });
  applyTheme();
}

export function resetAll() {
  // Заметки и имя — то, что человек написал сам, — сброс прогресса не трогает.
  const { settings, notes, profile } = state;
  update((s) => { Object.assign(s, fresh(), { settings, notes, profile }); });
}
