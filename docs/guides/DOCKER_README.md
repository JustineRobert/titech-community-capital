# Community Savings App - Docker Production Setup

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   MongoDB       │
│   (React/Nginx) │◄──►│   (Node.js)     │◄──►│   (Database)    │
│   Port: 3000    │    │   Port: 5000    │    │   Port: 27017   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐    ┌─────────────────┐
                    │   Redis         │    │   Prometheus     │
                    │   (Cache)       │    │   (Metrics)      │
                    │   Port: 6379    │    │   Port: 9090     │
                    └─────────────────┘    └─────────────────┘
                                             │
                                    ┌─────────────────┐
                                    │   Grafana        │
                                    │   (Dashboards)   │
                                    │   Port: 3001     │
                                    └─────────────────┘
```

## 🚀 Quick Start with Docker

### Prerequisites

- Docker Desktop installed and running
- At least 4GB RAM available
- Windows: Run PowerShell/Command Prompt as Administrator

### Start All Services

**Windows:**

```cmd
# Double-click start-docker.bat or run:
start-docker.bat
```

**Linux/Mac:**

```bash
# Make executable and run:
chmod +x start-docker.sh
./start-docker.sh
```

**Manual:**

```bash
# From project root directory
docker-compose up --build -d
```

### Access Points

Once started, access these URLs:

- 🌐 **Frontend App**: http://localhost:3000
- 🚀 **Backend API**: http://localhost:5000
- 📊 **API Documentation**: http://localhost:5000/api-docs
- 📈 **Prometheus Metrics**: http://localhost:9090
- 📊 **Grafana Dashboards**: http://localhost:3001 (admin/admin)

## 🔧 Services Configuration

### MongoDB

- **Image**: mongo:7-jammy
- **Port**: 27017
- **Credentials**: admin/password123
- **Database**: community-savings
- **Volume**: mongodb-data (persistent)

### Redis

- **Image**: redis:7-alpine
- **Port**: 6379
- **Persistence**: AOF enabled
- **Volume**: redis-data (persistent)

### Backend

- **Build Context**: ./community-savings-app-backend
- **Environment**: .env.docker
- **Port**: 5000
- **Dependencies**: MongoDB, Redis

### Frontend

- **Build Context**: ./community-savings-app-frontend
- **Port**: 3000 (maps to container port 80)
- **Dependencies**: Backend

## 🐛 Debugging & Troubleshooting

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f mongodb
docker-compose logs -f redis
```

### Check Service Status

```bash
docker-compose ps
```

### Restart Services

```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart backend
```

### Stop Everything

```bash
docker-compose down
```

### Clean Restart (remove volumes)

```bash
docker-compose down -v
docker-compose up --build -d
```

## 🔍 Common Issues & Solutions

### Backend Won't Start

```bash
# Check backend logs
docker-compose logs backend

# Check if MongoDB is ready
docker-compose exec mongodb mongo --eval "db.stats()"

# Check if Redis is ready
docker-compose exec redis redis-cli ping
```

### Database Connection Issues

- Ensure MongoDB container is healthy: `docker-compose ps mongodb`
- Check MongoDB logs: `docker-compose logs mongodb`
- Verify connection string in `.env.docker`

### Port Conflicts

If ports are already in use:

```bash
# Change ports in docker-compose.yml
ports:
  - "5001:5000"  # Change host port from 5000 to 5001
```

### Memory Issues

If containers crash due to memory:

```bash
# Increase Docker Desktop memory allocation
# Or reduce services temporarily
docker-compose up -d mongodb redis backend
```

## 🏭 Production Deployment

### Environment Variables

Update `.env.docker` with production values:

- Strong JWT secrets (32+ characters)
- Production MongoDB URI
- Email service credentials
- Proper CORS origins

### Scaling

```bash
# Scale backend services
docker-compose up -d --scale backend=3

# Use nginx as load balancer
# Add nginx service to docker-compose.yml
```

### SSL/TLS

```yaml
# Add to backend service
environment:
  - HTTPS=true
ports:
  - '443:5000'
volumes:
  - ./ssl:/app/ssl:ro
```

## 📊 Monitoring

### Prometheus Metrics

- Backend exposes metrics at `/metrics`
- Configured in `prometheus/prometheus.yml`

### Grafana Dashboards

- Default login: admin/admin
- Add Prometheus as data source: http://prometheus:9090
- Import community dashboards or create custom ones

## 🔄 Development Workflow

### Code Changes

```bash
# Rebuild and restart backend
docker-compose up --build -d backend

# Rebuild frontend
docker-compose up --build -d frontend
```

### Database Seeding

```bash
# Access backend container
docker-compose exec backend bash

# Run seed scripts
npm run seed-admin
```

### Testing

```bash
# Run tests in container
docker-compose exec backend npm test

# Run integration tests
docker-compose exec backend npm run test:integration
```

## 📁 File Structure

```
community-savings-app-main/
├── docker-compose.yml          # Main orchestration
├── start-docker.bat           # Windows start script
├── start-docker.sh            # Linux/Mac start script
├── scripts/
│   └── init-mongo.js          # MongoDB initialization
├── community-savings-app-backend/
│   ├── Dockerfile             # Backend container config
│   ├── .env.docker            # Docker environment vars
│   └── ...                    # App source code
├── community-savings-app-frontend/
│   ├── Dockerfile             # Frontend container config
│   └── ...                    # React app
└── prometheus/
    └── prometheus.yml         # Metrics configuration
```

## 🎯 Production Readiness Checklist

- [x] Multi-service architecture
- [x] Persistent data volumes
- [x] Health checks and restart policies
- [x] Environment-specific configuration
- [x] Proper networking between services
- [x] Monitoring and observability
- [x] Graceful error handling
- [x] Security hardening (Helmet, CORS, etc.)
- [x] Rate limiting with Redis
- [x] Database connection retry logic
- [x] Docker multi-stage builds
- [x] Production logging (Winston)

## 🚨 Emergency Commands

```bash
# Stop everything immediately
docker-compose down --remove-orphans

# Remove all containers and volumes (CAUTION: loses data)
docker-compose down -v --remove-orphans

# Clean Docker system
docker system prune -a --volumes
```

---

**Need Help?** Check the logs first: `docker-compose logs -f backend`
