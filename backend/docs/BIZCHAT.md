# BizChat API

POST /api/bizchat/execute

Description:
- Execute a natural-language financial command (BizChat) which may perform actions such as sending money, checking balance, or approving loans. The endpoint parses the input, enforces RBAC, executes the requested service, and records an audit log.

Authentication:
- Requires `Authorization: Bearer <JWT>` header. The user must have appropriate permissions (e.g. `transactions:write` to send money).

Request Body:
- `text` (string, required): The natural language command, e.g. "Send 50000 UGX to John" or "Check my SACCO balance".

Response:
- 200: { success: true, data: <command result>, traceId }
- 400: invalid request
- 401: unauthorized
- 403: insufficient permissions
- 500: execution error

Notes:
- Commands are parsed by `services/bizchatService.js`. The service implements simple intents and integrates with `transactionService`, `walletService`, and `loanService` where applicable.
- All BizChat executions generate audit logs via `services/auditService.js` for compliance.
