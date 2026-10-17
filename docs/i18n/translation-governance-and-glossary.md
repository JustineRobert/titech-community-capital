# Translation Governance and Financial Terminology Glossary

## Status model

- **Source**: canonical English string maintained by product/engineering.
- **Draft**: translation prepared, not approved for production.
- **Linguistically reviewed**: reviewer verified grammar, register and local intelligibility; not sufficient alone for legal/financial disclosures.
- **Financial/compliance review required**: critical wording awaits domain review.
- **Approved for production**: the documented review required for that content has been completed and can be evidenced.
- **Deprecated**: no longer used by supported application versions; retain compatibility as necessary.

Never set a review status based on assumption, automated parity, machine translation or a passing build. Record reviewer identity, language competence/role, content version, date, scope and unresolved notes in the repository's agreed review record. Do not invent approver identities.

## Critical content requiring human review

Consent and data sharing; privacy and retention notices; contractual terms; fees, rates, interest, taxes and repayment obligations; payment/settlement/reversal status; security incidents; eligibility and risk notices; KYC/AML instructions; regulatory statements; account-closure and dispute processes. Until approved wording exists, follow product/legal policy rather than presenting a draft as legally approved or recording consent based on an unapproved translation.

## Glossary — source concepts

| English source term | Definition to preserve | Translator guidance |
|---|---|---|
| Savings contribution | An amount recorded against a member/group savings plan | Do not imply the platform itself holds customer deposits. |
| Pending payment | Request is not yet confirmed as completed | Must not be translated as successful or settled. |
| Provider accepted | Provider accepted/queued a request; end outcome can remain unknown | Do not equate request acceptance with settlement. |
| Settled | Authoritative settlement evidence confirms final movement under the provider contract | Preserve distinction from initiated/completed UI states. |
| Reconciliation | Comparison of authoritative internal records with external/provider/settlement evidence | Do not translate to generic “reporting”. |
| Unmatched transaction | Item without a valid corresponding record on the other side | Keep as unresolved until controlled resolution. |
| Reversal | Authorized counteracting transaction linked to the original | Do not imply the original posted record was deleted. |
| Available balance | Balance as calculated by the approved authoritative account rules | Never alter computation due to localized rendering. |
| Consent | Specific, informed permission with purpose, scope and validity where applicable | Needs approved text and a recorded consent event. |
| Audit trail | Traceable historical record of actions and relevant evidence | Do not imply immutability unless storage controls are proven. |
| Fixed deposit | A term-based deposit product operated by an authorized responsible institution | Software support does not confer deposit-taking authority on TITech. |
| Investment execution | An actual order/transaction through an appropriately authorized party | Must remain disabled unless all legal, partner and operational gates pass. |

## Quality gates

Run `npm run i18n:check` for locale/resource parity and placeholder checks. That structural validator does not review translation fluency or legal correctness. Run `npm run i18n:production-gate` separately; it is expected to fail until all required non-English locales reach approved status. A failed production gate is an intentional guard, not a defect to suppress.

## Glossary updates

Update English source and the glossary together, preserve resource keys when wording changes, update every locale resource, review placeholders, then run validator/tests. The translation should be checked in the actual rendered UI including Arabic RTL and long/numerical values. Do not send personal, member, account or transaction data to external translation services.
