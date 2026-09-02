# 🏦 TITech Community Capital

> **The financial operating system for Africa's community economy.**

TITech Community Capital is an **enterprise-grade community finance platform** designed to connect **SACCOs, VSLAs, savings groups, cooperatives, community enterprises, and emerging financial institutions** to modern financial infrastructure.

Africa's community finance sector manages significant economic activity, yet much of that activity remains fragmented, poorly digitized, difficult to measure, and difficult for formal capital providers to underwrite.

TITech is building the infrastructure layer that makes community financial activity:

* **Digital**
* **Measurable**
* **Auditable**
* **Interoperable**
* **Risk-aware**
* **Payment-enabled**
* **Institutionally financeable**

Subject to authorization, privacy requirements, applicable law, and regulatory controls, institutions operating on TITech can participate in a **permissioned financial data and intelligence network** that transforms previously difficult-to-observe community cash flows into structured financial information.

---

## 🚀 Project Status

**Status:** Active Development / Production Hardening
**Version:** 2.1
**Organization:** TITech Community Capital LTD
**Last Updated:** September 2026

TITech has evolved beyond a basic community savings application toward a broader financial infrastructure platform incorporating:

**Community Finance + Wallets + Transactions + Ledger + Loans + Reconciliation + Payments + KYC/AML + Risk + Fraud + Observability + Enterprise Infrastructure**

Individual capabilities can have different implementation, testing, operational, security, and regulatory maturity. Repository implementation and verification artifacts remain the source of truth for actual production readiness.

---

## 🌍 Vision

TITech's long-term objective is to become a foundational **community-finance infrastructure platform for Africa and emerging markets**.

The platform is being engineered around a simple proposition:

> **If community financial activity can be digitized, reconciled, understood, trusted and connected to capital, previously underserved communities can become more visible participants in the formal financial economy.**

TITech therefore goes beyond a conventional savings application.

The broader platform direction is:

```text
Community Finance
       │
       ▼
Payments
       │
       ▼
Ledger & Reconciliation
       │
       ▼
Risk & Fraud Intelligence
       │
       ▼
KYC / AML
       │
       ▼
Credit Infrastructure
       │
       ▼
Institutional Capital
```

---

## 🎯 What TITech Does

### Community Finance

* Group and institution management
* Member management
* Savings and contribution management
* Member wallets and balances
* Financial transactions
* Recurring contributions
* Loan origination and repayment workflows
* Financial reporting
* Notifications and communication
* Multi-tenant architecture
* Mobile-responsive experiences
* Offline-aware workflows

### Financial Infrastructure

* Transaction orchestration
* Idempotent financial operations
* Atomic database transactions
* Ledger mutation controls
* Balance integrity controls
* Reconciliation workflows
* Settlement-oriented architecture
* Financial auditability
* Transaction observability
* Operational health monitoring
* Repository/service separation

### Risk & Compliance Infrastructure

* KYC workflows
* AML-oriented controls
* RBAC and permission management
* Fraud-risk foundations
* Risk intelligence
* Audit logging
* Security controls
* Regulatory reporting foundations
* Enterprise observability

### Payments

The architecture is designed to support integrations with payment and mobile-money providers, including African mobile-money ecosystems.

Potential providers include:

* MTN Mobile Money
* Airtel Money
* M-Pesa
* Other regional payment providers

> **Important:** Production payment availability depends on provider agreements, supported products, country-specific infrastructure, licensing, compliance requirements, and regulatory authorization.

---

## 🏗️ Platform Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                    TITech Community Capital                  │
│                                                               │
│       African Community Finance Infrastructure               │
└───────────────────────────────────────────────────────────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
      Community Layer   Financial Layer   Intelligence Layer
             │                │                │
             │                │                ├── Risk
             │                │                ├── Fraud
             │                │                ├── Analytics
             │                │                └── AI / ML
             │                │
             │                ├── Wallets
             │                ├── Transactions
             │                ├── Ledger
             │                ├── Loans
             │                ├── Contributions
             │                ├── Reconciliation
             │                └── Settlement
             │
             ├── SACCOs
             ├── VSLAs
             ├── Savings Groups
             ├── Cooperatives
             └── Community Enterprises
                              │
                              ▼
                    Payments & External Systems
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
       Mobile Money      Banking APIs     Institutional
        Providers        & Payments      Capital Providers
                              │
                              ▼
                    Compliance & Governance
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
            KYC              AML              Audit
                              │
                              ▼
                     Regulatory Reporting
```

---

# 🧩 System Components

```text
TITech Community Capital
│
├── Frontend
│   ├── React
│   ├── Vite
│   ├── React Router
│   ├── Enterprise UI Components
│   ├── Financial Dashboards
│   ├── Offline-aware UX
│   └── Role / Permission-aware Views
│
├── Backend
│   ├── Node.js
│   ├── Express
│   ├── Mongoose
│   ├── REST APIs
│   ├── Authentication
│   ├── Authorization
│   ├── Financial Services
│   ├── Repositories
│   ├── Validation
│   ├── Idempotency
│   └── Error Handling
│
├── Financial Core
│   ├── Wallets
│   ├── Transactions
│   ├── Ledger
│   ├── Balances
│   ├── Contributions
│   ├── Loans
│   ├── Reconciliation
│   ├── Settlement
│   └── Financial Operations
│
├── Risk & Compliance
│   ├── KYC
│   ├── AML
│   ├── Fraud Controls
│   ├── Risk Intelligence
│   ├── Audit Logs
│   └── Regulatory Reporting
│
├── Integration Layer
│   ├── Mobile Money
│   ├── Payment Providers
│   ├── Email
│   ├── Notifications
│   └── External APIs
│
└── Infrastructure
    ├── MongoDB
    ├── Redis
    ├── Docker
    ├── GitHub Actions
    ├── Observability
    ├── Health Checks
    └── Cloud Deployment
```

---

# ⚙️ Financial Integrity Architecture

Financial systems require stronger guarantees than ordinary CRUD applications.

TITech treats financial mutations as controlled operations.

A typical operation follows this conceptual boundary:

```text
Request
   │
   ▼
Authentication
   │
   ▼
Authorization
   │
   ▼
Validation
   │
   ▼
Idempotency Check
   │
   ▼
Financial Operation
   │
   ├── Transaction
   ├── Ledger Mutation
   ├── Balance Mutation
   └── Audit Event
   │
   ▼
Atomic Commit
   │
   ▼
Observability / Metrics
   │
   ▼
Response
```

### Financial Integrity Principles

TITech emphasizes:

* **Atomicity**
* **Idempotency**
* **Consistency**
* **Auditability**
* **Traceability**
* **Explicit financial boundaries**
* **Conditional balance mutations**
* **MongoDB session-aware transactions**
* **Repository/service separation**
* **Deterministic financial operations**

A wallet debit, for example, must not successfully mutate the ledger while leaving the balance unchanged.

Where supported by the database deployment, related financial mutations are intended to execute within a controlled transaction boundary.

External side effects such as mobile-money requests, notifications, email delivery, and provider APIs should be handled through appropriate orchestration, queue, outbox, callback, and reconciliation patterns rather than being treated as ordinary database mutations.

---

# 🔐 Security Architecture

Security is treated as a platform capability rather than an afterthought.

Current security architecture includes:

* JWT authentication
* Refresh-token architecture
* Password hashing
* Role-Based Access Control
* Permission-aware endpoints
* Input validation
* Request validation
* Environment-based secrets
* Security headers
* Audit logging
* Error-handling boundaries
* Dependency/security scanning
* Idempotency controls for sensitive operations
* Financial transaction integrity controls

Sensitive configuration must be supplied through environment variables or secure deployment configuration.

> **Never commit credentials, private keys, API secrets, provider secrets, or production database credentials to Git.**

See:

* [`SECURITY.md`](SECURITY.md)
* [`docs/PRODUCTION_VERIFICATION_CHECKLIST.md`](docs/PRODUCTION_VERIFICATION_CHECKLIST.md)

---

# 👥 Multi-Tenant Architecture

TITech is designed around **multi-tenant financial infrastructure**.

The target architecture allows multiple institutions to operate on a common platform while maintaining logical data boundaries.

```text
TITech Platform
│
├── Tenant A
│   ├── Users
│   ├── Groups
│   ├── Members
│   ├── Transactions
│   └── Financial Records
│
├── Tenant B
│   ├── Users
│   ├── Groups
│   ├── Members
│   ├── Transactions
│   └── Financial Records
│
└── Tenant C
    ├── Users
    ├── Groups
    ├── Members
    ├── Transactions
    └── Financial Records
```

Tenant isolation, authorization, data-access controls, and cross-tenant query prevention must be continuously validated as the platform evolves.

---

# 📱 Offline-First Direction

Community finance infrastructure in Africa must account for inconsistent connectivity.

TITech therefore incorporates an **offline-aware architecture** designed to support resilient user experiences where connectivity cannot be assumed.

The broader direction includes:

* Offline state awareness
* Local operation queues
* Synchronization
* Retry handling
* Conflict detection
* Idempotent replay
* Network-aware UX
* Reliable financial synchronization

> **Financial operations must never be treated as server-confirmed merely because an operation was queued locally. Server-side confirmation remains authoritative.**

---

# 🧪 Testing & Quality Engineering

TITech uses automated testing as part of the engineering lifecycle.

Testing areas include:

* Unit tests
* Integration tests
* Authentication tests
* Contribution tests
* Group-management tests
* Loan tests
* Financial-service tests
* API tests
* Migration tests
* Idempotency tests
* Offline synchronization tests
* Provider callback tests
* Infrastructure validation
* Security validation

Run the standard suite with:

```bash
make test
```

Backend tests:

```bash
make test-backend
```

Coverage:

```bash
make test-coverage
```

Complete quality validation:

```bash
make quality
```

> Test counts and coverage percentages are deliberately not hard-coded in this README. They should be generated from the current repository and CI environment.

---

# 🚦 CI/CD

TITech uses GitHub Actions to automate engineering quality and delivery controls.

The intended pipeline includes:

```text
Git Push / Pull Request
          │
          ▼
    Dependency Setup
          │
          ▼
    Static Validation
          │
          ▼
  Lint / Formatting
          │
          ▼
       Testing
          │
          ▼
   Build Validation
          │
          ▼
 Security Validation
          │
          ▼
 Docker Validation
          │
          ▼
 Release / Deploy
```

Repository workflows are located under:

```text
.github/workflows/
```

The active workflows are the source of truth for the exact CI/CD jobs and gates.

---

# 🐳 Docker

Build the platform:

```bash
make docker-build
```

Start services:

```bash
make docker-up
```

View logs:

```bash
make docker-logs
```

Stop services:

```bash
make docker-down
```

Typical local services may include:

```text
Frontend      → localhost:3000
Backend API   → localhost:5000
MongoDB       → localhost:27017
Redis         → localhost:6379
Nginx         → localhost:80
```

Actual ports depend on the active Docker Compose configuration and environment.

---

# 🚀 Quick Start

## Prerequisites

Recommended development environment:

* Node.js 20+
* npm
* Git
* MongoDB
* Redis
* Docker / Docker Compose
* Make

Verify Node.js:

```bash
node --version
```

Verify npm:

```bash
npm --version
```

---

## One-Command Installation

```bash
make install
```

---

## Start Development

Start the complete development environment:

```bash
make dev
```

Start the backend independently:

```bash
make dev-backend
```

Start the frontend independently:

```bash
make dev-frontend
```

---

# 🛠️ Developer Commands

## Installation

```bash
make install
make install-backend
make install-frontend
```

## Development

```bash
make dev
make dev-backend
make dev-frontend
```

## Quality

```bash
make lint
make lint-fix
make format
make quality
```

## Testing

```bash
make test
make test-backend
make test-unit
make test-coverage
```

## Docker

```bash
make docker-build
make docker-up
make docker-down
make docker-logs
```

Use:

```bash
make help
```

to inspect the commands currently exposed by the Makefile.

> The Makefile is the source of truth for supported command names. This README intentionally avoids hard-coded command counts.

---

# 🌐 Environment Configuration

## Backend

Create the backend environment configuration using the repository's environment template where available.

Example development configuration:

```env
NODE_ENV=development
PORT=5000
HOST=0.0.0.0

MONGODB_URI=mongodb://127.0.0.1:27017/community_savings
REDIS_URL=redis://127.0.0.1:6379

JWT_SECRET=replace-with-a-secure-secret
JWT_REFRESH_SECRET=replace-with-a-secure-refresh-secret
```

Production deployments should use managed secrets or a secure deployment configuration mechanism instead of committing `.env` files.

## Frontend

Example:

```env
VITE_API_URL=http://localhost:5000
VITE_ENVIRONMENT=development
```

Frontend environment variables must not contain secrets.

Anything prefixed with `VITE_` may be exposed to the client application.

---

# 🗄️ Data Architecture

TITech uses MongoDB through Mongoose.

The backend follows a layered architecture:

```text
Routes
  │
  ▼
Controllers
  │
  ▼
Services
  │
  ▼
Repositories
  │
  ▼
Models
  │
  ▼
MongoDB
```

Financial domains receive additional separation:

```text
Financial Operation
        │
        ├── Idempotency
        ├── Transaction
        ├── Ledger
        ├── Balance
        ├── Audit
        └── Observability
```

This reduces direct database manipulation from controllers and makes financial behavior easier to test, reason about, reconcile, and audit.

---

# 📊 Observability

Production financial infrastructure requires more than application logs.

TITech's architecture includes observability around:

* Application health
* Financial operations
* API behavior
* Errors
* Performance
* Transaction processing
* Background operations
* Infrastructure lifecycle
* Operational metrics

The platform is designed toward Prometheus-compatible metrics and enterprise monitoring integrations.

Recommended observability layers include:

```text
Application Logs
       +
Metrics
       +
Health Checks
       +
Audit Events
       +
Distributed Tracing
       +
Alerting
```

---

# 💳 Payments & Mobile Money

TITech is designed to operate as an orchestration layer between community financial institutions and external payment systems.

Conceptually:

```text
Member
  │
  ▼
TITech
  │
  ├── Financial Operation
  ├── Idempotency
  ├── Ledger
  ├── Balance
  ├── Reconciliation
  │
  ▼
Payment / Mobile Money Provider
  │
  ▼
Provider Callback
  │
  ▼
TITech Reconciliation
```

Provider integrations must account for:

* Authentication
* Callback verification
* Idempotency
* Duplicate callbacks
* Timeouts
* Retries
* Reconciliation
* Settlement
* Provider outages
* Transaction state transitions
* Regulatory requirements

External provider responses should not automatically be treated as final financial settlement without appropriate reconciliation and state validation.

---

# 🏦 Credit & Risk Intelligence

TITech's long-term opportunity extends beyond savings.

Digitized community financial behavior can potentially support improved risk assessment, subject to consent, privacy requirements, regulatory obligations, data governance, and model controls.

Potential intelligence layers include:

```text
Savings Behavior
       │
       ▼
Contribution History
       │
       ▼
Repayment Behavior
       │
       ▼
Cash-Flow Patterns
       │
       ▼
Transaction History
       │
       ▼
Risk Intelligence
       │
       ├── Risk Scoring
       ├── Fraud Signals
       ├── Portfolio Analytics
       ├── Credit Underwriting
       └── Capital Allocation
```

TITech does **not** equate data availability with automatic creditworthiness.

Production credit decisioning should incorporate:

* Explainability
* Consent
* Fairness
* Data minimization
* Regulatory compliance
* Human or operational oversight where appropriate
* Model monitoring
* Appropriate risk controls

---

# 🌍 African Market Opportunity

TITech is being developed for markets where community finance is economically important while digital financial infrastructure remains fragmented.

Potential customer segments include:

### Community Organizations

* SACCOs
* VSLAs
* Savings groups
* Cooperatives
* Chamas
* Community associations

### Financial Institutions

* Microfinance institutions
* Credit unions
* Digital lenders
* Banks
* Fintechs

### Institutional Partners

* NGOs
* Development-finance organizations
* Impact investors
* Government programs
* Financial inclusion initiatives
* Agricultural-finance programs

### Enterprise Customers

* Employers
* Cooperatives
* Community enterprises
* Merchant networks
* Distributed workforces

---

# 💼 Platform Business Model

Potential revenue streams include:

## SaaS

Subscription plans for institutions based on factors such as:

* Members
* Groups
* Transactions
* Features
* Compliance requirements
* Institution size

## Payments

Potential transaction-based revenue through eligible payment infrastructure and provider partnerships.

## Financial Infrastructure

Potential revenue from:

* Reconciliation
* Financial APIs
* Enterprise integrations
* Reporting
* Risk infrastructure
* Institutional tooling

## Data & Intelligence

Subject to applicable law, consent, privacy, and governance:

* Portfolio intelligence
* Risk analytics
* Institutional reporting
* Benchmarking
* Financial insights

## Capital Connectivity

Long-term potential to connect qualified community financial institutions and enterprises with appropriate sources of capital.

---

# 🧭 Product Evolution

TITech is progressing toward broader financial infrastructure.

```text
Stage 1
Community Savings
       │
       ▼
Stage 2
Digital Financial Infrastructure
       │
       ▼
Stage 3
Payments + Ledger + Reconciliation
       │
       ▼
Stage 4
Risk + KYC + AML + Fraud Intelligence
       │
       ▼
Stage 5
Institutional Credit Infrastructure
       │
       ▼
Stage 6
Capital Connectivity
       │
       ▼
Stage 7
African Community Finance Network
```

---

# 📚 Documentation

The `docs/` directory contains project documentation.

### Getting Started

* [`docs/DOCUMENTATION_INDEX.md`](docs/DOCUMENTATION_INDEX.md)
* [`docs/PRODUCTION_READY_README.md`](docs/PRODUCTION_READY_README.md)

### Production

* [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)
* [`docs/PRODUCTION_READINESS_SUMMARY.md`](docs/PRODUCTION_READINESS_SUMMARY.md)
* [`docs/PRODUCTION_VERIFICATION_CHECKLIST.md`](docs/PRODUCTION_VERIFICATION_CHECKLIST.md)

### Engineering

* [`docs/GIT_COMMIT_GUIDE.md`](docs/GIT_COMMIT_GUIDE.md)
* [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md)

### Platform & Legal

* [`docs/LEGAL_PAGE_IMPLEMENTATION.md`](docs/LEGAL_PAGE_IMPLEMENTATION.md)

### CI/CD

* [`docs/GITHUB_ACTIONS_FIX.md`](docs/GITHUB_ACTIONS_FIX.md)

### Project Review / Submission

* [`docs/CONTEST_SUBMISSION_SUMMARY.md`](docs/CONTEST_SUBMISSION_SUMMARY.md)

---

# 🔍 Repository Structure

A simplified representation:

```text
society-community-savings-app/
│
├── backend/
│   ├── bootstrap/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── repositories/
│   ├── routes/
│   ├── services/
│   ├── scripts/
│   └── tests/
│
├── community-savings-app-frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── services/
│   │   └── ...
│   └── tests/
│
├── docs/
├── .github/
│   └── workflows/
├── docker/
├── Makefile
├── README.md
├── SECURITY.md
└── LICENSE
```

The exact repository structure may evolve as the platform is modularized.

---

# 🤝 Contributing

Contributions are welcome.

## Development Workflow

1. Fork the repository.
2. Create a feature branch.
3. Implement the change.
4. Add or update tests.
5. Run quality checks.
6. Commit using a clear message.
7. Push the branch.
8. Open a Pull Request.

Example:

```bash
git checkout -b feature/my-feature
```

Before submitting:

```bash
make quality
```

### Financial Code Changes

Changes affecting:

* Balances
* Wallets
* Transactions
* Ledger entries
* Loans
* Payments
* Reconciliation
* Settlement
* Idempotency
* Authentication
* Authorization

should include appropriate automated tests and receive additional review.

---

# 🔒 Responsible Financial Technology

TITech is financial infrastructure software.

Production deployment must therefore be accompanied by appropriate:

* Legal review
* Regulatory review
* Data-protection controls
* KYC/AML procedures
* Financial controls
* Payment-provider agreements
* Security assessments
* Disaster-recovery procedures
* Operational controls
* Incident-response procedures

> **Software readiness does not by itself constitute regulatory authorization, financial licensing, payment-provider approval, or permission to operate as a regulated financial institution.**

Organizations deploying TITech remain responsible for complying with applicable laws and regulations in their operating jurisdictions.

---

# 🚢 Deployment

TITech can be deployed across multiple environments depending on operational requirements.

## Local Development

```bash
make install
make dev
```

## Docker

```bash
make docker-build
make docker-up
```

## Cloud

The architecture can be adapted for environments such as:

* AWS
* Azure
* Google Cloud
* DigitalOcean
* Render
* Vercel

Cloud deployments should use environment-specific configuration, managed secrets, monitoring, backups, network controls, and appropriate security policies.

See:

[`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)

---

# 🛡️ Production Readiness

TITech should be evaluated across multiple dimensions rather than using a single "production ready" label.

| Area           | Objective                                              |
| -------------- | ------------------------------------------------------ |
| Application    | Stable core workflows                                  |
| Financial Core | Atomic and auditable financial operations              |
| Security       | Authentication, authorization and secure configuration |
| Data           | Integrity, backups and recovery                        |
| Payments       | Provider integration and reconciliation                |
| Compliance     | Jurisdiction-specific regulatory controls              |
| Observability  | Logs, metrics, health and alerts                       |
| Infrastructure | Repeatable deployment                                  |
| Resilience     | Failure handling and recovery                          |
| Testing        | Automated regression protection                        |
| Operations     | Monitoring and incident response                       |
| Governance     | Access, audit and change control                       |

## Production Gate

Before a production financial deployment, validate:

```text
☐ Environment configuration
☐ Database connectivity
☐ Database indexes
☐ Financial transaction integrity
☐ Idempotency
☐ Authentication
☐ Authorization
☐ KYC / AML workflows
☐ Payment callbacks
☐ Reconciliation
☐ Backups
☐ Restore procedure
☐ Monitoring
☐ Alerting
☐ Security scanning
☐ Load / stress testing
☐ Disaster recovery
☐ Regulatory requirements
☐ Incident response
☐ Production verification checklist
```

---

# 📈 Current Engineering Direction

The project is transitioning from a community savings application toward broader **financial infrastructure**.

## Immediate Priorities

* Stabilize application bootstrap
* Keep frontend/backend dependencies deterministic
* Maintain reliable financial transaction boundaries
* Complete financial-domain automated tests
* Strengthen offline synchronization
* Harden provider callback processing
* Validate migration tooling
* Improve backup/restore procedures
* Strengthen security validation
* Maintain CI/CD reliability

## Next Priorities

* Database performance and scaling
* Redis-backed infrastructure where justified
* Payment-provider integrations
* Mobile-money integrations
* Stress and resilience testing
* Production observability
* Enterprise dashboards
* Feature flags
* Advanced reconciliation

## Strategic Priorities

* Institutional APIs
* Credit and risk infrastructure
* Advanced fraud intelligence
* Capital-provider integrations
* Cross-institution analytics
* Regional expansion
* Partner ecosystem
* Developer/API platform

---

# 🧠 Engineering Principles

### 1. Financial correctness before convenience

A fast incorrect financial transaction is worse than a slow failed transaction.

### 2. Server authority

Client-side state is never treated as authoritative for financial truth.

### 3. Idempotency by design

Retrying a financial request must not unintentionally create duplicate financial effects.

### 4. Auditability

Important financial and administrative actions should be traceable.

### 5. Explicit boundaries

Financial operations should have clear service and repository boundaries.

### 6. Secure by default

Secrets, permissions, and sensitive operations must be protected by default.

### 7. Observable systems

Critical operations should produce sufficient operational signals to diagnose failures.

### 8. Resilience by design

Critical infrastructure must account for retries, timeouts, duplicate events, partial failures, and recovery.

### 9. Africa-first, globally extensible

The platform is designed around African community-finance realities while maintaining an architecture capable of supporting broader emerging-market use cases.

---

# 📞 Support

### Documentation

Start with:

[`docs/DOCUMENTATION_INDEX.md`](docs/DOCUMENTATION_INDEX.md)

### Deployment

See:

[`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)

### Security

See:

[`SECURITY.md`](SECURITY.md)

### Issues

Use GitHub Issues for:

* Bug reports
* Feature requests
* Engineering problems
* Documentation improvements

### Discussions

Use GitHub Discussions for:

* Architecture discussions
* Product ideas
* Community feedback
* Collaboration

---

# 📜 License

TITech Community Capital is released under the MIT License.

See [`LICENSE`](LICENSE) for the complete license text.

---

# 🏁 Project Status

**TITech Community Capital is an actively evolving financial technology platform.**

The project has progressed beyond a basic community savings application toward a modular architecture incorporating:

**Community Finance + Financial Transactions + Ledger + Wallets + Loans + Reconciliation + Payments + KYC/AML + Risk + Fraud + Observability + Enterprise Infrastructure**

Capabilities may have different implementation, testing, operational, and regulatory maturity levels.

Always verify:

* Current repository implementation
* Automated test status
* CI/CD status
* Security validation
* Production verification checklist
* Regulatory requirements

before describing any capability as production-ready.

---

# 🎯 Getting Started in 3 Steps

### 1. Install

```bash
make install
```

### 2. Start

```bash
make dev
```

### 3. Verify

```bash
make quality
```

Then open the frontend using the URL reported by the active development server.

---

# 🌍 Building the Financial Infrastructure for Africa

TITech's ambition is larger than digitizing savings groups.

The objective is to build infrastructure that allows community financial activity to become:

```text
VISIBLE
   ↓
DIGITAL
   ↓
STRUCTURED
   ↓
VERIFIABLE
   ↓
RISK-AWARE
   ↓
FINANCEABLE
   ↓
CONNECTED TO CAPITAL
```

> **TITech Community Capital — turning Africa's community financial activity into trusted digital financial infrastructure.**

---

**Version:** 2.1
**Status:** Active Development / Production Hardening
**Last Updated:** September 2026
**Organization:** TITech Community Capital LTD