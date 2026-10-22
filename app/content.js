import yaml from 'js-yaml';
import { level } from './store.js';

// Курс собирается из content/course.yaml (акты и порядок) и content/<ветка>.yaml (узлы с теорией и задачами).
// Зависимости вычисляются автоматически:
//  - внутри трека узлы идут по порядку;
//  - первый узел трека в акте N требует испытание акта N−1;
//  - испытание акта требует последний узел каждого основного трека акта;
//  - боковой трек (side: true) открывается испытанием ИЛИ уровнем.

export let course = null;

async function loadYaml(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Не удалось загрузить ${path}: ${res.status}`);
  try {
    return yaml.load(await res.text());
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
}

export async function loadCourse() {
  const meta = await loadYaml('content/course.yaml');
  const files = await Promise.all(meta.files.map((f) => loadYaml(`content/${f}.yaml`)));
  const branches = {}, nodes = {};
  for (const f of files) {
    const b = { id: f.branch, title: f.title, color: f.color || '#7aa2ff', nodes: [] };
    branches[b.id] = b;
    for (const n of f.nodes || []) {
      if (nodes[n.id]) throw new Error(`Повтор id узла: ${n.id}`);
      nodes[n.id] = { ...n, branch: b.id, tasks: n.tasks || [], reqs: [], altLevel: null };
      b.nodes.push(n.id);
    }
  }
  // content/deep/<ветка>.yaml — углублённые разделы: теория, источники и задачи
  // дописываются в конец уже существующих узлов (номера старых задач не меняются).
  const deep = await Promise.all((meta.deep || []).map((f) => loadYaml(`content/deep/${f}.yaml`)));
  for (const f of deep) {
    for (const d of f.nodes || []) {
      const n = nodes[d.id];
      if (!n) throw new Error(`content/deep: нет узла ${d.id}`);
      if (d.theory) n.theory = `${n.theory || ''}\n\n${d.theory}`;
      if (d.sources) n.sources = [...(n.sources || []), ...d.sources];
      if (d.tasks) n.tasks = [...n.tasks, ...d.tasks];
    }
  }
  const acts = meta.acts.map((a, k) => ({ ...a, index: k }));
  acts.forEach((act, k) => {
    for (const tr of act.tracks) {
      tr.nodes.forEach((id, i) => {
        const n = nodes[id];
        if (!n) throw new Error(`В course.yaml указан узел ${id}, которого нет в файлах`);
        n.act = k;
        n.side = !!tr.side;
        n.indexInTrack = i + 1;
        if (i > 0) n.reqs = [tr.nodes[i - 1]];
        else {
          n.reqs = k > 0 ? [acts[k - 1].trial] : [];
          if (tr.side && tr.level) n.altLevel = tr.level;
        }
      });
    }
    const t = nodes[act.trial];
    if (!t) throw new Error(`Нет испытания ${act.trial}`);
    t.act = k;
    t.isTrial = true;
    t.reqs = act.tracks.filter((tr) => !tr.side || tr.requiredForTrial).map((tr) => tr.nodes[tr.nodes.length - 1]);
  });
  course = { title: meta.title, acts, branches, nodes, scenarios: [] };
  if (meta.scenarios) course.scenarios = (await loadYaml(`content/${meta.scenarios}.yaml`)).scenarios || [];
  return course;
}

export const taskKey = (nodeId, i) => `${nodeId}#${i}`;

export function nodeStats(node, s) {
  const total = node.tasks.length;
  let solved = 0, first = 0;
  node.tasks.forEach((_, i) => {
    const t = s.tasks[taskKey(node.id, i)];
    if (t && t.solved) solved++;
    if (t && t.first) first++;
  });
  const done = total > 0 && solved === total;
  let stars = 0;
  if (done) {
    stars = 1;
    if (first / total >= 0.6) stars = 2;
    if (first === total) stars = 3;
  }
  return { total, solved, first, done, stars };
}

export function isDone(id, s) {
  const n = course.nodes[id];
  return n ? nodeStats(n, s).done : false;
}

export function isUnlocked(node, s) {
  if (s.settings.free) return true;
  if (node.reqs.every((r) => isDone(r, s))) return true;
  if (node.altLevel && level(s.xp) >= node.altLevel) return true;
  return false;
}

export function allNodesOrdered() {
  const out = [];
  for (const act of course.acts) {
    for (const tr of act.tracks) out.push(...tr.nodes);
    out.push(act.trial);
  }
  return out.map((id) => course.nodes[id]);
}

export function findTask(key) {
  const [id, i] = key.split('#');
  const node = course.nodes[id];
  if (!node) return null;
  const task = node.tasks[+i];
  return task ? { node, task, index: +i } : null;
}
