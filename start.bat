@echo off
chcp 65001 >nul
title 세종시 침수 디지털트윈
cd /d "%~dp0web"

REM --- 1) 8765 포트에 남아 있는 이전(좀비) 서버 정리 ---
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 " ^| findstr LISTENING') do (
  echo 이전 서버 종료: PID %%a
  taskkill /f /pid %%a >nul 2>nul
)

REM --- 2) 서버가 실제로 뜨면 그때 브라우저 열기 (레이스 방지) ---
start "" /min powershell -NoProfile -Command "do { Start-Sleep -Milliseconds 400 } until (Test-NetConnection -ComputerName localhost -Port 8765 -InformationLevel Quiet); Start-Process 'http://localhost:8765/index.html'"

REM --- 3) 로컬 서버 시작 (이 창을 닫으면 서버 종료) ---
echo 로컬 서버 시작: http://localhost:8765/index.html
echo (이 창을 닫으면 서버가 종료됩니다)
where py >nul 2>nul && (py -3 nocache_server.py) || (where python >nul 2>nul && (python nocache_server.py) || ("C:\Python314\python.exe" nocache_server.py))
pause
