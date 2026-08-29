//writing{variant="document" id="74261"}
/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Terms of Service Page
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/TermsOfService.jsx
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Production-grade presentation layer for the TITech Community Capital
 *   Terms of Service.
 *
 * Responsibilities:
 *   - Render the current Terms of Service.
 *   - Provide accessible section navigation.
 *   - Support URL hash/deep-link navigation.
 *   - Display document version and effective date.
 *   - Provide print support.
 *   - Provide copy-link support.
 *   - Provide responsive legal-document navigation.
 *   - Integrate with the centralized legal route system.
 *   - Remain independent from backend implementation details.
 *
 * Architecture:
 *   legalConstants.js
 *        ↓
 *   legalConfig.js
 *        ↓
 *   legalTypes.js
 *        ↓
 *   legalRoutes.js
 *        ↓
 *   TermsOfService.jsx
 *
 * Important:
 *   This component presents legal content and does not constitute legal
 *   advice. Final production publication should be reviewed and approved
 *   by qualified legal counsel and relevant compliance stakeholders.
 *
 * Branding:
 *   TITech Community Capital
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

import PropTypes from 'prop-types';

import {
  LEGAL_ACCESSIBILITY,
  LEGAL_ACCESSIBILITY_MESSAGES,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_ROUTES,
  LEGAL_SYSTEM,
  LEGAL_UI,
  LEGAL_VERSIONING,
} from './legalConstants';

import {
  buildLegalSectionUrl,
} from './legalRoutes';

import './LegalPages.css';

/* ============================================================================
 * DOCUMENT METADATA
 * ========================================================================== */

const DOCUMENT = Object.freeze({
  id:
    'terms-of-service',

  slug:
    'terms-of-service',

  type:
    LEGAL_DOCUMENT_TYPES.TERMS_OF_SERVICE,

  title:
    'Terms of Service',

  shortTitle:
    'Terms',

  version:
    LEGAL_VERSIONING.CURRENT_VERSION,

  lastUpdated:
    'January 15, 2026',

  effectiveDate:
    'January 15, 2026',

  organization:
    LEGAL_SYSTEM.ORGANIZATION,

  jurisdiction:
    LEGAL_SYSTEM.JURISDICTION,

  route:
    LEGAL_ROUTES.TERMS,
});

/* ============================================================================
 * CONTACT INFORMATION
 * ========================================================================== */

const CONTACT = Object.freeze({
  legalEmail:
    'legal@titechcommunity.app',

  supportEmail:
    'support@titechcommunity.app',

  privacyEmail:
    'privacy@communitysavings.app',

  phone:
    '+256 (782) 397907',

  phoneHref:
    '+256782397907',

  address:
    'TITech Community Capital Ltd, Plot 69-71 Jinja Road, Kampala, Uganda',
});

/* ============================================================================
 * SECTION REGISTRY
 * ========================================================================== */

const SECTIONS = Object.freeze([
  {
    id:
      'tos-1',

    title:
      'Acceptance of These Terms',

    shortTitle:
      'Acceptance',
  },

  {
    id:
      'tos-2',

    title:
      'Eligibility and Account Registration',

    shortTitle:
      'Eligibility & Accounts',
  },

  {
    id:
      'tos-3',

    title:
      'TITech Community Capital Services',

    shortTitle:
      'Our Services',
  },

  {
    id:
      'tos-4',

    title:
      'Community, Group and Tenant Responsibilities',

    shortTitle:
      'Community Responsibilities',
  },

  {
    id:
      'tos-5',

    title:
      'Financial and Transaction Services',

    shortTitle:
      'Financial Services',
  },

  {
    id:
      'tos-6',

    title:
      'Fees, Charges and Taxes',

    shortTitle:
      'Fees & Charges',
  },

  {
    id:
      'tos-7',

    title:
      'User Responsibilities and Acceptable Use',

    shortTitle:
      'User Responsibilities',
  },

  {
    id:
      'tos-8',

    title:
      'Security and Account Protection',

    shortTitle:
      'Security',
  },

  {
    id:
      'tos-9',

    title:
      'Intellectual Property',

    shortTitle:
      'Intellectual Property',
  },

  {
    id:
      'tos-10',

    title:
      'Third-Party Services',

    shortTitle:
      'Third Parties',
  },

  {
    id:
      'tos-11',

    title:
      'Service Availability and Changes',

    shortTitle:
      'Availability & Changes',
  },

  {
    id:
      'tos-12',

    title:
      'Suspension and Termination',

    shortTitle:
      'Suspension & Termination',
  },

  {
    id:
      'tos-13',

    title:
      'Disclaimers and Limitations',

    shortTitle:
      'Disclaimers',
  },

  {
    id:
      'tos-14',

    title:
      'Indemnification',

    shortTitle:
      'Indemnification',
  },

  {
    id:
      'tos-15',

    title:
      'Limitation of Liability',

    shortTitle:
      'Liability',
  },

  {
    id:
      'tos-16',

    title:
      'Dispute Resolution and Governing Law',

    shortTitle:
      'Disputes & Law',
  },

  {
    id:
      'tos-17',

    title:
      'Changes to These Terms',

    shortTitle:
      'Changes',
  },

  {
    id:
      'tos-18',

    title:
      'General Provisions',

    shortTitle:
      'General',
  },

  {
    id:
      'tos-19',

    title:
      'Contact Information',

    shortTitle:
      'Contact',
  },
]);

/* ============================================================================
 * SMALL PRESENTATIONAL COMPONENTS
 * ========================================================================== */

function SectionHeading({
  id,
  children,
}) {
  return (
    <h2
      id={id}
      className="legal-section__title"
      tabIndex={-1}
    >
      {children}
    </h2>
  );
}

SectionHeading.propTypes = {
  id:
    PropTypes.string.isRequired,

  children:
    PropTypes.node.isRequired,
};

/* ============================================================================
 * PAGE COMPONENT
 * ========================================================================== */

export default function TermsOfService({
  showTableOfContents = LEGAL_UI.SHOW_TABLE_OF_CONTENTS,
  showPrintButton = LEGAL_UI.SHOW_PRINT_BUTTON,
  showCopyLink = LEGAL_UI.SHOW_COPY_LINK,
  showBackToTop = LEGAL_UI.SHOW_BACK_TO_TOP,
  onSectionChange,
}) {
  const [activeSection, setActiveSection] =
    useState(SECTIONS[0].id);

  const [copyState, setCopyState] =
    useState('idle');

  const sectionRefs =
    useRef(new Map());

  const copyResetTimer =
    useRef(null);

  /* ==========================================================================
   * SECTION REF REGISTRATION
   * ======================================================================== */

  const registerSectionRef = useCallback(
    (id, node) => {
      if (node) {
        sectionRefs.current.set(
          id,
          node,
        );
      } else {
        sectionRefs.current.delete(
          id,
        );
      }
    },
    [],
  );

  /* ==========================================================================
   * SECTION NAVIGATION
   * ======================================================================== */

  const scrollToSection = useCallback(
    (sectionId, updateUrl = true) => {
      const element =
        sectionRefs.current.get(
          sectionId,
        );

      if (!element) {
        return false;
      }

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia ===
          'function' &&
        window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;

      element.scrollIntoView({
        behavior:
          LEGAL_ACCESSIBILITY.REDUCED_MOTION_RESPECTED &&
          prefersReducedMotion
            ? 'auto'
            : LEGAL_UI.SCROLL_BEHAVIOR,

        block:
          'start',
      });

      if (updateUrl) {
        const url =
          buildLegalSectionUrl(
            DOCUMENT.route,
            sectionId,
          );

        window.history.replaceState(
          null,
          '',
          url,
        );
      }

      setActiveSection(
        sectionId,
      );

      if (
        typeof onSectionChange ===
        'function'
      ) {
        onSectionChange(
          sectionId,
        );
      }

      if (
        LEGAL_ACCESSIBILITY.FOCUS_SECTION_ON_HASH
      ) {
        window.setTimeout(() => {
          element.focus({
            preventScroll: true,
          });
        }, 50);
      }

      return true;
    },
    [onSectionChange],
  );

  /* ==========================================================================
   * HASH / DEEP LINK INITIALIZATION
   * ======================================================================== */

  useEffect(() => {
    if (
      typeof window ===
      'undefined'
    ) {
      return undefined;
    }

    const rawHash =
      window.location.hash.replace(
        /^#/,
        '',
      );

    if (!rawHash) {
      return undefined;
    }

    let sectionId =
      rawHash;

    try {
      sectionId =
        decodeURIComponent(
          rawHash,
        );
    } catch {
      // Preserve raw hash when decoding fails.
    }

    const sectionExists =
      SECTIONS.some(
        (section) =>
          section.id ===
          sectionId,
      );

    if (!sectionExists) {
      return undefined;
    }

    const timer =
      window.setTimeout(() => {
        scrollToSection(
          sectionId,
          false,
        );
      }, 100);

    return () =>
      window.clearTimeout(
        timer,
      );
  }, [scrollToSection]);

  /* ==========================================================================
   * ACTIVE SECTION OBSERVER
   * ======================================================================== */

  useEffect(() => {
    if (
      typeof IntersectionObserver ===
      'undefined'
    ) {
      return undefined;
    }

    const observer =
      new IntersectionObserver(
        (entries) => {
          const visibleEntries =
            entries
              .filter(
                (entry) =>
                  entry.isIntersecting,
              )
              .sort(
                (a, b) =>
                  a.boundingClientRect.top -
                  b.boundingClientRect.top,
              );

          const firstVisible =
            visibleEntries[0];

          if (!firstVisible) {
            return;
          }

          const sectionId =
            firstVisible.target.id;

          setActiveSection(
            sectionId,
          );

          if (
            typeof onSectionChange ===
            'function'
          ) {
            onSectionChange(
              sectionId,
            );
          }
        },
        {
          rootMargin:
            `-${LEGAL_UI.HEADER_OFFSET}px 0px -55% 0px`,

          threshold:
            0.01,
        },
      );

    sectionRefs.current.forEach(
      (element) => {
        observer.observe(
          element,
        );
      },
    );

    return () => {
      observer.disconnect();
    };
  }, [onSectionChange]);

  /* ==========================================================================
   * TIMER CLEANUP
   * ======================================================================== */

  useEffect(
    () => () => {
      if (copyResetTimer.current) {
        window.clearTimeout(
          copyResetTimer.current,
        );
      }
    },
    [],
  );

  /* ==========================================================================
   * PRINT
   * ======================================================================== */

  const handlePrint = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.print ===
        'function'
    ) {
      window.print();
    }
  }, []);

  /* ==========================================================================
   * COPY CURRENT URL
   * ======================================================================== */

  const handleCopyLink = useCallback(
    async () => {
      if (
        typeof window ===
        'undefined'
      ) {
        return;
      }

      const url =
        window.location.href;

      try {
        if (
          navigator.clipboard &&
          typeof navigator.clipboard.writeText ===
            'function'
        ) {
          await navigator.clipboard.writeText(
            url,
          );
        } else {
          const textarea =
            document.createElement(
              'textarea',
            );

          textarea.value =
            url;

          textarea.setAttribute(
            'readonly',
            '',
          );

          textarea.style.position =
            'fixed';

          textarea.style.opacity =
            '0';

          document.body.appendChild(
            textarea,
          );

          textarea.select();

          document.execCommand(
            'copy',
          );

          document.body.removeChild(
            textarea,
          );
        }

        setCopyState(
          'copied',
        );

        if (copyResetTimer.current) {
          window.clearTimeout(
            copyResetTimer.current,
          );
        }

        copyResetTimer.current =
          window.setTimeout(
            () => {
              setCopyState(
                'idle',
              );
            },
            2500,
          );
      } catch {
        setCopyState(
          'error',
        );

        if (copyResetTimer.current) {
          window.clearTimeout(
            copyResetTimer.current,
          );
        }

        copyResetTimer.current =
          window.setTimeout(
            () => {
              setCopyState(
                'idle',
              );
            },
            2500,
          );
      }
    },
    [],
  );

  /* ==========================================================================
   * BACK TO TOP
   * ======================================================================== */

  const handleBackToTop =
    useCallback(() => {
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia ===
          'function' &&
        window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;

      window.scrollTo({
        top: 0,

        behavior:
          LEGAL_ACCESSIBILITY.REDUCED_MOTION_RESPECTED &&
          prefersReducedMotion
            ? 'auto'
            : LEGAL_UI.SCROLL_BEHAVIOR,
      });
    }, []);

  /* ==========================================================================
   * NAVIGATION MODEL
   * ======================================================================== */

  const navigationSections =
    useMemo(
      () =>
        SECTIONS.map(
          (section) => ({
            ...section,

            href:
              buildLegalSectionUrl(
                DOCUMENT.route,
                section.id,
              ),

            active:
              section.id ===
              activeSection,
          }),
        ),
      [activeSection],
    );

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <main
      id="main-content"
      className="legal-page legal-page--terms"
      aria-labelledby="terms-of-service-title"
    >
      {/* ======================================================================
          DOCUMENT HEADER
          ==================================================================== */}

      <header className="legal-page__header">
        <div className="legal-page__header-inner">
          <div className="legal-page__eyebrow">
            {LEGAL_SYSTEM.BRAND}
          </div>

          <h1
            id="terms-of-service-title"
            className="legal-page__title"
          >
            {DOCUMENT.title}
          </h1>

          <p className="legal-page__description">
            These Terms of Service govern your
            access to and use of TITech Community
            Capital applications, platforms,
            websites, APIs and related services.
          </p>

          <div
            className="legal-document-meta"
            aria-label="Terms of Service metadata"
          >
            {LEGAL_UI.SHOW_VERSION && (
              <span className="legal-document-meta__item">
                <strong>
                  Version:
                </strong>{' '}
                {DOCUMENT.version}
              </span>
            )}

            {LEGAL_UI.SHOW_LAST_UPDATED && (
              <span className="legal-document-meta__item">
                <strong>
                  Last updated:
                </strong>{' '}
                {DOCUMENT.lastUpdated}
              </span>
            )}

            {LEGAL_UI.SHOW_EFFECTIVE_DATE && (
              <span className="legal-document-meta__item">
                <strong>
                  Effective:
                </strong>{' '}
                {DOCUMENT.effectiveDate}
              </span>
            )}

            <span className="legal-document-meta__item">
              <strong>
                Jurisdiction:
              </strong>{' '}
              {DOCUMENT.jurisdiction}
            </span>
          </div>

          <div
            className="legal-page__actions"
            aria-label="Terms of Service actions"
          >
            {showPrintButton && (
              <button
                type="button"
                className="legal-button legal-button--secondary"
                onClick={handlePrint}
              >
                Print
              </button>
            )}

            {showCopyLink && (
              <button
                type="button"
                className="legal-button legal-button--secondary"
                onClick={handleCopyLink}
                aria-live="polite"
              >
                {copyState === 'copied'
                  ? 'Link Copied'
                  : copyState === 'error'
                    ? 'Copy Failed'
                    : 'Copy Link'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ======================================================================
          DOCUMENT BODY
          ==================================================================== */}

      <div className="legal-page__body">
        {showTableOfContents && (
          <aside
            className="legal-page__sidebar"
            aria-label="Terms of Service navigation"
          >
            <nav
              className="legal-toc"
              aria-label="Table of contents"
            >
              <h2 className="legal-toc__title">
                Contents
              </h2>

              <ol className="legal-toc__list">
                {navigationSections.map(
                  (section) => (
                    <li
                      key={section.id}
                      className="legal-toc__item"
                    >
                      <button
                        type="button"
                        className={`legal-toc__link${
                          section.active
                            ? ' is-active'
                            : ''
                        }`}
                        onClick={() =>
                          scrollToSection(
                            section.id,
                          )
                        }
                        aria-current={
                          section.active
                            ? 'location'
                            : undefined
                        }
                      >
                        {section.shortTitle}
                      </button>
                    </li>
                  ),
                )}
              </ol>
            </nav>
          </aside>
        )}

        {/* ====================================================================
            TERMS DOCUMENT
            ================================================================== */}

        <article className="legal-document">
          <div className="legal-document__notice">
            <strong>
              Important:
            </strong>{' '}
            Please read these Terms of Service
            carefully before using TITech Community
            Capital services. By accessing or using
            applicable services, you acknowledge
            that you have read and understood these
            Terms and agree to be bound by them to
            the extent permitted by applicable law.
          </div>

          {/* ==================================================================
              1. ACCEPTANCE
              ================================================================= */}

          <section
            id="tos-1"
            ref={(node) =>
              registerSectionRef(
                'tos-1',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-1-title"
          >
            <SectionHeading id="tos-1-title">
              1. Acceptance of These Terms
            </SectionHeading>

            <p>
              These Terms of Service (“Terms”)
              constitute an agreement between you
              and TITech Community Capital Ltd
              (“TITech Community Capital,” “TITech,”
              “we,” “us,” or “our”) concerning your
              access to and use of our services.
            </p>

            <p>
              By registering for an account,
              accessing the platform, participating
              in a supported community or tenant,
              or otherwise using applicable TITech
              services, you agree to these Terms and
              any policies, disclosures or
              supplemental terms incorporated into
              them.
            </p>

            <p>
              If you do not agree with these Terms,
              you must not use the applicable
              services.
            </p>
          </section>

          {/* ==================================================================
              2. ELIGIBILITY
              ================================================================= */}

          <section
            id="tos-2"
            ref={(node) =>
              registerSectionRef(
                'tos-2',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-2-title"
          >
            <SectionHeading id="tos-2-title">
              2. Eligibility and Account
              Registration
            </SectionHeading>

            <p>
              You may use TITech Community Capital
              services only where you are legally
              permitted and meet the eligibility
              requirements applicable to the service
              you are accessing.
            </p>

            <p>
              You agree to provide accurate,
              complete and current information when
              creating or maintaining an account.
            </p>

            <p>
              You are responsible for maintaining
              the confidentiality of your login
              credentials and for activities
              conducted through your account,
              subject to applicable law and TITech's
              security obligations.
            </p>

            <p>
              We may require identity verification,
              additional documentation or other
              information before enabling particular
              services or transaction capabilities.
            </p>
          </section>

          {/* ==================================================================
              3. SERVICES
              ================================================================= */}

          <section
            id="tos-3"
            ref={(node) =>
              registerSectionRef(
                'tos-3',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-3-title"
          >
            <SectionHeading id="tos-3-title">
              3. TITech Community Capital Services
            </SectionHeading>

            <p>
              TITech Community Capital provides
              technology-enabled community finance
              and financial-management services.
              Depending on the applicable
              subscription, tenant configuration,
              jurisdiction and service availability,
              features may include:
            </p>

            <ul>
              <li>
                Community and group management.
              </li>
              <li>
                Member registration and account
                management.
              </li>
              <li>
                Savings and contribution tracking.
              </li>
              <li>
                Transaction recording and
                reconciliation.
              </li>
              <li>
                Financial reporting and analytics.
              </li>
              <li>
                Administrative and role-based
                access controls.
              </li>
              <li>
                Payment or mobile-money integrations
                where supported.
              </li>
              <li>
                Notifications and communications.
              </li>
            </ul>

            <p>
              Not every feature is available to
              every user, organization, jurisdiction
              or subscription level.
            </p>
          </section>

          {/* ==================================================================
              4. COMMUNITY RESPONSIBILITIES
              ================================================================= */}

          <section
            id="tos-4"
            ref={(node) =>
              registerSectionRef(
                'tos-4',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-4-title"
          >
            <SectionHeading id="tos-4-title">
              4. Community, Group and Tenant
              Responsibilities
            </SectionHeading>

            <p>
              Organizations using TITech Community
              Capital on behalf of a community,
              SACCO, cooperative, savings group,
              microfinance organization or other
              tenant are responsible for the
              accuracy and lawful administration of
              information they provide to the
              platform.
            </p>

            <p>
              Authorized administrators must assign
              permissions appropriately and must not
              grant access beyond what is reasonably
              required for a user's role.
            </p>

            <p>
              Tenant administrators remain
              responsible for their organization's
              internal governance, member
              relationships, approvals and
              obligations except to the extent
              expressly assumed by TITech under a
              separate agreement.
            </p>
          </section>

          {/* ==================================================================
              5. FINANCIAL SERVICES
              ================================================================= */}

          <section
            id="tos-5"
            ref={(node) =>
              registerSectionRef(
                'tos-5',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-5-title"
          >
            <SectionHeading id="tos-5-title">
              5. Financial and Transaction
              Services
            </SectionHeading>

            <p>
              TITech Community Capital may provide
              technology infrastructure that
              facilitates recording, managing,
              communicating or processing financial
              information and transactions.
            </p>

            <p>
              Unless expressly stated in a separate
              agreement or applicable disclosure,
              TITech does not itself guarantee the
              underlying financial obligations of
              users, communities, tenants, payment
              providers or other third parties.
            </p>

            <p>
              Transaction availability, processing
              times and settlement may depend on
              banks, mobile-money providers, payment
              processors, telecommunications
              networks, financial institutions and
              other third parties.
            </p>

            <p>
              You are responsible for reviewing
              transaction details before confirming
              applicable transactions.
            </p>
          </section>

          {/* ==================================================================
              6. FEES
              ================================================================= */}

          <section
            id="tos-6"
            ref={(node) =>
              registerSectionRef(
                'tos-6',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-6-title"
          >
            <SectionHeading id="tos-6-title">
              6. Fees, Charges and Taxes
            </SectionHeading>

            <p>
              Certain TITech Community Capital
              services may be subject to
              subscription fees, transaction fees,
              usage charges or other applicable
              charges.
            </p>

            <p>
              Where applicable, fees will be
              communicated through the relevant
              pricing schedule, service agreement,
              application interface or other
              authorized communication.
            </p>

            <p>
              Third-party providers may separately
              charge fees for payment, mobile-money,
              telecommunications, banking or other
              services.
            </p>

            <p>
              You are responsible for taxes and
              government charges that apply to your
              activities or transactions, unless
              applicable law provides otherwise.
            </p>
          </section>

          {/* ==================================================================
              7. USER RESPONSIBILITIES
              ================================================================= */}

          <section
            id="tos-7"
            ref={(node) =>
              registerSectionRef(
                'tos-7',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-7-title"
          >
            <SectionHeading id="tos-7-title">
              7. User Responsibilities and
              Acceptable Use
            </SectionHeading>

            <p>
              You agree to use TITech Community
              Capital services lawfully, responsibly
              and in accordance with these Terms.
            </p>

            <p>
              You must not:
            </p>

            <ul>
              <li>
                Use the platform for unlawful,
                fraudulent or deceptive activity.
              </li>
              <li>
                Attempt to gain unauthorized access
                to accounts, systems or data.
              </li>
              <li>
                Interfere with platform availability
                or security.
              </li>
              <li>
                Upload malicious software or harmful
                code.
              </li>
              <li>
                Circumvent authentication,
                authorization or security controls.
              </li>
              <li>
                Misrepresent your identity or
                authority.
              </li>
              <li>
                Abuse transaction, referral,
                promotional or system functionality.
              </li>
              <li>
                Use the platform in a manner that
                violates applicable laws or
                regulations.
              </li>
            </ul>
          </section>

          {/* ==================================================================
              8. SECURITY
              ================================================================= */}

          <section
            id="tos-8"
            ref={(node) =>
              registerSectionRef(
                'tos-8',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-8-title"
          >
            <SectionHeading id="tos-8-title">
              8. Security and Account Protection
            </SectionHeading>

            <p>
              You are responsible for protecting
              your account credentials, devices,
              authentication mechanisms and
              recovery information.
            </p>

            <p>
              You must promptly notify TITech
              Community Capital if you suspect
              unauthorized access, credential
              compromise, fraudulent activity or
              another security incident affecting
              your account.
            </p>

            <p>
              We may apply security controls,
              rate limits, verification measures,
              account restrictions or other
              protective mechanisms to protect the
              platform and its users.
            </p>
          </section>

          {/* ==================================================================
              9. INTELLECTUAL PROPERTY
              ================================================================= */}

          <section
            id="tos-9"
            ref={(node) =>
              registerSectionRef(
                'tos-9',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-9-title"
          >
            <SectionHeading id="tos-9-title">
              9. Intellectual Property
            </SectionHeading>

            <p>
              TITech Community Capital and its
              licensors retain all rights, title and
              interest in the platform, software,
              trademarks, service marks, designs,
              documentation and other proprietary
              materials except for rights expressly
              granted to you.
            </p>

            <p>
              Subject to these Terms, TITech grants
              you a limited, non-exclusive,
              non-transferable and revocable right
              to use applicable services for their
              intended purpose.
            </p>

            <p>
              You may not copy, modify, reverse
              engineer, redistribute, sell, lease or
              exploit proprietary components of the
              services except where expressly
              permitted by law or by written
              agreement.
            </p>
          </section>

          {/* ==================================================================
              10. THIRD PARTIES
              ================================================================= */}

          <section
            id="tos-10"
            ref={(node) =>
              registerSectionRef(
                'tos-10',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-10-title"
          >
            <SectionHeading id="tos-10-title">
              10. Third-Party Services
            </SectionHeading>

            <p>
              TITech Community Capital may integrate
              with third-party providers, including
              payment processors, mobile-money
              providers, financial institutions,
              telecommunications providers,
              identity-verification services,
              cloud infrastructure providers and
              other technology providers.
            </p>

            <p>
              Third-party services may be governed
              by separate terms and privacy
              policies. TITech is not responsible
              for third-party services except to the
              extent required by applicable law or
              expressly agreed in writing.
            </p>
          </section>

          {/* ==================================================================
              11. AVAILABILITY
              ================================================================= */}

          <section
            id="tos-11"
            ref={(node) =>
              registerSectionRef(
                'tos-11',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-11-title"
          >
            <SectionHeading id="tos-11-title">
              11. Service Availability and Changes
            </SectionHeading>

            <p>
              We aim to provide reliable and secure
              services, but uninterrupted
              availability cannot be guaranteed.
            </p>

            <p>
              Services may be temporarily
              unavailable because of maintenance,
              upgrades, security events,
              infrastructure failures,
              telecommunications problems, third-
              party outages, regulatory
              requirements, force majeure events or
              other circumstances beyond our
              reasonable control.
            </p>

            <p>
              We may modify, enhance, suspend or
              discontinue features where reasonably
              necessary to operate or improve the
              platform, comply with legal
              requirements or address security and
              operational risks.
            </p>
          </section>

          {/* ==================================================================
              12. SUSPENSION
              ================================================================= */}

          <section
            id="tos-12"
            ref={(node) =>
              registerSectionRef(
                'tos-12',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-12-title"
          >
            <SectionHeading id="tos-12-title">
              12. Suspension and Termination
            </SectionHeading>

            <p>
              We may suspend, restrict or terminate
              access where reasonably necessary to:
            </p>

            <ul>
              <li>
                Protect users or the platform.
              </li>
              <li>
                Investigate suspected fraud or
                abuse.
              </li>
              <li>
                Address security threats.
              </li>
              <li>
                Enforce these Terms.
              </li>
              <li>
                Comply with legal or regulatory
                requirements.
              </li>
              <li>
                Address unpaid fees or contractual
                breaches.
              </li>
            </ul>

            <p>
              Where reasonably practicable and
              legally permitted, we may provide
              notice before non-emergency
              suspension or termination.
            </p>

            <p>
              Termination does not automatically
              extinguish obligations that by their
              nature should survive termination.
            </p>
          </section>

          {/* ==================================================================
              13. DISCLAIMERS
              ================================================================= */}

          <section
            id="tos-13"
            ref={(node) =>
              registerSectionRef(
                'tos-13',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-13-title"
          >
            <SectionHeading id="tos-13-title">
              13. Disclaimers and Limitations
            </SectionHeading>

            <p>
              To the maximum extent permitted by
              applicable law, services are provided
              subject to the warranties, conditions
              and limitations expressly stated in
              these Terms and applicable service
              agreements.
            </p>

            <p>
              We do not guarantee that the services
              will always be uninterrupted, error-
              free, completely secure or available
              in every jurisdiction or on every
              device.
            </p>

            <p>
              Information displayed through the
              platform may depend on information
              supplied by users, communities,
              tenants or third-party providers.
              Users should verify important
              financial information before taking
              consequential action.
            </p>
          </section>

          {/* ==================================================================
              14. INDEMNIFICATION
              ================================================================= */}

          <section
            id="tos-14"
            ref={(node) =>
              registerSectionRef(
                'tos-14',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-14-title"
          >
            <SectionHeading id="tos-14-title">
              14. Indemnification
            </SectionHeading>

            <p>
              To the extent permitted by applicable
              law, you agree to be responsible for
              claims, losses, liabilities, damages,
              costs and reasonable expenses arising
              from your unlawful use of the services,
              material breach of these Terms,
              violation of third-party rights or
              misuse of the platform.
            </p>

            <p>
              This provision does not require you to
              indemnify TITech Community Capital for
              matters that cannot lawfully be
              allocated to you.
            </p>
          </section>

          {/* ==================================================================
              15. LIABILITY
              ================================================================= */}

          <section
            id="tos-15"
            ref={(node) =>
              registerSectionRef(
                'tos-15',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-15-title"
          >
            <SectionHeading id="tos-15-title">
              15. Limitation of Liability
            </SectionHeading>

            <p>
              To the maximum extent permitted by
              applicable law, TITech Community
              Capital and its officers, employees,
              contractors and service providers will
              not be liable for indirect,
              incidental, special, consequential or
              punitive losses arising from use of
              the services where such exclusion is
              lawful.
            </p>

            <p>
              Nothing in these Terms excludes or
              limits liability that cannot legally
              be excluded or limited under
              applicable law.
            </p>

            <p>
              Where a separate written agreement
              establishes specific liability terms,
              that agreement may govern to the extent
              of any inconsistency.
            </p>
          </section>

          {/* ==================================================================
              16. DISPUTES AND GOVERNING LAW
              ================================================================= */}

          <section
            id="tos-16"
            ref={(node) =>
              registerSectionRef(
                'tos-16',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-16-title"
          >
            <SectionHeading id="tos-16-title">
              16. Dispute Resolution and Governing
              Law
            </SectionHeading>

            <p>
              We encourage users and TITech
              Community Capital to attempt to
              resolve disputes promptly and in good
              faith through appropriate support or
              legal channels before commencing formal
              proceedings, where permitted by law.
            </p>

            <p>
              Unless a separate agreement or
              mandatory applicable law provides
              otherwise, these Terms are intended to
              be governed by the laws applicable in
              Uganda.
            </p>

            <p>
              Nothing in these Terms removes any
              mandatory consumer, financial,
              regulatory or other legal protection
              that cannot lawfully be waived.
            </p>
          </section>

          {/* ==================================================================
              17. CHANGES
              ================================================================= */}

          <section
            id="tos-17"
            ref={(node) =>
              registerSectionRef(
                'tos-17',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-17-title"
          >
            <SectionHeading id="tos-17-title">
              17. Changes to These Terms
            </SectionHeading>

            <p>
              We may update these Terms from time to
              time to reflect changes in our
              services, technology, business
              operations, legal requirements or
              regulatory obligations.
            </p>

            <p>
              When we make material changes, we may
              provide notice through the platform,
              website, email or another appropriate
              communication channel where required
              or reasonably appropriate.
            </p>

            <p>
              Continued use of applicable services
              after the effective date of updated
              Terms may constitute acceptance where
              permitted by applicable law. Where
              affirmative acceptance is required, we
              may request it before continued use.
            </p>
          </section>

          {/* ==================================================================
              18. GENERAL
              ================================================================= */}

          <section
            id="tos-18"
            ref={(node) =>
              registerSectionRef(
                'tos-18',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-18-title"
          >
            <SectionHeading id="tos-18-title">
              18. General Provisions
            </SectionHeading>

            <h3>
              18.1 Severability
            </h3>

            <p>
              If any provision of these Terms is
              determined to be unlawful or
              unenforceable, the remaining
              provisions will continue to the extent
              permitted by applicable law.
            </p>

            <h3>
              18.2 No Waiver
            </h3>

            <p>
              Failure to enforce a provision does not
              constitute a waiver of the right to
              enforce it later.
            </p>

            <h3>
              18.3 Assignment
            </h3>

            <p>
              You may not transfer rights or
              obligations under these Terms where
              prohibited by applicable law or without
              required consent. TITech may assign or
              transfer its rights and obligations as
              part of a corporate restructuring,
              merger, acquisition or transfer of
              relevant business assets, subject to
              applicable law.
            </p>

            <h3>
              18.4 Entire Agreement
            </h3>

            <p>
              These Terms, together with applicable
              policies, disclosures and written
              agreements incorporated by reference,
              constitute the applicable agreement
              concerning the services addressed by
              these Terms.
            </p>
          </section>

          {/* ==================================================================
              19. CONTACT
              ================================================================= */}

          <section
            id="tos-19"
            ref={(node) =>
              registerSectionRef(
                'tos-19',
                node,
              )
            }
            className="legal-section"
            aria-labelledby="tos-19-title"
          >
            <SectionHeading id="tos-19-title">
              19. Contact Information
            </SectionHeading>

            <p>
              Questions concerning these Terms,
              contractual matters or legal notices
              may be directed to TITech Community
              Capital.
            </p>

            <address className="legal-contact">
              <p>
                <strong>
                  {CONTACT.address}
                </strong>
              </p>

              <p>
                Legal:{' '}
                <a
                  href={`mailto:${CONTACT.legalEmail}`}
                >
                  {CONTACT.legalEmail}
                </a>
              </p>

              <p>
                Support:{' '}
                <a
                  href={`mailto:${CONTACT.supportEmail}`}
                >
                  {CONTACT.supportEmail}
                </a>
              </p>

              <p>
                Privacy:{' '}
                <a
                  href={`mailto:${CONTACT.privacyEmail}`}
                >
                  {CONTACT.privacyEmail}
                </a>
              </p>

              <p>
                Phone:{' '}
                <a
                  href={`tel:${CONTACT.phoneHref}`}
                >
                  {CONTACT.phone}
                </a>
              </p>
            </address>
          </section>

          {/* ==================================================================
              DOCUMENT FOOTER
              ================================================================= */}

          <footer className="legal-document__footer">
            <p>
              <strong>
                {DOCUMENT.title}
              </strong>
            </p>

            <p>
              Version {DOCUMENT.version} · Last
              updated {DOCUMENT.lastUpdated} ·
              Effective {DOCUMENT.effectiveDate}
            </p>

            <p>
              © {new Date().getFullYear()}{' '}
              {LEGAL_SYSTEM.ORGANIZATION}. All
              rights reserved.
            </p>
          </footer>
        </article>
      </div>

      {/* ======================================================================
          BACK TO TOP
          ==================================================================== */}

      {showBackToTop && (
        <button
          type="button"
          className="legal-back-to-top"
          onClick={handleBackToTop}
          aria-label="Back to top"
        >
          Back to top
        </button>
      )}

      {/* ======================================================================
          ACCESSIBILITY STATUS
          ==================================================================== */}

      <div
        className="legal-visually-hidden"
        aria-live={
          LEGAL_ACCESSIBILITY.DEFAULT_ARIA_LIVE
        }
        aria-atomic="true"
      >
        {copyState === 'copied'
          ? 'Terms of Service link copied.'
          : copyState === 'error'
            ? 'Unable to copy Terms of Service link.'
            : activeSection
              ? `Current section: ${
                  SECTIONS.find(
                    (section) =>
                      section.id ===
                      activeSection,
                  )?.title ||
                  'Terms of Service'
                }.`
              : LEGAL_ACCESSIBILITY_MESSAGES.DOCUMENT_LOADED}
      </div>
    </main>
  );
}

/* ============================================================================
 * PROP TYPES
 * ========================================================================== */

TermsOfService.propTypes = {
  showTableOfContents:
    PropTypes.bool,

  showPrintButton:
    PropTypes.bool,

  showCopyLink:
    PropTypes.bool,

  showBackToTop:
    PropTypes.bool,

  onSectionChange:
    PropTypes.func,
};