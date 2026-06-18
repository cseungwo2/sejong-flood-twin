# -*- coding: utf-8 -*-
"""국가하천 하천범람지도(100/200/500/max, 세종 행정구역, EPSG:5186) → 경량 4326 GeoJSON.

원본은 폴리곤 5개지만 정점이 많아 geojson이 43~70MB → urban_500과 동일하게
dissolve + 단순화(1.5m) + 좌표 6자리로 ~1-3MB로 경량화. web/data/flood/river_*.geojson 덮어씀.
"""
import os, json, arcpy

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GIS = r"C:\Users\user\Desktop\새 폴더 (4)\GIS데이터_홍수위험지도정보제공포털"
OUTDIR = os.path.join(BASE, "web", "data", "flood")
scratch = os.path.join(BASE, "prep", "scratch.gdb")
sr4326 = arcpy.SpatialReference(4326)
arcpy.env.overwriteOutput = True

JOBS = [
    ("river_100", r"행정구역 세종특별자치시 세종특별자치시 100년 빈도 국가하천 하천범람지도\RFM_SGG_NTN_36110_100.shp"),
    ("river_200", r"행정구역 세종특별자치시 세종특별자치시 200년 빈도 국가하천 하천범람지도\RFM_SGG_NTN_36110_200.shp"),
    ("river_500", r"행정구역 세종특별자치시 세종특별자치시 500년 빈도 국가하천 하천범람지도\RFM_SGG_NTN_36110_500.shp"),
    ("river_max", r"행정구역 세종특별자치시 세종특별자치시 기왕최대 국가하천 하천범람지도\RFM_SGG_NTN_36110_MAX.shp"),
]

def rnd(o):
    if isinstance(o, (list, tuple)):
        if o and isinstance(o[0], (int, float)):
            return [round(o[0], 6), round(o[1], 6)]
        return [rnd(x) for x in o]
    return o

def process(key, rel):
    shp = os.path.join(GIS, rel)
    in_sr = arcpy.Describe(shp).spatialReference
    if in_sr is None or in_sr.factoryCode == 0:
        in_sr = arcpy.SpatialReference(5186)
    tr = (arcpy.ListTransformations(in_sr, sr4326) or [None])[0]
    dis = arcpy.management.Dissolve(shp, os.path.join(scratch, key + "_dis"))[0]
    sim = arcpy.cartography.SimplifyPolygon(dis, os.path.join(scratch, key + "_sim"),
            "POINT_REMOVE", "1.5 Meters", collapsed_point_option="NO_KEEP")[0]
    feats = []; nv = 0
    with arcpy.da.SearchCursor(sim, ["SHAPE@"], spatial_reference=in_sr) as cur:
        for (shape,) in cur:
            if shape is None: continue
            g = (shape.projectAs(sr4326, tr) if tr else shape.projectAs(sr4326)).__geo_interface__
            for ring in (g["coordinates"] if g["type"] == "Polygon" else [r for p in g["coordinates"] for r in p]):
                nv += len(ring)
            feats.append({"type": "Feature", "properties": {"key": key},
                          "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
    out = os.path.join(OUTDIR, key + ".geojson")
    json.dump({"type": "FeatureCollection",
               "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
               "features": feats}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    mb = os.path.getsize(out) / 1e6
    print(f"  {key}: feats={len(feats)} verts={nv} -> {mb:.2f} MB (tr={tr})")

if __name__ == "__main__":
    for key, rel in JOBS:
        process(key, rel)
    print("DONE")
