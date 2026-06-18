// CSV 파서 + 데이터셋 저장소 (의존성 0)
// 노드는 model.js의 node.csv = {dataset, column, role} 로 데이터를 참조한다.
//   role: 'driver'(시계열 입력) | 'observed'(관측·검증)
// 단일 상수/초기값은 node.value(수동)로 둔다.

const LS_KEY = 'redilab-cld-datasets';

// ---------- 파싱 ----------
// 따옴표·콤마·CRLF·BOM 처리하는 미니 CSV 파서
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter(r => r.length && !(r.length === 1 && r[0].trim() === ''));
  const columns = clean.length ? clean[0].map(s => s.trim()) : [];
  return { columns, rows: clean.slice(1) };
}

const TIME_PAT = /^(time|t|시간|hour|hr|min|분|날짜|date|datetime|step|스텝|연도|year|일자)$/i;
function detectTimeColumn(cols) {
  const i = cols.findIndex(c => TIME_PAT.test((c || '').trim()));
  return i;
}

export function makeDataset(name, parsed) {
  const ti = detectTimeColumn(parsed.columns);
  return {
    name, columns: parsed.columns, rows: parsed.rows,
    timeCol: ti >= 0 ? parsed.columns[ti] : null,
  };
}

// 컬럼 → 숫자 배열 (파싱 실패시 NaN)
export function columnValues(ds, col) {
  const idx = ds.columns.indexOf(col);
  if (idx < 0) return [];
  return ds.rows.map(r => {
    const v = parseFloat((r[idx] || '').replace(/,/g, ''));
    return isFinite(v) ? v : NaN;
  });
}

// 시간축 (timeCol 없으면 행 인덱스 0,1,2,…)
export function timeValues(ds) {
  if (!ds.timeCol) return ds.rows.map((_, i) => i);
  const v = columnValues(ds, ds.timeCol);
  return v.map((x, i) => isFinite(x) ? x : i);
}

// ---------- 저장소 ----------
const store = new Map();   // name -> dataset

export function addDataset(ds) {
  let name = ds.name, n = 1;
  while (store.has(name)) name = ds.name.replace(/\.csv$/i, '') + ' (' + (++n) + ')';
  ds.name = name; store.set(name, ds); saveDatasets();
  return name;
}
export function listDatasets() { return [...store.values()]; }
export function getDataset(name) { return store.get(name); }
export function removeDataset(name) { store.delete(name); saveDatasets(); }

function saveDatasets() {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...store.values()])); }
  catch (e) { console.warn('데이터셋 저장 실패(용량 초과 가능) — 메모리에는 유지됨', e); }
}
export function loadDatasets() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    store.clear();
    for (const d of arr) store.set(d.name, d);
  } catch {}
  return listDatasets();
}
