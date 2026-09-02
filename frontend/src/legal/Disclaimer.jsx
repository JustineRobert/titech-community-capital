/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Legal Disclaimer Page
* ============================================================================
*
* File:
* frontend/src/legal/Disclaimer.jsx
*
* Version:
* 2.0.0
*
* Purpose:
* Production-grade presentation layer for the TITech Community Capital
* Legal Disclaimer.
*
* Responsibilities:
* * Present the current TITech legal disclaimer.
* * Provide accessible section navigation.
* * Support URL hash/deep-link navigation.
* * Display document version and effective date.
* * Provide print support.
* * Provide copy-link support.
* * Provide responsive legal-document navigation.
* * Support active-section tracking.
* * Remain compatible with centralized legal configuration.
*
* Brand:
* TITech Community Capital
*
* IMPORTANT:
* This document is a technical/legal-content presentation component.
* Final legal language should be reviewed and approved by qualified
* legal counsel before publication as a binding corporate document.
*
* ============================================================================
  */

'use strict';

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
'legal-disclaimer',

slug:
'disclaimer',

type:
LEGAL_DOCUMENT_TYPES.DISCLAIMER,

title:
'Legal Disclaimer',

shortTitle:
'Disclaimer',

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
LEGAL_ROUTES.DISCLAIMER,
});

/* ============================================================================

* CONTACT INFORMATION
* ========================================================================== */

const CONTACT = Object.freeze({
legalEmail:
'[legal@titechcommunity.app](mailto:legal@titechcommunity.app)',

supportEmail:
'[support@titechcommunity.app](mailto:support@titechcommunity.app)',

privacyEmail:
'[privacy@communitysavings.app](mailto:privacy@communitysavings.app)',

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
'disclaimer-1',


title:
  'Purpose of This Disclaimer',

shortTitle:
  'Purpose',


},

{
id:
'disclaimer-2',


title:
  'Technology Platform',

shortTitle:
  'Technology Platform',


},

{
id:
'disclaimer-3',

title:
  'Financial Information and Services',

shortTitle:
  'Financial Information',


},

{
id:
'disclaimer-4',


title:
  'No Financial, Investment or Professional Advice',

shortTitle:
  'No Professional Advice',


},

{
id:
'disclaimer-5',


title:
  'Transaction and Payment Information',

shortTitle:
  'Transactions',


},

{
id:
'disclaimer-6',


title:
  'Third-Party Services',

shortTitle:
  'Third Parties',


},

{
id:
'disclaimer-7',


title:
  'Information Accuracy',

shortTitle:
  'Information Accuracy',


},

{
id:
'disclaimer-8',

title:
  'Service Availability',

shortTitle:
  'Availability',


},

{
id:
'disclaimer-9',


title:
  'Security and Cybersecurity',

shortTitle:
  'Security',


},

{
id:
'disclaimer-10',

title:
  'Regulatory and Jurisdictional Limitations',

shortTitle:
  'Regulatory Limitations',


},

{
id:
'disclaimer-11',


title:
  'Community and Tenant Responsibility',

shortTitle:
  'Community Responsibility',


},

{
id:
'disclaimer-12',


title:
  'No Guarantee of Financial Outcomes',

shortTitle:
  'Financial Outcomes',

},

{
id:
'disclaimer-13',

title:
  'External Links and Content',

shortTitle:
  'External Content',


},

{
id:
'disclaimer-14',


title:
  'Limitation of Disclaimer',

shortTitle:
  'Limitations',


},

{
id:
'disclaimer-15',


title:
  'Relationship With Other Legal Documents',

shortTitle:
  'Related Documents',


},

{
id:
'disclaimer-16',


title:
  'Changes to This Disclaimer',

shortTitle:
  'Changes',


},

{
id:
'disclaimer-17',


title:
  'Contact Information',

shortTitle:
  'Contact',


},
]);

/* ============================================================================

* PRESENTATIONAL COMPONENTS
* ========================================================================== */

function SectionHeading({
id,
children,
}) {
return ( <h2
   id={id}
   className="legal-section__title"
   tabIndex={-1}
 >
{children} </h2>
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

export default function Disclaimer({
showTableOfContents = LEGAL_UI.SHOW_TABLE_OF_CONTENTS,

showPrintButton = LEGAL_UI.SHOW_PRINT_BUTTON,

showCopyLink = LEGAL_UI.SHOW_COPY_LINK,

showBackToTop = LEGAL_UI.SHOW_BACK_TO_TOP,

onSectionChange,
}) {
const [activeSection, setActiveSection] =
useState(
SECTIONS[0].id,
);

const [copyState, setCopyState] =
useState('idle');

const sectionRefs =
useRef(
new Map(),
);

const copyResetTimer =
useRef(null);

/* ==========================================================================

* SECTION REF REGISTRATION
* ======================================================================== */

const registerSectionRef =
useCallback(
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

const scrollToSection =
useCallback(
(
sectionId,
updateUrl = true,
) => {
const element =
sectionRefs.current.get(
sectionId,
);

    if (!element) {
      return false;
    }

    const prefersReducedMotion =
      typeof window !==
        'undefined' &&
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

    if (
      updateUrl &&
      typeof window !==
        'undefined'
    ) {
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
      window.setTimeout(
        () => {
          element.focus({
            preventScroll:
              true,
          });
        },
        50,
      );
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
  window.setTimeout(
    () => {
      scrollToSection(
        sectionId,
        false,
      );
    },
    100,
  );

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
if (
copyResetTimer.current
) {
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

const handlePrint =
useCallback(() => {
if (
typeof window !==
'undefined' &&
typeof window.print ===
'function'
) {
window.print();
}
}, []);

/* ==========================================================================

* COPY CURRENT URL
* ======================================================================== */

const handleCopyLink =
useCallback(
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
        typeof navigator
          .clipboard.writeText ===
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

      if (
        copyResetTimer.current
      ) {
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

      if (
        copyResetTimer.current
      ) {
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
typeof window !==
'undefined' &&
typeof window.matchMedia ===
'function' &&
window.matchMedia(
'(prefers-reduced-motion: reduce)',
).matches;


  window.scrollTo({
    top:
      0,

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

return ( <main
   id="main-content"
   className="legal-page legal-page--disclaimer"
   aria-labelledby="legal-disclaimer-title"
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
        id="legal-disclaimer-title"
        className="legal-page__title"
      >
        {DOCUMENT.title}
      </h1>

      <p className="legal-page__description">
        Important information concerning the
        nature, scope and limitations of the
        TITech Community Capital technology
        platform and related services.
      </p>

      <div
        className="legal-document-meta"
        aria-label="Legal Disclaimer metadata"
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
        aria-label="Legal Disclaimer actions"
      >
        {showPrintButton && (
          <button
            type="button"
            className="legal-button legal-button--secondary"
            onClick={
              handlePrint
            }
          >
            Print
          </button>
        )}

        {showCopyLink && (
          <button
            type="button"
            className="legal-button legal-button--secondary"
            onClick={
              handleCopyLink
            }
            aria-live="polite"
          >
            {copyState ===
            'copied'
              ? 'Link Copied'
              : copyState ===
                  'error'
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
        aria-label="Legal Disclaimer navigation"
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
                  key={
                    section.id
                  }
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
                    {
                      section.shortTitle
                    }
                  </button>
                </li>
              ),
            )}
          </ol>
        </nav>
      </aside>
    )}

    {/* ====================================================================
        DISCLAIMER DOCUMENT
        ================================================================== */}

    <article className="legal-document">
      <div className="legal-document__notice">
        <strong>
          Important:
        </strong>{' '}
        This Legal Disclaimer provides
        general information about TITech
        Community Capital and its technology
        services. It does not replace
        applicable contractual terms, financial
        disclosures, regulatory requirements or
        professional advice.
      </div>

      {/* ==================================================================
          1. PURPOSE
          ================================================================= */}

      <section
        id="disclaimer-1"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-1',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-1-title"
      >
        <SectionHeading id="disclaimer-1-title">
          1. Purpose of This Disclaimer
        </SectionHeading>

        <p>
          This Disclaimer explains important
          limitations concerning information,
          technology, financial-management
          functionality and services made
          available through TITech Community
          Capital.
        </p>

        <p>
          It should be read together with the
          TITech Community Capital Terms of
          Service, Privacy Policy and any
          applicable product, tenant or service
          agreement.
        </p>
      </section>

      {/* ==================================================================
          2. TECHNOLOGY PLATFORM
          ================================================================= */}

      <section
        id="disclaimer-2"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-2',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-2-title"
      >
        <SectionHeading id="disclaimer-2-title">
          2. Technology Platform
        </SectionHeading>

        <p>
          TITech Community Capital is a
          technology platform designed to support
          community finance and financial-
          management activities.
        </p>

        <p>
          Platform functionality may include
          account management, savings and
          contribution tracking, transaction
          recording, reporting, analytics,
          administration, notifications and
          integrations with supported third-
          party services.
        </p>

        <p>
          Availability of particular features
          depends on the applicable product,
          subscription, tenant configuration,
          jurisdiction and technical
          environment.
        </p>
      </section>

      {/* ==================================================================
          3. FINANCIAL INFORMATION
          ================================================================= */}

      <section
        id="disclaimer-3"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-3',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-3-title"
      >
        <SectionHeading id="disclaimer-3-title">
          3. Financial Information and Services
        </SectionHeading>

        <p>
          Information displayed through TITech
          may include balances, contributions,
          transaction records, reports,
          calculations, summaries and other
          financial information supplied by
          users, communities, tenants or
          integrated systems.
        </p>

        <p>
          Such information should be reviewed
          carefully and reconciled against
          authoritative records where appropriate,
          particularly before making material
          financial decisions.
        </p>

        <p>
          TITech's technology functionality does
          not by itself create, guarantee or
          assume the underlying financial
          obligations between users, communities,
          organizations, financial institutions
          or other parties unless expressly
          agreed in writing.
        </p>
      </section>

      {/* ==================================================================
          4. NO PROFESSIONAL ADVICE
          ================================================================= */}

      <section
        id="disclaimer-4"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-4',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-4-title"
      >
        <SectionHeading id="disclaimer-4-title">
          4. No Financial, Investment or
          Professional Advice
        </SectionHeading>

        <p>
          Information made available through
          TITech Community Capital is not
          intended to constitute personalized
          financial, investment, accounting,
          tax, legal or other professional advice
          unless expressly stated otherwise in a
          separate authorized service agreement.
        </p>

        <p>
          Users should obtain independent
          professional advice before making
          decisions where professional advice is
          appropriate.
        </p>

        <p>
          Nothing on the platform should be
          interpreted as a recommendation to
          purchase, sell, lend, borrow, invest or
          otherwise transact in a particular
          financial product or service.
        </p>
      </section>

      {/* ==================================================================
          5. TRANSACTIONS
          ================================================================= */}

      <section
        id="disclaimer-5"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-5',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-5-title"
      >
        <SectionHeading id="disclaimer-5-title">
          5. Transaction and Payment
          Information
        </SectionHeading>

        <p>
          Transaction processing may involve
          third-party payment providers, banks,
          mobile-money operators,
          telecommunications networks,
          settlement systems and other external
          infrastructure.
        </p>

        <p>
          Processing times, transaction status,
          availability, fees and settlement may
          therefore depend on systems outside
          TITech's direct control.
        </p>

        <p>
          Users should confirm transaction
          details, recipient information, amounts
          and applicable charges before
          authorizing a transaction.
        </p>

        <p>
          Where a transaction appears incorrect,
          duplicated, unauthorized or incomplete,
          users should report it through the
          appropriate support or dispute process
          as soon as reasonably possible.
        </p>
      </section>

      {/* ==================================================================
          6. THIRD PARTIES
          ================================================================= */}

      <section
        id="disclaimer-6"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-6',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-6-title"
      >
        <SectionHeading id="disclaimer-6-title">
          6. Third-Party Services
        </SectionHeading>

        <p>
          TITech may integrate with third-party
          services to provide or enhance
          functionality.
        </p>

        <p>
          These services may include payment
          processors, mobile-money providers,
          banks, identity-verification providers,
          telecommunications providers, cloud
          infrastructure providers and other
          technology providers.
        </p>

        <p>
          Third-party systems may experience
          outages, delays, errors or changes that
          affect the availability or performance
          of integrated TITech functionality.
        </p>
      </section>

      {/* ==================================================================
          7. INFORMATION ACCURACY
          ================================================================= */}

      <section
        id="disclaimer-7"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-7',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-7-title"
      >
        <SectionHeading id="disclaimer-7-title">
          7. Information Accuracy
        </SectionHeading>

        <p>
          TITech seeks to provide accurate,
          reliable and useful information.
          However, information may occasionally
          be incomplete, delayed, inaccurate or
          affected by data supplied by users or
          third-party systems.
        </p>

        <p>
          Users and authorized tenant
          administrators are responsible for
          reviewing information relevant to their
          activities and reporting suspected
          inaccuracies promptly.
        </p>

        <p>
          TITech may correct, update or reconcile
          information when appropriate and
          technically or operationally possible.
        </p>
      </section>

      {/* ==================================================================
          8. AVAILABILITY
          ================================================================= */}

      <section
        id="disclaimer-8"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-8',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-8-title"
      >
        <SectionHeading id="disclaimer-8-title">
          8. Service Availability
        </SectionHeading>

        <p>
          TITech aims to maintain reliable
          service availability but cannot
          guarantee uninterrupted or error-free
          operation.
        </p>

        <p>
          Temporary interruption may result from
          maintenance, upgrades, infrastructure
          failures, network conditions,
          cybersecurity incidents, third-party
          outages, regulatory requirements or
          circumstances beyond reasonable
          control.
        </p>

        <p>
          Users should maintain appropriate
          operational procedures and alternative
          records for critical financial and
          organizational activities.
        </p>
      </section>

      {/* ==================================================================
          9. SECURITY
          ================================================================= */}

      <section
        id="disclaimer-9"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-9',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-9-title"
      >
        <SectionHeading id="disclaimer-9-title">
          9. Security and Cybersecurity
        </SectionHeading>

        <p>
          TITech implements security controls
          designed to protect systems, accounts
          and information.
        </p>

        <p>
          However, no internet-connected system
          can be guaranteed to be completely
          immune from unauthorized access,
          malicious activity, technical failure
          or other security threats.
        </p>

        <p>
          Users must protect their credentials,
          devices and authentication mechanisms
          and promptly report suspected
          compromise or unauthorized activity.
        </p>
      </section>

      {/* ==================================================================
          10. REGULATORY
          ================================================================= */}

      <section
        id="disclaimer-10"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-10',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-10-title"
      >
        <SectionHeading id="disclaimer-10-title">
          10. Regulatory and Jurisdictional
          Limitations
        </SectionHeading>

        <p>
          Financial, technology, data
          protection, consumer protection and
          other regulatory requirements may vary
          between jurisdictions.
        </p>

        <p>
          A service available in one jurisdiction
          may not be available, authorized or
          suitable for use in another
          jurisdiction.
        </p>

        <p>
          Users and organizations are responsible
          for complying with laws and regulatory
          obligations applicable to their
          activities, except to the extent
          expressly assumed by TITech under a
          written agreement.
        </p>

        <p>
          Nothing in this Disclaimer is intended
          to override mandatory legal or
          regulatory requirements.
        </p>
      </section>

      {/* ==================================================================
          11. COMMUNITY RESPONSIBILITY
          ================================================================= */}

      <section
        id="disclaimer-11"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-11',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-11-title"
      >
        <SectionHeading id="disclaimer-11-title">
          11. Community and Tenant
          Responsibility
        </SectionHeading>

        <p>
          Organizations using TITech Community
          Capital are responsible for their
          internal governance, approvals,
          financial policies, member
          relationships and authorized use of
          the platform.
        </p>

        <p>
          Tenant administrators should establish
          appropriate controls for user
          permissions, transaction approvals,
          reconciliations and access management.
        </p>

        <p>
          TITech provides technology
          infrastructure and does not replace the
          governance responsibilities of a
          community, SACCO, cooperative, savings
          group, microfinance organization or
          other tenant.
        </p>
      </section>

      {/* ==================================================================
          12. FINANCIAL OUTCOMES
          ================================================================= */}

      <section
        id="disclaimer-12"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-12',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-12-title"
      >
        <SectionHeading id="disclaimer-12-title">
          12. No Guarantee of Financial Outcomes
        </SectionHeading>

        <p>
          Use of TITech Community Capital does
          not guarantee financial growth,
          investment returns, savings outcomes,
          loan repayment, community performance,
          profitability or any other financial
          result.
        </p>

        <p>
          Financial outcomes depend on numerous
          factors, including user decisions,
          community governance, economic
          conditions, market conditions,
          counterparties and applicable laws.
        </p>
      </section>

      {/* ==================================================================
          13. EXTERNAL CONTENT
          ================================================================= */}

      <section
        id="disclaimer-13"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-13',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-13-title"
      >
        <SectionHeading id="disclaimer-13-title">
          13. External Links and Content
        </SectionHeading>

        <p>
          TITech may provide links or references
          to third-party websites, resources or
          services for convenience or
          informational purposes.
        </p>

        <p>
          The presence of an external link does
          not necessarily constitute an
          endorsement, sponsorship or guarantee
          of the third-party content.
        </p>

        <p>
          Users should review the applicable
          third-party terms, privacy policies and
          other conditions before using external
          services.
        </p>
      </section>

      {/* ==================================================================
          14. LIMITATIONS
          ================================================================= */}

      <section
        id="disclaimer-14"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-14',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-14-title"
      >
        <SectionHeading id="disclaimer-14-title">
          14. Limitation of Disclaimer
        </SectionHeading>

        <p>
          This Disclaimer does not exclude or
          limit rights, remedies or liabilities
          that cannot lawfully be excluded or
          limited under applicable law.
        </p>

        <p>
          Where a specific written agreement
          contains provisions that expressly
          address a matter covered by this
          Disclaimer, the specific agreement may
          govern to the extent permitted by law.
        </p>
      </section>

      {/* ==================================================================
          15. RELATED DOCUMENTS
          ================================================================= */}

      <section
        id="disclaimer-15"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-15',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-15-title"
      >
        <SectionHeading id="disclaimer-15-title">
          15. Relationship With Other Legal
          Documents
        </SectionHeading>

        <p>
          This Disclaimer should be read
          together with the applicable TITech
          Community Capital legal documents,
          including:
        </p>

        <ul>
          <li>
            Terms of Service.
          </li>
          <li>
            Privacy Policy.
          </li>
          <li>
            Applicable service or subscription
            agreements.
          </li>
          <li>
            Applicable financial disclosures.
          </li>
          <li>
            Applicable tenant or organizational
            agreements.
          </li>
          <li>
            Other policies and notices expressly
            incorporated into the applicable
            service.
          </li>
        </ul>

        <p>
          In the event of an inconsistency,
          applicable mandatory law and any
          controlling written agreement will
          govern to the extent legally required.
        </p>
      </section>

      {/* ==================================================================
          16. CHANGES
          ================================================================= */}

      <section
        id="disclaimer-16"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-16',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-16-title"
      >
        <SectionHeading id="disclaimer-16-title">
          16. Changes to This Disclaimer
        </SectionHeading>

        <p>
          TITech Community Capital may update
          this Disclaimer periodically to reflect
          changes in its services, technology,
          legal requirements, regulatory
          expectations or business operations.
        </p>

        <p>
          Material changes may be communicated
          through the platform, website, email or
          another appropriate communication
          channel where required or reasonably
          appropriate.
        </p>

        <p>
          The version and effective date shown at
          the beginning of this document identify
          the applicable published version.
        </p>
      </section>

      {/* ==================================================================
          17. CONTACT
          ================================================================= */}

      <section
        id="disclaimer-17"
        ref={(node) =>
          registerSectionRef(
            'disclaimer-17',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="disclaimer-17-title"
      >
        <SectionHeading id="disclaimer-17-title">
          17. Contact Information
        </SectionHeading>

        <p>
          Questions regarding this Disclaimer,
          legal matters or the interpretation of
          TITech Community Capital legal
          documentation may be directed to:
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
      onClick={
        handleBackToTop
      }
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
    {copyState ===
    'copied'
      ? 'Legal Disclaimer link copied.'
      : copyState ===
          'error'
        ? 'Unable to copy Legal Disclaimer link.'
        : activeSection
          ? `Current section: ${
              SECTIONS.find(
                (section) =>
                  section.id ===
                  activeSection,
              )?.title ||
              'Legal Disclaimer'
            }.`
          : LEGAL_ACCESSIBILITY_MESSAGES.DOCUMENT_LOADED}
  </div>
</main>


);
}

/* ============================================================================

* PROP TYPES
* ========================================================================== */

Disclaimer.propTypes = {
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