# -*- coding: utf-8 -*-
"""lot_overlay.png 재합성 — 지적 필지경계 제거, 실제 도로만 남김.
   기존 recompose_lot.py 와 동일 격자/정합, 단 parcel line 레이어를 그리지 않는다."""
import arcpy, os, struct, zlib
import numpy as np

ROOT = r"C:\Users\user\Desktop\새 폴더 (4)\SejongFloodTwin"
OUT  = os.path.join(ROOT, "web", "data")
par_r = os.path.join(ROOT, "prep", "par_id.tif")   # 격자/범위 기준용
rd_r  = os.path.join(ROOT, "prep", "road.tif")

# par_id 는 출력 격자(크기/정합) 기준으로만 사용
idarr = arcpy.RasterToNumPyArray(arcpy.Raster(par_r), nodata_to_value=0)
H, W = idarr.shape
road = arcpy.RasterToNumPyArray(arcpy.Raster(rd_r), nodata_to_value=0)
if road.shape != (H, W):
    rh, rw = min(H, road.shape[0]), min(W, road.shape[1])
    tmp = np.zeros((H, W), road.dtype); tmp[:rh, :rw] = road[:rh, :rw]; road = tmp

rgba = np.zeros((H, W, 4), np.uint8)
# 필지경계(line) 레이어는 그리지 않음. 도로만 — 단독이라 약간만 또렷하게.
rgba[road > 0] = [210, 216, 224, 150]
print("road px", int((road > 0).sum()), "grid", W, "x", H, flush=True)

def png_rgba(path, a):
    h, w, _ = a.shape
    raw = np.zeros((h, 1 + w * 4), np.uint8); raw[:, 1:] = a.reshape(h, w * 4)
    comp = zlib.compress(raw.tobytes(), 6)
    ch = lambda t, dd: struct.pack(">I", len(dd)) + t + dd + struct.pack(">I", zlib.crc32(t + dd) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n"
        + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + ch(b"IDAT", comp) + ch(b"IEND", b""))

png_rgba(os.path.join(OUT, "lot_overlay.png"), rgba)
print("DONE", round(os.path.getsize(os.path.join(OUT, "lot_overlay.png")) / 1e6, 2), "MB", flush=True)
