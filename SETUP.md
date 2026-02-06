# 🚀 Setup Rápido - Jarbas Remote Executor

## Passo 1: Gerar Token Seguro

```powershell
# Abrir PowerShell e rodar:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie o token gerado (ex: `a1b2c3d4e5f6...`)

## Passo 2: Criar arquivo .env

```powershell
cd d:\jarbas_vida\skills\remote-executor
copy .env.example .env
notepad .env
```

Cole o token gerado no campo `BRIDGE_TOKEN`

## Passo 3: Instalar Dependências

```powershell
npm install
```

## Passo 4: Testar Localmente

```powershell
# Iniciar o bridge
npm start

# Em outro terminal, testar
npm test
```

## Passo 5: Instalar Tailscale

### Windows:

```powershell
winget install tailscale.tailscale
```

Ou baixe de: https://tailscale.com/download/windows

### VPS (Linux):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

## Passo 6: Conectar Dispositivos

1. Abra Tailscale no Windows e faça login
2. Na VPS, rode `sudo tailscale up` e faça login
3. Anote o IP do seu PC: `tailscale ip -4`

## Passo 7: Configurar Jarbas (VPS)

Adicione ao `.env` do Jarbas:

```env
REMOTE_BRIDGE_URL=http://SEU_IP_TAILSCALE:8788
REMOTE_BRIDGE_TOKEN=seu_token_aqui
```

## Passo 8: Rodar como Admin (Importante!)

```powershell
# Abrir PowerShell como Administrador
# Botão direito > "Executar como Administrador"

cd d:\jarbas_vida\skills\remote-executor
npm start
```

## ✅ Pronto!

Agora o Jarbas pode executar comandos no seu PC! 🎉
