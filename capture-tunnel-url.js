/**
 * Captura a URL do Cloudflare Quick Tunnel e salva/envia
 * LÃª stdin do cloudflared e procura a URL trycloudflare.com
 * Envia via WhatsApp (Evolution API) e Jarbas Memory API
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const URL_FILE = path.join(__dirname, 'tunnel-url.txt');
const OPENAPI_FILE = path.join(__dirname, 'openapi.json');
const MEMORY_URL = process.env.JARBAS_MEMORY_URL || '';
const MEMORY_TOKEN = process.env.JARBAS_MEMORY_TOKEN || '';
const BRIDGE_TOKEN =
  process.env.BRIDGE_TOKEN ||
  process.env.REMOTE_BRIDGE_TOKEN ||
  'jarbas_bridge_2026_acesso_remoto_seguro_didi_token_secreto';

// Evolution API Config
const EVOLUTION_URL = process.env.EVOLUTION_URL || 'https://apps-evolution-api.klx2s6.easypanel.host';
const EVOLUTION_KEY = process.env.EVOLUTION_KEY || '94844982814C-49AB-8CEE-F6E840AA3DF5';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'teste';
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || '5551993299031';

let urlFound = false;

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  // Mostrar output do cloudflared
  process.stdout.write(chunk);

  // Procurar URL do tunnel
  if (!urlFound) {
    const match = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      const tunnelUrl = match[0];
      urlFound = true;

      console.log('\n============================================');
      console.log('  TUNNEL URL CAPTURADA!');
      console.log('  ' + tunnelUrl);
      console.log('============================================\n');

      // Salvar em arquivo
      fs.writeFileSync(URL_FILE, tunnelUrl, 'utf8');
      console.log('URL salva em: ' + URL_FILE);

      // Atualizar OpenAPI para o OpenClaw usar URL nova
      updateOpenApiServerUrl(tunnelUrl);

      // Enviar via WhatsApp
      sendWhatsApp(tunnelUrl);

      // Enviar para Jarbas Memory API (se configurado)
      if (MEMORY_URL && MEMORY_TOKEN) {
        sendToJarbas(tunnelUrl);
      }
    }
  }
});

function updateOpenApiServerUrl(tunnelUrl) {
  try {
    if (!fs.existsSync(OPENAPI_FILE)) return;

    const openapi = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
    if (!Array.isArray(openapi.servers) || openapi.servers.length === 0) {
      openapi.servers = [{ url: tunnelUrl, description: 'Bridge server via Cloudflare Tunnel' }];
    } else {
      openapi.servers[0].url = tunnelUrl;
    }

    fs.writeFileSync(OPENAPI_FILE, JSON.stringify(openapi, null, 2), 'utf8');
    console.log('OpenAPI atualizado em: ' + OPENAPI_FILE);
  } catch (err) {
    console.log('Aviso: falha ao atualizar openapi.json:', err.message);
  }
}

async function sendWhatsApp(tunnelUrl) {
  const message = `ðŸŒ *Jarbas Remote Bridge*\n\n` +
    `Nova URL do tunnel:\n${tunnelUrl}\n\n` +
    `ðŸ”‘ Token: ${BRIDGE_TOKEN}\n\n` +
    `ðŸ“¡ Health: ${tunnelUrl}/health\n` +
    `â° ${new Date().toLocaleString('pt-BR')}`;

  try {
    const response = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_KEY
      },
      body: JSON.stringify({
        number: NOTIFY_NUMBER,
        text: message
      })
    });

    const result = await response.json();
    if (response.ok) {
      console.log('URL enviada via WhatsApp para ' + NOTIFY_NUMBER);
    } else {
      console.log('Erro WhatsApp:', JSON.stringify(result));
    }
  } catch (err) {
    console.log('Aviso: nao conseguiu enviar WhatsApp:', err.message);
  }
}

async function sendToJarbas(tunnelUrl) {
  await syncBridgeState(tunnelUrl);
  await sendToMemory(tunnelUrl);
}

async function syncBridgeState(tunnelUrl) {
  try {
    const response = await fetch(MEMORY_URL + '/bridge/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MEMORY_TOKEN
      },
      body: JSON.stringify({
        url: tunnelUrl,
        token: BRIDGE_TOKEN,
        health_url: `${tunnelUrl}/health`,
        source: 'cloudflare-quick-tunnel',
        instance: EVOLUTION_INSTANCE,
        host: require('os').hostname()
      })
    });

    if (response.ok) {
      console.log('Bridge state sincronizado no Jarbas API!');
    } else {
      const errorText = await response.text();
      console.log('Aviso: falha ao sincronizar bridge state:', errorText);
    }
  } catch (err) {
    console.log('Aviso: nao conseguiu sincronizar bridge state:', err.message);
  }
}

async function sendToMemory(tunnelUrl) {
  try {
    const response = await fetch(MEMORY_URL + '/memory/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MEMORY_TOKEN
      },
      body: JSON.stringify({
        key: 'bridge_tunnel_url',
        type: 'config',
        title: 'Bridge Tunnel URL',
        content: tunnelUrl,
        tags: ['bridge', 'tunnel', 'config'],
        metadata: {
          updated_at: new Date().toISOString(),
          pc_name: require('os').hostname()
        }
      })
    });

    if (response.ok) {
      console.log('URL enviada para Jarbas Memory API!');
    }
  } catch (err) {
    console.log('Aviso: nao conseguiu enviar para Memory API:', err.message);
  }
}

process.stdin.on('end', () => {
  console.log('Cloudflared encerrou.');
});

