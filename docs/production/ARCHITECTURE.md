# TITech Community Capital — Production Architecture

**Status:** IMPLEMENTED / STATICALLY VERIFIED; runtime/provider proof pending  
**As of:** 2026-09-27

TITech remains a provider-independent financial control plane. The implementation keeps the existing separation of authentication/tenancy, application services, financial transaction boundary, persistence repositories, provider adapters, settlement/reconciliation and audit.

## Canonical financial direction

`Controller → application/use case → FinancialTransactionService → financial repositories → MongoDB transaction`

External provider side effects are intentionally outside the MongoDB transaction and are expected to flow through outbox/provider-worker/callback mechanisms.

## Authority

See `docs/production-readiness/01-architecture-authority-map.md` and `reports/authority-map-audit.json`.

## Not claimed

This document does not prove live provider certification, production MongoDB/Redis behavior, security assessment completion, DR restore or regulatory approval.
