# Legal Publication and Consent Release Gate

**Release state:** BLOCKED — draft content / verified operational facts / legal sign-off outstanding.

## Corporate identity

- [ ] Confirm the legal name **TITech Capital LTD** against the applicable corporate record.
- [ ] Verify company registration number, registered office, postal/service address and contracting authority.
- [ ] Supply monitored legal-notice and data-protection contacts.
- [ ] Confirm the operator and responsible party for each tenant/institution, payment, insurance, fundraising and support flow.

## Privacy and data governance

- [ ] Map the real data collected/derived and exclude non-existent or speculative collection statements.
- [ ] Document controller/processor/joint-controller roles per purpose and institution.
- [ ] Verify current data-protection registrations/notifications/officer duties where applicable.
- [ ] Approve each purpose and lawful basis; separately capture purpose-specific consent where required.
- [ ] Inventory processors, subprocessors, hosting countries, international access/transfers and safeguards.
- [ ] Approve retention/deletion schedule per account, consent, security, identity/KYC, insurance, payment, ledger, audit and support record.
- [ ] Complete rights-request identity verification, ownership, response workflow, and complaint escalation.
- [ ] Verify cookies, local/session storage, IndexedDB, analytics, crash reports, tracing, metrics, third-party scripts and retention.
- [ ] Verify encryption/key controls, access controls, tenant isolation, logs, backups, restoration, incident/breach handling and private-document malware scanning in the deployed environment.
- [ ] Review child data, vulnerable users, refugee/asylum-seeker evidence, assisted/offline onboarding and any sensitive data under documented safeguards.

## Terms and regulated-service scope

- [ ] Verify which features are actually enabled; do not promise unavailable functionality.
- [ ] Confirm whether the operator/partner requires a licence or regulatory approval for the exact products, flows and jurisdictions.
- [ ] Confirm payment provider contracts, callback authenticity, settlement responsibilities, fee disclosures and complaint paths.
- [ ] Confirm lending, savings, insurance, education fundraising, donations, capital connectivity and risk/credit decisioning language for each enabled service.
- [ ] Set price/fee schedules, cancellation/refund rules, charge responsibility, record corrections and dispute handling.
- [ ] Approve jurisdiction, governing-law, liability, indemnity and dispute clauses with qualified counsel; do not waive statutory rights.
- [ ] Verify institution agreement precedence, partner disclosures and who owes money/benefits to the end user.

## UI/API proof

- [ ] Public routes: `/legal`, `/terms`, `/privacy` work when opened directly and when refreshed; optional `/legal/index` hub also resolves.
- [ ] Login page shows links without changing authentication flow.
- [ ] Registration page displays the actual approved terms and privacy version before submission.
- [ ] Backend rejects registration without required terms acceptance or privacy acknowledgement.
- [ ] Server, not browser, records acceptance time, actor and exact version; event is auditable and resistant to tampering.
- [ ] Optional/sensitive sharing consent is separate and granular; withdrawal path is exercised.
- [ ] No draft warnings, placeholder details, placeholder text, guessed effective dates or unresolved requirements remain.
- [ ] Vitest frontend tests, Jest 30 backend tests, API tests, E2E browser tests, accessibility, build and release gates run with required Node/npm and dependencies.
- [ ] Legal sign-off, operator approval and evidence artifact IDs are in the release record.

**Gate rule:** Any unchecked item that applies to the deployed service blocks publication of the legal documents as final. Keep `LEGAL_PUBLICATION_STATUS='draft'` and `productionApproved=false` while this gate is unresolved.
