// 시나리오 저장소 — 편집기(cld.html)와 트윈(index.html)이 공유 (동일 origin localStorage)
// 시나리오 JSON 계약:
//   { name, dt, unit, t:[...], waterLevel:[...](트윈 침수심 m), risk:[...](0~1), series:{...} }
const KEY = 'redilab-scenarios';

// 시뮬 결과 + 매핑 -> 시나리오 객체
export function buildScenario(name, sim, map, unit = 'hour') {
  return {
    name,
    dt: sim.dt, unit,
    t: sim.t.slice(),
    waterLevel: map.waterLevel && sim.series[map.waterLevel] ? sim.series[map.waterLevel].slice() : [],
    risk: map.risk && sim.series[map.risk] ? sim.series[map.risk].slice() : [],
    map: { waterLevel: map.waterLevel || null, risk: map.risk || null },
    series: Object.fromEntries(Object.entries(sim.series).map(([k, v]) => [k, v.slice()])),
  };
}

export function listScenarios() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveScenario(scn) {
  const all = listScenarios(); all[scn.name] = scn;
  try { localStorage.setItem(KEY, JSON.stringify(all)); }
  catch (e) { console.warn('시나리오 저장 실패(용량)', e); }
}
export function getScenario(name) { return listScenarios()[name] || null; }
export function removeScenario(name) {
  const all = listScenarios(); delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
}
