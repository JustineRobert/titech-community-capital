# Ledger

The ledger is the financial source of truth. Projection caches/balances must be rebuildable from ledger state. Posting, reversal, correction and adjustment are compensating operations rather than destructive edits.

The repository contains multiple historical ledger modules; RC-1 treats `backend/modules/finance/ledger/` as the primary consolidation target while provider bridges remain translation layers. Runtime authority must be confirmed through import/call-site tests before deprecating older modules.
