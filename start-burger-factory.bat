@echo off
title The Burger Factory - Local & Wi-Fi Network Server
color 0E
cls

echo ============================================================================
echo   THE BURGER FACTORY -- FULL-STACK LAN SERVER LAUNCHER
echo ============================================================================
echo.

cd /d "%~dp0"

:: Detect primary Wi-Fi / LAN IPv4 Address using PowerShell
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Bluetooth' -and $_.IPAddress -notmatch '^169\.254' } | Select-Object -First 1).IPAddress"`) do (
    set LAN_IP=%%a
)

if "%LAN_IP%"=="" set LAN_IP=localhost

echo   [NETWORK READY] Connect your Phone to the same Wi-Fi network!
echo.
echo   --------------------------------------------------------------------------
echo   OPEN ON THIS PC (Customer Portal) : http://localhost:3000
echo   OPEN ON THIS PC (Staff Portal)    : http://localhost:3000/manager.html
echo   --------------------------------------------------------------------------
echo   OPEN ON YOUR PHONE (Customer)     : http://%LAN_IP%:3000
echo   OPEN ON YOUR PHONE (Staff Portal) : http://%LAN_IP%:3000/manager.html
echo   --------------------------------------------------------------------------
echo   STAFF PORTAL PASSCODE             : burger123
echo   --------------------------------------------------------------------------
echo.
echo   Starting Vite + Built-in Real-Time API Server on 0.0.0.0:3000...
echo.

start "" "http://localhost:3000"
call npx vite --host 0.0.0.0 --port 3000
pause
