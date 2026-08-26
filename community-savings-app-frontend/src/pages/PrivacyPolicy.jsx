'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Privacy Policy Page
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/PrivacyPolicy.jsx
 *
 * Purpose:
 *   Canonical privacy and data-protection policy page for the TITech
 *   Community Capital Platform.
 *
 * Production capabilities
 * ----------------------------------------------------------------------------
 * ✓ Semantic legal-document structure
 * ✓ React Router compatible
 * ✓ Deep-link section navigation
 * ✓ Active section tracking
 * ✓ Accessible keyboard focus management
 * ✓ WCAG 2.1 AA-oriented semantics
 * ✓ Reduced-motion awareness
 * ✓ Responsive/mobile-friendly structure
 * ✓ Print-friendly document hierarchy
 * ✓ Accessible scroll-to-top control
 * ✓ Privacy and data-protection contact information
 * ✓ URL/hash synchronization
 * ✓ Graceful SSR/test-environment guards
 * ✓ No misleading absolute-security guarantees
 * ✓ Consistent TITech Community Capital terminology
 * ✓ Stable section identifiers for external links
 *
 * Important:
 * ----------------------------------------------------------------------------
 * This component presents the organization's intended privacy practices.
 * Legal, regulatory, retention, and age-related requirements should be
 * reviewed by TITech Community Capital's appropriate legal/compliance
 * professionals before production publication.
 * ============================================================================
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowUp,
  FileText,
  Home,
  Mail,
  Phone,
  Shield,
} from 'lucide-react';
import './LegalPages.css';

// ============================================================================
// Constants
// ============================================================================

const PRIVACY_POLICY_VERSION = '1.0';
const LAST_UPDATED = 'January 15, 2026';

const SCROLL_TOP_THRESHOLD = 300;
const SECTION_SCROLL_OFFSET = 24;
const DEEP_LINK_DELAY = 50;
const FOCUS_DELAY = 250;

const PRIVACY_EMAIL = 'privacy@titechcommunity.app';
const DPO_EMAIL = 'dpo@titechcommunity.app';

const PRIVACY_PHONE_DISPLAY = '+256 (394) 324760';
const PRIVACY_PHONE_HREF = '+256394324760';

const MAILING_ADDRESS =
  'TITech Community Capital Ltd, Plot 69-71 Jinja Road, Kampala, Uganda';

const POLICY_TITLE = 'Privacy Policy';

// ============================================================================
// Navigation Configuration
// ============================================================================

const POLICY_SECTIONS = [
  {
    id: 'section-1',
    label: '1. Introduction',
  },
  {
    id: 'section-2',
    label: '2. Information We Collect',
  },
  {
    id: 'section-3',
    label: '3. How We Use Your Data',
  },
  {
    id: 'section-4',
    label: '4. Data Security',
  },
  {
    id: 'section-5',
    label: '5. Data Sharing',
  },
  {
    id: 'section-6',
    label: '6. Your Rights',
  },
  {
    id: 'section-7',
    label: '7. Cookies & Tracking',
  },
  {
    id: 'section-8',
    label: '8. Data Retention',
  },
  {
    id: 'section-9',
    label: "9. Children's Privacy",
  },
  {
    id: 'section-10',
    label: '10. Changes to This Privacy Policy',
  },
  {
    id: 'privacy-contact',
    label: 'Privacy Contact Information',
  },
];

const SECTION_IDS = new Set(
  POLICY_SECTIONS.map((section) => section.id),
);

// ============================================================================
// Environment / Browser Helpers
// ============================================================================

const canUseDOM = () =>
  typeof window !== 'undefined' &&
  typeof document !== 'undefined';

const getCurrentYear = () => new Date().getFullYear();

const prefersReducedMotion = () => {
  if (!canUseDOM() || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
};

const getScrollBehavior = () =>
  prefersReducedMotion() ? 'auto' : 'smooth';

const getHashId = () => {
  if (!canUseDOM()) {
    return '';
  }

  const rawHash = window.location.hash.replace(/^#/, '');

  if (!rawHash) {
    return '';
  }

  try {
    return decodeURIComponent(rawHash);
  } catch {
    return rawHash;
  }
};

const normalizeHashId = (value) => {
  if (!value) {
    return '';
  }

  const decoded = String(value).replace(/^#/, '');

  return SECTION_IDS.has(decoded) ? decoded : '';
};

const getSectionHeading = (sectionElement) => {
  if (!sectionElement) {
    return null;
  }

  return sectionElement.querySelector('h2');
};

const focusHeading = (sectionElement) => {
  const heading = getSectionHeading(sectionElement);

  if (!heading || typeof heading.focus !== 'function') {
    return;
  }

  heading.focus({
    preventScroll: true,
  });
};

// ============================================================================
// Main Component
// ============================================================================

const PrivacyPolicy = () => {
  const location = useLocation();

  const contentRef = useRef(null);
  const sectionRefs = useRef(new Map());
  const deepLinkTimerRef = useRef(null);
  const focusTimerRef = useRef(null);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [activeSection, setActiveSection] = useState(() =>
    normalizeHashId(getHashId()),
  );

  const currentYear = useMemo(() => getCurrentYear(), []);

  // --------------------------------------------------------------------------
  // Stable section registration
  // --------------------------------------------------------------------------

  const registerSection = useCallback(
    (sectionId, node) => {
      if (node) {
        sectionRefs.current.set(sectionId, node);
      } else {
        sectionRefs.current.delete(sectionId);
      }
    },
    [],
  );

  // --------------------------------------------------------------------------
  // Scroll position handling
  // --------------------------------------------------------------------------

  const handleContentScroll = useCallback(() => {
    const element = contentRef.current;

    if (!element) {
      return;
    }

    setShowScrollTop(
      element.scrollTop > SCROLL_TOP_THRESHOLD,
    );
  }, []);

  useEffect(() => {
    const element = contentRef.current;

    if (!element) {
      return undefined;
    }

    element.addEventListener(
      'scroll',
      handleContentScroll,
      {
        passive: true,
      },
    );

    handleContentScroll();

    return () => {
      element.removeEventListener(
        'scroll',
        handleContentScroll,
      );
    };
  }, [handleContentScroll]);

  // --------------------------------------------------------------------------
  // Active section tracking
  // --------------------------------------------------------------------------

  useEffect(() => {
    const element = contentRef.current;

    if (!element || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observedSections = POLICY_SECTIONS.map(
      ({ id }) => sectionRefs.current.get(id),
    ).filter(Boolean);

    if (!observedSections.length) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top -
              b.boundingClientRect.top,
          );

        if (!visibleEntries.length) {
          return;
        }

        const visibleSection = visibleEntries[0];

        if (visibleSection.target.id) {
          setActiveSection(visibleSection.target.id);
        }
      },
      {
        root: element,
        rootMargin: '-10% 0px -70% 0px',
        threshold: [0, 0.1, 0.25],
      },
    );

    observedSections.forEach((section) => {
      observer.observe(section);
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // --------------------------------------------------------------------------
  // Deep-linked section navigation
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!canUseDOM()) {
      return undefined;
    }

    const hashId = normalizeHashId(location.hash);

    setActiveSection(hashId);

    if (!hashId) {
      return undefined;
    }

    if (deepLinkTimerRef.current) {
      window.clearTimeout(deepLinkTimerRef.current);
    }

    deepLinkTimerRef.current = window.setTimeout(() => {
      const target =
        sectionRefs.current.get(hashId) ||
        document.getElementById(hashId);

      if (!target) {
        return;
      }

      const contentElement = contentRef.current;

      if (contentElement) {
        const contentRect =
          contentElement.getBoundingClientRect();

        const targetRect =
          target.getBoundingClientRect();

        const targetTop =
          contentElement.scrollTop +
          (targetRect.top - contentRect.top) -
          SECTION_SCROLL_OFFSET;

        contentElement.scrollTo({
          top: Math.max(0, targetTop),
          behavior: getScrollBehavior(),
        });
      } else {
        target.scrollIntoView({
          behavior: getScrollBehavior(),
          block: 'start',
        });
      }

      window.setTimeout(() => {
        focusHeading(target);
      }, 0);
    }, DEEP_LINK_DELAY);

    return () => {
      if (deepLinkTimerRef.current) {
        window.clearTimeout(deepLinkTimerRef.current);
      }
    };
  }, [location.hash]);

  // --------------------------------------------------------------------------
  // Cleanup timers
  // --------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (deepLinkTimerRef.current) {
        window.clearTimeout(deepLinkTimerRef.current);
      }

      if (focusTimerRef.current) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // Update browser URL without triggering a full application navigation
  // --------------------------------------------------------------------------

  const updateHash = useCallback((sectionId) => {
    if (
      !canUseDOM() ||
      !window.history ||
      typeof window.history.replaceState !== 'function'
    ) {
      return;
    }

    const encodedSectionId =
      encodeURIComponent(sectionId);

    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#${encodedSectionId}`,
    );
  }, []);

  // --------------------------------------------------------------------------
  // Scroll to top
  // --------------------------------------------------------------------------

  const scrollToTop = useCallback(() => {
    const element = contentRef.current;

    if (!element) {
      return;
    }

    element.scrollTo({
      top: 0,
      behavior: getScrollBehavior(),
    });

    setActiveSection('section-1');

    updateHash('section-1');

    if (focusTimerRef.current) {
      window.clearTimeout(focusTimerRef.current);
    }

    focusTimerRef.current = window.setTimeout(() => {
      const heading = document.getElementById(
        'privacy-policy-heading',
      );

      if (heading) {
        heading.focus({
          preventScroll: true,
        });
      }
    }, prefersReducedMotion() ? 0 : FOCUS_DELAY);
  }, [updateHash]);

  // --------------------------------------------------------------------------
  // Section navigation
  // --------------------------------------------------------------------------

  const handleSectionNavigation = useCallback(
    (event, sectionId) => {
      event.preventDefault();

      const normalizedSectionId =
        normalizeHashId(sectionId);

      if (!normalizedSectionId) {
        return;
      }

      const target =
        sectionRefs.current.get(normalizedSectionId) ||
        document.getElementById(normalizedSectionId);

      if (!target) {
        return;
      }

      const contentElement = contentRef.current;

      if (contentElement) {
        const contentRect =
          contentElement.getBoundingClientRect();

        const targetRect =
          target.getBoundingClientRect();

        const targetTop =
          contentElement.scrollTop +
          (targetRect.top - contentRect.top) -
          SECTION_SCROLL_OFFSET;

        contentElement.scrollTo({
          top: Math.max(0, targetTop),
          behavior: getScrollBehavior(),
        });
      } else {
        target.scrollIntoView({
          behavior: getScrollBehavior(),
          block: 'start',
        });
      }

      setActiveSection(normalizedSectionId);
      updateHash(normalizedSectionId);

      if (focusTimerRef.current) {
        window.clearTimeout(focusTimerRef.current);
      }

      focusTimerRef.current = window.setTimeout(() => {
        focusHeading(target);
      }, prefersReducedMotion() ? 0 : FOCUS_DELAY);
    },
    [updateHash],
  );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="legal-page">
      {/* ================================================================== */}
      {/* Header                                                             */}
      {/* ================================================================== */}

      <header className="legal-header">
        <div className="legal-header-content">
          <div
            className="legal-header-icon"
            aria-hidden="true"
          >
            <Shield size={30} />
          </div>

          <p className="legal-eyebrow">
            TITech Community Capital
          </p>

          <h1
            className="legal-title"
            id="privacy-page-title"
          >
            {POLICY_TITLE}
          </h1>

          <p className="legal-subtitle">
            Last updated: {LAST_UPDATED}
            {' • '}
            Version {PRIVACY_POLICY_VERSION}
          </p>

          <p className="legal-description">
            We are committed to protecting your personal
            information, respecting your privacy, and
            maintaining appropriate safeguards when you use
            TITech Community Capital services.
          </p>
        </div>
      </header>

      {/* ================================================================== */}
      {/* Main Legal Layout                                                  */}
      {/* ================================================================== */}

      <div className="legal-container">
        {/* ================================================================ */}
        {/* Sidebar                                                          */}
        {/* ================================================================ */}

        <aside
          className="legal-sidebar"
          aria-label="Privacy Policy navigation"
        >
          <nav
            className="legal-nav"
            aria-label="Privacy Policy Sections"
          >
            <div className="legal-nav-heading">
              <FileText
                size={17}
                aria-hidden="true"
              />

              <span>On this page</span>
            </div>

            <ol className="legal-nav-list">
              {POLICY_SECTIONS.map((section) => {
                const isActive =
                  activeSection === section.id;

                return (
                  <li key={section.id}>
                    <a
                      href={`#${encodeURIComponent(section.id)}`}
                      className={`nav-link${
                        isActive ? ' is-active' : ''
                      }`}
                      aria-current={
                        isActive ? 'location' : undefined
                      }
                      onClick={(event) =>
                        handleSectionNavigation(
                          event,
                          section.id,
                        )
                      }
                    >
                      {section.label}
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        {/* ================================================================ */}
        {/* Main Content                                                     */}
        {/* ================================================================ */}

        <main
          ref={contentRef}
          className="legal-content"
          aria-labelledby="privacy-page-title"
          tabIndex="-1"
        >
          <article
            className="legal-article"
            aria-labelledby="privacy-policy-heading"
          >
            {/* ============================================================ */}
            {/* Document Metadata                                             */}
            {/* ============================================================ */}

            <div
              className="legal-document-meta"
              aria-label="Privacy Policy document information"
            >
              <p>
                <strong>Document:</strong>{' '}
                {POLICY_TITLE}
              </p>

              <p>
                <strong>Effective date:</strong>{' '}
                {LAST_UPDATED}
              </p>

              <p>
                <strong>Version:</strong>{' '}
                {PRIVACY_POLICY_VERSION}
              </p>

              <p>
                <strong>Organization:</strong>{' '}
                TITech Community Capital Ltd
              </p>
            </div>

            {/* ============================================================ */}
            {/* Section 1                                                     */}
            {/* ============================================================ */}

            <section
              id="section-1"
              ref={(node) =>
                registerSection('section-1', node)
              }
              className="legal-section"
              aria-labelledby="privacy-policy-heading"
            >
              <h2
                id="privacy-policy-heading"
                tabIndex="-1"
              >
                1. Introduction
              </h2>

              <p>
                TITech Community Capital Ltd (
                <strong>
                  &quot;TITech Community Capital&quot;
                </strong>
                , <strong>&quot;we&quot;</strong>,{' '}
                <strong>&quot;us&quot;</strong>, or{' '}
                <strong>&quot;our&quot;</strong>) operates the
                Community Savings App and related digital
                financial and community-management services
                (collectively, the &quot;Platform&quot;).
              </p>

              <p>
                This Privacy Policy explains how we collect,
                use, disclose, retain, and protect personal
                information when you access or use the
                Platform.
              </p>

              <p>
                By using the Platform, you acknowledge that
                you have read and understood this Privacy
                Policy. Where applicable law requires a
                separate legal basis or consent for a
                particular processing activity, we will rely
                on the appropriate legal basis.
              </p>

              <p>
                This policy should be read together with our
                Terms of Service and any additional privacy
                notices provided for specific services or
                processing activities.
              </p>
            </section>

            {/* ============================================================ */}
            {/* Section 2                                                     */}
            {/* ============================================================ */}

            <section
              id="section-2"
              ref={(node) =>
                registerSection('section-2', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-2"
            >
              <h2
                id="privacy-section-2"
                tabIndex="-1"
              >
                2. Information We Collect
              </h2>

              <p>
                Depending on the services you use, TITech
                Community Capital may collect the following
                categories of information.
              </p>

              <h3>Personal Data You Provide</h3>

              <ul>
                <li>
                  <strong>Account Information:</strong> Name,
                  email address, phone number, date of birth,
                  and account credentials.
                </li>

                <li>
                  <strong>Financial Information:</strong>{' '}
                  Payment information, transaction records,
                  contribution information, savings activity,
                  and applicable financial-account
                  verification information.
                </li>

                <li>
                  <strong>Profile Information:</strong>{' '}
                  Savings goals, group memberships,
                  preferences, and communication settings.
                </li>

                <li>
                  <strong>Contact Information:</strong>{' '}
                  Address, telephone number, and optional
                  emergency-contact information where
                  provided.
                </li>

                <li>
                  <strong>
                    Identity and Verification Information:
                  </strong>{' '}
                  Information reasonably required for
                  identity verification, KYC, AML, fraud
                  prevention, or regulatory compliance.
                </li>
              </ul>

              <h3>Automatically Collected Information</h3>

              <ul>
                <li>
                  <strong>Device Information:</strong> Device
                  type, operating system, browser type,
                  application version, and related technical
                  information.
                </li>

                <li>
                  <strong>Usage Data:</strong> Pages viewed,
                  features used, timestamps, interactions,
                  and diagnostic information.
                </li>

                <li>
                  <strong>Approximate Location:</strong>{' '}
                  General location information such as city
                  or country where available and appropriate.
                </li>

                <li>
                  <strong>IP Address:</strong> Collected where
                  necessary for security, fraud prevention,
                  diagnostics, and service operation.
                </li>

                <li>
                  <strong>
                    Cookies and Similar Technologies:
                  </strong>{' '}
                  Information collected through cookies and
                  comparable technologies used to operate and
                  improve the Platform.
                </li>
              </ul>

              <h3>Information From Third Parties</h3>

              <ul>
                <li>
                  Payment processors and financial service
                  providers.
                </li>

                <li>
                  Financial institutions where verification
                  is required.
                </li>

                <li>
                  Mobile network operators and mobile-money
                  providers.
                </li>

                <li>
                  Identity, compliance, and fraud prevention
                  service providers.
                </li>

                <li>
                  Community or group administrators where
                  information is legitimately provided through
                  Platform functionality.
                </li>
              </ul>
            </section>

            {/* ============================================================ */}
            {/* Section 3                                                     */}
            {/* ============================================================ */}

            <section
              id="section-3"
              ref={(node) =>
                registerSection('section-3', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-3"
            >
              <h2
                id="privacy-section-3"
                tabIndex="-1"
              >
                3. How We Use Your Data
              </h2>

              <p>
                We process personal information only for
                legitimate and appropriate purposes, including:
              </p>

              <ul>
                <li>
                  <strong>Account Management:</strong> Creating
                  and maintaining accounts, authentication,
                  authorization, and identity verification.
                </li>

                <li>
                  <strong>Service Delivery:</strong> Operating
                  savings groups, processing transactions,
                  maintaining financial records, and providing
                  applicable Platform services.
                </li>

                <li>
                  <strong>Communications:</strong> Sending
                  transaction confirmations, security alerts,
                  service notifications, and other
                  account-related communications.
                </li>

                <li>
                  <strong>
                    Security and Fraud Prevention:
                  </strong>{' '}
                  Detecting suspicious activity, preventing
                  abuse, protecting accounts, and maintaining
                  Platform integrity.
                </li>

                <li>
                  <strong>
                    Legal and Regulatory Compliance:
                  </strong>{' '}
                  Meeting applicable legal, regulatory,
                  accounting, reporting, and compliance
                  obligations.
                </li>

                <li>
                  <strong>Analytics and Improvement:</strong>{' '}
                  Understanding service usage, diagnosing
                  technical problems, and improving Platform
                  functionality.
                </li>

                <li>
                  <strong>Customer Support:</strong> Responding
                  to requests, troubleshooting problems, and
                  providing customer assistance.
                </li>

                <li>
                  <strong>Marketing:</strong> Sending
                  promotional communications where permitted
                  and where any required consent has been
                  obtained.
                </li>
              </ul>
            </section>

            {/* ============================================================ */}
            {/* Section 4                                                     */}
            {/* ============================================================ */}

            <section
              id="section-4"
              ref={(node) =>
                registerSection('section-4', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-4"
            >
              <h2
                id="privacy-section-4"
                tabIndex="-1"
              >
                4. Data Security
              </h2>

              <p>
                TITech Community Capital applies
                administrative, technical, and organizational
                safeguards designed to protect personal
                information against unauthorized access,
                alteration, disclosure, loss, or destruction.
              </p>

              <ul>
                <li>
                  <strong>Encryption in Transit:</strong>{' '}
                  Appropriate TLS/HTTPS protections are used
                  for supported network communications.
                </li>

                <li>
                  <strong>Secure Storage:</strong> Appropriate
                  controls are applied to protect information
                  stored by the Platform and its authorized
                  service providers.
                </li>

                <li>
                  <strong>Access Controls:</strong> Access to
                  personal information is restricted according
                  to authorization and legitimate business
                  need.
                </li>

                <li>
                  <strong>
                    Authentication and Authorization:
                  </strong>{' '}
                  Security controls are used to protect
                  accounts and restricted Platform
                  functionality.
                </li>

                <li>
                  <strong>Monitoring:</strong> Security and
                  operational monitoring may be used to
                  identify suspicious or unauthorized activity.
                </li>

                <li>
                  <strong>Incident Response:</strong> We
                  maintain processes for investigating and
                  responding to security incidents.
                </li>

                <li>
                  <strong>Security Testing:</strong> Security
                  reviews and testing may be performed as
                  appropriate to identify and address
                  weaknesses.
                </li>
              </ul>

              <p className="highlight">
                <strong>Important:</strong> No method of
                electronic transmission or storage is
                completely secure. Although we take reasonable
                and appropriate measures to protect personal
                information, we cannot guarantee absolute
                security.
              </p>
            </section>

            {/* ============================================================ */}
            {/* Section 5                                                     */}
            {/* ============================================================ */}

            <section
              id="section-5"
              ref={(node) =>
                registerSection('section-5', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-5"
            >
              <h2
                id="privacy-section-5"
                tabIndex="-1"
              >
                5. Data Sharing
              </h2>

              <p>
                We do not sell personal information for
                monetary consideration. We may disclose
                information where necessary to provide
                services, protect users, comply with law, or
                operate the Platform.
              </p>

              <h3>Service Providers</h3>

              <p>
                We may share relevant information with
                authorized service providers supporting
                Platform operations, including payment
                processors, cloud infrastructure providers,
                communications providers, security providers,
                and technical service providers.
              </p>

              <h3>Legal and Regulatory Requirements</h3>

              <p>
                We may disclose information when required or
                permitted by applicable law, regulation, court
                order, lawful governmental request, or
                regulatory obligation.
              </p>

              <h3>Community and Group Functionality</h3>

              <p>
                Certain limited profile or transaction-related
                information may be visible to authorized
                members, administrators, or participants of a
                savings group when reasonably necessary for
                legitimate Platform functionality.
              </p>

              <h3>Financial and Payment Services</h3>

              <p>
                Relevant information may be shared with
                financial institutions, mobile money providers,
                payment processors, or other authorized
                financial-service providers when required to
                process or verify a transaction.
              </p>

              <h3>Third-Party Protection</h3>

              <p>
                Where appropriate, service providers processing
                personal information on our behalf are expected
                to maintain confidentiality and appropriate
                security safeguards consistent with their
                contractual and legal obligations.
              </p>

              <h3>
                Information We Do Not Intentionally Share
              </h3>

              <ul>
                <li>
                  Account passwords in plaintext.
                </li>

                <li>
                  Authentication secrets with unauthorized
                  third parties.
                </li>

                <li>
                  Personal information for unrelated
                  third-party purposes without an appropriate
                  legal basis or authorization.
                </li>
              </ul>
            </section>

            {/* ============================================================ */}
            {/* Section 6                                                     */}
            {/* ============================================================ */}

            <section
              id="section-6"
              ref={(node) =>
                registerSection('section-6', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-6"
            >
              <h2
                id="privacy-section-6"
                tabIndex="-1"
              >
                6. Your Rights
              </h2>

              <p>
                Subject to applicable law and regulatory
                requirements, you may have rights concerning
                your personal information, including:
              </p>

              <h3>Right to Access</h3>

              <p>
                You may request access to personal information
                that we hold about you.
              </p>

              <h3>Right to Rectification</h3>

              <p>
                You may request correction of inaccurate or
                incomplete personal information.
              </p>

              <h3>Right to Erasure</h3>

              <p>
                You may request deletion of personal
                information, subject to applicable legal,
                regulatory, contractual, accounting,
                fraud-prevention, and legitimate-business
                retention requirements.
              </p>

              <h3>Right to Data Portability</h3>

              <p>
                Where applicable, you may request personal
                information in a structured and commonly used
                format.
              </p>

              <h3>Right to Withdraw Consent</h3>

              <p>
                Where processing relies on consent, you may
                withdraw that consent, subject to applicable
                limitations.
              </p>

              <h3>
                Right to Object or Restrict Processing
              </h3>

              <p>
                Where applicable, you may object to or request
                restriction of certain processing activities.
              </p>

              <p>
                To exercise applicable privacy rights, contact
                us at{' '}
                <a href={`mailto:${PRIVACY_EMAIL}`}>
                  {PRIVACY_EMAIL}
                </a>
                . We may need to verify your identity before
                completing certain requests.
              </p>
            </section>

            {/* ============================================================ */}
            {/* Section 7                                                     */}
            {/* ============================================================ */}

            <section
              id="section-7"
              ref={(node) =>
                registerSection('section-7', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-7"
            >
              <h2
                id="privacy-section-7"
                tabIndex="-1"
              >
                7. Cookies &amp; Tracking Technologies
              </h2>

              <p>
                The Platform may use cookies and similar
                technologies to support authentication,
                security, preferences, analytics, and service
                functionality.
              </p>

              <h3>Essential Technologies</h3>

              <p>
                These technologies may be required for
                authentication, security, session management,
                and core Platform functionality.
              </p>

              <h3>Preference Technologies</h3>

              <p>
                These technologies may remember settings and
                preferences to improve your experience.
              </p>

              <h3>Performance and Analytics</h3>

              <p>
                Where implemented, analytics technologies may
                help us understand service usage, performance,
                and technical issues.
              </p>

              <h3>Marketing Technologies</h3>

              <p>
                Where applicable and permitted, marketing or
                advertising technologies may be used only in
                accordance with applicable requirements and
                preferences.
              </p>

              <h3>Managing Cookies</h3>

              <p>
                Most browsers allow you to manage or disable
                cookies through browser settings. Disabling
                essential cookies may affect authentication or
                other Platform functionality.
              </p>
            </section>

            {/* ============================================================ */}
            {/* Section 8                                                     */}
            {/* ============================================================ */}

            <section
              id="section-8"
              ref={(node) =>
                registerSection('section-8', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-8"
            >
              <h2
                id="privacy-section-8"
                tabIndex="-1"
              >
                8. Data Retention
              </h2>

              <p>
                We retain personal information only for as
                long as reasonably necessary for the purposes
                described in this policy, unless a longer
                period is required or permitted by applicable
                law.
              </p>

              <h3>Examples of Retention Categories</h3>

              <ul>
                <li>
                  <strong>Active Account Data:</strong>{' '}
                  Retained while the account and related
                  services remain active.
                </li>

                <li>
                  <strong>Transaction Records:</strong> May be
                  retained for periods required by financial,
                  accounting, audit, regulatory, or legal
                  obligations.
                </li>

                <li>
                  <strong>Communication Records:</strong>{' '}
                  Retained for as long as reasonably necessary
                  for service, support, security, or legal
                  purposes.
                </li>

                <li>
                  <strong>Marketing Preferences:</strong>{' '}
                  Retained as necessary to honor communication
                  preferences and demonstrate compliance.
                </li>

                <li>
                  <strong>Legal or Regulatory Holds:</strong>{' '}
                  Information may be retained for longer where
                  necessary to comply with legal obligations or
                  resolve disputes.
                </li>
              </ul>

              <p>
                Account deletion does not necessarily result in
                immediate deletion of every record. Information
                may need to be retained where required for
                legal, regulatory, accounting, security,
                fraud-prevention, or legitimate operational
                purposes.
              </p>
            </section>

            {/* ============================================================ */}
            {/* Section 9                                                     */}
            {/* ============================================================ */}

            <section
              id="section-9"
              ref={(node) =>
                registerSection('section-9', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-9"
            >
              <h2
                id="privacy-section-9"
                tabIndex="-1"
              >
                9. Children&apos;s Privacy
              </h2>

              <p>
                The Platform is intended for adults and is not
                directed toward children under the age of 18.
              </p>

              <p>
                We do not knowingly request or intentionally
                collect personal information from children
                under 18 through services intended for adult
                users.
              </p>

              <p>
                If you believe that a child has provided
                personal information to us, please contact us
                at{' '}
                <a href={`mailto:${PRIVACY_EMAIL}`}>
                  {PRIVACY_EMAIL}
                </a>
                .
              </p>
            </section>

            {/* ============================================================ */}
            {/* Section 10                                                    */}
            {/* ============================================================ */}

            <section
              id="section-10"
              ref={(node) =>
                registerSection('section-10', node)
              }
              className="legal-section"
              aria-labelledby="privacy-section-10"
            >
              <h2
                id="privacy-section-10"
                tabIndex="-1"
              >
                10. Changes to This Privacy Policy
              </h2>

              <p>
                We may update this Privacy Policy
                periodically to reflect changes in our
                services, technology, security practices, legal
                requirements, or data-processing activities.
              </p>

              <p>
                When changes are made, we will update the
                effective or last-updated date displayed at the
                beginning of this policy.
              </p>

              <p>
                Where a change materially affects your rights
                or obligations and applicable law requires
                additional notice, we will provide appropriate
                notice through the Platform or other permitted
                communication channels.
              </p>

              <p>
                We encourage you to periodically review this
                Privacy Policy to remain informed about how
                TITech Community Capital handles personal
                information.
              </p>
            </section>

            {/* ============================================================ */}
            {/* Contact Section                                               */}
            {/* ============================================================ */}

            <section
              id="privacy-contact"
              ref={(node) =>
                registerSection('privacy-contact', node)
              }
              className="legal-section contact-section"
              aria-labelledby="privacy-contact-heading"
            >
              <h2
                id="privacy-contact-heading"
                tabIndex="-1"
              >
                Privacy Contact Information
              </h2>

              <p>
                If you have questions, concerns, requests, or
                complaints regarding this Privacy Policy or
                the handling of your personal information,
                please contact TITech Community Capital.
              </p>

              <div className="contact-info">
                <p>
                  <strong>
                    <Mail
                      size={16}
                      aria-hidden="true"
                    />{' '}
                    Email:
                  </strong>{' '}
                  <a href={`mailto:${PRIVACY_EMAIL}`}>
                    {PRIVACY_EMAIL}
                  </a>
                </p>

                <p>
                  <strong>
                    <Shield
                      size={16}
                      aria-hidden="true"
                    />{' '}
                    Data Protection Contact:
                  </strong>{' '}
                  <a href={`mailto:${DPO_EMAIL}`}>
                    {DPO_EMAIL}
                  </a>
                </p>

                <p>
                  <strong>
                    <Phone
                      size={16}
                      aria-hidden="true"
                    />{' '}
                    Phone:
                  </strong>{' '}
                  <a
                    href={`tel:${PRIVACY_PHONE_HREF}`}
                    aria-label={`Call TITech Community Capital at ${PRIVACY_PHONE_DISPLAY}`}
                  >
                    {PRIVACY_PHONE_DISPLAY}
                  </a>
                </p>

                <p>
                  <strong>Mailing Address:</strong>{' '}
                  {MAILING_ADDRESS}
                </p>
              </div>
            </section>

            {/* ============================================================ */}
            {/* Legal Disclaimer                                              */}
            {/* ============================================================ */}

            <section
              className="legal-section legal-disclaimer"
              aria-labelledby="privacy-important-notice"
            >
              <h2
                id="privacy-important-notice"
                tabIndex="-1"
              >
                Important Notice
              </h2>

              <p>
                This Privacy Policy describes the Platform&apos;s
                intended privacy and data protection practices.
                It does not limit any rights or protections
                provided to you under applicable law. Where
                applicable law provides greater protection than
                this policy, the applicable legal requirements
                will prevail.
              </p>
            </section>
          </article>

          {/* ================================================================ */}
          {/* Scroll to Top                                                   */}
          {/* ================================================================ */}

          {showScrollTop && (
            <button
              type="button"
              className="scroll-to-top"
              onClick={scrollToTop}
              aria-label="Scroll to top of Privacy Policy"
              title="Scroll to top"
            >
              <ArrowUp
                size={20}
                aria-hidden="true"
              />
            </button>
          )}
        </main>
      </div>

      {/* ================================================================== */}
      {/* Footer Navigation                                                 */}
      {/* ================================================================== */}

      <footer
        className="legal-footer-nav"
        aria-label="Legal navigation"
      >
        <Link
          to="/terms"
          className="legal-link"
        >
          <FileText
            size={16}
            aria-hidden="true"
          />

          <span>Terms of Service</span>
        </Link>

        <Link
          to="/"
          className="legal-link"
        >
          <Home
            size={16}
            aria-hidden="true"
          />

          <span>Back to Home</span>
        </Link>

        <a
          href={`mailto:${PRIVACY_EMAIL}`}
          className="legal-link"
        >
          <Mail
            size={16}
            aria-hidden="true"
          />

          <span>Privacy Requests</span>
        </a>

        <span
          className="legal-footer-copyright"
          aria-label={`Copyright ${currentYear} TITech Community Capital`}
        >
          © {currentYear} TITech Community Capital
        </span>
      </footer>
    </div>
  );
};

export default PrivacyPolicy;