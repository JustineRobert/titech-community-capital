# TITech Community Capital

# Security Controls

**Source contract status:** PASS  
**External security-assessment status:** UNVERIFIED

Implemented source controls include:

- memory-only access tokens;
- Secure/HttpOnly refresh-cookie architecture;
- redux-persist stripping of auth credentials;
- Socket.IO use of the canonical in-memory token accessor;
- fail-closed MTN webhook configuration;
- constant-time webhook signature comparison;
- raw-body-aware callback verification;
- bounded replay windows.

Required external assessment: SAST, dependency scan, secret scan, container scan, IaC scan, DAST, authorization/tenant-isolation testing and webhook replay/fuzz testing.
