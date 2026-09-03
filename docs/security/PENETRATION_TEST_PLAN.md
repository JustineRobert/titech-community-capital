# Penetration Test Plan

## Purpose
This document defines the controlled security validation plan for TITech Community Capital. It is a preparation and evidence plan; it is not a statement that an external penetration test has passed.

## Status
External penetration test: PENDING

## Scope
- Backend APIs
- Payment callbacks and webhooks
- Authentication and authorization boundaries
- Contribution and wallet flows
- Ledger and balance logic
- Group, tenant, and institution isolation
- Audit and reporting endpoints

## Environments
- Local development
- CI sandbox
- Staging or isolated acceptance environment

## Test Accounts
- Anonymous user
- Standard member
- Group admin
- Institution admin
- Platform admin

## Attack Categories
- Authentication bypass
- Authorization escalation
- Tenant isolation bypass
- IDOR and parameter tampering
- Webhook signature and replay attacks
- Payment manipulation and duplicate callback processing
- Audit tampering and log integrity review
- Secret leakage and configuration drift

## Evidence Requirements
- Test objective
- Preconditions
- Steps
- Expected result
- Actual result
- Remediation owner
- Status

## Remediation Process
1. Triage severity
2. Create fix or compensating control
3. Re-run targeted validation
4. Update evidence registry
5. Formal closure only after verification
