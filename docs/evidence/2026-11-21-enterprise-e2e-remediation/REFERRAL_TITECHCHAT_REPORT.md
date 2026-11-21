# Referral and TITechChat implementation discovery

## Discovered source state

Referral and TITechChat artifacts exist, including Mongoose models, frontend components, chat services/sockets, legacy route modules, controllers and services. Source presence is not proof of an end-to-end mounted feature.

The canonical ESM Express route registry `backend/routes/index.js` does not mount `backend/routes/chatRoutes.js`, `backend/routes/referralRoutes.js` or the related legacy referral reward route. The legacy chat/referral route and controller/service files use CommonJS (`require`, `module.exports`) while the active backend package/route registry is native ESM. The existing source evidence `docs/evidence/TITech_2026-11-08_Execution_Change_Discovery.md` already describes TITechChats as disconnected and explicitly warns against mounting a fake route.

The frontend route constant `/chat-with-titech` is registered to `GuidedChatPage`, not to the dedicated TITechChat messaging module. No frontend route registration for the dedicated Referral workspace or the unmounted SACCO OnboardingDashboard component was found in the inspected route file.

## Why no unsafe mounting was performed

Simply importing legacy CommonJS routers into the canonical ESM registry would not establish correct module compatibility, route-level authentication, tenant-scoped conversation access, action permissions, socket membership, durable delivery, notification/outbox behavior or safe attachment access. The existing `Conversation` model being present does not make its read/write flows operational. The Referral model likewise does not prove referral attribution, campaign review or reward payout E2E.

No parallel messaging database, duplicate referral service or insecure unauthenticated route was introduced. The next safe implementation should first specify module contracts, migrate the required service/controller boundaries to ESM, use canonical authenticated/tenant/RBAC middleware, prove conversation/referral access with two real test tenants and mount only after the complete API + persistence + realtime/browser suites pass.

## Status

**Referral E2E: not proven. TITechChat messaging E2E: not proven.** Existing `/chat-with-titech` is GuidedChatPage and should not be represented as proof of authenticated participant messaging. Legacy modules remain in the archive without production promotion. These are explicit product completion items, not hidden successes.
