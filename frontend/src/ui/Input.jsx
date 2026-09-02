// ============================================================================
// TITech Community Capital
// Enterprise Input Component
// File: src/components/ui/Input.jsx
// Production Grade
// ============================================================================

import React, {
  forwardRef,
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";

// ============================================================================
// Component
// ============================================================================

const Input = forwardRef(
  (
    {
      label,
      name,
      value,
      type = "text",
      placeholder,
      disabled = false,
      readOnly = false,
      required = false,
      error,
      helperText,
      leftIcon,
      rightIcon,
      fullWidth = true,
      size = "md",
      variant = "default",
      className = "",
      containerClassName = "",
      showPasswordToggle = true,
      onChange,
      onBlur,
      onFocus,
      ...props
    },
    ref
  ) => {
    const [
      showPassword,
      setShowPassword,
    ] = React.useState(false);

    const resolvedType =
      useMemo(() => {
        if (
          type ===
            "password" &&
          showPassword
        ) {
          return "text";
        }

        return type;
      }, [
        type,
        showPassword,
      ]);

    const classes = [
      "tt-input",
      `tt-input-${size}`,
      `tt-input-${variant}`,
      error
        ? "tt-input-error"
        : "",
      disabled
        ? "tt-input-disabled"
        : "",
      leftIcon
        ? "tt-input-has-left-icon"
        : "",
      (rightIcon ||
        (type ===
          "password" &&
          showPasswordToggle))
        ? "tt-input-has-right-icon"
        : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className={`tt-input-container ${containerClassName} ${
          fullWidth
            ? "tt-input-full"
            : ""
        }`}
      >
        {label && (
          <label
            htmlFor={name}
            className="tt-input-label"
          >
            {label}

            {required && (
              <span className="tt-input-required">
                *
              </span>
            )}
          </label>
        )}

        <div className="tt-input-wrapper">
          {leftIcon && (
            <span className="tt-input-icon tt-input-icon-left">
              {leftIcon}
            </span>
          )}

          {!leftIcon &&
            type ===
              "search" && (
              <span className="tt-input-icon tt-input-icon-left">
                <Search
                  size={18}
                />
              </span>
            )}

          <input
            ref={ref}
            id={name}
            name={name}
            type={
              resolvedType
            }
            value={value}
            placeholder={
              placeholder
            }
            disabled={
              disabled
            }
            readOnly={
              readOnly
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
          />

          {type ===
            "password" &&
            showPasswordToggle && (
              <button
                type="button"
                tabIndex={
                  -1
                }
                className="tt-input-toggle"
                onClick={() =>
                  setShowPassword(
                    (
                      previous
                    ) =>
                      !previous
                  )
                }
              >
                {showPassword ? (
                  <EyeOff
                    size={18}
                  />
                ) : (
                  <Eye
                    size={18}
                  />
                )}
              </button>
            )}

          {rightIcon &&
            type !==
              "password" && (
              <span className="tt-input-icon tt-input-icon-right">
                {rightIcon}
              </span>
            )}
        </div>

        {(error ||
          helperText) && (
          <div
            id={`${name}-helper`}
            className={`tt-input-helper ${
              error
                ? "tt-input-helper-error"
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

Input.displayName =
  "Input";

// ============================================================================
// Prop Types
// ============================================================================

Input.propTypes = {
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

  type:
    PropTypes.string,

  placeholder:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  readOnly:
    PropTypes.bool,

  required:
    PropTypes.bool,

  error:
    PropTypes.string,

  helperText:
    PropTypes.string,

  leftIcon:
    PropTypes.node,

  rightIcon:
    PropTypes.node,

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

  showPasswordToggle:
    PropTypes.bool,

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
  Input
);