/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise SearchBox Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/SearchBox.jsx
 *
 * Purpose:
 *   Reusable enterprise-grade search input for the TITech Community Capital
 *   frontend.
 *
 * Features:
 *   ✓ Controlled and uncontrolled usage
 *   ✓ Debounced search
 *   ✓ Keyboard navigation
 *   ✓ ArrowUp / ArrowDown navigation
 *   ✓ Enter selection
 *   ✓ Escape handling
 *   ✓ Clear search
 *   ✓ Loading state
 *   ✓ Error state
 *   ✓ Empty state
 *   ✓ Accessible combobox semantics
 *   ✓ Configurable result rendering
 *   ✓ Configurable search callback
 *   ✓ Configurable minimum search length
 *   ✓ Configurable debounce delay
 *   ✓ Click-outside handling
 *   ✓ Mobile-friendly UI
 *   ✓ Dark-mode friendly styling
 *   ✓ Enterprise financial-platform friendly defaults
 *
 * Notes:
 *   - This component intentionally contains no ACFOS references.
 *   - It is UI-library agnostic and can be used with Tailwind CSS.
 *   - The search function may return:
 *       1. an array
 *       2. { data: [] }
 *       3. { results: [] }
 *       4. { data: { results: [] } }
 *   - Errors are handled without crashing the parent component.
 *
 * Example:
 *
 *   <SearchBox
 *     placeholder="Search members, groups, transactions..."
 *     onSearch={async (query) => {
 *       const response = await api.get(`/search?q=${query}`);
 *       return response.data;
 *     }}
 *     onSelect={(result) => {
 *       console.log("Selected:", result);
 *     }}
 *   />
 *
 * ============================================================================
 */

'use client';

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

/**
 * ---------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------
 */

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_QUERY_LENGTH = 2;
const DEFAULT_MAX_RESULTS = 10;

/**
 * ---------------------------------------------------------------------------
 * Utility helpers
 * ---------------------------------------------------------------------------
 */

/**
 * Safely normalize different API response shapes.
 *
 * Supported:
 *   []
 *   { data: [] }
 *   { results: [] }
 *   { data: { results: [] } }
 */
const normalizeResults = (response) => {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.results)) {
    return response.results;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response?.data?.results)) {
    return response.data.results;
  }

  return [];
};

/**
 * Extract a useful display label from a result.
 */
const getResultLabel = (result) => {
  if (result == null) {
    return '';
  }

  if (typeof result === 'string' || typeof result === 'number') {
    return String(result);
  }

  return (
    result.name ||
    result.fullName ||
    result.memberName ||
    result.groupName ||
    result.title ||
    result.label ||
    result.description ||
    result.email ||
    result.phoneNumber ||
    result.phone ||
    result.id ||
    ''
  );
};

/**
 * Extract a stable result key.
 */
const getResultKey = (result, index) => {
  if (result == null) {
    return `search-result-${index}`;
  }

  if (typeof result === 'string' || typeof result === 'number') {
    return `search-result-${result}-${index}`;
  }

  return (
    result.id ||
    result._id ||
    result.uuid ||
    result.memberId ||
    result.groupId ||
    result.transactionId ||
    `search-result-${index}`
  );
};

/**
 * ---------------------------------------------------------------------------
 * SearchBox
 * ---------------------------------------------------------------------------
 */

const SearchBox = forwardRef(function SearchBox(
  {
    value,
    defaultValue = '',
    onChange,
    onSearch,
    onSelect,
    onClear,

    results: controlledResults,
    loading: controlledLoading = false,
    error: controlledError = null,

    placeholder = 'Search...',
    ariaLabel = 'Search',
    name = 'search',
    id,

    debounceMs = DEFAULT_DEBOUNCE_MS,
    minQueryLength = DEFAULT_MIN_QUERY_LENGTH,
    maxResults = DEFAULT_MAX_RESULTS,

    disabled = false,
    readOnly = false,
    autoFocus = false,

    clearable = true,
    showResults = true,
    closeOnSelect = true,
    searchOnEmpty = false,

    renderResult,
    renderEmpty,
    renderError,

    className = '',
    inputClassName = '',
    dropdownClassName = '',
    resultClassName = '',

    size = 'md',

    /**
     * Optional callback fired whenever the search request starts.
     */
    onSearchStart,

    /**
     * Optional callback fired whenever a search request finishes.
     */
    onSearchEnd,

    /**
     * Optional callback for search errors.
     */
    onSearchError,

    /**
     * Optional callback when dropdown visibility changes.
     */
    onOpenChange,

    /**
     * Optional custom search icon.
     */
    searchIcon,

    /**
     * Optional custom clear icon.
     */
    clearIcon,

    /**
     * Optional custom loading indicator.
     */
    loadingIndicator,

    /**
     * Optional message shown when query is below minimum length.
     */
    minQueryMessage = `Enter at least ${minQueryLength} characters to search.`,

    /**
     * Optional empty-state message.
     */
    emptyMessage = 'No results found.',

    /**
     * Optional error-state message.
     */
    errorMessage = 'Unable to complete the search. Please try again.',

    /**
     * Optional class for wrapper when focused.
     */
    focusClassName = '',

    ...inputProps
  },
  ref,
) {
  /**
   * -------------------------------------------------------------------------
   * Controlled / uncontrolled value
   * -------------------------------------------------------------------------
   */

  const isControlled = value !== undefined;

  const [internalValue, setInternalValue] = useState(defaultValue);

  const query = isControlled ? value ?? '' : internalValue;

  /**
   * -------------------------------------------------------------------------
   * State
   * -------------------------------------------------------------------------
   */

  const [internalResults, setInternalResults] = useState([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState(null);

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  /**
   * -------------------------------------------------------------------------
   * Refs
   * -------------------------------------------------------------------------
   */

  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const listboxRef = useRef(null);

  const debounceTimerRef = useRef(null);
  const requestSequenceRef = useRef(0);

  const resultRefs = useRef([]);

  /**
   * -------------------------------------------------------------------------
   * IDs
   * -------------------------------------------------------------------------
   */

  const generatedId = useId();

  const inputId = id || `titech-search-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const statusId = `${inputId}-status`;

  /**
   * -------------------------------------------------------------------------
   * Derived state
   * -------------------------------------------------------------------------
   */

  const results = controlledResults !== undefined
    ? Array.isArray(controlledResults)
      ? controlledResults
      : normalizeResults(controlledResults)
    : internalResults;

  const loading =
    controlledResults !== undefined
      ? controlledLoading
      : internalLoading;

  const error =
    controlledResults !== undefined
      ? controlledError
      : internalError;

  const visibleResults = useMemo(
    () => results.slice(0, maxResults),
    [results, maxResults],
  );

  const normalizedQuery = String(query ?? '').trim();

  const hasMinimumQuery =
    normalizedQuery.length >= minQueryLength;

  const shouldShowDropdown =
    showResults &&
    isOpen &&
    !disabled &&
    !readOnly &&
    (
      loading ||
      error ||
      visibleResults.length > 0 ||
      normalizedQuery.length > 0
    );

  /**
   * -------------------------------------------------------------------------
   * Size styles
   * -------------------------------------------------------------------------
   */

  const sizeClasses = {
    sm: {
      wrapper: 'h-9',
      input:
        'h-9 pl-9 pr-9 text-sm',
      icon:
        'left-3',
      clear:
        'right-2',
    },

    md: {
      wrapper: 'h-11',
      input:
        'h-11 pl-10 pr-10 text-sm',
      icon:
        'left-3.5',
      clear:
        'right-3',
    },

    lg: {
      wrapper: 'h-12',
      input:
        'h-12 pl-11 pr-11 text-base',
      icon:
        'left-3.5',
      clear:
        'right-3',
    },
  };

  const currentSize =
    sizeClasses[size] || sizeClasses.md;

  /**
   * -------------------------------------------------------------------------
   * Dropdown visibility
   * -------------------------------------------------------------------------
   */

  const updateOpenState = useCallback(
    (nextOpen) => {
      setIsOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  /**
   * -------------------------------------------------------------------------
   * Exposed imperative API
   * -------------------------------------------------------------------------
   */

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        inputRef.current?.focus();
      },

      blur: () => {
        inputRef.current?.blur();
      },

      clear: () => {
        handleClear();
      },

      open: () => {
        if (!disabled && !readOnly) {
          updateOpenState(true);
        }
      },

      close: () => {
        updateOpenState(false);
      },

      getValue: () => query,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      disabled,
      readOnly,
      query,
      updateOpenState,
    ],
  );

  /**
   * -------------------------------------------------------------------------
   * Update value
   * -------------------------------------------------------------------------
   */

  const updateValue = useCallback(
    (nextValue) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }

      onChange?.(nextValue);
    },
    [isControlled, onChange],
  );

  /**
   * -------------------------------------------------------------------------
   * Execute search
   * -------------------------------------------------------------------------
   */

  const executeSearch = useCallback(
    async (searchQuery) => {
      const cleanQuery = String(searchQuery ?? '').trim();

      if (!onSearch) {
        return;
      }

      if (
        !searchOnEmpty &&
        cleanQuery.length < minQueryLength
      ) {
        setInternalResults([]);
        setInternalError(null);
        setInternalLoading(false);
        setHighlightedIndex(-1);
        return;
      }

      const requestId = ++requestSequenceRef.current;

      setInternalLoading(true);
      setInternalError(null);
      setHighlightedIndex(-1);

      onSearchStart?.(cleanQuery);

      try {
        const response = await onSearch(cleanQuery);

        /**
         * Ignore stale responses.
         *
         * This prevents an older, slower request from replacing the results
         * returned by a newer request.
         */
        if (requestId !== requestSequenceRef.current) {
          return;
        }

        const normalizedResults = normalizeResults(response);

        setInternalResults(normalizedResults);
        updateOpenState(true);
      } catch (searchError) {
        if (requestId !== requestSequenceRef.current) {
          return;
        }

        setInternalResults([]);

        const normalizedError =
          searchError instanceof Error
            ? searchError
            : new Error(errorMessage);

        setInternalError(normalizedError);

        onSearchError?.(normalizedError);
        updateOpenState(true);
      } finally {
        if (requestId === requestSequenceRef.current) {
          setInternalLoading(false);
          onSearchEnd?.(cleanQuery);
        }
      }
    },
    [
      onSearch,
      searchOnEmpty,
      minQueryLength,
      onSearchStart,
      onSearchError,
      onSearchEnd,
      updateOpenState,
      errorMessage,
    ],
  );

  /**
   * -------------------------------------------------------------------------
   * Debounced search
   * -------------------------------------------------------------------------
   */

  useEffect(() => {
    if (!onSearch) {
      return undefined;
    }

    if (
      !searchOnEmpty &&
      normalizedQuery.length < minQueryLength
    ) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      setInternalResults([]);
      setInternalError(null);
      setInternalLoading(false);
      setHighlightedIndex(-1);

      return undefined;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(normalizedQuery);
    }, Math.max(0, debounceMs));

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    normalizedQuery,
    debounceMs,
    minQueryLength,
    onSearch,
    searchOnEmpty,
    executeSearch,
  ]);

  /**
   * -------------------------------------------------------------------------
   * Cleanup
   * -------------------------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      requestSequenceRef.current += 1;
    };
  }, []);

  /**
   * -------------------------------------------------------------------------
   * Click outside
   * -------------------------------------------------------------------------
   */

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!wrapperRef.current) {
        return;
      }

      if (!wrapperRef.current.contains(event.target)) {
        updateOpenState(false);
        setHighlightedIndex(-1);
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
  }, [updateOpenState]);

  /**
   * -------------------------------------------------------------------------
   * Keyboard navigation
   * -------------------------------------------------------------------------
   */

  const handleKeyDown = useCallback(
    (event) => {
      if (disabled || readOnly) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();

          if (!shouldShowDropdown) {
            updateOpenState(true);
            return;
          }

          if (visibleResults.length === 0) {
            return;
          }

          setHighlightedIndex((currentIndex) => {
            const nextIndex =
              currentIndex >= visibleResults.length - 1
                ? 0
                : currentIndex + 1;

            return nextIndex;
          });

          break;
        }

        case 'ArrowUp': {
          event.preventDefault();

          if (visibleResults.length === 0) {
            return;
          }

          setHighlightedIndex((currentIndex) => {
            if (currentIndex <= 0) {
              return visibleResults.length - 1;
            }

            return currentIndex - 1;
          });

          break;
        }

        case 'Enter': {
          if (
            highlightedIndex >= 0 &&
            highlightedIndex < visibleResults.length
          ) {
            event.preventDefault();

            handleResultSelect(
              visibleResults[highlightedIndex],
              highlightedIndex,
            );
          }

          break;
        }

        case 'Escape': {
          event.preventDefault();

          updateOpenState(false);
          setHighlightedIndex(-1);

          break;
        }

        default:
          break;
      }
    },
    [
      disabled,
      readOnly,
      shouldShowDropdown,
      visibleResults,
      highlightedIndex,
      updateOpenState,
    ],
  );

  /**
   * -------------------------------------------------------------------------
   * Result selection
   * -------------------------------------------------------------------------
   */

  const handleResultSelect = useCallback(
    (result, index) => {
      onSelect?.(result, index);

      const resultLabel = getResultLabel(result);

      if (resultLabel) {
        updateValue(resultLabel);
      }

      if (closeOnSelect) {
        updateOpenState(false);
      }

      setHighlightedIndex(-1);
    },
    [
      onSelect,
      updateValue,
      closeOnSelect,
      updateOpenState,
    ],
  );

  /**
   * -------------------------------------------------------------------------
   * Clear
   * -------------------------------------------------------------------------
   */

  const handleClear = useCallback(() => {
    requestSequenceRef.current += 1;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    updateValue('');
    setInternalResults([]);
    setInternalError(null);
    setInternalLoading(false);
    setHighlightedIndex(-1);

    onClear?.();

    if (searchOnEmpty && onSearch) {
      executeSearch('');
    }

    inputRef.current?.focus();
  }, [
    updateValue,
    onClear,
    searchOnEmpty,
    onSearch,
    executeSearch,
  ]);

  /**
   * -------------------------------------------------------------------------
   * Input change
   * -------------------------------------------------------------------------
   */

  const handleInputChange = useCallback(
    (event) => {
      const nextValue = event.target.value;

      updateValue(nextValue);

      setHighlightedIndex(-1);

      if (!isOpen) {
        updateOpenState(true);
      }
    },
    [
      updateValue,
      isOpen,
      updateOpenState,
    ],
  );

  /**
   * -------------------------------------------------------------------------
   * Input focus
   * -------------------------------------------------------------------------
   */

  const handleFocus = useCallback(
    (event) => {
      updateOpenState(true);

      inputProps.onFocus?.(event);
    },
    [
      updateOpenState,
      inputProps,
    ],
  );

  /**
   * -------------------------------------------------------------------------
   * Scroll highlighted result into view
   * -------------------------------------------------------------------------
   */

  useEffect(() => {
    if (highlightedIndex < 0) {
      return;
    }

    const resultElement =
      resultRefs.current[highlightedIndex];

    resultElement?.scrollIntoView?.({
      block: 'nearest',
    });
  }, [highlightedIndex]);

  /**
   * -------------------------------------------------------------------------
   * Auto focus
   * -------------------------------------------------------------------------
   */

  useEffect(() => {
    if (autoFocus && !disabled && !readOnly) {
      inputRef.current?.focus();
    }
  }, [
    autoFocus,
    disabled,
    readOnly,
  ]);

  /**
   * -------------------------------------------------------------------------
   * Active descendant
   * -------------------------------------------------------------------------
   */

  const activeDescendant =
    highlightedIndex >= 0 &&
    highlightedIndex < visibleResults.length
      ? `${listboxId}-option-${highlightedIndex}`
      : undefined;

  /**
   * -------------------------------------------------------------------------
   * Dropdown content
   * -------------------------------------------------------------------------
   */

  const dropdownContent = useMemo(() => {
    if (loading) {
      return (
        <div
          className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-300"
          role="status"
          aria-live="polite"
        >
          {loadingIndicator || (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700 dark:border-gray-600 dark:border-t-gray-200"
            />
          )}

          <span>Searching...</span>
        </div>
      );
    }

    if (error) {
      return renderError ? (
        renderError(error)
      ) : (
        <div
          className="px-4 py-3 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error.message || errorMessage}
        </div>
      );
    }

    if (!hasMinimumQuery && !searchOnEmpty) {
      return (
        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          {minQueryMessage}
        </div>
      );
    }

    if (visibleResults.length === 0) {
      return renderEmpty ? (
        renderEmpty(normalizedQuery)
      ) : (
        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          {emptyMessage}
        </div>
      );
    }

    return visibleResults.map((result, index) => {
      const resultKey = getResultKey(result, index);
      const isHighlighted =
        highlightedIndex === index;

      return (
        <div
          key={resultKey}
          id={`${listboxId}-option-${index}`}
          ref={(element) => {
            resultRefs.current[index] = element;
          }}
          role="option"
          aria-selected={isHighlighted}
          tabIndex={-1}
          className={[
            'cursor-pointer select-none px-4 py-3',
            'transition-colors duration-100',
            isHighlighted
              ? 'bg-gray-100 dark:bg-gray-800'
              : 'bg-white dark:bg-gray-900',
            resultClassName,
          ].join(' ')}
          onMouseDown={(event) => {
            /**
             * Prevent input blur before selection.
             */
            event.preventDefault();
          }}
          onMouseEnter={() => {
            setHighlightedIndex(index);
          }}
          onClick={() => {
            handleResultSelect(result, index);
          }}
        >
          {renderResult
            ? renderResult(result, {
                index,
                highlighted: isHighlighted,
                query: normalizedQuery,
              })
            : (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {getResultLabel(result)}
                </span>

                {result?.description && (
                  <span className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                    {result.description}
                  </span>
                )}
              </div>
            )}
        </div>
      );
    });
  }, [
    loading,
    error,
    hasMinimumQuery,
    searchOnEmpty,
    visibleResults,
    highlightedIndex,
    listboxId,
    loadingIndicator,
    renderError,
    renderEmpty,
    renderResult,
    minQueryMessage,
    emptyMessage,
    errorMessage,
    normalizedQuery,
    resultClassName,
    handleResultSelect,
  ]);

  /**
   * -------------------------------------------------------------------------
   * Render
   * -------------------------------------------------------------------------
   */

  return (
    <div
      ref={wrapperRef}
      className={[
        'relative w-full',
        currentSize.wrapper,
        className,
      ].join(' ')}
    >
      <div
        className={[
          'relative flex w-full items-center',
          disabled
            ? 'opacity-60'
            : '',
          focusClassName,
        ].join(' ')}
      >
        {/* Search icon */}
        <span
          className={[
            'pointer-events-none absolute top-1/2 z-10 -translate-y-1/2',
            currentSize.icon,
            'text-gray-400 dark:text-gray-500',
          ].join(' ')}
          aria-hidden="true"
        >
          {searchIcon || (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
            >
              <circle
                cx="11"
                cy="11"
                r="7"
              />
              <path
                d="m20 20-3.5-3.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </span>

        <input
          {...inputProps}
          ref={inputRef}
          id={inputId}
          name={name}
          type="search"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          autoComplete={
            inputProps.autoComplete || 'off'
          }
          spellCheck={
            inputProps.spellCheck ?? false
          }
          aria-label={ariaLabel}
          aria-controls={
            shouldShowDropdown
              ? listboxId
              : undefined
          }
          aria-expanded={
            shouldShowDropdown
          }
          aria-autocomplete="list"
          aria-activedescendant={
            activeDescendant
          }
          aria-describedby={statusId}
          role="combobox"
          className={[
            'block w-full rounded-lg border',
            'border-gray-300 bg-white',
            'text-gray-900 placeholder:text-gray-400',
            'outline-none',
            'transition-all duration-150',
            'focus:border-gray-500',
            'focus:ring-2 focus:ring-gray-200',
            'dark:border-gray-700',
            'dark:bg-gray-900',
            'dark:text-gray-100',
            'dark:placeholder:text-gray-500',
            'dark:focus:border-gray-500',
            'dark:focus:ring-gray-800',
            'disabled:cursor-not-allowed',
            currentSize.input,
            inputClassName,
          ].join(' ')}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={inputProps.onBlur}
        />

        {/* Loading indicator */}
        {loading && (
          <span
            className={[
              'pointer-events-none absolute right-10 top-1/2',
              '-translate-y-1/2',
            ].join(' ')}
            aria-hidden="true"
          >
            <span className="block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700 dark:border-gray-600 dark:border-t-gray-200" />
          </span>
        )}

        {/* Clear button */}
        {clearable &&
          normalizedQuery.length > 0 &&
          !disabled &&
          !readOnly && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              className={[
                'absolute top-1/2 -translate-y-1/2',
                currentSize.clear,
                'rounded-md p-1',
                'text-gray-400',
                'transition-colors',
                'hover:bg-gray-100 hover:text-gray-700',
                'focus:outline-none focus:ring-2 focus:ring-gray-300',
                'dark:text-gray-500',
                'dark:hover:bg-gray-800 dark:hover:text-gray-200',
                'dark:focus:ring-gray-700',
              ].join(' ')}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={handleClear}
            >
              {clearIcon || (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path
                    d="M6 6l12 12M18 6 6 18"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          )}
      </div>

      {/* Screen-reader status */}
      <div
        id={statusId}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {loading
          ? 'Searching'
          : error
            ? 'Search failed'
            : `${visibleResults.length} search result${
                visibleResults.length === 1
                  ? ''
                  : 's'
              }`}
      </div>

      {/* Results dropdown */}
      {shouldShowDropdown && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} results`}
          className={[
            'absolute left-0 right-0 z-50 mt-2',
            'overflow-hidden rounded-lg border',
            'border-gray-200 bg-white',
            'shadow-lg shadow-gray-200/50',
            'dark:border-gray-700',
            'dark:bg-gray-900',
            'dark:shadow-black/30',
            dropdownClassName,
          ].join(' ')}
        >
          <div className="max-h-80 overflow-y-auto py-1">
            {dropdownContent}
          </div>
        </div>
      )}
    </div>
  );
});

SearchBox.displayName = 'SearchBox';

export default SearchBox;