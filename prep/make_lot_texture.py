# -*- coding: utf-8 -*-
"""지적(필지 경계) + 실폭도로 -> 투명 RGBA PNG (위성영상 위 합성용).
DEM과 동일 extent(EPSG:5186)로 래스터화하여 정렬."""
import arcpy, os, struct, zlib
import numpy as np

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("Spatial")
ROOT=r"C:\Users\user\Desktop\SejongFloodTwin"
DESK=r"C:\Users\user\Desktop"
OUT =os.path.join(ROOT,"web","data")
SCR =os.path.join(ROOT,"prep","scratch.gdb")
arcpy.env.workspace=SCR
SR5186=arcpy.SpatialReference(5186)
dem_tif=os.path.join(ROOT,"prep","dem.tif")

LDREG=os.path.join(DESK,u"새 폴더",u"Urban Planning",u"GIS",u"LSMD_CONT_LDREG_세종",u"LSMD_CONT_LDREG_36_202604.shp")
ROADS=os.path.join(DESK,u"새 폴더",u"Urban Planning",u"GIS",u"(도로명주소)실폭도로_세종",u"TL_SPRD_RW_36_202604.shp")

def log(*a): print(*a,flush=True)

demR=arcpy.Raster(dem_tif); ext=demR.extent
CELL=5
arcpy.env.outputCoordinateSystem=SR5186
arcpy.env.extent=ext
arcpy.env.snapRaster=dem_tif

# --- parcels -> id raster (5186) ---
log("[1] parcels -> id raster")
par=os.path.join(SCR,"par5186")
arcpy.management.Project(LDREG,par,SR5186)
arcpy.management.AddField(par,"RID","LONG")
arcpy.management.CalculateField(par,"RID","!OBJECTID!","PYTHON3")
par_r=os.path.join(ROOT,"prep","par_id.tif")
arcpy.conversion.PolygonToRaster(par,"RID",par_r,"CELL_CENTER","NONE",CELL)
log("  done")

# --- roads -> fill raster (5186) ---
log("[2] roads -> raster")
rd=os.path.join(SCR,"rd5186")
arcpy.management.Project(ROADS,rd,SR5186)
arcpy.management.AddField(rd,"RV","SHORT")
arcpy.management.CalculateField(rd,"RV","1","PYTHON3")
rd_r=os.path.join(ROOT,"prep","road.tif")
arcpy.conversion.PolygonToRaster(rd,"RV",rd_r,"CELL_CENTER","NONE",CELL)
log("  done")

# --- numpy compose ---
log("[3] compose RGBA")
idarr=arcpy.RasterToNumPyArray(arcpy.Raster(par_r),nodata_to_value=0).astype(np.int64)
H,W=idarr.shape
road=arcpy.RasterToNumPyArray(arcpy.Raster(rd_r),nodata_to_value=0)
if road.shape!=idarr.shape:
    rh,rw=min(H,road.shape[0]),min(W,road.shape[1])
    tmp=np.zeros((H,W),road.dtype); tmp[:rh,:rw]=road[:rh,:rw]; road=tmp
log("  shape",W,"x",H)

# parcel boundaries via edge detection
line=np.zeros((H,W),bool)
line[:,:-1] |= (idarr[:,:-1]!=idarr[:,1:])
line[:-1,:] |= (idarr[:-1,:]!=idarr[1:,:])
line &= (idarr!=0)
# 살짝 두껍게(dilate 1px)
d=np.zeros((H,W),bool)
d[:,1:]|=line[:,:-1]; d[:,:-1]|=line[:,1:]; d[1:,:]|=line[:-1,:]; d[:-1,:]|=line[1:,:]
line|=d

rgba=np.zeros((H,W,4),np.uint8)
rgba[line]=[205,210,220,130]      # 필지 경계: 옅은 회청색
rgba[road>0]=[255,247,220,205]    # 도로: 따뜻한 흰색
log("  parcel px",int(line.sum()),"road px",int((road>0).sum()))

def png_rgba(path,a):
    h,w,_=a.shape
    raw=np.zeros((h,1+w*4),np.uint8); raw[:,1:]=a.reshape(h,w*4)
    comp=zlib.compress(raw.tobytes(),6)
    ch=lambda t,d: struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
    open(path,"wb").write(b"\x89PNG\r\n\x1a\n"+ch(b"IHDR",struct.pack(">IIBBBBB",w,h,8,6,0,0,0))+ch(b"IDAT",comp)+ch(b"IEND",b""))

out=os.path.join(OUT,"lot_overlay.png")
png_rgba(out,rgba)
log("  ->",out,round(os.path.getsize(out)/1e6,1),"MB")
log("DONE")
