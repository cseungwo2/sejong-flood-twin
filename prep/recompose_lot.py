# -*- coding: utf-8 -*-
"""기존 par_id.tif / road.tif 를 다시 합성 — 도로를 은은하게 톤다운."""
import arcpy, os, struct, zlib
import numpy as np
ROOT=r"C:\Users\user\Desktop\SejongFloodTwin"
OUT =os.path.join(ROOT,"web","data")
par_r=os.path.join(ROOT,"prep","par_id.tif")
rd_r =os.path.join(ROOT,"prep","road.tif")

idarr=arcpy.RasterToNumPyArray(arcpy.Raster(par_r),nodata_to_value=0).astype(np.int64)
H,W=idarr.shape
road=arcpy.RasterToNumPyArray(arcpy.Raster(rd_r),nodata_to_value=0)
if road.shape!=idarr.shape:
    rh,rw=min(H,road.shape[0]),min(W,road.shape[1]); tmp=np.zeros((H,W),road.dtype); tmp[:rh,:rw]=road[:rh,:rw]; road=tmp

line=np.zeros((H,W),bool)
line[:,:-1]|=(idarr[:,:-1]!=idarr[:,1:]); line[:-1,:]|=(idarr[:-1,:]!=idarr[1:,:])
line&=(idarr!=0)
d=np.zeros((H,W),bool)
d[:,1:]|=line[:,:-1]; d[:,:-1]|=line[:,1:]; d[1:,:]|=line[:-1,:]; d[:-1,:]|=line[1:,:]
line|=d

rgba=np.zeros((H,W,4),np.uint8)
rgba[line]=[198,205,216,120]      # 필지 경계: 옅은 회청색 (유지)
rgba[road>0]=[206,212,220,72]     # 도로: 은은한 연회색·저투명도 (톤다운)
print("parcel px",int(line.sum()),"road px",int((road>0).sum()),flush=True)

def png_rgba(path,a):
    h,w,_=a.shape; raw=np.zeros((h,1+w*4),np.uint8); raw[:,1:]=a.reshape(h,w*4)
    comp=zlib.compress(raw.tobytes(),6)
    ch=lambda t,dd: struct.pack(">I",len(dd))+t+dd+struct.pack(">I",zlib.crc32(t+dd)&0xffffffff)
    open(path,"wb").write(b"\x89PNG\r\n\x1a\n"+ch(b"IHDR",struct.pack(">IIBBBBB",w,h,8,6,0,0,0))+ch(b"IDAT",comp)+ch(b"IEND",b""))
png_rgba(os.path.join(OUT,"lot_overlay.png"),rgba)
print("DONE",round(os.path.getsize(os.path.join(OUT,'lot_overlay.png'))/1e6,1),"MB",flush=True)
