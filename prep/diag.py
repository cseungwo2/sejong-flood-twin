# -*- coding: utf-8 -*-
import arcpy, os
arcpy.env.overwriteOutput = True

DEM_CONT = r"C:\Users\user\Desktop\DEM_세종\N3L_F0010000_36.shp"
BLD      = r"C:\Users\user\Desktop\새 폴더\Urban Planning\GIS\F_FAC_BUILDING_세종\F_FAC_BUILDING_36_202604.shp"

print("=== Licenses ===")
for ext in ["Spatial","3D"]:
    print(ext, arcpy.CheckExtension(ext))

print("\n=== Contours (DEM source) ===")
d = arcpy.Describe(DEM_CONT)
print("type:", d.shapeType, "| sr:", d.spatialReference.name, d.spatialReference.factoryCode)
ext = d.extent
print("extent:", round(ext.XMin), round(ext.YMin), round(ext.XMax), round(ext.YMax))
print("count:", arcpy.management.GetCount(DEM_CONT)[0])
# elevation range
zs=[]
with arcpy.da.SearchCursor(DEM_CONT, ["CONT"]) as cur:
    for r in cur:
        try: zs.append(float(r[0]))
        except: pass
print("CONT min/max:", min(zs), max(zs), "n=",len(zs))

print("\n=== Buildings ===")
db = arcpy.Describe(BLD)
print("sr:", db.spatialReference.name, db.spatialReference.factoryCode)
print("count:", arcpy.management.GetCount(BLD)[0])
fields=[f.name for f in arcpy.ListFields(BLD)]
print("has HEIGHT:", "HEIGHT" in fields, "| has GRND_FLR:", "GRND_FLR" in fields)
nH=nF=both0=0; tot=0
with arcpy.da.SearchCursor(BLD, ["HEIGHT","GRND_FLR"]) as cur:
    for h,fl in cur:
        tot+=1
        if h and h>0: nH+=1
        if fl and fl>0: nF+=1
        if (not h or h<=0) and (not fl or fl<=0): both0+=1
print(f"total={tot}  HEIGHT>0={nH}  GRND_FLR>0={nF}  both0={both0}")
