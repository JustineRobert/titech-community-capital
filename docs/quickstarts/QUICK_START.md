# Quick Start Guide - Community Savings App Backend

## Prerequisites

- Node.js 14+ and npm
- MongoDB 4.4+ (or MongoDB Atlas)
- Redis 6+ (for caching, rate limiting, and job queues)
- Git

### Installing Redis on Windows

#### Option 1: Using Chocolatey (Recommended)

```bash
choco install redis-64
```

#### Option 2: Download from Microsoft

1. Download Redis for Windows from: https://github.com/microsoftarchive/redis/releases
2. Extract and run `redis-server.exe`

#### Option 3: Using Docker

```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

### Installing Redis on macOS/Linux

```bash
# macOS with Homebrew
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

### Installing MongoDB

#### Option 1: Local MongoDB Installation (Recommended for Development)

**Windows:**

1. Download MongoDB Community Edition from https://www.mongodb.com/try/download/community
2. Run the installer and follow the setup wizard
3. MongoDB will start automatically as a Windows Service
4. Verify with: `mongosh` or `mongo`

**macOS (Homebrew):**

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

#### Option 2: MongoDB Atlas (Cloud Database - Free Tier Available)

**For easy setup without local installation:**

1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free account and sign up
3. Create a new cluster (free tier available)
4. Create a database user with username and password
5. Get your connection string (SRV URI format)
6. Update `.env` with your `MONGO_URI`:

```bash
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/community-savings?retryWrites=true&w=majority
```

**Note:** Make sure to:

- Add your IP to the IP whitelist (or use 0.0.0.0/0 for development)
- Replace `username:password` with your actual credentials

## Installation

### 1. Clone and Install Dependencies

```bash
cd community-savings-app-backend
npm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env
```

Create a `.env` file in the backend directory with the following configuration:

**For Local MongoDB:**

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://localhost:27017/community-savings
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production-min-32-chars
REDIS_URL=redis://localhost:6379
CORS_ORIGINS=http://localhost:3000,http://localhost:5000
LOG_LEVEL=debug
```

**For MongoDB Atlas (Cloud):**

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/community-savings?retryWrites=true&w=majority
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production-min-32-chars
REDIS_URL=redis://localhost:6379
CORS_ORIGINS=http://localhost:3000,http://localhost:5000
LOG_LEVEL=debug
```

**Important Notes:**

- Replace `username:password` and `cluster` in the MONGO_URI_ATLAS with your actual MongoDB Atlas credentials
- Keep `JWT_SECRET` and `JWT_REFRESH_SECRET` long and random (minimum 32 characters)
- Redis is optional for local development (app will fall back to in-memory store if unavailable)

### 3. Start MongoDB and Redis

**If using Local MongoDB:**

Windows (MongoDB runs as a service automatically):

```bash
# Verify MongoDB is running
mongosh
exit
```

macOS:

```bash
brew services start mongodb-community
```

Ubuntu/Debian:

```bash
sudo systemctl start mongodb
```

**If using MongoDB Atlas:**

- No action needed, MongoDB Atlas is always available at the cloud

**For Redis (Optional but Recommended):**

Windows (if you installed via Chocolatey):

```bash
redis-server
# In another terminal:
redis-cli ping  # Should respond with PONG
```

macOS:

```bash
brew services start redis
redis-cli ping
```

Ubuntu/Debian:

```bash
sudo systemctl start redis-server
redis-cli ping
```

### 4. Database Setup

```bash
# Initialize database indexes (one-time)
node -e "require('./config/performanceOptimization').initializeIndexes()"

# Seed admin user (for development)
npm run seed-admin

# Or seed local data
npm run seed-local
```

## Running the Application

### Development Mode

```bash
# With auto-reload on file changes
npm run dev

# Server runs on http://localhost:5000
```

### Production Mode

```bash
# Start with PM2 for process management
npm install -g pm2
pm2 start server.js --name "community-savings"

# Monitor
pm2 monitor
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- loans.test.js

# Watch mode
npm run test:watch
```

## API Documentation

### Access Swagger UI

Once server is running:

```
http://localhost:5000/api-docs
```

### Key Endpoints

#### Authentication

```bash
# Register
POST /api/auth/register
Body: { name, email, password, phone }

# Login
POST /api/auth/login
Body: { email, password }
```

#### Loans

```bash
# Check eligibility
GET /api/loans/eligibility/:groupId
Header: Authorization: Bearer <token>

# Request loan
POST /api/loans/request
Body: { groupId, amount, reason, repaymentTermMonths }

# Get loan details
GET /api/loans/:loanId

# Approve loan (admin)
PATCH /api/loans/:loanId/approve
Body: { interestRate, repaymentPeriodMonths }

# Disburse loan (admin)
PATCH /api/loans/:loanId/disburse

# Record payment
POST /api/loans/:loanId/repay
Body: { amount, paymentMethod }
```

#### Admin

```bash
# Dashboard metrics
GET /api/admin/dashboard

# Loan analytics
GET /api/admin/analytics/loans?period=30d

# System health
GET /api/admin/system/health
```

## Project Structure

```
community-savings-app-backend/
├── config/
│   ├── db.js                         # Database configuration
│   ├── swaggerConfig.js              # API documentation
│   └── performanceOptimization.js    # Database optimization
├── controllers/
│   ├── loanController.js             # Loan endpoints
│   ├── adminController.js            # Admin dashboard
│   ├── authController.js             # Authentication
│   ├── groupController.js            # Group management
│   └── ...
├── models/
│   ├── User.js
│   ├── Loan.js
│   ├── LoanEligibility.js
│   ├── LoanRepaymentSchedule.js
│   ├── LoanAudit.js
│   └── ...
├── routes/
│   ├── loans.js                      # Loan routes
│   ├── auth.js                       # Auth routes
│   └── ...
├── services/
│   ├── loanScoringService.js         # Eligibility scoring
│   ├── emailService.js               # Email functionality
│   └── ...
├── middleware/
│   ├── auth.js                       # JWT authentication
│   ├── securityHardening.js          # Security middleware
│   └── ...
├── tests/
│   ├── integration/
│   │   └── controllers/
│   │       ├── loans.test.js         # Loan integration tests
│   │       └── ...
│   └── setup.js                      # Test configuration
├── server.js                          # Application entry point
├── package.json
└── README.md
```

## Key Features

### Loan Management

- ✅ Eligibility scoring (4-component algorithm)
- ✅ Complete loan lifecycle (apply → approve → disburse → repay)
- ✅ Automatic repayment schedule generation
- ✅ Payment tracking with on-time/late detection
- ✅ Default detection and alerting

### Security

- ✅ JWT authentication
- ✅ Role-based access control
- ✅ Rate limiting (multiple layers)
- ✅ Input validation & sanitization
- ✅ CSRF protection
- ✅ Secure password hashing

### Admin Features

- ✅ Comprehensive dashboard
- ✅ User analytics
- ✅ Loan analytics with trends
- ✅ Payment collection metrics
- ✅ Compliance reporting
- ✅ System health monitoring
- ✅ Audit trail

### Performance

- ✅ 50+ optimized database indexes
- ✅ Query optimization with lean()
- ✅ Aggregation pipelines for analytics
- ✅ Caching ready (Redis integration)
- ✅ Connection pooling
- ✅ Response time < 200ms (p95)

## Troubleshooting

### Connection Issues

```bash
# Test MongoDB connection
mongo mongodb://localhost:27017/community-savings

# Check if MongoDB is running
ps aux | grep mongod

# Start MongoDB (if using local)
mongod --dbpath /path/to/data
```

### Port Already in Use

```bash
# Find process using port 5000
lsof -i :5000

# Kill process
kill -9 <PID>
```

### JWT Token Errors

```bash
# Ensure JWT_SECRET is set
echo $JWT_SECRET

# Regenerate if needed
openssl rand -base64 32
```

### Test Failures

```bash
# Clear MongoDB test database
mongo mongodb://localhost:27017/community-savings-test --eval "db.dropDatabase()"

# Run tests with debug output
DEBUG=* npm test
```

## Development Workflow

### Adding a New Endpoint

1. **Create route** in `/routes/loans.js`

   ```javascript
   router.post('/new', verifyToken, validateInputs, controller);
   ```

2. **Implement controller** in `/controllers/loanController.js`

   ```javascript
   exports.newEndpoint = asyncHandler(async (req, res) => {
     // Implementation
   });
   ```

3. **Add tests** in `/tests/integration/controllers/loans.test.js`

   ```javascript
   it('should do something', async () => {
     // Test
   });
   ```

4. **Update Swagger** in `/config/swaggerConfig.js`

### Database Migration

```bash
# Create new migration
node scripts/migrate.js create_migration_name

# Run migrations
npm run migrate

# Check status
npm run migrate:status

# Rollback
npm run migrate:down
```

## Performance Tuning

### Monitor Performance

```javascript
// In your code
const start = Date.now();
const result = await someQuery();
console.log(`Query took ${Date.now() - start}ms`);
```

### Enable Query Logging

```javascript
// In server.js
mongoose.set('debug', true);
```

### Database Stats

```bash
# Connect to MongoDB
mongo mongodb://localhost:27017/community-savings

# Get stats
db.stats()
db.loans.stats()

# Check indexes
db.loans.getIndexes()
```

## Deployment

### Pre-deployment Checklist

```bash
# Run tests
npm test

# Check code quality
npm run lint

# Generate documentation
npm run docs

# Build for production
npm run build
```

### Deploy to Production

See [PRODUCTION_DEPLOYMENT_COMPLETE.md](./PRODUCTION_DEPLOYMENT_COMPLETE.md) for detailed deployment instructions.

## Support

### Documentation

- **API Docs**: http://localhost:5000/api-docs (Swagger UI)
- **Implementation Guide**: [IMPLEMENTATION_COMPLETE_SUMMARY.md](./IMPLEMENTATION_COMPLETE_SUMMARY.md)
- **Deployment Guide**: [PRODUCTION_DEPLOYMENT_COMPLETE.md](./PRODUCTION_DEPLOYMENT_COMPLETE.md)

### Common Tasks

**Check loan status**

```javascript
const loan = await Loan.findById(loanId).populate('user').populate('group');
console.log(loan);
```

**Get user's loans**

```javascript
const loans = await Loan.find({ user: userId }).populate('group');
```

**Check eligibility**

```javascript
const { assessEligibility } = require('./services/loanScoringService');
const eligibility = await assessEligibility(userId, groupId, adminId);
```

**View audit trail**

```javascript
const audit = await LoanAudit.find({ user: userId }).sort({ createdAt: -1 });
```

## Links

- **Repository**: https://github.com/titech-africa/community-savings-app
- **Issue Tracker**: https://github.com/titech-africa/community-savings-app/issues
- **Wiki**: https://github.com/titech-africa/community-savings-app/wiki
- **Status Page**: https://status.community-savings.app

---

**Happy coding!** 🚀

For more information, see the complete [README.md](./README.md).
