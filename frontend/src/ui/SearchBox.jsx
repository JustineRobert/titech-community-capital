// ============================================================================
// TITech Community Capital
// Enterprise SearchBox Component
// File: src/components/ui/SearchBox.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Search,
  X,
  Loader2,
} from "lucide-react";

// ============================================================================
// Component
// ============================================================================

function SearchBox({
  value = "",
  placeholder = "Search...",
  debounceMs = 400,
  loading = false,
  disabled = false,
  autoFocus = false,
  fullWidth = true,
  size = "md",
  variant = "default",
  showClear = true,
  className = "",
  inputClassName = "",
  onChange,
  onSearch,
  onClear,
  onFocus,
  onBlur,
  onKeyDown,
}) {
  const [
    internalValue,
    setInternalValue,
  ] = useState(value);

  const debounceRef =
    useRef();

  const inputRef =
    useRef(null);

  // ===========================================================================
  // Sync external value
  // ===========================================================================

  useEffect(() => {
    setInternalValue(
      value ?? ""
    );
  }, [value]);

  // ===========================================================================
  // Autofocus
  // ===========================================================================

  useEffect(() => {
    if (
      autoFocus &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // ===========================================================================
  // Debounced Search
  // ===========================================================================

  useEffect(() => {
    if (!onSearch) {
      return undefined;
    }

    clearTimeout(
      debounceRef.current
    );

    debounceRef.current =
      setTimeout(() => {
        onSearch(
          internalValue
        );
      }, debounceMs);

    return () =>
      clearTimeout(
        debounceRef.current
      );
  }, [
    internalValue,
    debounceMs,
    onSearch,
  ]);

  // ===========================================================================
  // Handlers
  // ===========================================================================

  const handleChange =
    useCallback(
      (event) => {
        const next =
          event.target.value;

        setInternalValue(
          next
        );

        onChange?.(
          next,
          event
        );
      },
      [onChange]
    );

  const handleClear =
    useCallback(() => {
      setInternalValue("");

      onChange?.("");

      onSearch?.("");

      onClear?.();

      inputRef.current?.focus();
    }, [
      onChange,
      onSearch,
      onClear,
    ]);

  const classes = [
    "tt-search-box",
    `tt-search-${size}`,
    `tt-search-${variant}`,
    disabled
      ? "tt-search-disabled"
      : "",
    fullWidth
      ? "tt-search-full"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div
      className={
        classes
      }
    >
      <div className="tt-search-input-wrapper">
        <Search
          size={18}
          className="tt-search-icon"
        />

        <input
          ref={inputRef}
          type="search"
          value={
            internalValue
          }
          disabled={
            disabled
          }
          placeholder={
            placeholder
          }
          className={`tt-search-input ${inputClassName}`}
          onChange={
            handleChange
          }
          onFocus={
            onFocus
          }
          onBlur={
            onBlur
          }
          onKeyDown={
            onKeyDown
          }
          autoComplete="off"
          spellCheck="false"
        />

        <div className="tt-search-actions">
          {loading && (
            <Loader2
              size={18}
              className="tt-search-spinner"
            />
          )}

          {!loading &&
            showClear &&
            internalValue && (
              <button
                type="button"
                className="tt-search-clear"
                onClick={
                  handleClear
                }
                aria-label="Clear search"
              >
                <X
                  size={16}
                />
              </button>
            )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

SearchBox.propTypes = {
  value:
    PropTypes.string,

  placeholder:
    PropTypes.string,

  debounceMs:
    PropTypes.number,

  loading:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  autoFocus:
    PropTypes.bool,

  fullWidth:
    PropTypes.bool,

  size:
    PropTypes.oneOf([
      "sm",
      "md",
      "lg",
    ]),

  variant:
    PropTypes.oneOf([
      "default",
      "filled",
      "outlined",
    ]),

  showClear:
    PropTypes.bool,

  className:
    PropTypes.string,

  inputClassName:
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
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  SearchBox
);