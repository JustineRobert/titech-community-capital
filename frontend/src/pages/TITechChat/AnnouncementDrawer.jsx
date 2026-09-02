/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Drawer
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/AnnouncementDrawer.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Production-grade announcement/notification drawer for TITech Community
 *   Capital's TITechChat experience.
 *
 * Responsibilities:
 *   - Display tenant/user announcements.
 *   - Support unread/read state presentation.
 *   - Support announcement selection and dismissal.
 *   - Support mark-all-as-read workflows.
 *   - Support refresh/retry workflows.
 *   - Support announcement deep links/actions.
 *   - Provide accessible dialog/drawer semantics.
 *   - Trap keyboard focus while open.
 *   - Restore focus to the triggering element after close.
 *   - Prevent accidental background scrolling.
 *   - Support Escape-to-close.
 *   - Support responsive/mobile presentation.
 *   - Provide loading, empty and error states.
 *   - Provide safe relative/absolute date presentation.
 *   - Avoid coupling presentation to backend implementation details.
 *
 * Architectural boundary:
 *   This component MUST NOT:
 *   - perform direct API calls;
 *   - authorize users;
 *   - determine tenant access;
 *   - mutate financial records;
 *   - determine financial eligibility;
 *   - make compliance decisions;
 *   - trust client-provided authorization information.
 *
 *   Data loading and mutations should be delegated to the parent/container,
 *   Redux slice, selector layer, or announcement service.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

import './AnnouncementDrawer.css';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const COMPONENT_NAME =
  'TITechAnnouncementDrawer';

const DEFAULT_TITLE =
  'Announcements';

const DEFAULT_EMPTY_TITLE =
  'You’re all caught up';

const DEFAULT_EMPTY_DESCRIPTION =
  'There are no announcements to display right now.';

const DEFAULT_ERROR_TITLE =
  'Unable to load announcements';

const DEFAULT_ERROR_DESCRIPTION =
  'We could not load the latest announcements. Please try again.';

const DEFAULT_LOADING_COUNT =
  4;

const MAX_VISIBLE_ANNOUNCEMENTS =
  100;

const ANNOUNCEMENT_TYPES = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  DANGER: 'danger',
  SYSTEM: 'system',
});

const PRIORITY_ORDER = Object.freeze({
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
});

const DATE_FORMATTER_OPTIONS = Object.freeze({
  dateStyle: 'medium',
  timeStyle: 'short',
});

/* ============================================================================
 * UTILITY FUNCTIONS
 * ========================================================================== */

function cn(...classes) {
  return classes
    .filter(Boolean)
    .join(' ');
}

function safeString(
  value,
  fallback = '',
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    const normalized =
      String(value).trim();

    return normalized || fallback;
  } catch {
    return fallback;
  }
}

function normalizeId(value) {
  return safeString(value);
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isUnread(announcement) {
  if (!isObject(announcement)) {
    return false;
  }

  return (
    announcement.unread === true ||
    announcement.isUnread === true ||
    announcement.read === false ||
    announcement.isRead === false
  );
}

function isDismissed(announcement) {
  if (!isObject(announcement)) {
    return false;
  }

  return (
    announcement.dismissed === true ||
    announcement.isDismissed === true
  );
}

function getAnnouncementId(
  announcement,
) {
  if (!isObject(announcement)) {
    return '';
  }

  return normalizeId(
    announcement.id ||
      announcement._id ||
      announcement.announcementId ||
      announcement.uuid,
  );
}

function getAnnouncementTitle(
  announcement,
) {
  if (!isObject(announcement)) {
    return 'Announcement';
  }

  return safeString(
    announcement.title ||
      announcement.subject ||
      announcement.name,
    'Announcement',
  );
}

function getAnnouncementMessage(
  announcement,
) {
  if (!isObject(announcement)) {
    return '';
  }

  return safeString(
    announcement.message ||
      announcement.body ||
      announcement.description ||
      announcement.content,
  );
}

function getAnnouncementType(
  announcement,
) {
  const rawType = safeString(
    announcement?.type ||
      announcement?.severity ||
      announcement?.category,
    ANNOUNCEMENT_TYPES.INFO,
  ).toLowerCase();

  if (
    Object.values(
      ANNOUNCEMENT_TYPES,
    ).includes(rawType)
  ) {
    return rawType;
  }

  return ANNOUNCEMENT_TYPES.INFO;
}

function getPriority(
  announcement,
) {
  const priority =
    safeString(
      announcement?.priority,
      'normal',
    ).toLowerCase();

  return Object.prototype.hasOwnProperty.call(
    PRIORITY_ORDER,
    priority,
  )
    ? priority
    : 'normal';
}

function getTimestamp(
  announcement,
) {
  if (!isObject(announcement)) {
    return null;
  }

  return (
    announcement.publishedAt ||
    announcement.createdAt ||
    announcement.updatedAt ||
    announcement.timestamp ||
    null
  );
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return date;
}

function formatDate(
  value,
  locale,
) {
  const date =
    parseDate(value);

  if (!date) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(
      locale || undefined,
      DATE_FORMATTER_OPTIONS,
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function getRelativeTime(
  value,
  locale,
) {
  const date =
    parseDate(value);

  if (!date) {
    return '';
  }

  const difference =
    Date.now() - date.getTime();

  const absoluteDifference =
    Math.abs(difference);

  const minute =
    60 * 1000;

  const hour =
    60 * minute;

  const day =
    24 * hour;

  try {
    const formatter =
      new Intl.RelativeTimeFormat(
        locale || undefined,
        {
          numeric: 'auto',
        },
      );

    if (
      absoluteDifference <
      minute
    ) {
      return formatter.format(
        0,
        'second',
      );
    }

    if (
      absoluteDifference <
      hour
    ) {
      return formatter.format(
        Math.round(
          difference / minute,
        ),
        'minute',
      );
    }

    if (
      absoluteDifference <
      day
    ) {
      return formatter.format(
        Math.round(
          difference / hour,
        ),
        'hour',
      );
    }

    return formatter.format(
      Math.round(
        difference / day,
      ),
      'day',
    );
  } catch {
    return formatDate(
      value,
      locale,
    );
  }
}

function sortAnnouncements(
  announcements,
) {
  return [
    ...announcements,
  ].sort((a, b) => {
    const unreadDifference =
      Number(isUnread(b)) -
      Number(isUnread(a));

    if (
      unreadDifference !== 0
    ) {
      return unreadDifference;
    }

    const priorityDifference =
      PRIORITY_ORDER[
        getPriority(a)
      ] -
      PRIORITY_ORDER[
        getPriority(b)
      ];

    if (
      priorityDifference !== 0
    ) {
      return priorityDifference;
    }

    const dateA =
      parseDate(
        getTimestamp(a),
      )?.getTime() || 0;

    const dateB =
      parseDate(
        getTimestamp(b),
      )?.getTime() || 0;

    return dateB - dateA;
  });
}

function normalizeAnnouncements(
  value,
) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    isObject(value) &&
    Array.isArray(value.data)
  ) {
    return value.data;
  }

  if (
    isObject(value) &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }

  if (
    isObject(value) &&
    Array.isArray(
      value.announcements,
    )
  ) {
    return value.announcements;
  }

  return [];
}

/* ============================================================================
 * ICONS
 * ========================================================================== */

function Icon({
  name,
  size = 20,
}) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ariaHidden: true,
    focusable: 'false',
    'aria-hidden': 'true',
  };

  switch (name) {
    case 'close':
      return (
        <svg {...commonProps}>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      );

    case 'bell':
      return (
        <svg {...commonProps}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
      );

    case 'check':
      return (
        <svg {...commonProps}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );

    case 'checkAll':
      return (
        <svg {...commonProps}>
          <path d="m3 12 4 4L17 6" />
          <path d="m9 12 4 4L21 8" />
        </svg>
      );

    case 'refresh':
      return (
        <svg {...commonProps}>
          <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
          <path d="M4 4v5h5" />
          <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
          <path d="M20 20v-5h-5" />
        </svg>
      );

    case 'arrow':
      return (
        <svg {...commonProps}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );

    case 'info':
      return (
        <svg {...commonProps}>
          <circle
            cx="12"
            cy="12"
            r="9"
          />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );

    case 'warning':
      return (
        <svg {...commonProps}>
          <path d="m12 3 9 17H3L12 3Z" />
          <path d="M12 9v4" />
          <path d="M12 16h.01" />
        </svg>
      );

    case 'success':
      return (
        <svg {...commonProps}>
          <circle
            cx="12"
            cy="12"
            r="9"
          />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      );

    case 'danger':
      return (
        <svg {...commonProps}>
          <circle
            cx="12"
            cy="12"
            r="9"
          />
          <path d="M12 8v5" />
          <path d="M12 16h.01" />
        </svg>
      );

    default:
      return (
        <Icon
          name="info"
          size={size}
        />
      );
  }
}

Icon.propTypes = {
  name:
    PropTypes.string.isRequired,

  size:
    PropTypes.number,
};

/* ============================================================================
 * STATUS ICON
 * ========================================================================== */

function AnnouncementTypeIcon({
  type,
}) {
  const icon =
    type === ANNOUNCEMENT_TYPES.SUCCESS
      ? 'success'
      : type === ANNOUNCEMENT_TYPES.WARNING
        ? 'warning'
        : type === ANNOUNCEMENT_TYPES.DANGER
          ? 'danger'
          : 'info';

  return (
    <span
      className={cn(
        'titech-announcement-drawer__type-icon',
        `is-${type}`,
      )}
      aria-hidden="true"
    >
      <Icon
        name={icon}
        size={18}
      />
    </span>
  );
}

AnnouncementTypeIcon.propTypes = {
  type:
    PropTypes.string.isRequired,
};

/* ============================================================================
 * SKELETON
 * ========================================================================== */

function AnnouncementSkeleton({
  index,
}) {
  return (
    <div
      className="titech-announcement-drawer__skeleton"
      aria-hidden="true"
      data-testid={`announcement-skeleton-${index}`}
    >
      <span className="titech-announcement-drawer__skeleton-icon" />

      <span className="titech-announcement-drawer__skeleton-content">
        <span className="titech-announcement-drawer__skeleton-title" />
        <span className="titech-announcement-drawer__skeleton-line" />
        <span className="titech-announcement-drawer__skeleton-line titech-announcement-drawer__skeleton-line--short" />
      </span>
    </div>
  );
}

AnnouncementSkeleton.propTypes = {
  index:
    PropTypes.number.isRequired,
};

/* ============================================================================
 * ANNOUNCEMENT ITEM
 * ========================================================================== */

function AnnouncementItem({
  announcement,
  locale,
  onSelect,
  onMarkRead,
  onDismiss,
  onAction,
  disabled,
}) {
  const id =
    getAnnouncementId(
      announcement,
    );

  const title =
    getAnnouncementTitle(
      announcement,
    );

  const message =
    getAnnouncementMessage(
      announcement,
    );

  const type =
    getAnnouncementType(
      announcement,
    );

  const unread =
    isUnread(announcement);

  const timestamp =
    getTimestamp(
      announcement,
    );

  const dateLabel =
    formatDate(
      timestamp,
      locale,
    );

  const relativeTime =
    getRelativeTime(
      timestamp,
      locale,
    );

  const actionLabel =
    safeString(
      announcement?.actionLabel ||
        announcement?.ctaLabel ||
        announcement?.buttonLabel,
      'View details',
    );

  const hasAction =
    typeof onAction ===
      'function' &&
    Boolean(
      announcement?.actionUrl ||
        announcement?.url ||
        announcement?.link ||
        announcement?.action ||
        announcement?.cta,
    );

  const handleSelect =
    useCallback(
      () => {
        if (
          typeof onSelect ===
          'function'
        ) {
          onSelect(
            announcement,
          );
        }
      },
      [
        announcement,
        onSelect,
      ],
    );

  const handleMarkRead =
    useCallback(
      (event) => {
        event.stopPropagation();

        if (
          typeof onMarkRead ===
          'function' &&
          id
        ) {
          onMarkRead(
            announcement,
          );
        }
      },
      [
        announcement,
        id,
        onMarkRead,
      ],
    );

  const handleDismiss =
    useCallback(
      (event) => {
        event.stopPropagation();

        if (
          typeof onDismiss ===
          'function' &&
          id
        ) {
          onDismiss(
            announcement,
          );
        }
      },
      [
        announcement,
        id,
        onDismiss,
      ],
    );

  const handleAction =
    useCallback(
      (event) => {
        event.stopPropagation();

        if (
          typeof onAction ===
          'function'
        ) {
          onAction(
            announcement,
          );
        }
      },
      [
        announcement,
        onAction,
      ],
    );

  return (
    <article
      className={cn(
        'titech-announcement-drawer__item',
        unread &&
          'is-unread',
        `is-${type}`,
      )}
      data-announcement-id={
        id || undefined
      }
      data-testid={
        id
          ? `announcement-${id}`
          : 'announcement-item'
      }
    >
      <button
        type="button"
        className="titech-announcement-drawer__item-main"
        onClick={
          handleSelect
        }
        disabled={disabled}
        aria-label={`Open announcement: ${title}`}
      >
        <AnnouncementTypeIcon
          type={type}
        />

        <span className="titech-announcement-drawer__item-content">
          <span className="titech-announcement-drawer__item-header">
            <span className="titech-announcement-drawer__item-title">
              {title}
            </span>

            {unread && (
              <span
                className="titech-announcement-drawer__unread-dot"
                aria-label="Unread"
              />
            )}
          </span>

          {message && (
            <span className="titech-announcement-drawer__item-message">
              {message}
            </span>
          )}

          {timestamp && (
            <time
              className="titech-announcement-drawer__item-time"
              dateTime={
                parseDate(
                  timestamp,
                )?.toISOString()
              }
              title={dateLabel}
            >
              {relativeTime ||
                dateLabel}
            </time>
          )}
        </span>
      </button>

      <div className="titech-announcement-drawer__item-actions">
        {hasAction && (
          <button
            type="button"
            className="titech-announcement-drawer__item-action"
            onClick={
              handleAction
            }
            disabled={disabled}
          >
            {actionLabel}
            <Icon
              name="arrow"
              size={15}
            />
          </button>
        )}

        {unread &&
          typeof onMarkRead ===
            'function' && (
            <button
              type="button"
              className="titech-announcement-drawer__icon-button"
              onClick={
                handleMarkRead
              }
              disabled={disabled}
              aria-label={`Mark "${title}" as read`}
              title="Mark as read"
            >
              <Icon
                name="check"
                size={17}
              />
            </button>
          )}

        {typeof onDismiss ===
          'function' && (
          <button
            type="button"
            className="titech-announcement-drawer__icon-button"
            onClick={
              handleDismiss
            }
            disabled={disabled}
            aria-label={`Dismiss "${title}"`}
            title="Dismiss"
          >
            <Icon
              name="close"
              size={16}
            />
          </button>
        )}
      </div>
    </article>
  );
}

AnnouncementItem.propTypes = {
  announcement:
    PropTypes.object.isRequired,

  locale:
    PropTypes.string,

  onSelect:
    PropTypes.func,

  onMarkRead:
    PropTypes.func,

  onDismiss:
    PropTypes.func,

  onAction:
    PropTypes.func,

  disabled:
    PropTypes.bool,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

export default function AnnouncementDrawer({
  open = false,

  announcements = [],

  unreadCount,

  loading = false,

  error = null,

  title = DEFAULT_TITLE,

  emptyTitle =
    DEFAULT_EMPTY_TITLE,

  emptyDescription =
    DEFAULT_EMPTY_DESCRIPTION,

  errorTitle =
    DEFAULT_ERROR_TITLE,

  errorDescription =
    DEFAULT_ERROR_DESCRIPTION,

  locale,

  maxVisible =
    MAX_VISIBLE_ANNOUNCEMENTS,

  showMarkAllRead = true,

  showRefresh = true,

  showDismiss = true,

  closeOnOverlayClick = true,

  closeOnEscape = true,

  lockBodyScroll = true,

  loadingCount =
    DEFAULT_LOADING_COUNT,

  disabled = false,

  onClose,

  onSelect,

  onMarkRead,

  onMarkAllRead,

  onDismiss,

  onRefresh,

  onAction,

  className,

  labelledBy,

  describedBy,

  initialFocusRef,

  restoreFocus = true,

  testId = 'titech-announcement-drawer',
}) {
  const titleId =
    useId();

  const descriptionId =
    useId();

  const drawerRef =
    useRef(null);

  const previousFocusedElement =
    useRef(null);

  const previousBodyOverflow =
    useRef('');

  const previousBodyPaddingRight =
    useRef('');

  const normalizedAnnouncements =
    useMemo(
      () =>
        sortAnnouncements(
          normalizeAnnouncements(
            announcements,
          ),
        )
          .filter(
            (announcement) =>
              !isDismissed(
                announcement,
              ),
          )
          .slice(
            0,
            Math.max(
              0,
              Number(
                maxVisible,
              ) ||
                MAX_VISIBLE_ANNOUNCEMENTS,
            ),
          ),
      [
        announcements,
        maxVisible,
      ],
    );

  const computedUnreadCount =
    useMemo(
      () =>
        normalizedAnnouncements.filter(
          isUnread,
        ).length,
      [normalizedAnnouncements],
    );

  const displayUnreadCount =
    Number.isFinite(
      Number(unreadCount),
    )
      ? Math.max(
          0,
          Number(unreadCount),
        )
      : computedUnreadCount;

  const dialogTitleId =
    safeString(
      labelledBy,
      titleId,
    );

  const dialogDescriptionId =
    safeString(
      describedBy,
      descriptionId,
    );

  /* ==========================================================================
   * CLOSE
   * ======================================================================== */

  const handleClose =
    useCallback(
      (reason = 'close') => {
        if (
          disabled
        ) {
          return;
        }

        if (
          typeof onClose ===
          'function'
        ) {
          onClose(
            reason,
          );
        }
      },
      [
        disabled,
        onClose,
      ],
    );

  /* ==========================================================================
   * OVERLAY
   * ======================================================================== */

  const handleOverlayClick =
    useCallback(
      (event) => {
        if (
          !closeOnOverlayClick ||
          disabled
        ) {
          return;
        }

        if (
          event.target ===
          event.currentTarget
        ) {
          handleClose(
            'overlay',
          );
        }
      },
      [
        closeOnOverlayClick,
        disabled,
        handleClose,
      ],
    );

  /* ==========================================================================
   * ESCAPE
   * ======================================================================== */

  useEffect(() => {
    if (
      !open ||
      !closeOnEscape
    ) {
      return undefined;
    }

    const handleKeyDown =
      (event) => {
        if (
          event.key ===
          'Escape'
        ) {
          event.preventDefault();

          handleClose(
            'escape',
          );
        }
      };

    document.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    open,
    closeOnEscape,
    handleClose,
  ]);

  /* ==========================================================================
   * BODY SCROLL LOCK
   * ======================================================================== */

  useEffect(() => {
    if (
      !open ||
      !lockBodyScroll
    ) {
      return undefined;
    }

    if (
      typeof document ===
      'undefined'
    ) {
      return undefined;
    }

    previousBodyOverflow.current =
      document.body.style.overflow;

    previousBodyPaddingRight.current =
      document.body.style
        .paddingRight;

    const scrollbarWidth =
      window.innerWidth -
      document.documentElement
        .clientWidth;

    document.body.style.overflow =
      'hidden';

    if (
      scrollbarWidth > 0
    ) {
      document.body.style.paddingRight =
        `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow =
        previousBodyOverflow.current;

      document.body.style.paddingRight =
        previousBodyPaddingRight.current;
    };
  }, [
    open,
    lockBodyScroll,
  ]);

  /* ==========================================================================
   * FOCUS MANAGEMENT
   * ======================================================================== */

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousFocusedElement.current =
      document.activeElement;

    const timer =
      window.setTimeout(
        () => {
          const focusTarget =
            initialFocusRef?.current ||
            drawerRef.current?.querySelector(
              '[data-autofocus="true"]',
            ) ||
            drawerRef.current?.querySelector(
              'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );

          focusTarget?.focus?.();
        },
        0,
      );

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [
    open,
    initialFocusRef,
  ]);

  useEffect(() => {
    if (
      open ||
      !restoreFocus
    ) {
      return undefined;
    }

    const element =
      previousFocusedElement.current;

    if (
      element &&
      typeof element.focus ===
        'function' &&
      document.contains(
        element,
      )
    ) {
      const timer =
        window.setTimeout(
          () => {
            element.focus();
          },
          0,
        );

      return () =>
        window.clearTimeout(
          timer,
        );
    }

    return undefined;
  }, [
    open,
    restoreFocus,
  ]);

  /* ==========================================================================
   * FOCUS TRAP
   * ======================================================================== */

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const drawer =
      drawerRef.current;

    if (!drawer) {
      return undefined;
    }

    const handleTab =
      (event) => {
        if (
          event.key !==
          'Tab'
        ) {
          return;
        }

        const focusable =
          Array.from(
            drawer.querySelectorAll(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter(
            (element) =>
              element.offsetParent !==
              null,
          );

        if (
          focusable.length ===
          0
        ) {
          event.preventDefault();

          drawer.focus();

          return;
        }

        const first =
          focusable[0];

        const last =
          focusable[
            focusable.length -
              1
          ];

        if (
          event.shiftKey &&
          document.activeElement ===
            first
        ) {
          event.preventDefault();

          last.focus();

          return;
        }

        if (
          !event.shiftKey &&
          document.activeElement ===
            last
        ) {
          event.preventDefault();

          first.focus();
        }
      };

    drawer.addEventListener(
      'keydown',
      handleTab,
    );

    return () => {
      drawer.removeEventListener(
        'keydown',
        handleTab,
      );
    };
  }, [open]);

  /* ==========================================================================
   * ACCESSIBILITY / INERT BACKGROUND
   * ======================================================================== */

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const appRoot =
      document.getElementById(
        'root',
      );

    if (
      !appRoot ||
      appRoot ===
        drawerRef.current
    ) {
      return undefined;
    }

    const previousAriaHidden =
      appRoot.getAttribute(
        'aria-hidden',
      );

    appRoot.setAttribute(
      'aria-hidden',
      'true',
    );

    return () => {
      if (
        previousAriaHidden ===
        null
      ) {
        appRoot.removeAttribute(
          'aria-hidden',
        );
      } else {
        appRoot.setAttribute(
          'aria-hidden',
          previousAriaHidden,
        );
      }
    };
  }, [open]);

  /* ==========================================================================
   * BODY ESCAPE SAFETY
   * ======================================================================== */

  useEffect(
    () => () => {
      if (
        typeof document ===
        'undefined'
      ) {
        return;
      }

      document.body.style.overflow =
        previousBodyOverflow.current;

      document.body.style.paddingRight =
        previousBodyPaddingRight.current;
    },
    [],
  );

  /* ==========================================================================
   * CALLBACK WRAPPERS
   * ======================================================================== */

  const handleRefresh =
    useCallback(() => {
      if (
        disabled ||
        loading ||
        typeof onRefresh !==
          'function'
      ) {
        return;
      }

      onRefresh();
    }, [
      disabled,
      loading,
      onRefresh,
    ]);

  const handleMarkAllRead =
    useCallback(() => {
      if (
        disabled ||
        loading ||
        displayUnreadCount <=
          0 ||
        typeof onMarkAllRead !==
          'function'
      ) {
        return;
      }

      onMarkAllRead();
    }, [
      disabled,
      loading,
      displayUnreadCount,
      onMarkAllRead,
    ]);

  const handleAnnouncementSelect =
    useCallback(
      (announcement) => {
        if (
          disabled ||
          typeof onSelect !==
            'function'
        ) {
          return;
        }

        onSelect(
          announcement,
        );
      },
      [
        disabled,
        onSelect,
      ],
    );

  /* ==========================================================================
   * RENDER HELPERS
   * ======================================================================== */

  const renderLoading =
    () => (
      <div
        className="titech-announcement-drawer__loading"
        role="status"
        aria-live="polite"
        aria-label="Loading announcements"
      >
        {Array.from(
          {
            length:
              Math.max(
                1,
                Math.min(
                  8,
                  Number(
                    loadingCount,
                  ) ||
                    DEFAULT_LOADING_COUNT,
                ),
              ),
          },
          (_, index) => (
            <AnnouncementSkeleton
              key={index}
              index={index}
            />
          ),
        )}
      </div>
    );

  const renderError =
    () => (
      <div
        className="titech-announcement-drawer__state titech-announcement-drawer__state--error"
        role="alert"
      >
        <span className="titech-announcement-drawer__state-icon">
          <Icon
            name="danger"
            size={28}
          />
        </span>

        <h3>
          {errorTitle}
        </h3>

        <p>
          {safeString(
            error?.message,
            errorDescription,
          )}
        </p>

        {typeof onRefresh ===
          'function' && (
          <button
            type="button"
            className="titech-announcement-drawer__primary-button"
            onClick={
              handleRefresh
            }
            disabled={
              disabled ||
              loading
            }
            data-autofocus="true"
          >
            <Icon
              name="refresh"
              size={17}
            />
            Try again
          </button>
        )}
      </div>
    );

  const renderEmpty =
    () => (
      <div
        className="titech-announcement-drawer__state titech-announcement-drawer__state--empty"
        role="status"
      >
        <span className="titech-announcement-drawer__state-icon">
          <Icon
            name="bell"
            size={28}
          />
        </span>

        <h3>
          {emptyTitle}
        </h3>

        <p>
          {emptyDescription}
        </p>
      </div>
    );

  const renderContent =
    () => {
      if (loading) {
        return renderLoading();
      }

      if (error) {
        return renderError();
      }

      if (
        normalizedAnnouncements.length ===
        0
      ) {
        return renderEmpty();
      }

      return (
        <div
          className="titech-announcement-drawer__list"
          role="list"
          aria-label="TITech Community Capital announcements"
        >
          {normalizedAnnouncements.map(
            (announcement, index) => {
              const id =
                getAnnouncementId(
                  announcement,
                );

              return (
                <div
                  key={
                    id ||
                    `announcement-${index}`
                  }
                  role="listitem"
                >
                  <AnnouncementItem
                    announcement={
                      announcement
                    }
                    locale={
                      locale
                    }
                    onSelect={
                      handleAnnouncementSelect
                    }
                    onMarkRead={
                      onMarkRead
                    }
                    onDismiss={
                      showDismiss
                        ? onDismiss
                        : undefined
                    }
                    onAction={
                      onAction
                    }
                    disabled={
                      disabled
                    }
                  />
                </div>
              );
            },
          )}
        </div>
      );
    };

  /* ==========================================================================
   * CLOSED STATE
   * ======================================================================== */

  if (!open) {
    return null;
  }

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <div
      className={cn(
        'titech-announcement-drawer',
        className,
      )}
      data-testid={
        testId
      }
      data-component={
        COMPONENT_NAME
      }
    >
      <div
        className="titech-announcement-drawer__backdrop"
        onMouseDown={
          handleOverlayClick
        }
        aria-hidden="true"
      />

      <aside
        ref={
          drawerRef
        }
        className="titech-announcement-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={
          dialogTitleId
        }
        aria-describedby={
          dialogDescriptionId
        }
        tabIndex={-1}
      >
        {/* ====================================================================
            HEADER
            ================================================================== */}

        <header className="titech-announcement-drawer__header">
          <div className="titech-announcement-drawer__heading">
            <span className="titech-announcement-drawer__heading-icon">
              <Icon
                name="bell"
                size={22}
              />
            </span>

            <div>
              <h2
                id={
                  dialogTitleId
                }
                className="titech-announcement-drawer__title"
              >
                {title}
              </h2>

              <p
                id={
                  dialogDescriptionId
                }
                className="titech-announcement-drawer__description"
              >
                {displayUnreadCount >
                0
                  ? `${displayUnreadCount} unread ${
                      displayUnreadCount ===
                      1
                        ? 'announcement'
                        : 'announcements'
                    }`
                  : 'Stay up to date with TITech Community Capital'}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="titech-announcement-drawer__close"
            onClick={() =>
              handleClose(
                'button',
              )
            }
            disabled={
              disabled
            }
            aria-label="Close announcements"
            title="Close"
            data-autofocus="true"
          >
            <Icon
              name="close"
              size={20}
            />
          </button>
        </header>

        {/* ====================================================================
            TOOLBAR
            ================================================================== */}

        <div
          className="titech-announcement-drawer__toolbar"
          aria-label="Announcement controls"
        >
          {showMarkAllRead &&
            typeof onMarkAllRead ===
              'function' && (
            <button
              type="button"
              className="titech-announcement-drawer__toolbar-button"
              onClick={
                handleMarkAllRead
              }
              disabled={
                disabled ||
                loading ||
                displayUnreadCount ===
                  0
              }
            >
              <Icon
                name="checkAll"
                size={17}
              />
              Mark all as read
            </button>
          )}

          {showRefresh &&
            typeof onRefresh ===
              'function' && (
            <button
              type="button"
              className="titech-announcement-drawer__toolbar-button"
              onClick={
                handleRefresh
              }
              disabled={
                disabled ||
                loading
              }
              aria-label="Refresh announcements"
              title="Refresh announcements"
            >
              <Icon
                name="refresh"
                size={17}
              />
              Refresh
            </button>
          )}
        </div>

        {/* ====================================================================
            CONTENT
            ================================================================== */}

        <section
          className="titech-announcement-drawer__content"
          aria-live={
            loading
              ? 'polite'
              : 'off'
          }
        >
          {renderContent()}
        </section>

        {/* ====================================================================
            FOOTER
            ================================================================== */}

        <footer className="titech-announcement-drawer__footer">
          <span>
            TITech Community Capital
          </span>

          <span
            className="titech-announcement-drawer__footer-separator"
            aria-hidden="true"
          >
            •
          </span>

          <span>
            Official announcements
          </span>
        </footer>
      </aside>
    </div>
  );
}

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

AnnouncementDrawer.propTypes = {
  open:
    PropTypes.bool,

  announcements:
    PropTypes.oneOfType([
      PropTypes.arrayOf(
        PropTypes.object,
      ),
      PropTypes.shape({
        data:
          PropTypes.arrayOf(
            PropTypes.object,
          ),
        items:
          PropTypes.arrayOf(
            PropTypes.object,
          ),
        announcements:
          PropTypes.arrayOf(
            PropTypes.object,
          ),
      }),
    ]),

  unreadCount:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.string,
    ]),

  title:
    PropTypes.string,

  emptyTitle:
    PropTypes.string,

  emptyDescription:
    PropTypes.string,

  errorTitle:
    PropTypes.string,

  errorDescription:
    PropTypes.string,

  locale:
    PropTypes.string,

  maxVisible:
    PropTypes.number,

  showMarkAllRead:
    PropTypes.bool,

  showRefresh:
    PropTypes.bool,

  showDismiss:
    PropTypes.bool,

  closeOnOverlayClick:
    PropTypes.bool,

  closeOnEscape:
    PropTypes.bool,

  lockBodyScroll:
    PropTypes.bool,

  loadingCount:
    PropTypes.number,

  disabled:
    PropTypes.bool,

  onClose:
    PropTypes.func,

  onSelect:
    PropTypes.func,

  onMarkRead:
    PropTypes.func,

  onMarkAllRead:
    PropTypes.func,

  onDismiss:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  onAction:
    PropTypes.func,

  className:
    PropTypes.string,

  labelledBy:
    PropTypes.string,

  describedBy:
    PropTypes.string,

  initialFocusRef:
    PropTypes.shape({
      current:
        PropTypes.instanceOf(
          typeof Element !==
            'undefined'
            ? Element
            : Object,
        ),
    }),

  restoreFocus:
    PropTypes.bool,

  testId:
    PropTypes.string,
};