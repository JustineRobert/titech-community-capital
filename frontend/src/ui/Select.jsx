// ============================================================================
// TITech Community Capital
// Enterprise Select Component
// File: src/components/ui/Select.jsx
// Production Grade
// ============================================================================

import React, {
  forwardRef,
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";
import {
  ChevronDown,
  AlertCircle,
} from "lucide-react";

// ============================================================================
// Helpers
// ============================================================================

function normalizeOptions(
  options = []
) {
  return options.map(
    (option) => {
      if (
        typeof option ===
        "string"
      ) {
        return {
          label: option,
          value: option,
        };
      }

      return {
        label:
          option.label ??
          option.name ??
          option.value,
        value:
          option.value ??
          option.id,
        disabled:
          option.disabled ??
          false,
      };
    }
  );
}

// ============================================================================
// Component
// ============================================================================

const Select = forwardRef(
  (
    {
      label,
      name,
      value,
      options = [],
      placeholder = "Select an option",
      disabled = false,
      required = false,
      error,
      helperText,
      fullWidth = true,
      size = "md",
      variant = "default",
      className = "",
      containerClassName = "",
      onChange,
      onBlur,
      onFocus,
      ...props
    },
    ref
  ) => {
    const normalizedOptions =
      useMemo(
        () =>
          normalizeOptions(
            options
          ),
        [options]
      );

    const classes = [
      "tt-select",
      `tt-select-${size}`,
      `tt-select-${variant}`,
      error
        ? "tt-select-error"
        : "",
      disabled
        ? "tt-select-disabled"
        : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className={`tt-select-container ${containerClassName} ${
          fullWidth
            ? "tt-select-full"
            : ""
        }`}
      >
        {label && (
          <label
            htmlFor={name}
            className="tt-select-label"
          >
            {label}

            {required && (
              <span className="tt-select-required">
                *
              </span>
            )}
          </label>
        )}

        <div className="tt-select-wrapper">
          <select
            ref={ref}
            id={name}
            name={name}
            value={
              value ?? ""
            }
            disabled={
              disabled
            }
            required={
              required
            }
            className={
              classes
            }
            onChange={
              onChange
            }
            onBlur={
              onBlur
            }
            onFocus={
              onFocus
            }
            aria-invalid={
              !!error
            }
            aria-describedby={
              helperText ||
              error
                ? `${name}-helper`
                : undefined
            }
            {...props}
          >
            <option
              value=""
              disabled={
                required
              }
            >
              {
                placeholder
              }
            </option>

            {normalizedOptions.map(
              (
                option
              ) => (
                <option
                  key={`${option.value}`}
                  value={
                    option.value
                  }
                  disabled={
                    option.disabled
                  }
                >
                  {
                    option.label
                  }
                </option>
              )
            )}
          </select>

          <span className="tt-select-icon">
            <ChevronDown
              size={18}
            />
          </span>
        </div>

        {(error ||
          helperText) && (
          <div
            id={`${name}-helper`}
            className={`tt-select-helper ${
              error
                ? "tt-select-helper-error"
                : ""
            }`}
          >
            {error && (
              <AlertCircle
                size={14}
              />
            )}

            <span>
              {error ||
                helperText}
            </span>
          </div>
        )}
      </div>
    );
  }
);

Select.displayName =
  "Select";

// ============================================================================
// Prop Types
// ============================================================================

Select.propTypes = {
  label:
    PropTypes.node,

  name:
    PropTypes.string,

  value:
    PropTypes.oneOfType(
      [
        PropTypes.string,
        PropTypes.number,
      ]
    ),

  options:
    PropTypes.array,

  placeholder:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  required:
    PropTypes.bool,

  error:
    PropTypes.string,

  helperText:
    PropTypes.string,

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

  className:
    PropTypes.string,

  containerClassName:
    PropTypes.string,

  onChange:
    PropTypes.func,

  onBlur:
    PropTypes.func,

  onFocus:
    PropTypes.func,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  Select
);