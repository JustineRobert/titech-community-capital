# Integration Guide - Help Center, FAQ & Forum

## Quick Integration Steps

This guide provides a step-by-step walkthrough for integrating the Help Center, FAQ, and Forum components into your React application.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [File Structure](#file-structure)
3. [Installation](#installation)
4. [Basic Integration](#basic-integration)
5. [Advanced Integration](#advanced-integration)
6. [Testing Integration](#testing-integration)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 14.0+
- npm or yarn
- React 16.8+
- Basic knowledge of React and npm

---

## File Structure

Ensure the following files exist in your project:

```
src/
├── components/
│   ├── HelpCenter.jsx
│   ├── HelpCenter.css
│   ├── FAQ.jsx
│   ├── FAQ.css
│   ├── Forum.jsx
│   └── Forum.css
└── services/
    ├── helpService.js
    ├── faqService.js
    └── forumService.js
```

---

## Installation

### Step 1: Install Required Dependencies

If not already installed, add axios to your project:

```bash
npm install axios
```

### Step 2: Copy Component Files

Copy all component files from the `/community-savings-app-frontend/src/` directory to your project:

```bash
# Copy components
cp -r community-savings-app-frontend/src/components/* src/components/

# Copy services
cp -r community-savings-app-frontend/src/services/* src/services/
```

### Step 3: Verify File Presence

Ensure all files are in the correct locations:

```bash
# Check components
ls src/components/HelpCenter.*
ls src/components/FAQ.*
ls src/components/Forum.*

# Check services
ls src/services/helpService.js
ls src/services/faqService.js
ls src/services/forumService.js
```

---

## Basic Integration

### Method 1: Full Page Integration

Create a new page component that includes all three features:

```jsx
// pages/SupportPage.jsx
import React from 'react';
import HelpCenter from '../components/HelpCenter';
import FAQ from '../components/FAQ';
import Forum from '../components/Forum';
import '../components/HelpCenter.css';
import '../components/FAQ.css';
import '../components/Forum.css';

function SupportPage() {
  return (
    <div className="support-page">
      <h1>Community Support Center</h1>

      <section className="help-section">
        <HelpCenter />
      </section>

      <section className="faq-section">
        <FAQ />
      </section>

      <section className="forum-section">
        <Forum />
      </section>
    </div>
  );
}

export default SupportPage;
```

### Method 2: Separate Page Integration

Create individual pages for each component:

```jsx
// pages/HelpPage.jsx
import React from 'react';
import HelpCenter from '../components/HelpCenter';
import '../components/HelpCenter.css';

function HelpPage() {
  return <HelpCenter />;
}

export default HelpPage;

// pages/FAQPage.jsx
import React from 'react';
import FAQ from '../components/FAQ';
import '../components/FAQ.css';

function FAQPage() {
  return <FAQ />;
}

export default FAQPage;

// pages/ForumPage.jsx
import React from 'react';
import Forum from '../components/Forum';
import '../components/Forum.css';

function ForumPage() {
  return <Forum />;
}

export default ForumPage;
```

### Method 3: Tab-Based Integration

Use tabs to switch between components:

```jsx
// components/SupportTabs.jsx
import React, { useState } from 'react';
import HelpCenter from './HelpCenter';
import FAQ from './FAQ';
import Forum from './Forum';
import '../components/HelpCenter.css';
import '../components/FAQ.css';
import '../components/Forum.css';

function SupportTabs() {
  const [activeTab, setActiveTab] = useState('help');

  return (
    <div className="support-tabs">
      <div className="tabs-header">
        <button
          className={`tab-btn ${activeTab === 'help' ? 'active' : ''}`}
          onClick={() => setActiveTab('help')}
        >
          Help Center
        </button>
        <button
          className={`tab-btn ${activeTab === 'faq' ? 'active' : ''}`}
          onClick={() => setActiveTab('faq')}
        >
          FAQ
        </button>
        <button
          className={`tab-btn ${activeTab === 'forum' ? 'active' : ''}`}
          onClick={() => setActiveTab('forum')}
        >
          Forum
        </button>
      </div>

      <div className="tabs-content">
        {activeTab === 'help' && <HelpCenter />}
        {activeTab === 'faq' && <FAQ />}
        {activeTab === 'forum' && <Forum />}
      </div>
    </div>
  );
}

export default SupportTabs;
```

### Step 4: Update Router

Add the new pages to your router configuration:

```jsx
// App.jsx or main router file
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HelpPage from './pages/HelpPage';
import FAQPage from './pages/FAQPage';
import ForumPage from './pages/ForumPage';
import SupportPage from './pages/SupportPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/support" element={<SupportPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/forum" element={<ForumPage />} />
        {/* Other routes */}
      </Routes>
    </Router>
  );
}

export default App;
```

### Step 5: Configure Environment

Create or update `.env.local`:

```env
REACT_APP_API_URL=http://localhost:3001/api
```

For production:

```env
REACT_APP_API_URL=https://api.yourdomain.com/api
```

---

## Advanced Integration

### Custom Styling

Override component styles:

```css
/* styles/custom-support.css */

/* Custom Help Center */
.help-center {
  --primary-color: #ff6b6b;
  --primary-dark: #ee5a52;
}

.help-header {
  background: linear-gradient(135deg, #ff6b6b 0%, #ff8787 100%);
}

/* Custom FAQ */
.faq-container {
  background: #f5f5f5;
}

/* Custom Forum */
.forum-container {
  max-width: 1400px;
}
```

Import in your app:

```jsx
import './styles/custom-support.css';
```

### Context Integration

If using Context API for user state:

```jsx
// context/UserContext.js
import React, { createContext } from 'react';

export const UserContext = createContext();

export function UserProvider({ children }) {
  const user = {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    role: 'user',
  };

  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

// App.jsx
import { UserProvider } from './context/UserContext';
import SupportPage from './pages/SupportPage';

function App() {
  return (
    <UserProvider>
      <SupportPage />
    </UserProvider>
  );
}
```

### Redux Integration

If using Redux:

```jsx
// slices/supportSlice.js
import { createSlice } from '@reduxjs/toolkit';

export const supportSlice = createSlice({
  name: 'support',
  initialState: {
    activeTab: 'help',
  },
  reducers: {
    setActiveTab: (state, action) => {
      state.activeTab = action.payload;
    },
  },
});

export const { setActiveTab } = supportSlice.actions;
export default supportSlice.reducer;

// Components
import { useDispatch, useSelector } from 'react-redux';
import { setActiveTab } from '../slices/supportSlice';

function SupportTabs() {
  const dispatch = useDispatch();
  const activeTab = useSelector((state) => state.support.activeTab);

  return (
    <button
      onClick={() => dispatch(setActiveTab('help'))}
      className={activeTab === 'help' ? 'active' : ''}
    >
      Help Center
    </button>
  );
}
```

---

## Testing Integration

### Run Component Tests

```bash
# Run all tests
npm test

# Run specific component tests
npm test HelpCenter.test.js
npm test FAQ.test.js
npm test Forum.test.js

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch
```

### Verify API Integration

Before deploying, test API endpoints:

```bash
# Test Help Center API
curl http://localhost:3001/api/help/articles

# Test FAQ API
curl http://localhost:3001/api/faq

# Test Forum API
curl http://localhost:3001/api/forum/topics
```

### Test in Development Server

```bash
# Start development server
npm start

# Open http://localhost:3000/support
# Test all features:
# - Search functionality
# - Category filtering
# - Creating topics/replies
# - Responsive design
```

---

## Deployment

### Build for Production

```bash
# Create optimized build
npm run build

# Result: build/ directory contains production files
```

### Environment Configuration

Ensure production environment variables are set:

```bash
# .env.production
REACT_APP_API_URL=https://api.production.com/api
```

### Pre-deployment Checklist

- [ ] All tests pass: `npm test`
- [ ] Build completes without errors: `npm run build`
- [ ] API endpoints verified in production
- [ ] Environment variables updated
- [ ] Responsive design tested on mobile
- [ ] Accessibility verified
- [ ] Error messages appropriate
- [ ] Performance acceptable
- [ ] Security headers configured
- [ ] CORS properly set on backend

### Deploy to Production

```bash
# Example: Deploy to Vercel
npm install -g vercel
vercel

# Example: Deploy to Netlify
npm install -g netlify-cli
netlify deploy

# Example: Docker deployment
docker build -t support-app .
docker run -p 80:3000 support-app
```

---

## Troubleshooting

### Issue: CSS Not Loading

**Problem:** Components display but styling is missing

**Solution:**

```jsx
// Make sure to import CSS
import '../components/HelpCenter.css';
import '../components/FAQ.css';
import '../components/Forum.css';

// Or import in main App.js
import './components/HelpCenter.css';
```

### Issue: API Connection Failed

**Problem:** Components show error message

**Solution:**

```bash
# Check API server is running
curl http://localhost:3001/api/help/articles

# Verify REACT_APP_API_URL
echo $REACT_APP_API_URL

# Check browser console for CORS errors
# Update CORS settings on backend if needed
```

### Issue: Components Not Rendering

**Problem:** Blank page or error

**Solution:**

```jsx
// Check component is imported correctly
import HelpCenter from './components/HelpCenter';

// Check component is used correctly
<HelpCenter />

// Check parent component structure
<div className="support-page">
  <HelpCenter />
</div>
```

### Issue: Tests Failing

**Problem:** `npm test` shows red errors

**Solution:**

```bash
# Clear Jest cache
npm test -- --clearCache

# Run in verbose mode to see details
npm test -- --verbose

# Update snapshots if needed
npm test -- -u
```

### Issue: Performance Issues

**Problem:** Slow load times

**Solution:**

```jsx
// Implement code splitting
const HelpCenter = lazy(() => import('./components/HelpCenter'));
const FAQ = lazy(() => import('./components/FAQ'));
const Forum = lazy(() => import('./components/Forum'));

// Use with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <HelpCenter />
</Suspense>;
```

---

## Performance Tips

1. **Lazy Load Components**

   ```jsx
   const HelpCenter = lazy(() => import('./components/HelpCenter'));
   ```

2. **Optimize Images**
   - Use WebP format
   - Implement lazy loading
   - Compress assets

3. **Enable Caching**
   - Cache API responses
   - Implement progressive web app (PWA)

4. **Monitor Performance**
   - Use React DevTools Profiler
   - Check bundle size
   - Monitor API performance

---

## Next Steps

1. Follow the integration steps above
2. Run tests to verify everything works
3. Customize styling to match your brand
4. Deploy to production
5. Monitor usage and user feedback
6. Implement future enhancements

---

## Support Resources

- **Documentation:** See HELP_CENTER_FORUM_IMPLEMENTATION.md
- **API Spec:** See BACKEND_API_SPECIFICATION.md
- **Component Tests:** See individual .test.js files
- **Code Examples:** See implementation files

---

## Common Questions

**Q: Can I use just the Help Center without Forum?**  
A: Yes! Each component is independent and can be used separately.

**Q: How do I customize the styling?**  
A: Override CSS classes or create custom CSS files and import them.

**Q: What if I'm using Vue/Angular instead of React?**  
A: Components are React-specific. You would need to rewrite them in your framework.

**Q: How do I handle authentication?**  
A: Use JWT tokens in API headers. Services pass authorization headers automatically.

**Q: Can I host components on a CDN?**  
A: Components require React, so best deployed with your React app or as a separate React app.

---

**Last Updated:** January 2024  
**Version:** 1.0.0
