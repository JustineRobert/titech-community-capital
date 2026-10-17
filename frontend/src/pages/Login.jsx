/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Login Page
 * File: frontend/src/pages/Login.jsx
 *
 * Production Grade
 * ----------------------------------------------------------------------------
 * Responsibilities
 * - Secure and accessible user authentication
 * - Form validation and normalization
 * - Remembered email preference
 * - Temporary client-side brute-force protection
 * - Resilient authentication error handling
 * - Loading/submission state management
 * - Password visibility control
 * - WCAG-oriented accessible form semantics
 * - Safe navigation after successful authentication
 * - Avoid exposing sensitive authentication details
 * - TITech terminology consistency
 *
 * Security Note
 * ----------------------------------------------------------------------------
 * Client-side attempt tracking is only a UX safeguard. It must NOT be treated
 * as the authoritative authentication rate limiter. The backend must enforce
 * account/IP/device/risk-based rate limiting independently.
 * ============================================================================
 */

"use strict";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";

import {
  Formik,
  Form,
  Field,
} from "formik";

import * as Yup from "yup";

import {
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import {
  API_CONNECTIVITY_STATUS,
  probeApiReadiness,
} from "../services/api.js";

import "./Login.css";
import BrandLogo from "../components/BrandLogo";
import LanguageSelector from "../i18n/LanguageSelector";
import { useI18n } from "../i18n/I18nProvider";

/* ============================================================================
 * Constants
 * ========================================================================== */

const STORAGE_KEYS = Object.freeze({
  SAVED_EMAIL: "savedEmail",
  REMEMBER_ME: "rememberMe",
  LOGIN_ATTEMPTS: "loginAttempts",
  LOGIN_LOCKOUT: "loginLockout",
});

const SECURITY = Object.freeze({
  MAX_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000,
});

const ROUTES = Object.freeze({
  DASHBOARD: "/dashboard",
  REGISTER: "/register",
  FORGOT_PASSWORD: "/forgot-password",
  TERMS: "/terms",
  PRIVACY: "/privacy",
});

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 128;

/* ============================================================================
 * Validation
 * ========================================================================== */

const createLoginSchema = (t) => Yup.object({
  email: Yup.string()
    .trim()
    .email(t('auth.login.validation.emailFormat'))
    .required(t('auth.login.validation.emailRequired'))
    .max(EMAIL_MAX_LENGTH, t('auth.login.validation.emailTooLong'))
    .matches(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      t('auth.login.validation.emailFormat'),
    ),

  password: Yup.string()
    .required(t('auth.login.validation.passwordRequired'))
    .min(8, t('auth.login.validation.passwordMin', { min: 8 }))
    .max(PASSWORD_MAX_LENGTH, t('auth.login.validation.passwordTooLong')),
});

/* ============================================================================
 * Storage Helpers
 * ========================================================================== */

/**
 * Browser storage can be unavailable in privacy-restricted environments.
 * These helpers deliberately fail closed and never interrupt authentication.
 */

function readStorage(key) {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return false;
  }

  try {
    window.localStorage.setItem(
      key,
      value,
    );

    return true;
  } catch {
    return false;
  }
}

function removeStorage(key) {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return false;
  }

  try {
    window.localStorage.removeItem(key);

    return true;
  } catch {
    return false;
  }
}

/* ============================================================================
 * Authentication Helpers
 * ========================================================================== */

function getSavedEmail() {
  const savedEmail = readStorage(
    STORAGE_KEYS.SAVED_EMAIL,
  );

  if (
    !savedEmail ||
    !Yup.string()
      .email()
      .isValidSync(savedEmail)
  ) {
    return "";
  }

  return savedEmail.trim().toLowerCase();
}

function getRememberMeStatus() {
  return (
    readStorage(
      STORAGE_KEYS.REMEMBER_ME,
    ) === "true"
  );
}

function getPersistedAttemptCount() {
  const raw = readStorage(
    STORAGE_KEYS.LOGIN_ATTEMPTS,
  );

  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(
    raw,
    10,
  );

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return 0;
  }

  return Math.min(
    parsed,
    SECURITY.MAX_ATTEMPTS,
  );
}

function getPersistedLockout() {
  const raw = readStorage(
    STORAGE_KEYS.LOGIN_LOCKOUT,
  );

  if (!raw) {
    return null;
  }

  const timestamp = Date.parse(raw);

  if (!Number.isFinite(timestamp)) {
    removeStorage(
      STORAGE_KEYS.LOGIN_LOCKOUT,
    );

    return null;
  }

  if (timestamp <= Date.now()) {
    removeStorage(
      STORAGE_KEYS.LOGIN_LOCKOUT,
    );

    removeStorage(
      STORAGE_KEYS.LOGIN_ATTEMPTS,
    );

    return null;
  }

  return new Date(timestamp);
}

function clearLoginSecurityState() {
  removeStorage(
    STORAGE_KEYS.LOGIN_ATTEMPTS,
  );

  removeStorage(
    STORAGE_KEYS.LOGIN_LOCKOUT,
  );
}

function persistLoginSecurityState(
  attemptCount,
  lockoutTime = null,
) {
  writeStorage(
    STORAGE_KEYS.LOGIN_ATTEMPTS,
    String(attemptCount),
  );

  if (lockoutTime) {
    writeStorage(
      STORAGE_KEYS.LOGIN_LOCKOUT,
      lockoutTime.toISOString(),
    );
  } else {
    removeStorage(
      STORAGE_KEYS.LOGIN_LOCKOUT,
    );
  }
}

/* ============================================================================
 * Error Helpers
 * ========================================================================== */

function isCredentialFailure(error) {
  return error?.authCategory === "AUTH_INVALID_CREDENTIALS" ||
    error?.response?.status === 401;
}

function getSafeLoginErrorMessage(error, t) {
  const status = error?.response?.status ?? error?.status ?? null;

  if (error?.authCategory === 'AUTH_INVALID_CREDENTIALS' || status === 401) {
    return t('auth.login.errors.invalidCredentials');
  }
  if (status === 429) return t('auth.login.errors.rateLimit');
  if (status === 403) return t('auth.login.errors.accessDenied');
  if (typeof status === 'number' && status >= 500) {
    return t('auth.login.errors.serviceUnavailable');
  }
  if (!error?.response) return t('auth.login.errors.connection');
  return t('auth.login.errors.generic');
}

/* ============================================================================
 * Component
 * ========================================================================== */

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const { login, apiConnectivity } = useAuth();
  const { t } = useI18n();
  const loginSchema = useMemo(() => createLoginSchema(t), [t]);

  const mountedRef = useRef(false);

  const [loading, setLoading] =
    useState(false);

  const [showPassword, setShowPassword] =
    useState(false);

  const [attemptCount, setAttemptCount] =
    useState(0);

  const [lockoutTime, setLockoutTime] =
    useState(null);

  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] =
    useState(0);

  /* ==========================================================================
   * Initial Security State
   * ======================================================================== */

  useEffect(() => {
    mountedRef.current = true;

    const persistedLockout =
      getPersistedLockout();

    const persistedAttempts =
      getPersistedAttemptCount();

    setAttemptCount(
      persistedLockout
        ? persistedAttempts
        : 0,
    );

    setLockoutTime(
      persistedLockout,
    );

    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ==========================================================================
   * Lockout Countdown
   * ======================================================================== */

  useEffect(() => {
    if (!lockoutTime) {
      setLockoutRemainingSeconds(0);
      return undefined;
    }

    const updateRemaining = () => {
      const remainingMs =
        lockoutTime.getTime() -
        Date.now();

      if (remainingMs <= 0) {
        setLockoutTime(null);
        setLockoutRemainingSeconds(0);
        setAttemptCount(0);

        clearLoginSecurityState();

        return;
      }

      setLockoutRemainingSeconds(
        Math.ceil(
          remainingMs / 1000,
        ),
      );
    };

    updateRemaining();

    const interval = window.setInterval(
      updateRemaining,
      1000,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [lockoutTime]);

  /* ==========================================================================
   * Lockout State
   * ======================================================================== */

  const isLockedOut = useMemo(
    () =>
      Boolean(
        lockoutTime &&
          lockoutTime.getTime() >
            Date.now(),
      ),
    [lockoutTime, lockoutRemainingSeconds],
  );

  const lockoutMinutes = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(
          lockoutRemainingSeconds /
            60,
        ),
      ),
    [lockoutRemainingSeconds],
  );

  /* ==========================================================================
   * Redirect Destination
   * ======================================================================== */

  const redirectPath = useMemo(() => {
    const stateFromLocation =
      location?.state;

    const requestedPath =
      stateFromLocation?.from?.pathname;

    /*
     * Only accept local application paths.
     * This prevents open-redirect behavior through login state.
     */
    if (
      typeof requestedPath === "string" &&
      requestedPath.startsWith("/") &&
      !requestedPath.startsWith("//")
    ) {
      return requestedPath;
    }

    return ROUTES.DASHBOARD;
  }, [location]);

  /* ==========================================================================
   * Remember-Me Preferences
   * ======================================================================== */

  const persistRememberPreference =
    useCallback((values) => {
      const normalizedEmail =
        String(values?.email || "")
          .trim()
          .toLowerCase();

      if (values?.remember) {
        writeStorage(
          STORAGE_KEYS.SAVED_EMAIL,
          normalizedEmail,
        );

        writeStorage(
          STORAGE_KEYS.REMEMBER_ME,
          "true",
        );

        return;
      }

      removeStorage(
        STORAGE_KEYS.SAVED_EMAIL,
      );

      removeStorage(
        STORAGE_KEYS.REMEMBER_ME,
      );
    }, []);

  const serviceState = apiConnectivity?.status || API_CONNECTIVITY_STATUS.CHECKING;
  const serviceUnavailable =
    serviceState === API_CONNECTIVITY_STATUS.API_UNAVAILABLE ||
    serviceState === API_CONNECTIVITY_STATUS.OFFLINE;
  const serviceTimedOut = serviceState === API_CONNECTIVITY_STATUS.REQUEST_TIMEOUT;
  const serviceServerError = serviceState === API_CONNECTIVITY_STATUS.HTTP_SERVER_ERROR;
  const serviceEndpointError = serviceState === API_CONNECTIVITY_STATUS.API_ENDPOINT_ERROR;
  const serviceHttpError = serviceState === API_CONNECTIVITY_STATUS.API_HTTP_ERROR;
  const serviceCancelled = serviceState === API_CONNECTIVITY_STATUS.REQUEST_CANCELLED;
  const serviceDegraded =
    serviceState === API_CONNECTIVITY_STATUS.API_DEGRADED ||
    serviceState === API_CONNECTIVITY_STATUS.API_REACHABLE ||
    serviceEndpointError ||
    serviceHttpError;
  const serviceNeedsRetry = serviceUnavailable || serviceTimedOut || serviceServerError || serviceCancelled;

  const handleServiceRetry = useCallback(async () => {
    try {
      await probeApiReadiness({ force: true });
    } catch {
      // The connectivity state machine owns the classified failure state.
    }
  }, []);

  /* ==========================================================================
   * Login Handler
   * ======================================================================== */

  const handleLogin = useCallback(
    async (
      values,
      { setSubmitting },
    ) => {
      if (isLockedOut) {
        toast.error(
          t('auth.login.errors.lockout', { minutes: lockoutMinutes }),
          {
            autoClose: 5000,
          },
        );

        setSubmitting(false);
        return;
      }

      if (loading) {
        setSubmitting(false);
        return;
      }

      const email = String(
        values?.email || "",
      )
        .trim()
        .toLowerCase();

      const password = String(
        values?.password || "",
      );

      setLoading(true);

      try {
        // Fail closed at the point credentials would be submitted. A stale
        // UI status is not sufficient evidence that the authentication API is
        // ready now; the shared readiness probe is single-flight/cancellable.
        const readiness = await probeApiReadiness({ force: true });
        if (!readiness?.ready) {
          toast.error(
            readiness?.status === API_CONNECTIVITY_STATUS.REQUEST_TIMEOUT
              ? t('auth.login.errors.serviceTimeout')
              : readiness?.status === API_CONNECTIVITY_STATUS.HTTP_SERVER_ERROR
                ? t('auth.login.errors.serverError')
                : readiness?.status === API_CONNECTIVITY_STATUS.API_ENDPOINT_ERROR
                  ? t('auth.login.errors.endpointMissing')
                  : readiness?.status === API_CONNECTIVITY_STATUS.API_HTTP_ERROR
                    ? t('auth.login.errors.readinessDenied')
                    : t('auth.login.errors.connection'),
            { autoClose: 6000 },
          );
          return;
        }

        const authenticatedUser =
          await login(
            email,
            password,
          );

        if (!mountedRef.current) {
          return;
        }

        clearLoginSecurityState();

        setAttemptCount(0);
        setLockoutTime(null);

        persistRememberPreference({
          ...values,
          email,
        });

        if (!authenticatedUser) {
          toast.error(
            t('auth.login.errors.generic'),
            {
              autoClose: 4000,
            },
          );

          return;
        }

        toast.success(
          t('auth.login.errors.welcome'),
          {
            autoClose: 3000,
          },
        );

        navigate(
          redirectPath,
          {
            replace: true,
          },
        );
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        const credentialFailure = isCredentialFailure(error);

        // Only authoritative credential failures consume the client-side
        // attempt budget. Network/readiness/server failures must never lock a
        // legitimate user out while the TITech API is unavailable.
        if (credentialFailure) {
          const nextAttemptCount = Math.min(
            attemptCount + 1,
            SECURITY.MAX_ATTEMPTS,
          );

          setAttemptCount(nextAttemptCount);

          if (nextAttemptCount >= SECURITY.MAX_ATTEMPTS) {
            const nextLockout = new Date(
              Date.now() + SECURITY.LOCKOUT_DURATION_MS,
            );

            setLockoutTime(nextLockout);
            persistLoginSecurityState(nextAttemptCount, nextLockout);

            toast.error(
              t('auth.login.errors.lockout', { minutes: 15 }),
              { autoClose: 5000 },
            );
          } else {
            persistLoginSecurityState(nextAttemptCount);
            toast.error(getSafeLoginErrorMessage(error, t), { autoClose: 4000 });
          }
        } else {
          toast.error(getSafeLoginErrorMessage(error, t), { autoClose: 5000 });
        }

        /*
         * Log only non-sensitive operational metadata.
         * Never log passwords, tokens, cookies, or complete credentials.
         */
        if (
          typeof console !== "undefined" &&
          typeof console.warn === "function"
        ) {
          console.warn(
            "TITech login attempt failed.",
            {
              status:
                error?.response?.status ||
                null,
              category:
                error?.authCategory ||
                null,
              attempt:
                credentialFailure ? Math.min(attemptCount + 1, SECURITY.MAX_ATTEMPTS) : null,
            },
          );
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setSubmitting(false);
        }
      }
    },
    [
      attemptCount,
      isLockedOut,
      loading,
      lockoutMinutes,
      login,
      navigate,
      persistRememberPreference,
      redirectPath,
      t,
    ],
  );

  /* ==========================================================================
   * Initial Form Values
   * ======================================================================== */

  const initialValues = useMemo(
    () => ({
      email: getSavedEmail(),
      password: "",
      remember: getRememberMeStatus(),
    }),
    [],
  );

  /* ==========================================================================
   * Render
   * ======================================================================== */

  return (
    <main
      className="login-page"
      aria-labelledby="login-heading"
    >
      <div className="titech-auth-language-control">
        <LanguageSelector />
      </div>
      <div className="login-wrapper">
        {/* ==================================================================
         * Brand Panel
         * ================================================================== */}

        <section
          className="login-brand"
          aria-labelledby="brand-title"
        >
          <div className="brand-content">
            <div
              className="brand-mark brand-mark--official"
            >
              <BrandLogo
                variant="transparent"
                size="lg"
                alt="TITech Community Capital"
                loading="eager"
                fetchPriority="high"
              />
            </div>

            <p className="brand-eyebrow">
              TITech Community Capital
            </p>

            <h1
              id="brand-title"
              className="brand-title"
            >
              {t("auth.login.tagline")}
            </h1>

            <p className="brand-subtitle">
              {t("auth.login.subtitle")}
            </p>

            <div
              className="brand-features"
              role="list"
              aria-label={t("auth.login.featuresLabel")}
            >
              <div
                className="feature"
                role="listitem"
              >
                <div
                  className="feature-icon"
                  aria-hidden="true"
                >
                  <ShieldCheck
                    size={22}
                  />
                </div>

                <div>
                  <strong>
                    Build Community Finance
                  </strong>

                  <p>
                    Trusted digital infrastructure for groups, institutions and
                    community financial activity.
                  </p>
                </div>
              </div>

              <div
                className="feature"
                role="listitem"
              >
                <div
                  className="feature-icon"
                  aria-hidden="true"
                >
                  <CheckCircle2
                    size={22}
                  />
                </div>

                <div>
                  <strong>
                    Connect Digital Inclusion
                  </strong>

                  <p>
                    Financial services designed to bring more communities into
                    the formal financial economy.
                  </p>
                </div>
              </div>

              <div
                className="feature"
                role="listitem"
              >
                <div
                  className="feature-icon"
                  aria-hidden="true"
                >
                  <Lock
                    size={22}
                  />
                </div>

                <div>
                  <strong>
                    Enable Capital Access
                  </strong>

                  <p>
                    Trusted records, payments, reconciliation and pathways to
                    responsible financial capital.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ==================================================================
         * Authentication Panel
         * ================================================================== */}

        <section className="login-container">
          <div className="login-card">
            <header className="login-card-header">
              <p className="login-eyebrow">
                TITech Community Capital
              </p>

              <h2
                id="login-heading"
                className="login-heading"
              >
                Welcome Back
              </h2>

              <p className="login-subtitle">
                Enter your credentials to
                securely access your account.
              </p>
            </header>

            {/* ==============================================================
             * Lockout Notice
             * ============================================================ */}

            {isLockedOut && (
              <div
                className="lockout-warning"
                role="alert"
                aria-live="assertive"
              >
                <AlertCircle
                  size={20}
                  aria-hidden="true"
                />

                <div>
                  <strong>
                    Temporary sign-in protection
                  </strong>

                  <span>
                    Too many unsuccessful
                    attempts. Please try again
                    in{" "}
                    {lockoutMinutes}{" "}
                    minute(s).
                  </span>
                </div>
              </div>
            )}

            {/* ==============================================================
             * Attempt Warning
             * ============================================================ */}

            {!isLockedOut &&
              attemptCount > 2 &&
              attemptCount <
                SECURITY.MAX_ATTEMPTS && (
                <div
                  className="attempt-warning"
                  role="status"
                  aria-live="polite"
                >
                  <Info
                    size={18}
                    aria-hidden="true"
                  />

                  <span>
                    {SECURITY.MAX_ATTEMPTS -
                      attemptCount}{" "}
                    sign-in attempt(s)
                    remaining before temporary
                    protection is activated.
                  </span>
                </div>
              )}

            <div
              className={`login-service-status login-service-status--${
                serviceUnavailable || serviceTimedOut || serviceServerError
                  ? "unavailable"
                  : serviceDegraded || serviceCancelled
                    ? "degraded"
                    : serviceState === API_CONNECTIVITY_STATUS.READY
                      ? "ready"
                      : "checking"
              }`}
              role={serviceUnavailable || serviceTimedOut || serviceServerError || serviceEndpointError || serviceHttpError ? "alert" : "status"}
              aria-live="polite"
            >
              <span className="login-service-status__dot" aria-hidden="true" />
              <div className="login-service-status__content">
                <strong>
                  {serviceTimedOut
                    ? t('auth.login.status.timeoutTitle')
                    : serviceServerError
                      ? t('auth.login.status.serverErrorTitle')
                      : serviceEndpointError
                        ? t('auth.login.status.endpointMissingTitle')
                        : serviceHttpError
                          ? t('auth.login.status.httpErrorTitle')
                          : serviceCancelled
                            ? t('auth.login.status.cancelledTitle')
                            : serviceUnavailable
                              ? t('auth.login.status.unavailableTitle')
                              : serviceDegraded
                                ? t('auth.login.status.degradedTitle')
                                : serviceState === API_CONNECTIVITY_STATUS.READY
                                  ? t('auth.login.status.readyTitle')
                                  : t('auth.login.status.checkingTitle')}
                </strong>
                <span>
                  {serviceTimedOut
                    ? t('auth.login.status.timeoutDetails')
                    : serviceServerError
                      ? t('auth.login.status.serverErrorDetails')
                      : serviceEndpointError
                        ? t('auth.login.status.endpointMissingDetails')
                        : serviceHttpError
                          ? t('auth.login.status.httpErrorDetails', { status: apiConnectivity?.lastHttpStatus || '4xx' })
                          : serviceCancelled
                            ? t('auth.login.status.cancelledDetails')
                            : serviceUnavailable
                              ? t('auth.login.status.unavailableDetails')
                              : serviceDegraded
                                ? t('auth.login.status.degradedDetails')
                                : serviceState === API_CONNECTIVITY_STATUS.READY
                                  ? t('auth.login.status.readyDetails')
                                  : t('auth.login.status.checkingDetails')}
                </span>
                {serviceNeedsRetry && (
                  <button
                    type="button"
                    className="login-service-status__retry"
                    onClick={handleServiceRetry}
                    disabled={loading}
                  >
                    {t('auth.login.errors.retryServiceCheck')}
                  </button>
                )}
              </div>
            </div>

            <Formik
              initialValues={
                initialValues
              }
              validationSchema={
                loginSchema
              }
              onSubmit={
                handleLogin
              }
              validateOnChange
              validateOnBlur
            >
              {({
                errors,
                touched,
                isSubmitting,
                isValid,
              }) => {
                const formDisabled =
                  loading ||
                  isSubmitting ||
                  isLockedOut;

                return (
                  <Form
                    className="login-form"
                    noValidate
                    aria-busy={
                      formDisabled
                    }
                  >
                    {/* ========================================================
                     * Email
                     * ====================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor="email"
                        className="form-label"
                      >
                        <Mail
                          className="form-icon"
                          size={17}
                          aria-hidden="true"
                        />

                        <span>
                          {t("auth.login.emailLabel")}
                        </span>
                      </label>

                      <Field
                        id="email"
                        name="email"
                        type="email"
                        inputMode="email"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                        placeholder="you@example.com"
                        autoComplete="username"
                        maxLength={
                          EMAIL_MAX_LENGTH
                        }
                        disabled={
                          formDisabled
                        }
                        className={`form-input${
                          touched.email &&
                          errors.email
                            ? " has-error"
                            : ""
                        }`}
                        aria-invalid={
                          Boolean(
                            touched.email &&
                              errors.email,
                          )
                        }
                        aria-describedby={
                          touched.email &&
                          errors.email
                            ? "email-error"
                            : undefined
                        }
                      />

                      {touched.email &&
                        errors.email && (
                          <div
                            id="email-error"
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {
                                errors.email
                              }
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                     * Password
                     * ====================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor="password"
                        className="form-label"
                      >
                        <Lock
                          className="form-icon"
                          size={17}
                          aria-hidden="true"
                        />

                        <span>
                          {t("auth.login.passwordLabel")}
                        </span>
                      </label>

                      <div className="password-input-wrapper">
                        <Field
                          id="password"
                          name="password"
                          type={
                            showPassword
                              ? "text"
                              : "password"
                          }
                          placeholder={t("auth.login.passwordPlaceholder")}
                          autoComplete="current-password"
                          maxLength={
                            PASSWORD_MAX_LENGTH
                          }
                          disabled={
                            formDisabled
                          }
                          className={`form-input${
                            touched.password &&
                            errors.password
                              ? " has-error"
                              : ""
                          }`}
                          aria-invalid={
                            Boolean(
                              touched.password &&
                                errors.password,
                            )
                          }
                          aria-describedby={
                            touched.password &&
                            errors.password
                              ? "password-error"
                              : undefined
                          }
                        />

                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() =>
                            setShowPassword(
                              (current) =>
                                !current,
                            )
                          }
                          disabled={
                            formDisabled
                          }
                          aria-label={
                            showPassword
                              ? "Hide password"
                              : "Show password"
                          }
                          aria-pressed={
                            showPassword
                          }
                        >
                          {showPassword ? (
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
                      </div>

                      {touched.password &&
                        errors.password && (
                          <div
                            id="password-error"
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {
                                errors.password
                              }
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                     * Form Options
                     * ====================================================== */}

                    <div className="form-options">
                      <label className="remember-checkbox">
                        <Field
                          type="checkbox"
                          name="remember"
                          disabled={
                            formDisabled
                          }
                        />

                        <span>
                          {t("auth.login.rememberEmail")}
                        </span>
                      </label>

                      <Link
                        to={
                          ROUTES.FORGOT_PASSWORD
                        }
                        className="forgot-link"
                        tabIndex={
                          formDisabled
                            ? -1
                            : 0
                        }
                      >
                        {t("auth.login.forgotPassword")}
                      </Link>
                    </div>

                    {/* ========================================================
                     * Submit
                     * ====================================================== */}

                    <button
                      type="submit"
                      className="submit-btn"
                      disabled={
                        formDisabled ||
                        !isValid
                      }
                      aria-busy={
                        loading ||
                        isSubmitting
                      }
                    >
                      {loading ||
                      isSubmitting ? (
                        <span className="btn-loading">
                          <span
                            className="spinner"
                            aria-hidden="true"
                          />

                          <span>
                            {t("auth.login.submitting")}
                          </span>
                        </span>
                      ) : (
                        <>
                          <Lock
                            size={18}
                            aria-hidden="true"
                          />

                          <span>
                            {t("auth.login.submit")}
                          </span>
                        </>
                      )}
                    </button>

                    {/* ========================================================
                     * Registration
                     * ====================================================== */}

                    <p className="signup-link">
                      {t("auth.login.noAccount")}{" "}
                      <Link
                        to={
                          ROUTES.REGISTER
                        }
                        className="link-highlight"
                      >
                        {t("auth.login.createAccount")}
                      </Link>
                    </p>
                  </Form>
                );
              }}
            </Formik>
          </div>

          {/* ==================================================================
           * Legal Footer
           * ================================================================== */}

          <p className="login-footer">
            By signing in, you agree to
            TITech Community Capital's{" "}
            <Link
              to={ROUTES.TERMS}
              className="footer-link"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              to={ROUTES.PRIVACY}
              className="footer-link"
            >
              Privacy Policy
            </Link>
            .
          </p>

          <p
            className="login-security-note"
            role="note"
          >
            <ShieldCheck
              size={15}
              aria-hidden="true"
            />

            <span>
              Your credentials are protected
              by TITech's authentication and
              security controls.
            </span>
          </p>
        </section>
      </div>
    </main>
  );
}