@echo off
title Jarbas Remote Bridge + Tunnel
cd /d "D:\jarbas_vida\skills\remote-executor"

echo ============================================
echo   Jarbas Remote Bridge - Auto Start
echo ============================================

:: Start everything as background processes (no pipe, no need to keep this window open)
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\start-all.ps1"
