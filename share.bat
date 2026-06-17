@echo off
chcp 65001 >nul
title REDI Lab 공유 터널
cd /d "%~dp0"
echo [1/2] 로컬 서버 시작 (:8765)
start "" /min cmd /c "cd web && (where python >nul 2>nul && python -m http.server 8765 || \"C:\Python314\python.exe\" -m http.server 8765)"
timeout /t 2 >nul
echo [2/2] Cloudflare 퀵터널 시작 — 아래 https://....trycloudflare.com 주소를 공유하세요
echo (이 창을 닫으면 링크가 끊깁니다)
cloudflared.exe tunnel --no-autoupdate --url http://localhost:8765
pause
