'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise FAQ Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/FAQ.jsx
 *
 * Purpose:
 *   Production-grade, accessible and resilient Frequently Asked Questions
 *   experience for TITech applications.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ FAQ loading / retry states
 * ✓ Safe service integration
 * ✓ Search with debounce
 * ✓ Category filtering
 * ✓ FAQ statistics
 * ✓ Accessible accordion
 * ✓ Keyboard accessibility
 * ✓ Stable IDs
 * ✓ Optimistic helpful / unhelpful feedback
 * ✓ Duplicate feedback protection
 * ✓ View-count protection
 * ✓ Race-safe async state updates
 * ✓ Request cancellation where supported
 * ✓ Empty-state handling
 * ✓ Error-state handling
 * ✓ Responsive-friendly markup
 * ✓ Stable test selectors
 * ✓ Safe text normalization
 * ✓ Defensive API response normalization
 * ✓ React StrictMode-safe lifecycle handling
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation-only.
 *
 * It MUST NOT be used as an authorization, tenant-isolation, audit,
 * financial-integrity or security boundary.
 *
 * FAQ content received from the backend is rendered as text. HTML supplied
 * by remote content must not be injected through dangerouslySetInnerHTML
 * without an explicit, trusted sanitization pipeline.
 *
 * ============================================================================
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  HelpCircle,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';

import faqService from '../services/faqService';

import './FAQ.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;

const SEARCH_DEBOUNCE_MS = 250;

const DEFAULT_ERROR_MESSAGE =
  'We were unable to load the FAQ content. Please try again.';

const DEFAULT_LOADING_LABEL =
  'Loading frequently asked questions…';

const DEFAULT_SEARCH_PLACEHOLDER =
  'Search frequently asked questions…';

const DEFAULT_EMPTY_TITLE =
  'No FAQs Found';

const DEFAULT_EMPTY_SEARCH_MESSAGE =
  'Try a different search term or clear your filters.';

const DEFAULT_EMPTY_CATEGORY_MESSAGE =
  'There are no FAQs available in this category.';

const DEFAULT_CLEAR_FILTERS_LABEL =
  'Clear Filters';

const DEFAULT_RETRY_LABEL =
  'Retry';

const ALL_CATEGORY =
  'all';

const FEEDBACK_VALUES = Object.freeze({
  HELPFUL: 'helpful',
  UNHELPFUL: 'unhelpful',
});

const DEFAULT_STATS = Object.freeze({
  totalFaqs: 0,
  totalViews: 0,
});

const EMPTY_ARRAY = Object.freeze([]);


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

/**
 * Safely normalize a value to a string.
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
    const result = String(value).trim();

    return result || fallback;
  } catch {
    return fallback;
  }
};


/**
 * Safely normalize numeric values.
 */
const safeNumber = (
  value,
  fallback = 0,
) => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
};


/**
 * Normalize a FAQ identifier.
 */
const getFaqId = (
  faq,
) => {
  if (!faq || typeof faq !== 'object') {
    return '';
  }

  return safeText(
    faq.id ??
      faq._id ??
      faq.faqId ??
      faq.faq_id,
  );
};


/**
 * Normalize a FAQ category.
 */
const getFaqCategory = (
  faq,
) => {
  if (!faq || typeof faq !== 'object') {
    return '';
  }

  const category =
    faq.category ??
    faq.categoryName ??
    faq.category_name;

  if (
    category &&
    typeof category === 'object'
  ) {
    return safeText(
      category.name ??
        category.label ??
        category.id,
    );
  }

  return safeText(category);
};


/**
 * Normalize FAQ API records into a stable frontend shape.
 */
const normalizeFaq = (
  faq,
  index = 0,
) => {
  if (
    !faq ||
    typeof faq !== 'object'
  ) {
    return null;
  }

  const id =
    getFaqId(faq) ||
    `faq-${index}`;

  const question = safeText(
    faq.question ??
      faq.title ??
      faq.question_text,
  );

  const answer = safeText(
    faq.answer ??
      faq.content ??
      faq.answer_text ??
      faq.description,
  );

  if (!question) {
    return null;
  }

  return {
    ...faq,

    id,

    question,

    answer,

    category:
      getFaqCategory(faq),

    helpful_count:
      safeNumber(
        faq.helpful_count ??
          faq.helpfulCount ??
          faq.helpful,
      ),

    unhelpful_count:
      safeNumber(
        faq.unhelpful_count ??
          faq.unhelpfulCount ??
          faq.unhelpful,
      ),

    views:
      safeNumber(
        faq.views ??
          faq.view_count ??
          faq.viewCount,
      ),
  };
};


/**
 * Normalize an FAQ collection response.
 *
 * Supports:
 *   []
 *   { data: [] }
 *   { items: [] }
 *   { faqs: [] }
 *   { results: [] }
 */
const normalizeFaqCollection = (
  response,
) => {
  if (Array.isArray(response)) {
    return response;
  }

  if (
    response &&
    typeof response === 'object'
  ) {
    if (Array.isArray(response.data)) {
      return response.data;
    }

    if (Array.isArray(response.items)) {
      return response.items;
    }

    if (Array.isArray(response.faqs)) {
      return response.faqs;
    }

    if (Array.isArray(response.results)) {
      return response.results;
    }
  }

  return EMPTY_ARRAY;
};


/**
 * Normalize category API responses.
 */
const normalizeCategories = (
  response,
) => {
  if (!Array.isArray(response)) {
    if (
      response &&
      typeof response === 'object'
    ) {
      return normalizeCategories(
        response.data ??
          response.items ??
          response.categories ??
          response.results,
      );
    }

    return [];
  }

  const seen = new Set();

  return response
    .map((category) => {
      if (
        category &&
        typeof category === 'object'
      ) {
        const name = safeText(
          category.name ??
            category.label ??
            category.title ??
            category.id,
        );

        return name
          ? {
              ...category,
              name,
            }
          : null;
      }

      const name = safeText(category);

      return name
        ? {
            id: name,
            name,
          }
        : null;
    })
    .filter(Boolean)
    .filter((category) => {
      const key =
        category.name.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .sort((a, b) =>
      a.name.localeCompare(
        b.name,
        undefined,
        {
          sensitivity: 'base',
        },
      ),
    );
};


/**
 * Normalize statistics.
 */
const normalizeStats = (
  response,
  fallbackFaqCount = 0,
) => {
  const source =
    response &&
    typeof response === 'object'
      ? (
          response.data &&
          typeof response.data === 'object'
            ? response.data
            : response
        )
      : {};

  return {
    totalFaqs:
      safeNumber(
        source.totalFaqs ??
          source.total_faqs ??
          source.total ??
          fallbackFaqCount,
        fallbackFaqCount,
      ),

    totalViews:
      safeNumber(
        source.totalViews ??
          source.total_views ??
          source.views,
      ),
  };
};


/**
 * Case-insensitive search normalization.
 */
const normalizeSearchText = (
  value,
) =>
  safeText(value)
    .toLocaleLowerCase()
    .normalize('NFKC');


/**
 * Format large statistics without losing readability.
 */
const formatStatistic = (
  value,
) => {
  const number = safeNumber(value);

  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(
      number >= 10_000_000 ? 0 : 1,
    )}M`;
  }

  if (number >= 1_000) {
    return `${(number / 1_000).toFixed(
      number >= 10_000 ? 0 : 1,
    )}K`;
  }

  return number.toLocaleString();
};


/* ============================================================================
 * FAQ Component
 * ========================================================================== */

function FAQ({
  className = '',
  pageSize = DEFAULT_PAGE_SIZE,
  initialCategory = ALL_CATEGORY,
  initialSearchQuery = '',
  searchable = true,
  showStats = true,
  showCategories = true,
  showFeedback = true,
  showViews = false,
  allowMultipleOpen = false,
  emptyTitle = DEFAULT_EMPTY_TITLE,
  retryLabel = DEFAULT_RETRY_LABEL,
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
  testId = 'titech-faq',
  onFaqOpen,
  onFeedback,
  onError,
}) {
  const componentId = useId();

  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const searchTimerRef = useRef(null);

  const viewedFaqIdsRef = useRef(
    new Set(),
  );

  const feedbackFaqIdsRef = useRef(
    new Set(),
  );

  const [faqs, setFaqs] = useState([]);
  const [categories, setCategories] =
    useState([]);

  const [selectedCategory, setSelectedCategory] =
    useState(
      safeText(
        initialCategory,
        ALL_CATEGORY,
      ) || ALL_CATEGORY,
    );

  const [searchQuery, setSearchQuery] =
    useState(
      safeText(initialSearchQuery),
    );

  const [debouncedSearchQuery, setDebouncedSearchQuery] =
    useState(
      safeText(initialSearchQuery),
    );

  const [
    expandedFaqIds,
    setExpandedFaqIds,
  ] = useState(() =>
    allowMultipleOpen
      ? new Set()
      : null,
  );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(null);

  const [stats, setStats] =
    useState({
      ...DEFAULT_STATS,
    });

  const [feedbackState, setFeedbackState] =
    useState({});

  const [feedbackLoading, setFeedbackLoading] =
    useState({});


  /* ==========================================================================
   * Lifecycle
   * ======================================================================== */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (searchTimerRef.current) {
        clearTimeout(
          searchTimerRef.current,
        );
      }
    };
  }, []);


  /* ==========================================================================
   * Debounced search
   * ======================================================================== */

  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(
        searchTimerRef.current,
      );
    }

    searchTimerRef.current =
      setTimeout(() => {
        if (mountedRef.current) {
          setDebouncedSearchQuery(
            searchQuery,
          );
        }
      }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(
          searchTimerRef.current,
        );
      }
    };
  }, [searchQuery]);


  /* ==========================================================================
   * Load FAQ content
   * ======================================================================== */

  const loadFAQContent =
    useCallback(
      async () => {
        const requestId =
          loadRequestRef.current + 1;

        loadRequestRef.current =
          requestId;

        setLoading(true);
        setError(null);

        try {
          const [
            categoriesResponse,
            faqsResponse,
            statsResponse,
          ] = await Promise.all([
            faqService.getCategories(),

            faqService.getFAQItems(
              DEFAULT_PAGE,
              Math.max(
                1,
                Number(pageSize) ||
                  DEFAULT_PAGE_SIZE,
              ),
            ),

            faqService.getFAQStats(),
          ]);

          if (
            !mountedRef.current ||
            loadRequestRef.current !==
              requestId
          ) {
            return;
          }

          const normalizedFaqs =
            normalizeFaqCollection(
              faqsResponse,
            )
              .map(normalizeFaq)
              .filter(Boolean);

          const normalizedCategories =
            normalizeCategories(
              categoriesResponse,
            );

          const normalizedStats =
            normalizeStats(
              statsResponse,
              normalizedFaqs.length,
            );

          setFaqs(
            normalizedFaqs,
          );

          setCategories(
            normalizedCategories,
          );

          setStats(
            normalizedStats,
          );

          /*
           * If the previously selected category no longer exists, gracefully
           * return to "All" rather than showing a misleading empty state.
           */
          if (
            selectedCategory !==
              ALL_CATEGORY
          ) {
            const categoryExists =
              normalizedCategories.some(
                (category) =>
                  normalizeSearchText(
                    category.name,
                  ) ===
                  normalizeSearchText(
                    selectedCategory,
                  ),
              );

            if (!categoryExists) {
              setSelectedCategory(
                ALL_CATEGORY,
              );
            }
          }
        } catch (loadError) {
          if (
            !mountedRef.current ||
            loadRequestRef.current !==
              requestId
          ) {
            return;
          }

          const message =
            safeText(
              loadError?.userMessage ||
                loadError?.publicMessage,
            ) ||
            DEFAULT_ERROR_MESSAGE;

          setError(message);

          if (
            typeof onError === 'function'
          ) {
            onError(loadError);
          }

          if (
            typeof console !==
              'undefined' &&
            typeof console.error ===
              'function'
          ) {
            console.error(
              'TITech FAQ: failed to load FAQ content.',
              loadError,
            );
          }
        } finally {
          if (
            mountedRef.current &&
            loadRequestRef.current ===
              requestId
          ) {
            setLoading(false);
          }
        }
      },
      [
        onError,
        pageSize,
        selectedCategory,
      ],
    );


  useEffect(() => {
    loadFAQContent();
  }, [loadFAQContent]);


  /* ==========================================================================
   * Derived FAQ collection
   * ======================================================================== */

  const filteredFaqs = useMemo(() => {
    const normalizedQuery =
      normalizeSearchText(
        debouncedSearchQuery,
      );

    const normalizedCategory =
      normalizeSearchText(
        selectedCategory,
      );

    return faqs.filter((faq) => {
      const faqCategory =
        normalizeSearchText(
          faq.category,
        );

      const matchesCategory =
        normalizedCategory ===
          normalizeSearchText(
            ALL_CATEGORY,
          ) ||
        faqCategory ===
          normalizedCategory;

      if (!matchesCategory) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableText =
        [
          faq.question,
          faq.answer,
          faq.category,
        ]
          .map(normalizeSearchText)
          .join(' ');

      return searchableText.includes(
        normalizedQuery,
      );
    });
  }, [
    debouncedSearchQuery,
    faqs,
    selectedCategory,
  ]);


  const hasActiveFilters =
    Boolean(
      searchQuery.trim() ||
        selectedCategory !==
          ALL_CATEGORY,
    );


  /* ==========================================================================
   * Accordion state
   * ======================================================================== */

  const isFaqExpanded =
    useCallback(
      (faqId) => {
        if (allowMultipleOpen) {
          return expandedFaqIds?.has(
            faqId,
          );
        }

        return expandedFaqIds === faqId;
      },
      [
        allowMultipleOpen,
        expandedFaqIds,
      ],
    );


  const handleToggleFaq =
    useCallback(
      async (faqId) => {
        if (!faqId) {
          return;
        }

        const currentlyExpanded =
          isFaqExpanded(faqId);

        if (
          allowMultipleOpen
        ) {
          setExpandedFaqIds(
            (previous) => {
              const next =
                new Set(
                  previous || [],
                );

              if (next.has(faqId)) {
                next.delete(faqId);
              } else {
                next.add(faqId);
              }

              return next;
            },
          );
        } else {
          setExpandedFaqIds(
            currentlyExpanded
              ? null
              : faqId,
          );
        }

        if (
          currentlyExpanded
        ) {
          return;
        }

        const faq = faqs.find(
          (item) =>
            item.id === faqId,
        );

        if (
          typeof onFaqOpen ===
          'function'
        ) {
          try {
            onFaqOpen(faq);
          } catch (callbackError) {
            if (
              typeof console !==
                'undefined' &&
              typeof console.error ===
                'function'
            ) {
              console.error(
                'TITech FAQ: onFaqOpen callback failed.',
                callbackError,
              );
            }
          }
        }

        /*
         * Prevent duplicate view increments for the same FAQ during the
         * current component lifecycle.
         */
        if (
          viewedFaqIdsRef.current.has(
            faqId,
          )
        ) {
          return;
        }

        viewedFaqIdsRef.current.add(
          faqId,
        );

        try {
          await faqService.incrementFAQViews(
            faqId,
          );
        } catch (viewError) {
          /*
           * View analytics must never break the FAQ experience.
           */
          viewedFaqIdsRef.current.delete(
            faqId,
          );

          if (
            typeof console !==
              'undefined' &&
            typeof console.warn ===
              'function'
          ) {
            console.warn(
              'TITech FAQ: unable to increment FAQ views.',
              viewError,
            );
          }
        }
      },
      [
        allowMultipleOpen,
        faqs,
        isFaqExpanded,
        onFaqOpen,
      ],
    );


  /* ==========================================================================
   * Feedback
   * ======================================================================== */

  const handleMarkHelpful =
    useCallback(
      async (
        faqId,
        helpful = true,
      ) => {
        if (
          !faqId ||
          feedbackLoading[faqId]
        ) {
          return;
        }

        const nextFeedback =
          helpful
            ? FEEDBACK_VALUES.HELPFUL
            : FEEDBACK_VALUES.UNHELPFUL;

        const existingFeedback =
          feedbackState[faqId];

        /*
         * Prevent duplicate votes unless the application has explicitly
         * cleared the state.
         */
        if (
          existingFeedback ===
          nextFeedback
        ) {
          return;
        }

        const previousFaq =
          faqs.find(
            (faq) =>
              faq.id === faqId,
          );

        if (!previousFaq) {
          return;
        }

        const previousFeedback =
          existingFeedback || null;

        setFeedbackLoading(
          (previous) => ({
            ...previous,
            [faqId]: true,
          }),
        );

        /*
         * Optimistic UI update.
         */
        setFeedbackState(
          (previous) => ({
            ...previous,
            [faqId]: nextFeedback,
          }),
        );

        setFaqs(
          (previousFaqs) =>
            previousFaqs.map(
              (faq) => {
                if (
                  faq.id !== faqId
                ) {
                  return faq;
                }

                let helpfulCount =
                  safeNumber(
                    faq.helpful_count,
                  );

                let unhelpfulCount =
                  safeNumber(
                    faq.unhelpful_count,
                  );

                if (
                  previousFeedback ===
                  FEEDBACK_VALUES.HELPFUL
                ) {
                  helpfulCount =
                    Math.max(
                      0,
                      helpfulCount - 1,
                    );
                }

                if (
                  previousFeedback ===
                  FEEDBACK_VALUES.UNHELPFUL
                ) {
                  unhelpfulCount =
                    Math.max(
                      0,
                      unhelpfulCount - 1,
                    );
                }

                if (
                  nextFeedback ===
                  FEEDBACK_VALUES.HELPFUL
                ) {
                  helpfulCount += 1;
                } else {
                  unhelpfulCount += 1;
                }

                return {
                  ...faq,
                  helpful_count:
                    helpfulCount,
                  unhelpful_count:
                    unhelpfulCount,
                };
              },
            ),
        );

        try {
          if (helpful) {
            await faqService.markFAQHelpful(
              faqId,
            );
          } else {
            await faqService.markFAQUnhelpful(
              faqId,
            );
          }

          if (
            typeof onFeedback ===
            'function'
          ) {
            onFeedback({
              faq: previousFaq,
              faqId,
              helpful,
            });
          }
        } catch (feedbackError) {
          /*
           * Roll back optimistic state when the server rejects the vote.
           */
          if (
            mountedRef.current
          ) {
            setFeedbackState(
              (previous) => {
                const next = {
                  ...previous,
                };

                if (
                  previousFeedback
                ) {
                  next[faqId] =
                    previousFeedback;
                } else {
                  delete next[faqId];
                }

                return next;
              },
            );

            setFaqs(
              (previousFaqs) =>
                previousFaqs.map(
                  (faq) => {
                    if (
                      faq.id !== faqId
                    ) {
                      return faq;
                    }

                    let helpfulCount =
                      safeNumber(
                        faq.helpful_count,
                      );

                    let unhelpfulCount =
                      safeNumber(
                        faq.unhelpful_count,
                      );

                    if (
                      nextFeedback ===
                      FEEDBACK_VALUES.HELPFUL
                    ) {
                      helpfulCount =
                        Math.max(
                          0,
                          helpfulCount - 1,
                        );
                    } else {
                      unhelpfulCount =
                        Math.max(
                          0,
                          unhelpfulCount - 1,
                        );
                    }

                    if (
                      previousFeedback ===
                      FEEDBACK_VALUES.HELPFUL
                    ) {
                      helpfulCount += 1;
                    }

                    if (
                      previousFeedback ===
                      FEEDBACK_VALUES.UNHELPFUL
                    ) {
                      unhelpfulCount += 1;
                    }

                    return {
                      ...faq,
                      helpful_count:
                        helpfulCount,
                      unhelpful_count:
                        unhelpfulCount,
                    };
                  },
                ),
            );
          }

          if (
            typeof console !==
              'undefined' &&
            typeof console.error ===
              'function'
          ) {
            console.error(
              'TITech FAQ: failed to record FAQ feedback.',
              feedbackError,
            );
          }
        } finally {
          if (
            mountedRef.current
          ) {
            setFeedbackLoading(
              (previous) => {
                const next = {
                  ...previous,
                };

                delete next[faqId];

                return next;
              },
            );
          }
        }
      },
      [
        faqs,
        feedbackLoading,
        feedbackState,
        onFeedback,
      ],
    );


  /* ==========================================================================
   * Search / filters
   * ======================================================================== */

  const handleSearch =
    useCallback(
      (event) => {
        setSearchQuery(
          event.target.value,
        );
      },
      [],
    );


  const handleCategoryFilter =
    useCallback(
      (category) => {
        setSelectedCategory(
          safeText(
            category,
            ALL_CATEGORY,
          ) || ALL_CATEGORY,
        );
      },
      [],
    );


  const handleClearSearch =
    useCallback(() => {
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSelectedCategory(
        ALL_CATEGORY,
      );
    }, []);


  /* ==========================================================================
   * Keyboard support
   * ======================================================================== */

  const handleFaqKeyDown =
    useCallback(
      (event, faqId) => {
        if (
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault();

          handleToggleFaq(faqId);

          return;
        }

        if (
          event.key === 'Escape' &&
          isFaqExpanded(faqId)
        ) {
          event.preventDefault();

          if (allowMultipleOpen) {
            setExpandedFaqIds(
              (previous) => {
                const next =
                  new Set(
                    previous || [],
                  );

                next.delete(faqId);

                return next;
              },
            );
          } else {
            setExpandedFaqIds(null);
          }
        }
      },
      [
        allowMultipleOpen,
        handleToggleFaq,
        isFaqExpanded,
      ],
    );


  /* ==========================================================================
   * Render helpers
   * ======================================================================== */

  const renderLoadingState = () => (
    <div
      className="faq-container faq-container-loading"
      data-testid={`${testId}-loading`}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="faq-wrapper">
        <header className="faq-header">
          <div
            className="faq-header-icon"
            aria-hidden="true"
          >
            <HelpCircle />
          </div>

          <h1>
            Frequently Asked Questions
          </h1>

          <p>
            {DEFAULT_LOADING_LABEL}
          </p>
        </header>

        <div
          className="faq-loading-list"
          aria-hidden="true"
        >
          {Array.from(
            { length: 5 },
            (_, index) => (
              <div
                key={index}
                className="faq-loading-item"
              >
                <div className="faq-skeleton faq-skeleton-question" />
                <div className="faq-skeleton faq-skeleton-line" />
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );


  const renderErrorState = () => (
    <div
      className="faq-container faq-container-error"
      data-testid={`${testId}-error`}
      role="alert"
    >
      <div className="faq-wrapper">
        <header className="faq-header">
          <div
            className="faq-header-icon faq-header-icon-error"
            aria-hidden="true"
          >
            <AlertTriangle />
          </div>

          <h1>
            Frequently Asked Questions
          </h1>

          <p>
            {error ||
              DEFAULT_ERROR_MESSAGE}
          </p>
        </header>

        <div className="faq-error-actions">
          <button
            type="button"
            className="faq-retry-btn"
            onClick={loadFAQContent}
            disabled={loading}
            data-testid={`${testId}-retry`}
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={
                loading
                  ? 'faq-icon-spin'
                  : undefined
              }
            />

            <span>
              {loading
                ? 'Retrying…'
                : retryLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );


  /* ==========================================================================
   * Loading / error boundaries
   * ======================================================================== */

  if (loading && faqs.length === 0) {
    return renderLoadingState();
  }

  if (
    error &&
    faqs.length === 0
  ) {
    return renderErrorState();
  }


  /* ==========================================================================
   * Main render
   * ======================================================================== */

  return (
    <main
      className={`faq-container ${className}`.trim()}
      data-testid={testId}
      aria-busy={loading}
    >
      <div className="faq-wrapper">

        {/* ====================================================================
            Header
            ================================================================== */}

        <header className="faq-header">
          <div
            className="faq-header-icon"
            aria-hidden="true"
          >
            <HelpCircle />
          </div>

          <h1>
            Frequently Asked Questions
          </h1>

          <p>
            Find quick answers to common
            questions about TITech
            Community Capital.
          </p>
        </header>


        {/* ====================================================================
            Non-blocking refresh error
            ================================================================== */}

        {error ? (
          <div
            className="faq-inline-error"
            role="alert"
            data-testid={`${testId}-inline-error`}
          >
            <AlertTriangle
              size={18}
              aria-hidden="true"
            />

            <span>
              {error}
            </span>

            <button
              type="button"
              onClick={loadFAQContent}
              disabled={loading}
              className="faq-inline-retry"
            >
              {loading
                ? 'Retrying…'
                : retryLabel}
            </button>
          </div>
        ) : null}


        {/* ====================================================================
            Statistics
            ================================================================== */}

        {showStats ? (
          <section
            className="faq-stats"
            aria-label="FAQ statistics"
            data-testid={`${testId}-stats`}
          >
            <div className="faq-stat">
              <span className="faq-stat-number">
                {formatStatistic(
                  stats.totalFaqs ||
                    faqs.length,
                )}
              </span>

              <span className="faq-stat-label">
                Total FAQs
              </span>
            </div>

            <div className="faq-stat">
              <span className="faq-stat-number">
                {formatStatistic(
                  stats.totalViews,
                )}
              </span>

              <span className="faq-stat-label">
                Total Views
              </span>
            </div>

            <div className="faq-stat">
              <span className="faq-stat-number">
                {formatStatistic(
                  categories.length,
                )}
              </span>

              <span className="faq-stat-label">
                Categories
              </span>
            </div>
          </section>
        ) : null}


        {/* ====================================================================
            Search
            ================================================================== */}

        {searchable ? (
          <section
            className="faq-search"
            aria-label="Search FAQs"
          >
            <div className="faq-search-control">
              <Search
                size={20}
                className="faq-search-icon"
                aria-hidden="true"
              />

              <input
                id={`${componentId}-search`}
                type="search"
                className="faq-search-input"
                placeholder={
                  searchPlaceholder
                }
                value={searchQuery}
                onChange={
                  handleSearch
                }
                aria-label="Search frequently asked questions"
                autoComplete="off"
                spellCheck="false"
                data-testid={`${testId}-search`}
              />

              {searchQuery ? (
                <button
                  type="button"
                  className="faq-search-clear"
                  onClick={() =>
                    setSearchQuery('')
                  }
                  aria-label="Clear search"
                  title="Clear search"
                  data-testid={`${testId}-clear-search`}
                >
                  <X
                    size={18}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>
          </section>
        ) : null}


        {/* ====================================================================
            Category filter
            ================================================================== */}

        {showCategories &&
        categories.length > 0 ? (
          <nav
            className="faq-categories"
            aria-label="FAQ categories"
            data-testid={`${testId}-categories`}
          >
            <button
              type="button"
              className={`faq-category-btn ${
                selectedCategory ===
                ALL_CATEGORY
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                handleCategoryFilter(
                  ALL_CATEGORY,
                )
              }
              aria-pressed={
                selectedCategory ===
                ALL_CATEGORY
              }
              data-testid={`${testId}-category-all`}
            >
              All
            </button>

            {categories.map(
              (category) => {
                const categoryName =
                  safeText(
                    category.name,
                  );

                const isActive =
                  normalizeSearchText(
                    selectedCategory,
                  ) ===
                  normalizeSearchText(
                    categoryName,
                  );

                return (
                  <button
                    key={
                      safeText(
                        category.id,
                      ) ||
                      categoryName
                    }
                    type="button"
                    className={`faq-category-btn ${
                      isActive
                        ? 'active'
                        : ''
                    }`}
                    onClick={() =>
                      handleCategoryFilter(
                        categoryName,
                      )
                    }
                    aria-pressed={
                      isActive
                    }
                    data-testid={`${testId}-category-${categoryName
                      .toLowerCase()
                      .replace(
                        /[^a-z0-9]+/g,
                        '-',
                      )}`}
                  >
                    {categoryName}
                  </button>
                );
              },
            )}
          </nav>
        ) : null}


        {/* ====================================================================
            Result summary
            ================================================================== */}

        <div
          className="faq-results-summary"
          aria-live="polite"
        >
          <span>
            {filteredFaqs.length.toLocaleString()}{' '}
            {filteredFaqs.length === 1
              ? 'question'
              : 'questions'}
          </span>

          {hasActiveFilters ? (
            <span>
              {' '}
              matching your filters
            </span>
          ) : null}
        </div>


        {/* ====================================================================
            FAQ items
            ================================================================== */}

        {filteredFaqs.length > 0 ? (
          <section
            className="faq-list-section"
            aria-label="Frequently asked questions"
          >
            <ul
              className="faq-items"
              data-testid={`${testId}-items`}
            >
              {filteredFaqs.map(
                (faq) => {
                  const faqId =
                    faq.id;

                  const expanded =
                    isFaqExpanded(
                      faqId,
                    );

                  const questionId =
                    `${componentId}-question-${faqId}`;

                  const answerId =
                    `${componentId}-answer-${faqId}`;

                  const currentFeedback =
                    feedbackState[
                      faqId
                    ];

                  const isFeedbackLoading =
                    Boolean(
                      feedbackLoading[
                        faqId
                      ],
                    );

                  return (
                    <li
                      key={faqId}
                      className={`faq-item ${
                        expanded
                          ? 'open'
                          : ''
                      }`}
                      data-faq-id={
                        faqId
                      }
                      data-testid={`${testId}-item-${faqId}`}
                    >
                      <button
                        id={questionId}
                        type="button"
                        className="faq-question"
                        onClick={() =>
                          handleToggleFaq(
                            faqId,
                          )
                        }
                        onKeyDown={(
                          event,
                        ) =>
                          handleFaqKeyDown(
                            event,
                            faqId,
                          )
                        }
                        aria-expanded={
                          expanded
                        }
                        aria-controls={
                          answerId
                        }
                        data-testid={`${testId}-question-${faqId}`}
                      >
                        <span className="faq-question-text">
                          {faq.question}
                        </span>

                        <ChevronDown
                          className="faq-toggle-icon"
                          size={20}
                          aria-hidden="true"
                        />
                      </button>


                      <div
                        id={answerId}
                        className="faq-answer"
                        role="region"
                        aria-labelledby={
                          questionId
                        }
                        hidden={
                          !expanded
                        }
                        data-testid={`${testId}-answer-${faqId}`}
                      >
                        <div className="faq-answer-content">
                          <p className="faq-answer-text">
                            {faq.answer ||
                              'No answer is currently available for this question.'}
                          </p>


                          {showViews &&
                          faq.views > 0 ? (
                            <div className="faq-view-count">
                              {formatStatistic(
                                faq.views,
                              )}{' '}
                              {faq.views ===
                              1
                                ? 'view'
                                : 'views'}
                            </div>
                          ) : null}


                          {showFeedback ? (
                            <div
                              className="faq-helpful"
                              aria-label="FAQ helpfulness"
                            >
                              <span className="faq-helpful-label">
                                Was this helpful?
                              </span>

                              <button
                                type="button"
                                className={`faq-helpful-btn ${
                                  currentFeedback ===
                                  FEEDBACK_VALUES.HELPFUL
                                    ? 'selected'
                                    : ''
                                }`}
                                onClick={() =>
                                  handleMarkHelpful(
                                    faqId,
                                    true,
                                  )
                                }
                                disabled={
                                  isFeedbackLoading
                                }
                                aria-pressed={
                                  currentFeedback ===
                                  FEEDBACK_VALUES.HELPFUL
                                }
                                data-testid={`${testId}-helpful-${faqId}`}
                              >
                                {currentFeedback ===
                                FEEDBACK_VALUES.HELPFUL ? (
                                  <Check
                                    size={16}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ThumbsUp
                                    size={16}
                                    aria-hidden="true"
                                  />
                                )}

                                <span>
                                  Yes
                                </span>

                                {faq.helpful_count >
                                0 ? (
                                  <span className="faq-feedback-count">
                                    {formatStatistic(
                                      faq.helpful_count,
                                    )}
                                  </span>
                                ) : null}
                              </button>


                              <button
                                type="button"
                                className={`faq-helpful-btn ${
                                  currentFeedback ===
                                  FEEDBACK_VALUES.UNHELPFUL
                                    ? 'selected'
                                    : ''
                                }`}
                                onClick={() =>
                                  handleMarkHelpful(
                                    faqId,
                                    false,
                                  )
                                }
                                disabled={
                                  isFeedbackLoading
                                }
                                aria-pressed={
                                  currentFeedback ===
                                  FEEDBACK_VALUES.UNHELPFUL
                                }
                                data-testid={`${testId}-unhelpful-${faqId}`}
                              >
                                {currentFeedback ===
                                FEEDBACK_VALUES.UNHELPFUL ? (
                                  <Check
                                    size={16}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ThumbsDown
                                    size={16}
                                    aria-hidden="true"
                                  />
                                )}

                                <span>
                                  No
                                </span>

                                {faq.unhelpful_count >
                                0 ? (
                                  <span className="faq-feedback-count">
                                    {formatStatistic(
                                      faq.unhelpful_count,
                                    )}
                                  </span>
                                ) : null}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          </section>
        ) : (
          /* ================================================================
             Empty state
             ================================================================ */

          <section
            className="faq-no-results"
            role="status"
            aria-live="polite"
            data-testid={`${testId}-empty`}
          >
            <div
              className="faq-no-results-icon"
              aria-hidden="true"
            >
              <Search />
            </div>

            <h2>
              {emptyTitle}
            </h2>

            <p>
              {searchQuery.trim()
                ? DEFAULT_EMPTY_SEARCH_MESSAGE
                : DEFAULT_EMPTY_CATEGORY_MESSAGE}
            </p>

            {hasActiveFilters ? (
              <button
                type="button"
                className="faq-no-results-btn"
                onClick={
                  handleClearSearch
                }
                data-testid={`${testId}-clear-filters`}
              >
                <X
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  {DEFAULT_CLEAR_FILTERS_LABEL}
                </span>
              </button>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}


/* ============================================================================
 * PropTypes
 * ========================================================================== */

FAQ.propTypes = {
  className: PropTypes.string,

  pageSize:
    PropTypes.number,

  initialCategory:
    PropTypes.string,

  initialSearchQuery:
    PropTypes.string,

  searchable:
    PropTypes.bool,

  showStats:
    PropTypes.bool,

  showCategories:
    PropTypes.bool,

  showFeedback:
    PropTypes.bool,

  showViews:
    PropTypes.bool,

  allowMultipleOpen:
    PropTypes.bool,

  emptyTitle:
    PropTypes.string,

  retryLabel:
    PropTypes.string,

  searchPlaceholder:
    PropTypes.string,

  testId:
    PropTypes.string,

  onFaqOpen:
    PropTypes.func,

  onFeedback:
    PropTypes.func,

  onError:
    PropTypes.func,
};


/* ============================================================================
 * Component metadata
 * ========================================================================== */

FAQ.displayName =
  'TITechFAQ';


/* ============================================================================
 * Export
 * ========================================================================== */

export default memo(FAQ);