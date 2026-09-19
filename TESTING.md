# Testing

The required pyramid is unit → integration → API/contract → end-to-end → security/load/recovery.

Critical financial invariants include balanced journals, ledger/projection equality, one idempotency key/one financial effect, safe reversal, duplicate callback safety, tenant isolation, currency integrity and authoritative receipt state.

The remediation package proves syntax parsing and selected structural checks only. Full Jest/Vitest/Newman, load, security, restore and provider tests remain to be executed in the correct Node 24.15.x environment.
