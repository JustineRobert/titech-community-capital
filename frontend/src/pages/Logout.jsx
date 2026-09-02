// ============================================================================
// TITech Community Capital
// Enterprise Logout Page
// File: frontend/src/pages/Logout.jsx
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Safely terminate the authenticated session
// - Prevent duplicate logout requests
// - Handle auth initialization correctly
// - Treat logout as an idempotent operation
// - Sanitize optional post-logout redirect targets
// - Provide accessible loading, success and failure states
// - Support manual fallback to Login
// - Support controlled retry without page reload
// - Remain compatible with React Strict Mode
// - Avoid exposing authentication/session details
// - Maintain TITech terminology consistently
// - Avoid unsafe/open redirects
// - Clean up timers on unmount
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { toast } from 'react-toastify';

import {
  AlertCircle,
  CheckCircle2,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

import './Logout.css';

// ============================================================================
// Constants
// ============================================================================

const LOGIN_ROUTE = '/login';

const DEFAULT_REDIRECT = LOGIN_ROUTE;

const LOGOUT_TIMEOUT_MS = 15_000;

const SUCCESS_REDIRECT_DELAY_MS = 350;

const ALREADY_LOGGED_OUT_REDIRECT_DELAY_MS = 250;

const MAX_NEXT_LENGTH = 512;

const STATUS = Object.freeze({
  PREPARING: 'preparing',
  LOGGING_OUT: 'logging-out',
  SUCCESS: 'success',
  ALREADY_LOGGED_OUT: 'already-logged-out',
  ERROR: 'error',
  TIMEOUT: 'timeout',
});

// ============================================================================
// Redirect Security
// ============================================================================

/**
 * Determines whether a redirect target is a safe internal application path.
 *
 * Allowed:
 *   /login
 *   /dashboard
 *   /admin
 *   /login?reason=logout
 *
 * Rejected:
 *   https://example.com
 *   //example.com
 *   javascript:...
 *   data:...
 *   mailto:...
 */
const isSafeInternalPath = (value) => {
  if (typeof value !== 'string') {
    return false;
  }

  const candidate = value.trim();

  if (!candidate || candidate.length > MAX_NEXT_LENGTH) {
    return false;
  }

  if (!candidate.startsWith('/')) {
    return false;
  }

  // Prevent protocol-relative redirects.
  if (candidate.startsWith('//')) {
    return false;
  }

  // Prevent javascript:, data:, mailto:, http:, etc.
  if (/^[a-z][a-z\d+\-.]*:/i.test(candidate)) {
    return false;
  }

  // Prevent encoded protocol-relative redirects such as %2F%2F...
  try {
    const decoded = decodeURIComponent(candidate);

    if (decoded.startsWith('//')) {
      return false;
    }

    if (/^[a-z][a-z\d+\-.]*:/i.test(decoded)) {
      return false;
    }
  } catch {
    // Malformed URI encoding is unsafe.
    return false;
  }

  return true;
};

/**
 * Resolves ?next= safely.
 *
 * Any invalid/missing target falls back to /login.
 */
const getSafeRedirectTarget = (search) => {
  try {
    const params = new URLSearchParams(search || '');

    const requestedTarget = params.get('next');

    if (isSafeInternalPath(requestedTarget)) {
      return requestedTarget;
    }
  } catch {
    // Invalid query parameters intentionally fall back to Login.
  }

  return DEFAULT_REDIRECT;
};

// ============================================================================
// Error Helpers
// ============================================================================

const getErrorStatus = (error) => {
  return (
    error?.response?.status ??
    error?.status ??
    error?.statusCode ??
    null
  );
};

const getErrorMessage = (error) => {
  return String(
    error?.response?.data?.message ??
      error?.response?.data?.error ??
      error?.message ??
      '',
  ).toLowerCase();
};

/**
 * Logout is intentionally idempotent.
 *
 * A response indicating that no session exists means the desired final
 * security state has already been achieved.
 */
const isAlreadyLoggedOutError = (error) => {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);

  return (
    status === 401 ||
    status === 204 ||
    message.includes('no active session') ||
    message.includes('already signed out') ||
    message.includes('already logged out') ||
    message.includes('no session') ||
    message.includes('session not found') ||
    message.includes('not authenticated')
  );
};

// ============================================================================
// Component
// ============================================================================

const Logout = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const auth = useAuth();

  const {
    authenticated,
    loading: authLoading,
    logout,
  } = auth ?? {};

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [status, setStatus] = useState(STATUS.PREPARING);

  const [errorMessage, setErrorMessage] = useState('');

  const [attempt, setAttempt] = useState(0);

  // --------------------------------------------------------------------------
  // Refs
  // --------------------------------------------------------------------------

  const mountedRef = useRef(false);

  const logoutStartedRef = useRef(false);

  const redirectingRef = useRef(false);

  const timeoutRef = useRef(null);

  const redirectTimerRef = useRef(null);

  // --------------------------------------------------------------------------
  // Safe redirect target
  // --------------------------------------------------------------------------

  const redirectTarget = useMemo(
    () => getSafeRedirectTarget(location.search),
    [location.search],
  );

  // ==========================================================================
  // Timer Management
  // ==========================================================================

  const clearLogoutTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearRedirectTimer = useCallback(() => {
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearLogoutTimeout();
    clearRedirectTimer();
  }, [
    clearLogoutTimeout,
    clearRedirectTimer,
  ]);

  // ==========================================================================
  // Mount / Unmount
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      clearAllTimers();

      // Prevent callbacks from attempting to reuse the unmounted operation.
      logoutStartedRef.current = false;
    };
  }, [clearAllTimers]);

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const redirectTo = useCallback(
    (target = DEFAULT_REDIRECT) => {
      if (!mountedRef.current) {
        return;
      }

      if (redirectingRef.current) {
        return;
      }

      redirectingRef.current = true;

      clearAllTimers();

      const safeTarget = isSafeInternalPath(target)
        ? target
        : DEFAULT_REDIRECT;

      navigate(safeTarget, {
        replace: true,
      });
    },
    [
      clearAllTimers,
      navigate,
    ],
  );

  const scheduleRedirect = useCallback(
    (
      target,
      delay = SUCCESS_REDIRECT_DELAY_MS,
    ) => {
      if (!mountedRef.current) {
        return;
      }

      clearRedirectTimer();

      redirectTimerRef.current = window.setTimeout(() => {
        redirectTimerRef.current = null;

        redirectTo(target);
      }, delay);
    },
    [
      clearRedirectTimer,
      redirectTo,
    ],
  );

  // ==========================================================================
  // Logout Operation
  // ==========================================================================

  const performLogout = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }

    if (logoutStartedRef.current) {
      return;
    }

    if (typeof logout !== 'function') {
      setStatus(STATUS.ERROR);

      setErrorMessage(
        'The authentication service is temporarily unavailable. You can continue to the Login page.',
      );

      return;
    }

    logoutStartedRef.current = true;

    clearAllTimers();

    setStatus(STATUS.LOGGING_OUT);

    setErrorMessage('');

    // ------------------------------------------------------------------------
    // Defensive UI timeout
    //
    // This does NOT cancel AuthContext's request. AuthContext remains the
    // owner of network cancellation/session state.
    // ------------------------------------------------------------------------

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;

      if (!mountedRef.current) {
        return;
      }

      setStatus(STATUS.TIMEOUT);

      setErrorMessage(
        'The sign-out request is taking longer than expected. You can safely continue to the Login page.',
      );

      logoutStartedRef.current = false;
    }, LOGOUT_TIMEOUT_MS);

    try {
      await logout();

      if (!mountedRef.current) {
        return;
      }

      clearLogoutTimeout();

      setStatus(STATUS.SUCCESS);

      toast.success(
        'You have been securely signed out.',
        {
          autoClose: 2500,
          toastId: 'titech-logout-success',
        },
      );

      scheduleRedirect(
        redirectTarget,
        SUCCESS_REDIRECT_DELAY_MS,
      );
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      clearLogoutTimeout();

      // ----------------------------------------------------------------------
      // Idempotent logout handling
      // ----------------------------------------------------------------------

      if (isAlreadyLoggedOutError(error)) {
        setStatus(STATUS.SUCCESS);

        setErrorMessage('');

        toast.info(
          'Your session has already been signed out.',
          {
            autoClose: 2500,
            toastId: 'titech-logout-already-complete',
          },
        );

        scheduleRedirect(
          redirectTarget,
          SUCCESS_REDIRECT_DELAY_MS,
        );

        return;
      }

      // ----------------------------------------------------------------------
      // Unexpected failure
      // ----------------------------------------------------------------------

      // Do not expose backend/authentication internals to the user.
      // eslint-disable-next-line no-console
      console.error(
        '[TITech Logout] Logout request failed:',
        error,
      );

      setStatus(STATUS.ERROR);

      setErrorMessage(
        'We could not fully confirm the server-side sign-out request. You can safely continue to the Login page.',
      );

      toast.error(
        'Sign-out could not be fully confirmed. Please continue to Login.',
        {
          autoClose: 4500,
          toastId: 'titech-logout-error',
        },
      );

      logoutStartedRef.current = false;
    }
  }, [
    clearAllTimers,
    clearLogoutTimeout,
    logout,
    redirectTarget,
    scheduleRedirect,
  ]);

  // ==========================================================================
  // Initial Logout Trigger
  // ==========================================================================

  useEffect(() => {
    if (authLoading) {
      return undefined;
    }

    if (!mountedRef.current) {
      return undefined;
    }

    // ------------------------------------------------------------------------
    // No active session
    // ------------------------------------------------------------------------

    if (!authenticated) {
      setStatus(STATUS.ALREADY_LOGGED_OUT);

      setErrorMessage('');

      toast.info(
        'You are already signed out.',
        {
          autoClose: 2200,
          toastId: 'titech-already-logged-out',
        },
      );

      scheduleRedirect(
        redirectTarget,
        ALREADY_LOGGED_OUT_REDIRECT_DELAY_MS,
      );

      return undefined;
    }

    // ------------------------------------------------------------------------
    // Prevent duplicate operations.
    //
    // This protects against repeated effect execution, including React
    // Strict Mode development behavior.
    // ------------------------------------------------------------------------

    if (logoutStartedRef.current) {
      return undefined;
    }

    performLogout();

    return undefined;
  }, [
    authLoading,
    authenticated,
    performLogout,
    redirectTarget,
    scheduleRedirect,
  ]);

  // ==========================================================================
  // Retry
  // ==========================================================================

  const handleRetry = useCallback(() => {
    if (authLoading) {
      return;
    }

    if (logoutStartedRef.current) {
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    setAttempt((current) => current + 1);

    performLogout();
  }, [
    authLoading,
    performLogout,
  ]);

  // ==========================================================================
  // Manual Login Fallback
  // ==========================================================================

  const handleGoToLogin = useCallback(() => {
    redirectTo(LOGIN_ROUTE);
  }, [redirectTo]);

  // ==========================================================================
  // Status Presentation
  // ==========================================================================

  const statusContent = useMemo(() => {
    switch (status) {
      case STATUS.SUCCESS:
        return {
          icon: (
            <CheckCircle2
              aria-hidden="true"
            />
          ),
          title: 'Signed out successfully',
          description:
            'Your TITech Community Capital session has been securely closed.',
        };

      case STATUS.ALREADY_LOGGED_OUT:
        return {
          icon: (
            <ShieldCheck
              aria-hidden="true"
            />
          ),
          title: 'Already signed out',
          description:
            'There is no active TITech Community Capital session on this device.',
        };

      case STATUS.ERROR:
        return {
          icon: (
            <AlertCircle
              aria-hidden="true"
            />
          ),
          title: 'Sign-out needs attention',
          description:
            errorMessage ||
            'We could not fully confirm the sign-out request.',
        };

      case STATUS.TIMEOUT:
        return {
          icon: (
            <AlertCircle
              aria-hidden="true"
            />
          ),
          title: 'Sign-out is taking longer than expected',
          description:
            errorMessage ||
            'The sign-out request has not completed yet.',
        };

      case STATUS.LOGGING_OUT:
        return {
          icon: (
            <LogOut
              aria-hidden="true"
            />
          ),
          title: 'Signing you out',
          description:
            'Please wait while we securely close your TITech Community Capital session.',
        };

      case STATUS.PREPARING:
      default:
        return {
          icon: (
            <RefreshCw
              aria-hidden="true"
            />
          ),
          title: 'Preparing to sign out',
          description:
            'Checking your session and preparing a secure sign-out.',
        };
    }
  }, [
    errorMessage,
    status,
  ]);

  const isBusy =
    status === STATUS.PREPARING ||
    status === STATUS.LOGGING_OUT;

  const showRetry =
    status === STATUS.ERROR ||
    status === STATUS.TIMEOUT;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main
      className="logout-page"
      aria-labelledby="logout-heading"
    >
      <section
        className="logout-card"
        aria-describedby="logout-description"
      >
        <div
          className={`logout-icon ${
            isBusy
              ? 'logout-icon--loading'
              : ''
          }`}
          aria-hidden="true"
        >
          {statusContent.icon}
        </div>

        <div className="logout-content">
          <p className="logout-brand">
            TITech Community Capital
          </p>

          <h1
            id="logout-heading"
            className="logout-heading"
          >
            {statusContent.title}
          </h1>

          <p
            id="logout-description"
            className="logout-description"
          >
            {statusContent.description}
          </p>

          {isBusy && (
            <div
              className="logout-progress"
              role="status"
              aria-live="polite"
            >
              <span
                className="logout-spinner"
                aria-hidden="true"
              />

              <span>
                Securing your session...
              </span>
            </div>
          )}

          {showRetry && (
            <div
              className="logout-error"
              role="alert"
              aria-live="assertive"
            >
              <AlertCircle
                size={18}
                aria-hidden="true"
              />

              <span>
                {errorMessage}
              </span>
            </div>
          )}

          <div className="logout-actions">
            {showRetry && (
              <button
                type="button"
                className="logout-button logout-button--primary"
                onClick={handleRetry}
                disabled={
                  authLoading ||
                  logoutStartedRef.current
                }
              >
                <RefreshCw
                  size={17}
                  aria-hidden="true"
                />

                <span>
                  Try again
                </span>
              </button>
            )}

            <button
              type="button"
              className={`logout-button ${
                showRetry
                  ? 'logout-button--secondary'
                  : 'logout-button--primary'
              }`}
              onClick={handleGoToLogin}
            >
              <LogOut
                size={17}
                aria-hidden="true"
              />

              <span>
                Go to Login
              </span>
            </button>
          </div>

          {attempt > 0 && (
            <p
              className="logout-attempt"
              aria-live="polite"
            >
              Sign-out retry attempt {attempt}
            </p>
          )}
        </div>
      </section>

      <footer className="logout-footer">
        <p>
          © {new Date().getFullYear()} TITech Community Capital.
          <br />
          Your security and privacy matter to us.
        </p>
      </footer>
    </main>
  );
};

export default Logout;