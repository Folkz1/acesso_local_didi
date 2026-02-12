@echo off
title Jarbas Remote Bridge + Tunnel
cd /d "D:\jarbas_vida\skills\remote-executor"

echo ============================================
echo   Jarbas Remote Bridge - Auto Start
echo ============================================

:: Iniciar bridge server em background
echo Starting bridge server...
start /B node bridge-server.js

:: Aguardar bridge subir
timeout /t 3 /nobreak >nul

:: Iniciar cloudflared tunnel e capturar URL
echo Starting Cloudflare Tunnel...
set LOG_FILE=%CD%\tunnel.log
echo [%DATE% %TIME%] Starting Cloudflare Tunnel...>> "%LOG_FILE%"
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8788 2>&1 | node capture-tunnel-url.js >> "%LOG_FILE%" 2>&1

pause
