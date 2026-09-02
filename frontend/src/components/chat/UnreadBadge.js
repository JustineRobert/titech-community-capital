'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Unread Badge
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/UnreadBadge.js
 *
 * Purpose:
 *   Reusable unread-count/status badge for TITechChat and other TITech
 *   communication surfaces.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Numeric unread counts
 * ✓ 0 / empty state handling
 * ✓ 99+ / configurable maximum display
 * ✓ Singular/plural accessibility labels
 * ✓ Dot-only mode
 * ✓ Numeric mode
 * ✓ Compact / small / medium / large modes
 * ✓ Hidden-zero behavior
 * ✓ Highlight / muted variants
 * ✓ Mention indicator
 * ✓ Priority indicator
 * ✓ Custom label support
 * ✓ Tooltip support
 * ✓ Screen-reader support
 * ✓ Ref API
 * ✓ Defensive count normalization
 * ✓ Stable test selectors
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Presentation only.
 *
 * This component MUST NOT:
 *   - determine authoritative unread state
 *   - mutate message state
 *   - mark messages as read
 *   - perform network requests
 *   - enforce tenant authorization
 *
 * Unread/read truth must originate from TITech's authoritative messaging
 * state/service layer.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_MAX_DISPLAY =
  99;

const DEFAULT_ZERO_LABEL =
  'No unread messages';

const DEFAULT_ONE_LABEL =
  '1 unread message';

const DEFAULT_MANY_LABEL =
  'unread messages';

const DEFAULT_MENTION_LABEL =
  'Unread mentions';

const DEFAULT_PRIORITY_LABEL =
  'Unread priority messages';


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


const normalizeCount = (
  value,
) => {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      numeric,
    ),
  );
};


const formatCount = (
  count,
  maxDisplay,
) => {
  const normalized =
    normalizeCount(
      count,
    );

  const maximum =
    Math.max(
      1,
      normalizeCount(
        maxDisplay,
      ),
    );

  if (
    normalized >
    maximum
  ) {
    return `${maximum}+`;
  }

  return String(
    normalized,
  );
};


const buildAccessibleLabel = ({
  count,
  showZero,
  label,
  mention,
  priority,
  zeroLabel =
    DEFAULT_ZERO_LABEL,
  oneLabel =
    DEFAULT_ONE_LABEL,
  manyLabel =
    DEFAULT_MANY_LABEL,
  mentionLabel =
    DEFAULT_MENTION_LABEL,
  priorityLabel =
    DEFAULT_PRIORITY_LABEL,
}) => {
  const normalized =
    normalizeCount(
      count,
    );

  if (
    safeText(
      label,
    )
  ) {
    return safeText(
      label,
    );
  }

  if (
    priority &&
    normalized >
      0
  ) {
    return `${normalized > 1 ? normalized : 'One'} ${priorityLabel.toLowerCase()}`;
  }

  if (
    mention &&
    normalized >
      0
  ) {
    return `${normalized > 1 ? normalized : 'One'} ${mentionLabel.toLowerCase()}`;
  }

  if (
    normalized ===
    0
  ) {
    return showZero
      ? zeroLabel
      : '';
  }

  if (
    normalized ===
    1
  ) {
    return oneLabel;
  }

  return `${normalized} ${manyLabel}`;
};


/* ============================================================================
 * UnreadBadge
 * ========================================================================== */

const UnreadBadge =
  forwardRef(
    function UnreadBadge(
      {
        count =
          0,

        maxDisplay =
          DEFAULT_MAX_DISPLAY,

        showZero =
          false,

        dot =
          false,

        mention =
          false,

        priority =
          false,

        label,

        zeroLabel =
          DEFAULT_ZERO_LABEL,

        oneLabel =
          DEFAULT_ONE_LABEL,

        manyLabel =
          DEFAULT_MANY_LABEL,

        mentionLabel =
          DEFAULT_MENTION_LABEL,

        priorityLabel =
          DEFAULT_PRIORITY_LABEL,

        title,

        size =
          'small',

        variant =
          'default',

        animated =
          false,

        hideWhenZero =
          true,

        showIcon =
          false,

        icon,

        className =
          '',

        countClassName =
          '',

        iconClassName =
          '',

        ariaLabel,

        testId =
          'titech-unread-badge',

        ...rest
      },
      forwardedRef,
    ) {
      const rootRef =
        useRef(null);

      const normalizedCount =
        normalizeCount(
          count,
        );

      const displayedCount =
        formatCount(
          normalizedCount,
          maxDisplay,
        );

      const hasUnread =
        normalizedCount >
        0;

      const shouldRender =
        !(
          hideWhenZero &&
          !showZero &&
          normalizedCount ===
            0
        );

      const resolvedVariant =
        [
          'default',
          'muted',
          'mention',
          'priority',
          'danger',
        ].includes(
          variant,
        )
          ? variant
          : 'default';

      const resolvedSize =
        [
          'small',
          'medium',
          'large',
        ].includes(
          size,
        )
          ? size
          : 'small';

      const resolvedAriaLabel =
        safeText(
          ariaLabel ||
            buildAccessibleLabel({
              count:
                normalizedCount,

              showZero,

              label,

              mention,

              priority,

              zeroLabel,

              oneLabel,

              manyLabel,

              mentionLabel,

              priorityLabel,
            }),
        );

      const resolvedTitle =
        safeText(
          title ||
            resolvedAriaLabel,
        );

      const rootClassName =
        cn(
          'titech-unread-badge',

          `titech-unread-badge--${resolvedSize}`,

          `titech-unread-badge--${resolvedVariant}`,

          dot &&
            'titech-unread-badge--dot',

          !hasUnread &&
            'titech-unread-badge--empty',

          animated &&
            hasUnread &&
            'titech-unread-badge--animated',

          mention &&
            'titech-unread-badge--mention',

          priority &&
            'titech-unread-badge--priority',

          className,
        );

      /**
       * Public ref API.
       */
      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          getCount() {
            return normalizedCount;
          },

          getDisplayedCount() {
            return displayedCount;
          },

          hasUnread() {
            return hasUnread;
          },

          getElement() {
            return rootRef.current;
          },
        }),
        [
          displayedCount,
          hasUnread,
          normalizedCount,
        ],
      );

      if (
        !shouldRender
      ) {
        return null;
      }

      return (
        <span
          {...rest}
          ref={
            rootRef
          }
          className={
            rootClassName
          }
          role="status"
          aria-label={
            resolvedAriaLabel ||
            undefined
          }
          title={
            resolvedTitle ||
            undefined
          }
          data-testid={
            testId
          }
          data-count={
            normalizedCount
          }
          data-unread={
            hasUnread
              ? 'true'
              : 'false'
          }
        >

          {/* ================================================================
              Optional custom/status icon
              ================================================================ */}

          {showIcon &&
          !dot &&
          (icon ||
            mention ||
            priority) ? (
            <span
              className={cn(
                'titech-unread-badge__icon',
                iconClassName,
              )}
              aria-hidden="true"
            >
              {icon || (
                <svg
                  aria-hidden="true"
                  focusable="false"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="5"
                  />
                </svg>
              )}
            </span>
          ) : null}


          {/* ================================================================
              Dot mode
              ================================================================ */}

          {dot ? (
            <span
              className="titech-unread-badge__dot"
              aria-hidden="true"
            />
          ) : (
            <span
              className={cn(
                'titech-unread-badge__count',
                countClassName,
              )}
            >
              {
                displayedCount
              }
            </span>
          )}

        </span>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

UnreadBadge.displayName =
  'TITechUnreadBadge';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

UnreadBadge.propTypes = {
  count:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  maxDisplay:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  showZero:
    PropTypes.bool,

  dot:
    PropTypes.bool,

  mention:
    PropTypes.bool,

  priority:
    PropTypes.bool,

  label:
    PropTypes.string,

  zeroLabel:
    PropTypes.string,

  oneLabel:
    PropTypes.string,

  manyLabel:
    PropTypes.string,

  mentionLabel:
    PropTypes.string,

  priorityLabel:
    PropTypes.string,

  title:
    PropTypes.string,

  size:
    PropTypes.oneOf([
      'small',
      'medium',
      'large',
    ]),

  variant:
    PropTypes.oneOf([
      'default',
      'muted',
      'mention',
      'priority',
      'danger',
    ]),

  animated:
    PropTypes.bool,

  hideWhenZero:
    PropTypes.bool,

  showIcon:
    PropTypes.bool,

  icon:
    PropTypes.node,

  className:
    PropTypes.string,

  countClassName:
    PropTypes.string,

  iconClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

UnreadBadge.defaultProps = {
  count:
    0,

  maxDisplay:
    DEFAULT_MAX_DISPLAY,

  showZero:
    false,

  dot:
    false,

  mention:
    false,

  priority:
    false,

  label:
    undefined,

  zeroLabel:
    DEFAULT_ZERO_LABEL,

  oneLabel:
    DEFAULT_ONE_LABEL,

  manyLabel:
    DEFAULT_MANY_LABEL,

  mentionLabel:
    DEFAULT_MENTION_LABEL,

  priorityLabel:
    DEFAULT_PRIORITY_LABEL,

  title:
    undefined,

  size:
    'small',

  variant:
    'default',

  animated:
    false,

  hideWhenZero:
    true,

  showIcon:
    false,

  icon:
    undefined,

  className:
    '',

  countClassName:
    '',

  iconClassName:
    '',

  ariaLabel:
    undefined,

  testId:
    'titech-unread-badge',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_MAX_DISPLAY,
  DEFAULT_MANY_LABEL,
  DEFAULT_MENTION_LABEL,
  DEFAULT_ONE_LABEL,
  DEFAULT_PRIORITY_LABEL,
  DEFAULT_ZERO_LABEL,
  buildAccessibleLabel,
  formatCount,
  normalizeCount,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default UnreadBadge;