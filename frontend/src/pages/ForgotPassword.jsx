// ============================================================================
// TITech Community Capital
// Enterprise Password Recovery
// File: frontend/src/pages/ForgotPassword.jsx
// Production Grade
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "react-toastify";

import api from "../services/api";
import logger from "../utils/logger";

import "./ForgotPassword.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REDIRECT = "/login";
const DEFAULT_COOLDOWN_SECONDS = 60;

const API_ENDPOINTS = Object.freeze({
  FORGOT_PASSWORD: "/api/auth/forgot-password",
});

const EMAIL_MAX_LENGTH = 254;

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

// Keep server-facing password recovery messages generic.
// This prevents account enumeration.
const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email address, a password reset link has been sent.";

const GENERIC_ERROR_MESSAGE =
  "We could not process your request right now. Please try again.";

const RATE_LIMIT_MESSAGE =
  "Too many password reset requests. Please wait before trying again.";

// ============================================================================
// Utility helpers
// ============================================================================

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);

  if (!email || email.length > EMAIL_MAX_LENGTH) {
    return false;
  }

  return EMAIL_REGEX.test(email);
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED" ||
    error?.code === "ECONNABORTED" ||
    error?.message === "canceled" ||
    error?.message === "aborted"
  );
}

function getHttpStatus(error) {
  return (
    error?.response?.status ??
    error?.status ??
    null
  );
}

function getSafeServerMessage(error) {
  const message =
    error?.response?.data?.message ??
    error?.response?.data?.error ??
    null;

  if (
    typeof message !== "string" ||
    !message.trim()
  ) {
    return null;
  }

  return message.trim();
}

// ============================================================================
// Component
// ============================================================================

export default function ForgotPassword({
  redirectTo = DEFAULT_REDIRECT,
  cooldownSeconds = DEFAULT_COOLDOWN_SECONDS,
}) {
  const navigate = useNavigate();

  // --------------------------------------------------------------------------
  // Component lifecycle
  // --------------------------------------------------------------------------

  const mountedRef = useRef(false);
  const abortControllerRef = useRef(null);
  const cooldownTimerRef = useRef(null);

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");

  // --------------------------------------------------------------------------
  // Derived state
  // --------------------------------------------------------------------------

  const normalizedEmail = useMemo(
    () => normalizeEmail(email),
    [email]
  );

  const emailIsValid = useMemo(
    () => isValidEmail(normalizedEmail),
    [normalizedEmail]
  );

  const cooldownActive = cooldown > 0;

  const submitDisabled =
    submitting ||
    cooldownActive ||
    !emailIsValid;

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {
          // Ignore cleanup failures.
        }

        abortControllerRef.current = null;
      }

      if (cooldownTimerRef.current) {
        window.clearInterval(
          cooldownTimerRef.current
        );

        cooldownTimerRef.current = null;
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // Cooldown management
  // --------------------------------------------------------------------------

  const clearCooldown = useCallback(() => {
    if (cooldownTimerRef.current) {
      window.clearInterval(
        cooldownTimerRef.current
      );

      cooldownTimerRef.current = null;
    }

    if (mountedRef.current) {
      setCooldown(0);
    }
  }, []);

  const startCooldown = useCallback(
    (seconds) => {
      const safeSeconds = Math.max(
        0,
        Math.floor(
          Number(seconds) || 0
        )
      );

      if (cooldownTimerRef.current) {
        window.clearInterval(
          cooldownTimerRef.current
        );

        cooldownTimerRef.current = null;
      }

      if (!mountedRef.current) {
        return;
      }

      setCooldown(safeSeconds);

      if (safeSeconds <= 0) {
        return;
      }

      cooldownTimerRef.current =
        window.setInterval(() => {
          if (!mountedRef.current) {
            clearCooldown();
            return;
          }

          setCooldown((previous) => {
            if (previous <= 1) {
              if (cooldownTimerRef.current) {
                window.clearInterval(
                  cooldownTimerRef.current
                );

                cooldownTimerRef.current = null;
              }

              return 0;
            }

            return previous - 1;
          });
        }, 1000);
    },
    [clearCooldown]
  );

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  const handleNavigateToLogin = useCallback(() => {
    navigate(redirectTo, {
      replace: false,
    });
  }, [navigate, redirectTo]);

  // --------------------------------------------------------------------------
  // Email change
  // --------------------------------------------------------------------------

  const handleEmailChange = useCallback(
    (event) => {
      const value =
        event?.target?.value ?? "";

      setEmail(value);

      if (error) {
        setError("");
      }
    },
    [error]
  );

  // --------------------------------------------------------------------------
  // Password reset request
  // --------------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();

      if (submitting || cooldownActive) {
        return;
      }

      const normalized = normalizeEmail(email);

      setError("");

      if (!isValidEmail(normalized)) {
        setError(
          "Please enter a valid email address."
        );

        return;
      }

      // ----------------------------------------------------------------------
      // Cancel any previous request.
      // ----------------------------------------------------------------------

      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {
          // Ignore cancellation errors.
        }
      }

      const controller =
        new AbortController();

      abortControllerRef.current =
        controller;

      if (mountedRef.current) {
        setSubmitting(true);
      }

      try {
        await api.post(
          API_ENDPOINTS.FORGOT_PASSWORD,
          {
            email: normalized,
          },
          {
            signal: controller.signal,
          }
        );

        if (!mountedRef.current) {
          return;
        }

        // --------------------------------------------------------------------
        // Always show the generic success state regardless of whether the
        // account exists. This prevents user/account enumeration.
        // --------------------------------------------------------------------

        setSubmittedEmail(normalized);
        setSent(true);
        setError("");

        startCooldown(
          cooldownSeconds
        );

        toast.success(
          GENERIC_SUCCESS_MESSAGE
        );

        try {
          logger?.info?.(
            "TITech password recovery request completed",
            {
              emailDomain:
                normalized.split("@")[1] ||
                "unknown",
            }
          );
        } catch {
          // Logging must never break UX.
        }
      } catch (requestError) {
        if (
          isAbortError(requestError) ||
          controller.signal.aborted
        ) {
          return;
        }

        if (!mountedRef.current) {
          return;
        }

        const status =
          getHttpStatus(
            requestError
          );

        // --------------------------------------------------------------------
        // Rate limiting
        // --------------------------------------------------------------------

        if (status === 429) {
          setError(
            RATE_LIMIT_MESSAGE
          );

          startCooldown(
            cooldownSeconds
          );

          toast.warning(
            RATE_LIMIT_MESSAGE
          );
        } else {
          // Do not expose arbitrary backend messages because they may reveal
          // whether an account exists.
          setError(
            GENERIC_ERROR_MESSAGE
          );

          toast.error(
            GENERIC_ERROR_MESSAGE
          );
        }

        // --------------------------------------------------------------------
        // Safe diagnostics
        // --------------------------------------------------------------------

        try {
          logger?.warn?.(
            "TITech password recovery request failed",
            {
              status,
              emailDomain:
                normalized.split("@")[1] ||
                "unknown",
              serverMessage:
                getSafeServerMessage(
                  requestError
                ),
            }
          );
        } catch {
          // Logging failures must never affect application behavior.
        }
      } finally {
        if (
          mountedRef.current &&
          abortControllerRef.current ===
            controller
        ) {
          setSubmitting(false);
          abortControllerRef.current =
            null;
        }
      }
    },
    [
      cooldownActive,
      cooldownSeconds,
      email,
      startCooldown,
      submitting,
    ]
  );

  // --------------------------------------------------------------------------
  // Resend
  // --------------------------------------------------------------------------

  const handleResend = useCallback(
    async (event) => {
      event?.preventDefault?.();

      if (
        submitting ||
        cooldownActive
      ) {
        return;
      }

      await handleSubmit();
    },
    [
      cooldownActive,
      handleSubmit,
      submitting,
    ]
  );

  // --------------------------------------------------------------------------
  // Render: Success
  // --------------------------------------------------------------------------

  const renderSuccessState = () => (
    <div
      className="forgot-password-success"
      role="status"
      aria-live="polite"
    >
      <div
        className="forgot-password-success-icon"
        aria-hidden="true"
      >
        <CheckCircle2 size={34} />
      </div>

      <h2>
        Check your email
      </h2>

      <p>
        If an account exists for{" "}
        <strong>
          {submittedEmail}
        </strong>
        , we sent instructions to reset
        your password.
      </p>

      <p className="forgot-password-muted">
        For your security, TITech does not
        reveal whether an email address is
        registered. Please also check your
        spam or junk folder.
      </p>

      {cooldownActive && (
        <div
          className="forgot-password-cooldown"
          role="timer"
          aria-live="polite"
        >
          <Clock3
            size={17}
            aria-hidden="true"
          />

          <span>
            You can request another email
            in{" "}
            <strong>
              {cooldown}s
            </strong>
            .
          </span>
        </div>
      )}

      <div className="forgot-password-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={
            handleNavigateToLogin
          }
          disabled={submitting}
        >
          <ArrowLeft
            size={17}
            aria-hidden="true"
          />

          Return to login
        </button>

        <button
          type="button"
          className="btn-secondary"
          onClick={handleResend}
          disabled={
            cooldownActive ||
            submitting
          }
          aria-disabled={
            cooldownActive ||
            submitting
          }
        >
          <RefreshCw
            size={17}
            aria-hidden="true"
          />

          {submitting
            ? "Sending..."
            : cooldownActive
              ? `Resend (${cooldown}s)`
              : "Resend email"}
        </button>
      </div>
    </div>
  );

  // --------------------------------------------------------------------------
  // Render: Form
  // --------------------------------------------------------------------------

  const renderForm = () => (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-describedby={
        error
          ? "forgot-password-error"
          : "forgot-password-help"
      }
    >
      <div className="forgot-password-field">
        <label
          htmlFor="forgot-password-email"
        >
          Email address
          <span
            className="required"
            aria-hidden="true"
          >
            *
          </span>
        </label>

        <div className="forgot-password-input-wrapper">
          <Mail
            size={18}
            aria-hidden="true"
          />

          <input
            id="forgot-password-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            maxLength={
              EMAIL_MAX_LENGTH
            }
            value={email}
            onChange={
              handleEmailChange
            }
            placeholder="you@example.com"
            disabled={submitting}
            required
            aria-required="true"
            aria-invalid={
              Boolean(error)
            }
            aria-describedby={
              error
                ? "forgot-password-error"
                : "forgot-password-help"
            }
          />
        </div>

        <p
          id="forgot-password-help"
          className="forgot-password-help"
        >
          Enter the email address associated
          with your TITech Community Capital
          account.
        </p>
      </div>

      {error && (
        <div
          id="forgot-password-error"
          className="forgot-password-error"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle
            size={18}
            aria-hidden="true"
          />

          <span>{error}</span>
        </div>
      )}

      <div className="forgot-password-actions">
        <button
          type="submit"
          className="btn-primary"
          disabled={submitDisabled}
          aria-disabled={
            submitDisabled
          }
        >
          {submitting ? (
            <>
              <RefreshCw
                size={17}
                className="spin"
                aria-hidden="true"
              />

              Sending...
            </>
          ) : (
            <>
              <Mail
                size={17}
                aria-hidden="true"
              />

              Send reset link
            </>
          )}
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={
            handleNavigateToLogin
          }
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );

  // --------------------------------------------------------------------------
  // Main render
  // --------------------------------------------------------------------------

  return (
    <main
      className="forgot-password-page"
      aria-labelledby="forgot-password-heading"
    >
      <section className="forgot-password-card">
        <header className="forgot-password-header">
          <div
            className="forgot-password-brand-icon"
            aria-hidden="true"
          >
            <ShieldCheck size={30} />
          </div>

          <div>
            <p className="forgot-password-eyebrow">
              TITech Community Capital
            </p>

            <h1 id="forgot-password-heading">
              Forgot your password?
            </h1>
          </div>
        </header>

        {!sent && (
          <p className="forgot-password-description">
            No problem. Enter your email
            address below and we'll help you
            securely reset your password.
          </p>
        )}

        {sent
          ? renderSuccessState()
          : renderForm()}

        <footer className="forgot-password-footer">
          <ShieldCheck
            size={15}
            aria-hidden="true"
          />

          <span>
            Your account security and privacy
            are important to TITech.
          </span>
        </footer>
      </section>
    </main>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

ForgotPassword.propTypes = {
  redirectTo: PropTypes.string,
  cooldownSeconds:
    PropTypes.number,
};