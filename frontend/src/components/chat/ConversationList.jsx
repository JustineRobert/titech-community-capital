'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation List
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ConversationList.jsx
 *
 * Purpose:
 *   Enterprise-grade conversation collection/list for the TITech Community
 *   Capital messaging platform.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Conversation collection rendering
 * ✓ Active conversation state
 * ✓ Selected conversation state
 * ✓ Search
 * ✓ Filter: Active / Unread / Pinned / Archived / All
 * ✓ Sorting: Recent / Unread / Pinned / Original
 * ✓ Pagination / Load More
 * ✓ Tenant-aware rendering
 * ✓ Participant metadata
 * ✓ Unread count
 * ✓ Pinned state
 * ✓ Archived state
 * ✓ Online state
 * ✓ Loading state
 * ✓ Error state
 * ✓ Retry action
 * ✓ Refresh action
 * ✓ New conversation action
 * ✓ Archive / restore actions
 * ✓ Pin / unpin actions
 * ✓ Delete action
 * ✓ Custom item actions
 * ✓ Keyboard navigation
 * ✓ Accessible list semantics
 * ✓ Search result announcements
 * ✓ Ref API
 * ✓ Defensive API-data handling
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is a presentation/orchestration layer.
 *
 * It MUST NOT:
 *   - enforce tenant authorization
 *   - enforce membership permissions
 *   - approve or reject loans
 *   - execute financial transactions
 *   - make fraud decisions
 *   - mutate authoritative financial records
 *
 * Those responsibilities remain in TITech's trusted service/API layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import ConversationItem from './ConversationItem.jsx';

import './conversation-list.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_PAGE_SIZE = 50;

const DEFAULT_SEARCH_PLACEHOLDER =
  'Search conversations…';


/* ============================================================================
 * Utility functions
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


const getConversationId = (
  conversation,
  index = 0,
) => {
  const id =
    conversation?.id ??
    conversation?.conversationId ??
    conversation?.uuid;

  if (
    id !== null &&
    id !== undefined &&
    String(id).trim() !== ''
  ) {
    return String(id);
  }

  return `conversation-${index}`;
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


const getConversationPreview = (
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
  tenant = null,
) =>
  safeText(
    tenant?.name ||
      tenant?.tenantName ||
      tenant?.organizationName ||
      conversation?.tenantName ||
      conversation?.organizationName,
  );


const getUnreadCount = (
  conversation,
) => {
  const count =
    Number(
      conversation?.unreadCount ??
        conversation?.unreadMessages ??
        0,
    );

  if (
    !Number.isFinite(
      count,
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      count,
    ),
  );
};


const getSearchableText = (
  conversation,
) =>
  [
    getConversationTitle(
      conversation,
    ),

    getConversationPreview(
      conversation,
    ),

    getTenantName(
      conversation,
    ),

    safeText(
      conversation?.memberName,
    ),

    safeText(
      conversation?.participantName,
    ),

    safeText(
      conversation?.memberNumber,
    ),

    safeText(
      conversation?.conversationNumber,
    ),

    safeText(
      conversation?.reference,
    ),

    safeText(
      conversation?.referenceNumber,
    ),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();


const matchesFilter = (
  conversation,
  query = '',
  filter = 'active',
) => {
  const normalizedQuery =
    safeText(
      query,
    ).toLowerCase();

  if (
    normalizedQuery &&
    !getSearchableText(
      conversation,
    ).includes(
      normalizedQuery,
    )
  ) {
    return false;
  }

  const isArchived =
    conversation?.archived ===
    true;

  const isPinned =
    conversation?.pinned ===
    true;

  const isUnread =
    conversation?.unread ===
      true ||
    getUnreadCount(
      conversation,
    ) > 0;

  switch (
    filter
  ) {
    case 'unread':
      return isUnread;

    case 'pinned':
      return isPinned;

    case 'archived':
      return isArchived;

    case 'active':
      return !isArchived;

    case 'all':
    default:
      return true;
  }
};


const getConversationTimestamp =
  (
    conversation,
  ) =>
    conversation?.lastMessageAt ||
    conversation?.updatedAt ||
    conversation?.lastActivityAt ||
    null;


const toTimestamp = (
  value,
) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 0;
  }

  const timestamp =
    new Date(
      value,
    ).getTime();

  return Number.isFinite(
    timestamp,
  )
    ? timestamp
    : 0;
};


/**
 * Sort without mutating caller-owned conversation arrays.
 */
const sortConversations = (
  conversations,
  sortMode = 'recent',
) => {
  const copy =
    Array.isArray(
      conversations,
    )
      ? [
          ...conversations,
        ]
      : [];

  if (
    sortMode ===
    'original'
  ) {
    return copy;
  }

  if (
    sortMode ===
    'unread'
  ) {
    return copy.sort(
      (
        a,
        b,
      ) =>
        getUnreadCount(
          b,
        ) -
        getUnreadCount(
          a,
        ),
    );
  }

  if (
    sortMode ===
    'pinned'
  ) {
    return copy.sort(
      (
        a,
        b,
      ) =>
        Number(
          b?.pinned ===
            true,
        ) -
        Number(
          a?.pinned ===
            true,
        ),
    );
  }

  return copy.sort(
    (
      a,
      b,
    ) =>
      toTimestamp(
        getConversationTimestamp(
          b,
        ),
      ) -
      toTimestamp(
        getConversationTimestamp(
          a,
        ),
      ),
  );
};


/**
 * Safely obtain participants for a specific conversation.
 */
const getConversationParticipants = (
  conversation,
  participantsByConversation,
) => {
  const idCandidates = [
    conversation?.id,
    conversation?.conversationId,
    conversation?.uuid,
  ]
    .filter(
      (
        value,
      ) =>
        value !==
        null &&
        value !==
        undefined,
    )
    .map(
      (
        value,
      ) =>
        String(
          value,
        ),
    );

  for (
    const id of idCandidates
  ) {
    const participants =
      participantsByConversation?.[
        id
      ];

    if (
      Array.isArray(
        participants,
      )
    ) {
      return participants;
    }
  }

  return Array.isArray(
    conversation?.participants,
  )
    ? conversation.participants
    : [];
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const Icon = ({
  children,
  size = 18,
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
  >
    {children}
  </svg>
);


const SearchIcon = () => (
  <Icon>
    <circle
      cx="11"
      cy="11"
      r="7"
    />
    <path d="m20 20-4-4" />
  </Icon>
);


const CloseIcon = () => (
  <Icon size={16}>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </Icon>
);


const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Icon>
);


const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2" />
    <path d="M20 20v-5h-5" />
  </Icon>
);


/* ============================================================================
 * ConversationList
 * ========================================================================== */

const ConversationList =
  forwardRef(
    function ConversationList(
      {
        conversations =
          [],

        tenant =
          null,

        participantsByConversation =
          {},

        activeConversationId =
          null,

        selectedConversationId =
          null,

        loading =
          false,

        error =
          null,

        disabled =
          false,

        onSelect,

        onConversationSelect,

        onRetry,

        onRefresh,

        onNewConversation,

        onDelete,

        onArchive,

        onUnarchive,

        onPin,

        onSearch,

        onFilterChange,

        customItemActions =
          [],

        filter =
          'active',

        sortMode =
          'recent',

        searchValue,

        defaultSearchValue =
          '',

        searchPlaceholder =
          DEFAULT_SEARCH_PLACEHOLDER,

        debounceMs =
          150,

        pageSize =
          DEFAULT_PAGE_SIZE,

        showSearch =
          true,

        showFilters =
          false,

        showTenant =
          false,

        showParticipantCount =
          false,

        showActions =
          true,

        showUnreadBadge =
          true,

        showAvatar =
          true,

        showOnline =
          true,

        showNewConversation =
          true,

        showHeader =
          false,

        headerTitle =
          'Conversations',

        emptyTitle =
          'No conversations',

        emptyMessage =
          'Your conversations will appear here.',

        noResultsTitle =
          'No matching conversations',

        noResultsMessage =
          'Try a different search or filter.',

        loadingLabel =
          'Loading conversations',

        className =
          '',

        itemClassName =
          '',

        testId =
          'titech-conversation-list',

        ariaLabel =
          'TITech conversations',

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const listId =
        `titech-conversation-list-${generatedId}`;

      const rootRef =
        useRef(null);

      const searchInputRef =
        useRef(null);

      const itemRefs =
        useRef(
          new Map(),
        );

      const searchDebounceRef =
        useRef(null);

      const searchControlled =
        searchValue !==
        undefined;

      const [
        internalSearch,
        setInternalSearch,
      ] = useState(
        defaultSearchValue,
      );

      const [
        internalFilter,
        setInternalFilter,
      ] = useState(
        filter,
      );

      const [
        visibleCount,
        setVisibleCount,
      ] = useState(
        Math.max(
          1,
          Number(
            pageSize,
          ) ||
            DEFAULT_PAGE_SIZE,
        ),
      );

      const [
        focusedIndex,
        setFocusedIndex,
      ] = useState(
        -1,
      );


      /* ======================================================================
       * Controlled values
       * ==================================================================== */

      const effectiveSearch =
        searchControlled
          ? safeText(
              searchValue,
            )
          : internalSearch;

      const effectiveFilter =
        filter !==
          undefined &&
        filter !==
          null
          ? filter
          : internalFilter;


      /* ======================================================================
       * Normalize collection
       * ==================================================================== */

      const normalizedConversations =
        useMemo(
          () =>
            (
              Array.isArray(
                conversations,
              )
                ? conversations
                : []
            ).filter(
              (
                conversation,
              ) =>
                conversation &&
                typeof conversation ===
                  'object' &&
                !Array.isArray(
                  conversation,
                ),
            ),
          [
            conversations,
          ],
        );


      /* ======================================================================
       * Filter and sort
       * ==================================================================== */

      const filteredConversations =
        useMemo(
          () =>
            sortConversations(
              normalizedConversations.filter(
                (
                  conversation,
                ) =>
                  matchesFilter(
                    conversation,
                    effectiveSearch,
                    effectiveFilter,
                  ),
              ),
              sortMode,
            ),
          [
            normalizedConversations,
            effectiveSearch,
            effectiveFilter,
            sortMode,
          ],
        );


      /* ======================================================================
       * Visible collection
       * ==================================================================== */

      const visibleConversations =
        useMemo(
          () =>
            filteredConversations.slice(
              0,
              Math.max(
                1,
                visibleCount,
              ),
            ),
          [
            filteredConversations,
            visibleCount,
          ],
        );


      const totalCount =
        normalizedConversations.length;

      const resultCount =
        filteredConversations.length;

      const hasMore =
        visibleCount <
        resultCount;

      const isSearching =
        safeText(
          effectiveSearch,
        ).length >
        0;

      const noConversations =
        !loading &&
        totalCount ===
          0;

      const noResults =
        !loading &&
        totalCount >
          0 &&
        resultCount ===
          0;


      /* ======================================================================
       * Synchronize state
       * ==================================================================== */

      useEffect(
        () => {
          setInternalFilter(
            filter,
          );
        },
        [
          filter,
        ],
      );


      useEffect(
        () => {
          setVisibleCount(
            Math.max(
              1,
              Number(
                pageSize,
              ) ||
                DEFAULT_PAGE_SIZE,
            ),
          );

          setFocusedIndex(
            -1,
          );
        },
        [
          effectiveSearch,
          effectiveFilter,
          sortMode,
          pageSize,
        ],
      );


      useEffect(
        () => () => {
          if (
            searchDebounceRef.current
          ) {
            clearTimeout(
              searchDebounceRef.current,
            );
          }
        },
        [],
      );


      /* ======================================================================
       * Public ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focusSearch() {
            searchInputRef.current?.focus();
          },

          clearSearch() {
            if (
              searchControlled
            ) {
              onSearch?.(
                '',
              );
            } else {
              setInternalSearch(
                '',
              );

              onSearch?.(
                '',
              );
            }

            searchInputRef.current?.focus();
          },

          refresh() {
            onRefresh?.();
          },

          loadMore() {
            if (
              hasMore
            ) {
              setVisibleCount(
                (
                  current,
                ) =>
                  current +
                  Math.max(
                    1,
                    Number(
                      pageSize,
                    ) ||
                      DEFAULT_PAGE_SIZE,
                  ),
              );
            }
          },

          scrollToConversation(
            conversationId,
          ) {
            const node =
              itemRefs.current.get(
                String(
                  conversationId,
                ),
              );

            node?.scrollIntoView?.({
              behavior:
                'smooth',
              block:
                'nearest',
            });
          },

          getResultCount() {
            return resultCount;
          },
        }),
        [
          hasMore,
          onRefresh,
          onSearch,
          pageSize,
          resultCount,
          searchControlled,
        ],
      );


      /* ======================================================================
       * Search
       * ==================================================================== */

      const handleSearchChange =
        useCallback(
          (
            event,
          ) => {
            const nextValue =
              event.target.value;

            if (
              searchControlled
            ) {
              onSearch?.(
                nextValue,
              );
            } else {
              setInternalSearch(
                nextValue,
              );
            }

            if (
              searchDebounceRef.current
            ) {
              clearTimeout(
                searchDebounceRef.current,
              );
            }

            if (
              typeof onSearch ===
              'function'
            ) {
              searchDebounceRef.current =
                setTimeout(
                  () => {
                    onSearch(
                      nextValue,
                    );
                  },
                  Math.max(
                    0,
                    Number(
                      debounceMs,
                    ) || 0,
                  ),
                );
            }
          },
          [
            debounceMs,
            onSearch,
            searchControlled,
          ],
        );


      const clearSearch =
        useCallback(
          () => {
            if (
              searchControlled
            ) {
              onSearch?.(
                '',
              );
            } else {
              setInternalSearch(
                '',
              );

              onSearch?.(
                '',
              );
            }

            searchInputRef.current?.focus();
          },
          [
            onSearch,
            searchControlled,
          ],
        );


      /* ======================================================================
       * Filters
       * ==================================================================== */

      const handleFilterChange =
        useCallback(
          (
            nextFilter,
          ) => {
            if (
              filter ===
                undefined ||
              filter ===
                null
            ) {
              setInternalFilter(
                nextFilter,
              );
            }

            onFilterChange?.(
              nextFilter,
            );
          },
          [
            filter,
            onFilterChange,
          ],
        );


      /* ======================================================================
       * Conversation selection
       * ==================================================================== */

      const handleSelect =
        useCallback(
          (
            conversation,
          ) => {
            if (
              disabled ||
              loading
            ) {
              return;
            }

            const callback =
              onSelect ||
              onConversationSelect;

            callback?.(
              conversation,
            );
          },
          [
            disabled,
            loading,
            onConversationSelect,
            onSelect,
          ],
        );


      /* ======================================================================
       * Item action handlers
       * ==================================================================== */

      const handleDelete =
        useCallback(
          (
            conversation,
          ) => {
            onDelete?.(
              conversation,
            );
          },
          [
            onDelete,
          ],
        );


      const handleArchive =
        useCallback(
          (
            conversation,
          ) => {
            onArchive?.(
              conversation,
            );
          },
          [
            onArchive,
          ],
        );


      const handleUnarchive =
        useCallback(
          (
            conversation,
          ) => {
            onUnarchive?.(
              conversation,
            );
          },
          [
            onUnarchive,
          ],
        );


      const handlePin =
        useCallback(
          (
            conversation,
            nextPinned,
          ) => {
            onPin?.(
              conversation,
              nextPinned,
            );
          },
          [
            onPin,
          ],
        );


      /* ======================================================================
       * Register item refs
       * ==================================================================== */

      const registerItemRef =
        useCallback(
          (
            conversationId,
          ) =>
            (
              node,
            ) => {
              const key =
                String(
                  conversationId,
                );

              if (
                node
              ) {
                itemRefs.current.set(
                  key,
                  node,
                );
              } else {
                itemRefs.current.delete(
                  key,
                );
              }
            },
          [],
        );


      /* ======================================================================
       * Keyboard navigation
       * ==================================================================== */

      const focusConversationAt =
        useCallback(
          (
            index,
          ) => {
            if (
              visibleConversations.length ===
              0
            ) {
              return;
            }

            const boundedIndex =
              Math.max(
                0,
                Math.min(
                  visibleConversations.length -
                    1,
                  index,
                ),
              );

            const conversation =
              visibleConversations[
                boundedIndex
              ];

            if (
              !conversation
            ) {
              return;
            }

            const id =
              getConversationId(
                conversation,
                boundedIndex,
              );

            const item =
              itemRefs.current.get(
                String(
                  id,
                ),
              );

            setFocusedIndex(
              boundedIndex,
            );

            item?.focus?.();

            item?.scrollIntoView?.({
              behavior:
                'smooth',
              block:
                'nearest',
            });
          },
          [
            visibleConversations,
          ],
        );


      const handleListKeyDown =
        useCallback(
          (
            event,
          ) => {
            if (
              visibleConversations.length ===
              0
            ) {
              return;
            }

            if (
              event.key ===
              'ArrowDown'
            ) {
              event.preventDefault();

              focusConversationAt(
                focusedIndex <
                  0
                  ? 0
                  : focusedIndex +
                      1,
              );

              return;
            }

            if (
              event.key ===
              'ArrowUp'
            ) {
              event.preventDefault();

              focusConversationAt(
                focusedIndex <=
                  0
                  ? 0
                  : focusedIndex -
                      1,
              );

              return;
            }

            if (
              event.key ===
              'Home'
            ) {
              event.preventDefault();

              focusConversationAt(
                0,
              );

              return;
            }

            if (
              event.key ===
              'End'
            ) {
              event.preventDefault();

              focusConversationAt(
                visibleConversations.length -
                  1,
              );
            }
          },
          [
            focusConversationAt,
            focusedIndex,
            visibleConversations.length,
          ],
        );


      /* ======================================================================
       * Search result announcement
       * ==================================================================== */

      const resultLabel =
        isSearching
          ? `${resultCount} matching conversation${
              resultCount ===
              1
                ? ''
                : 's'
            }`
          : `${totalCount} conversation${
              totalCount ===
              1
                ? ''
                : 's'
            }`;


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <section
          {...rest}
          ref={
            rootRef
          }
          id={
            listId
          }
          className={cn(
            'titech-conversation-list',
            disabled &&
              'titech-conversation-list--disabled',
            loading &&
              'titech-conversation-list--loading',
            className,
          )}
          aria-label={
            ariaLabel
          }
          onKeyDown={
            handleListKeyDown
          }
          data-testid={
            testId
          }
        >

          {/* ================================================================
              Header
              ================================================================ */}

          {showHeader ? (
            <header className="titech-conversation-list__header">

              <div className="titech-conversation-list__header-title">
                <h2>
                  {
                    headerTitle
                  }
                </h2>

                <span
                  className="titech-conversation-list__count"
                  aria-live="polite"
                >
                  {
                    resultLabel
                  }
                </span>
              </div>


              {showNewConversation &&
              typeof onNewConversation ===
                'function' ? (
                <button
                  type="button"
                  className="titech-conversation-list__new-button"
                  onClick={
                    onNewConversation
                  }
                  disabled={
                    disabled ||
                    loading
                  }
                  aria-label="Start a new TITech conversation"
                  title="New conversation"
                >
                  <PlusIcon />

                  <span>
                    New
                  </span>
                </button>
              ) : null}

            </header>
          ) : null}


          {/* ================================================================
              Search
              ================================================================ */}

          {showSearch ? (
            <div className="titech-conversation-list__search-wrapper">

              <div className="titech-conversation-list__search">

                <span
                  className="titech-conversation-list__search-icon"
                  aria-hidden="true"
                >
                  <SearchIcon />
                </span>

                <input
                  ref={
                    searchInputRef
                  }
                  type="search"
                  className="titech-conversation-list__search-input"
                  value={
                    effectiveSearch
                  }
                  onChange={
                    handleSearchChange
                  }
                  placeholder={
                    searchPlaceholder
                  }
                  disabled={
                    disabled ||
                    loading
                  }
                  aria-label="Search TITech conversations"
                  autoComplete="off"
                  spellCheck={
                    false
                  }
                  data-testid="titech-conversation-search"
                />

                {effectiveSearch ? (
                  <button
                    type="button"
                    className="titech-conversation-list__clear-search"
                    onClick={
                      clearSearch
                    }
                    disabled={
                      disabled
                    }
                    aria-label="Clear conversation search"
                    title="Clear search"
                  >
                    <CloseIcon />
                  </button>
                ) : null}

              </div>

              <span
                className="titech-conversation-list__search-status"
                role="status"
                aria-live="polite"
              >
                {
                  resultLabel
                }
              </span>

            </div>
          ) : null}


          {/* ================================================================
              Filters
              ================================================================ */}

          {showFilters ? (
            <div
              className="titech-conversation-list__filters"
              role="group"
              aria-label="Conversation filters"
            >
              {[
                {
                  key:
                    'active',
                  label:
                    'Active',
                },

                {
                  key:
                    'unread',
                  label:
                    'Unread',
                },

                {
                  key:
                    'pinned',
                  label:
                    'Pinned',
                },

                {
                  key:
                    'archived',
                  label:
                    'Archived',
                },

                {
                  key:
                    'all',
                  label:
                    'All',
                },
              ].map(
                (
                  option,
                ) => (
                  <button
                    key={
                      option.key
                    }
                    type="button"
                    className={cn(
                      'titech-conversation-list__filter',
                      effectiveFilter ===
                        option.key &&
                        'titech-conversation-list__filter--active',
                    )}
                    onClick={() =>
                      handleFilterChange(
                        option.key,
                      )
                    }
                    disabled={
                      disabled ||
                      loading
                    }
                    aria-pressed={
                      effectiveFilter ===
                      option.key
                    }
                  >
                    {
                      option.label
                    }
                  </button>
                ),
              )}
            </div>
          ) : null}


          {/* ================================================================
              Error
              ================================================================ */}

          {error ? (
            <div
              className="titech-conversation-list__error"
              role="alert"
              data-testid="titech-conversation-list-error"
            >
              <span>
                {typeof error ===
                'string'
                  ? error
                  : 'Unable to load conversations.'}
              </span>

              {typeof onRetry ===
              'function' ? (
                <button
                  type="button"
                  className="titech-conversation-list__retry-button"
                  onClick={
                    onRetry
                  }
                  disabled={
                    disabled ||
                    loading
                  }
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}


          {/* ================================================================
              Loading
              ================================================================ */}

          {loading ? (
            <div
              className="titech-conversation-list__loading"
              role="status"
              aria-live="polite"
              aria-label={
                loadingLabel
              }
              data-testid="titech-conversation-list-loading"
            >
              <span
                className="titech-conversation-list__loading-spinner"
                aria-hidden="true"
              />

              <span>
                {
                  loadingLabel
                }
              </span>
            </div>
          ) : null}


          {/* ================================================================
              No conversations
              ================================================================ */}

          {!loading &&
          noConversations ? (
            <div
              className="titech-conversation-list__empty"
              data-testid="titech-conversation-list-empty"
            >
              <div className="titech-conversation-list__empty-title">
                {
                  emptyTitle
                }
              </div>

              <div className="titech-conversation-list__empty-message">
                {
                  emptyMessage
                }
              </div>

              {showNewConversation &&
              typeof onNewConversation ===
                'function' ? (
                <button
                  type="button"
                  className="titech-conversation-list__empty-action"
                  onClick={
                    onNewConversation
                  }
                  disabled={
                    disabled
                  }
                >
                  <PlusIcon />

                  <span>
                    Start a conversation
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}


          {/* ================================================================
              No results
              ================================================================ */}

          {!loading &&
          noResults ? (
            <div
              className={cn(
                'titech-conversation-list__empty',
                'titech-conversation-list__empty--no-results',
              )}
              data-testid="titech-conversation-list-no-results"
            >
              <div className="titech-conversation-list__empty-title">
                {
                  noResultsTitle
                }
              </div>

              <div className="titech-conversation-list__empty-message">
                {
                  noResultsMessage
                }
              </div>

              {effectiveSearch ? (
                <button
                  type="button"
                  className="titech-conversation-list__empty-action"
                  onClick={
                    clearSearch
                  }
                >
                  Clear search
                </button>
              ) : null}
            </div>
          ) : null}


          {/* ================================================================
              Conversations
              ================================================================ */}

          {!loading &&
          visibleConversations.length >
            0 ? (
            <div
              className="titech-conversation-list__items"
              role="list"
              aria-label="TITech conversation results"
              data-testid="titech-conversation-items"
            >
              {visibleConversations.map(
                (
                  conversation,
                  index,
                ) => {
                  const conversationId =
                    getConversationId(
                      conversation,
                      index,
                    );

                  const participants =
                    getConversationParticipants(
                      conversation,
                      participantsByConversation,
                    );

                  const isActive =
                    String(
                      conversationId,
                    ) ===
                    String(
                      activeConversationId,
                    );

                  const isSelected =
                    String(
                      conversationId,
                    ) ===
                    String(
                      selectedConversationId,
                    );

                  return (
                    <div
                      key={
                        conversationId
                      }
                      role="listitem"
                      className="titech-conversation-list__item"
                      data-conversation-id={
                        conversationId
                      }
                    >
                      <ConversationItem
                        ref={registerItemRef(
                          conversationId,
                        )}
                        conversation={
                          conversation
                        }
                        tenant={
                          tenant
                        }
                        participants={
                          participants
                        }
                        active={
                          isActive
                        }
                        selected={
                          isSelected
                        }
                        unread={
                          conversation?.unread ===
                          true
                        }
                        unreadCount={
                          getUnreadCount(
                            conversation,
                          )
                        }
                        pinned={
                          conversation?.pinned ===
                          true
                        }
                        archived={
                          conversation?.archived ===
                          true
                        }
                        online={
                          conversation?.online ===
                          true
                        }
                        disabled={
                          disabled
                        }
                        loading={
                          false
                        }
                        compact={
                          true
                        }
                        showPreview
                        showTimestamp
                        showParticipantCount={
                          showParticipantCount
                        }
                        showTenant={
                          showTenant
                        }
                        showActions={
                          showActions
                        }
                        showUnreadBadge={
                          showUnreadBadge
                        }
                        showAvatar={
                          showAvatar
                        }
                        showOnline={
                          showOnline
                        }
                        onSelect={
                          handleSelect
                        }
                        onDelete={
                          typeof onDelete ===
                          'function'
                            ? handleDelete
                            : undefined
                        }
                        onArchive={
                          typeof onArchive ===
                          'function'
                            ? handleArchive
                            : undefined
                        }
                        onUnarchive={
                          typeof onUnarchive ===
                          'function'
                            ? handleUnarchive
                            : undefined
                        }
                        onPin={
                          typeof onPin ===
                          'function'
                            ? handlePin
                            : undefined
                        }
                        customActions={
                          customItemActions
                        }
                        className={
                          itemClassName
                        }
                      />
                    </div>
                  );
                },
              )}
            </div>
          ) : null}


          {/* ================================================================
              Load more
              ================================================================ */}

          {!loading &&
          hasMore ? (
            <div className="titech-conversation-list__load-more">
              <button
                type="button"
                className="titech-conversation-list__load-more-button"
                onClick={() =>
                  setVisibleCount(
                    (
                      current,
                    ) =>
                      current +
                      Math.max(
                        1,
                        Number(
                          pageSize,
                        ) ||
                          DEFAULT_PAGE_SIZE,
                      ),
                  )
                }
                disabled={
                  disabled
                }
              >
                Load more
              </button>
            </div>
          ) : null}


          {/* ================================================================
              Footer controls
              ================================================================ */}

          {typeof onRefresh ===
            'function' &&
          totalCount >
            0 ? (
            <footer className="titech-conversation-list__footer">
              <button
                type="button"
                className="titech-conversation-list__refresh-button"
                onClick={
                  onRefresh
                }
                disabled={
                  disabled ||
                  loading
                }
                aria-label="Refresh conversations"
              >
                <RefreshIcon />

                <span>
                  Refresh
                </span>
              </button>
            </footer>
          ) : null}

        </section>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

ConversationList.displayName =
  'TITechConversationList';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ConversationList.propTypes = {
  conversations:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

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

  participantsByConversation:
    PropTypes.objectOf(
      PropTypes.arrayOf(
        PropTypes.object,
      ),
    ),

  activeConversationId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  selectedConversationId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  disabled:
    PropTypes.bool,

  onSelect:
    PropTypes.func,

  onConversationSelect:
    PropTypes.func,

  onRetry:
    PropTypes.func,

  onRefresh:
    PropTypes.func,

  onNewConversation:
    PropTypes.func,

  onDelete:
    PropTypes.func,

  onArchive:
    PropTypes.func,

  onUnarchive:
    PropTypes.func,

  onPin:
    PropTypes.func,

  onSearch:
    PropTypes.func,

  onFilterChange:
    PropTypes.func,

  customItemActions:
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

  filter:
    PropTypes.oneOf([
      'active',
      'unread',
      'pinned',
      'archived',
      'all',
    ]),

  sortMode:
    PropTypes.oneOf([
      'recent',
      'unread',
      'pinned',
      'original',
    ]),

  searchValue:
    PropTypes.string,

  defaultSearchValue:
    PropTypes.string,

  searchPlaceholder:
    PropTypes.string,

  debounceMs:
    PropTypes.number,

  pageSize:
    PropTypes.number,

  showSearch:
    PropTypes.bool,

  showFilters:
    PropTypes.bool,

  showTenant:
    PropTypes.bool,

  showParticipantCount:
    PropTypes.bool,

  showActions:
    PropTypes.bool,

  showUnreadBadge:
    PropTypes.bool,

  showAvatar:
    PropTypes.bool,

  showOnline:
    PropTypes.bool,

  showNewConversation:
    PropTypes.bool,

  showHeader:
    PropTypes.bool,

  headerTitle:
    PropTypes.string,

  emptyTitle:
    PropTypes.string,

  emptyMessage:
    PropTypes.string,

  noResultsTitle:
    PropTypes.string,

  noResultsMessage:
    PropTypes.string,

  loadingLabel:
    PropTypes.string,

  className:
    PropTypes.string,

  itemClassName:
    PropTypes.string,

  testId:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

ConversationList.defaultProps = {
  conversations:
    [],

  tenant:
    null,

  participantsByConversation:
    {},

  activeConversationId:
    null,

  selectedConversationId:
    null,

  loading:
    false,

  error:
    null,

  disabled:
    false,

  onSelect:
    undefined,

  onConversationSelect:
    undefined,

  onRetry:
    undefined,

  onRefresh:
    undefined,

  onNewConversation:
    undefined,

  onDelete:
    undefined,

  onArchive:
    undefined,

  onUnarchive:
    undefined,

  onPin:
    undefined,

  onSearch:
    undefined,

  onFilterChange:
    undefined,

  customItemActions:
    [],

  filter:
    'active',

  sortMode:
    'recent',

  searchValue:
    undefined,

  defaultSearchValue:
    '',

  searchPlaceholder:
    DEFAULT_SEARCH_PLACEHOLDER,

  debounceMs:
    150,

  pageSize:
    DEFAULT_PAGE_SIZE,

  showSearch:
    true,

  showFilters:
    false,

  showTenant:
    false,

  showParticipantCount:
    false,

  showActions:
    true,

  showUnreadBadge:
    true,

  showAvatar:
    true,

  showOnline:
    true,

  showNewConversation:
    true,

  showHeader:
    false,

  headerTitle:
    'Conversations',

  emptyTitle:
    'No conversations',

  emptyMessage:
    'Your conversations will appear here.',

  noResultsTitle:
    'No matching conversations',

  noResultsMessage:
    'Try a different search or filter.',

  loadingLabel:
    'Loading conversations',

  className:
    '',

  itemClassName:
    '',

  testId:
    'titech-conversation-list',

  ariaLabel:
    'TITech conversations',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_PAGE_SIZE,

  getConversationId,

  getConversationParticipants,

  getConversationPreview,

  getConversationTitle,

  getConversationTimestamp,

  getSearchableText,

  getTenantName,

  getUnreadCount,

  matchesFilter,

  sortConversations,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ConversationList;