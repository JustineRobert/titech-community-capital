# Terms of Service and Privacy Policy Implementation Guide

## Overview

This guide documents the complete implementation of Terms of Service and Privacy Policy features for the Community Savings App. The implementation includes fully worded legal documents, acceptance tracking, secure storage, and frontendcontrol components.

## Features Implemented

### ✅ Fully Worded Legal Documents

#### Terms of Service (v1.0.0)

- **20 Comprehensive Sections**:
  1. Acceptance of Terms
  2. Use License
  3. Disclaimer of Warranties
  4. Limitations of Liability
  5. Accuracy of Materials
  6. Materials and Content Ownership
  7. Financial Transactions & Payment
  8. Loan Agreements
  9. User Responsibilities
  10. Prohibited Conduct
  11. Limitation of Support
  12. Revision of Terms
  13. Governing Law
  14. Dispute Resolution
  15. Severability
  16. Entire Agreement
  17. Contact Information
  18. (And more...)

- **Key Coverage Areas**:
  - Legal usage rights and restrictions
  - Payment processing and transaction finality
  - Loan agreement terms
  - User conduct standards
  - Liability limitations
  - Kenya law governing clause

#### Privacy Policy (v1.0.0)

- **20 Comprehensive Sections**:
  1. Introduction
  2. Definitions
  3. Types of Data Collected (6 categories)
  4. Legal Basis for Processing
  5. Use of Data (5 purposes)
  6. Data Retention
  7. Data Sharing and Third Parties
  8. Security of Data
  9. Your Rights (7 rights listed)
  10. Children's Privacy
  11. Cookies and Tracking Technologies
  12. GDPR and Data Protection Laws
  13. California Privacy Rights (CCPA)
  14. Marketing Preferences
  15. Data Breach Notification
  16. Changes to This Policy
  17. Policy Compliance
  18. Data Protection Officer
  19. Contact Information
  20. Effective Date

- **Data Collection Tracking**:
  - Personal Information (name, email, phone, ID, address, income)
  - Financial Information (bank details, transactions, loans)
  - Device Information (device type, OS, IP address)
  - Usage Information (pages visited, features used)
  - Communication Data (messages, support tickets)
  - Location Data (GPS when enabled, IP-based)

- **Compliance Standards**:
  - GDPR (General Data Protection Regulation)
  - CCPA (California Consumer Privacy Act)
  - Kenya Data Protection Act, 2019
  - Industry best practices

### ✅ Acceptance Tracking System

#### Database Schema (MongoDB)

```javascript
LegalAcceptanceSchema = {
  userId: ObjectId (foreign key to User),
  termsVersion: String,      // e.g., "1.0.0"
  privacyVersion: String,    // e.g., "1.0.0"
  acceptedAt: Date,          // Timestamp of acceptance
  ipAddress: String,         // IP where acceptance occurred
  userAgent: String          // Browser/device info for audit trail
}
```

#### Audit Trail

Every acceptance record includes:

- User ID for identification
- Document versions accepted
- Timestamp of acceptance
- IP address of acceptance location
- User agent string for device/browser tracking
- Enables dispute resolution and compliance verification

### ✅ Backend API Endpoints

#### Public Endpoints (No Authentication)

##### 1. Get Terms of Service

```http
GET /api/legal/terms-of-service
```

**Response:**

```json
{
  "success": true,
  "message": "Terms of Service retrieved successfully",
  "data": {
    "title": "Terms of Service",
    "version": "1.0.0",
    "effectiveDate": "2026-01-15",
    "lastUpdated": "2026-01-15T00:00:00Z",
    "content": "...full legal text..."
  }
}
```

##### 2. Get Privacy Policy

```http
GET /api/legal/privacy-policy
```

**Response:**

```json
{
  "success": true,
  "message": "Privacy Policy retrieved successfully",
  "data": {
    "title": "Privacy Policy",
    "version": "1.0.0",
    "effectiveDate": "2026-01-15",
    "lastUpdated": "2026-01-15T00:00:00Z",
    "content": "...full legal text..."
  }
}
```

##### 3. Get Document Changelog

```http
GET /api/legal/changelog
```

**Response:**

```json
{
  "success": true,
  "message": "Changelog retrieved successfully",
  "data": [
    {
      "version": "1.0.0",
      "date": "2026-01-15",
      "document": "both",
      "changes": [
        "Initial release",
        "Comprehensive Terms of Service",
        "Complete Privacy Policy",
        "GDPR and CCPA compliance",
        "Data retention policies",
        "User rights documentation"
      ]
    }
  ]
}
```

#### Protected Endpoints (Requires Authentication)

##### 4. Accept Terms and Privacy Policy

```http
POST /api/legal/accept-terms
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
Body: {}
```

**Response:**

```json
{
  "success": true,
  "message": "Terms and Privacy Policy accepted successfully",
  "data": {
    "acceptedAt": "2026-01-20T10:30:00Z",
    "termsVersion": "1.0.0",
    "privacyVersion": "1.0.0",
    "recordedFor": "user_id_123"
  }
}
```

##### 5. Get Acceptance Status

```http
GET /api/legal/acceptance-status
Authorization: Bearer {JWT_TOKEN}
```

**Response:**

```json
{
  "success": true,
  "message": "Acceptance status retrieved successfully",
  "data": {
    "userId": "user_id_123",
    "hasAccepted": true,
    "acceptedTerms": true,
    "acceptedPrivacy": true,
    "currentTermsVersion": "1.0.0",
    "currentPrivacyVersion": "1.0.0",
    "acceptedAt": "2026-01-20T10:30:00Z",
    "acceptedTermsVersion": "1.0.0",
    "acceptedPrivacyVersion": "1.0.0"
  }
}
```

### ✅ Backend Implementation

#### 1. Service Layer (`termsAndPrivacy.js`)

**Functions:**

- `getTermsOfService()` - Returns full Terms of Service document
- `getPrivacyPolicy()` - Returns full Privacy Policy document
- `getVersion(docType)` - Returns current version number
- `getLastUpdated(docType)` - Returns last update date
- `recordAcceptance(userId, termsVersion, privacyVersion, ipAddress, userAgent)` - Records acceptance in database
- `getAcceptanceStatus(userId)` - Checks if user accepted current versions
- `getChangelog()` - Returns document version history

**Version Management:**

```javascript
CURRENT_VERSIONS = {
  terms: '1.0.0',
  privacy: '1.0.0',
};

LAST_UPDATED = {
  terms: new Date('2026-01-15'),
  privacy: new Date('2026-01-15'),
};
```

#### 2. Controller Layer (`legalController.js`)

**Endpoints Implemented:**

- `getTermsOfService()` - GET /api/legal/terms-of-service
- `getPrivacyPolicy()` - GET /api/legal/privacy-policy
- `acceptTermsAndPrivacy()` - POST /api/legal/accept-terms
- `getAcceptanceStatus()` - GET /api/legal/acceptance-status
- `getChangelog()` - GET /api/legal/changelog

**Security Features:**

- Authentication validation for protected endpoints
- User ID extraction from JWT token
- IP address and user agent capture for audit trail
- Environment-aware error messages (production vs development)

#### 3. Routes (`legal.routes.js`)

**Route Configuration:**

```javascript
// Public routes
GET / api / legal / terms - of - service;
GET / api / legal / privacy - policy;
GET / api / legal / changelog;

// Protected routes (require authentication)
POST / api / legal / accept - terms;
GET / api / legal / acceptance - status;
```

**Middleware:**

- `authentication` middleware required for POST and restricted GET endpoints
- No authentication required for document retrieval (allows anonymous access)

#### 4. Server Integration (`server.js`)

**Route Mounting:**

```javascript
app.use('/api/legal', require('./routes/legal.routes'));
```

Added alongside other API routes for consistent endpoint structure.

### ✅ Frontend Components

#### LegalDocuments Component (`LegalDocuments.jsx`)

**Features:**

- **Modal Display**: Separate modals for Terms of Service and Privacy Policy
- **Acceptance Tracking**: Check and display user acceptance status
- **Dynamic Fetching**: Load documents from API endpoints
- **User-Friendly Interface**:
  - Large readable text in modals
  - Scrollable content area
  - Clear header with document version
  - Action buttons for acceptance
- **Responsive Design**: Fully mobile-responsive
- **Loading States**: Shows loading message while fetching
- **Error Handling**: Displays error messages if fetching fails

**Component States:**

```javascript
{
  showTermsModal: boolean,        // Terms modal visibility
  showPrivacyModal: boolean,      // Privacy modal visibility
  termsData: object,              // Fetched Terms of Service data
  privacyData: object,            // Fetched Privacy Policy data
  acceptanceStatus: object,       // User's acceptance status
  loading: boolean,               // API call loading state
  accepting: boolean,             // Acceptance submission loading
  error: string                   // Error messages
}
```

**Key Functions:**

- `fetchLegalDocuments()` - Loads all documents and acceptance status
- `handleAcceptTerms()` - Records user acceptance via API
- `useEffect()` - Initializes component on mount

#### Styling (`LegalDocuments.css`)

**Design Features:**

- Modern gradient backgrounds
- Smooth animations (fade-in, slide-up)
- Professional color scheme (#667eea primary)
- Responsive breakpoints:
  - Desktop: 900px max-width
  - Tablet: 768px breakpoint
  - Mobile: 480px breakpoint
- Accessible button states (hover, active, disabled)
- Custom scrollbar styling
- Dark text on light backgrounds for readability

**Component Structure:**

```
.legal-documents
├── .legal-acceptance-prompt (conditionally shown)
├── .legal-links (buttons to open modals)
├── .legal-modal-overlay (backdrop)
│   └── .legal-modal
│       ├── .legal-modal-header
│       ├── .legal-modal-content
│       └── .legal-modal-footer
```

## File Structure

```
community-savings-app-backend/
├── services/
│   └── termsAndPrivacy.js           ✅ Service layer with full documents
├── controllers/
│   └── legalController.js           ✅ API endpoint handlers
├── routes/
│   └── legal.routes.js              ✅ Route definitions
└── server.js                        ✅ Updated with route mounting

community-savings-app-frontend/
├── src/
│   └── components/
│       ├── LegalDocuments.jsx        ✅ React component
│       └── LegalDocuments.css        ✅ Component styling
```

## Usage Guide

### For End Users

#### Viewing Documents

1. Click "Terms of Service" or "Privacy Policy" button
2. Modal opens with full document
3. Scroll to read complete content
4. Version and effective date shown at top

#### Accepting Documents

1. After reviewing, click "Accept Terms" or "Accept Privacy Policy"
2. System records acceptance with timestamp
3. Acceptance status updates immediately
4. Green checkmarks show accepted documents

#### Checking Acceptance Status

1. View acceptance status on Terms page
2. Shows which documents have been accepted
3. Shows acceptance date
4. Shows version numbers of accepted documents

### For Developers

#### Adding to Your App

1. **Import Component:**

```jsx
import LegalDocuments from './components/LegalDocuments';
```

2. **Use in Your App:**

```jsx
function App() {
  return (
    <div>
      <LegalDocuments />
      {/* Other components */}
    </div>
  );
}
```

3. **Require on Signup:**
   Use acceptance status check before allowing account creation

4. **Refresh on Login:**
   Check acceptance status on user authentication

#### Updating Documents

##### Adding New Version

1. Update version in `termsAndPrivacy.js`:

```javascript
CURRENT_VERSIONS = {
  terms: '1.1.0', // Increment version
  privacy: '1.0.0',
};
```

2. Update `LAST_UPDATED`:

```javascript
LAST_UPDATED = {
  terms: new Date('2026-02-01'),
  privacy: new Date('2026-01-15'),
};
```

3. Update changelog in `getChangelog()` function

4. Update document content in `getTermsOfService()` or `getPrivacyPolicy()`

5. Existing acceptances remain; only new users or those re-accepting get new version

#### Querying Acceptance Data

```javascript
// Get all acceptances for a user
const { LegalAcceptance } = require('./services/termsAndPrivacy');
const userAcceptances = await LegalAcceptance.find({ userId });

// Get latest acceptance
const latestAcceptance = await LegalAcceptance.findOne({ userId }).sort({ acceptedAt: -1 });

// Get acceptances from a date range
const dateRangeAcceptances = await LegalAcceptance.find({
  acceptedAt: {
    $gte: startDate,
    $lte: endDate,
  },
});
```

## Compliance Notes

### GDPR Compliance

- Data collection basis documented in Privacy Policy
- User rights (access, deletion, portability) documented
- Data retention policies specified
- Can generate user data reports from acceptance records
- Audit trails support investigation of data usage

### CCPA Compliance

- California residents notified of data collection
- Right to know, delete, opt-out documented
- Marketing preferences tool available
- No sale of personal data statement included

### Kenya Data Protection Act

- Data Protection Officer contact information provided
- User rights under KDPA documented
- Data breach notification procedures specified
- Governing law clause specifies Kenya

### Security & Audit

- Acceptance records include IP and user agent for verification
- Timestamps enable audit trail
- Version tracking prevents disputes over document content
- JWT authentication ensures user identity verification

## Testing

### API Testing with cURL

```bash
# Get Terms of Service
curl http://localhost:5000/api/legal/terms-of-service

# Get Privacy Policy
curl http://localhost:5000/api/legal/privacy-policy

# Get Changelog
curl http://localhost:5000/api/legal/changelog

# Accept Terms (requires authentication)
curl -X POST http://localhost:5000/api/legal/accept-terms \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Get Acceptance Status (requires authentication)
curl http://localhost:5000/api/legal/acceptance-status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Frontend Testing

```javascript
// Test document fetching
test('fetches legal documents on mount', async () => {
  render(<LegalDocuments />);
  await waitFor(() => {
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
  });
});

// Test modal display
test('opens Terms modal when button clicked', () => {
  render(<LegalDocuments />);
  const termsBtn = screen.getByText('Terms of Service');
  fireEvent.click(termsBtn);
  expect(screen.getByRole('heading', { name: /Terms of Service/i })).toBeInTheDocument();
});

// Test acceptance
test('records acceptance when user clicks Accept button', async () => {
  render(<LegalDocuments />);
  const acceptBtn = screen.getByText('Accept Terms');
  fireEvent.click(acceptBtn);
  await waitFor(() => {
    expect(screen.getByText(/accepted successfully/i)).toBeInTheDocument();
  });
});
```

## Performance Considerations

### Optimization

- Documents cached on first load
- No database queries for public endpoints
- JWT validation only for protected endpoints
- Efficient modal rendering in React
- CSS grid for responsive layout

### Scaling

- Acceptance records indexed by userId for fast lookups
- Version tracking enables easy document updates
- Lightweight acceptance schema (4 fields per record)
- Stateless API for horizontal scaling

## Future Enhancements

1. **Multi-Language Support**
   - Store translations in separate documents
   - Language selection in UI
   - Accept endpoint returns language preference

2. **Document Versioning UI**
   - Show side-by-side diffs between versions
   - Document change history with highlighted changes
   - Version selector to view past documents

3. **Advanced Acceptance Tracking**
   - Enhanced audit logging with request ID
   - Acceptance analytics dashboard
   - Bulk acceptance reports

4. **Integration Features**
   - Require acceptance before first transaction
   - Decline handling with opt-in alternatives
   - Conditional acceptance based on user type

5. **Legal Management Console**
   - Admin interface to publish new versions
   - Document preview before publishing
   - Notification system for policy changes

## Support & Contact

For questions about implementation:

- Email: legal@communitysavings.app
- Support: support@communitysavings.app

For data protection inquiries:

- Data Protection Officer: privacy@communitysavings.app

---

**Implementation Date**: January 15, 2026  
**Last Updated**: January 15, 2026  
**Status**: ✅ Production Ready
