@echo off
REM Quick start script for Community Savings App development (Windows)
REM This script sets up local MongoDB and Redis using Docker

echo 🚀 Starting Community Savings App Development Environment
echo ========================================================

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running. Please start Docker and try again.
    pause
    exit /b 1
)

REM Check if docker-compose is available
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo ❌ docker-compose is not installed. Please install it and try again.
    pause
    exit /b 1
)

echo 📦 Starting MongoDB and Redis containers...
docker-compose -f docker-compose.dev.yml up -d mongodb redis

echo ⏳ Waiting for services to be ready...
timeout /t 10 /nobreak >nul

REM Check if MongoDB is ready
echo 🔍 Checking MongoDB connection...
docker-compose -f docker-compose.dev.yml exec -T mongodb mongosh --eval "db.adminCommand('ping')" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ MongoDB is ready!
) else (
    echo ⚠️ MongoDB is still starting... It may take a few more seconds.
)

REM Check if Redis is ready
echo 🔍 Checking Redis connection...
docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping 2>nul | findstr PONG >nul
if %errorlevel% equ 0 (
    echo ✅ Redis is ready!
) else (
    echo ⚠️ Redis is still starting...
)

echo.
echo 🎉 Development environment is ready!
echo.
echo 📊 Services:
echo    MongoDB:     mongodb://appuser:apppassword123@localhost:27017/community-savings
echo    Redis:       redis://localhost:6379
echo    Mongo Express: http://localhost:8081 (admin/admin123)
echo    Redis Commander: http://localhost:8082
echo.
echo 🚀 To start the application:
echo    npm run dev
echo.
echo 🛑 To stop services:
echo    docker-compose -f docker-compose.dev.yml down
echo.
echo 🧹 To clean up volumes (⚠️ deletes data):
echo    docker-compose -f docker-compose.dev.yml down -v
echo.
pause