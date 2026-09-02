/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat Home
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/ChatHome.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Enterprise-grade landing/dashboard page for TITech Community Capital's
 *   communication and collaboration workspace.
 *
 * Architectural position:
 *   Presentation-layer component for TITechChat.
 *
 * Responsibilities:
 *   - Present the TITechChat workspace.
 *   - Provide clear entry points into conversations and communication areas.
 *   - Display tenant-safe communication summaries supplied by the parent layer.
 *   - Support announcements, support conversations and contextual threads.
 *   - Provide loading, error and empty states.
 *   - Support keyboard and screen-reader navigation.
 *   - Provide deterministic rendering suitable for production environments.
 *   - Avoid direct API, database, authentication or financial logic.
 *   - Avoid trusting client-supplied tenant identifiers for authorization.
 *   - Remain compatible with enterprise service/controller architecture.
 *
 * Non-responsibilities:
 *   - Authentication.
 *   - Authorization.
 *   - Tenant resolution.
 *   - Database access.
 *   - Message persistence.
 *   - Financial calculations.
 *   - Direct API requests.
 *   - Security enforcement.
 *
 * Security principle:
 *   Authorization MUST be enforced by the backend/service layer.
 *   Props supplied to this component are presentation data only.
 *
 * Branding:
 *   TITech Community Capital
 *   TITechChat
 *
 * ============================================================================
 */

'use strict';

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

import './ChatHome.css';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const COMPONENT_NAME = 'TITechChatHome';

const DEFAULT_LIMIT = 5;

const MAX_VISIBLE_ITEMS = 5;

const CHAT_DESTINATIONS = Object.freeze({
  MESSAGES: 'messages',
  ANNOUNCEMENTS: 'announcements',
  SUPPORT: 'support',
  LOAN_THREADS: 'loan-threads',
  SAVINGS_THREADS: 'savings-threads',
});

const QUICK_ACTIONS = Object.freeze([
  {
    id: 'messages',
    title: 'Messages',
    description:
      'View and continue your conversations.',
    icon: '💬',
    destination:
      CHAT_DESTINATIONS.MESSAGES,
    tone: 'primary',
  },

  {
    id: 'announcements',
    title: 'Announcements',
    description:
      'Stay informed about important community updates.',
    icon: '📢',
    destination:
      CHAT_DESTINATIONS.ANNOUNCEMENTS,
    tone: 'info',
  },

  {
    id: 'support',
    title: 'Support',
    description:
      'Get assistance with your TITech services.',
    icon: '🛟',
    destination:
      CHAT_DESTINATIONS.SUPPORT,
    tone: 'support',
  },

  {
    id: 'loan-threads',
    title: 'Loan Conversations',
    description:
      'Access conversations connected to eligible loan activity.',
    icon: '🏦',
    destination:
      CHAT_DESTINATIONS.LOAN_THREADS,
    tone: 'finance',
  },

  {
    id: 'savings-threads',
    title: 'Savings Conversations',
    description:
      'Review conversations related to savings and group activity.',
    icon: '💰',
    destination:
      CHAT_DESTINATIONS.SAVINGS_THREADS,
    tone: 'savings',
  },
]);

const DEFAULT_STATISTICS = Object.freeze({
  unreadMessages: 0,
  unreadAnnouncements: 0,
  openSupportThreads: 0,
  activeConversations: 0,
});

/* ============================================================================
 * UTILITY FUNCTIONS
 * ========================================================================== */

/**
 * Safely normalizes a value to a non-negative integer.
 *
 * Presentation only.
 * This is NOT a security or authorization boundary.
 */
function normalizeCount(value) {
  const numericValue = Number(value);

  if (
    !Number.isFinite(numericValue) ||
    numericValue < 0
  ) {
    return 0;
  }

  return Math.floor(numericValue);
}

/**
 * Safely converts a value into a displayable string.
 */
function normalizeText(
  value,
  fallback = '',
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const text = String(value).trim();

  return text || fallback;
}

/**
 * Formats a timestamp for the user's locale.
 *
 * Invalid timestamps intentionally fall back to the original display value
 * rather than throwing during rendering.
 */
function formatDateTime(
  value,
  fallback = '',
) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/**
 * Returns a safe initials representation for avatars.
 */
function getInitials(
  name,
  fallback = 'T',
) {
  const normalized =
    normalizeText(name);

  if (!normalized) {
    return fallback;
  }

  const parts =
    normalized
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 2)
      .toUpperCase();
  }

  return parts
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * Prevents excessively long preview content from producing uncontrolled
 * layout expansion.
 */
function truncatePreview(
  value,
  maxLength = 140,
) {
  const text =
    normalizeText(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(
    0,
    maxLength - 1,
  )}…`;
}

/* ============================================================================
 * SMALL PRESENTATIONAL COMPONENTS
 * ========================================================================== */

function StatusBadge({
  children,
  tone = 'neutral',
  ariaLabel,
}) {
  return (
    <span
      className={`titech-chat-status titech-chat-status--${tone}`}
      aria-label={ariaLabel}
    >
      {children}
    </span>
  );
}

StatusBadge.propTypes = {
  children:
    PropTypes.node.isRequired,

  tone:
    PropTypes.oneOf([
      'neutral',
      'success',
      'warning',
      'danger',
      'info',
    ]),

  ariaLabel:
    PropTypes.string,
};

function LoadingState() {
  return (
    <div
      className="titech-chat-state titech-chat-state--loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="titech-chat-loading-spinner"
        aria-hidden="true"
      />

      <div>
        <strong>
          Loading TITechChat…
        </strong>

        <p>
          Preparing your communication
          workspace.
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}) {
  return (
    <div
      className="titech-chat-state titech-chat-state--error"
      role="alert"
    >
      <div
        className="titech-chat-state__icon"
        aria-hidden="true"
      >
        !
      </div>

      <div className="titech-chat-state__content">
        <h2>
          TITechChat is temporarily
          unavailable
        </h2>

        <p>
          {normalizeText(
            message,
            'We could not load your communication workspace. Please try again.',
          )}
        </p>

        {typeof onRetry ===
          'function' && (
          <button
            type="button"
            className="titech-chat-button titech-chat-button--primary"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}) {
  return (
    <div className="titech-chat-empty">
      <div
        className="titech-chat-empty__icon"
        aria-hidden="true"
      >
        💬
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>

      {actionLabel &&
        typeof onAction ===
          'function' && (
          <button
            type="button"
            className="titech-chat-button titech-chat-button--secondary"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  actionLabel,
  onAction,
}) {
  return (
    <div className="titech-chat-section-header">
      <div>
        {eyebrow && (
          <div className="titech-chat-section-header__eyebrow">
            {eyebrow}
          </div>
        )}

        <h2>
          {title}
        </h2>

        {description && (
          <p>
            {description}
          </p>
        )}
      </div>

      {actionLabel &&
        typeof onAction ===
          'function' && (
        <button
          type="button"
          className="titech-chat-button titech-chat-button--ghost"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ============================================================================
 * QUICK ACTION CARD
 * ========================================================================== */

function QuickActionCard({
  action,
  count = 0,
  onAction,
}) {
  const handleClick =
    useCallback(() => {
      if (typeof onAction === 'function') {
        onAction(
          action.destination,
          action,
        );
      }
    }, [
      action,
      onAction,
    ]);

  const normalizedCount =
    normalizeCount(count);

  return (
    <button
      type="button"
      className={`titech-chat-action-card titech-chat-action-card--${action.tone}`}
      onClick={handleClick}
      aria-label={
        normalizedCount > 0
          ? `${action.title}: ${normalizedCount} unread or pending items`
          : action.title
      }
    >
      <span
        className="titech-chat-action-card__icon"
        aria-hidden="true"
      >
        {action.icon}
      </span>

      <span className="titech-chat-action-card__body">
        <span className="titech-chat-action-card__title">
          {action.title}
        </span>

        <span className="titech-chat-action-card__description">
          {action.description}
        </span>
      </span>

      {normalizedCount > 0 && (
        <span
          className="titech-chat-action-card__count"
          aria-label={`${normalizedCount} pending`}
        >
          {normalizedCount > 99
            ? '99+'
            : normalizedCount}
        </span>
      )}

      <span
        className="titech-chat-action-card__arrow"
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}

QuickActionCard.propTypes = {
  action:
    PropTypes.shape({
      id:
        PropTypes.string.isRequired,

      title:
        PropTypes.string.isRequired,

      description:
        PropTypes.string.isRequired,

      icon:
        PropTypes.string.isRequired,

      destination:
        PropTypes.string.isRequired,

      tone:
        PropTypes.string.isRequired,
    }).isRequired,

  count:
    PropTypes.number,

  onAction:
    PropTypes.func,
};

/* ============================================================================
 * CONVERSATION PREVIEW
 * ========================================================================== */

function ConversationPreview({
  conversation,
  onOpen,
}) {
  const handleOpen =
    useCallback(() => {
      if (typeof onOpen === 'function') {
        onOpen(conversation);
      }
    }, [
      conversation,
      onOpen,
    ]);

  const title =
    normalizeText(
      conversation?.title,
      'Conversation',
    );

  const participant =
    normalizeText(
      conversation?.participantName,
      'TITech Community',
    );

  const preview =
    truncatePreview(
      conversation?.lastMessage,
      140,
    );

  const unread =
    normalizeCount(
      conversation?.unreadCount,
    );

  const timestamp =
    formatDateTime(
      conversation?.updatedAt,
      normalizeText(
        conversation?.updatedAtLabel,
        '',
      ),
    );

  return (
    <button
      type="button"
      className="titech-chat-conversation"
      onClick={handleOpen}
      aria-label={`Open conversation: ${title}`}
    >
      <span
        className="titech-chat-conversation__avatar"
        aria-hidden="true"
      >
        {getInitials(
          participant,
        )}
      </span>

      <span className="titech-chat-conversation__content">
        <span className="titech-chat-conversation__topline">
          <strong>
            {title}
          </strong>

          {timestamp && (
            <time
              dateTime={
                conversation?.updatedAt ||
                undefined
              }
            >
              {timestamp}
            </time>
          )}
        </span>

        <span className="titech-chat-conversation__participant">
          {participant}
        </span>

        {preview && (
          <span className="titech-chat-conversation__preview">
            {preview}
          </span>
        )}
      </span>

      {unread > 0 && (
        <StatusBadge
          tone="info"
          ariaLabel={`${unread} unread messages`}
        >
          {unread > 99
            ? '99+'
            : unread}
        </StatusBadge>
      )}

      <span
        className="titech-chat-conversation__arrow"
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}

ConversationPreview.propTypes = {
  conversation:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      title:
        PropTypes.string,

      participantName:
        PropTypes.string,

      lastMessage:
        PropTypes.string,

      unreadCount:
        PropTypes.number,

      updatedAt:
        PropTypes.string,

      updatedAtLabel:
        PropTypes.string,
    }).isRequired,

  onOpen:
    PropTypes.func,
};

/* ============================================================================
 * ANNOUNCEMENT PREVIEW
 * ========================================================================== */

function AnnouncementPreview({
  announcement,
  onOpen,
}) {
  const handleOpen =
    useCallback(() => {
      if (typeof onOpen === 'function') {
        onOpen(announcement);
      }
    }, [
      announcement,
      onOpen,
    ]);

  const title =
    normalizeText(
      announcement?.title,
      'Announcement',
    );

  const preview =
    truncatePreview(
      announcement?.summary ||
        announcement?.body,
      180,
    );

  const publishedAt =
    formatDateTime(
      announcement?.publishedAt,
      normalizeText(
        announcement?.publishedAtLabel,
        '',
      ),
    );

  const priority =
    normalizeText(
      announcement?.priority,
      'normal',
    ).toLowerCase();

  return (
    <button
      type="button"
      className="titech-chat-announcement"
      onClick={handleOpen}
      aria-label={`Open announcement: ${title}`}
    >
      <span
        className="titech-chat-announcement__icon"
        aria-hidden="true"
      >
        📢
      </span>

      <span className="titech-chat-announcement__content">
        <span className="titech-chat-announcement__topline">
          <strong>
            {title}
          </strong>

          {priority === 'urgent' && (
            <StatusBadge tone="danger">
              Urgent
            </StatusBadge>
          )}
        </span>

        {preview && (
          <span className="titech-chat-announcement__summary">
            {preview}
          </span>
        )}

        {publishedAt && (
          <time
            dateTime={
              announcement?.publishedAt ||
              undefined
            }
          >
            {publishedAt}
          </time>
        )}
      </span>

      <span
        className="titech-chat-announcement__arrow"
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}

AnnouncementPreview.propTypes = {
  announcement:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      title:
        PropTypes.string,

      summary:
        PropTypes.string,

      body:
        PropTypes.string,

      priority:
        PropTypes.string,

      publishedAt:
        PropTypes.string,

      publishedAtLabel:
        PropTypes.string,
    }).isRequired,

  onOpen:
    PropTypes.func,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

function ChatHome({
  user,
  statistics = DEFAULT_STATISTICS,
  conversations = [],
  announcements = [],
  isLoading = false,
  error = null,
  onRetry,
  onNavigate,
  onOpenConversation,
  onOpenAnnouncement,
  className = '',
  showQuickActions = true,
  showConversations = true,
  showAnnouncements = true,
  maxItems = DEFAULT_LIMIT,
}) {
  const pageRef =
    useRef(null);

  /* ==========================================================================
   * EFFECTS
   * ======================================================================== */

  useEffect(() => {
    if (pageRef.current) {
      pageRef.current.focus({
        preventScroll: true,
      });
    }
  }, []);

  /* ==========================================================================
   * DERIVED DATA
   * ======================================================================== */

  const displayName =
    useMemo(
      () =>
        normalizeText(
          user?.displayName ||
            user?.name ||
            user?.fullName,
          'Member',
        ),
      [user],
    );

  const firstName =
    useMemo(
      () =>
        normalizeText(
          displayName.split(
            /\s+/,
          )[0],
          'Member',
        ),
      [displayName],
    );

  const normalizedStatistics =
    useMemo(
      () => ({
        unreadMessages:
          normalizeCount(
            statistics?.unreadMessages,
          ),

        unreadAnnouncements:
          normalizeCount(
            statistics?.unreadAnnouncements,
          ),

        openSupportThreads:
          normalizeCount(
            statistics?.openSupportThreads,
          ),

        activeConversations:
          normalizeCount(
            statistics?.activeConversations,
          ),
      }),
      [statistics],
    );

  const visibleConversations =
    useMemo(
      () =>
        Array.isArray(
          conversations,
        )
          ? conversations
              .filter(Boolean)
              .slice(
                0,
                Math.min(
                  MAX_VISIBLE_ITEMS,
                  normalizeCount(
                    maxItems,
                  ) ||
                    DEFAULT_LIMIT,
                ),
              )
          : [],
      [
        conversations,
        maxItems,
      ],
    );

  const visibleAnnouncements =
    useMemo(
      () =>
        Array.isArray(
          announcements,
        )
          ? announcements
              .filter(Boolean)
              .slice(
                0,
                Math.min(
                  MAX_VISIBLE_ITEMS,
                  normalizeCount(
                    maxItems,
                  ) ||
                    DEFAULT_LIMIT,
                ),
              )
          : [],
      [
        announcements,
        maxItems,
      ],
    );

  const totalAttentionItems =
    useMemo(
      () =>
        normalizedStatistics.unreadMessages +
        normalizedStatistics.unreadAnnouncements +
        normalizedStatistics.openSupportThreads,
      [normalizedStatistics],
    );

  /* ==========================================================================
   * NAVIGATION
   * ======================================================================== */

  const handleNavigate =
    useCallback(
      (destination, payload) => {
        if (
          typeof onNavigate ===
          'function'
        ) {
          onNavigate(
            destination,
            payload,
          );
        }
      },
      [onNavigate],
    );

  const handleViewMessages =
    useCallback(() => {
      handleNavigate(
        CHAT_DESTINATIONS.MESSAGES,
      );
    }, [handleNavigate]);

  const handleViewAnnouncements =
    useCallback(() => {
      handleNavigate(
        CHAT_DESTINATIONS.ANNOUNCEMENTS,
      );
    }, [handleNavigate]);

  const handleViewSupport =
    useCallback(() => {
      handleNavigate(
        CHAT_DESTINATIONS.SUPPORT,
      );
    }, [handleNavigate]);

  /* ==========================================================================
   * RENDER — LOADING
   * ======================================================================== */

  if (isLoading) {
    return (
      <main
        ref={pageRef}
        tabIndex={-1}
        className={`titech-chat-home ${className}`.trim()}
        aria-labelledby="titech-chat-home-title"
      >
        <LoadingState />
      </main>
    );
  }

  /* ==========================================================================
   * RENDER — ERROR
   * ======================================================================== */

  if (error) {
    return (
      <main
        ref={pageRef}
        tabIndex={-1}
        className={`titech-chat-home ${className}`.trim()}
        aria-labelledby="titech-chat-home-error-title"
      >
        <ErrorState
          message={
            typeof error ===
            'string'
              ? error
              : error?.message
          }
          onRetry={onRetry}
        />
      </main>
    );
  }

  /* ==========================================================================
   * RENDER — MAIN
   * ======================================================================== */

  return (
    <main
      ref={pageRef}
      tabIndex={-1}
      className={`titech-chat-home ${className}`.trim()}
      aria-labelledby="titech-chat-home-title"
    >
      {/* ======================================================================
          HERO
          ==================================================================== */}

      <header className="titech-chat-home__hero">
        <div className="titech-chat-home__hero-content">
          <div className="titech-chat-home__eyebrow">
            TITech Community Capital
          </div>

          <h1
            id="titech-chat-home-title"
            className="titech-chat-home__title"
          >
            Welcome to TITechChat,
            {` ${firstName}`}
          </h1>

          <p className="titech-chat-home__description">
            Your secure communication
            workspace for community,
            organization and TITech
            service conversations.
          </p>

          {totalAttentionItems >
            0 && (
            <div
              className="titech-chat-home__attention"
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden="true"
              >
                ●
              </span>

              <span>
                You have{' '}
                <strong>
                  {totalAttentionItems}
                </strong>{' '}
                item
                {totalAttentionItems ===
                1
                  ? ''
                  : 's'} requiring
                attention.
              </span>
            </div>
          )}
        </div>

        <div
          className="titech-chat-home__hero-mark"
          aria-hidden="true"
        >
          <span>💬</span>
        </div>
      </header>

      {/* ======================================================================
          SUMMARY
          ==================================================================== */}

      <section
        className="titech-chat-home__summary"
        aria-labelledby="titech-chat-summary-title"
      >
        <div className="titech-chat-visually-hidden">
          <h2 id="titech-chat-summary-title">
            Communication summary
          </h2>
        </div>

        <article className="titech-chat-stat">
          <span
            className="titech-chat-stat__icon"
            aria-hidden="true"
          >
            💬
          </span>

          <div>
            <span className="titech-chat-stat__value">
              {
                normalizedStatistics.activeConversations
              }
            </span>

            <span className="titech-chat-stat__label">
              Active conversations
            </span>
          </div>
        </article>

        <article className="titech-chat-stat">
          <span
            className="titech-chat-stat__icon"
            aria-hidden="true"
          >
            ✉️
          </span>

          <div>
            <span className="titech-chat-stat__value">
              {
                normalizedStatistics.unreadMessages
              }
            </span>

            <span className="titech-chat-stat__label">
              Unread messages
            </span>
          </div>
        </article>

        <article className="titech-chat-stat">
          <span
            className="titech-chat-stat__icon"
            aria-hidden="true"
          >
            📢
          </span>

          <div>
            <span className="titech-chat-stat__value">
              {
                normalizedStatistics.unreadAnnouncements
              }
            </span>

            <span className="titech-chat-stat__label">
              New announcements
            </span>
          </div>
        </article>

        <article className="titech-chat-stat">
          <span
            className="titech-chat-stat__icon"
            aria-hidden="true"
          >
            🛟
          </span>

          <div>
            <span className="titech-chat-stat__value">
              {
                normalizedStatistics.openSupportThreads
              }
            </span>

            <span className="titech-chat-stat__label">
              Support threads
            </span>
          </div>
        </article>
      </section>

      {/* ======================================================================
          QUICK ACTIONS
          ==================================================================== */}

      {showQuickActions && (
        <section
          className="titech-chat-home__section"
          aria-labelledby="titech-chat-actions-title"
        >
          <SectionHeader
            eyebrow="Workspace"
            title="What would you like to do?"
            description="Access the communication area you need."
          />

          <div
            id="titech-chat-actions-title"
            className="titech-chat-action-grid"
          >
            {QUICK_ACTIONS.map(
              (action) => {
                let count = 0;

                switch (
                  action.destination
                ) {
                  case CHAT_DESTINATIONS.MESSAGES:
                    count =
                      normalizedStatistics.unreadMessages;
                    break;

                  case CHAT_DESTINATIONS.ANNOUNCEMENTS:
                    count =
                      normalizedStatistics.unreadAnnouncements;
                    break;

                  case CHAT_DESTINATIONS.SUPPORT:
                    count =
                      normalizedStatistics.openSupportThreads;
                    break;

                  default:
                    count = 0;
                }

                return (
                  <QuickActionCard
                    key={
                      action.id
                    }
                    action={
                      action
                    }
                    count={
                      count
                    }
                    onAction={
                      handleNavigate
                    }
                  />
                );
              },
            )}
          </div>
        </section>
      )}

      {/* ======================================================================
          RECENT CONVERSATIONS
          ==================================================================== */}

      {showConversations && (
        <section
          className="titech-chat-home__section"
          aria-labelledby="titech-chat-conversations-title"
        >
          <SectionHeader
            eyebrow="Communication"
            title="Recent conversations"
            description="Continue where you left off."
            actionLabel={
              visibleConversations.length >
              0
                ? 'View all'
                : undefined
            }
            onAction={
              handleViewMessages
            }
          />

          <div
            id="titech-chat-conversations-title"
            className="titech-chat-list"
          >
            {visibleConversations.length >
            0 ? (
              visibleConversations.map(
                (
                  conversation,
                  index,
                ) => (
                  <ConversationPreview
                    key={
                      conversation.id ??
                      `conversation-${index}`
                    }
                    conversation={
                      conversation
                    }
                    onOpen={
                      onOpenConversation
                    }
                  />
                ),
              )
            ) : (
              <EmptyState
                title="No conversations yet"
                description="Your recent conversations will appear here when available."
                actionLabel="Open messages"
                onAction={
                  handleViewMessages
                }
              />
            )}
          </div>
        </section>
      )}

      {/* ======================================================================
          ANNOUNCEMENTS
          ==================================================================== */}

      {showAnnouncements && (
        <section
          className="titech-chat-home__section"
          aria-labelledby="titech-chat-announcements-title"
        >
          <SectionHeader
            eyebrow="Updates"
            title="Latest announcements"
            description="Important information from TITech Community Capital and your authorized community or organization."
            actionLabel={
              visibleAnnouncements.length >
              0
                ? 'View all'
                : undefined
            }
            onAction={
              handleViewAnnouncements
            }
          />

          <div
            id="titech-chat-announcements-title"
            className="titech-chat-list"
          >
            {visibleAnnouncements.length >
            0 ? (
              visibleAnnouncements.map(
                (
                  announcement,
                  index,
                ) => (
                  <AnnouncementPreview
                    key={
                      announcement.id ??
                      `announcement-${index}`
                    }
                    announcement={
                      announcement
                    }
                    onOpen={
                      onOpenAnnouncement
                    }
                  />
                ),
              )
            ) : (
              <EmptyState
                title="No new announcements"
                description="Important updates and notices will appear here."
              />
            )}
          </div>
        </section>
      )}

      {/* ======================================================================
          SECURITY / TRUST NOTICE
          ==================================================================== */}

      <aside
        className="titech-chat-home__security-notice"
        aria-label="TITechChat security information"
      >
        <span
          className="titech-chat-home__security-icon"
          aria-hidden="true"
        >
          🔒
        </span>

        <div>
          <strong>
            Protect your account
          </strong>

          <p>
            Never share passwords, one-time
            verification codes, PINs, recovery
            codes or other authentication
            credentials through chat. TITech
            staff will not ask you to disclose
            your confidential authentication
            credentials.
          </p>
        </div>
      </aside>

      {/* ======================================================================
          FOOTER
          ==================================================================== */}

      <footer className="titech-chat-home__footer">
        <p>
          <strong>
            TITechChat
          </strong>{' '}
          · Secure communication for the
          TITech Community Capital platform.
        </p>

        <p>
          Messages and communication activity
          remain subject to applicable TITech
          policies, permissions, retention
          requirements and organizational
          controls.
        </p>
      </footer>
    </main>
  );
}

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

ChatHome.propTypes = {
  user:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      displayName:
        PropTypes.string,

      name:
        PropTypes.string,

      fullName:
        PropTypes.string,
    }),

  statistics:
    PropTypes.shape({
      unreadMessages:
        PropTypes.number,

      unreadAnnouncements:
        PropTypes.number,

      openSupportThreads:
        PropTypes.number,

      activeConversations:
        PropTypes.number,
    }),

  conversations:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        title:
          PropTypes.string,

        participantName:
          PropTypes.string,

        lastMessage:
          PropTypes.string,

        unreadCount:
          PropTypes.number,

        updatedAt:
          PropTypes.string,

        updatedAtLabel:
          PropTypes.string,
      }),
    ),

  announcements:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        title:
          PropTypes.string,

        summary:
          PropTypes.string,

        body:
          PropTypes.string,

        priority:
          PropTypes.string,

        publishedAt:
          PropTypes.string,

        publishedAtLabel:
          PropTypes.string,
      }),
    ),

  isLoading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.shape({
        message:
          PropTypes.string,
      }),
    ]),

  onRetry:
    PropTypes.func,

  onNavigate:
    PropTypes.func,

  onOpenConversation:
    PropTypes.func,

  onOpenAnnouncement:
    PropTypes.func,

  className:
    PropTypes.string,

  showQuickActions:
    PropTypes.bool,

  showConversations:
    PropTypes.bool,

  showAnnouncements:
    PropTypes.bool,

  maxItems:
    PropTypes.number,
};

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

export default memo(ChatHome);