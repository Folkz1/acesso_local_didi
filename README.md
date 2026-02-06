# 🌐 Remote Executor Skill

> **Permite que o Jarbas execute comandos no seu computador local com acesso admin ao PowerShell via Tailscale**

## 🎯 O que faz?

Esta skill permite que o Jarbas (rodando na VPS) execute comandos no seu PC Windows local de forma segura, incluindo:

- ✅ **Codex** (Claude Code CLI)
- ✅ **Claude** (Anthropic CLI)
- ✅ **PowerShell Admin** (comandos do sistema)
- ✅ **Qualquer CLI** que você autorizar

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  VPS (Jarbas na nuvem)                                  │
│  ┌──────────────────────────────────────────┐           │
│  │ POST /remote/execute                     │           │
│  │ { tool: "powershell",                    │           │
│  │   command: "Get-Process" }               │           │
│  └──────────────────────────────────────────┘           │
│                    │                                     │
│                    │ HTTPS via Tailscale                 │
│                    ▼                                     │
│         http://100.x.y.z:8788/run                       │
└─────────────────────────────────────────────────────────┘
                     │
                     │ Rede Privada Criptografada
                     │
┌─────────────────────────────────────────────────────────┐
│  Seu PC (Windows)                                       │
│  ┌──────────────────────────────────────────┐           │
│  │ Bridge Server (porta 8788)               │           │
│  │ - Executa comandos autorizados           │           │
│  │ - PowerShell com privilégios admin       │           │
│  │ - Auth: Bearer Token                     │           │
│  │ - Timeout: 5 minutos                     │           │
│  └──────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

## 🚀 Setup Rápido

### 1️⃣ Instalar Tailscale (Rede Privada)

**No seu PC (Windows):**

```powershell
# Baixar e instalar Tailscale
winget install tailscale.tailscale

# Ou baixar manualmente de: https://tailscale.com/download/windows
```

**Na VPS (Linux):**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

**Conectar ambos:**

1. Abra Tailscale no Windows e faça login
2. Na VPS, rode `sudo tailscale up` e faça login com a mesma conta
3. Anote o IP do seu PC (ex: `100.64.1.5`)

### 2️⃣ Instalar o Bridge Server (no seu PC)

```powershell
cd d:\jarbas_vida\skills\remote-executor
npm install
```

### 3️⃣ Configurar Variáveis de Ambiente

Crie o arquivo `.env` no diretório `remote-executor`:

```env
# Token de autenticação (gere um forte!)
BRIDGE_TOKEN=seu_token_super_secreto_aqui_123456789

# Porta do servidor
BRIDGE_PORT=8788

# Comandos permitidos (separados por vírgula)
ALLOWED_TOOLS=codex,claude,powershell,python,node

# Timeout em milissegundos (padrão: 5 minutos)
COMMAND_TIMEOUT=300000

# Nível de log (debug, info, warn, error)
LOG_LEVEL=info
```

### 4️⃣ Iniciar o Bridge Server

**Como administrador:**

```powershell
# Abrir PowerShell como Admin
# Botão direito > "Executar como Administrador"

cd d:\jarbas_vida\skills\remote-executor
node bridge-server.js
```

Você verá:

```
✅ Bridge Server running on http://100.64.1.5:8788
🔒 Auth: Bearer token required
📋 Allowed tools: codex, claude, powershell, python, node
⏱️  Timeout: 300000ms (5 minutes)
```

### 5️⃣ Configurar o Jarbas (VPS)

Adicione ao `.env` do Jarbas:

```env
# URL do bridge (IP Tailscale do seu PC)
REMOTE_BRIDGE_URL=http://100.64.1.5:8788

# Token de autenticação (mesmo do bridge)
REMOTE_BRIDGE_TOKEN=seu_token_super_secreto_aqui_123456789
```

## 📡 API Reference

### Endpoint: `POST /run`

**Request:**

```json
{
  "tool": "powershell",
  "command": "Get-Process | Select-Object -First 5",
  "args": [],
  "timeout": 60000
}
```

**Response (sucesso):**

```json
{
  "ok": true,
  "stdout": "...",
  "stderr": "",
  "exitCode": 0,
  "executionTime": 1234
}
```

**Response (erro):**

```json
{
  "ok": false,
  "error": "Command timeout",
  "stderr": "...",
  "exitCode": 1
}
```

### Headers Obrigatórios

```
Authorization: Bearer seu_token_super_secreto_aqui_123456789
Content-Type: application/json
```

## 🔧 Ferramentas Disponíveis

### 1. PowerShell (Admin)

```json
{
  "tool": "powershell",
  "command": "Get-Service | Where-Object {$_.Status -eq 'Running'}"
}
```

### 2. Codex (Claude Code)

```json
{
  "tool": "codex",
  "command": "analyze this code",
  "args": ["--file", "app.js"]
}
```

### 3. Claude CLI

```json
{
  "tool": "claude",
  "command": "explain quantum computing in simple terms"
}
```

### 4. Python

```json
{
  "tool": "python",
  "command": "-c",
  "args": ["print('Hello from Python')"]
}
```

## 📂 Operações de Arquivo

### Ler arquivo: `POST /files/read`

```json
{
  "path": "D:\\projetos\\app\\config.js"
}
```

Resposta: `{ "ok": true, "content": "...", "size": 1234, "path": "..." }`

### Escrever arquivo: `POST /files/write`

```json
{
  "path": "D:\\projetos\\novo-arquivo.txt",
  "content": "Hello World!",
  "createDirs": true
}
```

Resposta: `{ "ok": true, "path": "...", "size": 12, "created": true }`

### Listar diretório: `POST /files/list`

```json
{
  "path": "D:\\projetos",
  "recursive": false
}
```

Resposta: `{ "ok": true, "entries": [{ "name": "app", "type": "directory", "size": 0, "modified": "..." }], "count": 5 }`

### Info do arquivo: `POST /files/info`

```json
{
  "path": "D:\\projetos\\app\\config.js"
}
```

Resposta: `{ "ok": true, "exists": true, "isFile": true, "size": 1234, "created": "...", "modified": "..." }`

### Editar arquivo: `POST /files/edit`

```json
{
  "path": "D:\\projetos\\app\\config.js",
  "search": "localhost:3000",
  "replace": "production.example.com",
  "all": true
}
```

Resposta: `{ "ok": true, "path": "...", "replacements": 2 }`

### Deletar arquivo: `POST /files/delete`

```json
{
  "path": "D:\\temp\\arquivo-temporario.txt",
  "recursive": false
}
```

Resposta: `{ "ok": true, "path": "...", "deleted": true }`

> **Nota:** Para deletar diretórios, é obrigatório `"recursive": true`

---

## 🛡️ Segurança

### ✅ O que está protegido:

1. **Bearer Token obrigatório** - sem token, sem acesso
2. **Allowlist de comandos** - só executa ferramentas autorizadas
3. **Timeout por comando** - evita processos travados
4. **Rede privada Tailscale** - não expõe porta pública
5. **Logs detalhados** - auditoria de todas as execuções
6. **Validação de input** - sanitização de comandos
7. **Proteção path traversal** - bloqueia `..` em caminhos de arquivo
8. **ALLOWED_FILE_ROOTS** - restringe acesso a pastas específicas (opcional)

### ⚠️ Importante:

- **Nunca compartilhe o `BRIDGE_TOKEN`**
- **Revise a allowlist** antes de adicionar novos comandos
- **Monitore os logs** regularmente
- **Mantenha o Tailscale atualizado**

## 📊 Logs

Os logs são salvos em `logs/bridge.log`:

```
[2026-02-05 15:30:45] INFO: Bridge server started on port 8788
[2026-02-05 15:31:12] INFO: Executing tool=powershell command=Get-Process
[2026-02-05 15:31:13] INFO: Execution completed in 1234ms exitCode=0
```

## 🔄 Manter Rodando (Opcional)

### Opção 1: PM2 (Recomendado)

```powershell
npm install -g pm2
pm2 start bridge-server.js --name jarbas-bridge
pm2 save
pm2 startup
```

### Opção 2: Windows Service (nssm)

```powershell
# Instalar nssm
winget install nssm

# Criar serviço
nssm install JarbasBridge "C:\Program Files\nodejs\node.exe" "d:\jarbas_vida\skills\remote-executor\bridge-server.js"
nssm start JarbasBridge
```

## 🧪 Testar Localmente

```powershell
# Teste simples
curl -X POST http://localhost:8788/run `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer seu_token_super_secreto_aqui_123456789" `
  -d '{"tool":"powershell","command":"echo Hello Jarbas"}'
```

## 🆘 Troubleshooting

### Erro: "Unauthorized"

- Verifique se o token está correto no header `Authorization`

### Erro: "Tool not allowed"

- Adicione a ferramenta em `ALLOWED_TOOLS` no `.env`

### Erro: "Connection refused"

- Verifique se o Tailscale está rodando
- Confirme o IP com `tailscale ip -4`

### Erro: "Command timeout"

- Aumente `COMMAND_TIMEOUT` no `.env`
- Verifique se o comando não está travado

## 📝 Exemplo de Uso no Jarbas

```javascript
// No código do Jarbas
const response = await fetch(process.env.REMOTE_BRIDGE_URL + "/run", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.REMOTE_BRIDGE_TOKEN}`,
  },
  body: JSON.stringify({
    tool: "powershell",
    command: "Get-ComputerInfo | Select-Object CsName, WindowsVersion",
  }),
});

const result = await response.json();
console.log(result.stdout);
```

## 🎓 Próximos Passos

1. ✅ Instalar Tailscale
2. ✅ Configurar `.env`
3. ✅ Rodar bridge server
4. ✅ Testar com curl
5. ✅ Integrar com Jarbas
6. ✅ Configurar PM2 (opcional)

---

**Criado para o Jarbas Vida** 🤖💚
