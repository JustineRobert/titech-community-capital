'use strict';

/**
 * ============================================================================
 * MESSAGE EVENTS
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Centralized Socket.IO and internal event registry for TITechChat.
 *
 * All realtime communication, notifications, analytics, and audit pipelines
 * should use these constants rather than hardcoded event names.
 *
 * Supports:
 *
 * ✅ Message Events
 * ✅ Conversation Events
 * ✅ Participant Events
 * ✅ Presence Events
 * ✅ Read & Delivery Receipts
 * ✅ Typing Indicators
 * ✅ Thread Events
 * ✅ Announcement Events
 * ✅ Export Events
 * ✅ Moderation Events
 * ✅ Notification Events
 * ✅ Compliance Events
 * ✅ Internal Domain Events
 *
 * ============================================================================
 */

const MESSAGE_EVENTS = Object.freeze({
  /*
  |--------------------------------------------------------------------------
  | Message Events
  |--------------------------------------------------------------------------
  */

  MESSAGE_NEW: 'message:new',
  MESSAGE_CREATED: 'message:created',
  MESSAGE_UPDATE: 'message:update',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_DELETE: 'message:delete',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_EDIT: 'message:edit',
  MESSAGE_PIN: 'message:pin',
  MESSAGE_UNPIN: 'message:unpin',
  MESSAGE_REPLY: 'message:reply',

  /*
  |--------------------------------------------------------------------------
  | Delivery & Read Receipts
  |--------------------------------------------------------------------------
  */

  MESSAGE_DELIVERED: 'message:delivered',
  MESSAGE_READ: 'message:read',
  MESSAGE_UNREAD: 'message:unread',
  READ_RECEIPT: 'message:read',
  DELIVERY_RECEIPT: 'message:delivered',

  /*
  |--------------------------------------------------------------------------
  | Attachments
  |--------------------------------------------------------------------------
  */

  ATTACHMENT_UPLOADED: 'attachment:uploaded',
  ATTACHMENT_REMOVED: 'attachment:removed',

  /*
  |--------------------------------------------------------------------------
  | Conversation Events
  |--------------------------------------------------------------------------
  */

  CONVERSATION_CREATE: 'conversation:create',
  CONVERSATION_CREATED: 'conversation:created',
  CONVERSATION_UPDATE: 'conversation:update',
  CONVERSATION_UPDATED: 'conversation:updated',
  CONVERSATION_DELETE: 'conversation:delete',
  CONVERSATION_DELETED: 'conversation:deleted',
  CONVERSATION_ARCHIVE: 'conversation:archive',
  CONVERSATION_ARCHIVED: 'conversation:archived',
  CONVERSATION_LOCK: 'conversation:lock',
  CONVERSATION_LOCKED: 'conversation:locked',

  /*
  |--------------------------------------------------------------------------
  | Thread Events
  |--------------------------------------------------------------------------
  */

  THREAD_CREATED: 'thread:created',
  THREAD_UPDATED: 'thread:updated',
  THREAD_CLOSED: 'thread:closed',
  THREAD_REOPENED: 'thread:reopened',

  /*
  |--------------------------------------------------------------------------
  | Participant Events
  |--------------------------------------------------------------------------
  */

  PARTICIPANT_ADD: 'participant:add',
  PARTICIPANT_ADDED: 'participant:added',
  PARTICIPANT_REMOVE: 'participant:remove',
  PARTICIPANT_REMOVED: 'participant:removed',
  PARTICIPANT_JOIN: 'participant:join',
  PARTICIPANT_LEAVE: 'participant:leave',

  /*
  |--------------------------------------------------------------------------
  | Presence Events
  |--------------------------------------------------------------------------
  */

  USER_ONLINE: 'user:online',
  USER_OFFLINE: 'user:offline',
  USER_PRESENCE: 'user:presence',
  USER_AWAY: 'user:away',

  /*
  |--------------------------------------------------------------------------
  | Typing Indicators
  |--------------------------------------------------------------------------
  */

  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',

  /*
  |--------------------------------------------------------------------------
  | Announcement Events
  |--------------------------------------------------------------------------
  */

  ANNOUNCEMENT_CREATED: 'announcement:created',
  ANNOUNCEMENT_UPDATED: 'announcement:updated',
  ANNOUNCEMENT_DELETED: 'announcement:deleted',

  /*
  |--------------------------------------------------------------------------
  | Export Events
  |--------------------------------------------------------------------------
  */

  EXPORT_REQUESTED: 'export:requested',
  EXPORT_PROCESSING: 'export:processing',
  EXPORT_READY: 'export:ready',
  EXPORT_FAILED: 'export:failed',
  EXPORT_DOWNLOADED: 'export:downloaded',

  /*
  |--------------------------------------------------------------------------
  | Moderation Events
  |--------------------------------------------------------------------------
  */

  MESSAGE_REPORTED: 'message:reported',
  MESSAGE_MODERATED: 'message:moderated',
  MESSAGE_RESTORED: 'message:restored',

  /*
  |--------------------------------------------------------------------------
  | Notification Events
  |--------------------------------------------------------------------------
  */

  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_READ: 'notification:read',

  /*
  |--------------------------------------------------------------------------
  | System Events
  |--------------------------------------------------------------------------
  */

  SYSTEM_MESSAGE: 'system:message',
  SYSTEM_WARNING: 'system:warning',
  SYSTEM_ERROR: 'system:error',
  SYSTEM_BROADCAST: 'system:broadcast',

  /*
  |--------------------------------------------------------------------------
  | Socket Lifecycle
  |--------------------------------------------------------------------------
  */

  SOCKET_CONNECTED: 'socket:connected',
  SOCKET_DISCONNECTED: 'socket:disconnected',
  SOCKET_RECONNECTED: 'socket:reconnected',
  SOCKET_ERROR: 'socket:error',

  /*
  |--------------------------------------------------------------------------
  | Internal Domain Events
  |--------------------------------------------------------------------------
  */

  DOMAIN_MESSAGE_CREATED:
    'domain.message.created',

  DOMAIN_MESSAGE_UPDATED:
    'domain.message.updated',

  DOMAIN_MESSAGE_DELETED:
    'domain.message.deleted',

  DOMAIN_CONVERSATION_CREATED:
    'domain.conversation.created',

  DOMAIN_CONVERSATION_UPDATED:
    'domain.conversation.updated',

  DOMAIN_EXPORT_CREATED:
    'domain.export.created',

  DOMAIN_EXPORT_READY:
    'domain.export.ready',
});

/*
|--------------------------------------------------------------------------
| Helper Arrays
|--------------------------------------------------------------------------
*/

const MESSAGE_EVENT_NAMES = Object.freeze([
  MESSAGE_EVENTS.MESSAGE_NEW,
  MESSAGE_EVENTS.MESSAGE_UPDATE,
  MESSAGE_EVENTS.MESSAGE_DELETE,
  MESSAGE_EVENTS.MESSAGE_EDIT,
]);

const CONVERSATION_EVENT_NAMES =
  Object.freeze([
    MESSAGE_EVENTS.CONVERSATION_CREATE,
    MESSAGE_EVENTS.CONVERSATION_UPDATE,
    MESSAGE_EVENTS.CONVERSATION_ARCHIVE,
    MESSAGE_EVENTS.CONVERSATION_LOCK,
  ]);

const PRESENCE_EVENT_NAMES =
  Object.freeze([
    MESSAGE_EVENTS.USER_ONLINE,
    MESSAGE_EVENTS.USER_OFFLINE,
    MESSAGE_EVENTS.USER_AWAY,
  ]);

module.exports = {
  ...MESSAGE_EVENTS,
  MESSAGE_EVENTS,
  MESSAGE_EVENT_NAMES,
  CONVERSATION_EVENT_NAMES,
  PRESENCE_EVENT_NAMES,
};