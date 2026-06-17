# -*- coding: utf-8 -*-
"""
Sejong Flood Twin - data prep (arcpy / ArcGIS Pro 3.6)
Outputs into ...\SejongFloodTwin\web\data :
  - buildings.geojson  (EPSG:4326)  fields: gz (ground elev, m), h (building height, m)
  - dem.png            16-bit grayscale heightmap of DEM
  - dem_meta.json      {w,h,bbox(4326 lon/lat),zmin,zmax}  (0 = nodata in png)
  - flood/<name>.geojson  official inundation extents (4326)
"""
import arcpy, os, json, struct, zlib
import numpy as np
from arcpy.sa import *

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("Spatial")

ROOT   = r"C:\Users\user\Desktop\SejongFloodTwin"
DESK   = r"C:\Users\user\Desktop"
OUT    = os.path.join(ROOT, "web", "data")
FLOUT  = os.path.join(OUT, "flood")
SCR    = os.path.join(ROOT, "prep", "scratch.gdb")
os.makedirs(OUT, exist_ok=True)
os.makedirs(FLOUT, exist_ok=True)
if not arcpy.Exists(SCR):
    arcpy.management.CreateFileGDB(os.path.dirname(SCR), os.path.basename(SCR))
arcpy.env.workspace = SCR
arcpy.env.scratchWorkspace = SCR

SR5186 = arcpy.SpatialReference(5186)   # working CRS (matches buildings/flood)
SR4326 = arcpy.SpatialReference(4326)   # web CRS

DEM_CONT = os.path.join(DESK, u"DEM_세종", u"N3L_F0010000_36.shp")
BLD      = os.path.join(DESK, u"새 폴더", u"Urban Planning", u"GIS", u"F_FAC_BUILDING_세종", u"F_FAC_BUILDING_36_202604.shp")

def log(*a): print(*a, flush=True)

# ---------------------------------------------------------------- 1. DEM
log("[1] project contours -> 5186")
cont5186 = os.path.join(SCR, "cont5186")
arcpy.management.Project(DEM_CONT, cont5186, SR5186)

log("[2] TopoToRaster -> dem (10 m)")
arcpy.env.outputCoordinateSystem = SR5186
desc = arcpy.Describe(cont5186); ext = desc.extent
arcpy.env.extent = ext
arcpy.env.cellSize = 10
dem = os.path.join(SCR, "dem")
try:
    ttr = TopoToRaster([TopoContour([[cont5186, "CONT"]])], 10, ext, 0, "", "", "ENFORCE", "CONTOUR")
    ttr.save(dem)
except Exception as e:
    log("  TopoToRaster failed -> TIN fallback:", e)
    arcpy.CheckOutExtension("3D")
    tin = os.path.join(ROOT, "prep", "tin")
    arcpy.ddd.CreateTin(tin, SR5186, [[cont5186, "CONT", "Hard_Line"]], "DELAUNAY")
    arcpy.ddd.TinRaster(tin, dem, "FLOAT", "LINEAR", "CELLSIZE 10")

demR = arcpy.Raster(dem)
log("  dem stats: min", demR.minimum, "max", demR.maximum, demR.width, "x", demR.height)

# ---------------------------------------------------------------- 2. Buildings ground_z + height
log("[3] building ground elevation (Z_MIN) via 3D AddSurfaceInformation")
arcpy.CheckOutExtension("3D")
bld_w = os.path.join(SCR, "bld")
arcpy.management.CopyFeatures(BLD, bld_w)
arcpy.management.RepairGeometry(bld_w)
arcpy.ddd.AddSurfaceInformation(bld_w, dem, "Z_MIN;Z_MEAN", "BILINEAR")

log("[4] compute gz, h fields")
for fn in ["gz", "h"]:
    if fn not in [f.name for f in arcpy.ListFields(bld_w)]:
        arcpy.management.AddField(bld_w, fn, "DOUBLE")
with arcpy.da.UpdateCursor(bld_w, ["Z_Min", "HEIGHT", "GRND_FLR", "gz", "h"]) as cur:
    for zmin, H, FL, gz, h in cur:
        gz = float(zmin) if zmin is not None else 0.0
        if H and H > 0:      h = float(H)
        elif FL and FL > 0:  h = float(FL) * 3.0
        else:                h = 3.0
        cur.updateRow([zmin, H, FL, gz, h])

log("[5] export buildings.geojson (4326, slim fields)")
bld4326 = os.path.join(SCR, "bld4326")
arcpy.management.Project(bld_w, bld4326, SR4326)
# keep only gz,h (+ a couple ids) to shrink file
keep = {"gz", "h", "BLD_NM", "GRND_FLR"}
for f in arcpy.ListFields(bld4326):
    if (not f.required) and f.name not in keep and f.type not in ("Geometry",):
        try: arcpy.management.DeleteField(bld4326, f.name)
        except: pass
bgj = os.path.join(OUT, "buildings.geojson")
if os.path.exists(bgj): os.remove(bgj)
arcpy.conversion.FeaturesToJSON(bld4326, bgj, "NOT_FORMATTED", "NO_Z_VALUES", "NO_M_VALUES", geoJSON="GEOJSON")
log("  ->", bgj, round(os.path.getsize(bgj)/1e6, 1), "MB")

# ---------------------------------------------------------------- 3. DEM heightmap PNG (16-bit gray)
log("[6] DEM -> 16-bit heightmap png")
arr = arcpy.RasterToNumPyArray(demR, nodata_to_value=np.nan).astype("float64")
H, W = arr.shape
valid = np.isfinite(arr)
zmin = float(np.nanmin(arr)); zmax = float(np.nanmax(arr))
norm = np.zeros((H, W), dtype=np.uint16)
scaled = np.clip((arr - zmin) / max(zmax - zmin, 1e-6), 0, 1)
norm[valid] = (1 + np.round(scaled[valid] * 65534)).astype(np.uint16)  # 0 reserved = nodata

def write_png_gray16(path, a16):
    h, w = a16.shape
    be = a16.astype('>u2')
    raw = np.zeros((h, 1 + w * 2), dtype=np.uint8)
    raw[:, 1:] = be.view(np.uint8).reshape(h, w * 2)
    comp = zlib.compress(raw.tobytes(), 9)
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 16, 0, 0, 0, 0)  # 16-bit grayscale
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b""))

png = os.path.join(OUT, "dem.png")
write_png_gray16(png, norm)
log("  ->", png, round(os.path.getsize(png)/1e6, 1), "MB", W, "x", H)

# bbox of DEM extent in 4326
def to4326(x, y):
    pg = arcpy.PointGeometry(arcpy.Point(x, y), SR5186).projectAs(SR4326)
    return pg.centroid.X, pg.centroid.Y
lon0, lat0 = to4326(ext.XMin, ext.YMin)
lon1, lat1 = to4326(ext.XMax, ext.YMax)
meta = {"w": W, "h": H,
        "bbox": {"west": lon0, "south": lat0, "east": lon1, "north": lat1},
        "zmin": zmin, "zmax": zmax, "cell_m": 10, "crs_src": 5186}
with open(os.path.join(OUT, "dem_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)
log("  meta:", meta["bbox"], "z", round(zmin,1), round(zmax,1))

# ---------------------------------------------------------------- 4. official flood maps -> geojson
log("[7] official flood extents -> geojson")
flood_src = {
    "river_100": u"행정구역 세종특별자치시 세종특별자치시 100년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_100.shp",
    "river_200": u"행정구역 세종특별자치시 세종특별자치시 200년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_200.shp",
    "river_500": u"행정구역 세종특별자치시 세종특별자치시 500년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_500.shp",
    "river_max": u"행정구역 세종특별자치시 세종특별자치시 기왕최대 국가하천 하천범람지도\\RFM_SGG_NTN_36110_MAX.shp",
    "urban_max": u"행정구역 세종특별자치시 세종특별자치시 기왕최대 도시침수지도\\CFM_SGG_36110_MAX.shp",
}
for name, rel in flood_src.items():
    src = os.path.join(DESK, rel)
    if not arcpy.Exists(src):
        log("  missing", name); continue
    p4326 = os.path.join(SCR, "fl_" + name)
    arcpy.management.Project(src, p4326, SR4326)
    out = os.path.join(FLOUT, name + ".geojson")
    if os.path.exists(out): os.remove(out)
    arcpy.conversion.FeaturesToJSON(p4326, out, "NOT_FORMATTED", geoJSON="GEOJSON")
    log("  ->", name, round(os.path.getsize(out)/1e6, 2), "MB")

log("DONE")
