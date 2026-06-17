# -*- coding: utf-8 -*-
"""Downsample DEM (from scratch.gdb) -> Float32 terrain grid for the web engine.
Outputs web/data/terrain.bin (Float32 LE, row-major, north row first) + terrain_meta.json
nodata encoded as -9999.0"""
import arcpy, os, json
import numpy as np

ROOT = r"C:\Users\user\Desktop\SejongFloodTwin"
OUT  = os.path.join(ROOT, "web", "data")
SCR  = os.path.join(ROOT, "prep", "scratch.gdb")
dem  = os.path.join(SCR, "dem")
os.makedirs(OUT, exist_ok=True)

dem = os.path.join(ROOT, "prep", "dem.tif")   # tif (gdb raster fails RasterToNumPyArray)
r = arcpy.Raster(dem)
SR5186 = arcpy.SpatialReference(5186); SR4326 = arcpy.SpatialReference(4326)
ext = r.extent
arr = arcpy.RasterToNumPyArray(r, nodata_to_value=np.nan).astype("float64")  # (H,W) north->south
H, W = arr.shape
print("full", W, "x", H)

MAXD = 1000
step = max(1, int(np.ceil(max(W, H) / MAXD)))
# block-mean downsample ignoring nan
Hc = (H // step) * step; Wc = (W // step) * step
a = arr[:Hc, :Wc].reshape(Hc // step, step, Wc // step, step)
with np.errstate(invalid="ignore"):
    ds = np.nanmean(a, axis=(1, 3))
ny, nx = ds.shape
ds = np.where(np.isfinite(ds), ds, -9999.0).astype("<f4")
zmin = float(np.nanmin(arr)); zmax = float(np.nanmax(arr))
print("grid", nx, "x", ny, "step", step, "z", round(zmin,1), round(zmax,1))

ds.tofile(os.path.join(OUT, "terrain.bin"))

def to4326(x, y):
    pg = arcpy.PointGeometry(arcpy.Point(x, y), SR5186).projectAs(SR4326)
    return pg.centroid.X, pg.centroid.Y
w_, s_ = to4326(ext.XMin, ext.YMin)
e_, n_ = to4326(ext.XMax, ext.YMax)
meta = {"nx": nx, "ny": ny, "cell_m": 10 * step,
        "bbox": {"west": w_, "south": s_, "east": e_, "north": n_},
        "zmin": zmin, "zmax": zmax, "nodata": -9999.0}
json.dump(meta, open(os.path.join(OUT, "terrain_meta.json"), "w"), indent=2)
print("wrote terrain.bin", os.path.getsize(os.path.join(OUT, "terrain.bin")), "bytes")
print(meta["bbox"])
