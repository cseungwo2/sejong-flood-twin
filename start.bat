@echo off
chcp 65001 >nul
title 세종시 침수 디지털트윈
cd /d "%~dp0web"
echo 로컬 서버 시작: http://localhost:8765/index.html
start "" http://localhost:8765/index.html
where python >nul 2>nul && (python -m http.server 8765) || ("C:\Python314\python.exe" -m http.server 8765)
pause
