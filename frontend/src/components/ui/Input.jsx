"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Input Component
 * ============================================================================
 *
 * File:
 *   frontend/src/components/ui/Input.jsx
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Enterprise-grade reusable input control for TITech applications.
 *
 * Features:
 * ----------------------------------------------------------------------------
 * ✓ Controlled and uncontrolled input support
 * ✓ React ref forwarding
 * ✓ Accessible labels
 * ✓ Automatic stable ID generation
 * ✓ Error / warning / success states
 * ✓ Help and validation messaging
 * ✓ Required-field semantics
 * ✓ Disabled / read-only states
 * ✓ Loading state
 * ✓ Prefix / suffix support
 * ✓ Password visibility toggle
 * ✓ Character counter
 * ✓ Maximum/minimum length
 * ✓ Input mode support
 * ✓ Auto-complete support
 * ✓ Native input attributes passthrough
 * ✓ Form integration
 * ✓ Keyboard accessible
 * ✓ Screen-reader friendly
 * ✓ Enterprise styling hooks
 * ✓ Safe event handling
 *
 * Security:
 * ----------------------------------------------------------------------------
 * This component does not perform business validation or trust user input.
 * Validation and sanitization must also be enforced by the backend.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  memo,
  useId,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const INPUT_TYPES = [
  "text",
  "email",
  "password",
  "number",
  "tel",
  "url",
  "search",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
];

const VALIDATION_STATES = [
  "default",
  "success",
  "warning",
  "error",
];

// ============================================================================
// Helpers
// ============================================================================

function normalizeId(
  value
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    );
}

function buildDescriptionId(
  id,
  suffix
) {
  return `${id}-${suffix}`;
}

// ============================================================================
// Component
// ============================================================================

const Input = forwardRef(
  (
    {
      id,
      name,
      label,
      type = "text",

      value,
      defaultValue,

      placeholder,

      disabled = false,
      readOnly = false,
      required = false,

      autoFocus = false,
      autoComplete,

      min,
      max,
      step,

      minLength,
      maxLength,

      pattern,

      inputMode,

      size = "md",

      state = "default",

      error,
      warning,
      success,
      helperText,

      prefix,
      suffix,

      loading = false,

      showPasswordToggle = false,

      showCharacterCount = false,

      fullWidth = true,

      className = "",
      inputClassName = "",
      labelClassName = "",

      ariaLabel,
      ariaLabelledBy,
      ariaDescribedBy,

      onChange,
      onFocus,
      onBlur,
      onKeyDown,
      onKeyUp,

      ...props
    },
    ref
  ) => {
    // ========================================================================
    // Internal State
    // ========================================================================

    const generatedId =
      useId();

    const normalizedGeneratedId =
      useMemo(
        () =>
          normalizeId(
            `tt-input-${generatedId}`
          ),
        [generatedId]
      );

    const inputId =
      normalizeId(id) ||
      normalizedGeneratedId;

    const [
      passwordVisible,
      setPasswordVisible,
    ] = useState(false);

    // ========================================================================
    // Derived State
    // ========================================================================

    const effectiveState =
      VALIDATION_STATES.includes(
        state
      )
        ? state
        : "default";

    const hasError =
      Boolean(error);

    const hasWarning =
      Boolean(warning);

    const hasSuccess =
      Boolean(success);

    const validationState =
      hasError
        ? "error"
        : hasWarning
        ? "warning"
        : hasSuccess
        ? "success"
        : effectiveState;

    const isPassword =
      type === "password";

    const effectiveType =
      isPassword &&
      showPasswordToggle &&
      passwordVisible
        ? "text"
        : type;

    const isDisabled =
      disabled || loading;

    // ========================================================================
    // Accessibility IDs
    // ========================================================================

    const errorId =
      buildDescriptionId(
        inputId,
        "error"
      );

    const warningId =
      buildDescriptionId(
        inputId,
        "warning"
      );

    const successId =
      buildDescriptionId(
        inputId,
        "success"
      );

    const helperId =
      buildDescriptionId(
        inputId,
        "help"
      );

    const countId =
      buildDescriptionId(
        inputId,
        "count"
      );

    // ========================================================================
    // Accessible Description
    // ========================================================================

    const describedBy =
      [
        ariaDescribedBy,
        hasError
          ? errorId
          : null,
        !hasError &&
        hasWarning
          ? warningId
          : null,
        !hasError &&
        !hasWarning &&
        hasSuccess
          ? successId
          : null,
        helperText
          ? helperId
          : null,
        showCharacterCount &&
        maxLength
          ? countId
          : null,
      ]
        .filter(Boolean)
        .join(" ") ||
      undefined;

    // ========================================================================
    // Character Count
    // ========================================================================

    const currentLength =
      typeof value ===
      "string"
        ? value.length
        : typeof defaultValue ===
          "string"
        ? defaultValue.length
        : 0;

    // ========================================================================
    // Classes
    // ========================================================================

    const classes = [
      "tt-input",
      `tt-input-${size}`,
      `tt-input-${validationState}`,

      fullWidth
        ? "tt-input-full-width"
        : "",

      prefix
        ? "tt-input-has-prefix"
        : "",

      suffix
        ? "tt-input-has-suffix"
        : "",

      loading
        ? "tt-input-loading"
        : "",

      isDisabled
        ? "tt-input-disabled"
        : "",

      readOnly
        ? "tt-input-readonly"
        : "",

      inputClassName,
    ]
      .filter(Boolean)
      .join(" ");

    const wrapperClasses = [
      "tt-input-wrapper",

      fullWidth
        ? "tt-input-wrapper-full-width"
        : "",

      className,
    ]
      .filter(Boolean)
      .join(" ");

    // ========================================================================
    // Password Visibility
    // ========================================================================

    const togglePasswordVisibility =
      () => {
        if (
          isDisabled ||
          readOnly
        ) {
          return;
        }

        setPasswordVisible(
          (previous) =>
            !previous
        );
      };

    // ========================================================================
    // Event Handlers
    // ========================================================================

    const handleChange =
      (event) => {
        if (
          typeof onChange ===
          "function"
        ) {
          onChange(event);
        }
      };

    const handleFocus =
      (event) => {
        if (
          typeof onFocus ===
          "function"
        ) {
          onFocus(event);
        }
      };

    const handleBlur =
      (event) => {
        if (
          typeof onBlur ===
          "function"
        ) {
          onBlur(event);
        }
      };

    // ========================================================================
    // Render
    // ========================================================================

    return (
      <div
        className={
          wrapperClasses
        }
      >
        {label && (
          <label
            htmlFor={inputId}
            className={[
              "tt-input-label",
              labelClassName,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span>
              {label}
            </span>

            {required && (
              <span
                className="tt-input-required"
                aria-hidden="true"
              >
                {" "}
                *
              </span>
            )}
          </label>
        )}

        <div
          className={[
            "tt-input-control",
            `tt-input-control-${size}`,
            `tt-input-control-${validationState}`,
            isDisabled
              ? "tt-input-control-disabled"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {prefix && (
            <span
              className="tt-input-prefix"
              aria-hidden="true"
            >
              {prefix}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            name={name}
            type={effectiveType}
            value={value}
            defaultValue={
              defaultValue
            }
            placeholder={
              placeholder
            }
            disabled={
              isDisabled
            }
            readOnly={
              readOnly
            }
            required={
              required
            }
            autoFocus={
              autoFocus
            }
            autoComplete={
              autoComplete
            }
            min={min}
            max={max}
            step={step}
            minLength={
              minLength
            }
            maxLength={
              maxLength
            }
            pattern={
              pattern
            }
            inputMode={
              inputMode
            }
            className={
              classes
            }
            aria-label={
              ariaLabel
            }
            aria-labelledby={
              ariaLabelledBy
            }
            aria-describedby={
              describedBy
            }
            aria-invalid={
              validationState ===
              "error"
                ? "true"
                : "false"
            }
            aria-required={
              required
                ? "true"
                : undefined
            }
            aria-busy={
              loading
                ? "true"
                : undefined
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
              onKeyDown
            }
            onKeyUp={
              onKeyUp
            }
            {...props}
          />

          {loading && (
            <span
              className="tt-input-loading-indicator"
              aria-hidden="true"
            >
              <Loader2
                size={18}
                className="tt-input-spinner"
              />
            </span>
          )}

          {isPassword &&
            showPasswordToggle &&
            !loading && (
              <button
                type="button"
                className="tt-input-password-toggle"
                onClick={
                  togglePasswordVisibility
                }
                disabled={
                  isDisabled ||
                  readOnly
                }
                aria-label={
                  passwordVisible
                    ? "Hide password"
                    : "Show password"
                }
                aria-pressed={
                  passwordVisible
                }
                tabIndex={
                  isDisabled
                    ? -1
                    : 0
                }
              >
                {passwordVisible ? (
                  <EyeOff
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <Eye
                    size={18}
                    aria-hidden="true"
                  />
                )}
              </button>
            )}

          {suffix &&
            !loading &&
            !(
              isPassword &&
              showPasswordToggle
            ) && (
              <span
                className="tt-input-suffix"
                aria-hidden="true"
              >
                {suffix}
              </span>
            )}
        </div>

        {/* ================================================================== */}
        {/* Validation / Help Message                                         */}
        {/* ================================================================== */}

        {hasError && (
          <div
            id={errorId}
            className="tt-input-message tt-input-error-message"
            role="alert"
          >
            {error}
          </div>
        )}

        {!hasError &&
          hasWarning && (
            <div
              id={warningId}
              className="tt-input-message tt-input-warning-message"
              role="status"
            >
              {warning}
            </div>
          )}

        {!hasError &&
          !hasWarning &&
          hasSuccess && (
            <div
              id={successId}
              className="tt-input-message tt-input-success-message"
              role="status"
            >
              {success}
            </div>
          )}

        {helperText && (
          <div
            id={helperId}
            className="tt-input-message tt-input-helper-message"
          >
            {helperText}
          </div>
        )}

        {/* ================================================================== */}
        {/* Character Counter                                                  */}
        {/* ================================================================== */}

        {showCharacterCount &&
          maxLength && (
            <div
              id={countId}
              className="tt-input-character-count"
              aria-live="polite"
            >
              {currentLength}
              {" / "}
              {maxLength}
            </div>
          )}
      </div>
    );
  }
);

Input.displayName =
  "TITechInput";

// ============================================================================
// PropTypes
// ============================================================================

Input.propTypes = {
  id: PropTypes.string,

  name: PropTypes.string,

  label: PropTypes.node,

  type: PropTypes.oneOf(
    INPUT_TYPES
  ),

  value: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  defaultValue:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  placeholder:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  readOnly:
    PropTypes.bool,

  required:
    PropTypes.bool,

  autoFocus:
    PropTypes.bool,

  autoComplete:
    PropTypes.string,

  min: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  max: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  step: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  minLength:
    PropTypes.number,

  maxLength:
    PropTypes.number,

  pattern:
    PropTypes.string,

  inputMode:
    PropTypes.string,

  size: PropTypes.oneOf([
    "sm",
    "md",
    "lg",
  ]),

  state: PropTypes.oneOf(
    VALIDATION_STATES
  ),

  error:
    PropTypes.node,

  warning:
    PropTypes.node,

  success:
    PropTypes.node,

  helperText:
    PropTypes.node,

  prefix:
    PropTypes.node,

  suffix:
    PropTypes.node,

  loading:
    PropTypes.bool,

  showPasswordToggle:
    PropTypes.bool,

  showCharacterCount:
    PropTypes.bool,

  fullWidth:
    PropTypes.bool,

  className:
    PropTypes.string,

  inputClassName:
    PropTypes.string,

  labelClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  ariaLabelledBy:
    PropTypes.string,

  ariaDescribedBy:
    PropTypes.string,

  onChange:
    PropTypes.func,

  onFocus:
    PropTypes.func,

  onBlur:
    PropTypes.func,

  onKeyDown:
    PropTypes.func,

  onKeyUp:
    PropTypes.func,
};

// ============================================================================
// Export
// ============================================================================

export default memo(Input);