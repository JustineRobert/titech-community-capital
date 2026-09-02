# Frontend Dockerfile
# =====================================================================
# GitHub Copilot assisted Dockerfile
# Multi-stage build: build static site with Node, serve via Nginx
# =====================================================================

# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package manifests first for better caching
COPY package*.json ./
RUN npm ci --frozen-lockfile

# Copy source code
COPY . .

# Build production-ready frontend
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets to Nginx HTML directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Optional: custom Nginx config (can be mounted via docker-compose)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Start Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
