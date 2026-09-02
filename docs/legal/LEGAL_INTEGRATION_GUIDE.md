# Legal Documents Integration Guide

## Quick Start

This guide shows how to integrate the Terms of Service and Privacy Policy feature into your Community Savings App.

## Backend Integration

### 1. Protect Transaction Endpoints

Update your payment and loan routes to require legal acceptance:

#### Payments Route (`routes/payments.js`)

```javascript
const express = require('express');
const router = express.Router();
const { authentication } = require('../middleware/authMiddleware');
const { requireAcceptanceForTransaction } = require('../middleware/legalAcceptanceMiddleware');
const paymentsController = require('../controllers/paymentsController');

// Protect payment endpoints with legal acceptance requirement
router.post(
  '/initiate',
  authentication,
  requireAcceptanceForTransaction,
  paymentsController.initiatePayment
);
router.post(
  '/confirm',
  authentication,
  requireAcceptanceForTransaction,
  paymentsController.confirmPayment
);
router.get(
  '/history',
  authentication,
  requireAcceptanceForTransaction,
  paymentsController.getPaymentHistory
);

module.exports = router;
```

#### Loans Route (`routes/loans.js`)

```javascript
const express = require('express');
const router = express.Router();
const { authentication } = require('../middleware/authMiddleware');
const { requireAcceptanceForTransaction } = require('../middleware/legalAcceptanceMiddleware');
const loansController = require('../controllers/loansController');

// Protect loan endpoints with legal acceptance requirement
router.post(
  '/request',
  authentication,
  requireAcceptanceForTransaction,
  loansController.requestLoan
);
router.post(
  '/approve',
  authentication,
  requireAcceptanceForTransaction,
  loansController.approveLoan
);
router.post('/repay', authentication, requireAcceptanceForTransaction, loansController.repayLoan);

module.exports = router;
```

### 2. Check Acceptance on Registration

Update your authentication controller to suggest legal review after registration:

```javascript
// In authController.js - after successful registration
exports.register = async (req, res) => {
  // ... existing registration code ...

  const user = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: hashedPassword,
  });

  // Send response with legal acceptance link
  return res.status(201).json({
    success: true,
    message: 'Registration successful. Please review and accept our Terms and Privacy Policy.',
    data: {
      user,
      requiresLegalAcceptance: true,
      legalDocumentsUrl: '/api/legal',
      redirectTo: '/legal',
    },
  });
};
```

### 3. Initialize Legal Service

In `server.js`, ensure the legal service is available:

```javascript
// Already added in server.js
app.use('/api/legal', require('./routes/legal.routes'));
```

## Frontend Integration

### 1. Add Legal Documents Component to App

#### Option A: Standalone Modal (Current Implementation)

```jsx
// In your main App component or relevant page
import LegalDocuments from './components/LegalDocuments';

function App() {
  return (
    <div>
      <LegalDocuments />
      <YourMainApp />
    </div>
  );
}
```

#### Option B: Dedicated Page

Create a dedicated legal page:

```jsx
// pages/LegalPage.jsx
import React from 'react';
import LegalDocuments from '../components/LegalDocuments';

export default function LegalPage() {
  return (
    <div className="legal-page">
      <header>
        <h1>Legal Documents</h1>
        <p>Please review and accept our policies</p>
      </header>
      <main>
        <LegalDocuments />
      </main>
    </div>
  );
}
```

### 2. Add Pre-transaction Acceptance Check

Create a component to enforce acceptance before transactions:

```jsx
// components/TransactionGuard.jsx
import React, { useState, useEffect } from 'react';
import LegalDocuments from './LegalDocuments';

export default function TransactionGuard({ children }) {
  const [acceptanceStatus, setAcceptanceStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAcceptance();
  }, []);

  const checkAcceptance = async () => {
    try {
      const response = await fetch('/api/legal/acceptance-status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await response.json();
      setAcceptanceStatus(data.data);
    } catch (error) {
      console.error('Error checking acceptance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  const accepted = acceptanceStatus?.acceptedTerms && acceptanceStatus?.acceptedPrivacy;

  if (!accepted) {
    return (
      <div className="acceptance-guard">
        <h2>Legal Acceptance Required</h2>
        <p>You must accept our Terms of Service and Privacy Policy to continue.</p>
        <LegalDocuments />
      </div>
    );
  }

  return children;
}

// Usage:
// <TransactionGuard>
//   <PaymentForm />
// </TransactionGuard>
```

### 3. Add Navigation Link to Legal Page

In your main navigation menu:

```jsx
// components/Navigation.jsx
import { Link } from 'react-router-dom';

export default function Navigation() {
  return (
    <nav>
      {/* Other navigation items */}
      <Link to="/legal">Legal Documents</Link>
    </nav>
  );
}

// In Router configuration:
import LegalPage from './pages/LegalPage';

<Route path="/legal" element={<LegalPage />} />;
```

### 4. Handle Acceptance in Transaction Forms

```jsx
// In your payment or loan form component
import { useState, useEffect } from 'react';

export default function PaymentForm() {
  const [acceptanceStatus, setAcceptanceStatus] = useState({
    acceptedTerms: false,
    acceptedPrivacy: false,
  });

  useEffect(() => {
    fetchAcceptanceStatus();
  }, []);

  const fetchAcceptanceStatus = async () => {
    const response = await fetch('/api/legal/acceptance-status', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const data = await response.json();
    setAcceptanceStatus(data.data);
  };

  const handlePayment = async () => {
    if (!acceptanceStatus.acceptedTerms || !acceptanceStatus.acceptedPrivacy) {
      alert('Please accept Terms and Privacy Policy first');
      window.location.href = '/legal';
      return;
    }

    // Proceed with payment
    try {
      const response = await fetch('/api/payments/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          amount: formData.amount,
          method: formData.method,
        }),
      });

      if (!response.ok && response.status === 403) {
        // Already accepted, but server says no - refresh status
        alert('Please review and accept the latest terms');
        window.location.href = '/legal';
        return;
      }

      const data = await response.json();
      // Handle payment success
    } catch (error) {
      console.error('Payment error:', error);
    }
  };

  return (
    <form onSubmit={handlePayment}>
      {/* Form fields */}
      {(!acceptanceStatus.acceptedTerms || !acceptanceStatus.acceptedPrivacy) && (
        <div className="acceptance-warning">
          <p>⚠️ You must accept Terms and Privacy Policy to proceed</p>
          <a href="/legal">Review Legal Documents</a>
        </div>
      )}
      <button disabled={!acceptanceStatus.acceptedTerms || !acceptanceStatus.acceptedPrivacy}>
        Complete Payment
      </button>
    </form>
  );
}
```

### 5. Add to Footer

Include links in footer for transparency:

```jsx
// components/Footer.jsx
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer>
      <div className="footer-legal">
        <Link to="/legal">Terms of Service</Link>
        <span> | </span>
        <Link to="/legal">Privacy Policy</Link>
        <span> | </span>
        <Link to="/legal">Legal Documents</Link>
      </div>
    </footer>
  );
}
```

## Key Integration Points

### 1. Authentication Flow

```
User Signup/Login
    ↓
Check Acceptance Status
    ↓
Not Accepted? → Redirect to /legal
    ↓
Accepted? → Allow access
```

### 2. Transaction Flow

```
User Initiates Transaction
    ↓
Check Acceptance Middleware
    ↓
Not Accepted? → Return 403 Forbidden
    ↓
Accepted? → Process Transaction
```

### 3. First-Time User Flow

```
Registration Complete
    ↓
Show "Accept Terms" Prompt
    ↓
Display LegalDocuments Component
    ↓
User Reviews & Accepts
    ↓
Record Acceptance
    ↓
Allow App Access
```

## Error Handling

### Handle 403 Forbidden Responses

```javascript
// In API interceptor or fetch wrapper
async function fetchWithAcceptanceCheck(url, options = {}) {
  const response = await fetch(url, options);

  if (response.status === 403) {
    const data = await response.json();
    if (data.action === 'REQUIRE_LEGAL_ACCEPTANCE') {
      // Redirect to legal documents
      window.location.href = data.acceptanceLink;
      return null;
    }
  }

  return response;
}

// Usage:
const response = await fetchWithAcceptanceCheck('/api/payments/initiate', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify(paymentData),
});
```

## Testing Integration

### Test Acceptance Flow

```javascript
// Cypress test example
describe('Legal Acceptance Flow', () => {
  it('should require acceptance before payment', () => {
    // Login
    cy.visit('/login');
    cy.get('[data-testid=email]').type('user@test.com');
    cy.get('[data-testid=password]').type('password123');
    cy.get('[data-testid=login-btn]').click();

    // Try to make payment without accepting
    cy.visit('/payments');
    cy.get('[data-testid=payment-btn]').click();
    cy.contains('Please accept Terms').should('be.visible');

    // Navigate to legal
    cy.visit('/legal');
    cy.get('[data-testid=accept-terms-btn]').click();

    // Should now be able to make payment
    cy.visit('/payments');
    cy.get('[data-testid=payment-btn]').click();
    cy.contains('Payment Processing').should('be.visible');
  });
});
```

## Database Queries

### Query User Acceptance Records

```javascript
// In your admin/reporting code
const { LegalAcceptance } = require('./services/termsAndPrivacy');

// Get all acceptances for specific user
async function getUserAcceptances(userId) {
  return await LegalAcceptance.find({ userId }).sort({ acceptedAt: -1 });
}

// Get acceptances in date range
async function getAcceptancesInDateRange(startDate, endDate) {
  return await LegalAcceptance.find({
    acceptedAt: {
      $gte: startDate,
      $lte: endDate,
    },
  });
}

// Get acceptances by version
async function getAcceptancesByVersion(termsVersion, privacyVersion) {
  return await LegalAcceptance.find({
    termsVersion,
    privacyVersion,
  });
}

// Get users who haven't accepted latest version
async function getUsersNotAcceptedLatest(latestTermsVersion, latestPrivacyVersion) {
  return await LegalAcceptance.find({
    $or: [
      { termsVersion: { $ne: latestTermsVersion } },
      { privacyVersion: { $ne: latestPrivacyVersion } },
    ],
  }).distinct('userId');
}
```

## Monitoring & Analytics

### Track Acceptance Metrics

```javascript
// In your analytics service
async function trackAcceptanceMetrics() {
  const { LegalAcceptance } = require('./services/termsAndPrivacy');

  const total = await LegalAcceptance.countDocuments();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayAcceptances = await LegalAcceptance.countDocuments({
    acceptedAt: { $gte: today },
  });

  const latestTermsAcceptances = await LegalAcceptance.countDocuments({
    termsVersion: '1.0.0',
  });

  return {
    totalAcceptances: total,
    todayAcceptances,
    latestTermsAcceptances,
    acceptanceRate: ((latestTermsAcceptances / total) * 100).toFixed(2) + '%',
  };
}
```

## Troubleshooting

### Issue: "User must accept terms" error on every request

**Solution**: Check that acceptance status is being cached correctly. Ensure user ID matches between JWT and database.

### Issue: Modal not displaying

**Solution**: Verify API endpoints are returning data. Check browser console for fetch errors. Ensure token is valid in Authorization header.

### Issue: Acceptance not being recorded

**Solution**: Verify MongoDB connection and schema. Check POST request includes Authorization header. Ensure user is authenticated.

### Issue: Old version still being shown

**Solution**: Clear browser cache. Verify CURRENT_VERSIONS in termsAndPrivacy.js is updated. Check API response includes new content.

## Compliance Verification

Run this checklist before going to production:

- [ ] Terms of Service includes all required sections
- [ ] Privacy Policy covers GDPR, CCPA, Kenya Data Protection Act
- [ ] Acceptance records stored with timestamp, IP, user agent
- [ ] Users must accept before transactions
- [ ] New users prompted to accept on signup
- [ ] Document versions properly tracked
- [ ] API endpoints tested and working
- [ ] Frontend component displays correctly
- [ ] Modal is mobile-responsive
- [ ] Error handling implemented
- [ ] Authentication middleware enforced
- [ ] Audit trail complete
- [ ] Contact information accurate

---

**Last Updated**: January 15, 2026
