#!/bin/bash
# Quick start script for Community Savings App development
# This script sets up local MongoDB and Redis using Docker

set -e

echo "🚀 Starting Community Savings App Development Environment"
echo "========================================================"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install it and try again."
    exit 1
fi

echo "📦 Starting MongoDB and Redis containers..."
docker-compose -f docker-compose.dev.yml up -d mongodb redis

echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if MongoDB is ready
echo "🔍 Checking MongoDB connection..."
if docker-compose -f docker-compose.dev.yml exec -T mongodb mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "✅ MongoDB is ready!"
else
    echo "⚠️ MongoDB is still starting... It may take a few more seconds."
fi

# Check if Redis is ready
echo "🔍 Checking Redis connection..."
if docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping | grep -q PONG; then
    echo "✅ Redis is ready!"
else
    echo "⚠️ Redis is still starting..."
fi

echo ""
echo "🎉 Development environment is ready!"
echo ""
echo "📊 Services:"
echo "   MongoDB:     mongodb://appuser:apppassword123@localhost:27017/community-savings"
echo "   Redis:       redis://localhost:6379"
echo "   Mongo Express: http://localhost:8081 (admin/admin123)"
echo "   Redis Commander: http://localhost:8082"
echo ""
echo "🚀 To start the application:"
echo "   npm run dev"
echo ""
echo "🛑 To stop services:"
echo "   docker-compose -f docker-compose.dev.yml down"
echo ""
echo "🧹 To clean up volumes (⚠️ deletes data):"
echo "   docker-compose -f docker-compose.dev.yml down -v"