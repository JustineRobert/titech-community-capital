'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Search Bar
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/SearchBar.jsx
 *
 * Purpose:
 *   Reusable enterprise-grade search input for TITech Chat and communication
 *   surfaces.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Controlled / uncontrolled modes
 * ✓ Debounced search
 * ✓ Explicit search submission
 * ✓ Search-as-you-type
 * ✓ Clear button
 * ✓ Escape-to-clear
 * ✓ Enter-to-search
 * ✓ Minimum query length
 * ✓ Maximum query length
 * ✓ Query normalization
 * ✓ Search result count
 * ✓ Loading state
 * ✓ Error state
 * ✓ Search suggestions
 * ✓ Recent search support
 * ✓ Keyboard suggestion navigation
 * ✓ ARIA combobox semantics
 * ✓ Screen-reader status
 * ✓ Mobile-friendly input
 * ✓ Ref API
 * ✓ Defensive event handling
 * ✓ Tenant context metadata hooks
 * ✓ Stable test selectors
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - authorize access to data
 *   - bypass tenant isolation
 *   - execute financial operations
 *   - determine loan eligibility
 *   - make fraud decisions
 *   - directly mutate authoritative backend records
 *
 * TITech's trusted API/service layer remains authoritative.
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


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_DEBOUNCE_MS = 250;

const DEFAULT_MIN_QUERY_LENGTH = 0;

const DEFAULT_MAX_QUERY_LENGTH = 200;

const DEFAULT_PLACEHOLDER =
  'Search TITech…';


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


const normalizeQuery = (
  value,
) =>
  safeText(
    value,
  ).replace(
    /\s+/g,
    ' ',
  );


const clampMaxLength = (
  value,
  maxLength,
) =>
  normalizeQuery(
    value,
  ).slice(
    0,
    Math.max(
      1,
      Number(
        maxLength,
      ) || DEFAULT_MAX_QUERY_LENGTH,
    ),
  );


const isValidQuery = (
  query,
  minLength,
  maxLength,
) => {
  const length =
    query.length;

  return (
    length <=
      maxLength &&
    (
      length === 0 ||
      length >= minLength
    )
  );
};


/* ============================================================================
 * Icons
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


const ClearIcon = (
  props,
) => (
  <Icon
    {...props}
    size={
      props.size ||
      16
    }
  >
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </Icon>
);


const LoadingIcon = (
  props,
) => (
  <Icon
    {...props}
    size={
      props.size ||
      17
    }
  >
    <path d="M12 2v4" />
    <path d="m16.24 3.76-2.83 2.83" />
    <path d="M22 12h-4" />
    <path d="m20.24 16.24-2.83-2.83" />
    <path d="M12 22v-4" />
    <path d="m7.76 20.24 2.83-2.83" />
    <path d="M2 12h4" />
    <path d="m3.76 7.76 2.83 2.83" />
  </Icon>
);


const ChevronUpIcon = (
  props,
) => (
  <Icon
    {...props}
    size={
      props.size ||
      15
    }
  >
    <path d="m18 15-6-6-6 6" />
  </Icon>
);


const ChevronDownIcon = (
  props,
) => (
  <Icon
    {...props}
    size={
      props.size ||
      15
    }
  >
    <path d="m6 9 6 6 6-6" />
  </Icon>
);


/* ============================================================================
 * SearchBar
 * ========================================================================== */

const SearchBar =
  forwardRef(
    function SearchBar(
      {
        value,

        defaultValue =
          '',

        onChange,

        onSearch,

        onClear,

        onFocus,

        onBlur,

        onKeyDown,

        onSuggestionSelect,

        suggestions =
          [],

        recentSearches =
          [],

        placeholder =
          DEFAULT_PLACEHOLDER,

        disabled =
          false,

        readOnly =
          false,

        loading =
          false,

        error =
          null,

        resultCount,

        debounceMs =
          DEFAULT_DEBOUNCE_MS,

        minQueryLength =
          DEFAULT_MIN_QUERY_LENGTH,

        maxQueryLength =
          DEFAULT_MAX_QUERY_LENGTH,

        searchOnChange =
          true,

        searchOnEnter =
          true,

        clearOnEscape =
          true,

        normalize =
          true,

        autoFocus =
          false,

        showSearchIcon =
          true,

        showClearButton =
          true,

        showLoadingIndicator =
          true,

        showResultCount =
          false,

        showSuggestions =
          true,

        showRecentSearches =
          false,

        closeSuggestionsOnSelect =
          true,

        minCharactersForSuggestions =
          0,

        suggestionFilter,

        tenant =
          null,

        context =
          'chat',

        ariaLabel =
          'Search TITech',

        inputId,

        className =
          '',

        inputClassName =
          '',

        dropdownClassName =
          '',

        testId =
          'titech-search-bar',

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const resolvedInputId =
        inputId ||
        `titech-search-bar-${generatedId}`;

      const listboxId =
        `${resolvedInputId}-listbox`;

      const statusId =
        `${resolvedInputId}-status`;

      const errorId =
        `${resolvedInputId}-error`;

      const inputRef =
        useRef(null);

      const rootRef =
        useRef(null);

      const debounceRef =
        useRef(null);

      const isControlled =
        value !==
        undefined;

      const [
        internalValue,
        setInternalValue,
      ] =
        useState(
          defaultValue,
        );

      const [
        isFocused,
        setIsFocused,
      ] =
        useState(
          false,
        );

      const [
        activeSuggestionIndex,
        setActiveSuggestionIndex,
      ] =
        useState(
          -1,
        );


      /* ======================================================================
       * Derived values
       * ==================================================================== */

      const rawValue =
        isControlled
          ? value
          : internalValue;

      const query =
        normalize
          ? normalizeQuery(
              rawValue,
            )
          : safeText(
              rawValue,
            );

      const minLength =
        Math.max(
          0,
          Number(
            minQueryLength,
          ) ||
            0,
        );

      const maxLength =
        Math.max(
          minLength || 1,
          Number(
            maxQueryLength,
          ) ||
            DEFAULT_MAX_QUERY_LENGTH,
        );

      const queryLength =
        query.length;

      const hasQuery =
        queryLength >
        0;

      const minLengthViolation =
        hasQuery &&
        queryLength <
          minLength;

      const maxLengthViolation =
        queryLength >
        maxLength;

      const effectiveError =
        error ||
        (
          maxLengthViolation
            ? `Search must not exceed ${maxLength} characters.`
            : minLengthViolation
              ? `Enter at least ${minLength} characters to search.`
              : ''
        );

      const searchAllowed =
        !disabled &&
        !readOnly &&
        !loading &&
        !minLengthViolation &&
        !maxLengthViolation;


      /* ======================================================================
       * Suggestion normalization
       * ==================================================================== */

      const normalizedSuggestions =
        useMemo(
          () => {
            if (
              !showSuggestions
            ) {
              return [];
            }

            const source =
              queryLength >=
              minCharactersForSuggestions
                ? suggestions
                : [];

            if (
              !Array.isArray(
                source,
              )
            ) {
              return [];
            }

            const normalized =
              source
                .map(
                  (
                    suggestion,
                    index,
                  ) => {
                    if (
                      typeof suggestion ===
                      'string'
                    ) {
                      const text =
                        safeText(
                          suggestion,
                        );

                      return text
                        ? {
                            id:
                              `suggestion-${index}-${text}`,
                            label:
                              text,
                            value:
                              text,
                            original:
                              suggestion,
                          }
                        : null;
                    }

                    if (
                      suggestion &&
                      typeof suggestion ===
                        'object'
                    ) {
                      const label =
                        safeText(
                          suggestion.label ||
                            suggestion.name ||
                            suggestion.title ||
                            suggestion.value,
                        );

                      if (
                        !label
                      ) {
                        return null;
                      }

                      return {
                        id:
                          suggestion.id ||
                          `suggestion-${index}-${label}`,

                        label,

                        value:
                          safeText(
                            suggestion.value,
                            label,
                          ),

                        description:
                          safeText(
                            suggestion.description,
                          ),

                        icon:
                          suggestion.icon,

                        type:
                          suggestion.type,

                        original:
                          suggestion,
                      };
                    }

                    return null;
                  },
                )
                .filter(Boolean);

            if (
              typeof suggestionFilter ===
              'function'
            ) {
              return normalized.filter(
                (
                  suggestion,
                ) =>
                  suggestionFilter(
                    suggestion,
                    query,
                  ),
              );
            }

            if (
              !query
            ) {
              return normalized;
            }

            const normalizedQuery =
              query.toLowerCase();

            return normalized.filter(
              (
                suggestion,
              ) =>
                suggestion.label
                  .toLowerCase()
                  .includes(
                    normalizedQuery,
                  ) ||
                suggestion.value
                  .toLowerCase()
                  .includes(
                    normalizedQuery,
                  ),
            );
          },
          [
            minCharactersForSuggestions,
            query,
            queryLength,
            showSuggestions,
            suggestionFilter,
            suggestions,
          ],
        );


      const normalizedRecentSearches =
        useMemo(
          () =>
            Array.isArray(
              recentSearches,
            )
              ? recentSearches
                  .map(
                    (
                      item,
                      index,
                    ) => {
                      if (
                        typeof item ===
                        'string'
                      ) {
                        const text =
                          safeText(
                            item,
                          );

                        return text
                          ? {
                              id:
                                `recent-${index}-${text}`,
                              label:
                                text,
                              value:
                                text,
                            }
                          : null;
                      }

                      if (
                        item &&
                        typeof item ===
                          'object'
                      ) {
                        const label =
                          safeText(
                            item.label ||
                              item.value ||
                              item.query ||
                              item.name,
                          );

                        return label
                          ? {
                              id:
                                item.id ||
                                `recent-${index}-${label}`,
                              label,
                              value:
                                safeText(
                                  item.value ||
                                    item.query,
                                  label,
                                ),
                            }
                          : null;
                      }

                      return null;
                    },
                  )
                  .filter(Boolean)
              : [],
          [
            recentSearches,
          ],
        );


      const visibleSuggestions =
        useMemo(
          () => {
            if (
              !isFocused ||
              !showSuggestions ||
              disabled ||
              readOnly
            ) {
              return [];
            }

            if (
              normalizedSuggestions.length >
              0
            ) {
              return normalizedSuggestions;
            }

            if (
              showRecentSearches &&
              !query &&
              normalizedRecentSearches.length >
                0
            ) {
              return normalizedRecentSearches;
            }

            return [];
          },
          [
            disabled,
            isFocused,
            normalizedRecentSearches,
            normalizedSuggestions,
            query,
            readOnly,
            showRecentSearches,
            showSuggestions,
          ],
        );


      const hasSuggestions =
        visibleSuggestions.length >
        0;


      /* ======================================================================
       * Reset suggestion focus
       * ==================================================================== */

      useEffect(
        () => {
          setActiveSuggestionIndex(
            -1,
          );
        },
        [
          query,
        ],
      );


      /* ======================================================================
       * Cleanup
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
       * Autofocus
       * ==================================================================== */

      useEffect(
        () => {
          if (
            autoFocus &&
            !disabled &&
            !readOnly
          ) {
            inputRef.current?.focus();
          }
        },
        [
          autoFocus,
          disabled,
          readOnly,
        ],
      );


      /* ======================================================================
       * Public ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            inputRef.current?.focus();
          },

          blur() {
            inputRef.current?.blur();
          },

          clear() {
            clearSearch();
          },

          submit() {
            return submitSearch(
              query,
            );
          },

          getValue() {
            return query;
          },

          getInputElement() {
            return inputRef.current;
          },

          getSuggestions() {
            return visibleSuggestions;
          },
        }),
        [
          query,
          visibleSuggestions,
        ],
      );


      /* ======================================================================
       * Update value
       * ==================================================================== */

      const updateValue =
        useCallback(
          (
            nextValue,
          ) => {
            const normalized =
              normalize
                ? normalizeQuery(
                    nextValue,
                  )
                : safeText(
                    nextValue,
                  );

            const clamped =
              clampMaxLength(
                normalized,
                maxLength,
              );

            if (
              !isControlled
            ) {
              setInternalValue(
                clamped,
              );
            }

            onChange?.(
              clamped,
            );

            return clamped;
          },
          [
            isControlled,
            maxLength,
            normalize,
            onChange,
          ],
        );


      /* ======================================================================
       * Search submission
       * ==================================================================== */

      const submitSearch =
        useCallback(
          async (
            explicitQuery,
          ) => {
            const normalized =
              normalize
                ? normalizeQuery(
                    explicitQuery,
                  )
                : safeText(
                    explicitQuery,
                  );

            if (
              normalized.length >
              maxLength
            ) {
              return false;
            }

            if (
              normalized.length >
                0 &&
              normalized.length <
                minLength
            ) {
              return false;
            }

            if (
              !searchAllowed
            ) {
              return false;
            }

            const result =
              onSearch?.(
                normalized,
                {
                  context,

                  tenantId:
                    tenant?.id ??
                    tenant?.tenantId ??
                    null,

                  query:
                    normalized,
                },
              );

            if (
              result &&
              typeof result.then ===
                'function'
            ) {
              await result;
            }

            return true;
          },
          [
            context,
            maxLength,
            minLength,
            normalize,
            onSearch,
            searchAllowed,
            tenant,
          ],
        );


      /* ======================================================================
       * Clear search
       * ==================================================================== */

      const clearSearch =
        useCallback(
          () => {
            if (
              disabled
            ) {
              return;
            }

            if (
              debounceRef.current
            ) {
              clearTimeout(
                debounceRef.current,
              );

              debounceRef.current =
                null;
            }

            if (
              !isControlled
            ) {
              setInternalValue(
                '',
              );
            }

            onChange?.(
              '',
            );

            onClear?.();

            setActiveSuggestionIndex(
              -1,
            );

            inputRef.current?.focus();
          },
          [
            disabled,
            isControlled,
            onChange,
            onClear,
          ],
        );


      /* ======================================================================
       * Select suggestion
       * ==================================================================== */

      const selectSuggestion =
        useCallback(
          async (
            suggestion,
          ) => {
            if (
              !suggestion ||
              disabled ||
              readOnly
            ) {
              return;
            }

            const value =
              safeText(
                suggestion.value,
                suggestion.label,
              );

            if (
              !isControlled
            ) {
              setInternalValue(
                value,
              );
            }

            onChange?.(
              value,
            );

            if (
              closeSuggestionsOnSelect
            ) {
              setActiveSuggestionIndex(
                -1,
              );

              inputRef.current?.focus();
            }

            if (
              typeof onSuggestionSelect ===
              'function'
            ) {
              const result =
                onSuggestionSelect(
                  suggestion.original ||
                    suggestion,
                );

              if (
                result &&
                typeof result.then ===
                  'function'
              ) {
                await result;
              }
            } else if (
              searchAllowed
            ) {
              await submitSearch(
                value,
              );
            }
          },
          [
            closeSuggestionsOnSelect,
            disabled,
            isControlled,
            onChange,
            onSuggestionSelect,
            readOnly,
            searchAllowed,
            submitSearch,
          ],
        );


      /* ======================================================================
       * Input change
       * ==================================================================== */

      const handleChange =
        (
          event,
        ) => {
          const nextValue =
            event.target.value;

          const nextQuery =
            updateValue(
              nextValue,
            );

          if (
            !searchOnChange ||
            typeof onSearch !==
              'function'
          ) {
            return;
          }

          if (
            debounceRef.current
          ) {
            clearTimeout(
              debounceRef.current,
            );
          }

          if (
            nextQuery.length >
            0 &&
            nextQuery.length <
              minLength
          ) {
            return;
          }

          debounceRef.current =
            setTimeout(
              () => {
                submitSearch(
                  nextQuery,
                );
              },
              Math.max(
                0,
                Number(
                  debounceMs,
                ) || 0,
              ),
            );
        };


      /* ======================================================================
       * Focus / blur
       * ==================================================================== */

      const handleFocus =
        (
          event,
        ) => {
          setIsFocused(
            true,
          );

          onFocus?.(
            event,
          );
        };


      const handleBlur =
        (
          event,
        ) => {
          /**
           * Delay closing the dropdown so a suggestion click can complete.
           */
          window.setTimeout(
            () => {
              if (
                !rootRef.current?.contains(
                  document.activeElement,
                )
              ) {
                setIsFocused(
                  false,
                );
              }
            },
            0,
          );

          onBlur?.(
            event,
          );
        };


      /* ======================================================================
       * Keyboard interaction
       * ==================================================================== */

      const handleKeyDown =
        (
          event,
        ) => {
          onKeyDown?.(
            event,
          );

          if (
            event.defaultPrevented
          ) {
            return;
          }

          if (
            hasSuggestions
          ) {
            if (
              event.key ===
              'ArrowDown'
            ) {
              event.preventDefault();

              setActiveSuggestionIndex(
                (
                  current,
                ) =>
                  current >=
                  visibleSuggestions.length -
                    1
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

              setActiveSuggestionIndex(
                (
                  current,
                ) =>
                  current <=
                  0
                    ? visibleSuggestions.length -
                      1
                    : current - 1,
              );

              return;
            }

            if (
              event.key ===
              'Home' &&
              event.altKey
            ) {
              event.preventDefault();

              setActiveSuggestionIndex(
                0,
              );

              return;
            }

            if (
              event.key ===
              'End' &&
              event.altKey
            ) {
              event.preventDefault();

              setActiveSuggestionIndex(
                visibleSuggestions.length -
                  1,
              );

              return;
            }

            if (
              event.key ===
              'Enter' &&
              activeSuggestionIndex >=
                0
            ) {
              event.preventDefault();

              selectSuggestion(
                visibleSuggestions[
                  activeSuggestionIndex
                ],
              );

              return;
            }
          }

          if (
            event.key ===
            'Escape'
          ) {
            if (
              hasSuggestions
            ) {
              event.preventDefault();

              setActiveSuggestionIndex(
                -1,
              );

              if (
                clearOnEscape &&
                query
              ) {
                clearSearch();
              }

              return;
            }

            if (
              clearOnEscape &&
              query
            ) {
              event.preventDefault();

              clearSearch();

              return;
            }
          }

          if (
            event.key ===
              'Enter' &&
            searchOnEnter
          ) {
            event.preventDefault();

            submitSearch(
              query,
            );
          }
        };


      /* ======================================================================
       * Result label
       * ==================================================================== */

      const resultLabel =
        useMemo(
          () => {
            if (
              loading
            ) {
              return query
                ? `Searching for "${query}"…`
                : 'Searching TITech…';
            }

            if (
              resultCount ===
                null ||
              resultCount ===
                undefined
            ) {
              return '';
            }

            const numeric =
              Number(
                resultCount,
              );

            if (
              !Number.isFinite(
                numeric,
              )
            ) {
              return '';
            }

            return `${numeric} result${
              numeric ===
              1
                ? ''
                : 's'
            }`;
          },
          [
            loading,
            query,
            resultCount,
          ],
        );


      const activeDescendant =
        activeSuggestionIndex >=
          0 &&
        visibleSuggestions[
          activeSuggestionIndex
        ]
          ? `${listboxId}-option-${activeSuggestionIndex}`
          : undefined;


      /* ======================================================================
       * CSS classes
       * ==================================================================== */

      const rootClassName =
        cn(
          'titech-search-bar',

          loading &&
            'titech-search-bar--loading',

          disabled &&
            'titech-search-bar--disabled',

          effectiveError &&
            'titech-search-bar--error',

          hasQuery &&
            'titech-search-bar--has-query',

          hasSuggestions &&
            'titech-search-bar--has-suggestions',

          className,
        );

      const inputClasses =
        cn(
          'titech-search-bar__input',
          inputClassName,
        );


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <div
          {...rest}
          ref={
            rootRef
          }
          className={
            rootClassName
          }
          data-testid={
            testId
          }
          data-context={
            context
          }
        >

          {/* ================================================================
              Search control
              ================================================================ */}

          <div className="titech-search-bar__control">

            {showSearchIcon ? (
              <span
                className="titech-search-bar__search-icon"
                aria-hidden="true"
              >
                <SearchIcon />
              </span>
            ) : null}


            <input
              ref={
                inputRef
              }
              id={
                resolvedInputId
              }
              type="search"
              className={
                inputClasses
              }
              value={
                query
              }
              onChange={
                handleChange
              }
              onFocus={
                handleFocus
              }
              onBlur={
                handleBlur
              }
              onKeyDown={
                handleKeyDown
              }
              placeholder={
                placeholder
              }
              disabled={
                disabled
              }
              readOnly={
                readOnly
              }
              maxLength={
                maxLength
              }
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={
                false
              }
              inputMode="search"
              enterKeyHint="search"
              role="combobox"
              aria-label={
                ariaLabel
              }
              aria-expanded={
                hasSuggestions
              }
              aria-controls={
                hasSuggestions
                  ? listboxId
                  : undefined
              }
              aria-autocomplete={
                showSuggestions
                  ? 'list'
                  : 'none'
              }
              aria-activedescendant={
                activeDescendant
              }
              aria-invalid={
                Boolean(
                  effectiveError,
                )
              }
              aria-describedby={[
                effectiveError
                  ? errorId
                  : '',
                resultLabel
                  ? statusId
                  : '',
              ]
                .filter(Boolean)
                .join(' ') ||
                undefined}
              data-testid="titech-search-bar-input"
            />


            {loading &&
            showLoadingIndicator ? (
              <span
                className="titech-search-bar__loading"
                role="status"
                aria-label="Searching"
              >
                <LoadingIcon />
              </span>
            ) : null}


            {!loading &&
            showClearButton &&
            hasQuery ? (
              <button
                type="button"
                className="titech-search-bar__clear"
                onClick={
                  clearSearch
                }
                disabled={
                  disabled
                }
                aria-label="Clear search"
                title="Clear search"
                data-testid="titech-search-bar-clear"
              >
                <ClearIcon />
              </button>
            ) : null}

          </div>


          {/* ================================================================
              Suggestions / recent searches
              ================================================================ */}

          {hasSuggestions ? (
            <div
              id={
                listboxId
              }
              className={cn(
                'titech-search-bar__dropdown',
                dropdownClassName,
              )}
              role="listbox"
              aria-label={
                query
                  ? 'Search suggestions'
                  : 'Recent searches'
              }
              data-testid="titech-search-bar-suggestions"
            >
              {visibleSuggestions.map(
                (
                  suggestion,
                  index,
                ) => {
                  const optionId =
                    `${listboxId}-option-${index}`;

                  const isActive =
                    index ===
                    activeSuggestionIndex;

                  return (
                    <button
                      key={
                        suggestion.id ||
                        optionId
                      }
                      id={
                        optionId
                      }
                      type="button"
                      className={cn(
                        'titech-search-bar__suggestion',
                        isActive &&
                          'titech-search-bar__suggestion--active',
                      )}
                      role="option"
                      aria-selected={
                        isActive
                      }
                      onMouseDown={(
                        event,
                      ) => {
                        /**
                         * Prevent the input blur from closing the dropdown
                         * before the suggestion handler runs.
                         */
                        event.preventDefault();
                      }}
                      onClick={() =>
                        selectSuggestion(
                          suggestion,
                        )
                      }
                      data-testid={`titech-search-bar-suggestion-${index}`}
                    >
                      {suggestion.icon ? (
                        <span
                          className="titech-search-bar__suggestion-icon"
                          aria-hidden="true"
                        >
                          {
                            suggestion.icon
                          }
                        </span>
                      ) : null}

                      <span className="titech-search-bar__suggestion-content">
                        <span className="titech-search-bar__suggestion-label">
                          {
                            suggestion.label
                          }
                        </span>

                        {suggestion.description ? (
                          <span className="titech-search-bar__suggestion-description">
                            {
                              suggestion.description
                            }
                          </span>
                        ) : null}
                      </span>

                      {suggestion.type ? (
                        <span className="titech-search-bar__suggestion-type">
                          {
                            suggestion.type
                          }
                        </span>
                      ) : null}
                    </button>
                  );
                },
              )}

              {activeSuggestionIndex >=
              0 ? (
                <span
                  className="titech-search-bar__keyboard-hint"
                  aria-hidden="true"
                >
                  <ChevronUpIcon />
                  <ChevronDownIcon />
                  <span>
                    Navigate
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}


          {/* ================================================================
              Error
              ================================================================ */}

          {effectiveError ? (
            <div
              id={
                errorId
              }
              className="titech-search-bar__error"
              role="alert"
              data-testid="titech-search-bar-error"
            >
              {
                safeText(
                  effectiveError,
                )
              }
            </div>
          ) : null}


          {/* ================================================================
              Result status
              ================================================================ */}

          {(
            showResultCount &&
            resultLabel
          ) ? (
            <div
              id={
                statusId
              }
              className="titech-search-bar__status"
              role="status"
              aria-live="polite"
              data-testid="titech-search-bar-status"
            >
              {
                resultLabel
              }
            </div>
          ) : null}

        </div>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

SearchBar.displayName =
  'TITechSearchBar';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

SearchBar.propTypes = {
  value:
    PropTypes.string,

  defaultValue:
    PropTypes.string,

  onChange:
    PropTypes.func,

  onSearch:
    PropTypes.func,

  onClear:
    PropTypes.func,

  onFocus:
    PropTypes.func,

  onBlur:
    PropTypes.func,

  onKeyDown:
    PropTypes.func,

  onSuggestionSelect:
    PropTypes.func,

  suggestions:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,

        PropTypes.shape({
          id:
            PropTypes.oneOfType([
              PropTypes.string,
              PropTypes.number,
            ]),

          label:
            PropTypes.string,

          value:
            PropTypes.string,

          name:
            PropTypes.string,

          title:
            PropTypes.string,

          description:
            PropTypes.string,

          icon:
            PropTypes.node,

          type:
            PropTypes.string,
        }),
      ]),
    ),

  recentSearches:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,

        PropTypes.shape({
          id:
            PropTypes.oneOfType([
              PropTypes.string,
              PropTypes.number,
            ]),

          label:
            PropTypes.string,

          value:
            PropTypes.string,

          query:
            PropTypes.string,

          name:
            PropTypes.string,
        }),
      ]),
    ),

  placeholder:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  readOnly:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  resultCount:
    PropTypes.number,

  debounceMs:
    PropTypes.number,

  minQueryLength:
    PropTypes.number,

  maxQueryLength:
    PropTypes.number,

  searchOnChange:
    PropTypes.bool,

  searchOnEnter:
    PropTypes.bool,

  clearOnEscape:
    PropTypes.bool,

  normalize:
    PropTypes.bool,

  autoFocus:
    PropTypes.bool,

  showSearchIcon:
    PropTypes.bool,

  showClearButton:
    PropTypes.bool,

  showLoadingIndicator:
    PropTypes.bool,

  showResultCount:
    PropTypes.bool,

  showSuggestions:
    PropTypes.bool,

  showRecentSearches:
    PropTypes.bool,

  closeSuggestionsOnSelect:
    PropTypes.bool,

  minCharactersForSuggestions:
    PropTypes.number,

  suggestionFilter:
    PropTypes.func,

  tenant:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      tenantId:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      name:
        PropTypes.string,
    }),

  context:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  inputId:
    PropTypes.string,

  className:
    PropTypes.string,

  inputClassName:
    PropTypes.string,

  dropdownClassName:
    PropTypes.string,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

SearchBar.defaultProps = {
  value:
    undefined,

  defaultValue:
    '',

  onChange:
    undefined,

  onSearch:
    undefined,

  onClear:
    undefined,

  onFocus:
    undefined,

  onBlur:
    undefined,

  onKeyDown:
    undefined,

  onSuggestionSelect:
    undefined,

  suggestions:
    [],

  recentSearches:
    [],

  placeholder:
    DEFAULT_PLACEHOLDER,

  disabled:
    false,

  readOnly:
    false,

  loading:
    false,

  error:
    null,

  resultCount:
    undefined,

  debounceMs:
    DEFAULT_DEBOUNCE_MS,

  minQueryLength:
    DEFAULT_MIN_QUERY_LENGTH,

  maxQueryLength:
    DEFAULT_MAX_QUERY_LENGTH,

  searchOnChange:
    true,

  searchOnEnter:
    true,

  clearOnEscape:
    true,

  normalize:
    true,

  autoFocus:
    false,

  showSearchIcon:
    true,

  showClearButton:
    true,

  showLoadingIndicator:
    true,

  showResultCount:
    false,

  showSuggestions:
    true,

  showRecentSearches:
    false,

  closeSuggestionsOnSelect:
    true,

  minCharactersForSuggestions:
    0,

  suggestionFilter:
    undefined,

  tenant:
    null,

  context:
    'chat',

  ariaLabel:
    'Search TITech',

  inputId:
    undefined,

  className:
    '',

  inputClassName:
    '',

  dropdownClassName:
    '',

  testId:
    'titech-search-bar',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_QUERY_LENGTH,
  DEFAULT_MIN_QUERY_LENGTH,
  DEFAULT_PLACEHOLDER,
  clampMaxLength,
  isValidQuery,
  normalizeQuery,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default SearchBar;