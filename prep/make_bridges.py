# -*- coding: utf-8 -*-
"""OSM 교량(osm_bridges.json) → web/data/bridges.json (트윈 렌더용).
- 의미있는 교량만(길이>=20m 또는 이름 있음)
- 도로 등급별 폭(width) 부여. 높이는 트윈에서 양끝 지형고로 보간(여기선 좌표·폭만).
"""
import os, json, math

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "prep", "osm_bridges.json")
OUT = os.path.join(BASE, "web", "data", "bridges.json")

WIDTH = {
    "motorway": 19, "trunk": 18, "motorway_link": 9, "trunk_link": 9,
    "primary": 15, "secondary": 12, "tertiary": 10,
    "residential": 7, "unclassified": 7, "service": 6,
    "footway": 4.5, "cycleway": 4.5, "path": 4, "pedestrian": 6, "track": 5,
}

def seg_m(a, b):
    latm = (a[1] + b[1]) / 2
    dx = (b[0] - a[0]) * 111320 * math.cos(math.radians(latm))
    dy = (b[1] - a[1]) * 111320
    return math.hypot(dx, dy)

d = json.load(open(SRC, encoding="utf-8"))
out = []
for e in d.get("elements", []):
    if e.get("type") != "way":
        continue
    geom = e.get("geometry")
    if not geom or len(geom) < 2:
        continue
    coords = [[round(g["lon"], 6), round(g["lat"], 6)] for g in geom]
    length = sum(seg_m(coords[i - 1], coords[i]) for i in range(1, len(coords)))
    tags = e.get("tags", {})
    name = tags.get("name", "")
    hw = tags.get("highway", "")
    rail = tags.get("railway")
    if length < 20 and not name:
        continue
    if rail:
        w = 11
    else:
        w = WIDTH.get(hw, 8)
    out.append({"coords": coords, "w": w, "name": name})

# 세종 경계로 기하 클립: 넘어가는 교량은 경계에서 잘라 안쪽 구간만 남김(딱 세종 영역).
try:
    from clip_bridges_sejong import load_inside, clip_bridges
    inside = load_inside()
    if inside is not None:
        n0 = len(out)
        out = clip_bridges(out, inside)
        print(f"  경계 기하 클립: {n0} 교량 → 세종 내 조각 {len(out)}개")
    else:
        print("  (마스크/PIL 없음 → 경계 클립 생략)")
except Exception as e:
    print("  (경계 클립 생략:", e, ")")

json.dump({"bridges": out}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("교량 출력:", len(out), "개 ->", OUT, "(", round(os.path.getsize(OUT)/1e6, 2), "MB )")
named = [b["name"] for b in out if b["name"]]
print("이름 예:", named[:12])
