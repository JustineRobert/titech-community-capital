# Data Processing and Controller / Processor Matrix

| Dataset / flow | Typical data | Likely role to assess | Primary purpose | Key controls | Decision required |
|---|---|---|---|---|---|
| Member identity | Name, phone, member ID, KYC attributes | Institution controller / TITech processor in many deployments | Membership administration | RBAC, minimization, audit, retention | Contract-specific assessment |
| Transaction records | Payment IDs, amounts, status, timestamps | Institution controller / TITech processor; PSP independent for provider processing | Financial operations | Encryption, integrity, immutable audit | Contract-specific assessment |
| Provider callbacks | Provider reference, status, limited payload | Joint / separate-controller analysis may be required | Payment verification and reconciliation | Signature verification, replay protection, minimization | Counsel review |
| Consent records | Consent status, purpose, timestamp | Institution controller / TITech processor | Data sharing and permissioning | Versioned consent, withdrawal, audit | Notice + consent design |
| Support records | Contact and incident data | Institution or TITech depending workflow | Support | Least privilege, retention | Contract-specific |
| Risk features | Derived cash-flow/behavioral indicators | Institution/partner controller or joint analysis | Consented risk services | Purpose limitation, explainability, access controls | Legal + model governance |
| Data exports | Member/transaction reports | Export requester’s controller responsibility | Reporting | Approval, access log, watermarking where applicable | Export policy |
| Cross-border copies | Replicated/processed data | Controller/processor depends on arrangement | Service delivery | Transfer assessment, vendor controls | Counsel decision before use |

## Required privacy evidence

- Data inventory and classification.
- Privacy notice versions.
- Lawful-basis record where applicable.
- Consent record and withdrawal behavior where consent is the basis.
- Data-subject-rights workflow.
- Retention schedule.
- Breach response and notification workflow.
- Processor/sub-processor register.
- Cross-border transfer assessment.
- Access/export audit logs.
