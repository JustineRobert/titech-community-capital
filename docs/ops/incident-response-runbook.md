# Incident Response Runbook

## Severity

- **SEV-1:** financial integrity, unauthorized movement, systemic payment outage, severe data incident.
- **SEV-2:** material payment/reconciliation degradation with contained financial risk.
- **SEV-3:** localized operational issue.
- **SEV-4:** cosmetic/non-critical issue.

## Response

```text
Detect
→ triage
→ contain
→ protect financial state
→ communicate
→ investigate
→ recover
→ reconcile
→ evidence
→ corrective action
```

## Mandatory SEV-1 evidence

- incident ID;
- incident commander;
- affected tenants;
- correlation IDs;
- provider references;
- before/after financial state;
- security/privacy assessment;
- reconciliation results;
- communications log;
- root cause;
- corrective action;
- approval to resume.
