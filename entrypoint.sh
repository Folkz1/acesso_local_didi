#!/bin/sh

echo "============================================"
echo "  Jarbas Remote Bridge - VPS Container"
echo "============================================"

# Iniciar Tailscale daemon em background (ignora erros)
if command -v tailscaled >/dev/null 2>&1; then
  echo "Starting Tailscale daemon..."
  tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &
  sleep 3

  if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Connecting to Tailscale network..."
    tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname=jarbas-vps || echo "Tailscale connection failed, continuing anyway..."
    tailscale ip -4 2>/dev/null || true
  else
    echo "WARNING: TAILSCALE_AUTHKEY not set"
  fi
else
  echo "Tailscale not installed, skipping..."
fi

echo ""
echo "Starting Node.js bridge server..."
echo "============================================"

exec node bridge-server.js
