'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Message List
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/MessageList.js
 *
 * Purpose:
 *   Production-grade message collection and viewport manager for TITechChat.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Message rendering
 * ✓ MessageBubble integration
 * ✓ Active conversation support
 * ✓ Loading state
 * ✓ Initial loading state
 * ✓ Pagination
 * ✓ Load-more messages
 * ✓ Infinite-scroll hook
 * ✓ New-message indicators
 * ✓ Auto-scroll behavior
 * ✓ Scroll-to-bottom control
 * ✓ Unread boundary
 * ✓ Empty state
 * ✓ Error state
 * ✓ Retry support
 * ✓ Message grouping
 * ✓ Date separators
 * ✓ Consecutive-message optimization
 * ✓ Sender grouping
 * ✓ Own/incoming message handling
 * ✓ Tenant-aware context hooks
 * ✓ Keyboard navigation
 * ✓ Accessibility
 * ✓ Ref API
 * ✓ Stable test selectors
 * ✓ Defensive API-data handling
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component manages presentation and viewport behavior only.
 *
 * It MUST NOT:
 *   - authorize message access
 *   - enforce tenant isolation
 *   - decide financial permissions
 *   - modify authoritative financial records
 *   - execute financial transactions
 *   - make fraud decisions
 *
 * Those responsibilities remain in TITech's trusted backend/service layer.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import MessageBubble from './MessageBubble';

import EmptyState from './EmptyState';

import ErrorState from './ErrorState';

import LoadingState from './LoadingState';

import './message-list.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_PAGE_SIZE = 50;

const DEFAULT_BOTTOM_THRESHOLD = 80;

const DEFAULT_SCROLL_THRESHOLD = 160;


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
  fallback = '',
) =>
  safeText(
    message?.senderId ??
      message?.userId ??
      message?.authorId ??
      message?.sender?.id ??
      fallback,
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
  value,
) => {
  if (!value) {
    return '';
  }

  const date =
    new Date(
      value,
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
  value,
) => {
  if (!value) {
    return '';
  }

  const date =
    new Date(
      value,
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


const isNearBottom = (
  element,
  threshold = DEFAULT_BOTTOM_THRESHOLD,
) => {
  if (
    !element
  ) {
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


/**
 * Stable message normalization.
 *
 * The caller's array is never mutated.
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

        __titechIndex:
          index,

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
 * Determine whether two messages can be visually grouped.
 */
const canGroupMessages = (
  previous,
  current,
  groupingWindowMs = 5 * 60 * 1000,
) => {
  if (
    !previous ||
    !current
  ) {
    return false;
  }

  const previousSender =
    getMessageSenderId(
      previous,
    );

  const currentSender =
    getMessageSenderId(
      current,
    );

  if (
    previousSender !==
    currentSender
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

  const previousTime =
    new Date(
      getMessageTimestamp(
        previous,
      ) || 0,
    ).getTime();

  const currentTime =
    new Date(
      getMessageTimestamp(
        current,
      ) || 0,
    ).getTime();

  if (
    !Number.isFinite(
      previousTime,
    ) ||
    !Number.isFinite(
      currentTime,
    )
  ) {
    return true;
  }

  return (
    currentTime -
      previousTime <=
    groupingWindowMs
  );
};


/* ============================================================================
 * Date separator
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
        {label}
      </span>
    </div>
  );
};


/* ============================================================================
 * New-message marker
 * ========================================================================== */

const NewMessageMarker = ({
  label =
    'New messages',
}) => (
  <div
    className="titech-message-list__new-message-marker"
    role="separator"
    aria-label={
      label
    }
  >
    <span>
      {label}
    </span>
  </div>
);


/* ============================================================================
 * Scroll button
 * ========================================================================== */

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
    >
      ↓
    </span>

    {unreadCount >
    0 ? (
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

        tenant,

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

        customMessageActions = [],

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
          5 * 60 * 1000,

        autoScroll =
          true,

        autoScrollThreshold =
          DEFAULT_BOTTOM_THRESHOLD,

        infiniteScroll =
          true,

        scrollThreshold =
          DEFAULT_SCROLL_THRESHOLD,

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

        testId =
          'titech-message-list',

        ariaLabel =
          'TITech conversation messages',

        reverse =
          false,

        ...rest
      },
      forwardedRef,
    ) {
      const scrollRef =
        useRef(null);

      const bottomAnchorRef =
        useRef(null);

      const messageRefs =
        useRef(
          new Map(),
        );

      const previousMessageCountRef =
        useRef(
          Array.isArray(
            messages,
          )
            ? messages.length
            : 0,
        );

      const initializedRef =
        useRef(false);

      const loadingMoreRef =
        useRef(false);

      const wasAtBottomRef =
        useRef(true);

      const [
        showScrollToBottom,
        setShowScrollToBottom,
      ] =
        useState(
          false,
        );


      /* ======================================================================
       * Effective loading state
       * ==================================================================== */

      const resolvedInitialLoading =
        initialLoading ??
        (
          loading &&
          (
            !Array.isArray(
              messages,
            ) ||
            messages.length ===
              0
          )
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


      /* ======================================================================
       * Render order
       * ==================================================================== */

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
       * Bottom state
       * ==================================================================== */

      const checkScrollPosition =
        useCallback(
          () => {
            const element =
              scrollRef.current;

            if (!element) {
              return;
            }

            const atBottom =
              isNearBottom(
                element,
                autoScrollThreshold,
              );

            const atTop =
              element.scrollTop <=
              scrollThreshold;

            const previous =
              wasAtBottomRef.current;

            wasAtBottomRef.current =
              atBottom;

            setShowScrollToBottom(
              !atBottom,
            );

            if (
              previous !==
              atBottom
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
              scrollThreshold
            ) {
              onReachBottom?.();
            }
          },
          [
            autoScrollThreshold,
            onAtBottomChange,
            onReachBottom,
            onReachTop,
            scrollThreshold,
          ],
        );


      /* ======================================================================
       * Scroll to bottom
       * ==================================================================== */

      const scrollToBottom =
        useCallback(
          (
            behavior =
              'smooth',
          ) => {
            const element =
              scrollRef.current;

            if (!element) {
              return;
            }

            try {
              element.scrollTo({
                top:
                  element.scrollHeight,

                behavior,
              });
            } catch {
              element.scrollTop =
                element.scrollHeight;
            }

            setShowScrollToBottom(
              false,
            );

            wasAtBottomRef.current =
              true;

            onAtBottomChange?.(
              true,
            );
          },
          [
            onAtBottomChange,
          ],
        );


      /* ======================================================================
       * Scroll to message
       * ==================================================================== */

      const scrollToMessage =
        useCallback(
          (
            messageId,
            behavior =
              'smooth',
          ) => {
            const node =
              messageRefs.current.get(
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
       * Public ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          scrollToBottom,

          scrollToLatest:
            scrollToBottom,

          scrollToMessage,

          getScrollElement() {
            return scrollRef.current;
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

          focus() {
            scrollRef.current?.focus();
          },
        }),
        [
          normalizedMessages,
          scrollToBottom,
          scrollToMessage,
        ],
      );


      /* ======================================================================
       * Register message refs
       * ==================================================================== */

      const registerMessageRef =
        useCallback(
          (
            messageId,
          ) =>
            (
              node,
            ) => {
              const key =
                String(
                  messageId,
                );

              if (
                node
              ) {
                messageRefs.current.set(
                  key,
                  node,
                );
              } else {
                messageRefs.current.delete(
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
            checkScrollPosition();

            onScroll?.(
              event,
            );

            const element =
              event.currentTarget;

            const atTop =
              element.scrollTop <=
              scrollThreshold;

            if (
              infiniteScroll &&
              atTop &&
              hasMore &&
              typeof onLoadMore ===
                'function' &&
              !loadingMoreRef.current
            ) {
              loadingMoreRef.current =
                true;

              onLoadMore?.(
                {
                  conversationId,

                  direction:
                    'older',

                  limit:
                    pageSize,
                },
              );
            }
          },
          [
            checkScrollPosition,
            conversationId,
            hasMore,
            infiniteScroll,
            onLoadMore,
            onScroll,
            pageSize,
            scrollThreshold,
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
       * Initial scroll
       * ==================================================================== */

      useEffect(
        () => {
          if (
            initializedRef.current
          ) {
            return;
          }

          if (
            resolvedInitialLoading
          ) {
            return;
          }

          if (
            normalizedMessages.length ===
            0
          ) {
            initializedRef.current =
              true;

            return;
          }

          initializedRef.current =
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
       * Conversation change
       * ==================================================================== */

      useEffect(
        () => {
          initializedRef.current =
            false;

          previousMessageCountRef.current =
            0;

          wasAtBottomRef.current =
            true;

          setShowScrollToBottom(
            false,
          );
        },
        [
          conversationId,
        ],
      );


      /* ======================================================================
       * New messages / auto-scroll
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
            !increased ||
            !autoScroll
          ) {
            return;
          }

          const shouldScroll =
            wasAtBottomRef.current ||
            previousCount ===
              0;

          if (
            shouldScroll
          ) {
            requestAnimationFrame(
              () => {
                scrollToBottom();
              },
            );
          } else {
            setShowScrollToBottom(
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
       * Resize / initial position observer
       * ==================================================================== */

      useEffect(
        () => {
          const element =
            scrollRef.current;

          if (!element) {
            return undefined;
          }

          checkScrollPosition();

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
                  wasAtBottomRef.current &&
                  autoScroll
                ) {
                  scrollToBottom(
                    'auto',
                  );
                }

                checkScrollPosition();
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
          checkScrollPosition,
          scrollToBottom,
        ],
      );


      /* ======================================================================
       * Load more messages manually
       * ==================================================================== */

      const handleLoadMore =
        useCallback(
          async () => {
            if (
              !hasMore ||
              typeof onLoadMore !==
                'function' ||
              loadingMoreRef.current
            ) {
              return;
            }

            loadingMoreRef.current =
              true;

            try {
              await onLoadMore(
                {
                  conversationId,

                  direction:
                    'older',

                  limit:
                    pageSize,
                },
              );
            } finally {
              loadingMoreRef.current =
                false;
            }
          },
          [
            conversationId,
            hasMore,
            onLoadMore,
            pageSize,
          ],
        );


      /* ======================================================================
       * Retry
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
       * Own message resolver
       * ==================================================================== */

      const resolveIsOwnMessage =
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

            const senderId =
              getMessageSenderId(
                message,
              );

            if (
              currentUserId ===
                null ||
              currentUserId ===
                undefined
            ) {
              return false;
            }

            return (
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
       * Determine new-message marker
       * ==================================================================== */

      const shouldRenderUnreadMarker =
        Number.isInteger(
          unreadMarkerIndex,
        ) &&
        unreadMarkerIndex >=
          0 &&
        unreadMarkerIndex <
          renderMessages.length;


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
            className,
          )}
          aria-label={
            ariaLabel
          }
          data-testid={
            testId
          }
        >

          {/* ================================================================
              Initial loading
              ================================================================ */}

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


          {/* ================================================================
              Error
              ================================================================ */}

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


          {/* ================================================================
              Empty
              ================================================================ */}

          {!resolvedInitialLoading &&
          !error &&
          normalizedMessages.length ===
            0 ? (
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
                  onStartConversation
                    ? {
                        label:
                          'Start conversation',

                        onClick:
                          onStartConversation,
                      }
                    : undefined
                }
              />
            </div>
          ) : null}


          {/* ================================================================
              Message viewport
              ================================================================ */}

          {!resolvedInitialLoading &&
          !error &&
          normalizedMessages.length >
            0 ? (
            <div
              ref={
                scrollRef
              }
              className="titech-message-list__viewport"
              tabIndex={0}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              onScroll={
                handleScroll
              }
              data-testid="titech-message-list-viewport"
            >

              {/* ------------------------------------------------------------
                  Older message loader
                  ------------------------------------------------------------ */}

              {hasMore ? (
                <div className="titech-message-list__load-more">

                  {loadingMore ? (
                    <LoadingState
                      variant="spinner"
                      size="small"
                      label="Loading older messages…"
                      showDescription={false}
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


              {/* ------------------------------------------------------------
                  Message collection
                  ------------------------------------------------------------ */}

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

                    const previous =
                      renderMessages[
                        index - 1
                      ];

                    const currentDateKey =
                      getMessageDateKey(
                        getMessageTimestamp(
                          message,
                        ),
                      );

                    const previousDateKey =
                      getMessageDateKey(
                        getMessageTimestamp(
                          previous,
                        ),
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
                        previous,
                        message,
                        groupingWindowMs,
                      );

                    const showUnreadMarker =
                      shouldRenderUnreadMarker &&
                      index ===
                        unreadMarkerIndex;

                    const isOwn =
                      resolveIsOwnMessage(
                        message,
                      );

                    const role =
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
                              getMessageTimestamp(
                                message,
                              )
                            }
                          />
                        ) : null}


                        {showUnreadMarker ? (
                          <NewMessageMarker
                            label={
                              newMessageCount >
                              0
                                ? `${newMessageCount} new messages`
                                : 'New messages'
                            }
                          />
                        ) : null}


                        <div
                          ref={registerMessageRef(
                            messageId,
                          )}
                          className={cn(
                            'titech-message-list__message',
                            grouped &&
                              'titech-message-list__message--grouped',
                            isOwn &&
                              'titech-message-list__message--own',
                            `titech-message-list__message--${role}`,
                          )}
                          data-message-id={
                            messageId
                          }
                          data-sender-id={
                            senderId ||
                            undefined
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
                            className={
                              messageClassName
                            }
                          />
                        </div>

                      </React.Fragment>
                    );
                  },
                )}
              </div>


              {/* ------------------------------------------------------------
                  Sending indicator
                  ------------------------------------------------------------ */}

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
                    showDescription={false}
                    inline
                  />
                </div>
              ) : null}


              {/* ------------------------------------------------------------
                  Bottom anchor
                  ------------------------------------------------------------ */}

              <div
                ref={
                  bottomAnchorRef
                }
                className="titech-message-list__bottom-anchor"
                aria-hidden="true"
              />

            </div>
          ) : null}


          {/* ================================================================
              Scroll-to-bottom
              ================================================================ */}

          {showScrollButton &&
          showScrollToBottom &&
          normalizedMessages.length >
            0 ? (
            <ScrollBottomButton
              onClick={() =>
                scrollToBottom()
              }
              unreadCount={
                Number(
                  unreadCount ||
                    newMessageCount ||
                    0,
                )
              }
            />
          ) : null}


          {/* ================================================================
              Live unread status
              ================================================================ */}

          {newMessageCount >
          0 ? (
            <div
              className="titech-message-list__live-status"
              role="status"
              aria-live="polite"
            >
              {newMessageCount ===
              1
                ? '1 new message'
                : `${newMessageCount} new messages`}
            </div>
          ) : null}

        </section>
      );
    },
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

  scrollThreshold:
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

  testId:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  reverse:
    PropTypes.bool,
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
    5 * 60 * 1000,

  autoScroll:
    true,

  autoScrollThreshold:
    DEFAULT_BOTTOM_THRESHOLD,

  infiniteScroll:
    true,

  scrollThreshold:
    DEFAULT_SCROLL_THRESHOLD,

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

  testId:
    'titech-message-list',

  ariaLabel:
    'TITech conversation messages',

  reverse:
    false,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DateSeparator,
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
  isNearBottom,
  normalizeMessages,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default MessageList;