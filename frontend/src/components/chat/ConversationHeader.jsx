'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation Header
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ConversationHeader.jsx
 *
 * Purpose:
 *   Enterprise-grade conversation header for TITech Community Capital's
 *   messaging platform.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Conversation title and subtitle
 * ✓ Tenant / organization context
 * ✓ Participant count
 * ✓ Online state
 * ✓ Typing state
 * ✓ Conversation status
 * ✓ Pinned state
 * ✓ Archived state
 * ✓ Back navigation
 * ✓ Search
 * ✓ Refresh
 * ✓ New conversation
 * ✓ Conversation actions menu
 * ✓ Pin / unpin
 * ✓ Archive / restore
 * ✓ Close conversation
 * ✓ Custom actions
 * ✓ Loading state
 * ✓ Error state
 * ✓ Responsive presentation
 * ✓ Keyboard interaction
 * ✓ Accessible menu semantics
 * ✓ Focus management
 * ✓ Defensive data handling
 * ✓ Ref API
 * ✓ No external icon dependency
 * ✓ TITech branding consistency
 *
 * Security / architecture
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - perform authorization
 *   - enforce tenant security
 *   - execute financial transactions
 *   - determine loan eligibility
 *   - perform fraud decisions
 *   - modify authoritative financial records
 *
 * Those responsibilities belong to TITech's trusted service/API layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import './conversation-header.css';


/* ============================================================================
 * Utilities
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
    const result =
      String(value).trim();

    return result ||
      fallback;
  } catch {
    return fallback;
  }
};


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

  const count =
    Number(
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


const formatParticipantCount =
  (
    count,
  ) =>
    count === 1
      ? '1 participant'
      : `${count} participants`;


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
    words.length === 0
  ) {
    return 'TI';
  }

  if (
    words.length === 1
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


const formatActivity = (
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

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle:
          'medium',
        timeStyle:
          'short',
      },
    ).format(date);
  } catch {
    return '';
  }
};


/* ============================================================================
 * Icon system
 * ========================================================================== */

const Icon = ({
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
  <Icon {...props}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Icon>
);


const SearchIcon = (
  props,
) => (
  <Icon {...props}>
    <circle
      cx="11"
      cy="11"
      r="7"
    />
    <path d="m20 20-4-4" />
  </Icon>
);


const RefreshIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </Icon>
);


const MoreIcon = (
  props,
) => (
  <Icon {...props}>
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
  </Icon>
);


const UsersIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle
      cx="9"
      cy="7"
      r="4"
    />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);


const BuildingIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="M3 21h18" />
    <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
    <path d="M15 21V9a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v12" />
    <path d="M8 7h2" />
    <path d="M8 11h2" />
    <path d="M8 15h2" />
  </Icon>
);


const PinIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="m12 17 5-5" />
    <path d="m9 14 7-7 3 3-7 7" />
    <path d="M5 19 2 22" />
    <path d="M8 16 3 11l5 5" />
  </Icon>
);


const ArchiveIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="M4 4h16v4H4z" />
    <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M9 12h6" />
  </Icon>
);


const CloseIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </Icon>
);


const PlusIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);


/* ============================================================================
 * Avatar
 * ========================================================================== */

const ConversationAvatar = ({
  title,
  imageUrl,
  online = false,
}) => {
  const [
    imageFailed,
    setImageFailed,
  ] = useState(
    false,
  );

  const showImage =
    Boolean(
      imageUrl,
    ) &&
    !imageFailed;

  return (
    <div
      className="titech-conversation-header__avatar-wrapper"
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          className="titech-conversation-header__avatar-image"
          loading="lazy"
          decoding="async"
          onError={() =>
            setImageFailed(
              true,
            )
          }
        />
      ) : (
        <span className="titech-conversation-header__avatar-fallback">
          {getInitials(
            title,
          )}
        </span>
      )}

      {online ? (
        <span
          className="titech-conversation-header__online-indicator"
          title="Online"
        />
      ) : null}
    </div>
  );
};


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
    )
      .toLowerCase()
      .replace(
        /\s+/g,
        '-',
      );

  const label =
    safeText(
      status,
    )
      .replace(
        /[_-]+/g,
        ' ',
      )
      .replace(
        /\b\w/g,
        (
          character,
        ) =>
          character.toUpperCase(),
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

        title,

        subtitle,

        imageUrl,

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

        showNewConversation =
          false,

        compact =
          false,

        mobileTitleOnly =
          false,

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

        className =
          '',

        ariaLabel =
          'TITech conversation header',

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
        `${headerId}-actions`;

      const rootRef =
        useRef(null);

      const [
        menuOpen,
        setMenuOpen,
      ] = useState(
        false,
      );

      const [
        focusableIndex,
        setFocusableIndex,
      ] = useState(
        -1,
      );

      const resolvedTitle =
        safeText(
          title ||
            getConversationTitle(
              conversation,
            ),
          'TITech Conversation',
        );

      const resolvedSubtitle =
        safeText(
          subtitle ||
            conversation?.subtitle ||
            conversation?.description,
        );

      const tenantName =
        getTenantName(
          tenant,
          conversation,
        );

      const participantCount =
        getParticipantCount(
          conversation,
          participants,
        );

      const resolvedStatus =
        status ||
        conversation?.status;

      const resolvedPinned =
        pinned ||
        Boolean(
          conversation?.pinned,
        );

      const resolvedArchived =
        archived ||
        Boolean(
          conversation?.archived,
        );

      const resolvedOnline =
        online ||
        Boolean(
          conversation?.online,
        );

      const resolvedImage =
        imageUrl ||
        conversation?.imageUrl ||
        conversation?.avatarUrl ||
        conversation?.image;

      const activity =
        formatActivity(
          conversation?.lastMessageAt ||
            conversation?.updatedAt ||
            conversation?.lastActivityAt,
        );

      /* ======================================================================
       * Menu lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          if (!menuOpen) {
            setFocusableIndex(
              -1,
            );

            return undefined;
          }

          const handlePointerDown =
            (
              event,
            ) => {
              if (
                rootRef.current &&
                !rootRef.current.contains(
                  event.target,
                )
              ) {
                setMenuOpen(
                  false,
                );
              }
            };

          const handleEscape =
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
            'mousedown',
            handlePointerDown,
          );

          document.addEventListener(
            'keydown',
            handleEscape,
          );

          return () => {
            document.removeEventListener(
              'mousedown',
              handlePointerDown,
            );

            document.removeEventListener(
              'keydown',
              handleEscape,
            );
          };
        },
        [
          menuOpen,
        ],
      );

      /* ======================================================================
       * Ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          openMenu() {
            if (
              !disabled &&
              !loading
            ) {
              setMenuOpen(
                true,
              );
            }
          },

          closeMenu() {
            setMenuOpen(
              false,
            );
          },

          toggleMenu() {
            if (
              !disabled &&
              !loading
            ) {
              setMenuOpen(
                (
                  current,
                ) =>
                  !current,
              );
            }
          },

          focus() {
            rootRef.current?.focus();
          },
        }),
        [
          disabled,
          loading,
        ],
      );

      /* ======================================================================
       * Menu actions
       * ==================================================================== */

      const actions =
        [];

      if (
        showNewConversation &&
        typeof onNewConversation ===
          'function'
      ) {
        actions.push({
          key:
            'new-conversation',

          label:
            'New conversation',

          icon: (
            <PlusIcon
              size={16}
            />
          ),

          onClick:
            () =>
              onNewConversation(),
        });
      }

      if (
        typeof onPin ===
        'function'
      ) {
        actions.push({
          key:
            'pin',

          label:
            resolvedPinned
              ? 'Unpin conversation'
              : 'Pin conversation',

          icon: (
            <PinIcon
              size={16}
            />
          ),

          onClick:
            () =>
              onPin(
                conversation,
                !resolvedPinned,
              ),
        });
      }

      if (
        resolvedArchived &&
        typeof onUnarchive ===
          'function'
      ) {
        actions.push({
          key:
            'restore',

          label:
            'Restore conversation',

          icon: (
            <ArchiveIcon
              size={16}
            />
          ),

          onClick:
            () =>
              onUnarchive(
                conversation,
              ),
        });
      } else if (
        !resolvedArchived &&
        typeof onArchive ===
          'function'
      ) {
        actions.push({
          key:
            'archive',

          label:
            'Archive conversation',

          icon: (
            <ArchiveIcon
              size={16}
            />
          ),

          onClick:
            () =>
              onArchive(
                conversation,
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

            if (
              !safeText(
                action.label,
              )
            ) {
              return;
            }

            actions.push({
              key:
                action.id ||
                action.key ||
                `custom-${index}`,

              label:
                safeText(
                  action.label,
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

              onClick:
                () =>
                  action.onClick?.(
                    conversation,
                  ),
            });
          },
        );
      }

      if (
        typeof onClose ===
        'function'
      ) {
        actions.push({
          key:
            'close',

          label:
            'Close conversation',

          icon: (
            <CloseIcon
              size={16}
            />
          ),

          onClick:
            () =>
              onClose(
                conversation,
              ),

          danger:
            false,
        });
      }

      /* ======================================================================
       * Menu keyboard navigation
       * ==================================================================== */

      const handleMenuKeyDown =
        (
          event,
        ) => {
          if (
            !menuOpen ||
            actions.length ===
              0
          ) {
            return;
          }

          if (
            event.key ===
            'ArrowDown'
          ) {
            event.preventDefault();

            setFocusableIndex(
              (
                current,
              ) =>
                current >=
                actions.length - 1
                  ? 0
                  : current + 1,
            );

            return;
          }

          if (
            event.key ===
            'ArrowUp'
          ) {
            event.preventDefault();

            setFocusableIndex(
              (
                current,
              ) =>
                current <=
                0
                  ? actions.length - 1
                  : current - 1,
            );

            return;
          }

          if (
            event.key ===
            'Home'
          ) {
            event.preventDefault();

            setFocusableIndex(
              0,
            );

            return;
          }

          if (
            event.key ===
            'End'
          ) {
            event.preventDefault();

            setFocusableIndex(
              actions.length -
                1,
            );

            return;
          }

          if (
            event.key ===
            'Enter' &&
            focusableIndex >=
              0
          ) {
            event.preventDefault();

            const selected =
              actions[
                focusableIndex
              ];

            if (
              selected &&
              !selected.disabled
            ) {
              setMenuOpen(
                false,
              );

              selected.onClick?.();
            }
          }
        };

      /* ======================================================================
       * Menu focus
       * ==================================================================== */

      useEffect(
        () => {
          if (
            !menuOpen ||
            focusableIndex < 0
          ) {
            return;
          }

          const buttons =
            rootRef.current?.querySelectorAll(
              '[role="menuitem"]',
            );

          buttons?.[
            focusableIndex
          ]?.focus();
        },
        [
          menuOpen,
          focusableIndex,
        ],
      );

      const handleAction =
        (
          action,
        ) => {
          if (
            typeof action !==
            'function'
          ) {
            return;
          }

          setMenuOpen(
            false,
          );

          action();
        };

      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <header
          {...rest}
          ref={
            rootRef
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
          tabIndex={
            -1
          }
          aria-label={
            ariaLabel
          }
        >

          {/* =================================================================
              Back navigation
              ================================================================= */}

          <div className="titech-conversation-header__leading">

            {showBack &&
            typeof onBack ===
              'function' ? (
              <button
                type="button"
                className="titech-conversation-header__icon-button"
                onClick={() =>
                  onBack(
                    conversation,
                  )
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


            {/* =============================================================
                Conversation avatar
                ============================================================= */}

            <ConversationAvatar
              title={
                resolvedTitle
              }
              imageUrl={
                resolvedImage
              }
              online={
                resolvedOnline
              }
            />


            {/* =============================================================
                Identity
                ============================================================= */}

            <div className="titech-conversation-header__identity">

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

                {resolvedPinned ? (
                  <span
                    className="titech-conversation-header__pinned-indicator"
                    aria-label="Pinned conversation"
                    title="Pinned conversation"
                  >
                    <PinIcon
                      size={14}
                    />
                  </span>
                ) : null}

              </div>


              {!mobileTitleOnly ? (
                <div className="titech-conversation-header__metadata">

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
                  ) : null}


                  {showParticipantCount &&
                  participantCount >
                    0 ? (
                    <>
                      {resolvedSubtitle ? (
                        <span
                          className="titech-conversation-header__separator"
                          aria-hidden="true"
                        >
                          •
                        </span>
                      ) : null}

                      <span className="titech-conversation-header__participant-count">
                        <UsersIcon
                          size={14}
                        />

                        {formatParticipantCount(
                          participantCount,
                        )}
                      </span>
                    </>
                  ) : null}


                  {showTenant &&
                  tenantName ? (
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
                          tenantName
                        }
                      >
                        <BuildingIcon
                          size={13}
                        />

                        {
                          tenantName
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
                  activity ? (
                    <>
                      <span
                        className="titech-conversation-header__separator"
                        aria-hidden="true"
                      >
                        •
                      </span>

                      <time
                        className="titech-conversation-header__activity"
                        dateTime={
                          conversation?.lastMessageAt ||
                          conversation?.updatedAt ||
                          conversation?.lastActivityAt ||
                          undefined
                        }
                        title={
                          activity
                        }
                      >
                        {
                          activity
                        }
                      </time>
                    </>
                  ) : null}

                </div>
              ) : null}

            </div>
          </div>


          {/* =================================================================
              Right side
              ================================================================= */}

          <div className="titech-conversation-header__actions">

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
            actions.length >
              0 ? (
              <div
                className="titech-conversation-header__menu-wrapper"
              >

                <button
                  type="button"
                  className="titech-conversation-header__icon-button"
                  onClick={() => {
                    if (
                      disabled ||
                      loading
                    ) {
                      return;
                    }

                    setMenuOpen(
                      (
                        current,
                      ) =>
                        !current,
                    );

                    setFocusableIndex(
                      -1,
                    );
                  }}
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
                    className="titech-conversation-header__menu"
                    role="menu"
                    aria-label="Conversation actions"
                    onKeyDown={
                      handleMenuKeyDown
                    }
                  >
                    {actions.map(
                      (
                        action,
                        index,
                      ) => (
                        <button
                          key={
                            action.key ||
                            index
                          }
                          type="button"
                          role="menuitem"
                          className={cn(
                            'titech-conversation-header__menu-item',
                            action.danger &&
                              'titech-conversation-header__menu-item--danger',
                          )}
                          disabled={
                            action.disabled
                          }
                          onClick={() =>
                            handleAction(
                              action.onClick,
                            )
                          }
                        >
                          {action.icon ? (
                            <span className="titech-conversation-header__menu-item-icon">
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

              </div>
            ) : null}

          </div>


          {/* =================================================================
              Loading indicator
              ================================================================= */}

          {loading ? (
            <div
              className="titech-conversation-header__loading-indicator"
              role="progressbar"
              aria-label="Loading conversation"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuetext="Loading conversation"
            />
          ) : null}

        </header>
      );
    },
  );


/* ============================================================================
 * Metadata
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

      conversationTitle:
        PropTypes.string,

      subtitle:
        PropTypes.string,

      description:
        PropTypes.string,

      tenantName:
        PropTypes.string,

      organizationName:
        PropTypes.string,

      participantCount:
        PropTypes.number,

      participantsCount:
        PropTypes.number,

      status:
        PropTypes.string,

      pinned:
        PropTypes.bool,

      archived:
        PropTypes.bool,

      online:
        PropTypes.bool,

      image:
        PropTypes.string,

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

      lastActivityAt:
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
      PropTypes.object,
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

  title:
    PropTypes.string,

  subtitle:
    PropTypes.string,

  imageUrl:
    PropTypes.string,

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

  showNewConversation:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  mobileTitleOnly:
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

  className:
    PropTypes.string,

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

  title:
    undefined,

  subtitle:
    undefined,

  imageUrl:
    undefined,

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

  showNewConversation:
    false,

  compact:
    false,

  mobileTitleOnly:
    false,

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

  className:
    '',

  ariaLabel:
    'TITech conversation header',

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