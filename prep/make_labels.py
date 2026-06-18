# -*- coding: utf-8 -*-
"""이름 라벨 데이터 생성 → web/data/labels.json
- 읍면동: LSMD_ADM_SECT_UMD_36 (5186) → 4326 중심점 + EMD_NM(cp949)
- 하천: rivers.geojson(국가/지방) + streams.geojson(명칭 있는 소하천) 중심점 + 이름
"""
import os, json, struct, collections, arcpy

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMD_SHP = r"C:\Users\user\Desktop\읍면동_세종\LSMD_ADM_SECT_UMD_36_202606.shp"
EMD_DBF = r"C:\Users\user\Desktop\읍면동_세종\LSMD_ADM_SECT_UMD_36_202606.dbf"
OUT = os.path.join(BASE, "web", "data", "labels.json")
sr4326 = arcpy.SpatialReference(4326)

def read_dbf(path):
    data = open(path, "rb").read()
    nrec = struct.unpack("<I", data[4:8])[0]; hdr = struct.unpack("<H", data[8:10])[0]
    recsize = struct.unpack("<H", data[10:12])[0]
    fields = []; pos = 32
    while data[pos] != 0x0D:
        fields.append((data[pos:pos+11].split(b"\x00")[0].decode("ascii"), data[pos+16])); pos += 32
    rows = []
    for r in range(nrec):
        rs = hdr + r*recsize + 1; off = 0; rec = {}
        for name, flen in fields:
            raw = data[rs+off:rs+off+flen]; off += flen
            try: rec[name] = raw.decode("cp949").strip("\x00 ").strip()
            except: rec[name] = raw.decode("latin1").strip()
        rows.append(rec)
    return rows

# 읍면동 이름(cp949) by EMD_CD
emd_name = {r["EMD_CD"]: r["EMD_NM"] for r in read_dbf(EMD_DBF)}

emd = []
in_sr = arcpy.Describe(EMD_SHP).spatialReference
if in_sr is None or in_sr.factoryCode == 0:
    in_sr = arcpy.SpatialReference(5186)
tr = (arcpy.ListTransformations(in_sr, sr4326) or [None])[0]
with arcpy.da.SearchCursor(EMD_SHP, ["SHAPE@", "EMD_CD"], spatial_reference=in_sr) as cur:
    for shape, cd in cur:
        if shape is None: continue
        g = shape.projectAs(sr4326, tr) if tr else shape.projectAs(sr4326)
        p = g.labelPoint  # 폴리곤 내부 보장점
        emd.append({"name": emd_name.get(cd, cd), "lon": round(p.X, 6), "lat": round(p.Y, 6)})

def ring_centroid_groups(path):
    """이름별로 모든 외곽링 정점 평균 → 대표 라벨점."""
    gj = json.load(open(path, encoding="utf-8"))
    acc = collections.defaultdict(lambda: [0.0, 0.0, 0, None])  # sx, sy, n, grade
    for f in gj["features"]:
        nm = (f["properties"].get("name") or "").strip()
        grade = f["properties"].get("grade", "")
        if not nm or "구역" in nm or "관리" in nm or "예정" in nm:  # 일반 라벨 제외
            continue
        gm = f["geometry"];
        polys = [gm["coordinates"]] if gm["type"] == "Polygon" else gm["coordinates"]
        for rings in polys:
            for c in rings[0]:
                a = acc[nm]; a[0] += c[0]; a[1] += c[1]; a[2] += 1; a[3] = grade
    out = []
    for nm, (sx, sy, n, grade) in acc.items():
        if n: out.append({"name": nm, "grade": grade, "lon": round(sx/n, 6), "lat": round(sy/n, 6)})
    return out

rivers = ring_centroid_groups(os.path.join(BASE, "web", "data", "rivers", "rivers.geojson"))
rivers += ring_centroid_groups(os.path.join(BASE, "web", "data", "rivers", "streams.geojson"))

json.dump({"emd": emd, "rivers": rivers}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("읍면동 라벨:", len(emd), "| 하천 라벨:", len(rivers))
print("읍면동 예:", [e["name"] for e in emd[:8]])
print("하천 예:", [r["name"] for r in rivers[:10]])
print("SAVED:", OUT)
