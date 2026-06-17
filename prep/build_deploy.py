# -*- coding: utf-8 -*-
"""Netlify 배포용 최적화 빌드 -> SejongFloodTwin/dist
 - 건물: 좌표 6자리 반올림 + 속성 gz,h만, minify
 - 홍수지도: SimplifyPolygon(8m) 후 geojson
 - dem.png 제외(미사용)"""
import arcpy, os, json, shutil
arcpy.env.overwriteOutput=True
ROOT=r"C:\Users\user\Desktop\SejongFloodTwin"
DESK=r"C:\Users\user\Desktop"
WEB=os.path.join(ROOT,"web"); DATA=os.path.join(WEB,"data")
DIST=os.path.join(ROOT,"dist"); DDATA=os.path.join(DIST,"data"); DFL=os.path.join(DDATA,"flood")
SCR=os.path.join(ROOT,"prep","scratch.gdb")
SR4326=arcpy.SpatialReference(4326)
for d in (DIST,DDATA,DFL): os.makedirs(d,exist_ok=True)
def log(*a): print(*a,flush=True)

# 1) static copies
for f in ["index.html","app.js"]: shutil.copy(os.path.join(WEB,f),os.path.join(DIST,f))
for f in ["terrain.bin","terrain_meta.json","dem_meta.json","lot_overlay.png"]:
    src=os.path.join(DATA,f)
    if os.path.exists(src): shutil.copy(src,os.path.join(DDATA,f))
log("[1] copied static + terrain + lot_overlay")

# 2) buildings minify
log("[2] minify buildings.geojson")
gj=json.load(open(os.path.join(DATA,"buildings.geojson"),encoding="utf-8"))
def r6(c):
    if isinstance(c,(int,float)): return round(c,6)
    return [r6(x) for x in c]
out=[]
for f in gj["features"]:
    g=f.get("geometry");
    if not g: continue
    p=f.get("properties",{})
    out.append({"type":"Feature","geometry":{"type":g["type"],"coordinates":r6(g["coordinates"])},
                "properties":{"gz":round(float(p.get("gz",0)),1),"h":round(float(p.get("h",3)),1)}})
fc={"type":"FeatureCollection","features":out}
json.dump(fc,open(os.path.join(DDATA,"buildings.geojson"),"w",encoding="utf-8"),
          ensure_ascii=False,separators=(",",":"))
log("  ->",round(os.path.getsize(os.path.join(DDATA,'buildings.geojson'))/1e6,1),"MB")

# 3) flood simplify
flood_src={
 "river_100":u"행정구역 세종특별자치시 세종특별자치시 100년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_100.shp",
 "river_200":u"행정구역 세종특별자치시 세종특별자치시 200년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_200.shp",
 "river_500":u"행정구역 세종특별자치시 세종특별자치시 500년 빈도 국가하천 하천범람지도\\RFM_SGG_NTN_36110_500.shp",
 "river_max":u"행정구역 세종특별자치시 세종특별자치시 기왕최대 국가하천 하천범람지도\\RFM_SGG_NTN_36110_MAX.shp",
 "urban_max":u"행정구역 세종특별자치시 세종특별자치시 기왕최대 도시침수지도\\CFM_SGG_36110_MAX.shp",
}
log("[3] simplify flood")
for name,rel in flood_src.items():
    src=os.path.join(SCR,"fl_"+name)
    if not arcpy.Exists(src):
        s=os.path.join(DESK,rel)
        if not arcpy.Exists(s): log("  miss",name); continue
        arcpy.management.Project(s,src,SR4326)
    simp=os.path.join(SCR,"sm_"+name)
    try:
        arcpy.cartography.SimplifyPolygon(src,simp,"POINT_REMOVE","8 Meters",
            collapsed_point_option="NO_KEEP")
        use=simp
    except Exception as e:
        log("  simplify fail",name,e); use=src
    out=os.path.join(DFL,name+".geojson")
    if os.path.exists(out): os.remove(out)
    arcpy.conversion.FeaturesToJSON(use,out,"NOT_FORMATTED",geoJSON="GEOJSON")
    log("  ->",name,round(os.path.getsize(out)/1e6,2),"MB")

# size report
tot=sum(os.path.getsize(os.path.join(dp,f)) for dp,_,fs in os.walk(DIST) for f in fs)
log("TOTAL dist:",round(tot/1e6,1),"MB")
log("DONE ->",DIST)
