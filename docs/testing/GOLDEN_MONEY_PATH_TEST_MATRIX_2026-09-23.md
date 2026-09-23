# Golden Money Path Test Matrix — 2026-09-23

| Scenario | Reference proof | Existing integration suite | External staging |
|---|---:|---:|---:|
| Normal success | PASS | Present | Pending |
| Duplicate initiation | PASS | Present | Pending |
| Duplicate callback | PASS | Present | Pending |
| Provider timeout | PASS | Present | Pending |
| Server restart/recovery | PASS (state harness) | Partial/infrastructure-dependent | Pending |
| Concurrent operations | Contracted | Present | Pending |
| Wrong tenant | PASS | Present | Pending |
| Wrong currency | PASS | Present/partial | Pending |
| Reversal | PASS | Present | Pending |
| Reconciliation mismatch | PASS | Present | Pending |
| Offline replay | PASS | Existing offline architecture | Pending |
| Out-of-order callback | PASS | Present/partial | Pending |
| Ledger balancing | PASS | Present | Pending |
| Receipt gating | PASS | Existing receipt tests | Pending |
| Audit trail | PASS | Existing audit infrastructure | Pending |

Reference proof command:

```bash
npm run test:golden:proof
```
