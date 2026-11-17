# Integration evidence

## Source-level integration completed

- Protected frontend route registry now contains canonical member, loan and savings detail route definitions.
- The member directory and profile bind to the `Member` domain model via `/api/v1/members` rather than legacy administrative user listing.
- Backend route registry mounts member, loan and savings read routers after existing authentication and trusted tenant middleware.
- `MEMBER_VIEW`, `LOAN_VIEW`, and `SAVINGS_VIEW` are explicit policy permissions.
- Loan search resolves matching Member records under the trusted `req.tenant._id`; loan list supports bounded page/limit/status/member/search filters.
- Savings account records and savings-linked Transaction records are queried by trusted tenant ObjectId.
- The Savings DTO explicitly labels aggregate snapshot as not ledger authority.
- A 10-test Node source-contract suite passed and confirms protected route registration, API mounts, RBAC and money helper behavior.

## Integration not proven

No Express server was booted and no request was made against actual MongoDB or Redis. No authentic data fixture was read. Therefore API response serialization, live HTTP status behavior, Mongo populate behavior, production proxy path/rewrite behavior and cross-tenant runtime denials remain unverified. Member/loan/savings APIs are read surfaces only; they do not implement customer lifecycle mutations.
