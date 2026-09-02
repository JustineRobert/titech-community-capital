'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Read Badge
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ReadBadge.jsx
 *
 * Purpose:
 *   Production-grade delivery/read-status indicator for TITechChat Enterprise.
 *
 * Supported states
 * ----------------------------------------------------------------------------
 * ✓ Pending
 * ✓ Sending
 * ✓ Sent
 * ✓ Delivered
 * ✓ Read
 * ✓ Seen
 * ✓ Failed
 * ✓ Error
 * ✓ Unknown / fallback
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Single / double check indicators
 * ✓ Text label support
 * ✓ Compact mode
 * ✓ Icon-only mode
 * ✓ Accessible labels
 * ✓ Tooltip title
 * ✓ Timestamp support
 * ✓ Read-by count
 * ✓ Custom label overrides
 * ✓ Custom icon support
 * ✓ Loading state
 * ✓ Error presentation
 * ✓ Defensive status normalization
 * ✓ Ref API
 * ✓ Stable test selectors
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation-only.
 *
 * It MUST NOT:
 *   - determine whether a message is actually read
 *   - mutate message state
 *   - authorize access
 *   - perform network operations
 *   - infer tenant permissions
 *
 * Read/delivery truth must come from the authoritative TITech messaging
 * service/backend.
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

const DEFAULT_UNKNOWN_LABEL =
  'Unknown status';

const DEFAULT_PENDING_LABEL =
  'Sending…';

const DEFAULT_SENT_LABEL =
  'Sent';

const DEFAULT_DELIVERED_LABEL =
  'Delivered';

const DEFAULT_READ_LABEL =
  'Read';

const DEFAULT_SEEN_LABEL =
  'Seen';

const DEFAULT_FAILED_LABEL =
  'Failed';

const DEFAULT_ERROR_LABEL =
  'Error';


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


const normalizeStatus = (
  status,
) => {
  const normalized =
    safeText(
      status,
      'unknown',
    )
      .toLowerCase()
      .replace(
        /[_\s-]+/g,
        '-',
      );

  const aliases = {
    pending:
      'pending',

    queued:
      'pending',

    sending:
      'pending',

    processing:
      'pending',

    sent:
      'sent',

    submitted:
      'sent',

    delivered:
      'delivered',

    delivery:
      'delivered',

    read:
      'read',

    opened:
      'read',

    seen:
      'seen',

    failed:
      'failed',

    error:
      'failed',

    rejected:
      'failed',

    unknown:
      'unknown',
  };

  return (
    aliases[
      normalized
    ] ||
    'unknown'
  );
};


const isTerminalStatus = (
  status,
) =>
  [
    'sent',
    'delivered',
    'read',
    'seen',
    'failed',
  ].includes(
    normalizeStatus(
      status,
    ),
  );


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


/* ============================================================================
 * Status metadata
 * ========================================================================== */

const STATUS_CONFIG = {
  pending: {
    label:
      DEFAULT_PENDING_LABEL,

    shortLabel:
      'Sending',

    tone:
      'pending',

    icon:
      'pending',
  },

  sent: {
    label:
      DEFAULT_SENT_LABEL,

    shortLabel:
      'Sent',

    tone:
      'sent',

    icon:
      'single-check',
  },

  delivered: {
    label:
      DEFAULT_DELIVERED_LABEL,

    shortLabel:
      'Delivered',

    tone:
      'delivered',

    icon:
      'double-check',
  },

  read: {
    label:
      DEFAULT_READ_LABEL,

    shortLabel:
      'Read',

    tone:
      'read',

    icon:
      'double-check',
  },

  seen: {
    label:
      DEFAULT_SEEN_LABEL,

    shortLabel:
      'Seen',

    tone:
      'seen',

    icon:
      'double-check',
  },

  failed: {
    label:
      DEFAULT_FAILED_LABEL,

    shortLabel:
      'Failed',

    tone:
      'failed',

    icon:
      'error',
  },

  unknown: {
    label:
      DEFAULT_UNKNOWN_LABEL,

    shortLabel:
      DEFAULT_UNKNOWN_LABEL,

    tone:
      'unknown',

    icon:
      'unknown',
  },
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const IconBase = ({
  children,
  size = 14,
  className = '',
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);


const PendingIcon = ({
  size = 14,
}) => (
  <IconBase size={size}>
    <circle
      cx="12"
      cy="12"
      r="8"
      strokeDasharray="4 3"
    />
  </IconBase>
);


const SingleCheckIcon = ({
  size = 14,
}) => (
  <IconBase size={size}>
    <path d="m5 12 4 4 10-10" />
  </IconBase>
);


const DoubleCheckIcon = ({
  size = 14,
}) => (
  <IconBase size={size}>
    <path d="m3 12 4 4 8-8" />
    <path d="m9 16 4 4 8-8" />
  </IconBase>
);


const ErrorIcon = ({
  size = 14,
}) => (
  <IconBase size={size}>
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path d="M12 8v5" />

    <path d="M12 16h.01" />
  </IconBase>
);


const UnknownIcon = ({
  size = 14,
}) => (
  <IconBase size={size}>
    <circle
      cx="12"
      cy="12"
      r="9"
    />

    <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 2-1.5 3" />

    <path d="M12 17h.01" />
  </IconBase>
);


/* ============================================================================
 * Icon resolver
 * ========================================================================== */

const getStatusIcon = (
  status,
  size,
) => {
  const config =
    STATUS_CONFIG[
      normalizeStatus(
        status,
      )
    ];

  switch (
    config.icon
  ) {
    case 'pending':
      return (
        <PendingIcon
          size={size}
        />
      );

    case 'single-check':
      return (
        <SingleCheckIcon
          size={size}
        />
      );

    case 'double-check':
      return (
        <DoubleCheckIcon
          size={size}
        />
      );

    case 'error':
      return (
        <ErrorIcon
          size={size}
        />
      );

    case 'unknown':
    default:
      return (
        <UnknownIcon
          size={size}
        />
      );
  }
};


/* ============================================================================
 * ReadBadge
 * ========================================================================== */

const ReadBadge =
  forwardRef(
    function ReadBadge(
      {
        status =
          'sent',

        timestamp,

        readAt,

        deliveredAt,

        readByCount = 0,

        label,

        shortLabel,

        showLabel =
          false,

        showTimestamp =
          false,

        showReadBy =
          false,

        showIcon =
          true,

        iconOnly =
          false,

        compact =
          false,

        size =
          'small',

        animated =
          true,

        disabled =
          false,

        customIcon,

        className =
          '',

        labelClassName =
          '',

        iconClassName =
          '',

        timestampClassName =
          '',

        readByClassName =
          '',

        ariaLabel,

        title,

        testId =
          'titech-read-badge',

        ...rest
      },
      forwardedRef,
    ) {
      const rootRef =
        useRef(null);

      const normalizedStatus =
        normalizeStatus(
          status,
        );

      const config =
        STATUS_CONFIG[
          normalizedStatus
        ] ||
        STATUS_CONFIG.unknown;

      const numericReadByCount =
        Number(
          readByCount,
        );

      const hasReadByCount =
        Number.isFinite(
          numericReadByCount,
        ) &&
        numericReadByCount >
          0;

      const effectiveTimestamp =
        readAt ||
        deliveredAt ||
        timestamp;

      const formattedTimestamp =
        formatTimestamp(
          effectiveTimestamp,
        );

      const resolvedLabel =
        safeText(
          label,
          config.label,
        );

      const resolvedShortLabel =
        safeText(
          shortLabel,
          config.shortLabel,
        );

      const resolvedAriaLabel =
        safeText(
          ariaLabel,
          resolvedLabel,
        );

      const resolvedTitle =
        safeText(
          title ||
            formattedTimestamp ||
            resolvedLabel,
        );

      const resolvedSize =
        size ===
        'large'
          ? 16
          : size ===
              'medium'
            ? 14
            : 12;

      const icon =
        customIcon ||
        getStatusIcon(
          normalizedStatus,
          resolvedSize,
        );

      const statusClass =
        `titech-read-badge--${config.tone}`;

      const rootClassName =
        cn(
          'titech-read-badge',

          statusClass,

          `titech-read-badge--${size}`,

          compact &&
            'titech-read-badge--compact',

          iconOnly &&
            'titech-read-badge--icon-only',

          animated &&
            normalizedStatus ===
              'pending' &&
            'titech-read-badge--animated',

          disabled &&
            'titech-read-badge--disabled',

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

          getStatus() {
            return normalizedStatus;
          },

          getLabel() {
            return resolvedLabel;
          },

          getElement() {
            return rootRef.current;
          },
        }),
        [
          normalizedStatus,
          resolvedLabel,
        ],
      );

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
            resolvedAriaLabel
          }
          aria-disabled={
            disabled
              ? 'true'
              : undefined
          }
          title={
            resolvedTitle
          }
          data-testid={
            testId
          }
          data-status={
            normalizedStatus
          }
          data-terminal={
            isTerminalStatus(
              normalizedStatus,
            )
              ? 'true'
              : 'false'
          }
        >

          {/* ================================================================
              Status icon
              ================================================================ */}

          {showIcon ? (
            <span
              className={cn(
                'titech-read-badge__icon',
                iconClassName,
              )}
              aria-hidden="true"
            >
              {
                icon
              }
            </span>
          ) : null}


          {/* ================================================================
              Label
              ================================================================ */}

          {(showLabel ||
            !iconOnly) &&
          !compact ? (
            <span
              className={cn(
                'titech-read-badge__label',
                labelClassName,
              )}
            >
              {
                resolvedLabel
              }
            </span>
          ) : null}


          {/* ================================================================
              Compact label
              ================================================================ */}

          {showLabel &&
          compact &&
          !iconOnly ? (
            <span
              className={cn(
                'titech-read-badge__label',
                'titech-read-badge__label--compact',
                labelClassName,
              )}
            >
              {
                resolvedShortLabel
              }
            </span>
          ) : null}


          {/* ================================================================
              Read-by count
              ================================================================ */}

          {showReadBy &&
          hasReadByCount ? (
            <span
              className={cn(
                'titech-read-badge__read-by',
                readByClassName,
              )}
              aria-label={`${numericReadByCount} people have read this message`}
            >
              {numericReadByCount >
              99
                ? '99+'
                : numericReadByCount}
            </span>
          ) : null}


          {/* ================================================================
              Timestamp
              ================================================================ */}

          {showTimestamp &&
          formattedTimestamp ? (
            <time
              className={cn(
                'titech-read-badge__timestamp',
                timestampClassName,
              )}
              dateTime={
                effectiveTimestamp
                  ? new Date(
                      effectiveTimestamp,
                    ).toISOString()
                  : undefined
              }
              title={
                formattedTimestamp
              }
            >
              {
                formattedTimestamp
              }
            </time>
          ) : null}

        </span>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

ReadBadge.displayName =
  'TITechReadBadge';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ReadBadge.propTypes = {
  status:
    PropTypes.oneOf([
      'pending',
      'queued',
      'sending',
      'processing',
      'sent',
      'submitted',
      'delivered',
      'delivery',
      'read',
      'opened',
      'seen',
      'failed',
      'error',
      'rejected',
      'unknown',
    ]),

  timestamp:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.instanceOf(
        Date,
      ),
    ]),

  readAt:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.instanceOf(
        Date,
      ),
    ]),

  deliveredAt:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.instanceOf(
        Date,
      ),
    ]),

  readByCount:
    PropTypes.number,

  label:
    PropTypes.string,

  shortLabel:
    PropTypes.string,

  showLabel:
    PropTypes.bool,

  showTimestamp:
    PropTypes.bool,

  showReadBy:
    PropTypes.bool,

  showIcon:
    PropTypes.bool,

  iconOnly:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  size:
    PropTypes.oneOf([
      'small',
      'medium',
      'large',
    ]),

  animated:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  customIcon:
    PropTypes.node,

  className:
    PropTypes.string,

  labelClassName:
    PropTypes.string,

  iconClassName:
    PropTypes.string,

  timestampClassName:
    PropTypes.string,

  readByClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  title:
    PropTypes.string,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

ReadBadge.defaultProps = {
  status:
    'sent',

  timestamp:
    undefined,

  readAt:
    undefined,

  deliveredAt:
    undefined,

  readByCount:
    0,

  label:
    undefined,

  shortLabel:
    undefined,

  showLabel:
    false,

  showTimestamp:
    false,

  showReadBy:
    false,

  showIcon:
    true,

  iconOnly:
    false,

  compact:
    false,

  size:
    'small',

  animated:
    true,

  disabled:
    false,

  customIcon:
    undefined,

  className:
    '',

  labelClassName:
    '',

  iconClassName:
    '',

  timestampClassName:
    '',

  readByClassName:
    '',

  ariaLabel:
    undefined,

  title:
    undefined,

  testId:
    'titech-read-badge',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_DELIVERED_LABEL,
  DEFAULT_ERROR_LABEL,
  DEFAULT_FAILED_LABEL,
  DEFAULT_PENDING_LABEL,
  DEFAULT_READ_LABEL,
  DEFAULT_SENT_LABEL,
  DEFAULT_SEEN_LABEL,
  DEFAULT_UNKNOWN_LABEL,
  DoubleCheckIcon,
  ErrorIcon,
  PendingIcon,
  SingleCheckIcon,
  UnknownIcon,
  STATUS_CONFIG,
  formatTimestamp,
  getStatusIcon,
  isTerminalStatus,
  normalizeStatus,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ReadBadge;