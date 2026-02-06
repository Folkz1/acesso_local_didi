#!/bin/sh
set -e

echo "============================================"
echo "  Jarbas Remote Bridge - VPS Connector"
echo "============================================"

# Iniciar Tailscale daemon em background
echo "Starting Tailscale daemon..."
tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &

# Aguardar daemon subir
sleep 3

# Conectar ao Tailscale com auth key
if [ -n "$TAILSCALE_AUTHKEY" ]; then
  echo "Connecting to Tailscale network..."
  tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=jarbas-vps
  echo "Tailscale connected! VPS IP:"
  tailscale ip -4
else
  echo "WARNING: TAILSCALE_AUTHKEY not set!"
  echo "Set TAILSCALE_AUTHKEY in EasyPanel environment variables."
fi

echo ""
echo "Starting bridge proxy..."
echo "============================================"

# Iniciar o proxy/connector Node
exec node bridge-server.js
