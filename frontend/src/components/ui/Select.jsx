/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Select Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/Select.jsx
 *
 * Purpose:
 *   Enterprise-grade, reusable Select component for TITech Community Capital.
 *
 * Designed for:
 *   - Members
 *   - SACCOs
 *   - VSLA groups
 *   - Community groups
 *   - Accounts
 *   - Transactions
 *   - Loans
 *   - Savings products
 *   - Shares
 *   - Users
 *   - Roles
 *   - Branches
 *   - Departments
 *   - Financial products
 *   - Administrative configuration
 *
 * Features:
 *   ✓ Controlled / uncontrolled usage
 *   ✓ Native form integration
 *   ✓ Keyboard navigation
 *   ✓ ArrowUp / ArrowDown
 *   ✓ Home / End
 *   ✓ Enter / Space selection
 *   ✓ Escape to close
 *   ✓ Type-ahead search
 *   ✓ Optional searchable dropdown
 *   ✓ Clearable selection
 *   ✓ Disabled component
 *   ✓ Disabled individual options
 *   ✓ Loading state
 *   ✓ Error state
 *   ✓ Required state
 *   ✓ Helper text
 *   ✓ Validation messages
 *   ✓ Grouped options
 *   ✓ Object options
 *   ✓ Primitive options
 *   ✓ Custom option rendering
 *   ✓ Custom selected-value rendering
 *   ✓ Custom icons
 *   ✓ Empty state
 *   ✓ Async-friendly
 *   ✓ Maximum visible options
 *   ✓ Accessibility / ARIA combobox pattern
 *   ✓ Click-outside handling
 *   ✓ Imperative focus / open / close / clear API
 *   ✓ Dark mode support
 *   ✓ Multiple visual sizes
 *   ✓ Enterprise-friendly defaults
 *
 * Important:
 *   This component contains no ACFOS references.
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

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_MAX_VISIBLE_OPTIONS = 200;
const DEFAULT_TYPE_AHEAD_TIMEOUT = 700;

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Normalize options into a consistent internal representation.
 *
 * Supported option shapes:
 *
 *   "Member"
 *
 *   {
 *     value: "M001",
 *     label: "John Doe"
 *   }
 *
 *   {
 *     id: "M001",
 *     name: "John Doe"
 *   }
 *
 *   {
 *     value: "M001",
 *     label: "John Doe",
 *     disabled: true
 *   }
 */
const normalizeOption = (option, index) => {
  if (
    option === null ||
    option === undefined
  ) {
    return {
      value: '',
      label: '',
      disabled: true,
      raw: option,
      key: `empty-option-${index}`,
    };
  }

  if (
    typeof option === 'string' ||
    typeof option === 'number' ||
    typeof option === 'boolean'
  ) {
    return {
      value: option,
      label: String(option),
      disabled: false,
      raw: option,
      key: `option-${String(option)}-${index}`,
    };
  }

  const value =
    option.value ??
    option.id ??
    option.key ??
    option.code ??
    option.uuid ??
    '';

  const label =
    option.label ??
    option.name ??
    option.title ??
    option.fullName ??
    option.description ??
    String(value);

  return {
    ...option,
    value,
    label: String(label),
    disabled: Boolean(option.disabled),
    raw: option,
    key:
      option.id ??
      option.value ??
      option.key ??
      option.code ??
      `option-${index}`,
  };
};

/**
 * Normalize grouped options.
 *
 * Supported:
 *
 * {
 *   label: "Savings Products",
 *   options: [...]
 * }
 */
const normalizeOptions = (options = []) => {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((item, groupIndex) => {
    if (
      item &&
      typeof item === 'object' &&
      Array.isArray(item.options)
    ) {
      return item.options.map(
        (option, optionIndex) => ({
          ...normalizeOption(
            option,
            optionIndex,
          ),
          groupLabel:
            item.label ??
            item.name ??
            `Group ${groupIndex + 1}`,
          groupKey:
            item.id ??
            item.value ??
            item.label ??
            `group-${groupIndex}`,
        }),
      );
    }

    return [
      normalizeOption(
        item,
        groupIndex,
      ),
    ];
  });
};

/**
 * Safely compare values.
 *
 * Supports primitives and objects.
 */
const areValuesEqual = (
  first,
  second,
) => {
  if (first === second) {
    return true;
  }

  if (
    first === null ||
    first === undefined ||
    second === null ||
    second === undefined
  ) {
    return false;
  }

  if (
    typeof first === 'object' &&
    typeof second === 'object'
  ) {
    try {
      return (
        JSON.stringify(first) ===
        JSON.stringify(second)
      );
    } catch {
      return false;
    }
  }

  return String(first) === String(second);
};

/**
 * Find an option by value.
 */
const findOptionByValue = (
  options,
  value,
) => {
  return options.find((option) =>
    areValuesEqual(
      option.value,
      value,
    ),
  );
};

/**
 * ============================================================================
 * Select Component
 * ============================================================================
 */

const Select = forwardRef(function Select(
  {
    /**
     * ------------------------------------------------------------------------
     * Value
     * ------------------------------------------------------------------------
     */

    value,
    defaultValue = '',
    onChange,

    /**
     * ------------------------------------------------------------------------
     * Options
     * ------------------------------------------------------------------------
     */

    options = [],

    /**
     * ------------------------------------------------------------------------
     * Display
     * ------------------------------------------------------------------------
     */

    placeholder = 'Select an option...',
    label,
    description,
    helperText,
    error,
    success,

    /**
     * ------------------------------------------------------------------------
     * Form
     * ------------------------------------------------------------------------
     */

    name,
    id,
    required = false,
    disabled = false,
    readOnly = false,

    /**
     * ------------------------------------------------------------------------
     * Search
     * ------------------------------------------------------------------------
     */

    searchable = false,
    searchPlaceholder = 'Search options...',
    noOptionsMessage = 'No options available.',
    noResultsMessage = 'No matching options found.',
    clearable = false,

    /**
     * ------------------------------------------------------------------------
     * Loading
     * ------------------------------------------------------------------------
     */

    loading = false,
    loadingMessage = 'Loading options...',

    /**
     * ------------------------------------------------------------------------
     * Rendering
     * ------------------------------------------------------------------------
     */

    renderOption,
    renderValue,
    renderEmpty,

    /**
     * ------------------------------------------------------------------------
     * Behavior
     * ------------------------------------------------------------------------
     */

    closeOnSelect = true,
    openOnFocus = false,
    maxVisibleOptions =
      DEFAULT_MAX_VISIBLE_OPTIONS,

    /**
     * ------------------------------------------------------------------------
     * Styling
     * ------------------------------------------------------------------------
     */

    size = 'md',
    className = '',
    triggerClassName = '',
    dropdownClassName = '',
    optionClassName = '',

    /**
     * ------------------------------------------------------------------------
     * Icons
     * ------------------------------------------------------------------------
     */

    leadingIcon,
    chevronIcon,
    clearIcon,

    /**
     * ------------------------------------------------------------------------
     * Callbacks
     * ------------------------------------------------------------------------
     */

    onOpen,
    onClose,
    onFocus,
    onBlur,
    onClear,
    onSearchChange,

    /**
     * ------------------------------------------------------------------------
     * Type-ahead
     * ------------------------------------------------------------------------
     */

    typeAhead = true,
    typeAheadTimeout =
      DEFAULT_TYPE_AHEAD_TIMEOUT,

    /**
     * ------------------------------------------------------------------------
     * Native input props
     * ------------------------------------------------------------------------
     */

    autoFocus = false,
    autoComplete = 'off',
    tabIndex = 0,

    ...rest
  },
  ref,
) {
  /**
   * ==========================================================================
   * Controlled / Uncontrolled
   * ==========================================================================
   */

  const isControlled =
    value !== undefined;

  const [internalValue, setInternalValue] =
    useState(defaultValue);

  const selectedValue = isControlled
    ? value
    : internalValue;

  /**
   * ==========================================================================
   * Internal State
   * ==========================================================================
   */

  const [isOpen, setIsOpen] =
    useState(false);

  const [searchQuery, setSearchQuery] =
    useState('');

  const [highlightedIndex, setHighlightedIndex] =
    useState(-1);

  const [typeAheadBuffer, setTypeAheadBuffer] =
    useState('');

  /**
   * ==========================================================================
   * Refs
   * ==========================================================================
   */

  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const searchInputRef = useRef(null);
  const optionRefs = useRef([]);

  const typeAheadTimerRef =
    useRef(null);

  /**
   * ==========================================================================
   * IDs
   * ==========================================================================
   */

  const generatedId = useId();

  const selectId =
    id ||
    `titech-select-${generatedId}`;

  const listboxId =
    `${selectId}-listbox`;

  const searchId =
    `${selectId}-search`;

  const descriptionId =
    `${selectId}-description`;

  const errorId =
    `${selectId}-error`;

  /**
   * ==========================================================================
   * Normalized Options
   * ==========================================================================
   */

  const normalizedOptions = useMemo(
    () =>
      normalizeOptions(options),
    [options],
  );

  /**
   * ==========================================================================
   * Search Filtering
   * ==========================================================================
   */

  const filteredOptions = useMemo(() => {
    if (!searchable) {
      return normalizedOptions;
    }

    const normalizedSearch =
      searchQuery
        .trim()
        .toLowerCase();

    if (!normalizedSearch) {
      return normalizedOptions;
    }

    return normalizedOptions.filter(
      (option) => {
        const label =
          String(
            option.label ?? '',
          ).toLowerCase();

        const value =
          String(
            option.value ?? '',
          ).toLowerCase();

        return (
          label.includes(
            normalizedSearch,
          ) ||
          value.includes(
            normalizedSearch,
          )
        );
      },
    );
  }, [
    normalizedOptions,
    searchable,
    searchQuery,
  ]);

  /**
   * ==========================================================================
   * Visible Options
   * ==========================================================================
   */

  const visibleOptions =
    filteredOptions.slice(
      0,
      maxVisibleOptions,
    );

  /**
   * ==========================================================================
   * Selected Option
   * ==========================================================================
   */

  const selectedOption =
    findOptionByValue(
      normalizedOptions,
      selectedValue,
    );

  /**
   * ==========================================================================
   * Selected Label
   * ==========================================================================
   */

  const selectedLabel =
    selectedOption?.label ?? '';

  /**
   * ==========================================================================
   * Size Classes
   * ==========================================================================
   */

  const sizeStyles = {
    sm: {
      trigger:
        'min-h-9 px-3 py-1.5 text-sm',
      icon:
        'h-4 w-4',
    },

    md: {
      trigger:
        'min-h-11 px-3.5 py-2.5 text-sm',
      icon:
        'h-5 w-5',
    },

    lg: {
      trigger:
        'min-h-12 px-4 py-3 text-base',
      icon:
        'h-5 w-5',
    },
  };

  const currentSize =
    sizeStyles[size] ||
    sizeStyles.md;

  /**
   * ==========================================================================
   * Error Normalization
   * ==========================================================================
   */

  const errorMessage =
    typeof error === 'string'
      ? error
      : error?.message;

  const hasError =
    Boolean(errorMessage);

  /**
   * ==========================================================================
   * Dropdown Open / Close
   * ==========================================================================
   */

  const openDropdown = useCallback(() => {
    if (
      disabled ||
      readOnly
    ) {
      return;
    }

    setIsOpen(true);
    onOpen?.();

    if (searchable) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [
    disabled,
    readOnly,
    onOpen,
    searchable,
  ]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);

    onClose?.();

    triggerRef.current?.focus();
  }, [onClose]);

  /**
   * ==========================================================================
   * Selection
   * ==========================================================================
   */

  const updateValue = useCallback(
    (nextValue, option = null) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }

      onChange?.(
        nextValue,
        option,
      );
    },
    [
      isControlled,
      onChange,
    ],
  );

  const selectOption = useCallback(
    (option) => {
      if (
        !option ||
        option.disabled
      ) {
        return;
      }

      updateValue(
        option.value,
        option,
      );

      setSearchQuery('');
      setHighlightedIndex(-1);

      if (closeOnSelect) {
        closeDropdown();
      }
    },
    [
      updateValue,
      closeOnSelect,
      closeDropdown,
    ],
  );

  /**
   * ==========================================================================
   * Clear Selection
   * ==========================================================================
   */

  const clearSelection = useCallback(
    (event) => {
      event?.stopPropagation();

      updateValue(
        '',
        null,
      );

      setSearchQuery('');
      setHighlightedIndex(-1);

      onClear?.();

      if (!isOpen) {
        triggerRef.current?.focus();
      }
    },
    [
      updateValue,
      onClear,
      isOpen,
    ],
  );

  /**
   * ==========================================================================
   * Imperative API
   * ==========================================================================
   */

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        triggerRef.current?.focus();
      },

      blur: () => {
        triggerRef.current?.blur();
      },

      open: () => {
        openDropdown();
      },

      close: () => {
        closeDropdown();
      },

      clear: () => {
        updateValue(
          '',
          null,
        );
      },

      getValue: () =>
        selectedValue,

      getSelectedOption: () =>
        selectedOption,
    }),
    [
      openDropdown,
      closeDropdown,
      updateValue,
      selectedValue,
      selectedOption,
    ],
  );

  /**
   * ==========================================================================
   * Click Outside
   * ==========================================================================
   */

  useEffect(() => {
    const handlePointerDown =
      (event) => {
        if (
          wrapperRef.current &&
          !wrapperRef.current.contains(
            event.target,
          )
        ) {
          if (isOpen) {
            closeDropdown();
          }
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
  }, [
    isOpen,
    closeDropdown,
  ]);

  /**
   * ==========================================================================
   * Auto Focus
   * ==========================================================================
   */

  useEffect(() => {
    if (
      autoFocus &&
      !disabled &&
      !readOnly
    ) {
      triggerRef.current?.focus();
    }
  }, [
    autoFocus,
    disabled,
    readOnly,
  ]);

  /**
   * ==========================================================================
   * Highlight Management
   * ==========================================================================
   */

  const selectableIndexes =
    useMemo(
      () =>
        visibleOptions
          .map(
            (option, index) =>
              option.disabled
                ? -1
                : index,
          )
          .filter(
            (index) => index !== -1,
          ),
      [visibleOptions],
    );

  const moveHighlight = useCallback(
    (direction) => {
      if (
        selectableIndexes.length === 0
      ) {
        return;
      }

      const currentPosition =
        selectableIndexes.indexOf(
          highlightedIndex,
        );

      let nextPosition;

      if (
        currentPosition === -1
      ) {
        nextPosition =
          direction === 'down'
            ? 0
            : selectableIndexes.length - 1;
      } else if (
        direction === 'down'
      ) {
        nextPosition =
          currentPosition + 1 >=
          selectableIndexes.length
            ? 0
            : currentPosition + 1;
      } else {
        nextPosition =
          currentPosition - 1 < 0
            ? selectableIndexes.length - 1
            : currentPosition - 1;
      }

      setHighlightedIndex(
        selectableIndexes[
          nextPosition
        ],
      );
    },
    [
      selectableIndexes,
      highlightedIndex,
    ],
  );

  /**
   * ==========================================================================
   * Keyboard Navigation
   * ==========================================================================
   */

  const handleKeyDown = useCallback(
    (event) => {
      if (
        disabled ||
        readOnly
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();

          if (!isOpen) {
            openDropdown();
          } else {
            moveHighlight('down');
          }

          break;

        case 'ArrowUp':
          event.preventDefault();

          if (!isOpen) {
            openDropdown();
          } else {
            moveHighlight('up');
          }

          break;

        case 'Home':
          if (isOpen) {
            event.preventDefault();

            if (
              selectableIndexes.length > 0
            ) {
              setHighlightedIndex(
                selectableIndexes[0],
              );
            }
          }

          break;

        case 'End':
          if (isOpen) {
            event.preventDefault();

            if (
              selectableIndexes.length > 0
            ) {
              setHighlightedIndex(
                selectableIndexes[
                  selectableIndexes.length - 1
                ],
              );
            }
          }

          break;

        case 'Enter':
        case ' ':
          if (!isOpen) {
            event.preventDefault();
            openDropdown();
          } else if (
            highlightedIndex >= 0 &&
            visibleOptions[
              highlightedIndex
            ]
          ) {
            event.preventDefault();

            selectOption(
              visibleOptions[
                highlightedIndex
              ],
            );
          }

          break;

        case 'Escape':
          if (isOpen) {
            event.preventDefault();
            closeDropdown();
          }

          break;

        case 'Tab':
          if (isOpen) {
            closeDropdown();
          }

          break;

        default:
          break;
      }
    },
    [
      disabled,
      readOnly,
      isOpen,
      openDropdown,
      closeDropdown,
      moveHighlight,
      selectableIndexes,
      highlightedIndex,
      visibleOptions,
      selectOption,
    ],
  );

  /**
   * ==========================================================================
   * Type Ahead
   * ==========================================================================
   */

  const handleTypeAhead =
    useCallback(
      (event) => {
        if (
          !typeAhead ||
          searchable ||
          isOpen ||
          disabled ||
          readOnly
        ) {
          return;
        }

        const character =
          event.key;

        if (
          character.length !== 1 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }

        const nextBuffer =
          `${typeAheadBuffer}${character}`
            .toLowerCase();

        setTypeAheadBuffer(
          nextBuffer,
        );

        const match =
          normalizedOptions.find(
            (option) =>
              !option.disabled &&
              String(
                option.label,
              )
                .toLowerCase()
                .startsWith(
                  nextBuffer,
                ),
          );

        if (match) {
          updateValue(
            match.value,
            match,
          );
        }

        if (
          typeAheadTimerRef.current
        ) {
          clearTimeout(
            typeAheadTimerRef.current,
          );
        }

        typeAheadTimerRef.current =
          setTimeout(() => {
            setTypeAheadBuffer('');
          }, typeAheadTimeout);
      },
      [
        typeAhead,
        searchable,
        isOpen,
        disabled,
        readOnly,
        typeAheadBuffer,
        normalizedOptions,
        updateValue,
        typeAheadTimeout,
      ],
    );

  /**
   * ==========================================================================
   * Search
   * ==========================================================================
   */

  const handleSearchChange =
    useCallback(
      (event) => {
        const nextQuery =
          event.target.value;

        setSearchQuery(
          nextQuery,
        );

        setHighlightedIndex(
          -1,
        );

        onSearchChange?.(
          nextQuery,
        );
      },
      [onSearchChange],
    );

  /**
   * ==========================================================================
   * Option Scroll
   * ==========================================================================
   */

  useEffect(() => {
    if (
      highlightedIndex < 0
    ) {
      return;
    }

    const element =
      optionRefs.current[
        highlightedIndex
      ];

    element?.scrollIntoView?.({
      block: 'nearest',
    });
  }, [
    highlightedIndex,
  ]);

  /**
   * ==========================================================================
   * Focus / Blur
   * ==========================================================================
   */

  const handleFocus =
    useCallback(
      (event) => {
        onFocus?.(event);

        if (
          openOnFocus &&
          !disabled &&
          !readOnly
        ) {
          openDropdown();
        }
      },
      [
        onFocus,
        openOnFocus,
        disabled,
        readOnly,
        openDropdown,
      ],
    );

  const handleBlur =
    useCallback(
      (event) => {
        onBlur?.(event);
      },
      [onBlur],
    );

  /**
   * ==========================================================================
   * Selected Value Renderer
   * ==========================================================================
   */

  const selectedContent =
    selectedOption
      ? renderValue
        ? renderValue(
            selectedOption,
          )
        : (
          <span className="truncate">
            {selectedLabel}
          </span>
        )
      : (
        <span className="truncate text-gray-400 dark:text-gray-500">
          {placeholder}
        </span>
      );

  /**
   * ==========================================================================
   * Dropdown Content
   * ==========================================================================
   */

  const dropdownContent =
    loading ? (
      <div
        className="flex items-center gap-3 px-4 py-3 text-sm text-gray-600 dark:text-gray-300"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700 dark:border-gray-600 dark:border-t-gray-200"
        />

        <span>
          {loadingMessage}
        </span>
      </div>
    ) : normalizedOptions.length ===
      0 ? (
      renderEmpty ? (
        renderEmpty()
      ) : (
        <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          {noOptionsMessage}
        </div>
      )
    ) : visibleOptions.length ===
      0 ? (
      <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {noResultsMessage}
      </div>
    ) : (
      visibleOptions.map(
        (option, index) => {
          const isHighlighted =
            highlightedIndex ===
            index;

          const isSelected =
            areValuesEqual(
              option.value,
              selectedValue,
            );

          return (
            <div
              key={option.key}
              id={`${listboxId}-option-${index}`}
              ref={(element) => {
                optionRefs.current[
                  index
                ] = element;
              }}
              role="option"
              aria-selected={
                isSelected
              }
              aria-disabled={
                option.disabled
              }
              tabIndex={-1}
              className={[
                'relative flex w-full',
                'cursor-pointer select-none',
                'items-center justify-between',
                'gap-3 px-3.5 py-2.5',
                'text-sm',
                'transition-colors duration-100',
                option.disabled
                  ? 'cursor-not-allowed opacity-50'
                  : '',
                isHighlighted &&
                !option.disabled
                  ? 'bg-gray-100 dark:bg-gray-800'
                  : '',
                isSelected &&
                !isHighlighted
                  ? 'bg-gray-50 dark:bg-gray-800/60'
                  : '',
                optionClassName,
              ].join(' ')}
              onMouseDown={(
                event,
              ) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                if (
                  !option.disabled
                ) {
                  setHighlightedIndex(
                    index,
                  );
                }
              }}
              onClick={() => {
                if (
                  !option.disabled
                ) {
                  selectOption(
                    option,
                  );
                }
              }}
            >
              <div className="min-w-0 flex-1">
                {renderOption
                  ? renderOption(
                      option,
                      {
                        index,
                        selected:
                          isSelected,
                        highlighted:
                          isHighlighted,
                      },
                    )
                  : (
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {option.label}
                      </span>

                      {option.description && (
                        <span className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                          {
                            option.description
                          }
                        </span>
                      )}
                    </div>
                  )}
              </div>

              {isSelected && (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4 shrink-0 text-gray-700 dark:text-gray-200"
                  aria-hidden="true"
                >
                  <path
                    d="m5 12 4 4L19 6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          );
        },
      )
    );

  /**
   * ==========================================================================
   * Chevron
   * ==========================================================================
   */

  const defaultChevron = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={[
        currentSize.icon,
        'transition-transform duration-150',
        isOpen
          ? 'rotate-180'
          : '',
      ].join(' ')}
      aria-hidden="true"
    >
      <path
        d="m6 9 6 6 6-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  /**
   * ==========================================================================
   * Render
   * ==========================================================================
   */

  return (
    <div
      ref={wrapperRef}
      className={[
        'relative w-full',
        className,
      ].join(' ')}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Label                                                               */}
      {/* ------------------------------------------------------------------ */}

      {label && (
        <label
          htmlFor={selectId}
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          {label}

          {required && (
            <span
              className="ml-1 text-red-500"
              aria-hidden="true"
            >
              *
            </span>
          )}
        </label>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Description                                                         */}
      {/* ------------------------------------------------------------------ */}

      {description && (
        <p
          id={descriptionId}
          className="mb-2 text-xs text-gray-500 dark:text-gray-400"
        >
          {description}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Select Trigger                                                      */}
      {/* ------------------------------------------------------------------ */}

      <button
        {...rest}
        ref={triggerRef}
        id={selectId}
        name={name}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={
          isOpen
            ? listboxId
            : undefined
        }
        aria-required={required}
        aria-invalid={hasError}
        aria-describedby={[
          description
            ? descriptionId
            : '',
          hasError
            ? errorId
            : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined}
        disabled={disabled}
        tabIndex={tabIndex}
        className={[
          'flex w-full items-center',
          'justify-between gap-2',
          'rounded-lg border',
          'bg-white',
          'text-left',
          'outline-none',
          'transition-all duration-150',
          currentSize.trigger,

          hasError
            ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:border-red-600 dark:focus:ring-red-950'
            : success
              ? 'border-green-400 focus:border-green-500 focus:ring-2 focus:ring-green-100 dark:border-green-600 dark:focus:ring-green-950'
              : 'border-gray-300 focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-gray-700 dark:focus:border-gray-500 dark:focus:ring-gray-800',

          'text-gray-900',
          'dark:bg-gray-900',
          'dark:text-gray-100',

          'disabled:cursor-not-allowed',
          'disabled:opacity-60',

          triggerClassName,
        ].join(' ')}
        onClick={() => {
          if (isOpen) {
            closeDropdown();
          } else {
            openDropdown();
          }
        }}
        onKeyDown={(event) => {
          handleKeyDown(
            event,
          );

          handleTypeAhead(
            event,
          );
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {/* Leading icon */}
        {leadingIcon && (
          <span
            className="shrink-0 text-gray-400 dark:text-gray-500"
            aria-hidden="true"
          >
            {leadingIcon}
          </span>
        )}

        {/* Value */}
        <span className="min-w-0 flex-1">
          {selectedContent}
        </span>

        {/* Clear */}
        {clearable &&
          selectedOption &&
          !disabled &&
          !readOnly && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              title="Clear selection"
              className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              onMouseDown={(
                event,
              ) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(
                event,
              ) => {
                clearSelection(
                  event,
                );
              }}
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
            </span>
          )}

        {/* Chevron */}
        <span
          className="shrink-0 text-gray-400 dark:text-gray-500"
          aria-hidden="true"
        >
          {chevronIcon ||
            defaultChevron}
        </span>
      </button>

      {/* ------------------------------------------------------------------ */}
      {/* Hidden Native Form Value                                            */}
      {/* ------------------------------------------------------------------ */}

      {name && (
        <input
          type="hidden"
          name={name}
          value={
            selectedValue ??
            ''
          }
          readOnly
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Dropdown                                                            */}
      {/* ------------------------------------------------------------------ */}

      {isOpen && (
        <div
          id={listboxId}
          className={[
            'absolute left-0 right-0 z-50 mt-2',
            'overflow-hidden rounded-lg border',
            'border-gray-200 bg-white',
            'shadow-xl shadow-gray-200/50',
            'dark:border-gray-700',
            'dark:bg-gray-900',
            'dark:shadow-black/30',
            dropdownClassName,
          ].join(' ')}
        >
          {/* Search */}
          {searchable && (
            <div className="border-b border-gray-200 p-2 dark:border-gray-700">
              <div className="relative">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
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

                <input
                  ref={
                    searchInputRef
                  }
                  id={searchId}
                  type="search"
                  value={searchQuery}
                  placeholder={
                    searchPlaceholder
                  }
                  autoComplete="off"
                  className="h-9 w-full rounded-md border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-600 dark:focus:ring-gray-800"
                  onChange={
                    handleSearchChange
                  }
                  onKeyDown={(
                    event,
                  ) => {
                    if (
                      event.key ===
                      'ArrowDown'
                    ) {
                      event.preventDefault();
                      moveHighlight(
                        'down',
                      );
                    }

                    if (
                      event.key ===
                      'ArrowUp'
                    ) {
                      event.preventDefault();
                      moveHighlight(
                        'up',
                      );
                    }

                    if (
                      event.key ===
                      'Enter'
                    ) {
                      event.preventDefault();

                      if (
                        highlightedIndex >=
                          0 &&
                        visibleOptions[
                          highlightedIndex
                        ]
                      ) {
                        selectOption(
                          visibleOptions[
                            highlightedIndex
                          ],
                        );
                      }
                    }

                    if (
                      event.key ===
                      'Escape'
                    ) {
                      event.preventDefault();
                      closeDropdown();
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div
            role="listbox"
            aria-label={
              label ||
              placeholder
            }
            aria-multiselectable="false"
            className="max-h-72 overflow-y-auto py-1"
          >
            {dropdownContent}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Validation / Helper                                                 */}
      {/* ------------------------------------------------------------------ */}

      {(hasError ||
        helperText ||
        success) && (
        <div className="mt-1.5">
          {hasError ? (
            <p
              id={errorId}
              className="text-xs text-red-600 dark:text-red-400"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : success ? (
            <p className="text-xs text-green-600 dark:text-green-400">
              {typeof success ===
              'string'
                ? success
                : 'Selection is valid.'}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {helperText}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

Select.displayName = 'Select';

export default Select;