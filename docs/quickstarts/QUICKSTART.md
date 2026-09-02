# Quick Start Guide - Community Savings App

## 📋 Prerequisites

- Node.js 16+ and npm
- MongoDB (Atlas cloud or local instance)
- Git

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Clone & Install Dependencies

```bash
# At root level
npm run install-all

# This runs:
# - npm install (root)
# - npm install (backend)
# - npm install (frontend)
```

### Step 2: Configure Backend

```bash
cd community-savings-app-backend

# Copy example to actual env file
cp .env.example .env

# Edit .env with your values:
# - MONGO_URI: Your MongoDB connection string
# - JWT_SECRET: Generate a strong random string (32+ chars)
# - JWT_REFRESH_SECRET: Another strong random string
# - CLIENT_ORIGIN: http://localhost:3000 (for development)
```

**Example MongoDB URIs**:

- **MongoDB Atlas (Recommended)**:
  ```
  mongodb+srv://username:password@cluster.mongodb.net/community-savings?retryWrites=true&w=majority
  ```
- **Local MongoDB**:
  ```
  mongodb://localhost:27017/community-savings
  ```

### Step 3: Configure Frontend

```bash
cd ../community-savings-app-frontend

# Copy example to local env
cp .env.example .env.local

# Set API URL (should match backend):
# REACT_APP_API_URL=http://localhost:5000
```

### Step 4: Start Development Servers

You can also run everything in Docker (useful for production-like testing):

```bash
# from repo root
docker-compose up --build
```

This will start Redis, backend, frontend (served by nginx), Prometheus, Grafana and a
Redis exporter. Backend will be available on http://localhost:5000 and frontend
on http://localhost:3000. Grafana UI will be on http://localhost:3001.

**Option A: Run Both Simultaneously (from root)**

```bash
npm start
# Starts backend on http://localhost:5000
# Starts frontend on http://localhost:3000
```

**Option B: Run Separately**

```bash
# Terminal 1 - Backend
npm run backend

# Terminal 2 - Frontend
npm run frontend
```

---

## 🔐 Authentication Flow

### Registration

```
POST /api/auth/register
Body: {
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123"
}
Response: {
  "token": "eyJhbGc...",
  "user": { "id": "...", "email": "...", "role": "user" }
}
```

### Login

```
POST /api/auth/login
Body: {
  "email": "john@example.com",
  "password": "SecurePass123"
}
Response: {
  "token": "eyJhbGc...",
  "user": { "id": "...", "email": "...", "role": "user" }
}
```

### Get Current User

```
GET /api/auth/me
Header: x-auth-token: <token>
Response: {
  "id": "...",
  "name": "John Doe",
  "email": "john@example.com",
  "role": "user",
  "profile": { ... }
}
```

---

## 📁 Project Structure

```
community-savings-app/
├── community-savings-app-backend/
│   ├── config/          # Database configuration
│   ├── controllers/      # Business logic
│   ├── middleware/       # Auth, error handling
│   ├── models/          # MongoDB schemas
│   ├── routes/          # API endpoints
│   ├── utils/           # Validators, logger
│   ├── server.js        # Entry point
│   ├── .env.example     # Environment template
│   └── package.json
│
├── community-savings-app-frontend/
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── context/     # Auth context
│   │   ├── pages/       # Page components
│   │   ├── services/    # API calls
│   │   └── App.js       # Main app
│   ├── .env.example
│   └── package.json
│
└── package.json         # Root workspace config
```

---

## 🛠️ Development Commands

### Backend

```bash
cd community-savings-app-backend

# Development with auto-reload
npm run dev

# Production
npm start

# Tests (if configured)
npm test
```

### Frontend

```bash
cd community-savings-app-frontend

# Development
npm start

# Production build
npm build

# Tests (if configured)
npm test
```

### Root Level

```bash
# Run all tests
npm test

# Build frontend
npm run build

# Install all dependencies
npm run install-all
```

---

## 🧪 Testing the API

### Using cURL

```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com","password":"SecurePass123"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"SecurePass123"}'

# Get current user (replace TOKEN with actual token)
curl -X GET http://localhost:5000/api/auth/me \
  -H "x-auth-token: TOKEN"
```

### Using Postman

1. Import the collection from `postman/` folder if available
2. Set up environment variables:
   - `base_url`: `http://localhost:5000`
   - `token`: (will be set after login)
3. Test endpoints in order

### Admin seed & automated Postman tests (Newman)

- Create a local admin user quickly (backend):

```powershell
# from repo root
cd community-savings-app-backend
# set env variables OR ensure .env has MONGO_URI
$env:ADMIN_EMAIL='admin@example.com'; $env:ADMIN_PASS='AdminPass123'; node scripts/seed-admin.js
```

- Run the Postman collection via Newman (installed as a dev dependency at root):

```powershell
# from repo root
npm run postman:test
# This runs the `postman/Community-auth-tests.postman_collection.json` collection
# and writes a JSON report to `postman/newman-report.json`.
```

Notes about admin password policy and reports:

- The seed script enforces a default admin password policy: minimum 12 characters, at least one lowercase, one uppercase, and one digit. If you provide `ADMIN_PASS` it must meet the policy or you must set `ADMIN_FORCE=true` to override (not recommended).
- If you do not provide `ADMIN_PASS`, the seed script will generate a strong random password and print it to the console.
- Newman JSON report location: `postman/reports/newman-report.json` (the `postman:test` script writes the report there).

---

## 🐛 Troubleshooting

### "Cannot find module 'mongoose'"

```bash
# Run in backend directory
npm install
```

### "ECONNREFUSED" MongoDB error

- Check MongoDB is running
- Verify MONGO_URI in .env is correct
- Try fallback URI if DNS issues

### CORS error in frontend

- Verify CLIENT_ORIGIN in backend .env matches frontend URL
- Check CORS_ORIGINS environment variable

### Port already in use

```bash
# Change PORT in .env
PORT=5001  # Use different port

# Or kill process using port 5000
lsof -i :5000
kill -9 <PID>
```

### Token validation errors

- Token may be expired (15-min expiry) → Use refresh endpoint
- Check x-auth-token header is set correctly
- Verify JWT_SECRET in .env hasn't changed

---

## 📚 API Endpoints

### Auth Routes

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user

4### Group Routes

- `POST /api/groups` - Create group
- `GET /api/groups` - List user's groups
- `GET /api/groups/:id` - Get group details
- `POST /api/groups/:id/join` - Join group
- `POST /api/groups/:id/leave` - Leave group

### Contribution Routes

- `POST /api/contributions` - Add contribution
- `GET /api/contributions/group/:groupId` - Get group contributions
- `GET /api/contributions/user` - Get user's contributions
- `GET /api/contributions/group/:groupId/stats` - Get group stats

### Other Routes

- `GET /api/loans` - Loan management
- `GET /api/chats` - Chat functionality
- `GET /api/referrals` - Referral system
- `GET /api/settings` - User settings

---

## 🔑 Environment Variables Reference

### Backend (.env)

| Variable             | Description        | Example                 |
| -------------------- | ------------------ | ----------------------- |
| `PORT`               | Server port        | `5000`                  |
| `NODE_ENV`           | Environment        | `development`           |
| `MONGO_URI`          | MongoDB connection | `mongodb+srv://...`     |
| `JWT_SECRET`         | Token signing key  | Random 32+ chars        |
| `JWT_REFRESH_SECRET` | Refresh token key  | Random 32+ chars        |
| `CLIENT_ORIGIN`      | Frontend URL       | `http://localhost:3000` |

### Frontend (.env.local)

| Variable            | Description     | Example                 |
| ------------------- | --------------- | ----------------------- |
| `REACT_APP_API_URL` | Backend API URL | `http://localhost:5000` |

---

## 📝 Common Tasks

### Add New Validation Rule

1. Edit `utils/validators.js`
2. Add rule to `validationRules` object
3. Use in route: `router.post('/endpoint', validationRules.myRule, handler)`

### Create New API Endpoint

1. Create route in `routes/`
2. Add controller in `controllers/`
3. Import in `server.js`
4. Add validation if needed
5. Test with curl/Postman

### Modify User Model

1. Edit `models/User.js`
2. Add field to schema
3. Update auth controller if needed
4. Create migration if in production

---

## 🚢 Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Generate strong JWT secrets
- [ ] Configure production MongoDB URI
- [ ] Set correct CORS origins
- [ ] Enable HTTPS
- [ ] Setup monitoring/logging
- [ ] Run security audit
- [ ] Load test application
- [ ] Backup database plan
- [ ] Document deployment process

---

**Ready to go! Start with `npm start` and happy coding! 🎉**
