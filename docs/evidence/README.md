# TITech Release Evidence Register

This directory stores evidence required to move TITech Community Capital through the P0/P1/P2 release sequence.

## Evidence rule

A document is an **evidence record**, not proof merely because it exists. Each record must identify:

- test/exercise date and UTC timestamp;
- commit/build/image identifier;
- environment;
- operator or accountable owner;
- inputs and expected result;
- actual result;
- correlation/reference IDs where applicable;
- exceptions/failures;
- remediation owner and due date;
- approval/sign-off where required.

Templates:

- `provider/PROVIDER_CERTIFICATION_TEMPLATE.md`
- `security/SECURITY_ASSESSMENT_TEMPLATE.md`
- `operations/OPERATIONAL_DRILL_TEMPLATE.md`
- `pilot/PILOT_ACCEPTANCE_TEMPLATE.md`
- `capital/CAPITAL_PARTNER_VALIDATION_TEMPLATE.md`

Do not populate templates with invented results. Use `NOT_EXECUTED`, `BLOCKED`, `PASS`, or `FAIL` accurately.
