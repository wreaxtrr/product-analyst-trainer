import { html } from '../lib.js';
import { mulberry32 } from '../data/generate.js';

// ───── статистика ─────
export function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export function invPhi(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -invPhi(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function tQuantile(p, df) {
  const z = invPhi(p);
  const z3 = z ** 3, z5 = z ** 5, z7 = z ** 7;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
}

export function makeRng(seed) {
  const u = mulberry32(seed * 7919 + 13);
  const normal = () => { let a = 0; while (a === 0) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
  const poisson = (lam) => { if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * normal())); const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= u(); } while (p > L); return k - 1; };
  const binom = (n, p) => { if (n * p > 20 && n * (1 - p) > 20) return Math.max(0, Math.min(n, Math.round(n * p + Math.sqrt(n * p * (1 - p)) * normal()))); let k = 0; for (let i = 0; i < n; i++) if (u() < p) k++; return k; };
  return { u, normal, poisson, binom };
}

export const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export function quantile(sorted, q) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export const fmt = (x, d = 3) => (Number.isFinite(x) ? Number(x).toFixed(d) : '—');
export const pct = (x, d = 1) => (Number.isFinite(x) ? (100 * x).toFixed(d) + '%' : '—');
export const int = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('ru-RU') : '—');

// ───── оформление ─────
export function Widget({ title, tag = 'интерактив', children }) {
  return html`<div class="widget"><div class="widget-title"><span>${title}</span><span class="tag">${tag}</span></div>${children}</div>`;
}

export function Slider({ label, value, min, max, step = 1, onInput, show }) {
  return html`<label class="ctrl"><span class="ctrl-top"><span>${label}</span><b>${show ? show(value) : value}</b></span>
    <input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onInput(Number(e.target.value))} /></label>`;
}

export function Select({ label, value, options, onChange }) {
  return html`<label class="ctrl"><span class="ctrl-top"><span>${label}</span></span>
    <select value=${value} onChange=${(e) => onChange(e.target.value)}>${options.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></label>`;
}

export function Readouts({ items }) {
  return html`<div class="readouts">${items.map(([l, v]) => html`<div class="readout"><div class="readout-l">${l}</div><div class="readout-v">${v}</div></div>`)}</div>`;
}

export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

// Простая система координат. children получает функции масштаба (sx, sy).
export function Plot({ w = 640, h = 260, x, y, xTicks, yTicks, xFmt = (v) => +v.toFixed(3), yFmt = (v) => +v.toFixed(3), xLabel, yLabel, children, pad }) {
  const P = { l: 48, r: 12, t: 10, b: 34, ...(pad || {}) };
  const sx = (v) => P.l + ((v - x[0]) / (x[1] - x[0] || 1)) * (w - P.l - P.r);
  const sy = (v) => h - P.b - ((v - y[0]) / (y[1] - y[0] || 1)) * (h - P.t - P.b);
  const xt = xTicks || niceTicks(x[0], x[1], 6);
  const yt = yTicks || niceTicks(y[0], y[1], 4);
  return html`<svg class="chart" viewBox=${`0 0 ${w} ${h}`} role="img">
    ${yt.map((v) => html`<line class="grid" x1=${P.l} x2=${w - P.r} y1=${sy(v)} y2=${sy(v)} /><text x=${P.l - 6} y=${sy(v) + 4} text-anchor="end">${yFmt(v)}</text>`)}
    ${xt.map((v) => html`<text x=${sx(v)} y=${h - P.b + 15} text-anchor="middle">${xFmt(v)}</text>`)}
    <line class="axis" x1=${P.l} x2=${w - P.r} y1=${h - P.b} y2=${h - P.b} />
    ${xLabel && html`<text x=${(P.l + w - P.r) / 2} y=${h - 3} text-anchor="middle">${xLabel}</text>`}
    ${yLabel && html`<text x=${12} y=${P.t + (h - P.t - P.b) / 2} text-anchor="middle" transform=${`rotate(-90 12 ${P.t + (h - P.t - P.b) / 2})`}>${yLabel}</text>`}
    ${children(sx, sy)}
  </svg>`;
}

export function path(points, sx, sy) {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [a, b] = points[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    d += (d ? 'L' : 'M') + sx(a).toFixed(1) + ',' + sy(b).toFixed(1);
  }
  return d;
}

export const C = { a: '#6c9ef8', b: '#e07a7a', c: '#4cb88a', d: '#d6a64a', e: '#a58bf0' };
