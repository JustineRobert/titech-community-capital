import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChatReadiness } from './chat-production-gate.mjs';

const source = {
  routeRegistry: "router.use('/api/v1/groups', groupRoutes);",
  frontendRoutes: "<Route path={ROUTES.CHAT_WITH_TITECH} element={<GuidedChatPage />} />",
  socketService: 'const io = new SocketIOServer(httpServer);',
  bootstrap: 'createSocketServer(server)',
  chatSocket: "socket.on('room:join', (id) => joinRoom(socket, id));",
  socketConfig: 'createAdapter(redisPubClient, redisSubClient)',
  messageService: "const msg = await Message.create({ conversationId, body });",
  messageQueries: 'Message.find({ conversationId })',
  backendPackage: '{"type":"module"}',
  e2eEvidence: { status: 'NOT_RUN', testIds: [] },
};

test('current source profile remains blocked until API, protected workspace and socket integration are proven', () => {
  const result = evaluateChatReadiness(source);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.productionApproved, false);
  assert.ok(result.blockers.some((item) => item.id === 'backend-api-mounted'));
  assert.ok(result.blockers.some((item) => item.id === 'socket-room-authorization'));
  assert.ok(result.blockers.some((item) => item.id === 'multi-user-browser-e2e'));
});

test('a complete evidence profile may advance only to independent E2E review, never production approval', () => {
  const ready = evaluateChatReadiness({
    ...source,
    routeRegistry: "router.use('/api/v1/chat', authenticate, tenantAuthorization, chatRoutes);",
    frontendRoutes: "<Route path='/chat' element={<TITechChat />} />",
    socketService: "initChatSocket(io);",
    chatSocket: 'authorizeConversation(socket.userId, socket.tenantId, conversationId); socket.join(room);',
    messageService: 'Message.create({ tenantId: tenantId, conversationId, body });',
    messageQueries: 'Message.find({ tenantId: tenantId, conversationId: conversationId });',
    e2eEvidence: { status: 'PASS', testIds: ['chat-multi-user-1'] },
  });
  assert.equal(ready.status, 'READY_FOR_INDEPENDENT_E2E_REVIEW');
  assert.equal(ready.productionApproved, false);
});
