# Financial Integrity Report

| Control | Source finding | Result |
|---|---|---|
| Group is not the ledger | Group model documentation explicitly describes Group as a domain aggregate, not wallet/ledger/balance store | Preserved |
| Group balance authority | Group wallet controller rejects absent group-to-account mapping | Fail-closed |
| Contribution initiation | Group Details contains no Make Contribution control and states the workflow is disabled | Fail-closed |
| Canonical financial engine | Shared financial operation and transaction services exist | Available for integration; group flow not proven |
| Exact money | Education campaign policy validates integer minor units; broader financial layer has canonical money rules | Source present |
| Payment confirmation | No group-specific provider-to-ledger journey verified | Not verified |
| Duplicate provider events | No group-specific callback journey verified in this execution | Not verified |
| Receipts / reconciliation | No group-specific receipt + reconciliation journey proven | Not verified |
| Financial history retention | Group is not authoritative financial storage; membership history/audit retained in aggregate | Design guard maintained |

No live contribution posting, group ledger balance, provider outcome, receipt, reversal or reconciliation has been executed in this workspace. No financial acceptance criterion is marked E2E PASS.
