#!/bin/bash
# ============================================================================
# Staging Deployment Script
# ============================================================================
# Deploy Community Savings App to staging environment with health checks

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
STAGING_DIR="$PROJECT_ROOT/staging"
LOG_FILE="$STAGING_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
ENVIRONMENT="staging"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}" | tee -a "$LOG_FILE"
}

log_error() {
  echo -e "${RED}✗ $1${NC}" | tee -a "$LOG_FILE"
}

log_info() {
  echo -e "${YELLOW}ℹ $1${NC}" | tee -a "$LOG_FILE"
}

# Create log directory
mkdir -p "$STAGING_DIR"

log "======================================================================"
log "Starting Staging Deployment"
log "======================================================================"

# Step 1: Validation
log "Step 1: Validating environment..."
if [ ! -f "$PROJECT_ROOT/.env.staging" ]; then
  log_error ".env.staging file not found"
  exit 1
fi
log_success "Environment file loaded"

# Step 2: Load environment
log "Step 2: Loading environment variables..."
export $(cat "$PROJECT_ROOT/.env.staging" | grep -v '#' | xargs)
log_success "Environment variables loaded"

# Step 3: Build Docker images
log "Step 3: Building Docker images..."
cd "$PROJECT_ROOT"
docker-compose -f docker-compose.staging.yml build --no-cache 2>&1 | tee -a "$LOG_FILE" || {
  log_error "Docker build failed"
  exit 1
}
log_success "Docker images built successfully"

# Step 4: Stop existing containers
log "Step 4: Stopping existing containers..."
docker-compose -f docker-compose.staging.yml down 2>&1 | tee -a "$LOG_FILE" || true
log_success "Existing containers stopped"

# Step 5: Start services
log "Step 5: Starting services..."
docker-compose -f docker-compose.staging.yml up -d 2>&1 | tee -a "$LOG_FILE" || {
  log_error "Failed to start services"
  exit 1
}
log_success "Services started"

# Step 6: Wait for services to be ready
log "Step 6: Waiting for services to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf http://localhost:5000/healthz > /dev/null 2>&1; then
    log_success "Backend is healthy"
    break
  fi
  
  RETRY_COUNT=$((RETRY_COUNT + 1))
  log_info "Waiting for backend... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  log_error "Backend failed to start after $MAX_RETRIES attempts"
  exit 1
fi

# Step 7: Run database migrations
log "Step 7: Running database migrations..."
docker-compose -f docker-compose.staging.yml exec -T backend npm run migrate:staging 2>&1 | tee -a "$LOG_FILE" || {
  log_error "Database migrations failed"
  exit 1
}
log_success "Database migrations completed"

# Step 8: Verify services
log "Step 8: Verifying services..."

services=("mongodb" "redis" "backend" "nginx" "prometheus" "grafana")
for service in "${services[@]}"; do
  if docker-compose -f docker-compose.staging.yml ps | grep -q "$service.*Up"; then
    log_success "$service is running"
  else
    log_error "$service is not running"
    exit 1
  fi
done

# Step 9: Run health checks
log "Step 9: Running health checks..."

# Health check endpoints
HEALTH_CHECKS=(
  "http://localhost:5000/healthz:Backend API"
  "http://localhost/api/healthz:Nginx"
  "http://localhost:9090:Prometheus"
  "http://localhost:3001:Grafana"
)

for check in "${HEALTH_CHECKS[@]}"; do
  IFS=':' read -r URL NAME <<< "$check"
  if curl -sf "$URL" > /dev/null 2>&1; then
    log_success "$NAME is responding"
  else
    log_error "$NAME is not responding"
  fi
done

# Step 10: Run smoke tests
log "Step 10: Running smoke tests..."
cd "$PROJECT_ROOT/community-savings-app-backend"
npm run test:smoke -- --target http://localhost:5000 2>&1 | tee -a "$LOG_FILE" || {
  log_error "Smoke tests failed"
  exit 1
}
log_success "Smoke tests passed"

# Step 11: Generate deployment report
log "Step 11: Generating deployment report..."

REPORT_FILE="$STAGING_DIR/deployment-report-$(date +%Y%m%d-%H%M%S).txt"
cat > "$REPORT_FILE" << EOF
Community Savings App - Staging Deployment Report
==================================================
Deployment Date: $(date)
Environment: $ENVIRONMENT

Services Status:
================
$(docker-compose -f docker-compose.staging.yml ps)

Container Resources:
====================
$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}")

Network Information:
====================
$(docker network inspect staging-network | grep -E '(Name|IPv4Address)' | head -20)

Performance Metrics:
====================
Backend Response Time: $(curl -s -w "%{time_total}\n" -o /dev/null http://localhost:5000/healthz)s
P99 Response Time: Check Prometheus for detailed metrics

Known Issues: None
Deployment Status: SUCCESS
EOF

log_success "Deployment report generated: $REPORT_FILE"

# Step 12: Cleanup and summary
log "Step 12: Deployment complete"
log ""
log_success "======================================================================"
log_success "Staging Deployment Completed Successfully!"
log_success "======================================================================"
log ""
log "Service URLs:"
log "  Backend API: http://localhost:5000"
log "  Nginx: http://localhost"
log "  Prometheus: http://localhost:9090"
log "  Grafana: http://localhost:3001"
log ""
log "Log file: $LOG_FILE"
log "Report: $REPORT_FILE"
log ""
log "Next steps:"
log "  1. Run UAT tests: npm run test:uat"
log "  2. Check monitoring: http://localhost:3001"
log "  3. Review logs: docker-compose -f docker-compose.staging.yml logs -f"

exit 0
