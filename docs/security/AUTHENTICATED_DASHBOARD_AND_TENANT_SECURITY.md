# Authenticated Dashboard and Tenant Security

**Assessment date:** 31 October 2026. **Status:** implementation paths found; end-to-end authorization not yet proven.

`frontend/src/routes/AppRoutes.jsx` imports `useAuth` from `frontend/src/context/AuthContext.jsx`. The frontend also has `frontend/src/security/rbacPolicy.js`, `frontend/src/components/ProtectedRoute.jsx`, and `frontend/src/layouts/AdminLayout.jsx`. Those UI policies are not a substitute for backend enforcement.

Required release evidence:

1. For each role, test both permitted and denied routes and API operations against authoritative user/session state.
2. Attempt cross-tenant retrieval, modification, report export, invitation creation, and financial approval by swapping tenant identifiers.
3. Revoke/suspend an account while a browser tab and realtime connection are active; prove access is rejected after server-side invalidation.
4. Confirm socket handshake, tenant-room membership and event delivery are authorized server-side if sockets are enabled.
5. Confirm route errors distinguish unauthenticated, permission-denied, tenant-unavailable and service-unavailable states without leaking restricted data.
6. Test tenant context clearing on account switch and logout.

Do not declare tenant isolation secure from visible navigation, a role string or a static RBAC gate alone.
