# Security

This file is the current high-level security policy companion to the platform truth file. It does not constitute a penetration-test, certification or regulatory approval.

## Baseline

Authentication uses short-lived access tokens held in memory and refresh tokens in protected HttpOnly cookies. Authorization uses explicit permissions and tenant isolation. Sensitive operations require maker-checker controls where configured.

Secrets, passwords, access/refresh tokens and unnecessary PII must not be logged. Webhook endpoints require verification and replay-safe handling.

Security scans remain a required CI gate and are not reported as passed unless their tooling actually executes.
