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


def sejong_inside():
    """세종 경계 마스크(sejong_mask.png) 기반 inside(lon,lat) 판정 함수.
    마스크/PIL 이 없으면 None 반환(클리핑 생략). 지형·위성영상 클리핑과 동일 경계."""
    mp = os.path.join(BASE, "web", "data", "sejong_mask.png")
    mm = os.path.join(BASE, "web", "data", "sejong_mask_meta.json")
    if not (os.path.exists(mp) and os.path.exists(mm)):
        return None
    try:
        from PIL import Image
    except Exception:
        print("  (PIL 없음 → 경계 클리핑 생략)")
        return None
    b = json.load(open(mm, encoding="utf-8"))["bbox"]
    img = Image.open(mp).convert("L"); px = img.load(); mw, mh = img.size
    west, east, north, south = b["west"], b["east"], b["north"], b["south"]

    def inside(lon, lat):
        col = int((lon - west) / (east - west) * mw)
        row = int((north - lat) / (north - south) * mh)
        if col < 0 or col >= mw or row < 0 or row >= mh:
            return False
        return px[col, row] > 127

    return inside

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

# 세종 경계 밖 교량 제거(지형·위성 클리핑과 동일 경계). 한 점이라도 안에 들면 유지.
inside = sejong_inside()
if inside is not None:
    n0 = len(out)
    out = [b for b in out if any(inside(c[0], c[1]) for c in b["coords"])]
    print(f"  경계 클리핑: {n0} → {len(out)} (제거 {n0 - len(out)})")

json.dump({"bridges": out}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("교량 출력:", len(out), "개 ->", OUT, "(", round(os.path.getsize(OUT)/1e6, 2), "MB )")
named = [b["name"] for b in out if b["name"]]
print("이름 예:", named[:12])
