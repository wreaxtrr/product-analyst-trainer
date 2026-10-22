import katex from 'katex';

// Маленький Markdown для уроков: заголовки, абзацы, списки, таблицы, цитаты-выноски,
// блоки кода, формулы ($…$ и $$…$$) и вставки виджетов строкой «::widget имя {json}».

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tex(src, display) {
  try { return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false }); }
  catch (e) { return `<code>${esc(src)}</code>`; }
}

export function inline(s) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/\$([^$\n]+?)\$/g, (_, m) => keep(tex(m, false)));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => keep(
    /^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : `<a href="${esc(u)}">${esc(t)}</a>`,
  ));
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[+i]);
  return s;
}

const CALLOUTS = { tip: 'Совет', warn: 'Ловушка', interview: 'На собеседовании', note: 'Заметка', key: 'Главное' };

export function parseMd(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let html = [];
  const flush = () => { if (html.length) { blocks.push({ type: 'html', html: html.join('\n') }); html = []; } };
  const isStart = (l) => /^(#{2,4} |```|\$\$|::widget |>|\|| *[-*] | *\d+\. )/.test(l);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      html.push(`<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.startsWith('$$')) {
      let body = line.slice(2);
      if (body.trim().endsWith('$$')) { body = body.trim().slice(0, -2); i++; }
      else {
        const acc = [body];
        i++;
        while (i < lines.length && !lines[i].trim().endsWith('$$')) acc.push(lines[i++]);
        if (i < lines.length) acc.push(lines[i].trim().slice(0, -2));
        i++;
        body = acc.join('\n');
      }
      html.push(`<div class="math">${tex(body, true)}</div>`);
      continue;
    }
    if (line.startsWith('::widget ')) {
      flush();
      const m = line.slice(9).trim().match(/^([\w-]+)\s*(.*)$/);
      let props = {};
      if (m && m[2]) { try { props = JSON.parse(m[2]); } catch (e) { props = {}; } }
      blocks.push({ type: 'widget', name: m ? m[1] : '', props });
      i++;
      continue;
    }
    const hm = line.match(/^(#{2,4}) (.*)$/);
    if (hm) { html.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (line.startsWith('>')) {
      const acc = [];
      while (i < lines.length && lines[i].startsWith('>')) acc.push(lines[i++].replace(/^> ?/, ''));
      let kind = 'note', title = '';
      const km = acc[0].match(/^\[!(\w+)\]\s*(.*)$/);
      if (km) { kind = km[1]; title = km[2] || CALLOUTS[kind] || ''; acc.shift(); }
      const inner = parseMd(acc.join('\n')).map((b) => b.html || '').join('');
      html.push(`<div class="callout callout-${kind}">${title ? `<div class="callout-title">${inline(title)}</div>` : ''}${inner}</div>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(rows[1] && /^\|[\s:|-]+\|?$/.test(rows[1].trim()) ? 2 : 1).map(cells);
      html.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const lm = line.match(/^ *([-*]|\d+\.) /);
    if (lm) {
      const ordered = /\d/.test(lm[1]);
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(/^ *([-*]|\d+\.) (.*)$/);
        if (m) { items.push(m[2]); i++; continue; }
        if (l.startsWith('  ') && l.trim() && items.length) { items[items.length - 1] += ' ' + l.trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const acc = [];
    while (i < lines.length && lines[i].trim() && !isStart(lines[i])) acc.push(lines[i++]);
    if (!acc.length) { acc.push(lines[i++]); }
    html.push(`<p>${inline(acc.join(' '))}</p>`);
  }
  flush();
  return blocks;
}

export function mdToHtml(src) {
  return parseMd(src).map((b) => b.html || '').join('');
}
