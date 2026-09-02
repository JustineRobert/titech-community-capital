# ============================================================================
# Community Savings App - Makefile
# Unified commands for development, testing, and deployment
# ============================================================================

.PHONY: help install dev test lint format build clean docker-build docker-up

help:
	@echo "======================================================================"
	@echo "Community Savings App - Development Commands"
	@echo "======================================================================"
	@echo ""
	@echo "SETUP & INSTALLATION"
	@echo "  make install           Install all dependencies"
	@echo "  make install-backend   Install backend dependencies only"
	@echo "  make install-frontend  Install frontend dependencies only"
	@echo ""
	@echo "DEVELOPMENT"
	@echo "  make dev               Start both backend and frontend in development"
	@echo "  make dev-backend       Start backend development server"
	@echo "  make dev-frontend      Start frontend development server"
	@echo ""
	@echo "TESTING"
	@echo "  make test              Run all tests"
	@echo "  make test-backend      Run backend tests only"
	@echo "  make test-frontend     Run frontend tests only"
	@echo "  make test-unit         Run unit tests only"
	@echo "  make test-integration  Run integration tests only"
	@echo "  make test-coverage     Generate coverage reports"
	@echo ""
	@echo "CODE QUALITY"
	@echo "  make lint              Lint all code"
	@echo "  make lint-backend      Lint backend only"
	@echo "  make lint-frontend     Lint frontend only"
	@echo "  make lint-fix          Fix linting issues"
	@echo "  make format            Format code with Prettier"
	@echo "  make format-check      Check code formatting"
	@echo "  make quality           Run lint + format checks + tests"
	@echo ""
	@echo "BUILD & DEPLOYMENT"
	@echo "  make build             Build production assets"
	@echo "  make docker-build      Build Docker images"
	@echo "  make docker-up         Start Docker containers"
	@echo "  make docker-down       Stop Docker containers"
	@echo "  make docker-logs       View Docker container logs"
	@echo ""
	@echo "MAINTENANCE"
	@echo "  make clean             Clean build artifacts and logs"
	@echo "  make seed-admin        Seed admin user"
	@echo "  make migrate           Run database migrations"
	@echo ""
	@echo "======================================================================"

# ============================================================================
# INSTALLATION
# ============================================================================

install:
	@echo "Installing all dependencies..."
	npm run install-all
	@echo "✅ Installation complete"

install-backend:
	@echo "Installing backend dependencies..."
	cd community-savings-app-backend && npm install
	@echo "✅ Backend installation complete"

install-frontend:
	@echo "Installing frontend dependencies..."
	cd community-savings-app-frontend && npm install
	@echo "✅ Frontend installation complete"

# ============================================================================
# DEVELOPMENT
# ============================================================================

dev:
	@echo "Starting development environment..."
	npm run dev

dev-backend:
	@echo "Starting backend development server..."
	npm run dev-backend

dev-frontend:
	@echo "Starting frontend development server..."
	npm run dev-frontend

# ============================================================================
# TESTING
# ============================================================================

test:
	@echo "Running all tests..."
	npm run test

test-backend:
	@echo "Running backend tests..."
	cd community-savings-app-backend && npm run test

test-frontend:
	@echo "Running frontend tests..."
	cd community-savings-app-frontend && npm run test

test-unit:
	@echo "Running unit tests..."
	cd community-savings-app-backend && npm run test:unit

test-integration:
	@echo "Running integration tests..."
	cd community-savings-app-backend && npm run test:integration

test-coverage:
	@echo "Generating coverage reports..."
	cd community-savings-app-backend && npm run test:coverage
	cd community-savings-app-frontend && npm run test:coverage

# ============================================================================
# CODE QUALITY
# ============================================================================

lint:
	@echo "Linting all code..."
	npm run lint

lint-backend:
	@echo "Linting backend code..."
	cd community-savings-app-backend && npm run lint

lint-frontend:
	@echo "Linting frontend code..."
	cd community-savings-app-frontend && npm run lint

lint-fix:
	@echo "Fixing linting issues..."
	npm run lint:fix

format:
	@echo "Formatting code with Prettier..."
	npm run format

format-check:
	@echo "Checking code formatting..."
	npm run format:check

quality:
	@echo "Running full quality checks (lint + format + test)..."
	npm run quality

# ============================================================================
# BUILD & DEPLOYMENT
# ============================================================================

build:
	@echo "Building for production..."
	npm run build

docker-build:
	@echo "Building Docker images..."
	docker-compose build

docker-up:
	@echo "Starting Docker containers..."
	docker-compose up -d
	@echo "✅ Containers started. Use 'make docker-logs' to view logs"

docker-down:
	@echo "Stopping Docker containers..."
	docker-compose down

docker-logs:
	docker-compose logs -f

# ============================================================================
# MAINTENANCE
# ============================================================================

clean:
	@echo "Cleaning up artifacts..."
	rm -rf coverage/
	rm -rf dist/
	rm -rf build/
	rm -f logs/*.log
	rm -f community-savings-app-backend/coverage/*.json
	rm -f community-savings-app-frontend/coverage/*.json
	@echo "✅ Cleanup complete"

seed-admin:
	@echo "Seeding admin user..."
	npm run seed-admin

migrate:
	@echo "Running database migrations..."
	cd community-savings-app-backend && npm run migrate

# ============================================================================
# CONVENIENCE SHORTCUTS
# ============================================================================

start: dev
test-all: quality
check: format-check lint
fix: lint-fix format
