// CLD 편집기 — SVG 노드그래프 (Vensim풍). 외부 의존성 0.
import {
  createModel, addNode, getNode, removeNode, addLink, removeLink, getLink,
  toJSON, fromJSON, detectLoops, NODE_TYPES,
} from './model.js';
import {
  parseCSV, makeDataset, addDataset, listDatasets, getDataset, removeDataset,
  loadDatasets, columnValues, timeValues,
} from './csv.js';
import { simulate } from './sim.js';
import { drawChart, PALETTE } from './chart.js';
import { buildScenario, saveScenario, listScenarios, removeScenario } from './scenario.js';
import { sweep, crossingTime } from './analysis.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const LS_KEY = 'redilab-cld-model';

// ---------- DOM helpers ----------
const $ = s => document.querySelector(s);
function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) {
    if (k === 'class') n.setAttribute('class', attrs[k]);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- state ----------
const svg = $('#cv');
loadDatasets();
let model = loadModel();
let view = { x: 0, y: 0, k: 1 };          // pan/zoom (screen = world*k + xy)
let selection = null;                      // {type:'node'|'link', id}
let highlightLoop = null;                  // index into current loops, or null
let nodeEls = new Map();                    // id -> {g, body, text}
let linkEls = new Map();                    // id -> {g, path, hit, signG, signT}

// ---------- svg scaffold ----------
svg.innerHTML = '';
const defs = el('defs');
function marker(id, color) {
  return el('marker', { id, markerWidth: 9, markerHeight: 9, refX: 7.5, refY: 3,
    orient: 'auto', markerUnits: 'strokeWidth' },
    el('path', { d: 'M0,0 L8,3 L0,6 Z', fill: color }));
}
defs.append(
  marker('arr-muted', '#8499ad'), marker('arr-pos', '#46e3b1'),
  marker('arr-neg', '#ff7a7a'), marker('arr-accent', '#37c2ff'),
  el('pattern', { id: 'grid', width: 40, height: 40, patternUnits: 'userSpaceOnUse' },
    el('path', { d: 'M40 0 H0 V40', fill: 'none', stroke: 'rgba(255,255,255,.045)', 'stroke-width': 1 })),
);
svg.appendChild(defs);

const scene = el('g', { id: 'scene' });
const bg = el('rect', { id: 'bg', x: -8000, y: -8000, width: 16000, height: 16000, fill: 'url(#grid)' });
const loopLayer = el('g');     // loop rings/badges (behind links)
const linkLayer = el('g');
const nodeLayer = el('g');
const tempLayer = el('g');     // temp link while dragging
scene.append(bg, loopLayer, linkLayer, nodeLayer, tempLayer);
svg.appendChild(scene);

function applyView() {
  scene.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
  positionInlineEdit();
}

function screenToWorld(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
}

// ================= rendering =================
function render() {
  nodeEls.clear(); linkEls.clear();
  linkLayer.innerHTML = ''; nodeLayer.innerHTML = ''; loopLayer.innerHTML = '';
  for (const l of model.links) buildLink(l);
  for (const n of model.nodes) buildNode(n);
  for (const l of model.links) layoutLink(l);     // needs node sizes -> after nodes built
  renderLoops();
  renderDatasets();
  renderInspector();
  $('#model-name').textContent = model.name;
  applyView();
  saveLocal();
  scheduleSim();
}

function buildNode(n) {
  const shape = NODE_TYPES[n.type]?.shape || 'round';
  const body = el('rect', { class: 'nbody', rx: shape === 'box' ? 3 : 16, ry: shape === 'box' ? 3 : 16 });
  const text = el('text', { class: 'ntext', x: 0, y: 1 });
  text.textContent = n.name || ' ';
  const handle = el('circle', { class: 'handle', r: 6, cx: 0, cy: 0 });
  const g = el('g', { class: 'node ' + n.type, 'data-id': n.id });
  g.append(body, text, handle);
  nodeLayer.appendChild(g);

  // measure & size
  const tw = text.getComputedTextLength();
  const w = Math.max(74, tw + 30), h = shape === 'box' ? 40 : 34;
  n._w = w; n._h = h;
  body.setAttribute('x', -w / 2); body.setAttribute('y', -h / 2);
  body.setAttribute('width', w); body.setAttribute('height', h);
  handle.setAttribute('cx', w / 2);
  // CSV 바인딩 배지 (있을 때만, 좌상단)
  if (n.csv && getDataset(n.csv.dataset)) {
    g.appendChild(el('circle', { class: 'databadge', r: 4.5, cx: -w / 2 + 6, cy: -h / 2 + 6 }));
  }
  g.setAttribute('transform', `translate(${n.x} ${n.y})`);
  if (selection?.type === 'node' && selection.id === n.id) g.classList.add('selected');

  // handle -> start link drag
  handle.addEventListener('pointerdown', e => { e.stopPropagation(); startLinkDrag(n, e); });
  nodeEls.set(n.id, { g, body, text });
}

function positionNode(n) {
  nodeEls.get(n.id)?.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
}

function edgePoint(n, tox, toy) {
  const dx = tox - n.x, dy = toy - n.y;
  if (!dx && !dy) return [n.x, n.y];
  const hw = n._w / 2 + 5, hh = n._h / 2 + 5;
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [n.x + dx * s, n.y + dy * s];
}

function buildLink(l) {
  const cls = l.sign > 0 ? 'pos' : 'neg';
  const hit = el('path', { class: 'link hit', 'data-id': l.id });
  const path = el('path', { class: 'link ' + cls, 'data-id': l.id });
  const signBg = el('circle', { class: 'sign-bg', r: 9 });
  const signT = el('text', { class: 'sign ' + cls });
  signT.textContent = l.sign > 0 ? '+' : '–';
  const signG = el('g');
  signG.append(signBg, signT);
  // interactions
  hit.addEventListener('pointerdown', e => { e.stopPropagation(); select('link', l.id); });
  const toggle = e => { e.stopPropagation(); l.sign = -l.sign; render(); select('link', l.id); };
  signG.addEventListener('pointerdown', e => e.stopPropagation());
  signG.addEventListener('click', toggle);
  const g = el('g');
  g.append(hit, path, signG);
  linkLayer.appendChild(g);
  linkEls.set(l.id, { g, path, hit, signG, signT, signBg });
}

function layoutLink(l) {
  const a = getNode(model, l.from), b = getNode(model, l.to);
  const refs = linkEls.get(l.id);
  if (!a || !b || !refs) return;
  const [ax, ay] = edgePoint(a, b.x, b.y);
  const [bx, by] = edgePoint(b, a.x, a.y);
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const off = Math.min(36, len * 0.16);
  const cx = (ax + bx) / 2 - dy / len * off, cy = (ay + by) / 2 + dx / len * off;
  const d = `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  refs.path.setAttribute('d', d); refs.hit.setAttribute('d', d);
  // arrow color
  const sel = selection?.type === 'link' && selection.id === l.id;
  const mk = sel ? 'arr-accent' : l.sign > 0 ? 'arr-pos' : 'arr-neg';
  refs.path.setAttribute('marker-end', `url(#${mk})`);
  refs.path.setAttribute('class', 'link ' + (l.sign > 0 ? 'pos' : 'neg') + (sel ? ' selected' : ''));
  // sign at curve midpoint (t=0.5 of quadratic)
  const t = 0.5, mt = 1 - t;
  const px = mt * mt * ax + 2 * mt * t * cx + t * t * bx;
  const py = mt * mt * ay + 2 * mt * t * cy + t * t * by;
  refs.signG.setAttribute('transform', `translate(${px} ${py})`);
  refs.signT.setAttribute('class', 'sign ' + (l.sign > 0 ? 'pos' : 'neg'));
  refs.signT.textContent = l.sign > 0 ? '+' : '–';
}

function linksOf(id) { return model.links.filter(l => l.from === id || l.to === id); }

// ================= loops =================
let currentLoops = [];
function renderLoops() {
  currentLoops = detectLoops(model);
  const box = $('#loops');
  box.innerHTML = '';
  if (!currentLoops.length) { box.innerHTML = '<div class="empty">감지된 루프가 없습니다.</div>'; }
  currentLoops.forEach((lp, i) => {
    const names = lp.nodes.map(id => getNode(model, id)?.name || '?').join(' → ');
    const item = document.createElement('div');
    item.className = 'loop-item';
    item.innerHTML = `<div class="tag ${lp.polarity}">${lp.polarity}</div>
      <div class="path">${names} → ↩</div>`;
    item.addEventListener('click', () => {
      highlightLoop = highlightLoop === i ? null : i;
      applyHighlight();
    });
    box.appendChild(item);
  });
  applyHighlight();
}

function applyHighlight() {
  const lp = highlightLoop != null ? currentLoops[highlightLoop] : null;
  const nodeSet = lp ? new Set(lp.nodes) : null;
  const linkSet = lp ? new Set(lp.links) : null;
  nodeEls.forEach((r, id) => r.g.classList.toggle('dim', !!nodeSet && !nodeSet.has(id)));
  linkEls.forEach((r, id) => {
    const dim = !!linkSet && !linkSet.has(id);
    r.path.classList.toggle('dim', dim); r.hit.classList.toggle('dim', dim);
    r.signG.style.opacity = dim ? '.18' : '1';
  });
}

// ================= datasets (CSV) =================
function renderDatasets() {
  const box = $('#datasets');
  const list = listDatasets();
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">상단 “+ 데이터(CSV)”로 시민안전 데이터를 올리세요.</div>'; return; }
  for (const ds of list) {
    const users = model.nodes.filter(n => n.csv?.dataset === ds.name).length;
    const item = document.createElement('div');
    item.className = 'ds-item';
    const cols = ds.columns.map(c =>
      `<span class="chip${c === ds.timeCol ? ' time' : ''}">${esc(c)}${c === ds.timeCol ? ' ⏱' : ''}</span>`).join('');
    item.innerHTML = `
      <div class="ds-head"><div class="ds-name" title="${esc(ds.name)}">${esc(ds.name)}</div>
        <button class="ds-x" title="삭제">✕</button></div>
      <div class="ds-meta">${ds.rows.length}행 · ${ds.columns.length}열${users ? ` · 노드 ${users}개 연결` : ''}</div>
      <div class="ds-cols">${cols}</div>`;
    item.querySelector('.ds-x').addEventListener('click', () => {
      if (!confirm(`데이터셋 "${ds.name}" 삭제? 연결된 노드 바인딩도 해제됩니다.`)) return;
      model.nodes.forEach(n => { if (n.csv?.dataset === ds.name) n.csv = null; });
      removeDataset(ds.name); render();
    });
    box.appendChild(item);
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ================= selection / inspector =================
function select(type, id) {
  selection = id ? { type, id } : null;
  render();
}

function renderInspector() {
  const box = $('#inspector');
  box.innerHTML = '';
  if (!selection) { box.innerHTML = '<div class="empty">노드나 링크를 선택하세요. 빈 곳을 더블클릭하면 변수가 추가됩니다.</div>'; return; }

  if (selection.type === 'node') {
    const n = getNode(model, selection.id);
    if (!n) { selection = null; return renderInspector(); }
    box.appendChild(field('이름', input(n.name, v => { n.name = v; render(); })));
    const sel = document.createElement('select');
    for (const t in NODE_TYPES) {
      const o = document.createElement('option'); o.value = t; o.textContent = NODE_TYPES[t].ko;
      if (t === n.type) o.selected = true; sel.appendChild(o);
    }
    sel.addEventListener('change', () => { n.type = sel.value; render(); });
    box.appendChild(field('유형', sel));
    box.appendChild(equationUI(n));
    box.appendChild(bindingUI(n));
    box.appendChild(delBtn('변수 삭제', () => { removeNode(model, n.id); selection = null; render(); }));
  } else {
    const l = getLink(model, selection.id);
    if (!l) { selection = null; return renderInspector(); }
    const from = getNode(model, l.from)?.name || '?', to = getNode(model, l.to)?.name || '?';
    box.appendChild(noteEl(`${from} → ${to}`));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;margin:8px 0';
    for (const [lab, s] of [['＋ 강화', 1], ['－ 약화', -1]]) {
      const b = document.createElement('button');
      b.className = 'tb-btn' + (l.sign === s ? ' primary' : '');
      b.style.flex = '1'; b.textContent = lab;
      b.addEventListener('click', () => { l.sign = s; render(); select('link', l.id); });
      wrap.appendChild(b);
    }
    box.appendChild(labelEl('극성')); box.appendChild(wrap);
    box.appendChild(delBtn('링크 삭제', () => { removeLink(model, l.id); selection = null; render(); }));
  }
}
// 정량(Phase3) 입력: 타입별 값/수식
function equationUI(n) {
  const wrap = document.createElement('div');
  wrap.appendChild(divider('정량 (시뮬레이션)'));
  const bound = n.csv && n.csv.role === 'driver';
  if (bound) { wrap.appendChild(noteEl('이 변수는 CSV 드라이버로 입력됩니다 — 수식 대신 시계열이 사용됩니다.')); return wrap; }

  if (n.type === 'const') {
    wrap.appendChild(field('값', numInput(n.value, v => { n.value = v; scheduleSim(); })));
  } else if (n.type === 'stock') {
    wrap.appendChild(field('초기값', numInput(n.value, v => { n.value = v; scheduleSim(); })));
    wrap.appendChild(field('순변화율 수식  (유입 − 유출)', eqInput(n)));
    wrap.appendChild(eqHint('예: 지표유출 - 펌프_배수'));
  } else { // aux / flow
    wrap.appendChild(field('수식', eqInput(n)));
    wrap.appendChild(field('수식 없을 때 상수값', numInput(n.value, v => { n.value = v; scheduleSim(); })));
    wrap.appendChild(eqHint('변수명을 그대로 사용. 함수: min,max,abs,exp,sqrt,ln,pow,clamp'));
  }
  return wrap;
}
function eqInput(n) {
  const ta = document.createElement('textarea'); ta.value = n.eq || '';
  ta.placeholder = '예: 강우량 * 0.6';
  ta.addEventListener('input', () => { n.eq = ta.value; nodeEls.get(n.id) && scheduleSim(); });
  return ta;
}
function eqHint(t) { const d = document.createElement('div'); d.className = 'muted-note'; d.style.marginTop = '-3px'; d.textContent = t; return d; }
function numInput(val, on) {
  const i = document.createElement('input'); i.type = 'number'; i.step = 'any';
  i.value = val == null ? '' : val;
  i.addEventListener('input', () => on(i.value === '' ? null : +i.value));
  return i;
}

// 데이터(CSV) 바인딩 UI — role: none/driver/observed
function bindingUI(n) {
  const wrap = document.createElement('div');
  wrap.appendChild(divider('데이터 연결 (CSV)'));
  const list = listDatasets();
  if (!list.length) {
    wrap.appendChild(noteEl('상단 “+ 데이터(CSV)”로 데이터를 먼저 올리면 이 변수에 시계열을 연결할 수 있습니다.'));
    return wrap;
  }
  const cur = n.csv || {};
  // role
  const roleSel = mkSelect([['none', '연결 안함'], ['driver', '입력 드라이버 (시계열)'], ['observed', '관측·검증 (시계열)']],
    cur.role || 'none');
  wrap.appendChild(field('역할', roleSel));

  const row = document.createElement('div'); row.className = 'bind-row';
  const dsSel = mkSelect(list.map(d => [d.name, d.name]), cur.dataset || list[0].name);
  const colSel = document.createElement('select');
  const fillCols = () => {
    const ds = getDataset(dsSel.value); colSel.innerHTML = '';
    (ds?.columns || []).filter(c => c !== ds.timeCol).forEach(c => {
      const o = document.createElement('option'); o.value = c; o.textContent = c;
      if (c === cur.column) o.selected = true; colSel.appendChild(o);
    });
  };
  fillCols();
  const df = field('데이터셋', dsSel), cf = field('컬럼', colSel);
  row.append(df, cf); wrap.appendChild(row);

  const note = document.createElement('div');
  const refresh = () => {
    const off = roleSel.value === 'none';
    df.style.display = cf.style.display = off ? 'none' : '';
    note.innerHTML = '';
    if (off) { n.csv = null; return; }
    n.csv = { dataset: dsSel.value, column: colSel.value, role: roleSel.value };
    const ds = getDataset(dsSel.value);
    if (ds) {
      const v = columnValues(ds, colSel.value).filter(isFinite);
      const t = timeValues(ds);
      const lo = v.length ? Math.min(...v) : 0, hi = v.length ? Math.max(...v) : 0;
      note.className = 'bind-note';
      note.textContent = `✓ ${v.length}개 값 연결 · 범위 ${fmt(lo)}~${fmt(hi)} · 시간축 ${ds.timeCol || '(행 번호)'} ${t.length}스텝`;
    }
  };
  roleSel.addEventListener('change', () => { refresh(); render(); select('node', n.id); });
  dsSel.addEventListener('change', () => { fillCols(); refresh(); });
  colSel.addEventListener('change', refresh);
  refresh();
  wrap.appendChild(note);
  return wrap;
}
function mkSelect(opts, val) {
  const s = document.createElement('select');
  for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t;
    if (v === val) o.selected = true; s.appendChild(o); }
  return s;
}
function divider(t) { const d = document.createElement('div'); d.className = 'sec'; d.style.marginTop = '16px'; d.textContent = t; return d; }
function fmt(x) { return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2); }
function labelEl(t) { const d = document.createElement('div'); d.className = 'field'; d.innerHTML = `<label>${t}</label>`; return d; }
function field(label, control) { const d = document.createElement('div'); d.className = 'field';
  const l = document.createElement('label'); l.textContent = label; d.append(l, control); return d; }
function input(val, on) { const i = document.createElement('input'); i.value = val;
  i.addEventListener('input', () => on(i.value)); return i; }
function noteEl(t) { const d = document.createElement('div'); d.className = 'muted-note'; d.textContent = t; return d; }
function delBtn(t, on) { const b = document.createElement('button'); b.className = 'del-btn'; b.textContent = t;
  b.addEventListener('click', on); return b; }

// ================= interactions =================
let drag = null;   // node drag
let pan = null;    // canvas pan
let linkDrag = null; // creating a link

svg.addEventListener('pointerdown', e => {
  if (e.button === 1 || e.button === 2) { return; }
  const nodeG = e.target.closest?.('.node');
  if (e.target === bg || e.target === svg) {
    // pan + deselect
    if (selection) select(null);
    pan = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    svg.classList.add('panning');
  } else if (nodeG && !e.target.classList.contains('handle')) {
    const n = getNode(model, nodeG.dataset.id);
    select('node', n.id);
    const w = screenToWorld(e.clientX, e.clientY);
    drag = { n, dx: w.x - n.x, dy: w.y - n.y, moved: false };
  }
});

window.addEventListener('pointermove', e => {
  if (pan) {
    view.x = pan.ox + (e.clientX - pan.sx); view.y = pan.oy + (e.clientY - pan.sy); applyView();
  } else if (drag) {
    const w = screenToWorld(e.clientX, e.clientY);
    drag.n.x = Math.round(w.x - drag.dx); drag.n.y = Math.round(w.y - drag.dy); drag.moved = true;
    positionNode(drag.n); linksOf(drag.n.id).forEach(layoutLink);
  } else if (linkDrag) {
    const w = screenToWorld(e.clientX, e.clientY);
    const a = linkDrag.from;
    linkDrag.path.setAttribute('d', `M ${a.x} ${a.y} L ${w.x} ${w.y}`);
    const tg = e.target.closest?.('.node');
    highlightTarget(tg && tg.dataset.id !== a.id ? tg.dataset.id : null);
  }
});

window.addEventListener('pointerup', e => {
  if (pan) { pan = null; svg.classList.remove('panning'); }
  if (drag) { if (drag.moved) saveLocal(); drag = null; }
  if (linkDrag) {
    const tg = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.node');
    highlightTarget(null);
    tempLayer.innerHTML = ''; svg.classList.remove('linking');
    if (tg && tg.dataset.id !== linkDrag.from.id) {
      const id = addLink(model, linkDrag.from.id, tg.dataset.id, 1);
      render(); if (id) select('link', id);
    }
    linkDrag = null;
  }
});

function startLinkDrag(n, e) {
  svg.classList.add('linking');
  const path = el('path', { class: 'temp-link', 'marker-end': 'url(#arr-accent)' });
  tempLayer.appendChild(path);
  linkDrag = { from: n, path };
}
function highlightTarget(id) {
  nodeEls.forEach((r, nid) => r.g.querySelector('.nbody')
    .style.setProperty('stroke', id && nid === id ? 'var(--accent)' : ''));
}

// double-click: rename node OR add node on empty
svg.addEventListener('dblclick', e => {
  const nodeG = e.target.closest?.('.node');
  if (nodeG) { startRename(getNode(model, nodeG.dataset.id)); }
  else if (e.target === bg || e.target === svg) {
    const w = screenToWorld(e.clientX, e.clientY);
    const id = addNode(model, w.x, w.y, { name: '변수' });
    render(); select('node', id); startRename(getNode(model, id));
  }
});

// wheel zoom (cursor anchored)
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const w = { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  view.k = clamp(view.k * Math.exp(-e.deltaY * 0.0015), 0.3, 3);
  view.x = sx - w.x * view.k; view.y = sy - w.y * view.k;
  applyView();
}, { passive: false });

svg.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
    e.preventDefault();
    if (selection.type === 'node') removeNode(model, selection.id);
    else removeLink(model, selection.id);
    selection = null; render();
  }
});

// ---------- inline rename ----------
const inlineEdit = $('#inline-edit');
let renaming = null;
function startRename(n) {
  if (!n) return;
  renaming = n;
  inlineEdit.value = n.name;
  inlineEdit.style.display = 'block';
  positionInlineEdit();
  inlineEdit.focus(); inlineEdit.select();
}
function positionInlineEdit() {
  if (!renaming) return;
  const sx = renaming.x * view.k + view.x, sy = renaming.y * view.k + view.y;
  const r = svg.getBoundingClientRect();
  inlineEdit.style.left = (r.left + sx) + 'px';
  inlineEdit.style.top = (r.top + sy) + 'px';
  inlineEdit.style.transform = 'translate(-50%,-50%)';
  inlineEdit.style.minWidth = Math.max(80, (renaming._w || 80) * view.k) + 'px';
}
function commitRename() {
  if (!renaming) return;
  renaming.name = inlineEdit.value.trim() || '변수';
  inlineEdit.style.display = 'none';
  renaming = null; render();
}
inlineEdit.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
  else if (e.key === 'Escape') { inlineEdit.style.display = 'none'; renaming = null; }
});
inlineEdit.addEventListener('blur', commitRename);

// ================= toolbar =================
$('#btn-add').addEventListener('click', () => {
  const c = screenToWorld(svg.getBoundingClientRect().width / 2, svg.getBoundingClientRect().height / 2);
  const id = addNode(model, c.x, c.y, { name: '변수' });
  render(); select('node', id); startRename(getNode(model, id));
});
$('#btn-csv').addEventListener('click', () => $('#csv-input').click());
$('#csv-input').addEventListener('change', e => {
  const files = [...e.target.files]; if (!files.length) return;
  let done = 0, last = null;
  files.forEach(f => {
    const fr = new FileReader();
    fr.onload = () => {
      try { last = addDataset(makeDataset(f.name, parseCSV(fr.result))); }
      catch (err) { alert(`"${f.name}" 파싱 실패: ${err.message}`); }
      if (++done === files.length) {
        render();
        if (last) {
          const ds = getDataset(last);
          alert(`데이터셋 "${last}" 로드 완료 (${ds.rows.length}행 · ${ds.columns.length}열)\n` +
            `시간축: ${ds.timeCol || '(행 번호 사용)'}\n\n노드를 선택해 “데이터 연결”에서 시계열을 바인딩하세요.`);
        }
      }
    };
    fr.readAsText(f, 'utf-8');
  });
  e.target.value = '';
});
$('#btn-save').addEventListener('click', () => {
  const name = (model.name || 'cld').replace(/\s+/g, '_');
  download(name + '.json', toJSON(model));
});
$('#btn-load').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => { try { model = fromJSON(fr.result); selection = null; highlightLoop = null; simShown = null; render(); }
    catch (err) { alert('불러오기 실패: ' + err.message); } };
  fr.readAsText(f); e.target.value = '';
});
$('#btn-clear').addEventListener('click', () => {
  if (confirm('현재 모델을 모두 지웁니다. 계속할까요?')) {
    model = createModel(); selection = null; highlightLoop = null; simShown = null; render();
  }
});
$('#btn-sample').addEventListener('click', () => {
  if (model.nodes.length && !confirm('예시 모델로 교체합니다. 계속할까요?')) return;
  model = sampleModel(); selection = null; highlightLoop = null; simShown = null; render();
});

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ================= persistence =================
function saveLocal() { try { localStorage.setItem(LS_KEY, toJSON(model)); } catch {} }
function loadModel() {
  try { const t = localStorage.getItem(LS_KEY); if (t) return fromJSON(t); } catch {}
  return sampleModel();
}

// ================= sample (침수 → 시민안전 CLD + 정량모델) =================
function sampleModel() {
  const m = createModel();
  m.name = '세종 침수–시민안전 모델 (예시)';
  const N = (name, x, y, type, value, eq) => addNode(m, x, y, { name, type, value, eq });
  const rain   = N('강우량', -380, -160, 'const', 50, '');                       // mm/h (CSV로 교체 가능)
  const runoff = N('지표유출', -180, -120, 'aux', null, '강우량 * 0.7');
  const depth  = N('침수심', 40, -20, 'stock', 0, '지표유출*0.018 - 펌프배수 - 자연배수');
  const cap    = N('배수용량', 40, -200, 'aux', null, 'clamp(1 - 침수심/5, 0, 1)');
  const pump   = N('펌프배수', 300, -170, 'aux', null, '배수용량 * 0.4 * 침수심');
  const nat    = N('자연배수', 300, -20, 'aux', null, '0.05 * 침수심');
  const expo   = N('시민노출', 260, 120, 'aux', null, 'clamp(침수심/3, 0, 1)');
  const vuln   = N('취약계층', 40, 200, 'const', 0.4, '');
  const resp   = N('대피경보', 40, 120, 'aux', null, 'clamp(침수심/4, 0, 1)');
  const risk   = N('안전위험도', 520, 90, 'aux', null,
    'clamp(시민노출*(0.5+0.5*취약계층)*(1-0.6*대피경보), 0, 1)');

  const L = (a, b, s) => addLink(m, a, b, s);
  L(rain, runoff, 1); L(runoff, depth, 1);
  L(depth, cap, -1);  L(cap, pump, 1); L(pump, depth, -1);   // R: 침수↑→용량↓→배수↓→침수↑
  L(depth, pump, 1);                                         // B: 침수↑→펌프↑→침수↓
  L(depth, nat, 1);   L(nat, depth, -1);                     // B: 자연배수
  L(depth, expo, 1);  L(expo, risk, 1);  L(vuln, risk, 1);
  L(depth, resp, 1);  L(resp, risk, -1);
  return m;
}

// ================= simulation panel =================
let simResult = null;
let simShown = null;   // null => 기본(스톡+관측)
const colorFor = i => PALETTE[i % PALETTE.length];
const llerp = (ts, vs, t) => {
  if (!ts.length) return 0;
  if (t <= ts[0]) return vs[0]; if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; ts[m] <= t ? lo = m : hi = m; }
  return vs[lo] + (vs[hi] - vs[lo]) * (t - ts[lo]) / ((ts[hi] - ts[lo]) || 1);
};

function defaultShown() {
  const base = model.nodes.filter(n => n.type === 'stock' || n.csv?.role === 'observed').map(n => n.name);
  return new Set(base.length ? base : model.nodes.map(n => n.name).filter(Boolean));
}
const shownSet = () => simShown || defaultShown();

function openSim() { $('#simpanel').classList.remove('hidden'); runSim(); }
function scheduleSim() {
  if ($('#simpanel').classList.contains('hidden')) return;
  clearTimeout(scheduleSim._t); scheduleSim._t = setTimeout(runSim, 250);
}
function runSim() {
  const dt = +$('#sp-dt').value || 1;
  const sv = $('#sp-steps').value; const steps = sv ? +sv : undefined;
  simResult = simulate(model, { dt, steps });
  $('#sp-steps').placeholder = 'auto (' + simResult.steps + ')';
  $('#sp-warn').textContent = simResult.warnings.join(' · ');
  analysisMode = false; $('#an-back').style.display = 'none'; $('#sp-legend').style.display = '';
  refreshSelects();
  renderLegend(); drawSim();
}
function seriesFor(n) {                      // 관측 노드는 CSV 원본, 그 외는 시뮬값
  if (n.csv?.role === 'observed') {
    const ds = getDataset(n.csv.dataset); if (!ds) return null;
    const dts = timeValues(ds), dvs = columnValues(ds, n.csv.column);
    return simResult.t.map(t => llerp(dts, dvs, t));
  }
  return simResult.series[n.name];
}
function drawSim() {
  if (!simResult) return;
  const shown = shownSet(), lines = [];
  model.nodes.forEach((n, i) => {
    if (!n.name || !shown.has(n.name)) return;
    const vals = seriesFor(n); if (!vals) return;
    lines.push({ name: n.name, color: colorFor(i), values: vals, dashed: n.csv?.role === 'observed' });
  });
  const opts = { t: simResult.t, lines, normalize: $('#sp-norm').checked, xlabel: '시간' };
  if ($('#an-showthr')?.checked) {
    const out = $('#an-out').value, thr = +$('#an-thr').value;
    if (out && simResult.series[out] && isFinite(thr)) {
      opts.threshold = thr;
      const ct = crossingTime(simResult.t, simResult.series[out], thr);
      if (ct != null) opts.vmarks = [{ x: ct, color: '#ff7a7a', label: `붕괴 t≈${fmt(ct)}` }];
    }
  }
  drawChart($('#sp-chart'), opts);
}
function renderLegend() {
  const box = $('#sp-legend'); box.innerHTML = '';
  if (!simResult) return;
  const shown = shownSet();
  model.nodes.forEach((n, i) => {
    if (!n.name) return;
    const lg = document.createElement('span');
    lg.className = 'lg' + (shown.has(n.name) ? '' : ' off');
    lg.innerHTML = `<span class="sw" style="background:${colorFor(i)}"></span>${esc(n.name)}${n.csv?.role === 'observed' ? ' (관측)' : ''}`;
    lg.addEventListener('click', () => {
      const set = new Set(shownSet());
      set.has(n.name) ? set.delete(n.name) : set.add(n.name);
      simShown = set; renderLegend(); drawSim();
    });
    box.appendChild(lg);
  });
}

let analysisMode = false;

// 분석/시나리오 셀렉트 채우기 (선택값 보존)
function refreshSelects() {
  const names = model.nodes.map(n => n.name).filter(Boolean);
  const consts = model.nodes.filter(n => n.type === 'const' || !n.eq).map(n => n.name).filter(Boolean);
  const find = re => names.find(nm => re.test(nm)) || '';
  const defWL = find(/침수심|수위|depth|water/i) || (model.nodes.find(n => n.type === 'stock')?.name) || names[0] || '';
  const defRisk = find(/위험|risk/i) || '';
  fillSelect('#an-out', names, defWL);
  fillSelect('#an-param', consts.length ? consts : names, find(/강우|rain|배수|용량/i) || consts[0] || names[0] || '');
  fillSelect('#scn-wl', names, defWL);
  fillSelect('#scn-risk', ['', ...names], defRisk, '(없음)');
}
function fillSelect(sel, opts, def, emptyLabel) {
  const elx = $(sel); if (!elx) return;
  const prev = elx.value;
  elx.innerHTML = '';
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = o; op.textContent = o === '' ? (emptyLabel || '(없음)') : o;
    elx.appendChild(op);
  }
  const want = opts.includes(prev) && prev !== '' ? prev : def;
  elx.value = want != null ? want : (opts[0] || '');
}

// ---- 임계점 분석 (파라미터 스윕) ----
function runAnalysis() {
  if (!simResult) runSim();
  const param = $('#an-param').value, output = $('#an-out').value;
  const from = +$('#an-from').value, to = +$('#an-to').value, steps = Math.max(2, +$('#an-steps').value || 30);
  const metric = $('#an-metric').value, threshold = +$('#an-thr').value;
  const dt = +$('#sp-dt').value || 1; const sv = $('#sp-steps').value;
  const simOpts = { dt, steps: sv ? +sv : undefined };
  const res = sweep(model, { param, from, to, steps, output, metric, threshold, simOpts });
  const xs = res.points.map(p => p.param), ys = res.points.map(p => p.value);
  drawChart($('#sp-chart'), {
    t: xs, xlabel: param, threshold,
    lines: [{ name: `${output} ${metric === 'peak' ? '첨두' : '최종'}`, color: '#37c2ff', values: ys }],
    vmarks: res.tipping != null ? [{ x: res.tipping, color: '#ffd24a', label: `임계 ${param}≈${fmt(res.tipping)}` }] : [],
  });
  $('#an-result').textContent = res.tipping != null
    ? `⚠ 임계점: ${param} ≈ ${fmt(res.tipping)} 부터 ${output} ${metric === 'peak' ? '첨두' : '최종'}이 붕괴 임계(${threshold})를 초과/발산합니다.`
    : `이 범위(${fmt(from)}~${fmt(to)})에서는 붕괴 임계를 넘지 않습니다 — 안정 구간.`;
  analysisMode = true; $('#an-back').style.display = ''; $('#sp-legend').style.display = 'none';
}
function backToTime() { analysisMode = false; $('#an-back').style.display = 'none'; $('#sp-legend').style.display = ''; drawSim(); }

// ---- 시나리오 저장/내보내기 ----
function saveScn(asFile) {
  if (!simResult) runSim();
  const name = ($('#scn-name').value.trim()) || ('시나리오_' + (Object.keys(listScenarios()).length + 1));
  const map = { waterLevel: $('#scn-wl').value, risk: $('#scn-risk').value };
  const scn = buildScenario(name, simResult, map, 'step');
  saveScenario(scn);
  renderScnList();
  if (asFile) download(name.replace(/\s+/g, '_') + '.json', JSON.stringify(scn, null, 2));
  alert(`시나리오 "${name}" 저장 완료.\n· 트윈에서: index.html?scenario=${encodeURIComponent(name)}\n· JSON 파일은 web/data/scenarios/ 에 보관하면 배포본에도 포함됩니다.`);
}
function renderScnList() {
  const box = $('#scn-list'); if (!box) return;
  const all = listScenarios(); const names = Object.keys(all);
  box.innerHTML = '';
  if (!names.length) { box.innerHTML = '<div class="empty">저장된 시나리오가 없습니다. 시뮬 실행 후 “시나리오 저장”.</div>'; return; }
  for (const nm of names) {
    const s = all[nm];
    const div = document.createElement('div'); div.className = 'scn-item';
    const wl = s.waterLevel?.length ? Math.max(...s.waterLevel).toFixed(1) : '-';
    div.innerHTML = `<span class="nm">${esc(nm)}</span>
      <span class="meta">${s.t.length}스텝 · 최대수위 ${wl}m · 수위:${esc(s.map?.waterLevel || '-')} 위험:${esc(s.map?.risk || '-')}</span>
      <a href="./index.html?scenario=${encodeURIComponent(nm)}" target="_blank">트윈 →</a>
      <button class="rm">삭제</button>`;
    div.querySelector('.rm').addEventListener('click', () => { removeScenario(nm); renderScnList(); });
    box.appendChild(div);
  }
}

$('#btn-sim').addEventListener('click', () => { openSim(); refreshSelects(); renderScnList(); });
$('#sp-run').addEventListener('click', runSim);
$('#sp-close').addEventListener('click', () => $('#simpanel').classList.add('hidden'));
$('#sp-norm').addEventListener('change', () => analysisMode ? null : drawSim());
$('#an-run').addEventListener('click', runAnalysis);
$('#an-back').addEventListener('click', backToTime);
$('#an-showthr').addEventListener('change', () => { if (!analysisMode) drawSim(); });
$('#an-out').addEventListener('change', () => { if (!analysisMode) drawSim(); });
$('#an-thr').addEventListener('input', () => { if (!analysisMode) drawSim(); });
$('#scn-save').addEventListener('click', () => saveScn(false));
$('#scn-download').addEventListener('click', () => saveScn(true));
addEventListener('resize', () => { if (!$('#simpanel').classList.contains('hidden') && !analysisMode) drawSim(); });

// ================= init =================
render();
// 첫 렌더 후 카메라를 콘텐츠 중앙으로
(function centerView() {
  if (!model.nodes.length) return;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const n of model.nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
  const r = svg.getBoundingClientRect();
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  view.k = clamp(Math.min(r.width / (maxX - minX + 240), r.height / (maxY - minY + 240)), 0.4, 1.2);
  view.x = r.width / 2 - cx * view.k; view.y = r.height / 2 - cy * view.k;
  applyView();
})();
