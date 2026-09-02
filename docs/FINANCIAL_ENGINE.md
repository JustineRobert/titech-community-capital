# Financial Engine

Implements double-entry accounting for TITech Community Capital.

## Features
- Debit/Credit enforcement
- Atomic MongoDB transactions
- Idempotency via unique reference
- Audit trail via JournalEntries
- Tenant isolation

## API
POST /api/finance/transaction
{
  "reference": "TX12345",
  "description": "Savings deposit",
  "entries": [
    { "accountId": "...", "amount": 10000, "direction": "debit" },
    { "accountId": "...", "amount": 10000, "direction": "credit" }
  ]
}
