# Consent and Data Sharing Model

## Principles

1. Consent is not a substitute for every other possible lawful basis.
2. Every data-sharing purpose is explicit and versioned.
3. Data sharing is minimized to the declared purpose.
4. Withdrawal must be recorded and propagated where legally and technically applicable.
5. Sensitive exports require authorization and audit evidence.
6. Provider payloads are minimized and retained only as needed for financial/control evidence.

## Consent record

```text
consentId
subjectId
tenantId
purposeCode
partnerId
dataCategories
noticeVersion
lawfulBasis
status
capturedAt
capturedBy
sourceChannel
expiresAt (if applicable)
withdrawnAt (nullable)
withdrawnBy (nullable)
correlationId
``` 

## Sharing decision flow

```text
Request
→ identify subject + tenant
→ identify purpose
→ evaluate lawful basis / consent requirement
→ minimize fields
→ validate recipient authorization
→ record decision
→ transfer securely
→ audit
→ support withdrawal / correction / retention workflow
```

No data export is considered compliant solely because a UI button exists. Evidence must show the authorization, purpose, recipient, data categories and audit trail.
