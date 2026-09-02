'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation List
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ConversationList.js
 *
 * Purpose:
 *   Production-grade conversation collection/list for the TITech Community
 *   Capital enterprise messaging platform.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Conversation collection rendering
 * ✓ Active conversation state
 * ✓ Selected conversation state
 * ✓ Search/filtering
 * ✓ External/local search support
 * ✓ Tenant-aware display context
 * ✓ Unread indicators
 * ✓ Pinned conversations
 * ✓ Archived conversations
 * ✓ Loading state
 * ✓ Empty state
 * ✓ Error state
 * ✓ Retry support
 * ✓ New conversation action
 * ✓ Conversation selection
 * ✓ Pin / unpin
 * ✓ Archive / restore
 * ✓ Delete hooks
 * ✓ Custom actions
 * ✓ Keyboard navigation
 * ✓ Accessible list semantics
 * ✓ Search result count
 * ✓ Large list resilience
 * ✓ Defensive API data handling
 * ✓ Stable test selectors
 * ✓ Ref API
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - enforce tenant authorization
 *   - determine membership permissions
 *   - modify authoritative financial records
 *   - approve loans
 *   - execute transactions
 *   - make fraud decisions
 *
 * Those responsibilities belong to TITech's trusted API/service layers.
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

import ConversationItem from './ConversationItem';

import './conversation-list.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_PAGE_SIZE = 50;

const DEFAULT_SEARCH_PLACEHOLDER =
  'Search conversations…';


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


const getConversationId = (
  conversation,
  index,
) => {
  const id =
    conversation?.id ??
    conversation?.conversationId ??
    conversation?.uuid;

  if (
    id !== null &&
    id !== undefined &&
    String(id).trim()
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
  tenant,
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

  return Number.isFinite(
    count,
  )
    ? Math.max(
        0,
        count,
      )
    : 0;
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
      null,
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
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();


const matchesFilter = (
  conversation,
  query,
  filter,
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

  switch (
    filter
  ) {
    case 'unread':
      return (
        getUnreadCount(
          conversation,
        ) > 0 ||
        conversation?.unread === true
      );

    case 'pinned':
      return (
        conversation?.pinned === true
      );

    case 'archived':
      return (
        conversation?.archived === true
      );

    case 'active':
      return (
        conversation?.archived !==
        true
      );

    case 'all':
    default:
      return true;
  }
};


/**
 * Stable comparator with pinned/unread priority while preserving the original
 * collection order where possible.
 */
const sortConversations = (
  conversations,
  sortMode,
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
          b?.pinned === true,
        ) -
        Number(
          a?.pinned === true,
        ),
    );
  }

  if (
    sortMode ===
    'recent'
  ) {
    return copy.sort(
      (
        a,
        b,
      ) => {
        const aDate =
          new Date(
            a?.lastMessageAt ||
              a?.updatedAt ||
              a?.lastActivityAt ||
              0,
          ).getTime();

        const bDate =
          new Date(
            b?.lastMessageAt ||
              b?.updatedAt ||
              b?.lastActivityAt ||
              0,
          ).getTime();

        return (
          (Number.isFinite(
            bDate,
          )
            ? bDate
            : 0) -
          (Number.isFinite(
            aDate,
          )
            ? aDate
            : 0)
        );
      },
    );
  }

  return copy;
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
  <Icon
    size={16}
  >
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

      const rootRef =
        useRef(null);

      const searchInputRef =
        useRef(null);

      const debounceRef =
        useRef(null);

      const itemRefs =
        useRef(
          new Map(),
        );

      const searchControlled =
        searchValue !==
        undefined;

      const [
        internalSearch,
        setInternalSearch,
      ] =
        useState(
          defaultSearchValue,
        );

      const [
        internalFilter,
        setInternalFilter,
      ] =
        useState(
          filter,
        );

      const [
        visibleCount,
        setVisibleCount,
      ] =
        useState(
          pageSize,
        );

      const effectiveSearch =
        searchControlled
          ? String(
              searchValue ??
                '',
            )
          : internalSearch;

      const effectiveFilter =
        filter !==
          undefined &&
        filter !==
          null
          ? filter
          : internalFilter;

      const rawConversations =
        Array.isArray(
          conversations,
        )
          ? conversations
          : [];

      /**
       * Remove invalid non-object records without mutating caller data.
       */
      const normalizedConversations =
        useMemo(
          () =>
            rawConversations.filter(
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
            rawConversations,
          ],
        );

      /**
       * Filter + sort.
       */
      const filteredConversations =
        useMemo(
          () => {
            const filtered =
              normalizedConversations.filter(
                (
                  conversation,
                ) =>
                  matchesFilter(
                    conversation,
                    effectiveSearch,
                    effectiveFilter,
                  ),
              );

            return sortConversations(
              filtered,
              sortMode,
            );
          },
          [
            normalizedConversations,
            effectiveSearch,
            effectiveFilter,
            sortMode,
          ],
        );

      /**
       * Paginated render collection.
       */
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

      const hasMore =
        visibleCount <
        filteredConversations.length;

      const isSearching =
        Boolean(
          safeText(
            effectiveSearch,
          ),
        );

      const totalCount =
        normalizedConversations.length;

      const resultCount =
        filteredConversations.length;

      const noConversations =
        !loading &&
        totalCount === 0;

      const noResults =
        !loading &&
        totalCount >
          0 &&
        resultCount === 0;

      /* ======================================================================
       * Synchronize filter state when controlled value changes
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

      /* ======================================================================
       * Reset pagination when result set changes
       * ==================================================================== */

      useEffect(
        () => {
          setVisibleCount(
            pageSize,
          );
        },
        [
          effectiveSearch,
          effectiveFilter,
          sortMode,
          pageSize,
        ],
      );

      /* ======================================================================
       * Cleanup debounce
       * ==================================================================== */

      useEffect(
        () => () => {
          if (
            debounceRef.current
          ) {
            clearTimeout(
              debounceRef.current,
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

              return;
            }

            setInternalSearch(
              '',
            );

            onSearch?.(
              '',
            );
          },

          refresh() {
            onRefresh?.();
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

          loadMore() {
            if (
              hasMore
            ) {
              setVisibleCount(
                (
                  current,
                ) =>
                  current +
                  pageSize,
              );
            }
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
       * Search handling
       * ==================================================================== */

      const handleSearchChange =
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
            debounceRef.current
          ) {
            clearTimeout(
              debounceRef.current,
            );
          }

          if (
            typeof onSearch ===
            'function'
          ) {
            debounceRef.current =
              setTimeout(
                () => {
                  onSearch(
                    nextValue,
                  );
                },
                Math.max(
                  0,
                  debounceMs,
                ),
              );
          }
        };

      const clearSearch =
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
        };

      /* ======================================================================
       * Filter handling
       * ==================================================================== */

      const handleFilterChange =
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
        };

      /* ======================================================================
       * Conversation selection
       * ==================================================================== */

      const handleSelect =
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
        };

      /* ======================================================================
       * Action handlers
       * ==================================================================== */

      const handleArchive =
        (
          conversation,
        ) => {
          onArchive?.(
            conversation,
          );
        };

      const handleUnarchive =
        (
          conversation,
        ) => {
          onUnarchive?.(
            conversation,
          );
        };

      const handleDelete =
        (
          conversation,
        ) => {
          onDelete?.(
            conversation,
          );
        };

      const handlePin =
        (
          conversation,
          nextPinned,
        ) => {
          onPin?.(
            conversation,
            nextPinned,
          );
        };

      /* ======================================================================
       * Keyboard navigation
       * ==================================================================== */

      const focusItemAt =
        (
          index,
        ) => {
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
              String(id),
            );

          item?.focus?.();
          item?.scrollIntoView?.({
            behavior:
              'smooth',
            block:
              'nearest',
          });
        };

      const handleListKeyDown =
        (
          event,
        ) => {
          if (
            visibleConversations.length ===
            0
          ) {
            return;
          }

          const currentIndex =
            visibleConversations.findIndex(
              (
                conversation,
                index,
              ) =>
                String(
                  getConversationId(
                    conversation,
                    index,
                  ),
                ) ===
                String(
                  activeConversationId,
                ),
            );

          if (
            event.key ===
            'ArrowDown'
          ) {
            event.preventDefault();

            focusItemAt(
              currentIndex <
                0
                ? 0
                : currentIndex +
                    1,
            );

            return;
          }

          if (
            event.key ===
            'ArrowUp'
          ) {
            event.preventDefault();

            focusItemAt(
              currentIndex <=
                0
                ? 0
                : currentIndex -
                    1,
            );

            return;
          }

          if (
            event.key ===
            'Home'
          ) {
            event.preventDefault();

            focusItemAt(
              0,
            );

            return;
          }

          if (
            event.key ===
            'End'
          ) {
            event.preventDefault();

            focusItemAt(
              visibleConversations.length -
                1,
            );
          }
        };

      /* ======================================================================
       * Register/unregister item refs
       * ==================================================================== */

      const registerItemRef =
        (
          id,
        ) =>
        (
          node,
        ) => {
          const key =
            String(
              id,
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
        };

      /* ======================================================================
       * Render result label
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
            `titech-conversation-list-${generatedId}`
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
            <div className="titech-conversation-list__header">

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
                  aria-label="Start a new conversation"
                  title="New conversation"
                >
                  <PlusIcon />

                  <span>
                    New
                  </span>
                </button>
              ) : null}

            </div>
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
                  aria-label="Search conversations"
                  data-testid="titech-conversation-search"
                  autoComplete="off"
                  spellCheck={
                    false
                  }
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
                  onClick={
                    onRetry
                  }
                  disabled={
                    disabled ||
                    loading
                  }
                  className="titech-conversation-list__retry-button"
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
              <span className="titech-conversation-list__loading-spinner" />

              <span>
                {
                  loadingLabel
                }
              </span>
            </div>
          ) : null}


          {/* ================================================================
              Empty state
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
              className="titech-conversation-list__empty titech-conversation-list__empty--no-results"
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
              Conversation list
              ================================================================ */}

          {!loading &&
          visibleConversations.length >
            0 ? (
            <div
              className="titech-conversation-list__items"
              role="list"
              aria-label="Conversation results"
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

                  const participantData =
                    Array.isArray(
                      participantsByConversation?.[
                        conversationId
                      ],
                    )
                      ? participantsByConversation[
                          conversationId
                        ]
                      : Array.isArray(
                          participantsByConversation?.[
                            String(
                              conversationId,
                            )
                          ],
                        )
                        ? participantsByConversation[
                            String(
                              conversationId,
                            )
                          ]
                        : conversation?.participants ||
                          [];

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
                        ref={
                          registerItemRef(
                            conversationId,
                          )
                        }
                        conversation={
                          conversation
                        }
                        tenant={
                          tenant
                        }
                        participants={
                          participantData
                        }
                        active={
                          String(
                            conversationId,
                          ) ===
                          String(
                            activeConversationId,
                          )
                        }
                        selected={
                          String(
                            conversationId,
                          ) ===
                          String(
                            selectedConversationId,
                          )
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
                          onDelete
                            ? handleDelete
                            : undefined
                        }
                        onArchive={
                          onArchive
                            ? handleArchive
                            : undefined
                        }
                        onUnarchive={
                          onUnarchive
                            ? handleUnarchive
                            : undefined
                        }
                        onPin={
                          onPin
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
                      pageSize,
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
              Refresh
              ================================================================ */}

          {typeof onRefresh ===
          'function' &&
          totalCount >
            0 ? (
            <div className="titech-conversation-list__footer">
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
              >
                Refresh
              </button>
            </div>
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
    PropTypes.string,

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
  getConversationPreview,
  getConversationTitle,
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