/**
 * Captura a URL do Cloudflare Quick Tunnel e salva/envia
 * Lê stdin do cloudflared e procura a URL trycloudflare.com
 */

const fs = require('fs');
const path = require('path');

const URL_FILE = path.join(__dirname, 'tunnel-url.txt');
const MEMORY_URL = process.env.JARBAS_MEMORY_URL || '';
const MEMORY_TOKEN = process.env.JARBAS_MEMORY_TOKEN || '';

let urlFound = false;

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  // Mostrar output do cloudflared
  process.stdout.write(chunk);

  // Procurar URL do tunnel
  if (!urlFound) {
    const match = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
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

      // Enviar para Jarbas Memory API (se configurado)
      if (MEMORY_URL && MEMORY_TOKEN) {
        sendToMemory(tunnelUrl);
      }
    }
  }
});

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
