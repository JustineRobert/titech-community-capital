// ============================================================================
// TITech Community Capital
// Enterprise 404 / Not Found Page
// File: frontend/src/pages/NotFound.jsx
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Provide a professional 404 experience
// - Maintain consistent TITech Community Capital branding
// - Provide safe navigation to authenticated/public entry points
// - Support browser history navigation
// - Provide accessible semantic structure
// - Support keyboard navigation and screen readers
// - Avoid exposing internal routing or application details
// - Remain responsive across desktop, tablet and mobile devices
// - Remain compatible with React Router
// - Avoid unnecessary dependencies
// ============================================================================

import React, { useCallback } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Compass,
  Home,
  Search,
  ShieldAlert,
} from 'lucide-react';

import {
  Link,
  useNavigate,
} from 'react-router-dom';

// ============================================================================
// Constants
// ============================================================================

const HOME_ROUTE = '/dashboard';
const LOGIN_ROUTE = '/login';

// ============================================================================
// Helper Components
// ============================================================================

/**
 * ActionButton
 *
 * Small internal abstraction used to keep navigation actions consistent.
 */
function ActionButton({
  children,
  icon: Icon,
  to,
  onClick,
  variant = 'primary',
  type = 'button',
  ariaLabel,
}) {
  const className = [
    'not-found-button',
    `not-found-button--${variant}`,
  ].join(' ');

  if (to) {
    return (
      <Link
        to={to}
        className={className}
        aria-label={ariaLabel}
      >
        {Icon && (
          <Icon
            size={18}
            strokeWidth={2}
            aria-hidden="true"
          />
        )}

        <span>{children}</span>
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {Icon && (
        <Icon
          size={18}
          strokeWidth={2}
          aria-hidden="true"
        />
      )}

      <span>{children}</span>
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function NotFound() {
  const navigate = useNavigate();

  // --------------------------------------------------------------------------
  // Browser History
  // --------------------------------------------------------------------------

  const handleGoBack = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      window.history.length > 1
    ) {
      navigate(-1);
      return;
    }

    navigate(HOME_ROUTE, {
      replace: true,
    });
  }, [navigate]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <main
      className="not-found-page"
      aria-labelledby="not-found-heading"
    >
      <div className="not-found-background" aria-hidden="true">
        <div className="not-found-background-orb not-found-background-orb--one" />
        <div className="not-found-background-orb not-found-background-orb--two" />
      </div>

      <section
        className="not-found-card"
        aria-describedby="not-found-description"
      >
        {/* ====================================================================
            Brand
            ==================================================================== */}

        <div className="not-found-brand">
          <div
            className="not-found-brand-mark"
            aria-hidden="true"
          >
            <Compass
              size={22}
              strokeWidth={2}
            />
          </div>

          <span>
            TITech Community Capital
          </span>
        </div>

        {/* ====================================================================
            Error Illustration
            ==================================================================== */}

        <div
          className="not-found-illustration"
          aria-hidden="true"
        >
          <div className="not-found-illustration-ring">
            <ShieldAlert
              size={42}
              strokeWidth={1.7}
            />
          </div>

          <span className="not-found-code">
            404
          </span>
        </div>

        {/* ====================================================================
            Content
            ==================================================================== */}

        <div className="not-found-content">
          <p className="not-found-eyebrow">
            Page unavailable
          </p>

          <h1
            id="not-found-heading"
            className="not-found-heading"
          >
            Page not found
          </h1>

          <p
            id="not-found-description"
            className="not-found-description"
          >
            Sorry, we couldn't find the page you're looking for.
            It may have been moved, removed, or the address may be
            incorrect.
          </p>
        </div>

        {/* ====================================================================
            Primary Actions
            ==================================================================== */}

        <nav
          className="not-found-actions"
          aria-label="404 page navigation"
        >
          <ActionButton
            to={HOME_ROUTE}
            icon={Home}
            variant="primary"
          >
            Go to Dashboard
          </ActionButton>

          <ActionButton
            to={LOGIN_ROUTE}
            icon={ArrowRight}
            variant="secondary"
          >
            Go to Login
          </ActionButton>

          <ActionButton
            onClick={handleGoBack}
            icon={ArrowLeft}
            variant="ghost"
          >
            Go Back
          </ActionButton>
        </nav>

        {/* ====================================================================
            Helpful Guidance
            ==================================================================== */}

        <div className="not-found-help">
          <Search
            size={17}
            strokeWidth={2}
            aria-hidden="true"
          />

          <p>
            Check the web address or use one of the navigation
            options above to continue.
          </p>
        </div>
      </section>

      {/* ======================================================================
          Footer
          ====================================================================== */}

      <footer className="not-found-footer">
        <p>
          © {new Date().getFullYear()} TITech Community Capital.
        </p>

        <span aria-hidden="true">
          •
        </span>

        <p>
          Secure community finance infrastructure.
        </p>
      </footer>
    </main>
  );
}