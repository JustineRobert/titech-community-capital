# Partner Portal Security and Privacy

## Implemented safeguards

- Existing TITech access-token and refresh-session architecture is reused; no separate portal login or token store is introduced.
- Frontend visibility checks are supplementary. Backend `requirePermission` and canonical auth/tenant middleware remain authoritative.
- Case input requires bounded type, subject, description, priority, transition note and evidence references.
- Technical diagnostics use an allowlist (application version, module, route, timestamp, request ID, correlation ID, error code and error name). Query/hash routes and unknown fields are discarded.
- Credential-like values are redacted from support text, including bearer credentials, token/password/secret/API-key/OTP/PIN/cookie assignments and `Set-Cookie` values.
- Linked case references use a fixed allowlist. Arbitrary assignment and browser-provided actor/tenant identifiers are ignored.
- Audit metadata avoids raw case descriptions and customer contents. Canonical audit-chain entries are requested for case create/view/list/transition.
- If audit persistence fails after the case operation commits, the API surfaces the condition and committed resource reference rather than silently reporting full success.
- Help preference persistence is non-sensitive and scoped by a stable authenticated user identifier; no authentication credential is stored there.

## Limitations requiring closure

- Case mutation and canonical audit-chain persistence are not transactionally atomic. A durable transactional outbox or session-aware audit writer with appropriate chain concurrency handling is required before high-assurance production use.
- Case embedded event history is not a replacement for the canonical tamper-evident audit chain.
- No partner customer/account APIs are available; sensitive account data is not displayed.
- Attachment upload and malware scanning are not implemented in this portal.
- External security assessment, abuse/rate-limit verification, browser E2E, backup/restore and production configuration checks were not performed in this execution.
- No evidence of third-party insurer authority, insurance distribution permission, underwriting authority, telecom provider approval or regulatory sign-off is created by this implementation.

`productionApproved` remains `false`.
