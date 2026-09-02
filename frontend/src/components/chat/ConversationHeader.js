'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation Header
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ConversationHeader.js
 *
 * Purpose:
 *   Production-grade header for the TITech Community Capital chat experience.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Conversation title / subject
 * ✓ Conversation participant information
 * ✓ Online / offline / typing state
 * ✓ Tenant / organization context
 * ✓ Conversation status
 * ✓ Pinned / archived state
 * ✓ Search action
 * ✓ New conversation action
 * ✓ Conversation actions menu
 * ✓ Back navigation
 * ✓ Refresh action
 * ✓ Participant count
 * ✓ Responsive layout
 * ✓ Accessibility
 * ✓ Keyboard interaction
 * ✓ Loading state
 * ✓ Error-safe rendering
 * ✓ Custom action support
 * ✓ Ref forwarding
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - authorize users
 *   - decide tenant permissions
 *   - mutate financial records
 *   - execute financial transactions
 *   - determine loan eligibility
 *   - perform fraud decisions
 *
 * Those responsibilities remain with TITech application services and the
 * authoritative backend.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


/**
 * Safely normalize display text.
 */
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
      String(value).trim();

    return result ||
      fallback;
  } catch {
    return fallback;
  }
};


/**
 * Resolve conversation title from common API shapes.
 */
const getConversationTitle = (
  conversation,
) =>
  safeText(
    conversation?.title ||
      conversation?.name ||
      conversation?.subject ||
      conversation?.conversationTitle,
    'TITech Conversation',
  );


/**
 * Resolve tenant name from common API shapes.
 */
const getTenantName = (
  tenant,
  conversation,
) =>
  safeText(
    tenant?.name ||
      tenant?.tenantName ||
      tenant?.organizationName ||
      conversation?.tenantName ||
      conversation?.organizationName,
  );


/**
 * Resolve participant count.
 */
const getParticipantCount = (
  conversation,
  participants,
) => {
  if (
    Array.isArray(
      participants,
    )
  ) {
    return participants.length;
  }

  const count = Number(
    conversation?.participantCount ??
      conversation?.participantsCount ??
      0,
  );

  return Number.isFinite(
    count,
  )
    ? count
    : 0;
};


/**
 * Resolve last activity.
 */
const getLastActivity =
  (
    conversation,
  ) =>
    conversation?.lastMessageAt ||
    conversation?.updatedAt ||
    conversation?.lastActivityAt ||
    null;


/**
 * Format a compact participant count.
 */
const formatParticipantCount =
  (
    count,
  ) =>
    count === 1
      ? '1 participant'
      : `${count} participants`;


/**
 * Create avatar initials.
 */
const getInitials = (
  name,
) => {
  const normalized =
    safeText(
      name,
      'TI',
    );

  const words =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (
    words.length ===
    0
  ) {
    return 'TI';
  }

  if (
    words.length ===
    1
  ) {
    return words[0]
      .slice(
        0,
        2,
      )
      .toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};


/**
 * Format a lightweight last-activity label.
 */
const formatActivity =
  (
    value,
  ) => {
    if (!value) {
      return '';
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      return '';
    }

    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle:
          'medium',
        timeStyle:
          'short',
      },
    ).format(date);
  };


/* ============================================================================
 * Icons
 * ========================================================================== */

const IconBase = ({
  children,
  size = 18,
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
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);


const ArrowLeftIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </IconBase>
);


const SearchIcon = (
  props,
) => (
  <IconBase {...props}>
    <circle
      cx="11"
      cy="11"
      r="7"
    />
    <path d="m20 20-4-4" />
  </IconBase>
);


const RefreshIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </IconBase>
);


const MoreIcon = (
  props,
) => (
  <IconBase {...props}>
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
  </IconBase>
);


const UsersIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle
      cx="9"
      cy="7"
      r="4"
    />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </IconBase>
);


const BuildingIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="M3 21h18" />
    <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
    <path d="M15 21V9a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v12" />
    <path d="M8 7h2" />
    <path d="M8 11h2" />
    <path d="M8 15h2" />
  </IconBase>
);


const PinIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="m12 17 5-5" />
    <path d="m9 14 7-7 3 3-7 7" />
    <path d="M5 19 2 22" />
    <path d="M8 16 3 11l3-3 5 5" />
  </IconBase>
);


const ArchiveIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="M4 4h16v4H4z" />
    <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M9 12h6" />
  </IconBase>
);


const CloseIcon = (
  props,
) => (
  <IconBase {...props}>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </IconBase>
);


/* ============================================================================
 * Avatar
 * ========================================================================== */

const ConversationAvatar = ({
  title,
  imageUrl,
  online = false,
}) => (
  <div
    className="titech-conversation-header__avatar-wrapper"
    aria-hidden="true"
  >
    {imageUrl ? (
      <img
        src={imageUrl}
        alt=""
        className="titech-conversation-header__avatar-image"
        loading="lazy"
        onError={(
          event,
        ) => {
          event.currentTarget.style.display =
            'none';

          const fallback =
            event.currentTarget
              .nextElementSibling;

          if (
            fallback
          ) {
            fallback.style.display =
              'flex';
          }
        }}
      />
    ) : null}

    <span
      className={cn(
        'titech-conversation-header__avatar-fallback',
        imageUrl
          ? 'titech-conversation-header__avatar-fallback--hidden'
          : '',
      )}
    >
      {getInitials(
        title,
      )}
    </span>

    {online ? (
      <span
        className="titech-conversation-header__online-indicator"
        title="Online"
      />
    ) : null}
  </div>
);


/* ============================================================================
 * Status badge
 * ========================================================================== */

const StatusBadge = ({
  status,
}) => {
  if (!status) {
    return null;
  }

  const normalized =
    safeText(
      status,
    ).toLowerCase();

  const label =
    normalized
      .replace(
        /[_-]+/g,
        ' ',
      )
      .replace(
        /\b\w/g,
        (
          char,
        ) =>
          char.toUpperCase(),
      );

  return (
    <span
      className={cn(
        'titech-conversation-header__status',
        `titech-conversation-header__status--${normalized}`,
      )}
    >
      {label}
    </span>
  );
};


/* ============================================================================
 * Menu item
 * ========================================================================== */

const ActionButton = ({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}) => (
  <button
    type="button"
    role="menuitem"
    className={cn(
      'titech-conversation-header__menu-item',
      danger &&
        'titech-conversation-header__menu-item--danger',
    )}
    disabled={disabled}
    onClick={onClick}
  >
    <span
      className="titech-conversation-header__menu-icon"
    >
      {icon}
    </span>

    <span>
      {label}
    </span>
  </button>
);


/* ============================================================================
 * ConversationHeader
 * ========================================================================== */

const ConversationHeader =
  forwardRef(
    function ConversationHeader(
      {
        conversation =
          null,

        tenant =
          null,

        participants =
          [],

        loading =
          false,

        disabled =
          false,

        error =
          null,

        online =
          false,

        typing =
          false,

        status,

        pinned =
          false,

        archived =
          false,

        showBack =
          false,

        showTenant =
          true,

        showParticipantCount =
          true,

        showStatus =
          true,

        showLastActivity =
          false,

        showSearch =
          true,

        showRefresh =
          true,

        showMenu =
          true,

        onBack,

        onSearch,

        onRefresh,

        onNewConversation,

        onPin,

        onArchive,

        onUnarchive,

        onClose,

        customActions =
          [],

        rightContent =
          null,

        title,

        subtitle,

        imageUrl,

        className =
          '',

        compact =
          false,

        mobileTitleOnly =
          false,

        ariaLabel =
          'Conversation header',

        id,

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const headerId =
        id ||
        `titech-conversation-header-${generatedId}`;

      const menuId =
        `${headerId}-menu`;

      const containerRef =
        useRef(null);

      const [
        menuOpen,
        setMenuOpen,
      ] = useState(
        false,
      );

      const resolvedTitle =
        safeText(
          title ||
            getConversationTitle(
              conversation,
            ),
          'TITech Conversation',
        );

      const resolvedTenantName =
        getTenantName(
          tenant,
          conversation,
        );

      const resolvedSubtitle =
        safeText(
          subtitle ||
            conversation?.subtitle ||
            conversation?.description ||
            '',
        );

      const participantCount =
        getParticipantCount(
          conversation,
          participants,
        );

      const activityLabel =
        formatActivity(
          getLastActivity(
            conversation,
          ),
        );

      const resolvedStatus =
        status ||
        conversation?.status;

      const effectivePinned =
        pinned ||
        Boolean(
          conversation?.pinned,
        );

      const effectiveArchived =
        archived ||
        Boolean(
          conversation?.archived,
        );

      const effectiveImageUrl =
        imageUrl ||
        conversation?.imageUrl ||
        conversation?.avatarUrl ||
        conversation?.image;

      const effectiveOnline =
        online ||
        conversation?.online ===
          true;

      /**
       * Close menu when clicking outside.
       */
      useEffect(
        () => {
          if (!menuOpen) {
            return undefined;
          }

          const handlePointerDown =
            (
              event,
            ) => {
              if (
                containerRef.current &&
                !containerRef.current.contains(
                  event.target,
                )
              ) {
                setMenuOpen(
                  false,
                );
              }
            };

          document.addEventListener(
            'mousedown',
            handlePointerDown,
          );

          return () => {
            document.removeEventListener(
              'mousedown',
              handlePointerDown,
            );
          };
        },
        [
          menuOpen,
        ],
      );

      /**
       * Escape closes the actions menu.
       */
      useEffect(
        () => {
          if (!menuOpen) {
            return undefined;
          }

          const handleKeyDown =
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
        },
        [
          menuOpen,
        ],
      );

      /**
       * Public ref API.
       */
      React.useImperativeHandle(
        forwardedRef,
        () => ({
          openMenu() {
            setMenuOpen(
              true,
            );
          },

          closeMenu() {
            setMenuOpen(
              false,
            );
          },

          focus() {
            containerRef.current?.focus();
          },
        }),
        [],
      );

      const handleAction =
        (
          callback,
        ) => {
          if (
            typeof callback !==
            'function'
          ) {
            return;
          }

          setMenuOpen(
            false,
          );

          callback();
        };

      const handleMenuToggle =
        () => {
          if (
            disabled ||
            loading
          ) {
            return;
          }

          setMenuOpen(
            (
              value,
            ) =>
              !value,
          );
        };

      const handleHeaderKeyDown =
        (
          event,
        ) => {
          if (
            event.key ===
            'Escape'
          ) {
            setMenuOpen(
              false,
            );
          }
        };

      const menuActions =
        [];

      if (
        typeof onNewConversation ===
        'function'
      ) {
        menuActions.push({
          key:
            'new-conversation',

          label:
            'New conversation',

          onClick:
            onNewConversation,
        });
      }

      if (
        typeof onPin ===
        'function'
      ) {
        menuActions.push({
          key:
            'pin',

          label:
            effectivePinned
              ? 'Unpin conversation'
              : 'Pin conversation',

          onClick:
            () =>
              onPin(
                conversation,
                !effectivePinned,
              ),

          icon: (
            <PinIcon
              size={16}
            />
          ),
        });
      }

      if (
        effectiveArchived &&
        typeof onUnarchive ===
          'function'
      ) {
        menuActions.push({
          key:
            'unarchive',

          label:
            'Restore conversation',

          onClick:
            () =>
              onUnarchive(
                conversation,
              ),

          icon: (
            <ArchiveIcon
              size={16}
            />
          ),
        });
      } else if (
        !effectiveArchived &&
        typeof onArchive ===
          'function'
      ) {
        menuActions.push({
          key:
            'archive',

          label:
            'Archive conversation',

          onClick:
            () =>
              onArchive(
                conversation,
              ),

          icon: (
            <ArchiveIcon
              size={16}
            />
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

            menuActions.push({
              key:
                action.id ||
                action.key ||
                `custom-${index}`,

              label:
                safeText(
                  action.label,
                ),

              onClick:
                () =>
                  action.onClick?.(
                    conversation,
                  ),

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
            });
          },
        );
      }

      /**
       * Render
       */
      return (
        <header
          {...rest}
          ref={
            containerRef
          }
          id={
            headerId
          }
          className={cn(
            'titech-conversation-header',
            compact &&
              'titech-conversation-header--compact',
            mobileTitleOnly &&
              'titech-conversation-header--mobile-title-only',
            loading &&
              'titech-conversation-header--loading',
            error &&
              'titech-conversation-header--error',
            className,
          )}
          aria-label={
            ariaLabel
          }
          tabIndex={-1}
          onKeyDown={
            handleHeaderKeyDown
          }
        >

          {/* ================================================================
              Left / back
              ================================================================ */}

          <div
            className="titech-conversation-header__left"
          >
            {showBack &&
            typeof onBack ===
              'function' ? (
              <button
                type="button"
                className="titech-conversation-header__icon-button"
                onClick={
                  onBack
                }
                disabled={
                  disabled ||
                  loading
                }
                aria-label="Back to conversations"
                title="Back to conversations"
              >
                <ArrowLeftIcon />
              </button>
            ) : null}

            <ConversationAvatar
              title={
                resolvedTitle
              }
              imageUrl={
                effectiveImageUrl
              }
              online={
                effectiveOnline
              }
            />

            <div
              className="titech-conversation-header__identity"
            >
              <div className="titech-conversation-header__title-row">

                <h1
                  className="titech-conversation-header__title"
                  title={
                    resolvedTitle
                  }
                >
                  {
                    resolvedTitle
                  }
                </h1>

                {effectivePinned ? (
                  <span
                    className="titech-conversation-header__indicator"
                    title="Pinned conversation"
                    aria-label="Pinned conversation"
                  >
                    <PinIcon
                      size={14}
                    />
                  </span>
                ) : null}

              </div>


              {!mobileTitleOnly ? (
                <div
                  className="titech-conversation-header__meta"
                >

                  {typing ? (
                    <span
                      className="titech-conversation-header__typing"
                      role="status"
                      aria-live="polite"
                    >
                      Typing…
                    </span>
                  ) : resolvedSubtitle ? (
                    <span
                      className="titech-conversation-header__subtitle"
                      title={
                        resolvedSubtitle
                      }
                    >
                      {
                        resolvedSubtitle
                      }
                    </span>
                  ) : showParticipantCount &&
                    participantCount >
                      0 ? (
                    <span className="titech-conversation-header__participant-count">
                      <UsersIcon
                        size={14}
                      />

                      {formatParticipantCount(
                        participantCount,
                      )}
                    </span>
                  ) : null}


                  {showTenant &&
                  resolvedTenantName ? (
                    <>
                      <span
                        className="titech-conversation-header__separator"
                        aria-hidden="true"
                      >
                        •
                      </span>

                      <span
                        className="titech-conversation-header__tenant"
                        title={
                          resolvedTenantName
                        }
                      >
                        <BuildingIcon
                          size={13}
                        />

                        {
                          resolvedTenantName
                        }
                      </span>
                    </>
                  ) : null}


                  {showStatus &&
                  resolvedStatus ? (
                    <>
                      <span
                        className="titech-conversation-header__separator"
                        aria-hidden="true"
                      >
                        •
                      </span>

                      <StatusBadge
                        status={
                          resolvedStatus
                        }
                      />
                    </>
                  ) : null}


                  {showLastActivity &&
                  activityLabel ? (
                    <span
                      className="titech-conversation-header__activity"
                      title={
                        activityLabel
                      }
                    >
                      {activityLabel}
                    </span>
                  ) : null}

                </div>
              ) : null}

            </div>
          </div>


          {/* ================================================================
              Right actions
              ================================================================ */}

          <div
            className="titech-conversation-header__right"
          >

            {rightContent}


            {showSearch &&
            typeof onSearch ===
              'function' ? (
              <button
                type="button"
                className="titech-conversation-header__icon-button"
                onClick={() =>
                  handleAction(
                    onSearch,
                  )
                }
                disabled={
                  disabled ||
                  loading
                }
                aria-label="Search conversation"
                title="Search conversation"
              >
                <SearchIcon />
              </button>
            ) : null}


            {showRefresh &&
            typeof onRefresh ===
              'function' ? (
              <button
                type="button"
                className="titech-conversation-header__icon-button"
                onClick={() =>
                  handleAction(
                    onRefresh,
                  )
                }
                disabled={
                  disabled ||
                  loading
                }
                aria-label="Refresh conversation"
                title="Refresh conversation"
              >
                <RefreshIcon />
              </button>
            ) : null}


            {showMenu &&
            menuActions.length >
              0 ? (
              <div
                className="titech-conversation-header__menu-wrapper"
              >
                <button
                  type="button"
                  className="titech-conversation-header__icon-button"
                  onClick={
                    handleMenuToggle
                  }
                  disabled={
                    disabled ||
                    loading
                  }
                  aria-label="Conversation actions"
                  aria-haspopup="menu"
                  aria-expanded={
                    menuOpen
                  }
                  aria-controls={
                    menuOpen
                      ? menuId
                      : undefined
                  }
                  title="Conversation actions"
                >
                  <MoreIcon />
                </button>


                {menuOpen ? (
                  <div
                    id={
                      menuId
                    }
                    role="menu"
                    aria-label="Conversation actions"
                    className="titech-conversation-header__menu"
                  >
                    {menuActions.map(
                      (
                        action,
                      ) => (
                        <ActionButton
                          key={
                            action.key
                          }
                          icon={
                            action.icon ||
                            null
                          }
                          label={
                            action.label
                          }
                          onClick={() =>
                            handleAction(
                              action.onClick,
                            )
                          }
                          disabled={
                            action.disabled
                          }
                          danger={
                            action.danger
                          }
                        />
                      ),
                    )}

                    {typeof onClose ===
                    'function' ? (
                      <>
                        <div
                          className="titech-conversation-header__menu-divider"
                        />

                        <ActionButton
                          icon={
                            <CloseIcon
                              size={16}
                            />
                          }
                          label="Close conversation"
                          onClick={() =>
                            handleAction(
                              () =>
                                onClose(
                                  conversation,
                                ),
                            )
                          }
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>


          {/* ================================================================
              Loading indicator
              ================================================================ */}

          {loading ? (
            <div
              className="titech-conversation-header__loading-indicator"
              role="progressbar"
              aria-label="Loading conversation"
              aria-valuetext="Loading conversation"
            />
          ) : null}

        </header>
      );
    },
  );


/* ============================================================================
 * Display name
 * ========================================================================== */

ConversationHeader.displayName =
  'TITechConversationHeader';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ConversationHeader.propTypes = {
  conversation:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      title:
        PropTypes.string,

      name:
        PropTypes.string,

      subject:
        PropTypes.string,

      description:
        PropTypes.string,

      subtitle:
        PropTypes.string,

      tenantName:
        PropTypes.string,

      organizationName:
        PropTypes.string,

      participantCount:
        PropTypes.number,

      status:
        PropTypes.string,

      pinned:
        PropTypes.bool,

      archived:
        PropTypes.bool,

      online:
        PropTypes.bool,

      imageUrl:
        PropTypes.string,

      avatarUrl:
        PropTypes.string,

      lastMessageAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.instanceOf(
            Date,
          ),
        ]),

      updatedAt:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.instanceOf(
            Date,
          ),
        ]),
    }),

  tenant:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      name:
        PropTypes.string,

      tenantName:
        PropTypes.string,

      organizationName:
        PropTypes.string,
    }),

  participants:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  loading:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.instance,
    ]),

  online:
    PropTypes.bool,

  typing:
    PropTypes.bool,

  status:
    PropTypes.string,

  pinned:
    PropTypes.bool,

  archived:
    PropTypes.bool,

  showBack:
    PropTypes.bool,

  showTenant:
    PropTypes.bool,

  showParticipantCount:
    PropTypes.bool,

  showStatus:
    PropTypes.bool,

  showLastActivity:
    PropTypes.bool,

  showSearch:
    PropTypes.bool,

  showRefresh:
    PropTypes.bool,

  showMenu:
    PropTypes.bool,

  onBack:
    PropTypes.func,

  onSearch:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  onNewConversation:
    PropTypes.func,

  onPin:
    PropTypes.func,

  onArchive:
    PropTypes.func,

  onUnarchive:
    PropTypes.func,

  onClose:
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

  rightContent:
    PropTypes.node,

  title:
    PropTypes.string,

  subtitle:
    PropTypes.string,

  imageUrl:
    PropTypes.string,

  className:
    PropTypes.string,

  compact:
    PropTypes.bool,

  mobileTitleOnly:
    PropTypes.bool,

  ariaLabel:
    PropTypes.string,

  id:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

ConversationHeader.defaultProps = {
  conversation:
    null,

  tenant:
    null,

  participants:
    [],

  loading:
    false,

  disabled:
    false,

  error:
    null,

  online:
    false,

  typing:
    false,

  status:
    undefined,

  pinned:
    false,

  archived:
    false,

  showBack:
    false,

  showTenant:
    true,

  showParticipantCount:
    true,

  showStatus:
    true,

  showLastActivity:
    false,

  showSearch:
    true,

  showRefresh:
    true,

  showMenu:
    true,

  onBack:
    undefined,

  onSearch:
    undefined,

  onRefresh:
    undefined,

  onNewConversation:
    undefined,

  onPin:
    undefined,

  onArchive:
    undefined,

  onUnarchive:
    undefined,

  onClose:
    undefined,

  customActions:
    [],

  rightContent:
    null,

  title:
    undefined,

  subtitle:
    undefined,

  imageUrl:
    undefined,

  className:
    '',

  compact:
    false,

  mobileTitleOnly:
    false,

  ariaLabel:
    'Conversation header',

  id:
    undefined,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ConversationAvatar,
  StatusBadge,
  formatActivity,
  getConversationTitle,
  getInitials,
  getParticipantCount,
  getTenantName,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ConversationHeader;