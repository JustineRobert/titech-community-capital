# Security Scanning

The canonical blocking scanners run in `.github/workflows/ci.yml`: npm audit at high severity, OSV against all lockfiles, Trivy filesystem vulnerability and secret scanning at HIGH/CRITICAL, and CodeQL JavaScript analysis. No scanner uses an unconditional success exit code.

Findings must be fixed or documented as a narrow, time-bound exception with an owner and removal condition. Secrets, tokens, credentials, and KYC data must never be committed or emitted in logs.