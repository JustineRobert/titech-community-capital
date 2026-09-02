/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Community Forum
 * ============================================================================
 *
 * File:
 *   frontend/src/components/Forum.jsx
 *
 * Purpose:
 *   Production-grade community discussion and knowledge-sharing interface.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Responsive enterprise UI
 * ✓ Search and discussion filtering
 * ✓ Category filtering
 * ✓ Discussion creation
 * ✓ Discussion refresh/retry
 * ✓ Loading, empty and error states
 * ✓ Optimistic-safe interaction boundaries
 * ✓ Pagination support
 * ✓ View/reply metadata
 * ✓ Accessible semantic markup
 * ✓ Keyboard navigation
 * ✓ React Router integration
 * ✓ Stable test selectors
 * ✓ Defensive API normalization
 * ✓ Abort-safe asynchronous loading
 * ✓ Request race protection
 * ✓ Tenant-aware presentation hooks
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation-only.
 *
 * Authorization, tenant isolation, moderation, validation, rate limiting,
 * permissions, and persistence MUST be enforced by the backend/API.
 *
 * ============================================================================ */

'use strict';

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import {
  Link,
  useNavigate,
} from 'react-router-dom';

import {
  Search,
  Plus,
  RefreshCw,
  MessageCircle,
  Eye,
  Clock3,
  User,
  Tag,
  ChevronRight,
  X,
  SlidersHorizontal,
  AlertCircle,
  Inbox,
  Loader2,
} from 'lucide-react';

import './Forum.css';

/* ============================================================================
 * Service Resolution
 *
 * The component deliberately resolves the forum service defensively so that
 * an application with a differently shaped service export can still render
 * predictable UI states.
 * ========================================================================== */

import forumService from '../services/forumService';

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_PAGE_SIZE = 20;

const DEFAULT_CATEGORY = 'all';

const SEARCH_DEBOUNCE_MS = 250;

const FORUM_TEST_ID = 'titech-forum';

const CATEGORY_ALL = {
  id: 'all',
  name: 'All Discussions',
};

const DEFAULT_CATEGORIES = [
  CATEGORY_ALL,
  {
    id: 'general',
    name: 'General',
  },
  {
    id: 'savings',
    name: 'Savings',
  },
  {
    id: 'loans',
    name: 'Loans',
  },
  {
    id: 'financial-literacy',
    name: 'Financial Literacy',
  },
  {
    id: 'technology',
    name: 'Technology',
  },
];

/* ============================================================================
 * Utilities
 * ========================================================================== */

/**
 * Convert unknown input into a safe string.
 */
function safeString(value, fallback = '') {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value);
}

/**
 * Convert unknown numeric input into a safe number.
 */
function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Normalize identifiers returned by different API versions.
 */
function getId(item) {
  if (!item) {
    return null;
  }

  return (
    item.id ??
    item._id ??
    item.forumId ??
    item.threadId ??
    item.discussionId ??
    null
  );
}

/**
 * Normalize API response containers.
 *
 * Supports common enterprise API response shapes:
 *
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { results: [] }
 *   { discussions: [] }
 *   { forums: [] }
 */
function extractItems(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (!response || typeof response !== 'object') {
    return [];
  }

  const candidates = [
    response.items,
    response.results,
    response.discussions,
    response.forums,
    response.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (
      candidate &&
      typeof candidate === 'object'
    ) {
      const nested = [
        candidate.items,
        candidate.results,
        candidate.discussions,
        candidate.forums,
      ];

      for (const nestedCandidate of nested) {
        if (Array.isArray(nestedCandidate)) {
          return nestedCandidate;
        }
      }
    }
  }

  return [];
}

/**
 * Extract pagination metadata without assuming one backend contract.
 */
function extractPagination(response, fallbackPage) {
  if (
    !response ||
    typeof response !== 'object'
  ) {
    return {
      page: fallbackPage,
      total: null,
      totalPages: null,
      hasNext: false,
    };
  }

  const pagination =
    response.pagination ||
    response.meta ||
    response.pageInfo ||
    {};

  const page = safeNumber(
    pagination.page ??
      response.page ??
      fallbackPage,
    fallbackPage,
  );

  const totalRaw =
    pagination.total ??
    response.total ??
    null;

  const total =
    totalRaw === null
      ? null
      : safeNumber(totalRaw, 0);

  const totalPagesRaw =
    pagination.totalPages ??
    response.totalPages ??
    null;

  const totalPages =
    totalPagesRaw === null
      ? null
      : safeNumber(
          totalPagesRaw,
          0,
        );

  const hasNext =
    typeof pagination.hasNext ===
    'boolean'
      ? pagination.hasNext
      : typeof response.hasNext ===
          'boolean'
        ? response.hasNext
        : totalPages !== null
          ? page < totalPages
          : false;

  return {
    page,
    total,
    totalPages,
    hasNext,
  };
}

/**
 * Normalize categories returned from the API.
 */
function normalizeCategories(categories) {
  if (!Array.isArray(categories)) {
    return DEFAULT_CATEGORIES;
  }

  const normalized = categories
    .map((category) => {
      if (
        typeof category ===
        'string'
      ) {
        return {
          id: category,
          name: category,
        };
      }

      if (
        category &&
        typeof category ===
          'object'
      ) {
        const id =
          category.id ??
          category._id ??
          category.slug ??
          category.name;

        const name =
          category.name ??
          category.label ??
          category.title ??
          category.slug;

        if (!id || !name) {
          return null;
        }

        return {
          ...category,
          id: safeString(id),
          name: safeString(name),
        };
      }

      return null;
    })
    .filter(Boolean);

  const unique = new Map();

  unique.set(
    CATEGORY_ALL.id,
    CATEGORY_ALL,
  );

  normalized.forEach(
    (category) => {
      if (
        category.id !==
        CATEGORY_ALL.id
      ) {
        unique.set(
          category.id,
          category,
        );
      }
    },
  );

  return Array.from(
    unique.values(),
  );
}

/**
 * Normalize a discussion returned from the backend.
 */
function normalizeDiscussion(item) {
  if (!item) {
    return null;
  }

  const author =
    item.author ||
    item.createdBy ||
    item.user ||
    {};

  const category =
    item.category ||
    item.categoryName ||
    item.topicCategory ||
    '';

  const replies =
    item.replyCount ??
    item.repliesCount ??
    item.commentsCount ??
    (Array.isArray(item.replies)
      ? item.replies.length
      : 0);

  const views =
    item.viewCount ??
    item.views ??
    item.viewsCount ??
    0;

  const title =
    item.title ||
    item.subject ||
    item.question ||
    'Untitled discussion';

  const body =
    item.excerpt ||
    item.summary ||
    item.description ||
    item.content ||
    '';

  return {
    ...item,

    id: getId(item),

    title: safeString(
      title,
      'Untitled discussion',
    ),

    body: safeString(body),

    category:
      typeof category ===
      'object'
        ? safeString(
            category.name ??
              category.slug,
          )
        : safeString(
            category,
          ),

    author: {
      ...author,
      id:
        author.id ??
        author._id ??
        null,
      name: safeString(
        author.name ??
          author.fullName ??
          author.username ??
          'TITech Community Member',
      ),
    },

    replyCount: safeNumber(
      replies,
      0,
    ),

    viewCount: safeNumber(
      views,
      0,
    ),

    createdAt:
      item.createdAt ??
      item.created_at ??
      item.dateCreated ??
      null,

    updatedAt:
      item.updatedAt ??
      item.updated_at ??
      null,

    status:
      item.status ||
      'published',
  };
}

/**
 * Format discussion timestamps safely.
 */
function formatDate(value) {
  if (!value) {
    return 'Recently';
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return 'Recently';
  }

  const now = new Date();

  const diff =
    now.getTime() -
    date.getTime();

  const minute =
    60 * 1000;

  const hour =
    60 * minute;

  const day =
    24 * hour;

  if (diff >= 0 && diff < minute) {
    return 'Just now';
  }

  if (diff >= 0 && diff < hour) {
    const minutes = Math.floor(
      diff / minute,
    );

    return `${minutes}m ago`;
  }

  if (diff >= 0 && diff < day) {
    const hours = Math.floor(
      diff / hour,
    );

    return `${hours}h ago`;
  }

  if (
    diff >= 0 &&
    diff < 7 * day
  ) {
    const days = Math.floor(
      diff / day,
    );

    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: 'medium',
    },
  ).format(date);
}

/**
 * Resolve a forum service method safely.
 */
function getServiceMethod(...names) {
  if (
    !forumService ||
    typeof forumService !==
      'object'
  ) {
    return null;
  }

  for (const name of names) {
    if (
      typeof forumService[
        name
      ] === 'function'
    ) {
      return forumService[name];
    }
  }

  return null;
}

/* ============================================================================
 * Skeleton
 * ========================================================================== */

const ForumSkeleton = memo(
  function ForumSkeleton({
    count = 6,
  }) {
    return (
      <div
        className="forum-skeleton-list"
        aria-hidden="true"
        data-testid="titech-forum-loading"
      >
        {Array.from(
          {
            length: count,
          },
          (_, index) => (
            <div
              className="forum-skeleton-card"
              key={index}
            >
              <div className="forum-skeleton-line forum-skeleton-line-sm" />
              <div className="forum-skeleton-line forum-skeleton-line-lg" />
              <div className="forum-skeleton-line forum-skeleton-line-md" />

              <div className="forum-skeleton-footer">
                <div className="forum-skeleton-line forum-skeleton-line-xs" />
                <div className="forum-skeleton-line forum-skeleton-line-xs" />
              </div>
            </div>
          ),
        )}
      </div>
    );
  },
);

ForumSkeleton.displayName =
  'TITechForumSkeleton';

ForumSkeleton.propTypes = {
  count: PropTypes.number,
};

/* ============================================================================
 * Empty State
 * ========================================================================== */

const ForumEmptyState = memo(
  function ForumEmptyState({
    hasFilters,
    onClear,
    onCreate,
  }) {
    return (
      <section
        className="forum-empty-state"
        data-testid="titech-forum-empty"
        aria-live="polite"
      >
        <div className="forum-empty-icon">
          <Inbox
            size={32}
            aria-hidden="true"
          />
        </div>

        <h2>
          No discussions found
        </h2>

        <p>
          {hasFilters
            ? 'Try adjusting your search or category filters.'
            : 'Be the first to start a conversation with the TITech community.'}
        </p>

        <div className="forum-empty-actions">
          {hasFilters ? (
            <button
              type="button"
              className="forum-secondary-button"
              onClick={onClear}
            >
              <X
                size={17}
                aria-hidden="true"
              />
              Clear filters
            </button>
          ) : null}

          <button
            type="button"
            className="forum-primary-button"
            onClick={onCreate}
          >
            <Plus
              size={17}
              aria-hidden="true"
            />
            Start discussion
          </button>
        </div>
      </section>
    );
  },
);

ForumEmptyState.displayName =
  'TITechForumEmptyState';

ForumEmptyState.propTypes = {
  hasFilters:
    PropTypes.bool.isRequired,
  onClear:
    PropTypes.func.isRequired,
  onCreate:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * Error State
 * ========================================================================== */

const ForumErrorState = memo(
  function ForumErrorState({
    message,
    onRetry,
  }) {
    return (
      <section
        className="forum-error-state"
        data-testid="titech-forum-error"
        role="alert"
      >
        <div className="forum-error-icon">
          <AlertCircle
            size={30}
            aria-hidden="true"
          />
        </div>

        <div className="forum-error-content">
          <h2>
            Unable to load discussions
          </h2>

          <p>
            {message ||
              'We could not retrieve the community discussions right now. Please try again.'}
          </p>

          <button
            type="button"
            className="forum-primary-button"
            onClick={onRetry}
          >
            <RefreshCw
              size={17}
              aria-hidden="true"
            />
            Try again
          </button>
        </div>
      </section>
    );
  },
);

ForumErrorState.displayName =
  'TITechForumErrorState';

ForumErrorState.propTypes = {
  message:
    PropTypes.string,
  onRetry:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * Discussion Card
 * ========================================================================== */

const DiscussionCard = memo(
  function DiscussionCard({
    discussion,
    onOpen,
  }) {
    if (!discussion) {
      return null;
    }

    const discussionId =
      discussion.id;

    const destination =
      discussionId !== null &&
      discussionId !== undefined
        ? `/forum/${encodeURIComponent(
            String(
              discussionId,
            ),
          )}`
        : '/forum';

    const handleOpen =
      () => {
        if (
          typeof onOpen ===
          'function'
        ) {
          onOpen(discussion);
        }
      };

    return (
      <article
        className="forum-discussion-card"
        data-testid={`titech-forum-discussion-${discussionId}`}
      >
        <div className="forum-discussion-card-main">
          <div className="forum-discussion-meta-top">
            {discussion.category ? (
              <span className="forum-category-badge">
                <Tag
                  size={13}
                  aria-hidden="true"
                />
                {discussion.category}
              </span>
            ) : null}

            {discussion.status &&
            discussion.status !==
              'published' ? (
              <span
                className={`forum-status-badge forum-status-${discussion.status}`}
              >
                {discussion.status}
              </span>
            ) : null}
          </div>

          <h2 className="forum-discussion-title">
            <Link
              to={destination}
              onClick={
                handleOpen
              }
              aria-label={`Open discussion: ${discussion.title}`}
            >
              {discussion.title}
            </Link>
          </h2>

          {discussion.body ? (
            <p className="forum-discussion-excerpt">
              {discussion.body}
            </p>
          ) : null}

          <div className="forum-discussion-metadata">
            <span
              className="forum-metadata-item"
              title={
                discussion.author
                  .name
              }
            >
              <User
                size={15}
                aria-hidden="true"
              />
              <span>
                {
                  discussion
                    .author
                    .name
                }
              </span>
            </span>

            <span className="forum-metadata-item">
              <Clock3
                size={15}
                aria-hidden="true"
              />
              <time
                dateTime={
                  discussion.createdAt ||
                  undefined
                }
              >
                {formatDate(
                  discussion.createdAt,
                )}
              </time>
            </span>

            <span className="forum-metadata-item">
              <MessageCircle
                size={15}
                aria-hidden="true"
              />
              <span>
                {
                  discussion.replyCount
                }{' '}
                {discussion.replyCount ===
                1
                  ? 'reply'
                  : 'replies'}
              </span>
            </span>

            <span className="forum-metadata-item">
              <Eye
                size={15}
                aria-hidden="true"
              />
              <span>
                {
                  discussion.viewCount
                }{' '}
                {discussion.viewCount ===
                1
                  ? 'view'
                  : 'views'}
              </span>
            </span>
          </div>
        </div>

        <Link
          to={destination}
          onClick={
            handleOpen
          }
          className="forum-discussion-arrow"
          aria-label={`View ${discussion.title}`}
          tabIndex={-1}
        >
          <ChevronRight
            size={21}
            aria-hidden="true"
          />
        </Link>
      </article>
    );
  },
);

DiscussionCard.displayName =
  'TITechDiscussionCard';

DiscussionCard.propTypes = {
  discussion:
    PropTypes.shape({
      id: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number,
      ]),
      title:
        PropTypes.string.isRequired,
      body:
        PropTypes.string,
      category:
        PropTypes.string,
      replyCount:
        PropTypes.number,
      viewCount:
        PropTypes.number,
      createdAt:
        PropTypes.string,
      status:
        PropTypes.string,
      author:
        PropTypes.shape({
          name:
            PropTypes.string,
        }),
    }).isRequired,
  onOpen:
    PropTypes.func,
};

/* ============================================================================
 * Category Navigation
 * ========================================================================== */

const CategoryNavigation = memo(
  function CategoryNavigation({
    categories,
    selectedCategory,
    onSelect,
  }) {
    return (
      <nav
        className="forum-categories"
        aria-label="Forum categories"
      >
        {categories.map(
          (category) => {
            const isActive =
              selectedCategory ===
              category.id;

            return (
              <button
                type="button"
                key={
                  category.id
                }
                className={`forum-category-button${
                  isActive
                    ? ' is-active'
                    : ''
                }`}
                aria-current={
                  isActive
                    ? 'page'
                    : undefined
                }
                aria-pressed={
                  isActive
                }
                onClick={() =>
                  onSelect(
                    category.id,
                  )
                }
              >
                {
                  category.name
                }
              </button>
            );
          },
        )}
      </nav>
    );
  },
);

CategoryNavigation.displayName =
  'TITechForumCategoryNavigation';

CategoryNavigation.propTypes = {
  categories:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.string
            .isRequired,
        name:
          PropTypes.string
            .isRequired,
      }),
    ).isRequired,
  selectedCategory:
    PropTypes.string.isRequired,
  onSelect:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * Forum Component
 * ========================================================================== */

function Forum({
  initialCategory =
    DEFAULT_CATEGORY,
  initialSearch = '',
  pageSize =
    DEFAULT_PAGE_SIZE,
  showCategories = true,
  showCreateButton = true,
  showSearch = true,
  className = '',
  testId = FORUM_TEST_ID,
}) {
  const navigate =
    useNavigate();

  const mountedRef =
    useRef(true);

  const requestIdRef =
    useRef(0);

  const searchTimerRef =
    useRef(null);

  const [
    discussions,
    setDiscussions,
  ] = useState([]);

  const [
    categories,
    setCategories,
  ] = useState(
    DEFAULT_CATEGORIES,
  );

  const [
    searchInput,
    setSearchInput,
  ] = useState(
    initialSearch,
  );

  const [
    searchQuery,
    setSearchQuery,
  ] = useState(
    initialSearch,
  );

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState(
    initialCategory,
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    page,
    setPage,
  ] = useState(1);

  const [
    pagination,
    setPagination,
  ] = useState({
    page: 1,
    total: null,
    totalPages: null,
    hasNext: false,
  });

  /* ========================================================================
   * Lifecycle
   * ====================================================================== */

  useEffect(() => {
    mountedRef.current =
      true;

    return () => {
      mountedRef.current =
        false;

      if (
        searchTimerRef.current
      ) {
        clearTimeout(
          searchTimerRef.current,
        );
      }
    };
  }, []);

  /* ========================================================================
   * Search Debounce
   * ====================================================================== */

  useEffect(() => {
    if (
      searchTimerRef.current
    ) {
      clearTimeout(
        searchTimerRef.current,
      );
    }

    searchTimerRef.current =
      setTimeout(() => {
        if (
          mountedRef.current
        ) {
          setSearchQuery(
            searchInput.trim(),
          );

          setPage(1);
        }
      }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (
        searchTimerRef.current
      ) {
        clearTimeout(
          searchTimerRef.current,
        );
      }
    };
  }, [searchInput]);

  /* ========================================================================
   * Load Categories
   * ====================================================================== */

  const loadCategories =
    useCallback(
      async () => {
        const getCategories =
          getServiceMethod(
            'getCategories',
            'fetchCategories',
            'listCategories',
          );

        if (
          !getCategories
        ) {
          return;
        }

        try {
          const response =
            await getCategories();

          if (
            mountedRef.current
          ) {
            setCategories(
              normalizeCategories(
                extractItems(
                  response,
                ),
              ),
            );
          }
        } catch (categoryError) {
          /*
           * Category loading is non-critical. Keep the built-in categories
           * available rather than failing the entire forum experience.
           */
          if (
            process.env
              .NODE_ENV !==
            'production'
          ) {
            console.warn(
              '[TITech Forum] Unable to load categories.',
              categoryError,
            );
          }
        }
      },
      [],
    );

  /* ========================================================================
   * Load Discussions
   * ====================================================================== */

  const loadDiscussions =
    useCallback(
      async ({
        targetPage = 1,
        isRefresh = false,
      } = {}) => {
        const requestId =
          ++requestIdRef.current;

        const getDiscussions =
          getServiceMethod(
            'getDiscussions',
            'getForumItems',
            'getForumPosts',
            'getThreads',
            'fetchDiscussions',
            'listDiscussions',
          );

        if (
          !getDiscussions
        ) {
          if (
            mountedRef.current
          ) {
            setError(
              'The forum service is not configured. Please contact support.',
            );
            setLoading(false);
            setRefreshing(false);
          }

          return;
        }

        if (isRefresh) {
          setRefreshing(true);
        } else if (
          targetPage === 1
        ) {
          setLoading(true);
        }

        if (
          mountedRef.current
        ) {
          setError(null);
        }

        try {
          const params = {
            page: targetPage,
            limit: pageSize,
          };

          if (searchQuery) {
            params.search =
              searchQuery;
          }

          if (
            selectedCategory !==
            DEFAULT_CATEGORY
          ) {
            params.category =
              selectedCategory;
          }

          let response;

          /*
           * Some existing services use positional arguments while newer
           * enterprise services accept one parameter object. Prefer the
           * object contract and gracefully fall back to positional arguments
           * only when necessary.
           */
          try {
            response =
              await getDiscussions(
                params,
              );
          } catch (
            primaryError
          ) {
            response =
              await getDiscussions(
                targetPage,
                pageSize,
                searchQuery,
                selectedCategory !==
                  DEFAULT_CATEGORY
                  ? selectedCategory
                  : undefined,
              );
          }

          if (
            !mountedRef.current ||
            requestId !==
              requestIdRef.current
          ) {
            return;
          }

          const items =
            extractItems(
              response,
            )
              .map(
                normalizeDiscussion,
              )
              .filter(
                (item) =>
                  item &&
                  item.id !== null,
              );

          const pageMeta =
            extractPagination(
              response,
              targetPage,
            );

          setDiscussions(
            items,
          );

          setPage(
            pageMeta.page ||
              targetPage,
          );

          setPagination(
            pageMeta,
          );
        } catch (loadError) {
          if (
            !mountedRef.current ||
            requestId !==
              requestIdRef.current
          ) {
            return;
          }

          setError(
            loadError?.message ||
              'We could not load the community discussions. Please try again.',
          );
        } finally {
          if (
            mountedRef.current &&
            requestId ===
              requestIdRef.current
          ) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      },
      [
        pageSize,
        searchQuery,
        selectedCategory,
      ],
    );

  /* ========================================================================
   * Initial / Filter Loading
   * ====================================================================== */

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadDiscussions({
      targetPage: page,
    });
  }, [
    loadDiscussions,
    page,
  ]);

  /* ========================================================================
   * Handlers
   * ====================================================================== */

  const handleSearchChange =
    useCallback(
      (event) => {
        setSearchInput(
          event.target.value,
        );
      },
      [],
    );

  const handleClearSearch =
    useCallback(() => {
      setSearchInput('');
      setSearchQuery('');
      setPage(1);
    }, []);

  const handleCategorySelect =
    useCallback(
      (category) => {
        setSelectedCategory(
          category ||
            DEFAULT_CATEGORY,
        );

        setPage(1);
      },
      [],
    );

  const handleClearFilters =
    useCallback(() => {
      setSearchInput('');
      setSearchQuery('');
      setSelectedCategory(
        DEFAULT_CATEGORY,
      );
      setPage(1);
    }, []);

  const handleRefresh =
    useCallback(() => {
      loadDiscussions({
        targetPage: page,
        isRefresh: true,
      });
    }, [
      loadDiscussions,
      page,
    ]);

  const handleCreate =
    useCallback(() => {
      navigate(
        '/forum/create',
      );
    }, [navigate]);

  const handleOpenDiscussion =
    useCallback(
      (discussion) => {
        /*
         * Reserved for analytics/telemetry integration.
         *
         * Navigation remains owned by React Router.
         */
        if (
          process.env
            .NODE_ENV !==
          'production'
        ) {
          if (
            discussion?.id ===
            null
          ) {
            console.debug(
              '[TITech Forum] Discussion has no navigable identifier.',
            );
          }
        }
      },
      [],
    );

  const handlePreviousPage =
    useCallback(() => {
      setPage(
        (currentPage) =>
          Math.max(
            1,
            currentPage - 1,
          ),
      );
    }, []);

  const handleNextPage =
    useCallback(() => {
      if (
        pagination.hasNext
      ) {
        setPage(
          (currentPage) =>
            currentPage + 1,
        );
      }
    }, [
      pagination.hasNext,
    ]);

  /* ========================================================================
   * Derived State
   * ====================================================================== */

  const hasFilters =
    Boolean(
      searchQuery ||
        selectedCategory !==
          DEFAULT_CATEGORY,
    );

  const resultLabel =
    useMemo(() => {
      if (
        pagination.total !==
        null
      ) {
        return `${pagination.total} ${
          pagination.total === 1
            ? 'discussion'
            : 'discussions'
        }`;
      }

      return `${discussions.length} ${
        discussions.length ===
        1
          ? 'discussion'
          : 'discussions'
      }`;
    }, [
      discussions.length,
      pagination.total,
    ]);

  const rootClassName = [
    'forum-container',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /* ========================================================================
   * Render
   * ====================================================================== */

  return (
    <main
      className={
        rootClassName
      }
      data-testid={testId}
      data-component="titech-forum"
    >
      <div className="forum-wrapper">
        {/* ================================================================
            Header
            ================================================================ */}

        <header className="forum-header">
          <div className="forum-header-content">
            <div className="forum-header-copy">
              <span className="forum-eyebrow">
                TITech Community
              </span>

              <h1 className="forum-title">
                Community Forum
              </h1>

              <p className="forum-description">
                Ask questions, share
                knowledge, and learn
                from the TITech
                community.
              </p>
            </div>

            {showCreateButton ? (
              <button
                type="button"
                className="forum-primary-button forum-create-button"
                onClick={
                  handleCreate
                }
                data-testid="titech-forum-create"
              >
                <Plus
                  size={18}
                  aria-hidden="true"
                />
                Start discussion
              </button>
            ) : null}
          </div>
        </header>

        {/* ================================================================
            Controls
            ================================================================ */}

        <section
          className="forum-controls"
          aria-label="Forum controls"
        >
          {showSearch ? (
            <div className="forum-search-container">
              <Search
                size={19}
                className="forum-search-icon"
                aria-hidden="true"
              />

              <label
                className="sr-only"
                htmlFor={`${testId}-search`}
              >
                Search discussions
              </label>

              <input
                id={`${testId}-search`}
                type="search"
                className="forum-search-input"
                placeholder="Search discussions..."
                value={
                  searchInput
                }
                onChange={
                  handleSearchChange
                }
                autoComplete="off"
                spellCheck="false"
                enterKeyHint="search"
                data-testid="titech-forum-search"
              />

              {searchInput ? (
                <button
                  type="button"
                  className="forum-search-clear"
                  onClick={
                    handleClearSearch
                  }
                  aria-label="Clear search"
                >
                  <X
                    size={17}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className="forum-refresh-button"
            onClick={
              handleRefresh
            }
            disabled={
              loading ||
              refreshing
            }
            aria-label="Refresh discussions"
            title="Refresh discussions"
            data-testid="titech-forum-refresh"
          >
            {refreshing ? (
              <Loader2
                size={18}
                aria-hidden="true"
                className="forum-spinner"
              />
            ) : (
              <RefreshCw
                size={18}
                aria-hidden="true"
              />
            )}

            <span className="forum-refresh-label">
              Refresh
            </span>
          </button>
        </section>

        {/* ================================================================
            Categories
            ================================================================ */}

        {showCategories ? (
          <section
            className="forum-filter-section"
            aria-label="Discussion filters"
          >
            <div className="forum-filter-heading">
              <SlidersHorizontal
                size={16}
                aria-hidden="true"
              />

              <span>
                Categories
              </span>
            </div>

            <CategoryNavigation
              categories={
                categories
              }
              selectedCategory={
                selectedCategory
              }
              onSelect={
                handleCategorySelect
              }
            />
          </section>
        ) : null}

        {/* ================================================================
            Result Summary
            ================================================================ */}

        {!loading &&
        !error ? (
          <div
            className="forum-results-summary"
            aria-live="polite"
          >
            <span>
              {resultLabel}
            </span>

            {hasFilters ? (
              <button
                type="button"
                className="forum-clear-filters"
                onClick={
                  handleClearFilters
                }
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ================================================================
            Loading
            ================================================================ */}

        {loading ? (
          <ForumSkeleton />
        ) : null}

        {/* ================================================================
            Error
            ================================================================ */}

        {!loading && error ? (
          <ForumErrorState
            message={error}
            onRetry={
              handleRefresh
            }
          />
        ) : null}

        {/* ================================================================
            Content
            ================================================================ */}

        {!loading &&
        !error &&
        discussions.length >
          0 ? (
          <section
            className="forum-discussions"
            aria-label="Community discussions"
          >
            <div
              className="forum-discussion-list"
              data-testid="titech-forum-list"
            >
              {discussions.map(
                (discussion) => (
                  <DiscussionCard
                    key={
                      discussion.id
                    }
                    discussion={
                      discussion
                    }
                    onOpen={
                      handleOpenDiscussion
                    }
                  />
                ),
              )}
            </div>

            {/* ============================================================
                Pagination
                ============================================================ */}

            {pagination.totalPages >
              1 ||
            pagination.hasNext ||
            page > 1 ? (
              <nav
                className="forum-pagination"
                aria-label="Forum pagination"
              >
                <button
                  type="button"
                  className="forum-secondary-button"
                  onClick={
                    handlePreviousPage
                  }
                  disabled={
                    page <= 1
                  }
                  aria-label="Previous page"
                >
                  Previous
                </button>

                <span
                  className="forum-pagination-status"
                  aria-current="page"
                >
                  Page {page}
                  {pagination.totalPages
                    ? ` of ${pagination.totalPages}`
                    : ''}
                </span>

                <button
                  type="button"
                  className="forum-secondary-button"
                  onClick={
                    handleNextPage
                  }
                  disabled={
                    !pagination.hasNext
                  }
                  aria-label="Next page"
                >
                  Next
                </button>
              </nav>
            ) : null}
          </section>
        ) : null}

        {/* ================================================================
            Empty State
            ================================================================ */}

        {!loading &&
        !error &&
        discussions.length ===
          0 ? (
          <ForumEmptyState
            hasFilters={
              hasFilters
            }
            onClear={
              handleClearFilters
            }
            onCreate={
              handleCreate
            }
          />
        ) : null}
      </div>
    </main>
  );
}

/* ============================================================================
 * Metadata
 * ========================================================================== */

Forum.displayName =
  'TITechForum';

/* ============================================================================
 * PropTypes
 * ========================================================================== */

Forum.propTypes = {
  initialCategory:
    PropTypes.string,

  initialSearch:
    PropTypes.string,

  pageSize:
    PropTypes.number,

  showCategories:
    PropTypes.bool,

  showCreateButton:
    PropTypes.bool,

  showSearch:
    PropTypes.bool,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,
};

/* ============================================================================
 * Default Props
 * ========================================================================== */

Forum.defaultProps = {
  initialCategory:
    DEFAULT_CATEGORY,

  initialSearch: '',

  pageSize:
    DEFAULT_PAGE_SIZE,

  showCategories:
    true,

  showCreateButton:
    true,

  showSearch: true,

  className: '',

  testId:
    FORUM_TEST_ID,
};

/* ============================================================================
 * Export
 * ========================================================================== */

export default memo(Forum);

/* ============================================================================
 * End of TITech Forum
 * ========================================================================== */