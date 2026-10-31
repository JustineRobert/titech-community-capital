# Legal Acceptance Integration Readiness

**Assessment date:** 31 October 2026. **Status:** BLOCKED; production registration must remain closed.

`backend/controllers/authController.js` has a fail-closed production gate. The source checks `canonicalLegalContent.status === 'approved'`, a verified acceptance integration status and `productionRegistrationEnabled === true`, but `CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY` is hard-coded `false`. This must not be flipped merely to enable registration.

The canonical `register` handler still does not read and validate `acceptedTerms`, `acknowledgedPrivacy`, `termsVersion` and `privacyVersion`, and does not persist separate immutable acceptance records as part of account creation. Thus the required legal acceptance workflow is not proven by the current handler.

## Required close-out

1. Authorized legal owner approves the actual Terms of Service and Privacy Policy publication versions.
2. Backend registration validates authoritative server-published version/hash rather than trusting browser version strings.
3. Terms acceptance and privacy-notice acknowledgement persist as separate records with user, tenant, document type/version/hash, action and server timestamp; collect extra request metadata only where justified by approved policy.
4. The user and invitation usage now commit in one MongoDB transaction. Extend that same transaction to include both acceptance records and the verification dispatch/outbox insertion before accepting registration as end-to-end complete.
5. A transaction failure leaves no partial user, acceptance or invitation-count mutation.
6. Integration tests demonstrate unpublished, withdrawn, mismatched-version, acceptance-persistence-failure and transaction-unavailable denial.
7. Independent authorized legal review and documentary approval are attached to the release evidence.

**Release rule:** `productionRegistrationEnabled` and all canonical integration gates remain false until code evidence and external legal approval have both been reviewed. Repository settings cannot establish legal approval.
