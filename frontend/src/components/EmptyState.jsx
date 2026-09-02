'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Empty State Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/EmptyState.jsx
 *
 * Purpose:
 *   Production-grade reusable empty-state component for TITech applications.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Lucide icon registry
 * ✓ Enterprise preset states
 * ✓ Empty / no-results / no-data states
 * ✓ Error / retry states
 * ✓ Search / filter reset states
 * ✓ Create / add actions
 * ✓ Primary + secondary actions
 * ✓ Custom action collection
 * ✓ Loading state
 * ✓ Custom content
 * ✓ Footer content
 * ✓ Compact / inline variants
 * ✓ Responsive presentation
 * ✓ Accessible semantic structure
 * ✓ Screen-reader announcements
 * ✓ Keyboard accessibility
 * ✓ Ref API
 * ✓ Stable test selectors
 * ✓ Safe callback execution
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Presentation only.
 *
 * This component MUST NOT:
 *   - authorize users
 *   - enforce tenant isolation
 *   - modify authoritative financial data
 *   - approve transactions
 *   - determine loan eligibility
 *   - perform fraud decisions
 *
 * Application/service layers remain authoritative.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useCallback,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';

import {
  AlertCircle,
  Bell,
  Building2,
  Database,
  FileSearch,
  FileText,
  Inbox,
  LockKeyhole,
  PlusCircle,
  RefreshCw,
  Search,
  Users,
  WalletCards,
  ArrowRight,
} from 'lucide-react';

import './EmptyState.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_TITLE =
  'No Data Available';

const DEFAULT_DESCRIPTION =
  'There is nothing to display at the moment.';

const DEFAULT_ICON =
  'inbox';

const DEFAULT_TEST_ID =
  'titech-empty-state';

const DEFAULT_SIZE =
  'medium';

const DEFAULT_ALIGN =
  'center';


/* ============================================================================
 * Icon Registry
 * ========================================================================== */

const ICONS = Object.freeze({
  default:
    Inbox,

  inbox:
    Inbox,

  search:
    Search,

  'search-results':
    Search,

  database:
    Database,

  files:
    FileSearch,

  file:
    FileText,

  error:
    AlertCircle,

  add:
    PlusCircle,

  users:
    Users,

  members:
    Users,

  messages:
    Inbox,

  message:
    Inbox,

  transactions:
    WalletCards,

  savings:
    WalletCards,

  loans:
    FileText,

  reports:
    FileText,

  notifications:
    Bell,

  tenant:
    Building2,

  organization:
    Building2,

  unauthorized:
    LockKeyhole,

  forbidden:
    LockKeyhole,
});


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


const isPromiseLike = (
  value,
) =>
  Boolean(
    value &&
      typeof value.then ===
        'function',
  );


const normalizeIconName = (
  value,
) =>
  safeText(
    value,
    DEFAULT_ICON,
  ).toLowerCase();


/**
 * Build an accessible label for the component.
 */
const buildAccessibleLabel = ({
  title,
  description,
  loading,
}) => {
  if (
    loading
  ) {
    return 'Loading content';
  }

  const resolvedTitle =
    safeText(
      title,
    );

  const resolvedDescription =
    safeText(
      description,
    );

  return [
    resolvedTitle,
    resolvedDescription,
  ]
    .filter(Boolean)
    .join('. ');
};


/**
 * Normalize action declarations.
 */
const normalizeAction = (
  action,
  fallbackLabel = 'Continue',
) => {
  if (
    typeof action ===
    'function'
  ) {
    return {
      label:
        fallbackLabel,

      onClick:
        action,

      variant:
        'secondary',

      disabled:
        false,

      danger:
        false,
    };
  }

  if (
    !action ||
    typeof action !==
      'object'
  ) {
    return null;
  }

  const label =
    safeText(
      action.label,
    );

  if (
    !label ||
    typeof action.onClick !==
      'function'
  ) {
    return null;
  }

  return {
    ...action,

    label,

    variant:
      action.variant ===
      'primary'
        ? 'primary'
        : 'secondary',

    disabled:
      Boolean(
        action.disabled,
      ),

    danger:
      Boolean(
        action.danger,
      ),
  };
};


/* ============================================================================
 * EmptyState
 * ========================================================================== */

const EmptyState = memo(
  forwardRef(
    function EmptyState(
      {
        title =
          DEFAULT_TITLE,

        description =
          DEFAULT_DESCRIPTION,

        message,

        icon =
          DEFAULT_ICON,

        iconComponent,

        iconSize,

        iconStrokeWidth =
          1.8,

        actionLabel,

        onAction,

        secondaryActionLabel,

        onSecondaryAction,

        primaryAction,

        secondaryAction,

        actions =
          [],

        loading =
          false,

        loadingLabel =
          'Loading…',

        compact =
          false,

        inline =
          false,

        bordered =
          false,

        elevated =
          false,

        size =
          DEFAULT_SIZE,

        align =
          DEFAULT_ALIGN,

        disabled =
          false,

        className =
          '',

        contentClassName =
          '',

        iconClassName =
          '',

        actionsClassName =
          '',

        footerClassName =
          '',

        ariaLabel,

        role =
          'status',

        live =
          'polite',

        titleId,

        descriptionId,

        customContent,

        children,

        footer,

        showIcon =
          true,

        showArrow =
          false,

        testId =
          DEFAULT_TEST_ID,

        onRetry,

        retryLabel =
          'Retry',

        showRetry =
          false,

        onClear,

        clearLabel =
          'Clear filters',

        showClear =
          false,

        onSearch,

        searchLabel =
          'Search',

        showSearch =
          false,

        onCreate,

        createLabel =
          'Create',

        showCreate =
          false,

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const rootRef =
        useRef(null);

      const resolvedDescription =
        safeText(
          description ||
            message,
        );

      const resolvedTitle =
        safeText(
          title,
          DEFAULT_TITLE,
        );

      const resolvedIconName =
        normalizeIconName(
          icon,
        );

      const resolvedSize = [
        'small',
        'medium',
        'large',
      ].includes(
        size,
      )
        ? size
        : DEFAULT_SIZE;

      const resolvedAlign = [
        'left',
        'center',
        'right',
      ].includes(
        align,
      )
        ? align
        : DEFAULT_ALIGN;

      const resolvedIconSize =
        iconSize ||
        (
          resolvedSize ===
          'large'
            ? 64
            : resolvedSize ===
                'small'
              ? 40
              : 52
        );

      const resolvedTitleId =
        titleId ||
        `titech-empty-state-title-${generatedId}`;

      const resolvedDescriptionId =
        descriptionId ||
        `titech-empty-state-description-${generatedId}`;

      const Icon =
        iconComponent ||
        ICONS[
          resolvedIconName
        ] ||
        Inbox;


      /* ======================================================================
       * Action normalization
       * ==================================================================== */

      const normalizedPrimaryAction =
        useMemo(
          () =>
            normalizeAction(
              primaryAction ||
                (
                  actionLabel &&
                  typeof onAction ===
                    'function'
                    ? {
                        label:
                          actionLabel,
                        onClick:
                          onAction,
                        variant:
                          'primary',
                      }
                    : null
                ),
              actionLabel ||
                'Continue',
            ),
          [
            actionLabel,
            onAction,
            primaryAction,
          ],
        );


      const normalizedSecondaryAction =
        useMemo(
          () =>
            normalizeAction(
              secondaryAction ||
                (
                  secondaryActionLabel &&
                  typeof onSecondaryAction ===
                    'function'
                    ? {
                        label:
                          secondaryActionLabel,
                        onClick:
                          onSecondaryAction,
                        variant:
                          'secondary',
                      }
                    : null
                ),
              secondaryActionLabel ||
                'Cancel',
            ),
          [
            onSecondaryAction,
            secondaryAction,
            secondaryActionLabel,
            secondaryActionLabel,
          ],
        );


      /* ======================================================================
       * Standard actions
       * ==================================================================== */

      const standardActions =
        useMemo(
          () => {
            const result =
              [];

            if (
              showSearch &&
              typeof onSearch ===
                'function'
            ) {
              result.push({
                id:
                  'search',

                label:
                  searchLabel,

                onClick:
                  onSearch,

                variant:
                  'secondary',

                icon: (
                  <Search
                    size={16}
                    aria-hidden="true"
                  />
                ),
              });
            }

            if (
              showClear &&
              typeof onClear ===
                'function'
            ) {
              result.push({
                id:
                  'clear',

                label:
                  clearLabel,

                onClick:
                  onClear,

                variant:
                  'secondary',
              });
            }

            if (
              showRetry &&
              typeof onRetry ===
                'function'
            ) {
              result.push({
                id:
                  'retry',

                label:
                  retryLabel,

                onClick:
                  onRetry,

                variant:
                  'secondary',

                icon: (
                  <RefreshCw
                    size={16}
                    aria-hidden="true"
                  />
                ),
              });
            }

            if (
              showCreate &&
              typeof onCreate ===
                'function'
            ) {
              result.push({
                id:
                  'create',

                label:
                  createLabel,

                onClick:
                  onCreate,

                variant:
                  'primary',

                icon: (
                  <PlusCircle
                    size={16}
                    aria-hidden="true"
                  />
                ),
              });
            }

            return result;
          },
          [
            clearLabel,
            createLabel,
            onClear,
            onCreate,
            onRetry,
            onSearch,
            retryLabel,
            searchLabel,
            showClear,
            showCreate,
            showRetry,
            showSearch,
          ],
        );


      const normalizedActions =
        useMemo(
          () =>
            Array.isArray(
              actions,
            )
              ? actions
                  .map(
                    (
                      action,
                    ) =>
                      normalizeAction(
                        action,
                      ),
                  )
                  .filter(Boolean)
              : [],
          [
            actions,
          ],
        );


      const combinedActions =
        useMemo(
          () => [
            ...standardActions,
            ...normalizedActions,
          ],
          [
            normalizedActions,
            standardActions,
          ],
        );


      const primary =
        normalizedPrimaryAction ||
        combinedActions.find(
          (
            action,
          ) =>
            action.variant ===
            'primary',
        ) ||
        null;


      const secondary =
        [
          normalizedSecondaryAction,
          ...combinedActions.filter(
            (
              action,
            ) =>
              action !==
                primary &&
              action.variant !==
                'primary',
          ),
        ].filter(Boolean);


      /* ======================================================================
       * Safe action execution
       * ==================================================================== */

      const executeAction =
        useCallback(
          async (
            action,
          ) => {
            if (
              !action ||
              action.disabled ||
              disabled ||
              loading
            ) {
              return;
            }

            try {
              const result =
                action.onClick();

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch {
              /**
               * Action errors belong to the parent/application layer.
               * Do not silently turn an action failure into fake success.
               */
            }
          },
          [
            disabled,
            loading,
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

          getElement() {
            return rootRef.current;
          },

          getPrimaryAction() {
            return primary;
          },

          getActions() {
            return [
              ...secondary,
              ...(primary
                ? [primary]
                : []),
            ];
          },
        }),
        [
          primary,
          secondary,
        ],
      );


      /* ======================================================================
       * CSS classes
       * ==================================================================== */

      const rootClassName =
        cn(
          'empty-state',
          `empty-state-${resolvedSize}`,
          `empty-state-align-${resolvedAlign}`,

          compact &&
            'empty-state-compact',

          inline &&
            'empty-state-inline',

          bordered &&
            'empty-state-bordered',

          elevated &&
            'empty-state-elevated',

          loading &&
            'empty-state-loading',

          disabled &&
            'empty-state-disabled',

          className,
        );


      const accessibleLabel =
        ariaLabel ||
        buildAccessibleLabel({
          title:
            resolvedTitle,

          description:
            resolvedDescription,

          loading,
        });


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <section
          {...rest}
          ref={
            rootRef
          }
          className={
            rootClassName
          }
          role={
            role
          }
          aria-live={
            live
          }
          aria-busy={
            loading
              ? 'true'
              : undefined
          }
          aria-labelledby={
            resolvedTitle
              ? resolvedTitleId
              : undefined
          }
          aria-describedby={
            resolvedDescription
              ? resolvedDescriptionId
              : undefined
          }
          aria-label={
            accessibleLabel
          }
          data-testid={
            testId
          }
          data-state={
            loading
              ? 'loading'
              : 'empty'
          }
          tabIndex={
            -1
          }
        >

          <div
            className={cn(
              'empty-state-content',
              contentClassName,
            )}
          >

            {/* ================================================================
                Icon
                ================================================================ */}

            {showIcon ? (
              <div
                className={cn(
                  'empty-state-icon',
                  iconClassName,
                )}
                aria-hidden="true"
              >
                {loading ? (
                  <RefreshCw
                    className="empty-state-spinner"
                    size={
                      resolvedIconSize
                    }
                    strokeWidth={
                      iconStrokeWidth
                    }
                  />
                ) : (
                  <Icon
                    size={
                      resolvedIconSize
                    }
                    strokeWidth={
                      iconStrokeWidth
                    }
                    aria-hidden="true"
                  />
                )}
              </div>
            ) : null}


            {/* ================================================================
                Content
                ================================================================ */}

            <div className="empty-state-copy">

              {resolvedTitle ? (
                <h2
                  id={
                    resolvedTitleId
                  }
                  className="empty-state-title"
                >
                  {
                    loading
                      ? loadingLabel
                      : resolvedTitle
                  }
                </h2>
              ) : null}


              {resolvedDescription &&
              !loading ? (
                <p
                  id={
                    resolvedDescriptionId
                  }
                  className="empty-state-description"
                >
                  {
                    resolvedDescription
                  }
                </p>
              ) : null}


              {children ? (
                <div className="empty-state-children">
                  {
                    children
                  }
                </div>
              ) : null}


              {customContent ? (
                <div className="empty-state-custom-content">
                  {
                    customContent
                  }
                </div>
              ) : null}

            </div>


            {/* ================================================================
                Actions
                ================================================================ */}

            {(
              primary ||
              secondary.length >
                0
            ) ? (
              <div
                className={cn(
                  'empty-state-actions',
                  actionsClassName,
                )}
              >

                {primary ? (
                  <button
                    type="button"
                    className="empty-state-btn primary"
                    onClick={() =>
                      executeAction(
                        primary,
                      )
                    }
                    disabled={
                      disabled ||
                      loading ||
                      primary.disabled
                    }
                    aria-label={
                      primary.ariaLabel ||
                      primary.label
                    }
                  >
                    {primary.icon ? (
                      <span
                        className="empty-state-btn-icon"
                        aria-hidden="true"
                      >
                        {
                          primary.icon
                        }
                      </span>
                    ) : null}

                    <span>
                      {
                        primary.label
                      }
                    </span>

                    {(
                      primary.showArrow ||
                      showArrow
                    ) ? (
                      <ArrowRight
                        size={16}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                ) : null}


                {secondary.map(
                  (
                    action,
                    index,
                  ) => (
                    <button
                      key={
                        action.id ||
                        action.key ||
                        `empty-secondary-${index}`
                      }
                      type="button"
                      className={cn(
                        'empty-state-btn secondary',
                        action.danger &&
                          'empty-state-btn-danger',
                      )}
                      onClick={() =>
                        executeAction(
                          action,
                        )
                      }
                      disabled={
                        disabled ||
                        loading ||
                        action.disabled
                      }
                      aria-label={
                        action.ariaLabel ||
                        action.label
                      }
                    >
                      {action.icon ? (
                        <span
                          className="empty-state-btn-icon"
                          aria-hidden="true"
                        >
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


            {/* ================================================================
                Footer
                ================================================================ */}

            {footer ? (
              <div
                className={cn(
                  'empty-state-footer',
                  footerClassName,
                )}
              >
                {
                  footer
                }
              </div>
            ) : null}

          </div>
        </section>
      );
    },
  ),
);


/* ============================================================================
 * Metadata
 * ========================================================================== */

EmptyState.displayName =
  'TITechEmptyState';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

const actionShape =
  PropTypes.shape({
    id:
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number,
      ]),

    key:
      PropTypes.string,

    label:
      PropTypes.string
        .isRequired,

    icon:
      PropTypes.node,

    onClick:
      PropTypes.func
        .isRequired,

    disabled:
      PropTypes.bool,

    danger:
      PropTypes.bool,

    variant:
      PropTypes.oneOf([
        'primary',
        'secondary',
      ]),

    ariaLabel:
      PropTypes.string,

    showArrow:
      PropTypes.bool,
  });


EmptyState.propTypes = {
  title:
    PropTypes.string,

  description:
    PropTypes.string,

  message:
    PropTypes.string,

  icon:
    PropTypes.string,

  iconComponent:
    PropTypes.elementType,

  iconSize:
    PropTypes.number,

  iconStrokeWidth:
    PropTypes.number,

  actionLabel:
    PropTypes.string,

  onAction:
    PropTypes.func,

  secondaryActionLabel:
    PropTypes.string,

  onSecondaryAction:
    PropTypes.func,

  primaryAction:
    PropTypes.oneOfType([
      PropTypes.func,
      actionShape,
    ]),

  secondaryAction:
    actionShape,

  actions:
    PropTypes.arrayOf(
      actionShape,
    ),

  loading:
    PropTypes.bool,

  loadingLabel:
    PropTypes.string,

  compact:
    PropTypes.bool,

  inline:
    PropTypes.bool,

  bordered:
    PropTypes.bool,

  elevated:
    PropTypes.bool,

  size:
    PropTypes.oneOf([
      'small',
      'medium',
      'large',
    ]),

  align:
    PropTypes.oneOf([
      'left',
      'center',
      'right',
    ]),

  disabled:
    PropTypes.bool,

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  iconClassName:
    PropTypes.string,

  actionsClassName:
    PropTypes.string,

  footerClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  role:
    PropTypes.string,

  live:
    PropTypes.oneOf([
      'off',
      'polite',
      'assertive',
    ]),

  titleId:
    PropTypes.string,

  descriptionId:
    PropTypes.string,

  customContent:
    PropTypes.node,

  children:
    PropTypes.node,

  footer:
    PropTypes.node,

  showIcon:
    PropTypes.bool,

  showArrow:
    PropTypes.bool,

  testId:
    PropTypes.string,

  onRetry:
    PropTypes.func,

  retryLabel:
    PropTypes.string,

  showRetry:
    PropTypes.bool,

  onClear:
    PropTypes.func,

  clearLabel:
    PropTypes.string,

  showClear:
    PropTypes.bool,

  onSearch:
    PropTypes.func,

  searchLabel:
    PropTypes.string,

  showSearch:
    PropTypes.bool,

  onCreate:
    PropTypes.func,

  createLabel:
    PropTypes.string,

  showCreate:
    PropTypes.bool,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

EmptyState.defaultProps = {
  title:
    DEFAULT_TITLE,

  description:
    DEFAULT_DESCRIPTION,

  message:
    undefined,

  icon:
    DEFAULT_ICON,

  iconComponent:
    undefined,

  iconSize:
    undefined,

  iconStrokeWidth:
    1.8,

  actionLabel:
    undefined,

  onAction:
    undefined,

  secondaryActionLabel:
    undefined,

  onSecondaryAction:
    undefined,

  primaryAction:
    undefined,

  secondaryAction:
    undefined,

  actions:
    [],

  loading:
    false,

  loadingLabel:
    'Loading…',

  compact:
    false,

  inline:
    false,

  bordered:
    false,

  elevated:
    false,

  size:
    DEFAULT_SIZE,

  align:
    DEFAULT_ALIGN,

  disabled:
    false,

  className:
    '',

  contentClassName:
    '',

  iconClassName:
    '',

  actionsClassName:
    '',

  footerClassName:
    '',

  ariaLabel:
    undefined,

  role:
    'status',

  live:
    'polite',

  titleId:
    undefined,

  descriptionId:
    undefined,

  customContent:
    undefined,

  children:
    undefined,

  footer:
    undefined,

  showIcon:
    true,

  showArrow:
    false,

  testId:
    DEFAULT_TEST_ID,

  onRetry:
    undefined,

  retryLabel:
    'Retry',

  showRetry:
    false,

  onClear:
    undefined,

  clearLabel:
    'Clear filters',

  showClear:
    false,

  onSearch:
    undefined,

  searchLabel:
    'Search',

  showSearch:
    false,

  onCreate:
    undefined,

  createLabel:
    'Create',

  showCreate:
    false,
};


/* ============================================================================
 * Enterprise Presets
 * ========================================================================== */

export const EmptyGroups = memo(
  function EmptyGroups(
    props,
  ) {
    return (
      <EmptyState
        icon="database"
        title="No Community Groups"
        description="Create your first savings group to start managing contributions and loans."
        actionLabel="Create Group"
        {...props}
      />
    );
  },
);


export const EmptySearch = memo(
  function EmptySearch(
    props,
  ) {
    return (
      <EmptyState
        icon="search"
        title="No Results Found"
        description="Try adjusting your filters or search terms."
        {...props}
      />
    );
  },
);


export const EmptyTransactions =
  memo(
    function EmptyTransactions(
      props,
    ) {
      return (
        <EmptyState
          icon="files"
          title="No Transactions"
          description="No transactions have been recorded yet."
          {...props}
        />
      );
    },
  );


export const EmptyError = memo(
  function EmptyError(
    props,
  ) {
    return (
      <EmptyState
        icon="error"
        title="Something Went Wrong"
        description="An unexpected error occurred while loading this data."
        actionLabel="Retry"
        {...props}
      />
    );
  },
);


export const EmptyMembers = memo(
  function EmptyMembers(
    props,
  ) {
    return (
      <EmptyState
        icon="members"
        title="No Members"
        description="No members are currently available for this view."
        {...props}
      />
    );
  },
);


export const EmptyMessages = memo(
  function EmptyMessages(
    props,
  ) {
    return (
      <EmptyState
        icon="messages"
        title="No Messages"
        description="There are no messages to display in this conversation."
        {...props}
      />
    );
  },
);


export const EmptyReports = memo(
  function EmptyReports(
    props,
  ) {
    return (
      <EmptyState
        icon="reports"
        title="No Reports"
        description="No reports are currently available for the selected criteria."
        {...props}
      />
    );
  },
);


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_DESCRIPTION,
  DEFAULT_ICON,
  DEFAULT_SIZE,
  DEFAULT_TEST_ID,
  DEFAULT_TITLE,
  ICONS,
  buildAccessibleLabel,
  cn,
  normalizeAction,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default EmptyState;