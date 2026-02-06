FROM node:18-alpine

# Instalar Tailscale direto via apk (sem install.sh que tenta rc-update)
RUN apk add --no-cache iptables ip6tables tailscale

# Criar diretório de estado do Tailscale
RUN mkdir -p /var/lib/tailscale /var/run/tailscale

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8788

ENV NODE_ENV=production

# Script de entrada que inicia Tailscale + Node
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
