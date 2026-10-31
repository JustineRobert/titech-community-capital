# Email Verification Readiness

**Assessment date:** 31 October 2026. **Status:** PARTIALLY IMPLEMENTED; operational evidence incomplete.

## Source evidence

- `backend/models/User.js` provides secure random verification-token generation, stores a token hash and expiry, has token-validation and token-clearing methods, and excludes token material from selected serialized outputs.
- `backend/controllers/emailController.js` generates a token, saves its hash and expiry, creates a verification URL, sends through the current email service and clears the newly issued token if delivery fails.
- `backend/routes/email.js` exposes `/verify` with a rate limiter and input validation; it also has a resend-verification route.
- `backend/controllers/authController.js` rejects an explicitly unverified account with `EMAIL_VERIFICATION_REQUIRED`.
- `frontend/src/pages/VerifyEmail.jsx` provides a token-entry/verification interface and a public resend-request form with generic account-enumeration-resistant feedback.
- `frontend/src/context/AuthContext.jsx` now returns an explicit registration status and distinguishes a verification request accepted by the endpoint from an unconfirmed request. It does not open a session even if a registration response unexpectedly includes a token; the API client no longer persists tokens or tenant context from registration.
- The registration page navigates to `/verify-email` and carries the address in router state rather than appending it to the URL. Users may enter the address again after a reload.

## Gaps and acceptance tests

The account creation and email dispatch shown here are separate requests rather than an email outbox event atomically committed with user creation. The current delivery path should not be described as a proven transactional outbox. Confirm provider acceptance versus recipient delivery carefully.

Required: test-only email sink isolation, token never logged, token hashing, expiry, one-time consumption, replay, cooldown/rate limits, provider failure recovery, resend after failed delivery, account-enumeration policy, browser pending/error/retry states, restart recovery, and actual configured provider delivery. The new UI path has only been syntax-parsed; browser interaction was not run. Do not issue an authenticated session before verification. No production email-provider approval is asserted by this document.
