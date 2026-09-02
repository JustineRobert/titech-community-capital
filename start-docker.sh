#!/bin/bash

echo "========================================"
echo "Community Savings App - Docker Setup"
echo "========================================"
echo

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed"
    echo "Please install Docker from: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "ERROR: Docker Compose is not available"
    echo "Please install Docker Compose"
    exit 1
fi

echo "Starting all services with Docker Compose..."
echo "This may take a few minutes on first run..."
echo

# Use docker compose (newer syntax) if available, otherwise docker-compose
if docker compose version &> /dev/null; then
    docker compose up --build -d
else
    docker-compose up --build -d
fi

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to start services"
    exit 1
fi

echo
echo "========================================"
echo "Services Started Successfully!"
echo "========================================"
echo
echo "🌐 Frontend:    http://localhost:3000"
echo "🚀 Backend API: http://localhost:5000"
echo "📊 API Docs:    http://localhost:5000/api-docs"
echo "📈 Prometheus:  http://localhost:9090"
echo "📊 Grafana:     http://localhost:3001 (admin/admin)"
echo
echo "To view logs: docker-compose logs -f"
echo "To stop: docker-compose down"
echo