FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8788

ENV NODE_ENV=production

CMD ["node", "bridge-server.js"]
