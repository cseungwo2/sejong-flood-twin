# -*- coding: utf-8 -*-
"""세종시 행정경계(sejong_mask.png) 밖의 교량을 제거.

bridges.json 의 교량은 OSM 광역 bbox로 받아 세종시 밖(공주·청주 등)까지 포함돼 있다.
지형·위성영상 클리핑과 '동일한' 경계(sejong_mask)를 기준으로,
한 꼭짓점이라도 경계 안에 들어오는 교량만 남긴다(경계에 걸친 교량은 유지, 완전히 밖이면 제거).

마스크: inside=255(흰색), outside=0, row0=북(트윈 UV v=0 = 북과 동일).
"""
import os, json
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "web", "data")
BRIDGES = os.path.join(DATA, "bridges.json")
MASK_PNG = os.path.join(DATA, "sejong_mask.png")
MASK_META = os.path.join(DATA, "sejong_mask_meta.json")


def load_mask():
    meta = json.load(open(MASK_META, encoding="utf-8"))
    b = meta["bbox"]
    img = Image.open(MASK_PNG).convert("L")
    px = img.load()
    mw, mh = img.size  # (width, height)
    west, east = b["west"], b["east"]
    north, south = b["north"], b["south"]

    def inside(lon, lat):
        # lon/lat -> mask pixel. row0 = 북.
        col = int((lon - west) / (east - west) * mw)
        row = int((north - lat) / (north - south) * mh)
        if col < 0 or col >= mw or row < 0 or row >= mh:
            return False
        return px[col, row] > 127

    return inside


def main():
    inside = load_mask()
    d = json.load(open(BRIDGES, encoding="utf-8"))
    bridges = d.get("bridges", [])
    kept, dropped = [], 0
    for br in bridges:
        coords = br.get("coords", [])
        if any(inside(c[0], c[1]) for c in coords):
            kept.append(br)
        else:
            dropped += 1
    d["bridges"] = kept
    json.dump(d, open(BRIDGES, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"교량 클리핑: 전체 {len(bridges)} → 세종 내 {len(kept)} (제거 {dropped})")
    print("저장:", BRIDGES, f"({round(os.path.getsize(BRIDGES)/1e6, 2)} MB)")


if __name__ == "__main__":
    main()
