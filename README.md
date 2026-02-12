# Remote Executor Bridge

Bridge HTTP para controlar seu PC Windows remotamente via OpenClaw/Jarbas.

## O que entrega

- execucao remota de CLIs (`powershell`, `codex`, `claude`, `python`, `node`, `git`, `npm`, etc.)
- operacoes de arquivo (`/files/read`, `/files/write`, `/files/list`, `/files/delete`, `/files/info`, `/files/edit`)
- comandos assincronos com polling (`/jobs/run`, `/jobs/{jobId}`, `/jobs`)
- suporte a `cwd` e `background` para nao travar request ao abrir IDE/app

## Arquitetura atual (recomendada)

1. `bridge-server.js` roda no PC local (porta `8788`)
2. `cloudflared` cria URL publica temporaria (`*.trycloudflare.com`)
3. `capture-tunnel-url.js` captura URL e:
   - atualiza `tunnel-url.txt`
   - atualiza `openapi.json`
   - envia WhatsApp via Evolution API
   - sincroniza URL/token no Jarbas Memory Core (`/bridge/sync`)

## Endpoints

- `GET /health`
- `POST /run`
- `POST /jobs/run`
- `GET /jobs/{jobId}`
- `GET /jobs`
- `POST /files/read`
- `POST /files/write`
- `POST /files/list`
- `POST /files/delete`
- `POST /files/info`
- `POST /files/edit`

Spec para OpenClaw: `skills/remote-executor/openapi.json`

## Configuracao `.env`

Use `skills/remote-executor/.env.example` como base.

Campos criticos:

- `BRIDGE_TOKEN` (obrigatorio)
- `BRIDGE_PORT=8788`
- `ALLOWED_TOOLS=*` (sem restricao de tool)
- `COMMAND_TIMEOUT=300000` (ou maior para IA pesada)
- `ALLOWED_FILE_ROOTS=` (vazio = sem restricao de pastas)

Campos para notificacao/sincronizacao:

- `JARBAS_MEMORY_URL`
- `JARBAS_MEMORY_TOKEN`
- `EVOLUTION_URL`
- `EVOLUTION_KEY`
- `EVOLUTION_INSTANCE`
- `NOTIFY_NUMBER`

## Execucao local

```powershell
cd d:\jarbas_vida\skills\remote-executor
npm install
node bridge-server.js
```

## Auto-start no boot (Windows)

`start-all.bat` sobe bridge + cloudflared.

Fluxo esperado no boot:

1. bridge inicia
2. tunnel sobe
3. nova URL enviada por WhatsApp
4. Jarbas Memory recebe `/bridge/sync`
5. OpenClaw passa a usar URL/token atualizados

## Testes rapidos

### Health

```bash
curl -s https://SEU-TUNNEL.trycloudflare.com/health
```

### Run (PowerShell)

```bash
curl -s -X POST "https://SEU-TUNNEL.trycloudflare.com/run" \
  -H "Authorization: Bearer SEU_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"powershell","command":"Get-Process | Select-Object -First 5"}'
```

### Job assincrono (ideal para codex/claude)

```bash
curl -s -X POST "https://SEU-TUNNEL.trycloudflare.com/jobs/run" \
  -H "Authorization: Bearer SEU_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"codex","command":"analise este projeto","timeout":600000}'
```

Depois faça polling em `GET /jobs/{jobId}`.

## Uso recomendado no OpenClaw

1. Para comandos curtos, usar `/run`
2. Para IA e tarefas longas, usar `/jobs/run` + polling
3. Para abrir IDE/app, usar `background=true`
4. Sempre usar `cwd` quando a task for de um projeto especifico
