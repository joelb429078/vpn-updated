@echo off
rem Launch the VPNBook client. OpenVPN needs admin rights to add routes,
rem so relaunch elevated if we aren't already.
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
call npm start
