# cld-studio Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다운로드해 더블클릭하면 켜지는 데스크톱 CLD 편집기 — 변수·인과링크·극성 작도, 피드백 루프 자동 식별, `.cld.json` 저장/열기까지 동작하는 실행 가능한 v1 골격.

**Architecture:** Electron 2-프로세스(Main = 창·메뉴·파일IO, Renderer = SVG 편집기). 세종 트윈에서 검증된 `web-sd/sd/` 엔진(model·editor SVG)을 바닐라 ESM 모듈로 이식하고, 세종/시뮬/CSV/트윈 UI는 제거. 순수 로직(model·loop detection)은 vitest로 TDD.

**Tech Stack:** Electron, 바닐라 JS(ES Modules, 프레임워크 없음), vitest(단위 테스트). 패키징(electron-builder)·출력·Vensim import는 후속 마일스톤.

## Global Constraints

- 대상 OS: Windows (개발·실행 모두). Node 24 LTS, npm 11.
- 프레임워크 금지 — 바닐라 JS + ESM만. SVG 직접 조작.
- 시뮬레이션/CSV/세종/트윈 UI는 v1에서 제외(원본 코드는 `web-sd/`에 보존, 복사 안 함).
- 저장 포맷: `{ "format": "cld-studio", "version": 1, "meta": {...}, "nodes": [...], "links": [...] }`.
- 링크 극성: `sign` = `+1`(강화) | `-1`(약화). 루프 극성: 부호곱 양수 `R`, 음수 `B`.
- 새 레포 위치: `C:\Users\tmddd\cld-studio` (이 플랜 Task 1에서 생성).
- 커밋은 각 Task 끝에서. 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: 프로젝트 스캐폴딩 — 빈 Electron 창 실행

**Files:**
- Create: `cld-studio/package.json`
- Create: `cld-studio/src/main/main.js`
- Create: `cld-studio/src/main/preload.js`
- Create: `cld-studio/src/renderer/index.html`
- Create: `cld-studio/.gitignore`

**Interfaces:**
- Produces: `npm run dev` → Electron 창이 뜨고 "cld-studio" 텍스트 표시. main이 `src/renderer/index.html` 로드.

- [ ] **Step 1: 폴더 생성 및 git 초기화**

```bash
mkdir -p /c/Users/tmddd/cld-studio/src/main /c/Users/tmddd/cld-studio/src/renderer/core /c/Users/tmddd/cld-studio/src/renderer/io /c/Users/tmddd/cld-studio/src/renderer/ui /c/Users/tmddd/cld-studio/test/fixtures /c/Users/tmddd/cld-studio/assets
cd /c/Users/tmddd/cld-studio && git init && git config user.name "cseungwo2" && git config user.email "wlstjd400@gmail.com"
```

- [ ] **Step 2: `.gitignore` 작성**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: `package.json` 작성**

```json
{
  "name": "cld-studio",
  "version": "0.1.0",
  "description": "범용 CLD(인과지도) 저작 도구",
  "type": "module",
  "main": "src/main/main.js",
  "scripts": {
    "dev": "electron .",
    "test": "vitest run"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: `src/main/main.js` 작성**

```js
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820,
    backgroundColor: '#0a1422',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
```

- [ ] **Step 5: `src/main/preload.js` 작성 (지금은 빈 브리지)**

```js
// 보안 브리지 — Task 5에서 파일 IO API를 노출한다. 지금은 자리만 잡는다.
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('cld', {});
```

- [ ] **Step 6: `src/renderer/index.html` 작성 (최소 셸)**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline';" />
  <title>cld-studio</title>
  <style> html,body{margin:0;height:100%;background:#0a1422;color:#e6eef7;
    font-family:system-ui,sans-serif;display:grid;place-items:center} </style>
</head>
<body>
  <div>cld-studio — 부팅 OK</div>
</body>
</html>
```

- [ ] **Step 7: 의존성 설치**

Run: `cd /c/Users/tmddd/cld-studio && npm install`
Expected: electron·vitest 설치 완료, `node_modules/` 생성.

- [ ] **Step 8: 실행 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm run dev`
Expected: Electron 창이 뜨고 "cld-studio — 부팅 OK" 표시. (창 닫으면 프로세스 종료)

- [ ] **Step 9: 커밋**

```bash
cd /c/Users/tmddd/cld-studio && git add -A && git commit -m "chore: Electron 스캐폴딩 — 빈 창 실행"
```

---

### Task 2: 코어 데이터 모델 + 루프 감지 (TDD)

**Files:**
- Create: `cld-studio/src/renderer/core/model.js`
- Create: `cld-studio/test/model.test.js`
- Create: `cld-studio/vitest.config.js`

**Interfaces:**
- Produces:
  - `createModel() → { name, nodes:[], links:[], _id:0 }`
  - `addNode(model, x, y, opts) → id('n#')`; node `{ id, name, type, x, y, labelPos:null }`
  - `addLink(model, from, to, sign=1) → id('l#') | null`(자기참조·중복 시 null); link `{ id, from, to, sign, curv:null }`
  - `getNode(model,id)`, `getLink(model,id)`, `removeNode(model,id)`, `removeLink(model,id)`
  - `toJSON(model) → string`(format/version/meta 포함), `fromJSON(text) → model`
  - `detectLoops(model,{maxLoops,maxLen}) → [{ nodes:[id], links:[id], polarity:'R'|'B' }]`
  - `NODE_TYPES` = `{ aux, stock, flow, const }`

- [ ] **Step 1: `vitest.config.js` 작성**

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.js'] } });
```

- [ ] **Step 2: 실패하는 테스트 작성 — `test/model.test.js`**

```js
import { describe, it, expect } from 'vitest';
import {
  createModel, addNode, addLink, getNode, removeNode, removeLink,
  toJSON, fromJSON, detectLoops,
} from '../src/renderer/core/model.js';

describe('model 기본 연산', () => {
  it('노드를 추가하고 좌표/기본필드를 가진다', () => {
    const m = createModel();
    const id = addNode(m, 10.4, 20.6, { name: '강우' });
    const n = getNode(m, id);
    expect(n.name).toBe('강우');
    expect(n.type).toBe('aux');
    expect(n).toMatchObject({ x: 10, y: 21 });   // 반올림
    expect(n.labelPos).toBeNull();
  });

  it('링크는 자기참조와 중복을 막는다', () => {
    const m = createModel();
    const a = addNode(m, 0, 0, {}), b = addNode(m, 1, 1, {});
    expect(addLink(m, a, a, 1)).toBeNull();
    const l = addLink(m, a, b, -1);
    expect(getLink(m, l).sign).toBe(-1);
    expect(addLink(m, a, b, 1)).toBeNull();        // 중복
  });

  it('노드 삭제 시 연결된 링크도 사라진다', () => {
    const m = createModel();
    const a = addNode(m, 0, 0, {}), b = addNode(m, 1, 1, {});
    addLink(m, a, b, 1);
    removeNode(m, a);
    expect(m.links.length).toBe(0);
  });
});

describe('직렬화', () => {
  it('toJSON은 format/version을 포함하고 fromJSON으로 왕복된다', () => {
    const m = createModel();
    m.name = '테스트'; addNode(m, 5, 5, { name: 'A' });
    const json = JSON.parse(toJSON(m));
    expect(json.format).toBe('cld-studio');
    expect(json.version).toBe(1);
    const back = fromJSON(toJSON(m));
    expect(back.nodes[0].name).toBe('A');
  });
});

describe('피드백 루프 감지', () => {
  it('양의 2-노드 루프는 R', () => {
    const m = createModel();
    const a = addNode(m, 0, 0, {}), b = addNode(m, 1, 0, {});
    addLink(m, a, b, 1); addLink(m, b, a, 1);
    const loops = detectLoops(m);
    expect(loops.length).toBe(1);
    expect(loops[0].polarity).toBe('R');
  });

  it('음의 링크가 하나면 B', () => {
    const m = createModel();
    const a = addNode(m, 0, 0, {}), b = addNode(m, 1, 0, {});
    addLink(m, a, b, 1); addLink(m, b, a, -1);
    expect(detectLoops(m)[0].polarity).toBe('B');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm test`
Expected: FAIL — `model.js` 모듈 없음(import 에러).

- [ ] **Step 4: `src/renderer/core/model.js` 구현**

`web-sd/sd/model.js`를 기반으로 이식하되 다음을 변경한다:
- node에 `labelPos: opts.labelPos ?? null` 추가, link에 `curv: opts.curv ?? null` 추가.
- Phase2 예약 필드(`value/eq/unit/csv`)는 **제거**(v1 스키마 단순화).
- `toJSON`을 새 포맷으로 교체.

```js
export const NODE_TYPES = {
  aux:   { ko: '보조변수', shape: 'round' },
  stock: { ko: '저장(Stock)', shape: 'box' },
  flow:  { ko: '흐름(Flow)', shape: 'valve' },
  const: { ko: '상수', shape: 'pill' },
};

export function createModel() {
  return { name: '새 인과지도', nodes: [], links: [], _id: 0, meta: {} };
}

export function addNode(model, x, y, opts = {}) {
  const id = 'n' + (++model._id);
  model.nodes.push({
    id, name: opts.name || '변수', type: opts.type || 'aux',
    x: Math.round(x), y: Math.round(y), labelPos: opts.labelPos ?? null,
  });
  return id;
}
export function getNode(model, id) { return model.nodes.find(n => n.id === id); }
export function removeNode(model, id) {
  model.nodes = model.nodes.filter(n => n.id !== id);
  model.links = model.links.filter(l => l.from !== id && l.to !== id);
}
export function addLink(model, from, to, sign = 1) {
  if (from === to) return null;
  if (model.links.some(l => l.from === from && l.to === to)) return null;
  const id = 'l' + (++model._id);
  model.links.push({ id, from, to, sign, curv: null });
  return id;
}
export function removeLink(model, id) { model.links = model.links.filter(l => l.id !== id); }
export function getLink(model, id) { return model.links.find(l => l.id === id); }

export function toJSON(model) {
  return JSON.stringify({
    format: 'cld-studio', version: 1,
    meta: model.meta || {}, name: model.name,
    nodes: model.nodes, links: model.links, _id: model._id,
  }, null, 2);
}
export function fromJSON(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  const model = createModel();
  model.name = o.name || '불러온 모델';
  model.meta = o.meta || {};
  model.nodes = (o.nodes || []).map(n => ({
    id: n.id, name: n.name ?? '변수', type: n.type || 'aux',
    x: n.x || 0, y: n.y || 0, labelPos: n.labelPos ?? null,
  }));
  model.links = (o.links || []).map(l => ({
    id: l.id, from: l.from, to: l.to, sign: l.sign === -1 ? -1 : 1, curv: l.curv ?? null,
  }));
  let max = 0;
  for (const x of [...model.nodes, ...model.links]) {
    const mt = /(\d+)$/.exec(x.id || ''); if (mt) max = Math.max(max, +mt[1]);
  }
  model._id = Math.max(o._id || 0, max);
  return model;
}

// web-sd/sd/model.js의 detectLoops를 그대로 이식 (단순 순환 열거 + 극성 곱)
export function detectLoops(model, { maxLoops = 200, maxLen = 12 } = {}) {
  const ids = model.nodes.map(n => n.id);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const adj = new Map(ids.map(id => [id, []]));
  for (const l of model.links) if (adj.has(l.from)) adj.get(l.from).push(l);
  const loops = [];
  for (const start of ids) {
    if (loops.length >= maxLoops) break;
    const startIdx = indexOf.get(start);
    const stack = [start]; const onStack = new Set([start]);
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
          continue;
        }
        if (indexOf.get(v) < startIdx) continue;
        if (onStack.has(v)) continue;
        stack.push(v); onStack.add(v);
        dfs(v, prod * (l.sign || 1), depth + 1);
        stack.pop(); onStack.delete(v);
      }
    })(start, 1, 1);
  }
  return loops;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm test`
Expected: PASS — 모든 테스트 통과.

- [ ] **Step 6: 커밋**

```bash
cd /c/Users/tmddd/cld-studio && git add -A && git commit -m "feat: 코어 모델 + 루프 감지 (TDD)"
```

---

### Task 3: SVG 편집기 엔진 이식 — 작도 가능

**Files:**
- Create: `cld-studio/src/renderer/core/render.js`
- Create: `cld-studio/src/renderer/app.js`
- Create: `cld-studio/src/renderer/ui/style.css`
- Modify: `cld-studio/src/renderer/index.html`

**Interfaces:**
- Consumes: `core/model.js` 전체.
- Produces: `app.js`가 `#cv` SVG에 모델을 렌더. 사용자 상호작용: 빈곳 더블클릭=변수추가, 노드 드래그=이동, 파란 손잡이 드래그=인과링크, ± 클릭=극성, 노드 더블클릭=이름편집, Del=삭제, 휠=줌. 전역 `getModel()`, `setModel(m)`, `onModelChange(cb)` 노출(Task 4·5에서 사용).

- [ ] **Step 1: `web-sd/sd/editor.js`·`web-sd/sd/style.css`를 이식 기반으로 복사**

```bash
cp /c/Users/tmddd/sejong-flood-twin/web-sd/sd/editor.js /c/Users/tmddd/cld-studio/src/renderer/core/render.js
cp /c/Users/tmddd/sejong-flood-twin/web-sd/sd/style.css /c/Users/tmddd/cld-studio/src/renderer/ui/style.css
```

- [ ] **Step 2: `render.js`에서 v1 범위 밖 코드 제거**

다음 블록을 **삭제**한다(존재 시):
- import 중 `sim.js`, `chart.js`, `scenario.js`, `analysis.js`, `csv.js` 관련 전부.
- 상단 툴바 이벤트 중 `#btn-sim`, `#btn-csv`, `#csv-input`, 트윈 링크 관련 핸들러.
- 시뮬레이션 패널(`openSim/runSim/drawSim/seriesFor/...`), 임계점 분석, 시나리오 내보내기, CSV 데이터셋(`renderDatasets/bindingUI/autoMapColumns/normName`), 방정식 UI(`equationUI/eqInput/...`) 전체 함수.
- 인스펙터에서 `equationUI(n)`·`bindingUI(n)` 호출 라인.
- 모델 영속화는 localStorage 대신 Task 5에서 파일로 대체하므로 `saveLocal/loadModel`의 localStorage 접근을 **임시로 no-op**(`function saveLocal(){}`)로 두고, 초기 모델은 `createModel()`로 시작.

남겨야 하는 핵심: SVG 셋업, `render()`, 노드/링크 그리기, 드래그(pointerdown/move/up), 링크 드래그, 극성 토글, 인라인 이름편집, 줌/팬, 키보드 삭제, 인스펙터의 이름·유형·극성·삭제 부분.

- [ ] **Step 3: 변경 알림 훅 추가 — `render.js` 하단에 공개 API 추가**

```js
// ===== 외부(app/Task4/Task5) 연동 API =====
const _listeners = [];
export function onModelChange(cb) { _listeners.push(cb); }
function notifyChange() { for (const cb of _listeners) cb(model); }
export function getModel() { return model; }
export function setModel(m) { model = m; selection = null; render(); notifyChange(); }
export function bootRender(svgRootId = 'cv') { /* 기존 초기화 진입점 */ }
```

`saveLocal()` 호출 지점마다 그 뒤에 `notifyChange();`를 추가(편집이 일어날 때 리스너 통지). `model`/`selection`/`render`가 모듈 스코프 변수이므로 export 함수에서 접근 가능하게 `let model`로 유지.

- [ ] **Step 4: `src/renderer/app.js` 작성 (부트스트랩)**

```js
import './core/render.js';   // render.js가 DOM 로드시 자동 초기화하도록 작성돼 있음
// Task 4(루프 패널)·Task 5(파일 IO)에서 여기 import를 추가한다.
```

- [ ] **Step 5: `index.html`을 편집기 셸로 교체**

`web-sd/index.html`의 `<body>` 구조(topbar·#main·#cv·#side)를 참고해 이식하되, 제거 대상 버튼(`+ 데이터(CSV)`, `▶ 시뮬레이션`, `트윈 →`)은 뺀다. `<head>`에 `<link rel="stylesheet" href="./ui/style.css">`, 본문 끝에 `<script type="module" src="./app.js"></script>`. CSP의 `style-src`에 `'unsafe-inline'` 유지(SVG 인라인 스타일). 폰트 CDN은 오프라인 앱이라 제거하고 Task(후속)에서 로컬 폰트로 대체 — v1 M1은 system-ui로 둔다.

- [ ] **Step 6: 실행 확인 (수동)**

Run: `cd /c/Users/tmddd/cld-studio && npm run dev`
Expected: 창에서 빈곳 더블클릭→변수 추가, 드래그 이동(텍스트 안 잡힘), 손잡이 드래그로 링크 연결, ± 극성 토글, Del 삭제, 휠 줌이 모두 동작.

- [ ] **Step 7: 커밋**

```bash
cd /c/Users/tmddd/cld-studio && git add -A && git commit -m "feat: SVG 편집 엔진 이식 — CLD 작도 동작 (세종/시뮬 UI 제거)"
```

---

### Task 4: 피드백 루프 패널 + R/B 배지 자동 번호

**Files:**
- Create: `cld-studio/src/renderer/ui/loops-panel.js`
- Modify: `cld-studio/src/renderer/core/render.js` (배지 그리기 훅)
- Modify: `cld-studio/src/renderer/app.js`
- Test: `cld-studio/test/loops-number.test.js`

**Interfaces:**
- Consumes: `detectLoops`, `onModelChange`, `getModel` from core.
- Produces: `numberLoops(loops) → [{...loop, label:'R1'|'B1'...}]` (R·B 각각 1부터 증가). 우측 패널에 루프 목록, 캔버스에 루프 배지.

- [ ] **Step 1: 실패 테스트 — `test/loops-number.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { numberLoops } from '../src/renderer/ui/loops-panel.js';

describe('루프 번호 매기기', () => {
  it('R/B별로 1부터 증가하는 라벨', () => {
    const loops = [{ polarity: 'R' }, { polarity: 'B' }, { polarity: 'R' }];
    const out = numberLoops(loops);
    expect(out.map(l => l.label)).toEqual(['R1', 'B1', 'R2']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm test`
Expected: FAIL — `numberLoops` 없음.

- [ ] **Step 3: `ui/loops-panel.js` 구현**

```js
import { detectLoops } from '../core/model.js';

export function numberLoops(loops) {
  const c = { R: 0, B: 0 };
  return loops.map(l => ({ ...l, label: l.polarity + (++c[l.polarity]) }));
}

// 패널 렌더: #loops 컨테이너에 목록 출력, 클릭 시 콜백
export function renderLoopsPanel(model, { onSelect } = {}) {
  const box = document.getElementById('loops');
  if (!box) return [];
  const loops = numberLoops(detectLoops(model));
  box.innerHTML = loops.length
    ? '' : '<div class="empty">감지된 루프가 없습니다.</div>';
  loops.forEach(lp => {
    const el = document.createElement('div');
    el.className = 'loop-item ' + (lp.polarity === 'R' ? 'r' : 'b');
    el.textContent = `${lp.label} · ${lp.nodes.length}개 변수`;
    el.addEventListener('click', () => onSelect && onSelect(lp));
    box.appendChild(el);
  });
  return loops;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm test`
Expected: PASS.

- [ ] **Step 5: `app.js`에서 패널 연결**

```js
import './core/render.js';
import { renderLoopsPanel } from './ui/loops-panel.js';
import { onModelChange, getModel } from './core/render.js';

function refresh() { renderLoopsPanel(getModel(), { onSelect: () => {} }); }
onModelChange(refresh);
window.addEventListener('DOMContentLoaded', refresh);
```

- [ ] **Step 6: 수동 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm run dev`
Expected: 닫힌 루프를 그리면 우측 패널에 `R1`/`B1`이 즉시 나타남.

- [ ] **Step 7: 커밋**

```bash
cd /c/Users/tmddd/cld-studio && git add -A && git commit -m "feat: 피드백 루프 패널 + R/B 자동 번호"
```

---

### Task 5: `.cld.json` 저장/열기 — 네이티브 다이얼로그 + 앱 메뉴

**Files:**
- Modify: `cld-studio/src/main/main.js` (메뉴 + IPC 핸들러)
- Modify: `cld-studio/src/main/preload.js` (파일 API 노출)
- Create: `cld-studio/src/renderer/io/file-io.js`
- Modify: `cld-studio/src/renderer/app.js`

**Interfaces:**
- Consumes: `getModel/setModel` from render, `toJSON/fromJSON` from model.
- Produces: 메뉴 파일>새로/열기/저장/다른이름저장. `window.cld.saveFile(text, defaultName) → {ok, path}`, `window.cld.openFile() → {ok, path, text}` (preload 노출). 렌더러 `file-io.js`가 IPC를 호출.

- [ ] **Step 1: `main.js`에 IPC + 메뉴 추가**

```js
import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
// ... 기존 import/창 생성 유지 ...

ipcMain.handle('file:save', async (_e, { text, defaultName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'model.cld.json',
    filters: [{ name: 'CLD model', extensions: ['cld.json', 'json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, text, 'utf-8');
  return { ok: true, path: filePath };
});

ipcMain.handle('file:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'CLD model', extensions: ['cld.json', 'json'] }],
  });
  if (canceled || !filePaths[0]) return { ok: false };
  const text = await fs.readFile(filePaths[0], 'utf-8');
  return { ok: true, path: filePaths[0], text };
});

function buildMenu() {
  const send = (ch) => () => win.webContents.send(ch);
  const template = [
    { label: '파일', submenu: [
      { label: '새로 만들기', accelerator: 'CmdOrCtrl+N', click: send('menu:new') },
      { label: '열기…', accelerator: 'CmdOrCtrl+O', click: send('menu:open') },
      { type: 'separator' },
      { label: '저장', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
      { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu:saveAs') },
      { type: 'separator' },
      { role: 'quit', label: '종료' },
    ]},
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }] },
    { label: '보기', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

`createWindow()` 안 `loadFile` 뒤에 `buildMenu();` 호출 추가.

- [ ] **Step 2: `preload.js`에 파일 API 노출**

```js
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('cld', {
  saveFile: (text, defaultName) => ipcRenderer.invoke('file:save', { text, defaultName }),
  openFile: () => ipcRenderer.invoke('file:open'),
  onMenu: (channel, cb) => ipcRenderer.on(channel, cb),
});
```

- [ ] **Step 3: `renderer/io/file-io.js` 작성**

```js
import { getModel, setModel } from '../core/render.js';
import { toJSON, fromJSON, createModel } from '../core/model.js';

let currentPath = null;

export async function saveModel({ saveAs = false } = {}) {
  const m = getModel();
  const name = (m.name || 'model').replace(/\s+/g, '_') + '.cld.json';
  const res = await window.cld.saveFile(toJSON(m), name);
  if (res.ok) currentPath = res.path;
  return res;
}
export async function openModel() {
  const res = await window.cld.openFile();
  if (res.ok) { setModel(fromJSON(res.text)); currentPath = res.path; }
  return res;
}
export function newModel() { setModel(createModel()); currentPath = null; }

export function wireMenu() {
  window.cld.onMenu('menu:new', () => newModel());
  window.cld.onMenu('menu:open', () => openModel());
  window.cld.onMenu('menu:save', () => saveModel());
  window.cld.onMenu('menu:saveAs', () => saveModel({ saveAs: true }));
}
```

- [ ] **Step 4: `app.js`에서 메뉴 배선**

```js
import { wireMenu } from './io/file-io.js';
wireMenu();
```

- [ ] **Step 5: 수동 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm run dev`
Expected: 변수 몇 개 그리고 `Ctrl+S`→네이티브 저장창→`.cld.json` 저장. `Ctrl+N`으로 비우고 `Ctrl+O`로 그 파일 열면 그래프 복원.

- [ ] **Step 6: 커밋**

```bash
cd /c/Users/tmddd/cld-studio && git add -A && git commit -m "feat: .cld.json 저장/열기 + 네이티브 메뉴"
```

---

### Task 6: 미저장 경고 + 자동저장/복구

**Files:**
- Modify: `cld-studio/src/renderer/io/file-io.js` (dirty 추적, 자동저장)
- Modify: `cld-studio/src/renderer/app.js`
- Modify: `cld-studio/src/main/main.js` (close 가드)

**Interfaces:**
- Consumes: `onModelChange` from render, `saveModel` from file-io.
- Produces: `isDirty()`, 창 닫기 시 미저장이면 main이 확인 다이얼로그. 60초 주기 + 변경 시 디바운스로 `localStorage['cld-studio-autosave']`에 직렬화. 시작 시 복구 제안.

- [ ] **Step 1: file-io에 dirty/자동저장 추가**

```js
import { onModelChange } from '../core/render.js';
let dirty = false;
export function isDirty() { return dirty; }
onModelChange(() => { dirty = true; scheduleAutosave(); });

let _t = null;
function scheduleAutosave() {
  clearTimeout(_t);
  _t = setTimeout(() => {
    try { localStorage.setItem('cld-studio-autosave', toJSON(getModel())); } catch {}
  }, 1500);
}
export function recoverIfAny() {
  const t = localStorage.getItem('cld-studio-autosave');
  if (t && confirm('이전에 저장하지 않은 작업이 있습니다. 복구할까요?')) {
    setModel(fromJSON(t)); return true;
  }
  return false;
}
```

`saveModel`·`openModel`·`newModel` 성공 시 `dirty = false`로 설정하는 라인 추가.

- [ ] **Step 2: app.js에서 시작 복구 호출**

```js
import { recoverIfAny } from './io/file-io.js';
window.addEventListener('DOMContentLoaded', () => recoverIfAny());
```

- [ ] **Step 3: main.js 창 닫기 가드**

```js
win.on('close', async (e) => {
  e.preventDefault();
  const dirty = await win.webContents.executeJavaScript('window.__cldDirty?.() ?? false');
  if (!dirty) { win.destroy(); return; }
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['저장 안 함', '취소', '저장'], defaultId: 2, cancelId: 1,
    message: '저장하지 않은 변경사항이 있습니다.',
  });
  if (response === 0) win.destroy();
  else if (response === 2) { win.webContents.send('menu:save'); }
});
```

`file-io.js`에서 `window.__cldDirty = isDirty;`를 노출하는 라인 추가.

- [ ] **Step 4: 수동 확인**

Run: `cd /c/Users/tmddd/cld-studio && npm run dev`
Expected: 변수 추가 후 창 닫기→경고 다이얼로그. 강제 종료 후 재실행 시 복구 제안.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/tmddd/cld-studio && git add -A && git commit -m "feat: 미저장 경고 + 자동저장/복구"
```

---

## Milestone 1 완료 기준
- `npm run dev`로 데스크톱 창 실행 → CLD 작도(변수·링크·극성)·드래그·줌
- 닫힌 루프 → R/B 자동 식별·번호
- `.cld.json` 네이티브 저장/열기, 미저장 경고·자동복구
- `npm test` 전부 통과

## 후속 마일스톤 (별도 플랜)
- **M2 — 논문급 출력**: SVG/PDF/PNG 내보내기, 폰트(Pretendard+Tinos) 임베딩·윤곽선화, 흑백/투명배경 옵션, 곡선 화살표 핸들·정렬/스냅
- **M3 — Vensim `.mdl` import**: 스케치 파서(변수·화살표·극성·곡률), 부분실패 리포트 (TDD, 픽스처)
- **M4 — 패키징·배포**: electron-builder로 `.exe`(NSIS+포터블), GitHub Releases, SmartScreen 안내, 아이콘
