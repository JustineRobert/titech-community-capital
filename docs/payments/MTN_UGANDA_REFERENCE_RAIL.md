# MTN Uganda Reference Rail

## Purpose
MTN Uganda serves as the platform's first reference payment rail. The adapter and callback layer are designed to be provider-specific but isolated behind canonical payment contracts.

## Implementation evidence
- Callback validation and normalization path: `backend/modules/payment/providers/mtn/mtnCallbackHandler.js`
- Golden Money Path orchestration: `backend/modules/payment/goldenMoneyPathService.js`

## Security expectations
- callback authenticity validation
- signature verification where supported
- timestamp and reference checks
- duplicate callback protection
- idempotent financial processing

## Current status
Implemented as a deterministic reference adapter and callback processing model. Live MTN provider verification remains pending external sandbox or production access. The repository must not claim production integration without actual credentials and approved access.
