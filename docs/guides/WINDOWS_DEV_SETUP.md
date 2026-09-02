# Windows Development Setup Guide

This guide helps you set up the Community Savings App on Windows for local development.

## 🚀 Quick Start (5 minutes)

If you want to get the app running immediately:

1. **Install MongoDB** (download from https://mongodb.com/try/download/community)
2. **Skip Redis** (optional - app works without it)
3. **Configure .env** (see Step 3 below)
4. **Run `npm run dev`**

---

## Step 1: Install MongoDB Community Edition

1. Download the installer from: https://www.mongodb.com/try/download/community
2. Run `mongodb-windows-x86_64-*.msi`
3. Click through the installer (recommended: install as a service)
4. MongoDB will automatically start as a Windows Service

## Alternative: Use MongoDB Atlas (Cloud Database - No Installation Required)

**Perfect if you don't want to install MongoDB locally:**

1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free account and cluster
3. Create a database user (note username/password)
4. Get your connection string from "Connect" → "Connect your application"
5. Update your `.env` file:

```env
MONGO_URI=mongodb+srv://yourusername:yourpassword@cluster0.xxxxx.mongodb.net/community-savings?retryWrites=true&w=majority
```

6. Whitelist your IP in Atlas (or use 0.0.0.0/0 for development)
7. Skip to Step 3 below

**Benefits:** No local installation, always available, free tier included.

---

Redis is optional for development but recommended. Choose one method:

### Method A: Using Chocolatey (Requires Admin Rights)

```bash
# Run PowerShell as Administrator, then:
choco install redis-64
redis-server
```

### Method B: Manual Download (Easiest)

1. Visit: https://github.com/microsoftarchive/redis/releases
2. Download `Redis-x64-3.0.504.zip` (or latest)
3. Extract to `C:\Redis`
4. Open Command Prompt as Administrator:

```cmd
cd C:\Redis
redis-server.exe
```

### Method C: Skip Redis (Recommended for quick start)

**The app works perfectly without Redis!** Just continue to Step 3.

### Method B: Download Manual Installation

1. Visit: https://github.com/microsoftarchive/redis/releases
2. Download `Redis-x64-*.msi`
3. Run the installer
4. Start from Command Prompt: `redis-server`

### Method C: MongoDB Atlas Instead (Skip Redis)

Skip this step if you prefer to use MongoDB Atlas (cloud) instead of local MongoDB.

**Verify Redis is running (in another terminal):**

```bash
redis-cli ping
# Should respond: PONG
```

## Step 3: Set Up Environment Variables

1. Open `community-savings-app-backend/.env` (or copy from `.env.example`)
2. For **Local Development**, use these minimum settings:

```env
# Server
NODE_ENV=development
PORT=5000

# MongoDB (Local)
MONGO_URI=mongodb://localhost:27017/community-savings

# JWT
JWT_SECRET=your-super-secret-key-min-32-chars-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production

# Redis (optional, app will work without it)
REDIS_URL=redis://localhost:6379

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5000

# Logging
LOG_LEVEL=debug
```

## Step 4: Install Dependencies

```bash
cd community-savings-app-backend
npm install
```

## Step 5: Start the Development Server

Make sure MongoDB is running, then:

```bash
npm run dev
```

**Success indicators:**

- ✅ Server running (development) at http://localhost:5000
- ✅ MongoDB connected successfully
- ℹ️ Redis messages (errors are OK - falls back gracefully)

## Troubleshooting

### MongoDB Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:27017
```

**Solution:**

1. Open Task Manager
2. Search for "MongoDB" in Services tab
3. Right-click → Start (if stopped)
4. Or: `net start MongoDB` in Command Prompt (as Admin)

### Redis Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution:** Redis is optional. The app will use in-memory storage instead. This is safe for development.

If you want Redis:

1. Ensure redis-server is running in a separate terminal
2. Or skip it and continue - the app works fine without it

### Port Already in Use

If port 5000 is in use:

```bash
# Change in .env
PORT=5001
npm run dev
```

### MongoDB Collections Not Created

Run the seeding script:

```bash
npm run seed-admin
```

## Alternative: Use MongoDB Atlas (Cloud)

If you don't want to install MongoDB locally:

1. Sign up at: https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Create a database user (note username/password)
4. Get connection string from "Connect" button
5. Update `.env`:

```env
MONGO_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/community-savings?retryWrites=true&w=majority
```

6. Make sure to whitelist your IP in Atlas (or use 0.0.0.0/0 for dev)

## Useful Commands

```bash
# Start backend in dev mode
npm run dev

# Run tests
npm test

# Seed admin user
npm run seed-admin

# Check MongoDB
mongosh

# Check Redis
redis-cli ping
```

## Next Steps

1. Frontend: Navigate to `community-savings-app-frontend` and follow its setup guide
2. Test API: Visit http://localhost:5000/api-docs (Swagger documentation)
3. Environment: Copy relevant variables to frontend when needed

---

For more details, see [QUICK_START.md](./QUICK_START.md)
