# Architecture

TITech Community Capital is organized as a modular community-finance infrastructure platform. The RC-1 architecture favors deterministic financial paths, explicit domain boundaries and controlled adapters over additional abstraction.

## Canonical layers

`route → controller → authorization/validation → service/domain orchestration → repository → model`

Financial mutations must flow through the authoritative financial transaction and ledger boundaries. Controllers do not directly mutate balances or post journals.

## Core domains

Tenant, Member, Group, Account, FinancialTransaction, Payment, Ledger/LedgerEntry, Balance, Reconciliation, Loan and AuditEvent.

## Integration boundaries

Payment providers translate provider-specific protocols; generic payment orchestration owns state transitions and idempotency. Redis is coordination/cache infrastructure, not financial truth.

## Known migration boundary

The backend retains a large ESM/CommonJS compatibility surface. Existing `createRequire()` bridges are preferred over blind conversion until runtime imports and tests establish safe ownership.
