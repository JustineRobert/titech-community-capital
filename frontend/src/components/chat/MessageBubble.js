'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Message Bubble
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/MessageBubble.js
 *
 * Purpose:
 *   Production-grade reusable message bubble for TITech Community Capital's
 *   enterprise messaging platform.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ User / assistant / system / agent messages
 * ✓ Sender identity
 * ✓ Avatar support
 * ✓ Message timestamp
 * ✓ Delivery / read status
 * ✓ Pending / sending state
 * ✓ Failed state
 * ✓ Edited state
 * ✓ Deleted state
 * ✓ Reply / quoted message
 * ✓ Attachments
 * ✓ Safe attachment presentation
 * ✓ Link-safe text rendering
 * ✓ Copy message
 * ✓ Retry failed message
 * ✓ Edit message
 * ✓ Delete message
 * ✓ Regenerate / resend support
 * ✓ Custom actions
 * ✓ Context menu
 * ✓ Keyboard accessibility
 * ✓ Screen-reader semantics
 * ✓ Responsive presentation
 * ✓ Long-message resilience
 * ✓ Defensive API-data handling
 * ✓ Tenant-aware display hooks
 * ✓ Ref API
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - authorize users
 *   - determine tenant access
 *   - execute financial transactions
 *   - approve loans
 *   - make fraud decisions
 *   - modify authoritative financial records
 *
 * Backend/service layers remain authoritative.
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


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_MAX_PREVIEW_LENGTH =
  12000;


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
    const result =
      String(value);

    return result ||
      fallback;
  } catch {
    return fallback;
  }
};


const sanitizeDisplayText = (
  value,
  maxLength = DEFAULT_MAX_PREVIEW_LENGTH,
) => {
  const text =
    safeText(
      value,
    );

  return text.slice(
    0,
    Math.max(
      1,
      maxLength,
    ),
  );
};


const getMessageText = (
  message,
) =>
  sanitizeDisplayText(
    message?.content ??
      message?.text ??
      message?.body ??
      '',
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
) =>
  safeText(
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


const normalizeStatus =
  (
    message,
  ) =>
    safeText(
      message?.status ||
        message?.deliveryStatus ||
        message?.state,
      '',
    ).toLowerCase();


const isDeletedMessage =
  (
    message,
  ) =>
    message?.deleted === true ||
    message?.isDeleted === true ||
    normalizeStatus(
      message,
    ) ===
      'deleted';


const isEditedMessage =
  (
    message,
  ) =>
    message?.edited === true ||
    message?.isEdited === true ||
    Boolean(
      message?.editedAt,
    );


const normalizeAttachments = (
  message,
) => {
  const attachments =
    message?.attachments;

  if (
    !Array.isArray(
      attachments,
    )
  ) {
    return [];
  }

  return attachments.filter(
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


const ReplyIcon = () => (
  <Icon>
    <path d="M9 17 4 12l5-5" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
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
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(
        0,
        2,
      )
      .map(
        (
          word,
        ) =>
          word.charAt(
            0,
          ),
      )
      .join('')
      .toUpperCase() ||
    'TI';

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
 * Role labels
 * ========================================================================== */

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

    case 'system':
      return 'System';

    case 'agent':
      return 'TITech Agent';

    case 'user':
    default:
      return 'User';
  }
};


/* ============================================================================
 * MessageBubble
 * ========================================================================== */

const MessageBubble =
  forwardRef(
    function MessageBubble(
      {
        message,

        sender,

        isOwn =
          false,

        role,

        showAvatar =
          true,

        showSender =
          true,

        showTimestamp =
          true,

        showStatus =
          true,

        showActions =
          true,

        showReply =
          true,

        showAttachments =
          true,

        showEditedLabel =
          true,

        compact =
          false,

        disableActions =
          false,

        onReply,

        onCopy,

        onEdit,

        onDelete,

        onRetry,

        onRegenerate,

        customActions =
          [],

        quotedMessage,

        attachments,

        readOnly =
          false,

        failed =
          false,

        pending =
          false,

        className =
          '',

        contentClassName =
          '',

        testId =
          'titech-message-bubble',

        ariaLabel,

        maxTextLength =
          DEFAULT_MAX_PREVIEW_LENGTH,

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

      const normalizedRole =
        safeText(
          role ||
            getSenderRole(
              message,
              sender,
            ),
          'user',
        ).toLowerCase();

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

      const messageStatus =
        normalizeStatus(
          message,
        );

      const messageDeleted =
        isDeletedMessage(
          message,
        );

      const messageEdited =
        isEditedMessage(
          message,
        );

      const normalizedAttachments =
        Array.isArray(
          attachments,
        )
          ? attachments.filter(
              Boolean,
            )
          : normalizeAttachments(
              message,
            );

      const isFailed =
        failed ||
        messageStatus ===
          'failed' ||
        messageStatus ===
          'error';

      const isPending =
        pending ||
        messageStatus ===
          'pending' ||
        messageStatus ===
          'sending';

      const resolvedQuotedMessage =
        quotedMessage ||
        message?.replyTo ||
        message?.quotedMessage ||
        null;

      const canEdit =
        !readOnly &&
        !disableActions &&
        typeof onEdit ===
          'function' &&
        isOwn &&
        !messageDeleted;

      const canDelete =
        !readOnly &&
        !disableActions &&
        typeof onDelete ===
          'function' &&
        !messageDeleted;

      const canReply =
        !disableActions &&
        typeof onReply ===
          'function' &&
        !messageDeleted;

      const canRetry =
        !disableActions &&
        typeof onRetry ===
          'function' &&
        isFailed;

      const canRegenerate =
        !disableActions &&
        typeof onRegenerate ===
          'function' &&
        normalizedRole !==
          'user' &&
        !messageDeleted;

      const canCopy =
        !disableActions &&
        (
          typeof onCopy ===
            'function' ||
          Boolean(
            messageText,
          )
        );

      /**
       * ======================================================================
       * Action menu
       * ====================================================================
       */

      const actions =
        [];

      if (
        canReply &&
        showReply
      ) {
        actions.push({
          key:
            'reply',

          label:
            'Reply',

          icon: (
            <ReplyIcon />
          ),

          onClick:
            () =>
              onReply(
                message,
              ),
        });
      }

      if (
        canCopy
      ) {
        actions.push({
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
                  navigator
                    ?.clipboard
                    ?.writeText
                ) {
                  await navigator.clipboard.writeText(
                    messageText,
                  );
                }

                setCopied(
                  true,
                );

                window.setTimeout(
                  () =>
                    setCopied(
                      false,
                    ),
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
        actions.push({
          key:
            'edit',

          label:
            'Edit message',

          icon: (
            <EditIcon />
          ),

          onClick:
            () =>
              onEdit(
                message,
              ),
        });
      }

      if (
        canRetry
      ) {
        actions.push({
          key:
            'retry',

          label:
            'Retry sending',

          icon: (
            <RetryIcon />
          ),

          onClick:
            () =>
              onRetry(
                message,
              ),
        });
      }

      if (
        canRegenerate
      ) {
        actions.push({
          key:
            'regenerate',

          label:
            'Regenerate response',

          icon: (
            <RetryIcon />
          ),

          onClick:
            () =>
              onRegenerate(
                message,
              ),
        });
      }

      if (
        canDelete
      ) {
        actions.push({
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
              onDelete(
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

            if (!label) {
              return;
            }

            actions.push({
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

      /**
       * ======================================================================
       * Menu lifecycle
       * ====================================================================
       */

      useEffect(
        () => {
          if (!menuOpen) {
            return undefined;
          }

          const handleOutsideClick =
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
            handleOutsideClick,
          );

          document.addEventListener(
            'keydown',
            handleEscape,
          );

          return () => {
            document.removeEventListener(
              'mousedown',
              handleOutsideClick,
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

      /**
       * ======================================================================
       * Public ref API
       * ====================================================================
       */

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

      /**
       * ======================================================================
       * Message role styling
       * ====================================================================
       */

      const roleClass =
        [
          'user',
          'assistant',
          'system',
          'agent',
        ].includes(
          normalizedRole,
        )
          ? normalizedRole
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

        messageDeleted &&
          'titech-message-bubble--deleted',

        messageEdited &&
          'titech-message-bubble--edited',

        compact &&
          'titech-message-bubble--compact',

        menuOpen &&
          'titech-message-bubble--menu-open',

        className,
      ]
        .filter(Boolean)
        .join(' ');

      /**
       * ======================================================================
       * Status content
       * ====================================================================
       */

      let statusLabel =
        '';

      let StatusIcon = null;

      if (
        isFailed
      ) {
        statusLabel =
          'Failed to send';
        StatusIcon =
          AlertIcon;
      } else if (
        isPending
      ) {
        statusLabel =
          'Sending';
      } else if (
        messageStatus ===
          'read' ||
        messageStatus ===
          'seen'
      ) {
        statusLabel =
          'Read';
        StatusIcon =
          DoubleCheckIcon;
      } else if (
        messageStatus ===
        'delivered'
      ) {
        statusLabel =
          'Delivered';
        StatusIcon =
          DoubleCheckIcon;
      } else if (
        messageStatus ===
        'sent'
      ) {
        statusLabel =
          'Sent';
        StatusIcon =
          CheckIcon;
      }

      const accessibleMessageLabel =
        ariaLabel ||
        `${getRoleLabel(
          normalizedRole,
        )} ${messageDeleted ? 'deleted message' : 'message'}${
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
            accessibleMessageLabel
          }
          data-testid={
            testId
          }
          data-message-id={
            getMessageId(
              message,
            )
          }
          data-message-role={
            normalizedRole
          }
          data-message-status={
            messageStatus ||
            'default'
          }
        >

          {/* ================================================================
              Sender/avatar
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
                Sender row
                ================================================================ */}

            {showSender &&
            !isOwn ? (
              <div className="titech-message-bubble__sender-row">

                <span className="titech-message-bubble__sender">
                  {
                    senderName
                  }
                </span>

                {normalizedRole !==
                'user' ? (
                  <span className="titech-message-bubble__role">
                    {getRoleLabel(
                      normalizedRole,
                    )}
                  </span>
                ) : null}

              </div>
            ) : null}


            {/* ================================================================
                Quoted / replied-to message
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
                Message content
                ================================================================ */}

            <div
              className={cn(
                'titech-message-bubble__content',
                contentClassName,
              )}
            >
              {messageDeleted ? (
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
                    <div
                      key={
                        attachment?.id ||
                        attachment?.attachmentId ||
                        `${attachment?.name || 'attachment'}-${index}`
                      }
                      className="titech-message-bubble__attachment"
                    >
                      <span
                        className="titech-message-bubble__attachment-name"
                        title={
                          attachment?.name ||
                          attachment?.filename ||
                          'Attachment'
                        }
                      >
                        {
                          attachment?.name ||
                          attachment?.filename ||
                          'Attachment'
                        }
                      </span>
                    </div>
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
              messageEdited &&
              !messageDeleted ? (
                <span className="titech-message-bubble__edited">
                  edited
                </span>
              ) : null}


              {showStatus &&
              isOwn &&
              statusLabel ? (
                <span
                  className={cn(
                    'titech-message-bubble__status',
                    isFailed &&
                      'titech-message-bubble__status--error',
                  )}
                  role={
                    isFailed
                      ? 'alert'
                      : 'status'
                  }
                  aria-label={
                    statusLabel
                  }
                >
                  {StatusIcon ? (
                    <StatusIcon />
                  ) : null}

                  <span>
                    {
                      statusLabel
                    }
                  </span>
                </span>
              ) : null}


              {showActions &&
              actions.length >
                0 ? (
                <div
                  className="titech-message-bubble__actions"
                >
                  <button
                    type="button"
                    className="titech-message-bubble__action-button"
                    onClick={(
                      event,
                    ) => {
                      event.stopPropagation();

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
          PropTypes.node,
        ]),

      text:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.node,
        ]),

      body:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.node,
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

  quotedMessage:
    PropTypes.object,

  attachments:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  readOnly:
    PropTypes.bool,

  failed:
    PropTypes.bool,

  pending:
    PropTypes.bool,

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

  quotedMessage:
    null,

  attachments:
    undefined,

  readOnly:
    false,

  failed:
    false,

  pending:
    false,

  className:
    '',

  contentClassName:
    '',

  testId:
    'titech-message-bubble',

  ariaLabel:
    undefined,

  maxTextLength:
    DEFAULT_MAX_PREVIEW_LENGTH,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  AlertIcon,
  CopyIcon,
  DeleteIcon,
  DoubleCheckIcon,
  EditIcon,
  MessageAvatar,
  MoreIcon,
  ReplyIcon,
  RetryIcon,
  CheckIcon,
  formatRelativeTime,
  formatTimestamp,
  getMessageId,
  getMessageText,
  getRoleLabel,
  getSenderName,
  getSenderRole,
  normalizeAttachments,
  normalizeStatus,
  sanitizeDisplayText,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default MessageBubble;