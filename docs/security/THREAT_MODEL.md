# Threat Model

## Scope
The scope covers the TITech Community Capital platform as an operational fintech and community-finance system handling members, groups, contributions, wallets, KYC/AML, transactions, ledgers, balances, provider callbacks, reporting, audit, and institution administration.

## Assets
- Money and balances
- Ledger integrity and financial transactions
- KYC and AML records
- Provider credentials and callback secrets
- Authentication tokens and identities
- Group and member data
- Audit trails and logs
- Reporting and reconciliation data

## Actors
- Anonymous attacker
- Authenticated user
- Malicious group administrator
- Compromised institution administrator
- Compromised backend service
- External payment attacker
- Insider

## Threats
- Account takeover
- Privilege escalation
- IDOR and tenant escape
- Transaction replay
- Webhook forgery and replay
- Payment manipulation
- Balance or ledger manipulation
- KYC bypass
- AML bypass
- Credential theft or secret leakage
- API abuse and DoS
- Data exfiltration
- Insider abuse

## Controls
- Authentication and RBAC enforcement
- Tenant scoping on all queries and writes
- Idempotency keys for financial operations
- Callback signature validation and replay detection
- Authorization checks for every sensitive endpoint
- Immutable audit events and correlation IDs
- Deterministic reconciliation mismatch detection
- Secret rotation and environment isolation

## Status
This threat model is a baseline architecture and security control statement. It does not claim a completed external security assessment or regulatory approval.
