# TITech Community Capital — root-context frontend production image
# Canonical application source remains frontend/Dockerfile.
FROM node:24.15.0-bookworm-slim AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY frontend/ ./
RUN npm run build
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
CMD ["nginx","-g","daemon off;"]
