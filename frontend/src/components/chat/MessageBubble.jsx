/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Message Bubble
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/MessageBubble.jsx
 *
 * Purpose:
 *   Production-grade reusable message renderer for TITechChat Enterprise
 *   Messaging Platform.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ User / assistant / agent / system messages
 * ✓ Own / incoming message alignment
 * ✓ Sender identity
 * ✓ Sender avatar
 * ✓ Role indicator
 * ✓ Timestamp
 * ✓ Delivery/read status
 * ✓ Pending/sending state
 * ✓ Failed state
 * ✓ Edited state
 * ✓ Deleted state
 * ✓ Reply / quoted message
 * ✓ Attachment presentation
 * ✓ Copy message
 * ✓ Reply
 * ✓ Edit
 * ✓ Delete
 * ✓ Retry failed message
 * ✓ Regenerate response
 * ✓ Custom actions
 * ✓ Accessible action menu
 * ✓ Keyboard interaction
 * ✓ Safe text rendering
 * ✓ Defensive API-data handling
 * ✓ Responsive-friendly markup
 * ✓ Ref API
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - authorize users
 *   - enforce tenant isolation
 *   - approve financial transactions
 *   - determine loan eligibility
 *   - perform fraud decisions
 *   - mutate authoritative financial records
 *
 * Those responsibilities belong to TITech's trusted service/API layers.
 *
 * ============================================================================
 */

'use strict';

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

import AttachmentPreview from './AttachmentPreview.jsx';

import './message-bubble.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_MAX_TEXT_LENGTH = 12000;


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


const sanitizeDisplayText = (
  value,
  maxLength = DEFAULT_MAX_TEXT_LENGTH,
) =>
  safeText(
    value,
  ).slice(
    0,
    Math.max(
      1,
      maxLength,
    ),
  );


const getMessageId = (
  message,
  fallback = 'message',
) =>
  safeText(
    message?.id ??
      message?.messageId ??
      message?.uuid,
    fallback,
  );


const getMessageText = (
  message,
) => {
  const value =
    message?.content ??
    message?.text ??
    message?.body ??
    '';

  /*
   * Structured message content should not be rendered as arbitrary HTML.
   * Preserve plain textual representation only.
   */
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


const getSenderName = (
  message,
  sender,
) =>
  safeText(
    sender?.name ||
      sender?.displayName ||
      sender?.fullName ||
      message?.senderName ||
      message?.authorName ||
      message?.userName,
    'TITech User',
  );


const getSenderRole = (
  message,
  sender,
  explicitRole,
) =>
  safeText(
    explicitRole ||
      sender?.role ||
      sender?.type ||
      message?.senderRole ||
      message?.role ||
      'user',
    'user',
  ).toLowerCase();


const getAvatarUrl = (
  message,
  sender,
) =>
  safeText(
    sender?.avatarUrl ||
      sender?.imageUrl ||
      sender?.photoUrl ||
      message?.avatarUrl ||
      message?.senderAvatarUrl,
  );


const getTimestampValue = (
  message,
) =>
  message?.createdAt ||
  message?.timestamp ||
  message?.sentAt ||
  message?.updatedAt ||
  null;


const formatTimestamp = (
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
        timeStyle:
          'short',
      },
    ).format(
      date,
    );
  } catch {
    return '';
  }
};


const formatRelativeTime = (
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

  const difference =
    Date.now() -
    date.getTime();

  const minute =
    60 * 1000;

  const hour =
    60 * minute;

  const day =
    24 * hour;

  if (
    difference <
    minute
  ) {
    return 'Just now';
  }

  if (
    difference <
    hour
  ) {
    return `${Math.floor(
      difference /
        minute,
    )}m`;
  }

  if (
    difference <
    day
  ) {
    return `${Math.floor(
      difference /
        hour,
    )}h`;
  }

  if (
    difference <
    7 * day
  ) {
    return `${Math.floor(
      difference /
        day,
    )}d`;
  }

  return formatTimestamp(
    value,
  );
};


const getMessageStatus = (
  message,
) =>
  safeText(
    message?.status ||
      message?.deliveryStatus ||
      message?.state,
    '',
  ).toLowerCase();


const isDeletedMessage = (
  message,
) =>
  message?.deleted ===
    true ||
  message?.isDeleted ===
    true ||
  getMessageStatus(
    message,
  ) ===
    'deleted';


const isEditedMessage = (
  message,
) =>
  message?.edited ===
    true ||
  message?.isEdited ===
    true ||
  Boolean(
    message?.editedAt,
  );


const normalizeAttachments = (
  message,
  suppliedAttachments,
) => {
  const source =
    Array.isArray(
      suppliedAttachments,
    )
      ? suppliedAttachments
      : message?.attachments;

  if (
    !Array.isArray(
      source,
    )
  ) {
    return [];
  }

  return source.filter(
    (
      attachment,
    ) =>
      attachment &&
      typeof attachment ===
        'object' &&
      !Array.isArray(
        attachment,
      ),
  );
};


const getRoleLabel = (
  role,
) => {
  switch (
    safeText(
      role,
    ).toLowerCase()
  ) {
    case 'assistant':
    case 'ai':
      return 'TITech Assistant';

    case 'agent':
      return 'TITech Agent';

    case 'system':
      return 'System';

    case 'moderator':
      return 'Moderator';

    default:
      return 'User';
  }
};


const getInitials = (
  name,
) => {
  const normalized =
    safeText(
      name,
      'TI',
    ).trim();

  const words =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (
    words.length ===
    0
  ) {
    return 'TI';
  }

  if (
    words.length ===
    1
  ) {
    return words[0]
      .slice(
        0,
        2,
      )
      .toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const Icon = ({
  children,
  size = 16,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);


const MoreIcon = () => (
  <Icon>
    <circle
      cx="5"
      cy="12"
      r="1"
      fill="currentColor"
      stroke="none"
    />
    <circle
      cx="12"
      cy="12"
      r="1"
      fill="currentColor"
      stroke="none"
    />
    <circle
      cx="19"
      cy="12"
      r="1"
      fill="currentColor"
      stroke="none"
    />
  </Icon>
);


const ReplyIcon = () => (
  <Icon>
    <path d="M9 17 4 12l5-5" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </Icon>
);


const CopyIcon = () => (
  <Icon>
    <rect
      x="9"
      y="9"
      width="11"
      height="11"
      rx="2"
    />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
);


const EditIcon = () => (
  <Icon>
    <path d="m12 20 9-9-3-3-9 9-1 4Z" />
    <path d="m14 6 3 3" />
  </Icon>
);


const DeleteIcon = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V4h6v3" />
  </Icon>
);


const RetryIcon = () => (
  <Icon>
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </Icon>
);


const CheckIcon = () => (
  <Icon>
    <path d="m5 12 4 4 10-10" />
  </Icon>
);


const DoubleCheckIcon = () => (
  <Icon>
    <path d="m3 12 4 4 8-8" />
    <path d="m9 16 4 4 8-8" />
  </Icon>
);


const AlertIcon = () => (
  <Icon>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);


/* ============================================================================
 * Avatar
 * ========================================================================== */

const MessageAvatar = ({
  name,
  imageUrl,
}) => {
  const [
    imageFailed,
    setImageFailed,
  ] = useState(
    false,
  );

  const initials =
    getInitials(
      name,
    );

  return (
    <div
      className="titech-message-bubble__avatar"
      aria-hidden="true"
    >
      {imageUrl &&
      !imageFailed ? (
        <img
          src={
            imageUrl
          }
          alt=""
          loading="lazy"
          decoding="async"
          onError={() =>
            setImageFailed(
              true,
            )
          }
        />
      ) : (
        <span>
          {
            initials
          }
        </span>
      )}
    </div>
  );
};


/* ============================================================================
 * Status indicator
 * ========================================================================== */

const MessageStatus = ({
  status,
  failed,
  pending,
}) => {
  if (
    failed
  ) {
    return (
      <span
        className="titech-message-bubble__status titech-message-bubble__status--error"
        role="alert"
        aria-label="Failed to send"
      >
        <AlertIcon />

        <span>
          Failed
        </span>
      </span>
    );
  }

  if (
    pending
  ) {
    return (
      <span
        className="titech-message-bubble__status titech-message-bubble__status--pending"
        role="status"
        aria-label="Sending"
      >
        Sending…
      </span>
    );
  }

  switch (
    status
  ) {
    case 'read':
    case 'seen':
      return (
        <span
          className="titech-message-bubble__status"
          aria-label="Read"
        >
          <DoubleCheckIcon />
        </span>
      );

    case 'delivered':
      return (
        <span
          className="titech-message-bubble__status"
          aria-label="Delivered"
        >
          <DoubleCheckIcon />
        </span>
      );

    case 'sent':
      return (
        <span
          className="titech-message-bubble__status"
          aria-label="Sent"
        >
          <CheckIcon />
        </span>
      );

    default:
      return null;
  }
};


/* ============================================================================
 * MessageBubble
 * ========================================================================== */

const MessageBubble =
  forwardRef(
    function MessageBubble(
      {
        message = null,

        sender = null,

        isOwn = false,

        role,

        showAvatar = true,

        showSender = true,

        showTimestamp = true,

        showStatus = true,

        showActions = true,

        showReply = true,

        showAttachments = true,

        showEditedLabel = true,

        compact = false,

        disableActions = false,

        readOnly = false,

        pending = false,

        failed = false,

        quotedMessage,

        attachments,

        onReply,

        onCopy,

        onEdit,

        onDelete,

        onRetry,

        onRegenerate,

        customActions = [],

        className = '',

        contentClassName = '',

        testId = 'titech-message-bubble',

        ariaLabel,

        maxTextLength =
          DEFAULT_MAX_TEXT_LENGTH,

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const bubbleId =
        `titech-message-bubble-${generatedId}`;

      const rootRef =
        useRef(null);

      const [
        menuOpen,
        setMenuOpen,
      ] = useState(
        false,
      );

      const [
        copied,
        setCopied,
      ] = useState(
        false,
      );

      const [
        actionFocusIndex,
        setActionFocusIndex,
      ] = useState(
        -1,
      );

      const resolvedRole =
        getSenderRole(
          message,
          sender,
          role,
        );

      const senderName =
        getSenderName(
          message,
          sender,
        );

      const avatarUrl =
        getAvatarUrl(
          message,
          sender,
        );

      const messageText =
        sanitizeDisplayText(
          getMessageText(
            message,
          ),
          maxTextLength,
        );

      const messageId =
        getMessageId(
          message,
          bubbleId,
        );

      const timestamp =
        getTimestampValue(
          message,
        );

      const relativeTimestamp =
        formatRelativeTime(
          timestamp,
        );

      const fullTimestamp =
        formatTimestamp(
          timestamp,
        );

      const status =
        getMessageStatus(
          message,
        );

      const deleted =
        isDeletedMessage(
          message,
        );

      const edited =
        isEditedMessage(
          message,
        );

      const normalizedAttachments =
        normalizeAttachments(
          message,
          attachments,
        );

      const isFailed =
        Boolean(
          failed ||
            status ===
              'failed' ||
            status ===
              'error',
        );

      const isPending =
        Boolean(
          pending ||
            status ===
              'pending' ||
            status ===
              'sending',
        );

      const resolvedQuotedMessage =
        quotedMessage ||
        message?.replyTo ||
        message?.quotedMessage ||
        null;

      const canReply =
        !disableActions &&
        !readOnly &&
        !deleted &&
        typeof onReply ===
          'function' &&
        showReply;

      const canCopy =
        !disableActions &&
        !deleted &&
        Boolean(
          messageText,
        );

      const canEdit =
        !disableActions &&
        !readOnly &&
        isOwn &&
        !deleted &&
        typeof onEdit ===
          'function';

      const canDelete =
        !disableActions &&
        !readOnly &&
        !deleted &&
        typeof onDelete ===
          'function';

      const canRetry =
        !disableActions &&
        isFailed &&
        typeof onRetry ===
          'function';

      const canRegenerate =
        !disableActions &&
        !deleted &&
        !isOwn &&
        (
          resolvedRole ===
            'assistant' ||
          resolvedRole ===
            'ai' ||
          resolvedRole ===
            'agent'
        ) &&
        typeof onRegenerate ===
          'function';

      const actions =
        useMemo(
          () => {
            const result =
              [];

            if (
              canReply
            ) {
              result.push({
                key:
                  'reply',

                label:
                  'Reply',

                icon: (
                  <ReplyIcon />
                ),

                onClick:
                  () =>
                    onReply?.(
                      message,
                    ),
              });
            }

            if (
              canCopy
            ) {
              result.push({
                key:
                  'copy',

                label:
                  copied
                    ? 'Copied'
                    : 'Copy message',

                icon: (
                  <CopyIcon />
                ),

                onClick:
                  async () => {
                    try {
                      if (
                        typeof onCopy ===
                        'function'
                      ) {
                        await onCopy(
                          message,
                        );
                      } else if (
                        typeof navigator !==
                          'undefined' &&
                        navigator.clipboard &&
                        typeof navigator
                          .clipboard
                          .writeText ===
                          'function'
                      ) {
                        await navigator.clipboard.writeText(
                          messageText,
                        );
                      }

                      setCopied(
                        true,
                      );

                      setTimeout(
                        () => {
                          if (
                            mountedRef.current
                          ) {
                            setCopied(
                              false,
                            );
                          }
                        },
                        1800,
                      );
                    } catch {
                      setCopied(
                        false,
                      );
                    }
                  },
              });
            }

            if (
              canEdit
            ) {
              result.push({
                key:
                  'edit',

                label:
                  'Edit message',

                icon: (
                  <EditIcon />
                ),

                onClick:
                  () =>
                    onEdit?.(
                      message,
                    ),
              });
            }

            if (
              canRetry
            ) {
              result.push({
                key:
                  'retry',

                label:
                  'Retry sending',

                icon: (
                  <RetryIcon />
                ),

                onClick:
                  () =>
                    onRetry?.(
                      message,
                    ),
              });
            }

            if (
              canRegenerate
            ) {
              result.push({
                key:
                  'regenerate',

                label:
                  'Regenerate response',

                icon: (
                  <RetryIcon />
                ),

                onClick:
                  () =>
                    onRegenerate?.(
                      message,
                    ),
              });
            }

            if (
              canDelete
            ) {
              result.push({
                key:
                  'delete',

                label:
                  'Delete message',

                icon: (
                  <DeleteIcon />
                ),

                danger:
                  true,

                onClick:
                  () =>
                    onDelete?.(
                      message,
                    ),
              });
            }

            if (
              Array.isArray(
                customActions,
              )
            ) {
              customActions.forEach(
                (
                  action,
                  index,
                ) => {
                  if (
                    !action ||
                    typeof action !==
                      'object'
                  ) {
                    return;
                  }

                  const label =
                    safeText(
                      action.label,
                    );

                  if (
                    !label
                  ) {
                    return;
                  }

                  result.push({
                    key:
                      action.id ||
                      action.key ||
                      `custom-${index}`,

                    label,

                    icon:
                      action.icon,

                    danger:
                      Boolean(
                        action.danger,
                      ),

                    disabled:
                      Boolean(
                        action.disabled,
                      ),

                    onClick:
                      () =>
                        action.onClick?.(
                          message,
                        ),
                  });
                },
              );
            }

            return result;
          },
          [
            canCopy,
            canDelete,
            canEdit,
            canRegenerate,
            canReply,
            canRetry,
            copied,
            customActions,
            message,
            messageText,
            onCopy,
            onDelete,
            onEdit,
            onRegenerate,
            onReply,
            onRetry,
          ],
        );

      /*
       * Mount state is used by async clipboard handling to prevent state
       * updates after unmount.
       */
      const mountedRef =
        useRef(
          true,
        );

      useEffect(
        () => () => {
          mountedRef.current =
            false;
        },
        [],
      );

      /* ======================================================================
       * Menu lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          if (
            !menuOpen
          ) {
            setActionFocusIndex(
              -1,
            );

            return undefined;
          }

          const handleOutside =
            (
              event,
            ) => {
              if (
                rootRef.current &&
                !rootRef.current.contains(
                  event.target,
                )
              ) {
                setMenuOpen(
                  false,
                );
              }
            };

          const handleEscape =
            (
              event,
            ) => {
              if (
                event.key ===
                'Escape'
              ) {
                event.preventDefault();

                setMenuOpen(
                  false,
                );

                rootRef.current?.focus();
              }
            };

          document.addEventListener(
            'mousedown',
            handleOutside,
          );

          document.addEventListener(
            'keydown',
            handleEscape,
          );

          return () => {
            document.removeEventListener(
              'mousedown',
              handleOutside,
            );

            document.removeEventListener(
              'keydown',
              handleEscape,
            );
          };
        },
        [
          menuOpen,
        ],
      );

      /* ======================================================================
       * Public ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          openActions() {
            if (
              actions.length >
                0 &&
              !disableActions
            ) {
              setMenuOpen(
                true,
              );
            }
          },

          closeActions() {
            setMenuOpen(
              false,
            );
          },

          getElement() {
            return rootRef.current;
          },
        }),
        [
          actions.length,
          disableActions,
        ],
      );

      /* ======================================================================
       * Menu keyboard navigation
       * ==================================================================== */

      const handleMenuKeyDown =
        useCallback(
          (
            event,
          ) => {
            if (
              actions.length ===
              0
            ) {
              return;
            }

            if (
              event.key ===
              'ArrowDown'
            ) {
              event.preventDefault();

              setActionFocusIndex(
                (
                  current,
                ) =>
                  current >=
                  actions.length -
                    1
                    ? 0
                    : current + 1,
              );

              return;
            }

            if (
              event.key ===
              'ArrowUp'
            ) {
              event.preventDefault();

              setActionFocusIndex(
                (
                  current,
                ) =>
                  current <=
                  0
                    ? actions.length -
                      1
                    : current - 1,
              );

              return;
            }

            if (
              event.key ===
              'Home'
            ) {
              event.preventDefault();

              setActionFocusIndex(
                0,
              );

              return;
            }

            if (
              event.key ===
              'End'
            ) {
              event.preventDefault();

              setActionFocusIndex(
                actions.length -
                  1,
              );

              return;
            }

            if (
              event.key ===
                'Enter' ||
              event.key ===
                ' '
            ) {
              event.preventDefault();

              const action =
                actions[
                  actionFocusIndex
                ];

              if (
                action &&
                !action.disabled
              ) {
                setMenuOpen(
                  false,
                );

                action.onClick?.();
              }

              return;
            }

            if (
              event.key ===
              'Escape'
            ) {
              event.preventDefault();

              setMenuOpen(
                false,
              );

              rootRef.current?.focus();
            }
          },
          [
            actionFocusIndex,
            actions,
          ],
        );

      useEffect(
        () => {
          if (
            !menuOpen ||
            actionFocusIndex <
              0
          ) {
            return;
          }

          const menuItems =
            rootRef.current?.querySelectorAll(
              '[role="menuitem"]',
            );

          menuItems?.[
            actionFocusIndex
          ]?.focus();
        },
        [
          actionFocusIndex,
          menuOpen,
        ],
      );

      /* ======================================================================
       * Root keyboard interaction
       * ==================================================================== */

      const handleRootKeyDown =
        (
          event,
        ) => {
          if (
            event.key ===
            'Escape' &&
            menuOpen
          ) {
            event.preventDefault();

            setMenuOpen(
              false,
            );
          }

          if (
            event.key ===
            'ArrowRight' &&
            actions.length >
              0
          ) {
            event.preventDefault();

            setMenuOpen(
              true,
            );

            setActionFocusIndex(
              0,
            );
          }
        };

      /* ======================================================================
       * CSS classes
       * ==================================================================== */

      const roleClass = [
        'user',
        'assistant',
        'agent',
        'system',
        'moderator',
      ].includes(
        resolvedRole,
      )
        ? resolvedRole
        : 'user';

      const rootClassName = [
        'titech-message-bubble',

        `titech-message-bubble--${roleClass}`,

        isOwn &&
          'titech-message-bubble--own',

        isFailed &&
          'titech-message-bubble--failed',

        isPending &&
          'titech-message-bubble--pending',

        deleted &&
          'titech-message-bubble--deleted',

        edited &&
          'titech-message-bubble--edited',

        compact &&
          'titech-message-bubble--compact',

        menuOpen &&
          'titech-message-bubble--menu-open',

        className,
      ]
        .filter(Boolean)
        .join(' ');

      const accessibleLabel =
        ariaLabel ||
        `${getRoleLabel(
          resolvedRole,
        )} ${
          deleted
            ? 'deleted message'
            : 'message'
        }${
          messageText
            ? `: ${messageText.slice(
                0,
                200,
              )}`
            : ''
        }`;

      return (
        <article
          {...rest}
          ref={
            rootRef
          }
          id={
            bubbleId
          }
          className={
            rootClassName
          }
          tabIndex={
            -1
          }
          aria-label={
            accessibleLabel
          }
          data-testid={
            testId
          }
          data-message-id={
            messageId
          }
          data-message-role={
            resolvedRole
          }
          data-message-status={
            status ||
            'default'
          }
          onKeyDown={
            handleRootKeyDown
          }
        >

          {/* ================================================================
              Avatar
              ================================================================ */}

          {!isOwn &&
          showAvatar ? (
            <MessageAvatar
              name={
                senderName
              }
              imageUrl={
                avatarUrl
              }
            />
          ) : null}


          <div className="titech-message-bubble__body">

            {/* ================================================================
                Sender
                ================================================================ */}

            {showSender &&
            !isOwn ? (
              <div className="titech-message-bubble__sender-row">

                <span className="titech-message-bubble__sender">
                  {
                    senderName
                  }
                </span>

                {resolvedRole !==
                  'user' ? (
                  <span className="titech-message-bubble__role">
                    {getRoleLabel(
                      resolvedRole,
                    )}
                  </span>
                ) : null}

              </div>
            ) : null}


            {/* ================================================================
                Reply context
                ================================================================ */}

            {resolvedQuotedMessage ? (
              <div
                className="titech-message-bubble__quoted"
                role="note"
                aria-label="Replied-to message"
              >
                <span className="titech-message-bubble__quoted-label">
                  Replying to
                </span>

                <span className="titech-message-bubble__quoted-content">
                  {sanitizeDisplayText(
                    getMessageText(
                      resolvedQuotedMessage,
                    ),
                    500,
                  )}
                </span>
              </div>
            ) : null}


            {/* ================================================================
                Text
                ================================================================ */}

            <div
              className={cn(
                'titech-message-bubble__content',
                contentClassName,
              )}
              data-testid="titech-message-content"
            >
              {deleted ? (
                <span className="titech-message-bubble__deleted-text">
                  This message has been deleted.
                </span>
              ) : (
                <span className="titech-message-bubble__text">
                  {
                    messageText
                  }
                </span>
              )}
            </div>


            {/* ================================================================
                Attachments
                ================================================================ */}

            {showAttachments &&
            normalizedAttachments.length >
              0 ? (
              <div
                className="titech-message-bubble__attachments"
                data-testid="titech-message-attachments"
              >
                {normalizedAttachments.map(
                  (
                    attachment,
                    index,
                  ) => (
                    <AttachmentPreview
                      key={
                        attachment?.id ||
                        attachment?.attachmentId ||
                        `${attachment?.name || 'attachment'}-${index}`
                      }
                      attachment={
                        attachment
                      }
                      disabled={
                        disableActions
                      }
                      readOnly={
                        readOnly
                      }
                      showRemove={
                        false
                      }
                      showMetadata={
                        true
                      }
                    />
                  ),
                )}
              </div>
            ) : null}


            {/* ================================================================
                Footer
                ================================================================ */}

            <div className="titech-message-bubble__footer">

              {showTimestamp &&
              relativeTimestamp ? (
                <time
                  className="titech-message-bubble__timestamp"
                  dateTime={
                    timestamp ||
                    undefined
                  }
                  title={
                    fullTimestamp
                  }
                >
                  {
                    relativeTimestamp
                  }
                </time>
              ) : null}


              {showEditedLabel &&
              edited &&
              !deleted ? (
                <span className="titech-message-bubble__edited">
                  edited
                </span>
              ) : null}


              {showStatus &&
              isOwn ? (
                <MessageStatus
                  status={
                    status
                  }
                  failed={
                    isFailed
                  }
                  pending={
                    isPending
                  }
                />
              ) : null}


              {showActions &&
              actions.length >
                0 ? (
                <div
                  className="titech-message-bubble__actions"
                  onClick={(
                    event,
                  ) =>
                    event.stopPropagation()
                  }
                >
                  <button
                    type="button"
                    className="titech-message-bubble__action-button"
                    onClick={() => {
                      if (
                        disableActions
                      ) {
                        return;
                      }

                      setMenuOpen(
                        (
                          current,
                        ) =>
                          !current,
                      );

                      setActionFocusIndex(
                        -1,
                      );
                    }}
                    disabled={
                      disableActions
                    }
                    aria-label="Message actions"
                    aria-haspopup="menu"
                    aria-expanded={
                      menuOpen
                    }
                    title="Message actions"
                    data-testid="titech-message-actions-button"
                  >
                    <MoreIcon />
                  </button>


                  {menuOpen ? (
                    <div
                      className="titech-message-bubble__menu"
                      role="menu"
                      aria-label="Message actions"
                      onKeyDown={
                        handleMenuKeyDown
                      }
                    >
                      {actions.map(
                        (
                          action,
                          index,
                        ) => (
                          <button
                            key={
                              action.key ||
                              index
                            }
                            type="button"
                            role="menuitem"
                            className={cn(
                              'titech-message-bubble__menu-item',
                              action.danger &&
                                'titech-message-bubble__menu-item--danger',
                            )}
                            disabled={
                              action.disabled
                            }
                            onClick={() => {
                              setMenuOpen(
                                false,
                              );

                              action.onClick?.();
                            }}
                          >
                            {action.icon ? (
                              <span className="titech-message-bubble__menu-icon">
                                {
                                  action.icon
                                }
                              </span>
                            ) : null}

                            <span>
                              {
                                action.label
                              }
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}

                </div>
              ) : null}

            </div>

          </div>
        </article>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

MessageBubble.displayName =
  'TITechMessageBubble';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

MessageBubble.propTypes = {
  message:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      messageId:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      uuid:
        PropTypes.string,

      content:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      text:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      body:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      role:
        PropTypes.string,

      senderName:
        PropTypes.string,

      senderRole:
        PropTypes.string,

      senderAvatarUrl:
        PropTypes.string,

      avatarUrl:
        PropTypes.string,

      status:
        PropTypes.string,

      deliveryStatus:
        PropTypes.string,

      state:
        PropTypes.string,

      deleted:
        PropTypes.bool,

      isDeleted:
        PropTypes.bool,

      edited:
        PropTypes.bool,

      isEdited:
        PropTypes.bool,

      editedAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.instanceOf(
            Date,
          ),
        ]),

      createdAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.instanceOf(
            Date,
          ),
        ]),

      timestamp:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.instanceOf(
            Date,
          ),
        ]),

      sentAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.instanceOf(
            Date,
          ),
        ]),

      replyTo:
        PropTypes.object,

      quotedMessage:
        PropTypes.object,

      attachments:
        PropTypes.arrayOf(
          PropTypes.object,
        ),
    }),

  sender:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      name:
        PropTypes.string,

      displayName:
        PropTypes.string,

      fullName:
        PropTypes.string,

      role:
        PropTypes.string,

      type:
        PropTypes.string,

      avatarUrl:
        PropTypes.string,

      imageUrl:
        PropTypes.string,

      photoUrl:
        PropTypes.string,
    }),

  isOwn:
    PropTypes.bool,

  role:
    PropTypes.string,

  showAvatar:
    PropTypes.bool,

  showSender:
    PropTypes.bool,

  showTimestamp:
    PropTypes.bool,

  showStatus:
    PropTypes.bool,

  showActions:
    PropTypes.bool,

  showReply:
    PropTypes.bool,

  showAttachments:
    PropTypes.bool,

  showEditedLabel:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  disableActions:
    PropTypes.bool,

  readOnly:
    PropTypes.bool,

  pending:
    PropTypes.bool,

  failed:
    PropTypes.bool,

  quotedMessage:
    PropTypes.object,

  attachments:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  onReply:
    PropTypes.func,

  onCopy:
    PropTypes.func,

  onEdit:
    PropTypes.func,

  onDelete:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onRegenerate:
    PropTypes.func,

  customActions:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.string,

        key:
          PropTypes.string,

        label:
          PropTypes.string
            .isRequired,

        icon:
          PropTypes.node,

        onClick:
          PropTypes.func,

        danger:
          PropTypes.bool,

        disabled:
          PropTypes.bool,
      }),
    ),

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  testId:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  maxTextLength:
    PropTypes.number,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

MessageBubble.defaultProps = {
  message:
    null,

  sender:
    null,

  isOwn:
    false,

  role:
    undefined,

  showAvatar:
    true,

  showSender:
    true,

  showTimestamp:
    true,

  showStatus:
    true,

  showActions:
    true,

  showReply:
    true,

  showAttachments:
    true,

  showEditedLabel:
    true,

  compact:
    false,

  disableActions:
    false,

  readOnly:
    false,

  pending:
    false,

  failed:
    false,

  quotedMessage:
    null,

  attachments:
    undefined,

  onReply:
    undefined,

  onCopy:
    undefined,

  onEdit:
    undefined,

  onDelete:
    undefined,

  onRetry:
    undefined,

  onRegenerate:
    undefined,

  customActions:
    [],

  className:
    '',

  contentClassName:
    '',

  testId:
    'titech-message-bubble',

  ariaLabel:
    undefined,

  maxTextLength:
    DEFAULT_MAX_TEXT_LENGTH,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  AlertIcon,
  AttachmentPreview,
  CheckIcon,
  CopyIcon,
  DeleteIcon,
  DoubleCheckIcon,
  EditIcon,
  MessageAvatar,
  MessageStatus,
  MoreIcon,
  ReplyIcon,
  RetryIcon,
  formatRelativeTime,
  formatTimestamp,
  getAvatarUrl,
  getInitials,
  getMessageId,
  getMessageText,
  getMessageStatus,
  getRoleLabel,
  getSenderName,
  getSenderRole,
  getTimestampValue,
  isDeletedMessage,
  isEditedMessage,
  normalizeAttachments,
  safeText,
  sanitizeDisplayText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default MessageBubble;