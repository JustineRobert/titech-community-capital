# =====================================================================
# Backend Dockerfile (Production-Ready)
# Multi-stage build for lean, secure images
# =====================================================================

# Stage 1: Builder
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package manifests first for better caching
COPY package.json package-lock.json ./

# Install dependencies (production only)
RUN npm ci --only=production

# Copy application source
COPY . .

# Optional build step (transpilation, bundling, etc.)
# Uncomment if you use TypeScript or build scripts
# RUN npm run build

# Stage 2: Runtime
FROM node:18-alpine

WORKDIR /app

# Copy production node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Environment variables
ENV NODE_ENV=production \
    PORT=5000

# Expose backend port
EXPOSE 5000

# Use npm start for consistency with package.json scripts
CMD ["npm", "start"]
