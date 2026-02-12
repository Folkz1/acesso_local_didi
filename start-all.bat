@echo off
title Jarbas Remote Bridge + Tunnel
cd /d "D:\jarbas_vida\skills\remote-executor"

echo ============================================
echo   Jarbas Remote Bridge - Auto Start
echo ============================================

:: Reinicio idempotente: se ja tiver rodando, mata os processos antigos
echo Cleaning previous bridge/tunnel processes (if any)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir='D:\jarbas_vida\skills\remote-executor';" ^
  "$nodeProcs=Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like \"*$dir*bridge-server.js*\" -or $_.CommandLine -like \"*$dir*capture-tunnel-url.js*\" };" ^
  "foreach($p in $nodeProcs){ try{Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue}catch{} }" ^
  "$cf=Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -like \"*tunnel*--url*http://localhost:8788*\" -or $_.CommandLine -like \"*tunnel*--url*http://127.0.0.1:8788*\" };" ^
  "foreach($p in $cf){ try{Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue}catch{} }"

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
