# TITech Platform Security Policy

**Document ID:** TITECH-SECURITY-POLICY
**Version:** 2.0
**Status:** Controlled Security Policy
**Classification:** Internal / Confidential
**Effective Date:** 18 August 2026
**Review Frequency:** Monthly during active development; quarterly after production stabilization
**Applies To:** TITech Community Capital / TITech Platform, source code, infrastructure, APIs, applications, integrations, data, CI/CD pipelines and supporting services

---

## 1. Purpose

This document defines the security policy, vulnerability-disclosure process, security responsibilities, minimum security controls and incident-handling requirements for the TITech Platform.

TITech is designed to support financial and community-capital workflows, including savings, wallets, lending, KYC/AML, mobile-money integrations, fraud detection, communications, APIs and cloud infrastructure.

Because the platform may process financial transactions and personal information, security is treated as a **core business, engineering and compliance responsibility**, not merely a development concern.

This policy establishes the minimum security baseline required for:

* Development.
* Testing.
* Staging.
* Production.
* Third-party integrations.
* Cloud infrastructure.
* Financial transactions.
* Customer information.
* Administrative systems.
* CI/CD environments.
* Security incidents.
* Vulnerability disclosure.

---

# 2. Security Principles

TITech follows these core security principles:

1. **Security by Design**
2. **Least Privilege**
3. **Zero Trust**
4. **Defense in Depth**
5. **Secure Defaults**
6. **Separation of Duties**
7. **Data Minimization**
8. **Continuous Monitoring**
9. **Assume Breach**
10. **Evidence-Based Security**
11. **Privacy by Design**
12. **Financial Integrity by Design**

No individual security control should be treated as sufficient on its own.

---

# 3. Security Scope

This policy applies to:

### Applications

* Web applications.
* Mobile applications.
* Backend services.
* APIs.
* Administrative portals.
* Customer-support interfaces.

### Financial Systems

* Wallet ledger.
* Savings.
* Contributions.
* Withdrawals.
* Loan processing.
* Payments.
* Refunds/reversals.
* Reconciliation.
* Fraud detection.

### Identity & Compliance

* Authentication.
* Authorization.
* KYC.
* AML.
* Identity verification.
* Customer-risk systems.

### Infrastructure

* Kubernetes.
* Cloud infrastructure.
* Databases.
* Redis/cache systems.
* Storage.
* Networking.
* CI/CD infrastructure.

### External Integrations

* MTN Mobile Money.
* Airtel Money.
* Stripe where applicable.
* SMTP/email providers.
* SMS providers.
* KYC/identity providers.
* Sentry/monitoring systems.
* Cloud IAM.
* Other third-party services.

---

# 4. Security Classification

TITech information should be classified according to its sensitivity.

| Classification  | Examples                                   | Minimum Protection                                                    |
| --------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Public          | Marketing/public documentation             | Integrity controls                                                    |
| Internal        | Internal documentation                     | Access control                                                        |
| Confidential    | Business information                       | Authentication + access control                                       |
| Sensitive       | Customer information                       | Encryption + restricted access                                        |
| Restricted      | KYC, financial records                     | Strong encryption + enhanced monitoring                               |
| Secret          | Passwords, API keys, private keys          | Secret manager + strict access                                        |
| Critical Secret | Production credentials/payment credentials | Centralized secret management + rotation + privileged access controls |

---

# 5. Supported Versions

TITech actively supports:

* `main` branch, **only when designated as the production branch**
* Latest stable tagged release
* Current production deployment version

Development, feature and obsolete branches are not automatically considered production-supported.

### Version Security Rule

A version is considered security-supported only when:

* Security patches can be applied.
* Dependencies are maintained.
* Critical vulnerabilities are monitored.
* Deployment capability exists.
* The version has an assigned owner.

Unsupported versions should not process production financial transactions.

---

# 6. Security Ownership

Security is a shared responsibility.

| Role                   | Primary Responsibility                         |
| ---------------------- | ---------------------------------------------- |
| Executive Sponsor      | Security governance and risk acceptance        |
| CTO / Engineering Lead | Technical security                             |
| Security Lead/CISO     | Security programme and assurance               |
| DevSecOps              | CI/CD, infrastructure and security automation  |
| Backend Team           | Application/API security                       |
| Frontend/Mobile Team   | Client-side security                           |
| Database Team          | Data protection and database security          |
| DevOps/SRE             | Infrastructure, availability and resilience    |
| Compliance Team        | Regulatory/security governance                 |
| Risk/Fraud Team        | Fraud and transaction risk                     |
| Developers             | Secure coding                                  |
| QA                     | Security-aware testing                         |
| All Contributors       | Protect credentials and report security issues |

---

# 7. Vulnerability Reporting

## DO NOT open a public GitHub issue for a suspected security vulnerability.

Security vulnerabilities must be reported privately.

### Primary Security Contact

**Security Team:** [security@titech.com](mailto:security@titech.com)

> Replace this address with the organization's verified security mailbox before publishing this document.

### Emergency Contact

**Emergency Security Contact:** +256-772-123546

> Replace this number with the organization's verified 24/7 incident-response contact before publishing this document.

For critical incidents involving:

* Production credential compromise.
* Payment-provider compromise.
* Customer financial-data exposure.
* Active unauthorized access.
* Large-scale fraud.
* Remote code execution.
* Production database compromise.

use the emergency escalation path immediately.

---

# 8. Vulnerability Report Requirements

A vulnerability report should contain, where available:

* Reporter name or preferred identifier.
* Contact information.
* Affected component.
* Affected version/commit.
* Environment.
* Vulnerability category.
* Severity assessment.
* Steps to reproduce.
* Proof of concept.
* Screenshots/logs where safe.
* Expected behavior.
* Actual behavior.
* Security impact.
* Data potentially exposed.
* Suggested remediation.
* Whether exploitation is currently active.

### Example

```text
Subject: [SECURITY] Potential authorization bypass in wallet API

Affected component:
Wallet API

Affected endpoint:
[REDACTED]

Affected version:
vX.X.X

Severity:
High

Description:
[Description]

Steps to reproduce:
1. ...
2. ...
3. ...

Impact:
An authenticated user may potentially access another customer's
resource.

Proof of concept:
[Safe PoC]

Suggested remediation:
[Optional]
```

Do not include live credentials, private keys or unnecessary customer information in reports.

---

# 9. Vulnerability Severity

TITech uses risk-based vulnerability classification.

| Severity          | Example                                                                                 | Response                      |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| **Critical**      | Active credential compromise, remote code execution, unauthorized financial transaction | Immediate incident response   |
| **High**          | Privilege escalation, major authorization bypass, sensitive-data exposure               | Priority remediation          |
| **Medium**        | Limited data exposure, exploitable configuration weakness                               | Planned expedited remediation |
| **Low**           | Minor security weakness with limited impact                                             | Normal remediation            |
| **Informational** | Hardening recommendation                                                                | Backlog/improvement           |

Severity may be adjusted based on:

* Exploitability.
* Customer impact.
* Financial impact.
* Data sensitivity.
* Exposure.
* Attack complexity.
* Existing compensating controls.

---

# 10. Vulnerability Response SLA

Target response times:

| Severity |   Acknowledgement |   Target Remediation |
| -------- | ----------------: | -------------------: |
| Critical |         ≤ 4 hours |     Emergency / ASAP |
| High     |        ≤ 24 hours | Priority remediation |
| Medium   |        ≤ 48 hours |  Planned remediation |
| Low      | ≤ 5 business days | Normal release cycle |

These are **security targets**, not guarantees.

Critical vulnerabilities may require:

* Immediate containment.
* Credential rotation.
* Feature disablement.
* Traffic blocking.
* Emergency deployment.
* Customer notification where required.
* Regulatory notification where required.
* Forensic investigation.

---

# 11. Vulnerability Handling Lifecycle

```text
Report
  ↓
Triage
  ↓
Validate
  ↓
Classify Severity
  ↓
Assign Owner
  ↓
Contain
  ↓
Develop Fix
  ↓
Security Verification
  ↓
Deploy
  ↓
Monitor
  ↓
Close
  ↓
Lessons Learned
```

Every confirmed vulnerability should have an auditable record.

---

# 12. Coordinated Disclosure

TITech supports responsible and coordinated disclosure.

Security researchers should:

* Avoid unnecessary access to customer information.
* Avoid modifying or deleting production data.
* Avoid service disruption.
* Avoid social engineering employees.
* Avoid persistence mechanisms.
* Avoid destructive testing.
* Stop testing once sufficient evidence is obtained.

TITech will work with responsible researchers to establish a reasonable disclosure timeline.

Public disclosure before remediation may expose customers and the platform to unnecessary risk.

---

# 13. Security Research Safe Harbor

Good-faith security research is encouraged when conducted responsibly and within applicable laws.

Researchers should:

* Test only systems they are authorized to test.
* Minimize data access.
* Avoid destructive activity.
* Report findings privately.
* Delete sensitive information obtained accidentally.
* Cooperate with remediation.

This policy does not authorize unauthorized access to TITech systems or third-party systems.

---

# 14. Responsible Disclosure Recognition

TITech may acknowledge researchers who responsibly report valid security vulnerabilities.

Recognition may include:

* Name/handle in a security acknowledgements list.
* Written appreciation.
* Other recognition agreed with the researcher.

No public recognition will be made where the reporter requests anonymity.

Financial rewards are not guaranteed unless TITech establishes a formal bug-bounty programme.

---

# 15. Secrets Management

## Strict Prohibition

The following must never be committed to source control:

* Production passwords.
* API keys.
* Private keys.
* JWT signing secrets.
* Database credentials.
* Cloud credentials.
* Payment-provider credentials.
* OAuth secrets.
* SMTP passwords.
* Encryption keys.
* Kubernetes production secrets.
* Customer credentials.

Never commit:

```text
.env
.env.production
.env.prod
.env.local
credentials.json
service-account.json
private keys
database dumps
production configuration containing secrets
```

---

# 16. Secret Management Standard

Production secrets should be managed using an approved secret-management solution such as:

* HashiCorp Vault.
* Cloud KMS/Secrets Manager.
* Azure Key Vault.
* Google Secret Manager.
* Kubernetes-integrated secret management with appropriate encryption and access controls.

Secrets should be:

* Encrypted.
* Access controlled.
* Audited.
* Rotated.
* Revocable.
* Environment-specific.
* Limited to required services.

---

# 17. Credential Compromise Procedure

If a secret is suspected to be exposed:

### Assume it is compromised.

Immediately:

1. Revoke the credential.
2. Rotate the credential.
3. Investigate usage.
4. Review logs.
5. Identify affected systems.
6. Check Git history.
7. Remove the secret from active source/configuration.
8. Scan for additional exposure.
9. Determine customer/business impact.
10. Record the incident.
11. Notify required stakeholders.
12. Complete post-incident review.

Removing a secret from the latest Git commit **does not make a historical credential safe**.

---

# 18. Source Control Security

All production repositories should implement:

* Protected branches.
* Pull-request review.
* Required status checks.
* Secret scanning.
* Dependency scanning.
* Code scanning.
* Signed commits where appropriate.
* Least-privilege repository permissions.
* 2FA for privileged accounts.
* Personal access token controls.
* Access review.
* Audit logging.

Direct pushes to production branches should be restricted.

---

# 19. Secure Development Lifecycle

TITech follows a Secure Software Development Lifecycle:

```text
Requirements
    ↓
Threat Modeling
    ↓
Secure Architecture
    ↓
Secure Development
    ↓
Code Review
    ↓
Automated Security Scanning
    ↓
Functional Testing
    ↓
Security Testing
    ↓
Staging
    ↓
Security/Release Approval
    ↓
Production
    ↓
Continuous Monitoring
```

Security requirements should be defined before implementation of high-risk financial features.

---

# 20. Secure Coding Requirements

Developers must:

* Validate input.
* Encode output appropriately.
* Use parameterized database queries.
* Avoid dynamic code execution.
* Validate authorization server-side.
* Never trust client-side authorization.
* Protect against injection attacks.
* Handle errors safely.
* Avoid leaking sensitive information.
* Use secure cryptographic libraries.
* Avoid custom cryptography.
* Protect authentication tokens.
* Implement rate limits.
* Use secure dependencies.

---

# 21. OWASP Security Baseline

Web/API applications should be assessed against relevant OWASP risks, including:

* Broken access control.
* Cryptographic failures.
* Injection.
* Insecure design.
* Security misconfiguration.
* Vulnerable/outdated components.
* Identification/authentication failures.
* Software/data integrity failures.
* Logging/monitoring failures.
* Server-side request forgery.

API-specific risks must also be considered, especially:

* Object-level authorization.
* Broken authentication.
* Excessive data exposure.
* Resource exhaustion.
* Business-flow abuse.
* SSRF.
* Improper inventory management.
* Unsafe consumption of APIs.

---

# 22. Financial Transaction Security

Financial operations receive enhanced security controls.

These include:

* Strong authorization.
* Idempotency.
* Transaction integrity.
* Duplicate prevention.
* Replay protection.
* Audit logging.
* Reconciliation.
* Rate limiting.
* Fraud detection.
* Transaction limits.
* Anomaly detection.
* Secure callbacks.
* Provider-reference validation.
* Administrative approval for sensitive operations.

The platform must not rely on frontend validation for financial security.

---

# 23. Wallet Security

Wallet operations must protect:

* Account ownership.
* Balance integrity.
* Transaction history.
* Deposit operations.
* Withdrawal operations.
* Transfers.
* Reversals.
* Refunds.
* Reconciliation.

The authoritative financial record must be based on controlled ledger operations rather than an untrusted client-provided balance.

---

# 24. Mobile Money Security

Sensitive integrations include:

* MTN Mobile Money.
* Airtel Money.

Required controls:

* Secure credential storage.
* TLS.
* Authentication.
* Callback verification.
* Signature validation where supported.
* Replay protection.
* Idempotency.
* Provider transaction-reference validation.
* Timeout handling.
* Retry controls.
* Reconciliation.
* Transaction monitoring.
* Error handling.
* Provider outage handling.

Sandbox credentials must never be used as production credentials.

---

# 25. Stripe and Card Payment Security

Where Stripe or other card-payment providers are used:

* Prefer provider-hosted/tokenized payment flows.
* Do not store card numbers unless explicitly required and appropriately authorized.
* Never log full card numbers.
* Never log CVV/CVC.
* Protect payment-related tokens.
* Restrict payment API keys.
* Monitor suspicious payment activity.
* Maintain applicable PCI DSS scope documentation.

PCI DSS applicability must be formally determined from the actual payment architecture.

---

# 26. KYC / AML Security

KYC/AML data must receive enhanced protection.

Controls should include:

* Restricted access.
* Encryption.
* Audit logging.
* Data minimization.
* Retention controls.
* Identity verification security.
* Fraud protection.
* Administrative access monitoring.
* Secure document handling.
* Appropriate sanctions/AML screening.
* Secure regulatory reporting.

Compliance software functionality alone does not establish regulatory compliance.

---

# 27. Authentication

Authentication controls should include:

* Strong password hashing.
* Secure session/token management.
* Expiration.
* Token revocation.
* Brute-force protection.
* Rate limiting.
* Secure password reset.
* Account recovery protection.
* MFA for privileged users.
* Authentication event logging.
* Suspicious-login detection.

Privileged accounts must use stronger authentication than ordinary customer accounts.

---

# 28. Authorization

Authorization must follow:

**Deny by default + least privilege + explicit permission.**

Server-side authorization is mandatory.

Sensitive resources must be protected against:

* Horizontal privilege escalation.
* Vertical privilege escalation.
* IDOR/BOLA.
* Role manipulation.
* Tenant isolation failures.
* Administrative endpoint abuse.

---

# 29. Privileged Access Management

Privileged accounts should be:

* Individually assigned.
* Strongly authenticated.
* Logged.
* Monitored.
* Periodically reviewed.
* Disabled when no longer required.

Shared administrator accounts should be avoided.

Emergency access should be controlled and auditable.

---

# 30. Database Security

MongoDB/Redis and other data stores must use:

* Authentication.
* Authorization.
* Network restrictions.
* Encryption in transit.
* Encryption at rest where supported.
* Backup protection.
* Access logging.
* Least privilege.
* Secure credentials.
* Production isolation.

Databases must never be exposed directly to the public internet unless explicitly justified and strongly secured.

---

# 31. Cloud & Kubernetes Security

Production Kubernetes environments should implement:

* RBAC.
* Network policies.
* Pod security.
* Secure container images.
* Image vulnerability scanning.
* Resource limits.
* Secrets protection.
* TLS.
* Ingress controls.
* Logging.
* Monitoring.
* Audit logging.
* Workload identity where supported.
* Least-privilege cloud IAM.
* Cluster backup.
* Disaster recovery.

Cloud IAM permissions must be reviewed periodically.

---

# 32. CI/CD Security

The CI/CD pipeline must be treated as a privileged production system.

Controls:

* Protected branches.
* Build isolation.
* Secret protection.
* Least-privilege CI credentials.
* Dependency scanning.
* SAST.
* Secret scanning.
* Container scanning.
* Artifact integrity.
* Deployment approvals.
* Audit logs.
* Environment separation.

CI/CD credentials must not have unrestricted cloud access unless specifically required.

---

# 33. Dependency Security

Dependencies must be monitored for:

* Known vulnerabilities.
* Abandoned packages.
* Malicious packages.
* License concerns.
* Supply-chain risks.

Recommended controls:

```text
Dependency Declaration
        ↓
Automated Scan
        ↓
Risk Classification
        ↓
Patch/Upgrade
        ↓
Regression Test
        ↓
Security Verification
        ↓
Release
```

---

# 34. Logging & Monitoring

Security-relevant events should be logged, including:

* Authentication.
* Authorization failures.
* Password changes.
* MFA events.
* Privileged actions.
* Financial transactions.
* Payment callbacks.
* Configuration changes.
* Secret access where supported.
* Administrative activity.
* Security alerts.
* Suspicious behavior.

Logs must not contain:

* Passwords.
* API secrets.
* Private keys.
* Full payment-card information.
* Unnecessary sensitive personal data.

---

# 35. Audit Log Protection

Security and financial audit logs should be:

* Timestamped.
* Access controlled.
* Tamper resistant.
* Centrally collected where appropriate.
* Retained according to policy.
* Monitored for suspicious modification/deletion.

Critical financial events should have traceable correlation identifiers.

---

# 36. Data Protection

TITech shall apply privacy and data-security principles including:

* Data minimization.
* Purpose limitation.
* Access control.
* Encryption.
* Retention management.
* Secure deletion.
* Privacy-aware logging.
* Data-subject rights procedures where applicable.
* Breach response.

Applicable jurisdictional requirements must be assessed based on TITech's actual processing activities.

---

# 37. Encryption Standard

Sensitive information must be encrypted:

### In Transit

Use modern TLS configurations.

### At Rest

Use appropriate encryption for:

* Databases.
* Backups.
* Object storage.
* Sensitive documents.
* Secrets.

### Keys

Cryptographic keys must:

* Be protected.
* Have controlled access.
* Be rotated where appropriate.
* Not be committed to source control.
* Not be hardcoded.

---

# 38. Security Testing

Security testing should include:

### Automated

* [ ] SAST.
* [ ] Dependency scanning.
* [ ] Secret scanning.
* [ ] Container scanning.
* [ ] IaC scanning.
* [ ] DAST where appropriate.

### Manual

* [ ] Penetration testing.
* [ ] API authorization testing.
* [ ] Authentication testing.
* [ ] Business-logic testing.
* [ ] Financial transaction abuse testing.
* [ ] Payment callback testing.
* [ ] Kubernetes/cloud security testing.

### Operational

* [ ] Incident-response exercise.
* [ ] Credential compromise exercise.
* [ ] Backup restoration exercise.
* [ ] Disaster recovery exercise.

---

# 39. Security Testing Frequency

At minimum:

* Continuous automated scanning.
* Security testing for major releases.
* Security testing after significant architecture changes.
* Security testing after major payment-integration changes.
* Periodic independent penetration testing.
* Additional testing after significant security incidents.

Testing frequency should increase according to risk.

---

# 40. Incident Response

TITech maintains the following incident-response lifecycle:

```text
Detect
  ↓
Triage
  ↓
Classify
  ↓
Contain
  ↓
Investigate
  ↓
Eradicate
  ↓
Recover
  ↓
Validate
  ↓
Notify
  ↓
Post-Incident Review
```

Potential security incidents include:

* Credential leakage.
* Account takeover.
* Unauthorized financial transactions.
* Data breach.
* Malware.
* API exploitation.
* DDoS.
* Insider misuse.
* Cloud compromise.
* Database compromise.
* Payment-provider compromise.

---

# 41. Critical Incident Procedure

For a suspected critical production compromise:

1. Activate incident response.
2. Identify affected systems.
3. Preserve evidence.
4. Contain the attack.
5. Revoke compromised credentials.
6. Rotate secrets.
7. Restrict affected services.
8. Assess financial exposure.
9. Assess customer-data exposure.
10. Notify executive/security/compliance owners.
11. Notify third parties where required.
12. Notify regulators/customers where legally required.
13. Restore trusted systems.
14. Monitor for recurrence.
15. Complete post-incident review.

Do not destroy forensic evidence during emergency remediation.

---

# 42. Financial Security Incident

Any suspected unauthorized financial activity must be escalated immediately.

Examples:

* Unauthorized withdrawal.
* Unauthorized transfer.
* Wallet manipulation.
* Duplicate payment.
* Payment callback forgery.
* Loan fraud.
* Account takeover.
* Payment-provider credential compromise.

Financial incidents must be reviewed jointly by:

* Security.
* Engineering.
* Finance.
* Risk/Fraud.
* Compliance.
* Executive management.

---

# 43. Backup & Recovery Security

Backups must be:

* Encrypted.
* Access controlled.
* Monitored.
* Tested.
* Protected from accidental deletion.
* Protected against unauthorized modification.
* Retained according to policy.

A backup is not considered reliable until restoration has been successfully tested.

---

# 44. Disaster Recovery

TITech should maintain documented:

* RTO.
* RPO.
* Recovery procedures.
* System dependencies.
* Recovery priorities.
* Communication procedures.
* Emergency contacts.
* Restore procedures.

Critical financial services should receive the highest recovery priority.

---

# 45. Third-Party Security

Third parties processing TITech data or supporting critical operations should undergo risk-based due diligence.

Review areas include:

* Security controls.
* Data protection.
* Availability.
* Incident response.
* Contractual obligations.
* Access control.
* Encryption.
* Sub-processors.
* Data location.
* Business continuity.
* Exit strategy.

Critical providers require enhanced review.

---

# 46. Security Requirements for Developers

Contributors must:

* Use approved repositories.
* Protect accounts with MFA/2FA.
* Never share credentials.
* Never commit secrets.
* Keep dependencies updated.
* Run relevant security checks.
* Review authorization logic.
* Avoid sensitive information in logs.
* Report vulnerabilities privately.
* Follow secure coding standards.

---

# 47. Local Development

Developers must use:

* Test/sandbox credentials.
* Synthetic or approved test data.
* Local development secrets.
* `.env.example` placeholders.
* Separate development databases.

Production data should not be copied into local environments unless explicitly authorized and appropriately protected.

---

# 48. Environment Security

TITech environments must be separated:

```text
Development
     ↓
Testing
     ↓
Staging
     ↓
Production
```

Production credentials and data must not be reused in lower environments.

---

# 49. Security Checklist for Pull Requests

Before merging security-sensitive changes:

* [ ] Authentication reviewed.
* [ ] Authorization reviewed.
* [ ] Input validation reviewed.
* [ ] Sensitive data handling reviewed.
* [ ] Secrets checked.
* [ ] Dependency changes reviewed.
* [ ] Logging reviewed.
* [ ] Error handling reviewed.
* [ ] Financial logic reviewed where applicable.
* [ ] Tests added/updated.
* [ ] Security scans pass.

---

# 50. Production Security Gate

No major feature should enter unrestricted production until:

* [ ] Functional tests pass.
* [ ] Integration tests pass.
* [ ] Security testing passes.
* [ ] Critical/high vulnerabilities addressed or formally accepted.
* [ ] Secrets are protected.
* [ ] IAM is reviewed.
* [ ] Monitoring is operational.
* [ ] Logging is operational.
* [ ] Backup is verified.
* [ ] Recovery is tested.
* [ ] Incident procedures exist.
* [ ] Financial controls are validated where applicable.
* [ ] Applicable regulatory/privacy review is completed.
* [ ] Production owner approves.
* [ ] Security owner approves for high-risk capabilities.

---

# 51. Security Risk Acceptance

Security risks that cannot immediately be remediated must not simply be ignored.

A formal risk exception should document:

* Risk ID.
* Vulnerability.
* Business impact.
* Technical impact.
* Compensating controls.
* Reason for acceptance.
* Risk owner.
* Expiry date.
* Remediation plan.
* Executive approval where required.

Risk acceptance must have an expiration date.

---

# 52. Security Metrics

TITech should monitor:

### Vulnerability

* Critical vulnerabilities.
* High vulnerabilities.
* Mean time to remediate.
* Open security findings.
* Dependency vulnerabilities.

### Application

* Authentication failures.
* Authorization failures.
* API abuse.
* Rate-limit violations.
* Suspicious sessions.

### Financial

* Fraud attempts.
* Fraud losses.
* Payment failures.
* Reconciliation exceptions.
* Unauthorized transaction attempts.

### Infrastructure

* Security alerts.
* Privileged-access events.
* Cloud configuration findings.
* Container vulnerabilities.
* Secret exposures.

### Incident Response

* Mean time to detect.
* Mean time to contain.
* Mean time to recover.
* Number of incidents.
* Recurring incidents.

---

# 53. Security Review Checklist

## Application

* [ ] OWASP assessment completed.
* [ ] API authorization tested.
* [ ] Authentication tested.
* [ ] Input validation tested.
* [ ] Business logic tested.

## Infrastructure

* [ ] Kubernetes reviewed.
* [ ] Cloud IAM reviewed.
* [ ] Network controls reviewed.
* [ ] Container images scanned.
* [ ] TLS configured.

## Data

* [ ] Encryption verified.
* [ ] Data classification completed.
* [ ] Retention documented.
* [ ] Access controls verified.

## Financial

* [ ] Ledger integrity verified.
* [ ] Idempotency verified.
* [ ] Reconciliation verified.
* [ ] Fraud controls verified.

## Compliance

* [ ] Data-protection review completed.
* [ ] KYC/AML controls reviewed.
* [ ] Applicable payment requirements assessed.
* [ ] Partner requirements reviewed.

---

# 54. Security Documentation Requirements

The following should be maintained:

* Architecture diagrams.
* Data-flow diagrams.
* Threat models.
* API security documentation.
* Asset inventory.
* Data inventory.
* Risk register.
* Vulnerability register.
* Incident register.
* Third-party register.
* Security test reports.
* Penetration-test reports.
* Backup/DR evidence.
* Access-control reviews.
* Security approvals.

---

# 55. Security Truth Principle

TITech shall not claim:

* "100% secure."
* "Fully secure."
* "Fully compliant."
* "Regulator certified."
* "PCI DSS certified."
* "GDPR compliant."
* "Bank-grade security."

unless the specific claim is supported by appropriate evidence, scope and formal authorization.

Preferred language:

> **"TITech Platform is engineered toward enterprise-grade security and follows a controlled security assurance process covering application security, financial integrity, infrastructure security, privacy, monitoring, vulnerability management and incident response."**

---

# 56. Security Release Checklist

Before a production release:

* [ ] Security-impact assessment completed.
* [ ] Code review completed.
* [ ] Automated tests pass.
* [ ] Security scans pass.
* [ ] Dependency vulnerabilities reviewed.
* [ ] Secrets scan passes.
* [ ] API security reviewed.
* [ ] Database changes reviewed.
* [ ] Infrastructure changes reviewed.
* [ ] Monitoring updated.
* [ ] Rollback tested/planned.
* [ ] Security owner approval obtained for high-risk changes.

---

# 57. Security Contacts

## Primary

**TITech Security Team**
Email: [security@titech.com](mailto:security@titech.com)

## Emergency

**Critical Security Incident Hotline**
Phone: +256-772-123546

## Compliance

**Compliance Team**
Email: [Insert verified compliance address]

## Engineering

**Engineering Team**
Email: [Insert verified engineering/security escalation address]

> Contact information must be verified before this document is published publicly.

---

# 58. Security Policy Review

This document shall be reviewed:

* Monthly during active development.
* Quarterly during stable production.
* After significant architecture changes.
* After major security incidents.
* After significant regulatory changes.
* After major third-party integration changes.
* After penetration tests.
* After major infrastructure migrations.

All material revisions must be version controlled.

---

# 59. Document Change Log

| Version | Date            | Change                                                                                                                                               | Owner                         | Approval   |
| ------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
| 1.0     | [Previous Date] | Initial security policy                                                                                                                              | TITech Team                   | [Approver] |
| 2.0     | 18-Aug-2026     | Enterprise security governance, vulnerability management, financial security, incident response, DevSecOps, cloud/Kubernetes and production controls | TITech Security / Engineering | [Pending]  |

---

# 60. Security Policy Approval

## Security Owner

**Name:** ______________________________
**Role:** CISO / Security Lead
**Signature:** __________________________
**Date:** ______________________________

## CTO / Engineering

**Name:** ______________________________
**Role:** CTO / Engineering Lead
**Signature:** __________________________
**Date:** ______________________________

## Compliance

**Name:** ______________________________
**Role:** Compliance Officer
**Signature:** __________________________
**Date:** ______________________________

## Executive Sponsor

**Name:** ______________________________
**Role:** CEO / Executive Sponsor
**Signature:** __________________________
**Date:** ______________________________

---

# Appendix A — Security Status

| Control Area                   | Status    | Evidence   | Owner                  |
| ------------------------------ | --------- | ---------- | ---------------------- |
| Secure coding                  | ⚠️ Verify | [Evidence] | Engineering            |
| Authentication                 | ⚠️ Verify | [Evidence] | Platform               |
| Authorization                  | ⚠️ Verify | [Evidence] | Backend                |
| Secrets management             | ⚠️ Verify | [Evidence] | DevSecOps              |
| Dependency security            | ⚠️ Verify | [Evidence] | Engineering            |
| API security                   | ⚠️ Verify | [Evidence] | Backend                |
| Mobile Money security          | ⚠️ Verify | [Evidence] | Integrations           |
| Financial transaction security | ⚠️ Verify | [Evidence] | Finance/Backend        |
| KYC/AML security               | ⚠️ Verify | [Evidence] | Compliance             |
| Kubernetes security            | ⚠️ Verify | [Evidence] | DevOps                 |
| Logging/monitoring             | ⚠️ Verify | [Evidence] | SRE                    |
| Backup/DR                      | ⚠️ Verify | [Evidence] | DevOps                 |
| Penetration testing            | ⚠️ Verify | [Evidence] | Security               |
| Incident response              | ⚠️ Verify | [Evidence] | Security               |
| Privacy/data protection        | ⚠️ Verify | [Evidence] | Compliance             |
| Third-party security           | ⚠️ Verify | [Evidence] | Compliance/Procurement |

---

# Appendix B — Emergency Credential Compromise Checklist

* [ ] Confirm suspected exposure.
* [ ] Identify credential.
* [ ] Identify affected environment.
* [ ] Revoke credential.
* [ ] Generate replacement credential.
* [ ] Update secret manager.
* [ ] Restart/redeploy affected services if necessary.
* [ ] Search Git history.
* [ ] Search logs for credential use.
* [ ] Review cloud/provider activity.
* [ ] Review financial transactions.
* [ ] Determine customer impact.
* [ ] Determine regulatory notification requirements.
* [ ] Record incident.
* [ ] Conduct post-incident review.

---

# Appendix C — Security Evidence Standard

A security claim is considered **verified** only when supported by evidence that is:

* Current.
* Traceable.
* Relevant.
* Environment-specific.
* Version-specific where applicable.
* Reproducible where applicable.
* Owned.
* Auditable.

Examples include:

* Security scan reports.
* Penetration-test reports.
* CI/CD results.
* Access reviews.
* Configuration evidence.
* Incident records.
* DR test reports.
* Partner security attestations.
* Compliance assessments.

---

# Appendix D — Core Security Rules

1. **Never commit secrets.**
2. **Never trust client-side authorization.**
3. **Never expose production credentials.**
4. **Never assume a successful API response means a secure transaction.**
5. **Never treat sandbox validation as production certification.**
6. **Never expose sensitive customer information unnecessarily.**
7. **Never ignore a suspected credential compromise.**
8. **Never deploy critical financial functionality without security and operational controls.**
9. **Never claim compliance without evidence and appropriate scope.**
10. **Never claim production readiness without formal approval.**
11. **Always use least privilege.**
12. **Always protect financial transaction integrity.**
13. **Always maintain auditability.**
14. **Always monitor production systems.**
15. **Always test restoration, not merely backups.**
16. **Always report vulnerabilities privately.**
17. **Always investigate critical security events immediately.**
18. **Always document exceptions and risk acceptance.**

---

## Final Security Commitment

TITech is committed to building and operating the platform according to an **enterprise-grade, defense-in-depth security model**.

Security readiness is measured through **implemented controls, objective evidence, testing, operational effectiveness, risk management and accountable approval**.

The objective is not to claim that the platform is "perfectly secure". The objective is to maintain a continuously improving security programme capable of:

**Preventing → Detecting → Responding → Recovering → Learning**

from security threats while protecting customer information, financial assets, platform integrity and TITech's long-term trust.

**END OF CONTROLLED SECURITY POLICY**

**Document ID:** TITECH-SECURITY-POLICY
**Version:** 2.0
**Last Updated:** 18 August 2026
**Next Review:** 18 November 2026