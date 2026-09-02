/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Savings Group Card
 * ============================================================================
 *
 * File:
 *   frontend/src/components/GroupCard.jsx
 *
 * Purpose:
 *   Reusable, production-grade presentation component for displaying a
 *   TITech Community Capital savings/community group.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Group identity
 * ✓ Group description
 * ✓ Membership information
 * ✓ Savings/financial summary
 * ✓ Group status
 * ✓ Privacy/access indicators
 * ✓ Navigation
 * ✓ Optional actions
 * ✓ Responsive-friendly markup
 * ✓ Accessibility
 * ✓ Keyboard navigation
 * ✓ Defensive data normalization
 * ✓ Stable test selectors
 * ✓ Graceful handling of incomplete API data
 * ✓ React Router integration
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation-only.
 *
 * It MUST NOT be used as an authorization, tenant-isolation, financial
 * authorization, KYC/AML, licensing, or compliance boundary.
 *
 * All sensitive permissions and financial operations MUST be enforced by the
 * backend/API layer.
 *
 * ============================================================================
 */

'use strict';

import React, {
  memo,
  useCallback,
  useMemo,
} from 'react';

import PropTypes from 'prop-types';

import {
  Link,
} from 'react-router-dom';

import {
  Users,
  Wallet,
  ArrowRight,
  Lock,
  Globe2,
  ShieldCheck,
  MoreVertical,
  UserPlus,
  Settings,
  TrendingUp,
  CalendarDays,
  CheckCircle2,
  Clock3,
  AlertCircle,
} from 'lucide-react';

import './GroupCard.css';

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_TEST_ID =
  'titech-group-card';

const DEFAULT_CURRENCY =
  'UGX';

const DEFAULT_LOCALE =
  'en-UG';

const DEFAULT_GROUP_ROUTE =
  '/groups';

const DEFAULT_PLACEHOLDER =
  'Savings Group';

const STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  SUSPENDED: 'suspended',
  CLOSED: 'closed',
});

const PRIVACY = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
});

const DEFAULT_STATUS_LABELS = Object.freeze({
  [STATUS.ACTIVE]: 'Active',
  [STATUS.INACTIVE]: 'Inactive',
  [STATUS.PENDING]: 'Pending',
  [STATUS.SUSPENDED]: 'Suspended',
  [STATUS.CLOSED]: 'Closed',
});

const DEFAULT_STATUS_ICONS = Object.freeze({
  [STATUS.ACTIVE]: CheckCircle2,
  [STATUS.INACTIVE]: Clock3,
  [STATUS.PENDING]: Clock3,
  [STATUS.SUSPENDED]: AlertCircle,
  [STATUS.CLOSED]: AlertCircle,
});

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

/**
 * Safely convert an arbitrary value to a trimmed string.
 */
function normalizeString(
  value,
  fallback = '',
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value).trim() || fallback;
}

/**
 * Safely convert a value to a finite number.
 */
function normalizeNumber(
  value,
  fallback = 0,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return fallback;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : fallback;
}

/**
 * Clamp a numeric value between two boundaries.
 */
function clamp(
  value,
  minimum = 0,
  maximum = 100,
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

/**
 * Normalize a group status.
 */
function normalizeStatus(
  status,
) {
  const normalized =
    normalizeString(
      status,
      STATUS.ACTIVE,
    ).toLowerCase();

  return Object.values(
    STATUS,
  ).includes(normalized)
    ? normalized
    : STATUS.ACTIVE;
}

/**
 * Normalize privacy.
 */
function normalizePrivacy(
  privacy,
) {
  const normalized =
    normalizeString(
      privacy,
      PRIVACY.PUBLIC,
    ).toLowerCase();

  return normalized ===
    PRIVACY.PRIVATE
    ? PRIVACY.PRIVATE
    : PRIVACY.PUBLIC;
}

/**
 * Safely create a group route.
 */
function createGroupRoute(
  groupId,
  baseRoute = DEFAULT_GROUP_ROUTE,
) {
  const normalizedId =
    normalizeString(groupId);

  const normalizedBase =
    normalizeString(
      baseRoute,
      DEFAULT_GROUP_ROUTE,
    ).replace(
      /\/+$/,
      '',
    );

  if (!normalizedId) {
    return normalizedBase;
  }

  return `${normalizedBase}/${encodeURIComponent(
    normalizedId,
  )}`;
}

/**
 * Format monetary values consistently.
 */
function formatCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const amount =
    normalizeNumber(value);

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      },
    ).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(
      locale,
    )}`;
  }
}

/**
 * Format integers consistently.
 */
function formatNumber(
  value,
  locale = DEFAULT_LOCALE,
) {
  return normalizeNumber(
    value,
  ).toLocaleString(
    locale,
  );
}

/**
 * Format dates defensively.
 */
function formatDate(
  value,
  locale = DEFAULT_LOCALE,
) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      },
    ).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * Extract a stable group identifier from common API shapes.
 */
function getGroupId(
  group,
) {
  return (
    group?.id ??
    group?._id ??
    group?.groupId ??
    group?.uuid ??
    null
  );
}

/**
 * Extract membership count from common API shapes.
 */
function getMemberCount(
  group,
) {
  return normalizeNumber(
    group?.memberCount ??
      group?.membersCount ??
      group?.members?.length ??
      group?.members_count ??
      0,
  );
}

/**
 * Extract target/goal amount from common API shapes.
 */
function getTargetAmount(
  group,
) {
  return normalizeNumber(
    group?.targetAmount ??
      group?.savingsTarget ??
      group?.goalAmount ??
      group?.target_amount ??
      group?.goal_amount ??
      0,
  );
}

/**
 * Extract current savings amount from common API shapes.
 */
function getCurrentAmount(
  group,
) {
  return normalizeNumber(
    group?.currentAmount ??
      group?.totalSavings ??
      group?.savingsAmount ??
      group?.balance ??
      group?.current_amount ??
      group?.total_savings ??
      group?.savings_amount ??
      0,
  );
}

/**
 * Calculate savings progress.
 */
function calculateProgress(
  currentAmount,
  targetAmount,
) {
  if (
    targetAmount <= 0
  ) {
    return 0;
  }

  return clamp(
    (currentAmount /
      targetAmount) *
      100,
  );
}

/* ============================================================================
 * Status Badge
 * ========================================================================== */

const GroupStatusBadge = memo(
  function GroupStatusBadge({
    status,
    label,
  }) {
    const normalizedStatus =
      normalizeStatus(
        status,
      );

    const Icon =
      DEFAULT_STATUS_ICONS[
        normalizedStatus
      ] ||
      CheckCircle2;

    const resolvedLabel =
      label ||
      DEFAULT_STATUS_LABELS[
        normalizedStatus
      ] ||
      normalizedStatus;

    return (
      <span
        className={`group-card-status group-card-status--${normalizedStatus}`}
        data-status={
          normalizedStatus
        }
      >
        <Icon
          size={14}
          aria-hidden="true"
          focusable="false"
        />

        <span>
          {resolvedLabel}
        </span>
      </span>
    );
  },
);

GroupStatusBadge.displayName =
  'TITechGroupStatusBadge';

/* ============================================================================
 * Privacy Badge
 * ========================================================================== */

const GroupPrivacyBadge = memo(
  function GroupPrivacyBadge({
    privacy,
  }) {
    const normalizedPrivacy =
      normalizePrivacy(
        privacy,
      );

    const isPrivate =
      normalizedPrivacy ===
      PRIVACY.PRIVATE;

    const Icon = isPrivate
      ? Lock
      : Globe2;

    return (
      <span
        className="group-card-privacy"
        data-privacy={
          normalizedPrivacy
        }
        title={
          isPrivate
            ? 'Private group'
            : 'Public group'
        }
      >
        <Icon
          size={14}
          aria-hidden="true"
          focusable="false"
        />

        <span>
          {isPrivate
            ? 'Private'
            : 'Public'}
        </span>
      </span>
    );
  },
);

GroupPrivacyBadge.displayName =
  'TITechGroupPrivacyBadge';

/* ============================================================================
 * Metric
 * ========================================================================== */

const GroupMetric = memo(
  function GroupMetric({
    icon: Icon,
    label,
    value,
    testId,
  }) {
    return (
      <div
        className="group-card-metric"
        data-testid={
          testId
        }
      >
        <div
          className="group-card-metric-icon"
          aria-hidden="true"
        >
          <Icon
            size={17}
            focusable="false"
          />
        </div>

        <div className="group-card-metric-content">
          <span className="group-card-metric-label">
            {label}
          </span>

          <strong className="group-card-metric-value">
            {value}
          </strong>
        </div>
      </div>
    );
  },
);

GroupMetric.displayName =
  'TITechGroupMetric';

/* ============================================================================
 * Main Component
 * ========================================================================== */

function GroupCard({
  group = null,

  id,

  name,

  title,

  description,

  memberCount,

  membersCount,

  currentAmount,

  totalSavings,

  targetAmount,

  savingsTarget,

  currency = DEFAULT_CURRENCY,

  locale = DEFAULT_LOCALE,

  status = STATUS.ACTIVE,

  statusLabel,

  privacy = PRIVACY.PUBLIC,

  category,

  tags = [],

  createdAt,

  updatedAt,

  imageUrl,

  avatarUrl,

  href,

  baseRoute = DEFAULT_GROUP_ROUTE,

  showDescription = true,

  showMetrics = true,

  showProgress = true,

  showStatus = true,

  showPrivacy = true,

  showCategory = true,

  showActions = false,

  showManagementAction = false,

  showJoinAction = false,

  onClick,

  onJoin,

  onManage,

  onAction,

  disabled = false,

  loading = false,

  className = '',

  testId = DEFAULT_TEST_ID,

  ariaLabel,
}) {
  /* ==========================================================================
   * Normalize Group
   * ======================================================================== */

  const normalizedGroup =
    group || {};

  const resolvedId =
    normalizeString(
      id ??
        getGroupId(
          normalizedGroup,
        ),
    );

  const resolvedName =
    normalizeString(
      name ??
        title ??
        normalizedGroup.name ??
        normalizedGroup.title,
      DEFAULT_PLACEHOLDER,
    );

  const resolvedDescription =
    normalizeString(
      description ??
        normalizedGroup.description ??
        normalizedGroup.summary,
    );

  const resolvedMemberCount =
    normalizeNumber(
      memberCount ??
        membersCount ??
        getMemberCount(
          normalizedGroup,
        ),
    );

  const resolvedCurrentAmount =
    normalizeNumber(
      currentAmount ??
        totalSavings ??
        getCurrentAmount(
          normalizedGroup,
        ),
    );

  const resolvedTargetAmount =
    normalizeNumber(
      targetAmount ??
        savingsTarget ??
        getTargetAmount(
          normalizedGroup,
        ),
    );

  const resolvedStatus =
    normalizeStatus(
      status ??
        normalizedGroup.status ??
        STATUS.ACTIVE,
    );

  const resolvedPrivacy =
    normalizePrivacy(
      privacy ??
        normalizedGroup.privacy ??
        normalizedGroup.visibility ??
        PRIVACY.PUBLIC,
    );

  const resolvedCategory =
    normalizeString(
      category ??
        normalizedGroup.category,
    );

  const resolvedCreatedAt =
    createdAt ??
    normalizedGroup.createdAt ??
    normalizedGroup.created_at;

  const resolvedUpdatedAt =
    updatedAt ??
    normalizedGroup.updatedAt ??
    normalizedGroup.updated_at;

  const resolvedImage =
    imageUrl ??
    avatarUrl ??
    normalizedGroup.imageUrl ??
    normalizedGroup.avatarUrl ??
    normalizedGroup.image_url ??
    normalizedGroup.avatar_url ??
    null;

  const resolvedTags =
    useMemo(() => {
      const source =
        tags?.length
          ? tags
          : normalizedGroup.tags;

      if (
        !Array.isArray(
          source,
        )
      ) {
        return [];
      }

      return source
        .map(
          (tag) =>
            typeof tag ===
            'object'
              ? tag.name ||
                tag.label
              : tag,
        )
        .map(
          (tag) =>
            normalizeString(
              tag,
            ),
        )
        .filter(Boolean)
        .slice(0, 6);
    }, [
      tags,
      normalizedGroup.tags,
    ]);

  const progress =
    calculateProgress(
      resolvedCurrentAmount,
      resolvedTargetAmount,
    );

  const resolvedHref =
    href ||
    createGroupRoute(
      resolvedId,
      baseRoute,
    );

  const resolvedAriaLabel =
    ariaLabel ||
    `Open savings group ${resolvedName}`;

  const cardClassName = [
    'group-card',
    loading
      ? 'group-card--loading'
      : '',
    disabled
      ? 'group-card--disabled'
      : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /* ==========================================================================
   * Event Handlers
   * ======================================================================== */

  const handleCardClick =
    useCallback(
      (event) => {
        if (
          disabled ||
          loading
        ) {
          event.preventDefault();
          return;
        }

        onClick?.(
          normalizedGroup,
          event,
        );
      },
      [
        disabled,
        loading,
        normalizedGroup,
        onClick,
      ],
    );

  const handleJoin =
    useCallback(
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          disabled ||
          loading
        ) {
          return;
        }

        onJoin?.(
          normalizedGroup,
          event,
        );
      },
      [
        disabled,
        loading,
        normalizedGroup,
        onJoin,
      ],
    );

  const handleManage =
    useCallback(
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          disabled ||
          loading
        ) {
          return;
        }

        onManage?.(
          normalizedGroup,
          event,
        );
      },
      [
        disabled,
        loading,
        normalizedGroup,
        onManage,
      ],
    );

  const handleAction =
    useCallback(
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          disabled ||
          loading
        ) {
          return;
        }

        onAction?.(
          normalizedGroup,
          event,
        );
      },
      [
        disabled,
        loading,
        normalizedGroup,
        onAction,
      ],
    );

  /* ==========================================================================
   * Loading Skeleton
   * ======================================================================== */

  if (loading) {
    return (
      <article
        className={`${cardClassName} group-card--skeleton`}
        data-testid={testId}
        data-component="titech-group-card"
        aria-busy="true"
        aria-label={`Loading ${resolvedName}`}
      >
        <div className="group-card-skeleton-media" />

        <div className="group-card-body">
          <div className="group-card-skeleton-line group-card-skeleton-line--title" />

          <div className="group-card-skeleton-line" />

          <div className="group-card-skeleton-line group-card-skeleton-line--short" />

          <div className="group-card-skeleton-metrics">
            <div />
            <div />
            <div />
          </div>
        </div>
      </article>
    );
  }

  /* ==========================================================================
   * Card
   * ======================================================================== */

  return (
    <article
      className={cardClassName}
      data-testid={testId}
      data-component="titech-group-card"
      data-group-id={
        resolvedId || undefined
      }
      data-status={
        resolvedStatus
      }
      data-privacy={
        resolvedPrivacy
      }
      aria-busy={false}
    >
      {/* ====================================================================
          Media / Header
          ==================================================================== */}

      <div className="group-card-header">
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt=""
            className="group-card-image"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="group-card-image group-card-image--placeholder"
            aria-hidden="true"
          >
            <Users
              size={34}
              focusable="false"
            />
          </div>
        )}

        <div className="group-card-header-overlay">
          <div className="group-card-badges">
            {showStatus ? (
              <GroupStatusBadge
                status={
                  resolvedStatus
                }
                label={
                  statusLabel
                }
              />
            ) : null}

            {showPrivacy ? (
              <GroupPrivacyBadge
                privacy={
                  resolvedPrivacy
                }
              />
            ) : null}
          </div>

          {showActions ? (
            <button
              type="button"
              className="group-card-action-button"
              aria-label={`More actions for ${resolvedName}`}
              title={`More actions for ${resolvedName}`}
              onClick={
                handleAction
              }
              disabled={
                disabled
              }
              data-testid="group-card-actions"
            >
              <MoreVertical
                size={18}
                aria-hidden="true"
                focusable="false"
              />
            </button>
          ) : null}
        </div>
      </div>

      {/* ====================================================================
          Body
          ==================================================================== */}

      <div className="group-card-body">
        <div className="group-card-title-row">
          <div className="group-card-title-wrapper">
            {showCategory &&
            resolvedCategory ? (
              <span className="group-card-category">
                {resolvedCategory}
              </span>
            ) : null}

            <h2 className="group-card-title">
              <Link
                to={resolvedHref}
                className="group-card-title-link"
                aria-label={
                  resolvedAriaLabel
                }
                onClick={
                  handleCardClick
                }
                aria-disabled={
                  disabled ||
                  undefined
                }
              >
                {resolvedName}
              </Link>
            </h2>
          </div>
        </div>

        {showDescription &&
        resolvedDescription ? (
          <p className="group-card-description">
            {resolvedDescription}
          </p>
        ) : null}

        {/* ==================================================================
            Metrics
            ================================================================== */}

        {showMetrics ? (
          <div
            className="group-card-metrics"
            aria-label="Group statistics"
          >
            <GroupMetric
              icon={Users}
              label="Members"
              value={formatNumber(
                resolvedMemberCount,
                locale,
              )}
              testId="group-card-member-count"
            />

            <GroupMetric
              icon={Wallet}
              label="Savings"
              value={formatCurrency(
                resolvedCurrentAmount,
                currency,
                locale,
              )}
              testId="group-card-savings"
            />

            <GroupMetric
              icon={TrendingUp}
              label="Target"
              value={formatCurrency(
                resolvedTargetAmount,
                currency,
                locale,
              )}
              testId="group-card-target"
            />
          </div>
        ) : null}

        {/* ==================================================================
            Progress
            ================================================================== */}

        {showProgress &&
        resolvedTargetAmount >
          0 ? (
          <div className="group-card-progress-section">
            <div className="group-card-progress-header">
              <span>
                Savings progress
              </span>

              <strong>
                {Math.round(
                  progress,
                )}
                %
              </strong>
            </div>

            <div
              className="group-card-progress-track"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(
                progress,
              )}
              aria-label={`${resolvedName} savings progress`}
            >
              <span
                className="group-card-progress-value"
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {/* ==================================================================
            Tags
            ================================================================== */}

        {resolvedTags.length >
        0 ? (
          <div
            className="group-card-tags"
            aria-label="Group tags"
          >
            {resolvedTags.map(
              (tag) => (
                <span
                  key={tag}
                  className="group-card-tag"
                >
                  {tag}
                </span>
              ),
            )}
          </div>
        ) : null}

        {/* ==================================================================
            Dates
            ================================================================== */}

        {resolvedCreatedAt ||
        resolvedUpdatedAt ? (
          <div className="group-card-meta">
            <CalendarDays
              size={15}
              aria-hidden="true"
              focusable="false"
            />

            <span>
              {resolvedUpdatedAt
                ? `Updated ${formatDate(
                    resolvedUpdatedAt,
                    locale,
                  )}`
                : `Created ${formatDate(
                    resolvedCreatedAt,
                    locale,
                  )}`}
            </span>
          </div>
        ) : null}

        {/* ==================================================================
            Actions
            ================================================================== */}

        {(showJoinAction ||
          showManagementAction) ? (
          <div className="group-card-actions">
            {showJoinAction ? (
              <button
                type="button"
                className="group-card-button group-card-button--primary"
                onClick={
                  handleJoin
                }
                disabled={
                  disabled
                }
                data-testid="group-card-join"
              >
                <UserPlus
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  Join Group
                </span>
              </button>
            ) : null}

            {showManagementAction ? (
              <button
                type="button"
                className="group-card-button group-card-button--secondary"
                onClick={
                  handleManage
                }
                disabled={
                  disabled
                }
                data-testid="group-card-manage"
              >
                <Settings
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  Manage
                </span>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="group-card-footer">
            <Link
              to={resolvedHref}
              className="group-card-view-link"
              onClick={
                handleCardClick
              }
              aria-label={`View ${resolvedName}`}
              aria-disabled={
                disabled ||
                undefined
              }
            >
              <span>
                View Group
              </span>

              <ArrowRight
                size={17}
                aria-hidden="true"
                focusable="false"
              />
            </Link>
          </div>
        )}
      </div>

      {/* ====================================================================
          Trust / Security Indicator
          ==================================================================== */}

      <div
        className="group-card-trust"
        aria-label="TITech platform security"
      >
        <ShieldCheck
          size={14}
          aria-hidden="true"
          focusable="false"
        />

        <span>
          Protected by TITech
        </span>
      </div>
    </article>
  );
}

/* ============================================================================
 * Component Metadata
 * ========================================================================== */

GroupCard.displayName =
  'TITechGroupCard';

/* ============================================================================
 * PropTypes
 * ========================================================================== */

GroupCard.propTypes = {
  group:
    PropTypes.object,

  id:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  name:
    PropTypes.string,

  title:
    PropTypes.string,

  description:
    PropTypes.string,

  memberCount:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  membersCount:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  currentAmount:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  totalSavings:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  targetAmount:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  savingsTarget:
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
    ]),

  currency:
    PropTypes.string,

  locale:
    PropTypes.string,

  status:
    PropTypes.string,

  statusLabel:
    PropTypes.string,

  privacy:
    PropTypes.string,

  category:
    PropTypes.string,

  tags:
    PropTypes.array,

  createdAt:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.instanceOf(Date),
    ]),

  updatedAt:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
      PropTypes.instanceOf(Date),
    ]),

  imageUrl:
    PropTypes.string,

  avatarUrl:
    PropTypes.string,

  href:
    PropTypes.string,

  baseRoute:
    PropTypes.string,

  showDescription:
    PropTypes.bool,

  showMetrics:
    PropTypes.bool,

  showProgress:
    PropTypes.bool,

  showStatus:
    PropTypes.bool,

  showPrivacy:
    PropTypes.bool,

  showCategory:
    PropTypes.bool,

  showActions:
    PropTypes.bool,

  showManagementAction:
    PropTypes.bool,

  showJoinAction:
    PropTypes.bool,

  onClick:
    PropTypes.func,

  onJoin:
    PropTypes.func,

  onManage:
    PropTypes.func,

  onAction:
    PropTypes.func,

  disabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,
};

/* ============================================================================
 * Default Props
 * ========================================================================== */

GroupCard.defaultProps = {
  group: null,

  id: null,

  name: '',

  title: '',

  description: '',

  memberCount: null,

  membersCount: null,

  currentAmount: null,

  totalSavings: null,

  targetAmount: null,

  savingsTarget: null,

  currency:
    DEFAULT_CURRENCY,

  locale:
    DEFAULT_LOCALE,

  status:
    STATUS.ACTIVE,

  statusLabel: '',

  privacy:
    PRIVACY.PUBLIC,

  category: '',

  tags: [],

  createdAt: null,

  updatedAt: null,

  imageUrl: '',

  avatarUrl: '',

  href: '',

  baseRoute:
    DEFAULT_GROUP_ROUTE,

  showDescription: true,

  showMetrics: true,

  showProgress: true,

  showStatus: true,

  showPrivacy: true,

  showCategory: true,

  showActions: false,

  showManagementAction: false,

  showJoinAction: false,

  onClick: undefined,

  onJoin: undefined,

  onManage: undefined,

  onAction: undefined,

  disabled: false,

  loading: false,

  className: '',

  testId:
    DEFAULT_TEST_ID,

  ariaLabel: '',
};

/* ============================================================================
 * Static Utilities
 * ========================================================================== */

GroupCard.STATUS =
  STATUS;

GroupCard.PRIVACY =
  PRIVACY;

GroupCard.formatCurrency =
  formatCurrency;

GroupCard.formatNumber =
  formatNumber;

GroupCard.calculateProgress =
  calculateProgress;

GroupCard.createGroupRoute =
  createGroupRoute;

/* ============================================================================
 * Export
 * ========================================================================== */

export default memo(
  GroupCard,
);