# =============================================================================
# TITech Community Capital — Frontend Production Container
# Canonical Dockerfile: frontend/Dockerfile
# Runtime baseline: Node.js 24.15.0 / Nginx stable Alpine
# =============================================================================

FROM node:24.15.0-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev \
    && npm cache clean --force

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
