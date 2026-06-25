# cld-studio — 설계 문서 (v1)

> 상태: 설계 확정(브레인스토밍 완료) · 작성일 2026-06-25
> 다음 단계: 구현 계획(writing-plans) → 실제 빌드 시 새 레포 `cld-studio`로 이동

## 1. 개요 / 목적

연구실 누구나 쓸 수 있는 **범용 CLD(인과지도) 저작 데스크톱 프로그램**. 세종 침수 트윈 과정에서 만든 웹 기반 CLD 편집기(`sejong-flood-twin/web-sd/`)의 검증된 엔진을 재사용해, 독립 제품으로 분리한다.

**한 줄 정체성**: *"Vensim처럼 익숙하되, Vensim에서 답답했던 점을 푼다 — 특히 논문 Figure로 바로 쓸 수 있는 출력 품질."*

- 대상 사용자: 연구실 내 CLD/SD 연구자 (대부분 Windows)
- 배포: **다운로드해서 더블클릭 실행하는 데스크톱 앱**(웹사이트 아님)
- v1 초점: ① CLD 그리기 ② 피드백 루프 자동 식별 ③ **논문급 출력**

## 2. 범위

### v1 포함
- CLD 작도(변수·인과링크·극성), 피드백 루프 자동 감지 + R/B 배지
- 곡선 화살표(베지어), 정렬/그리드 스냅/선택적 자동 레이아웃
- 논문급 출력: **벡터 SVG/PDF + 고DPI PNG**(투명배경·흑백모드·윤곽선화)
- 자체 저장 포맷 `.cld.json`(저장/열기, 네이티브 다이얼로그)
- **Vensim `.mdl` 가져오기**(스케치부: 모양·좌표·극성·곡선. 수식 무시)
- 견고한 undo/redo, 테마, 자동저장/크래시 복구

### v1 제외 (Phase 2+)
- 시뮬레이션·Stock-Flow 정량 모델링 (현재 코드 보존만 — 승우 연구 전용)
- Vensim **내보내기**(.mdl export)
- 협업/실시간 공동편집·코멘트
- 서브스크립트(배열), 민감도·최적화
- 코드서명, 자동 업데이트(구조만 열어둠)

## 3. 접근법

**접근 1 채택** — 기존 SVG 편집 엔진 재사용 + 모듈 정리 + Electron 셸. 바닐라 JS 유지(프레임워크 미사용). 검증된 코드 살리고, 세종/시뮬/CSV/트윈 UI는 v1에서 제외(보존).

## 4. 아키텍처 / 구조

Electron 표준 2-프로세스:
- **Main** (`main.js`): 창 생성, 네이티브 메뉴(파일 새로/열기/저장/내보내기), 파일 다이얼로그, 디스크 IO
- **Preload** (`preload.js`): contextIsolation 보안 브리지 — 렌더러 ↔ 파일 IO/내보내기
- **Renderer**: 편집기 본체(SVG 엔진)

```
cld-studio/
  package.json, electron-builder 설정      # → Windows .exe (NSIS + portable)
  src/
    main/    main.js, preload.js           # 네이티브 셸·파일 IO·메뉴
    renderer/
      index.html, app.js
      core/   model.js  render.js  loops.js  commands.js(undo/redo)
      io/     json-io.js  vensim-import.js  export-image.js
      ui/     toolbar.js  inspector.js  style.css
  assets/  icons, 임베딩 폰트(Pretendard, Tinos)
  test/    fixtures(*.mdl), 단위테스트
```

**기존 코드 재사용 매핑**: `web-sd/sd/editor.js`(약 1.3천 줄) → `render.js`(그리기·드래그·줌) + `commands.js`(편집·undo) + `loops.js`(루프 감지)로 분할. `model.js`는 거의 그대로. `sim.js/csv.js/analysis.js/scenario.js`는 Phase 2용으로 보존.

**데이터 흐름**: 입력 → model 갱신 → SVG 재렌더 + 루프 재감지 → 배지. 저장: model 직렬화 → IPC → main 파일 기록. 열기: 역방향.

## 5. 데이터 모델 / 파일 포맷

내부 모델(현행 유지 + v1 추가):
```
node:  { id, name, type('aux'|'stock'|'flow'|'const'), x, y,
         labelPos?,                         // 라벨 미세조정 (v1)
         value?, eq?, unit?, csv? }          // Phase2 예약(스키마만)
link:  { id, from, to, sign(+1|-1),
         curv? }                             // 곡률 (v1, 학술 곡선 화살표)
loop:  detectLoops() → { nodes, links, polarity:'R'|'B' } + 자동 번호(R1/B1), 배지위치
```

자체 포맷 **`.cld.json`**:
```json
{ "format": "cld-studio", "version": 1,
  "meta": { "title": "", "author": "", "created": "", "note": "" },
  "nodes": [ ... ], "links": [ ... ] }
```
`format/version`으로 하위호환 보장.

## 6. 편집기 기능 — Vensim 페인포인트 → 차별화 (v1)

| Vensim 불편 | cld-studio 해결 |
|---|---|
| 출력 촌스럽고 저해상 | 모던 기본 + 벡터(SVG/PDF)·고DPI PNG·투명배경 |
| 루프를 손으로 찾아 R/B 수동 배치 | **루프 자동 감지 + R1/B1 배지 자동** |
| 곡선 화살표 fiddly, 겹침 지저분 | 베지어 핸들 + 겹침 회피 + 그리드 스냅 |
| 극성(+/−) 작고 위치 못 옮김 | 크고 명확, 드래그 이동, 흑백 구분 |
| 변수명 줄바꿈·폰트 빈약 | 자동 줄바꿈 + 폰트 통제 + 정제 타이포 |
| undo 얕음 | 다단계 undo/redo |
| 정렬 도구 없음 | 정렬/분배/스냅 + 선택적 자동 레이아웃 |
| 색·테마 없음 | 테마 + 흑백 인쇄 미리보기 |
| .mdl 버전관리·공유 부적합 | 순수 JSON → git diff·공유 친화 |
| 유료·Mac 취약 | 무료·우리 소유 |

**핵심 차별 3종**: ① 논문급 벡터 출력 ② 루프 자동식별/배지 ③ 손맛 좋은 곡선화살표+정렬.

## 7. 논문급 출력 (상세)

**폰트 전략(혼용 스크립트)**:
- 한글 → **Pretendard**, 영문/숫자 → **Times New Roman**. `unicode-range`로 글자 단위 자동 적용 (예: "강우량 (Rainfall)" — 한글 프리텐다드 / 영문 Times).
- **임베딩 라이선스**: Pretendard(OFL)는 자유 임베딩. Times New Roman은 MS 시스템 폰트라 재배포 제약 → 내보내기 시:
  - (기본) 화면엔 Times New Roman 표시 + 임베딩은 **Tinos**(Times와 메트릭 동일 오픈폰트, Apache)로 대체 → 동일 모양·깨끗한 라이선스
  - (옵션) **텍스트 윤곽선(path) 변환** → 폰트 불필요, 어떤 저널 시스템에서도 100% 동일(검색·수정 불가)

**내보내기 포맷**: SVG(벡터) · PDF(벡터) · PNG(고DPI 2x/4x, 투명배경).
**옵션 패널**: 배경(투명/흰색) · 배율/DPI · 여백 · **흑백 모드**(+/−·R/B 흑백 구분) · 루프배지 포함 · 텍스트 윤곽선화.
**구현**: 편집기 SVG를 폰트 임베딩해 직렬화. PNG=canvas 배율 래스터화, PDF=svg2pdf+jsPDF 또는 Electron `printToPDF`.

## 8. Vensim `.mdl` 가져오기 (상세)

전용 파서 `vensim-import.js`:
1. 스케치 마커(`\\\---/// Sketch...`)에서 파일 분할 — **스케치부만** 사용
2. 레코드 번호로 분류:
   - `10,id,이름,x,y,...` → node (id매핑, 이름 `\n` 보존, box모양 → stock, 그 외 aux)
   - `1,id,from,to,...,극성,...` → link (from/to, 극성 +/− 반영·없으면 +, 곡률점 → `curv`)
   - `11`(밸브), `12`(코멘트/구름) → **v1 스킵**
3. 부분 실패 허용 + 리포트:
   > "✓ 변수 23·화살표 31 가져옴 · 밸브 4 스킵 · 화살표 2 극성불명→+ 처리"

**까다로운 케이스**: 고스트/그림자 변수(`<이름>`) → 이름으로 병합(옵션)·리포트. 서브스크립트·매크로 무시. 수식부 무시(Phase 2 흡수).

## 9. 패키징 · 빌드 · 배포

- **electron-builder** → 산출물 2종:
  - 설치형 `CLD-Studio-Setup-x.x.x.exe`(NSIS, 시작메뉴 바로가기)
  - 무설치 포터블 `CLD-Studio-portable.exe`(더블클릭 실행)
- **배포 = GitHub Releases**에 `.exe` 첨부 → 연구실 분들 다운로드.
- **SmartScreen**: 미서명이라 첫 실행 경고 → "추가정보→실행" 안내(README). v1 미서명, 서명은 나중.
- 자동 업데이트(electron-updater)는 구조만 열고 나중.
- 개발: `npm run dev`(라이브리로드) · `npm run dist`(.exe).

## 10. 에러 처리

- 저장/열기 실패 → 친절한 다이얼로그(경로·원인)
- `.mdl` 파싱 → best-effort + 리포트
- 크래시 안전망: 작업 중 임시 자동저장 → 재시작 시 "복구할까요?"
- 닫을 때 미저장 경고(저장/버림/취소)

## 11. 테스트

- 순수 로직 단위테스트(TDD): 모델 연산, **루프 감지**, **Vensim 파서**(샘플 `.mdl` 픽스처→기대결과), 내보내기 직렬화
- 렌더/DOM은 핵심 동작 위주 최소 + 수동 확인
- 샘플 `.mdl` + 골든 출력 픽스처 동봉

## 12. 결정 로그 (브레인스토밍 합의)

1. 제품: 세종 한정 아님 → 연구실 범용 CLD 저작 도구
2. v1 범위 = A안(CLD+루프+출력), 시뮬은 Phase 2(보존)
3. 배포 = **데스크톱 앱**(웹사이트 아님), **Electron**, **Windows .exe**, 오프라인
4. Vensim = **import만 v1**(스케치/극성, 수식 무시), export 나중
5. 저장소 = **새 레포 `cld-studio`로 분리**(스펙은 일단 sejong-flood-twin/docs에)
6. 폰트 = 영문 **Times New Roman**(임베딩은 Tinos 대체/윤곽선) + 한글 **Pretendard**
7. 차별화 = Vensim 페인포인트 반영(출력품질·루프자동·곡선·정렬·테마·JSON)
