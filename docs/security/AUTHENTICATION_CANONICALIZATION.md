# Authentication Canonicalization Inventory

**Assessment date:** 31 October 2026. **Status:** canonical paths identified; legacy cleanup deferred pending import/runtime evidence.

| File | Observed role | Disposition |
|---|---|---|
| `frontend/src/context/AuthContext.jsx` | Frontend auth state and session lifecycle; imported in `AppRoutes.jsx` | Canonical observed provider. |
| `frontend/src/context/AuthProvider.jsx` | Separate legacy/similar provider path named in the request baseline | Do not delete until repository-wide runtime/test dependency scan proves unused. |
| `frontend/src/services/api.js` | Frontend API client | Retain; verify interceptors and refresh behavior in browser tests. |
| `backend/routes/index.js` | Canonical route registry; imports `./auth.js` | Retain. |
| `backend/routes/auth.js` | Auth routes under `/api/auth` | Canonical observed route module. |
| `backend/controllers/authController.js` | Register/login/refresh/logout/logout-all/session handlers | Canonical observed controller; invitation usage + user creation transaction implemented at source level, integration proof outstanding. |
| `backend/modules/auth/routes/auth.routes.js` | Alternative module path named in the assessment | Runtime/route-mount status must be proven before removal. |
| `backend/models/User.js` | User, password and verification-token behavior | Retain and migrate compatibly. |
| `backend/models/RefreshToken.js` | Persistent refresh/session records and lifecycle | Retain; no duplicate model introduced. |
| `backend/models/TenantInvitation.js` | Invitation lifecycle | Retain; invitation consumption atomicity remains P0. |
| `backend/controllers/emailController.js` + `backend/routes/email.js` | Email verification, resend and recovery handlers/routes | Retain and test through actual provider boundary. |

No competing V2 architecture was created. Source-reference checks for this archive did not find runtime/test/script imports of the root `backend/app.cjs` or `backend/PRODUCTION_IMPLEMENTATION_v2.js`; these exact current files were moved, not deleted, into `.titech-remediation/archive/2026-10-31-legacy-root-recovery/` so they are no longer ambiguous active-root entry points. Earlier archived copies were not overwritten. A full supported-runtime startup, build and CI dependency-graph run is still required before the files can be considered conclusively inactive.

The frontend registration transport also no longer stores a token or tenant from the registration response. Authentication remains an explicit login step after email verification. This change has source/syntax evidence, not browser integration proof.
