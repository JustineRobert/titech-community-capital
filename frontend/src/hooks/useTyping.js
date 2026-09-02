'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Typing Indicator Hook
 * File: frontend/src/hooks/useTyping.js
 * Production Grade
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Provides reliable typing-indicator orchestration for TITech's real-time
 * communication system.
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 *
 *   React Component
 *        │
 *        ▼
 *   useTyping()
 *        │
 *        ├── typing state
 *        ├── debounce / throttle
 *        ├── inactivity timeout
 *        ├── socket event lifecycle
 *        └── cleanup / unmount safety
 *                 │
 *                 ▼
 *            chatSocket
 *                 │
 *                 ▼
 *              Socket.IO
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✓ Local typing state
 * ✓ Remote typing users
 * ✓ Socket.IO integration
 * ✓ Debounced typing-start events
 * ✓ Automatic typing-stop events
 * ✓ Inactivity timeout
 * ✓ Configurable debounce
 * ✓ Configurable timeout
 * ✓ Conversation/room aware
 * ✓ Multi-user typing support
 * ✓ Duplicate-event protection
 * ✓ Stale event protection
 * ✓ Safe unmount cleanup
 * ✓ Socket lifecycle resilience
 * ✓ React 18 compatible
 * ✓ Strict Mode friendly
 * ✓ No business logic in hook
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This hook does NOT contain chat business rules.
 *
 * API/business operations:
 *   → chatService
 *
 * Socket transport:
 *   → chatSocket
 *
 * UI orchestration:
 *   → this hook
 *
 * ============================================================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  initSocket,
  joinRoom,
  leaveRoom,
  on,
  off,
  emit,
} from '../sockets/chatSocket';

/*
|----------------------------------------------------------------------------
| Configuration
|----------------------------------------------------------------------------
*/

const DEFAULT_DEBOUNCE_MS = 300;

const DEFAULT_TYPING_TIMEOUT_MS = 3000;

const DEFAULT_MAX_TYPING_USERS = 50;

const DEFAULT_EVENTS = Object.freeze({
  START: 'typing:start',
  STOP: 'typing:stop',
});

/*
|----------------------------------------------------------------------------
| Helpers
|----------------------------------------------------------------------------
*/

/**
 * Normalize a potentially invalid identifier.
 */
function normalizeId(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
}

/**
 * Extract a user identifier from a socket payload.
 *
 * Supports common backend representations:
 *
 *   userId
 *   user._id
 *   user.id
 *   memberId
 *   actorId
 */
function getTypingUserId(payload) {
  if (!payload) {
    return null;
  }

  return normalizeId(
    payload.userId ??
      payload.user?._id ??
      payload.user?.id ??
      payload.memberId ??
      payload.actorId
  );
}

/**
 * Extract conversation identifier from a socket payload.
 */
function getConversationId(payload) {
  if (!payload) {
    return null;
  }

  return normalizeId(
    payload.conversationId ??
      payload.conversation?._id ??
      payload.conversation?.id ??
      payload.roomId
  );
}

/**
 * Normalize typing-user metadata.
 */
function normalizeTypingUser(payload) {
  if (!payload) {
    return null;
  }

  const userId =
    getTypingUserId(payload);

  if (!userId) {
    return null;
  }

  return {
    ...payload,
    userId,
    conversationId:
      getConversationId(payload),
    startedAt:
      payload.startedAt ||
      new Date().toISOString(),
  };
}

/**
 * Safely determine whether a socket event belongs to this conversation.
 */
function belongsToConversation(
  payload,
  conversationId
) {
  const incomingConversationId =
    getConversationId(payload);

  /*
   * Some socket implementations already scope events to a room and therefore
   * may not include conversationId. In that case we accept the event.
   */
  if (!incomingConversationId) {
    return true;
  }

  return (
    incomingConversationId ===
    conversationId
  );
}

/*
|----------------------------------------------------------------------------
| Hook
|----------------------------------------------------------------------------
*/

/**
 * Enterprise typing indicator hook.
 *
 * @param {string|number|null} conversationId
 * @param {Object} options
 * @returns {Object}
 */
export default function useTyping(
  conversationId,
  options = {}
) {
  const {
    enabled = true,

    debounceMs =
      DEFAULT_DEBOUNCE_MS,

    typingTimeoutMs =
      DEFAULT_TYPING_TIMEOUT_MS,

    maxTypingUsers =
      DEFAULT_MAX_TYPING_USERS,

    autoJoinRoom = true,

    events = DEFAULT_EVENTS,

    currentUserId = null,
  } = options;

  /*
  |----------------------------------------------------------------------------
  | Normalized configuration
  |----------------------------------------------------------------------------
  */

  const normalizedConversationId =
    normalizeId(
      conversationId
    );

  const normalizedCurrentUserId =
    normalizeId(
      currentUserId
    );

  const startEvent =
    events?.START ||
    DEFAULT_EVENTS.START;

  const stopEvent =
    events?.STOP ||
    DEFAULT_EVENTS.STOP;

  /*
  |----------------------------------------------------------------------------
  | State
  |----------------------------------------------------------------------------
  */

  const [
    isTyping,
    setIsTyping,
  ] = useState(false);

  const [
    typingUsers,
    setTypingUsers,
  ] = useState([]);

  const [
    lastTypingUser,
    setLastTypingUser,
  ] = useState(null);

  /*
  |----------------------------------------------------------------------------
  | Refs
  |----------------------------------------------------------------------------
  */

  const mountedRef =
    useRef(false);

  const typingStateRef =
    useRef(false);

  const startTimerRef =
    useRef(null);

  const stopTimerRef =
    useRef(null);

  const remoteTimeoutsRef =
    useRef(new Map());

  const roomRef =
    useRef(null);

  const currentConversationRef =
    useRef(
      normalizedConversationId
    );

  /*
  |----------------------------------------------------------------------------
  | Keep conversation reference current
  |----------------------------------------------------------------------------
  */

  useEffect(() => {
    currentConversationRef.current =
      normalizedConversationId;
  }, [
    normalizedConversationId,
  ]);

  /*
  |----------------------------------------------------------------------------
  | Clear Local Timers
  |----------------------------------------------------------------------------
  */

  const clearLocalTimers =
    useCallback(() => {
      if (
        startTimerRef.current
      ) {
        clearTimeout(
          startTimerRef.current
        );

        startTimerRef.current = null;
      }

      if (
        stopTimerRef.current
      ) {
        clearTimeout(
          stopTimerRef.current
        );

        stopTimerRef.current = null;
      }
    }, []);

  /*
  |----------------------------------------------------------------------------
  | Clear Remote Timers
  |----------------------------------------------------------------------------
  */

  const clearRemoteTimers =
    useCallback(() => {
      remoteTimeoutsRef.current.forEach(
        (timer) => {
          clearTimeout(timer);
        }
      );

      remoteTimeoutsRef.current.clear();
    }, []);

  /*
  |----------------------------------------------------------------------------
  | Remove Remote Typing User
  |----------------------------------------------------------------------------
  */

  const removeTypingUser =
    useCallback(
      (userId) => {
        if (!userId) {
          return;
        }

        setTypingUsers(
          (previous) =>
            previous.filter(
              (user) =>
                user.userId !==
                userId
            )
        );

        const timer =
          remoteTimeoutsRef.current.get(
            userId
          );

        if (timer) {
          clearTimeout(timer);

          remoteTimeoutsRef.current.delete(
            userId
          );
        }
      },
      []
    );

  /*
  |----------------------------------------------------------------------------
  | Add / Update Remote Typing User
  |----------------------------------------------------------------------------
  */

  const addTypingUser =
    useCallback(
      (payload) => {
        if (
          !mountedRef.current ||
          !enabled
        ) {
          return;
        }

        if (
          !belongsToConversation(
            payload,
            normalizedConversationId
          )
        ) {
          return;
        }

        const user =
          normalizeTypingUser(
            payload
          );

        if (!user) {
          return;
        }

        /*
         * Never display our own typing indicator as a remote user.
         */
        if (
          normalizedCurrentUserId &&
          user.userId ===
            normalizedCurrentUserId
        ) {
          return;
        }

        const userId =
          user.userId;

        setTypingUsers(
          (previous) => {
            const existingIndex =
              previous.findIndex(
                (item) =>
                  item.userId ===
                  userId
              );

            if (
              existingIndex >=
              0
            ) {
              const next = [
                ...previous,
              ];

              next[
                existingIndex
              ] = {
                ...next[
                  existingIndex
                ],
                ...user,
                lastSeenAt:
                  new Date().toISOString(),
              };

              return next;
            }

            return [
              user,
              ...previous,
            ].slice(
              0,
              maxTypingUsers
            );
          }
        );

        setLastTypingUser(user);

        /*
         * Reset inactivity timer for this remote user.
         */
        const existingTimer =
          remoteTimeoutsRef.current.get(
            userId
          );

        if (existingTimer) {
          clearTimeout(
            existingTimer
          );
        }

        const timer =
          setTimeout(() => {
            removeTypingUser(
              userId
            );
          }, typingTimeoutMs);

        remoteTimeoutsRef.current.set(
          userId,
          timer
        );
      },
      [
        enabled,
        maxTypingUsers,
        normalizedConversationId,
        normalizedCurrentUserId,
        removeTypingUser,
        typingTimeoutMs,
      ]
    );

  /*
  |----------------------------------------------------------------------------
  | Handle Remote Typing Stop
  |----------------------------------------------------------------------------
  */

  const handleRemoteTypingStop =
    useCallback(
      (payload) => {
        if (
          !mountedRef.current ||
          !enabled
        ) {
          return;
        }

        if (
          !belongsToConversation(
            payload,
            normalizedConversationId
          )
        ) {
          return;
        }

        const userId =
          getTypingUserId(
            payload
          );

        if (!userId) {
          return;
        }

        removeTypingUser(
          userId
        );
      },
      [
        enabled,
        normalizedConversationId,
        removeTypingUser,
      ]
    );

  /*
  |----------------------------------------------------------------------------
  | Emit Typing Start
  |----------------------------------------------------------------------------
  */

  const emitTypingStart =
    useCallback(() => {
      if (
        !enabled ||
        !normalizedConversationId ||
        !mountedRef.current
      ) {
        return;
      }

      if (
        typingStateRef.current
      ) {
        /*
         * Already typing. Do not emit duplicate start events.
         */
        return;
      }

      typingStateRef.current = true;

      setIsTyping(true);

      emit(startEvent, {
        conversationId:
          normalizedConversationId,
        userId:
          normalizedCurrentUserId,
        timestamp:
          new Date().toISOString(),
      });
    }, [
      enabled,
      normalizedConversationId,
      normalizedCurrentUserId,
      startEvent,
    ]);

  /*
  |----------------------------------------------------------------------------
  | Emit Typing Stop
  |----------------------------------------------------------------------------
  */

  const emitTypingStop =
    useCallback(() => {
      if (
        !typingStateRef.current
      ) {
        return;
      }

      typingStateRef.current = false;

      setIsTyping(false);

      if (
        !normalizedConversationId
      ) {
        return;
      }

      emit(stopEvent, {
        conversationId:
          normalizedConversationId,
        userId:
          normalizedCurrentUserId,
        timestamp:
          new Date().toISOString(),
      });
    }, [
      normalizedConversationId,
      normalizedCurrentUserId,
      stopEvent,
    ]);

  /*
  |----------------------------------------------------------------------------
  | Notify Typing
  |----------------------------------------------------------------------------
  */

  const notifyTyping =
    useCallback(() => {
      if (
        !enabled ||
        !normalizedConversationId ||
        !mountedRef.current
      ) {
        return;
      }

      /*
       * Reset inactivity timer.
       */
      if (
        stopTimerRef.current
      ) {
        clearTimeout(
          stopTimerRef.current
        );
      }

      /*
       * Debounce the start event.
       */
      if (
        !typingStateRef.current
      ) {
        if (
          startTimerRef.current
        ) {
          clearTimeout(
            startTimerRef.current
          );
        }

        startTimerRef.current =
          setTimeout(() => {
            startTimerRef.current =
              null;

            emitTypingStart();
          }, debounceMs);
      }

      /*
       * Automatically stop typing after inactivity.
       */
      stopTimerRef.current =
        setTimeout(() => {
          stopTimerRef.current =
            null;

          emitTypingStop();
        }, typingTimeoutMs);
    }, [
      debounceMs,
      emitTypingStart,
      emitTypingStop,
      enabled,
      normalizedConversationId,
      typingTimeoutMs,
    ]);

  /*
  |----------------------------------------------------------------------------
  | Explicit Stop
  |----------------------------------------------------------------------------
  */

  const stopTyping =
    useCallback(() => {
      clearLocalTimers();

      emitTypingStop();
    }, [
      clearLocalTimers,
      emitTypingStop,
    ]);

  /*
  |----------------------------------------------------------------------------
  | Socket Lifecycle
  |----------------------------------------------------------------------------
  */

  useEffect(() => {
    mountedRef.current = true;

    if (
      !enabled ||
      !normalizedConversationId
    ) {
      return () => {
        mountedRef.current = false;
      };
    }

    initSocket();

    if (
      autoJoinRoom
    ) {
      joinRoom(
        normalizedConversationId
      );

      roomRef.current =
        normalizedConversationId;
    }

    /*
     * Remote typing events.
     */
    on(
      startEvent,
      addTypingUser
    );

    on(
      stopEvent,
      handleRemoteTypingStop
    );

    /*
     * Cleanup.
     */
    return () => {
      mountedRef.current = false;

      clearLocalTimers();

      clearRemoteTimers();

      if (
        typingStateRef.current
      ) {
        /*
         * Best-effort stop event during unmount.
         *
         * We intentionally do not depend on React state here.
         */
        typingStateRef.current = false;

        if (
          normalizedConversationId
        ) {
          emit(stopEvent, {
            conversationId:
              normalizedConversationId,
            userId:
              normalizedCurrentUserId,
            timestamp:
              new Date().toISOString(),
          });
        }
      }

      off(
        startEvent,
        addTypingUser
      );

      off(
        stopEvent,
        handleRemoteTypingStop
      );

      if (
        roomRef.current
      ) {
        leaveRoom(
          roomRef.current
        );

        roomRef.current =
          null;
      }

      setIsTyping(false);
      setTypingUsers([]);
      setLastTypingUser(null);
    };
  }, [
    addTypingUser,
    autoJoinRoom,
    clearLocalTimers,
    clearRemoteTimers,
    enabled,
    handleRemoteTypingStop,
    normalizedConversationId,
    normalizedCurrentUserId,
    startEvent,
    stopEvent,
  ]);

  /*
  |----------------------------------------------------------------------------
  | Conversation Change Safety
  |----------------------------------------------------------------------------
  */

  useEffect(() => {
    /*
     * When switching conversations, ensure no typing state from the previous
     * room leaks into the new conversation.
     */
    clearLocalTimers();

    clearRemoteTimers();

    typingStateRef.current =
      false;

    setIsTyping(false);
    setTypingUsers([]);
    setLastTypingUser(null);
  }, [
    normalizedConversationId,
    clearLocalTimers,
    clearRemoteTimers,
  ]);

  /*
  |----------------------------------------------------------------------------
  | Derived State
  |----------------------------------------------------------------------------
  */

  const typingCount =
    typingUsers.length;

  const someoneTyping =
    typingCount > 0;

  const typingText =
    useMemo(() => {
      if (
        typingCount === 0
      ) {
        return '';
      }

      if (
        typingCount === 1
      ) {
        const name =
          typingUsers[0]
            ?.name ||
          typingUsers[0]
            ?.displayName ||
          'Someone';

        return `${name} is typing…`;
      }

      if (
        typingCount === 2
      ) {
        const first =
          typingUsers[0]
            ?.name ||
          typingUsers[0]
            ?.displayName ||
          'Someone';

        const second =
          typingUsers[1]
            ?.name ||
          typingUsers[1]
            ?.displayName ||
          'Someone';

        return `${first} and ${second} are typing…`;
      }

      return `${typingCount} people are typing…`;
    }, [
      typingCount,
      typingUsers,
    ]);

  /*
  |----------------------------------------------------------------------------
  | Return API
  |----------------------------------------------------------------------------
  */

  return {
    /*
     * Local typing state.
     */
    isTyping,

    /*
     * Remote typing state.
     */
    typingUsers,
    typingCount,
    someoneTyping,
    lastTypingUser,
    typingText,

    /*
     * Actions.
     */
    notifyTyping,
    stopTyping,

    /*
     * Utility.
     */
    clearTypingUsers: useCallback(
      () => {
        clearRemoteTimers();

        setTypingUsers([]);
        setLastTypingUser(null);
      },
      [clearRemoteTimers]
    ),

    /*
     * Diagnostics.
     */
    conversationId:
      normalizedConversationId,

    enabled,
  };
}