# -*- coding: utf-8 -*-
"""Finish prep: dem(gdb)->tif, terrain.bin grid, dem.png, flood geojson."""
import arcpy, os, json, struct, zlib
import numpy as np

arcpy.env.overwriteOutput = True
ROOT = r"C:\Users\user\Desktop\SejongFloodTwin"
DESK = r"C:\Users\user\Desktop"
OUT  = os.path.join(ROOT, "web", "data")
FLOUT= os.path.join(OUT, "flood")
SCR  = os.path.join(ROOT, "prep", "scratch.gdb")
os.makedirs(FLOUT, exist_ok=True)
SR5186 = arcpy.SpatialReference(5186); SR4326 = arcpy.SpatialReference(4326)

def log(*a): print(*a, flush=True)

# 1) gdb raster -> tif (fixes RasterToNumPyArray "table not found")
dem_gdb = os.path.join(SCR, "dem")
dem_tif = os.path.join(ROOT, "prep", "dem.tif")
log("[1] CopyRaster -> tif")
arcpy.management.CopyRaster(dem_gdb, dem_tif, pixel_type="32_BIT_FLOAT")
r = arcpy.Raster(dem_tif); ext = r.extent
arr = arcpy.RasterToNumPyArray(r, nodata_to_value=np.nan).astype("float64")
H, W = arr.shape
zmin=float(np.nanmin(arr)); zmax=float(np.nanmax(arr))
log("  dem", W, "x", H, "z", round(zmin,1), round(zmax,1))

def to4326(x,y):
    pg=arcpy.PointGeometry(arcpy.Point(x,y),SR5186).projectAs(SR4326); return pg.centroid.X, pg.centroid.Y
w_,s_=to4326(ext.XMin,ext.YMin); e_,n_=to4326(ext.XMax,ext.YMax)
bbox={"west":w_,"south":s_,"east":e_,"north":n_}

# 2) downsampled terrain grid (Float32, row0=north, nodata=-9999)
log("[2] terrain.bin")
MAXD=500; step=max(1,int(np.ceil(max(W,H)/MAXD)))
Hc=(H//step)*step; Wc=(W//step)*step
blk=arr[:Hc,:Wc].reshape(Hc//step,step,Wc//step,step)
with np.errstate(invalid="ignore"): ds=np.nanmean(blk,axis=(1,3))
ny,nx=ds.shape
ds=np.where(np.isfinite(ds),ds,-9999.0).astype("<f4")
ds.tofile(os.path.join(OUT,"terrain.bin"))
json.dump({"nx":int(nx),"ny":int(ny),"cell_m":10*step,"bbox":bbox,
           "zmin":zmin,"zmax":zmax,"nodata":-9999.0},
          open(os.path.join(OUT,"terrain_meta.json"),"w"),indent=2)
log("  grid",nx,"x",ny,"step",step)

# 3) 16-bit heightmap png (Stage2 terrain water shader, optional)
log("[3] dem.png (16-bit)")
valid=np.isfinite(arr)
norm=np.zeros((H,W),dtype=np.uint16)
sc=np.clip((arr-zmin)/max(zmax-zmin,1e-6),0,1)
norm[valid]=(1+np.round(sc[valid]*65534)).astype(np.uint16)
def png16(path,a16):
    h,w=a16.shape; be=a16.astype('>u2')
    raw=np.zeros((h,1+w*2),dtype=np.uint8); raw[:,1:]=be.view(np.uint8).reshape(h,w*2)
    comp=zlib.compress(raw.tobytes(),6)
    ch=lambda t,d: struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
    open(path,"wb").write(b"\x89PNG\r\n\x1a\n"+ch(b"IHDR",struct.pack(">IIBBBBB",w,h,16,0,0,0,0))+ch(b"IDAT",comp)+ch(b"IEND",b""))
png16(os.path.join(OUT,"dem.png"),norm)
json.dump({"w":int(W),"h":int(H),"bbox":bbox,"zmin":zmin,"zmax":zmax},
          open(os.path.join(OUT,"dem_meta.json"),"w"),indent=2)

# 4) official flood extents -> geojson (4326)
log("[4] flood geojson")
flood_src={
 "river_100":u"행정구역 세종특별자치시 세종특별자치시 100년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_100.shp",
 "river_200":u"행정구역 세종특별자치시 세종특별자치시 200년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_200.shp",
 "river_500":u"행정구역 세종특별자치시 세종특별자치시 500년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_500.shp",
 "river_max":u"행정구역 세종특별자치시 세종특별자치시 기왕최대 국가하천 하천범람지도\\RFM_SGG_NTN_36110_MAX.shp",
 "urban_max":u"행정구역 세종특별자치시 세종특별자치시 기왕최대 도시침수지도\\CFM_SGG_36110_MAX.shp",
}
for name,rel in flood_src.items():
    src=os.path.join(DESK,rel)
    if not arcpy.Exists(src): log("  missing",name); continue
    p=os.path.join(SCR,"fl_"+name); arcpy.management.Project(src,p,SR4326)
    out=os.path.join(FLOUT,name+".geojson")
    if os.path.exists(out): os.remove(out)
    arcpy.conversion.FeaturesToJSON(p,out,"NOT_FORMATTED",geoJSON="GEOJSON")
    log("  ->",name,round(os.path.getsize(out)/1e6,2),"MB")
log("DONE")
