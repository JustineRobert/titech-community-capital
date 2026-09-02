'use strict';

/**
 * ============================================================================
 * TITech COMMUNITY CAPITAL LTD
 * USE CONVERSATION HOOK — ENTERPRISE EDITION
 * ============================================================================
 *
 * File:
 *   frontend/src/hooks/useConversation.js
 *
 * Purpose:
 *   Enterprise React hook for managing a single TITech conversation.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *   - Load conversation metadata.
 *   - Load the authoritative message history.
 *   - Maintain reactive message state.
 *   - Join / leave the conversation's realtime room.
 *   - Process realtime message events.
 *   - Reconcile state after socket reconnects.
 *   - Send messages through the chat service.
 *   - Prevent duplicate messages.
 *   - Protect against stale asynchronous responses.
 *   - Protect against state updates after unmount.
 *   - Provide online / connection state.
 *   - Provide controlled local message operations.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   React Component
 *          │
 *          ▼
 *   useConversation(id)
 *          │
 *          ├──────────────► chatService
 *          │                    │
 *          │                    ├── fetchConversation()
 *          │                    └── postMessage()
 *          │
 *          └──────────────► chatSocket
 *                               │
 *                               ├── initSocket()
 *                               ├── joinRoom()
 *                               ├── leaveRoom()
 *                               └── realtime events
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This hook is NOT the authoritative source of conversation state.
 *
 * The TITech backend remains authoritative for:
 *
 *   - conversation membership
 *   - authorization
 *   - message persistence
 *   - message ordering
 *   - message identity
 *   - idempotency
 *   - tenant isolation
 *   - moderation
 *   - auditability
 *
 * The frontend may optimistically display a message, but the backend remains
 * the source of truth.
 *
 * ============================================================================
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  fetchConversation,
  postMessage,
} from '../services/chatService';

import {
  initSocket,
  joinRoom,
  leaveRoom,
  on,
  off,
} from '../sockets/chatSocket';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_LOAD_ERROR =
  'Failed to load conversation.';

const DEFAULT_SEND_ERROR =
  'Failed to send message.';

const SOCKET_EVENTS = Object.freeze({
  MESSAGE_NEW:
    'message:new',

  MESSAGE_UPDATED:
    'message:update',

  MESSAGE_DELETED:
    'message:delete',

  CONVERSATION_UPDATE:
    'conversation:update',

  CONNECT:
    'connect',

  RECONNECT:
    'reconnect',

  DISCONNECT:
    'disconnect',

  CONNECT_ERROR:
    'connect_error',
});

/**
 * ============================================================================
 * Error Helpers
 * ============================================================================
 */

/**
 * Normalize an arbitrary error into a safe user-facing message.
 *
 * @param {unknown} error
 * @param {string} fallback
 * @returns {string}
 */
function getErrorMessage(
  error,
  fallback,
) {
  if (!error) {
    return fallback;
  }

  if (
    typeof error === 'string' &&
    error.trim()
  ) {
    return error;
  }

  if (
    typeof error.message ===
      'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  if (
    typeof error.response?.data
      ?.message === 'string' &&
    error.response.data.message.trim()
  ) {
    return error.response.data.message;
  }

  if (
    typeof error.response?.data
      ?.error === 'string' &&
    error.response.data.error.trim()
  ) {
    return error.response.data.error;
  }

  return fallback;
}

/**
 * Determine whether an error represents cancellation.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isAbortError(
  error,
) {
  return (
    error?.name ===
      'AbortError' ||
    error?.code ===
      'ERR_CANCELED' ||
    error?.message ===
      'canceled'
  );
}

/**
 * ============================================================================
 * Identifier Helpers
 * ============================================================================
 */

/**
 * @param {object|null} message
 * @returns {string|null}
 */
function getMessageId(
  message,
) {
  if (!message) {
    return null;
  }

  return (
    message._id ??
    message.id ??
    message.messageId ??
    message.clientMessageId ??
    null
  );
}

/**
 * @param {object|null} message
 * @returns {string|null}
 */
function getConversationIdFromMessage(
  message,
) {
  if (!message) {
    return null;
  }

  return (
    message.conversationId ??
    message.conversation?._id ??
    message.conversation?.id ??
    null
  );
}

/**
 * ============================================================================
 * Date Helpers
 * ============================================================================
 */

/**
 * @param {unknown} value
 * @returns {Date|string|null}
 */
function normalizeDate(
  value,
) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(
      value.getTime(),
    )
      ? null
      : value;
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? value
    : date;
}

/**
 * ============================================================================
 * Message Normalization
 * ============================================================================
 */

/**
 * Normalize a message while preserving server-defined fields.
 *
 * @param {object} message
 * @returns {object|null}
 */
function normalizeMessage(
  message,
) {
  if (
    !message ||
    typeof message !==
      'object'
  ) {
    return null;
  }

  const conversationId =
    getConversationIdFromMessage(
      message,
    );

  if (!conversationId) {
    return null;
  }

  return {
    ...message,

    conversationId,

    createdAt:
      normalizeDate(
        message.createdAt ??
          message.sentAt ??
          message.timestamp,
      ),
  };
}

/**
 * Normalize a message collection and remove duplicates.
 *
 * @param {unknown} input
 * @returns {object[]}
 */
function normalizeMessages(
  input,
) {
  if (
    !Array.isArray(input)
  ) {
    return [];
  }

  const result = [];
  const identifiers =
    new Set();

  input.forEach(
    (message) => {
      const normalized =
        normalizeMessage(
          message,
        );

      if (!normalized) {
        return;
      }

      const id =
        getMessageId(
          normalized,
        );

      if (
        id &&
        identifiers.has(
          String(id),
        )
      ) {
        return;
      }

      if (id) {
        identifiers.add(
          String(id),
        );
      }

      result.push(
        normalized,
      );
    },
  );

  return result;
}

/**
 * ============================================================================
 * Message Equality
 * ============================================================================
 */

/**
 * Determine whether two messages represent the same logical message.
 *
 * The server message ID is the strongest identity.
 *
 * clientMessageId is useful for reconciling optimistic messages with the
 * authoritative server response.
 *
 * @param {object|null} first
 * @param {object|null} second
 * @returns {boolean}
 */
function isSameMessage(
  first,
  second,
) {
  if (!first || !second) {
    return false;
  }

  const firstId =
    getMessageId(first);

  const secondId =
    getMessageId(second);

  if (
    firstId &&
    secondId &&
    String(firstId) ===
      String(secondId)
  ) {
    return true;
  }

  const firstClientId =
    first.clientMessageId;

  const secondClientId =
    second.clientMessageId;

  if (
    firstClientId &&
    secondClientId &&
    String(firstClientId) ===
      String(secondClientId)
  ) {
    return true;
  }

  return false;
}

/**
 * ============================================================================
 * Message Merge
 * ============================================================================
 */

/**
 * Merge an incoming message into the current collection.
 *
 * The incoming authoritative server message wins over the existing object.
 *
 * @param {object[]} previous
 * @param {object} incoming
 * @returns {object[]}
 */
function mergeMessage(
  previous,
  incoming,
) {
  const normalized =
    normalizeMessage(
      incoming,
    );

  if (!normalized) {
    return previous;
  }

  const index =
    previous.findIndex(
      (message) =>
        isSameMessage(
          message,
          normalized,
        ),
    );

  /**
   * Existing message:
   *
   * Replace it with the authoritative incoming version.
   */
  if (index !== -1) {
    const next =
      [...previous];

    next[index] = {
      ...next[index],
      ...normalized,
    };

    return next;
  }

  /**
   * New message.
   *
   * Append rather than blindly replacing the entire collection.
   */
  return [
    ...previous,
    normalized,
  ];
}

/**
 * ============================================================================
 * Hook
 * ============================================================================
 */

/**
 * useConversation
 *
 * @param {string|null} conversationId
 *
 * @returns {{
 *   conversation: object|null,
 *   messages: object[],
 *   setMessages: Function,
 *   loading: boolean,
 *   refreshing: boolean,
 *   sending: boolean,
 *   error: string|null,
 *   sendError: string|null,
 *   online: boolean,
 *   connected: boolean,
 *   sendMessage: Function,
 *   refresh: Function,
 *   clearError: Function,
 *   clearSendError: Function,
 *   upsertMessage: Function,
 *   removeMessage: Function
 * }}
 */
export default function useConversation(
  conversationId,
) {
  /**
   * ==========================================================================
   * State
   * ==========================================================================
   */

  const [
    conversation,
    setConversation,
  ] = useState(null);

  const [
    messages,
    setMessages,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(
    Boolean(conversationId),
  );

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    sending,
    setSending,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    sendError,
    setSendError,
  ] = useState(null);

  const [
    online,
    setOnline,
  ] = useState(
    typeof navigator ===
      'undefined'
      ? true
      : navigator.onLine,
  );

  const [
    connected,
    setConnected,
  ] = useState(false);

  /**
   * ==========================================================================
   * Lifecycle / Concurrency Refs
   * ==========================================================================
   */

  const mountedRef =
    useRef(false);

  const requestSequenceRef =
    useRef(0);

  const sendSequenceRef =
    useRef(0);

  const abortControllerRef =
    useRef(null);

  const socketRef =
    useRef(null);

  const activeRoomRef =
    useRef(null);

  /**
   * ==========================================================================
   * Load Conversation
   * ==========================================================================
   */

  const loadConversation =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        if (!conversationId) {
          if (
            mountedRef.current
          ) {
            setConversation(
              null,
            );

            setMessages([]);
            setLoading(false);
            setRefreshing(false);
            setError(null);
          }

          return null;
        }

        const requestId =
          ++requestSequenceRef.current;

        /**
         * Cancel previous request when supported.
         */
        if (
          abortControllerRef.current
        ) {
          abortControllerRef.current.abort();
        }

        const controller =
          typeof AbortController !==
          'undefined'
            ? new AbortController()
            : null;

        abortControllerRef.current =
          controller;

        if (!silent) {
          setLoading(true);
        }

        setRefreshing(true);
        setError(null);

        try {
          const data =
            await fetchConversation(
              conversationId,
            );

          /**
           * Ignore stale responses.
           */
          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return null;
          }

          const normalizedConversation =
            data &&
            typeof data ===
              'object'
              ? data
              : null;

          const normalizedMessages =
            normalizeMessages(
              data?.messages,
            );

          setConversation(
            normalizedConversation,
          );

          setMessages(
            normalizedMessages,
          );

          setError(null);

          return normalizedConversation;
        } catch (err) {
          if (
            isAbortError(err)
          ) {
            return null;
          }

          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return null;
          }

          setError(
            getErrorMessage(
              err,
              DEFAULT_LOAD_ERROR,
            ),
          );

          return null;
        } finally {
          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return;
          }

          setLoading(false);
          setRefreshing(false);
        }
      },
      [conversationId],
    );

  /**
   * ==========================================================================
   * Refresh
   * ==========================================================================
   */

  const refresh =
    useCallback(
      () =>
        loadConversation({
          silent: false,
        }),
      [loadConversation],
    );

  /**
   * ==========================================================================
   * Clear Errors
   * ==========================================================================
   */

  const clearError =
    useCallback(() => {
      setError(null);
    }, []);

  const clearSendError =
    useCallback(() => {
      setSendError(null);
    }, []);

  /**
   * ==========================================================================
   * Upsert Message
   * ==========================================================================
   */

  const upsertMessage =
    useCallback(
      (message) => {
        if (
          !message ||
          !conversationId
        ) {
          return;
        }

        const incomingConversationId =
          getConversationIdFromMessage(
            message,
          );

        if (
          !incomingConversationId ||
          String(
            incomingConversationId,
          ) !==
            String(
              conversationId,
            )
        ) {
          return;
        }

        setMessages(
          (previous) =>
            mergeMessage(
              previous,
              message,
            ),
        );
      },
      [conversationId],
    );

  /**
   * ==========================================================================
   * Remove Message
   * ==========================================================================
   */

  const removeMessage =
    useCallback(
      (messageId) => {
        if (!messageId) {
          return;
        }

        setMessages(
          (previous) =>
            previous.filter(
              (message) =>
                String(
                  getMessageId(
                    message,
                  ),
                ) !==
                String(
                  messageId,
                ),
            ),
        );
      },
      [],
    );

  /**
   * ==========================================================================
   * Send Message
   * ==========================================================================
   */

  const sendMessage =
    useCallback(
      async (
        body,
        attachments = [],
      ) => {
        if (!conversationId) {
          const errorObject =
            new Error(
              'A conversation ID is required.',
            );

          setSendError(
            errorObject.message,
          );

          throw errorObject;
        }

        /**
         * Validate message body.
         *
         * Attachments-only messages are still permitted.
         */
        const normalizedBody =
          typeof body === 'string'
            ? body.trim()
            : '';

        if (
          !normalizedBody &&
          !Array.isArray(
            attachments,
          )
        ) {
          const errorObject =
            new Error(
              'Message content is required.',
            );

          setSendError(
            errorObject.message,
          );

          throw errorObject;
        }

        if (
          !normalizedBody &&
          Array.isArray(
            attachments,
          ) &&
          attachments.length ===
            0
        ) {
          const errorObject =
            new Error(
              'Message content or an attachment is required.',
            );

          setSendError(
            errorObject.message,
          );

          throw errorObject;
        }

        const sendId =
          ++sendSequenceRef.current;

        setSending(true);
        setSendError(null);

        try {
          /**
           * The backend should generate/validate the authoritative message
           * identity and enforce idempotency.
           */
          const response =
            await postMessage({
              conversationId,

              body: normalizedBody,

              attachments:
                Array.isArray(
                  attachments,
                )
                  ? attachments
                  : [],
            });

          /**
           * Ignore a stale send completion.
           *
           * The request may still have succeeded server-side; this guard only
           * prevents an obsolete React lifecycle operation from mutating
           * state.
           */
          if (
            !mountedRef.current
          ) {
            return response;
          }

          /**
           * Do NOT blindly append the response.
           *
           * The same message may subsequently arrive through Socket.IO.
           *
           * mergeMessage() makes the HTTP response idempotent at the local
           * state level.
           */
          if (response) {
            setMessages(
              (previous) =>
                mergeMessage(
                  previous,
                  response,
                ),
            );
          }

          return response;
        } catch (err) {
          if (
            !mountedRef.current ||
            sendId !==
              sendSequenceRef.current
          ) {
            throw err;
          }

          const message =
            getErrorMessage(
              err,
              DEFAULT_SEND_ERROR,
            );

          setSendError(
            message,
          );

          throw err;
        } finally {
          if (
            mountedRef.current &&
            sendId ===
              sendSequenceRef.current
          ) {
            setSending(false);
          }
        }
      },
      [conversationId],
    );

  /**
   * ==========================================================================
   * Browser Online / Offline Lifecycle
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    const handleOnline =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setOnline(true);

        /**
         * Reconcile conversation after network recovery.
         */
        if (conversationId) {
          loadConversation({
            silent: true,
          }).catch(() => {});
        }
      };

    const handleOffline =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setOnline(false);
      };

    window.addEventListener(
      'online',
      handleOnline,
    );

    window.addEventListener(
      'offline',
      handleOffline,
    );

    return () => {
      window.removeEventListener(
        'online',
        handleOnline,
      );

      window.removeEventListener(
        'offline',
        handleOffline,
      );
    };
  }, [
    conversationId,
    loadConversation,
  ]);

  /**
   * ==========================================================================
   * Conversation Lifecycle / Socket Room
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    /**
     * No conversation selected.
     */
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      setConnected(false);

      return undefined;
    }

    /**
     * ------------------------------------------------------------------------
     * Initial Load
     * ------------------------------------------------------------------------
     */

    loadConversation().catch(
      () => {},
    );

    /**
     * ------------------------------------------------------------------------
     * Initialize Socket
     * ------------------------------------------------------------------------
     */

    let socket = null;

    try {
      socket =
        initSocket();

      socketRef.current =
        socket || null;
    } catch {
      if (
        mountedRef.current
      ) {
        setConnected(false);
      }
    }

    /**
     * ------------------------------------------------------------------------
     * Join Room
     * ------------------------------------------------------------------------
     */

    try {
      /**
       * Leave an old room defensively if the socket abstraction retains one.
       */
      if (
        activeRoomRef.current &&
        String(
          activeRoomRef.current,
        ) !==
          String(
            conversationId,
          )
      ) {
        leaveRoom(
          activeRoomRef.current,
        );
      }

      joinRoom(
        conversationId,
      );

      activeRoomRef.current =
        conversationId;
    } catch {
      /**
       * Room subscription failure should not prevent REST conversation
       * access.
       */
    }

    /**
     * ==========================================================================
     * Event Handlers
     * ==========================================================================
     */

    /**
     * New realtime message.
     */
    const handleNewMessage =
      (message) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const incomingConversationId =
          getConversationIdFromMessage(
            message,
          );

        if (
          !incomingConversationId ||
          String(
            incomingConversationId,
          ) !==
            String(
              conversationId,
            )
        ) {
          return;
        }

        setMessages(
          (previous) =>
            mergeMessage(
              previous,
              message,
            ),
        );
      };

    /**
     * Message update.
     */
    const handleMessageUpdate =
      (message) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const incomingConversationId =
          getConversationIdFromMessage(
            message,
          );

        if (
          !incomingConversationId ||
          String(
            incomingConversationId,
          ) !==
            String(
              conversationId,
            )
        ) {
          return;
        }

        setMessages(
          (previous) =>
            mergeMessage(
              previous,
              message,
            ),
        );
      };

    /**
     * Message deletion.
     */
    const handleMessageDelete =
      (payload) => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        const payloadConversationId =
          getConversationIdFromMessage(
            payload,
          );

        if (
          payloadConversationId &&
          String(
            payloadConversationId,
          ) !==
            String(
              conversationId,
            )
        ) {
          return;
        }

        const messageId =
          getMessageId(
            payload,
          ) ??
          payload?.messageId;

        if (!messageId) {
          return;
        }

        removeMessage(
          messageId,
        );
      };

    /**
     * Conversation metadata update.
     */
    const handleConversationUpdate =
      (update) => {
        if (
          !mountedRef.current ||
          !update
        ) {
          return;
        }

        const updateId =
          update._id ??
          update.id ??
          update.conversationId;

        if (
          !updateId ||
          String(updateId) !==
            String(
              conversationId,
            )
        ) {
          return;
        }

        setConversation(
          (previous) => ({
            ...(previous || {}),
            ...update,
          }),
        );
      };

    /**
     * Socket connected.
     */
    const handleConnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setConnected(true);
        setOnline(true);

        /**
         * Rejoin the room after a transport reconnect.
         */
        try {
          joinRoom(
            conversationId,
          );
        } catch {
          // REST reconciliation below remains authoritative.
        }

        /**
         * Reconcile state because events may have been missed while offline.
         */
        loadConversation({
          silent: true,
        }).catch(() => {});
      };

    /**
     * Socket reconnect.
     */
    const handleReconnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setConnected(true);
        setOnline(true);

        try {
          joinRoom(
            conversationId,
          );
        } catch {
          // Continue with authoritative REST reconciliation.
        }

        loadConversation({
          silent: true,
        }).catch(() => {});
      };

    /**
     * Socket disconnect.
     */
    const handleDisconnect =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setConnected(false);
      };

    /**
     * Socket connection error.
     */
    const handleConnectError =
      () => {
        if (
          !mountedRef.current
        ) {
          return;
        }

        setConnected(false);
      };

    /**
     * ==========================================================================
     * Register Events
     * ==========================================================================
     */

    on(
      SOCKET_EVENTS.MESSAGE_NEW,
      handleNewMessage,
    );

    on(
      SOCKET_EVENTS.MESSAGE_UPDATED,
      handleMessageUpdate,
    );

    on(
      SOCKET_EVENTS.MESSAGE_DELETED,
      handleMessageDelete,
    );

    on(
      SOCKET_EVENTS.CONVERSATION_UPDATE,
      handleConversationUpdate,
    );

    on(
      SOCKET_EVENTS.CONNECT,
      handleConnect,
    );

    on(
      SOCKET_EVENTS.RECONNECT,
      handleReconnect,
    );

    on(
      SOCKET_EVENTS.DISCONNECT,
      handleDisconnect,
    );

    on(
      SOCKET_EVENTS.CONNECT_ERROR,
      handleConnectError,
    );

    /**
     * ==========================================================================
     * Cleanup
     * ==========================================================================
     */

    return () => {
      mountedRef.current =
        false;

      /**
       * Invalidate outstanding asynchronous operations.
       */
      ++requestSequenceRef.current;
      ++sendSequenceRef.current;

      /**
       * Abort pending fetch where supported.
       */
      if (
        abortControllerRef.current
      ) {
        abortControllerRef.current.abort();

        abortControllerRef.current =
          null;
      }

      /**
       * Remove event listeners.
       */
      off(
        SOCKET_EVENTS.MESSAGE_NEW,
        handleNewMessage,
      );

      off(
        SOCKET_EVENTS.MESSAGE_UPDATED,
        handleMessageUpdate,
      );

      off(
        SOCKET_EVENTS.MESSAGE_DELETED,
        handleMessageDelete,
      );

      off(
        SOCKET_EVENTS.CONVERSATION_UPDATE,
        handleConversationUpdate,
      );

      off(
        SOCKET_EVENTS.CONNECT,
        handleConnect,
      );

      off(
        SOCKET_EVENTS.RECONNECT,
        handleReconnect,
      );

      off(
        SOCKET_EVENTS.DISCONNECT,
        handleDisconnect,
      );

      off(
        SOCKET_EVENTS.CONNECT_ERROR,
        handleConnectError,
      );

      /**
       * Leave only the room associated with this hook instance.
       */
      try {
        leaveRoom(
          conversationId,
        );
      } catch {
        // Cleanup must remain non-fatal.
      }

      if (
        activeRoomRef.current &&
        String(
          activeRoomRef.current,
        ) ===
          String(
            conversationId,
          )
      ) {
        activeRoomRef.current =
          null;
      }

      socketRef.current =
        null;
    };
  }, [
    conversationId,
    loadConversation,
    removeMessage,
  ]);

  /**
   * ==========================================================================
   * Public API
   * ==========================================================================
   */

  return {
    /**
     * Conversation metadata.
     */
    conversation,

    /**
     * Current conversation messages.
     */
    messages,

    /**
     * Direct state setter retained for backwards compatibility.
     */
    setMessages,

    /**
     * Initial loading state.
     */
    loading,

    /**
     * Indicates a refresh/reconciliation operation.
     */
    refreshing,

    /**
     * Indicates a message send operation is active.
     */
    sending,

    /**
     * Conversation loading error.
     */
    error,

    /**
     * Message sending error.
     */
    sendError,

    /**
     * Browser network state.
     */
    online,

    /**
     * Socket connection state.
     */
    connected,

    /**
     * Send a message through the authoritative API.
     */
    sendMessage,

    /**
     * Reload authoritative conversation state.
     */
    refresh,

    /**
     * Clear conversation loading error.
     */
    clearError,

    /**
     * Clear message sending error.
     */
    clearSendError,

    /**
     * Add/update a message locally.
     */
    upsertMessage,

    /**
     * Remove a message locally.
     */
    removeMessage,
  };
}