/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat Announcement Bell
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/AnnouncementBell.jsx
 *
 * Version:
 *   4.0.0
 *
 * Purpose:
 *   Production-grade, accessible notification bell for the TITech Community
 *   Capital announcement subsystem.
 *
 * Responsibilities:
 *   - Display the current unread announcement count.
 *   - Open/close the AnnouncementDrawer through controlled or uncontrolled
 *     integration.
 *   - Remain compatible with Redux-backed announcement selectors.
 *   - Provide accessible keyboard and screen-reader behaviour.
 *   - Prevent invalid, negative or excessive badge values.
 *   - Support loading, disabled and error states.
 *   - Respect reduced-motion preferences.
 *   - Provide stable enterprise-grade test hooks.
 *   - Remain independent from backend implementation details.
 *   - Avoid unnecessary derived-state recalculation.
 *
 * Architectural boundaries:
 *   - This component is presentation/state-boundary infrastructure.
 *   - Announcement retrieval belongs to announcementService.js.
 *   - Announcement state belongs to announcementSlice.js.
 *   - Derived announcement state belongs to announcementSelectors.js.
 *   - Drawer presentation belongs to AnnouncementDrawer.jsx.
 *   - Constants/contracts belong to announcementConstants.js.
 *
 * Branding:
 *   TITech Community Capital
 *   TITechChat
 *
 * IMPORTANT:
 *   No ACFOS terminology is intentionally used in this component.
 *
 * ============================================================================
 */

'use strict';

import React, {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import {
  ANNOUNCEMENT_ACCESSIBILITY,
} from './announcementConstants';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const COMPONENT_VERSION = '4.0.0';

const DEFAULT_MAX_BADGE_COUNT = 99;

const DEFAULT_LABEL = 'Announcements';

const DEFAULT_TEST_ID = 'announcement-bell';

const DEFAULT_ICON_SIZE = 24;

const DEFAULT_LIVE_POLITENESS = 'polite';

const COPY = Object.freeze({
  open: 'Open announcements',
  close: 'Close announcements',
  loading: 'Loading announcements',
  error: 'Announcements unavailable',
  noUnread: 'No unread announcements',
});

/* ============================================================================
 * SAFE ENVIRONMENT HELPERS
 * ========================================================================== */

/**
 * Determines whether the browser environment is available.
 *
 * @returns {boolean}
 */
function isBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

/**
 * Determines whether reduced motion should be respected.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  if (
    !isBrowser() ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
}

/* ============================================================================
 * NORMALIZATION HELPERS
 * ========================================================================== */

/**
 * Safely normalizes an unread announcement count.
 *
 * Guarantees:
 *   - never negative
 *   - never NaN
 *   - never Infinity
 *   - always an integer
 *   - never exceeds the configured badge limit
 *
 * @param {unknown} value
 * @param {number} maxCount
 * @returns {number}
 */
function normalizeUnreadCount(
  value,
  maxCount = DEFAULT_MAX_BADGE_COUNT,
) {
  const numericValue =
    typeof value === 'number'
      ? value
      : Number(value);

  if (
    !Number.isFinite(numericValue) ||
    numericValue <= 0
  ) {
    return 0;
  }

  const normalizedMax =
    Number.isFinite(Number(maxCount)) &&
    Number(maxCount) > 0
      ? Math.floor(Number(maxCount))
      : DEFAULT_MAX_BADGE_COUNT;

  return Math.min(
    Math.floor(numericValue),
    Math.max(1, normalizedMax),
  );
}

/**
 * Creates the visual badge representation.
 *
 * @param {number} count
 * @param {number} maxCount
 * @returns {string}
 */
function formatBadgeCount(
  count,
  maxCount = DEFAULT_MAX_BADGE_COUNT,
) {
  const normalized =
    normalizeUnreadCount(
      count,
      maxCount,
    );

  if (normalized <= 0) {
    return '';
  }

  const normalizedMax =
    Number.isFinite(Number(maxCount)) &&
    Number(maxCount) > 0
      ? Math.floor(Number(maxCount))
      : DEFAULT_MAX_BADGE_COUNT;

  return normalized >= normalizedMax
    ? `${normalizedMax}+`
    : String(normalized);
}

/**
 * Resolves a safe accessible label.
 *
 * @param {object} options
 * @returns {string}
 */
function buildAccessibleLabel({
  unreadCount,
  isOpen,
  isLoading,
  hasError,
  label,
}) {
  const safeLabel =
    typeof label === 'string' &&
    label.trim()
      ? label.trim()
      : DEFAULT_LABEL;

  if (isLoading) {
    return `${safeLabel}: ${COPY.loading}.`;
  }

  if (hasError) {
    return `${safeLabel}: ${COPY.error}.`;
  }

  if (isOpen) {
    return unreadCount > 0
      ? `${safeLabel}: ${unreadCount} unread. Close announcements.`
      : `${safeLabel}: ${COPY.noUnread}. Close announcements.`;
  }

  return unreadCount > 0
    ? `${safeLabel}: ${unreadCount} unread. Open announcements.`
    : `${safeLabel}: ${COPY.noUnread}. Open announcements.`;
}

/* ============================================================================
 * ICON
 * ========================================================================== */

/**
 * Accessible presentation-only announcement bell icon.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function AnnouncementIcon({
  decorative = true,
  className = '',
  size = DEFAULT_ICON_SIZE,
}) {
  const numericSize =
    Number.isFinite(Number(size)) &&
    Number(size) > 0
      ? Number(size)
      : DEFAULT_ICON_SIZE;

  return (
    <svg
      className={`announcement-bell__icon ${className}`.trim()}
      viewBox="0 0 24 24"
      width={numericSize}
      height={numericSize}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={
        decorative
          ? 'true'
          : undefined
      }
      focusable="false"
      role={
        decorative
          ? undefined
          : 'img'
      }
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

AnnouncementIcon.propTypes = {
  decorative:
    PropTypes.bool,

  className:
    PropTypes.string,

  size:
    PropTypes.number,
};

/* ============================================================================
 * COMPONENT
 * ========================================================================== */

/**
 * AnnouncementBell
 *
 * Supports:
 *
 * Controlled mode:
 *
 *   <AnnouncementBell
 *     isOpen={drawerOpen}
 *     onOpen={handleOpen}
 *     onClose={handleClose}
 *   />
 *
 * Uncontrolled mode:
 *
 *   <AnnouncementBell
 *     defaultOpen={false}
 *     onToggle={handleToggle}
 *   />
 *
 * The actual AnnouncementDrawer remains the responsibility of the parent.
 */
const AnnouncementBell = forwardRef(
  function AnnouncementBell(
    {
      unreadCount = 0,

      isOpen: controlledIsOpen,

      defaultOpen = false,

      onOpen,

      onClose,

      onToggle,

      onClick,

      disabled = false,

      loading = false,

      error = false,

      maxBadgeCount =
        DEFAULT_MAX_BADGE_COUNT,

      label =
        DEFAULT_LABEL,

      title,

      ariaLabel,

      className = '',

      buttonClassName = '',

      badgeClassName = '',

      iconClassName = '',

      showBadge = true,

      showZeroBadge = false,

      hideBadgeWhenLoading = true,

      testId =
        DEFAULT_TEST_ID,

      id,

      ariaControls,

      ariaHaspopup = 'dialog',

      tabIndex = 0,

      type = 'button',

      iconSize =
        DEFAULT_ICON_SIZE,

      children,

      ...rest
    },
    ref,
  ) {
    const generatedId =
      useId();

    const [internalIsOpen, setInternalIsOpen] =
      useState(
        Boolean(defaultOpen),
      );

    const lastFocusedState =
      useRef(
        Boolean(defaultOpen),
      );

    const isControlled =
      typeof controlledIsOpen ===
      'boolean';

    const isOpen =
      isControlled
        ? controlledIsOpen
        : internalIsOpen;

    /* ------------------------------------------------------------------------
     * DERIVED VALUES
     * ---------------------------------------------------------------------- */

    const normalizedUnreadCount =
      useMemo(
        () =>
          normalizeUnreadCount(
            unreadCount,
            maxBadgeCount,
          ),
        [
          unreadCount,
          maxBadgeCount,
        ],
      );

    const badgeText =
      useMemo(
        () =>
          formatBadgeCount(
            normalizedUnreadCount,
            maxBadgeCount,
          ),
        [
          normalizedUnreadCount,
          maxBadgeCount,
        ],
      );

    const shouldShowBadge =
      Boolean(showBadge) &&
      (
        normalizedUnreadCount > 0 ||
        Boolean(showZeroBadge)
      ) &&
      !(
        loading &&
        hideBadgeWhenLoading
      );

    const safeLabel =
      typeof label === 'string' &&
      label.trim()
        ? label.trim()
        : DEFAULT_LABEL;

    const accessibleLabel =
      useMemo(
        () =>
          ariaLabel ||
          buildAccessibleLabel({
            unreadCount:
              normalizedUnreadCount,
            isOpen,
            isLoading:
              Boolean(loading),
            hasError:
              Boolean(error),
            label:
              safeLabel,
          }),
        [
          ariaLabel,
          normalizedUnreadCount,
          isOpen,
          loading,
          error,
          safeLabel,
        ],
      );

    const resolvedId =
      id ||
      `titech-announcement-bell-${generatedId}`;

    const resolvedTitle =
      title ||
      (
        loading
          ? COPY.loading
          : error
            ? COPY.error
            : isOpen
              ? COPY.close
              : COPY.open
      );

    const livePoliteness =
      ANNOUNCEMENT_ACCESSIBILITY
        ?.ANNOUNCEMENT_COUNT_ARIA_LIVE ||
      ANNOUNCEMENT_ACCESSIBILITY
        ?.LIVE_REGION_POLITENESS ||
      DEFAULT_LIVE_POLITENESS;

    const bellSize =
      ANNOUNCEMENT_ACCESSIBILITY
        ?.BELL_SIZE ||
      'md';

    /* ------------------------------------------------------------------------
     * OPEN/CLOSE STATE
     * ---------------------------------------------------------------------- */

    const updateOpenState =
      useCallback(
        (nextOpenState) => {
          if (disabled) {
            return;
          }

          const normalizedNextState =
            Boolean(nextOpenState);

          if (!isControlled) {
            setInternalIsOpen(
              normalizedNextState,
            );
          }

          lastFocusedState.current =
            normalizedNextState;

          if (
            normalizedNextState &&
            typeof onOpen ===
              'function'
          ) {
            onOpen();
          }

          if (
            !normalizedNextState &&
            typeof onClose ===
              'function'
          ) {
            onClose();
          }

          if (
            typeof onToggle ===
              'function'
          ) {
            onToggle(
              normalizedNextState,
            );
          }
        },
        [
          disabled,
          isControlled,
          onOpen,
          onClose,
          onToggle,
        ],
      );

    /* ------------------------------------------------------------------------
     * CLICK HANDLER
     * ---------------------------------------------------------------------- */

    const handleClick =
      useCallback(
        (event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }

          if (
            typeof onClick ===
            'function'
          ) {
            onClick(event);
          }

          if (
            event.defaultPrevented
          ) {
            return;
          }

          updateOpenState(
            !isOpen,
          );
        },
        [
          disabled,
          onClick,
          updateOpenState,
          isOpen,
        ],
      );

    /* ------------------------------------------------------------------------
     * KEYBOARD HANDLER
     *
     * Native button semantics provide Enter/Space support.
     * Escape is supported for closing the announcement surface.
     * ---------------------------------------------------------------------- */

    const handleKeyDown =
      useCallback(
        (event) => {
          if (
            disabled ||
            event.defaultPrevented
          ) {
            return;
          }

          if (
            event.key === 'Escape' &&
            isOpen
          ) {
            event.preventDefault();

            updateOpenState(false);
          }
        },
        [
          disabled,
          isOpen,
          updateOpenState,
        ],
      );

    /* ------------------------------------------------------------------------
     * CLASS NAMES
     * ---------------------------------------------------------------------- */

    const rootClassName =
      useMemo(
        () =>
          [
            'announcement-bell',

            isOpen
              ? 'is-open'
              : '',

            normalizedUnreadCount > 0
              ? 'has-unread'
              : '',

            loading
              ? 'is-loading'
              : '',

            error
              ? 'has-error'
              : '',

            disabled
              ? 'is-disabled'
              : '',

            prefersReducedMotion()
              ? 'prefers-reduced-motion'
              : '',

            className,
          ]
            .filter(Boolean)
            .join(' '),
        [
          isOpen,
          normalizedUnreadCount,
          loading,
          error,
          disabled,
          className,
        ],
      );

    const resolvedButtonClassName =
      useMemo(
        () =>
          [
            'announcement-bell__button',
            buttonClassName,
          ]
            .filter(Boolean)
            .join(' '),
        [buttonClassName],
      );

    const resolvedBadgeClassName =
      useMemo(
        () =>
          [
            'announcement-bell__badge',
            badgeClassName,
          ]
            .filter(Boolean)
            .join(' '),
        [badgeClassName],
      );

    /* ------------------------------------------------------------------------
     * RENDER
     * ---------------------------------------------------------------------- */

    return (
      <div
        id={resolvedId}
        className={rootClassName}
        data-testid={testId}
        data-component="AnnouncementBell"
        data-version={COMPONENT_VERSION}
        data-product="TITech"
        data-module="TITechChat"
        data-bell-size={bellSize}
        data-unread-count={
          normalizedUnreadCount
        }
        data-open={
          isOpen
            ? 'true'
            : 'false'
        }
        data-loading={
          loading
            ? 'true'
            : 'false'
        }
        data-error={
          error
            ? 'true'
            : 'false'
        }
        data-disabled={
          disabled
            ? 'true'
            : 'false'
        }
      >
        <button
          ref={ref}
          type={type}
          className={
            resolvedButtonClassName
          }
          onClick={
            handleClick
          }
          onKeyDown={
            handleKeyDown
          }
          disabled={
            disabled
          }
          tabIndex={
            disabled
              ? -1
              : tabIndex
          }
          aria-label={
            accessibleLabel
          }
          aria-expanded={
            isOpen
          }
          aria-controls={
            ariaControls
          }
          aria-haspopup={
            ariaHaspopup
          }
          aria-busy={
            Boolean(loading)
          }
          title={
            resolvedTitle
          }
          data-testid={`${testId}-button`}
          {...rest}
        >
          <span
            className="announcement-bell__icon-wrapper"
            aria-hidden="true"
          >
            <AnnouncementIcon
              className={
                iconClassName
              }
              size={
                iconSize
              }
            />
          </span>

          {children}

          {shouldShowBadge && (
            <span
              className={
                resolvedBadgeClassName
              }
              aria-hidden="true"
              data-testid={`${testId}-badge`}
            >
              {badgeText}
            </span>
          )}

          <span
            className="announcement-bell__sr-count"
            aria-live={
              livePoliteness
            }
            aria-atomic="true"
            data-testid={`${testId}-live-region`}
          >
            {normalizedUnreadCount >
            0
              ? `${normalizedUnreadCount} unread announcement${
                  normalizedUnreadCount ===
                  1
                    ? ''
                    : 's'
                }.`
              : COPY.noUnread + '.'}
          </span>
        </button>
      </div>
    );
  },
);

/* ============================================================================
 * COMPONENT METADATA
 * ========================================================================== */

AnnouncementBell.displayName =
  'AnnouncementBell';

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

AnnouncementBell.propTypes = {
  /**
   * Number of currently unread announcements.
   */
  unreadCount:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  /**
   * Controlled open state.
   */
  isOpen:
    PropTypes.bool,

  /**
   * Initial open state for uncontrolled usage.
   */
  defaultOpen:
    PropTypes.bool,

  /**
   * Called when the announcement surface opens.
   */
  onOpen:
    PropTypes.func,

  /**
   * Called when the announcement surface closes.
   */
  onClose:
    PropTypes.func,

  /**
   * Called with the resolved next open state.
   */
  onToggle:
    PropTypes.func,

  /**
   * Native click callback.
   *
   * Calling event.preventDefault() prevents the automatic toggle.
   */
  onClick:
    PropTypes.func,

  disabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.bool,

  /**
   * Maximum visual unread badge value.
   *
   * Example:
   *   99 -> 99+
   */
  maxBadgeCount:
    PropTypes.number,

  label:
    PropTypes.string,

  title:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  className:
    PropTypes.string,

  buttonClassName:
    PropTypes.string,

  badgeClassName:
    PropTypes.string,

  iconClassName:
    PropTypes.string,

  showBadge:
    PropTypes.bool,

  showZeroBadge:
    PropTypes.bool,

  hideBadgeWhenLoading:
    PropTypes.bool,

  testId:
    PropTypes.string,

  id:
    PropTypes.string,

  ariaControls:
    PropTypes.string,

  ariaHaspopup:
    PropTypes.oneOf([
      'false',
      'true',
      'menu',
      'listbox',
      'tree',
      'grid',
      'dialog',
    ]),

  tabIndex:
    PropTypes.number,

  type:
    PropTypes.oneOf([
      'button',
      'submit',
      'reset',
    ]),

  iconSize:
    PropTypes.number,

  children:
    PropTypes.node,
};

export default AnnouncementBell;