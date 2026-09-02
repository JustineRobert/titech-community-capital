# Enhanced Group Creation - Quick Start Guide for Developers

## 5-Minute Setup

### Prerequisites

- Node.js v18+
- MongoDB running locally or connection string
- Admin user created in database

### Step 1: Backend Setup (1 min)

```bash
cd community-savings-app-backend

# Install dependencies
npm install

# Create .env file
cat > .env << 'EOF'
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/society-savings
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev_secret_key_change_in_production
PORT=5000
EOF

# Start server
npm run dev  # or: nodemon server.js
```

**Expected Output**:

```
✓ Server listening on port 5000
✓ Connected to MongoDB
```

### Step 2: Frontend Setup (1 min)

```bash
cd community-savings-app-frontend

# Install dependencies
npm install

# Create .env file
cat > .env.local << 'EOF'
VITE_API_URL=http://localhost:5000
EOF

# Start dev server
npm run dev
```

**Expected Output**:

```
  VITE v4.x.x  ready in XXX ms
  ➜  Local:   http://localhost:5173/
```

### Step 3: Create Admin User (1 min)

```bash
cd community-savings-app-backend

# Run seed script (creates default admin)
npm run seed-admin

# Or specify credentials:
# ADMIN_EMAIL=admin@example.com ADMIN_PASS=AdminPass123 npm run seed-admin
```

### Step 4: Login & Test (2 min)

1. Open browser: http://localhost:5173
2. Login with admin credentials
3. Click "Create Group" button
4. Follow 4-step wizard

## File Locations

```
community-savings-app/
├── community-savings-app-frontend/
│   └── src/pages/
│       ├── CreateGroupV2.jsx       ← Main component
│       └── CreateGroupV2.css       ← Styles
├── community-savings-app-backend/
│   ├── controllers/groupController.js    ← Enhanced endpoints
│   ├── routes/groups.js                   ← Updated routes
│   └── models/Group.js                    ← Updated schema
├── ENHANCED_GROUP_CREATION_DOCS.md           ← Full documentation
├── GROUP_CREATION_TESTING_GUIDE.md           ← Testing procedures
└── GROUP_CREATION_IMPLEMENTATION_COMPLETE.md ← Summary
```

## Key Features Quick Reference

### CreateGroupV2 Features

```javascript
// 4-Step Wizard
1. Group Info (name, type, description)
2. Members (CSV or manual)
3. Preview (review details)
4. Confirmation (progress tracking)

// Group Types
- savings (traditional savings pool)
- investment (investment focus)
- community (community support)
- welfare (member welfare)

// Member Roles
- member (regular)
- treasurer (financial)
- secretary (records)

// CSV Format
email,role
john@example.com,treasurer
jane@example.com,secretary
bob@example.com,member
```

### API Endpoints

#### Create Group

```
POST /api/groups
Headers: Authorization: Bearer {token}
Body: {
  name: string,
  type: enum,
  description: string,
  members: [{email, role}],
  createdBy: userId
}
Response: 201 { groupId, invitedCount }
```

#### Send Batch Invitations

```
POST /api/groups/:groupId/send-invitations
Headers: Authorization: Bearer {token}
Body: {
  members: [{email, role}],
  batchIndex: number
}
Response: 200 { successCount, failureCount, failures }
```

## Common Tasks

### View Component in Browser

```bash
# Frontend must be running on http://localhost:5173
# Navigate to: http://localhost:5173/create-group
# (Must be logged in as admin)
```

### Test API Endpoint Directly

```bash
# Get token first
TOKEN=$(curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"AdminPass123"}' \
  | jq -r '.token')

# Create group
curl -X POST http://localhost:5000/api/groups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name":"Test Group",
    "type":"savings",
    "description":"Test",
    "members":[{"email":"test@example.com","role":"member"}],
    "createdBy":"admin_user_id"
  }'
```

### Check Database for Created Groups

```bash
# Connect to MongoDB
mongo

# Switch database
use society-savings

# Find recent groups
db.groups.find({}).sort({createdAt: -1}).limit(5).pretty()

# Count groups
db.groups.countDocuments()
```

### View Frontend Logs

```bash
# Browser Console (F12)
# Look for:
# - CreateGroupV2 component initialization
# - API call logs
# - CSV parsing results
# - Progress updates
```

### View Backend Logs

```bash
# Terminal running backend
# Look for:
# - GROUP_CREATED logs
# - Batch invitation processing
# - RBAC enforcement messages
# - Database operation logs
```

## Debugging Tips

### Component Not Rendering

1. Check console for errors (F12)
2. Verify user is admin: `document.querySelector('[data-role]')`
3. Check CSS file exists: `src/pages/CreateGroupV2.css`
4. Clear browser cache: Ctrl+Shift+Delete

### CSV Upload Not Working

1. Verify file format: email,role (one per line)
2. Check email format: valid@example.com
3. Verify roles: member, treasurer, secretary
4. Check console for parse errors

### API Calls Failing

1. Verify token in Authorization header
2. Check backend is running: http://localhost:5000/api/health
3. Verify MongoDB connection
4. Check error message in response

### Styling Issues

1. Clear browser cache
2. Check CSS file syntax
3. Verify Tailwind/CSS not conflicting
4. Open DevTools > Elements > Inspect

## Performance Checklist

```
✓ Component load time < 500ms
✓ CSV parsing < 1s for 100 rows
✓ API response < 2s
✓ Batch invitations < 1s per batch
✓ No console errors
✓ No memory leaks
✓ Responsive on all devices
```

## Security Checklist

```
✓ RBAC enforced (admin-only)
✓ Email validation working
✓ Role enum enforced
✓ Duplicates detected
✓ No XSS vulnerabilities
✓ CSRF token included
✓ Audit logs created
✓ Errors don't expose data
```

## Troubleshooting Common Issues

| Problem                                | Solution                                              |
| -------------------------------------- | ----------------------------------------------------- |
| "Port 5000 already in use"             | `lsof -ti:5000 \| xargs kill -9` then restart         |
| "Connect ECONNREFUSED 127.0.0.1:27017" | Start MongoDB: `mongod`                               |
| "Component blank screen"               | Check admin login, check console errors               |
| "CSV upload shows 0 rows"              | Verify file format and line endings (Unix vs Windows) |
| "Invitations not sending"              | Check Redis running or check queue logs               |
| "RBAC error but user is admin"         | Clear browser cache and re-login                      |

## Next Steps After Setup

### For Frontend Development

1. Review CreateGroupV2.jsx structure (comments throughout)
2. Modify CSS in CreateGroupV2.css
3. Test responsive design on different screens
4. Update/add React components as needed

### For Backend Development

1. Review enhanced groupController.js functions
2. Add validation rules if needed
3. Customize email templates
4. Integrate with notification system

### For Testing

1. Follow GROUP_CREATION_TESTING_GUIDE.md
2. Run unit tests: `npm test`
3. Run integration tests: `npm run test:integration`
4. Test on staging before production

### For Deployment

1. Update environment variables
2. Run database migrations
3. Build frontend: `npm run build`
4. Deploy backend and frontend separately
5. Run smoke tests on new environment

## Documentation Map

| Document                                  | Purpose                             |
| ----------------------------------------- | ----------------------------------- |
| ENHANCED_GROUP_CREATION_DOCS.md           | Complete feature documentation      |
| GROUP_CREATION_TESTING_GUIDE.md           | Testing procedures and checklists   |
| GROUP_CREATION_IMPLEMENTATION_COMPLETE.md | Project summary and status          |
| CreateGroupV2.jsx                         | Component code with comments        |
| CreateGroupV2.css                         | Styling with responsive breakpoints |

## Getting Help

### Code Questions

1. Review comments in CreateGroupV2.jsx
2. Check ENHANCED_GROUP_CREATION_DOCS.md
3. Look at examples in GROUP_CREATION_TESTING_GUIDE.md

### API Questions

1. Check endpoint examples in docs
2. Review controller functions
3. Test with curl/Postman

### Styling Questions

1. Check CreateGroupV2.css
2. Review responsive breakpoints
3. Test in different screen sizes

### Debugging

1. Check console.log statements
2. Review network tab (DevTools)
3. Check backend logs
4. Use debugger breakpoints

## Quick Commands Reference

```bash
# Backend
cd community-savings-app-backend
npm run dev              # Start dev server
npm run seed-admin       # Create admin user
npm test                 # Run tests
npm run lint             # Check code style

# Frontend
cd community-savings-app-frontend
npm run dev              # Start dev server
npm run build            # Production build
npm run preview          # Preview build
npm test                 # Run tests

# Database
mongo                    # Connect to MongoDB
mongosh                  # Alternative MongoDB shell
redis-cli                # Connect to Redis

# General
git status               # Check file changes
git diff                 # View code differences
curl                     # Test API endpoints
```

## Version Information

```
Component Version: 2.0
Release Date: January 2024
Status: Production Ready
Tested On: Node v18+, React 18+, MongoDB 5+
```

## Support Contacts

- **Frontend Issues**: Frontend team lead
- **Backend Issues**: Backend team lead
- **Database Issues**: DBA
- **Security Issues**: Security team
- **General Questions**: Development team

---

**Happy coding! 🚀**

For detailed information, refer to:

- ENHANCED_GROUP_CREATION_DOCS.md (full reference)
- GROUP_CREATION_TESTING_GUIDE.md (testing procedures)
- GROUP_CREATION_IMPLEMENTATION_COMPLETE.md (project status)
