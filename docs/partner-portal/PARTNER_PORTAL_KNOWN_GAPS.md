# Partner Portal Known Gaps — 8 November 2026

1. Tenant-scoped partner customer lookup and message-history APIs are not mounted.
2. Partner-safe account settings inspection is not available.
3. Provider-specific message pathway monitoring is not integrated; status remains UNKNOWN.
4. Full case assignment, conversation replies, internal notes, attachment validation/scanning and SLA notifications are not exposed in the portal.
5. Case mutation and canonical audit-chain persistence are sequential, not atomically committed.
6. No frontend build, browser E2E or accessibility audit was run because the supported Node/npm runtime and installed dependencies were unavailable.
7. Multi-tenant live API security tests and external penetration testing remain outstanding.
8. TITechChats remains disconnected from the canonical backend route registry; legacy chat modules contain CommonJS patterns under the ESM backend package and the frontend's prior chat page contains unresolved imports. It was not mounted using a fail-open or fake service.
9. Offline browser synchronization remains blocked: the existing backend requires `X-Device-ID`, `X-Device-Fingerprint` and `X-Device-Secret`; the examined frontend sync client only supplies device ID/fingerprint. The hook is not mounted in the canonical provider tree, a verified device-registration/trust route is not established, and the service worker remains behind `VITE_ENABLE_SW`.
10. Meetings is now registered at `/meetings` in the canonical frontend router and the existing backend route is already mounted. Actual meeting workflows, durable audit coupling, video provider sandbox joining and offline minutes synchronization have not been browser/runtime verified.
11. Full enterprise production readiness still depends on wider platform gates: supported runtime and bootstrap/health; ledger replay; provider failure/settlement evidence; tenant permissions; security/recovery; regulatory/partner verification; commercial pilot evidence.

This gap list reflects the supplied archive and the checks executed in this environment. It is not a statement about later remote commits or deployment state.
