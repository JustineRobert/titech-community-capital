/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise TITech Chat — Conversation View
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/ConversationView.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade conversation presentation and interaction layer for
 *   TITech Community Capital Chat.
 *
 * Responsibilities:
 *   - Render conversation messages.
 *   - Render message status and delivery state.
 *   - Support optimistic/pending messages.
 *   - Support failed-message retry.
 *   - Support message deletion through parent callbacks.
 *   - Support attachments and attachment previews.
 *   - Support typing indicators.
 *   - Support empty/loading/error states.
 *   - Support accessible keyboard navigation.
 *   - Support auto-scroll without disrupting users reading history.
 *   - Support "new messages" notification when user is away from bottom.
 *   - Support conversation-level actions.
 *   - Remain independent from backend implementation details.
 *
 * Architectural boundary:
 *   This component is a presentation/orchestration component.
 *
 *   It MUST NOT:
 *   - perform authorization decisions;
 *   - determine tenant access;
 *   - mutate financial records;
 *   - approve transactions;
 *   - perform fraud decisions;
 *   - contain secrets;
 *   - directly own backend persistence.
 *
 * Parent/application layers remain responsible for:
 *   - API/WebSocket communication;
 *   - authentication;
 *   - authorization;
 *   - tenant isolation;
 *   - persistence;
 *   - message delivery;
 *   - moderation/business rules.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

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

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechChatConversationView';

const DEFAULT_TITLE =
  'Conversation';

const DEFAULT_EMPTY_TITLE =
  'No messages yet';

const DEFAULT_EMPTY_DESCRIPTION =
  'Start the conversation by sending a message.';

const DEFAULT_ERROR_MESSAGE =
  'We could not load this conversation.';

const DEFAULT_LOADING_MESSAGE =
  'Loading conversation…';

const DEFAULT_SEND_PLACEHOLDER =
  'Write a message…';

const DEFAULT_MAX_MESSAGE_LENGTH =
  5000;

const AUTO_SCROLL_THRESHOLD_PX =
  120;

const SCROLL_DEBOUNCE_MS =
  100;

const NEW_MESSAGE_RESET_MS =
  1500;

/**
 * Explicit message statuses.
 *
 * These are presentation statuses. The backend may use a different
 * representation; normalizeMessages() below accepts common alternatives.
 */
const MESSAGE_STATUS = Object.freeze({
  SENDING: 'sending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/**
 * Attachment statuses.
 */
const ATTACHMENT_STATUS = Object.freeze({
  READY: 'ready',
  UPLOADING: 'uploading',
  FAILED: 'failed',
});

/* ============================================================================
 * UTILITY HELPERS
 * ========================================================================== */

function cn(...classes) {
  return classes
    .filter(Boolean)
    .join(' ');
}

function safeString(value, fallback = '') {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    return String(value).trim() || fallback;
  } catch {
    return fallback;
  }
}

function getMessageId(message, index) {
  return (
    safeString(
      message?.id,
      '',
    ) ||
    safeString(
      message?._id,
      '',
    ) ||
    safeString(
      message?.messageId,
      '',
    ) ||
    `message-${index}`
  );
}

function getMessageText(message) {
  return safeString(
    message?.text ??
      message?.content ??
      message?.body ??
      '',
  );
}

function getMessageTimestamp(message) {
  return (
    message?.createdAt ??
    message?.timestamp ??
    message?.sentAt ??
    message?.updatedAt ??
    null
  );
}

function getSenderId(message) {
  return safeString(
    message?.senderId ??
      message?.userId ??
      message?.authorId ??
      message?.sender?.id ??
      message?.author?.id ??
      '',
  );
}

function getSenderName(message) {
  return (
    safeString(
      message?.senderName ??
        message?.sender?.name ??
        message?.author?.name ??
        message?.userName ??
        message?.user?.name ??
        '',
    ) ||
    'TITech User'
  );
}

function isOwnMessage(
  message,
  currentUserId,
) {
  if (
    typeof message?.isOwn ===
      'boolean'
  ) {
    return message.isOwn;
  }

  if (!currentUserId) {
    return false;
  }

  return (
    getSenderId(message) ===
    safeString(currentUserId)
  );
}

function normalizeStatus(message) {
  const status =
    safeString(
      message?.status,
      '',
    ).toLowerCase();

  if (
    [
      MESSAGE_STATUS.SENDING,
      MESSAGE_STATUS.SENT,
      MESSAGE_STATUS.DELIVERED,
      MESSAGE_STATUS.READ,
      MESSAGE_STATUS.FAILED,
      MESSAGE_STATUS.CANCELLED,
    ].includes(status)
  ) {
    return status;
  }

  if (
    message?.failed ||
    message?.error
  ) {
    return MESSAGE_STATUS.FAILED;
  }

  if (
    message?.pending ||
    message?.optimistic
  ) {
    return MESSAGE_STATUS.SENDING;
  }

  if (
    message?.read ||
    message?.isRead
  ) {
    return MESSAGE_STATUS.READ;
  }

  if (
    message?.delivered ||
    message?.isDelivered
  ) {
    return MESSAGE_STATUS.DELIVERED;
  }

  return MESSAGE_STATUS.SENT;
}

function normalizeAttachments(
  attachments,
) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .filter(Boolean)
    .map((attachment, index) => ({
      id:
        safeString(
          attachment.id ??
            attachment.fileId ??
            attachment._id,
          '',
        ) ||
        `attachment-${index}`,

      name:
        safeString(
          attachment.name ??
            attachment.fileName,
          'Attachment',
        ),

      url:
        safeString(
          attachment.url ??
            attachment.downloadUrl ??
            attachment.previewUrl,
          '',
        ),

      previewUrl:
        safeString(
          attachment.previewUrl ??
            attachment.thumbnailUrl ??
            attachment.url,
          '',
        ),

      mimeType:
        safeString(
          attachment.mimeType ??
            attachment.type,
          '',
        ),

      size:
        attachment.size ??
        attachment.fileSize ??
        null,

      status:
        safeString(
          attachment.status,
          ATTACHMENT_STATUS.READY,
        ),

      ...attachment,
    }));
}

function normalizeMessage(
  message,
  index,
) {
  return {
    ...message,

    id:
      getMessageId(
        message,
        index,
      ),

    text:
      getMessageText(message),

    senderId:
      getSenderId(message),

    senderName:
      getSenderName(message),

    timestamp:
      getMessageTimestamp(message),

    status:
      normalizeStatus(message),

    attachments:
      normalizeAttachments(
        message?.attachments,
      ),
  };
}

function normalizeMessages(
  messages,
) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map(
    normalizeMessage,
  );
}

function formatTime(
  timestamp,
  locale,
) {
  if (!timestamp) {
    return '';
  }

  const date =
    timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(
      locale || undefined,
      {
        hour: '2-digit',
        minute: '2-digit',
      },
    ).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

function formatDateLabel(
  timestamp,
  locale,
) {
  if (!timestamp) {
    return '';
  }

  const date =
    timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(
      locale || undefined,
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      },
    ).format(date);
  } catch {
    return date.toDateString();
  }
}

function formatFileSize(
  bytes,
) {
  const value =
    Number(bytes);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return '';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(
      value / 1024
    ).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(
      value /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  }

  return `${(
    value /
    (1024 * 1024 * 1024)
  ).toFixed(1)} GB`;
}

function isImageAttachment(
  attachment,
) {
  return safeString(
    attachment?.mimeType,
  ).startsWith('image/');
}

function getInitials(
  name,
) {
  const normalized =
    safeString(
      name,
      'T',
    );

  const parts =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (!parts.length) {
    return 'T';
  }

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return (
    parts[0][0] +
    parts[
      parts.length - 1
    ][0]
  ).toUpperCase();
}

function groupMessagesByDate(
  messages,
  locale,
) {
  const groups = [];

  messages.forEach(
    (message) => {
      const label =
        formatDateLabel(
          message.timestamp,
          locale,
        ) || 'Messages';

      const previous =
        groups[
          groups.length - 1
        ];

      if (
        previous &&
        previous.label === label
      ) {
        previous.messages.push(
          message,
        );
      } else {
        groups.push({
          label,
          messages: [message],
        });
      }
    },
  );

  return groups;
}

/* ============================================================================
 * ICONS
 * ========================================================================== */

function IconBase({
  children,
  size = 18,
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

IconBase.propTypes = {
  children:
    PropTypes.node.isRequired,

  size:
    PropTypes.number,
};

function SendIcon() {
  return (
    <IconBase>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </IconBase>
  );
}

function RefreshIcon() {
  return (
    <IconBase>
      <path d="M20 11a8 8 0 0 0-14.7-4.3L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.7 4.3L21 15" />
      <path d="M21 20v-5h-5" />
    </IconBase>
  );
}

function MoreIcon() {
  return (
    <IconBase>
      <circle
        cx="5"
        cy="12"
        r="1"
      />
      <circle
        cx="12"
        cy="12"
        r="1"
      />
      <circle
        cx="19"
        cy="12"
        r="1"
      />
    </IconBase>
  );
}

function ArrowDownIcon() {
  return (
    <IconBase>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </IconBase>
  );
}

function PaperclipIcon() {
  return (
    <IconBase>
      <path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7L9.8 17.6a2 2 0 0 1-2.8-2.8l8.5-8.5" />
    </IconBase>
  );
}

function DownloadIcon() {
  return (
    <IconBase>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </IconBase>
  );
}

function CheckIcon() {
  return (
    <IconBase size={15}>
      <path d="m5 12 4 4L19 6" />
    </IconBase>
  );
}

function DoubleCheckIcon() {
  return (
    <IconBase size={15}>
      <path d="m2.5 12 4 4L16 6.5" />
      <path d="m9 12 4 4L22 7" />
    </IconBase>
  );
}

function AlertIcon() {
  return (
    <IconBase>
      <path d="M10.3 3.3 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </IconBase>
  );
}

/* ============================================================================
 * STATUS COMPONENT
 * ========================================================================== */

function MessageStatus({
  status,
}) {
  if (
    status ===
    MESSAGE_STATUS.SENDING
  ) {
    return (
      <span
        className="titech-chat__message-status titech-chat__message-status--sending"
        aria-label="Sending"
        title="Sending"
      >
        <span aria-hidden="true">
          …
        </span>
      </span>
    );
  }

  if (
    status ===
    MESSAGE_STATUS.FAILED
  ) {
    return (
      <span
        className="titech-chat__message-status titech-chat__message-status--failed"
        aria-label="Message failed to send"
        title="Message failed to send"
      >
        <AlertIcon />
      </span>
    );
  }

  if (
    status ===
    MESSAGE_STATUS.READ
  ) {
    return (
      <span
        className="titech-chat__message-status titech-chat__message-status--read"
        aria-label="Read"
        title="Read"
      >
        <DoubleCheckIcon />
      </span>
    );
  }

  if (
    status ===
    MESSAGE_STATUS.DELIVERED
  ) {
    return (
      <span
        className="titech-chat__message-status titech-chat__message-status--delivered"
        aria-label="Delivered"
        title="Delivered"
      >
        <DoubleCheckIcon />
      </span>
    );
  }

  return (
    <span
      className="titech-chat__message-status titech-chat__message-status--sent"
      aria-label="Sent"
      title="Sent"
    >
      <CheckIcon />
    </span>
  );
}

MessageStatus.propTypes = {
  status:
    PropTypes.string.isRequired,
};

/* ============================================================================
 * ATTACHMENT VIEW
 * ========================================================================== */

function AttachmentList({
  attachments,
  onAttachmentClick,
}) {
  if (!attachments.length) {
    return null;
  }

  return (
    <div
      className="titech-chat__attachments"
      aria-label="Message attachments"
    >
      {attachments.map(
        (attachment) => {
          const image =
            isImageAttachment(
              attachment,
            );

          const content =
            image &&
            attachment.previewUrl ? (
              <img
                src={
                  attachment.previewUrl
                }
                alt={
                  attachment.name
                }
                className="titech-chat__attachment-image"
                loading="lazy"
              />
            ) : (
              <span className="titech-chat__attachment-file">
                <PaperclipIcon />
                <span className="titech-chat__attachment-file-name">
                  {attachment.name}
                </span>

                {attachment.size && (
                  <small>
                    {formatFileSize(
                      attachment.size,
                    )}
                  </small>
                )}
              </span>
            );

          if (
            attachment.url
          ) {
            return (
              <a
                key={
                  attachment.id
                }
                href={
                  attachment.url
                }
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'titech-chat__attachment',
                  image &&
                    'titech-chat__attachment--image',
                )}
                aria-label={`Open attachment ${attachment.name}`}
                onClick={(event) => {
                  if (
                    typeof onAttachmentClick ===
                    'function'
                  ) {
                    onAttachmentClick(
                      attachment,
                      event,
                    );
                  }
                }}
              >
                {content}
              </a>
            );
          }

          return (
            <button
              key={
                attachment.id
              }
              type="button"
              className={cn(
                'titech-chat__attachment',
                image &&
                  'titech-chat__attachment--image',
              )}
              onClick={() =>
                onAttachmentClick?.(
                  attachment,
                )
              }
              aria-label={`Open attachment ${attachment.name}`}
            >
              {content}
            </button>
          );
        },
      )}
    </div>
  );
}

AttachmentList.propTypes = {
  attachments:
    PropTypes.arrayOf(
      PropTypes.object,
    ).isRequired,

  onAttachmentClick:
    PropTypes.func,
};

/* ============================================================================
 * MESSAGE BUBBLE
 * ========================================================================== */

const MessageBubble = React.memo(
  function MessageBubble({
    message,
    currentUserId,
    showSenderName,
    showAvatar,
    showTimestamp,
    allowRetry,
    allowDelete,
    onRetry,
    onDelete,
    onMessageAction,
    locale,
  }) {
    const own =
      isOwnMessage(
        message,
        currentUserId,
      );

    const status =
      normalizeStatus(
        message,
      );

    const senderName =
      getSenderName(message);

    const text =
      getMessageText(message);

    const hasAttachments =
      message.attachments?.length >
      0;

    const canRetry =
      allowRetry &&
      status ===
        MESSAGE_STATUS.FAILED;

    const canDelete =
      allowDelete &&
      Boolean(
        message.deletable !==
          false,
      );

    return (
      <article
        className={cn(
          'titech-chat__message',
          own &&
            'titech-chat__message--own',
          !own &&
            'titech-chat__message--incoming',
          status ===
            MESSAGE_STATUS.FAILED &&
            'titech-chat__message--failed',
        )}
        data-message-id={
          message.id
        }
        data-testid={`titech-chat-message-${message.id}`}
      >
        {showAvatar && !own && (
          <div
            className="titech-chat__avatar"
            aria-hidden="true"
          >
            {getInitials(
              senderName,
            )}
          </div>
        )}

        <div className="titech-chat__message-column">
          {showSenderName && !own && (
            <div className="titech-chat__sender-name">
              {senderName}
            </div>
          )}

          <div className="titech-chat__bubble-row">
            <div className="titech-chat__bubble">
              {text && (
                <p className="titech-chat__message-text">
                  {text}
                </p>
              )}

              <AttachmentList
                attachments={
                  message.attachments ||
                  []
                }
              />

              <div className="titech-chat__message-meta">
                {showTimestamp &&
                  message.timestamp && (
                    <time
                      dateTime={
                        new Date(
                          message.timestamp,
                        ).toISOString()
                      }
                      title={
                        new Date(
                          message.timestamp,
                        ).toLocaleString(
                          locale ||
                            undefined,
                        )
                      }
                    >
                      {formatTime(
                        message.timestamp,
                        locale,
                      )}
                    </time>
                  )}

                {own && (
                  <MessageStatus
                    status={
                      status
                    }
                  />
                )}
              </div>
            </div>

            {(canRetry ||
              canDelete ||
              onMessageAction) && (
              <div className="titech-chat__message-actions">
                {canRetry && (
                  <button
                    type="button"
                    className="titech-chat__message-action"
                    onClick={() =>
                      onRetry?.(
                        message,
                      )
                    }
                    aria-label="Retry sending message"
                    title="Retry"
                  >
                    <RefreshIcon />
                  </button>
                )}

                {canDelete && (
                  <button
                    type="button"
                    className="titech-chat__message-action"
                    onClick={() =>
                      onDelete?.(
                        message,
                      )
                    }
                    aria-label="Delete message"
                    title="Delete"
                  >
                    <MoreIcon />
                  </button>
                )}

                {onMessageAction && (
                  <button
                    type="button"
                    className="titech-chat__message-action"
                    onClick={() =>
                      onMessageAction(
                        message,
                      )
                    }
                    aria-label="Message actions"
                    title="More actions"
                  >
                    <MoreIcon />
                  </button>
                )}
              </div>
            )}
          </div>

          {canRetry && (
            <div
              className="titech-chat__message-error"
              role="status"
            >
              Failed to send.
              <button
                type="button"
                onClick={() =>
                  onRetry?.(
                    message,
                  )
                }
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </article>
    );
  },
);

MessageBubble.propTypes = {
  message:
    PropTypes.object.isRequired,

  currentUserId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  showSenderName:
    PropTypes.bool,

  showAvatar:
    PropTypes.bool,

  showTimestamp:
    PropTypes.bool,

  allowRetry:
    PropTypes.bool,

  allowDelete:
    PropTypes.bool,

  onRetry:
    PropTypes.func,

  onDelete:
    PropTypes.func,

  onMessageAction:
    PropTypes.func,

  locale:
    PropTypes.string,
};

/* ============================================================================
 * TYPING INDICATOR
 * ========================================================================== */

function TypingIndicator({
  typingUsers,
}) {
  if (
    !Array.isArray(
      typingUsers,
    ) ||
    typingUsers.length === 0
  ) {
    return null;
  }

  const names =
    typingUsers
      .map(
        (user) =>
          safeString(
            user?.name ??
              user?.displayName ??
              user,
          ),
      )
      .filter(Boolean);

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : 'Several people are typing';

  return (
    <div
      className="titech-chat__typing"
      role="status"
      aria-live="polite"
    >
      <span
        className="titech-chat__typing-dots"
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
      </span>

      <span>
        {label}
      </span>
    </div>
  );
}

TypingIndicator.propTypes = {
  typingUsers:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object,
      ]),
    ),
};

/* ============================================================================
 * EMPTY STATE
 * ========================================================================== */

function EmptyConversation({
  title,
  description,
}) {
  return (
    <div
      className="titech-chat__empty"
      role="status"
    >
      <div
        className="titech-chat__empty-icon"
        aria-hidden="true"
      >
        <IconBase size={32}>
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.4-.7L3 21l1.8-5.3A8.4 8.4 0 1 1 21 11.5Z" />
          <path d="M8 12h.01" />
          <path d="M12 12h.01" />
          <path d="M16 12h.01" />
        </IconBase>
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>
    </div>
  );
}

EmptyConversation.propTypes = {
  title:
    PropTypes.node,

  description:
    PropTypes.node,
};

/* ============================================================================
 * LOADING STATE
 * ========================================================================== */

function LoadingConversation({
  message,
}) {
  return (
    <div
      className="titech-chat__loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="titech-chat__spinner" />
      <span>
        {message}
      </span>
    </div>
  );
}

LoadingConversation.propTypes = {
  message:
    PropTypes.string,
};

/* ============================================================================
 * ERROR STATE
 * ========================================================================== */

function ConversationError({
  message,
  onRetry,
}) {
  return (
    <div
      className="titech-chat__error"
      role="alert"
    >
      <div className="titech-chat__error-icon">
        <AlertIcon />
      </div>

      <div>
        <strong>
          Unable to load conversation
        </strong>

        <p>
          {message}
        </p>

        {onRetry && (
          <button
            type="button"
            className="titech-chat__button titech-chat__button--secondary"
            onClick={onRetry}
          >
            <RefreshIcon />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

ConversationError.propTypes = {
  message:
    PropTypes.string,

  onRetry:
    PropTypes.func,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

const ConversationView = forwardRef(
  function ConversationView(
    {
      conversationId,
      title = DEFAULT_TITLE,
      subtitle,
      messages = [],
      loading = false,
      error = null,
      currentUserId,
      currentUser,
      typingUsers = [],
      online = true,
      disabled = false,

      onSendMessage,
      onRetryMessage,
      onDeleteMessage,
      onMessageAction,
      onRetryLoad,

      onLoadMore,
      hasMoreMessages = false,
      loadingMore = false,

      attachments = [],
      onAttachmentClick,

      showHeader = true,
      showSenderName = true,
      showAvatars = true,
      showTimestamps = true,
      showComposer = true,
      showAttachmentButton = true,
      showScrollToLatest = true,

      allowRetry = true,
      allowDelete = false,

      emptyTitle =
        DEFAULT_EMPTY_TITLE,
      emptyDescription =
        DEFAULT_EMPTY_DESCRIPTION,

      placeholder =
        DEFAULT_SEND_PLACEHOLDER,

      maxMessageLength =
        DEFAULT_MAX_MESSAGE_LENGTH,

      locale,

      className,

      headerActions,
      composerExtra,
      emptyState,
      footer,

      onConversationAction,
      onInputChange,
      onTypingStart,
      onTypingStop,

      autoFocus = false,
    },
    ref,
  ) {
    /* ========================================================================
     * STATE
     * ====================================================================== */

    const [
      inputValue,
      setInputValue,
    ] = useState('');

    const [
      internalSending,
      setInternalSending,
    ] = useState(false);

    const [
      showNewMessages,
      setShowNewMessages,
    ] = useState(false);

    const [
      userHasScrolled,
      setUserHasScrolled,
    ] = useState(false);

    const [
      attachmentInputKey,
      setAttachmentInputKey,
    ] = useState(0);

    /* ========================================================================
     * REFS
     * ====================================================================== */

    const scrollContainerRef =
      useRef(null);

    const composerRef =
      useRef(null);

    const mountedRef =
      useRef(true);

    const scrollTimerRef =
      useRef(null);

    const typingTimerRef =
      useRef(null);

    const previousMessageCountRef =
      useRef(messages.length);

    /* ========================================================================
     * DERIVED DATA
     * ====================================================================== */

    const normalizedMessages =
      useMemo(
        () =>
          normalizeMessages(
            messages,
          ),
        [messages],
      );

    const groupedMessages =
      useMemo(
        () =>
          groupMessagesByDate(
            normalizedMessages,
            locale,
          ),
        [
          normalizedMessages,
          locale,
        ],
      );

    const characterCount =
      inputValue.length;

    const remainingCharacters =
      maxMessageLength -
      characterCount;

    const hasInput =
      inputValue.trim().length >
      0;

    const sending =
      internalSending;

    const hasMessages =
      normalizedMessages.length >
      0;

    /* ========================================================================
     * LIFECYCLE
     * ====================================================================== */

    useEffect(
      () => {
        mountedRef.current = true;

        return () => {
          mountedRef.current = false;

          if (
            scrollTimerRef.current
          ) {
            window.clearTimeout(
              scrollTimerRef.current,
            );
          }

          if (
            typingTimerRef.current
          ) {
            window.clearTimeout(
              typingTimerRef.current,
            );
          }
        };
      },
      [],
    );

    /* ========================================================================
     * SCROLL HELPERS
     * ====================================================================== */

    const isNearBottom =
      useCallback(() => {
        const element =
          scrollContainerRef.current;

        if (!element) {
          return true;
        }

        const distance =
          element.scrollHeight -
          element.scrollTop -
          element.clientHeight;

        return (
          distance <=
          AUTO_SCROLL_THRESHOLD_PX
        );
      }, []);

    const scrollToLatest =
      useCallback(
        (
          behavior = 'smooth',
        ) => {
          const element =
            scrollContainerRef.current;

          if (!element) {
            return;
          }

          element.scrollTo({
            top:
              element.scrollHeight,
            behavior,
          });

          setShowNewMessages(
            false,
          );
          setUserHasScrolled(
            false,
          );
        },
        [],
      );

    useImperativeHandle(
      ref,
      () => ({
        scrollToLatest,

        focusComposer() {
          composerRef.current?.focus();
        },

        getConversationId() {
          return conversationId;
        },

        getMessageCount() {
          return normalizedMessages.length;
        },

        getInputValue() {
          return inputValue;
        },
      }),
      [
        conversationId,
        inputValue,
        normalizedMessages.length,
        scrollToLatest,
      ],
    );

    useEffect(
      () => {
        const currentCount =
          normalizedMessages.length;

        const previousCount =
          previousMessageCountRef.current;

        if (
          currentCount >
            previousCount &&
          !isNearBottom()
        ) {
          setShowNewMessages(
            true,
          );
        } else if (
          isNearBottom()
        ) {
          setShowNewMessages(
            false,
          );
        }

        previousMessageCountRef.current =
          currentCount;
      },
      [
        normalizedMessages.length,
        isNearBottom,
      ],
    );

    useEffect(
      () => {
        if (
          normalizedMessages.length ===
            0 ||
          userHasScrolled
        ) {
          return;
        }

        if (scrollTimerRef.current) {
          window.clearTimeout(
            scrollTimerRef.current,
          );
        }

        scrollTimerRef.current =
          window.setTimeout(
            () => {
              if (
                isNearBottom()
              ) {
                scrollToLatest(
                  'auto',
                );
              }
            },
            SCROLL_DEBOUNCE_MS,
          );

        return () => {
          if (
            scrollTimerRef.current
          ) {
            window.clearTimeout(
              scrollTimerRef.current,
            );
          }
        };
      },
      [
        normalizedMessages.length,
        isNearBottom,
        scrollToLatest,
        userHasScrolled,
      ],
    );

    /* ========================================================================
     * INITIAL AUTO FOCUS
     * ====================================================================== */

    useEffect(
      () => {
        if (
          autoFocus &&
          !loading &&
          !disabled
        ) {
          const timer =
            window.setTimeout(
              () =>
                composerRef.current?.focus(),
              100,
            );

          return () =>
            window.clearTimeout(
              timer,
            );
        }

        return undefined;
      },
      [
        autoFocus,
        disabled,
        loading,
      ],
    );

    /* ========================================================================
     * INPUT
     * ====================================================================== */

    const handleInputChange =
      useCallback(
        (event) => {
          const nextValue =
            event.target.value.slice(
              0,
              maxMessageLength,
            );

          setInputValue(
            nextValue,
          );

          onInputChange?.(
            nextValue,
            event,
          );

          if (
            nextValue.trim()
          ) {
            onTypingStart?.();

            if (
              typingTimerRef.current
            ) {
              window.clearTimeout(
                typingTimerRef.current,
              );
            }

            typingTimerRef.current =
              window.setTimeout(
                () => {
                  onTypingStop?.();
                },
                1500,
              );
          } else {
            onTypingStop?.();
          }
        },
        [
          maxMessageLength,
          onInputChange,
          onTypingStart,
          onTypingStop,
        ],
      );

    /* ========================================================================
     * SEND
     * ====================================================================== */

    const handleSend =
      useCallback(
        async (
          event,
        ) => {
          event?.preventDefault();

          const text =
            inputValue.trim();

          if (
            disabled ||
            sending ||
            !text ||
            remainingCharacters <
              0
          ) {
            return;
          }

          if (
            typeof onSendMessage !==
            'function'
          ) {
            return;
          }

          setInternalSending(
            true,
          );

          onTypingStop?.();

          try {
            await onSendMessage({
              conversationId,
              text,
              attachments,
            });

            if (
              mountedRef.current
            ) {
              setInputValue(
                '',
              );

              setAttachmentInputKey(
                (value) =>
                  value + 1,
              );

              window.setTimeout(
                () => {
                  if (
                    mountedRef.current
                  ) {
                    scrollToLatest();
                  }
                },
                0,
              );
            }
          } catch {
            // Parent owns the authoritative error state.
            // The failed message may be represented through
            // the messages prop and retried there.
          } finally {
            if (
              mountedRef.current
            ) {
              setInternalSending(
                false,
              );
            }
          }
        },
        [
          attachments,
          conversationId,
          disabled,
          inputValue,
          onSendMessage,
          onTypingStop,
          remainingCharacters,
          scrollToLatest,
          sending,
        ],
      );

    /* ========================================================================
     * KEYBOARD HANDLING
     * ====================================================================== */

    const handleComposerKeyDown =
      useCallback(
        (event) => {
          if (
            event.key !==
            'Enter'
          ) {
            return;
          }

          if (
            event.shiftKey ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          ) {
            return;
          }

          event.preventDefault();

          handleSend(event);
        },
        [handleSend],
      );

    /* ========================================================================
     * SCROLL EVENT
     * ====================================================================== */

    const handleScroll =
      useCallback(() => {
        const nearBottom =
          isNearBottom();

        setUserHasScrolled(
          !nearBottom,
        );

        if (nearBottom) {
          setShowNewMessages(
            false,
          );
        }

        if (
          scrollContainerRef.current
            ?.scrollTop === 0 &&
          hasMoreMessages &&
          !loadingMore &&
          typeof onLoadMore ===
            'function'
        ) {
          onLoadMore();
        }
      }, [
        hasMoreMessages,
        isNearBottom,
        loadingMore,
        onLoadMore,
      ]);

    /* ========================================================================
     * ATTACHMENT INPUT
     * ====================================================================== */

    const handleAttachmentChange =
      useCallback(
        (event) => {
          const files =
            Array.from(
              event.target.files ||
                [],
            );

          if (
            !files.length
          ) {
            return;
          }

          onAttachmentClick?.(
            files,
          );

          setAttachmentInputKey(
            (value) =>
              value + 1,
          );
        },
        [onAttachmentClick],
      );

    /* ========================================================================
     * RENDER
     * ====================================================================== */

    return (
      <section
        className={cn(
          'titech-chat',
          className,
        )}
        data-component={
          COMPONENT_NAME
        }
        data-conversation-id={
          conversationId
        }
        aria-label={`${title} conversation`}
      >
        {/* ====================================================================
            HEADER
            ================================================================== */}

        {showHeader && (
          <header className="titech-chat__header">
            <div className="titech-chat__header-main">
              <div
                className="titech-chat__conversation-avatar"
                aria-hidden="true"
              >
                {getInitials(
                  currentUser?.tenantName ||
                    title,
                )}
              </div>

              <div className="titech-chat__header-copy">
                <h1 className="titech-chat__title">
                  {title}
                </h1>

                {subtitle && (
                  <p className="titech-chat__subtitle">
                    {subtitle}
                  </p>
                )}

                <div
                  className={cn(
                    'titech-chat__connection',
                    online
                      ? 'titech-chat__connection--online'
                      : 'titech-chat__connection--offline',
                  )}
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="titech-chat__connection-dot"
                    aria-hidden="true"
                  />

                  {online
                    ? 'Connected'
                    : 'Offline'}
                </div>
              </div>
            </div>

            <div className="titech-chat__header-actions">
              {headerActions}

              {onConversationAction && (
                <button
                  type="button"
                  className="titech-chat__icon-button"
                  onClick={() =>
                    onConversationAction()
                  }
                  aria-label="Conversation actions"
                  title="Conversation actions"
                >
                  <MoreIcon />
                </button>
              )}
            </div>
          </header>
        )}

        {/* ====================================================================
            ERROR
            ================================================================== */}

        {error && (
          <ConversationError
            message={
              typeof error ===
              'string'
                ? error
                : error?.message ||
                  DEFAULT_ERROR_MESSAGE
            }
            onRetry={
              onRetryLoad
            }
          />
        )}

        {/* ====================================================================
            MESSAGE LIST
            ================================================================== */}

        <div className="titech-chat__body">
          <div
            ref={
              scrollContainerRef
            }
            className="titech-chat__messages"
            onScroll={
              handleScroll
            }
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Conversation messages"
            tabIndex={0}
          >
            {loading &&
              !hasMessages && (
                <LoadingConversation
                  message={
                    DEFAULT_LOADING_MESSAGE
                  }
                />
              )}

            {loadingMore && (
              <div
                className="titech-chat__loading-more"
                role="status"
              >
                <span className="titech-chat__spinner" />
                Loading older messages…
              </div>
            )}

            {!loading &&
              !error &&
              !hasMessages &&
              (emptyState || (
                <EmptyConversation
                  title={
                    emptyTitle
                  }
                  description={
                    emptyDescription
                  }
                />
              ))}

            {groupedMessages.map(
              (group) => (
                <div
                  key={
                    group.label
                  }
                  className="titech-chat__date-group"
                >
                  <div className="titech-chat__date-divider">
                    <span>
                      {
                        group.label
                      }
                    </span>
                  </div>

                  <div className="titech-chat__message-list">
                    {group.messages.map(
                      (
                        message,
                      ) => (
                        <MessageBubble
                          key={
                            message.id
                          }
                          message={
                            message
                          }
                          currentUserId={
                            currentUserId
                          }
                          showSenderName={
                            showSenderName
                          }
                          showAvatar={
                            showAvatars
                          }
                          showTimestamp={
                            showTimestamps
                          }
                          allowRetry={
                            allowRetry
                          }
                          allowDelete={
                            allowDelete
                          }
                          onRetry={
                            onRetryMessage
                          }
                          onDelete={
                            onDeleteMessage
                          }
                          onMessageAction={
                            onMessageAction
                          }
                          locale={
                            locale
                          }
                        />
                      ),
                    )}
                  </div>
                </div>
              ),
            )}

            <TypingIndicator
              typingUsers={
                typingUsers
              }
            />
          </div>

          {/* ==================================================================
              NEW MESSAGE INDICATOR
              ================================================================= */}

          {showScrollToLatest &&
            showNewMessages && (
              <button
                type="button"
                className="titech-chat__new-messages"
                onClick={() =>
                  scrollToLatest()
                }
                aria-label="Scroll to latest messages"
              >
                <ArrowDownIcon />
                New messages
              </button>
            )}
        </div>

        {/* ====================================================================
            COMPOSER
            ================================================================== */}

        {showComposer && (
          <footer className="titech-chat__composer-wrapper">
            {composerExtra}

            {attachments.length >
              0 && (
              <div
                className="titech-chat__composer-attachments"
                aria-label="Selected attachments"
              >
                {attachments.map(
                  (
                    attachment,
                  ) => (
                    <span
                      key={
                        attachment.id ||
                        attachment.name
                      }
                      className="titech-chat__selected-attachment"
                    >
                      <PaperclipIcon />

                      <span>
                        {safeString(
                          attachment.name,
                          'Attachment',
                        )}
                      </span>

                      {attachment.size && (
                        <small>
                          {formatFileSize(
                            attachment.size,
                          )}
                        </small>
                      )}
                    </span>
                  ),
                )}
              </div>
            )}

            <form
              className="titech-chat__composer"
              onSubmit={
                handleSend
              }
              aria-label="Send a message"
            >
              {showAttachmentButton && (
                <>
                  <input
                    key={
                      attachmentInputKey
                    }
                    id={`titech-chat-attachment-${conversationId || 'conversation'}`}
                    type="file"
                    className="titech-chat__file-input"
                    onChange={
                      handleAttachmentChange
                    }
                    multiple
                    tabIndex={-1}
                  />

                  <label
                    htmlFor={`titech-chat-attachment-${conversationId || 'conversation'}`}
                    className="titech-chat__composer-button"
                    aria-label="Attach files"
                    title="Attach files"
                  >
                    <PaperclipIcon />
                  </label>
                </>
              )}

              <textarea
                ref={
                  composerRef
                }
                className="titech-chat__textarea"
                value={
                  inputValue
                }
                onChange={
                  handleInputChange
                }
                onKeyDown={
                  handleComposerKeyDown
                }
                placeholder={
                  placeholder
                }
                disabled={
                  disabled ||
                  sending
                }
                maxLength={
                  maxMessageLength
                }
                rows={1}
                aria-label="Message"
                aria-describedby={`titech-chat-composer-help-${conversationId || 'conversation'}`}
              />

              <div className="titech-chat__composer-controls">
                <span
                  id={`titech-chat-composer-help-${conversationId || 'conversation'}`}
                  className={cn(
                    'titech-chat__character-count',
                    remainingCharacters <
                      100 &&
                      'titech-chat__character-count--warning',
                    remainingCharacters <
                      0 &&
                      'titech-chat__character-count--error',
                  )}
                  aria-live="polite"
                >
                  {remainingCharacters}{' '}
                  characters
                  remaining
                </span>

                <button
                  type="submit"
                  className="titech-chat__send-button"
                  disabled={
                    disabled ||
                    sending ||
                    !hasInput ||
                    remainingCharacters <
                      0
                  }
                  aria-label={
                    sending
                      ? 'Sending message'
                      : 'Send message'
                  }
                  title="Send message"
                >
                  {sending ? (
                    <span
                      className="titech-chat__spinner titech-chat__spinner--light"
                      aria-hidden="true"
                    />
                  ) : (
                    <SendIcon />
                  )}
                </button>
              </div>
            </form>

            <p className="titech-chat__composer-hint">
              Press Enter to send. Use
              Shift + Enter for a new
              line.
            </p>
          </footer>
        )}

        {footer && (
          <div className="titech-chat__footer">
            {footer}
          </div>
        )}
      </section>
    );
  },
);

/* ============================================================================
 * DISPLAY NAME
 * ========================================================================== */

ConversationView.displayName =
  'ConversationView';

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

ConversationView.propTypes = {
  conversationId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  title:
    PropTypes.node,

  subtitle:
    PropTypes.node,

  messages:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  currentUserId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  currentUser:
    PropTypes.object,

  typingUsers:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object,
      ]),
    ),

  online:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  onSendMessage:
    PropTypes.func,

  onRetryMessage:
    PropTypes.func,

  onDeleteMessage:
    PropTypes.func,

  onMessageAction:
    PropTypes.func,

  onRetryLoad:
    PropTypes.func,

  onLoadMore:
    PropTypes.func,

  hasMoreMessages:
    PropTypes.bool,

  loadingMore:
    PropTypes.bool,

  attachments:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  onAttachmentClick:
    PropTypes.func,

  showHeader:
    PropTypes.bool,

  showSenderName:
    PropTypes.bool,

  showAvatars:
    PropTypes.bool,

  showTimestamps:
    PropTypes.bool,

  showComposer:
    PropTypes.bool,

  showAttachmentButton:
    PropTypes.bool,

  showScrollToLatest:
    PropTypes.bool,

  allowRetry:
    PropTypes.bool,

  allowDelete:
    PropTypes.bool,

  emptyTitle:
    PropTypes.node,

  emptyDescription:
    PropTypes.node,

  placeholder:
    PropTypes.string,

  maxMessageLength:
    PropTypes.number,

  locale:
    PropTypes.string,

  className:
    PropTypes.string,

  headerActions:
    PropTypes.node,

  composerExtra:
    PropTypes.node,

  emptyState:
    PropTypes.node,

  footer:
    PropTypes.node,

  onConversationAction:
    PropTypes.func,

  onInputChange:
    PropTypes.func,

  onTypingStart:
    PropTypes.func,

  onTypingStop:
    PropTypes.func,

  autoFocus:
    PropTypes.bool,
};

export default ConversationView;