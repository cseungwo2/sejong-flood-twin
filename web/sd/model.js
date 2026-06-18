// SD/CLD 모델 자료구조 + 직렬화 + 피드백 루프 감지
// 트윈과 분리된 순수 데이터 계층 (DOM 의존 없음). Phase3 정량화를 위해
// 노드에 type/value/eq/unit 필드를 미리 예약해 둔다.

export const NODE_TYPES = {
  aux:   { ko: '보조변수', shape: 'round' },   // 일반 변수(기본)
  stock: { ko: '저장(Stock)', shape: 'box' },  // 적분 대상
  flow:  { ko: '흐름(Flow)', shape: 'valve' }, // 변화율
  const: { ko: '상수', shape: 'pill' },        // 고정 파라미터
};

export function createModel() {
  return { name: '새 인과지도', nodes: [], links: [], _id: 0 };
}

export function addNode(model, x, y, opts = {}) {
  const id = 'n' + (++model._id);
  model.nodes.push({
    id,
    name: opts.name || '변수',
    type: opts.type || 'aux',
    x: Math.round(x), y: Math.round(y),
    value: opts.value ?? null,   // 초기값/상수 (Phase3)
    eq: opts.eq ?? '',           // 수식 (Phase3)
    unit: opts.unit ?? '',
    csv: opts.csv ?? null,       // CSV 바인딩 {file,column,role} (Phase2)
  });
  return id;
}

export function getNode(model, id) { return model.nodes.find(n => n.id === id); }

export function removeNode(model, id) {
  model.nodes = model.nodes.filter(n => n.id !== id);
  model.links = model.links.filter(l => l.from !== id && l.to !== id);
}

// 인과링크 추가. 자기참조/중복 방지. sign: +1 강화, -1 약화.
export function addLink(model, from, to, sign = 1) {
  if (from === to) return null;
  if (model.links.some(l => l.from === from && l.to === to)) return null;
  const id = 'l' + (++model._id);
  model.links.push({ id, from, to, sign });
  return id;
}

export function removeLink(model, id) {
  model.links = model.links.filter(l => l.id !== id);
}

export function getLink(model, id) { return model.links.find(l => l.id === id); }

// ---------- 직렬화 ----------
export function toJSON(model) {
  return JSON.stringify({
    name: model.name,
    nodes: model.nodes,
    links: model.links,
    _id: model._id,
  }, null, 2);
}

export function fromJSON(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  const model = createModel();
  model.name = o.name || '불러온 모델';
  model.nodes = (o.nodes || []).map(n => ({
    id: n.id, name: n.name ?? '변수', type: n.type || 'aux',
    x: n.x || 0, y: n.y || 0,
    value: n.value ?? null, eq: n.eq ?? '', unit: n.unit ?? '', csv: n.csv ?? null,
  }));
  model.links = (o.links || []).map(l => ({
    id: l.id, from: l.from, to: l.to, sign: l.sign === -1 ? -1 : 1,
  }));
  // _id 재계산 (id 충돌 방지)
  let max = 0;
  for (const x of [...model.nodes, ...model.links]) {
    const m = /(\d+)$/.exec(x.id || ''); if (m) max = Math.max(max, +m[1]);
  }
  model._id = Math.max(o._id || 0, max);
  return model;
}

// ---------- 피드백 루프 감지 ----------
// 유향 그래프의 단순 순환(simple cycle)을 열거한다. 회전 중복을 막기 위해
// "사이클 내 최소 인덱스 노드"에서 시작하는 경로만 채택. 폴라리티 곱이
// 양수면 R(자기강화), 음수면 B(균형). 폭증 방지를 위해 상한을 둔다.
export function detectLoops(model, { maxLoops = 200, maxLen = 12 } = {}) {
  const ids = model.nodes.map(n => n.id);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const adj = new Map(ids.map(id => [id, []]));
  for (const l of model.links) if (adj.has(l.from)) adj.get(l.from).push(l);

  const loops = [];
  for (const start of ids) {
    if (loops.length >= maxLoops) break;
    const startIdx = indexOf.get(start);
    const stack = [start];
    const onStack = new Set([start]);

    (function dfs(u, prod, depth) {
      if (loops.length >= maxLoops || depth > maxLen) return;
      for (const l of adj.get(u)) {
        const v = l.to;
        if (v === start) {
          const sign = prod * (l.sign || 1);
          loops.push({
            nodes: [...stack],
            links: [...stack].map((nid, i) => {
              const next = i + 1 < stack.length ? stack[i + 1] : start;
              return model.links.find(x => x.from === nid && x.to === next)?.id;
            }),
            polarity: sign > 0 ? 'R' : 'B',
          });
          if (loops.length >= maxLoops) return;
          continue;
        }
        if (indexOf.get(v) < startIdx) continue;   // 정규형: 최소 인덱스에서만 시작
        if (onStack.has(v)) continue;
        stack.push(v); onStack.add(v);
        dfs(v, prod * (l.sign || 1), depth + 1);
        stack.pop(); onStack.delete(v);
      }
    })(start, 1, 1);
  }
  return loops;
}
