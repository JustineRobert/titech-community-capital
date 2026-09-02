# Community Savings App - Development Setup

## 🚀 Quick Start

### Option 1: Docker (Recommended)

1. **Start Services**

   ```bash
   # Linux/Mac
   ./start-dev.sh

   # Windows
   start-dev.bat
   ```

2. **Start Application**
   ```bash
   npm run dev
   ```

### Option 2: Manual Setup

1. **Install MongoDB locally**
   - Download from [mongodb.com](https://www.mongodb.com/try/download/community)
   - Start MongoDB service on port 27017

2. **Install Redis locally**
   - Download from [redis.io](https://redis.io/download)
   - Start Redis service on port 6379

3. **Start Application**
   ```bash
   npm run dev
   ```

## 📊 Services

| Service             | URL                         | Credentials              | Purpose               |
| ------------------- | --------------------------- | ------------------------ | --------------------- |
| **MongoDB**         | `mongodb://localhost:27017` | `appuser:apppassword123` | Primary database      |
| **Redis**           | `redis://localhost:6379`    | None                     | Cache & rate limiting |
| **Mongo Express**   | `http://localhost:8081`     | `admin:admin123`         | Database UI           |
| **Redis Commander** | `http://localhost:8082`     | None                     | Redis UI              |
| **Backend API**     | `http://localhost:5000`     | N/A                      | REST API              |
| **Frontend**        | `http://localhost:3000`     | N/A                      | React App             |

## 🔧 Environment Variables

### Development (.env)

```bash
# Application
NODE_ENV=development
PORT=5000

# MongoDB (Atlas for production, local for development)
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
MONGO_URI_FALLBACK=mongodb://appuser:apppassword123@127.0.0.1:27017/community-savings

# Redis
REDIS_URI=redis://127.0.0.1:6379

# Graceful Startup (Development)
GRACEFUL_STARTUP=true
SKIP_DB_CHECKS=false

# Security
JWT_SECRET=your-secret-key
```

### Production (.env.production)

```bash
NODE_ENV=production
MONGO_URI=mongodb+srv://user:pass@atlas-cluster.mongodb.net/db
REDIS_URI=redis://prod-redis-host:6379
GRACEFUL_STARTUP=false
SKIP_DB_CHECKS=false
```

## 🐳 Docker Commands

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up -d

# Start specific services
docker-compose -f docker-compose.dev.yml up -d mongodb redis

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop services
docker-compose -f docker-compose.dev.yml down

# Clean up (removes data!)
docker-compose -f docker-compose.dev.yml down -v
```

## 🔍 Troubleshooting

### Backend won't start

**Issue**: `ECONNREFUSED 127.0.0.1:27017`
**Solution**:

```bash
# Start MongoDB with Docker
docker-compose -f docker-compose.dev.yml up -d mongodb

# Or check if local MongoDB is running
brew services list | grep mongodb  # macOS
sudo systemctl status mongod      # Linux
```

### Redis connection fails

**Issue**: Redis unavailable, but app continues
**Solution**: This is expected behavior. Redis gracefully falls back to memory store.

### Graceful Startup Mode

**When**: `GRACEFUL_STARTUP=true` (default in development)
**Behavior**: App starts even if MongoDB is unavailable
**Impact**: Some features limited until MongoDB connects

**Disable graceful startup**:

```bash
GRACEFUL_STARTUP=false npm run dev
```

### Database Connection Issues

**Check MongoDB**:

```bash
# Test connection
mongosh "mongodb://appuser:apppassword123@localhost:27017/community-savings"
```

**Check Redis**:

```bash
# Test connection
redis-cli ping
```

## 📁 Project Structure

```
community-savings-app/
├── community-savings-app-backend/
│   ├── config/db.js          # MongoDB connection logic
│   ├── services/redis.js     # Redis connection logic
│   ├── server.js             # Main application server
│   ├── .env                  # Environment variables
│   └── logs/                 # Application logs
├── community-savings-app-frontend/
│   └── ...                   # React application
├── docker-compose.dev.yml    # Development services
├── start-dev.sh             # Quick start script (Linux/Mac)
└── start-dev.bat            # Quick start script (Windows)
```

## 🚦 Health Checks

- **Startup**: Validates environment and service availability
- **Runtime**: Automatic reconnection with exponential backoff
- **Graceful Degradation**: Continues operation when services are unavailable

## 🔐 Security Notes

- Never commit `.env` files
- Use strong, unique passwords for database users
- Rotate credentials regularly
- Use environment-specific configurations

## 📞 Support

If you encounter issues:

1. Check the logs in `community-savings-app-backend/logs/`
2. Verify Docker services are running
3. Test database connections manually
4. Check environment variables are set correctly
