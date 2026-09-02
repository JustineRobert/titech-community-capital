# Mobile Money Integration Documentation

## Overview

This document outlines the Mobile Money Payment Integration for the Community Savings App, supporting MTN Mobile Money (MoMo) and Airtel Money transactions for secure, reliable payment processing.

## Table of Contents

1. [Supported Providers](#supported-providers)
2. [Setup Instructions](#setup-instructions)
3. [API Endpoints](#api-endpoints)
4. [Frontend Integration](#frontend-integration)
5. [Security Best Practices](#security-best-practices)
6. [Error Handling](#error-handling)
7. [Transaction Flow](#transaction-flow)
8. [Testing](#testing)

---

## Supported Providers

### MTN Mobile Money (MTN MoMo)

- **Region**: Cameroon, Ghana, Uganda, Côte d'Ivoire, etc.
- **Required Parameters**: Phone number, amount, API credentials
- **Transaction Flow**: USSD-based or App-based verification
- **Settlement**: Real-time or batch processing

### Airtel Money

- **Region**: Africa-wide coverage
- **Required Parameters**: Phone number, amount, business code
- **Transaction Flow**: USSD-based verification
- **Settlement**: Real-time

---

## Setup Instructions

### 1. MTN Mobile Money Setup

#### Prerequisites

- MTN Developer Account
- Sandbox/Production API credentials
- Active MTN subscription

#### Configuration Steps

1. **Create MTN Developer Account**
   - Visit: https://developer.mtn.cm
   - Register and verify your email
   - Create an application in the dashboard

2. **Get Credentials**
   - API Key: Used for API authentication
   - Primary Key: Used for request signing
   - User ID: Your unique identifier
   - API User: Service account username

3. **Update Environment Variables**

   ```env
   MTN_MOMO_BASE_URL=https://api.sandbox.mtn.com.gh/mocserver/3.0.0
   MTN_MOMO_API_KEY=your_api_key_here
   MTN_MOMO_PRIMARY_KEY=your_primary_key_here
   MTN_MOMO_USER_ID=your_user_id_here
   MTN_MOMO_API_USER=your_api_user_here
   MTN_TARGET_ENV=sandbox  # Use 'production' for live
   ```

4. **Request Collections URL**
   - Enable "Collection" product in your app
   - Note the Base URL for your region

### 2. Airtel Money Setup

#### Prerequisites

- Airtel Business Account
- Merchant/Business Code
- OAuth credentials

#### Configuration Steps

1. **Create Airtel Business Account**
   - Visit: https://merchant.airtelbyafrika.com
   - Register your business
   - Complete KYC verification

2. **Get Credentials**
   - Client ID: OAuth client identifier
   - Client Secret: OAuth client secret
   - Business Code: Your merchant code

3. **Update Environment Variables**

   ```env
   AIRTEL_MONEY_BASE_URL=https://openapiuat.airtel.africa/merchant/v1
   AIRTEL_MONEY_CLIENT_ID=your_client_id_here
   AIRTEL_MONEY_CLIENT_SECRET=your_client_secret_here
   AIRTEL_MONEY_BUSINESS_CODE=your_business_code_here
   ```

4. **Enable API Permissions**
   - Request Collection API access
   - Configure IP whitelist (optional)

---

## API Endpoints

### 1. Initiate Payment

**Endpoint**: `POST /api/payments/initiate`

**Headers**:

```
Authorization: Bearer {access_token}
Content-Type: application/json
Idempotency-Key: {unique_request_id}  # Optional but recommended
```

**Request Body**:

```json
{
  "phoneNumber": "+256772123546",
  "amount": 5000,
  "currency": "XAF",
  "provider": "MTN_MOMO",
  "groupId": "507f1f77bcf86cd799439011",
  "contributionId": "507f1f77bcf86cd799439012",
  "description": "Community Savings Contribution"
}
```

**Response** (201 Created):

```json
{
  "message": "Payment initiated successfully",
  "transactionId": "TXN-1234567890-abc123def456",
  "status": "PENDING",
  "provider": "MTN_MOMO",
  "amount": 5000,
  "currency": "XAF",
  "phoneNumber": "+256****3546",
  "providerReference": "abc123xyz789"
}
```

**Error Responses**:

```json
{
  "message": "Invalid phone number format",
  "errors": [{ "param": "phoneNumber", "msg": "..." }]
}
```

### 2. Check Payment Status

**Endpoint**: `GET /api/payments/status/{transactionId}`

**Headers**:

```
Authorization: Bearer {access_token}
```

**Response** (200 OK):

```json
{
  "transactionId": "TXN-1234567890-abc123def456",
  "status": "COMPLETED",
  "amount": 5000,
  "currency": "XAF",
  "provider": "MTN_MOMO",
  "phoneNumber": "+237****6789",
  "initiatedAt": "2024-01-15T10:30:00Z",
  "confirmedAt": "2024-01-15T10:35:00Z",
  "providerReference": "abc123xyz789"
}
```

**Possible Status Values**:

- `PENDING` - Payment initiated, awaiting provider confirmation
- `PROCESSING` - Payment being processed
- `COMPLETED` - Payment successful
- `FAILED` - Payment failed
- `CANCELLED` - Payment cancelled by user
- `REFUNDED` - Payment refunded

### 3. Request Refund

**Endpoint**: `POST /api/payments/{transactionId}/refund`

**Headers**:

```
Authorization: Bearer {access_token}
Content-Type: application/json
```

**Request Body**:

```json
{
  "refundAmount": 5000,
  "refundReason": "User requested refund due to duplicate payment"
}
```

**Response** (200 OK):

```json
{
  "message": "Refund processed successfully",
  "transactionId": "TXN-1234567890-abc123def456",
  "refundId": "REF-1234567890-xyz123abc456",
  "refundAmount": 5000,
  "status": "REFUNDED",
  "refundReason": "User requested refund due to duplicate payment"
}
```

### 4. Get Payment History

**Endpoint**: `GET /api/payments?status=COMPLETED&provider=MTN_MOMO&skip=0&limit=20`

**Headers**:

```
Authorization: Bearer {access_token}
```

**Response** (200 OK):

```json
{
  "message": "Payment history retrieved",
  "data": [
    {
      "transactionId": "TXN-...",
      "amount": 5000,
      "currency": "XAF",
      "provider": "MTN_MOMO",
      "status": "COMPLETED",
      "initiatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 15,
    "skip": 0,
    "limit": 20,
    "hasMore": false
  }
}
```

### 5. Get Payment Details

**Endpoint**: `GET /api/payments/{transactionId}`

**Headers**:

```
Authorization: Bearer {access_token}
```

**Response** (200 OK):

```json
{
  "message": "Payment details retrieved",
  "data": {
    "transactionId": "TXN-1234567890-abc123def456",
    "userId": "507f1f77bcf86cd799439013",
    "groupId": "507f1f77bcf86cd799439011",
    "amount": 5000,
    "currency": "XAF",
    "provider": "MTN_MOMO",
    "status": "COMPLETED",
    "phoneNumber": "+237****6789",
    "initiatedAt": "2024-01-15T10:30:00Z",
    "confirmedAt": "2024-01-15T10:35:00Z",
    "metadata": {
      "description": "Community Savings Contribution",
      "deviceId": "device-abc123"
    }
  }
}
```

---

## Frontend Integration

### Using MobileMoneyPayment Component

```jsx
import MobileMoneyPayment from './components/MobileMoneyPayment';

function ContributionForm() {
  const handlePaymentSuccess = (paymentData) => {
    console.log('Payment successful:', paymentData);
    // Update contribution status
    // Update user balance
    // Show success message
  };

  return (
    <MobileMoneyPayment
      amount={5000}
      currency="XAF"
      groupId="507f1f77bcf86cd799439011"
      contributionId="507f1f77bcf86cd799439012"
      onPaymentSuccess={handlePaymentSuccess}
    />
  );
}
```

### Component Props

- `amount` (number, required): Payment amount
- `currency` (string, optional): Currency code (default: XAF)
- `groupId` (string, optional): Associated group ID
- `contributionId` (string, optional): Associated contribution ID
- `onPaymentSuccess` (function, optional): Callback on successful payment
- `onPaymentCancel` (function, optional): Callback on payment cancellation

### Manual API Integration

```javascript
// Initialize payment
const response = await api.post('/api/payments/initiate', {
  phoneNumber: '+237123456789',
  amount: 5000,
  currency: 'XAF',
  provider: 'MTN_MOMO',
});

const { transactionId } = response.data;

// Poll for status
const statusResponse = await api.get(`/api/payments/status/${transactionId}`);
```

---

## Security Best Practices

### 1. Environment Variables

- Never commit `.env` files to version control
- Use `.env.example` for documentation
- Rotate secrets regularly
- Use different credentials for sandbox vs production

### 2. API Security

- All payment endpoints require authentication
- Use HTTPS only in production
- Implement rate limiting (default: 100 requests/15min)
- Validate all input parameters

### 3. Phone Number Security

- Phone numbers are masked in responses: +237\*\*\*\*6789
- Raw phone numbers stored securely in database
- Encryption layer recommended for sensitive data

### 4. Transaction Security

- Implement idempotency keys to prevent duplicate processing
- Use transaction IDs for audit trails
- Log all payment events for compliance
- Implement fraud detection

### 5. Data Protection

- PCI DSS compliance for payment data
- GDPR compliance for user data
- Regular security audits
- Penetration testing

---

## Error Handling

### Common Error Codes

| Code | Message                     | Solution                       |
| ---- | --------------------------- | ------------------------------ |
| 400  | Invalid phone number format | Validate phone in E.164 format |
| 422  | Validation failed           | Check all required fields      |
| 409  | Duplicate payment request   | Use idempotency key or wait    |
| 401  | Unauthorized                | Provide valid access token     |
| 403  | Forbidden                   | Check user permissions         |
| 500  | Server error                | Retry or contact support       |

### Retry Logic

```javascript
async function retryPaymentCheck(transactionId, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await api.get(`/api/payments/status/${transactionId}`);
      if (response.data.status === 'COMPLETED') {
        return response.data;
      }
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(5000); // Wait 5 seconds before retry
    }
  }
}
```

---

## Transaction Flow

### MTN MoMo Payment Flow

```
1. User initiates payment via frontend
   ↓
2. Frontend calls POST /api/payments/initiate
   ↓
3. Backend creates Payment record (status: PENDING)
   ↓
4. Backend calls MTN API with USSD request
   ↓
5. User receives USSD prompt on phone
   ↓
6. User enters PIN and confirms payment
   ↓
7. MTN confirms transaction
   ↓
8. Frontend polls GET /api/payments/status
   ↓
9. Backend checks MTN API for status
   ↓
10. Payment record updated (status: COMPLETED)
   ↓
11. Contribution record updated
   ↓
12. User sees success message
```

### Webhook Integration (Future)

For production, implement webhooks instead of polling:

```javascript
// Backend webhook endpoint
app.post('/api/payments/webhook/mtn', (req, res) => {
  const { transactionId, status, financialId } = req.body;

  // Verify webhook signature
  if (!verifySignature(req)) {
    return res.status(401).json({ message: 'Invalid signature' });
  }

  // Update payment status
  Payment.findOneAndUpdate({ transactionId }, { status, providerReference: financialId });

  res.status(200).json({ message: 'Webhook received' });
});
```

---

## Testing

### Sandbox Testing

1. **Test Phone Numbers**

   ```
   MTN MoMo: +237650000000 - +237669999999
   Airtel: +237650000000 - +237669999999
   ```

2. **Test Amounts**
   - Minimum: 100 (0.01 in major currency)
   - Maximum: 500,000

3. **Test Scenarios**
   - Successful payment
   - Insufficient funds
   - Invalid phone number
   - Timeout/network error
   - Duplicate request

### Postman Collection

Available at: `postman/Mobile-Money-Tests.postman_collection.json`

**Setup**:

1. Import collection into Postman
2. Set environment variables:
   - `API_BASE_URL`: http://localhost:5000
   - `ACCESS_TOKEN`: Your JWT token
3. Run tests

### Unit Testing

```javascript
// tests/payment.test.js
describe('Payment API', () => {
  it('should initiate MTN payment', async () => {
    const response = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phoneNumber: '+256772123546',
        amount: 5000,
        currency: 'XAF',
        provider: 'MTN_MOMO',
      });

    expect(response.status).toBe(201);
    expect(response.body.transactionId).toBeDefined();
  });
});
```

---

## Production Deployment Checklist

- [ ] Update `.env` with production credentials
- [ ] Switch from sandbox to production URLs
- [ ] Enable HTTPS enforcement
- [ ] Set up webhook endpoints
- [ ] Configure SSL certificates
- [ ] Enable rate limiting
- [ ] Set up monitoring and alerts
- [ ] Test all payment scenarios
- [ ] Configure backup providers
- [ ] Set up transaction logging
- [ ] Enable fraud detection
- [ ] Schedule regular audits

---

## Support & Troubleshooting

### MTN Issues

- **Invalid API Key**: Check MTN Developer Console credentials
- **Request Timeout**: Increase `PAYMENT_TIMEOUT` in `.env`
- **Network Error**: Check firewall/proxy settings

### Airtel Issues

- **Authentication Failed**: Verify OAuth credentials
- **Invalid Business Code**: Check merchant setup
- **Token Expiration**: Tokens auto-refresh, no action needed

### General Issues

- Check application logs: `logs/combined.log`
- Enable debug mode: `DEBUG=true`
- Review transaction details in database
- Contact provider support with transaction ID

---

## Resources

- [MTN Developer Docs](https://developer.mtn.cm)
- [Airtel API Docs](https://merchant.airtelbyafrika.com)
- [Community Savings App Docs](../README.md)
- [Security Best Practices](./SECURITY.md)

---

**Last Updated**: February 2, 2026  
**Version**: 1.0.0  
**Maintained By**: Community Savings Dev Team
