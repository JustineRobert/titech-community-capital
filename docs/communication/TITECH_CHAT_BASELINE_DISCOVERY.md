# TITech Chat — archive-local baseline discovery

**Run:** `2026-11-21-1146Z`  
**Product:** TITech Community Capital  
**Organisation:** TITECH CAPITAL - SMC LTD.  
**Production approval:** `productionApproved=false`

## Executive finding

TITech contains a large body of Chat UI, Redux state, API clients, models, routes, services, socket handlers and tests. That source presence is not a functioning module integration. The authenticated member-to-member Chat experience is currently **disconnected / not production-operational** in the supplied archive.

The canonical React route registry exposes `/chat-with-titech` as a public `GuidedChatPage`; this is a guided public contact/chat experience, not the authenticated TITech Chat workspace. The existing `TITechChat`, `ConversationList`, and `ConversationDetail` surfaces are not registered as a protected route in `frontend/src/routes/AppRoutes.jsx`.

The canonical Express route registry is `backend/routes/index.js`. It mounts multiple authenticated tenant modules but does not mount `backend/routes/chat.js` or `backend/routes/chatRoutes.js`. Those legacy Chat routers are CommonJS-style source inside the backend package which declares `"type": "module"`; the inspected route file also imports `../middlewares/auth`, while the canonical directory is `backend/middleware/`. The current route/service graph therefore cannot be assumed to load or execute.

The canonical Socket.IO server is created by `backend/services/socket.js` from `backend/bootstrap/ApplicationBootstrap.js`. That service authenticates a socket and maintains generic user presence, but it does not attach the Chat event handlers. `backend/sockets/chatSocket.js` is a separate CommonJS-style handler and `backend/realtime/chatSocket.js` attempts to instantiate another Socket.IO server; neither is shown attached to the canonical server. A second real-time server is not an acceptable remediation.

## Existing implementation inventory

### Frontend

- `frontend/src/pages/TITechChat.js`
- `frontend/src/pages/TITechChat/ChatHome.jsx`
- `frontend/src/pages/TITechChat/ConversationView.jsx`
- `frontend/src/pages/TITechChat/{AnnouncementAdmin,AnnouncementBell,AnnouncementCenter,AnnouncementDrawer,LoanThreads,SavingsThreads,SupportThreads}.jsx`
- `frontend/src/components/chat/` (message panel, composer, conversation list/item/header, attachment preview, typing indicator, read badge, empty/loading/error states)
- `frontend/src/store/chatSlice.js`, `frontend/src/store/chat/`
- `frontend/src/services/chatApi.js`, `frontend/src/services/chatService.js`
- `frontend/src/hooks/useChat.js`, `frontend/src/hooks/useConversation.js`
- `frontend/src/sockets/chatSocket.js`

### Backend

- Models: `Chat.js`, `ChatMessage.js`, `Conversation.js`, `Message.js`, `MessageAudit.js`, `MessageRead.js`
- Routes: `routes/chat.js`, `routes/chatRoutes.js`, `routes/bizchat.js`, `routes/bizchat.routes.js`
- Controllers: `controllers/chatController.js`, `controllers/chat/{conversationController,messageController,announcementController,exportController,supportThreadController}.js`
- Services: `services/chatService.js`, `services/chat/{conversationService,messageService,participantService,moderationService,searchService,unreadService,exportService,threadLinkService}.js`
- Security/support: `middleware/chatAuthorization.js`, `middleware/conversationAccess.js`, `middleware/chatRateLimit.js`, `middleware/messageSanitizer.js`
- Realtime: `services/socket.js`, `sockets/chatSocket.js`, `sockets/socketAuth.js`, `sockets/roomManager.js`, `realtime/chatSocket.js`
- Tests: `backend/tests/chat/`, `backend/tests/integration/chat.test.*`, and frontend `__tests__/chat/`

Several parallel/duplicate historical implementations exist. They must be reconciled against the canonical ESM modules before any route is mounted.

## Confirmed integration/security root causes

1. **Backend API unmounted:** `backend/routes/index.js` contains no Chat router mount.
2. **Frontend workspace unregistered:** current public `/chat-with-titech` page is `GuidedChatPage`, not an authenticated conversation inbox.
3. **No canonical socket event attachment:** the bootstrap-created Socket.IO server does not attach Chat handlers.
4. **Unsafe room join helper:** `backend/sockets/roomManager.js` joins a room using only a socket and caller-supplied conversation ID; there is no authorization callback in the helper. The legacy event handler invokes it directly.
5. **No verified Redis Socket.IO adapter:** the canonical socket service has no `@socket.io/redis-adapter`/`createAdapter` integration.
6. **Tenant persistence gap in legacy service:** `backend/models/Message.js` requires `tenantId`, but legacy `backend/services/chat/messageService.js` creates a Message without explicitly setting it. The same service retrieves a conversation by ID alone and queries messages by `conversationId` without a tenant filter.
7. **ESM/CommonJS incompatibility:** backend package scope declares ESM while inspected legacy Chat services use `require()` and `module.exports`.
8. **No multi-user Playwright evidence:** no executed authenticated two-browser Chat journey evidence exists in this run.

These findings are static source discovery, not live penetration-test results. The gate deliberately remains BLOCKED.

## Existing platform boundaries to preserve

- `backend/middleware/auth.js` — canonical authentication middleware.
- `backend/middleware/tenantMiddleware.js` / trusted tenant authorization in the canonical route registry.
- `backend/security/rbacPolicy.js` and the canonical permission registry.
- `backend/services/socket.js` — existing single Socket.IO server.
- Existing `Conversation`, `Message`, `MessageRead`, `MessageAudit`, and notification/audit architecture, subject to schema/type reconciliation.
- MongoDB, Redis, audit, notification, security, feature-flag and financial controls.

Chat messages must never post ledger entries, mutate balances, initiate payments, or authorize financial actions.

## Environment constraints

No root/backend/frontend `node_modules` directory exists. Available Node/npm versions are `v22.16.0` / `10.9.2`, below the project engines of Node `>=24.15.0` / npm `>=11`. MongoDB, Redis, Docker and an installed browser automation runtime were not available in this execution. Full integration and E2E testing was not run.
