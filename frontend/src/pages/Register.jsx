// ============================================================================
// TITech Community Capital
// Enterprise Registration Page
// File: frontend/src/pages/Register.jsx
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Secure account registration
// - Strong client-side validation
// - Password strength feedback
// - Accessible form controls and validation messages
// - Duplicate submission protection
// - Rate-limit aware error handling
// - Safe post-registration navigation
// - Controlled password visibility
// - Generic authentication error messaging
// - React Strict Mode compatibility
// - Mobile responsive presentation
// - TITech terminology consistency
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  Formik,
  Form,
  Field,
} from 'formik';

import * as Yup from 'yup';

import { toast } from 'react-toastify';

import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

import './Register.css';

// ============================================================================
// Constants
// ============================================================================

const LOGIN_ROUTE = '/login';
const DEFAULT_SUCCESS_ROUTE = '/dashboard';

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 16;
const MAX_PASSWORD_LENGTH = 128;

const REGISTRATION_TIMEOUT_MS = 30_000;

const PASSWORD_SPECIAL_CHARACTERS = /[@$!%*?&^#()_+\-=]/;

const GENERIC_REGISTRATION_ERROR =
  'We could not create your account. Please review your details and try again.';

const RATE_LIMIT_ERROR =
  'Too many registration attempts. Please wait a moment and try again.';

// ============================================================================
// Redirect Security
// ============================================================================

/**
 * Accept only internal application paths.
 *
 * Prevents registration redirects from becoming an open-redirect vector.
 */
const isSafeInternalPath = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const candidate = value.trim();

  if (!candidate || candidate.length > 512) {
    return false;
  }

  if (!candidate.startsWith('/')) {
    return false;
  }

  if (candidate.startsWith('//')) {
    return false;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(candidate)) {
    return false;
  }

  return true;
};

/**
 * Resolve optional `next` query parameter.
 */
const getSafeRedirectTarget = (search) => {
  try {
    const params = new URLSearchParams(search || '');
    const requestedTarget = params.get('next');

    if (isSafeInternalPath(requestedTarget)) {
      return requestedTarget;
    }
  } catch {
    // Invalid query strings safely fall back to dashboard.
  }

  return DEFAULT_SUCCESS_ROUTE;
};

// ============================================================================
// Validation
// ============================================================================

const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizePhone = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, '');

const RegisterSchema = Yup.object({
  name: Yup.string()
    .trim()
    .min(2, 'Full name must be at least 2 characters.')
    .max(
      MAX_NAME_LENGTH,
      `Full name cannot exceed ${MAX_NAME_LENGTH} characters.`,
    )
    .required('Full name is required.'),

  email: Yup.string()
    .trim()
    .lowercase()
    .email('Please enter a valid email address.')
    .max(
      MAX_EMAIL_LENGTH,
      'Email address is too long.',
    )
    .required('Email address is required.'),

  phone: Yup.string()
    .nullable()
    .transform((value) => {
      if (!value) {
        return '';
      }

      return normalizePhone(value);
    })
    .test(
      'phone-format',
      'Enter a valid international phone number, for example +256782397907.',
      (value) => {
        if (!value) {
          return true;
        }

        return /^\+[1-9]\d{7,14}$/.test(value);
      },
    )
    .max(
      MAX_PHONE_LENGTH,
      'Phone number is too long.',
    ),

  password: Yup.string()
    .required('Password is required.')
    .min(
      8,
      'Password must be at least 8 characters.',
    )
    .max(
      MAX_PASSWORD_LENGTH,
      `Password cannot exceed ${MAX_PASSWORD_LENGTH} characters.`,
    )
    .matches(
      /[A-Z]/,
      'Password must contain at least one uppercase letter.',
    )
    .matches(
      /[a-z]/,
      'Password must contain at least one lowercase letter.',
    )
    .matches(
      /\d/,
      'Password must contain at least one number.',
    )
    .matches(
      PASSWORD_SPECIAL_CHARACTERS,
      'Password must contain at least one special character.',
    ),

  confirmPassword: Yup.string()
    .required('Please confirm your password.')
    .oneOf(
      [Yup.ref('password')],
      'Passwords do not match.',
    ),

  agreeTerms: Yup.boolean()
    .oneOf(
      [true],
      'You must accept the Terms and Privacy Policy.',
    ),
});

// ============================================================================
// Password Strength
// ============================================================================

const calculatePasswordStrength = (password = '') => {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (PASSWORD_SPECIAL_CHARACTERS.test(password)) score += 1;

  return Math.min(score, 6);
};

const getPasswordStrength = (score) => {
  if (score <= 1) {
    return {
      label: 'Weak',
      percentage: 16,
      level: 'weak',
    };
  }

  if (score === 2) {
    return {
      label: 'Fair',
      percentage: 33,
      level: 'fair',
    };
  }

  if (score === 3) {
    return {
      label: 'Good',
      percentage: 50,
      level: 'good',
    };
  }

  if (score === 4) {
    return {
      label: 'Strong',
      percentage: 67,
      level: 'strong',
    };
  }

  if (score === 5) {
    return {
      label: 'Very Strong',
      percentage: 84,
      level: 'very-strong',
    };
  }

  return {
    label: 'Excellent',
    percentage: 100,
    level: 'excellent',
  };
};

// ============================================================================
// Error Helpers
// ============================================================================

const getResponseStatus = (error) =>
  error?.response?.status ??
  error?.status ??
  error?.statusCode ??
  null;

const getResponseMessage = (error) => {
  const message =
    error?.response?.data?.message ??
    error?.response?.data?.error ??
    '';

  return typeof message === 'string'
    ? message.trim()
    : '';
};

/**
 * Convert backend errors into safe user-facing messages.
 *
 * Raw authentication/server errors should not be displayed directly because
 * they can expose implementation details or sensitive information.
 */
const getRegistrationErrorMessage = (error) => {
  const status = getResponseStatus(error);

  if (status === 409) {
    return 'An account with these details may already exist. Please sign in or use different details.';
  }

  if (status === 422) {
    return 'Some registration details could not be accepted. Please review your information.';
  }

  if (status === 429) {
    return RATE_LIMIT_ERROR;
  }

  if (status >= 500) {
    return 'The registration service is temporarily unavailable. Please try again shortly.';
  }

  const backendMessage = getResponseMessage(error).toLowerCase();

  if (
    backendMessage.includes('email already') ||
    backendMessage.includes('already registered') ||
    backendMessage.includes('already exists')
  ) {
    return 'An account with this email may already exist. Please sign in instead.';
  }

  return GENERIC_REGISTRATION_ERROR;
};

// ============================================================================
// Component
// ============================================================================

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
  } = useAuth() ?? {};

  const componentId = useId();

  const mountedRef = useRef(false);
  const registrationInProgressRef = useRef(false);
  const timeoutRef = useRef(null);

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [registrationError, setRegistrationError] =
    useState('');

  // --------------------------------------------------------------------------
  // Safe post-registration redirect
  // --------------------------------------------------------------------------

  const successRedirect = useMemo(
    () => getSafeRedirectTarget(location.search),
    [location.search],
  );

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // Timeout cleanup
  // --------------------------------------------------------------------------

  const clearRegistrationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  const navigateAfterRegistration = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    navigate(successRedirect, {
      replace: true,
    });
  }, [
    navigate,
    successRedirect,
  ]);

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  const handleRegister = useCallback(
    async (
      values,
      {
        setSubmitting,
        resetForm,
      },
    ) => {
      if (!mountedRef.current) {
        return;
      }

      if (registrationInProgressRef.current) {
        return;
      }

      if (typeof register !== 'function') {
        const message =
          'Registration service is currently unavailable. Please try again later.';

        setRegistrationError(message);

        toast.error(message, {
          toastId: 'titech-registration-service-unavailable',
        });

        return;
      }

      registrationInProgressRef.current = true;

      setRegistrationError('');
      clearRegistrationTimeout();

      timeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        registrationInProgressRef.current = false;

        setRegistrationError(
          'Registration is taking longer than expected. Please check your connection and try again.',
        );

        toast.error(
          'Registration is taking longer than expected.',
          {
            toastId: 'titech-registration-timeout',
          },
        );
      }, REGISTRATION_TIMEOUT_MS);

      try {
        const payload = {
          name: normalizeName(values.name),
          email: normalizeEmail(values.email),
          password: values.password,
        };

        const phone = normalizePhone(values.phone);

        if (phone) {
          payload.phone = phone;
        }

        await register(payload);

        if (!mountedRef.current) {
          return;
        }

        clearRegistrationTimeout();

        registrationInProgressRef.current = false;

        toast.success(
          'Your TITech Community Capital account has been created successfully.',
          {
            autoClose: 3000,
            toastId: 'titech-registration-success',
          },
        );

        resetForm();

        navigateAfterRegistration();
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        clearRegistrationTimeout();

        registrationInProgressRef.current = false;

        const message =
          getRegistrationErrorMessage(error);

        setRegistrationError(message);

        if (getResponseStatus(error) === 429) {
          toast.error(RATE_LIMIT_ERROR, {
            autoClose: 5000,
            toastId: 'titech-registration-rate-limit',
          });
        } else {
          toast.error(message, {
            autoClose: 4500,
            toastId: 'titech-registration-error',
          });
        }

        // Keep detailed diagnostics out of the user interface.
        // eslint-disable-next-line no-console
        console.error(
          '[TITech Registration] Registration request failed:',
          {
            status: getResponseStatus(error),
            message: getResponseMessage(error),
          },
        );
      } finally {
        clearRegistrationTimeout();

        if (mountedRef.current) {
          setSubmitting(false);
        }
      }
    },
    [
      clearRegistrationTimeout,
      navigateAfterRegistration,
      register,
    ],
  );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <main
      className="register-page"
      aria-labelledby={`${componentId}-heading`}
    >
      <div className="register-wrapper">
        {/* ====================================================================
            Brand / Features Panel
        ==================================================================== */}

        <section
          className="register-features"
          aria-labelledby={`${componentId}-brand`}
        >
          <div className="register-features-inner">
            <div className="register-security-badge">
              <ShieldCheck
                size={18}
                aria-hidden="true"
              />

              <span>
                Secure financial platform
              </span>
            </div>

            <h1
              id={`${componentId}-brand`}
              className="features-title"
            >
              TITech Community Capital
            </h1>

            <p className="features-subtitle">
              Build financial resilience together
              through trusted community savings,
              contributions, and lending.
            </p>

            <div
              className="feature-list"
              aria-label="TITech Community Capital features"
            >
              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Secure savings accounts
                </span>
              </div>

              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Community group contributions
                </span>
              </div>

              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Mobile money integration
                </span>
              </div>

              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Responsible community lending
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ====================================================================
            Registration Form
        ==================================================================== */}

        <section
          className="register-container"
          aria-labelledby={`${componentId}-heading`}
        >
          <div className="register-card">
            <header className="register-card-header">
              <h2
                id={`${componentId}-heading`}
              >
                Create your account
              </h2>

              <p className="register-subtitle">
                Start your TITech Community Capital
                journey today.
              </p>
            </header>

            {registrationError && (
              <div
                className="registration-alert"
                role="alert"
                aria-live="assertive"
              >
                <AlertCircle
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  {registrationError}
                </span>
              </div>
            )}

            <Formik
              initialValues={{
                name: '',
                email: '',
                phone: '',
                password: '',
                confirmPassword: '',
                agreeTerms: false,
              }}
              validationSchema={RegisterSchema}
              onSubmit={handleRegister}
              validateOnBlur
              validateOnChange
            >
              {({
                values,
                errors,
                touched,
                isSubmitting,
              }) => {
                const passwordStrength =
                  calculatePasswordStrength(
                    values.password,
                  );

                const strength =
                  getPasswordStrength(
                    passwordStrength,
                  );

                const isBusy =
                  isSubmitting ||
                  registrationInProgressRef.current;

                return (
                  <Form
                    className="register-form"
                    noValidate
                  >
                    {/* ========================================================
                        Full Name
                    ======================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor={`${componentId}-name`}
                      >
                        <User
                          size={16}
                          aria-hidden="true"
                        />

                        <span>
                          Full Name
                        </span>
                      </label>

                      <Field
                        id={`${componentId}-name`}
                        name="name"
                        type="text"
                        className={`form-input ${
                          touched.name &&
                          errors.name
                            ? 'form-input--error'
                            : ''
                        }`}
                        placeholder="Enter your full name"
                        autoComplete="name"
                        maxLength={MAX_NAME_LENGTH}
                        aria-invalid={
                          touched.name &&
                          Boolean(errors.name)
                        }
                        aria-describedby={
                          touched.name &&
                          errors.name
                            ? `${componentId}-name-error`
                            : undefined
                        }
                      />

                      {touched.name &&
                        errors.name && (
                          <div
                            id={`${componentId}-name-error`}
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {errors.name}
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                        Email
                    ======================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor={`${componentId}-email`}
                      >
                        <Mail
                          size={16}
                          aria-hidden="true"
                        />

                        <span>
                          Email Address
                        </span>
                      </label>

                      <Field
                        id={`${componentId}-email`}
                        type="email"
                        name="email"
                        className={`form-input ${
                          touched.email &&
                          errors.email
                            ? 'form-input--error'
                            : ''
                        }`}
                        placeholder="you@example.com"
                        autoComplete="email"
                        inputMode="email"
                        maxLength={MAX_EMAIL_LENGTH}
                        aria-invalid={
                          touched.email &&
                          Boolean(errors.email)
                        }
                        aria-describedby={
                          touched.email &&
                          errors.email
                            ? `${componentId}-email-error`
                            : undefined
                        }
                      />

                      {touched.email &&
                        errors.email && (
                          <div
                            id={`${componentId}-email-error`}
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {errors.email}
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                        Phone
                    ======================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor={`${componentId}-phone`}
                      >
                        <Phone
                          size={16}
                          aria-hidden="true"
                        />

                        <span>
                          Phone Number
                          <span className="optional-label">
                            {' '}
                            (Optional)
                          </span>
                        </span>
                      </label>

                      <Field
                        id={`${componentId}-phone`}
                        name="phone"
                        type="tel"
                        className={`form-input ${
                          touched.phone &&
                          errors.phone
                            ? 'form-input--error'
                            : ''
                        }`}
                        placeholder="+256782397907"
                        autoComplete="tel"
                        inputMode="tel"
                        maxLength={MAX_PHONE_LENGTH}
                        aria-invalid={
                          touched.phone &&
                          Boolean(errors.phone)
                        }
                        aria-describedby={
                          touched.phone &&
                          errors.phone
                            ? `${componentId}-phone-error`
                            : undefined
                        }
                      />

                      {touched.phone &&
                        errors.phone && (
                          <div
                            id={`${componentId}-phone-error`}
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {errors.phone}
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                        Password
                    ======================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor={`${componentId}-password`}
                      >
                        <Lock
                          size={16}
                          aria-hidden="true"
                        />

                        <span>
                          Password
                        </span>
                      </label>

                      <div className="password-input-wrapper">
                        <Field
                          id={`${componentId}-password`}
                          type={
                            showPassword
                              ? 'text'
                              : 'password'
                          }
                          name="password"
                          className={`form-input ${
                            touched.password &&
                            errors.password
                              ? 'form-input--error'
                              : ''
                          }`}
                          placeholder="Create a strong password"
                          autoComplete="new-password"
                          maxLength={
                            MAX_PASSWORD_LENGTH
                          }
                          aria-invalid={
                            touched.password &&
                            Boolean(errors.password)
                          }
                          aria-describedby={`${componentId}-password-help ${
                            touched.password &&
                            errors.password
                              ? `${componentId}-password-error`
                              : ''
                          }`}
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
                          aria-label={
                            showPassword
                              ? 'Hide password'
                              : 'Show password'
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

                      <p
                        id={`${componentId}-password-help`}
                        className="password-requirements"
                      >
                        Use at least 8 characters
                        with uppercase, lowercase,
                        a number, and a special
                        character.
                      </p>

                      {values.password && (
                        <div
                          className="password-strength"
                          aria-live="polite"
                        >
                          <div
                            className="strength-meter"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={
                              strength.percentage
                            }
                            aria-label={`Password strength: ${strength.label}`}
                          >
                            <div
                              className={`strength-bar strength-bar--${strength.level}`}
                              style={{
                                width: `${strength.percentage}%`,
                              }}
                            />
                          </div>

                          <span
                            className={`strength-label strength-label--${strength.level}`}
                          >
                            {strength.label}
                          </span>
                        </div>
                      )}

                      {touched.password &&
                        errors.password && (
                          <div
                            id={`${componentId}-password-error`}
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {errors.password}
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                        Confirm Password
                    ======================================================== */}

                    <div className="form-group">
                      <label
                        htmlFor={`${componentId}-confirm-password`}
                      >
                        <Lock
                          size={16}
                          aria-hidden="true"
                        />

                        <span>
                          Confirm Password
                        </span>
                      </label>

                      <div className="password-input-wrapper">
                        <Field
                          id={`${componentId}-confirm-password`}
                          type={
                            showConfirmPassword
                              ? 'text'
                              : 'password'
                          }
                          name="confirmPassword"
                          className={`form-input ${
                            touched.confirmPassword &&
                            errors.confirmPassword
                              ? 'form-input--error'
                              : ''
                          }`}
                          placeholder="Re-enter your password"
                          autoComplete="new-password"
                          maxLength={
                            MAX_PASSWORD_LENGTH
                          }
                          aria-invalid={
                            touched.confirmPassword &&
                            Boolean(
                              errors.confirmPassword,
                            )
                          }
                          aria-describedby={
                            touched.confirmPassword &&
                            errors.confirmPassword
                              ? `${componentId}-confirm-password-error`
                              : undefined
                          }
                        />

                        <button
                          type="button"
                          className="password-toggle"
                          onClick={() =>
                            setShowConfirmPassword(
                              (current) =>
                                !current,
                            )
                          }
                          aria-label={
                            showConfirmPassword
                              ? 'Hide confirmation password'
                              : 'Show confirmation password'
                          }
                          aria-pressed={
                            showConfirmPassword
                          }
                        >
                          {showConfirmPassword ? (
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

                      {touched.confirmPassword &&
                        errors.confirmPassword && (
                          <div
                            id={`${componentId}-confirm-password-error`}
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

                    {/* ========================================================
                        Terms
                    ======================================================== */}

                    <div className="form-group">
                      <label className="checkbox-label">
                        <Field
                          type="checkbox"
                          name="agreeTerms"
                          className="terms-checkbox"
                          aria-invalid={
                            touched.agreeTerms &&
                            Boolean(
                              errors.agreeTerms,
                            )
                          }
                        />

                        <span>
                          I agree to the{' '}
                          <Link
                            to="/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Terms of Service
                          </Link>{' '}
                          and{' '}
                          <Link
                            to="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Privacy Policy
                          </Link>
                          .
                        </span>
                      </label>

                      {touched.agreeTerms &&
                        errors.agreeTerms && (
                          <div
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle
                              size={14}
                              aria-hidden="true"
                            />

                            <span>
                              {errors.agreeTerms}
                            </span>
                          </div>
                        )}
                    </div>

                    {/* ========================================================
                        Submit
                    ======================================================== */}

                    <button
                      type="submit"
                      className="submit-btn"
                      disabled={isBusy}
                      aria-busy={isBusy}
                    >
                      {isBusy ? (
                        <>
                          <span
                            className="register-spinner"
                            aria-hidden="true"
                          />

                          <span>
                            Creating Account...
                          </span>
                        </>
                      ) : (
                        <span>
                          Create Account
                        </span>
                      )}
                    </button>

                    {/* ========================================================
                        Login
                    ======================================================== */}

                    <p className="login-link">
                      Already have an account?{' '}
                      <Link to={LOGIN_ROUTE}>
                        Sign In
                      </Link>
                    </p>
                  </Form>
                );
              }}
            </Formik>
          </div>
        </section>
      </div>

      {/* ======================================================================
          Footer
      ====================================================================== */}

      <footer className="register-footer">
        <p>
          © {new Date().getFullYear()} TITech
          Community Capital. All rights reserved.
        </p>

        <p>
          Your security, privacy, and financial
          wellbeing matter to us.
        </p>
      </footer>
    </main>
  );
}