/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Terms of Service
 * File: frontend/src/pages/TermsOfService.jsx
 *
 * Production Grade
 * ----------------------------------------------------------------------------
 * - Comprehensive Terms of Service presentation
 * - Accessible semantic document structure
 * - Sticky section navigation
 * - Active section tracking
 * - Deep-link compatible anchors
 * - Scroll-to-top support
 * - Keyboard accessible navigation
 * - Print-friendly document layout
 * - Reduced-motion awareness
 * - Responsive mobile/tablet/desktop experience
 * - Defensive browser API usage
 * - Uganda governing-law disclosure
 * - TITech Community Capital terminology consistency
 * - No ACFOS terminology
 * ============================================================================
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Link } from 'react-router-dom';

import {
  AlertCircle,
  ChevronUp,
  FileText,
  Gavel,
  Home,
  Lock,
  Printer,
  Scale,
  ShieldCheck,
} from 'lucide-react';

import './LegalPages.css';

/* ============================================================================
 * Constants
 * ========================================================================== */

const LEGAL_LAST_UPDATED = 'January 15, 2026';
const LEGAL_VERSION = '1.0';

const CONTACT_EMAIL = 'legal@titechcommunity.app';
const CONTACT_PHONE = '+256394324760';
const CONTACT_PHONE_DISPLAY = '+256 (394) 324760';

const SECTION_IDS = Object.freeze([
  'section-1',
  'section-2',
  'section-3',
  'section-4',
  'section-5',
  'section-6',
  'section-7',
  'section-8',
  'section-9',
  'section-10',
  'contact-information',
]);

const NAVIGATION = Object.freeze([
  {
    id: 'terms',
    title: 'Terms of Service',
    icon: Scale,
    items: [
      {
        id: 'section-1',
        label: '1. Acceptance of Terms',
      },
      {
        id: 'section-2',
        label: '2. User Rights & Responsibilities',
      },
      {
        id: 'section-3',
        label: '3. User Conduct',
      },
      {
        id: 'section-4',
        label: '4. Payment Terms',
      },
      {
        id: 'section-5',
        label: '5. Loan Agreements',
      },
      {
        id: 'section-6',
        label: '6. Savings Groups',
      },
      {
        id: 'section-7',
        label: '7. Financial Transactions',
      },
      {
        id: 'section-8',
        label: '8. Dispute Resolution',
      },
      {
        id: 'section-9',
        label: '9. Limitation of Liability',
      },
      {
        id: 'section-10',
        label: '10. Governing Law',
      },
      {
        id: 'contact-information',
        label: 'Contact Information',
      },
    ],
  },
]);

/* ============================================================================
 * Utility Helpers
 * ========================================================================== */

function getScrollContainer() {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.querySelector('.legal-content');
}

function getSectionElement(id) {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.getElementById(id);
}

function prefersReducedMotion() {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  return window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
}

function scrollToSection(id) {
  const target = getSectionElement(id);

  if (!target) {
    return;
  }

  target.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
}

/* ============================================================================
 * Component
 * ========================================================================== */

const TermsOfService = () => {
  const contentRef = useRef(null);
  const observerRef = useRef(null);
  const navigationTimerRef = useRef(null);

  const [activeSection, setActiveSection] = useState('section-1');
  const [showScrollTop, setShowScrollTop] = useState(false);

  /* --------------------------------------------------------------------------
   * Derived metadata
   * ------------------------------------------------------------------------ */

  const navigation = useMemo(
    () => NAVIGATION,
    [],
  );

  /* --------------------------------------------------------------------------
   * Scroll handling
   * ------------------------------------------------------------------------ */

  const handleContentScroll = useCallback(() => {
    const container = contentRef.current;

    if (!container) {
      return;
    }

    setShowScrollTop(container.scrollTop > 420);
  }, []);

  /* --------------------------------------------------------------------------
   * Scroll to top
   * ------------------------------------------------------------------------ */

  const scrollToTop = useCallback(() => {
    const container = getScrollContainer();

    if (!container) {
      return;
    }

    container.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });

    if (
      typeof window !== 'undefined' &&
      window.history?.replaceState
    ) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname +
          window.location.search,
      );
    }

    setActiveSection('section-1');
  }, []);

  /* --------------------------------------------------------------------------
   * Print
   * ------------------------------------------------------------------------ */

  const handlePrint = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.print === 'function'
    ) {
      window.print();
    }
  }, []);

  /* --------------------------------------------------------------------------
   * Section navigation
   * ------------------------------------------------------------------------ */

  const handleSectionNavigation = useCallback(
    (event, id) => {
      event.preventDefault();

      if (!SECTION_IDS.includes(id)) {
        return;
      }

      setActiveSection(id);
      scrollToSection(id);

      if (
        typeof window !== 'undefined' &&
        window.history?.replaceState
      ) {
        window.history.replaceState(
          null,
          '',
          `#${id}`,
        );
      }
    },
    [],
  );

  /* --------------------------------------------------------------------------
   * Scroll observer
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    const container = contentRef.current;

    if (
      !container ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return undefined;
    }

    const sections = SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!sections.length) {
      return undefined;
    }

    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
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

        const nextId =
          visibleEntries[0]?.target?.id;

        if (nextId) {
          setActiveSection(nextId);
        }
      },
      {
        root: container,
        rootMargin: '-12% 0px -68% 0px',
        threshold: [0, 0.1, 0.25, 0.5],
      },
    );

    sections.forEach((section) => {
      observerRef.current?.observe(section);
    });

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  /* --------------------------------------------------------------------------
   * Native scroll listener
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    const container = contentRef.current;

    if (!container) {
      return undefined;
    }

    container.addEventListener(
      'scroll',
      handleContentScroll,
      {
        passive: true,
      },
    );

    handleContentScroll();

    return () => {
      container.removeEventListener(
        'scroll',
        handleContentScroll,
      );
    };
  }, [handleContentScroll]);

  /* --------------------------------------------------------------------------
   * Deep-link support
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const hash = String(
      window.location.hash || '',
    ).replace(/^#/, '');

    if (!SECTION_IDS.includes(hash)) {
      return undefined;
    }

    navigationTimerRef.current =
      window.setTimeout(() => {
        setActiveSection(hash);
        scrollToSection(hash);
      }, 60);

    return () => {
      if (navigationTimerRef.current) {
        window.clearTimeout(
          navigationTimerRef.current,
        );
        navigationTimerRef.current = null;
      }
    };
  }, []);

  /* --------------------------------------------------------------------------
   * Keyboard support
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key === 'Escape' &&
        showScrollTop
      ) {
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
  }, [scrollToTop, showScrollTop]);

  /* --------------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------------ */

  return (
    <div
      className="legal-page terms-of-service-page"
    >
      {/* ======================================================================
       * Header
       * ==================================================================== */}

      <header className="legal-header">
        <div className="legal-header-content">
          <div
            className="legal-header-badge"
            aria-hidden="true"
          >
            <ShieldCheck size={20} />
            <span>TITech Community Capital</span>
          </div>

          <h1 className="legal-title">
            Terms of Service
          </h1>

          <p className="legal-subtitle">
            Platform Terms, Responsibilities,
            Transactions & Governance
          </p>

          <p className="legal-description">
            These Terms of Service govern access to
            and use of the TITech Community Capital
            Platform. Please review them carefully
            before using services provided through
            the Platform.
          </p>

          <div
            className="legal-header-meta"
            aria-label="Terms metadata"
          >
            <span>
              <strong>Last updated:</strong>{' '}
              {LEGAL_LAST_UPDATED}
            </span>

            <span aria-hidden="true">•</span>

            <span>
              <strong>Version:</strong>{' '}
              {LEGAL_VERSION}
            </span>
          </div>
        </div>
      </header>

      {/* ======================================================================
       * Main Layout
       * ==================================================================== */}

      <div className="legal-container">
        {/* ====================================================================
         * Sidebar
         * ================================================================== */}

        <aside
          className="legal-sidebar"
          aria-label="Terms of Service navigation"
        >
          <nav
            className="legal-nav"
            aria-label="Terms sections"
          >
            {navigation.map((section) => {
              const SectionIcon = section.icon;

              return (
                <div
                  key={section.id}
                  className="nav-section"
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
                    {section.items.map((item) => {
                      const active =
                        activeSection === item.id;

                      return (
                        <a
                          key={item.id}
                          href={`#${item.id}`}
                          className={`nav-link${
                            active
                              ? ' active'
                              : ''
                          }`}
                          aria-current={
                            active
                              ? 'location'
                              : undefined
                          }
                          onClick={(event) =>
                            handleSectionNavigation(
                              event,
                              item.id,
                            )
                          }
                        >
                          {item.label}
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="legal-nav-actions">
            <Link
              to="/dashboard"
              className="nav-action-link"
              aria-label="Return to TITech Community Capital dashboard"
            >
              <Home
                size={18}
                aria-hidden="true"
              />

              <span>Dashboard</span>
            </Link>

            <Link
              to="/privacy"
              className="nav-action-link"
              aria-label="Open TITech Community Capital Privacy Policy"
            >
              <Lock
                size={18}
                aria-hidden="true"
              />

              <span>Privacy</span>
            </Link>

            <button
              type="button"
              className="nav-action-link"
              onClick={handlePrint}
              aria-label="Print Terms of Service"
            >
              <Printer
                size={18}
                aria-hidden="true"
              />

              <span>Print</span>
            </button>
          </div>
        </aside>

        {/* ====================================================================
         * Main Content
         * ================================================================== */}

        <main
          ref={contentRef}
          className="legal-content"
          tabIndex={-1}
          aria-label="TITech Community Capital Terms of Service"
        >
          <article className="legal-article">
            {/* ================================================================
             * Section 1
             * ============================================================ */}

            <section
              id="section-1"
              className="legal-section"
              aria-labelledby="section-1-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  01
                </span>

                <div>
                  <h2 id="section-1-title">
                    1. Acceptance of Terms
                  </h2>

                  <p className="section-update">
                    Effective through the current
                    version published by TITech
                    Community Capital.
                  </p>
                </div>
              </div>

              <p>
                By accessing or using the TITech
                Community Capital Platform,
                you acknowledge that you have read,
                understood, and agree to be bound by
                these Terms of Service and all
                applicable policies referenced by
                them.
              </p>

              <p>
                If you do not agree with these
                Terms, you must discontinue use of
                the Platform. TITech Community
                Capital may update these Terms from
                time to time. Material changes may
                be communicated through appropriate
                Platform channels where required by
                applicable law.
              </p>

              <div
                className="highlight"
                role="note"
              >
                <strong>Important:</strong>{' '}
                Continued use of the Platform after
                updated Terms become effective may
                constitute acceptance of the revised
                Terms to the extent permitted by
                applicable law.
              </div>
            </section>

            {/* ================================================================
             * Section 2
             * ============================================================ */}

            <section
              id="section-2"
              className="legal-section"
              aria-labelledby="section-2-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  02
                </span>

                <div>
                  <h2 id="section-2-title">
                    2. User Rights & Responsibilities
                  </h2>
                </div>
              </div>

              <p>
                Subject to these Terms, TITech
                Community Capital grants you a
                limited, non-exclusive,
                non-transferable right to access and
                use the Platform for lawful purposes.
              </p>

              <h3>
                User Responsibilities
              </h3>

              <ul>
                <li>
                  Maintain the confidentiality of
                  account credentials and
                  authentication information.
                </li>

                <li>
                  Accept responsibility for activity
                  performed through your account,
                  except where caused by a confirmed
                  security incident outside your
                  control.
                </li>

                <li>
                  Provide accurate, complete, and
                  reasonably current registration and
                  verification information.
                </li>

                <li>
                  Comply with applicable laws,
                  regulations, policies, and
                  contractual obligations.
                </li>

                <li>
                  Use the Platform only for lawful,
                  authorized, and legitimate
                  activities.
                </li>

                <li>
                  Promptly notify TITech Community
                  Capital of suspected unauthorized
                  access or misuse.
                </li>
              </ul>
            </section>

            {/* ================================================================
             * Section 3
             * ============================================================ */}

            <section
              id="section-3"
              className="legal-section"
              aria-labelledby="section-3-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  03
                </span>

                <div>
                  <h2 id="section-3-title">
                    3. User Conduct
                  </h2>
                </div>
              </div>

              <p>
                You must not misuse the Platform,
                interfere with its operation, or
                compromise the security, privacy,
                or rights of TITech Community
                Capital or other users.
              </p>

              <h3>
                Prohibited Activities
              </h3>

              <ul>
                <li>
                  Harass, threaten, intimidate, or
                  deliberately cause distress to
                  another person.
                </li>

                <li>
                  Engage in fraud, impersonation,
                  misrepresentation, deception, or
                  unauthorized financial activity.
                </li>

                <li>
                  Attempt to gain unauthorized access
                  to Platform systems, APIs, accounts,
                  or data.
                </li>

                <li>
                  Upload, transmit, or distribute
                  malicious, unlawful, or harmful
                  content.
                </li>

                <li>
                  Violate intellectual property,
                  privacy, or other legal rights.
                </li>

                <li>
                  Disrupt, overload, interfere with,
                  or attempt to bypass Platform
                  security controls.
                </li>

                <li>
                  Send spam, unauthorized commercial
                  communications, or abusive
                  messages.
                </li>

                <li>
                  Reverse engineer, decompile,
                  disassemble, or improperly attempt
                  to discover protected implementation
                  details.
                </li>

                <li>
                  Use the Platform for money
                  laundering, terrorist financing,
                  sanctions evasion, or other
                  unlawful financial activity.
                </li>
              </ul>
            </section>

            {/* ================================================================
             * Section 4
             * ============================================================ */}

            <section
              id="section-4"
              className="legal-section"
              aria-labelledby="section-4-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  04
                </span>

                <div>
                  <h2 id="section-4-title">
                    4. Payment Terms
                  </h2>
                </div>
              </div>

              <p>
                TITech Community Capital may
                provide technology that facilitates
                or records financial activity
                between authorized participants.
                Payment processing may also depend
                on approved third-party payment
                providers and applicable regulatory
                requirements.
              </p>

              <h3>
                Payment Processing
              </h3>

              <ul>
                <li>
                  Use only payment methods and
                  transaction channels authorized by
                  the Platform.
                </li>

                <li>
                  Review transaction details before
                  confirming a payment.
                </li>

                <li>
                  Processing times may vary by
                  payment provider, financial
                  institution, network conditions,
                  and transaction type.
                </li>

                <li>
                  Transactions may fail, be delayed,
                  reversed, rejected, or placed under
                  review.
                </li>

                <li>
                  Applicable provider or financial
                  institution charges may be payable
                  by the user where disclosed or
                  otherwise applicable.
                </li>
              </ul>

              <h3>
                Refunds & Reversals
              </h3>

              <ul>
                <li>
                  Refunds and reversals depend on the
                  transaction type and the rules of
                  the relevant provider.
                </li>

                <li>
                  Some completed or settled
                  transactions may not be reversible.
                </li>

                <li>
                  Transaction discrepancies should
                  be reported as soon as reasonably
                  possible.
                </li>

                <li>
                  Resolution may require coordination
                  with a payment provider or financial
                  institution.
                </li>
              </ul>
            </section>

            {/* ================================================================
             * Section 5
             * ============================================================ */}

            <section
              id="section-5"
              className="legal-section"
              aria-labelledby="section-5-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  05
                </span>

                <div>
                  <h2 id="section-5-title">
                    5. Loan Agreements
                  </h2>
                </div>
              </div>

              <p>
                Where the Platform supports
                community lending, loan arrangements
                may be entered into between
                authorized participants subject to
                applicable group rules and law.
              </p>

              <ul>
                <li>
                  Loan terms should be clearly agreed
                  by the relevant parties.
                </li>

                <li>
                  Principal amounts, repayment
                  schedules, applicable charges, and
                  other material conditions should be
                  documented.
                </li>

                <li>
                  TITech Community Capital does not
                  guarantee repayment unless expressly
                  provided under a separate binding
                  arrangement.
                </li>

                <li>
                  Defaults and disputes may require
                  direct resolution, mediation,
                  arbitration, or appropriate legal
                  processes.
                </li>

                <li>
                  Users remain responsible for
                  understanding the risks associated
                  with lending and borrowing.
                </li>

                <li>
                  Loan arrangements must comply with
                  applicable laws and regulatory
                  requirements.
                </li>
              </ul>

              <div
                className="highlight"
                role="note"
              >
                <strong>Important:</strong>{' '}
                TITech Community Capital operates as
                a technology platform and does not,
                by itself, constitute a licensed
                financial institution or provider of
                personalized financial or legal
                advice.
              </div>
            </section>

            {/* ================================================================
             * Section 6
             * ============================================================ */}

            <section
              id="section-6"
              className="legal-section"
              aria-labelledby="section-6-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  06
                </span>

                <div>
                  <h2 id="section-6-title">
                    6. Savings Groups
                  </h2>
                </div>
              </div>

              <p>
                Users may create, administer, or
                participate in community savings
                groups through supported Platform
                functionality.
              </p>

              <ul>
                <li>
                  Group administrators may establish
                  group rules and operational
                  procedures subject to Platform
                  policies and applicable law.
                </li>

                <li>
                  Group members are expected to comply
                  with legitimate group rules and
                  agreed contribution obligations.
                </li>

                <li>
                  Group-level disagreements should
                  first be addressed through the
                  group's defined governance process.
                </li>

                <li>
                  TITech Community Capital may
                  provide administrative and
                  transactional tools but does not
                  guarantee that group participants
                  will perform their obligations.
                </li>

                <li>
                  Group membership, contribution, and
                  governance data may be retained and
                  processed according to the Platform's
                  Privacy Policy and legal obligations.
                </li>

                <li>
                  Removal from or departure from a
                  group may be subject to outstanding
                  financial, contractual, or legal
                  obligations.
                </li>
              </ul>
            </section>

            {/* ================================================================
             * Section 7
             * ============================================================ */}

            <section
              id="section-7"
              className="legal-section"
              aria-labelledby="section-7-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  07
                </span>

                <div>
                  <h2 id="section-7-title">
                    7. Financial Transactions
                  </h2>
                </div>
              </div>

              <p>
                Financial transactions performed or
                recorded through the Platform may be
                subject to additional controls,
                verification, fraud monitoring,
                transaction limits, and regulatory
                requirements.
              </p>

              <ul>
                <li>
                  Users are responsible for reviewing
                  transaction details before
                  confirmation.
                </li>

                <li>
                  Transaction identifiers,
                  timestamps, audit records, and
                  related metadata may be retained for
                  reconciliation, security, audit, and
                  compliance purposes.
                </li>

                <li>
                  TITech Community Capital may delay,
                  suspend, reject, or restrict a
                  transaction where reasonably necessary
                  for security, fraud prevention,
                  compliance, or operational integrity.
                </li>

                <li>
                  Applicable transaction fees should
                  be disclosed before processing where
                  required.
                </li>

                <li>
                  Users must comply with applicable
                  currency, tax, sanctions,
                  anti-money-laundering, and other
                  financial requirements.
                </li>

                <li>
                  Electronic records generated through
                  the Platform may form part of the
                  transaction history used for
                  operational and compliance purposes.
                </li>
              </ul>

              <div
                className="highlight"
                role="note"
              >
                <strong>
                  Transaction Safety:
                </strong>{' '}
                Never share passwords, one-time
                authentication codes, private keys,
                or payment credentials with another
                person through the Platform.
              </div>
            </section>

            {/* ================================================================
             * Section 8
             * ============================================================ */}

            <section
              id="section-8"
              className="legal-section"
              aria-labelledby="section-8-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  08
                </span>

                <div>
                  <h2 id="section-8-title">
                    8. Dispute Resolution
                  </h2>
                </div>
              </div>

              <p>
                We encourage users to contact TITech
                Community Capital first where a
                dispute concerns Platform operation,
                account access, transaction records,
                or supported services.
              </p>

              <div
                className="contact-box"
                aria-label="Dispute contact details"
              >
                <p>
                  <strong>Email:</strong>{' '}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                  >
                    {CONTACT_EMAIL}
                  </a>
                </p>

                <p>
                  <strong>Phone:</strong>{' '}
                  <a
                    href={`tel:${CONTACT_PHONE}`}
                  >
                    {CONTACT_PHONE_DISPLAY}
                  </a>
                </p>

                <p>
                  <strong>Location:</strong>{' '}
                  Kampala, Uganda
                </p>
              </div>

              <h3>
                Escalation
              </h3>

              <p>
                If a dispute cannot be resolved
                through applicable support channels,
                the matter may be escalated through
                mediation, arbitration, regulatory
                processes, or court proceedings as
                permitted by applicable law.
              </p>
            </section>

            {/* ================================================================
             * Section 9
             * ============================================================ */}

            <section
              id="section-9"
              className="legal-section"
              aria-labelledby="section-9-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  09
                </span>

                <div>
                  <h2 id="section-9-title">
                    9. Limitation of Liability
                  </h2>
                </div>
              </div>

              <div
                className="highlight highlight-danger"
                role="note"
              >
                <AlertCircle
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  TITech Community Capital provides
                  the Platform to the extent made
                  available under applicable law and
                  does not guarantee uninterrupted,
                  error-free, or risk-free operation.
                </span>
              </div>

              <p>
                To the fullest extent permitted by
                applicable law, TITech Community
                Capital disclaims warranties and
                conditions that cannot lawfully be
                implied, including warranties of
                merchantability, fitness for a
                particular purpose, and
                non-infringement.
              </p>

              <p>
                To the fullest extent permitted by
                applicable law, TITech Community
                Capital will not be liable for
                indirect, incidental, special,
                consequential, exemplary, or punitive
                damages arising from use of or
                inability to use the Platform.
              </p>

              <p>
                Nothing in these Terms excludes or
                limits liability that cannot lawfully
                be excluded or limited under applicable
                law.
              </p>
            </section>

            {/* ================================================================
             * Section 10
             * ============================================================ */}

            <section
              id="section-10"
              className="legal-section"
              aria-labelledby="section-10-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  10
                </span>

                <div>
                  <h2 id="section-10-title">
                    10. Governing Law
                  </h2>
                </div>
              </div>

              <p>
                These Terms of Service are intended
                to be governed by and interpreted in
                accordance with the laws of Uganda,
                subject to any mandatory legal
                requirements applicable to a
                particular user, transaction, or
                service.
              </p>

              <p>
                Where permitted by law, disputes
                arising from these Terms or use of the
                Platform may be subject to the
                jurisdiction of the competent courts
                of Uganda.
              </p>

              <p>
                If any provision of these Terms is
                found to be invalid or unenforceable,
                the remaining provisions will continue
                in effect to the fullest extent
                permitted by law.
              </p>
            </section>

            {/* ================================================================
             * Contact Information
             * ============================================================ */}

            <section
              id="contact-information"
              className="legal-section contact-section"
              aria-labelledby="contact-information-title"
            >
              <div className="legal-section-heading">
                <span
                  className="legal-section-number"
                  aria-hidden="true"
                >
                  •
                </span>

                <div>
                  <h2 id="contact-information-title">
                    Contact Information
                  </h2>
                </div>
              </div>

              <p>
                Questions regarding these Terms of
                Service, Platform policies, or legal
                notices may be directed to TITech
                Community Capital through the approved
                contact channels below.
              </p>

              <div
                className="contact-box"
                aria-label="TITech Community Capital contact information"
              >
                <p>
                  <strong>Email:</strong>{' '}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                  >
                    {CONTACT_EMAIL}
                  </a>
                </p>

                <p>
                  <strong>Phone:</strong>{' '}
                  <a
                    href={`tel:${CONTACT_PHONE}`}
                  >
                    {CONTACT_PHONE_DISPLAY}
                  </a>
                </p>

                <p>
                  <strong>Address:</strong>{' '}
                  TITech Community Capital Ltd,
                  Kampala, Uganda
                </p>

                <p>
                  <strong>Response target:</strong>{' '}
                  We aim to respond to legal inquiries
                  within 5 business days, subject to
                  verification, complexity, and
                  applicable legal requirements.
                </p>
              </div>
            </section>

            {/* ================================================================
             * Related Documents
             * ============================================================ */}

            <section
              className="legal-related-documents"
              aria-labelledby="related-documents-title"
            >
              <div className="legal-major-heading">
                <div
                  className="legal-major-icon"
                  aria-hidden="true"
                >
                  <FileText size={22} />
                </div>

                <div>
                  <h2
                    id="related-documents-title"
                    className="major-title"
                  >
                    Related Legal Documents
                  </h2>

                  <p className="section-update">
                    Review the Privacy Policy and other
                    applicable Platform policies.
                  </p>
                </div>
              </div>

              <div className="legal-related-links">
                <Link
                  to="/privacy"
                  className="legal-related-link"
                >
                  <Lock
                    size={18}
                    aria-hidden="true"
                  />

                  <span>
                    <strong>
                      Privacy Policy
                    </strong>

                    <small>
                      How TITech Community Capital
                      handles personal information.
                    </small>
                  </span>
                </Link>

                <Link
                  to="/legal"
                  className="legal-related-link"
                >
                  <Gavel
                    size={18}
                    aria-hidden="true"
                  />

                  <span>
                    <strong>
                      Legal Information
                    </strong>

                    <small>
                      Consolidated legal documents and
                      platform disclosures.
                    </small>
                  </span>
                </Link>
              </div>
            </section>

            {/* ================================================================
             * Footer Note
             * ============================================================ */}

            <footer className="legal-footer-note">
              <p>
                <strong>Last Updated:</strong>{' '}
                {LEGAL_LAST_UPDATED}{' '}
                <span aria-hidden="true">|</span>{' '}
                <strong>Version:</strong>{' '}
                {LEGAL_VERSION}
              </p>

              <p>
                These Terms may be updated to reflect
                changes in the Platform, applicable
                law, regulatory requirements, security
                controls, or business operations.
                Please review this page periodically.
              </p>

              <p className="legal-footer-brand">
                ©{' '}
                {new Date().getFullYear()}{' '}
                TITech Community Capital.
                All rights reserved.
              </p>
            </footer>
          </article>

          {/* ==================================================================
           * Scroll To Top
           * ================================================================= */}

          {showScrollTop && (
            <button
              type="button"
              className="scroll-top-btn"
              onClick={scrollToTop}
              aria-label="Scroll to top of Terms of Service"
              title="Scroll to top"
            >
              <ChevronUp
                size={20}
                aria-hidden="true"
              />
            </button>
          )}
        </main>
      </div>

      {/* ======================================================================
       * Footer Navigation
       * ==================================================================== */}

      <footer className="legal-footer-nav">
        <Link
          to="/privacy"
          className="legal-link"
        >
          <Lock
            size={16}
            aria-hidden="true"
          />

          <span>Privacy Policy</span>
        </Link>

        <Link
          to="/dashboard"
          className="legal-link"
        >
          <Home
            size={16}
            aria-hidden="true"
          />

          <span>Dashboard</span>
        </Link>

        <Link
          to="/legal"
          className="legal-link"
        >
          <FileText
            size={16}
            aria-hidden="true"
          />

          <span>Legal Information</span>
        </Link>
      </footer>
    </div>
  );
};

export default TermsOfService;