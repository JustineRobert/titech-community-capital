# =============================================================================
# TITech Community Capital — Frontend Production Container
# Canonical source: frontend/Dockerfile
# Build: React + Vite
# Runtime: Nginx stable Alpine
# =============================================================================

FROM node:24.15.0-bookworm-slim AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev \
    && npm cache clean --force

COPY frontend/ ./

ARG VITE_API_URL=/api/v1
ARG VITE_SOCKET_URL=/
ARG VITE_APP_VERSION=1.0.0
ARG VITE_BUILD_TIME

ENV VITE_API_URL=${VITE_API_URL} \
    VITE_SOCKET_URL=${VITE_SOCKET_URL} \
    VITE_APP_VERSION=${VITE_APP_VERSION} \
    VITE_BUILD_TIME=${VITE_BUILD_TIME}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
