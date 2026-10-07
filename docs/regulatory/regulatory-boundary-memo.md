# TITech Community Capital — Regulatory Boundary Memo

**Version:** 1.0  
**Review date:** 7 October 2026  
**Status:** Engineering/compliance boundary artifact — **not legal advice and not regulatory approval**

## Objective

TITech's first regulatory task is not “get a license”. It is to establish and document exactly what TITech does, what a regulated partner does, where funds move, who holds customer/member money, who makes regulated decisions, who is the controller/processor for each data flow, and what evidence is required before a capability may move from pilot to production.

## Proposed operating boundary

TITech's core model is a technology, control and data layer. The core model does **not** assume TITech takes custody of member funds, issues electronic money, operates a payment system, or makes balance-sheet lending decisions.

| Activity | TITech role | Partner / institution role | Control boundary |
|---|---|---|---|
| Member records | Technology/data layer | Community institution remains accountable for its member relationship | Data protection, access control, retention, audit |
| Institution / tenant records | SaaS control plane | Institution controls authoritative institutional data | Tenant isolation and contracts |
| Ledger software | Financial-control software and audit trail | Institution owns accounting position and policies | Double entry, immutable history, authorization |
| Payment instruction | Orchestration and control layer | Licensed PSP/bank executes regulated payment | Instruction integrity, idempotency, provider evidence |
| Money custody | **No custody in core model** | Licensed bank/PSP/regulated institution | No TITech balance-sheet custody without separate legal strategy |
| Settlement | Matching/reconciliation control | PSP/bank executes settlement | Settlement file/event matching and exception management |
| Credit decision | Consented risk signals only | Licensed lender underwrites, contracts and disburses | Explainability, partner accountability |
| KYC/AML workflow | Evidence/workflow support | Responsible regulated institution performs legally required checks | RACI and audit trail |
| Data sharing | Consent/permission layer | Receiving partner uses data for declared purpose | Purpose limitation and consent evidence |
| Statutory reporting | Reporting/control software | Institution/regulated partner owns filing obligation | Review, approval, source evidence |

## Uganda regulatory perimeter to validate with counsel

1. **National payment systems:** Uganda's National Payment Systems Act regulates payment systems, payment service providers, electronic money and related payment activities. The consolidated legal source currently indexed by ULII is the 31 December 2023 version; it must be re-checked for later amendments before go-live.
2. **Payment rules:** National Payment Systems Regulations, 2021 are relevant to payment-service boundaries; ULII records an amendment history and the package therefore treats current applicability as a legal-review item rather than a software assertion.
3. **Tier 4 / SACCO:** UMRA regulates, licenses and supervises Tier 4 financial institutions, including SACCOs. The package explicitly treats the institution's own regulatory obligations as distinct from TITech's software role.
4. **SACCO amendments:** A 2025 SACCO amendment instrument exists and must be included in the legal-currentness review.
5. **Data protection:** Uganda's Data Protection and Privacy Act (Chapter 97) and Data Protection and Privacy Regulations, 2021 govern the processing boundary. TITech must map controller/processor roles, lawful basis, notices, retention and cross-border transfer implications with counsel.

## Approval rule

No technical document, test, adapter, certificate, customer slide or source file may be interpreted as evidence that TITech is licensed, exempt, approved by a regulator, or authorized to perform a regulated activity unless an accountable legal/regulatory owner has recorded that conclusion and its source.

## Required owners

| Decision | Accountable owner | Evidence |
|---|---|---|
| TITech product boundary | TITech executive sponsor | Approved boundary memo |
| Regulated partner responsibilities | Partner compliance/legal | Signed RACI / contract |
| Uganda legal interpretation | Qualified Ugandan counsel | Legal opinion / memo |
| Payment-service perimeter | TITech + counsel + regulated partner | Legal boundary record |
| Data protection role | Privacy lead / counsel | Controller-processor assessment |
| Pilot approval | Institution + TITech | Pilot acceptance record |

## Source references checked 7 October 2026

- National Payment Systems Act, Chapter 59: https://ulii.org/en/akn/ug/act/2020/15/eng@2023-12-31
- National Payment Systems Regulations, 2021: https://ulii.org/en/akn/ug/act/si/2021/18/eng@2021-03-05
- Tier 4 Microfinance Institutions and Money Lenders Act, Chapter 61: https://ulii.org/en/akn/ug/act/2016/18/eng@2023-12-31
- Tier 4 / SACCO regulatory portal: https://umra.go.ug/regulations-codes/
- SACCO regulatory information: https://umra.go.ug/licensing-regulation-and-supervision-of-saccos-in-uganda/
- SACCO amendment instrument 2025: https://ulii.org/en/akn/ug/act/si/2025/45/eng@2025-05-02
- Data Protection and Privacy Act, Chapter 97: https://ulii.org/en/akn/ug/act/2019/9/eng@2023-12-31
- Data Protection and Privacy Regulations, 2021: https://ulii.org/en/akn/ug/act/si/2021/21/eng@2021-03-12
- PDPO information center: https://pdpo.go.ug/information-center

## Required review cadence

- At product launch: full boundary review.
- Before every new country/provider/regulatory model: delta review.
- Monthly: regulatory change scan.
- Before production expansion: counsel sign-off and partner responsibility confirmation.
