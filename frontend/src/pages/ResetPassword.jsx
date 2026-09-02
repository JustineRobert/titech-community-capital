// ============================================================================
// TITech Community Capital
// Enterprise Password Reset Completion
// File: frontend/src/pages/ResetPassword.jsx
//
// Production Grade
// ----------------------------------------------------------------------------
// - Secure reset-token validation
// - Defensive token handling
// - Password policy enforcement
// - Password strength visualization
// - Accessible form states
// - Formik + Yup validation
// - API error normalization
// - Request cancellation
// - Safe redirect lifecycle
// - Loading / invalid / success states
// - Responsive UI integration
// - No Redux / actions dependency
// - TITech branding only
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  Formik,
  Form,
  Field,
} from "formik";

import * as Yup from "yup";

import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { toast } from "react-toastify";

import api from "../services/api";

import "./ResetPassword.css";

// ============================================================================
// CONSTANTS
// ============================================================================

const RESET_ENDPOINT =
  "/api/email/reset-password";

const LOGIN_ROUTE = "/login";

const FORGOT_PASSWORD_ROUTE =
  "/forgot-password";

const REDIRECT_DELAY = 3000;

const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_SPECIAL_CHARACTER_REGEX =
  /[@$!%*?&]/;

const PASSWORD_UPPERCASE_REGEX =
  /[A-Z]/;

const PASSWORD_LOWERCASE_REGEX =
  /[a-z]/;

const PASSWORD_NUMBER_REGEX =
  /\d/;

// ============================================================================
// TOKEN VALIDATION
// ============================================================================

/*
 * This accepts the legacy 40-character hexadecimal reset token format while
 * also supporting longer URL-safe tokens commonly used by secure backends.
 *
 * The server remains the authority for token validity, expiration and
 * revocation. Client-side validation only prevents obviously malformed input.
 */
function isValidTokenFormat(token) {
  if (!token || typeof token !== "string") {
    return false;
  }

  const normalized =
    token.trim();

  return (
    /^[a-f0-9]{40}$/i.test(
      normalized
    ) ||
    /^[A-Za-z0-9_-]{32,512}$/.test(
      normalized
    )
  );
}

// ============================================================================
// PASSWORD POLICY
// ============================================================================

function getPasswordRequirements(
  password = ""
) {
  return {
    minLength:
      password.length >=
      PASSWORD_MIN_LENGTH,

    uppercase:
      PASSWORD_UPPERCASE_REGEX.test(
        password
      ),

    lowercase:
      PASSWORD_LOWERCASE_REGEX.test(
        password
      ),

    number:
      PASSWORD_NUMBER_REGEX.test(
        password
      ),

    special:
      PASSWORD_SPECIAL_CHARACTER_REGEX.test(
        password
      ),
  };
}

function calculatePasswordStrength(
  password = ""
) {
  if (!password) {
    return {
      score: 0,
      percentage: 0,
      label: "Enter a password",
      tone: "neutral",
    };
  }

  const requirements =
    getPasswordRequirements(
      password
    );

  let score = 0;

  if (requirements.minLength) {
    score += 1;
  }

  if (requirements.uppercase) {
    score += 1;
  }

  if (requirements.lowercase) {
    score += 1;
  }

  if (requirements.number) {
    score += 1;
  }

  if (requirements.special) {
    score += 1;
  }

  if (password.length >= 12) {
    score += 1;
  }

  if (password.length >= 16) {
    score += 1;
  }

  if (score <= 2) {
    return {
      score,
      percentage: 25,
      label: "Weak",
      tone: "weak",
    };
  }

  if (score <= 4) {
    return {
      score,
      percentage: 50,
      label: "Fair",
      tone: "fair",
    };
  }

  if (score <= 5) {
    return {
      score,
      percentage: 75,
      label: "Strong",
      tone: "strong",
    };
  }

  return {
    score,
    percentage: 100,
    label: "Very strong",
    tone: "excellent",
  };
}

function hasValidPasswordPolicy(
  password = ""
) {
  const requirements =
    getPasswordRequirements(
      password
    );

  return Object.values(
    requirements
  ).every(Boolean);
}

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

const ResetPasswordSchema =
  Yup.object({
    password: Yup.string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
      )
      .matches(
        PASSWORD_UPPERCASE_REGEX,
        "Password must contain at least one uppercase letter."
      )
      .matches(
        PASSWORD_LOWERCASE_REGEX,
        "Password must contain at least one lowercase letter."
      )
      .matches(
        PASSWORD_NUMBER_REGEX,
        "Password must contain at least one number."
      )
      .matches(
        PASSWORD_SPECIAL_CHARACTER_REGEX,
        "Password must contain at least one special character."
      )
      .required(
        "Password is required."
      ),

    confirmPassword:
      Yup.string()
        .oneOf(
          [Yup.ref("password")],
          "Passwords must match."
        )
        .required(
          "Please confirm your password."
        ),
  });

// ============================================================================
// ERROR HELPERS
// ============================================================================

function getApiErrorMessage(
  error
) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Unable to reset your password. Please try again."
  );
}

function isTokenError(error) {
  const status =
    error?.response?.status;

  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 410
  );
}

// ============================================================================
// REUSABLE VIEW COMPONENTS
// ============================================================================

function BrandPanel() {
  return (
    <aside className="reset-password-brand">
      <div className="brand-content">
        <div
          className="brand-mark"
          aria-hidden="true"
        >
          TT
        </div>

        <p className="brand-kicker">
          TITech Community Capital
        </p>

        <h1 className="brand-title">
          Secure Access.
          <br />
          Stronger Communities.
        </h1>

        <p className="brand-subtitle">
          Protect your TITech account with a
          secure password and continue
          managing your community financial
          activities with confidence.
        </p>

        <div
          className="brand-features"
          role="list"
          aria-label="Security features"
        >
          <div
            className="feature"
            role="listitem"
          >
            <span
              className="feature-icon"
              aria-hidden="true"
            >
              <ShieldCheck size={19} />
            </span>

            <div>
              <strong>
                Secure by design
              </strong>

              <p>
                Password credentials are
                protected using secure
                authentication flows.
              </p>
            </div>
          </div>

          <div
            className="feature"
            role="listitem"
          >
            <span
              className="feature-icon"
              aria-hidden="true"
            >
              <Lock size={19} />
            </span>

            <div>
              <strong>
                Strong password policy
              </strong>

              <p>
                Use a combination of upper,
                lower, numeric and special
                characters.
              </p>
            </div>
          </div>

          <div
            className="feature"
            role="listitem"
          >
            <span
              className="feature-icon"
              aria-hidden="true"
            >
              <CheckCircle2 size={19} />
            </span>

            <div>
              <strong>
                Account protection
              </strong>

              <p>
                Your new password takes effect
                immediately after a successful
                reset.
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function LoadingState() {
  return (
    <div className="reset-password-page">
      <div className="reset-password-wrapper">
        <BrandPanel />

        <main className="reset-password-container">
          <section
            className="reset-password-card state-card"
            aria-busy="true"
            aria-live="polite"
          >
            <div
              className="loading-spinner"
              aria-hidden="true"
            />

            <h2>
              Validating reset link
            </h2>

            <p>
              Please wait while TITech verifies
              your password reset request.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

function InvalidTokenState() {
  return (
    <div className="reset-password-page">
      <div className="reset-password-wrapper">
        <BrandPanel />

        <main className="reset-password-container">
          <section
            className="reset-password-card state-card error-card"
            role="alert"
          >
            <span
              className="state-icon state-icon-danger"
              aria-hidden="true"
            >
              <AlertCircle size={42} />
            </span>

            <h2>
              Invalid Reset Link
            </h2>

            <p>
              This password reset link is invalid,
              malformed or has expired. Request a
              new reset link to continue.
            </p>

            <Link
              to={FORGOT_PASSWORD_ROUTE}
              className="submit-btn state-action"
            >
              Request New Link
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}

function SuccessState() {
  return (
    <div className="reset-password-page">
      <div className="reset-password-wrapper">
        <BrandPanel />

        <main className="reset-password-container">
          <section
            className="reset-password-card state-card success-card"
            role="status"
            aria-live="polite"
          >
            <span
              className="state-icon state-icon-success"
              aria-hidden="true"
            >
              <CheckCircle2 size={42} />
            </span>

            <h2>
              Password Reset Successful
            </h2>

            <p>
              Your TITech account password has
              been successfully changed.
            </p>

            <p className="redirect-message">
              You will be redirected to the
              login page shortly.
            </p>

            <Link
              to={LOGIN_ROUTE}
              className="submit-btn state-action"
            >
              Go to Login
            </Link>
          </section>
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// PASSWORD REQUIREMENTS
// ============================================================================

function PasswordRequirement({
  met,
  children,
}) {
  return (
    <li
      className={
        met
          ? "requirement met"
          : "requirement"
      }
    >
      <span
        className="requirement-icon"
        aria-hidden="true"
      >
        {met ? (
          <Check size={13} />
        ) : (
          <X size={13} />
        )}
      </span>

      <span>{children}</span>
    </li>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ResetPassword() {
  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const mountedRef =
    useRef(false);

  const redirectTimerRef =
    useRef(null);

  const requestControllerRef =
    useRef(null);

  const [loading, setLoading] =
    useState(false);

  const [showPassword, setShowPassword] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [tokenValid, setTokenValid] =
    useState(false);

  const [
    tokenValidating,
    setTokenValidating,
  ] = useState(true);

  const [resetSuccess, setResetSuccess] =
    useState(false);

  const [tokenError, setTokenError] =
    useState("");

  const token =
    searchParams
      .get("token")
      ?.trim() || "";

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current =
        false;

      if (
        redirectTimerRef.current
      ) {
        window.clearTimeout(
          redirectTimerRef.current
        );
      }

      if (
        requestControllerRef.current
      ) {
        requestControllerRef.current.abort();
      }
    };
  }, []);

  // ==========================================================================
  // Validate token
  // ==========================================================================

  useEffect(() => {
    if (!mountedRef.current) {
      return;
    }

    setTokenValidating(true);
    setTokenValid(false);
    setTokenError("");

    if (!token) {
      setTokenValidating(false);

      setTokenError(
        "The password reset token is missing."
      );

      toast.error(
        "Invalid or missing reset token.",
        {
          autoClose: 5000,
        }
      );

      return;
    }

    if (!isValidTokenFormat(token)) {
      setTokenValidating(false);

      setTokenError(
        "The password reset token format is invalid."
      );

      toast.error(
        "Invalid reset token format.",
        {
          autoClose: 5000,
        }
      );

      return;
    }

    setTokenValid(true);
    setTokenValidating(false);
  }, [token]);

  // ==========================================================================
  // Reset submission
  // ==========================================================================

  const handleSubmit = useCallback(
    async (
      values,
      {
        setSubmitting,
        setFieldError,
      }
    ) => {
      if (!token) {
        toast.error(
          "The password reset token is missing."
        );

        setSubmitting(false);

        return;
      }

      if (
        !isValidTokenFormat(token)
      ) {
        toast.error(
          "The password reset token is invalid."
        );

        setSubmitting(false);

        return;
      }

      if (
        !hasValidPasswordPolicy(
          values.password
        )
      ) {
        toast.error(
          "Please satisfy all password requirements."
        );

        setSubmitting(false);

        return;
      }

      if (
        values.password !==
        values.confirmPassword
      ) {
        setFieldError(
          "confirmPassword",
          "Passwords must match."
        );

        setSubmitting(false);

        return;
      }

      if (
        requestControllerRef.current
      ) {
        try {
          requestControllerRef.current.abort();
        } catch {
          // Ignore prior request cancellation.
        }
      }

      let controller = null;

      if (
        typeof AbortController !==
        "undefined"
      ) {
        controller =
          new AbortController();

        requestControllerRef.current =
          controller;
      }

      setLoading(true);
      setTokenError("");

      try {
        const response =
          await api.post(
            RESET_ENDPOINT,
            {
              token,
              password:
                values.password,
              confirmPassword:
                values.confirmPassword,
            },
            controller
              ? {
                  signal:
                    controller.signal,
                }
              : undefined
          );

        if (
          !mountedRef.current
        ) {
          return;
        }

        const success =
          response?.status >= 200 &&
          response?.status < 300;

        if (!success) {
          throw new Error(
            "The password reset request was not accepted."
          );
        }

        setResetSuccess(true);

        toast.success(
          "Password reset successful.",
          {
            autoClose: 4000,
          }
        );

        redirectTimerRef.current =
          window.setTimeout(
            () => {
              if (
                mountedRef.current
              ) {
                navigate(
                  LOGIN_ROUTE,
                  {
                    replace: true,
                  }
                );
              }
            },
            REDIRECT_DELAY
          );
      } catch (error) {
        const cancelled =
          error?.name ===
            "AbortError" ||
          error?.code ===
            "ERR_CANCELED";

        if (
          cancelled ||
          !mountedRef.current
        ) {
          return;
        }

        if (
          isTokenError(error)
        ) {
          setTokenValid(false);

          setTokenError(
            "This reset link is invalid or has expired."
          );

          toast.error(
            "Invalid or expired reset token.",
            {
              autoClose: 5000,
            }
          );

          return;
        }

        const message =
          getApiErrorMessage(
            error
          );

        toast.error(message, {
          autoClose: 5000,
        });
      } finally {
        if (
          mountedRef.current
        ) {
          setLoading(false);
          setSubmitting(false);
        }
      }
    },
    [navigate, token]
  );

  // ==========================================================================
  // Memoized state for presentation
  // ==========================================================================

  const initialValues =
    useMemo(
      () => ({
        password: "",
        confirmPassword: "",
      }),
      []
    );

  // ==========================================================================
  // Loading state
  // ==========================================================================

  if (tokenValidating) {
    return <LoadingState />;
  }

  // ==========================================================================
  // Invalid token state
  // ==========================================================================

  if (!tokenValid) {
    return <InvalidTokenState />;
  }

  // ==========================================================================
  // Success state
  // ==========================================================================

  if (resetSuccess) {
    return <SuccessState />;
  }

  // ==========================================================================
  // Main form
  // ==========================================================================

  return (
    <div className="reset-password-page">
      <div className="reset-password-wrapper">
        {/* ================================================================
            BRAND / SECURITY PANEL
            ================================================================ */}

        <BrandPanel />

        {/* ================================================================
            RESET FORM
            ================================================================ */}

        <main className="reset-password-container">
          <section className="reset-password-card">
            <Link
              to={LOGIN_ROUTE}
              className="back-link"
            >
              <ArrowLeft
                size={16}
                aria-hidden="true"
              />

              Back to Login
            </Link>

            <div className="reset-password-heading-group">
              <span
                className="form-security-icon"
                aria-hidden="true"
              >
                <Lock size={20} />
              </span>

              <div>
                <h2 className="reset-password-heading">
                  Create New Password
                </h2>

                <p className="reset-password-subtitle">
                  Create a strong password to
                  secure your TITech account.
                </p>
              </div>
            </div>

            {tokenError && (
              <div
                className="reset-password-inline-error"
                role="alert"
              >
                <AlertCircle
                  size={17}
                  aria-hidden="true"
                />

                <span>
                  {tokenError}
                </span>
              </div>
            )}

            <Formik
              initialValues={
                initialValues
              }
              validationSchema={
                ResetPasswordSchema
              }
              onSubmit={
                handleSubmit
              }
              validateOnChange
              validateOnBlur
              validateOnMount
            >
              {({
                isSubmitting,
                errors,
                touched,
                isValid,
                values,
              }) => {
                const passwordRequirements =
                  getPasswordRequirements(
                    values.password
                  );

                const passwordStrength =
                  calculatePasswordStrength(
                    values.password
                  );

                const formBusy =
                  loading ||
                  isSubmitting;

                return (
                  <Form
                    className="reset-password-form"
                    noValidate
                  >
                    {/* ====================================================
                        NEW PASSWORD
                        ==================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor="password"
                        className="form-label"
                      >
                        <Lock
                          className="form-icon"
                          size={16}
                          aria-hidden="true"
                        />

                        New Password
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
                          autoComplete="new-password"
                          placeholder="Enter a strong password"
                          disabled={
                            formBusy
                          }
                          className={`form-input ${
                            touched.password &&
                            errors.password
                              ? "has-error"
                              : ""
                          }`}
                          aria-invalid={
                            touched.password &&
                            errors.password
                              ? "true"
                              : "false"
                          }
                          aria-describedby="password-help password-strength password-error"
                        />

                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() =>
                            setShowPassword(
                              (
                                current
                              ) =>
                                !current
                            )
                          }
                          aria-label={
                            showPassword
                              ? "Hide password"
                              : "Show password"
                          }
                          aria-pressed={
                            showPassword
                          }
                          disabled={
                            formBusy
                          }
                        >
                          {showPassword ? (
                            <EyeOff
                              size={
                                18
                              }
                              aria-hidden="true"
                            />
                          ) : (
                            <Eye
                              size={
                                18
                              }
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </div>

                      <p
                        id="password-help"
                        className="form-help"
                      >
                        Use a unique password
                        that you do not use on
                        other services.
                      </p>

                      {values.password && (
                        <div
                          id="password-strength"
                          className={`password-strength password-strength-${passwordStrength.tone}`}
                          aria-live="polite"
                        >
                          <div
                            className="strength-meter"
                            role="progressbar"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={
                              passwordStrength.percentage
                            }
                            aria-label="Password strength"
                          >
                            <span
                              className="strength-bar"
                              style={{
                                width: `${passwordStrength.percentage}%`,
                              }}
                            />
                          </div>

                          <span className="strength-text">
                            {
                              passwordStrength.label
                            }
                          </span>
                        </div>
                      )}

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

                    {/* ====================================================
                        CONFIRM PASSWORD
                        ==================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor="confirmPassword"
                        className="form-label"
                      >
                        <Lock
                          className="form-icon"
                          size={16}
                          aria-hidden="true"
                        />

                        Confirm Password
                      </label>

                      <div className="password-input-wrapper">
                        <Field
                          id="confirmPassword"
                          name="confirmPassword"
                          type={
                            showConfirmPassword
                              ? "text"
                              : "password"
                          }
                          autoComplete="new-password"
                          placeholder="Re-enter your password"
                          disabled={
                            formBusy
                          }
                          className={`form-input ${
                            touched.confirmPassword &&
                            errors.confirmPassword
                              ? "has-error"
                              : ""
                          }`}
                          aria-invalid={
                            touched.confirmPassword &&
                            errors.confirmPassword
                              ? "true"
                              : "false"
                          }
                          aria-describedby={
                            touched.confirmPassword &&
                            errors.confirmPassword
                              ? "confirm-password-error"
                              : undefined
                          }
                        />

                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() =>
                            setShowConfirmPassword(
                              (
                                current
                              ) =>
                                !current
                            )
                          }
                          aria-label={
                            showConfirmPassword
                              ? "Hide confirmation password"
                              : "Show confirmation password"
                          }
                          aria-pressed={
                            showConfirmPassword
                          }
                          disabled={
                            formBusy
                          }
                        >
                          {showConfirmPassword ? (
                            <EyeOff
                              size={
                                18
                              }
                              aria-hidden="true"
                            />
                          ) : (
                            <Eye
                              size={
                                18
                              }
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </div>

                      {touched.confirmPassword &&
                        errors.confirmPassword && (
                          <div
                            id="confirm-password-error"
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {
                                errors.confirmPassword
                              }
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ====================================================
                        REQUIREMENTS
                        ==================================================== */}

                    <section
                      className="password-requirements"
                      aria-labelledby="password-requirements-title"
                    >
                      <div className="requirements-header">
                        <div>
                          <p
                            id="password-requirements-title"
                            className="requirements-title"
                          >
                            Password requirements
                          </p>

                          <p className="requirements-subtitle">
                            Your password should
                            satisfy every
                            requirement below.
                          </p>
                        </div>

                        <ShieldCheck
                          size={20}
                          aria-hidden="true"
                        />
                      </div>

                      <ul className="requirements-list">
                        <PasswordRequirement
                          met={
                            passwordRequirements.minLength
                          }
                        >
                          At least{" "}
                          {
                            PASSWORD_MIN_LENGTH
                          }{" "}
                          characters
                        </PasswordRequirement>

                        <PasswordRequirement
                          met={
                            passwordRequirements.uppercase
                          }
                        >
                          One uppercase letter
                        </PasswordRequirement>

                        <PasswordRequirement
                          met={
                            passwordRequirements.lowercase
                          }
                        >
                          One lowercase letter
                        </PasswordRequirement>

                        <PasswordRequirement
                          met={
                            passwordRequirements.number
                          }
                        >
                          One number
                        </PasswordRequirement>

                        <PasswordRequirement
                          met={
                            passwordRequirements.special
                          }
                        >
                          One special character
                          (@$!%*?&)
                        </PasswordRequirement>
                      </ul>
                    </section>

                    {/* ====================================================
                        SUBMIT
                        ==================================================== */}

                    <button
                      type="submit"
                      disabled={
                        formBusy ||
                        !isValid ||
                        !hasValidPasswordPolicy(
                          values.password
                        )
                      }
                      className="submit-btn"
                      aria-busy={
                        formBusy
                      }
                    >
                      {formBusy ? (
                        <span className="btn-loading">
                          <span
                            className="spinner"
                            aria-hidden="true"
                          />

                          Updating Password…
                        </span>
                      ) : (
                        <>
                          <ShieldCheck
                            size={17}
                            aria-hidden="true"
                          />

                          Reset Password
                        </>
                      )}
                    </button>

                    {/* ====================================================
                        LOGIN LINK
                        ==================================================== */}

                    <p className="login-link">
                      Remember your password?{" "}
                      <Link
                        to={
                          LOGIN_ROUTE
                        }
                        className="link-highlight"
                      >
                        Log in here
                      </Link>
                    </p>
                  </Form>
                );
              }}
            </Formik>
          </section>

          {/* ================================================================
              FOOTER
              ================================================================ */}

          <footer className="reset-password-footer">
            <span>
              By using this service, you agree
              to TITech's{" "}
              <Link
                to="/terms"
                className="footer-link"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                to="/privacy"
                className="footer-link"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}