# -*- coding: utf-8 -*-
"""도시침수지도 30/50/80/100년(세종, EPSG:5186) → 경량 4326 GeoJSON.

urban_500과 동일: dissolve + 단순화(1.5m) + 좌표 6자리 → web/data/flood/urban_{30,50,80,100}.geojson
"""
import os, json, arcpy

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESK = r"C:\Users\user\Desktop"
OUTDIR = os.path.join(BASE, "web", "data", "flood")
scratch = os.path.join(BASE, "prep", "scratch.gdb")
sr4326 = arcpy.SpatialReference(4326)
arcpy.env.overwriteOutput = True

JOBS = [
    ("urban_30",  r"30년빈도 도시침수\30년빈도도시침수.shp"),
    ("urban_50",  r"50년빈도 도시침수\50년빈도도시침수.shp"),
    ("urban_80",  r"80년빈도 도시침수\80년빈도도시침수.shp"),
    ("urban_100", r"100년빈도 도시침수\100년빈도도시침수.shp"),
]

def rnd(o):
    if isinstance(o, (list, tuple)):
        if o and isinstance(o[0], (int, float)):
            return [round(o[0], 6), round(o[1], 6)]
        return [rnd(x) for x in o]
    return o

def process(key, rel):
    shp = os.path.join(DESK, rel)
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
    print(f"  {key}: feats={len(feats)} verts={nv} -> {os.path.getsize(out)/1e6:.2f} MB")

if __name__ == "__main__":
    for key, rel in JOBS:
        process(key, rel)
    print("DONE")
