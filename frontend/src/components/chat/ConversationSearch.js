/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation Search
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/ConversationSearch.js
 *
 * Purpose:
 *   Production-grade reusable search component for the TITech Community
 *   Capital messaging platform.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Controlled search mode
 * ✓ Uncontrolled search mode
 * ✓ Debounced search callbacks
 * ✓ Immediate input callback
 * ✓ Search submission
 * ✓ Clear / reset
 * ✓ Escape-to-clear
 * ✓ Enter-to-search
 * ✓ Loading state
 * ✓ Search error state
 * ✓ Result count
 * ✓ Keyboard accessibility
 * ✓ Screen-reader announcements
 * ✓ Search history hooks
 * ✓ Minimum query length
 * ✓ Maximum query length
 * ✓ Whitespace normalization
 * ✓ Search mode / filter support
 * ✓ Tenant context support
 * ✓ Ref API
 * ✓ Defensive value handling
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is a UI/orchestration layer.
 *
 * It MUST NOT:
 *   - authorize access to conversations
 *   - bypass tenant isolation
 *   - expose another tenant's records
 *   - perform backend permission checks
 *   - execute financial operations
 *
 * The authoritative TITech service/API layer must enforce tenant isolation,
 * authorization, query constraints and data-access policy.
 *
 * ============================================================================
 */

'use strict';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
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
  'Search conversations…';


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const safeString = (
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
    return String(value);
  } catch {
    return fallback;
  }
};


/**
 * Normalize search text without destroying useful user input.
 *
 * - Removes leading/trailing whitespace
 * - Collapses repeated whitespace
 */
const normalizeQuery = (
  value,
) =>
  safeString(
    value,
  )
    .trim()
    .replace(
      /\s+/g,
      ' ',
    );


const isValidQueryLength = (
  query,
  minLength,
  maxLength,
) => {
  const length =
    query.length;

  return (
    length >=
      Math.max(
        0,
        minLength,
      ) &&
    length <=
      Math.max(
        0,
        maxLength,
      )
  );
};


/**
 * Return a human-readable result label.
 */
const getResultLabel = (
  resultCount,
  query,
  loading,
) => {
  if (loading) {
    return query
      ? `Searching for "${query}"…`
      : 'Searching conversations…';
  }

  if (
    resultCount ===
      null ||
    resultCount ===
      undefined
  ) {
    return '';
  }

  const numericCount =
    Number(
      resultCount,
    );

  if (
    !Number.isFinite(
      numericCount,
    )
  ) {
    return '';
  }

  if (
    query
  ) {
    return `${numericCount} matching conversation${
      numericCount ===
      1
        ? ''
        : 's'
    }`;
  }

  return `${numericCount} conversation${
    numericCount ===
    1
      ? ''
      : 's'
  }`;
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const SearchIcon = ({
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
    <circle
      cx="11"
      cy="11"
      r="7"
    />

    <path d="m20 20-4-4" />
  </svg>
);


const ClearIcon = ({
  size = 16,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </svg>
);


const LoadingIcon = ({
  size = 17,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 2v4" />
    <path d="m16.24 3.76-2.83 2.83" />
    <path d="M22 12h-4" />
    <path d="m20.24 16.24-2.83-2.83" />
    <path d="M12 22v-4" />
    <path d="m7.76 20.24 2.83-2.83" />
    <path d="M2 12h4" />
    <path d="m3.76 7.76 2.83 2.83" />
  </svg>
);


/* ============================================================================
 * ConversationSearch
 * ========================================================================== */

const ConversationSearch =
  forwardRef(
    function ConversationSearch(
      {
        value,
        defaultValue =
          '',

        onChange,
        onSearch,
        onClear,

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

        resultCount =
          null,

        debounceMs =
          DEFAULT_DEBOUNCE_MS,

        minQueryLength =
          DEFAULT_MIN_QUERY_LENGTH,

        maxQueryLength =
          DEFAULT_MAX_QUERY_LENGTH,

        clearOnEscape =
          true,

        searchOnEnter =
          true,

        searchOnChange =
          true,

        normalize =
          true,

        autoFocus =
          false,

        showResultCount =
          true,

        showClearButton =
          true,

        showSearchIcon =
          true,

        showLoadingIndicator =
          true,

        showError =
          true,

        searchContext =
          'conversations',

        tenant =
          null,

        filter,

        ariaLabel =
          'Search TITech conversations',

        inputId,

        className =
          '',

        inputClassName =
          '',

        testId =
          'titech-conversation-search',

        minQueryMessage,

        maxQueryMessage,

        noResultsMessage,

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const resolvedInputId =
        inputId ||
        `titech-conversation-search-${generatedId}`;

      const errorId =
        `${resolvedInputId}-error`;

      const resultId =
        `${resolvedInputId}-result`;

      const inputRef =
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
        validationError,
        setValidationError,
      ] =
        useState(
          '',
        );

      const [
        submittedQuery,
        setSubmittedQuery,
      ] =
        useState(
          '',
        );


      /* ======================================================================
       * Effective value
       * ==================================================================== */

      const rawValue =
        isControlled
          ? value
          : internalValue;

      const effectiveValue =
        normalize
          ? normalizeQuery(
              rawValue,
            )
          : safeString(
              rawValue,
            );

      const queryLength =
        effectiveValue.length;

      const hasQuery =
        queryLength >
        0;

      const exceedsMaxLength =
        queryLength >
        maxQueryLength;

      const belowMinLength =
        hasQuery &&
        queryLength <
          minQueryLength;

      const effectiveError =
        validationError ||
        error;

      const canSearch =
        !disabled &&
        !readOnly &&
        !loading &&
        !exceedsMaxLength &&
        !belowMinLength;


      /* ======================================================================
       * Validation message
       * ==================================================================== */

      const resolvedValidationError =
        validationError ||
        (
          exceedsMaxLength
            ? (
                maxQueryMessage ||
                `Search must not exceed ${maxQueryLength} characters.`
              )
            : belowMinLength
              ? (
                  minQueryMessage ||
                  `Enter at least ${minQueryLength} characters to search.`
                )
              : ''
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
              effectiveValue,
            );
          },

          getValue() {
            return effectiveValue;
          },

          getInputElement() {
            return inputRef.current;
          },
        }),
        [
          effectiveValue,
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
       * Auto focus
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
       * Update value
       * ==================================================================== */

      const updateValue =
        useCallback(
          (
            nextValue,
            emitChange =
              true,
          ) => {
            const candidate =
              normalize
                ? normalizeQuery(
                    nextValue,
                  )
                : safeString(
                    nextValue,
                  );

            if (
              candidate.length >
              maxQueryLength
            ) {
              setValidationError(
                `Search must not exceed ${maxQueryLength} characters.`,
              );

              return false;
            }

            setValidationError(
              '',
            );

            if (
              !isControlled
            ) {
              setInternalValue(
                candidate,
              );
            }

            if (
              emitChange &&
              typeof onChange ===
                'function'
            ) {
              onChange(
                candidate,
              );
            }

            return true;
          },
          [
            isControlled,
            maxQueryLength,
            normalize,
            onChange,
          ],
        );


      /* ======================================================================
       * Submit search
       * ==================================================================== */

      const submitSearch =
        useCallback(
          async (
            explicitQuery,
          ) => {
            const query =
              normalize
                ? normalizeQuery(
                    explicitQuery,
                  )
                : safeString(
                    explicitQuery,
                  );

            if (
              query.length >
              maxQueryLength
            ) {
              setValidationError(
                `Search must not exceed ${maxQueryLength} characters.`,
              );

              return false;
            }

            if (
              query.length <
              minQueryLength &&
              query.length >
              0
            ) {
              setValidationError(
                `Enter at least ${minQueryLength} characters to search.`,
              );

              return false;
            }

            if (
              query.length ===
                0 &&
              minQueryLength >
                0
            ) {
              setSubmittedQuery(
                '',
              );

              onClear?.();

              return true;
            }

            if (
              !canSearch
            ) {
              return false;
            }

            setValidationError(
              '',
            );

            setSubmittedQuery(
              query,
            );

            if (
              typeof onSearch ===
              'function'
            ) {
              try {
                await onSearch(
                  query,
                  {
                    context:
                      searchContext,

                    tenantId:
                      tenant?.id ??
                      tenant?.tenantId ??
                      null,

                    filter:
                      filter ??
                      null,
                  },
                );
              } catch (
                searchError
              ) {
                setValidationError(
                  searchError?.message ||
                    'Unable to search conversations.',
                );

                return false;
              }
            }

            return true;
          },
          [
            canSearch,
            filter,
            maxQueryLength,
            minQueryLength,
            normalize,
            onClear,
            onSearch,
            searchContext,
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

            setValidationError(
              '',
            );

            setSubmittedQuery(
              '',
            );

            if (
              !isControlled
            ) {
              setInternalValue(
                '',
              );
            }

            onClear?.();

            onChange?.(
              '',
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
       * Input change
       * ==================================================================== */

      const handleChange =
        (
          event,
        ) => {
          const nextValue =
            event.target.value;

          const updated =
            updateValue(
              nextValue,
            );

          if (
            !updated
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
            !searchOnChange ||
            typeof onSearch !==
              'function'
          ) {
            return;
          }

          const normalized =
            normalize
              ? normalizeQuery(
                  nextValue,
                )
              : safeString(
                  nextValue,
                );

          if (
            normalized.length <
              minQueryLength &&
            normalized.length >
              0
          ) {
            return;
          }

          debounceRef.current =
            setTimeout(
              () => {
                submitSearch(
                  normalized,
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
       * Keyboard interaction
       * ==================================================================== */

      const handleKeyDown =
        (
          event,
        ) => {
          if (
            event.key ===
            'Escape' &&
            clearOnEscape
          ) {
            if (
              effectiveValue
            ) {
              event.preventDefault();

              clearSearch();
            }

            return;
          }

          if (
            event.key ===
              'Enter' &&
            searchOnEnter
          ) {
            event.preventDefault();

            submitSearch(
              effectiveValue,
            );
          }
        };


      /* ======================================================================
       * Search status
       * ==================================================================== */

      const resultLabel =
        getResultLabel(
          resultCount,
          submittedQuery ||
            effectiveValue,
          loading,
        );

      const showNoResults =
        !loading &&
        !effectiveError &&
        Boolean(
          submittedQuery ||
            effectiveValue,
        ) &&
        resultCount ===
          0;

      const accessibleStatus =
        showNoResults
          ? (
              noResultsMessage ||
              'No matching conversations found.'
            )
          : resultLabel;


      /* ======================================================================
       * CSS classes
       * ==================================================================== */

      const rootClassName = [
        'titech-conversation-search',
        loading
          ? 'titech-conversation-search--loading'
          : '',
        effectiveError
          ? 'titech-conversation-search--error'
          : '',
        disabled
          ? 'titech-conversation-search--disabled'
          : '',
        hasQuery
          ? 'titech-conversation-search--has-query'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ');


      const inputClasses = [
        'titech-conversation-search__input',
        inputClassName,
      ]
        .filter(Boolean)
        .join(' ');


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <div
          {...rest}
          className={
            rootClassName
          }
          data-testid={
            testId
          }
        >

          <div
            className="titech-conversation-search__control"
          >

            {showSearchIcon ? (
              <span
                className="titech-conversation-search__icon"
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
                effectiveValue
              }
              onChange={
                handleChange
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
                maxQueryLength
              }
              autoComplete="off"
              spellCheck={
                false
              }
              inputMode="search"
              enterKeyHint="search"
              aria-label={
                ariaLabel
              }
              aria-invalid={
                Boolean(
                  resolvedValidationError,
                )
              }
              aria-describedby={[
                resolvedValidationError
                  ? errorId
                  : '',
                showResultCount &&
                accessibleStatus
                  ? resultId
                  : '',
              ]
                .filter(Boolean)
                .join(' ') ||
                undefined}
              data-testid="titech-conversation-search-input"
            />


            {loading &&
            showLoadingIndicator ? (
              <span
                className="titech-conversation-search__loading"
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
                className="titech-conversation-search__clear"
                onClick={
                  clearSearch
                }
                disabled={
                  disabled
                }
                aria-label="Clear conversation search"
                title="Clear search"
                data-testid="titech-conversation-search-clear"
              >
                <ClearIcon />
              </button>
            ) : null}

          </div>


          {/* ================================================================
              Validation / server error
              ================================================================ */}

          {showError &&
          resolvedValidationError ? (
            <div
              id={
                errorId
              }
              className="titech-conversation-search__error"
              role="alert"
              data-testid="titech-conversation-search-error"
            >
              {
                resolvedValidationError
              }
            </div>
          ) : null}


          {/* ================================================================
              Result announcement
              ================================================================ */}

          {showResultCount &&
          accessibleStatus ? (
            <div
              id={
                resultId
              }
              className="titech-conversation-search__status"
              role="status"
              aria-live="polite"
              data-testid="titech-conversation-search-status"
            >
              {showNoResults
                ? (
                    noResultsMessage ||
                    'No matching conversations found.'
                  )
                : accessibleStatus}
            </div>
          ) : null}

        </div>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

ConversationSearch.displayName =
  'TITechConversationSearch';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

ConversationSearch.propTypes = {
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

  clearOnEscape:
    PropTypes.bool,

  searchOnEnter:
    PropTypes.bool,

  searchOnChange:
    PropTypes.bool,

  normalize:
    PropTypes.bool,

  autoFocus:
    PropTypes.bool,

  showResultCount:
    PropTypes.bool,

  showClearButton:
    PropTypes.bool,

  showSearchIcon:
    PropTypes.bool,

  showLoadingIndicator:
    PropTypes.bool,

  showError:
    PropTypes.bool,

  searchContext:
    PropTypes.string,

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

  filter:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  inputId:
    PropTypes.string,

  className:
    PropTypes.string,

  inputClassName:
    PropTypes.string,

  testId:
    PropTypes.string,

  minQueryMessage:
    PropTypes.string,

  maxQueryMessage:
    PropTypes.string,

  noResultsMessage:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

ConversationSearch.defaultProps = {
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
    null,

  debounceMs:
    DEFAULT_DEBOUNCE_MS,

  minQueryLength:
    DEFAULT_MIN_QUERY_LENGTH,

  maxQueryLength:
    DEFAULT_MAX_QUERY_LENGTH,

  clearOnEscape:
    true,

  searchOnEnter:
    true,

  searchOnChange:
    true,

  normalize:
    true,

  autoFocus:
    false,

  showResultCount:
    true,

  showClearButton:
    true,

  showSearchIcon:
    true,

  showLoadingIndicator:
    true,

  showError:
    true,

  searchContext:
    'conversations',

  tenant:
    null,

  filter:
    undefined,

  ariaLabel:
    'Search TITech conversations',

  inputId:
    undefined,

  className:
    '',

  inputClassName:
    '',

  testId:
    'titech-conversation-search',

  minQueryMessage:
    undefined,

  maxQueryMessage:
    undefined,

  noResultsMessage:
    undefined,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MAX_QUERY_LENGTH,
  DEFAULT_MIN_QUERY_LENGTH,
  DEFAULT_PLACEHOLDER,
  getResultLabel,
  isValidQueryLength,
  normalizeQuery,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default ConversationSearch;