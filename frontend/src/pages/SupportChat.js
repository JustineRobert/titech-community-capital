'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Support Chat
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/SupportChat.js
 *
 * Purpose:
 *   Production-grade TITech customer/support communication surface with:
 *
 *   ✓ REST message history
 *   ✓ WebSocket real-time messaging
 *   ✓ REST fallback
 *   ✓ Automatic reconnect with exponential backoff + jitter
 *   ✓ Manual reconnect
 *   ✓ Offline message queue
 *   ✓ Optimistic messaging
 *   ✓ Server acknowledgement reconciliation
 *   ✓ Typing indicators
 *   ✓ Presence-aware connection state
 *   ✓ File attachment uploads
 *   ✓ Attachment validation
 *   ✓ Accessible message log
 *   ✓ Keyboard shortcuts
 *   ✓ Read-state synchronization
 *   ✓ Bounded client memory
 *   ✓ Error recovery
 *   ✓ Loading states
 *   ✓ Safe telemetry hooks
 *   ✓ Tenant-aware context support
 *   ✓ Stable test selectors
 *   ✓ TITech branding consistency
 *
 * ============================================================================
 *
 * SECURITY NOTES
 * ----------------------------------------------------------------------------
 *
 * 1. Authentication tokens are NOT placed in the WebSocket URL.
 *    Query-string tokens can leak through logs, browser history, proxies and
 *    infrastructure telemetry.
 *
 * 2. The WebSocket server MUST independently authenticate and authorize the
 *    connection and conversation subscription.
 *
 * 3. The frontend MUST NOT be treated as the authoritative tenant-security
 *    boundary.
 *
 * 4. File validation here is UX protection only. Server-side validation MUST
 *    independently validate:
 *      - MIME type
 *      - extension
 *      - file size
 *      - content
 *      - malware
 *      - tenant authorization
 *
 * 5. Never render raw HTML received from messages.
 *
 * ============================================================================
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronDown,
  Circle,
  Paperclip,
  RefreshCw,
  Send,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

import {
  toast,
} from 'react-toastify';

import {
  useAuth,
} from '../context/AuthContext';

import api from '../services/api';

import logger from '../utils/logger';

import Spinner from '../components/ui/Spinner';

import MessageBubble from '../components/chat/MessageBubble';

import AttachmentPreview from '../components/chat/AttachmentPreview';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_CONVERSATION_ID =
  'support-general';

const DEFAULT_TITLE =
  'TITech Support';

const WS_RECONNECT_BASE_MS =
  1000;

const WS_RECONNECT_MAX_MS =
  30000;

const WS_RECONNECT_JITTER_MS =
  500;

const MAX_OFFLINE_QUEUE =
  200;

const MAX_MESSAGES =
  1000;

const HISTORY_LIMIT =
  100;

const MESSAGE_MAX_LENGTH =
  5000;

const TYPING_DEBOUNCE_MS =
  350;

const TYPING_EXPIRY_MS =
  3000;

const READ_DEBOUNCE_MS =
  750;

const MAX_ATTACHMENT_SIZE =
  10 * 1024 * 1024;

const MAX_ATTACHMENTS =
  5;

const ALLOWED_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
];

const EMPTY_ARRAY = [];

const EMPTY_OBJECT = {};


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


const safeText = (
  value,
  fallback = '',
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    return (
      String(value).trim() ||
      fallback
    );
  } catch {
    return fallback;
  }
};


const normalizeId = (
  value,
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(
    value,
  );
};


const getApiData = (
  response,
) => {
  if (
    response?.data?.data !==
    undefined
  ) {
    return response.data.data;
  }

  return (
    response?.data ??
    EMPTY_ARRAY
  );
};


const extractErrorMessage = (
  error,
  fallback,
) =>
  safeText(
    error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message,
    fallback,
  );


const getCurrentUserId = (
  user,
) =>
  normalizeId(
    user?.id ??
      user?.userId ??
      user?.uuid,
  );


const getMessageId = (
  message,
) =>
  normalizeId(
    message?.id ??
      message?._id ??
      message?.messageId,
  );


const getMessageSenderId = (
  message,
) =>
  normalizeId(
    message?.senderId ??
      message?.userId ??
      message?.from?.id ??
      message?.sender?.id ??
      message?.author?.id,
  );


const getMessageTimestamp = (
  message,
) =>
  message?.createdAt ??
  message?.timestamp ??
  message?.sentAt ??
  new Date().toISOString();


const isOwnMessage = (
  message,
  currentUserId,
) =>
  Boolean(
    currentUserId &&
      getMessageSenderId(
        message,
      ) === currentUserId,
  );


const createTemporaryId = () =>
  `titech-tmp-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;


const createClientCorrelationId =
  () =>
    `titech-client-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;


const normalizeMessages = (
  value,
) => {
  if (
    Array.isArray(value)
  ) {
    return value;
  }

  if (
    Array.isArray(
      value?.messages,
    )
  ) {
    return value.messages;
  }

  if (
    Array.isArray(
      value?.items,
    )
  ) {
    return value.items;
  }

  return [];
};


const normalizeTypingUser = (
  value,
) => {
  if (
    !value
  ) {
    return null;
  }

  if (
    typeof value ===
    'string' ||
    typeof value ===
      'number'
  ) {
    return {
      id:
        String(
          value,
        ),

      name:
        'Support agent',
    };
  }

  const id =
    normalizeId(
      value.id ??
        value.userId ??
        value.uuid,
    );

  if (
    !id
  ) {
    return null;
  }

  return {
    id,

    name:
      safeText(
        value.name ??
          value.displayName ??
          value.fullName,
        'Support agent',
      ),
  };
};


const getFileExtension = (
  filename,
) => {
  const normalized =
    safeText(
      filename,
    ).toLowerCase();

  const index =
    normalized.lastIndexOf(
      '.',
    );

  return index >=
    0
    ? normalized.slice(
        index,
      )
    : '';
};


const validateAttachment = (
  file,
) => {
  if (
    !file
  ) {
    return {
      valid:
        false,

      message:
        'No file was selected.',
    };
  }

  if (
    file.size >
    MAX_ATTACHMENT_SIZE
  ) {
    return {
      valid:
        false,

      message:
        `Attachment "${file.name}" exceeds the ${Math.round(
          MAX_ATTACHMENT_SIZE /
            1024 /
            1024,
        )} MB limit.`,
    };
  }

  const mimeAllowed =
    ALLOWED_ATTACHMENT_TYPES.includes(
      safeText(
        file.type,
      ).toLowerCase(),
    );

  const extensionAllowed =
    ALLOWED_ATTACHMENT_EXTENSIONS.includes(
      getFileExtension(
        file.name,
      ),
    );

  if (
    !mimeAllowed &&
    !extensionAllowed
  ) {
    return {
      valid:
        false,

      message:
        `File type "${file.type || 'unknown'}" is not supported.`,
    };
  }

  return {
    valid:
      true,
  };
};


/* ============================================================================
 * Local debounce hook
 *
 * The supplied implementation attempted:
 *
 *   const useDebounce = useDebouncedCallback || fallback;
 *
 * That is unsafe because hooks cannot be selected conditionally at runtime.
 * A local implementation keeps this component deterministic and dependency-
 * independent.
 * ========================================================================== */

function useDebouncedCallback(
  callback,
  wait = 300,
) {
  const callbackRef =
    useRef(
      callback,
    );

  const timerRef =
    useRef(null);

  useEffect(
    () => {
      callbackRef.current =
        callback;
    },
    [
      callback,
    ],
  );

  useEffect(
    () => () => {
      if (
        timerRef.current
      ) {
        clearTimeout(
          timerRef.current,
        );
      }
    },
    [],
  );

  return useCallback(
    (...args) => {
      if (
        timerRef.current
      ) {
        clearTimeout(
          timerRef.current,
        );
      }

      timerRef.current =
        setTimeout(
          () => {
            callbackRef.current(
              ...args,
            );
          },
          wait,
        );
    },
    [
      wait,
    ],
  );
}


/* ============================================================================
 * SupportChat
 * ========================================================================== */

export default function SupportChat({
  conversationId =
    DEFAULT_CONVERSATION_ID,

  title =
    DEFAULT_TITLE,

  websocketUrl,

  maxMessages =
    MAX_MESSAGES,

  historyLimit =
    HISTORY_LIMIT,

  maxMessageLength =
    MESSAGE_MAX_LENGTH,

  maxAttachments =
    MAX_ATTACHMENTS,

  attachmentMaxSize =
    MAX_ATTACHMENT_SIZE,

  onMessage,

  onConnectionChange,

  onError,

  tenantId,

  className =
    '',
}) {
  const auth =
    useAuth() ??
    EMPTY_OBJECT;

  const {
    user,
    token,
  } = auth;


  /* ==========================================================================
   * State
   * ======================================================================== */

  const [
    messages,
    setMessages,
  ] = useState(
    [],
  );

  const [
    input,
    setInput,
  ] = useState(
    '',
  );

  const [
    sending,
    setSending,
  ] = useState(
    false,
  );

  const [
    connected,
    setConnected,
  ] = useState(
    false,
  );

  const [
    connecting,
    setConnecting,
  ] = useState(
    false,
  );

  const [
    typingUsers,
    setTypingUsers,
  ] = useState(
    [],
  );

  const [
    error,
    setError,
  ] = useState(
    null,
  );

  const [
    attachments,
    setAttachments,
  ] = useState(
    [],
  );

  const [
    uploading,
    setUploading,
  ] = useState(
    false,
  );

  const [
    initialLoading,
    setInitialLoading,
  ] = useState(
    true,
  );

  const [
    hasMoreMessages,
    setHasMoreMessages,
  ] = useState(
    false,
  );

  const [
    loadingMore,
    setLoadingMore,
  ] = useState(
    false,
  );

  const [
    online,
    setOnline,
  ] = useState(
    typeof navigator !==
      'undefined'
      ? navigator.onLine
      : true,
  );


  /* ==========================================================================
   * Refs
   * ======================================================================== */

  const wsRef =
    useRef(null);

  const reconnectTimerRef =
    useRef(null);

  const reconnectAttemptsRef =
    useRef(0);

  const offlineQueueRef =
    useRef([]);

  const typingExpiryTimersRef =
    useRef(
      new Map(),
    );

  const mountedRef =
    useRef(false);

  const listRef =
    useRef(null);

  const inputRef =
    useRef(null);

  const attachmentInputRef =
    useRef(null);

  const shouldAutoScrollRef =
    useRef(true);

  const lastMessageIdRef =
    useRef(null);

  const readTimerRef =
    useRef(null);

  const lastReadMessageIdRef =
    useRef(null);

  const currentConversationRef =
    useRef(
      conversationId,
    );


  /* ==========================================================================
   * Derived values
   * ======================================================================== */

  const currentUserId =
    useMemo(
      () =>
        getCurrentUserId(
          user,
        ),
      [
        user,
      ],
    );

  const resolvedTenantId =
    tenantId ??
    user?.tenantId ??
    user?.tenant?.id ??
    null;

  const resolvedMaxMessages =
    Math.max(
      50,
      Number(
        maxMessages,
      ) ||
        MAX_MESSAGES,
    );

  const resolvedHistoryLimit =
    Math.min(
      200,
      Math.max(
        1,
        Number(
          historyLimit,
        ) ||
          HISTORY_LIMIT,
      ),
    );

  const resolvedMaxMessageLength =
    Math.max(
      100,
      Number(
        maxMessageLength,
      ) ||
        MESSAGE_MAX_LENGTH,
    );

  const resolvedMaxAttachments =
    Math.max(
      1,
      Number(
        maxAttachments,
      ) ||
        MAX_ATTACHMENTS,
    );

  const resolvedAttachmentMaxSize =
    Math.max(
      1024,
      Number(
        attachmentMaxSize,
      ) ||
        MAX_ATTACHMENT_SIZE,
    );


  const canSend =
    !sending &&
    !uploading &&
    (
      input.trim().length >
        0 ||
      attachments.length >
        0
    ) &&
    input.length <=
      resolvedMaxMessageLength;


  const connectionLabel =
    connected
      ? 'Connected'
      : connecting
        ? 'Connecting'
        : online
          ? 'Disconnected'
          : 'Offline';


  /* ==========================================================================
   * WS URL
   * ======================================================================== */

  const resolvedWsUrl =
    useMemo(
      () => {
        const configured =
          websocketUrl ||
          process.env
            ?.REACT_APP_WS_URL ||
          process.env
            ?.REACT_APP_API_WS;

        if (
          configured
        ) {
          return configured
            .replace(
              /\/+$/,
              '',
            )
            .replace(
              /^http:\/\//i,
              'ws://',
            )
            .replace(
              /^https:\/\//i,
              'wss://',
            ) +
            '/ws/support';
        }

        if (
          typeof window ===
          'undefined'
        ) {
          return null;
        }

        const protocol =
          window.location.protocol ===
          'https:'
            ? 'wss:'
            : 'ws:';

        return `${protocol}//${window.location.host}/ws/support`;
      },
      [
        websocketUrl,
      ],
    );


  /* ==========================================================================
   * Scroll helpers
   * ======================================================================== */

  const isNearBottom =
    useCallback(
      () => {
        const element =
          listRef.current;

        if (
          !element
        ) {
          return true;
        }

        const threshold =
          80;

        return (
          element.scrollHeight -
            element.scrollTop -
            element.clientHeight <=
          threshold
        );
      },
      [],
    );


  const scrollToBottom =
    useCallback(
      (
        behavior = 'smooth',
      ) => {
        try {
          const element =
            listRef.current;

          if (
            !element
          ) {
            return;
          }

          element.scrollTo({
            top:
              element.scrollHeight,

            behavior,
          });
        } catch {
          try {
            if (
              listRef.current
            ) {
              listRef.current.scrollTop =
                listRef.current.scrollHeight;
            }
          } catch {
            // Intentionally ignored.
          }
        }
      },
      [],
    );


  /* ==========================================================================
   * Message state helpers
   * ======================================================================== */

  const appendMessage =
    useCallback(
      message => {
        if (
          !message
        ) {
          return;
        }

        const normalizedMessage =
          {
            ...message,

            id:
              getMessageId(
                message,
              ) ||
              createTemporaryId(),

            conversationId:
              message.conversationId ||
              conversationId,

            createdAt:
              getMessageTimestamp(
                message,
              ),
          };

        setMessages(
          previous => {
            const incomingId =
              getMessageId(
                normalizedMessage,
              );

            if (
              incomingId &&
              previous.some(
                messageItem =>
                  getMessageId(
                    messageItem,
                  ) ===
                  incomingId,
              )
            ) {
              return previous;
            }

            return [
              ...previous,
              normalizedMessage,
            ].slice(
              -resolvedMaxMessages,
            );
          },
        );

        onMessage?.(
          normalizedMessage,
        );
      },
      [
        conversationId,
        onMessage,
        resolvedMaxMessages,
      ],
    );


  const replaceOptimisticMessage =
    useCallback(
      (
        temporaryId,
        serverMessage,
      ) => {
        if (
          !temporaryId ||
          !serverMessage
        ) {
          return;
        }

        setMessages(
          previous =>
            previous.map(
              messageItem =>
                getMessageId(
                  messageItem,
                ) ===
                temporaryId
                  ? {
                      ...serverMessage,

                      status:
                        'sent',

                      conversationId:
                        serverMessage.conversationId ||
                        conversationId,
                    }
                  : messageItem,
            ),
        );
      },
      [
        conversationId,
      ],
    );


  const markOptimisticFailed =
    useCallback(
      temporaryId => {
        setMessages(
          previous =>
            previous.map(
              messageItem =>
                getMessageId(
                  messageItem,
                ) ===
                temporaryId
                  ? {
                      ...messageItem,

                      status:
                        'failed',
                    }
                  : messageItem,
            ),
        );
      },
      [],
    );


  const removeOptimisticMessage =
    useCallback(
      temporaryId => {
        setMessages(
          previous =>
            previous.filter(
              messageItem =>
                getMessageId(
                  messageItem,
                ) !==
                temporaryId,
            ),
        );
      },
      [],
    );


  /* ==========================================================================
   * WebSocket event send helper
   * ======================================================================== */

  const sendWsEvent =
    useCallback(
      (
        type,
        payload = {},
      ) => {
        const socket =
          wsRef.current;

        if (
          !socket ||
          socket.readyState !==
            WebSocket.OPEN
        ) {
          return false;
        }

        try {
          socket.send(
            JSON.stringify({
              type,

              payload,

              meta: {
                conversationId,

                tenantId:
                  resolvedTenantId ||
                  undefined,

                timestamp:
                  new Date().toISOString(),
              },
            }),
          );

          return true;
        } catch (
          sendError
        ) {
          logger?.warn?.(
            'TITech SupportChat WebSocket send failed',
            {
              error:
                sendError?.message,
            },
          );

          return false;
        }
      },
      [
        conversationId,
        resolvedTenantId,
      ],
    );


  /* ==========================================================================
   * Offline queue
   * ======================================================================== */

  const queueOfflineMessage =
    useCallback(
      (
        payload,
        temporaryId,
      ) => {
        offlineQueueRef.current.push({
          payload,

          temporaryId,

          queuedAt:
            Date.now(),
        });

        if (
          offlineQueueRef.current
            .length >
          MAX_OFFLINE_QUEUE
        ) {
          offlineQueueRef.current.shift();
        }
      },
      [],
    );


  /* ==========================================================================
   * Flush offline queue
   * ======================================================================== */

  const flushOfflineQueue =
    useCallback(
      async () => {
        if (
          !offlineQueueRef
            .current.length
        ) {
          return;
        }

        const queue =
          offlineQueueRef.current.splice(
            0,
            offlineQueueRef.current.length,
          );

        for (
          const item of queue
        ) {
          if (
            !mountedRef.current
          ) {
            return;
          }

          try {
            const sent =
              sendWsEvent(
                'message.create',
                item.payload,
              );

            if (
              sent
            ) {
              continue;
            }

            const response =
              await api.post(
                `/api/support/${encodeURIComponent(
                  conversationId,
                )}/messages`,
                item.payload,
                {
                  timeout:
                    20000,
                },
              );

            const serverMessage =
              getApiData(
                response,
              );

            if (
              serverMessage
            ) {
              replaceOptimisticMessage(
                item.temporaryId,
                serverMessage,
              );
            }
          } catch (
            queueError
          ) {
            logger?.warn?.(
              'TITech SupportChat offline queue flush failed',
              {
                error:
                  queueError?.message,
              },
            );

            offlineQueueRef.current.unshift(
              item,
            );

            break;
          }
        }
      },
      [
        conversationId,
        replaceOptimisticMessage,
        sendWsEvent,
      ],
    );


  /* ==========================================================================
   * Typing indicator
   * ======================================================================== */

  const removeTypingUser =
    useCallback(
      userId => {
        if (
          !userId
        ) {
          return;
        }

        setTypingUsers(
          previous =>
            previous.filter(
              typingUser =>
                typingUser.id !==
                userId,
            ),
        );

        const timer =
          typingExpiryTimersRef
            .current.get(
              userId,
            );

        if (
          timer
        ) {
          clearTimeout(
            timer,
          );
        }

        typingExpiryTimersRef.current.delete(
          userId,
        );
      },
      [],
    );


  const upsertTypingUser =
    useCallback(
      userValue => {
        const typingUser =
          normalizeTypingUser(
            userValue,
          );

        if (
          !typingUser ||
          typingUser.id ===
            currentUserId
        ) {
          return;
        }

        setTypingUsers(
          previous => {
            const existing =
              previous.some(
                userItem =>
                  userItem.id ===
                  typingUser.id,
              );

            if (
              existing
            ) {
              return previous.map(
                userItem =>
                  userItem.id ===
                  typingUser.id
                    ? typingUser
                    : userItem,
              );
            }

            return [
              ...previous,
              typingUser,
            ];
          },
        );

        const existingTimer =
          typingExpiryTimersRef
            .current.get(
              typingUser.id,
            );

        if (
          existingTimer
        ) {
          clearTimeout(
            existingTimer,
          );
        }

        const expiryTimer =
          setTimeout(
            () => {
              removeTypingUser(
                typingUser.id,
              );
            },
            TYPING_EXPIRY_MS,
          );

        typingExpiryTimersRef.current.set(
          typingUser.id,
          expiryTimer,
        );
      },
      [
        currentUserId,
        removeTypingUser,
      ],
    );


  const sendTyping =
    useDebouncedCallback(
      useCallback(
        () => {
          sendWsEvent(
            'typing',
            {
              conversationId,

              user: {
                id:
                  currentUserId,

                name:
                  safeText(
                    user?.name ||
                      user?.displayName ||
                      user?.fullName,
                    'User',
                  ),
              },
            },
          );
        },
        [
          conversationId,
          currentUserId,
          sendWsEvent,
          user,
        ],
      ),
      TYPING_DEBOUNCE_MS,
    );


  /* ==========================================================================
   * WebSocket message handler
   * ======================================================================== */

  const handleWsMessage =
    useCallback(
      event => {
        try {
          const data =
            typeof event.data ===
            'string'
              ? JSON.parse(
                  event.data,
                )
              : event.data;

          if (
            !data ||
            typeof data !==
              'object'
          ) {
            return;
          }

          const payload =
            data.payload ||
            data.data ||
            {};

          switch (
            data.type
          ) {
            case 'connection.ready':
            case 'connected': {
              setConnected(
                true,
              );

              setConnecting(
                false,
              );

              onConnectionChange?.(
                true,
              );

              break;
            }

            case 'message.created':
            case 'message.new': {
              const incomingConversationId =
                normalizeId(
                  payload.conversationId ||
                    conversationId,
                );

              if (
                incomingConversationId !==
                normalizeId(
                  conversationId,
                )
              ) {
                break;
              }

              const correlationId =
                normalizeId(
                  payload.clientCorrelationId ||
                    payload.correlationId,
                );

              if (
                correlationId
              ) {
                setMessages(
                  previous =>
                    previous.map(
                      messageItem =>
                        messageItem
                          .clientCorrelationId ===
                        correlationId
                          ? {
                              ...payload,

                              status:
                                'sent',
                            }
                          : messageItem,
                    ),
                );
              }

              appendMessage(
                payload,
              );

              break;
            }

            case 'message.acknowledged':
            case 'message.sent': {
              const temporaryId =
                normalizeId(
                  payload.temporaryId ||
                    payload.clientMessageId ||
                    payload.tempId,
                );

              const serverMessage =
                payload.message ||
                payload;

              if (
                temporaryId &&
                serverMessage
              ) {
                replaceOptimisticMessage(
                  temporaryId,
                  serverMessage,
                );
              }

              break;
            }

            case 'message.updated': {
              const messageId =
                getMessageId(
                  payload,
                );

              if (
                !messageId
              ) {
                break;
              }

              setMessages(
                previous =>
                  previous.map(
                    messageItem =>
                      getMessageId(
                        messageItem,
                      ) ===
                      messageId
                        ? payload
                        : messageItem,
                  ),
              );

              break;
            }

            case 'message.failed': {
              const temporaryId =
                normalizeId(
                  payload.temporaryId ||
                    payload.clientMessageId ||
                    payload.tempId,
                );

              if (
                temporaryId
              ) {
                markOptimisticFailed(
                  temporaryId,
                );
              }

              setError(
                safeText(
                  payload.message,
                  'Message delivery failed.',
                ),
              );

              break;
            }

            case 'typing':
            case 'user.typing': {
              upsertTypingUser(
                payload.user ||
                  payload,
              );

              break;
            }

            case 'typing.stop':
            case 'user.typing.stop': {
              const typingUser =
                normalizeTypingUser(
                  payload.user ||
                    payload,
                );

              if (
                typingUser?.id
              ) {
                removeTypingUser(
                  typingUser.id,
                );
              }

              break;
            }

            case 'presence':
            case 'presence.updated':
              break;

            case 'read':
            case 'message.read':
              break;

            case 'error': {
              const message =
                safeText(
                  payload.message ||
                    payload.error,
                  'TITech Support Chat encountered a communication error.',
                );

              setError(
                message,
              );

              onError?.(
                new Error(
                  message,
                ),
              );

              break;
            }

            default:
              break;
          }
        } catch (
          parseError
        ) {
          logger?.warn?.(
            'Invalid TITech SupportChat WebSocket message',
            {
              error:
                parseError?.message,
            },
          );
        }
      },
      [
        appendMessage,
        conversationId,
        markOptimisticFailed,
        onConnectionChange,
        onError,
        removeTypingUser,
        replaceOptimisticMessage,
        upsertTypingUser,
      ],
    );


  /* ==========================================================================
   * WebSocket connection
   * ======================================================================== */

  const scheduleReconnect =
    useCallback(
      () => {
        if (
          !mountedRef.current ||
          !online
        ) {
          return;
        }

        if (
          reconnectTimerRef
            .current
        ) {
          return;
        }

        const attempt =
          reconnectAttemptsRef.current;

        const exponentialDelay =
          Math.min(
            WS_RECONNECT_BASE_MS *
              Math.pow(
                1.5,
                Math.max(
                  0,
                  attempt,
                ),
              ),
            WS_RECONNECT_MAX_MS,
          );

        const jitter =
          Math.floor(
            Math.random() *
              WS_RECONNECT_JITTER_MS,
          );

        const delay =
          Math.min(
            WS_RECONNECT_MAX_MS,
            exponentialDelay +
              jitter,
          );

        reconnectAttemptsRef.current =
          attempt + 1;

        reconnectTimerRef.current =
          setTimeout(
            () => {
              reconnectTimerRef.current =
                null;

              if (
                mountedRef.current &&
                online
              ) {
                connectWs();
              }
            },
            delay,
          );
      },
      [
        online,
      ],
    );


  const closeWs =
    useCallback(
      ({
        intentional = true,
      } = {}) => {
        if (
          reconnectTimerRef.current
        ) {
          clearTimeout(
            reconnectTimerRef.current,
          );

          reconnectTimerRef.current =
            null;
        }

        const socket =
          wsRef.current;

        wsRef.current =
          null;

        if (
          socket
        ) {
          try {
            socket.onopen =
              null;

            socket.onmessage =
              null;

            socket.onerror =
              null;

            socket.onclose =
              null;

            if (
              socket.readyState ===
                WebSocket.OPEN ||
              socket.readyState ===
                WebSocket.CONNECTING
            ) {
              socket.close(
                1000,
                intentional
                  ? 'Client closing'
                  : 'Reconnect',
              );
            }
          } catch {
            // Intentionally ignored.
          }
        }

        setConnected(
          false,
        );

        setConnecting(
          false,
        );

        onConnectionChange?.(
          false,
        );
      },
      [
        onConnectionChange,
      ],
    );


  const connectWs =
    useCallback(
      () => {
        if (
          !mountedRef.current ||
          !online ||
          !resolvedWsUrl
        ) {
          return;
        }

        const existing =
          wsRef.current;

        if (
          existing &&
          (
            existing.readyState ===
              WebSocket.OPEN ||
            existing.readyState ===
              WebSocket.CONNECTING
          )
        ) {
          return;
        }

        setConnecting(
          true,
        );

        try {
          const socket =
            new WebSocket(
              resolvedWsUrl,
            );

          wsRef.current =
            socket;

          socket.onopen =
            () => {
              if (
                !mountedRef.current
              ) {
                return;
              }

              reconnectAttemptsRef.current =
                0;

              setConnected(
                true,
              );

              setConnecting(
                false,
              );

              setError(
                null,
              );

              onConnectionChange?.(
                true,
              );

              /**
               * Authentication is sent inside the established connection
               * rather than through query parameters.
               */
              if (
                token
              ) {
                sendWsEvent(
                  'auth',
                  {
                    token,
                  },
                );
              }

              sendWsEvent(
                'subscribe',
                {
                  conversationId,

                  tenantId:
                    resolvedTenantId ||
                    undefined,
                },
              );

              flushOfflineQueue();

              logger?.info?.(
                'TITech SupportChat WebSocket connected',
                {
                  conversationId,
                },
              );
            };

          socket.onmessage =
            handleWsMessage;

          socket.onerror =
            event => {
              logger?.warn?.(
                'TITech SupportChat WebSocket error',
                {
                  conversationId,

                  online,

                  readyState:
                    socket.readyState,
                },
              );

              onError?.(
                event,
              );

              try {
                socket.close();
              } catch {
                // Intentionally ignored.
              }
            };

          socket.onclose =
            event => {
              if (
                wsRef.current ===
                socket
              ) {
                wsRef.current =
                  null;
              }

              if (
                !mountedRef.current
              ) {
                return;
              }

              setConnected(
                false,
              );

              setConnecting(
                false,
              );

              onConnectionChange?.(
                false,
              );

              logger?.warn?.(
                'TITech SupportChat WebSocket closed',
                {
                  conversationId,

                  code:
                    event?.code,

                  reason:
                    event?.reason,
                },
              );

              if (
                online
              ) {
                scheduleReconnect();
              }
            };
        } catch (
          connectionError
        ) {
          setConnected(
            false,
          );

          setConnecting(
            false,
          );

          logger?.error?.(
            'TITech SupportChat WebSocket creation failed',
            {
              error:
                connectionError?.message,

              conversationId,
            },
          );

          scheduleReconnect();
        }
      },
      [
        conversationId,
        flushOfflineQueue,
        handleWsMessage,
        onConnectionChange,
        onError,
        online,
        resolvedTenantId,
        resolvedWsUrl,
        scheduleReconnect,
        sendWsEvent,
        token,
      ],
    );


  /* ==========================================================================
   * Load message history
   * ======================================================================== */

  const loadMessages =
    useCallback(
      async ({
        before,
        appendOlder = false,
      } = {}) => {
        if (
          appendOlder
        ) {
          setLoadingMore(
            true,
          );
        } else {
          setInitialLoading(
            true,
          );
        }

        try {
          const params =
            new URLSearchParams();

          params.set(
            'limit',
            String(
              resolvedHistoryLimit,
            ),
          );

          if (
            before
          ) {
            params.set(
              'before',
              before,
            );
          }

          const response =
            await api.get(
              `/api/support/${encodeURIComponent(
                conversationId,
              )}/messages?${params.toString()}`,
              {
                timeout:
                  20000,
              },
            );

          const data =
            getApiData(
              response,
            );

          const loaded =
            normalizeMessages(
              data,
            );

          if (
            !mountedRef.current
          ) {
            return;
          }

          if (
            appendOlder
          ) {
            setMessages(
              previous =>
                [
                  ...loaded,
                  ...previous,
                ].slice(
                  -resolvedMaxMessages,
                ),
            );
          } else {
            setMessages(
              loaded.slice(
                -resolvedMaxMessages,
              ),
            );
          }

          const hasMore =
            Boolean(
              data?.hasMore ??
                response?.data
                  ?.hasMore ??
                loaded.length >=
                  resolvedHistoryLimit,
            );

          setHasMoreMessages(
            hasMore,
          );

          if (
            loaded.length
          ) {
            const last =
              loaded[
                loaded.length - 1
              ];

            lastMessageIdRef.current =
              getMessageId(
                last,
              );
          }
        } catch (
          loadError
        ) {
          const message =
            extractErrorMessage(
              loadError,
              'Failed to load TITech support messages.',
            );

          if (
            mountedRef.current
          ) {
            setError(
              message,
            );
          }

          logger?.warn?.(
            'TITech SupportChat message history load failed',
            {
              error:
                loadError?.message,
              conversationId,
            },
          );

          onError?.(
            loadError,
          );
        } finally {
          if (
            mountedRef.current
          ) {
            if (
              appendOlder
            ) {
              setLoadingMore(
                false,
              );
            } else {
              setInitialLoading(
                false,
              );
            }
          }
        }
      },
      [
        conversationId,
        onError,
        resolvedHistoryLimit,
        resolvedMaxMessages,
      ],
    );


  /* ==========================================================================
   * Send message
   * ======================================================================== */

  const sendMessage =
    useCallback(
      async ({
        text,
        attachments: attachmentList =
          EMPTY_ARRAY,
      }) => {
        const trimmed =
          safeText(
            text,
          );

        if (
          !trimmed &&
          attachmentList.length ===
            0
        ) {
          return null;
        }

        if (
          trimmed.length >
          resolvedMaxMessageLength
        ) {
          setError(
            `Message exceeds the ${resolvedMaxMessageLength}-character limit.`,
          );

          return null;
        }

        const temporaryId =
          createTemporaryId();

        const correlationId =
          createClientCorrelationId();

        const optimisticMessage =
          {
            id:
              temporaryId,

            clientCorrelationId:
              correlationId,

            conversationId,

            text:
              trimmed,

            attachments:
              attachmentList,

            from: {
              id:
                currentUserId ||
                'me',

              name:
                safeText(
                  user?.name ||
                    user?.displayName ||
                    user?.fullName,
                  'You',
                ),
            },

            status:
              'sending',

            createdAt:
              new Date().toISOString(),
          };

        appendMessage(
          optimisticMessage,
        );

        const payload =
          {
            conversationId,

            tenantId:
              resolvedTenantId ||
              undefined,

            text:
              trimmed,

            attachments:
              attachmentList,

            clientMessageId:
              temporaryId,

            clientCorrelationId:
              correlationId,
          };

        const wsSent =
          sendWsEvent(
            'message.create',
            payload,
          );

        if (
          wsSent
        ) {
          return temporaryId;
        }

        if (
          !online ||
          !connected
        ) {
          queueOfflineMessage(
            payload,
            temporaryId,
          );

          setError(
            'You are offline. Your message has been queued for delivery.',
          );

          return temporaryId;
        }

        try {
          const response =
            await api.post(
              `/api/support/${encodeURIComponent(
                conversationId,
              )}/messages`,
              payload,
              {
                timeout:
                  20000,
              },
            );

          const serverMessage =
            getApiData(
              response,
            );

          if (
            serverMessage
          ) {
            replaceOptimisticMessage(
              temporaryId,
              serverMessage,
            );
          } else {
            setMessages(
              previous =>
                previous.map(
                  messageItem =>
                    getMessageId(
                      messageItem,
                    ) ===
                    temporaryId
                      ? {
                          ...messageItem,

                          status:
                            'sent',
                        }
                      : messageItem,
                ),
            );
          }

          return temporaryId;
        } catch (
          sendError
        ) {
          markOptimisticFailed(
            temporaryId,
          );

          const message =
            extractErrorMessage(
              sendError,
              'Failed to send message.',
            );

          setError(
            message,
          );

          logger?.error?.(
            'TITech SupportChat REST message send failed',
            {
              error:
                sendError?.message,

              conversationId,
            },
          );

          onError?.(
            sendError,
          );

          return null;
        }
      },
      [
        appendMessage,
        connected,
        conversationId,
        currentUserId,
        markOptimisticFailed,
        onError,
        online,
        queueOfflineMessage,
        replaceOptimisticMessage,
        resolvedMaxMessageLength,
        resolvedTenantId,
        sendWsEvent,
        user,
      ],
    );


  /* ==========================================================================
   * Read-state synchronization
   * ======================================================================== */

  const markRead =
    useCallback(
      async () => {
        if (
          !currentUserId ||
          !messages.length
        ) {
          return;
        }

        const latest =
          messages[
            messages.length - 1
          ];

        const latestId =
          getMessageId(
            latest,
          );

        if (
          !latestId ||
          latestId ===
            lastReadMessageIdRef.current
        ) {
          return;
        }

        lastReadMessageIdRef.current =
          latestId;

        try {
          await api.post(
            `/api/support/${encodeURIComponent(
              conversationId,
            )}/read`,
            {
              messageId:
                latestId,
            },
            {
              timeout:
                10000,
            },
          );

          sendWsEvent(
            'read',
            {
              messageId:
                latestId,
            },
          );
        } catch (
          readError
        ) {
          logger?.debug?.(
            'TITech SupportChat mark-read request failed',
            {
              error:
                readError?.message,
            },
          );
        }
      },
      [
        conversationId,
        currentUserId,
        messages,
        sendWsEvent,
      ],
    );


  const scheduleMarkRead =
    useCallback(
      () => {
        if (
          readTimerRef.current
        ) {
          clearTimeout(
            readTimerRef.current,
          );
        }

        readTimerRef.current =
          setTimeout(
            () => {
              markRead();
            },
            READ_DEBOUNCE_MS,
          );
      },
      [
        markRead,
      ],
    );


  /* ==========================================================================
   * Attachment upload
   * ======================================================================== */

  const handleFileChange =
    useCallback(
      async event => {
        const files =
          Array.from(
            event?.target
              ?.files ||
              EMPTY_ARRAY,
          );

        if (
          !files.length
        ) {
          return;
        }

        if (
          attachments.length +
            files.length >
          resolvedMaxAttachments
        ) {
          setError(
            `You can attach a maximum of ${resolvedMaxAttachments} files.`,
          );

          try {
            event.target.value =
              '';
          } catch {
            // Ignore.
          }

          return;
        }

        setUploading(
          true,
        );

        setError(
          null,
        );

        try {
          for (
            const file of files
          ) {
            const validation =
              validateAttachment(
                file,
              );

            if (
              !validation.valid
            ) {
              setError(
                validation.message,
              );

              continue;
            }

            if (
              file.size >
              resolvedAttachmentMaxSize
            ) {
              setError(
                `Attachment "${file.name}" exceeds the configured size limit.`,
              );

              continue;
            }

            const formData =
              new FormData();

            formData.append(
              'file',
              file,
            );

            formData.append(
              'conversationId',
              conversationId,
            );

            if (
              resolvedTenantId
            ) {
              formData.append(
                'tenantId',
                resolvedTenantId,
              );
            }

            const response =
              await api.post(
                `/api/support/${encodeURIComponent(
                  conversationId,
                )}/attachments`,
                formData,
                {
                  timeout:
                    60000,

                  /**
                   * Do not manually specify multipart Content-Type with
                   * Axios/browser FormData. The browser must provide the
                   * boundary.
                   */
                },
              );

            const attachment =
              getApiData(
                response,
              );

            if (
              attachment
            ) {
              setAttachments(
                previous =>
                  [
                    ...previous,
                    attachment,
                  ].slice(
                    0,
                    resolvedMaxAttachments,
                  ),
              );

              toast.success(
                `${file.name} uploaded successfully.`,
              );
            }
          }
        } catch (
          uploadError
        ) {
          const message =
            extractErrorMessage(
              uploadError,
              'Attachment upload failed.',
            );

          setError(
            message,
          );

          logger?.warn?.(
            'TITech SupportChat attachment upload failed',
            {
              error:
                uploadError?.message,

              conversationId,
            },
          );

          onError?.(
            uploadError,
          );
        } finally {
          if (
            mountedRef.current
          ) {
            setUploading(
              false,
            );
          }

          try {
            event.target.value =
              '';
          } catch {
            // Ignore.
          }
        }
      },
      [
        attachments.length,
        conversationId,
        onError,
        resolvedAttachmentMaxSize,
        resolvedMaxAttachments,
        resolvedTenantId,
      ],
    );


  const removeAttachment =
    useCallback(
      attachmentId => {
        setAttachments(
          previous =>
            previous.filter(
              attachment =>
                normalizeId(
                  attachment?.id ??
                    attachment?.attachmentId,
                ) !==
                normalizeId(
                  attachmentId,
                ),
            ),
        );
      },
      [],
    );


  /* ==========================================================================
   * Submit
   * ======================================================================== */

  const handleSubmit =
    useCallback(
      async event => {
        event?.preventDefault?.();

        if (
          !canSend
        ) {
          return;
        }

        setSending(
          true,
        );

        setError(
          null,
        );

        try {
          const result =
            await sendMessage({
              text:
                input.trim(),

              attachments,
            });

          if (
            result
          ) {
            setInput(
              '',
            );

            setAttachments(
              [],
            );

            setTimeout(
              () =>
                scrollToBottom(
                  'smooth',
                ),
              50,
            );

            inputRef.current?.focus();
          }
        } finally {
          if (
            mountedRef.current
          ) {
            setSending(
              false,
            );
          }
        }
      },
      [
        attachments,
        canSend,
        input,
        scrollToBottom,
        sendMessage,
      ],
    );


  /* ==========================================================================
   * Input handling
   * ======================================================================== */

  const handleInputChange =
    useCallback(
      event => {
        const value =
          event.target.value;

        if (
          value.length >
          resolvedMaxMessageLength
        ) {
          return;
        }

        setInput(
          value,
        );

        if (
          value.trim()
        ) {
          sendTyping();
        }
      },
      [
        resolvedMaxMessageLength,
        sendTyping,
      ],
    );


  /* ==========================================================================
   * Keyboard shortcuts
   * ======================================================================== */

  const handleInputKeyDown =
    useCallback(
      event => {
        if (
          event.key ===
            'Enter' &&
          !event.shiftKey &&
          (event.ctrlKey ||
            event.metaKey)
        ) {
          event.preventDefault();

          if (
            !sending
          ) {
            handleSubmit(
              event,
            );
          }
        }
      },
      [
        handleSubmit,
        sending,
      ],
    );


  /* ==========================================================================
   * Manual reconnect
   * ======================================================================== */

  const handleReconnect =
    useCallback(
      () => {
        reconnectAttemptsRef.current =
          0;

        closeWs({
          intentional:
            false,
        });

        setTimeout(
          () => {
            if (
              mountedRef.current &&
              online
            ) {
              connectWs();
            }
          },
          50,
        );
      },
      [
        closeWs,
        connectWs,
        online,
      ],
    );


  /* ==========================================================================
   * Scroll event
   * ======================================================================== */

  const handleScroll =
    useCallback(
      () => {
        shouldAutoScrollRef.current =
          isNearBottom();

        const element =
          listRef.current;

        if (
          !element ||
          loadingMore ||
          !hasMoreMessages
        ) {
          return;
        }

        if (
          element.scrollTop <=
          40
        ) {
          const firstMessage =
            messages[0];

          const before =
            firstMessage
              ? getMessageId(
                  firstMessage,
                )
              : null;

          if (
            before
          ) {
            loadMessages({
              before,

              appendOlder:
                true,
            });
          }
        }
      },
      [
        hasMoreMessages,
        isNearBottom,
        loadMessages,
        loadingMore,
        messages,
      ],
    );


  /* ==========================================================================
   * Online/offline lifecycle
   * ======================================================================== */

  useEffect(
    () => {
      const handleOnline =
        () => {
          setOnline(
            true,
          );

          setError(
            null,
          );

          handleReconnect();
        };

      const handleOffline =
        () => {
          setOnline(
            false,
          );

          setConnected(
            false,
          );

          setError(
            'You are offline. Messages will be queued until connectivity returns.',
          );
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
    },
    [
      handleReconnect,
    ],
  );


  /* ==========================================================================
   * Initialization / conversation changes
   * ======================================================================== */

  useEffect(
    () => {
      mountedRef.current =
        true;

      currentConversationRef.current =
        conversationId;

      reconnectAttemptsRef.current =
        0;

      offlineQueueRef.current =
        [];

      setMessages(
        [],
      );

      setInput(
        '',
      );

      setAttachments(
        [],
      );

      setTypingUsers(
        [],
      );

      setError(
        null,
      );

      setInitialLoading(
        true,
      );

      lastReadMessageIdRef.current =
        null;

      const initialize =
        async () => {
          await loadMessages();

          if (
            mountedRef.current &&
            online
          ) {
            connectWs();
          }
        };

      initialize();

      return () => {
        mountedRef.current =
          false;

        closeWs();

        typingExpiryTimersRef.current.forEach(
          timer => {
            clearTimeout(
              timer,
            );
          },
        );

        typingExpiryTimersRef.current.clear();

        if (
          readTimerRef.current
        ) {
          clearTimeout(
            readTimerRef.current,
          );

          readTimerRef.current =
            null;
        }
      };
    },
    [
      closeWs,
      connectWs,
      conversationId,
      loadMessages,
      online,
    ],
  );


  /* ==========================================================================
   * Message auto-scroll + read state
   * ======================================================================== */

  useEffect(
    () => {
      if (
        !messages.length
      ) {
        return;
      }

      lastMessageIdRef.current =
        getMessageId(
          messages[
            messages.length - 1
          ],
        );

      if (
        shouldAutoScrollRef.current
      ) {
        requestAnimationFrame(
          () => {
            scrollToBottom(
              'auto',
            );
          },
        );
      }

      scheduleMarkRead();
    },
    [
      messages,
      scheduleMarkRead,
      scrollToBottom,
    ],
  );


  /* ==========================================================================
   * Focus input when connected / conversation changes
   * ======================================================================== */

  useEffect(
    () => {
      if (
        connected &&
        !sending &&
        !uploading
      ) {
        inputRef.current?.focus();
      }
    },
    [
      connected,
      sending,
      uploading,
      conversationId,
    ],
  );


  /* ==========================================================================
   * Cleanup queued timers on unmount
   * ======================================================================== */

  useEffect(
    () => () => {
      if (
        reconnectTimerRef.current
      ) {
        clearTimeout(
          reconnectTimerRef.current,
        );
      }

      if (
        readTimerRef.current
      ) {
        clearTimeout(
          readTimerRef.current,
        );
      }

      typingExpiryTimersRef.current.forEach(
        timer => {
          clearTimeout(
            timer,
          );
        },
      );
    },
    [],
  );


  /* ==========================================================================
   * Render helpers
   * ======================================================================== */

  const renderConnectionIcon =
    () => {
      if (
        connected
      ) {
        return (
          <Wifi
            size={15}
            aria-hidden="true"
          />
        );
      }

      if (
        online
      ) {
        return (
          <RefreshCw
            size={15}
            aria-hidden="true"
            className="support-chat__spin"
          />
        );
      }

      return (
        <WifiOff
          size={15}
          aria-hidden="true"
        />
      );
    };


  const renderMessageStatus =
    message => {
      if (
        !isOwnMessage(
          message,
          currentUserId,
        )
      ) {
        return null;
      }

      const status =
        safeText(
          message?.status,
          'sent',
        ).toLowerCase();

      if (
        status ===
        'sending'
      ) {
        return (
          <span
            className="support-chat__message-status"
            aria-label="Sending"
            title="Sending"
          >
            <Circle
              size={11}
              aria-hidden="true"
            />
          </span>
        );
      }

      if (
        status ===
        'failed'
      ) {
        return (
          <span
            className="support-chat__message-status support-chat__message-status--error"
            aria-label="Delivery failed"
            title="Delivery failed"
          >
            <AlertCircle
              size={12}
              aria-hidden="true"
            />
          </span>
        );
      }

      if (
        status ===
        'delivered'
      ) {
        return (
          <span
            className="support-chat__message-status"
            aria-label="Delivered"
            title="Delivered"
          >
            <Check
              size={12}
              aria-hidden="true"
            />
          </span>
        );
      }

      if (
        status ===
        'read'
      ) {
        return (
          <span
            className="support-chat__message-status support-chat__message-status--read"
            aria-label="Read"
            title="Read"
          >
            <CheckCheck
              size={13}
              aria-hidden="true"
            />
          </span>
        );
      }

      return (
        <span
          className="support-chat__message-status"
          aria-label="Sent"
          title="Sent"
        >
          <Check
            size={12}
            aria-hidden="true"
          />
        </span>
      );
    };


  /* ==========================================================================
   * Empty state
   * ======================================================================== */

  const renderEmptyState =
    () => (
      <div
        className="support-chat__empty"
        role="status"
      >
        <div className="support-chat__empty-icon">
          <Circle
            size={28}
            aria-hidden="true"
          />
        </div>

        <h3>
          Start a conversation
        </h3>

        <p>
          Send a message to the TITech support team and we will assist you.
        </p>
      </div>
    );


  /* ==========================================================================
   * Render
   * ======================================================================== */

  return (
    <section
      className={cn(
        'support-chat',
        'card',
        className,
      )}
      aria-labelledby="support-chat-heading"
      data-testid="titech-support-chat"
      data-conversation-id={
        conversationId
      }
      data-connected={
        connected
          ? 'true'
          : 'false'
      }
    >

      {/* ====================================================================
          Header
          ==================================================================== */}

      <header className="support-chat-header">

        <div className="support-chat-header__main">

          <div className="support-chat-header__title-row">

            <h2
              id="support-chat-heading"
              className="support-chat-header__title"
            >
              {
                title
              }
            </h2>

            <span
              className={cn(
                'support-chat-header__status',
                connected &&
                  'support-chat-header__status--connected',
                !online &&
                  'support-chat-header__status--offline',
              )}
            >
              <span
                className="support-chat-header__status-icon"
                aria-hidden="true"
              >
                {
                  renderConnectionIcon()
                }
              </span>

              <span>
                {
                  connectionLabel
                }
              </span>
            </span>

          </div>

          <div className="support-chat-header__meta">

            <span>
              {typingUsers.length >
              0
                ? `${typingUsers
                    .map(
                      typingUser =>
                        typingUser.name,
                    )
                    .join(
                      ', ',
                    )} ${
                    typingUsers.length ===
                    1
                      ? 'is'
                      : 'are'
                  } typing…`
                : connected
                  ? 'TITech support is available'
                  : online
                    ? 'Reconnecting to TITech support…'
                    : 'Messages will be queued while offline'}
            </span>

          </div>

        </div>


        <div className="support-chat-header__actions">

          {!connected ? (
            <button
              type="button"
              className="support-chat__button support-chat__button--ghost"
              onClick={
                handleReconnect
              }
              disabled={
                connecting ||
                !online
              }
              aria-label="Reconnect to TITech support"
              title="Reconnect"
            >
              <RefreshCw
                size={16}
                className={
                  connecting
                    ? 'support-chat__spin'
                    : undefined
                }
                aria-hidden="true"
              />

              <span>
                {
                  connecting
                    ? 'Connecting…'
                    : 'Reconnect'
                }
              </span>
            </button>
          ) : null}

        </div>

      </header>


      {/* ====================================================================
          Error banner
          ==================================================================== */}

      {error ? (
        <div
          className="support-chat__error"
          role="alert"
        >
          <div className="support-chat__error-content">

            <AlertCircle
              size={17}
              aria-hidden="true"
            />

            <span>
              {
                error
              }
            </span>

          </div>

          <button
            type="button"
            className="support-chat__error-close"
            onClick={() =>
              setError(
                null,
              )
            }
            aria-label="Dismiss error"
            title="Dismiss"
          >
            <X
              size={15}
              aria-hidden="true"
            />
          </button>
        </div>
      ) : null}


      {/* ====================================================================
          Message list
          ==================================================================== */}

      <div
        ref={
          listRef
        }
        className="support-chat-list"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="TITech support conversation"
        onScroll={
          handleScroll
        }
      >

        {loadingMore ? (
          <div
            className="support-chat__load-more"
            role="status"
          >
            <Spinner
              size="sm"
              label="Loading earlier messages…"
            />
          </div>
        ) : null}


        {initialLoading ? (
          <div
            className="support-chat__loading"
            role="status"
            aria-live="polite"
          >
            <Spinner
              size="md"
              label="Loading support messages…"
            />
          </div>
        ) : messages.length ===
          0 ? (
          renderEmptyState()
        ) : (
          <div className="support-chat__messages">

            {messages.map(
              message => {
                const messageId =
                  getMessageId(
                    message,
                  );

                return (
                  <article
                    key={
                      messageId
                    }
                    className="support-chat__message-row"
                    data-message-id={
                      messageId
                    }
                    data-message-status={
                      message.status ||
                      'sent'
                    }
                  >

                    <MessageBubble
                      message={
                        message
                      }
                      currentUserId={
                        currentUserId
                      }
                    />

                    {renderMessageStatus(
                      message,
                    )}

                  </article>
                );
              },
            )}

          </div>
        )}

      </div>


      {/* ====================================================================
          Typing indicator
          ==================================================================== */}

      {typingUsers.length >
      0 ? (
        <div
          className="support-chat__typing"
          aria-live="polite"
          role="status"
        >
          <span className="support-chat__typing-dots">
            <i />
            <i />
            <i />
          </span>

          <span>
            {typingUsers
              .map(
                typingUser =>
                  typingUser.name,
              )
              .join(
                ', ',
              )}{' '}
            {typingUsers.length ===
            1
              ? 'is'
              : 'are'}{' '}
            typing
          </span>
        </div>
      ) : null}


      {/* ====================================================================
          Composer
          ==================================================================== */}

      <div className="support-chat-controls">

        <form
          className="support-chat__form"
          onSubmit={
            handleSubmit
          }
          noValidate
        >

          <div className="support-chat__composer">

            <label
              htmlFor="titech-support-input"
              className="support-chat__sr-only"
            >
              Message TITech support
            </label>

            <textarea
              id="titech-support-input"
              ref={
                inputRef
              }
              value={
                input
              }
              onChange={
                handleInputChange
              }
              onKeyDown={
                handleInputKeyDown
              }
              placeholder="Type your message…"
              rows={3}
              maxLength={
                resolvedMaxMessageLength
              }
              className="support-chat__textarea"
              disabled={
                sending ||
                uploading
              }
              aria-describedby="titech-support-composer-help"
              aria-label="Message"
              data-testid="titech-support-input"
            />


            <div
              className="support-chat__composer-meta"
              id="titech-support-composer-help"
            >

              <span>
                Ctrl+Enter / Cmd+Enter to send
              </span>

              <span
                className={cn(
                  input.length >=
                    resolvedMaxMessageLength &&
                    'support-chat__character-count--limit',
                )}
              >
                {
                  input.length
                }
                /
                {
                  resolvedMaxMessageLength
                }
              </span>

            </div>


            {/* ================================================================
                Attachments
                ================================================================ */}

            <div className="support-chat__attachment-bar">

              <input
                ref={
                  attachmentInputRef
                }
                id="titech-support-file-upload"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={
                  handleFileChange
                }
                disabled={
                  uploading ||
                  sending ||
                  attachments.length >=
                    resolvedMaxAttachments
                }
                className="support-chat__file-input"
                tabIndex={-1}
              />

              <button
                type="button"
                className="support-chat__attachment-button"
                onClick={() =>
                  attachmentInputRef.current?.click()
                }
                disabled={
                  uploading ||
                  sending ||
                  attachments.length >=
                    resolvedMaxAttachments
                }
                aria-label="Attach files"
                title="Attach files"
              >
                {uploading ? (
                  <RefreshCw
                    size={17}
                    className="support-chat__spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Paperclip
                    size={17}
                    aria-hidden="true"
                  />
                )}

                <span>
                  Attach
                </span>
              </button>


              <span className="support-chat__attachment-count">
                {
                  attachments.length
                }
                /
                {
                  resolvedMaxAttachments
                }{' '}
                attachments
              </span>

            </div>


            {/* ================================================================
                Attachment previews
                ================================================================ */}

            {attachments.length >
            0 ? (
              <div
                className="support-chat__attachments"
                aria-label="Selected attachments"
              >
                {attachments.map(
                  attachment => (
                    <div
                      key={
                        normalizeId(
                          attachment?.id ??
                            attachment?.attachmentId ??
                            attachment?.url,
                        )
                      }
                      className="support-chat__attachment"
                    >
                      <AttachmentPreview
                        attachment={
                          attachment
                        }
                        onRemove={() =>
                          removeAttachment(
                            attachment?.id ??
                              attachment?.attachmentId,
                          )
                        }
                      />
                    </div>
                  ),
                )}
              </div>
            ) : null}

          </div>


          {/* ==================================================================
              Send button
              ================================================================== */}

          <button
            type="submit"
            className="support-chat__send-button"
            disabled={
              !canSend
            }
            aria-disabled={
              !canSend
            }
            aria-label={
              sending
                ? 'Sending message'
                : 'Send message'
            }
            data-testid="titech-support-send"
          >
            {sending ? (
              <RefreshCw
                size={18}
                className="support-chat__spin"
                aria-hidden="true"
              />
            ) : (
              <Send
                size={18}
                aria-hidden="true"
              />
            )}

            <span>
              {
                sending
                  ? 'Sending…'
                  : 'Send'
              }
            </span>
          </button>

        </form>

      </div>


      {/* ====================================================================
          Offline banner
          ==================================================================== */}

      {!online ? (
        <div
          className="support-chat__offline-banner"
          role="status"
          aria-live="polite"
        >
          <WifiOff
            size={15}
            aria-hidden="true"
          />

          <span>
            You are offline. Messages will be queued and sent when connectivity
            returns.
          </span>
        </div>
      ) : null}

    </section>
  );
}


/* ============================================================================
 * PropTypes
 * ========================================================================== */

SupportChat.propTypes = {
  conversationId:
    PropTypes.string,

  title:
    PropTypes.string,

  websocketUrl:
    PropTypes.string,

  maxMessages:
    PropTypes.number,

  historyLimit:
    PropTypes.number,

  maxMessageLength:
    PropTypes.number,

  maxAttachments:
    PropTypes.number,

  attachmentMaxSize:
    PropTypes.number,

  onMessage:
    PropTypes.func,

  onConnectionChange:
    PropTypes.func,

  onError:
    PropTypes.func,

  tenantId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  className:
    PropTypes.string,
};