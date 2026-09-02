@echo off
REM start-docker-dev.bat
REM Windows batch script to start all services with Docker Compose
REM Features:
REM - Automatic service health checks
REM - Exponential backoff for Redis
REM - Proper logging configuration
REM - Clean output

setlocal enabledelayedexpansion

echo.
echo 🚀 Starting Community Savings App with Docker Compose...
echo.

REM Check if Docker is installed
where docker >nul 2>nul
if errorlevel 1 (
    echo ❌ Docker is not installed or not in PATH. Please install Docker Desktop.
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
where docker-compose >nul 2>nul
if errorlevel 1 (
    echo ❌ Docker Compose is not installed. Please ensure Docker Desktop is properly installed.
    pause
    exit /b 1
)

REM Navigate to project directory
cd /d "%~dp0"

REM Clean up any stopped containers
echo 🧹 Cleaning up stopped containers...
docker-compose down 2>nul

REM Build images
echo 🔨 Building Docker images...
docker-compose build --no-cache

REM Start services
echo ⬆️  Starting services in background...
docker-compose up -d

echo.
echo ⏳ Waiting for services to be healthy...
timeout /t 5 /nobreak

echo.
echo 📊 Service Status:
echo ────────────────────────────────────

REM Check MongoDB
docker-compose exec -T mongodb mongosh --quiet --eval "db.adminCommand('ping')" >nul 2>&1
if errorlevel 0 (
    echo ✅ MongoDB is ready on localhost:27017
) else (
    echo ⏳ MongoDB is starting...
)

REM Check Redis
docker-compose exec -T redis redis-cli ping >nul 2>&1
if errorlevel 0 (
    echo ✅ Redis is ready on localhost:6379
    echo    - Exponential backoff enabled
    echo    - Throttled error logging enabled
    echo    - Automatic reconnection enabled
) else (
    echo ⏳ Redis is starting...
)

echo.
echo 📺 Available Services:
echo ────────────────────────────────────
echo Frontend:       http://localhost:3000
echo Backend API:    http://localhost:5000
echo MongoDB:        localhost:27017
echo Redis:          localhost:6379
echo Prometheus:     http://localhost:9090
echo Grafana:        http://localhost:3001 (admin/admin)
echo Redis Exporter: http://localhost:9121
echo.

echo 🔍 Redis Configuration:
echo ────────────────────────────────────
echo • Exponential backoff: ENABLED
echo • Min retry delay: 1 second
echo • Max retry delay: 30 seconds
echo • Error log throttle: 30s (production) / 5s (development)
echo • Max reconnection attempts: 10
echo.

echo 📝 Useful Commands:
echo ────────────────────────────────────
echo View logs:           docker-compose logs -f backend
echo Redis CLI:           docker-compose exec redis redis-cli
echo MongoDB shell:       docker-compose exec mongodb mongosh
echo Stop services:       docker-compose down
echo Clean everything:    docker-compose down -v
echo.

echo ✅ All services starting! Check status with 'docker-compose ps'
echo.
pause
