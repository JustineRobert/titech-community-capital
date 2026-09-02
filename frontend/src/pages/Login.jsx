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

import "./Login.css";

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

const DEFAULT_ERROR_MESSAGE =
  "Unable to sign in. Please check your credentials and try again.";

const AUTHENTICATION_ERROR_MESSAGE =
  "Invalid email or password.";

const LOCKOUT_MESSAGE =
  "Too many unsuccessful attempts. Please try again later.";

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 128;

/* ============================================================================
 * Validation
 * ========================================================================== */

const LoginSchema = Yup.object({
  email: Yup.string()
    .trim()
    .email("Please enter a valid email address.")
    .required("Email address is required.")
    .max(
      EMAIL_MAX_LENGTH,
      "Email address is too long.",
    )
    .matches(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      "Please enter a valid email address.",
    ),

  password: Yup.string()
    .required("Password is required.")
    .min(
      8,
      "Password must be at least 8 characters.",
    )
    .max(
      PASSWORD_MAX_LENGTH,
      "Password is too long.",
    ),
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

function isAuthenticationError(error) {
  return (
    error?.response?.status === 401 ||
    error?.response?.status === 403
  );
}

function getSafeLoginErrorMessage(error) {
  if (isAuthenticationError(error)) {
    return AUTHENTICATION_ERROR_MESSAGE;
  }

  /*
   * Prefer a controlled backend message only when it is clearly intended for
   * end users. Do not expose stack traces, database errors, or infrastructure
   * details from arbitrary error objects.
   */
  const serverMessage =
    error?.response?.data?.message;

  if (
    typeof serverMessage === "string" &&
    serverMessage.trim().length > 0 &&
    serverMessage.length <= 300
  ) {
    return serverMessage.trim();
  }

  return DEFAULT_ERROR_MESSAGE;
}

/* ============================================================================
 * Component
 * ========================================================================== */

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const { login } = useAuth();

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
          `${LOCKOUT_MESSAGE} Try again in ${lockoutMinutes} minute(s).`,
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
            DEFAULT_ERROR_MESSAGE,
            {
              autoClose: 4000,
            },
          );

          return;
        }

        toast.success(
          "Welcome back to TITech Community Capital.",
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

        const nextAttemptCount =
          Math.min(
            attemptCount + 1,
            SECURITY.MAX_ATTEMPTS,
          );

        setAttemptCount(
          nextAttemptCount,
        );

        if (
          nextAttemptCount >=
          SECURITY.MAX_ATTEMPTS
        ) {
          const nextLockout =
            new Date(
              Date.now() +
                SECURITY.LOCKOUT_DURATION_MS,
            );

          setLockoutTime(
            nextLockout,
          );

          persistLoginSecurityState(
            nextAttemptCount,
            nextLockout,
          );

          toast.error(
            "Too many unsuccessful attempts. Please try again in 15 minutes.",
            {
              autoClose: 5000,
            },
          );
        } else {
          persistLoginSecurityState(
            nextAttemptCount,
          );

          toast.error(
            getSafeLoginErrorMessage(
              error,
            ),
            {
              autoClose: 4000,
            },
          );
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
              attempt:
                nextAttemptCount,
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
              className="brand-mark"
              aria-hidden="true"
            >
              <ShieldCheck
                size={30}
              />
            </div>

            <p className="brand-eyebrow">
              TITech Community Capital
            </p>

            <h1
              id="brand-title"
              className="brand-title"
            >
              Grow Your Wealth Together
            </h1>

            <p className="brand-subtitle">
              Secure, transparent and
              community-driven financial
              services built for
              sustainable growth.
            </p>

            <div
              className="brand-features"
              role="list"
              aria-label="TITech Community Capital benefits"
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
                    Secure Savings
                  </strong>

                  <p>
                    Designed with security
                    and financial
                    accountability in mind.
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
                    Community Driven
                  </strong>

                  <p>
                    Financial tools that
                    help communities grow
                    together.
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
                    Trusted Access
                  </strong>

                  <p>
                    Protected account
                    access for every
                    community member.
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

            <Formik
              initialValues={
                initialValues
              }
              validationSchema={
                LoginSchema
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
                          Email Address
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
                          Password
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
                          placeholder="Enter your password"
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
                          Remember my email
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
                        Forgot password?
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
                            Signing in…
                          </span>
                        </span>
                      ) : (
                        <>
                          <Lock
                            size={18}
                            aria-hidden="true"
                          />

                          <span>
                            Sign In
                          </span>
                        </>
                      )}
                    </button>

                    {/* ========================================================
                     * Registration
                     * ====================================================== */}

                    <p className="signup-link">
                      Don't have an account?{" "}
                      <Link
                        to={
                          ROUTES.REGISTER
                        }
                        className="link-highlight"
                      >
                        Create one now
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