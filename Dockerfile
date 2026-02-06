FROM node:18-alpine

# Instalar Tailscale
RUN apk add --no-cache iptables ip6tables curl && \
    curl -fsSL https://tailscale.com/install.sh | sh

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
