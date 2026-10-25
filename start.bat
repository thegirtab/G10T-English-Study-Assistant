@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   English Loop 正在启动...
echo   浏览器会自动打开 http://localhost:5173
echo   关闭这个窗口即停止服务。
echo.
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:5173"
node server.js
if errorlevel 1 pause
