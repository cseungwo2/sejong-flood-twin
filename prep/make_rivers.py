# -*- coding: utf-8 -*-
"""하천구역(UJB1)·소하천구역(UJC1) → 4326 GeoJSON + 등급/기본수심 태깅.

- 5174(하천유역)/5186(소하천) → 4326 정확 변환(datum transform 적용)
- 실제 하천만: UJB1(하천구역), UJC1(소하천구역). UJB4(홍수관리구역)/UJC2(소하천예정지) 제외
- 등급: 미호천/금강 → 국가하천(2.5m), 그 외 하천구역 → 지방하천(1.5m), 소하천구역 → 소하천(0.7m)
"""
import os, json, struct, collections, arcpy

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # SejongFloodTwin
DESK = r"C:\Users\user\Desktop"
OUT_DIR = os.path.join(BASE, "web", "data", "rivers")
os.makedirs(OUT_DIR, exist_ok=True)

DEPTH = {"국가하천": 2.5, "지방하천": 1.5, "소하천": 0.7}
SR4326 = arcpy.SpatialReference(4326)

def read_dbf_names(path):
    """원본 dbf를 cp949로 읽어 {MNUM: ALIAS} 사전 반환(한글 정상)."""
    data = open(path, "rb").read()
    nrec = struct.unpack("<I", data[4:8])[0]
    hdr = struct.unpack("<H", data[8:10])[0]
    recsize = struct.unpack("<H", data[10:12])[0]
    fields = []; pos = 32
    while data[pos] != 0x0D:
        fields.append((data[pos:pos+11].split(b"\x00")[0].decode("ascii"), data[pos+16])); pos += 32
    out = {}
    for r in range(nrec):
        rstart = hdr + r*recsize + 1; off = 0; rec = {}
        for name, flen in fields:
            raw = data[rstart+off:rstart+off+flen]; off += flen
            try: rec[name] = raw.decode("cp949").strip("\x00 ").strip()
            except: rec[name] = raw.decode("latin1").strip()
        out[rec.get("MNUM", "")] = rec.get("ALIAS", "")
    return out

def code_of(mnum):
    i = mnum.find("UJ"); return mnum[i:i+4] if i >= 0 else "?"

def pick_transform(in_sr):
    tl = arcpy.ListTransformations(in_sr, SR4326)
    return tl[0] if tl else None

def rings_to_geojson(geom):
    """arcpy polygon → GeoJSON Polygon/MultiPolygon 좌표(외곽+홀 처리)."""
    polys = []
    for part in geom:
        rings = []; ring = []
        for pnt in part:
            if pnt is None:          # 내부 링(홀) 구분자
                if ring: rings.append(ring)
                ring = []
                continue
            ring.append([round(pnt.X, 7), round(pnt.Y, 7)])
        if ring: rings.append(ring)
        if rings: polys.append(rings)
    if not polys: return None
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}

def build(shp, dbf, keep_code, grade_fn, out_path, layer_name):
    names = read_dbf_names(dbf)
    in_sr = arcpy.Describe(shp).spatialReference
    if in_sr is None or in_sr.factoryCode == 0:
        # 소하천: SR 미정의 → prj 기준 5186 명시
        in_sr = arcpy.SpatialReference(5186)
    tr = pick_transform(in_sr)
    print(f"[{layer_name}] in_sr={in_sr.factoryCode} transform={tr}")
    feats = []; grade_count = collections.Counter()
    fields = ["SHAPE@", "MNUM"]
    with arcpy.da.SearchCursor(shp, fields, spatial_reference=in_sr) as cur:
        for shape, mnum in cur:
            if shape is None: continue
            if code_of(mnum) != keep_code: continue
            g = shape.projectAs(SR4326, tr) if tr else shape.projectAs(SR4326)
            coords = rings_to_geojson(g)
            if coords is None: continue
            alias = names.get(mnum, "")
            grade = grade_fn(alias)
            grade_count[grade] += 1
            feats.append({
                "type": "Feature",
                "properties": {"name": alias, "grade": grade, "depth_m": DEPTH[grade]},
                "geometry": coords,
            })
    fc = {"type": "FeatureCollection",
          "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
          "features": feats}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"[{layer_name}] features={len(feats)} grades={dict(grade_count)} -> {out_path}")
    return len(feats)

def river_grade(alias):
    # 세종 국가하천은 미호천(미호강)·금강 본류뿐. '금강천' 등 동명 지류는 지방하천.
    a = alias.strip()
    if a in ("미호천", "미호강", "금강") or a.startswith("미호강") or a.startswith("미호천"):
        return "국가하천"
    return "지방하천"

if __name__ == "__main__":
    arcpy.env.overwriteOutput = True
    build(
        os.path.join(DESK, "하천유역_세종", "LSMD_CONT_UJ201_5174_36_202606.shp"),
        os.path.join(DESK, "하천유역_세종", "LSMD_CONT_UJ201_5174_36_202606.dbf"),
        "UJB1", river_grade,
        os.path.join(OUT_DIR, "rivers.geojson"), "하천구역",
    )
    build(
        os.path.join(DESK, "소하천_세종", "LSMD_CONT_UJ301_36_202606.shp"),
        os.path.join(DESK, "소하천_세종", "LSMD_CONT_UJ301_36_202606.dbf"),
        "UJC1", lambda a: "소하천",
        os.path.join(OUT_DIR, "streams.geojson"), "소하천구역",
    )
    print("DONE")
