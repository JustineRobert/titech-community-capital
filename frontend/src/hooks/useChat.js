'use strict';

/**
 * ============================================================================
 * TITech COMMUNITY CAPITAL LTD
 * USE CHAT HOOK — ENTERPRISE EDITION
 * ============================================================================
 *
 * File:
 *   frontend/src/hooks/useChat.js
 *
 * Purpose:
 *   Enterprise React hook responsible for orchestrating the client-side
 *   conversation lifecycle.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 *   - Load conversations from the TITech API service.
 *   - Maintain reactive conversation state.
 *   - Initialize and observe the chat socket.
 *   - Process real-time message events.
 *   - Process conversation update events.
 *   - Handle socket reconnect events.
 *   - Support manual refresh.
 *   - Protect against stale asynchronous responses.
 *   - Protect against state updates after unmount.
 *   - Provide offline/online awareness.
 *   - Normalize incoming conversation/message data.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   React Component
 *        │
 *        ▼
 *   useChat()
 *        │
 *        ├──────────────► chatService
 *        │                    │
 *        │                    ▼
 *        │                 TITech API
 *        │
 *        └──────────────► chatSocket
 *                             │
 *                             ▼
 *                         Socket.IO
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This hook intentionally remains an orchestration layer.
 *
 * API concerns belong in:
 *
 *   frontend/src/services/chatService.js
 *
 * Socket concerns belong in:
 *
 *   frontend/src/sockets/chatSocket.js
 *
 * Authentication, authorization, persistence, message ordering, idempotency,
 * tenant isolation and server-side conversation integrity MUST remain
 * authoritative on the TITech backend.
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
  fetchConversations,
} from '../services/chatService';

import {
  initSocket,
  on,
  off,
} from '../sockets/chatSocket';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_ERROR_MESSAGE =
  'Failed to load conversations.';

const SOCKET_EVENTS = Object.freeze({
  MESSAGE_NEW: 'message:new',

  CONVERSATION_UPDATE:
    'conversation:update',

  CONNECT: 'connect',

  RECONNECT: 'reconnect',

  DISCONNECT: 'disconnect',

  CONNECT_ERROR:
    'connect_error',
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Normalize arbitrary API/socket errors into a safe user-facing message.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (!error) {
    return DEFAULT_ERROR_MESSAGE;
  }

  if (
    typeof error === 'string' &&
    error.trim()
  ) {
    return error;
  }

  if (
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  if (
    typeof error.response?.data?.message ===
      'string' &&
    error.response.data.message.trim()
  ) {
    return error.response.data.message;
  }

  if (
    typeof error.response?.data?.error ===
      'string' &&
    error.response.data.error.trim()
  ) {
    return error.response.data.error;
  }

  return DEFAULT_ERROR_MESSAGE;
}

/**
 * Determine whether an error represents an aborted request.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isAbortError(error) {
  return (
    error?.name ===
      'AbortError' ||
    error?.code === 'ERR_CANCELED' ||
    error?.code === 'ECONNABORTED' ||
    error?.message ===
      'canceled'
  );
}

/**
 * Safely determine a conversation identifier.
 *
 * @param {object|null} conversation
 * @returns {string|null}
 */
function getConversationId(
  conversation,
) {
  if (!conversation) {
    return null;
  }

  return (
    conversation._id ??
    conversation.id ??
    conversation.conversationId ??
    null
  );
}

/**
 * Safely determine a message identifier.
 *
 * @param {object|null} message
 * @returns {string|null}
 */
function getMessageId(message) {
  if (!message) {
    return null;
  }

  return (
    message._id ??
    message.id ??
    message.messageId ??
    null
  );
}

/**
 * Safely normalize a timestamp.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
function normalizeDate(value) {
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
    ? null
    : date;
}

/**
 * Normalize a conversation object without destroying unknown server fields.
 *
 * @param {object} conversation
 * @returns {object}
 */
function normalizeConversation(
  conversation,
) {
  if (
    !conversation ||
    typeof conversation !==
      'object'
  ) {
    return null;
  }

  const id =
    getConversationId(
      conversation,
    );

  if (!id) {
    return null;
  }

  return {
    ...conversation,

    _id: id,

    lastActivityAt:
      normalizeDate(
        conversation.lastActivityAt ??
          conversation.updatedAt ??
          conversation.createdAt,
      ),

    unreadCount:
      Number.isFinite(
        Number(
          conversation.unreadCount,
        ),
      )
        ? Math.max(
            0,
            Number(
              conversation.unreadCount,
            ),
          )
        : 0,
  };
}

/**
 * Normalize a conversation collection.
 *
 * @param {unknown} conversations
 * @returns {object[]}
 */
function normalizeConversations(
  conversations,
) {
  if (
    !Array.isArray(
      conversations,
    )
  ) {
    return [];
  }

  const map = new Map();

  conversations.forEach(
    (conversation) => {
      const normalized =
        normalizeConversation(
          conversation,
        );

      if (!normalized) {
        return;
      }

      map.set(
        normalized._id,
        normalized,
      );
    },
  );

  return Array.from(
    map.values(),
  );
}

/**
 * Determine whether two values represent the same message.
 *
 * @param {object} left
 * @param {object} right
 * @returns {boolean}
 */
function sameMessage(
  left,
  right,
) {
  const leftId =
    getMessageId(left);

  const rightId =
    getMessageId(right);

  if (
    leftId &&
    rightId
  ) {
    return (
      String(leftId) ===
      String(rightId)
    );
  }

  return false;
}

/**
 * ============================================================================
 * Hook
 * ============================================================================
 */

/**
 * useChat
 *
 * @returns {{
 *   conversations: Array,
 *   setConversations: Function,
 *   loading: boolean,
 *   refreshing: boolean,
 *   error: string|null,
 *   online: boolean,
 *   connected: boolean,
 *   refresh: Function,
 *   clearError: Function,
 *   markConversationRead: Function,
 *   upsertConversation: Function,
 *   removeConversation: Function
 * }}
 */
export default function useChat() {
  /**
   * --------------------------------------------------------------------------
   * State
   * --------------------------------------------------------------------------
   */

  const [
    conversations,
    setConversations,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
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
   * --------------------------------------------------------------------------
   * Lifecycle / Concurrency Refs
   * --------------------------------------------------------------------------
   *
   * These refs allow us to prevent stale asynchronous responses from
   * overwriting newer state.
   */

  const mountedRef =
    useRef(false);

  const requestSequenceRef =
    useRef(0);

  const abortControllerRef =
    useRef(null);

  const socketRef =
    useRef(null);

  /**
   * ==========================================================================
   * Load Conversations
   * ==========================================================================
   */

  const loadConversations =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        const requestId =
          ++requestSequenceRef.current;

        /**
         * Abort an older request.
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
          /**
           * NOTE:
           *
           * The current chatService signature accepts no arguments.
           *
           * We intentionally do not force an AbortSignal into the service
           * because doing so could break an existing implementation.
           *
           * chatService can later be enhanced to accept:
           *
           *   fetchConversations({
           *     signal: controller.signal
           *   })
           *
           * without changing the orchestration contract.
           */
          const data =
            await fetchConversations();

          /**
           * Ignore stale responses.
           */
          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return;
          }

          const normalized =
            normalizeConversations(
              data,
            );

          setConversations(
            normalized,
          );

          setError(null);
        } catch (err) {
          /**
           * Ignore intentionally aborted requests.
           */
          if (
            isAbortError(err)
          ) {
            return;
          }

          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return;
          }

          setError(
            getErrorMessage(err),
          );
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
      [],
    );

  /**
   * ==========================================================================
   * Manual Refresh
   * ==========================================================================
   */

  const refresh =
    useCallback(
      () =>
        loadConversations({
          silent: false,
        }),
      [loadConversations],
    );

  /**
   * ==========================================================================
   * Clear Error
   * ==========================================================================
   */

  const clearError =
    useCallback(() => {
      if (!mountedRef.current) {
        return;
      }

      setError(null);
    }, []);

  /**
   * ==========================================================================
   * Upsert Conversation
   * ==========================================================================
   *
   * Useful for real-time socket events.
   */

  const upsertConversation =
    useCallback(
      (incoming) => {
        const normalized =
          normalizeConversation(
            incoming,
          );

        if (!normalized) {
          return;
        }

        setConversations(
          (previous) => {
            const existingIndex =
              previous.findIndex(
                (conversation) =>
                  String(
                    getConversationId(
                      conversation,
                    ),
                  ) ===
                  String(
                    normalized._id,
                  ),
              );

            if (
              existingIndex ===
              -1
            ) {
              return [
                normalized,
                ...previous,
              ];
            }

            const next =
              [...previous];

            next[
              existingIndex
            ] = {
              ...next[
                existingIndex
              ],
              ...normalized,
            };

            return next;
          },
        );
      },
      [],
    );

  /**
   * ==========================================================================
   * Remove Conversation
   * ==========================================================================
   */

  const removeConversation =
    useCallback(
      (conversationId) => {
        if (!conversationId) {
          return;
        }

        setConversations(
          (previous) =>
            previous.filter(
              (conversation) =>
                String(
                  getConversationId(
                    conversation,
                  ),
                ) !==
                String(
                  conversationId,
                ),
            ),
        );
      },
      [],
    );

  /**
   * ==========================================================================
   * Mark Conversation Read
   * ==========================================================================
   *
   * This is intentionally a local state operation.
   *
   * If the backend exposes a read-receipt endpoint, that operation should be
   * implemented in chatService and called separately.
   */

  const markConversationRead =
    useCallback(
      (conversationId) => {
        if (!conversationId) {
          return;
        }

        setConversations(
          (previous) =>
            previous.map(
              (conversation) => {
                if (
                  String(
                    getConversationId(
                      conversation,
                    ),
                  ) !==
                  String(
                    conversationId,
                  )
                ) {
                  return conversation;
                }

                return {
                  ...conversation,

                  unreadCount: 0,
                };
              },
            ),
        );
      },
      [],
    );

  /**
   * ==========================================================================
   * Online / Offline State
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    const handleOnline =
      () => {
        if (!mountedRef.current) {
          return;
        }

        setOnline(true);

        /**
         * Refresh after recovering network connectivity.
         */
        loadConversations({
          silent: true,
        }).catch(() => {});
      };

    const handleOffline =
      () => {
        if (!mountedRef.current) {
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
  }, [loadConversations]);

  /**
   * ==========================================================================
   * Chat Initialization
   * ==========================================================================
   */

  useEffect(() => {
    mountedRef.current = true;

    /**
     * ------------------------------------------------------------------------
     * Initial API Load
     * ------------------------------------------------------------------------
     */

    loadConversations().catch(
      () => {},
    );

    /**
     * ------------------------------------------------------------------------
     * Socket Initialization
     * ------------------------------------------------------------------------
     */

    let socket = null;

    try {
      socket =
        initSocket();

      socketRef.current =
        socket || null;
    } catch (err) {
      /**
       * Socket initialization should not prevent the conversation API from
       * functioning.
       */
      if (
        mountedRef.current
      ) {
        setConnected(false);
      }
    }

    /**
     * ------------------------------------------------------------------------
     * New Message
     * ------------------------------------------------------------------------
     */

    const handleNewMessage =
      (message) => {
        if (
          !mountedRef.current ||
          !message ||
          typeof message !==
            'object'
        ) {
          return;
        }

        const conversationId =
          message.conversationId ??
          message.conversation?._id ??
          message.conversation?.id;

        if (!conversationId) {
          return;
        }

        setConversations(
          (previous) => {
            const index =
              previous.findIndex(
                (conversation) =>
                  String(
                    getConversationId(
                      conversation,
                    ),
                  ) ===
                  String(
                    conversationId,
                  ),
              );

            /**
             * If the conversation is not currently loaded, we do not invent a
             * partial conversation object. The server remains authoritative.
             *
             * A background refresh will retrieve the complete record.
             */
            if (index === -1) {
              return previous;
            }

            const next =
              [...previous];

            const current =
              next[index];

            /**
             * Protect against duplicate socket delivery.
             */
            if (
              sameMessage(
                current.lastMessage,
                message,
              )
            ) {
              return previous;
            }

            next[index] = {
              ...current,

              lastMessage:
                message,

              lastActivityAt:
                normalizeDate(
                  message.createdAt ??
                    message.sentAt ??
                    new Date(),
                ),

              unreadCount:
                Math.max(
                  0,
                  Number(
                    current.unreadCount ||
                      0,
                  ),
                ) + 1,
            };

            /**
             * Move the active conversation to the top.
             */
            const [
              updated,
            ] = next.splice(
              index,
              1,
            );

            return [
              updated,
              ...next,
            ];
          },
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Conversation Update
     * ------------------------------------------------------------------------
     */

    const handleConversationUpdate =
      (update) => {
        if (
          !mountedRef.current ||
          !update ||
          typeof update !==
            'object'
        ) {
          return;
        }

        upsertConversation(
          update,
        );
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Connected
     * ------------------------------------------------------------------------
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
         * Reconcile potentially missed events after reconnect.
         */
        loadConversations({
          silent: true,
        }).catch(() => {});
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Reconnected
     * ------------------------------------------------------------------------
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

        /**
         * Socket reconnection can occur after events were missed while
         * disconnected, therefore perform authoritative reconciliation.
         */
        loadConversations({
          silent: true,
        }).catch(() => {});
      };

    /**
     * ------------------------------------------------------------------------
     * Socket Disconnected
     * ------------------------------------------------------------------------
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
     * ------------------------------------------------------------------------
     * Socket Connection Error
     * ------------------------------------------------------------------------
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
     * ------------------------------------------------------------------------
     * Register Events
     * ------------------------------------------------------------------------
     */

    on(
      SOCKET_EVENTS.MESSAGE_NEW,
      handleNewMessage,
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
     * ------------------------------------------------------------------------
     * Cleanup
     * ------------------------------------------------------------------------
     */

    return () => {
      mountedRef.current =
        false;

      /**
       * Invalidate all outstanding requests.
       */
      ++requestSequenceRef.current;

      /**
       * Cancel active API request where supported.
       */
      if (
        abortControllerRef.current
      ) {
        abortControllerRef.current.abort();
        abortControllerRef.current =
          null;
      }

      /**
       * Remove socket listeners.
       */
      off(
        SOCKET_EVENTS.MESSAGE_NEW,
        handleNewMessage,
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

      socketRef.current =
        null;
    };
  }, [
    loadConversations,
    upsertConversation,
  ]);

  /**
   * ==========================================================================
   * Public Hook Contract
   * ==========================================================================
   */

  return {
    /**
     * Conversation collection.
     */
    conversations,

    /**
     * Direct state setter retained for compatibility with existing consumers.
     */
    setConversations,

    /**
     * Initial loading state.
     */
    loading,

    /**
     * Indicates an explicit/background refresh is in progress.
     */
    refreshing,

    /**
     * Last recoverable API/socket error.
     */
    error,

    /**
     * Browser network state.
     */
    online,

    /**
     * Real-time socket connection state.
     */
    connected,

    /**
     * Reload conversations from the authoritative API.
     */
    refresh,

    /**
     * Clear current error state.
     */
    clearError,

    /**
     * Locally mark a conversation as read.
     */
    markConversationRead,

    /**
     * Add or update a conversation.
     */
    upsertConversation,

    /**
     * Remove a conversation from local state.
     */
    removeConversation,
  };
}