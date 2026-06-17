# -*- coding: utf-8 -*-
"""Recompute building ground elevation by sampling DEM at building centroids
(robust for small buildings), then re-export buildings.geojson (4326)."""
import arcpy, os, json
import numpy as np
from arcpy.sa import ExtractValuesToPoints

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("Spatial")
ROOT=r"C:\Users\user\Desktop\SejongFloodTwin"
OUT =os.path.join(ROOT,"web","data")
SCR =os.path.join(ROOT,"prep","scratch.gdb")
arcpy.env.workspace=SCR
SR5186=arcpy.SpatialReference(5186); SR4326=arcpy.SpatialReference(4326)
dem_tif=os.path.join(ROOT,"prep","dem.tif")
bld=os.path.join(SCR,"bld")     # has gz,h fields already

def log(*a): print(*a,flush=True)

# 1) centroid points with link id
pts=os.path.join(SCR,"bpts")
if arcpy.Exists(pts): arcpy.management.Delete(pts)
arcpy.management.CreateFeatureclass(SCR,"bpts","POINT",spatial_reference=SR5186)
arcpy.management.AddField(pts,"SRCFID","LONG")
log("[1] centroids")
with arcpy.da.InsertCursor(pts,["SHAPE@XY","SRCFID"]) as ic:
    with arcpy.da.SearchCursor(bld,["OID@","SHAPE@TRUECENTROID"]) as sc:
        for oid,cen in sc: ic.insertRow([cen,oid])
log("  pts:",arcpy.management.GetCount(pts)[0])

# 2) sample dem
log("[2] ExtractValuesToPoints")
pz=os.path.join(SCR,"bpts_z")
if arcpy.Exists(pz): arcpy.management.Delete(pz)
ExtractValuesToPoints(pts,dem_tif,pz,"NONE","VALUE_ONLY")

zmap={}
with arcpy.da.SearchCursor(pz,["SRCFID","RASTERVALU"]) as sc:
    for fid,v in sc:
        if v is not None and v>-9000: zmap[fid]=float(v)
log("  sampled:",len(zmap))

# 3) write gz back
demR=arcpy.Raster(dem_tif); zfloor=float(demR.minimum)
log("[3] update gz (fallback floor=%.2f)"%zfloor)
vals=[]
with arcpy.da.UpdateCursor(bld,["OID@","gz"]) as uc:
    for oid,gz in uc:
        g=zmap.get(oid,zfloor); uc.updateRow([oid,g]); vals.append(g)
vals=np.array(vals)
log("  gz min/mean/max:",round(vals.min(),1),round(vals.mean(),1),round(vals.max(),1),
    "| <5m:",int((vals<5).sum()),"/",len(vals))

# 4) re-export geojson (4326)
log("[4] re-export buildings.geojson")
b4=os.path.join(SCR,"bld4326b")
if arcpy.Exists(b4): arcpy.management.Delete(b4)
arcpy.management.Project(bld,b4,SR4326)
keep={"gz","h","BLD_NM","GRND_FLR"}
for f in arcpy.ListFields(b4):
    if (not f.required) and f.name not in keep and f.type!="Geometry":
        try: arcpy.management.DeleteField(b4,f.name)
        except: pass
out=os.path.join(OUT,"buildings.geojson")
if os.path.exists(out): os.remove(out)
arcpy.conversion.FeaturesToJSON(b4,out,"NOT_FORMATTED","NO_Z_VALUES","NO_M_VALUES",geoJSON="GEOJSON")
log("  ->",round(os.path.getsize(out)/1e6,1),"MB")
log("DONE")
