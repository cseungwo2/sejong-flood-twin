# 세종시 침수 디지털트윈 (Sejong Flood Digital Twin)

DEM·건물 데이터를 3D로 표출하고, **침수심 슬라이더**를 좌우로 움직여 세종시 전역에서
어느 위치·어느 건물이 얼마나 잠기는지 실시간으로 보는 웹 기반 디지털트윈.

## 실행 방법
1. `start.bat` 더블클릭 → 로컬 서버(:8765)가 뜨고 브라우저가 자동 열림
2. 닫을 때는 콘솔 창에서 아무 키나 누르거나 창을 닫으면 됨

수동 실행:
```
cd web
python -m http.server 8765
# 브라우저에서 http://localhost:8765/index.html
```

### URL 파라미터(데모/공유용)
- `?wl=5`   초기 침수심(기준수위 위 m)
- `?ovr=river_max`  공식 홍수범위 자동 표시 (river_100/200/500/max, urban_max)

## 조작
- **하단 슬라이더 = 침수심(m)**: 시가지 최저지반(EL ≈10 m 부근) 위로 물이 차오름
- 좌클릭 회전 · 우클릭 이동 · 휠 줌
- 건물에 마우스 올리면 그 건물 침수심 툴팁
- 좌측 패널: 침수 건물 수 / 침수 면적 / 최대 침수심 실시간
- 공식 홍수위험지도(정부 공인 100·200·500년·기왕최대) 오버레이 토글

## 폴더 구조
```
SejongFloodTwin/
├─ start.bat              실행 런처
├─ web/
│  ├─ index.html          UI
│  ├─ app.js              Three.js 엔진(지형·건물·물 셰이더·슬라이더)
│  └─ data/
│     ├─ terrain.bin      DEM 다운샘플 그리드(Float32, 317×453)
│     ├─ terrain_meta.json
│     ├─ buildings.geojson 건물 77,425동 (gz=지반고, h=높이)
│     ├─ dem.png          16-bit 고해상 heightmap (향후 정밀 침수면용)
│     ├─ lot_overlay.png  지적(필지경계)+도로 합성 오버레이 (RGBA)
│     └─ flood/*.geojson  공식 홍수위험지도 범위
└─ prep/                  ArcGIS(arcpy) 전처리 스크립트
   ├─ main_prep.py        등고선→DEM, 건물 처리, geojson/heightmap
   ├─ fix_gz.py           건물 지반고(DEM 중심점 추출) 재계산
   ├─ patch_prep.py       terrain.bin / dem.png / flood geojson
   ├─ make_terrain.py     DEM→다운샘플 지형 그리드(terrain.bin)
   ├─ make_lot_texture.py 지적+도로 → lot_overlay.png
   └─ dem.tif             보간된 DEM (10 m, EPSG:5186)
```

## 데이터 파이프라인 (ArcGIS Pro / arcpy)
1. **등고선(N3L, EPSG:5179) → DEM**: 5186으로 투영 후 TopoToRaster로 10 m DEM 생성 (표고 0~499 m)
2. **건물 지반고(gz)**: 건물 중심점에서 DEM 값 추출(ExtractValuesToPoints) — 작은 건물도 누락 없이
3. **건물 높이(h)**: HEIGHT 필드 → 없으면 지상층수×3 m → 없으면 기본 3 m
4. 모든 결과를 WGS84(4326) GeoJSON + 다운샘플 지형 그리드로 내보냄

## 시뮬레이션 방식과 한계
- **방식**: 정적 bathtub 모델. 수면고 W에서 `침수심 = W − 지면고`, 지면/건물보다 낮으면 침수.
  지형·건물 침수 판정은 모두 GPU 셰이더에서 실시간 처리(슬라이더 드래그 = uniform 갱신).
- **한계**: 물의 흐름·시간 전파·하천 통수능·배수는 반영하지 않음(수위가 균일하게 차오르는 가정).
  실제 동적 침수가 필요하면 HEC-RAS 2D 등 수리해석 결과를 같은 트윈에 올리면 됨.
- 수직 과장(VE) 2.5배 적용(시각용). **침수심·면적 통계는 실제 미터 기준**.
- 건물 약 67%는 원본에 높이정보가 없어 3 m(1층)로 가정함.

## 표출 구성
- 지형: 10 m DEM(40 m 그리드 메시) 위에 **위성영상 + 지적(필지경계) + 실폭도로 합성 텍스처** 드레이핑
  - 위성: ESRI World Imagery 타일 / 지적·도로: `data/lot_overlay.png`(LDREG 필지경계 + TL_SPRD_RW 도로, EPSG:5186)
- 건물: 7.4만 동 흰색 입체화(지반보다 약간 아래에서 솟게 처리해 지형에 묻히지 않음)
- 카메라: 건물 최밀집 도심으로 자동 포커싱(`?view=` 로 거리 조절)

## 다음 단계(선택)
- `dem.png` 기반 고해상 침수면 셰이더로 지형 침수 경계 정밀화
- 건물별 최대 침수심 → 피해/대피 분석, 지하층 침수 경고
- HEC-RAS 2D 동적 결과(시간별 수심) 시계열 애니메이션 연동
