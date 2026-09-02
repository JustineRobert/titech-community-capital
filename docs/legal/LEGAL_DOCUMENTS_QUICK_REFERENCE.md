# Legal Documents - Quick Reference Card

## 🚀 Quick Start for Developers

### Import the Component (React)

```jsx
import LegalDocuments from './components/LegalDocuments';

// Use in your app
<LegalDocuments />;
```

### Protect a Payment Route (Backend)

```javascript
const { requireAcceptanceForTransaction } = require('./middleware/legalAcceptanceMiddleware');

router.post(
  '/payments/initiate',
  authentication,
  requireAcceptanceForTransaction,
  paymentsController.initiatePayment
);
```

### Check Acceptance Status (Frontend)

```jsx
const [accepted, setAccepted] = useState(false);

useEffect(() => {
  fetch('/api/legal/acceptance-status', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .then((data) => setAccepted(data.data.acceptedTerms && data.data.acceptedPrivacy));
}, []);
```

---

## 📚 API Endpoints at a Glance

| Method | Endpoint                       | Auth | Purpose                 |
| ------ | ------------------------------ | ---- | ----------------------- |
| GET    | `/api/legal/terms-of-service`  | ❌   | Get full ToS            |
| GET    | `/api/legal/privacy-policy`    | ❌   | Get full privacy policy |
| GET    | `/api/legal/changelog`         | ❌   | Get version history     |
| POST   | `/api/legal/accept-terms`      | ✅   | Record acceptance       |
| GET    | `/api/legal/acceptance-status` | ✅   | Check compliance        |

---

## 🔐 Middleware Options

### Option 1: Block Without Acceptance

```javascript
const { requireLegalAcceptance } = require('./middleware/legalAcceptanceMiddleware');
app.post('/api/sensitive-endpoint', authentication, requireLegalAcceptance, handler);
// Returns 403 Forbidden if not accepted
```

### Option 2: Block Without Transaction Acceptance

```javascript
const { requireAcceptanceForTransaction } = require('./middleware/legalAcceptanceMiddleware');
app.post('/api/payments/initiate', authentication, requireAcceptanceForTransaction, handler);
// Specifically for financial transactions
```

### Option 3: Log Without Blocking

```javascript
const { logLegalAcceptance } = require('./middleware/legalAcceptanceMiddleware');
app.get('/api/public-endpoint', authentication, logLegalAcceptance, handler);
// Just logs status, doesn't block
```

---

## 🎯 Common Scenarios

### Scenario 1: Require Acceptance on Signup

```javascript
// After user registration succeeds
return res.status(201).json({
  success: true,
  message: 'Please review our Terms and Privacy Policy',
  redirectTo: '/legal',
  requiresLegalAcceptance: true,
});
```

### Scenario 2: Block Payment Without Acceptance

```javascript
// In payment controller
async function initiatePayment(req, res) {
  if (!req.legalAcceptance?.acceptedTerms) {
    return res.status(403).json({
      message: 'Accept Terms & Privacy Policy first',
      redirectTo: '/legal',
    });
  }
  // Process payment
}
```

### Scenario 3: Update Legal Documents

```javascript
// In termsAndPrivacy.js
const CURRENT_VERSIONS = {
  terms: '1.1.0', // Increment
  privacy: '1.1.0', // Increment
};

LAST_UPDATED = {
  terms: new Date('2026-02-01'),
  privacy: new Date('2026-02-01'),
};

// Add to changelog
function getChangelog() {
  return [
    {
      version: '1.1.0',
      date: '2026-02-01',
      document: 'terms',
      changes: ['Updated payment terms', 'New AI features clause'],
    },
    ...existing,
  ];
}
```

---

## 🧪 Testing Quick Commands

```bash
# Test public endpoint (no auth needed)
curl http://localhost:5000/api/legal/terms-of-service | jq

# Test protected endpoint (needs JWT)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:5000/api/legal/acceptance-status | jq

# Run test suite
npm test -- legal.test.js

# Run specific test
npm test -- legal.test.js -t "should return Terms of Service"
```

---

## 📋 Database Query Patterns

### Get User's Latest Acceptance

```javascript
const { LegalAcceptance } = require('./services/termsAndPrivacy');
const latest = await LegalAcceptance.findOne({ userId }).sort({ acceptedAt: -1 });
```

### Get All Acceptances This Month

```javascript
const startOfMonth = new Date();
startOfMonth.setDate(1);

const acceptances = await LegalAcceptance.find({
  acceptedAt: { $gte: startOfMonth },
});
```

### Find Users with Outdated Versions

```javascript
const oldAcceptances = await LegalAcceptance.find({
  termsVersion: { $ne: '1.0.0' },
});
```

---

## 🔍 Error Handling Patterns

### Handle 403 Forbidden

```javascript
fetch(url, options).then((res) => {
  if (res.status === 403) {
    // Check if it's a legal acceptance error
    return res.json().then((data) => {
      if (data.action === 'REQUIRE_LEGAL_ACCEPTANCE') {
        window.location.href = '/legal';
      }
    });
  }
  return res;
});
```

### Handle Missing Token

```javascript
if (!localStorage.getItem('token')) {
  // Must be logged in to accept terms
  window.location.href = '/login';
}
```

---

## 📊 Key Files Reference

| File                           | Purpose           | Size      |
| ------------------------------ | ----------------- | --------- |
| `termsAndPrivacy.js`           | Service layer     | 180 lines |
| `legalController.js`           | API handlers      | 160 lines |
| `legal.routes.js`              | Route definitions | 20 lines  |
| `legalAcceptanceMiddleware.js` | Enforcement       | 100 lines |
| `LegalDocuments.jsx`           | React component   | 200 lines |
| `LegalDocuments.css`           | Styling           | 400 lines |

---

## ⚙️ Environment Variables

No additional environment variables required! The service uses:

- `NODE_ENV` (existing)
- `JWT_SECRET` (existing for auth)
- `MONGO_URI` (existing for database)

---

## 🚨 Common Issues & Fixes

### Issue: 401 Unauthorized on /accept-terms

**Fix**: Ensure you're sending valid JWT token in Authorization header

```javascript
headers: { 'Authorization': `Bearer ${token}` }
```

### Issue: Modal not showing in React

**Fix**: Verify API endpoints are accessible and returning data

```javascript
// Test endpoint
curl http://localhost:5000/api/legal/terms-of-service
```

### Issue: Acceptance not being recorded

**Fix**: Check MongoDB connection and user is authenticated

```javascript
// Verify MongoDB connection
db.Legal.findOne({}); // Should return null or a document
```

### Issue: Acceptance middleware returning 500

**Fix**: Check `termsAndPrivacy.js` service is properly initialized

```javascript
const service = require('./services/termsAndPrivacy');
console.log(service.getVersion('terms')); // Should return '1.0.0'
```

---

## 📞 Quick Support Reference

**Question**: How do I make terms acceptance mandatory?
**Answer**: Use `requireLegalAcceptance` middleware on any route

**Question**: Can users skip terms acceptance?
**Answer**: No - middleware blocks access until accepted

**Question**: Do old acceptances become invalid when documents update?
**Answer**: Yes - getAcceptanceStatus() checks version numbers

**Question**: Can I see who accepted and when?
**Answer**: Yes - query `LegalAcceptance.findOne({ userId }).sort({ acceptedAt: -1 })`

---

## 🎓 Learning Path

1. **Understand the Flow**
   - Read LEGAL_DOCUMENTS_IMPLEMENTATION.md (30 min)
   - Review API endpoints
   - Check database schema

2. **Implement Backend**
   - Add requireAcceptanceForTransaction to payment routes
   - Test API endpoints with curl
   - Run legal.test.js suite

3. **Implement Frontend**
   - Add LegalDocuments component to app
   - Test modal display
   - Test acceptance flow

4. **Integrate Fully**
   - Add acceptance check on signup
   - Add navigation links
   - Test end-to-end flow

5. **Monitor**
   - Track acceptance rates
   - Monitor errors
   - Review audit trail

---

## 🎯 Success Criteria

- ✅ Users see Terms & Privacy Policy before signup
- ✅ Cannot make payments without acceptance
- ✅ Cannot request loans without acceptance
- ✅ Acceptance recorded with IP/user agent
- ✅ Version mismatches tracked
- ✅ All tests passing
- ✅ No auth errors on legal endpoints
- ✅ Mobile UI looks good
- ✅ Performance acceptable (<100ms)
- ✅ Audit trail complete

---

## 📅 Deployment Checklist

Before going to production:

- [ ] Legal documents reviewed by counsel
- [ ] Contact information updated
- [ ] Test suite passing (npm test -- legal.test.js)
- [ ] API endpoints accessible
- [ ] Frontend component displays correctly
- [ ] Middleware enforced on payment/loan routes
- [ ] Database backed up
- [ ] Error logging configured
- [ ] Monitoring alerts set up
- [ ] Deployment plan documented

---

## 🔗 Related Documentation

- **Full Implementation Details**: LEGAL_DOCUMENTS_IMPLEMENTATION.md
- **Integration Guide**: LEGAL_INTEGRATION_GUIDE.md
- **Architecture**: API_REFERENCE_QUICK_START.md
- **Compliance**: SECURITY_HARDENING_GUIDE.md

---

**Last Updated**: January 15, 2026 | **Status**: ✅ Production Ready
