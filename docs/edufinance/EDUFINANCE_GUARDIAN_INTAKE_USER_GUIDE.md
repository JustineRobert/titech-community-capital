# TITech EduFinance — Parent/Guardian Request Intake Guide

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Service:** TITech EduFinance — School Fees Financing Infrastructure Platform  
**Tagline:** Verified school fees. Responsible financing. Complete reconciliation.

## Availability

The intake workspace is hidden by default. To expose it in a development or approved partner test environment, set:

```dotenv
VITE_TITECH_EDUFINANCE_APPLICATIONS_ENABLED=true
```

The backend must independently be configured with `TITECH_EDUFINANCE_APPLICATIONS_ENABLED=true`. The frontend flag is public presentation configuration only; it is not an authorization control and cannot override the backend flag, authentication, tenant checks, applicant permissions or partner/legal approval requirements. The supplied frontend and backend environment templates both default to `false`.

## Submitting a request

1. Sign in through the normal TITech authentication flow.
2. Open **EduFinance** from the existing TITech navigation.
3. Select the education-financing purpose and relationship to the student beneficiary.
4. Enter the school tenant and school references supplied by the institution.
5. Enter the school-issued beneficiary reference. Do not enter the student's name, national identity number, date of birth, contact details or other unnecessary child information.
6. Enter the academic-year, term and invoice references, including the invoice version.
7. Enter the guardian authority and guardian-consent evidence references supplied through the approved process. Entering a reference does not verify it.
8. Enter invoice amount, amount already paid and requested amount as whole UGX shillings. The browser rejects fractional amounts and requests above the declared outstanding amount; the server independently repeats its authoritative validation.
9. Submit the request for partner review.
10. Use **My requests** to view records returned for the currently authenticated applicant and tenant.

## What submission means

A successful submission means only that TITech accepted an applicant-declared request into the gated intake workflow. It does not mean:

- that the school or its payment destination has been verified;
- that the invoice is authentic, current, outstanding or exclusively financed;
- that guardian authority or consent has been independently verified;
- that KYC/AML is complete;
- that affordability or underwriting has been performed;
- that a lender has approved or offered credit;
- that an agreement has been accepted;
- that funds have been disbursed or received by a school;
- that a loan account, repayment schedule or ledger entry exists.

The UI must display the verification statuses returned by the server. Do not represent pending/unknown states as successful or zero balances.

## Support and privacy

The parent or legally authorized guardian is the applicant. The student is the education beneficiary, not automatically the borrower. Do not use student information as a credit-scoring proxy or disclose the parent's financial circumstances to a school. Refugee and host-community applications remain subject to approved institutional partner onboarding, lawful identity/guardian evidence and the same tenant, privacy and safeguarding controls.

## Technical contract

- `GET /api/v1/edufinance/applications/me` — applicant-only list.
- `POST /api/v1/edufinance/applications` — application intake; sends `Idempotency-Key`.
- Shared frontend API client: `frontend/src/services/api.js`.
- Applicant API wrapper: `frontend/src/services/eduFinanceApi.js`.
- Form validation/mapping: `frontend/src/pages/edufinance/eduFinanceFormPolicy.mjs`.
- Backend validation: `backend/modules/edufinance/eduFinance.policy.js`.
- Backend feature flag and permission middleware: `backend/modules/edufinance/eduFinance.routes.js`.

Live credit, agreement, disbursement, repayment, collection, accounting, reconciliation and loan-closure functionality is not part of this intake UI. Keep those functions disabled until independently approved and implemented against canonical TITech services.
