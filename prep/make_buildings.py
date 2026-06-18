# -*- coding: utf-8 -*-
"""F_FAC_BUILDING(세종, 5186) → web/data/buildings.geojson (용도 USABILITY 포함, 4326).

앱은 지형에 건물을 안착(sampleTerr)하므로 gz 불필요. 필요한 것: 형상 + h + use.
h = HEIGHT(>0) 아니면 3m. use = USABILITY(건축법 별표1 5자리 코드).
"""
import os, json, arcpy

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP = r"C:\Users\user\Desktop\새 폴더 (4)\SJ_GIS\F_FAC_BUILDING_세종시\F_FAC_BUILDING_36110_202604.shp"
OUT = os.path.join(BASE, "web", "data", "buildings.geojson")
sr4326 = arcpy.SpatialReference(4326)
in_sr = arcpy.Describe(SHP).spatialReference
if in_sr is None or in_sr.factoryCode == 0:
    in_sr = arcpy.SpatialReference(5186)
tr = (arcpy.ListTransformations(in_sr, sr4326) or [None])[0]
print("SR=%s transform=%s" % (in_sr.factoryCode, tr))

def rnd(o):
    if isinstance(o, (list, tuple)):
        if o and isinstance(o[0], (int, float)): return [round(o[0], 6), round(o[1], 6)]
        return [rnd(x) for x in o]
    return o

feats = []; n = 0
with arcpy.da.SearchCursor(SHP, ["SHAPE@", "HEIGHT", "GRND_FLR", "USABILITY", "BLD_NM"], spatial_reference=in_sr) as cur:
    for shape, ht, flr, use, nm in cur:
        if shape is None: continue
        g = (shape.projectAs(sr4326, tr) if tr else shape.projectAs(sr4326)).__geo_interface__
        h = ht if (ht and ht > 0) else 3
        feats.append({"type": "Feature",
                      "properties": {"h": int(h), "use": (use or "").strip(), "nm": (nm or "").strip()},
                      "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
        n += 1
        if n % 20000 == 0: print("  ...", n)

json.dump({"type": "FeatureCollection",
           "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
           "features": feats}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
import collections
uc = collections.Counter(f["properties"]["use"] for f in feats)
print("건물:", len(feats), "| %.1f MB" % (os.path.getsize(OUT) / 1e6))
print("용도 상위:", uc.most_common(8))
print("SAVED:", OUT)
