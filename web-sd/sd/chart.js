// 경량 SVG 라인차트 (의존성 0)
const NS = 'http://www.w3.org/2000/svg';
const E = (t, a = {}) => { const n = document.createElementNS(NS, t);
  for (const k in a) if (a[k] != null) n.setAttribute(k, a[k]); return n; };

export const PALETTE = ['#37c2ff', '#46e3b1', '#ffd24a', '#ff7a7a', '#c060ff', '#7ee0ff', '#ff9e3d', '#43c6ff'];

// svg: <svg> 요소. data: { t:[...], lines:[{name,color,values,dashed}], normalize, xlabel }
export function drawChart(svg, data) {
  const W = svg.clientWidth || 600, H = svg.clientHeight || 240;
  const m = { l: 46, r: 12, t: 12, b: 28 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const { t, lines, normalize, xlabel } = data;
  if (!t || !t.length || !lines.length) {
    svg.appendChild(text(W / 2, H / 2, '시뮬레이션을 실행하면 결과가 표시됩니다', 'mid', '#5f7488'));
    return;
  }
  const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
  const xmin = t[0], xmax = t[t.length - 1] || 1;

  // y 범위
  const norm = lines.map(L => {
    if (!normalize) return L.values;
    const lo = Math.min(...L.values), hi = Math.max(...L.values), d = hi - lo || 1;
    return L.values.map(v => (v - lo) / d);
  });
  let ymin = Infinity, ymax = -Infinity;
  for (const vs of norm) for (const v of vs) { if (isFinite(v)) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); } }
  if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
  if (data.threshold != null && !normalize) { ymin = Math.min(ymin, data.threshold); ymax = Math.max(ymax, data.threshold); }
  if (ymin === ymax) { ymax = ymin + 1; }
  ymin = Math.min(ymin, 0);

  const X = v => m.l + (v - xmin) / (xmax - xmin || 1) * plotW;
  const Y = v => m.t + plotH - (v - ymin) / (ymax - ymin || 1) * plotH;

  // 그리드 + y눈금
  for (let i = 0; i <= 4; i++) {
    const yv = ymin + (ymax - ymin) * i / 4, yy = Y(yv);
    svg.appendChild(E('line', { x1: m.l, y1: yy, x2: W - m.r, y2: yy, stroke: 'rgba(255,255,255,.07)' }));
    svg.appendChild(text(m.l - 6, yy + 3, fmt(yv), 'end', '#5f7488', 10));
  }
  // x눈금
  const xt = 5;
  for (let i = 0; i <= xt; i++) {
    const xv = xmin + (xmax - xmin) * i / xt, xx = X(xv);
    svg.appendChild(text(xx, H - 10, fmt(xv), 'mid', '#5f7488', 10));
  }
  if (xlabel) svg.appendChild(text(W - m.r, H - 10, xlabel, 'end', '#5f7488', 10));

  // 임계선 (붕괴 임계값)
  if (data.threshold != null && !normalize) {
    const yy = Y(data.threshold);
    svg.appendChild(E('line', { x1: m.l, y1: yy, x2: W - m.r, y2: yy,
      stroke: '#ff7a7a', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', opacity: .8 }));
    svg.appendChild(text(W - m.r - 2, yy - 4, '붕괴 임계 ' + fmt(data.threshold), 'end', '#ff7a7a', 10));
  }
  // 수직 마커 (붕괴시점 / 임계 파라미터)
  for (const vm of (data.vmarks || [])) {
    const xx = X(vm.x);
    svg.appendChild(E('line', { x1: xx, y1: m.t, x2: xx, y2: m.t + plotH,
      stroke: vm.color || '#ffd24a', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    if (vm.label) svg.appendChild(text(xx + 3, m.t + 11, vm.label, 'start', vm.color || '#ffd24a', 10));
  }
  // 라인
  lines.forEach((L, i) => {
    const vs = norm[i];
    let d = '';
    for (let k = 0; k < t.length; k++) {
      if (!isFinite(vs[k])) continue;
      d += (d ? ' L ' : 'M ') + X(t[k]).toFixed(1) + ' ' + Y(vs[k]).toFixed(1);
    }
    svg.appendChild(E('path', { d, fill: 'none', stroke: L.color, 'stroke-width': 2,
      'stroke-dasharray': L.dashed ? '5 4' : null, 'stroke-linejoin': 'round' }));
  });
}

function text(x, y, s, anchor, fill, size = 11) {
  const t = E('text', { x, y, fill, 'font-size': size, 'font-family': 'Pretendard, sans-serif' });
  t.setAttribute('text-anchor', anchor === 'mid' ? 'middle' : anchor === 'end' ? 'end' : 'start');
  t.textContent = s; return t;
}
function fmt(x) {
  if (!isFinite(x)) return '';
  const a = Math.abs(x);
  if (a >= 1000) return (x / 1000).toFixed(1) + 'k';
  if (a >= 10 || a === 0) return x.toFixed(0);
  return x.toFixed(a < 1 ? 2 : 1);
}
