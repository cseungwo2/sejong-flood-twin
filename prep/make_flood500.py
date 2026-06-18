# -*- coding: utf-8 -*-
"""500_SJ.shp(500년 빈도 도시침수, EPSG:5186) → 4326 GeoJSON.

정식 셰이프파일(.shp/.shx/.dbf/.prj) → arcpy SearchCursor로 읽어 5186→4326 변환
(KGD2002_To_WGS_1984_1, 홀 포함 native 처리). 출력: web/data/flood/urban_500.geojson.
"""
import os, json, arcpy

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP = r"C:\Users\user\Desktop\500_SJ.shp"
OUT = os.path.join(BASE, "web", "data", "flood", "urban_500.geojson")

sr5186 = arcpy.SpatialReference(5186)
sr4326 = arcpy.SpatialReference(4326)
in_sr = arcpy.Describe(SHP).spatialReference
if in_sr is None or in_sr.factoryCode == 0:
    in_sr = sr5186
tr = "KGD2002_To_WGS_1984_1"
arcpy.env.overwriteOutput = True
print("in_sr=%s  count=%s" % (in_sr.factoryCode, arcpy.management.GetCount(SHP)[0]))

# 16,987개 침수필지 → 침수영역(합집합)으로 dissolve, 살짝 단순화로 경량화
scratch = os.path.join(BASE, "prep", "scratch.gdb")
dis = arcpy.management.Dissolve(SHP, os.path.join(scratch, "uf500_dis"))[0]
simp = arcpy.cartography.SimplifyPolygon(
    dis, os.path.join(scratch, "uf500_sim"), "POINT_REMOVE", "1.5 Meters",
    collapsed_point_option="NO_KEEP")[0]

def rnd(o):  # 좌표 6자리(~0.1m) 반올림으로 파일 축소
    if isinstance(o, (list, tuple)):
        if o and isinstance(o[0], (int, float)):
            return [round(o[0], 6), round(o[1], 6)]
        return [rnd(x) for x in o]
    return o

feats = []; nvert = 0
with arcpy.da.SearchCursor(simp, ["SHAPE@"], spatial_reference=in_sr) as cur:
    for (shape,) in cur:
        if shape is None:
            continue
        g = shape.projectAs(sr4326, tr)
        geo = g.__geo_interface__
        for ring in (geo["coordinates"] if geo["type"] == "Polygon" else [r for p in geo["coordinates"] for r in p]):
            nvert += len(ring)
        feats.append({"type": "Feature", "properties": {"freq": "500yr", "kind": "urban"},
                      "geometry": {"type": geo["type"], "coordinates": rnd(geo["coordinates"])}})

fc = {"type": "FeatureCollection",
      "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
      "features": feats}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(fc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

# 검증: 4326 범위 (세종 bbox 안인지)
xs = []; ys = []
for f in feats:
    g = f["geometry"]; polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for rings in polys:
        for ring in rings:
            for c in ring: xs.append(c[0]); ys.append(c[1])
print("features=%d verts=%d" % (len(feats), nvert))
print("4326 lon[%.4f,%.4f] lat[%.4f,%.4f]" % (min(xs), max(xs), min(ys), max(ys)))
print("SAVED:", OUT)
