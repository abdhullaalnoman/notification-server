FROM node:20-bookworm-slim

# Chromium is used by whatsapp-web.js (puppeteer) - do not download another one
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    WWEBJS_AUTH_PATH=/app/.wwebjs_auth \
    TZ=Asia/Dhaka

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates tzdata git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

# Default service. docker-compose overrides this per container:
#   npm run hams | npm run fac | npm run epic
CMD ["npm", "run", "hams"]
