# Test discovery inventory

The actual archive audit reports 197 backend test files, 26 zero-byte suites, zero case-insensitive duplicate groups, zero mixed CJS/ESM test files and 33 planned non-executable specs. The current script labels the 26 empty suites “non-blocking,” but that classification does not make them valid tests or adequate coverage. They are listed below and each has an adjacent `.planned.md` specification. They remain unimplemented test debt and a release blocker for the full acceptance criteria.

## Zero-byte test files confirmed

- `backend/tests/chat/Conversation.model.test.js`
- `backend/tests/chat/Message.model.test.js`
- `backend/tests/chat/chat.permissions.test.js`
- `backend/tests/chat/chat.realtime.test.js`
- `backend/tests/chat/chat.routes.test.js`
- `backend/tests/chat/chat.service.test.js`
- `backend/tests/chat/chat.validation.test.js`
- `backend/tests/chat/chatController.test.js`
- `backend/tests/chat/chatRoutes.test.js`
- `backend/tests/chat/chatService.test.js`
- `backend/tests/chat/chatSocket.test.js`
- `backend/tests/chat/conversationModel.test.js`
- `backend/tests/chat/messageModel.test.js`
- `backend/tests/commercial/compatibility/billingRuntime.test.js`
- `backend/tests/commercial/models/commercial.models.test.js`
- `backend/tests/commercial/services.test.js`
- `backend/tests/commercial/stage01d/stage01d.reconciliation.test.cjs`
- `backend/tests/commercial/stage01d/stage01d.shadowRead.test.cjs`
- `backend/tests/integration/commercial/transactionRevenue.integration.test.js`
- `backend/tests/unit/commercial/transactionRevenue/feeAssessment.service.test.js`
- `backend/tests/unit/commercial/transactionRevenue/feeCalculation.service.test.js`
- `backend/tests/unit/commercial/transactionRevenue/feeRule.service.test.js`
- `backend/tests/unit/commercial/transactionRevenue/revenueEntry.service.test.js`
- `backend/tests/unit/commercial/transactionRevenue/revenueReversal.service.test.js`
- `backend/tests/unit/commercial/transactionRevenue/settlement.service.test.js`
- `backend/tests/unit/commercial/transactionRevenue/transactionRevenue.service.test.js`


## Discovery and runner contract

`backend/jest.config.cjs` is CommonJS configuration. The backend package declares ESM application sources. Jest's configured patterns include `.test.js` and `.test.cjs` and intentionally exclude `.mjs`; native `.mjs` suites are expected to run through Node's `node:test` scripts. The config currently has `injectGlobals: true`, `transform: {}`, and is invoked with `--experimental-vm-modules`. Frontend runner configuration could not be executed because the frontend dependencies are absent.

The `audit:test-discovery` exit 0 means the inventory completed; it does **not** mean all 26 zero-byte suites are covered or passing. Actual backend Jest discovery/run cannot be confirmed until dependencies are installed.
