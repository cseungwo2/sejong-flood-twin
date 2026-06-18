# -*- coding: utf-8 -*-
"""HAND(Height Above Nearest Drainage) 래스터 → hand.bin (terrain.bin과 동일 그리드).

DEM(10m, 5186) Fill → FlowDirection → 하천망(하천구역 UJB1 + 소하천구역 UJC1) 기준
FlowDistance(VERTICAL) = 각 셀이 흘러드는 하천보다 수직으로 몇 m 높은지.
terrain.bin과 동일하게 step배 블록평균 축소 → web/data/hand.bin (Float32 LE, 북행 먼저).
하천에 못 닿는 셀(배수 안 됨)은 99999 → 절대 안 잠김.
"""
import os, json, arcpy
import numpy as np
from arcpy.sa import Raster, Fill, FlowDirection, FlowDistance, SetNull, IsNull

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEM = os.path.join(BASE, "prep", "dem.tif")
SCR = os.path.join(BASE, "prep", "scratch.gdb")
OUT = os.path.join(BASE, "web", "data", "hand.bin")
RIVER = r"C:\Users\user\Desktop\새 폴더 (4)\SJ_GIS\하천유역_세종\LSMD_CONT_UJ201_5174_36_202606.shp"
SOHA  = r"C:\Users\user\Desktop\새 폴더 (4)\SJ_GIS\소하천_세종\LSMD_CONT_UJ301_36_202606.shp"

arcpy.CheckOutExtension("Spatial")
arcpy.env.overwriteOutput = True
demR = arcpy.Raster(DEM)
sr = demR.spatialReference
cell = demR.meanCellWidth
arcpy.env.outputCoordinateSystem = sr
arcpy.env.snapRaster = DEM
arcpy.env.extent = demR.extent
arcpy.env.cellSize = DEM
print("DEM SR=%s cell=%.2f extent set" % (sr.factoryCode, cell))

def prep_river(shp, where, name):
    lyr = arcpy.management.MakeFeatureLayer(shp, name + "_lyr", where)
    cp = arcpy.management.CopyFeatures(lyr, os.path.join(SCR, name + "_c"))[0]
    csr = arcpy.Describe(cp).spatialReference
    if csr is None or csr.factoryCode != 5186:
        tr = (arcpy.ListTransformations(csr if csr and csr.factoryCode else arcpy.SpatialReference(5174), sr) or [None])[0]
        cp = arcpy.management.Project(cp, os.path.join(SCR, name + "_p"), sr, tr,
                                      csr if csr and csr.factoryCode else arcpy.SpatialReference(5174))[0]
    return cp

r1 = prep_river(RIVER, "MNUM LIKE '%UJB1%'", "hcheon")   # 하천구역(5174)
r2 = prep_river(SOHA,  "MNUM LIKE '%UJC1%'", "scheon")   # 소하천구역(5186)
merged = arcpy.management.Merge([r1, r2], os.path.join(SCR, "rivers_hand"))[0]
arcpy.management.AddField(merged, "v", "SHORT")
arcpy.management.CalculateField(merged, "v", "1")
print("하천망 rasterize...")
streamRas = os.path.join(SCR, "stream_r")
arcpy.conversion.PolygonToRaster(merged, "v", streamRas, "MAXIMUM_AREA", cellsize=cell)
stream = SetNull(IsNull(Raster(streamRas)), 1)   # 하천=1, 그 외 NoData

print("Fill / FlowDirection / FlowDistance(VERTICAL)...")
demF = Fill(demR)
fdr = FlowDirection(demF)
hand = FlowDistance(stream, demF, fdr, "VERTICAL", "D8", "MINIMUM")
hand.save(os.path.join(SCR, "hand_r"))

arr = arcpy.RasterToNumPyArray(hand, nodata_to_value=np.nan).astype("float64")
H, W = arr.shape
step = max(1, int(np.ceil(max(W, H) / 1000)))
Hc = (H // step) * step; Wc = (W // step) * step
a = arr[:Hc, :Wc].reshape(Hc // step, step, Wc // step, step)
with np.errstate(invalid="ignore"):
    ds = np.nanmean(a, axis=(1, 3))
ny, nx = ds.shape
finite = np.isfinite(ds)
ds = np.where(finite, ds, 99999.0).astype("<f4")
ds.tofile(OUT)

meta = json.load(open(os.path.join(BASE, "web", "data", "terrain_meta.json")))
print("HAND grid %dx%d step=%d  (terrain %dx%d) %s" %
      (nx, ny, step, meta["nx"], meta["ny"], "MATCH" if (nx == meta["nx"] and ny == meta["ny"]) else "MISMATCH!"))
print("HAND m: min=%.2f max=%.2f  배수셀비율=%.3f" %
      (np.nanmin(arr), np.nanmax(arr), finite.mean()))
print("SAVED:", OUT, os.path.getsize(OUT), "bytes")
