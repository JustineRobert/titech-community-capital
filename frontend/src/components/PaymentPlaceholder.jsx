// ============================================================================
// TITech Community Capital
// Enterprise Payment Placeholder
// File: frontend/src/components/PaymentPlaceholder.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Reusable payment placeholder for payment methods or payment integrations
// that are not yet enabled, configured, available, or supported.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Clear payment availability messaging
// ✓ Provider / payment-method presentation
// ✓ Optional amount and currency display
// ✓ Optional explanatory messaging
// ✓ Optional action / retry callback
// ✓ Optional navigation target
// ✓ Loading / disabled state
// ✓ Accessible semantics
// ✓ Stable test selectors
// ✓ Responsive-friendly markup
// ✓ Defensive prop normalization
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// This component is presentation-only.
//
// It MUST NOT be treated as an authorization, tenant-isolation, financial
// authorization, payment-processing, KYC/AML, compliance, or accounting
// boundary.
//
// Payment authorization, provider availability, transaction validation,
// limits, permissions, and financial state MUST be enforced by the
// backend/API layer.
//
// ============================================================================

"use strict";

import React, { memo, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  Info,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  WalletCards,
} from "lucide-react";

import "./PaymentPlaceholder.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_ID = "titech-payment-placeholder";

const DEFAULT_TITLE = "Payment method unavailable";

const DEFAULT_MESSAGE =
  "This payment method is currently unavailable.";

const DEFAULT_PROVIDER = "Payment Provider";

const DEFAULT_CURRENCY = "UGX";

const DEFAULT_AMOUNT = 0;

const STATUS = Object.freeze({
  DEFAULT: "default",
  INFO: "info",
  PENDING: "pending",
  WARNING: "warning",
  ERROR: "error",
  SUCCESS: "success",
});

const SIZE = Object.freeze({
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
});

const ICONS = Object.freeze({
  DEFAULT: CreditCard,
  MOBILE_MONEY: Smartphone,
  WALLET: WalletCards,
  SECURITY: ShieldCheck,
  INFO: Info,
  PENDING: Clock3,
  ERROR: AlertCircle,
  SUCCESS: CheckCircle2,
  LOCKED: LockKeyhole,
});

// ============================================================================
// Normalization Helpers
// ============================================================================

function normalizeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function normalizeNumber(value, fallback = DEFAULT_AMOUNT) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = String(value)
    .replace(/,/g, "")
    .trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeStatus(value) {
  const normalized = normalizeString(
    value,
    STATUS.DEFAULT,
  ).toLowerCase();

  return Object.values(STATUS).includes(normalized)
    ? normalized
    : STATUS.DEFAULT;
}

function normalizeSize(value) {
  const normalized = normalizeString(
    value,
    SIZE.MEDIUM,
  ).toLowerCase();

  return Object.values(SIZE).includes(normalized)
    ? normalized
    : SIZE.MEDIUM;
}

function normalizeProvider(value) {
  return normalizeString(
    value,
    DEFAULT_PROVIDER,
  );
}

// ============================================================================
// Formatting
// ============================================================================

function createNumberFormatter(locale, options = {}) {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat("en-UG", options);
  }
}

function formatAmount({
  amount,
  currency = DEFAULT_CURRENCY,
  locale = "en-UG",
  maximumFractionDigits = 0,
}) {
  const normalizedAmount = normalizeNumber(amount);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(normalizedAmount);
  } catch {
    return `${currency} ${createNumberFormatter(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(normalizedAmount)}`;
  }
}

// ============================================================================
// Icon Resolution
// ============================================================================

function getDefaultIcon(status) {
  switch (normalizeStatus(status)) {
    case STATUS.ERROR:
      return ICONS.ERROR;

    case STATUS.SUCCESS:
      return ICONS.SUCCESS;

    case STATUS.PENDING:
      return ICONS.PENDING;

    case STATUS.INFO:
      return ICONS.INFO;

    default:
      return ICONS.DEFAULT;
  }
}

// ============================================================================
// Payment Placeholder
// ============================================================================

function PaymentPlaceholder({
  provider = DEFAULT_PROVIDER,
  title = DEFAULT_TITLE,
  message = DEFAULT_MESSAGE,
  description = "",
  amount = DEFAULT_AMOUNT,
  currency = DEFAULT_CURRENCY,
  locale = "en-UG",
  status = STATUS.INFO,
  icon: CustomIcon,
  href = "",
  to = "",
  actionLabel = "",
  onAction,
  onRetry,
  retryLabel = "Try Again",
  showAmount = false,
  showProvider = true,
  showSecurityNotice = true,
  securityMessage =
    "Your payment information remains protected by TITech Community Capital security controls.",
  loading = false,
  disabled = false,
  compact = false,
  size = SIZE.MEDIUM,
  className = "",
  testId = DEFAULT_TEST_ID,
  ariaLabel = "",
}) {
  // ==========================================================================
  // Normalize Props
  // ==========================================================================

  const resolvedProvider = normalizeProvider(provider);

  const resolvedTitle = normalizeString(
    title,
    DEFAULT_TITLE,
  );

  const resolvedMessage = normalizeString(
    message,
    DEFAULT_MESSAGE,
  );

  const resolvedDescription = normalizeString(
    description,
  );

  const resolvedCurrency = normalizeString(
    currency,
    DEFAULT_CURRENCY,
  );

  const resolvedLocale = normalizeString(
    locale,
    "en-UG",
  );

  const resolvedStatus = normalizeStatus(status);

  const resolvedSize = normalizeSize(size);

  const resolvedHref = normalizeString(
    href || to,
  );

  const resolvedActionLabel = normalizeString(
    actionLabel,
  );

  const resolvedRetryLabel = normalizeString(
    retryLabel,
    "Try Again",
  );

  const resolvedSecurityMessage = normalizeString(
    securityMessage,
  );

  const resolvedAmount = normalizeNumber(
    amount,
  );

  const resolvedShowAmount = normalizeBoolean(
    showAmount,
    false,
  );

  const resolvedShowProvider = normalizeBoolean(
    showProvider,
    true,
  );

  const resolvedShowSecurityNotice = normalizeBoolean(
    showSecurityNotice,
    true,
  );

  const isDisabled =
    disabled ||
    loading;

  // ==========================================================================
  // Derived Values
  // ==========================================================================

  const formattedAmount = useMemo(
    () =>
      formatAmount({
        amount: resolvedAmount,
        currency: resolvedCurrency,
        locale: resolvedLocale,
      }),
    [
      resolvedAmount,
      resolvedCurrency,
      resolvedLocale,
    ],
  );

  const Icon = useMemo(
    () =>
      CustomIcon ||
      getDefaultIcon(resolvedStatus),
    [
      CustomIcon,
      resolvedStatus,
    ],
  );

  const hasAction =
    Boolean(
      resolvedHref ||
      resolvedActionLabel ||
      onAction ||
      onRetry,
    );

  const resolvedAriaLabel = normalizeString(
    ariaLabel,
    `${resolvedProvider}: ${resolvedTitle}`,
  );

  const widgetClassName = [
    "payment-placeholder",
    `payment-placeholder--${resolvedSize}`,
    `payment-placeholder--status-${resolvedStatus}`,
    compact
      ? "payment-placeholder--compact"
      : "",
    loading
      ? "payment-placeholder--loading"
      : "",
    isDisabled
      ? "payment-placeholder--disabled"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  const handleAction = useCallback(
    (event) => {
      if (isDisabled) {
        event?.preventDefault?.();
        return;
      }

      if (typeof onAction === "function") {
        onAction(event);
        return;
      }

      if (
        typeof onRetry === "function" &&
        !resolvedHref &&
        !resolvedActionLabel
      ) {
        onRetry(event);
      }
    },
    [
      isDisabled,
      onAction,
      onRetry,
      resolvedHref,
      resolvedActionLabel,
    ],
  );

  const handleRetry = useCallback(
    (event) => {
      if (isDisabled) {
        event?.preventDefault?.();
        return;
      }

      if (typeof onRetry === "function") {
        onRetry(event);
        return;
      }

      if (typeof onAction === "function") {
        onAction(event);
      }
    },
    [
      isDisabled,
      onRetry,
      onAction,
    ],
  );

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (loading) {
    return (
      <section
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-payment-placeholder"
        data-state="loading"
        data-status={resolvedStatus}
        aria-busy="true"
        aria-live="polite"
        aria-label={`Loading ${resolvedProvider} payment availability`}
      >
        <div className="payment-placeholder__icon payment-placeholder__icon--loading">
          <RefreshCw
            size={28}
            aria-hidden="true"
            focusable="false"
          />
        </div>

        <div className="payment-placeholder__body">
          <span className="payment-placeholder__eyebrow">
            {resolvedProvider}
          </span>

          <h3 className="payment-placeholder__title">
            Checking payment availability
          </h3>

          <p className="payment-placeholder__message">
            Please wait while TITech checks the current payment
            service status.
          </p>

          {resolvedShowAmount ? (
            <div className="payment-placeholder__amount">
              {formattedAmount}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  // ==========================================================================
  // Content
  // ==========================================================================

  const content = (
    <>
      <div
        className="payment-placeholder__icon"
        aria-hidden="true"
      >
        <Icon
          size={
            compact
              ? 24
              : 30
          }
          focusable="false"
        />
      </div>

      <div className="payment-placeholder__body">
        {resolvedShowProvider ? (
          <span className="payment-placeholder__eyebrow">
            {resolvedProvider}
          </span>
        ) : null}

        <h3 className="payment-placeholder__title">
          {resolvedTitle}
        </h3>

        <p className="payment-placeholder__message">
          {resolvedMessage}
        </p>

        {resolvedDescription ? (
          <p className="payment-placeholder__description">
            {resolvedDescription}
          </p>
        ) : null}

        {resolvedShowAmount ? (
          <div
            className="payment-placeholder__amount"
            data-testid={`${testId}-amount`}
            aria-label={`Payment amount ${formattedAmount}`}
          >
            {formattedAmount}
          </div>
        ) : null}

        {resolvedShowSecurityNotice &&
        resolvedSecurityMessage ? (
          <div className="payment-placeholder__security">
            <ShieldCheck
              size={16}
              aria-hidden="true"
              focusable="false"
            />

            <span>
              {resolvedSecurityMessage}
            </span>
          </div>
        ) : null}

        {hasAction ? (
          <div className="payment-placeholder__actions">
            {resolvedHref ? (
              /^https?:\/\//i.test(
                resolvedHref,
              ) ? (
                <a
                  href={resolvedHref}
                  className="payment-placeholder__button payment-placeholder__button--primary"
                  data-testid={`${testId}-action`}
                  aria-disabled={
                    isDisabled
                      ? "true"
                      : undefined
                  }
                  onClick={handleAction}
                >
                  {resolvedActionLabel ||
                    "Continue"}
                  <ArrowRight
                    size={17}
                    aria-hidden="true"
                    focusable="false"
                  />
                </a>
              ) : (
                <Link
                  to={resolvedHref}
                  className="payment-placeholder__button payment-placeholder__button--primary"
                  data-testid={`${testId}-action`}
                  aria-disabled={
                    isDisabled
                      ? "true"
                      : undefined
                  }
                  onClick={handleAction}
                >
                  {resolvedActionLabel ||
                    "Continue"}
                  <ArrowRight
                    size={17}
                    aria-hidden="true"
                    focusable="false"
                  />
                </Link>
              )
            ) : resolvedActionLabel ||
              onAction ? (
              <button
                type="button"
                className="payment-placeholder__button payment-placeholder__button--primary"
                data-testid={`${testId}-action`}
                disabled={isDisabled}
                onClick={handleAction}
              >
                {loading
                  ? "Please wait..."
                  : resolvedActionLabel ||
                    "Continue"}

                <ArrowRight
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                />
              </button>
            ) : null}

            {onRetry ? (
              <button
                type="button"
                className="payment-placeholder__button payment-placeholder__button--secondary"
                data-testid={`${testId}-retry`}
                disabled={isDisabled}
                onClick={handleRetry}
              >
                <RefreshCw
                  size={16}
                  aria-hidden="true"
                  focusable="false"
                />

                {resolvedRetryLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  // ==========================================================================
  // Interactive Wrapper
  // ==========================================================================

  if (resolvedHref) {
    const isExternal =
      /^(https?:\/\/|mailto:|tel:)/i.test(
        resolvedHref,
      );

    if (isExternal) {
      return (
        <section
          className={widgetClassName}
          data-testid={testId}
          data-component="titech-payment-placeholder"
          data-state="ready"
          data-status={resolvedStatus}
          aria-label={resolvedAriaLabel}
        >
          {content}
        </section>
      );
    }

    return (
      <section
        className={widgetClassName}
        data-testid={testId}
        data-component="titech-payment-placeholder"
        data-state="ready"
        data-status={resolvedStatus}
        aria-label={resolvedAriaLabel}
      >
        {content}
      </section>
    );
  }

  // ==========================================================================
  // Non-Navigational Placeholder
  // ==========================================================================

  return (
    <section
      className={widgetClassName}
      data-testid={testId}
      data-component="titech-payment-placeholder"
      data-state="ready"
      data-status={resolvedStatus}
      aria-label={resolvedAriaLabel}
    >
      {content}
    </section>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

PaymentPlaceholder.propTypes = {
  provider: PropTypes.string,

  title: PropTypes.string,

  message: PropTypes.string,

  description: PropTypes.string,

  amount: PropTypes.oneOfType([
    PropTypes.number,
    PropTypes.string,
  ]),

  currency: PropTypes.string,

  locale: PropTypes.string,

  status: PropTypes.oneOf(
    Object.values(STATUS),
  ),

  icon: PropTypes.elementType,

  href: PropTypes.string,

  to: PropTypes.string,

  actionLabel: PropTypes.string,

  onAction: PropTypes.func,

  onRetry: PropTypes.func,

  retryLabel: PropTypes.string,

  showAmount: PropTypes.bool,

  showProvider: PropTypes.bool,

  showSecurityNotice: PropTypes.bool,

  securityMessage: PropTypes.string,

  loading: PropTypes.bool,

  disabled: PropTypes.bool,

  compact: PropTypes.bool,

  size: PropTypes.oneOf(
    Object.values(SIZE),
  ),

  className: PropTypes.string,

  testId: PropTypes.string,

  ariaLabel: PropTypes.string,
};

// ============================================================================
// Default Props
// ============================================================================

PaymentPlaceholder.defaultProps = {
  provider: DEFAULT_PROVIDER,

  title: DEFAULT_TITLE,

  message: DEFAULT_MESSAGE,

  description: "",

  amount: DEFAULT_AMOUNT,

  currency: DEFAULT_CURRENCY,

  locale: "en-UG",

  status: STATUS.INFO,

  icon: null,

  href: "",

  to: "",

  actionLabel: "",

  onAction: undefined,

  onRetry: undefined,

  retryLabel: "Try Again",

  showAmount: false,

  showProvider: true,

  showSecurityNotice: true,

  securityMessage:
    "Your payment information remains protected by TITech Community Capital security controls.",

  loading: false,

  disabled: false,

  compact: false,

  size: SIZE.MEDIUM,

  className: "",

  testId: DEFAULT_TEST_ID,

  ariaLabel: "",
};

// ============================================================================
// Static Constants
// ============================================================================

PaymentPlaceholder.STATUS = STATUS;

PaymentPlaceholder.SIZE = SIZE;

// ============================================================================
// Static Utilities
// ============================================================================

PaymentPlaceholder.formatAmount =
  formatAmount;

PaymentPlaceholder.normalizeNumber =
  normalizeNumber;

PaymentPlaceholder.normalizeStatus =
  normalizeStatus;

// ============================================================================
// Metadata
// ============================================================================

PaymentPlaceholder.displayName =
  "TITechPaymentPlaceholder";

// ============================================================================
// Export
// ============================================================================

export default memo(
  PaymentPlaceholder,
);