@echo off
echo ========================================
echo Community Savings App - Docker Setup
echo ========================================
echo.

cd /d "%~dp0"

echo Checking Docker installation...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed or not running
    echo Please install Docker Desktop from: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo.
echo Starting all services with Docker Compose...
echo This may take a few minutes on first run...
echo.

docker-compose up --build -d

if %errorlevel% neq 0 (
    echo ERROR: Failed to start services
    pause
    exit /b 1
)

echo.
echo ========================================
echo Services Started Successfully!
echo ========================================
echo.
echo 🌐 Frontend:    http://localhost:3000
echo 🚀 Backend API: http://localhost:5000
echo 📊 API Docs:    http://localhost:5000/api-docs
echo 📈 Prometheus:  http://localhost:9090
echo 📊 Grafana:     http://localhost:3001 (admin/admin)
echo.
echo To view logs: docker-compose logs -f
echo To stop: docker-compose down
echo.

pause