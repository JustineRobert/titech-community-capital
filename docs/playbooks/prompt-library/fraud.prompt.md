📄 /docs/playbooks/fintech-system-playbook.md
✅ SYSTEM LAYERS (STANDARD TEMPLATE)
LAYER 1: Infrastructure
→ Kubernetes, Terraform, Multi-region

LAYER 2: Backend Core
→ MERN API, Auth, Multi-tenant, Idempotency

LAYER 3: Financial Engine
→ Ledger, Transactions, Reconciliation

LAYER 4: Event System
→ Kafka + BullMQ (async processing)

LAYER 5: Intelligence
→ Fraud Engine + ML pipeline

LAYER 6: Security & Compliance
→ SOC2 monitoring + audit logging (ELK)

LAYER 7: Interface
→ React Admin + React Native App



✅ ENGINEERING RULES (REUSABLE)
1. NEVER mutate ledger entries (append-only)
2. ALWAYS enforce idempotency for financial endpoints
3. ALL requests must carry tenantId
4. ALL transactions must balance (debit = credit)
5. ALL critical operations must be logged (audit)
6. ALL async tasks must go through queue/stream
7. SYSTEM must be event-driven, not tightly coupled


✅ EXAMPLE PROMPT FILE
📄 /docs/playbooks/prompt-library/fraud.prompt.md


You are a fintech backend engineer.

Generate a production-ready fraud detection system.

Requirements:
- Node.js (Express)
- Kafka or BullMQ worker integration
- Risk scoring (LOW/MEDIUM/HIGH)
- Rules:
  - high transaction amounts
  - velocity spikes
  - retry abuse
  - device/IP anomalies

Deliver:
- services/fraudEngine.js
- workers/fraudWorker.js
- integration example

Constraints:
- Do not modify architecture
- Provide copy-paste code
- Must support multi-tenant (tenantId)
``