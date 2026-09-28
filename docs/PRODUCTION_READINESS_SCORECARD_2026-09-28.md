# TITech Community Capital — Production Readiness Scorecard

| Capability | Current source status | Evidence in repository | External verification required |
|---|---|---|---|
| Repository truth | IMPLEMENTED / VERIFIED | truth-inventory and static gates | Node 24 dependency-backed runtime |
| Golden Money Path | IMPLEMENTED / TEST CONTRACTS | payment, transaction, ledger and reconciliation modules + existing evidence docs | real provider + real transaction replay |
| MTN MoMo | IMPLEMENTED / PENDING EXTERNAL VERIFICATION | provider modules + new production safety contract | provider certification, credentials, live/sandbox evidence |
| Reconciliation | IMPLEMENTED / TEST CONTRACTS | canonical reconciliation services/models | provider statement + real settlement matching |
| General ledger | IMPLEMENTED | ledger engine/models/services | Mongo transaction/concurrency evidence |
| Financial statements | IMPLEMENTED | trial balance/statement services | closed-period operational evidence |
| Audit | IMPLEMENTED / HARDENED | tamper-evident audit module + compatibility boundary | operational chain verification |
| Loans | IMPLEMENTED / TEST CONTRACTS | workflow/audit/schedule modules | pilot UAT and financial posting evidence |
| Customer onboarding | IMPLEMENTED | onboarding module + frontend flow | KYC/consent/UAT evidence |
| Security | IMPLEMENTED / PENDING VERIFICATION | CI security workflows + static controls | SAST/DAST/secret/container/IaC scan results |
| Backup/restore | DOCUMENTED | existing DR/backup runbooks | actual restore drill |
| Monitoring | IMPLEMENTED | health/readiness/metrics/observability modules | staging/production evidence |
| Pilot readiness | IMPLEMENTED | pilot readiness contract + deployment package | 3 signed/onboarded SACCOs |
| Brand standardization | IMPLEMENTED | canonical asset + brand manifest + reusable component | final corporate asset review |

## Production approval

**NOT PRODUCTION APPROVED** from source inspection alone.

The final designation is blocked until external dependency evidence is attached to the data room and production approval record.
