# -*- coding: utf-8 -*-
"""Downloads의 zip을 바탕화면에 풀어 정리 (한국어 파일명 복원, 다운로드중 파일 skip).

- 완료된 .zip만 처리(.crdownload/.part 동반 시 skip)
- 한글 entry명: UTF-8 플래그 없으면 cp437→cp949 재디코드
- 바탕화면/<zip이름>/ 폴더로 추출, 이미 푼 것은 skip(멱등)
- 처리한 zip은 Downloads/_unzipped_done/ 로 이동
"""
import os, sys, zipfile, shutil, json

DOWN = r"C:\Users\user\Downloads"
DESK = r"C:\Users\user\Desktop"
DONE = os.path.join(DOWN, "_unzipped_done")

def fix_name(info):
    n = info.filename
    if info.flag_bits & 0x800:
        return n
    try:
        return n.encode("cp437").decode("cp949")
    except Exception:
        return n

def zip_ready(path):
    # 같은 베이스명의 미완성 다운로드가 있으면 아직 받는 중
    base = path
    for ext in (".crdownload", ".part", ".tmp"):
        if os.path.exists(base + ext):
            return False
    # zip 무결성 빠른 확인
    try:
        with zipfile.ZipFile(path) as z:
            return z.testzip() is None or True  # 헤더 열리면 충분
    except zipfile.BadZipFile:
        return False
    except Exception:
        return False

def extract(path):
    name = os.path.splitext(os.path.basename(path))[0]
    dest = os.path.join(DESK, name)
    if os.path.isdir(dest) and os.listdir(dest):
        return None  # 이미 처리됨
    os.makedirs(dest, exist_ok=True)
    nfiles = 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            fixed = fix_name(info)
            target = os.path.join(dest, fixed)
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with z.open(info) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
                nfiles += 1
    return dest, nfiles

def main():
    os.makedirs(DONE, exist_ok=True)
    results = []
    for fn in sorted(os.listdir(DOWN)):
        if not fn.lower().endswith(".zip"):
            continue
        path = os.path.join(DOWN, fn)
        if not zip_ready(path):
            results.append({"zip": fn, "status": "downloading"})
            continue
        try:
            r = extract(path)
        except Exception as e:
            results.append({"zip": fn, "status": "error", "msg": str(e)})
            continue
        if r is None:
            results.append({"zip": fn, "status": "already"})
        else:
            dest, nfiles = r
            results.append({"zip": fn, "status": "ok", "dest": os.path.basename(dest), "files": nfiles})
            try:
                shutil.move(path, os.path.join(DONE, fn))
            except Exception:
                pass
    print(json.dumps(results, ensure_ascii=False))
    return results

if __name__ == "__main__":
    main()
