/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Skeleton UI Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/Skeleton.jsx
 *
 * Purpose:
 *   Enterprise-grade loading placeholders for the TITech Community Capital
 *   frontend.
 *
 * Supports:
 *   ✓ Generic skeleton blocks
 *   ✓ Text skeletons
 *   ✓ Circular skeletons
 *   ✓ Avatar skeletons
 *   ✓ Card skeletons
 *   ✓ Table skeletons
 *   ✓ List skeletons
 *   ✓ Dashboard skeletons
 *   ✓ Profile skeletons
 *   ✓ Transaction skeletons
 *   ✓ Member skeletons
 *   ✓ Loan skeletons
 *   ✓ Custom skeleton layouts
 *   ✓ Multiple animation modes
 *   ✓ Configurable dimensions
 *   ✓ Responsive layouts
 *   ✓ Dark mode
 *   ✓ Accessibility
 *   ✓ Reduced-motion support
 *   ✓ Forwarded refs
 *   ✓ Enterprise-friendly composition
 *
 * Design principles:
 *   - Avoid layout shift while data loads.
 *   - Keep loading states visually consistent across TITech.
 *   - Prefer composition over duplicated loading markup.
 *   - Avoid exposing implementation-specific product naming.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useMemo,
} from 'react';

/**
 * ============================================================================
 * Utility
 * ============================================================================
 */

const cn = (...classes) =>
  classes
    .filter(Boolean)
    .join(' ');

/**
 * ============================================================================
 * Base Skeleton
 * ============================================================================
 *
 * Example:
 *
 *   <Skeleton width="200px" height="20px" />
 *
 */

const Skeleton = forwardRef(function Skeleton(
  {
    width,
    height,

    variant = 'rect',
    animation = 'shimmer',

    rounded,
    circle = false,

    className = '',

    style,
    children,

    /**
     * Accessible label.
     *
     * The skeleton itself remains presentation-oriented by default.
     * Use `ariaLabel` when the loading region needs a spoken status.
     */
    ariaLabel,

    /**
     * Whether this skeleton should expose a loading status.
     */
    role,

    /**
     * Allows callers to control visibility from CSS.
     */
    hidden = false,

    ...rest
  },
  ref,
) {
  /**
   * -------------------------------------------------------------------------
   * Variant classes
   * -------------------------------------------------------------------------
   */

  const variantClass = useMemo(() => {
    if (circle || variant === 'circle') {
      return 'rounded-full';
    }

    switch (variant) {
      case 'text':
        return 'rounded-md';

      case 'avatar':
        return 'rounded-full';

      case 'pill':
        return 'rounded-full';

      case 'card':
        return 'rounded-xl';

      case 'rect':
      default:
        return 'rounded-lg';
    }
  }, [
    circle,
    variant,
  ]);

  /**
   * -------------------------------------------------------------------------
   * Animation classes
   * -------------------------------------------------------------------------
   */

  const animationClass =
    animation === 'none'
      ? ''
      : animation === 'pulse'
        ? 'animate-pulse'
        : animation === 'wave'
          ? 'titech-skeleton-wave'
          : 'titech-skeleton-shimmer';

  /**
   * -------------------------------------------------------------------------
   * Dynamic style
   * -------------------------------------------------------------------------
   */

  const skeletonStyle = {
    width:
      circle || variant === 'circle'
        ? width || height || undefined
        : width,

    height:
      circle || variant === 'circle'
        ? width || height || undefined
        : height,

    ...style,
  };

  return (
    <div
      ref={ref}
      hidden={hidden}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={
        ariaLabel ? undefined : true
      }
      className={cn(
        'relative overflow-hidden',
        'bg-gray-200 dark:bg-gray-800',
        'shrink-0',
        variantClass,
        animationClass,
        className,
      )}
      style={skeletonStyle}
      {...rest}
    >
      {children}
    </div>
  );
});

Skeleton.displayName = 'Skeleton';

/**
 * ============================================================================
 * Skeleton Text
 * ============================================================================
 */

export const SkeletonText = forwardRef(
  function SkeletonText(
    {
      lines = 1,
      width,
      lastLineWidth = '70%',
      height = '0.875rem',
      gap = '0.5rem',
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    const safeLines = Math.max(
      1,
      Number(lines) || 1,
    );

    return (
      <div
        ref={ref}
        className={cn(
          'flex w-full flex-col',
          className,
        )}
        style={{
          gap,
        }}
        {...props}
      >
        {Array.from({
          length: safeLines,
        }).map((_, index) => (
          <Skeleton
            key={`text-line-${index}`}
            variant="text"
            animation={animation}
            height={height}
            width={
              index === safeLines - 1
                ? lastLineWidth
                : width || '100%'
            }
          />
        ))}
      </div>
    );
  },
);

SkeletonText.displayName =
  'SkeletonText';

/**
 * ============================================================================
 * Skeleton Circle / Avatar
 * ============================================================================
 */

export const SkeletonAvatar = forwardRef(
  function SkeletonAvatar(
    {
      size = 40,
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <Skeleton
        ref={ref}
        variant="avatar"
        animation={animation}
        width={size}
        height={size}
        className={className}
        {...props}
      />
    );
  },
);

SkeletonAvatar.displayName =
  'SkeletonAvatar';

/**
 * ============================================================================
 * Skeleton Button
 * ============================================================================
 */

export const SkeletonButton = forwardRef(
  function SkeletonButton(
    {
      width = 120,
      height = 40,
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <Skeleton
        ref={ref}
        variant="pill"
        animation={animation}
        width={width}
        height={height}
        className={className}
        {...props}
      />
    );
  },
);

SkeletonButton.displayName =
  'SkeletonButton';

/**
 * ============================================================================
 * Skeleton Card
 * ============================================================================
 */

export const SkeletonCard = forwardRef(
  function SkeletonCard(
    {
      showIcon = true,
      showTitle = true,
      showDescription = true,
      showFooter = false,

      animation = 'shimmer',

      className = '',

      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full rounded-xl border',
          'border-gray-200 bg-white',
          'p-5',
          'dark:border-gray-800',
          'dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-4">
          {showIcon && (
            <SkeletonAvatar
              size={44}
              animation={animation}
            />
          )}

          <div className="min-w-0 flex-1">
            {showTitle && (
              <Skeleton
                width="45%"
                height="1rem"
                animation={animation}
                variant="text"
              />
            )}

            {showDescription && (
              <div className="mt-3">
                <SkeletonText
                  lines={2}
                  animation={animation}
                  height="0.75rem"
                  lastLineWidth="75%"
                />
              </div>
            )}
          </div>
        </div>

        {showFooter && (
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Skeleton
              width="25%"
              height="0.75rem"
              animation={animation}
              variant="text"
            />

            <SkeletonButton
              width={90}
              height={32}
              animation={animation}
            />
          </div>
        )}
      </div>
    );
  },
);

SkeletonCard.displayName =
  'SkeletonCard';

/**
 * ============================================================================
 * Skeleton Stat Card
 * ============================================================================
 *
 * Suitable for:
 *   - Total members
 *   - Total savings
 *   - Loan portfolio
 *   - Outstanding balances
 *   - Transactions
 *   - Shares
 */

export const SkeletonStatCard =
  forwardRef(function SkeletonStatCard(
    {
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full rounded-xl border',
          'border-gray-200 bg-white p-5',
          'dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton
              width="55%"
              height="0.75rem"
              variant="text"
              animation={animation}
            />

            <div className="mt-3">
              <Skeleton
                width="65%"
                height="1.75rem"
                variant="text"
                animation={animation}
              />
            </div>

            <div className="mt-3">
              <Skeleton
                width="40%"
                height="0.7rem"
                variant="text"
                animation={animation}
              />
            </div>
          </div>

          <SkeletonAvatar
            size={44}
            animation={animation}
          />
        </div>
      </div>
    );
  });

SkeletonStatCard.displayName =
  'SkeletonStatCard';

/**
 * ============================================================================
 * Skeleton Table
 * ============================================================================
 */

export const SkeletonTable =
  forwardRef(function SkeletonTable(
    {
      rows = 6,
      columns = 5,

      showHeader = true,

      animation = 'shimmer',

      className = '',

      rowHeight = 48,

      ...props
    },
    ref,
  ) {
    const safeRows = Math.max(
      1,
      Number(rows) || 1,
    );

    const safeColumns = Math.max(
      1,
      Number(columns) || 1,
    );

    return (
      <div
        ref={ref}
        className={cn(
          'w-full overflow-hidden rounded-xl border',
          'border-gray-200 bg-white',
          'dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        {showHeader && (
          <div className="flex gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/50">
            {Array.from({
              length: safeColumns,
            }).map((_, index) => (
              <div
                key={`header-${index}`}
                className="flex-1"
              >
                <Skeleton
                  width={
                    index === 0
                      ? '60%'
                      : '50%'
                  }
                  height="0.75rem"
                  variant="text"
                  animation={animation}
                />
              </div>
            ))}
          </div>
        )}

        <div>
          {Array.from({
            length: safeRows,
          }).map((_, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              className="flex items-center gap-4 border-b border-gray-100 px-4 last:border-b-0 dark:border-gray-800"
              style={{
                minHeight: rowHeight,
              }}
            >
              {Array.from({
                length: safeColumns,
              }).map(
                (
                  __,
                  columnIndex,
                ) => (
                  <div
                    key={`cell-${rowIndex}-${columnIndex}`}
                    className="min-w-0 flex-1"
                  >
                    <Skeleton
                      width={
                        columnIndex ===
                        0
                          ? '75%'
                          : columnIndex ===
                              safeColumns -
                                1
                            ? '45%'
                            : '60%'
                      }
                      height="0.75rem"
                      variant="text"
                      animation={
                        animation
                      }
                    />
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    );
  });

SkeletonTable.displayName =
  'SkeletonTable';

/**
 * ============================================================================
 * Skeleton List
 * ============================================================================
 */

export const SkeletonList =
  forwardRef(function SkeletonList(
    {
      items = 6,
      showAvatar = true,
      showSecondary = true,

      animation = 'shimmer',

      className = '',

      ...props
    },
    ref,
  ) {
    const safeItems = Math.max(
      1,
      Number(items) || 1,
    );

    return (
      <div
        ref={ref}
        className={cn(
          'divide-y divide-gray-100',
          'dark:divide-gray-800',
          className,
        )}
        {...props}
      >
        {Array.from({
          length: safeItems,
        }).map((_, index) => (
          <div
            key={`list-item-${index}`}
            className="flex items-center gap-3 py-4"
          >
            {showAvatar && (
              <SkeletonAvatar
                size={40}
                animation={animation}
              />
            )}

            <div className="min-w-0 flex-1">
              <Skeleton
                width={
                  index % 3 === 0
                    ? '45%'
                    : '60%'
                }
                height="0.875rem"
                variant="text"
                animation={animation}
              />

              {showSecondary && (
                <div className="mt-2">
                  <Skeleton
                    width="35%"
                    height="0.7rem"
                    variant="text"
                    animation={animation}
                  />
                </div>
              )}
            </div>

            <Skeleton
              width={60}
              height={28}
              variant="pill"
              animation={animation}
            />
          </div>
        ))}
      </div>
    );
  });

SkeletonList.displayName =
  'SkeletonList';

/**
 * ============================================================================
 * Skeleton Member
 * ============================================================================
 */

export const SkeletonMember =
  forwardRef(function SkeletonMember(
    {
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border',
          'border-gray-200 bg-white p-5',
          'dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-4">
          <SkeletonAvatar
            size={56}
            animation={animation}
          />

          <div className="min-w-0 flex-1">
            <Skeleton
              width="45%"
              height="1rem"
              variant="text"
              animation={animation}
            />

            <div className="mt-2">
              <Skeleton
                width="30%"
                height="0.7rem"
                variant="text"
                animation={animation}
              />
            </div>

            <div className="mt-2">
              <Skeleton
                width="55%"
                height="0.7rem"
                variant="text"
                animation={animation}
              />
            </div>
          </div>

          <SkeletonButton
            width={80}
            height={32}
            animation={animation}
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 dark:border-gray-800 md:grid-cols-4">
          {Array.from({
            length: 4,
          }).map((_, index) => (
            <div
              key={`member-stat-${index}`}
            >
              <Skeleton
                width="50%"
                height="0.7rem"
                variant="text"
                animation={animation}
              />

              <div className="mt-2">
                <Skeleton
                  width="75%"
                  height="1rem"
                  variant="text"
                  animation={animation}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  });

SkeletonMember.displayName =
  'SkeletonMember';

/**
 * ============================================================================
 * Skeleton Profile
 * ============================================================================
 */

export const SkeletonProfile =
  forwardRef(function SkeletonProfile(
    {
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full rounded-xl border',
          'border-gray-200 bg-white p-6',
          'dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <SkeletonAvatar
            size={88}
            animation={animation}
          />

          <div className="min-w-0 flex-1">
            <Skeleton
              width="35%"
              height="1.25rem"
              variant="text"
              animation={animation}
            />

            <div className="mt-2">
              <Skeleton
                width="25%"
                height="0.75rem"
                variant="text"
                animation={animation}
              />
            </div>

            <div className="mt-3">
              <Skeleton
                width="45%"
                height="0.75rem"
                variant="text"
                animation={animation}
              />
            </div>
          </div>

          <SkeletonButton
            width={100}
            height={38}
            animation={animation}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 border-t border-gray-100 pt-6 dark:border-gray-800 sm:grid-cols-2">
          {Array.from({
            length: 6,
          }).map((_, index) => (
            <div
              key={`profile-field-${index}`}
            >
              <Skeleton
                width="30%"
                height="0.7rem"
                variant="text"
                animation={animation}
              />

              <div className="mt-2">
                <Skeleton
                  width={
                    index % 2 === 0
                      ? '65%'
                      : '50%'
                  }
                  height="0.9rem"
                  variant="text"
                  animation={animation}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  });

SkeletonProfile.displayName =
  'SkeletonProfile';

/**
 * ============================================================================
 * Skeleton Transaction
 * ============================================================================
 */

export const SkeletonTransaction =
  forwardRef(
    function SkeletonTransaction(
      {
        animation = 'shimmer',
        className = '',
        ...props
      },
      ref,
    ) {
      return (
        <div
          ref={ref}
          className={cn(
            'rounded-xl border',
            'border-gray-200 bg-white p-5',
            'dark:border-gray-800 dark:bg-gray-900',
            className,
          )}
          {...props}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonAvatar
                size={44}
                animation={animation}
              />

              <div className="min-w-0">
                <Skeleton
                  width="140px"
                  height="0.875rem"
                  variant="text"
                  animation={animation}
                />

                <div className="mt-2">
                  <Skeleton
                    width="100px"
                    height="0.7rem"
                    variant="text"
                    animation={animation}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <Skeleton
                width="90px"
                height="1rem"
                variant="text"
                animation={animation}
              />

              <Skeleton
                width="60px"
                height="22px"
                variant="pill"
                animation={animation}
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 dark:border-gray-800 sm:grid-cols-4">
            {Array.from({
              length: 4,
            }).map((_, index) => (
              <div
                key={`transaction-field-${index}`}
              >
                <Skeleton
                  width="55%"
                  height="0.65rem"
                  variant="text"
                  animation={animation}
                />

                <div className="mt-2">
                  <Skeleton
                    width={
                      index === 0
                        ? '75%'
                        : '60%'
                    }
                    height="0.8rem"
                    variant="text"
                    animation={animation}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    },
  );

SkeletonTransaction.displayName =
  'SkeletonTransaction';

/**
 * ============================================================================
 * Skeleton Loan
 * ============================================================================
 */

export const SkeletonLoan =
  forwardRef(function SkeletonLoan(
    {
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border',
          'border-gray-200 bg-white p-5',
          'dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <SkeletonAvatar
              size={48}
              animation={animation}
            />

            <div>
              <Skeleton
                width="130px"
                height="0.9rem"
                variant="text"
                animation={animation}
              />

              <div className="mt-2">
                <Skeleton
                  width="90px"
                  height="0.7rem"
                  variant="text"
                  animation={animation}
                />
              </div>
            </div>
          </div>

          <Skeleton
            width={80}
            height={26}
            variant="pill"
            animation={animation}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {Array.from({
            length: 4,
          }).map((_, index) => (
            <div
              key={`loan-stat-${index}`}
            >
              <Skeleton
                width="55%"
                height="0.65rem"
                variant="text"
                animation={animation}
              />

              <div className="mt-2">
                <Skeleton
                  width="80%"
                  height="1rem"
                  variant="text"
                  animation={animation}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Skeleton
            width="100%"
            height={8}
            variant="pill"
            animation={animation}
          />
        </div>
      </div>
    );
  });

SkeletonLoan.displayName =
  'SkeletonLoan';

/**
 * ============================================================================
 * Skeleton Dashboard
 * ============================================================================
 */

export const SkeletonDashboard =
  forwardRef(function SkeletonDashboard(
    {
      statCards = 4,
      tableRows = 6,
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    const safeStatCards =
      Math.max(
        1,
        Number(statCards) || 1,
      );

    return (
      <div
        ref={ref}
        className={cn(
          'w-full space-y-6',
          className,
        )}
        {...props}
      >
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Skeleton
              width="220px"
              height="1.5rem"
              variant="text"
              animation={animation}
            />

            <div className="mt-2">
              <Skeleton
                width="300px"
                height="0.75rem"
                variant="text"
                animation={animation}
              />
            </div>
          </div>

          <SkeletonButton
            width={120}
            height={38}
            animation={animation}
          />
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({
            length: safeStatCards,
          }).map((_, index) => (
            <SkeletonStatCard
              key={`dashboard-stat-${index}`}
              animation={animation}
            />
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <Skeleton
                  width="160px"
                  height="1rem"
                  variant="text"
                  animation={animation}
                />

                <SkeletonButton
                  width={70}
                  height={30}
                  animation={animation}
                />
              </div>

              <div className="mt-6">
                <Skeleton
                  width="100%"
                  height={260}
                  variant="card"
                  animation={animation}
                />
              </div>
            </div>
          </div>

          <div>
            <SkeletonCard
              animation={animation}
              showFooter
            />
          </div>
        </div>

        {/* Table */}
        <SkeletonTable
          rows={tableRows}
          columns={5}
          animation={animation}
        />
      </div>
    );
  });

SkeletonDashboard.displayName =
  'SkeletonDashboard';

/**
 * ============================================================================
 * Skeleton Page
 * ============================================================================
 */

export const SkeletonPage =
  forwardRef(function SkeletonPage(
    {
      showHeader = true,
      showContent = true,
      contentRows = 6,
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full space-y-6',
          className,
        )}
        {...props}
      >
        {showHeader && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Skeleton
                width="220px"
                height="1.5rem"
                variant="text"
                animation={animation}
              />

              <div className="mt-2">
                <Skeleton
                  width="320px"
                  height="0.75rem"
                  variant="text"
                  animation={animation}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <SkeletonButton
                width={90}
                height={36}
                animation={animation}
              />

              <SkeletonButton
                width={120}
                height={36}
                animation={animation}
              />
            </div>
          </div>
        )}

        {showContent && (
          <div className="space-y-4">
            {Array.from({
              length: Math.max(
                1,
                Number(contentRows) || 1,
              ),
            }).map((_, index) => (
              <SkeletonCard
                key={`page-card-${index}`}
                animation={animation}
                showFooter={
                  index % 3 === 0
                }
              />
            ))}
          </div>
        )}
      </div>
    );
  });

SkeletonPage.displayName =
  'SkeletonPage';

/**
 * ============================================================================
 * Skeleton Form
 * ============================================================================
 */

export const SkeletonForm =
  forwardRef(function SkeletonForm(
    {
      fields = 6,
      columns = 1,
      showActions = true,
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    const safeFields =
      Math.max(
        1,
        Number(fields) || 1,
      );

    const safeColumns =
      Math.max(
        1,
        Number(columns) || 1,
      );

    return (
      <div
        ref={ref}
        className={cn(
          'w-full rounded-xl border',
          'border-gray-200 bg-white p-6',
          'dark:border-gray-800 dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div
          className="grid gap-5"
          style={{
            gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({
            length: safeFields,
          }).map((_, index) => (
            <div
              key={`form-field-${index}`}
              className="min-w-0"
            >
              <Skeleton
                width="30%"
                height="0.7rem"
                variant="text"
                animation={animation}
              />

              <div className="mt-2">
                <Skeleton
                  width="100%"
                  height={42}
                  variant="rect"
                  animation={animation}
                />
              </div>

              {index % 3 === 0 && (
                <div className="mt-2">
                  <Skeleton
                    width="55%"
                    height="0.6rem"
                    variant="text"
                    animation={animation}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {showActions && (
          <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
            <SkeletonButton
              width={90}
              height={38}
              animation={animation}
            />

            <SkeletonButton
              width={120}
              height={38}
              animation={animation}
            />
          </div>
        )}
      </div>
    );
  });

SkeletonForm.displayName =
  'SkeletonForm';

/**
 * ============================================================================
 * Skeleton Modal
 * ============================================================================
 */

export const SkeletonModal =
  forwardRef(function SkeletonModal(
    {
      animation = 'shimmer',
      className = '',
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full max-w-lg rounded-xl',
          'border border-gray-200',
          'bg-white shadow-2xl',
          'dark:border-gray-800',
          'dark:bg-gray-900',
          className,
        )}
        {...props}
      >
        <div className="border-b border-gray-100 p-5 dark:border-gray-800">
          <Skeleton
            width="45%"
            height="1.1rem"
            variant="text"
            animation={animation}
          />

          <div className="mt-2">
            <Skeleton
              width="70%"
              height="0.7rem"
              variant="text"
              animation={animation}
            />
          </div>
        </div>

        <div className="space-y-5 p-5">
          <SkeletonForm
            fields={4}
            showActions={false}
            animation={animation}
            className="border-0 p-0 shadow-none"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 p-5 dark:border-gray-800">
          <SkeletonButton
            width={90}
            height={38}
            animation={animation}
          />

          <SkeletonButton
            width={120}
            height={38}
            animation={animation}
          />
        </div>
      </div>
    );
  });

SkeletonModal.displayName =
  'SkeletonModal';

/**
 * ============================================================================
 * CSS Injection
 * ============================================================================
 *
 * The shimmer/wave animations are intentionally embedded here so the component
 * does not require a separate global stylesheet.
 *
 * `prefers-reduced-motion` disables movement for accessibility.
 */

const SkeletonStyles = () => (
  <style>
    {`
      @keyframes titech-skeleton-shimmer {
        0% {
          transform: translateX(-100%);
          opacity: 0;
        }

        20% {
          opacity: 1;
        }

        100% {
          transform: translateX(100%);
          opacity: 0;
        }
      }

      @keyframes titech-skeleton-wave {
        0% {
          transform: translateX(-100%);
        }

        100% {
          transform: translateX(100%);
        }
      }

      .titech-skeleton-shimmer::after,
      .titech-skeleton-wave::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.45),
          transparent
        );
        animation: titech-skeleton-shimmer 1.6s ease-in-out infinite;
      }

      .titech-skeleton-wave::after {
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.35),
          transparent
        );
        animation-name: titech-skeleton-wave;
        animation-duration: 1.4s;
        animation-timing-function: ease-in-out;
      }

      .dark .titech-skeleton-shimmer::after,
      .dark .titech-skeleton-wave::after {
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.08),
          transparent
        );
      }

      @media (prefers-reduced-motion: reduce) {
        .titech-skeleton-shimmer::after,
        .titech-skeleton-wave::after {
          animation: none;
        }
      }
    `}
  </style>
);

/**
 * ============================================================================
 * Attach Styles
 * ============================================================================
 *
 * This wrapper keeps the default export as the actual Skeleton component
 * while making the styles available through the exported `SkeletonStyles`
 * component.
 */

export {
  SkeletonStyles,
};

/**
 * ============================================================================
 * Named Exports
 * ============================================================================
 */

export {
  Skeleton,
};

export default Skeleton;