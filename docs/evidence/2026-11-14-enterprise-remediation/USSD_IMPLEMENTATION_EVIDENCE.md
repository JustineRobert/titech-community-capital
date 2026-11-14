# USSD — Implementation Evidence and Status

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Status:** `IMPLEMENTED_CONTRACT_ONLY`  
**Provider verified:** false  
**Network verified:** false  
**Production approved:** false

## Source implementation inspected

- `backend/modules/ussd/ussd.contract.js` — canonical normalized provider callback contract and input validation.
- `backend/modules/ussd/ussd.provider-registry.js` — adapter registration/contract boundary.
- `backend/modules/ussd/ussd.menu.js` — capability-filtered menu rendering.
- `backend/modules/ussd/ussd.routes.js` — callback route boundary, provider authentication and dependencies fail closed.
- `backend/modules/ussd/tests/ussd-contract.test.mjs` — 10 unit/contract tests.
- Canonical route registration is in `backend/routes/index.js` at `/api/v1/channels/ussd`.
- Existing `.env.example` and `.env.production.example` retain disabled flags and empty provider allowlists.

## Tested properties

- Provider payload is normalized to canonical fields rather than treated as a universal wire format.
- The canonical callback requires provider/session/request references and E.164 MSISDN.
- Network is provider metadata, not inferred from the MSISDN prefix.
- Caller-supplied tenant/member identifiers are discarded/not accepted as authorization claims.
- Provider adapters are required to authenticate, normalize and serialize provider-specific protocol.
- The menu renders only institution-enabled features and defaults to reviewed English.
- Unreviewed translations are not activated.
- Session lifecycle rejects invalid transitions/terminal-state resurrection.
- Missing provider/domain services fail closed.

All 10 native USSD module tests passed in the 28/28 focused test run. The USSD static contract gate passed 10 checks.

## Not implemented or externally proven

- Actual MTN Uganda or Airtel Uganda adapter, contract, current protocol, sandbox credential or production webhook authentication.
- Pegasus, True African, Infobip, Yo! Uganda or other aggregator onboarding evidence.
- Shared/dedicated shortcode availability, allocation or UCC approval.
- Network routing on MTN, Airtel, another network or number portability behavior.
- Durable Redis session adapter/injected production channel service proof.
- Real member authentication challenge, consent and recovery over USSD.
- End-to-end contribution, repayment, financial-intent, provider outcome, ledger and reconciliation journey.
- Actual SIM-based response length/encoding/timeout verification.

## Fail-closed configuration

Current defaults preserve USSD disabled, empty provider allowlist, financial USSD actions disabled and production approval false. Do not activate a provider, financial menu item or shortcode until partner contracts, current protocol, provider-specific signature verification, test results, legal assessment and operational approvals are recorded.

## Next evidence required

Complete provider due diligence, select a provider based on written evidence, obtain its technical specification and sandbox, implement its adapter with contract tests, prove both network paths using authorized test SIMs, integrate the production Redis/session/domain service, and independently test financial outcome verification and recovery. Provider acknowledgement or successful HTTP delivery alone is not financial confirmation.
