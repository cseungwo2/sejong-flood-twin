# -*- coding: utf-8 -*-
"""세종시 연속지적도(LDREG) → 행정경계 마스크 PNG (트윈 bbox 정렬, 4326).

필지 전체를 래스터화하면 도로/하천 지목까지 포함돼 세종시 채워진 형상이 된다.
inside=255(흰색), outside=0. 트윈 지형 셰이더에서 경계 밖 discard에 사용.
"""
import os, json, arcpy
import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP = r"C:\Users\user\Desktop\LSMD_CONT_LDREG_세종\LSMD_CONT_LDREG_36_202604.shp"
META = os.path.join(BASE, "web", "data", "terrain_meta.json")
OUT_PNG = os.path.join(BASE, "web", "data", "sejong_mask.png")

m = json.load(open(META, encoding="utf-8"))
b = m["bbox"]; west, south, east, north = b["west"], b["south"], b["east"], b["north"]
MW = 1280
cell_deg = (east - west) / MW
MH = int(round((north - south) / cell_deg))
print(f"bbox W={east-west:.5f} H={north-south:.5f}  mask {MW}x{MH} cell={cell_deg:.6f}deg")

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("Spatial") if arcpy.CheckExtension("Spatial") == "Available" else None
sr5186 = arcpy.SpatialReference(5186)
sr4326 = arcpy.SpatialReference(4326)
scratch = os.path.join(BASE, "prep", "scratch.gdb")

# 0) 원본 SR 미정의 대비 → 복사 후 5186 정의
src = arcpy.management.CopyFeatures(SHP, os.path.join(scratch, "ldreg_src"))[0]
if arcpy.Describe(src).spatialReference.factoryCode == 0:
    arcpy.management.DefineProjection(src, sr5186)
arcpy.management.AddField(src, "v", "SHORT")
arcpy.management.CalculateField(src, "v", "1")

# 1) 네이티브 5186에서 래스터화 (≈25m)
cell_m = 25.0
ras5186 = os.path.join(scratch, "mask5186")
arcpy.conversion.PolygonToRaster(src, "v", ras5186, "CELL_CENTER", cellsize=cell_m)

# 2) 4326 bbox 그리드로 투영 (NEAREST)
arcpy.env.outputCoordinateSystem = sr4326
arcpy.env.extent = arcpy.Extent(west, south, east, north)
arcpy.env.cellSize = cell_deg
ras4326 = os.path.join(scratch, "mask4326")
arcpy.management.ProjectRaster(ras5186, ras4326, sr4326, "NEAREST", cell_deg,
                               "KGD2002_To_WGS_1984_1")

# 3) numpy → 0/255 마스크 (row0 = 북)
arr = arcpy.RasterToNumPyArray(ras4326, nodata_to_value=0)
mask = np.where(arr > 0, 255, 0).astype("uint8")
print("mask shape:", mask.shape, "inside ratio: %.3f" % ((mask > 0).mean()))

# 4) PNG 저장 (PIL)
try:
    from PIL import Image
    Image.fromarray(mask, "L").save(OUT_PNG)
except Exception as e:
    # 폴백: 메타+raw 저장 후 시스템 파이썬에서 변환 필요
    np.save(OUT_PNG.replace(".png", ".npy"), mask)
    print("PIL 실패, npy 저장:", e)
    raise

# 메타 보조 기록
json.dump({"mw": mask.shape[1], "mh": mask.shape[0], "bbox": b},
          open(OUT_PNG.replace(".png", "_meta.json"), "w"), ensure_ascii=False)
print("SAVED:", OUT_PNG)
