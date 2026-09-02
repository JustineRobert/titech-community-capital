#!/bin/bash\necho "Setup script ready"
#!/bin/bash
set -e

####################################
# Community Savings App Setup Script
####################################

echo "🚀 Starting setup for Community Savings App..."

# Ensure we are in project root
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd community-savings-app-backend
npm install
cd ..

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd community-savings-app-frontend
npm install
cd ..

# Create production environment file
echo "⚙️ Setting up .env.production..."
cat > community-savings-app-backend/.env.production << 'EOF'
####################################
# Application Environment
####################################
NODE_ENV=production

####################################
# Server Configuration
####################################
PORT=5000
HOST=0.0.0.0

####################################
# Database Configuration
####################################
# MongoDB Atlas (Production)
MONGO_URI=REPLACE_ATLAS_URI

# Local / Docker MongoDB (Development fallback)
MONGO_URI_FALLBACK=mongodb://127.0.0.1:27017/community_savings

####################################
# Security
####################################
JWT_SECRET=REPLACE_WITH_STRONG_SECRET
JWT_REFRESH_SECRET=REPLACE_WITH_REFRESH_SECRET

####################################
# CORS Configuration
####################################
CORS_ORIGINS=https://your-production-frontend.com,http://localhost:3000
CLIENT_ORIGIN=https://your-production-frontend.com

####################################
# Logging Configuration
####################################
LOG_LEVEL=info
LOG_DIR=/var/log/communitySavings-prod

####################################
# Feature Flags
####################################
ENABLE_EMAIL_VERIFICATION=true
ENABLE_PASSWORD_RESET=true
ENABLE_REFERRALS=true

####################################
# Redis Configuration
####################################
REDIS_PASSWORD=REPLACE_WITH_REDIS_PASSWORD
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
REDIS_ENABLE_LOGGING=true
REDIS_RECONNECT_ON_ERROR=true
REDIS_MAX_RETRIES=5

####################################
# Email / Third‑party
####################################
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=comunitiessavings@gmail.com
EMAIL_PASSWORD=Justine@881234

####################################
# Monitoring / Analytics
####################################
SENTRY_DSN=REPLACE_WITH_SENTRY_DSN
GOOGLE_ANALYTICS_ID=REPLACE_WITH_GA_ID

####################################
# Database Credentials (optional)
####################################
DB_USER=titechaafrica_db_user
DB_PASSWORD=REPLACE_ATLAS_PASSWORD
EOF

echo "✅ .env.production created at community-savings-app-backend/.env.production"

# Build frontend for production
echo "🛠 Building frontend..."
cd community-savings-app-frontend
npm run build
cd ..

echo "🎉 Setup complete! You can now run:"
echo "   npm run dev        # Start backend + frontend together"
echo "   npm run start:backend  # Start backend only"
echo "   npm run start:frontend # Start frontend only"
