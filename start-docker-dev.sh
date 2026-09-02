#!/bin/bash

# start-docker-dev.sh
# Development helper script to start all services with Docker Compose
# Features:
# - Automatic service Health checks
# - Exponential backoff for Redis
# - Proper logging configuration
# - Clean output

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "🚀 Starting Community Savings App with Docker Compose..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Clean up any stopped containers from previous runs
echo "🧹 Cleaning up stopped containers..."
docker-compose down 2>/dev/null || true

# Build images
echo "🔨 Building Docker images..."
docker-compose build --no-cache

# Start services
echo "⬆️  Starting services in background..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check service health
echo ""
echo "📊 Service Status:"
echo "────────────────────────────────────"

# Check MongoDB
if docker-compose exec -T mongodb mongosh --quiet --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "✅ MongoDB is ready on localhost:27017"
else
    echo "⏳ MongoDB is starting..."
fi

# Check Redis
if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is ready on localhost:6379"
    echo "   - Exponential backoff enabled"
    echo "   - Throttled error logging enabled"
    echo "   - Automatic reconnection enabled"
else
    echo "⏳ Redis is starting..."
fi

# Check Backend
if [ "$(docker-compose ps backend -q)" ]; then
    if curl -s http://localhost:5000/health > /dev/null 2>&1; then
        echo "✅ Backend API is ready on http://localhost:5000"
    else
        echo "⏳ Backend is starting..."
    fi
fi

# Check Frontend
if [ "$(docker-compose ps frontend -q)" ]; then
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "✅ Frontend is ready on http://localhost:3000"
    else
        echo "⏳ Frontend is starting..."
    fi
fi

echo ""
echo "📺 Available Services:"
echo "────────────────────────────────────"
echo "Frontend:       http://localhost:3000"
echo "Backend API:    http://localhost:5000"
echo "MongoDB:        localhost:27017"
echo "Redis:          localhost:6379"
echo "Prometheus:     http://localhost:9090"
echo "Grafana:        http://localhost:3001 (admin/admin)"
echo "Redis Exporter: http://localhost:9121"
echo ""
echo "🔍 Redis Status:"
echo "────────────────────────────────────"
echo "• Exponential backoff: ENABLED"
echo "• Min retry delay: 1 second"
echo "• Max retry delay: 30 seconds"
echo "• Error log throttle: 30s (production) / 5s (development)"
echo "• Max reconnection attempts: 10"
echo ""
echo "📝 Useful Commands:"
echo "────────────────────────────────────"
echo "View logs:           docker-compose logs -f backend"
echo "Redis CLI:           docker-compose exec redis redis-cli"
echo "MongoDB shell:       docker-compose exec mongodb mongosh"
echo "Stop services:       docker-compose down"
echo "Clean everything:    docker-compose down -v"
echo ""
echo "✅ All services starting! Check logs with 'docker-compose logs -f'"
echo ""
