// 임계점(tipping point) · 붕괴 분석
import { fromJSON, toJSON } from './model.js';
import { simulate } from './sim.js';

// 시계열에서 임계값 최초 초과 시점(붕괴 시점) 찾기. 없으면 null.
export function crossingTime(t, series, threshold) {
  for (let i = 0; i < series.length; i++) {
    if (isFinite(series[i]) && series[i] >= threshold) {
      if (i === 0) return t[0];
      // 선형보간으로 교차 시각 추정
      const a = series[i - 1], b = series[i];
      const f = (threshold - a) / ((b - a) || 1);
      return t[i - 1] + (t[i] - t[i - 1]) * f;
    }
  }
  return null;
}

// 발산(붕괴) 여부: 비유한 값이거나, 꼬리가 계속 가파르게 상승.
export function isDiverging(series) {
  const n = series.length; if (n < 4) return false;
  const last = series[n - 1];
  if (!isFinite(last)) return true;
  const k = Math.max(2, Math.floor(n * 0.15));
  const slope = (series[n - 1] - series[n - 1 - k]) / k;
  const scale = Math.max(1e-9, Math.abs(series[n - 1]));
  return slope > 0.01 * scale && last >= Math.max(...series) - 1e-9;  // 끝에서 여전히 상승=미수렴
}

// 파라미터 스윕: param 노드값을 from~to로 훑어 output 지표(peak|final)를 계산.
// 반환 { points:[{param,value,crossed,diverging}], tipping, simAt(v) }
export function sweep(model, { param, from, to, steps, output, metric = 'peak', threshold, simOpts = {} }) {
  const base = toJSON(model);
  const points = [];
  let tipping = null;
  for (let i = 0; i <= steps; i++) {
    const v = from + (to - from) * i / steps;
    const m2 = fromJSON(base);
    const node = m2.nodes.find(n => n.name === param);
    if (node) node.value = v;
    const sim = simulate(m2, simOpts);
    const s = sim.series[output] || [];
    const value = metric === 'final' ? s[s.length - 1] : Math.max(...s);
    const diverging = isDiverging(s);
    const crossed = threshold != null && value >= threshold;
    points.push({ param: v, value, crossed, diverging });
    if (tipping == null && (crossed || diverging)) tipping = v;
  }
  return { points, tipping };
}
