# Security

This file is the current high-level security policy companion to the platform truth file. It does not constitute a penetration-test, certification or regulatory approval.

## Baseline

Authentication uses short-lived access tokens held in memory and refresh tokens in protected HttpOnly cookies. Authorization uses explicit permissions and tenant isolation. Sensitive operations require maker-checker controls where configured.

Secrets, passwords, access/refresh tokens and unnecessary PII must not be logged. Webhook endpoints require verification and replay-safe handling.

Security scans remain a required CI gate and are not reported as passed unless their tooling actually executes.

## 2026-09-22 control-plane security additions

The control-plane now includes:

- granular consent scoped to subject, recipient, purpose, data categories and validity;
- action-based API permission checks independent of screen visibility;
- capital-data sharing with four-eyes approval (maker cannot approve their own request);
- provenance records containing source, transformation, confidence, collection time and consent reference;
- tenant-scoped support/incident records linked to financial evidence without allowing support workflows to mutate ledger truth;
- append-only, hash-chained audit records for control-plane evidence.

These controls do not replace jurisdiction-specific legal, privacy, AML/CFT, provider, contractual or penetration-testing requirements.
