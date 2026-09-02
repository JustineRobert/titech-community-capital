'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation Item
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ConversationItem.js
 *
 * Purpose:
 *   Production-grade reusable conversation item for the TITech Community
 *   Capital messaging experience.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Active conversation state
 * ✓ Unread state
 * ✓ Unread count badge
 * ✓ Conversation title
 * ✓ Message preview
 * ✓ Timestamp
 * ✓ Participant count
 * ✓ Tenant / organization context
 * ✓ Online state
 * ✓ Pinned state
 * ✓ Archived state
 * ✓ Selection state
 * ✓ Keyboard accessibility
 * ✓ Enter / Space activation
 * ✓ Delete action
 * ✓ Archive / restore action
 * ✓ Pin / unpin action
 * ✓ More-actions menu
 * ✓ Loading state
 * ✓ Disabled state
 * ✓ Safe text handling
 * ✓ Defensive data handling
 * ✓ Screen-reader labels
 * ✓ Responsive presentation
 * ✓ Ref forwarding
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This is a presentation and interaction component.
 *
 * It MUST NOT:
 *   - determine authorization
 *   - enforce tenant isolation
 *   - perform financial operations
 *   - calculate loan eligibility
 *   - make fraud decisions
 *   - modify authoritative financial records
 *
 * Those responsibilities remain in the trusted TITech service/API layers.
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
    const result =
      String(value).trim();

    return result ||
      fallback;
  } catch {
    return fallback;
  }
};


const getTitle = (
  conversation,
) =>
  safeText(
    conversation?.title ||
      conversation?.name ||
      conversation?.subject ||
      conversation?.conversationTitle,
    'TITech Conversation',
  );


const getPreview = (
  conversation,
) =>
  safeText(
    conversation?.preview ||
      conversation?.lastMessage ||
      conversation?.lastMessageText ||
      conversation?.latestMessage ||
      conversation?.messagePreview,
  );


const getTenantName = (
  conversation,
  tenant,
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


const getConversationTimestamp =
  (
    conversation,
  ) =>
    conversation?.lastMessageAt ||
    conversation?.updatedAt ||
    conversation?.lastActivityAt ||
    null;


const formatTimestamp = (
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


const formatRelativeTimestamp =
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

    const difference =
      Date.now() -
      date.getTime();

    const minute =
      60 * 1000;

    const hour =
      60 * minute;

    const day =
      24 * hour;

    if (
      difference <
      minute
    ) {
      return 'Just now';
    }

    if (
      difference <
      hour
    ) {
      return `${Math.floor(
        difference / minute,
      )}m`;
    }

    if (
      difference <
      day
    ) {
      return `${Math.floor(
        difference / hour,
      )}h`;
    }

    if (
      difference <
      7 * day
    ) {
      return `${Math.floor(
        difference / day,
      )}d`;
    }

    return formatTimestamp(
      value,
    );
  };


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


/**
 * Format unread count with a safe display cap.
 */
const formatUnreadCount = (
  count,
) => {
  const numericCount =
    Number(count);

  if (
    !Number.isFinite(
      numericCount,
    ) ||
    numericCount <= 0
  ) {
    return '';
  }

  if (
    numericCount >
    99
  ) {
    return '99+';
  }

  return String(
    Math.floor(
      numericCount,
    ),
  );
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const Icon = ({
  children,
  size = 16,
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


const DeleteIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="M4 7h16" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V4h6v3" />
  </Icon>
);


const CheckIcon = (
  props,
) => (
  <Icon {...props}>
    <path d="m5 12 4 4 10-10" />
  </Icon>
);


/* ============================================================================
 * Avatar
 * ========================================================================== */

const ConversationAvatar = ({
  title,
  imageUrl,
  online = false,
  unread = false,
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
      className="titech-conversation-item__avatar-wrapper"
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          className="titech-conversation-item__avatar-image"
          loading="lazy"
          decoding="async"
          onError={() =>
            setImageFailed(
              true,
            )
          }
        />
      ) : (
        <span className="titech-conversation-item__avatar-fallback">
          {getInitials(
            title,
          )}
        </span>
      )}

      {online ? (
        <span
          className={cn(
            'titech-conversation-item__online-indicator',
            unread &&
              'titech-conversation-item__online-indicator--unread',
          )}
          title="Online"
        />
      ) : null}
    </div>
  );
};


/* ============================================================================
 * ConversationItem
 * ========================================================================== */

const ConversationItem =
  forwardRef(
    function ConversationItem(
      {
        conversation =
          null,

        tenant =
          null,

        participants =
          [],

        active =
          false,

        selected =
          false,

        unread =
          false,

        unreadCount,

        pinned =
          false,

        archived =
          false,

        online =
          false,

        disabled =
          false,

        loading =
          false,

        compact =
          false,

        showPreview =
          true,

        showTimestamp =
          true,

        showParticipantCount =
          false,

        showTenant =
          false,

        showActions =
          true,

        showUnreadBadge =
          true,

        showAvatar =
          true,

        showOnline =
          true,

        onSelect,

        onDelete,

        onArchive,

        onUnarchive,

        onPin,

        customActions =
          [],

        className =
          '',

        ariaLabel,

        id,

        testId =
          'titech-conversation-item',

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const itemId =
        id ||
        `titech-conversation-item-${generatedId}`;

      const rootRef =
        useRef(null);

      const [
        menuOpen,
        setMenuOpen,
      ] = useState(
        false,
      );

      const [
        actionFocusIndex,
        setActionFocusIndex,
      ] = useState(
        -1,
      );

      const resolvedTitle =
        getTitle(
          conversation,
        );

      const resolvedPreview =
        getPreview(
          conversation,
        );

      const tenantName =
        getTenantName(
          conversation,
          tenant,
        );

      const participantCount =
        getParticipantCount(
          conversation,
          participants,
        );

      const timestamp =
        getConversationTimestamp(
          conversation,
        );

      const relativeTime =
        formatRelativeTimestamp(
          timestamp,
        );

      const accessibleTimestamp =
        formatTimestamp(
          timestamp,
        );

      const resolvedUnreadCount =
        unreadCount ??
        conversation?.unreadCount ??
        conversation?.unreadMessages ??
        0;

      const hasUnread =
        unread ||
        Number(
          resolvedUnreadCount,
        ) >
          0 ||
        Boolean(
          conversation?.unread,
        );

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

      const imageUrl =
        conversation?.imageUrl ||
        conversation?.avatarUrl ||
        conversation?.image;

      const unreadLabel =
        formatUnreadCount(
          resolvedUnreadCount,
        );

      /* ======================================================================
       * Action definitions
       * ==================================================================== */

      const actions = [];

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
              size={15}
            />
          ),

          onClick: () =>
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
              size={15}
            />
          ),

          onClick: () =>
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
              size={15}
            />
          ),

          onClick: () =>
            onArchive(
              conversation,
            ),
        });
      }

      if (
        typeof onDelete ===
        'function'
      ) {
        actions.push({
          key:
            'delete',

          label:
            'Delete conversation',

          icon: (
            <DeleteIcon
              size={15}
            />
          ),

          danger:
            true,

          onClick: () =>
            onDelete(
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

            const label =
              safeText(
                action.label,
              );

            if (!label) {
              return;
            }

            actions.push({
              key:
                action.id ||
                action.key ||
                `custom-${index}`,

              label,

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

              onClick: () =>
                action.onClick?.(
                  conversation,
                ),
            });
          },
        );
      }

      /* ======================================================================
       * Menu lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          if (!menuOpen) {
            setActionFocusIndex(
              -1,
            );

            return undefined;
          }

          const handleOutside =
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
            handleOutside,
          );

          document.addEventListener(
            'keydown',
            handleEscape,
          );

          return () => {
            document.removeEventListener(
              'mousedown',
              handleOutside,
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
       * Public ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          openActions() {
            if (
              !disabled &&
              !loading &&
              actions.length >
                0
            ) {
              setMenuOpen(
                true,
              );
            }
          },

          closeActions() {
            setMenuOpen(
              false,
            );
          },
        }),
        [
          actions.length,
          disabled,
          loading,
        ],
      );


      /* ======================================================================
       * Selection handler
       * ==================================================================== */

      const handleSelect =
        () => {
          if (
            disabled ||
            loading
          ) {
            return;
          }

          setMenuOpen(
            false,
          );

          onSelect?.(
            conversation,
          );
        };


      /* ======================================================================
       * Keyboard interaction
       * ==================================================================== */

      const handleKeyDown =
        (
          event,
        ) => {
          if (
            event.key ===
            'Enter' ||
            event.key ===
            ' '
          ) {
            event.preventDefault();

            handleSelect();

            return;
          }

          if (
            event.key ===
            'ArrowRight' &&
            actions.length >
              0
          ) {
            event.preventDefault();

            setMenuOpen(
              true,
            );

            setActionFocusIndex(
              0,
            );
          }
        };


      const handleMenuKeyDown =
        (
          event,
        ) => {
          if (
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

            setActionFocusIndex(
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

            setActionFocusIndex(
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

            setActionFocusIndex(
              0,
            );

            return;
          }

          if (
            event.key ===
            'End'
          ) {
            event.preventDefault();

            setActionFocusIndex(
              actions.length -
                1,
            );

            return;
          }

          if (
            event.key ===
            'Enter' ||
            event.key ===
            ' '
          ) {
            event.preventDefault();

            const action =
              actions[
                actionFocusIndex
              ];

            if (
              action &&
              !action.disabled
            ) {
              setMenuOpen(
                false,
              );

              action.onClick?.();
            }

            return;
          }

          if (
            event.key ===
            'Escape'
          ) {
            event.preventDefault();

            setMenuOpen(
              false,
            );

            rootRef.current?.focus();
          }
        };


      /* ======================================================================
       * Menu item focus
       * ==================================================================== */

      useEffect(
        () => {
          if (
            !menuOpen ||
            actionFocusIndex <
              0
          ) {
            return;
          }

          const menuItems =
            rootRef.current?.querySelectorAll(
              '[role="menuitem"]',
            );

          menuItems?.[
            actionFocusIndex
          ]?.focus();
        },
        [
          menuOpen,
          actionFocusIndex,
        ],
      );


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <article
          {...rest}
          ref={
            rootRef
          }
          id={
            itemId
          }
          className={cn(
            'titech-conversation-item',

            active &&
              'titech-conversation-item--active',

            selected &&
              'titech-conversation-item--selected',

            hasUnread &&
              'titech-conversation-item--unread',

            resolvedPinned &&
              'titech-conversation-item--pinned',

            resolvedArchived &&
              'titech-conversation-item--archived',

            compact &&
              'titech-conversation-item--compact',

            disabled &&
              'titech-conversation-item--disabled',

            loading &&
              'titech-conversation-item--loading',

            className,
          )}
          tabIndex={
            disabled ||
            loading
              ? -1
              : 0
          }
          role="button"
          aria-label={
            ariaLabel ||
            `${resolvedTitle}${
              hasUnread
                ? ', unread'
                : ''
            }`
          }
          aria-current={
            active
              ? 'true'
              : undefined
          }
          aria-selected={
            selected
              ? true
              : undefined
          }
          onClick={
            handleSelect
          }
          onKeyDown={
            handleKeyDown
          }
          data-testid={
            testId
          }
          data-conversation-id={
            conversation?.id ||
            undefined
          }
        >

          {/* ================================================================
              Avatar
              ================================================================ */}

          {showAvatar ? (
            <ConversationAvatar
              title={
                resolvedTitle
              }
              imageUrl={
                imageUrl
              }
              online={
                showOnline &&
                resolvedOnline
              }
              unread={
                hasUnread
              }
            />
          ) : null}


          {/* ================================================================
              Main content
              ================================================================ */}

          <div className="titech-conversation-item__content">

            {/* --------------------------------------------------------------
                Top row
                -------------------------------------------------------------- */}

            <div className="titech-conversation-item__top-row">

              <div className="titech-conversation-item__title-wrapper">

                <span
                  className="titech-conversation-item__title"
                  title={
                    resolvedTitle
                  }
                >
                  {
                    resolvedTitle
                  }
                </span>

                {resolvedPinned ? (
                  <span
                    className="titech-conversation-item__pin-indicator"
                    aria-label="Pinned conversation"
                    title="Pinned conversation"
                  >
                    <PinIcon
                      size={13}
                    />
                  </span>
                ) : null}

              </div>


              {showTimestamp &&
              relativeTime ? (
                <time
                  className="titech-conversation-item__timestamp"
                  dateTime={
                    timestamp ||
                    undefined
                  }
                  title={
                    formatTimestamp(
                      timestamp,
                    )
                  }
                >
                  {
                    relativeTime
                  }
                </time>
              ) : null}

            </div>


            {/* --------------------------------------------------------------
                Preview row
                -------------------------------------------------------------- */}

            {showPreview &&
            resolvedPreview ? (
              <div className="titech-conversation-item__preview-row">

                <span
                  className="titech-conversation-item__preview"
                  title={
                    resolvedPreview
                  }
                >
                  {
                    resolvedPreview
                  }
                </span>

                {hasUnread &&
                showUnreadBadge &&
                unreadLabel ? (
                  <span
                    className="titech-conversation-item__unread-badge"
                    aria-label={`${unreadLabel} unread messages`}
                  >
                    {
                      unreadLabel
                    }
                  </span>
                ) : null}

              </div>
            ) : null}


            {/* --------------------------------------------------------------
                Metadata
                -------------------------------------------------------------- */}

            {(showTenant &&
              tenantName) ||
            (showParticipantCount &&
              participantCount >
                0) ? (
              <div className="titech-conversation-item__metadata">

                {showTenant &&
                tenantName ? (
                  <span
                    className="titech-conversation-item__tenant"
                    title={
                      tenantName
                    }
                  >
                    {
                      tenantName
                    }
                  </span>
                ) : null}

                {showTenant &&
                tenantName &&
                showParticipantCount &&
                participantCount >
                  0 ? (
                  <span
                    className="titech-conversation-item__separator"
                    aria-hidden="true"
                  >
                    •
                  </span>
                ) : null}

                {showParticipantCount &&
                participantCount >
                  0 ? (
                  <span className="titech-conversation-item__participants">
                    {participantCount ===
                    1
                      ? '1 participant'
                      : `${participantCount} participants`}
                  </span>
                ) : null}

              </div>
            ) : null}

          </div>


          {/* ================================================================
              Actions
              ================================================================ */}

          {showActions &&
          actions.length >
            0 ? (
            <div
              className="titech-conversation-item__actions"
              onClick={(
                event,
              ) =>
                event.stopPropagation()
              }
            >

              <button
                type="button"
                className="titech-conversation-item__action-button"
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

                  setActionFocusIndex(
                    -1,
                  );
                }}
                disabled={
                  disabled ||
                  loading
                }
                aria-label={`Actions for ${resolvedTitle}`}
                aria-haspopup="menu"
                aria-expanded={
                  menuOpen
                }
                title="Conversation actions"
              >
                <MoreIcon />
              </button>


              {menuOpen ? (
                <div
                  className="titech-conversation-item__menu"
                  role="menu"
                  aria-label={`Actions for ${resolvedTitle}`}
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
                          'titech-conversation-item__menu-item',
                          action.danger &&
                            'titech-conversation-item__menu-item--danger',
                        )}
                        disabled={
                          action.disabled
                        }
                        onClick={() => {
                          setMenuOpen(
                            false,
                          );

                          action.onClick?.();
                        }}
                      >
                        {action.icon ? (
                          <span className="titech-conversation-item__menu-icon">
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

                        {action.key ===
                        'pin' &&
                        resolvedPinned ? (
                          <CheckIcon
                            size={14}
                          />
                        ) : null}
                      </button>
                    ),
                  )}
                </div>
              ) : null}

            </div>
          ) : null}


          {/* ================================================================
              Loading indicator
              ================================================================ */}

          {loading ? (
            <span
              className="titech-conversation-item__loading"
              role="status"
              aria-label="Loading conversation"
            />
          ) : null}

        </article>
      );
    },
  );


/* ============================================================================
 * Component metadata
 * ========================================================================== */

ConversationItem.displayName =
  'TITechConversationItem';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ConversationItem.propTypes = {
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

      preview:
        PropTypes.string,

      lastMessage:
        PropTypes.string,

      lastMessageText:
        PropTypes.string,

      latestMessage:
        PropTypes.string,

      messagePreview:
        PropTypes.string,

      tenantName:
        PropTypes.string,

      organizationName:
        PropTypes.string,

      participantCount:
        PropTypes.number,

      participantsCount:
        PropTypes.number,

      unreadCount:
        PropTypes.number,

      unreadMessages:
        PropTypes.number,

      unread:
        PropTypes.bool,

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

  active:
    PropTypes.bool,

  selected:
    PropTypes.bool,

  unread:
    PropTypes.bool,

  unreadCount:
    PropTypes.number,

  pinned:
    PropTypes.bool,

  archived:
    PropTypes.bool,

  online:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  showPreview:
    PropTypes.bool,

  showTimestamp:
    PropTypes.bool,

  showParticipantCount:
    PropTypes.bool,

  showTenant:
    PropTypes.bool,

  showActions:
    PropTypes.bool,

  showUnreadBadge:
    PropTypes.bool,

  showAvatar:
    PropTypes.bool,

  showOnline:
    PropTypes.bool,

  onSelect:
    PropTypes.func,

  onDelete:
    PropTypes.func,

  onArchive:
    PropTypes.func,

  onUnarchive:
    PropTypes.func,

  onPin:
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

  className:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  id:
    PropTypes.string,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

ConversationItem.defaultProps = {
  conversation:
    null,

  tenant:
    null,

  participants:
    [],

  active:
    false,

  selected:
    false,

  unread:
    false,

  unreadCount:
    undefined,

  pinned:
    false,

  archived:
    false,

  online:
    false,

  disabled:
    false,

  loading:
    false,

  compact:
    false,

  showPreview:
    true,

  showTimestamp:
    true,

  showParticipantCount:
    false,

  showTenant:
    false,

  showActions:
    true,

  showUnreadBadge:
    true,

  showAvatar:
    true,

  showOnline:
    true,

  onSelect:
    undefined,

  onDelete:
    undefined,

  onArchive:
    undefined,

  onUnarchive:
    undefined,

  onPin:
    undefined,

  customActions:
    [],

  className:
    '',

  ariaLabel:
    undefined,

  id:
    undefined,

  testId:
    'titech-conversation-item',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ConversationAvatar,
  formatRelativeTimestamp,
  formatTimestamp,
  formatUnreadCount,
  getInitials,
  getParticipantCount,
  getPreview,
  getTenantName,
  getTitle,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ConversationItem;