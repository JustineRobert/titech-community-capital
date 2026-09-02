'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal Pages
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/LegalPages.jsx
 *
 * Version:
 *   2026.3
 *
 * Classification:
 *   Production / Enterprise
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Centralized legal-document presentation layer for:
 *
 *   • Terms of Service
 *   • Privacy Policy
 *   • General Disclaimer
 *   • Financial Disclaimer
 *   • Legal Contact Information
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 *   ✓ WCAG-oriented accessibility
 *   ✓ Keyboard navigation
 *   ✓ Screen-reader friendly landmarks
 *   ✓ Responsive document layout
 *   ✓ Mobile navigation drawer
 *   ✓ Focus management
 *   ✓ Deep-link / hash navigation
 *   ✓ Browser back/forward hash support
 *   ✓ Active-section tracking
 *   ✓ Reduced-motion support
 *   ✓ Print support
 *   ✓ Scroll-to-top support
 *   ✓ SEO metadata
 *   ✓ Open Graph metadata
 *   ✓ Twitter metadata
 *   ✓ Canonical URL support
 *   ✓ Safe static legal-content rendering
 *   ✓ No authentication dependency
 *   ✓ No financial transaction processing
 *   ✓ No direct API/database access
 *   ✓ TITech terminology consistency
 *   ✓ SSR-safe browser API usage
 *   ✓ Defensive DOM handling
 *
 * IMPORTANT LEGAL NOTICE
 * ----------------------------------------------------------------------------
 * The legal content contained in this component is application-facing
 * documentation and should be reviewed, approved, and maintained by qualified
 * legal/privacy professionals before being relied upon as final legal advice
 * or contractual documentation.
 *
 * ============================================================================
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  Link,
  useLocation,
} from 'react-router-dom';

import {
  AlertTriangle,
  ChevronUp,
  FileText,
  Home,
  Lock,
  Menu,
  Printer,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';

import './Legal.css';

/* ============================================================================
 * APPLICATION / LEGAL METADATA
 * ========================================================================== */

const LEGAL_CONFIG = Object.freeze({
  brandName:
    'TITech Community Capital',

  brandShortName:
    'TITech Community Capital',

  pageTitle:
    'TITech Community Capital | Legal Information',

  pageDescription:
    'Terms of Service, Privacy Policy, financial disclaimer, and legal information for TITech Community Capital.',

  legalVersion:
    '1.0',

  legalLastUpdated:
    'January 15, 2026',

  legalEffectiveDate:
    'January 15, 2026',

  legalEmail:
    'legal@titechcommunity.app',

  legalPhone:
    '+256782397907',

  legalPhoneDisplay:
    '+256 (782) 397907',

  legalAddress:
    'Kampala, Uganda',

  robots:
    'index,follow',

  canonicalPath:
    '/legal',
});

/* ============================================================================
 * BEHAVIOUR CONFIGURATION
 * ========================================================================== */

const LEGAL_UI_CONFIG = Object.freeze({
  scrollTopThreshold:
    420,

  sectionScrollOffset:
    20,

  hashNavigationReleaseDelay:
    650,

  deepLinkDelay:
    100,

  focusDelay:
    150,

  activeSectionRootMargin:
    '-8% 0px -70% 0px',

  activeSectionThresholds:
    Object.freeze([
      0,
      0.1,
      0.25,
      0.5,
    ]),
});

/* ============================================================================
 * SECTION ALLOW-LIST
 * ========================================================================== */

/**
 * Explicit allow-list of navigable legal sections.
 *
 * This prevents arbitrary URL hash values from being interpreted as
 * navigation targets.
 */
const SECTION_IDS = Object.freeze([
  'tos-1',
  'tos-2',
  'tos-3',
  'tos-4',
  'tos-5',
  'tos-6',
  'pp-1',
  'pp-2',
  'pp-3',
  'pp-4',
  'pp-5',
  'pp-6',
  'disclaimer',
  'financial-disclaimer',
  'contact-legal',
]);

/* ============================================================================
 * NAVIGATION DEFINITION
 * ========================================================================== */

const NAV_SECTIONS = Object.freeze([
  {
    id: 'terms',
    title: 'Terms of Service',
    icon: Scale,
    links: [
      {
        id: 'tos-1',
        label: '1. Acceptance of Terms',
      },
      {
        id: 'tos-2',
        label: '2. User Rights & Responsibilities',
      },
      {
        id: 'tos-3',
        label: '3. User Conduct',
      },
      {
        id: 'tos-4',
        label: '4. Payment Terms',
      },
      {
        id: 'tos-5',
        label: '5. Loan Agreements',
      },
      {
        id: 'tos-6',
        label: '6. Limitation of Liability',
      },
    ],
  },

  {
    id: 'privacy',
    title: 'Privacy Policy',
    icon: ShieldCheck,
    links: [
      {
        id: 'pp-1',
        label: '1. Information We Collect',
      },
      {
        id: 'pp-2',
        label: '2. How We Use Information',
      },
      {
        id: 'pp-3',
        label: '3. Data Security',
      },
      {
        id: 'pp-4',
        label: '4. Your Privacy Rights',
      },
      {
        id: 'pp-5',
        label: '5. Cookies & Tracking',
      },
      {
        id: 'pp-6',
        label: '6. Third-Party Services',
      },
    ],
  },

  {
    id: 'disclaimer-section',
    title: 'Disclaimer',
    icon: AlertTriangle,
    links: [
      {
        id: 'disclaimer',
        label: 'General Disclaimer',
      },
      {
        id: 'financial-disclaimer',
        label: 'Financial Disclaimer',
      },
      {
        id: 'contact-legal',
        label: 'Contact Legal',
      },
    ],
  },
]);

/* ============================================================================
 * UTILITY FUNCTIONS
 * ========================================================================== */

function isBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

function prefersReducedMotion() {
  if (
    !isBrowser() ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return Boolean(
    window
      .matchMedia(
        '(prefers-reduced-motion: reduce)',
      )
      ?.matches,
  );
}

function isValidSectionId(id) {
  return (
    typeof id === 'string' &&
    SECTION_IDS.includes(id)
  );
}

function getLegalSection(id) {
  if (
    !isBrowser() ||
    !isValidSectionId(id)
  ) {
    return null;
  }

  return document.getElementById(id);
}

function getLegalSectionElements() {
  if (!isBrowser()) {
    return [];
  }

  return SECTION_IDS
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function getCurrentHash() {
  if (!isBrowser()) {
    return null;
  }

  const rawHash =
    window.location.hash?.replace(
      /^#/,
      '',
    );

  if (!rawHash) {
    return null;
  }

  try {
    const decoded =
      decodeURIComponent(rawHash);

    return isValidSectionId(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

function buildCurrentUrl(hash = null) {
  if (!isBrowser()) {
    return '';
  }

  const base =
    `${window.location.pathname}` +
    `${window.location.search}`;

  return hash
    ? `${base}#${encodeURIComponent(hash)}`
    : base;
}

function updateHash(id) {
  if (
    !isBrowser() ||
    !window.history?.replaceState ||
    !isValidSectionId(id)
  ) {
    return;
  }

  const nextUrl =
    buildCurrentUrl(id);

  if (
    window.location.href ===
    `${window.location.origin}${nextUrl}`
  ) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    '',
    nextUrl,
  );
}

function clearHash() {
  if (
    !isBrowser() ||
    !window.history?.replaceState
  ) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    '',
    buildCurrentUrl(),
  );
}

/* ============================================================================
 * SEO / DOCUMENT METADATA
 * ========================================================================== */

function upsertMetaTag({
  selector,
  attributes,
}) {
  if (!isBrowser()) {
    return null;
  }

  let element =
    document.head.querySelector(
      selector,
    );

  if (!element) {
    element =
      document.createElement('meta');

    Object.entries(attributes).forEach(
      ([key, value]) => {
        element.setAttribute(
          key,
          value,
        );
      },
    );

    document.head.appendChild(
      element,
    );
  } else {
    Object.entries(attributes).forEach(
      ([key, value]) => {
        element.setAttribute(
          key,
          value,
        );
      },
    );
  }

  return element;
}

function upsertCanonicalLink(href) {
  if (!isBrowser()) {
    return null;
  }

  let link =
    document.head.querySelector(
      'link[rel="canonical"]',
    );

  if (!link) {
    link =
      document.createElement('link');

    link.setAttribute(
      'rel',
      'canonical',
    );

    document.head.appendChild(
      link,
    );
  }

  link.setAttribute(
    'href',
    href,
  );

  return link;
}

function useLegalMetadata() {
  useEffect(() => {
    if (!isBrowser()) {
      return undefined;
    }

    const previousTitle =
      document.title;

    const managedMetaSelectors =
      Object.freeze([
        'meta[name="description"]',
        'meta[name="robots"]',
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[property="og:type"]',
        'meta[property="og:url"]',
        'meta[name="twitter:card"]',
        'meta[name="twitter:title"]',
        'meta[name="twitter:description"]',
      ]);

    const previousMeta =
      managedMetaSelectors.map(
        (selector) => {
          const element =
            document.head.querySelector(
              selector,
            );

          return {
            selector,
            element,
            content:
              element?.getAttribute(
                'content',
              ) ?? null,
          };
        },
      );

    const previousCanonical =
      document.head.querySelector(
        'link[rel="canonical"]',
      );

    const previousCanonicalHref =
      previousCanonical?.getAttribute(
        'href',
      ) ?? null;

    document.title =
      LEGAL_CONFIG.pageTitle;

    upsertMetaTag({
      selector:
        'meta[name="description"]',
      attributes: {
        name: 'description',
        content:
          LEGAL_CONFIG.pageDescription,
      },
    });

    upsertMetaTag({
      selector:
        'meta[name="robots"]',
      attributes: {
        name: 'robots',
        content:
          LEGAL_CONFIG.robots,
      },
    });

    upsertMetaTag({
      selector:
        'meta[property="og:title"]',
      attributes: {
        property: 'og:title',
        content:
          LEGAL_CONFIG.pageTitle,
      },
    });

    upsertMetaTag({
      selector:
        'meta[property="og:description"]',
      attributes: {
        property: 'og:description',
        content:
          LEGAL_CONFIG.pageDescription,
      },
    });

    upsertMetaTag({
      selector:
        'meta[property="og:type"]',
      attributes: {
        property: 'og:type',
        content: 'website',
      },
    });

    upsertMetaTag({
      selector:
        'meta[property="og:url"]',
      attributes: {
        property: 'og:url',
        content:
          `${window.location.origin}${LEGAL_CONFIG.canonicalPath}`,
      },
    });

    upsertMetaTag({
      selector:
        'meta[name="twitter:card"]',
      attributes: {
        name: 'twitter:card',
        content: 'summary',
      },
    });

    upsertMetaTag({
      selector:
        'meta[name="twitter:title"]',
      attributes: {
        name: 'twitter:title',
        content:
          LEGAL_CONFIG.pageTitle,
      },
    });

    upsertMetaTag({
      selector:
        'meta[name="twitter:description"]',
      attributes: {
        name: 'twitter:description',
        content:
          LEGAL_CONFIG.pageDescription,
      },
    });

    upsertCanonicalLink(
      `${window.location.origin}${LEGAL_CONFIG.canonicalPath}`,
    );

    return () => {
      document.title =
        previousTitle;

      previousMeta.forEach(
        ({
          selector,
          element,
          content,
        }) => {
          if (element) {
            if (content === null) {
              element.removeAttribute(
                'content',
              );
            } else {
              element.setAttribute(
                'content',
                content,
              );
            }

            return;
          }

          document.head
            .querySelector(selector)
            ?.remove();
        },
      );

      const currentCanonical =
        document.head.querySelector(
          'link[rel="canonical"]',
        );

      if (previousCanonical) {
        if (currentCanonical) {
          if (
            previousCanonicalHref ===
            null
          ) {
            currentCanonical.removeAttribute(
              'href',
            );
          } else {
            currentCanonical.setAttribute(
              'href',
              previousCanonicalHref,
            );
          }
        }
      } else {
        currentCanonical?.remove();
      }
    };
  }, []);
}

/* ============================================================================
 * LEGAL PAGE HEADER
 * ========================================================================== */

function LegalPageHeader({
  onOpenMobileNavigation,
}) {
  return (
    <header className="legal-header">
      <div className="legal-header-content">
        <div className="legal-header-top-row">
          <div
            className="legal-header-badge"
            aria-label={
              LEGAL_CONFIG.brandName
            }
          >
            <ShieldCheck
              size={20}
              aria-hidden="true"
            />

            <span>
              {LEGAL_CONFIG.brandShortName}
            </span>
          </div>

          <button
            type="button"
            className="legal-mobile-menu-button"
            onClick={
              onOpenMobileNavigation
            }
            aria-label="Open legal document navigation"
            aria-controls="legal-mobile-navigation"
            aria-expanded="false"
          >
            <Menu
              size={22}
              aria-hidden="true"
            />

            <span className="sr-only">
              Open legal navigation
            </span>
          </button>
        </div>

        <h1 className="legal-title">
          Legal Information
        </h1>

        <p className="legal-subtitle">
          Terms of Service, Privacy Policy &amp;
          Disclaimer
        </p>

        <p className="legal-description">
          Please review these legal documents carefully.
          They explain the terms governing your use of the{' '}
          {LEGAL_CONFIG.brandName} Platform, our approach
          to privacy and data protection, and important
          financial, operational, and technology-related
          disclaimers.
        </p>

        <div
          className="legal-header-meta"
          aria-label="Legal document metadata"
        >
          <span>
            <strong>
              Last updated:
            </strong>{' '}
            {LEGAL_CONFIG.legalLastUpdated}
          </span>

          <span aria-hidden="true">
            •
          </span>

          <span>
            <strong>
              Effective:
            </strong>{' '}
            {LEGAL_CONFIG.legalEffectiveDate}
          </span>

          <span aria-hidden="true">
            •
          </span>

          <span>
            <strong>
              Version:
            </strong>{' '}
            {LEGAL_CONFIG.legalVersion}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ============================================================================
 * LEGAL NAVIGATION
 * ========================================================================== */

function LegalNavigation({
  navigation,
  activeSection,
  onSectionNavigation,
  onPrint,
  mobile = false,
  onClose,
  closeButtonRef,
}) {
  const navigationId =
    mobile
      ? 'legal-mobile-navigation'
      : 'legal-desktop-navigation';

  return (
    <aside
      id={navigationId}
      className={
        mobile
          ? 'legal-sidebar legal-sidebar-mobile'
          : 'legal-sidebar'
      }
      aria-label="Legal document navigation"
    >
      {mobile && (
        <div className="legal-mobile-nav-header">
          <strong>
            Legal Navigation
          </strong>

          <button
            ref={closeButtonRef}
            type="button"
            className="legal-mobile-close-button"
            onClick={onClose}
            aria-label="Close legal document navigation"
          >
            <X
              size={20}
              aria-hidden="true"
            />

            <span className="sr-only">
              Close legal navigation
            </span>
          </button>
        </div>
      )}

      <nav
        className="legal-nav"
        aria-label="Legal sections"
      >
        {navigation.map(
          (section) => {
            const SectionIcon =
              section.icon;

            return (
              <div
                className="nav-section"
                key={section.id}
              >
                <h2 className="nav-section-title">
                  <SectionIcon
                    size={16}
                    aria-hidden="true"
                  />

                  <span>
                    {section.title}
                  </span>
                </h2>

                <div className="nav-section-links">
                  {section.links.map(
                    (link) => {
                      const isActive =
                        activeSection ===
                        link.id;

                      return (
                        <a
                          key={link.id}
                          href={`#${link.id}`}
                          className={
                            `nav-link${
                              isActive
                                ? ' active'
                                : ''
                            }`
                          }
                          aria-current={
                            isActive
                              ? 'location'
                              : undefined
                          }
                          onClick={(
                            event,
                          ) =>
                            onSectionNavigation(
                              event,
                              link.id,
                            )
                          }
                        >
                          {link.label}
                        </a>
                      );
                    },
                  )}
                </div>
              </div>
            );
          },
        )}
      </nav>

      <div className="legal-nav-actions">
        <Link
          to="/dashboard"
          className="nav-action-link"
          title="Return to dashboard"
          aria-label={
            `Return to ${LEGAL_CONFIG.brandName} dashboard`
          }
          onClick={onClose}
        >
          <Home
            size={18}
            aria-hidden="true"
          />

          <span>
            Dashboard
          </span>
        </Link>

        <button
          type="button"
          className="nav-action-link"
          onClick={() => {
            onPrint();
            onClose?.();
          }}
          title="Print legal documents"
          aria-label="Print legal documents"
        >
          <Printer
            size={18}
            aria-hidden="true"
          />

          <span>
            Print
          </span>
        </button>
      </div>
    </aside>
  );
}

/* ============================================================================
 * TERMS OF SERVICE
 * ========================================================================== */

function TermsOfService() {
  return (
    <section
      className="legal-major-section"
      aria-labelledby="terms-title"
    >
      <div className="legal-major-heading">
        <div
          className="legal-major-icon"
          aria-hidden="true"
        >
          <Scale size={24} />
        </div>

        <div>
          <h2
            id="terms-title"
            className="major-title"
          >
            Terms of Service
          </h2>

          <p className="section-update">
            Last updated:{' '}
            {LEGAL_CONFIG.legalLastUpdated}
          </p>
        </div>
      </div>

      <section
        id="tos-1"
        className="legal-section"
        aria-labelledby="tos-1-title"
        tabIndex={-1}
      >
        <h3 id="tos-1-title">
          1. Acceptance of Terms
        </h3>

        <p>
          By accessing or using the{' '}
          {LEGAL_CONFIG.brandName} Platform, you
          acknowledge that you have read, understood, and
          agree to be bound by these Terms of Service and
          applicable laws and regulations.
        </p>

        <p>
          If you do not agree with these Terms, you should
          discontinue use of the Platform.{' '}
          {LEGAL_CONFIG.brandName} may update these Terms
          from time to time. Continued use following
          publication of material changes constitutes
          acceptance of the revised Terms to the extent
          permitted by applicable law.
        </p>
      </section>

      <section
        id="tos-2"
        className="legal-section"
        aria-labelledby="tos-2-title"
        tabIndex={-1}
      >
        <h3 id="tos-2-title">
          2. User Rights &amp; Responsibilities
        </h3>

        <p>
          Subject to these Terms,{' '}
          {LEGAL_CONFIG.brandName} grants you a limited,
          non-exclusive, non-transferable right to access
          and use the Platform for lawful purposes.
        </p>

        <h4>
          User Responsibilities
        </h4>

        <ul>
          <li>
            Maintain the confidentiality of your account
            credentials.
          </li>

          <li>
            Accept responsibility for activity performed
            through your account.
          </li>

          <li>
            Provide accurate, complete, and current
            registration information.
          </li>

          <li>
            Comply with applicable laws, regulations,
            policies, and contractual obligations.
          </li>

          <li>
            Avoid using the Platform for illegal,
            fraudulent, deceptive, or unauthorized
            purposes.
          </li>

          <li>
            Keep your contact and account information
            reasonably current.
          </li>
        </ul>
      </section>

      <section
        id="tos-3"
        className="legal-section"
        aria-labelledby="tos-3-title"
        tabIndex={-1}
      >
        <h3 id="tos-3-title">
          3. User Conduct
        </h3>

        <p>
          You agree not to misuse the Platform or
          interfere with the rights, security,
          availability, integrity, or operation of{' '}
          {LEGAL_CONFIG.brandName} or its users.
        </p>

        <ul>
          <li>
            Harass, threaten, intimidate, or deliberately
            cause distress to another person.
          </li>

          <li>
            Engage in fraud, impersonation,
            misrepresentation, or deception.
          </li>

          <li>
            Attempt to gain unauthorized access to
            systems, accounts, APIs, or data.
          </li>

          <li>
            Upload or transmit malicious, harmful, or
            unlawful content.
          </li>

          <li>
            Infringe intellectual property, privacy, or
            other legal rights.
          </li>

          <li>
            Interfere with the availability, integrity,
            or normal operation of the Platform.
          </li>

          <li>
            Send unsolicited commercial messages, spam,
            or abusive communications.
          </li>

          <li>
            Attempt to reverse engineer, decompile, or
            improperly discover protected implementation
            details.
          </li>

          <li>
            Use the Platform for money laundering,
            terrorist financing, fraud, or other unlawful
            financial activity.
          </li>

          <li>
            Engage in unlawful discrimination,
            harassment, or abusive conduct.
          </li>
        </ul>
      </section>

      <section
        id="tos-4"
        className="legal-section"
        aria-labelledby="tos-4-title"
        tabIndex={-1}
      >
        <h3 id="tos-4-title">
          4. Payment Terms
        </h3>

        <p>
          {LEGAL_CONFIG.brandName} may provide technology
          that facilitates or records financial activity
          between authorized participants. Specific
          payment services may depend on approved payment
          providers and applicable regulatory requirements.
        </p>

        <h4>
          Payment Processing
        </h4>

        <ul>
          <li>
            Transactions must use authorized payment
            channels.
          </li>

          <li>
            Payment processing may involve third-party
            financial or payment service providers.
          </li>

          <li>
            Processing times may vary depending on the
            selected provider and financial institution.
          </li>

          <li>
            A transaction may fail, be delayed, reversed,
            rejected, or placed under review.
          </li>

          <li>
            Users may be responsible for fees imposed by
            their financial institution or payment
            provider.
          </li>

          <li>
            Transaction records should be reviewed
            promptly and discrepancies reported through
            appropriate support channels.
          </li>
        </ul>

        <h4>
          Refunds &amp; Reversals
        </h4>

        <ul>
          <li>
            Refunds or reversals are subject to the
            nature of the transaction and applicable
            provider rules.
          </li>

          <li>
            Certain completed financial transactions
            may not be reversible.
          </li>

          <li>
            Transaction disputes should be reported as
            soon as reasonably possible.
          </li>

          <li>
            Resolution may require coordination with a
            payment provider or financial institution.
          </li>
        </ul>
      </section>

      <section
        id="tos-5"
        className="legal-section"
        aria-labelledby="tos-5-title"
        tabIndex={-1}
      >
        <h3 id="tos-5-title">
          5. Loan Agreements
        </h3>

        <p>
          Where the Platform supports community lending,
          loan arrangements may be established between
          authorized participants subject to group rules
          and applicable law.
        </p>

        <ul>
          <li>
            Loan terms should be clearly agreed by the
            relevant parties.
          </li>

          <li>
            Repayment schedules and applicable charges
            should be documented.
          </li>

          <li>
            {LEGAL_CONFIG.brandName} does not guarantee
            repayment unless expressly stated in a
            separate binding agreement.
          </li>

          <li>
            Loan defaults and disputes may require direct
            resolution between the parties or appropriate
            legal processes.
          </li>

          <li>
            Users are responsible for understanding the
            risks associated with lending and borrowing.
          </li>

          <li>
            Loan arrangements must comply with applicable
            laws and regulatory requirements.
          </li>
        </ul>

        <div
          className="highlight"
          role="note"
        >
          <strong>
            Important:
          </strong>{' '}
          {LEGAL_CONFIG.brandName} is a technology
          platform and does not, by itself, constitute a
          licensed financial institution or provider of
          personalized financial or legal advice.
        </div>
      </section>

      <section
        id="tos-6"
        className="legal-section"
        aria-labelledby="tos-6-title"
        tabIndex={-1}
      >
        <h3 id="tos-6-title">
          6. Limitation of Liability
        </h3>

        <p>
          To the fullest extent permitted by applicable
          law, {LEGAL_CONFIG.brandName} will not be liable
          for indirect, incidental, special, consequential,
          or punitive damages arising from use of the
          Platform, including loss of profits, revenue,
          data, or business opportunities.
        </p>

        <p>
          Nothing in these Terms excludes or limits
          liability that cannot lawfully be excluded or
          limited under applicable law.
        </p>

        <p>
          Where a limitation of liability is legally
          enforceable, {LEGAL_CONFIG.brandName}'s aggregate
          liability will be limited to the maximum extent
          permitted by applicable law.
        </p>
      </section>
    </section>
  );
}

/* ============================================================================
 * PRIVACY POLICY
 * ========================================================================== */

function PrivacyPolicy() {
  return (
    <section
      className="legal-major-section"
      aria-labelledby="privacy-title"
    >
      <div className="legal-major-heading">
        <div
          className="legal-major-icon"
          aria-hidden="true"
        >
          <Lock size={24} />
        </div>

        <div>
          <h2
            id="privacy-title"
            className="major-title"
          >
            Privacy Policy
          </h2>

          <p className="section-update">
            Last updated:{' '}
            {LEGAL_CONFIG.legalLastUpdated}
          </p>
        </div>
      </div>

      <section
        id="pp-1"
        className="legal-section"
        aria-labelledby="pp-1-title"
        tabIndex={-1}
      >
        <h3 id="pp-1-title">
          1. Information We Collect
        </h3>

        <p>
          We collect information necessary to operate
          the {LEGAL_CONFIG.brandName} Platform, provide
          requested services, maintain security, and comply
          with applicable legal obligations.
        </p>

        <h4>
          Information You Provide
        </h4>

        <ul>
          <li>
            Name and contact information.
          </li>

          <li>
            Phone number and address information.
          </li>

          <li>
            Identification and verification information
            where required.
          </li>

          <li>
            Financial and transaction-related information
            necessary to provide requested services.
          </li>

          <li>
            Profile and account information you choose to
            provide.
          </li>
        </ul>

        <h4>
          Automatically Collected Information
        </h4>

        <ul>
          <li>
            Device type, operating system, browser, and
            application information.
          </li>

          <li>
            IP address, timestamps, access records, and
            technical logs.
          </li>

          <li>
            Security and fraud-prevention signals.
          </li>

          <li>
            Cookies and similar technologies where
            applicable.
          </li>

          <li>
            Location information where enabled and
            permitted.
          </li>
        </ul>
      </section>

      <section
        id="pp-2"
        className="legal-section"
        aria-labelledby="pp-2-title"
        tabIndex={-1}
      >
        <h3 id="pp-2-title">
          2. How We Use Information
        </h3>

        <p>
          We may use collected information to:
        </p>

        <ul>
          <li>
            Provide, operate, maintain, and improve the
            Platform.
          </li>

          <li>
            Authenticate users and manage accounts.
          </li>

          <li>
            Process, record, reconcile, and communicate
            transaction information.
          </li>

          <li>
            Detect, investigate, and prevent fraud, abuse,
            unauthorized activity, and security incidents.
          </li>

          <li>
            Provide customer support and respond to
            inquiries.
          </li>

          <li>
            Send service communications and, where legally
            permitted, promotional communications.
          </li>

          <li>
            Meet legal, regulatory, accounting, and
            compliance obligations.
          </li>

          <li>
            Analyze system performance and improve
            reliability and user experience.
          </li>
        </ul>
      </section>

      <section
        id="pp-3"
        className="legal-section"
        aria-labelledby="pp-3-title"
        tabIndex={-1}
      >
        <h3 id="pp-3-title">
          3. Data Security
        </h3>

        <p>
          {LEGAL_CONFIG.brandName} maintains technical
          and organizational safeguards designed to
          protect personal information against
          unauthorized access, alteration, disclosure,
          destruction, and misuse.
        </p>

        <ul>
          <li>
            Encryption for sensitive data in transit.
          </li>

          <li>
            Secure credential storage and authentication
            controls.
          </li>

          <li>
            Access controls based on operational
            requirements and authorization.
          </li>

          <li>
            Security monitoring and audit logging.
          </li>

          <li>
            Backup and recovery controls appropriate to
            the service.
          </li>

          <li>
            Security testing and vulnerability management
            processes.
          </li>
        </ul>

        <p>
          No internet-based service can guarantee absolute
          security. Users should also protect their
          credentials and promptly report suspected
          unauthorized activity.
        </p>
      </section>

      <section
        id="pp-4"
        className="legal-section"
        aria-labelledby="pp-4-title"
        tabIndex={-1}
      >
        <h3 id="pp-4-title">
          4. Your Privacy Rights
        </h3>

        <p>
          Depending on applicable law and your location,
          you may have rights concerning your personal
          information, including:
        </p>

        <ul>
          <li>
            <strong>
              Access:
            </strong>{' '}
            Request access to personal information we hold
            about you.
          </li>

          <li>
            <strong>
              Rectification:
            </strong>{' '}
            Request correction of inaccurate or incomplete
            information.
          </li>

          <li>
            <strong>
              Erasure:
            </strong>{' '}
            Request deletion where legally permitted.
          </li>

          <li>
            <strong>
              Restriction:
            </strong>{' '}
            Request restriction of certain processing
            activities where applicable.
          </li>

          <li>
            <strong>
              Portability:
            </strong>{' '}
            Request applicable personal information in a
            portable format.
          </li>

          <li>
            <strong>
              Withdrawal of Consent:
            </strong>{' '}
            Withdraw consent where processing relies on
            consent.
          </li>

          <li>
            <strong>
              Complaint:
            </strong>{' '}
            Lodge a complaint with the relevant data
            protection authority.
          </li>
        </ul>

        <p>
          Some rights are subject to legal, regulatory,
          contractual, security, and operational
          limitations.
        </p>
      </section>

      <section
        id="pp-5"
        className="legal-section"
        aria-labelledby="pp-5-title"
        tabIndex={-1}
      >
        <h3 id="pp-5-title">
          5. Cookies &amp; Tracking
        </h3>

        <p>
          The Platform may use cookies and related
          technologies to support functionality, security,
          preferences, analytics, and service performance.
        </p>

        <h4>
          Potential Cookie Categories
        </h4>

        <ul>
          <li>
            <strong>
              Essential:
            </strong>{' '}
            Required for functionality, authentication,
            and security.
          </li>

          <li>
            <strong>
              Performance:
            </strong>{' '}
            Used to understand service performance and
            usage.
          </li>

          <li>
            <strong>
              Functional:
            </strong>{' '}
            Used to remember preferences and settings.
          </li>

          <li>
            <strong>
              Marketing:
            </strong>{' '}
            Where applicable and permitted, used for
            relevant communications and measurement.
          </li>
        </ul>

        <p>
          Browser settings can be used to manage certain
          cookies. Disabling essential technologies may
          affect Platform functionality.
        </p>
      </section>

      <section
        id="pp-6"
        className="legal-section"
        aria-labelledby="pp-6-title"
        tabIndex={-1}
      >
        <h3 id="pp-6-title">
          6. Third-Party Services
        </h3>

        <p>
          {LEGAL_CONFIG.brandName} may work with carefully
          selected third-party providers that support
          Platform operations.
        </p>

        <ul>
          <li>
            Payment and financial service providers.
          </li>

          <li>
            Cloud hosting and infrastructure providers.
          </li>

          <li>
            Security, monitoring, and observability
            services.
          </li>

          <li>
            Email and communications providers.
          </li>

          <li>
            Customer support and operational services.
          </li>
        </ul>

        <p>
          Third-party providers may process information
          on our behalf subject to applicable agreements,
          security requirements, and legal obligations.{' '}
          {LEGAL_CONFIG.brandName} does not sell personal
          information as a business model.
        </p>
      </section>
    </section>
  );
}

/* ============================================================================
 * DISCLAIMER
 * ========================================================================== */

function Disclaimer() {
  return (
    <section
      className="legal-major-section"
      aria-labelledby="disclaimer-title"
    >
      <div className="legal-major-heading">
        <div
          className="legal-major-icon"
          aria-hidden="true"
        >
          <FileText size={24} />
        </div>

        <div>
          <h2
            id="disclaimer-title"
            className="major-title"
          >
            Disclaimer
          </h2>

          <p className="section-update">
            Last updated:{' '}
            {LEGAL_CONFIG.legalLastUpdated}
          </p>
        </div>
      </div>

      <section
        id="disclaimer"
        className="legal-section"
        aria-labelledby="general-disclaimer-title"
        tabIndex={-1}
      >
        <h3 id="general-disclaimer-title">
          General Disclaimer
        </h3>

        <p>
          The {LEGAL_CONFIG.brandName} Platform is
          provided on an “as-is” and “as-available” basis
          to the fullest extent permitted by applicable
          law.
        </p>

        <h4>
          Warranty Disclaimers
        </h4>

        <ul>
          <li>
            We do not guarantee uninterrupted or
            error-free availability.
          </li>

          <li>
            We do not guarantee that all defects will be
            corrected immediately.
          </li>

          <li>
            We do not guarantee specific outcomes from
            use of the Platform.
          </li>

          <li>
            Third-party services and content may be
            subject to separate terms and risks.
          </li>

          <li>
            Users remain responsible for decisions made
            using Platform information.
          </li>
        </ul>
      </section>

      <section
        id="financial-disclaimer"
        className="legal-section"
        aria-labelledby="financial-disclaimer-title"
        tabIndex={-1}
      >
        <h3 id="financial-disclaimer-title">
          Financial Disclaimer
        </h3>

        <div
          className="highlight"
          role="note"
        >
          <strong>
            Important:
          </strong>{' '}
          {LEGAL_CONFIG.brandName} is a technology
          platform and does not provide personalized
          financial, investment, tax, or legal advice
          unless expressly stated under a separate
          authorized service.
        </div>

        <h4>
          Key Points
        </h4>

        <ul>
          <li>
            Financial activity may involve risks,
            including payment failure, delays, fraud,
            disputes, and counterparty default.
          </li>

          <li>
            Users should independently assess the risks
            associated with savings, lending, borrowing,
            and other financial activity.
          </li>

          <li>
            {LEGAL_CONFIG.brandName} does not guarantee
            the creditworthiness, reliability, or
            performance of another participant.
          </li>

          <li>
            Users should seek qualified professional
            advice where financial or legal advice is
            required.
          </li>

          <li>
            Financial arrangements must comply with
            applicable laws and regulations.
          </li>

          <li>
            Users remain responsible for applicable tax,
            reporting, and regulatory obligations.
          </li>
        </ul>
      </section>

      <section
        id="contact-legal"
        className="legal-section"
        aria-labelledby="contact-legal-title"
        tabIndex={-1}
      >
        <h3 id="contact-legal-title">
          Contact Legal
        </h3>

        <p>
          If you have questions regarding these
          documents, privacy practices, or applicable user
          rights, please contact the{' '}
          {LEGAL_CONFIG.brandName} legal team through the
          organization's approved contact channels.
        </p>

        <div
          className="contact-box"
          aria-label="Legal contact information"
        >
          <p>
            <strong>
              Email:
            </strong>{' '}
            <a
              href={`mailto:${LEGAL_CONFIG.legalEmail}`}
            >
              {LEGAL_CONFIG.legalEmail}
            </a>
          </p>

          <p>
            <strong>
              Phone:
            </strong>{' '}
            <a
              href={`tel:${LEGAL_CONFIG.legalPhone}`}
            >
              {LEGAL_CONFIG.legalPhoneDisplay}
            </a>
          </p>

          <p>
            <strong>
              Address:
            </strong>{' '}
            {LEGAL_CONFIG.legalAddress}
          </p>

          <p>
            <strong>
              Target response time:
            </strong>{' '}
            We aim to respond to legal and privacy
            inquiries within 5 business days, subject to
            complexity, verification requirements, and
            applicable law.
          </p>
        </div>
      </section>
    </section>
  );
}

/* ============================================================================
 * DOCUMENT FOOTER
 * ========================================================================== */

function LegalDocumentFooter() {
  const currentYear =
    new Date().getFullYear();

  return (
    <footer
      className="legal-footer-note"
      aria-label="Legal document footer"
    >
      <p>
        <strong>
          Last Updated:
        </strong>{' '}
        {LEGAL_CONFIG.legalLastUpdated}{' '}
        <span aria-hidden="true">
          |
        </span>{' '}
        <strong>
          Version:
        </strong>{' '}
        {LEGAL_CONFIG.legalVersion}
      </p>

      <p>
        These documents may be updated from time to time
        to reflect changes in the Platform, applicable
        law, regulatory requirements, security practices,
        or business operations. Users should review this
        page periodically for updates.
      </p>

      <p className="legal-footer-brand">
        © {currentYear} {LEGAL_CONFIG.brandName}. All
        rights reserved.
      </p>
    </footer>
  );
}

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

const LegalPages = () => {
  const location =
    useLocation();

  const contentRef =
    useRef(null);

  const observerRef =
    useRef(null);

  const releaseHashNavigationTimerRef =
    useRef(null);

  const deepLinkTimerRef =
    useRef(null);

  const mobileNavigationCloseButtonRef =
    useRef(null);

  const mobileNavigationTriggerRef =
    useRef(null);

  const [
    activeSection,
    setActiveSection,
  ] = useState('tos-1');

  const [
    showScrollTop,
    setShowScrollTop,
  ] = useState(false);

  const [
    mobileNavigationOpen,
    setMobileNavigationOpen,
  ] = useState(false);

  const navigation =
    useMemo(
      () => NAV_SECTIONS,
      [],
    );

  useLegalMetadata();

  /* --------------------------------------------------------------------------
   * Scroll handling
   * ------------------------------------------------------------------------ */

  const handleScroll =
    useCallback(() => {
      const container =
        contentRef.current;

      if (!container) {
        return;
      }

      setShowScrollTop(
        container.scrollTop >
          LEGAL_UI_CONFIG.scrollTopThreshold,
      );
    }, []);

  /* --------------------------------------------------------------------------
   * Mobile navigation
   * ------------------------------------------------------------------------ */

  const closeMobileNavigation =
    useCallback(() => {
      setMobileNavigationOpen(false);
    }, []);

  const openMobileNavigation =
    useCallback(() => {
      setMobileNavigationOpen(true);
    }, []);

  /* --------------------------------------------------------------------------
   * Section scrolling
   * ------------------------------------------------------------------------ */

  const scrollToSection =
    useCallback(
      (id) => {
        if (
          !isBrowser() ||
          !isValidSectionId(id)
        ) {
          return;
        }

        const target =
          getLegalSection(id);

        const container =
          contentRef.current;

        if (
          !target ||
          !container
        ) {
          return;
        }

        if (
          releaseHashNavigationTimerRef.current
        ) {
          window.clearTimeout(
            releaseHashNavigationTimerRef.current,
          );
        }

        container.dataset.hashNavigation =
          'true';

        const behavior =
          prefersReducedMotion()
            ? 'auto'
            : 'smooth';

        const containerRect =
          container.getBoundingClientRect();

        const targetRect =
          target.getBoundingClientRect();

        const targetTop =
          targetRect.top -
          containerRect.top +
          container.scrollTop -
          LEGAL_UI_CONFIG.sectionScrollOffset;

        container.scrollTo({
          top: Math.max(
            0,
            targetTop,
          ),
          behavior,
        });

        setActiveSection(id);

        updateHash(id);

        closeMobileNavigation();

        const focusDelay =
          behavior === 'smooth'
            ? LEGAL_UI_CONFIG.focusDelay
            : 0;

        window.setTimeout(
          () => {
            try {
              target.focus({
                preventScroll: true,
              });
            } catch {
              target.focus();
            }
          },
          focusDelay,
        );

        releaseHashNavigationTimerRef.current =
          window.setTimeout(
            () => {
              delete container.dataset
                .hashNavigation;
            },
            behavior === 'smooth'
              ? LEGAL_UI_CONFIG.hashNavigationReleaseDelay
              : 100,
          );
      },
      [
        closeMobileNavigation,
      ],
    );

  /* --------------------------------------------------------------------------
   * Section navigation
   * ------------------------------------------------------------------------ */

  const handleSectionNavigation =
    useCallback(
      (event, id) => {
        event.preventDefault();

        scrollToSection(id);
      },
      [scrollToSection],
    );

  /* --------------------------------------------------------------------------
   * Scroll to top
   * ------------------------------------------------------------------------ */

  const scrollToTop =
    useCallback(() => {
      const container =
        contentRef.current;

      if (!container) {
        return;
      }

      if (
        releaseHashNavigationTimerRef.current &&
        isBrowser()
      ) {
        window.clearTimeout(
          releaseHashNavigationTimerRef.current,
        );
      }

      container.scrollTo({
        top: 0,
        behavior:
          prefersReducedMotion()
            ? 'auto'
            : 'smooth',
      });

      setActiveSection(
        'tos-1',
      );

      clearHash();

      try {
        container.focus({
          preventScroll: true,
        });
      } catch {
        container.focus();
      }
    }, []);

  /* --------------------------------------------------------------------------
   * Print
   * ------------------------------------------------------------------------ */

  const handlePrint =
    useCallback(() => {
      if (!isBrowser()) {
        return;
      }

      window.print();
    }, []);

  /* --------------------------------------------------------------------------
   * Intersection Observer
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    const container =
      contentRef.current;

    if (
      !container ||
      typeof IntersectionObserver ===
        'undefined'
    ) {
      return undefined;
    }

    const sections =
      getLegalSectionElements();

    if (!sections.length) {
      return undefined;
    }

    observerRef.current?.disconnect();

    observerRef.current =
      new IntersectionObserver(
        () => {
          if (
            container.dataset.hashNavigation ===
            'true'
          ) {
            return;
          }

          const containerRect =
            container.getBoundingClientRect();

          const visibleSections =
            sections
              .map((section) => {
                const rect =
                  section.getBoundingClientRect();

                const top =
                  rect.top -
                  containerRect.top;

                const bottom =
                  rect.bottom -
                  containerRect.top;

                const isVisible =
                  bottom > 0 &&
                  top <
                    container.clientHeight;

                return {
                  section,
                  top,
                  isVisible,
                };
              })
              .filter(
                ({
                  isVisible,
                }) =>
                  isVisible,
              )
              .sort(
                (a, b) =>
                  Math.abs(a.top) -
                  Math.abs(b.top),
              );

          const nextSection =
            visibleSections[0]
              ?.section;

          if (
            nextSection?.id
          ) {
            setActiveSection(
              nextSection.id,
            );
          }
        },
        {
          root: container,

          rootMargin:
            LEGAL_UI_CONFIG.activeSectionRootMargin,

          threshold:
            LEGAL_UI_CONFIG.activeSectionThresholds,
        },
      );

    sections.forEach(
      (section) => {
        observerRef.current.observe(
          section,
        );
      },
    );

    return () => {
      observerRef.current?.disconnect();

      observerRef.current =
        null;
    };
  }, []);

  /* --------------------------------------------------------------------------
   * Native scroll listener
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    const container =
      contentRef.current;

    if (!container) {
      return undefined;
    }

    container.addEventListener(
      'scroll',
      handleScroll,
      {
        passive: true,
      },
    );

    handleScroll();

    return () => {
      container.removeEventListener(
        'scroll',
        handleScroll,
      );
    };
  }, [handleScroll]);

  /* --------------------------------------------------------------------------
   * Deep-link / hash navigation
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!isBrowser()) {
      return undefined;
    }

    const hash =
      getCurrentHash();

    if (!hash) {
      return undefined;
    }

    if (
      deepLinkTimerRef.current
    ) {
      window.clearTimeout(
        deepLinkTimerRef.current,
      );
    }

    deepLinkTimerRef.current =
      window.setTimeout(
        () => {
          scrollToSection(hash);
        },
        LEGAL_UI_CONFIG.deepLinkDelay,
      );

    return () => {
      if (
        deepLinkTimerRef.current
      ) {
        window.clearTimeout(
          deepLinkTimerRef.current,
        );

        deepLinkTimerRef.current =
          null;
      }
    };
  }, [
    location.pathname,
    location.search,
    location.hash,
    scrollToSection,
  ]);

  /* --------------------------------------------------------------------------
   * Browser hash changes
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!isBrowser()) {
      return undefined;
    }

    const handleHashChange =
      () => {
        const hash =
          getCurrentHash();

        if (hash) {
          scrollToSection(hash);
        } else {
          scrollToTop();
        }
      };

    window.addEventListener(
      'hashchange',
      handleHashChange,
    );

    return () => {
      window.removeEventListener(
        'hashchange',
        handleHashChange,
      );
    };
  }, [
    scrollToSection,
    scrollToTop,
  ]);

  /* --------------------------------------------------------------------------
   * Keyboard accessibility
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!isBrowser()) {
      return undefined;
    }

    const handleKeyDown =
      (event) => {
        if (
          event.key !==
          'Escape'
        ) {
          return;
        }

        if (
          mobileNavigationOpen
        ) {
          closeMobileNavigation();
          return;
        }

        if (showScrollTop) {
          scrollToTop();
        }
      };

    window.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    closeMobileNavigation,
    mobileNavigationOpen,
    scrollToTop,
    showScrollTop,
  ]);

  /* --------------------------------------------------------------------------
   * Mobile navigation focus management
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      mobileNavigationOpen
    ) {
      mobileNavigationCloseButtonRef
        .current
        ?.focus();

      return undefined;
    }

    mobileNavigationTriggerRef
      .current
      ?.focus();

    return undefined;
  }, [
    mobileNavigationOpen,
  ]);

  /* --------------------------------------------------------------------------
   * Mobile body interaction lock
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!isBrowser()) {
      return undefined;
    }

    if (
      mobileNavigationOpen
    ) {
      document.body.classList.add(
        'legal-navigation-open',
      );
    } else {
      document.body.classList.remove(
        'legal-navigation-open',
      );
    }

    return () => {
      document.body.classList.remove(
        'legal-navigation-open',
      );
    };
  }, [
    mobileNavigationOpen,
  ]);

  /* --------------------------------------------------------------------------
   * Cleanup timers
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    return () => {
      if (!isBrowser()) {
        return;
      }

      if (
        releaseHashNavigationTimerRef.current
      ) {
        window.clearTimeout(
          releaseHashNavigationTimerRef.current,
        );
      }

      if (
        deepLinkTimerRef.current
      ) {
        window.clearTimeout(
          deepLinkTimerRef.current,
        );
      }
    };
  }, []);

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <div
      className="legal-page"
      data-brand="titech-community-capital"
      data-document-version={
        LEGAL_CONFIG.legalVersion
      }
      data-router-version="2026.3"
      data-document-type="legal"
    >
      {/* ----------------------------------------------------------------------
       * Accessibility skip link
       * -------------------------------------------------------------------- */}
      <a
        href="#legal-document-content"
        className="legal-skip-link"
      >
        Skip to legal documents
      </a>

      {/* ----------------------------------------------------------------------
       * Page header
       * -------------------------------------------------------------------- */}
      <LegalPageHeader
        onOpenMobileNavigation={() => {
          mobileNavigationTriggerRef.current =
            document.activeElement;

          openMobileNavigation();
        }}
      />

      {/* ----------------------------------------------------------------------
       * Mobile navigation overlay
       * -------------------------------------------------------------------- */}
      {mobileNavigationOpen && (
        <div
          className="legal-mobile-navigation-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeMobileNavigation();
            }
          }}
        >
          <LegalNavigation
            navigation={navigation}
            activeSection={
              activeSection
            }
            onSectionNavigation={
              handleSectionNavigation
            }
            onPrint={
              handlePrint
            }
            mobile
            onClose={
              closeMobileNavigation
            }
            closeButtonRef={
              mobileNavigationCloseButtonRef
            }
          />
        </div>
      )}

      {/* ----------------------------------------------------------------------
       * Main legal application layout
       * -------------------------------------------------------------------- */}
      <div className="legal-container">
        {/* Desktop navigation */}
        <LegalNavigation
          navigation={navigation}
          activeSection={
            activeSection
          }
          onSectionNavigation={
            handleSectionNavigation
          }
          onPrint={
            handlePrint
          }
        />

        {/* --------------------------------------------------------------------
         * Legal document content
         * ------------------------------------------------------------------ */}
        <main
          id="legal-document-content"
          ref={contentRef}
          className="legal-content"
          tabIndex={-1}
          aria-label={
            `${LEGAL_CONFIG.brandName} legal documents`
          }
        >
          <article
            className="legal-article"
            aria-label="Legal documentation"
          >
            {/* Document status / overview */}
            <section
              className="legal-document-overview"
              aria-labelledby="legal-overview-title"
            >
              <div className="legal-document-overview-icon">
                <FileText
                  size={22}
                  aria-hidden="true"
                />
              </div>

              <div>
                <h2 id="legal-overview-title">
                  Legal Documents
                </h2>

                <p>
                  This page contains the principal
                  legal and policy documents governing
                  use of the{' '}
                  {LEGAL_CONFIG.brandName} Platform.
                </p>

                <p>
                  <strong>
                    Document version:
                  </strong>{' '}
                  {LEGAL_CONFIG.legalVersion}
                  {' · '}
                  <strong>
                    Effective:
                  </strong>{' '}
                  {LEGAL_CONFIG.legalEffectiveDate}
                  {' · '}
                  <strong>
                    Last updated:
                  </strong>{' '}
                  {LEGAL_CONFIG.legalLastUpdated}
                </p>

                <p
                  className="legal-document-notice"
                  role="note"
                >
                  <strong>
                    Legal notice:
                  </strong>{' '}
                  These documents are application-facing
                  legal and policy materials and should
                  be reviewed by qualified legal and
                  privacy professionals before being
                  relied upon as final legal advice or
                  contractual documentation.
                </p>
              </div>
            </section>

            <TermsOfService />

            <PrivacyPolicy />

            <Disclaimer />

            <LegalDocumentFooter />

            <noscript>
              <div
                className="legal-document-overview"
                role="alert"
              >
                JavaScript is disabled. The legal
                documents remain available as page
                content, but interactive navigation,
                smooth scrolling, and print controls may
                not be available.
              </div>
            </noscript>
          </article>

          {/* ------------------------------------------------------------------
           * Scroll-to-top
           * ---------------------------------------------------------------- */}
          {showScrollTop && (
            <button
              type="button"
              className="scroll-top-btn"
              onClick={
                scrollToTop
              }
              aria-label="Scroll to top of legal documents"
              title="Scroll to top"
            >
              <ChevronUp
                size={20}
                aria-hidden="true"
              />

              <span className="sr-only">
                Scroll to top
              </span>
            </button>
          )}
        </main>
      </div>
    </div>
  );
};

/* ============================================================================
 * EXPORT
 * ========================================================================== */

export default LegalPages;