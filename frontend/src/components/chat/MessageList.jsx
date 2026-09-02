'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Message List
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/MessageList.jsx
 *
 * Purpose:
 *   Production-grade message collection, viewport, pagination and interaction
 *   manager for the TITechChat enterprise messaging platform.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Message rendering
 * ✓ MessageBubble integration
 * ✓ Initial loading state
 * ✓ Message skeleton state
 * ✓ Empty state
 * ✓ Error state
 * ✓ Retry support
 * ✓ Older-message pagination
 * ✓ Infinite scroll
 * ✓ Scroll position preservation
 * ✓ Auto-scroll to latest
 * ✓ Scroll-to-bottom control
 * ✓ Unread/new-message marker
 * ✓ Date separators
 * ✓ Consecutive-message grouping
 * ✓ Sender grouping
 * ✓ Own/incoming message resolution
 * ✓ Message action delegation
 * ✓ Sending state
 * ✓ Conversation-aware lifecycle
 * ✓ Tenant context passthrough
 * ✓ Keyboard accessibility
 * ✓ Screen-reader live status
 * ✓ Ref API
 * ✓ Defensive API-data normalization
 * ✓ Stable test selectors
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - authorize message access
 *   - enforce tenant isolation
 *   - approve financial operations
 *   - execute financial transactions
 *   - determine loan eligibility
 *   - make fraud decisions
 *   - modify authoritative financial records
 *
 * Those responsibilities belong to TITech's trusted API/service layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import MessageBubble from './MessageBubble.jsx';

import EmptyState from './EmptyState.jsx';

import ErrorState from './ErrorState.js';

import LoadingState from './LoadingState.js';

import './message-list.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_PAGE_SIZE = 50;

const DEFAULT_BOTTOM_THRESHOLD = 80;

const DEFAULT_TOP_THRESHOLD = 160;

const DEFAULT_GROUPING_WINDOW_MS =
  5 * 60 * 1000;


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
    return String(value);
  } catch {
    return fallback;
  }
};


const getMessageId = (
  message,
  index = 0,
) => {
  const id =
    message?.id ??
    message?.messageId ??
    message?.uuid;

  if (
    id !== null &&
    id !== undefined &&
    String(id).trim()
  ) {
    return String(id);
  }

  return `message-${index}`;
};


const getMessageTimestamp = (
  message,
) =>
  message?.createdAt ||
  message?.timestamp ||
  message?.sentAt ||
  message?.updatedAt ||
  null;


const getMessageSenderId = (
  message,
) =>
  safeText(
    message?.senderId ??
      message?.userId ??
      message?.authorId ??
      message?.sender?.id,
  );


const getMessageRole = (
  message,
) =>
  safeText(
    message?.role ||
      message?.senderRole ||
      message?.sender?.role ||
      'user',
    'user',
  ).toLowerCase();


const getMessageText = (
  message,
) => {
  const value =
    message?.content ??
    message?.text ??
    message?.body ??
    '';

  if (
    typeof value ===
    'string'
  ) {
    return value;
  }

  if (
    typeof value ===
    'number'
  ) {
    return String(value);
  }

  return safeText(
    value,
  );
};


const getMessageDateKey = (
  timestamp,
) => {
  if (!timestamp) {
    return '';
  }

  const date =
    new Date(
      timestamp,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '';
  }

  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  ].join('-');
};


const formatDateSeparator = (
  timestamp,
) => {
  if (!timestamp) {
    return '';
  }

  const date =
    new Date(
      timestamp,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle:
          'medium',
      },
    ).format(
      date,
    );
  } catch {
    return date.toDateString();
  }
};


const getNumericTimestamp = (
  timestamp,
) => {
  if (!timestamp) {
    return 0;
  }

  const value =
    new Date(
      timestamp,
    ).getTime();

  return Number.isFinite(
    value,
  )
    ? value
    : 0;
};


const isNearBottom = (
  element,
  threshold =
    DEFAULT_BOTTOM_THRESHOLD,
) => {
  if (!element) {
    return true;
  }

  const distance =
    element.scrollHeight -
    element.scrollTop -
    element.clientHeight;

  return (
    distance <=
    threshold
  );
};


const isNearTop = (
  element,
  threshold =
    DEFAULT_TOP_THRESHOLD,
) => {
  if (!element) {
    return false;
  }

  return (
    element.scrollTop <=
    threshold
  );
};


/**
 * Normalize the incoming message collection without mutating caller data.
 */
const normalizeMessages = (
  messages,
) => {
  if (
    !Array.isArray(
      messages,
    )
  ) {
    return [];
  }

  return messages
    .filter(
      (
        message,
      ) =>
        message &&
        typeof message ===
          'object' &&
        !Array.isArray(
          message,
        ),
    )
    .map(
      (
        message,
        index,
      ) => ({
        ...message,

        __titechId:
          getMessageId(
            message,
            index,
          ),

        __titechTimestamp:
          getMessageTimestamp(
            message,
          ),

        __titechSenderId:
          getMessageSenderId(
            message,
          ),
      }),
    );
};


/**
 * Determine whether two messages belong to the same visual group.
 */
const canGroupMessages = (
  previous,
  current,
  groupingWindowMs =
    DEFAULT_GROUPING_WINDOW_MS,
) => {
  if (
    !previous ||
    !current
  ) {
    return false;
  }

  const previousSenderId =
    getMessageSenderId(
      previous,
    );

  const currentSenderId =
    getMessageSenderId(
      current,
    );

  if (
    previousSenderId !==
    currentSenderId
  ) {
    return false;
  }

  const previousRole =
    getMessageRole(
      previous,
    );

  const currentRole =
    getMessageRole(
      current,
    );

  if (
    previousRole !==
    currentRole
  ) {
    return false;
  }

  const previousTimestamp =
    getNumericTimestamp(
      getMessageTimestamp(
        previous,
      ),
    );

  const currentTimestamp =
    getNumericTimestamp(
      getMessageTimestamp(
        current,
      ),
    );

  if (
    !previousTimestamp ||
    !currentTimestamp
  ) {
    return true;
  }

  return (
    currentTimestamp -
      previousTimestamp <=
    groupingWindowMs
  );
};


/* ============================================================================
 * Structural subcomponents
 * ========================================================================== */

const DateSeparator = ({
  value,
}) => {
  const label =
    formatDateSeparator(
      value,
    );

  if (!label) {
    return null;
  }

  return (
    <div
      className="titech-message-list__date-separator"
      role="separator"
      aria-label={
        label
      }
    >
      <span>
        {
          label
        }
      </span>
    </div>
  );
};


const NewMessageMarker = ({
  count = 0,
  label,
}) => {
  const resolvedLabel =
    label ||
    (
      count > 0
        ? `${count} new ${
            count === 1
              ? 'message'
              : 'messages'
          }`
        : 'New messages'
    );

  return (
    <div
      className="titech-message-list__new-message-marker"
      role="separator"
      aria-label={
        resolvedLabel
      }
      data-testid="titech-message-list-new-marker"
    >
      <span>
        {
          resolvedLabel
        }
      </span>
    </div>
  );
};


const ScrollBottomButton = ({
  onClick,
  unreadCount = 0,
}) => (
  <button
    type="button"
    className="titech-message-list__scroll-bottom"
    onClick={
      onClick
    }
    aria-label={
      unreadCount > 0
        ? `Scroll to latest messages. ${unreadCount} unread`
        : 'Scroll to latest messages'
    }
    title="Scroll to latest messages"
    data-testid="titech-message-list-scroll-bottom"
  >
    <span
      aria-hidden="true"
      className="titech-message-list__scroll-bottom-icon"
    >
      ↓
    </span>

    {unreadCount > 0 ? (
      <span className="titech-message-list__scroll-bottom-count">
        {unreadCount >
        99
          ? '99+'
          : unreadCount}
      </span>
    ) : null}
  </button>
);


/* ============================================================================
 * MessageList
 * ========================================================================== */

const MessageList =
  forwardRef(
    function MessageList(
      {
        messages =
          [],

        currentUserId,

        conversationId,

        tenant =
          null,

        loading =
          false,

        initialLoading,

        loadingMore =
          false,

        sending =
          false,

        error =
          null,

        disabled =
          false,

        hasMore =
          false,

        hasOlderMessages,

        pageSize =
          DEFAULT_PAGE_SIZE,

        onLoadMore,

        onRetry,

        onReply,

        onCopy,

        onEdit,

        onDelete,

        onRetryMessage,

        onRegenerate,

        customMessageActions =
          [],

        isUserOwnMessage,

        showAvatars =
          true,

        showSender =
          true,

        showTimestamps =
          true,

        showStatus =
          true,

        showActions =
          true,

        showAttachments =
          true,

        showEditedLabel =
          true,

        showDateSeparators =
          true,

        groupMessages =
          true,

        groupingWindowMs =
          DEFAULT_GROUPING_WINDOW_MS,

        autoScroll =
          true,

        autoScrollThreshold =
          DEFAULT_BOTTOM_THRESHOLD,

        infiniteScroll =
          true,

        topScrollThreshold =
          DEFAULT_TOP_THRESHOLD,

        showScrollButton =
          true,

        unreadCount =
          0,

        newMessageCount =
          0,

        unreadMarkerIndex,

        onAtBottomChange,

        onScroll,

        onReachTop,

        onReachBottom,

        emptyVariant =
          'messages',

        emptyTitle =
          'No messages yet',

        emptyMessage =
          'Messages will appear here when the conversation begins.',

        onStartConversation,

        className =
          '',

        messageClassName =
          '',

        ariaLabel =
          'TITech conversation messages',

        testId =
          'titech-message-list',

        reverse =
          false,

        scrollRestoreMode =
          'preserve',

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const viewportId =
        `titech-message-list-${generatedId}`;

      const viewportRef =
        useRef(null);

      const bottomAnchorRef =
        useRef(null);

      const messageNodeMapRef =
        useRef(
          new Map(),
        );

      const previousMessageCountRef =
        useRef(
          0,
        );

      const previousConversationIdRef =
        useRef(
          conversationId,
        );

      const scrollSnapshotRef =
        useRef(null);

      const loadingMoreRef =
        useRef(false);

      const mountedRef =
        useRef(true);

      const initialScrollDoneRef =
        useRef(false);

      const userHasScrolledRef =
        useRef(false);

      const wasAtBottomRef =
        useRef(true);

      const [
        showScrollButtonState,
        setShowScrollButtonState,
      ] =
        useState(
          false,
        );


      /* ======================================================================
       * Lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          mountedRef.current =
            true;

          return () => {
            mountedRef.current =
              false;
          };
        },
        [],
      );


      /* ======================================================================
       * Derived loading state
       * ==================================================================== */

      const resolvedInitialLoading =
        initialLoading !==
        undefined
          ? initialLoading
          : Boolean(
              loading &&
                (
                  !Array.isArray(
                    messages,
                  ) ||
                  messages.length ===
                    0
                ),
            );


      /* ======================================================================
       * Normalize messages
       * ==================================================================== */

      const normalizedMessages =
        useMemo(
          () =>
            normalizeMessages(
              messages,
            ),
          [
            messages,
          ],
        );


      /**
       * Message order.
       *
       * `reverse=false` assumes the API supplies chronological order:
       * oldest -> newest.
       *
       * `reverse=true` reverses the visual collection.
       */
      const renderMessages =
        useMemo(
          () =>
            reverse
              ? [
                  ...normalizedMessages,
                ].reverse()
              : normalizedMessages,
          [
            normalizedMessages,
            reverse,
          ],
        );


      /* ======================================================================
       * Own message resolver
       * ==================================================================== */

      const resolveOwnMessage =
        useCallback(
          (
            message,
          ) => {
            if (
              typeof isUserOwnMessage ===
              'function'
            ) {
              return Boolean(
                isUserOwnMessage(
                  message,
                ),
              );
            }

            if (
              message?.isOwn !==
              undefined
            ) {
              return Boolean(
                message.isOwn,
              );
            }

            if (
              message?.own !==
              undefined
            ) {
              return Boolean(
                message.own,
              );
            }

            if (
              currentUserId ===
                undefined ||
              currentUserId ===
                null
            ) {
              return false;
            }

            const senderId =
              getMessageSenderId(
                message,
              );

            return (
              senderId &&
              String(
                senderId,
              ) ===
                String(
                  currentUserId,
                )
            );
          },
          [
            currentUserId,
            isUserOwnMessage,
          ],
        );


      /* ======================================================================
       * Scroll helpers
       * ==================================================================== */

      const updateScrollState =
        useCallback(
          (
            {
              notify = true,
            } = {},
          ) => {
            const element =
              viewportRef.current;

            if (!element) {
              return;
            }

            const atBottom =
              isNearBottom(
                element,
                autoScrollThreshold,
              );

            const atTop =
              isNearTop(
                element,
                topScrollThreshold,
              );

            const wasAtBottom =
              wasAtBottomRef.current;

            wasAtBottomRef.current =
              atBottom;

            setShowScrollButtonState(
              !atBottom,
            );

            if (
              notify &&
              atBottom !==
                wasAtBottom
            ) {
              onAtBottomChange?.(
                atBottom,
              );
            }

            if (
              atTop
            ) {
              onReachTop?.();
            }

            const distanceFromBottom =
              element.scrollHeight -
              element.scrollTop -
              element.clientHeight;

            if (
              distanceFromBottom <=
              autoScrollThreshold
            ) {
              onReachBottom?.();
            }
          },
          [
            autoScrollThreshold,
            onAtBottomChange,
            onReachBottom,
            onReachTop,
            topScrollThreshold,
          ],
        );


      const scrollToBottom =
        useCallback(
          (
            behavior =
              'smooth',
          ) => {
            const element =
              viewportRef.current;

            if (!element) {
              return;
            }

            const target =
              Math.max(
                0,
                element.scrollHeight -
                  element.clientHeight,
              );

            try {
              element.scrollTo({
                top:
                  target,
                behavior,
              });
            } catch {
              element.scrollTop =
                target;
            }

            wasAtBottomRef.current =
              true;

            setShowScrollButtonState(
              false,
            );

            onAtBottomChange?.(
              true,
            );
          },
          [
            onAtBottomChange,
          ],
        );


      const scrollToMessage =
        useCallback(
          (
            messageId,
            behavior =
              'smooth',
          ) => {
            const node =
              messageNodeMapRef.current.get(
                String(
                  messageId,
                ),
              );

            if (!node) {
              return false;
            }

            try {
              node.scrollIntoView({
                behavior,
                block:
                  'center',
              });
            } catch {
              node.scrollIntoView();
            }

            return true;
          },
          [],
        );


      /* ======================================================================
       * Public API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            viewportRef.current?.focus();
          },

          scrollToBottom,

          scrollToLatest:
            scrollToBottom,

          scrollToMessage,

          getScrollElement() {
            return viewportRef.current;
          },

          getMessages() {
            return normalizedMessages;
          },

          getMessageCount() {
            return normalizedMessages.length;
          },

          isAtBottom() {
            return wasAtBottomRef.current;
          },

          isAtTop() {
            return isNearTop(
              viewportRef.current,
              topScrollThreshold,
            );
          },
        }),
        [
          normalizedMessages,
          scrollToBottom,
          scrollToMessage,
          topScrollThreshold,
        ],
      );


      /* ======================================================================
       * Register message node
       * ==================================================================== */

      const registerMessageNode =
        useCallback(
          (
            id,
          ) =>
            (
              node,
            ) => {
              const key =
                String(
                  id,
                );

              if (
                node
              ) {
                messageNodeMapRef.current.set(
                  key,
                  node,
                );
              } else {
                messageNodeMapRef.current.delete(
                  key,
                );
              }
            },
          [],
        );


      /* ======================================================================
       * Scroll event
       * ==================================================================== */

      const handleScroll =
        useCallback(
          (
            event,
          ) => {
            const element =
              event.currentTarget;

            userHasScrolledRef.current =
              true;

            updateScrollState();

            onScroll?.(
              event,
            );

            const atTop =
              isNearTop(
                element,
                topScrollThreshold,
              );

            if (
              infiniteScroll &&
              atTop &&
              (
                hasMore ||
                hasOlderMessages
              ) &&
              typeof onLoadMore ===
                'function' &&
              !loadingMoreRef.current
            ) {
              loadingMoreRef.current =
                true;

              const result =
                onLoadMore(
                  {
                    conversationId,

                    direction:
                      'older',

                    limit:
                      pageSize,
                  },
                );

              if (
                result &&
                typeof result.finally ===
                  'function'
              ) {
                result.finally(
                  () => {
                    if (
                      mountedRef.current
                    ) {
                      loadingMoreRef.current =
                        false;
                    }
                  },
                );
              } else {
                loadingMoreRef.current =
                  false;
              }
            }
          },
          [
            conversationId,
            hasMore,
            hasOlderMessages,
            infiniteScroll,
            onLoadMore,
            onScroll,
            pageSize,
            topScrollThreshold,
            updateScrollState,
          ],
        );


      /* ======================================================================
       * Reset loading-more guard
       * ==================================================================== */

      useEffect(
        () => {
          if (
            !loadingMore
          ) {
            loadingMoreRef.current =
              false;
          }
        },
        [
          loadingMore,
        ],
      );


      /* ======================================================================
       * Conversation lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          const changed =
            String(
              previousConversationIdRef.current ??
                '',
            ) !==
            String(
              conversationId ??
                '',
            );

          if (
            changed
          ) {
            previousConversationIdRef.current =
              conversationId;

            initialScrollDoneRef.current =
              false;

            userHasScrolledRef.current =
              false;

            wasAtBottomRef.current =
              true;

            previousMessageCountRef.current =
              0;

            scrollSnapshotRef.current =
              null;

            setShowScrollButtonState(
              false,
            );
          }
        },
        [
          conversationId,
        ],
      );


      /* ======================================================================
       * Initial scroll
       * ==================================================================== */

      useEffect(
        () => {
          if (
            resolvedInitialLoading ||
            initialScrollDoneRef.current
          ) {
            return;
          }

          if (
            normalizedMessages.length ===
            0
          ) {
            initialScrollDoneRef.current =
              true;

            return;
          }

          initialScrollDoneRef.current =
            true;

          if (
            autoScroll
          ) {
            requestAnimationFrame(
              () => {
                scrollToBottom(
                  'auto',
                );
              },
            );
          }
        },
        [
          autoScroll,
          normalizedMessages.length,
          resolvedInitialLoading,
          scrollToBottom,
        ],
      );


      /* ======================================================================
       * Track new messages
       * ==================================================================== */

      useEffect(
        () => {
          const previousCount =
            previousMessageCountRef.current;

          const currentCount =
            normalizedMessages.length;

          const increased =
            currentCount >
            previousCount;

          previousMessageCountRef.current =
            currentCount;

          if (
            !increased
          ) {
            return;
          }

          /**
           * New messages should automatically bring the viewport to the latest
           * message only when the user was already at the bottom.
           */
          if (
            autoScroll &&
            (
              wasAtBottomRef.current ||
              previousCount ===
                0
            )
          ) {
            requestAnimationFrame(
              () => {
                scrollToBottom();
              },
            );
          } else {
            setShowScrollButtonState(
              true,
            );
          }
        },
        [
          autoScroll,
          normalizedMessages.length,
          scrollToBottom,
        ],
      );


      /* ======================================================================
       * Preserve viewport position while older messages load
       * ==================================================================== */

      useEffect(
        () => {
          const element =
            viewportRef.current;

          if (!element) {
            return;
          }

          if (
            scrollRestoreMode !==
            'preserve'
          ) {
            return;
          }

          if (
            !loadingMore
          ) {
            scrollSnapshotRef.current =
              null;

            return;
          }

          if (
            !scrollSnapshotRef.current
          ) {
            scrollSnapshotRef.current = {
              scrollHeight:
                element.scrollHeight,

              scrollTop:
                element.scrollTop,
            };
          }
        },
        [
          loadingMore,
          scrollRestoreMode,
        ],
      );


      useEffect(
        () => {
          const snapshot =
            scrollSnapshotRef.current;

          const element =
            viewportRef.current;

          if (
            !snapshot ||
            !element ||
            loadingMore
          ) {
            return;
          }

          if (
            element.scrollHeight >
            snapshot.scrollHeight
          ) {
            const addedHeight =
              element.scrollHeight -
              snapshot.scrollHeight;

            element.scrollTop =
              snapshot.scrollTop +
              addedHeight;
          }

          scrollSnapshotRef.current =
            null;
        },
        [
          loadingMore,
          normalizedMessages.length,
        ],
      );


      /* ======================================================================
       * Resize observer
       * ==================================================================== */

      useEffect(
        () => {
          const element =
            viewportRef.current;

          if (!element) {
            return undefined;
          }

          updateScrollState({
            notify:
              false,
          });

          if (
            typeof ResizeObserver ===
            'undefined'
          ) {
            return undefined;
          }

          const observer =
            new ResizeObserver(
              () => {
                if (
                  autoScroll &&
                  wasAtBottomRef.current
                ) {
                  scrollToBottom(
                    'auto',
                  );
                }

                updateScrollState({
                  notify:
                    false,
                });
              },
            );

          observer.observe(
            element,
          );

          return () => {
            observer.disconnect();
          };
        },
        [
          autoScroll,
          scrollToBottom,
          updateScrollState,
        ],
      );


      /* ======================================================================
       * Manual load older messages
       * ==================================================================== */

      const handleLoadMore =
        useCallback(
          () => {
            if (
              loadingMoreRef.current ||
              typeof onLoadMore !==
                'function'
            ) {
              return;
            }

            loadingMoreRef.current =
              true;

            const result =
              onLoadMore(
                {
                  conversationId,

                  direction:
                    'older',

                  limit:
                    pageSize,
                },
              );

            if (
              result &&
              typeof result.finally ===
                'function'
            ) {
              result.finally(
                () => {
                  if (
                    mountedRef.current
                  ) {
                    loadingMoreRef.current =
                      false;
                  }
                },
              );
            } else {
              loadingMoreRef.current =
                false;
            }
          },
          [
            conversationId,
            onLoadMore,
            pageSize,
          ],
        );


      /* ======================================================================
       * Retry message-list request
       * ==================================================================== */

      const handleRetry =
        useCallback(
          () => {
            if (
              disabled ||
              loading
            ) {
              return;
            }

            onRetry?.();
          },
          [
            disabled,
            loading,
            onRetry,
          ],
        );


      /* ======================================================================
       * Empty state primary action
       * ==================================================================== */

      const handleStartConversation =
        useCallback(
          () => {
            if (
              disabled
            ) {
              return;
            }

            onStartConversation?.(
              conversationId,
            );
          },
          [
            conversationId,
            disabled,
            onStartConversation,
          ],
        );


      /* ======================================================================
       * Accessible list state
       * ==================================================================== */

      const hasMessages =
        normalizedMessages.length >
        0;

      const displayUnreadCount =
        Math.max(
          0,
          Number(
            unreadCount ||
              newMessageCount ||
              0,
          ),
        );


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <section
          {...rest}
          className={cn(
            'titech-message-list',
            disabled &&
              'titech-message-list--disabled',
            resolvedInitialLoading &&
              'titech-message-list--loading',
            error &&
              'titech-message-list--error',
            className,
          )}
          aria-label={
            ariaLabel
          }
          data-testid={
            testId
          }
          data-conversation-id={
            conversationId ??
            undefined
          }
          data-tenant-id={
            tenant?.id ??
            tenant?.tenantId ??
            undefined
          }
        >

          {/* =================================================================
              Initial loading
              ================================================================= */}

          {resolvedInitialLoading ? (
            <div
              className="titech-message-list__initial-loading"
              data-testid="titech-message-list-initial-loading"
            >
              <LoadingState
                variant="message-skeleton"
                rows={5}
                showLabel={false}
                ariaLabel="Loading TITech messages"
              />
            </div>
          ) : null}


          {/* =================================================================
              Error
              ================================================================= */}

          {!resolvedInitialLoading &&
          error ? (
            <div
              className="titech-message-list__error"
              data-testid="titech-message-list-error"
            >
              <ErrorState
                error={
                  error
                }
                variant="generic"
                onRetry={
                  handleRetry
                }
              />
            </div>
          ) : null}


          {/* =================================================================
              Empty state
              ================================================================= */}

          {!resolvedInitialLoading &&
          !error &&
          !hasMessages ? (
            <div
              className="titech-message-list__empty"
              data-testid="titech-message-list-empty"
            >
              <EmptyState
                variant={
                  emptyVariant
                }
                title={
                  emptyTitle
                }
                description={
                  emptyMessage
                }
                primaryAction={
                  typeof onStartConversation ===
                    'function'
                    ? {
                        label:
                          'Start conversation',

                        onClick:
                          handleStartConversation,
                      }
                    : undefined
                }
              />
            </div>
          ) : null}


          {/* =================================================================
              Message viewport
              ================================================================= */}

          {!resolvedInitialLoading &&
          !error &&
          hasMessages ? (
            <div
              id={
                viewportId
              }
              ref={
                viewportRef
              }
              className="titech-message-list__viewport"
              tabIndex={0}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-busy={
                loadingMore ||
                sending
              }
              onScroll={
                handleScroll
              }
              data-testid="titech-message-list-viewport"
            >

              {/* =============================================================
                  Older messages control
                  ============================================================= */}

              {(
                hasMore ||
                hasOlderMessages
              ) ? (
                <div className="titech-message-list__load-more">

                  {loadingMore ? (
                    <LoadingState
                      variant="spinner"
                      size="small"
                      label="Loading older messages…"
                      inline
                    />
                  ) : (
                    <button
                      type="button"
                      className="titech-message-list__load-more-button"
                      onClick={
                        handleLoadMore
                      }
                      disabled={
                        disabled ||
                        loadingMore
                      }
                      data-testid="titech-message-list-load-more"
                    >
                      Load older messages
                    </button>
                  )}

                </div>
              ) : null}


              {/* =============================================================
                  Message collection
                  ============================================================= */}

              <div
                className="titech-message-list__messages"
                role="presentation"
              >
                {renderMessages.map(
                  (
                    message,
                    index,
                  ) => {
                    const messageId =
                      getMessageId(
                        message,
                        index,
                      );

                    const previousMessage =
                      renderMessages[
                        index - 1
                      ];

                    const currentTimestamp =
                      getMessageTimestamp(
                        message,
                      );

                    const previousTimestamp =
                      getMessageTimestamp(
                        previousMessage,
                      );

                    const currentDateKey =
                      getMessageDateKey(
                        currentTimestamp,
                      );

                    const previousDateKey =
                      getMessageDateKey(
                        previousTimestamp,
                      );

                    const showDateSeparator =
                      showDateSeparators &&
                      (
                        index ===
                          0 ||
                        currentDateKey !==
                          previousDateKey
                      );

                    const grouped =
                      groupMessages &&
                      canGroupMessages(
                        previousMessage,
                        message,
                        groupingWindowMs,
                      );

                    const showUnreadMarker =
                      Number.isInteger(
                        unreadMarkerIndex,
                      ) &&
                      index ===
                        unreadMarkerIndex;

                    const isOwn =
                      resolveOwnMessage(
                        message,
                      );

                    const messageRole =
                      getMessageRole(
                        message,
                      );

                    const senderId =
                      getMessageSenderId(
                        message,
                      );

                    return (
                      <React.Fragment
                        key={
                          messageId
                        }
                      >

                        {showDateSeparator ? (
                          <DateSeparator
                            value={
                              currentTimestamp
                            }
                          />
                        ) : null}


                        {showUnreadMarker ? (
                          <NewMessageMarker
                            count={
                              displayUnreadCount
                            }
                          />
                        ) : null}


                        <div
                          ref={registerMessageNode(
                            messageId,
                          )}
                          className={cn(
                            'titech-message-list__message',
                            grouped &&
                              'titech-message-list__message--grouped',
                            isOwn &&
                              'titech-message-list__message--own',
                            `titech-message-list__message--${messageRole}`,
                            messageClassName,
                          )}
                          data-message-id={
                            messageId
                          }
                          data-sender-id={
                            senderId ||
                            undefined
                          }
                          data-message-index={
                            index
                          }
                          data-grouped={
                            grouped
                              ? 'true'
                              : 'false'
                          }
                        >
                          <MessageBubble
                            message={
                              message
                            }
                            isOwn={
                              isOwn
                            }
                            showAvatar={
                              showAvatars &&
                              !grouped
                            }
                            showSender={
                              showSender &&
                              !grouped
                            }
                            showTimestamp={
                              showTimestamps
                            }
                            showStatus={
                              showStatus
                            }
                            showActions={
                              showActions
                            }
                            showAttachments={
                              showAttachments
                            }
                            showEditedLabel={
                              showEditedLabel
                            }
                            onReply={
                              onReply
                            }
                            onCopy={
                              onCopy
                            }
                            onEdit={
                              isOwn
                                ? onEdit
                                : undefined
                            }
                            onDelete={
                              onDelete
                            }
                            onRetry={
                              onRetryMessage
                            }
                            onRegenerate={
                              onRegenerate
                            }
                            customActions={
                              customMessageActions
                            }
                          />
                        </div>

                      </React.Fragment>
                    );
                  },
                )}
              </div>


              {/* =============================================================
                  Sending indicator
                  ============================================================= */}

              {sending ? (
                <div
                  className="titech-message-list__sending"
                  role="status"
                  aria-live="polite"
                  data-testid="titech-message-list-sending"
                >
                  <LoadingState
                    variant="message"
                    size="small"
                    label="Sending message…"
                    inline
                  />
                </div>
              ) : null}


              {/* =============================================================
                  Bottom anchor
                  ============================================================= */}

              <div
                ref={
                  bottomAnchorRef
                }
                className="titech-message-list__bottom-anchor"
                aria-hidden="true"
              />

            </div>
          ) : null}


          {/* =================================================================
              Scroll-to-bottom
              ================================================================= */}

          {showScrollButton &&
          showMessagesAndScrollButton(
            hasMessages,
            showScrollButtonState,
          ) ? (
            <ScrollBottomButton
              onClick={() =>
                scrollToBottom()
              }
              unreadCount={
                displayUnreadCount
              }
            />
          ) : null}


          {/* =================================================================
              Live status
              ================================================================= */}

          {displayUnreadCount >
          0 ? (
            <div
              className="titech-message-list__live-status"
              role="status"
              aria-live="polite"
            >
              {displayUnreadCount ===
              1
                ? '1 new message'
                : `${displayUnreadCount} new messages`}
            </div>
          ) : null}

        </section>
      );
    },
  );


/* ============================================================================
 * Helper for scroll button visibility
 * ========================================================================== */

const showMessagesAndScrollButton = (
  hasMessages,
  shouldShow,
) =>
  Boolean(
    hasMessages &&
      shouldShow,
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

MessageList.displayName =
  'TITechMessageList';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

MessageList.propTypes = {
  messages:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  currentUserId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  conversationId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  tenant:
    PropTypes.object,

  loading:
    PropTypes.bool,

  initialLoading:
    PropTypes.bool,

  loadingMore:
    PropTypes.bool,

  sending:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  disabled:
    PropTypes.bool,

  hasMore:
    PropTypes.bool,

  hasOlderMessages:
    PropTypes.bool,

  pageSize:
    PropTypes.number,

  onLoadMore:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onReply:
    PropTypes.func,

  onCopy:
    PropTypes.func,

  onEdit:
    PropTypes.func,

  onDelete:
    PropTypes.func,

  onRetryMessage:
    PropTypes.func,

  onRegenerate:
    PropTypes.func,

  customMessageActions:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  isUserOwnMessage:
    PropTypes.func,

  showAvatars:
    PropTypes.bool,

  showSender:
    PropTypes.bool,

  showTimestamps:
    PropTypes.bool,

  showStatus:
    PropTypes.bool,

  showActions:
    PropTypes.bool,

  showAttachments:
    PropTypes.bool,

  showEditedLabel:
    PropTypes.bool,

  showDateSeparators:
    PropTypes.bool,

  groupMessages:
    PropTypes.bool,

  groupingWindowMs:
    PropTypes.number,

  autoScroll:
    PropTypes.bool,

  autoScrollThreshold:
    PropTypes.number,

  infiniteScroll:
    PropTypes.bool,

  topScrollThreshold:
    PropTypes.number,

  showScrollButton:
    PropTypes.bool,

  unreadCount:
    PropTypes.number,

  newMessageCount:
    PropTypes.number,

  unreadMarkerIndex:
    PropTypes.number,

  onAtBottomChange:
    PropTypes.func,

  onScroll:
    PropTypes.func,

  onReachTop:
    PropTypes.func,

  onReachBottom:
    PropTypes.func,

  emptyVariant:
    PropTypes.string,

  emptyTitle:
    PropTypes.string,

  emptyMessage:
    PropTypes.string,

  onStartConversation:
    PropTypes.func,

  className:
    PropTypes.string,

  messageClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  testId:
    PropTypes.string,

  reverse:
    PropTypes.bool,

  scrollRestoreMode:
    PropTypes.oneOf([
      'preserve',
      'none',
    ]),
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

MessageList.defaultProps = {
  messages:
    [],

  currentUserId:
    undefined,

  conversationId:
    undefined,

  tenant:
    null,

  loading:
    false,

  initialLoading:
    undefined,

  loadingMore:
    false,

  sending:
    false,

  error:
    null,

  disabled:
    false,

  hasMore:
    false,

  hasOlderMessages:
    undefined,

  pageSize:
    DEFAULT_PAGE_SIZE,

  onLoadMore:
    undefined,

  onRetry:
    undefined,

  onReply:
    undefined,

  onCopy:
    undefined,

  onEdit:
    undefined,

  onDelete:
    undefined,

  onRetryMessage:
    undefined,

  onRegenerate:
    undefined,

  customMessageActions:
    [],

  isUserOwnMessage:
    undefined,

  showAvatars:
    true,

  showSender:
    true,

  showTimestamps:
    true,

  showStatus:
    true,

  showActions:
    true,

  showAttachments:
    true,

  showEditedLabel:
    true,

  showDateSeparators:
    true,

  groupMessages:
    true,

  groupingWindowMs:
    DEFAULT_GROUPING_WINDOW_MS,

  autoScroll:
    true,

  autoScrollThreshold:
    DEFAULT_BOTTOM_THRESHOLD,

  infiniteScroll:
    true,

  topScrollThreshold:
    DEFAULT_TOP_THRESHOLD,

  showScrollButton:
    true,

  unreadCount:
    0,

  newMessageCount:
    0,

  unreadMarkerIndex:
    undefined,

  onAtBottomChange:
    undefined,

  onScroll:
    undefined,

  onReachTop:
    undefined,

  onReachBottom:
    undefined,

  emptyVariant:
    'messages',

  emptyTitle:
    'No messages yet',

  emptyMessage:
    'Messages will appear here when the conversation begins.',

  onStartConversation:
    undefined,

  className:
    '',

  messageClassName:
    '',

  ariaLabel:
    'TITech conversation messages',

  testId:
    'titech-message-list',

  reverse:
    false,

  scrollRestoreMode:
    'preserve',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DateSeparator,
  DEFAULT_BOTTOM_THRESHOLD,
  DEFAULT_GROUPING_WINDOW_MS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TOP_THRESHOLD,
  NewMessageMarker,
  ScrollBottomButton,
  canGroupMessages,
  formatDateSeparator,
  getMessageDateKey,
  getMessageId,
  getMessageRole,
  getMessageSenderId,
  getMessageText,
  getMessageTimestamp,
  getNumericTimestamp,
  isNearBottom,
  isNearTop,
  normalizeMessages,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default MessageList;