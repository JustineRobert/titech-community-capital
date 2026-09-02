// ============================================================================
// TITech Community Capital
// Enterprise Mobile Money Payment Component
// File: frontend/src/components/MobileMoneyPayment.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Reusable mobile-money payment interface for TITech Community Capital.
//
// Supported providers
// ----------------------------------------------------------------------------
// ✓ MTN MoMo
// ✓ Airtel Money
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Provider selection
// ✓ Phone number collection and validation
// ✓ Payment initiation
// ✓ Payment status polling
// ✓ Success / failure / timeout states
// ✓ Retry UX
// ✓ Defensive API response normalization
// ✓ Duplicate-submission protection
// ✓ Polling cleanup
// ✓ Accessibility
// ✓ Stable test selectors
// ✓ Responsive-friendly semantic markup
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// This component is PRESENTATION ONLY.
//
// It MUST NOT be treated as:
// ✓ A financial authorization boundary
// ✓ A ledger/accounting boundary
// ✓ A KYC/AML boundary
// ✓ A tenant-isolation boundary
// ✓ A payment-provider trust boundary
//
// The backend MUST independently validate:
// ✓ Authentication
// ✓ Authorization
// ✓ Tenant ownership
// ✓ Group ownership
// ✓ Contribution ownership
// ✓ Amount and currency
// ✓ Provider
// ✓ Phone number
// ✓ Idempotency
// ✓ Transaction state
// ✓ Payment-provider callbacks/webhooks
//
// IMPORTANT
// ----------------------------------------------------------------------------
// The client never declares a transaction successful merely because the
// initiation endpoint succeeds. Final payment success must come from the
// trusted backend/payment-provider reconciliation flow.
//
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  DollarSign,
  Loader2,
  Phone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";

import { toast } from "react-toastify";

import api from "../services/api";

import "./MobileMoneyPayment.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CURRENCY = "UGX";
const DEFAULT_LOCALE = "en-UG";

const PAYMENT_INITIATE_ENDPOINT =
  "/api/payments/initiate";

const PAYMENT_STATUS_ENDPOINT =
  "/api/payments/status";

const POLLING_INTERVAL_MS = 5000;

const MAX_POLL_ATTEMPTS = 60;

const REQUEST_TIMEOUT_MESSAGE =
  "Payment confirmation is taking longer than expected. Please verify your mobile money account before trying again.";

const DEFAULT_ERROR_MESSAGE =
  "We were unable to process the payment. Please try again.";

const PROVIDERS = Object.freeze({
  MTN_MOMO: "MTN_MOMO",
  AIRTEL_MONEY: "AIRTEL_MONEY",
});

const PAYMENT_STEPS = Object.freeze({
  PROVIDER: "provider",
  PHONE: "phone",
  PROCESSING: "processing",
  COMPLETE: "complete",
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  TIMEOUT: "TIMEOUT",
});

const TERMINAL_STATUSES = new Set([
  PAYMENT_STATUS.COMPLETED,
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.EXPIRED,
]);

const SUCCESS_STATUSES = new Set([
  PAYMENT_STATUS.COMPLETED,
]);

const FAILURE_STATUSES = new Set([
  PAYMENT_STATUS.FAILED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.EXPIRED,
]);

const PROVIDER_METADATA = Object.freeze({
  [PROVIDERS.MTN_MOMO]: {
    name: "MTN MoMo",
    shortName: "MTN",
    description: "Fast and secure mobile money",
  },

  [PROVIDERS.AIRTEL_MONEY]: {
    name: "Airtel Money",
    shortName: "Airtel",
    description: "Convenient mobile money payments",
  },
});

// ============================================================================
// Utility Helpers
// ============================================================================

function normalizeString(
  value,
  fallback = "",
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function normalizeNumber(
  value,
  fallback = 0,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : fallback;
  }

  const normalized = String(value)
    .replace(/,/g, "")
    .trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function normalizeStatus(
  value,
) {
  const normalized = normalizeString(
    value,
    PAYMENT_STATUS.PENDING,
  ).toUpperCase();

  return Object.values(
    PAYMENT_STATUS,
  ).includes(normalized)
    ? normalized
    : PAYMENT_STATUS.PENDING;
}

function sanitizeErrorMessage(
  error,
  fallback = DEFAULT_ERROR_MESSAGE,
) {
  const candidates = [
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.message,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(
      candidate,
    );

    if (normalized) {
      return normalized;
    }
  }

  return fallback;
}

function getProviderName(
  provider,
) {
  return (
    PROVIDER_METADATA[
      provider
    ]?.name ||
    "mobile money"
  );
}

function getProviderShortName(
  provider,
) {
  return (
    PROVIDER_METADATA[
      provider
    ]?.shortName ||
    "mobile money"
  );
}

// ============================================================================
// Phone Number Helpers
// ============================================================================

/**
 * Normalize an East African/Ugandan mobile number.
 *
 * Supported examples:
 *   0771234567
 *   771234567
 *   +256771234567
 *   +256 771 234 567
 *
 * The backend remains responsible for final provider-specific validation.
 */
function normalizePhoneNumber(
  value,
) {
  const raw = normalizeString(value);

  if (!raw) {
    return "";
  }

  let cleaned = raw.replace(
    /[^\d+]/g,
    "",
  );

  if (
    cleaned.startsWith("00")
  ) {
    cleaned =
      `+${cleaned.slice(2)}`;
  }

  if (
    cleaned.startsWith("+")
  ) {
    return cleaned;
  }

  if (
    cleaned.startsWith("0")
  ) {
    return `+256${cleaned.slice(1)}`;
  }

  if (
    /^7\d{8}$/.test(cleaned)
  ) {
    return `+256${cleaned}`;
  }

  return cleaned;
}

/**
 * Validate normalized Ugandan mobile numbers.
 *
 * This is intentionally conservative on the client.
 * Backend/provider validation remains authoritative.
 */
function validatePhoneNumber(
  value,
) {
  const normalized =
    normalizePhoneNumber(value);

  return /^\+2567\d{8}$/.test(
    normalized,
  );
}

// ============================================================================
// Formatting
// ============================================================================

function formatAmount(
  amount,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
) {
  const normalizedAmount =
    normalizeNumber(amount);

  try {
    return new Intl.NumberFormat(
      locale,
      {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      },
    ).format(normalizedAmount);
  } catch {
    return `${currency} ${normalizedAmount.toLocaleString()}`;
  }
}

// ============================================================================
// API Response Normalization
// ============================================================================

function extractPaymentPayload(
  response,
) {
  const data =
    response?.data || {};

  return (
    data?.data ||
    data
  );
}

function extractTransactionId(
  response,
) {
  const payload =
    extractPaymentPayload(
      response,
    );

  return (
    payload?.transactionId ||
    payload?.transactionID ||
    payload?.transaction_id ||
    payload?.paymentId ||
    payload?.paymentID ||
    payload?.reference ||
    payload?.referenceId ||
    null
  );
}

function extractPaymentStatus(
  response,
) {
  const payload =
    extractPaymentPayload(
      response,
    );

  return normalizeStatus(
    payload?.status ||
      payload?.paymentStatus ||
      payload?.transactionStatus,
  );
}

// ============================================================================
// Component
// ============================================================================

function MobileMoneyPayment({
  amount = 0,
  currency = DEFAULT_CURRENCY,
  groupId = null,
  contributionId = null,
  onPaymentSuccess = null,
  onPaymentCancel = null,
  onPaymentError = null,
  onPaymentTimeout = null,
  locale = DEFAULT_LOCALE,
  initialProvider = "",
  initialPhoneNumber = "",
  disabled = false,
  testId = "titech-mobile-money-payment",
  className = "",
}) {
  // ========================================================================
  // Stable IDs
  // ========================================================================

  const generatedId =
    useId();

  const phoneInputId =
    `${generatedId}-phone`;

  const providerGroupId =
    `${generatedId}-provider`;

  const statusRegionId =
    `${generatedId}-status`;

  // ========================================================================
  // State
  // ========================================================================

  const [step, setStep] =
    useState(
      PAYMENT_STEPS.PROVIDER,
    );

  const [provider, setProvider] =
    useState(
      initialProvider,
    );

  const [phoneNumber, setPhoneNumber] =
    useState(
      initialPhoneNumber,
    );

  const [loading, setLoading] =
    useState(false);

  const [transactionId, setTransactionId] =
    useState(null);

  const [paymentStatus, setPaymentStatus] =
    useState(null);

  const [error, setError] =
    useState(null);

  const [pollAttempt, setPollAttempt] =
    useState(0);

  const [timedOut, setTimedOut] =
    useState(false);

  // ========================================================================
  // Refs
  // ========================================================================

  const mountedRef =
    useRef(true);

  const pollingTimerRef =
    useRef(null);

  const pollingInProgressRef =
    useRef(false);

  const paymentRequestInProgressRef =
    useRef(false);

  const completedRef =
    useRef(false);

  // ========================================================================
  // Derived Values
  // ========================================================================

  const normalizedAmount =
    useMemo(
      () =>
        normalizeNumber(
          amount,
        0,
      ),
      [amount],
    );

  const normalizedCurrency =
    useMemo(
      () =>
        normalizeString(
          currency,
          DEFAULT_CURRENCY,
        ).toUpperCase(),
      [currency],
    );

  const normalizedPhone =
    useMemo(
      () =>
        normalizePhoneNumber(
          phoneNumber,
        ),
      [phoneNumber],
    );

  const formattedAmount =
    useMemo(
      () =>
        formatAmount(
          normalizedAmount,
          normalizedCurrency,
          locale,
        ),
      [
        normalizedAmount,
        normalizedCurrency,
        locale,
      ],
    );

  const providerName =
    getProviderName(
      provider,
    );

  const providerShortName =
    getProviderShortName(
      provider,
    );

  const isPhoneValid =
    validatePhoneNumber(
      phoneNumber,
    );

  const isTerminalStatus =
    paymentStatus
      ? TERMINAL_STATUSES.has(
          paymentStatus,
        )
      : false;

  const isSuccessful =
    paymentStatus
      ? SUCCESS_STATUSES.has(
          paymentStatus,
        )
      : false;

  const isFailed =
    paymentStatus
      ? FAILURE_STATUSES.has(
          paymentStatus,
        )
      : false;

  // ========================================================================
  // Lifecycle
  // ========================================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (
        pollingTimerRef.current
      ) {
        clearTimeout(
          pollingTimerRef.current,
        );

        pollingTimerRef.current =
          null;
      }
    };
  }, []);

  // ========================================================================
  // Polling Cleanup
  // ========================================================================

  const stopPolling =
    useCallback(() => {
      if (
        pollingTimerRef.current
      ) {
        clearTimeout(
          pollingTimerRef.current,
        );

        pollingTimerRef.current =
          null;
      }

      pollingInProgressRef.current =
        false;
    }, []);

  // ========================================================================
  // Payment Success
  // ========================================================================

  const handlePaymentSuccess =
    useCallback(
      (payload) => {
        if (
          completedRef.current
        ) {
          return;
        }

        completedRef.current =
          true;

        stopPolling();

        if (
          !mountedRef.current
        ) {
          return;
        }

        setPaymentStatus(
          PAYMENT_STATUS.COMPLETED,
        );

        setStep(
          PAYMENT_STEPS.COMPLETE,
        );

        setError(null);

        toast.success(
          "Payment completed successfully.",
        );

        onPaymentSuccess?.(
          payload,
        );
      },
      [
        onPaymentSuccess,
        stopPolling,
      ],
    );

  // ========================================================================
  // Payment Failure
  // ========================================================================

  const handlePaymentFailure =
    useCallback(
      (
        status,
        message,
        payload = null,
      ) => {
        stopPolling();

        if (
          !mountedRef.current
        ) {
          return;
        }

        const normalizedStatus =
          normalizeStatus(
            status,
          );

        setPaymentStatus(
          normalizedStatus,
        );

        setError(
          normalizeString(
            message,
            DEFAULT_ERROR_MESSAGE,
          ),
        );

        setStep(
          PAYMENT_STEPS.COMPLETE,
        );

        if (
          normalizedStatus ===
          PAYMENT_STATUS.CANCELLED
        ) {
          toast.info(
            "Payment was cancelled.",
          );
        } else {
          toast.error(
            normalizeString(
              message,
              DEFAULT_ERROR_MESSAGE,
            ),
          );
        }

        onPaymentError?.(
          payload || {
            status:
              normalizedStatus,
            transactionId,
          },
        );
      },
      [
        onPaymentError,
        stopPolling,
        transactionId,
      ],
    );

  // ========================================================================
  // Payment Status Polling
  // ========================================================================

  const pollPaymentStatus =
    useCallback(
      async (txId) => {
        if (
          !txId ||
          completedRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        if (
          pollingInProgressRef.current
        ) {
          return;
        }

        if (
          pollAttempt >=
          MAX_POLL_ATTEMPTS
        ) {
          stopPolling();

          if (
            mountedRef.current
          ) {
            setTimedOut(true);

            setError(
              REQUEST_TIMEOUT_MESSAGE,
            );

            setStep(
              PAYMENT_STEPS.COMPLETE,
            );

            toast.warning(
              "Payment confirmation is taking longer than expected.",
            );

            onPaymentTimeout?.({
              transactionId: txId,
              status:
                paymentStatus ||
                PAYMENT_STATUS.PENDING,
            });
          }

          return;
        }

        pollingInProgressRef.current =
          true;

        try {
          const response =
            await api.get(
              `${PAYMENT_STATUS_ENDPOINT}/${encodeURIComponent(
                txId,
              )}`,
            );

          if (
            !mountedRef.current
          ) {
            return;
          }

          const status =
            extractPaymentStatus(
              response,
            );

          const payload =
            extractPaymentPayload(
              response,
            );

          setPaymentStatus(
            status,
          );

          setPollAttempt(
            (current) =>
              current + 1,
          );

          if (
            SUCCESS_STATUSES.has(
              status,
            )
          ) {
            handlePaymentSuccess(
              payload,
            );

            return;
          }

          if (
            FAILURE_STATUSES.has(
              status,
            )
          ) {
            handlePaymentFailure(
              status,
              payload?.message ||
                payload?.reason ||
                "The mobile money payment could not be completed.",
              payload,
            );

            return;
          }

          if (
            mountedRef.current
          ) {
            setStep(
              PAYMENT_STEPS.PROCESSING,
            );
          }

          if (
            pollAttempt + 1 >=
            MAX_POLL_ATTEMPTS
          ) {
            stopPolling();

            if (
              mountedRef.current
            ) {
              setTimedOut(true);

              setError(
                REQUEST_TIMEOUT_MESSAGE,
              );

              setStep(
                PAYMENT_STEPS.COMPLETE,
              );

              toast.warning(
                "Payment confirmation is taking longer than expected.",
              );

              onPaymentTimeout?.({
                transactionId: txId,
                status,
              });
            }

            return;
          }

          pollingTimerRef.current =
            setTimeout(
              () => {
                pollingTimerRef.current =
                  null;

                pollPaymentStatus(
                  txId,
                );
              },
              POLLING_INTERVAL_MS,
            );
        } catch (pollError) {
          if (
            !mountedRef.current
          ) {
            return;
          }

          const nextAttempt =
            pollAttempt + 1;

          setPollAttempt(
            nextAttempt,
          );

          // Transient status endpoint errors should not immediately declare
          // the payment failed. The backend remains authoritative.
          if (
            nextAttempt >=
            MAX_POLL_ATTEMPTS
          ) {
            stopPolling();

            setTimedOut(true);

            setError(
              "We could not confirm the final payment status. Please verify your mobile money account before attempting another payment.",
            );

            setStep(
              PAYMENT_STEPS.COMPLETE,
            );

            toast.warning(
              "Unable to confirm payment status.",
            );

            onPaymentTimeout?.({
              transactionId: txId,
              status:
                paymentStatus ||
                PAYMENT_STATUS.PENDING,
              error: sanitizeErrorMessage(
                pollError,
              ),
            });

            return;
          }

          pollingTimerRef.current =
            setTimeout(
              () => {
                pollingTimerRef.current =
                  null;

                pollPaymentStatus(
                  txId,
                );
              },
              POLLING_INTERVAL_MS,
            );
        } finally {
          pollingInProgressRef.current =
            false;
        }
      },
      [
        handlePaymentFailure,
        handlePaymentSuccess,
        onPaymentTimeout,
        paymentStatus,
        pollAttempt,
        stopPolling,
      ],
    );

  // ========================================================================
  // Initiate Payment
  // ========================================================================

  const handleInitiatePayment =
    useCallback(
      async (event) => {
        event?.preventDefault();

        if (
          disabled ||
          loading ||
          paymentRequestInProgressRef.current
        ) {
          return;
        }

        setError(null);
        setTimedOut(false);

        if (
          !provider ||
          !PROVIDER_METADATA[
            provider
          ]
        ) {
          setError(
            "Please select a valid payment provider.",
          );

          return;
        }

        if (
          normalizedAmount <= 0
        ) {
          setError(
            "Enter a valid payment amount greater than zero.",
          );

          return;
        }

        if (
          !isPhoneValid
        ) {
          setError(
            "Enter a valid Ugandan mobile phone number.",
          );

          return;
        }

        paymentRequestInProgressRef.current =
          true;

        setLoading(true);

        completedRef.current =
          false;

        stopPolling();

        setPollAttempt(0);
        setTransactionId(null);
        setPaymentStatus(
          PAYMENT_STATUS.PENDING,
        );

        try {
          const idempotencyKey =
            globalThis.crypto?.randomUUID
              ? globalThis.crypto.randomUUID()
              : `${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2)}`;

          const payload = {
            provider,
            phoneNumber:
              normalizedPhone,
            amount:
              normalizedAmount,
            currency:
              normalizedCurrency,
            groupId:
              groupId || undefined,
            contributionId:
              contributionId ||
              undefined,
            description:
              "TITech Community Capital mobile money contribution",
            idempotencyKey,
          };

          const response =
            await api.post(
              PAYMENT_INITIATE_ENDPOINT,
              payload,
            );

          if (
            !mountedRef.current
          ) {
            return;
          }

          const txId =
            extractTransactionId(
              response,
            );

          const status =
            extractPaymentStatus(
              response,
            );

          const responsePayload =
            extractPaymentPayload(
              response,
            );

          if (!txId) {
            throw new Error(
              "The payment service did not return a transaction reference.",
            );
          }

          setTransactionId(
            txId,
          );

          setPaymentStatus(
            status,
          );

          setStep(
            PAYMENT_STEPS.PROCESSING,
          );

          toast.info(
            `Payment initiated. Complete the ${providerShortName} prompt on your phone.`,
          );

          // Never treat initiation as final success.
          if (
            SUCCESS_STATUSES.has(
              status,
            )
          ) {
            handlePaymentSuccess(
              responsePayload,
            );

            return;
          }

          if (
            FAILURE_STATUSES.has(
              status,
            )
          ) {
            handlePaymentFailure(
              status,
              responsePayload?.message ||
                "The payment could not be initiated.",
              responsePayload,
            );

            return;
          }

          setTimeout(
            () => {
              if (
                mountedRef.current
              ) {
                pollPaymentStatus(
                  txId,
                );
              }
            },
            500,
          );
        } catch (requestError) {
          if (
            !mountedRef.current
          ) {
            return;
          }

          const errorMessage =
            sanitizeErrorMessage(
              requestError,
            );

          setError(
            errorMessage,
          );

          setPaymentStatus(
            PAYMENT_STATUS.FAILED,
          );

          setStep(
            PAYMENT_STEPS.PHONE,
          );

          toast.error(
            errorMessage,
          );

          onPaymentError?.(
            requestError,
          );
        } finally {
          paymentRequestInProgressRef.current =
            false;

          if (
            mountedRef.current
          ) {
            setLoading(false);
          }
        }
      },
      [
        contributionId,
        disabled,
        groupId,
        handlePaymentFailure,
        handlePaymentSuccess,
        isPhoneValid,
        loading,
        normalizedAmount,
        normalizedCurrency,
        normalizedPhone,
        onPaymentError,
        pollPaymentStatus,
        provider,
        providerShortName,
        stopPolling,
      ],
    );

  // ========================================================================
  // Navigation
  // ========================================================================

  const handleProviderContinue =
    useCallback(() => {
      if (
        disabled ||
        loading
      ) {
        return;
      }

      if (
        !provider ||
        !PROVIDER_METADATA[
          provider
        ]
      ) {
        setError(
          "Please select a payment provider.",
        );

        return;
      }

      setError(null);

      setStep(
        PAYMENT_STEPS.PHONE,
      );
    }, [
      disabled,
      loading,
      provider,
    ]);

  const handleBackToProvider =
    useCallback(() => {
      if (
        loading ||
        disabled
      ) {
        return;
      }

      setError(null);

      setStep(
        PAYMENT_STEPS.PROVIDER,
      );
    }, [
      disabled,
      loading,
    ]);

  // ========================================================================
  // Reset / Retry
  // ========================================================================

  const resetPayment =
    useCallback(() => {
      stopPolling();

      completedRef.current =
        false;

      paymentRequestInProgressRef.current =
        false;

      setStep(
        PAYMENT_STEPS.PROVIDER,
      );

      setProvider(
        initialProvider || "",
      );

      setPhoneNumber(
        initialPhoneNumber || "",
      );

      setLoading(false);
      setTransactionId(null);
      setPaymentStatus(null);
      setError(null);
      setPollAttempt(0);
      setTimedOut(false);
    }, [
      initialPhoneNumber,
      initialProvider,
      stopPolling,
    ]);

  const handleDone =
    useCallback(() => {
      if (
        isSuccessful
      ) {
        onPaymentCancel?.();
        return;
      }

      resetPayment();
    }, [
      isSuccessful,
      onPaymentCancel,
      resetPayment,
    ]);

  // ========================================================================
  // Provider Selection
  // ========================================================================

  const renderProviderStep =
    () => (
      <section
        className="payment-step"
        aria-labelledby={`${providerGroupId}-title`}
      >
        <div className="payment-step-header">
          <div
            className="payment-step-icon"
            aria-hidden="true"
          >
            <Smartphone
              size={22}
              focusable="false"
            />
          </div>

          <div>
            <h2
              id={`${providerGroupId}-title`}
              className="payment-title"
            >
              Select payment provider
            </h2>

            <p className="payment-subtitle">
              Choose the mobile money service
              you want to use.
            </p>
          </div>
        </div>

        <fieldset
          className="provider-grid"
          aria-describedby={`${providerGroupId}-help`}
        >
          <legend className="sr-only">
            Mobile money provider
          </legend>

          {Object.entries(
            PROVIDER_METADATA,
          ).map(
            ([
              providerValue,
              metadata,
            ]) => {
              const selected =
                provider ===
                providerValue;

              return (
                <label
                  key={
                    providerValue
                  }
                  className={`provider-card ${
                    selected
                      ? "selected"
                      : ""
                  }`}
                  data-testid={`${testId}-provider-${providerValue.toLowerCase()}`}
                  data-provider={
                    providerValue
                  }
                >
                  <input
                    type="radio"
                    name={
                      providerGroupId
                    }
                    value={
                      providerValue
                    }
                    checked={
                      selected
                    }
                    onChange={(
                      event,
                    ) => {
                      setProvider(
                        event
                          .target
                          .value,
                      );
                      setError(
                        null,
                      );
                    }}
                    disabled={
                      disabled ||
                      loading
                    }
                    className="provider-radio"
                  />

                  <span className="provider-content">
                    <span
                      className={`provider-logo ${
                        providerValue ===
                        PROVIDERS.MTN_MOMO
                          ? "mtn-logo"
                          : "airtel-logo"
                      }`}
                      aria-hidden="true"
                    >
                      {providerValue ===
                      PROVIDERS.MTN_MOMO
                        ? "MTN"
                        : "AIRTEL"}
                    </span>

                    <span className="provider-info">
                      <span className="provider-name">
                        {
                          metadata.name
                        }
                      </span>

                      <span className="provider-desc">
                        {
                          metadata.description
                        }
                      </span>
                    </span>
                  </span>

                  {selected ? (
                    <CheckCircle2
                      className="provider-selected-icon"
                      size={20}
                      aria-hidden="true"
                      focusable="false"
                    />
                  ) : null}
                </label>
              );
            },
          )}
        </fieldset>

        <p
          id={`${providerGroupId}-help`}
          className="payment-security-note"
        >
          <ShieldCheck
            size={16}
            aria-hidden="true"
            focusable="false"
          />
          Payments are processed through
          your mobile money provider.
        </p>

        {error ? (
          <div
            className="error-message"
            role="alert"
            data-testid={`${testId}-error`}
          >
            <AlertCircle
              size={18}
              aria-hidden="true"
              focusable="false"
            />

            <span>
              {error}
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={
            handleProviderContinue
          }
          disabled={
            disabled ||
            loading ||
            !provider
          }
          className="btn-primary"
          data-testid={`${testId}-continue`}
        >
          Continue
        </button>
      </section>
    );

  // ========================================================================
  // Phone Step
  // ========================================================================

  const renderPhoneStep =
    () => (
      <section
        className="payment-step"
        aria-labelledby={`${phoneInputId}-title`}
      >
        <div className="payment-step-header">
          <div
            className="payment-step-icon"
            aria-hidden="true"
          >
            <Phone
              size={22}
              focusable="false"
            />
          </div>

          <div>
            <h2
              id={`${phoneInputId}-title`}
              className="payment-title"
            >
              Enter phone number
            </h2>

            <p className="payment-subtitle">
              Enter your{" "}
              {providerName} phone
              number.
            </p>
          </div>
        </div>

        <form
          onSubmit={
            handleInitiatePayment
          }
          className="payment-form"
          noValidate
        >
          <div className="form-group">
            <label
              htmlFor={phoneInputId}
              className="form-label"
            >
              <Phone
                className="form-icon"
                size={18}
                aria-hidden="true"
                focusable="false"
              />

              Phone number
            </label>

            <input
              id={phoneInputId}
              name="phoneNumber"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={
                phoneNumber
              }
              onChange={(
                event,
              ) => {
                setPhoneNumber(
                  event.target
                    .value,
                );
                setError(
                  null,
                );
              }}
              placeholder="e.g. 0771 234 567"
              className={`form-input ${
                phoneNumber &&
                !isPhoneValid
                  ? "form-input--invalid"
                  : ""
              }`}
              aria-invalid={
                Boolean(
                  phoneNumber &&
                    !isPhoneValid,
                )
              }
              aria-describedby={`${phoneInputId}-help`}
              disabled={
                disabled ||
                loading
              }
              required
            />

            <small
              id={`${phoneInputId}-help`}
              className="form-help"
            >
              Use a valid Ugandan mobile
              number, for example
              0771 234 567 or
              +256 771 234 567.
            </small>
          </div>

          <div className="form-group">
            <span
              className="form-label"
              aria-hidden="true"
            >
              <DollarSign
                className="form-icon"
                size={18}
                focusable="false"
              />

              Amount
            </span>

            <output
              className="amount-display"
              data-testid={`${testId}-amount`}
              aria-label={`Payment amount ${formattedAmount}`}
            >
              {formattedAmount}
            </output>
          </div>

          {error ? (
            <div
              className="error-message"
              role="alert"
              data-testid={`${testId}-error`}
            >
              <AlertCircle
                size={18}
                aria-hidden="true"
                focusable="false"
              />

              <span>
                {error}
              </span>
            </div>
          ) : null}

          <div className="button-group">
            <button
              type="button"
              onClick={
                handleBackToProvider
              }
              className="btn-secondary"
              disabled={
                disabled ||
                loading
              }
              data-testid={`${testId}-back`}
            >
              Back
            </button>

            <button
              type="submit"
              disabled={
                disabled ||
                loading ||
                !isPhoneValid ||
                normalizedAmount <=
                  0
              }
              className="btn-primary"
              data-testid={`${testId}-pay`}
            >
              {loading ? (
                <>
                  <Loader2
                    size={18}
                    className="button-spinner"
                    aria-hidden="true"
                    focusable="false"
                  />

                  Processing...
                </>
              ) : (
                "Pay now"
              )}
            </button>
          </div>
        </form>
      </section>
    );

  // ========================================================================
  // Processing Step
  // ========================================================================

  const renderProcessingStep =
    () => {
      const isPending =
        paymentStatus ===
          PAYMENT_STATUS.PENDING ||
        paymentStatus ===
          PAYMENT_STATUS.PROCESSING;

      return (
        <section
          className="payment-step"
          aria-labelledby={`${statusRegionId}-title`}
        >
          <div
            className={`processing-container ${
              isSuccessful
                ? "processing-container--success"
                : isFailed ||
                  timedOut
                ? "processing-container--error"
                : ""
            }`}
          >
            <div
              className={`status-icon ${
                paymentStatus
                  ? paymentStatus.toLowerCase()
                  : "pending"
              }`}
              aria-hidden="true"
            >
              {isSuccessful ? (
                <CheckCircle2
                  size={42}
                  focusable="false"
                />
              ) : isFailed ? (
                <XCircle
                  size={42}
                  focusable="false"
                />
              ) : timedOut ? (
                <AlertCircle
                  size={42}
                  focusable="false"
                />
              ) : (
                <Clock3
                  size={42}
                  focusable="false"
                />
              )}
            </div>

            <h2
              id={`${statusRegionId}-title`}
              className="payment-title"
            >
              {isSuccessful
                ? "Payment successful"
                : isFailed
                ? "Payment failed"
                : timedOut
                ? "Payment confirmation delayed"
                : paymentStatus ===
                  PAYMENT_STATUS.PROCESSING
                ? "Completing payment..."
                : "Processing payment..."}
            </h2>

            <p
              className="payment-subtitle"
              aria-live="polite"
            >
              {isSuccessful
                ? `${formattedAmount} has been confirmed successfully.`
                : isFailed
                ? "The payment could not be completed. You can try again."
                : timedOut
                ? REQUEST_TIMEOUT_MESSAGE
                : paymentStatus ===
                  PAYMENT_STATUS.PROCESSING
                ? "Your payment is being processed. Please keep your phone available."
                : `Complete the ${providerShortName} prompt on your phone.`}
            </p>

            {isPending ? (
              <div
                className="loading-spinner"
                role="status"
                aria-label="Waiting for payment confirmation"
              >
                <Loader2
                  size={30}
                  className="payment-spinner"
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  Waiting for confirmation...
                </span>
              </div>
            ) : null}

            {transactionId ? (
              <div
                className="transaction-info"
                data-testid={`${testId}-transaction`}
              >
                <span className="info-label">
                  Transaction reference
                </span>

                <strong
                  className="info-value"
                  title={
                    transactionId
                  }
                >
                  {transactionId}
                </strong>
              </div>
            ) : null}

            {error ? (
              <div
                className="error-message"
                role={
                  timedOut
                    ? "status"
                    : "alert"
                }
                data-testid={`${testId}-error`}
              >
                <AlertCircle
                  size={18}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  {error}
                </span>
              </div>
            ) : null}

            {isSuccessful ? (
              <div
                className="payment-success-summary"
                role="status"
              >
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  Your contribution has
                  been submitted for
                  processing and
                  reconciliation.
                </span>
              </div>
            ) : null}

            <div className="button-group mt-6">
              {isFailed ||
              timedOut ? (
                <button
                  type="button"
                  onClick={
                    resetPayment
                  }
                  className="btn-primary"
                  data-testid={`${testId}-retry`}
                >
                  <RefreshCw
                    size={18}
                    aria-hidden="true"
                    focusable="false"
                  />

                  Try again
                </button>
              ) : null}

              {isSuccessful ? (
                <button
                  type="button"
                  onClick={
                    handleDone
                  }
                  className="btn-primary"
                  data-testid={`${testId}-done`}
                >
                  Done
                </button>
              ) : null}
            </div>

            {isPending ? (
              <p className="payment-processing-help">
                <ShieldCheck
                  size={16}
                  aria-hidden="true"
                  focusable="false"
                />

                Do not initiate another payment
                while this transaction is being
                confirmed.
              </p>
            ) : null}
          </div>
        </section>
      );
    };

  // ========================================================================
  // Root Classes
  // ========================================================================

  const rootClassName = [
    "mobile-money-payment",
    disabled
      ? "mobile-money-payment--disabled"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div
      className={rootClassName}
      data-testid={testId}
      data-component="titech-mobile-money-payment"
      data-step={step}
      data-provider={
        provider || undefined
      }
      data-status={
        paymentStatus ||
        undefined
      }
      aria-disabled={
        disabled ||
        undefined
      }
    >
      <div
        className="payment-header"
        data-testid={`${testId}-header`}
      >
        <div className="payment-brand-mark">
          <Smartphone
            size={20}
            aria-hidden="true"
            focusable="false"
          />
        </div>

        <div>
          <span className="payment-brand">
            TITech Community Capital
          </span>

          <span className="payment-brand-subtitle">
            Secure mobile money payment
          </span>
        </div>
      </div>

      <div
        className="payment-progress"
        aria-label="Payment progress"
      >
        {[
          {
            key:
              PAYMENT_STEPS.PROVIDER,
            label:
              "Provider",
          },
          {
            key:
              PAYMENT_STEPS.PHONE,
            label:
              "Phone",
          },
          {
            key:
              PAYMENT_STEPS.PROCESSING,
            label:
              "Confirmation",
          },
        ].map(
          (
            item,
            index,
          ) => {
            const stepOrder = [
              PAYMENT_STEPS.PROVIDER,
              PAYMENT_STEPS.PHONE,
              PAYMENT_STEPS.PROCESSING,
              PAYMENT_STEPS.COMPLETE,
            ];

            const currentIndex =
              stepOrder.indexOf(
                step,
              );

            const itemIndex =
              stepOrder.indexOf(
                item.key,
              );

            const active =
              item.key ===
              step;

            const completed =
              itemIndex <
              currentIndex;

            return (
              <React.Fragment
                key={item.key}
              >
                <div
                  className={`payment-progress-item ${
                    active
                      ? "active"
                      : ""
                  } ${
                    completed
                      ? "completed"
                      : ""
                  }`}
                  aria-current={
                    active
                      ? "step"
                      : undefined
                  }
                >
                  <span className="payment-progress-number">
                    {completed ? (
                      <CheckCircle2
                        size={14}
                        aria-hidden="true"
                        focusable="false"
                      />
                    ) : (
                      index + 1
                    )}
                  </span>

                  <span className="payment-progress-label">
                    {item.label}
                  </span>
                </div>

                {index < 2 ? (
                  <span
                    className={`payment-progress-line ${
                      completed
                        ? "completed"
                        : ""
                    }`}
                    aria-hidden="true"
                  />
                ) : null}
              </React.Fragment>
            );
          },
        )}
      </div>

      <div
        id={statusRegionId}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {paymentStatus
          ? `Payment status: ${paymentStatus.toLowerCase()}.`
          : ""}
      </div>

      {step ===
        PAYMENT_STEPS.PROVIDER &&
        renderProviderStep()}

      {step ===
        PAYMENT_STEPS.PHONE &&
        renderPhoneStep()}

      {(step ===
        PAYMENT_STEPS.PROCESSING ||
        step ===
          PAYMENT_STEPS.COMPLETE) &&
        renderProcessingStep()}
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

MobileMoneyPayment.propTypes = {
  amount: PropTypes.oneOfType([
    PropTypes.number,
    PropTypes.string,
  ]),

  currency: PropTypes.string,

  groupId: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.number,
  ]),

  contributionId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  onPaymentSuccess:
    PropTypes.func,

  onPaymentCancel:
    PropTypes.func,

  onPaymentError:
    PropTypes.func,

  onPaymentTimeout:
    PropTypes.func,

  locale:
    PropTypes.string,

  initialProvider:
    PropTypes.oneOf([
      "",
      ...Object.values(
        PROVIDERS,
      ),
    ]),

  initialPhoneNumber:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  testId:
    PropTypes.string,

  className:
    PropTypes.string,
};

// ============================================================================
// Static Constants
// ============================================================================

MobileMoneyPayment.PROVIDERS =
  PROVIDERS;

MobileMoneyPayment.PAYMENT_STATUS =
  PAYMENT_STATUS;

MobileMoneyPayment.PAYMENT_STEPS =
  PAYMENT_STEPS;

// ============================================================================
// Static Utilities
// ============================================================================

MobileMoneyPayment.normalizePhoneNumber =
  normalizePhoneNumber;

MobileMoneyPayment.validatePhoneNumber =
  validatePhoneNumber;

MobileMoneyPayment.formatAmount =
  formatAmount;

MobileMoneyPayment.displayName =
  "TITechMobileMoneyPayment";

// ============================================================================
// Export
// ============================================================================

export default memo(
  MobileMoneyPayment,
);