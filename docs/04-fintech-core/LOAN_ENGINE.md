# Loan Engine System

## 1. Objective

Deliver:
- Loan approval under 5 minutes
- Automated decision making
- Risk-controlled lending

---

## 2. Loan Lifecycle

1. Application
2. Risk Scoring
3. Decision (auto)
4. Disbursement
5. Repayment
6. Default handling

---

## 3. Loan Schema

```json
{
  "_id": "...",
  "tenantId": "...",
  "userId": "...",
  "amount": 500000,
  "interestRate": 12,
  "status": "approved",
  "schedule": []
}