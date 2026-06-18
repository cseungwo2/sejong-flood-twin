// 정량 SD 시뮬레이션 엔진 — 안전한 수식 파서(eval 미사용) + 시간적분
//
// 노드 의미:
//   const  : 고정값 = node.value
//   driver : CSV 시계열(node.csv.role==='driver') 을 시간 보간해 입력
//   aux/flow: node.eq(수식)을 매 스텝 평가. eq 비면 node.value 상수 취급
//   stock  : 상태량. 초기값 = node.value, 순변화율 = node.eq 평가값을 적분
//
// 수식은 다른 노드를 "이름"으로 참조. 함수: min,max,abs,exp,sqrt,ln,pow,clamp.
import { getDataset, columnValues, timeValues } from './csv.js';

// ---------- 수식 컴파일 ----------
// expr 문자열 -> (scope)=>number 클로저. names: 심볼표 키(길이 내림차순).
export function compile(expr, names) {
  const toks = tokenize(expr, names);
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = next().t, rhs = parseTerm();
      const a = node, b = rhs; node = op === '+' ? s => a(s) + b(s) : s => a(s) - b(s);
    }
    return node;
  }
  function parseTerm() {
    let node = parseFactor();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = next().t, rhs = parseFactor();
      const a = node, b = rhs; node = op === '*' ? s => a(s) * b(s) : s => a(s) / b(s);
    }
    return node;
  }
  function parseFactor() {
    if (peek() && peek().t === '-') { next(); const f = parseFactor(); return s => -f(s); }
    if (peek() && peek().t === '+') { next(); return parseFactor(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = next();
    if (!tk) throw new Error('수식이 비었거나 잘렸습니다');
    if (tk.t === 'num') { const v = tk.v; return () => v; }
    if (tk.t === 'var') { const nm = tk.v; return s => (nm in s ? s[nm] : 0); }
    if (tk.t === '(') { const e = parseExpr(); expect(')'); return e; }
    if (tk.t === 'fn') {
      expect('('); const args = [parseExpr()];
      while (peek() && peek().t === ',') { next(); args.push(parseExpr()); }
      expect(')');
      const fn = FUNCS[tk.v]; if (!fn) throw new Error(`알 수 없는 함수/변수: ${tk.v}`);
      return s => fn(...args.map(a => a(s)));
    }
    throw new Error('예기치 못한 토큰: ' + JSON.stringify(tk));
  }
  function expect(t) { const tk = next(); if (!tk || tk.t !== t) throw new Error(`'${t}' 가 필요합니다`); }
  const fn = parseExpr();
  if (p < toks.length) throw new Error('수식 끝에 남은 토큰: ' + JSON.stringify(toks[p]));
  return fn;
}

const FUNCS = {
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  abs: Math.abs, exp: Math.exp, sqrt: Math.sqrt, ln: Math.log,
  pow: (a, b) => Math.pow(a, b),
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
};

function tokenize(expr, names) {
  const toks = []; let i = 0; const isNum = c => c >= '0' && c <= '9';
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if ('+-*/(),'.includes(c)) { toks.push({ t: c }); i++; continue; }
    if (isNum(c) || (c === '.' && isNum(expr[i + 1]))) {
      let j = i + 1; while (j < expr.length && (isNum(expr[j]) || expr[j] === '.')) j++;
      toks.push({ t: 'num', v: parseFloat(expr.slice(i, j)) }); i = j; continue;
    }
    let matched = null;                       // 변수: 심볼표 최장일치
    for (const nm of names) { if (nm && expr.startsWith(nm, i)) { matched = nm; break; } }
    if (matched) { toks.push({ t: 'var', v: matched }); i += matched.length; continue; }
    let j = i;                                // 함수 식별자
    while (j < expr.length && /[A-Za-z_]/.test(expr[j])) j++;
    if (j > i) { toks.push({ t: 'fn', v: expr.slice(i, j).toLowerCase() }); i = j; continue; }
    throw new Error('해석 불가 문자: "' + expr.slice(i, i + 8) + '"');
  }
  return toks;
}

// ---------- 시계열 보간 ----------
function lerp(ts, vs, t) {
  if (!ts.length) return 0;
  if (t <= ts[0]) return vs[0];
  if (t >= ts[ts.length - 1]) return vs[vs.length - 1];
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  const f = (t - ts[lo]) / ((ts[hi] - ts[lo]) || 1);
  return vs[lo] + (vs[hi] - vs[lo]) * f;
}

// ---------- 시뮬레이션 ----------
// 반환: { t:[...], series:{ [nodeName]:[...] }, warnings:[...] }
export function simulate(model, opts = {}) {
  const warnings = [];
  const nodes = model.nodes;
  const byName = new Map();
  for (const n of nodes) {
    if (!n.name) continue;
    if (byName.has(n.name)) warnings.push(`이름 중복: "${n.name}" (뒤엣것이 우선)`);
    byName.set(n.name, n);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);

  const isDriver = n => n.csv && n.csv.role === 'driver';
  const drivers = new Map();   // id -> {ts, vs}
  for (const n of nodes) {
    if (!isDriver(n)) continue;
    const ds = getDataset(n.csv.dataset);
    if (!ds) { warnings.push(`드라이버 데이터셋 없음: ${n.name}`); continue; }
    drivers.set(n.id, { ts: timeValues(ds), vs: columnValues(ds, n.csv.column) });
  }

  // 시간축
  let dt = +opts.dt || 1;
  let steps = opts.steps;
  if (!steps) {                 // 드라이버 시계열 길이에서 자동 결정
    let span = 0;
    for (const d of drivers.values()) if (d.ts.length) span = Math.max(span, d.ts[d.ts.length - 1]);
    steps = span ? Math.round(span / dt) : 24;
  }
  const t0 = +opts.t0 || 0;

  // 컴파일
  const stocks = nodes.filter(n => n.type === 'stock');
  const compiled = new Map();   // id -> fn
  for (const n of nodes) {
    const usesEq = n.type === 'stock' ? n.eq : (!isDriver(n) && n.type !== 'const' && n.eq);
    if (usesEq && n.eq.trim()) {
      try { compiled.set(n.id, compile(n.eq, names)); }
      catch (e) { warnings.push(`수식 오류 [${n.name}]: ${e.message}`); compiled.set(n.id, () => NaN); }
    }
  }

  // aux/flow 평가 순서(의존성 토폴로지). 사이클이면 모델 순서 사용.
  const evalNodes = nodes.filter(n => n.type !== 'stock');
  const order = topoOrder(evalNodes, byName, isDriver, warnings);

  // 초기 상태
  const stockVal = new Map();
  for (const s of stocks) stockVal.set(s.id, +s.value || 0);

  const t = [], series = {};
  for (const n of nodes) series[n.name] = [];

  for (let k = 0; k <= steps; k++) {
    const time = t0 + k * dt;
    const scope = {};
    // 1) stocks (상태)
    for (const s of stocks) scope[s.name] = stockVal.get(s.id);
    // 2) const / driver
    for (const n of evalNodes) {
      if (isDriver(n)) { const d = drivers.get(n.id); scope[n.name] = d ? lerp(d.ts, d.vs, time) : 0; }
      else if (n.type === 'const') scope[n.name] = +n.value || 0;
    }
    // 3) aux/flow (토폴로지 순)
    for (const n of order) {
      if (isDriver(n) || n.type === 'const') continue;
      const fn = compiled.get(n.id);
      scope[n.name] = fn ? fn(scope) : (n.value != null ? +n.value : 0);
    }
    // 기록
    t.push(time);
    for (const n of nodes) series[n.name].push(scope[n.name] ?? 0);
    // 4) stock 적분 (Euler)
    if (k < steps) for (const s of stocks) {
      const fn = compiled.get(s.id); const rate = fn ? fn(scope) : 0;
      stockVal.set(s.id, stockVal.get(s.id) + dt * (isFinite(rate) ? rate : 0));
    }
  }
  return { t, series, warnings, dt, steps };
}

// aux/flow 의존성 토폴로지 정렬
function topoOrder(evalNodes, byName, isDriver, warnings) {
  const deps = new Map();   // node -> Set(dep node)
  for (const n of evalNodes) {
    const set = new Set();
    if (!isDriver(n) && n.type !== 'const' && n.eq) {
      for (const nm of refsIn(n.eq, byName)) {
        const dn = byName.get(nm);
        if (dn && dn.type !== 'stock' && dn !== n) set.add(dn);
      }
    }
    deps.set(n, set);
  }
  const order = [], done = new Set(), temp = new Set();
  let cyclic = false;
  const visit = n => {
    if (done.has(n)) return; if (temp.has(n)) { cyclic = true; return; }
    temp.add(n); for (const d of deps.get(n)) visit(d); temp.delete(n); done.add(n); order.push(n);
  };
  for (const n of evalNodes) visit(n);
  if (cyclic) warnings.push('대수 루프(즉시 인과 순환) 감지 — 평가 순서가 근사될 수 있습니다');
  return order;
}

// 수식에서 참조하는 변수명 추출(심볼표 최장일치)
function refsIn(expr, byName) {
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const found = new Set(); let i = 0;
  while (i < expr.length) {
    let m = null;
    for (const nm of names) { if (nm && expr.startsWith(nm, i)) { m = nm; break; } }
    if (m) { found.add(m); i += m.length; } else i++;
  }
  return found;
}
