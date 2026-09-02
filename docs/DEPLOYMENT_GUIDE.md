# 🚀 Deployment Guide - Production Readiness

**Project:** Community Savings App  
**Version:** 2.0  
**Status:** Ready for Production

---

## 📋 Deployment Options

Choose your deployment platform:

1. [Docker Compose (Local)](#docker-compose-local)
2. [Vercel (Frontend) + Render (Backend)](#vercel--render)
3. [Heroku (Simple)](#heroku)
4. [AWS (Scalable)](#aws)
5. [DigitalOcean (Developer-Friendly)](#digitalocean)

---

## 🐳 Docker Compose (Local)

### For Development & Local Testing

```bash
# 1. Build images
make docker-build

# 2. Start services
make docker-up

# 3. Check status
docker-compose ps

# 4. View logs
make docker-logs

# 5. Access services
# Frontend: http://localhost:3000
# Backend: http://localhost:5000
# MongoDB: localhost:27017
# Redis: localhost:6379

# 6. Stop services
make docker-down
```

### docker-compose.yml Location

File: `docker-compose.yml` in project root

### Environment Variables

Copy from `.env.example` to `.env`:

```bash
cp .env.example .env
# Edit with your values
```

---

## 🌐 Vercel + Render

### Best For: GitHub Finish-Up-A-Thon

#### Frontend on Vercel

**Step 1: Connect to Vercel**

```bash
# 1. Go to https://vercel.com
# 2. Click "New Project"
# 3. Import GitHub repository
# 4. Select "society-community-savings-app"
```

**Step 2: Configure Build Settings**

```
Framework Preset: Vite
Build Command: npm run build --prefix community-savings-app-frontend
Output Directory: community-savings-app-frontend/dist
Install Command: npm install
```

**Step 3: Set Environment Variables**

```
VITE_API_URL=https://[your-backend].onrender.com
VITE_ENVIRONMENT=production
```

**Step 4: Deploy**

```bash
git push origin main  # Automatically triggers deployment
```

#### Backend on Render

**Step 1: Create Web Service**

```bash
# 1. Go to https://render.com
# 2. Click "New +"
# 3. Select "Web Service"
# 4. Connect GitHub account
# 5. Select "society-community-savings-app"
```

**Step 2: Configure Service**

```
Name: community-savings-backend
Environment: Node
Build Command: npm install --prefix community-savings-app-backend
Start Command: npm start --prefix community-savings-app-backend
```

**Step 3: Add Environment Variables**

```
NODE_ENV=production
MONGODB_URI=[your-mongodb-url]
REDIS_URL=[your-redis-url]
JWT_SECRET=[secure-random-string]
PORT=5000
```

**Step 4: Create Database (MongoDB Atlas)**

```bash
# 1. Go to https://www.mongodb.com/cloud/atlas
# 2. Create cluster
# 3. Get connection string
# 4. Set MONGODB_URI in Render
```

**Step 5: Create Cache (Redis)**

```bash
# 1. Option A: Use Redis Cloud (https://redis.com/cloud/)
# 2. Option B: Use Railway Redis
# 3. Get connection URL
# 4. Set REDIS_URL in Render
```

### File: render.yaml (Optional)

Create `render.yaml` in root:

```yaml
services:
  - type: web
    name: community-savings-backend
    env: node
    plan: free
    buildCommand: npm install --prefix community-savings-app-backend
    startCommand: npm start --prefix community-savings-app-backend
    envVars:
      - key: NODE_ENV
        value: production
      - key: MONGODB_URI
        sync: false
      - key: REDIS_URL
        sync: false
      - key: JWT_SECRET
        sync: false

  - type: web
    name: community-savings-frontend
    env: static
    staticSite:
      buildCommand: npm run build --prefix community-savings-app-frontend
      publishPath: community-savings-app-frontend/dist
    envVars:
      - key: VITE_API_URL
        value: https://community-savings-backend.onrender.com
```

### Complete Frontend Deployment

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel --prod --prefix community-savings-app-frontend

# 4. Set environment variables
vercel env add VITE_API_URL
# Enter: https://[your-backend].onrender.com

# 5. Redeploy to pick up env vars
vercel --prod
```

---

## 🟣 Heroku

### For Simple Full-Stack Deployment

**Limitations:**

- Free tier ending (use paid plans or alternatives)
- Best for small apps
- Single dyno = slower scaling

**Step 1: Install Heroku CLI**

```bash
# macOS
brew tap heroku/brew && brew install heroku

# Windows (see heroku.com/download)
# Linux
curl https://cli-assets.heroku.com/install.sh | sh
```

**Step 2: Create Procfile**

Create `Procfile` in project root:

```
web: npm start --prefix community-savings-app-backend
frontend: npm start --prefix community-savings-app-frontend
```

**Step 3: Create app.json**

Create `app.json` in project root:

```json
{
  "name": "community-savings-app",
  "description": "Community Savings Platform",
  "repository": "https://github.com/[user]/society-community-savings-app",
  "addons": [
    {
      "plan": "mongolab:sandbox"
    },
    {
      "plan": "rediscloud:30"
    }
  ],
  "env": {
    "NODE_ENV": {
      "description": "Production environment",
      "value": "production"
    },
    "JWT_SECRET": {
      "description": "JWT secret key",
      "generator": "secret"
    }
  }
}
```

**Step 4: Deploy**

```bash
# 1. Login
heroku login

# 2. Create app
heroku create community-savings-app

# 3. Add database
heroku addons:create mongolab:sandbox
heroku addons:create rediscloud:30

# 4. Set environment
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=$(openssl rand -hex 32)

# 5. Deploy
git push heroku main

# 6. Check logs
heroku logs --tail
```

---

## ☁️ AWS

### For Enterprise Deployment

**Services Used:**

- Elastic Container Registry (ECR) - Image storage
- Elastic Container Service (ECS) - Orchestration
- Relational Database Service (RDS) - MongoDB alternative
- ElastiCache - Redis alternative
- Application Load Balancer (ALB) - Load balancing

#### Step 1: Build & Push Docker Images

```bash
# 1. Create ECR repositories
aws ecr create-repository --repository-name community-savings-backend
aws ecr create-repository --repository-name community-savings-frontend

# 2. Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com

# 3. Build images
docker build -t community-savings-backend:v2.0 -f community-savings-app-backend/Dockerfile .
docker build -t community-savings-frontend:v2.0 -f community-savings-app-frontend/Dockerfile .

# 4. Tag images
docker tag community-savings-backend:v2.0 \
  [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com/community-savings-backend:v2.0
docker tag community-savings-frontend:v2.0 \
  [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com/community-savings-frontend:v2.0

# 5. Push to ECR
docker push [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com/community-savings-backend:v2.0
docker push [YOUR_ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com/community-savings-frontend:v2.0
```

#### Step 2: Create Database

```bash
# MongoDB on DocumentDB
aws docdb create-db-cluster \
  --db-cluster-identifier community-savings-db \
  --engine docdb \
  --master-username admin \
  --master-user-password [YOUR_SECURE_PASSWORD]

# Or use regular RDS for PostgreSQL
aws rds create-db-instance \
  --db-instance-identifier community-savings-db \
  --db-instance-class db.t3.micro \
  --engine postgres
```

#### Step 3: Create Cache

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id community-savings-cache \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1
```

#### Step 4: Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name community-savings-cluster
```

#### Step 5: Create Task Definitions

Backend Task (`community-savings-backend-task.json`):

```json
{
  "family": "community-savings-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "[ACCOUNT_ID].dkr.ecr.us-east-1.amazonaws.com/community-savings-backend:v2.0",
      "portMappings": [
        {
          "containerPort": 5000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "5000"
        }
      ],
      "secrets": [
        {
          "name": "MONGODB_URI",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:[ACCOUNT_ID]:secret:mongodb-uri"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:[ACCOUNT_ID]:secret:jwt-secret"
        }
      ]
    }
  ]
}
```

Register task:

```bash
aws ecs register-task-definition --cli-input-json file://community-savings-backend-task.json
```

#### Step 6: Create Service

```bash
aws ecs create-service \
  --cluster community-savings-cluster \
  --service-name backend-service \
  --task-definition community-savings-backend \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx]}"
```

---

## 🌊 DigitalOcean

### For Developer-Friendly Deployment

**Step 1: Create App**

```bash
# 1. Go to https://cloud.digitalocean.com/apps
# 2. Click "Create Apps"
# 3. Connect GitHub repository
```

**Step 2: Configure Backend Service**

```
Name: api
Source: GitHub repository
Build command: npm install --prefix community-savings-app-backend
Run command: npm start --prefix community-savings-app-backend
Port: 5000
```

**Step 3: Configure Frontend Service**

```
Name: web
Source: GitHub repository
Build command: npm run build --prefix community-savings-app-frontend
Output directory: community-savings-app-frontend/dist
Port: 80
```

**Step 4: Add Database**

```bash
# Create Managed MongoDB
DO_MONGO_URI=[provided-by-digitalocean]

# Create Redis
DO_REDIS_URL=[provided-by-digitalocean]
```

**Step 5: Deploy**

```bash
# Set environment variables in app.yaml
MONGODB_URI=$DO_MONGO_URI
REDIS_URL=$DO_REDIS_URL
JWT_SECRET=[secure-random]
```

Deploy with:

```bash
doctl apps create --spec app.yaml
```

---

## ✅ Pre-Deployment Checklist

### Before Any Deployment

- [ ] All tests passing: `make quality`
- [ ] Docker builds successfully: `make docker-build`
- [ ] Environment variables set (see `.env.example`)
- [ ] Database credentials ready
- [ ] Redis connection string ready
- [ ] JWT secret generated
- [ ] Emails configured (if applicable)
- [ ] Payment gateway configured (if applicable)

### Production Environment Variables

```bash
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname
REDIS_URL=redis://user:pass@host:port
JWT_SECRET=[secure-random-string-min-32-chars]
JWT_REFRESH_EXPIRY=30d
FRONTEND_URL=https://[your-frontend-domain]
BACKEND_URL=https://[your-backend-domain]
CORS_ORIGIN=https://[your-frontend-domain]
EMAIL_SERVICE=sendgrid
EMAIL_API_KEY=[your-sendgrid-key]
```

---

## 🔒 Security Checklist

### Before Production

- [ ] All hardcoded secrets removed
- [ ] .env file in .gitignore
- [ ] Environment variables use secrets manager
- [ ] HTTPS/TLS enabled
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Input validation active
- [ ] SQL injection protection (if using SQL)
- [ ] XSS protection enabled
- [ ] CSRF tokens implemented
- [ ] JWT tokens properly signed
- [ ] Refresh token rotation enabled

---

## 📊 Deployment Comparison

| Platform        | Cost      | Setup Time | Scaling   | Difficulty |
| --------------- | --------- | ---------- | --------- | ---------- |
| Docker (Local)  | Free      | 5 min      | Manual    | Easy       |
| Vercel + Render | Free tier | 15 min     | Good      | Easy       |
| Heroku          | Paid      | 10 min     | Limited   | Easy       |
| AWS             | Paid      | 60 min     | Excellent | Hard       |
| DigitalOcean    | $12+      | 20 min     | Good      | Medium     |

---

## 🚀 Quick Deployment Commands

### Vercel (Frontend Only)

```bash
npm install -g vercel
vercel --prod --prefix community-savings-app-frontend
```

### Docker (Local/Server)

```bash
make docker-build
make docker-up
```

### Heroku (Full Stack)

```bash
heroku create community-savings-app
git push heroku main
heroku logs --tail
```

---

## 📞 Deployment Support

### Troubleshooting

**Port already in use:**

```bash
# Find process
lsof -i :5000
# Kill process
kill -9 [PID]
```

**Environment variables not loading:**

```bash
# Verify .env exists and is readable
cat .env

# Check in app
node -e "console.log(process.env.MONGODB_URI)"
```

**Docker image too large:**

```bash
# Clean up
docker system prune -a

# Rebuild
make docker-build --no-cache
```

---

## 📈 Post-Deployment Monitoring

### Health Checks

```bash
# Backend
curl https://[your-backend]/health

# Frontend
https://[your-frontend]

# Database
mongosh [YOUR_MONGODB_URI]
```

### Logging

```bash
# View logs
docker logs [container-id]

# Stream logs
docker logs -f [container-id]

# AWS CloudWatch
aws logs tail /aws/ecs/community-savings --follow
```

### Performance

```bash
# Load testing
# Use tools like Apache Bench, Wrk, or Locust
wrk -t12 -c400 -d30s https://[your-api]/health
```

---

## 🔄 Continuous Deployment

### GitHub Actions → Deployment

The included CI/CD pipeline can automatically deploy:

```yaml
# Add to .github/workflows/ci-cd.yml

deploy:
  needs: [quality, test, build]
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3

    - name: Deploy to production
      run: |
        # Your deployment command
        # Examples:
        # git push heroku main
        # vercel --prod
        # aws ecs update-service ...
```

---

## 📝 Deployment Checklist

Before going live:

- [ ] Tested locally with `make docker-up`
- [ ] All tests passing
- [ ] All quality checks passing
- [ ] Environment variables configured
- [ ] Database set up and verified
- [ ] Cache (Redis) set up and verified
- [ ] Domain configured and DNS updated
- [ ] SSL certificate installed
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] Error tracking enabled (Sentry, etc.)
- [ ] Logging configured
- [ ] Rate limiting enabled
- [ ] CORS configured correctly

---

## 🎉 You're Ready!

Choose your platform and deploy with confidence. The production-ready code is tested and verified.

**Status:** ✅ DEPLOYMENT READY

---

**Last Updated:** January 15, 2026  
**Version:** 2.0  
**Author:** Development Team
