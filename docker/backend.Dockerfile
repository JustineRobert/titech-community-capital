# =============================================================================
# TITech Community Capital — Backend Production Container
# Canonical source: backend/Dockerfile
# Runtime baseline: Node.js 24.15.x / npm 11.x
# =============================================================================

FROM node:24.15.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY backend/ ./

RUN mkdir -p /app/logs /app/tmp \
    && chown -R node:node /app

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "--max-old-space-size=4096", "server.js"]
