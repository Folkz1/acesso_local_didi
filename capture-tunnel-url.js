/**
 * Captures the Cloudflare Quick Tunnel URL from cloudflared stdout.
 *
 * Side effects:
 * - Saves it to tunnel-url.txt
 * - Updates openapi.json servers[0].url
 * - Optionally notifies via WhatsApp (Evolution API)
 * - Optionally syncs to Jarbas Memory Core (/bridge/sync)
 */

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");

const URL_FILE = path.join(__dirname, "tunnel-url.txt");
const OPENAPI_FILE = path.join(__dirname, "openapi.json");

let MEMORY_URL = process.env.JARBAS_MEMORY_URL || "";
if (MEMORY_URL) {
  MEMORY_URL = MEMORY_URL.trim();
  if (MEMORY_URL && !/^https?:\/\//i.test(MEMORY_URL)) {
    MEMORY_URL = `https://${MEMORY_URL}`;
  }
  MEMORY_URL = MEMORY_URL.replace(/\/+$/, "");
}
// Memory Core server uses JARBAS_MEMORY_AUTH_TOKEN. Keep backward compat with JARBAS_MEMORY_TOKEN.
const MEMORY_TOKEN =
  process.env.JARBAS_MEMORY_AUTH_TOKEN ||
  process.env.JARBAS_MEMORY_TOKEN ||
  "";

const BRIDGE_TOKEN =
  process.env.BRIDGE_TOKEN ||
  process.env.REMOTE_BRIDGE_TOKEN ||
  "jarbas_bridge_2026_acesso_remoto_seguro_didi_token_secreto";

// Evolution API Config
const EVOLUTION_URL =
  process.env.EVOLUTION_URL || "https://apps-evolution-api.klx2s6.easypanel.host";
const EVOLUTION_KEY =
  process.env.EVOLUTION_KEY || "94844982814C-49AB-8CEE-F6E840AA3DF5";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "teste";
const NOTIFY_NUMBER = process.env.NOTIFY_NUMBER || "5551993299031";

let urlFound = false;

process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk) => {
  // Keep cloudflared output visible.
  process.stdout.write(chunk);

  if (urlFound) return;

  const match = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (!match) return;

  const tunnelUrl = match[0];
  urlFound = true;

  console.log("\n============================================");
  console.log("  TUNNEL URL CAPTURED");
  console.log("  " + tunnelUrl);
  console.log("============================================\n");

  fs.writeFileSync(URL_FILE, tunnelUrl, "utf8");
  console.log("URL saved to: " + URL_FILE);

  updateOpenApiServerUrl(tunnelUrl);

  // Fire-and-forget side effects (do not block cloudflared output).
  void sendWhatsApp(tunnelUrl);
  if (MEMORY_URL && MEMORY_TOKEN) {
    void sendToJarbas(tunnelUrl);
  }
});

function updateOpenApiServerUrl(tunnelUrl) {
  try {
    if (!fs.existsSync(OPENAPI_FILE)) return;

    const openapi = JSON.parse(fs.readFileSync(OPENAPI_FILE, "utf8"));
    if (!Array.isArray(openapi.servers) || openapi.servers.length === 0) {
      openapi.servers = [
        { url: tunnelUrl, description: "Bridge server via Cloudflare Tunnel" },
      ];
    } else {
      openapi.servers[0].url = tunnelUrl;
    }

    fs.writeFileSync(OPENAPI_FILE, JSON.stringify(openapi, null, 2), "utf8");
    console.log("OpenAPI updated at: " + OPENAPI_FILE);
  } catch (err) {
    console.log("Warn: failed to update openapi.json:", err.message);
  }
}

async function sendWhatsApp(tunnelUrl) {
  const message =
    `Jarbas Remote Bridge\n\n` +
    `Nova URL do tunnel:\n${tunnelUrl}\n\n` +
    `Token: ${BRIDGE_TOKEN}\n\n` +
    `Health: ${tunnelUrl}/health\n` +
    `Quando: ${new Date().toLocaleString("pt-BR")}`;

  try {
    const response = await fetch(
      `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_KEY,
        },
        body: JSON.stringify({
          number: NOTIFY_NUMBER,
          text: message,
        }),
      },
    );

    const result = await response.json().catch(() => null);
    if (response.ok) {
      console.log("URL sent via WhatsApp to " + NOTIFY_NUMBER);
    } else {
      console.log("WhatsApp error:", JSON.stringify(result));
    }
  } catch (err) {
    console.log("Warn: failed to send WhatsApp:", err.message);
  }
}

async function sendToJarbas(tunnelUrl) {
  await syncBridgeState(tunnelUrl);
  await sendToMemory(tunnelUrl);
}

async function syncBridgeState(tunnelUrl) {
  try {
    const response = await fetch(MEMORY_URL + "/bridge/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + MEMORY_TOKEN,
      },
      body: JSON.stringify({
        url: tunnelUrl,
        token: BRIDGE_TOKEN,
        health_url: `${tunnelUrl}/health`,
        source: "cloudflare-quick-tunnel",
        instance: EVOLUTION_INSTANCE,
        host: os.hostname(),
      }),
    });

    if (response.ok) {
      console.log("Bridge state synced to Jarbas Memory Core.");
      return;
    }

    const errorText = await response.text().catch(() => "");
    console.log("Warn: /bridge/sync failed:", errorText);
  } catch (err) {
    console.log("Warn: /bridge/sync failed:", err.message);
  }
}

async function sendToMemory(tunnelUrl) {
  try {
    const response = await fetch(MEMORY_URL + "/memory/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + MEMORY_TOKEN,
      },
      body: JSON.stringify({
        key: "bridge_tunnel_url",
        type: "config",
        title: "Bridge Tunnel URL",
        content: tunnelUrl,
        tags: ["bridge", "tunnel", "config"],
        metadata: {
          updated_at: new Date().toISOString(),
          pc_name: os.hostname(),
        },
      }),
    });

    if (response.ok) {
      console.log("URL saved to Jarbas Memory Core.");
    }
  } catch (err) {
    console.log("Warn: /memory/save failed:", err.message);
  }
}

process.stdin.on("end", () => {
  console.log("cloudflared exited.");
});

