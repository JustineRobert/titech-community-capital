# Debug Guide: Node.js + Vite + MongoDB Project Errors

## Error 1: MODULE_NOT_FOUND - migrate-group-schema.js

### Problem

```
Error: Cannot find module 'D:\TITech Projects\society-community-savings-app\scripts\migrate-group-schema.js'
```

### Root Cause

The file `migrate-group-schema.js` does not exist. The actual migration script is `migrate.js`.

### Solution

**Step 1: Verify Available Migration Scripts**

```powershell
# Windows PowerShell
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-backend\scripts"
Get-ChildItem -Filter "*migrate*"

# Output shows:
# migrate.js
# migrateRunner.js
```

**Step 2: Use Correct Migration Command**

```powershell
# Windows PowerShell
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-backend"
node scripts/migrate.js up

# Git Bash
cd "/d/TITech Projects/society-community-savings-app/community-savings-app-backend"
node scripts/migrate.js up
```

**Step 3: Update Documentation**
Replace all references to `migrate-group-schema.js` with `migrate.js` in:

- `GROUP_CREATION_IMPLEMENTATION_COMPLETE.md` (line 267)
- `ENHANCED_GROUP_CREATION_DOCS.md`
- Any deployment guides

---

## Error 2: Bash Command Error - `d: command not found`

### Problem

```bash
bash: d: command not found
```

### Root Cause

Typo in bash command. User typed `d community-savings-app-frontend` instead of `cd community-savings-app-frontend`.

### Solution

**Windows PowerShell** (Recommended):

```powershell
# Use cd (works same as Unix)
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-frontend"

# Or use full path
Set-Location "D:\TITech Projects\society-community-savings-app\community-savings-app-frontend"
```

**Git Bash** (Correct):

```bash
# Use cd with forward slashes
cd "/d/TITech Projects/society-community-savings-app/community-savings-app-frontend"

# Or convert Windows path
cd /d/TITech\ Projects/society-community-savings-app/community-savings-app-frontend
```

**Quick Reference - Navigation**

| OS             | Correct Command | Example                                                     |
| -------------- | --------------- | ----------------------------------------------------------- |
| **PowerShell** | `cd "path"`     | `cd "D:\TITech Projects\society-community-savings-app"`     |
| **Git Bash**   | `cd /path`      | `cd "/d/TITech Projects/society-community-savings-app"`     |
| **Bash (WSL)** | `cd /path`      | `cd "/mnt/d/TITech Projects/society-community-savings-app"` |

---

## Error 3: EBADENGINE Warning - Node.js Version Mismatch

### Problem

```
npm warn EBADENGINE Unsupported engine {
  package: 'react-router@7.14.x',
  required: { node: '>=20.0.0' },
  current: { node: 'v18.20.8' }
}
```

### Root Cause

Your project uses `react-router@7.14.x` which requires **Node.js v20+**, but you have **v18.20.8**.

### Solution

**Step 1: Check Current Node Version**

```powershell
# PowerShell
node --version
# Output: v18.20.8

npm --version
# Output: 10.x.x
```

**Step 2: Upgrade Node.js to v20+**

#### Option A: Using NVM for Windows (Recommended)

```powershell
# Install nvm-windows from: https://github.com/coreybutler/nvm-windows
# Then:
nvm list                    # See installed versions
nvm install 20.15.1         # Install latest v20 LTS
nvm use 20.15.1             # Switch to v20
node --version              # Verify: v20.15.1
```

#### Option B: Direct Installation

1. Uninstall Node.js v18 (Control Panel → Programs → Uninstall)
2. Download Node.js v20 LTS from [nodejs.org](https://nodejs.org)
3. Install and verify:

```powershell
node --version  # Should be v20.x.x
```

#### Option C: Docker (Avoid Host Version Conflicts)

```dockerfile
# Use official Node.js v20 image
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "run", "dev"]
```

**Step 3: Reinstall Dependencies**

```powershell
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-frontend"
rm -r node_modules package-lock.json
npm install
npm run build
```

**Step 4: Verify No EBADENGINE Warnings**

```powershell
npm install --verbose
# Output should NOT contain EBADENGINE warnings
```

---

## Error 4: Vite CJS Deprecation Warning

### Problem

```
Warning: The CJS build of Vite's Node API is deprecated.
See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
```

### Root Cause

`vite build` is using the CommonJS build of Vite's Node API, which is being phased out.

### Solution

**Step 1: Update Vite (Upgrade to Latest)**

```powershell
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-frontend"
npm install vite@latest
```

**Step 2: Update vite.config.js**
Ensure your `vite.config.js` uses ESM syntax:

```javascript
// vite.config.js - Correct ESM format
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
  },
});
```

**Step 3: Run Build Again**

```powershell
npm run build
# Warning should be gone or minimized
```

**Important: The Build IS Still Valid**

- ✅ The warning is about the build tool's internal API, NOT the output
- ✅ Your `dist/` folder is correctly built and production-ready
- ✅ The warning doesn't affect functionality or performance
- ✅ You can safely deploy the built files

---

## Error 5: MongoDB Windows Service Not Responding

### Problem

```
net start MongoDB
The service is not responding to the control function. (NET HELPMSG 2186)
```

### Root Cause

MongoDB Windows service is:

1. Not installed, OR
2. Corrupted/crashed, OR
3. Port 27017 already in use

### Solution

**Step 1: Check If MongoDB Service Exists**

```powershell
# PowerShell (Run as Administrator)
Get-Service | Where-Object { $_.Name -like "*mongo*" }

# If no output, MongoDB service is NOT installed
```

**Step 2: Start MongoDB Manually (Immediate Fix)**

```powershell
# PowerShell (Run as Administrator)

# Option A: If MongoDB is installed in default location
mongod --dbpath "C:\data\db"

# Option B: If you have custom MongoDB installation
mongod --dbpath "C:\Program Files\MongoDB\Server\7.0\data" --logpath "C:\Program Files\MongoDB\Server\7.0\log\mongod.log"
```

**Step 3: Install/Reinstall MongoDB Service (Permanent Fix)**

#### Option A: Using Chocolatey (Easiest)

```powershell
# PowerShell (Run as Administrator)
choco install mongodb-community

# Verify installation
mongod --version

# Start service
net start MongoDB
```

#### Option B: Manual Installation

1. Download MongoDB Community from [mongodb.com/download](https://www.mongodb.com/download-center/community)
2. Extract to `C:\Program Files\MongoDB\`
3. Create data directory:

```powershell
mkdir "C:\data\db"
mkdir "C:\data\log"
```

4. Create MongoDB as Windows Service:

```powershell
# PowerShell (Run as Administrator)
# Navigate to MongoDB bin directory
cd "C:\Program Files\MongoDB\Server\7.0\bin"

# Create service
mongod --install --serviceName MongoDB --dbpath "C:\data\db" --logpath "C:\data\log\mongod.log"

# Start service
net start MongoDB
```

**Step 4: Verify MongoDB is Running**

```powershell
# Test connection
mongosh
# Should open MongoDB shell successfully

# Or test via Node.js
node -e "const mongoose = require('mongoose'); mongoose.connect('mongodb://localhost:27017/test').then(() => console.log('✅ MongoDB connected')).catch(e => console.log('❌', e.message))"
```

**Step 5: Update .env Configuration**
Ensure your backend `.env` has correct MongoDB URI:

```bash
# .env (Backend)
MONGODB_URI=mongodb://localhost:27017/community-savings
MONGO_URI=mongodb://localhost:27017/community-savings
NODE_ENV=development
```

---

## Complete Setup Verification Checklist

### Node.js & npm

```powershell
✅ node --version          # Should be v20.x.x or higher
✅ npm --version           # Should be 10.x.x or higher
✅ npm list -g             # Lists globally installed packages
```

### Frontend Setup

```powershell
✅ cd community-savings-app-frontend
✅ npm install             # No EBADENGINE warnings
✅ npm run build           # Should complete successfully
✅ npm run preview         # Should serve on http://localhost:5173
```

### Backend Setup

```powershell
✅ cd community-savings-app-backend
✅ npm install             # No warnings
✅ npm run build           # Should show "Backend build complete"
✅ npm start               # Should start on port 5000
```

### Database & Cache

```powershell
✅ mongosh                 # Should connect to MongoDB
✅ redis-cli              # Should connect to Redis (if using)
✅ node scripts/seed-admin.js  # Should create admin user
```

---

## Quick Command Reference

### Windows PowerShell

```powershell
# Navigate
cd "D:\TITech Projects\society-community-savings-app"

# Install dependencies
npm install

# Backend
cd community-savings-app-backend
npm run build
npm start

# Frontend (new terminal)
cd community-savings-app-frontend
npm run build
npm run preview
```

### Git Bash

```bash
# Navigate
cd "/d/TITech Projects/society-community-savings-app"

# Install & Build
npm install
npm run build

# Run backend
cd community-savings-app-backend
npm start

# Run frontend (new terminal)
cd ../community-savings-app-frontend
npm run dev
```

---

## Summary of Fixes

| Error                                 | Cause                           | Fix                                                 |
| ------------------------------------- | ------------------------------- | --------------------------------------------------- |
| **migrate-group-schema.js not found** | File doesn't exist              | Use `migrate.js` instead                            |
| **bash: d: command not found**        | Typo (`d` instead of `cd`)      | Use correct `cd` command                            |
| **EBADENGINE - Node v18 too old**     | react-router@7 needs Node >=v20 | Upgrade to Node.js v20+ using nvm or installer      |
| **Vite CJS deprecation warning**      | Using old CJS API               | Update vite.config.js to ESM (build is still valid) |
| **MongoDB service not responding**    | Service crashed/not installed   | Start mongod manually or reinstall MongoDB service  |

---

## Testing After Fixes

```powershell
# Terminal 1: Backend
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-backend"
npm start
# Should see: ✅ Server listening on port 5000

# Terminal 2: Frontend
cd "D:\TITech Projects\society-community-savings-app\community-savings-app-frontend"
npm run dev
# Should see: ✅ Local: http://localhost:5173

# Terminal 3: MongoDB
mongosh
# Should connect successfully

# Browser
# Visit http://localhost:5173 and test the Create Group feature
```

---

**Last Updated**: May 11, 2026  
**Node.js Version Recommended**: v20.15.1 LTS  
**MongoDB Version Recommended**: 7.0 or higher  
**Status**: ✅ All errors documented with solutions
