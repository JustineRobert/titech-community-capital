# TITech Community Capital — API Contract

## Canonical response envelope

Success:

```json
{ "success": true, "data": {}, "meta": {}, "requestId": "..." }
```

Failure:

```json
{ "success": false, "error": { "code": "MACHINE_READABLE_CODE", "message": "Safe message" }, "requestId": "...", "correlationId": "..." }
```

## Control-plane API surface

The existing `/api/v1` versioning is preserved.

| Method | Route | Purpose | Required action permission |
|---|---|---|---|
| GET | `/api/v1/consents` | List tenant-scoped consent records | `consent:read` |
| POST | `/api/v1/consents` | Grant a purpose-bound consent | `consent:grant` |
| GET | `/api/v1/consents/:id` | Read one consent | `consent:read` |
| POST | `/api/v1/consents/:id/withdraw` | Withdraw active consent | `consent:withdraw` |
| GET | `/api/v1/capital/share-requests` | Review sharing requests | `capital:share:read` |
| POST | `/api/v1/capital/share-requests` | Request permissioned capital-data sharing | `capital:share:create` |
| POST | `/api/v1/capital/share-requests/:id/approve` | Four-eyes approval | `capital:share:approve` |
| POST | `/api/v1/capital/share-requests/:id/revoke` | Revoke approved/shared request | `capital:share:revoke` |
| GET | `/api/v1/operations/cases` | List support/incident cases | `support:case:read` |
| POST | `/api/v1/operations/cases` | Create operational case | `support:case:create` |
| POST | `/api/v1/operations/cases/:id/transition` | Transition case + evidence | `support:case:transition` |

## Financial requirements

Financially material commands must use the repository's canonical authentication, tenant authorization, validation, idempotency and financial transaction boundaries. The following facts remain distinct:

`REQUESTED ≠ ACCEPTED ≠ SUCCESSFUL ≠ SETTLED ≠ RECONCILED`

## Capital data rules

A capital share request is valid only when a matching active consent exists for:

- subject;
- recipient;
- purpose;
- requested data categories;
- current validity window.

The capital share service does not create loans, approve funding or move money.
