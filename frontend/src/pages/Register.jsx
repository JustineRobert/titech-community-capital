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
import BrandLogo from "../components/BrandLogo";
import LanguageSelector from '../i18n/LanguageSelector';
import { useI18n } from '../i18n/I18nProvider';
import { LegalConsentFields } from '../legal/LegalConsentFields.jsx';
import { LegalDocumentLinks } from '../legal/LegalDocuments.jsx';
import { LEGAL_DOCUMENT_VERSION, LEGAL_PUBLICATION_STATUS } from '../legal/legalContent.js';

// ============================================================================
// Constants
// ============================================================================

const LOGIN_ROUTE = '/login';
const DEFAULT_SUCCESS_ROUTE = '/verify-email';

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 16;
const MAX_PASSWORD_LENGTH = 128;

const REGISTRATION_TIMEOUT_MS = 30_000;

const PASSWORD_SPECIAL_CHARACTERS = /[@$!%*?&^#()_+\-=]/;

// Draft legal text is never treated as approved in a production frontend build.
const legalRegistrationReleaseBlocked =
  Boolean(import.meta.env?.PROD) && LEGAL_PUBLICATION_STATUS !== 'approved';

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

const createRegisterSchema = (t) => Yup.object({
  name: Yup.string()
    .trim()
    .min(2, t('auth.register.validation.nameMin', { min: 2 }))
    .max(MAX_NAME_LENGTH, t('auth.register.validation.nameMax', { max: MAX_NAME_LENGTH }))
    .required(t('auth.register.validation.nameRequired')),

  email: Yup.string()
    .trim()
    .lowercase()
    .email(t('auth.register.validation.emailFormat'))
    .max(MAX_EMAIL_LENGTH, t('auth.register.validation.emailTooLong'))
    .required(t('auth.register.validation.emailRequired')),

  tenantInviteCode: Yup.string()
    .trim()
    .min(32, t('auth.register.validation.invitationMin', { min: 32 }))
    .max(128, t('auth.register.validation.invitationInvalid'))
    .required(t('auth.register.validation.invitationRequired')),

  phone: Yup.string()
    .nullable()
    .transform((value) => {
      if (!value) return '';
      return normalizePhone(value);
    })
    .test(
      'phone-format',
      t('auth.register.validation.phoneFormat', { example: '+256782397907' }),
      (value) => !value || /^\+[1-9]\d{7,14}$/.test(value),
    )
    .max(MAX_PHONE_LENGTH, t('auth.register.validation.phoneTooLong')),

  password: Yup.string()
    .required(t('auth.register.validation.passwordRequired'))
    .min(8, t('auth.register.validation.passwordMin', { min: 8 }))
    .max(MAX_PASSWORD_LENGTH, t('auth.register.validation.passwordMax', { max: MAX_PASSWORD_LENGTH }))
    .matches(/[A-Z]/, t('auth.register.validation.passwordUppercase'))
    .matches(/[a-z]/, t('auth.register.validation.passwordLowercase'))
    .matches(/\d/, t('auth.register.validation.passwordNumber'))
    .matches(PASSWORD_SPECIAL_CHARACTERS, t('auth.register.validation.passwordSpecial')),

  confirmPassword: Yup.string()
    .required(t('auth.register.validation.confirmRequired'))
    .oneOf([Yup.ref('password')], t('auth.register.validation.passwordsMismatch')),

  acceptedTerms: Yup.boolean()
    .oneOf([true], 'You must agree to the Terms of Service.'),

  acknowledgedPrivacy: Yup.boolean()
    .oneOf([true], 'You must acknowledge the Privacy Policy.'),
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
const getRegistrationErrorMessage = (error, t) => {
  const status = getResponseStatus(error);
  if (status === 409) return t('auth.register.errors.duplicate');
  if (status === 422) return t('auth.register.errors.invalidDetails');
  if (status === 429) return t('auth.register.errors.rateLimit');
  if (typeof status === 'number' && status >= 500) return t('auth.register.errors.serviceUnavailable');

  const backendMessage = getResponseMessage(error).toLowerCase();
  if (
    backendMessage.includes('email already') ||
    backendMessage.includes('already registered') ||
    backendMessage.includes('already exists')
  ) {
    return t('auth.register.errors.emailDuplicate');
  }

  return t('auth.register.errors.generic');
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
  const { t } = useI18n();
  const registrationSchema = useMemo(() => createRegisterSchema(t), [t]);

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

      if (legalRegistrationReleaseBlocked) {
        const message = 'Account creation is disabled in this production build until the Terms of Service and Privacy Policy receive formal approval.';
        setRegistrationError(message);
        toast.error(message, { toastId: 'titech-legal-publication-blocked' });
        return;
      }

      if (registrationInProgressRef.current) {
        return;
      }

      if (typeof register !== 'function') {
        const message =
          t('auth.register.errors.serviceUnavailableImmediate');

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
          t('auth.register.errors.timeout'),
        );

        toast.error(
          t('auth.register.errors.timeoutShort'),
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
          tenantInviteCode: values.tenantInviteCode.trim(),
          redirectAfterVerification: successRedirect,
          acceptedTerms: values.acceptedTerms === true,
          acknowledgedPrivacy: values.acknowledgedPrivacy === true,
          termsVersion: LEGAL_DOCUMENT_VERSION,
          privacyVersion: LEGAL_DOCUMENT_VERSION,
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
          t('auth.register.errors.success'),
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
          getRegistrationErrorMessage(error, t);

        setRegistrationError(message);

        if (getResponseStatus(error) === 429) {
          toast.error(t('auth.register.errors.rateLimit'), {
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
      t,
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
      <div className="titech-auth-language-control">
        <LanguageSelector />
      </div>
      <div className="register-wrapper">
        {/* ====================================================================
            Brand / Features Panel
        ==================================================================== */}

        <section
          className="register-features"
          aria-labelledby={`${componentId}-brand`}
        >
          <div className="register-features-inner">
            <div className="register-official-brand">
              <BrandLogo
                variant="transparent"
                size="lg"
                alt="TITech Community Capital"
                loading="eager"
                fetchPriority="high"
              />
            </div>

            <div className="register-security-badge">
              <ShieldCheck
                size={18}
                aria-hidden="true"
              />

              <span>
                {t("auth.register.securePlatform")}
              </span>
            </div>

            <h1
              id={`${componentId}-brand`}
              className="features-title"
            >
              {t("auth.register.tagline")}
            </h1>

            <p className="features-subtitle">
              {t("auth.register.subtitle")}
            </p>

            <div
              className="feature-list"
              aria-label={t("auth.login.featuresLabel")}
            >
              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Financial inclusion for all
                </span>
              </div>

              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Technology innovation for real-world challenges
                </span>
              </div>

              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Stronger communities and shared prosperity
                </span>
              </div>

              <div className="feature-item">
                <CheckCircle2
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  Sustainable finance and trusted capital pathways
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

            {LEGAL_PUBLICATION_STATUS !== 'approved' && (
              <div
                className="register-legal-draft-notice"
                role="status"
                aria-live="polite"
              >
                <strong>Legal documents are still drafts.</strong>
                <span>
                  Production account creation remains blocked until legal review, verified operator details and publication approval are complete.
                </span>
              </div>
            )}

            <Formik
              initialValues={{
                name: '',
                email: '',
                tenantInviteCode: '',
                phone: '',
                password: '',
                confirmPassword: '',
                acceptedTerms: false,
                acknowledgedPrivacy: false,
              }}
              validationSchema={registrationSchema}
              onSubmit={handleRegister}
              validateOnBlur
              validateOnChange
            >
              {({
                values,
                errors,
                touched,
                isSubmitting,
                setFieldValue,
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
                          {t("auth.register.nameLabel")}
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
                        placeholder={t("auth.register.namePlaceholder")}
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
                          {t("auth.register.emailLabel")}
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

                    <div className="form-group">
                      <label htmlFor={`${componentId}-tenant-invite-code`}>
                        {t("auth.register.tenantInviteCodeLabel")}
                      </label>
                      <Field
                        id={`${componentId}-tenant-invite-code`}
                        name="tenantInviteCode"
                        type="text"
                        className={`form-input ${
                          touched.tenantInviteCode &&
                          errors.tenantInviteCode
                            ? 'form-input--error'
                            : ''
                        }`}
                        placeholder={t("auth.register.tenantInviteCodePlaceholder")}
                        autoComplete="off"
                        maxLength={128}
                        aria-invalid={
                          touched.tenantInviteCode &&
                          Boolean(errors.tenantInviteCode)
                        }
                        aria-describedby={
                          touched.tenantInviteCode &&
                          errors.tenantInviteCode
                            ? `${componentId}-tenant-invite-code-error`
                            : `${componentId}-tenant-invite-code-help`
                        }
                      />
                      <small
                        id={`${componentId}-tenant-invite-code-help`}
                        className="form-help"
                      >
                        An invitation code is required to join an existing tenant
                        and access community groups.
                      </small>
                      {touched.tenantInviteCode &&
                        errors.tenantInviteCode && (
                          <div
                            id={`${componentId}-tenant-invite-code-error`}
                            className="field-error"
                            role="alert"
                          >
                            <AlertCircle size={14} aria-hidden="true" />
                            <span>{errors.tenantInviteCode}</span>
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
                          {t("auth.register.phoneLabel")}
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
                          {t("auth.register.passwordLabel")}
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
                          placeholder={t("auth.register.passwordPlaceholder")}
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
                          {t("auth.register.confirmPasswordLabel")}
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
                          placeholder={t("auth.register.confirmPasswordPlaceholder")}
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
                        Legal acceptance (separate terms and privacy fields)
                    ======================================================== */}

                    <LegalConsentFields
                      termsAccepted={values.acceptedTerms}
                      onTermsAcceptedChange={(accepted) => setFieldValue('acceptedTerms', accepted)}
                      privacyAcknowledged={values.acknowledgedPrivacy}
                      onPrivacyAcknowledgedChange={(acknowledged) => setFieldValue('acknowledgedPrivacy', acknowledged)}
                      disabled={legalRegistrationReleaseBlocked || isBusy}
                    />

                    {((touched.acceptedTerms && errors.acceptedTerms) ||
                      (touched.acknowledgedPrivacy && errors.acknowledgedPrivacy)) ? (
                        <div className="field-error" role="alert" aria-live="polite">
                          <AlertCircle size={14} aria-hidden="true" />
                          <span>{touched.acceptedTerms && errors.acceptedTerms ? errors.acceptedTerms : errors.acknowledgedPrivacy}</span>
                        </div>
                      ) : null}

                    {/* ========================================================
                        Submit
                    ======================================================== */}

                    <button
                      type="submit"
                      className="submit-btn"
                      disabled={isBusy || legalRegistrationReleaseBlocked}
                      aria-busy={isBusy || legalRegistrationReleaseBlocked}
                    >
                      {isBusy ? (
                        <>
                          <span
                            className="register-spinner"
                            aria-hidden="true"
                          />

                          <span>
                            {t("auth.register.submitting")}
                          </span>
                        </>
                      ) : (
                        <span>
                          {t("auth.register.submit")}
                        </span>
                      )}
                    </button>

                    {/* ========================================================
                        Login
                    ======================================================== */}

                    <p className="login-link">
                      {t("auth.register.haveAccount")}{' '}
                      <Link to={LOGIN_ROUTE}>
                        {t("auth.register.signIn")}
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
          © {new Date().getFullYear()} TITech Capital LTD. All rights reserved.
        </p>

        <LegalDocumentLinks className="register-footer__legal-links" />

        <p>
          TITech Community Capital is technology infrastructure. Feature availability, payment services, and regulated activities depend on applicable law and authorized institutional/provider arrangements.
        </p>
      </footer>
    </main>
  );
}