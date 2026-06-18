# -*- coding: utf-8 -*-
"""세종시 행정경계(sejong_mask.png)로 교량 폴리라인을 '기하 클립'.

단순 제거가 아니라, 경계를 넘어가는 교량은 세종 안쪽 구간만 남기고 바깥 구간은 잘라낸다.
→ 딱 세종시 영역만 남음. 완전히 밖인 교량은 사라지고, 경계에 걸친 교량은 경계에서 잘려
   여러 안쪽 조각으로 분할될 수 있다(같은 w·name 유지).

마스크: inside=255(흰색), outside=0, row0=북(트윈 UV v=0 = 북과 동일).
지형·위성영상 클리핑과 '동일한' 경계.
"""
import os, json

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "web", "data")
BRIDGES = os.path.join(DATA, "bridges.json")
MASK_PNG = os.path.join(DATA, "sejong_mask.png")
MASK_META = os.path.join(DATA, "sejong_mask_meta.json")


def load_inside():
    """inside(lon,lat) 판정 함수 반환. 마스크/PIL 없으면 None."""
    if not (os.path.exists(MASK_PNG) and os.path.exists(MASK_META)):
        return None
    try:
        from PIL import Image
    except Exception:
        return None
    b = json.load(open(MASK_META, encoding="utf-8"))["bbox"]
    img = Image.open(MASK_PNG).convert("L"); px = img.load(); mw, mh = img.size
    west, east, north, south = b["west"], b["east"], b["north"], b["south"]

    def inside(lon, lat):
        col = int((lon - west) / (east - west) * mw)
        row = int((north - lat) / (north - south) * mh)
        if col < 0 or col >= mw or row < 0 or row >= mh:
            return False
        return px[col, row] > 127

    return inside


def _boundary_pt(a, b, inside, iters=22):
    """a,b 중 정확히 하나만 경계 안일 때, 경계 교차점을 이분탐색으로 근사(≈sub-m)."""
    fa = inside(a[0], a[1])
    lo, hi = 0.0, 1.0
    for _ in range(iters):
        mid = (lo + hi) / 2
        m = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
        if inside(m[0], m[1]) == fa:
            lo = mid
        else:
            hi = mid
    t = (lo + hi) / 2
    return [round(a[0] + (b[0] - a[0]) * t, 6), round(a[1] + (b[1] - a[1]) * t, 6)]


def clip_polyline(coords, inside):
    """경계 안쪽 구간들만 추출. 안쪽 서브 폴리라인 리스트 반환(각 >=2점)."""
    flags = [inside(c[0], c[1]) for c in coords]
    segs, cur = [], []
    for i, (c, fin) in enumerate(zip(coords, flags)):
        if fin:
            if not cur and i > 0 and not flags[i - 1]:
                cur.append(_boundary_pt(coords[i - 1], c, inside))  # out→in 진입점
            cur.append([round(c[0], 6), round(c[1], 6)])
        else:
            if cur:
                cur.append(_boundary_pt(coords[i - 1], c, inside))   # in→out 이탈점
                if len(cur) >= 2:
                    segs.append(cur)
                cur = []
    if len(cur) >= 2:
        segs.append(cur)
    return segs


def clip_bridges(bridges, inside):
    """교량 리스트를 경계로 기하 클립. 잘린 조각마다 별도 교량으로 반환."""
    out = []
    for br in bridges:
        for sub in clip_polyline(br.get("coords", []), inside):
            out.append({"coords": sub, "w": br.get("w", 8), "name": br.get("name", "")})
    return out


def main():
    inside = load_inside()
    if inside is None:
        raise SystemExit("sejong_mask.png / PIL 없음 — 클립 불가")
    d = json.load(open(BRIDGES, encoding="utf-8"))
    src = d.get("bridges", [])
    clipped = clip_bridges(src, inside)
    d["bridges"] = clipped
    json.dump(d, open(BRIDGES, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"기하 클립: 입력 {len(src)} 교량 → 세종 내 조각 {len(clipped)}개")
    print("저장:", BRIDGES, f"({round(os.path.getsize(BRIDGES)/1e6, 2)} MB)")


if __name__ == "__main__":
    main()
