---

# ✅ 2. WALLET_LEDGER.md (CRITICAL CORE SYSTEM)

📂 `/docs/04-fintech-core/WALLET_LEDGER.md`

```markdown
# Wallet & Ledger System

## 1. Objective

Provide:
- Financial integrity
- Immutable audit trail
- Real-time balance computation

---

## 2. Double-Entry Accounting Model

Each transaction MUST produce:

- 1 Debit Entry
- 1 Credit Entry

Example:
Deposit 10,000 UGX

| Account        | Type  | Amount |
|---------------|------|--------|
| Cash Account  | Debit | 10,000 |
| User Wallet   | Credit| 10,000 |

---

## 3. Ledger Schema

```json
{
  "_id": "ObjectId",
  "transactionId": "...",
  "tenantId": "...",
  "debitAccount": "...",
  "creditAccount": "...",
  "amount": 10000,
  "currency": "UGX",
  "status": "posted",
  "createdAt": "ISODate"
}