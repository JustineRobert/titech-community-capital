# TITech Community Capital

# Threat Model

Primary threats:

- cross-tenant data access;
- replayed/forged callbacks;
- duplicate financial effects;
- token theft from browser storage;
- privilege escalation;
- injection and unsafe deserialization;
- provider/network outages;
- stale or reordered callbacks;
- backup/restore corruption;
- supply-chain vulnerabilities.

Security decisions must be backed by tests and assessed evidence. This repository document is a control specification, not a completed penetration test.
