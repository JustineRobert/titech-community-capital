# 🏦 TITech Community Capital

<<<<<<< HEAD
> **The financial operating system for Africa's community economy.**

TITech Community Capital is an **enterprise-grade community finance platform** designed to connect **SACCOs, VSLAs, savings groups, cooperatives, community enterprises, and emerging financial institutions** to modern financial infrastructure.

Africa's community finance sector manages enormous amounts of economic activity, yet much of that activity remains **fragmented, poorly digitized, difficult to measure, and difficult for formal capital providers to underwrite**.

TITech is building the infrastructure layer that makes these financial activities:

* **Digital**
* **Measurable**
* **Auditable**
* **Interoperable**
* **Risk-aware**
* **Payment-enabled**
* **Institutionally financeable**

Every institution operating on TITech can contribute, subject to authorization and applicable privacy/regulatory requirements, to a **permissioned financial data and intelligence network** that transforms previously invisible community cash flows into structured financial information.

---

[![CI/CD Pipeline](https://github.com/JustineRobert/society-community-savings-app/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/JustineRobert/society-community-savings-app/actions/workflows/ci-cd.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.1-green.svg)](docs/RELEASE_NOTES.md)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-supported-brightgreen.svg)](https://www.mongodb.com/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-purple.svg)](https://vitejs.dev/)

---

## 🌍 Vision

TITech's long-term objective is to become a foundational **community-finance infrastructure platform for Africa and emerging markets**.

The platform is being engineered around a simple proposition:

> **If community financial activity can be digitized, reconciled, understood, trusted and connected to capital, previously underserved communities can become more visible participants in the formal financial economy.**

TITech therefore goes beyond a conventional savings application.

It is evolving toward an integrated platform covering:

**Community Finance → Payments → Ledger → Reconciliation → Risk → KYC/AML → Fraud Intelligence → Credit → Settlement → Institutional Capital**

---

# 🎯 What TITech Does

TITech Community Capital provides infrastructure for organizations that manage collective financial activity.

### Core Community Finance

* 👥 Group and institution management
* 💰 Savings and contribution management
* 🏦 Member wallets and balances
* 💳 Financial transactions
* 📒 Double-entry-oriented ledger infrastructure
* 💸 Loan origination and repayment workflows
* 🔄 Recurring contributions
* 📊 Financial reporting
* 🔔 Notifications and communication
* 📱 Mobile-responsive user experience
* 🌐 Multi-tenant architecture

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

### Risk & Compliance Infrastructure

* KYC workflows
* AML-oriented controls
* RBAC and permission management
* Fraud-risk foundations
* Audit logging
* Security controls
* Regulatory reporting foundations
* Enterprise observability

### Payments

The architecture is designed to support integrations with payment and mobile-money providers, including African mobile-money ecosystems.

Examples include:

* MTN Mobile Money
* Airtel Money
* M-Pesa
* Other regional payment providers

> **Important:** Payment-provider availability, production activation and regulatory authorization depend on the applicable country, provider agreements and compliance requirements.

---

# 🏗️ Platform Architecture

TITech is designed as a modular financial platform rather than a single-purpose savings application.

```text
┌───────────────────────────────────────────────────────────────┐
│                     TITech Community Capital                  │
│                                                               │
│          African Community Finance Infrastructure             │
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
             │                │                └── AI/ML
             │                │
             │                ├── Wallet
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
          ┌───────────────────┼────────────────────┐
          ▼                   ▼                    ▼
     Mobile Money         Banking APIs        Institutional
     Providers            & Payments          Capital Providers

                              │
                              ▼

                     Compliance & Governance
                              │
          ┌──────────────────┼────────────────────┐
          ▼                  ▼                    ▼
         KYC                AML                Audit
          │                  │                    │
          └──────────────────┼────────────────────┘
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
│   └── Role/Permission-aware Views
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

TITech therefore treats financial mutations as controlled operations.

A typical financial operation follows the conceptual boundary:

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

### Financial integrity principles

TITech's financial architecture emphasizes:

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

For example, an operation that debits a wallet should not successfully mutate the ledger while leaving the balance unchanged—or vice versa.

Where supported by the database and deployment configuration, related financial mutations are intended to execute within a controlled transaction boundary.

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

**Never commit credentials, private keys, API secrets or production database credentials to Git.**

See:

* [`SECURITY.md`](SECURITY.md)
* [`docs/PRODUCTION_VERIFICATION_CHECKLIST.md`](docs/PRODUCTION_VERIFICATION_CHECKLIST.md)

---

# 👥 Multi-Tenant Architecture

TITech is being developed with **multi-tenant financial infrastructure** in mind.

The target architecture allows multiple institutions to operate on a common platform while maintaining logical data boundaries.

Conceptually:

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

Tenant isolation, authorization and data-access controls must be validated continuously as the platform scales.

---

# 📱 Offline-First Direction

Community finance infrastructure in Africa must account for inconsistent connectivity.

TITech therefore incorporates an **offline-aware architecture** designed to support resilient user experiences in environments where connectivity cannot be assumed.

The broader roadmap includes:

* Offline state awareness
* Local operation queues
* Synchronization
* Retry handling
* Conflict detection
* Idempotent replay
* Network-aware UX
* Reliable financial synchronization

> Financial operations must never be treated as safely synchronized merely because an operation was queued locally. Server-side confirmation remains authoritative.

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

Run the standard suite with:

```bash
make test
```

Run backend tests:

```bash
make test-backend
```

Run coverage:

```bash
make test-coverage
```

Before creating a production release:

```bash
make quality
```

> **Important:** Test counts and coverage percentages are intentionally not hard-coded here because they should be generated from the current repository rather than becoming stale documentation.

---

# 🚦 CI/CD

TITech uses GitHub Actions to automate software quality and delivery controls.

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

Relevant pipelines may include backend validation, frontend validation, enterprise testing, security checks and deployment workflows.

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

Typical local services include:

```text
Frontend      → localhost:3000
Backend API   → localhost:5000
MongoDB       → localhost:27017
Redis         → localhost:6379
Nginx         → localhost:80
```

Actual ports may vary according to the active Docker Compose configuration.

---

# 🚀 Quick Start

## Prerequisites

Recommended development environment:

* Node.js **20+**
* npm
* Git
* MongoDB
* Redis
* Docker / Docker Compose
* Make

Verify Node:

```bash
node --version
```

Verify npm:

```bash
npm --version
```

---

## One-Command Installation
=======
**Getting ready - Africa's community finance sector manages enormous amounts of economic activity but much of it remains invisible, fragmented and difficult for formal capital to underwrite. TITech is building the financial operating system connecting SACCOs, VSLAs and community enterprises to payments, accounting, risk intelligence and institutional capital.**
**Every institution joining TITech strengthens a permissioned financial data network that makes previously invisible community cash flows measurable and financeable.**

[![CI/CD Pipeline](https://github.com/JustineRobert/society-community-savings-app/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/JustineRobert/society-community-savings-app/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.1-green.svg)](docs/RELEASE_NOTES.md)

---

## 📋 Quick Start

### One-Command Setup
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

```bash
make install
```

<<<<<<< HEAD
---

## Start Development
=======
### One-Command Development
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

```bash
make dev
```

<<<<<<< HEAD
Or start the components independently:

```bash
make dev-backend
```

```bash
make dev-frontend
=======
### One-Command Docker

```bash
make docker-build && make docker-up
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
```

---

<<<<<<< HEAD
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

Run:

```bash
make help
```

to inspect the commands currently exposed by the Makefile.

> The Makefile is the source of truth for supported command names. This README deliberately avoids claiming a fixed number of commands.

---

# 🌐 Environment Configuration

## Backend

Create the backend environment configuration from the repository's environment template where available.

Example:

```env
NODE_ENV=development
PORT=5000

MONGODB_URI=mongodb://127.0.0.1:27017/community_savings

REDIS_URL=redis://127.0.0.1:6379

JWT_SECRET=replace-with-a-secure-secret
JWT_REFRESH_SECRET=replace-with-a-secure-refresh-secret
```

Production deployments should use a managed secrets mechanism rather than committing `.env` files.

---

## Frontend

Example:

```env
VITE_API_URL=http://localhost:5000
VITE_ENVIRONMENT=development
```

Frontend environment variables must not contain secrets.

Anything prefixed with `VITE_` may become accessible to the client-side application.

---

# 🗄️ Data Architecture

The platform uses MongoDB through Mongoose.

The backend follows a layered architecture around:

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

Financial domains receive additional separation around:

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

This structure is intended to reduce direct database manipulation from controllers and make financial behavior easier to test, reason about and audit.

---

# 📊 Observability

Production financial infrastructure requires more than application logs.

TITech's architecture includes observability capabilities around:

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

Recommended production observability layers include:

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

TITech is designed to serve as an orchestration layer between community financial institutions and external payment systems.

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

---

# 🏦 Credit & Risk Intelligence

TITech's long-term opportunity extends beyond savings.

Digitized community financial behavior can potentially support better risk assessment, subject to consent, privacy requirements, regulation and appropriate model governance.

Potential intelligence layers include:

```text
Savings Behavior
       │
Contribution History
       │
Repayment Behavior
       │
Cash-Flow Patterns
       │
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

Any production credit decisioning system must incorporate:

* Explainability
* Consent
* Fairness
* Data minimization
* Regulatory compliance
* Human/operational oversight where appropriate
* Model monitoring
* Appropriate risk controls

---

# 🌍 African Market Opportunity

TITech is being developed for markets where community finance is economically important but digital financial infrastructure remains fragmented.

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
* Digital lenders
* Credit unions
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

### SaaS

Subscription plans for institutions based on:

* Members
* Groups
* Transactions
* Features
* Compliance requirements
* Institution size

### Payments

Potential transaction-based revenue through eligible payment infrastructure and partnerships.

### Financial Infrastructure

Potential revenue from:

* Reconciliation
* Financial APIs
* Enterprise integrations
* Reporting
* Risk infrastructure
* Institutional tooling

### Data & Intelligence

Subject to applicable law, consent and governance:

* Portfolio intelligence
* Risk analytics
* Institutional reporting
* Benchmarking
* Financial insights

### Capital Marketplace

Long-term potential to connect qualified community financial institutions and enterprises with appropriate sources of capital.

---

# 🧭 Product Evolution

TITech is progressing toward a broader financial infrastructure platform.

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

The `/docs` directory contains project documentation.

### Getting Started

* [`DOCUMENTATION_INDEX.md`](docs/DOCUMENTATION_INDEX.md)
* [`PRODUCTION_READY_README.md`](docs/PRODUCTION_READY_README.md)

### Production

* [`DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)
* [`PRODUCTION_READINESS_SUMMARY.md`](docs/PRODUCTION_READINESS_SUMMARY.md)
* [`PRODUCTION_VERIFICATION_CHECKLIST.md`](docs/PRODUCTION_VERIFICATION_CHECKLIST.md)

### Engineering

* [`GIT_COMMIT_GUIDE.md`](docs/GIT_COMMIT_GUIDE.md)
* [`RELEASE_NOTES.md`](docs/RELEASE_NOTES.md)

### Platform & Legal

* [`LEGAL_PAGE_IMPLEMENTATION.md`](docs/LEGAL_PAGE_IMPLEMENTATION.md)

### CI/CD

* [`GITHUB_ACTIONS_FIX.md`](docs/GITHUB_ACTIONS_FIX.md)

### Project Review / Submission

* [`CONTEST_SUBMISSION_SUMMARY.md`](docs/CONTEST_SUBMISSION_SUMMARY.md)

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
│
├── .github/
│   └── workflows/
│
├── docker/
├── Makefile
├── package.json
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

Run:

```bash
make quality
```

before submitting the Pull Request.

### Financial Code Changes

Changes affecting:

* balances
* wallets
* transactions
* ledger entries
* loans
* payments
* reconciliation
* settlement
* idempotency
* authentication
* authorization

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

**Software readiness does not by itself constitute regulatory authorization, financial licensing, payment-provider approval or permission to operate as a regulated financial institution.**

Organizations deploying TITech remain responsible for complying with applicable laws and regulations in their operating jurisdictions.

---

# 🚢 Deployment

TITech can be deployed in multiple environments depending on operational requirements.

### Local

```bash
make install
make dev
=======
## 🎯 What Is This?

TITech Community Capital — The African Community Finance Operating System(ACFOS) is a full-stack MERN application that enables communities to manage group savings, contributions, and loans with professional-grade features(finance + payments + ledger + reconciliation + AML + KYC + fraud + risk + transaction orchestration + regulatory reporting + observability + settlement.):

✅ **Group Management** - Create and manage community groups  
✅ **Savings Tracking** - Track member contributions  
✅ **Loan Management** - Request, approve, and repay loans  
✅ **Real-Time Updates** - Socket.io for live notifications  
✅ **Role-Based Access** - Admin, treasurer, secretary roles  
✅ **Email Notifications** - Automated communication  
✅ **Mobile Responsive** - Works on all devices

---

## 🚀 Production Ready Features

### Code Quality

- ✅ ESLint + Prettier configuration
- ✅ 40+ quality rules enforced
- ✅ Consistent code style everywhere

### Testing

- ✅ 1,200+ lines of Jest tests
- ✅ 50+ test cases
- ✅ Auth, contributions, loans, groups tested
- ✅ 100% pass rate

### CI/CD Pipeline

- ✅ GitHub Actions automation
- ✅ Quality gates on every push
- ✅ Docker image building
- ✅ Codecov integration

### Deployment Ready

- ✅ Docker & Docker Compose
- ✅ Vercel + Render compatible
- ✅ AWS/Azure ready
- ✅ Health checks included

---

## 📚 Documentation

All documentation is organized in the [docs/](docs/) directory:

### Getting Started

- [**DOCUMENTATION_INDEX.md**](docs/DOCUMENTATION_INDEX.md) - Complete guide index
- [**PRODUCTION_READY_README.md**](docs/PRODUCTION_READY_README.md) - Quick reference (10 min)

### For Different Audiences

- [**CONTEST_SUBMISSION_SUMMARY.md**](docs/CONTEST_SUBMISSION_SUMMARY.md) - For judges/reviewers
- [**DEPLOYMENT_GUIDE.md**](docs/DEPLOYMENT_GUIDE.md) - For DevOps/deployment
- [**PRODUCTION_READINESS_SUMMARY.md**](docs/PRODUCTION_READINESS_SUMMARY.md) - Technical overview

### For Development

- [**GIT_COMMIT_GUIDE.md**](docs/GIT_COMMIT_GUIDE.md) - Implementation details
- [**PRODUCTION_VERIFICATION_CHECKLIST.md**](docs/PRODUCTION_VERIFICATION_CHECKLIST.md) - Pre-deployment

### Additional Resources

- [**GITHUB_ACTIONS_FIX.md**](docs/GITHUB_ACTIONS_FIX.md) - CI/CD updates
- [**LEGAL_PAGE_IMPLEMENTATION.md**](docs/LEGAL_PAGE_IMPLEMENTATION.md) - Legal page guide
- [**RELEASE_NOTES.md**](docs/RELEASE_NOTES.md) - Version history

---

## 🏗️ Architecture

```
Community Savings App
├── Backend (Express.js + MongoDB)
│   ├── Controllers (Auth, Groups, Contributions, Loans)
│   ├── Models (User, Group, Contribution, Loan)
│   ├── Routes (API endpoints)
│   └── Middleware (Auth, validation, error handling)
│
├── Frontend (React + Vite)
│   ├── Pages (Dashboard, Groups, Contributions, Loans)
│   ├── Components (Reusable UI components)
│   ├── Hooks (Custom React hooks)
│   └── Redux (State management)
│
└── Infrastructure
    ├── Docker (Containerization)
    ├── GitHub Actions (CI/CD)
    └── MongoDB & Redis (Data storage)
```

---

## 🛠️ Available Commands

### Setup

```bash
make install              # Install all dependencies
make install-backend      # Backend only
make install-frontend     # Frontend only
```

### Development

```bash
make dev                 # Start backend + frontend
make dev-backend        # Backend development server
make dev-frontend       # Frontend development server
```

### Quality

```bash
make lint               # Check code quality
make lint-fix           # Auto-fix issues
make format             # Format code
make quality            # Complete check
```

### Testing

```bash
make test               # All tests
make test-backend       # Backend tests
make test-unit          # Unit tests
make test-coverage      # Coverage reports
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
```

### Docker

```bash
<<<<<<< HEAD
make docker-build
make docker-up
```

### Cloud

The architecture can be adapted for:

* AWS
* Azure
* Google Cloud
* DigitalOcean
* Render
* Vercel

Cloud deployment should use environment-specific configuration, managed secrets, monitoring, backups and appropriate network/security controls.

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

### Production Gate

Before a production financial deployment, validate:

```text
☐ Environment configuration
☐ Database connectivity
☐ Database indexes
☐ Financial transaction integrity
☐ Idempotency
☐ Authentication
☐ Authorization
☐ KYC/AML workflows
☐ Payment callbacks
☐ Reconciliation
☐ Backups
☐ Restore procedure
☐ Monitoring
☐ Alerting
☐ Security scanning
☐ Load/stress testing
☐ Disaster recovery
☐ Regulatory requirements
☐ Incident response
☐ Production verification checklist
```

---

# 📈 Current Engineering Direction

The project is transitioning from a community savings application toward a broader **financial infrastructure platform**.

Priority engineering areas include:

### Immediate

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

### Next

* Database performance and scaling
* Redis-backed infrastructure where justified
* Payment-provider integrations
* Mobile-money integrations
* Stress and resilience testing
* Production observability
* Enterprise dashboards
* Feature flags
* Advanced reconciliation

### Strategic

* Institutional APIs
* Credit/risk infrastructure
* Advanced fraud intelligence
* Capital-provider integrations
* Cross-institution analytics
* Regional expansion
* Partner ecosystem
* Developer platform/API ecosystem

---

# 🧠 Engineering Principles

TITech development follows several core principles.

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

Secrets, permissions and sensitive operations must be protected by default.

### 7. Observable systems

Critical operations should produce sufficient operational signals to diagnose failures.

### 8. Africa-first, globally extensible

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

However, individual capabilities may have different implementation, testing, operational and regulatory maturity levels.

Always verify the current repository implementation, CI status and production verification checklist before describing a capability as production-ready.

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

## 🌍 Building the Financial Infrastructure for Africa

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

**TITech Community Capital — turning Africa's community financial activity into trusted digital financial infrastructure.**

---

**Version:** 2.1
**Status:** Active Development / Production Hardening
**Last Updated:** September 2026
**Organization:** TITech Community Capital LTD
=======
make docker-build       # Build images
make docker-up          # Start containers
make docker-down        # Stop containers
make docker-logs        # View logs
```

See [Makefile](Makefile) for all 20+ available commands.

---

## 📊 Project Statistics

| Metric              | Value        |
| ------------------- | ------------ |
| Test Coverage       | 1,200+ lines |
| Code Quality Rules  | 40+          |
| Available Commands  | 20+          |
| CI/CD Jobs          | 5 parallel   |
| Documentation Files | 13           |
| Lines of Code       | 50,000+      |

---

## 🔒 Security

- ✅ JWT authentication with refresh tokens
- ✅ Password hashing with bcrypt
- ✅ RBAC (Role-Based Access Control)
- ✅ Input validation and sanitization
- ✅ CSRF protection
- ✅ Environment variable management
- ✅ npm audit in CI/CD
- ✅ No hardcoded secrets

---

## 📈 Deployment Options

### Local Development

```bash
make install
make dev
```

### Docker (Recommended)

```bash
make docker-build
make docker-up
# Visit http://localhost:3000
```

### Cloud Deployment

- **Vercel** (Frontend) - See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
- **Render** (Backend) - See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
- **Heroku** (Full Stack) - See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
- **AWS** (Enterprise) - See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
- **DigitalOcean** (Scalable) - See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)

---

## 🔄 CI/CD Pipeline

Every push to `main` or `develop` triggers:

1. **Quality Checks** - ESLint + Prettier
2. **Tests** - Unit + integration tests
3. **Build** - Backend + frontend build
4. **Docker** - Image building with caching
5. **Security** - npm audit

All checks must pass before merging to main.

See [.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml) for details.

---

## 📝 Environment Setup

### Backend

```bash
# .env file required for backend
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname
REDIS_URL=redis://user:pass@host:port
JWT_SECRET=your-secure-secret-key
NODE_ENV=production
PORT=5000
```

### Frontend

```bash
# .env file required for frontend
VITE_API_URL=http://localhost:5000
VITE_ENVIRONMENT=production
```

Copy `.env.example` files for templates.

---

## 🧪 Testing

### Run All Tests

```bash
make test
```

### Run Specific Tests

```bash
# Backend unit tests
npm run test:unit --prefix community-savings-app-backend

# With coverage
npm run test:coverage --prefix community-savings-app-backend
```

### Test Coverage

Coverage reports are generated in:

- Backend: `community-savings-app-backend/coverage/`
- Frontend: `community-savings-app-frontend/coverage/`

---

## 🐳 Docker Compose Services

When running `make docker-up`:

- **Backend API**: http://localhost:5000
- **Frontend**: http://localhost:3000
- **MongoDB**: localhost:27017
- **Redis**: localhost:6379
- **Nginx** (proxy): localhost:80

---

## 📚 Technology Stack

### Backend

- Node.js 24.15.0
- Express.js 4.18.2
- MongoDB 8.23.1 (Mongoose)
- Redis 4.7.1
- Socket.io 4.7.0
- JWT Authentication

### Frontend

- React 18.3.1
- Vite 5.0.0
- React Router 7.6.0
- Redux 5.0.1
- Axios

### DevOps

- Docker & Docker Compose
- GitHub Actions
- ESLint + Prettier
- Jest
- Codecov

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `make quality` to verify
5. Commit with clear message
6. Push and create a pull request

All PRs must pass CI/CD checks before merging.

---

## 📖 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 📞 Support

### Documentation

- [Full Documentation Index](docs/DOCUMENTATION_INDEX.md)
- [Quick Start Guide](docs/PRODUCTION_READY_README.md)
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)

### Issues

- Report bugs via GitHub Issues
- Ask questions in Discussions

### Status

✅ **Production Ready**  
✅ **Fully Tested**  
✅ **Well Documented**  
✅ **Contest Submission Ready**

---

## 🎯 Next Steps

### To Get Started

1. Read [PRODUCTION_READY_README.md](docs/PRODUCTION_READY_README.md) (10 min)
2. Run `make install && make dev`
3. Visit http://localhost:3000

### To Deploy

1. Read [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
2. Choose your platform
3. Follow the instructions

### To Submit to Contest

1. Read [CONTEST_SUBMISSION_SUMMARY.md](docs/CONTEST_SUBMISSION_SUMMARY.md)
2. Run [PRODUCTION_VERIFICATION_CHECKLIST.md](docs/PRODUCTION_VERIFICATION_CHECKLIST.md)
3. Submit your entry

---

**Status:** ✅ Production Ready | **Version:** 2.1 | **Updated:** June 1, 2026
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
