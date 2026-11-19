# TITech Community Capital — 19 November 2026 remediation evidence

This directory records the source-level remediation performed against the supplied repository archive on 19 November 2026.

## Documents

- [Implementation report](IMPLEMENTATION_REPORT.md) — what was changed and what remains unverified.
- [Change discovery](CHANGE_DISCOVERY.md) — exact changed/new files and a step-by-step repository discovery path.
- [Test evidence](TEST_EVIDENCE.md) — commands, pass counts, blockers and evidence boundaries.
- [Institutional and pilot gap analysis](INSTITUTIONAL_PILOT_GAP_ANALYSIS.md) — current source-of-truth findings and work still needed for the full SACCO/VSLA/Chama/ROSCA workflow.
- [Release decision](RELEASE_DECISION.md) — current go/no-go and approval boundaries.

## Important limitation

The supplied ZIP is a source archive without Git metadata. The available environment has Node.js 22.16.0/npm 10.9.2 while the repository requires Node.js >=24.15.0/npm >=11.0.0. Dependencies are not installed. Therefore the work is source-level remediation plus native Node/static-gate testing; a live backend, MongoDB/Redis integration, Vite build, browser E2E, screenshots and operational pilot were not verified.
