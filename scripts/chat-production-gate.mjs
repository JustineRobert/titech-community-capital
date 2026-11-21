#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = process.env.TITECH_I18N_RUN_ID || '2026-11-21-1146Z';
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(RUN_ID)) throw new Error('TITECH_I18N_RUN_ID must be 3-64 letters, digits, hyphens or underscores.');
const REPORT_PATH = path.join(ROOT, 'reports/i18n-human-review', RUN_ID, 'chat-production-gate.json');

function read(relativePath) {
  const file = path.join(ROOT, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function evaluateChatReadiness(sources) {
  const failures = [];
  const checks = [];
  const add = (id, pass, evidence, blocker) => {
    checks.push({ id, status: pass ? 'PASS' : 'BLOCKED', evidence });
    if (!pass) failures.push({ id, reason: blocker });
  };
  const backendRoutesMounted = /(?:router|app)\.use\s*\(\s*['"`][^'"`]*chat/i.test(sources.routeRegistry)
    || /chatRoutes|chatRouter|communicationRoutes/.test(sources.routeRegistry);
  add('backend-api-mounted', backendRoutesMounted, 'Canonical backend route registry scan.', 'The chat API is not mounted in backend/routes/index.js. The existing legacy route modules are not composed into the canonical API registry.');

  const protectedWorkspaceRegistered = /<Route\b[^>]*path\s*=\s*\{?[^>]*(?:CHAT|chat)[^>]*element\s*=\s*\{\s*<[^>]*(?:TITechChat|ConversationList|SupportChat)/s.test(sources.frontendRoutes)
    || /<Route\b[^>]*path\s*=\s*['"][^'"]*\/chat(?:\/[^'"]*)?['"][^>]*element\s*=\s*\{\s*<[^>]*(?:TITechChat|ConversationList|SupportChat)/s.test(sources.frontendRoutes);
  add('protected-workspace-route', protectedWorkspaceRegistered, 'Protected React Router registration scan.', 'No authenticated member-to-member Chat workspace route is registered; /chat-with-titech resolves to the public guided-chat page.');

  const chatHandlerAttached = /initChatSocket|registerChatSocket|attachChatHandlers|chat:message/.test(sources.socketService)
    || /initChatSocket|registerChatSocket|attachChatHandlers|chat:message/.test(sources.bootstrap);
  add('canonical-socket-integration', chatHandlerAttached, 'Canonical Socket.IO service and bootstrap scan.', 'The existing canonical Socket.IO server does not attach the Chat event handlers. An additional independent Socket.IO server must not be introduced.');

  const roomAuthorization = /authorizeConversation|assertConversationAccess|conversationAccess|canJoinConversation/.test(sources.chatSocket)
    && /tenantId/.test(sources.chatSocket);
  add('socket-room-authorization', roomAuthorization, 'Chat socket room-join implementation scan.', 'The legacy room manager joins arbitrary conversation rooms without tenant-scoped membership verification.');

  const durableRedisAdapter = /@socket\.io\/redis-adapter|createAdapter\s*\(/.test(sources.socketService + sources.socketConfig);
  add('redis-socket-adapter', durableRedisAdapter, 'Socket.IO Redis adapter configuration scan.', 'No Redis Socket.IO adapter configuration was found in the canonical Socket.IO service/configuration.');

  const tenantScopedMessagePersistence = /tenantId\s*:\s*[^,\n]+/.test(sources.messageService)
    && /tenantId\s*:\s*[^,\n]+/.test(sources.messageQueries);
  add('tenant-scoped-message-persistence', tenantScopedMessagePersistence, 'Canonical message service/query source scan.', 'Existing legacy message service creates messages without the required tenantId and reads messages by conversationId without an explicit tenant filter.');

  const supportedMessageModule = !/require\s*\(/.test(sources.messageService) && /"type"\s*:\s*"module"/.test(sources.backendPackage);
  add('module-format-compatibility', supportedMessageModule, 'Backend package module type and canonical message service scan.', 'The legacy chat services use CommonJS require() inside the backend ESM package scope, so the legacy service cannot be treated as an operational ESM integration.');

  const browserEvidence = sources.e2eEvidence && sources.e2eEvidence.status === 'PASS' && Array.isArray(sources.e2eEvidence.testIds) && sources.e2eEvidence.testIds.length > 0;
  add('multi-user-browser-e2e', Boolean(browserEvidence), 'Committed Chat browser evidence record.', 'No executed multi-user Playwright evidence is present for persistence, real-time delivery, receipts, reload/recovery and tenant-isolation scenarios.');

  return {
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'BLOCKED' : 'READY_FOR_INDEPENDENT_E2E_REVIEW',
    module: 'TITech Chat',
    productionApproval: 'NO',
    productionApproved: false,
    checks,
    blockers: failures,
    architectureDecision: 'Do not mount the legacy chat routes or create a second Socket.IO server. First consolidate the existing module onto the canonical ESM route registry, authentication/tenant context, RBAC, MongoDB models and already-created Socket.IO server.',
    note: 'Static source checks are discovery evidence only. This gate does not substitute for running MongoDB, Redis, authenticated API tests or multi-browser Playwright tests.',
  };
}

export function runChatGate() {
  const e2ePath = path.join(ROOT, 'reports/titech-chat-e2e-results.json');
  const e2eEvidence = fs.existsSync(e2ePath) ? JSON.parse(fs.readFileSync(e2ePath, 'utf8')) : null;
  const result = evaluateChatReadiness({
    routeRegistry: read('backend/routes/index.js'),
    frontendRoutes: read('frontend/src/routes/AppRoutes.jsx'),
    socketService: read('backend/services/socket.js'),
    bootstrap: read('backend/bootstrap/ApplicationBootstrap.js'),
    chatSocket: read('backend/sockets/chatSocket.js'),
    socketConfig: read('backend/config/index.js'),
    messageService: read('backend/services/chat/messageService.js'),
    messageQueries: read('backend/services/chat/messageService.js'),
    backendPackage: read('backend/package.json'),
    e2eEvidence,
  });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'BLOCKED') process.exitCode = 1;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runChatGate();
