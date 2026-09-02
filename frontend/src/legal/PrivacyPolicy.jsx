/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Privacy Policy Page
* ============================================================================
*
* File:
* frontend/src/legal/PrivacyPolicy.jsx
*
* Version:
* 3.0.0
*
* Purpose:
* Production-grade presentation layer for the TITech Community Capital
* Privacy Policy.
*
* Responsibilities:
* * Render the current Privacy Policy.
* * Provide accessible section navigation.
* * Support URL hash/deep-link navigation.
* * Support browser hash navigation.
* * Display document version and update information.
* * Provide print support.
* * Provide copy-link support.
* * Respect user reduced-motion preferences.
* * Provide responsive legal-document navigation.
* * Expose stable semantic/test attributes.
* * Integrate with the centralized legal route system.
* * Remain independent from backend implementation details.
*
* Architecture:
* * Legal metadata remains centralized and immutable.
* * Section navigation is driven from a single registry.
* * Legal content remains presentation-only.
* * URL generation remains delegated to legalRoutes.js.
* * Global legal configuration remains delegated to legalConstants.js.
*
* Accessibility:
* * Semantic main/header/article/section/nav/aside/footer structure.
* * Keyboard-accessible navigation.
* * Focus management for hash navigation.
* * Reduced-motion support.
* * Screen-reader status messaging.
* * aria-current section indication.
* * Accessible document metadata.
*
* Important:
* This component presents legal content. It does not constitute legal
* advice and should be reviewed by qualified legal/privacy professionals
* before production publication.
*
* Branding:
* TITech Community Capital
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
'privacy-policy',

slug:
'privacy-policy',

type:
LEGAL_DOCUMENT_TYPES.PRIVACY_POLICY,

title:
'Privacy Policy',

shortTitle:
'Privacy',

version:
LEGAL_VERSIONING.CURRENT_VERSION,

lastUpdated:
'January 15, 2026',

effectiveDate:
'January 15, 2026',

lastUpdatedISO:
'2026-01-15',

effectiveDateISO:
'2026-01-15',

organization:
LEGAL_SYSTEM.ORGANIZATION,

jurisdiction:
LEGAL_SYSTEM.JURISDICTION,

route:
LEGAL_ROUTES.PRIVACY,
});

/* ============================================================================

* CONTACT INFORMATION
* ========================================================================== */

const CONTACT = Object.freeze({
privacyEmail:
'[privacy@communitysavings.app](mailto:privacy@communitysavings.app)',

dataProtectionEmail:
'[dpo@communitysavings.app](mailto:dpo@communitysavings.app)',

legalEmail:
'[legal@titechcommunity.app](mailto:legal@titechcommunity.app)',

phone:
'+256 (394) 324760',

phoneHref:
'+256394324760',

address:
'TITech Community Capital Ltd, Plot 69-71 Jinja Road, Kampala, Uganda',
});

/* ============================================================================

* SECTION REGISTRY
*
* Single source of truth for:
* * IDs
* * display titles
* * navigation labels
* * document ordering
* ========================================================================== */

const SECTIONS = Object.freeze([
Object.freeze({
id:
'pp-1',


number:
  '1',

title:
  'Introduction',

shortTitle:
  'Introduction',


}),

Object.freeze({
id:
'pp-2',


number:
  '2',

title:
  'Information We Collect',

shortTitle:
  'Information We Collect',


}),

Object.freeze({
id:
'pp-3',


number:
  '3',

title:
  'How We Use Your Data',

shortTitle:
  'How We Use Your Data',


}),

Object.freeze({
id:
'pp-4',


number:
  '4',

title:
  'Data Security',

shortTitle:
  'Data Security',

}),

Object.freeze({
id:
'pp-5',


number:
  '5',

title:
  'Data Sharing',

shortTitle:
  'Data Sharing',


}),

Object.freeze({
id:
'pp-6',


number:
  '6',

title:
  'Your Rights',

shortTitle:
  'Your Rights',


}),

Object.freeze({
id:
'pp-7',


number:
  '7',

title:
  'Cookies & Tracking',

shortTitle:
  'Cookies & Tracking',


}),

Object.freeze({
id:
'pp-8',


number:
  '8',

title:
  'Data Retention',

shortTitle:
  'Data Retention',


}),

Object.freeze({
id:
'pp-9',


number:
  '9',

title:
  "Children's Privacy",

shortTitle:
  "Children's Privacy",


}),

Object.freeze({
id:
'pp-10',


number:
  '10',

title:
  'International Data Transfers',

shortTitle:
  'International Transfers',


}),

Object.freeze({
id:
'pp-11',


number:
  '11',

title:
  'Changes to This Policy',

shortTitle:
  'Policy Changes',


}),

Object.freeze({
id:
'pp-12',


number:
  '12',

title:
  'Privacy Contact Information',

shortTitle:
  'Contact',


}),
]);

const SECTION_BY_ID = new Map(
SECTIONS.map(
(section) => [
section.id,
section,
],
),
);

/* ============================================================================

* CONSTANTS
* ========================================================================== */

const COPY_RESET_DELAY_MS =
2500;

const HASH_NAVIGATION_DELAY_MS =
100;

const FOCUS_DELAY_MS =
50;

const COPY_STATES = Object.freeze({
IDLE:
'idle',

COPIED:
'copied',

ERROR:
'error',
});

/* ============================================================================

* UTILITY HELPERS
* ========================================================================== */

/**

* Safely determines whether a browser environment is available.
  */
  function isBrowser() {
  return (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined'
  );
  }

/**

* Returns whether reduced motion is requested.
  */
  function prefersReducedMotion() {
  if (
  !isBrowser() ||
  typeof window.matchMedia !== 'function'
  ) {
  return false;
  }

return (
LEGAL_ACCESSIBILITY.REDUCED_MOTION_RESPECTED &&
window.matchMedia(
'(prefers-reduced-motion: reduce)',
).matches
);
}

/**

* Resolves the requested scroll behavior while respecting accessibility
* preferences.
  */
  function getScrollBehavior() {
  return prefersReducedMotion()
  ? 'auto'
  : LEGAL_UI.SCROLL_BEHAVIOR;
  }

/**

* Decodes a URL hash safely.
  */
  function getHashSectionId() {
  if (!isBrowser()) {
  return null;
  }

const rawHash =
window.location.hash.replace(
/^#/,
'',
);

if (!rawHash) {
return null;
}

try {
return decodeURIComponent(
rawHash,
);
} catch {
return rawHash;
}
}

/**

* Determines whether a section ID belongs to this document.
  */
  function isValidSectionId(
  sectionId,
  ) {
  return SECTION_BY_ID.has(
  sectionId,
  );
  }

/* ============================================================================

* SMALL PRESENTATIONAL COMPONENTS
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

export default function PrivacyPolicy({
showTableOfContents =
LEGAL_UI.SHOW_TABLE_OF_CONTENTS,

showPrintButton =
LEGAL_UI.SHOW_PRINT_BUTTON,

showCopyLink =
LEGAL_UI.SHOW_COPY_LINK,

showBackToTop =
LEGAL_UI.SHOW_BACK_TO_TOP,

onSectionChange,
}) {
const [
activeSection,
setActiveSection,
] = useState(
SECTIONS[0].id,
);

const [
copyState,
setCopyState,
] = useState(
COPY_STATES.IDLE,
);

const sectionRefs =
useRef(
new Map(),
);

const copyResetTimer =
useRef(null);

const focusTimer =
useRef(null);

const hashNavigationTimer =
useRef(null);

const lastAnnouncedSection =
useRef(
SECTIONS[0].id,
);

const mountedRef =
useRef(false);

/* ==========================================================================

* LIFECYCLE STATE
* ======================================================================== */

useEffect(() => {
mountedRef.current =
true;


return () => {
  mountedRef.current =
    false;
};


}, []);

/* ==========================================================================

* SECTION REF REGISTRATION
* ======================================================================== */

const registerSectionRef =
useCallback(
(
sectionId,
node,
) => {
if (node) {
sectionRefs.current.set(
sectionId,
node,
);
} else {
sectionRefs.current.delete(
sectionId,
);
}
},
[],
);

/* ==========================================================================

* ACTIVE SECTION
* ======================================================================== */

const announceSectionChange =
useCallback(
(sectionId) => {
if (
sectionId ===
lastAnnouncedSection.current
) {
return;
}


    lastAnnouncedSection.current =
      sectionId;

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
  [onSectionChange],
);


/* ==========================================================================

* SCROLL TO SECTION
* ======================================================================== */

const scrollToSection =
useCallback(
(
sectionId,
updateUrl = true,
focusSection = true,
) => {
if (
!isBrowser() ||
!isValidSectionId(
sectionId,
)
) {
return false;
}


    const element =
      sectionRefs.current.get(
        sectionId,
      );

    if (!element) {
      return false;
    }

    element.scrollIntoView({
      behavior:
        getScrollBehavior(),

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

    lastAnnouncedSection.current =
      sectionId;

    if (
      typeof onSectionChange ===
      'function'
    ) {
      onSectionChange(
        sectionId,
      );
    }

    if (
      focusSection &&
      LEGAL_ACCESSIBILITY.FOCUS_SECTION_ON_HASH
    ) {
      if (
        focusTimer.current
      ) {
        window.clearTimeout(
          focusTimer.current,
        );
      }

      focusTimer.current =
        window.setTimeout(
          () => {
            if (
              !mountedRef.current
            ) {
              return;
            }

            try {
              element.focus({
                preventScroll:
                  true,
              });
            } catch {
              // Older browsers may not support the focus options object.
              element.focus();
            }
          },
          FOCUS_DELAY_MS,
        );
    }

    return true;
  },
  [onSectionChange],
);


/* ==========================================================================

* INITIAL HASH / DEEP LINK
* ======================================================================== */

useEffect(() => {
if (!isBrowser()) {
return undefined;
}


const sectionId =
  getHashSectionId();

if (
  !isValidSectionId(
    sectionId,
  )
) {
  return undefined;
}

if (
  hashNavigationTimer.current
) {
  window.clearTimeout(
    hashNavigationTimer.current,
  );
}

hashNavigationTimer.current =
  window.setTimeout(
    () => {
      scrollToSection(
        sectionId,
        false,
        true,
      );
    },
    HASH_NAVIGATION_DELAY_MS,
  );

return () => {
  if (
    hashNavigationTimer.current
  ) {
    window.clearTimeout(
      hashNavigationTimer.current,
    );

    hashNavigationTimer.current =
      null;
  }
};


}, [scrollToSection]);

/* ==========================================================================

* BROWSER HASH NAVIGATION
*
* Supports:
* * Back/forward navigation.
* * External hash changes.
* * Direct hash manipulation.
* ======================================================================== */

useEffect(() => {
if (!isBrowser()) {
return undefined;
}


const handleHashChange =
  () => {
    const sectionId =
      getHashSectionId();

    if (
      !isValidSectionId(
        sectionId,
      )
    ) {
      return;
    }

    scrollToSection(
      sectionId,
      false,
      true,
    );
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


}, [scrollToSection]);

/* ==========================================================================

* INTERSECTION OBSERVER
* ======================================================================== */

useEffect(() => {
if (
!isBrowser() ||
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

      if (
        !isValidSectionId(
          sectionId,
        )
      ) {
        return;
      }

      /*
       * IntersectionObserver is responsible for visual active-state
       * tracking. It does not trigger focus, preventing unexpected
       * keyboard jumps while the user scrolls.
       */
      announceSectionChange(
        sectionId,
      );
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


}, [announceSectionChange]);

/* ==========================================================================

* CLEANUP TIMERS
* ======================================================================== */

useEffect(
() => {
return () => {
if (
isBrowser() &&
copyResetTimer.current
) {
window.clearTimeout(
copyResetTimer.current,
);
}


    if (
      isBrowser() &&
      focusTimer.current
    ) {
      window.clearTimeout(
        focusTimer.current,
      );
    }

    if (
      isBrowser() &&
      hashNavigationTimer.current
    ) {
      window.clearTimeout(
        hashNavigationTimer.current,
      );
    }
  };
},
[],


);

/* ==========================================================================

* PRINT
* ======================================================================== */

const handlePrint =
useCallback(
() => {
if (
!isBrowser() ||
typeof window.print !==
'function'
) {
return;
}


    window.print();
  },
  [],
);


/* ==========================================================================

* COPY LINK
* ======================================================================== */

const resetCopyState =
useCallback(
() => {
if (
!isBrowser()
) {
return;
}


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
          if (
            mountedRef.current
          ) {
            setCopyState(
              COPY_STATES.IDLE,
            );
          }
        },
        COPY_RESET_DELAY_MS,
      );
  },
  [],
);


const copyUsingFallback =
useCallback(
(text) => {
if (
!isBrowser() ||
typeof document.execCommand !==
'function'
) {
return false;
}


    const textarea =
      document.createElement(
        'textarea',
      );

    textarea.value =
      text;

    textarea.setAttribute(
      'readonly',
      '',
    );

    textarea.setAttribute(
      'aria-hidden',
      'true',
    );

    textarea.style.position =
      'fixed';

    textarea.style.top =
      '0';

    textarea.style.left =
      '0';

    textarea.style.width =
      '1px';

    textarea.style.height =
      '1px';

    textarea.style.padding =
      '0';

    textarea.style.border =
      '0';

    textarea.style.outline =
      '0';

    textarea.style.boxShadow =
      'none';

    textarea.style.background =
      'transparent';

    textarea.style.opacity =
      '0';

    document.body.appendChild(
      textarea,
    );

    textarea.focus();
    textarea.select();

    let copied =
      false;

    try {
      copied =
        document.execCommand(
          'copy',
        );
    } catch {
      copied =
        false;
    }

    document.body.removeChild(
      textarea,
    );

    return copied;
  },
  [],
);


const handleCopyLink =
useCallback(
async () => {
if (
!isBrowser()
) {
return;
}


    const url =
      window.location.href;

    try {
      let copied =
        false;

      if (
        navigator.clipboard &&
        typeof navigator.clipboard
          .writeText ===
          'function'
      ) {
        try {
          await navigator.clipboard.writeText(
            url,
          );

          copied =
            true;
        } catch {
          copied =
            false;
        }
      }

      if (!copied) {
        copied =
          copyUsingFallback(
            url,
          );
      }

      if (!copied) {
        throw new Error(
          'Clipboard operation failed.',
        );
      }

      if (
        mountedRef.current
      ) {
        setCopyState(
          COPY_STATES.COPIED,
        );
      }

      resetCopyState();
    } catch {
      if (
        mountedRef.current
      ) {
        setCopyState(
          COPY_STATES.ERROR,
        );
      }

      resetCopyState();
    }
  },
  [
    copyUsingFallback,
    resetCopyState,
  ],
);


/* ==========================================================================

* BACK TO TOP
* ======================================================================== */

const handleBackToTop =
useCallback(
() => {
if (
!isBrowser()
) {
return;
}


    window.scrollTo({
      top:
        0,

      behavior:
        getScrollBehavior(),
    });

    if (
      typeof window.history
        .replaceState ===
      'function'
    ) {
      const url =
        buildLegalSectionUrl(
          DOCUMENT.route,
          SECTIONS[0].id,
        );

      /*
       * Keep the document URL canonical while returning the user to the
       * beginning of the Privacy Policy.
       */
      window.history.replaceState(
        null,
        '',
        url,
      );
    }

    setActiveSection(
      SECTIONS[0].id,
    );

    lastAnnouncedSection.current =
      SECTIONS[0].id;
  },
  [],
);


/* ==========================================================================

* SECTION NAVIGATION DATA
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

* ACCESSIBILITY STATUS
* ======================================================================== */

const activeSectionTitle =
SECTION_BY_ID.get(
activeSection,
)?.title ||
DOCUMENT.title;

const accessibilityStatus =
copyState ===
COPY_STATES.COPIED
? 'Privacy Policy link copied.'
: copyState ===
COPY_STATES.ERROR
? 'Unable to copy Privacy Policy link.'
: LEGAL_ACCESSIBILITY_MESSAGES
.DOCUMENT_LOADED;

/* ==========================================================================

* RENDER
* ======================================================================== */

return ( <main
   id="main-content"
   className="legal-page legal-page--privacy"
   aria-labelledby="privacy-policy-title"
   data-document-id={DOCUMENT.id}
   data-document-type={DOCUMENT.type}
   data-document-version={DOCUMENT.version}
   data-document-route={DOCUMENT.route}
 >
{/* ======================================================================
DOCUMENT HEADER
==================================================================== */}


  <header
    className="legal-page__header"
    data-testid="privacy-policy-header"
  >
    <div className="legal-page__header-inner">
      <div
        className="legal-page__eyebrow"
        data-document-brand
      >
        {LEGAL_SYSTEM.BRAND}
      </div>

      <h1
        id="privacy-policy-title"
        className="legal-page__title"
      >
        {DOCUMENT.title}
      </h1>

      <p
        id="privacy-policy-description"
        className="legal-page__description"
      >
        This Privacy Policy explains how{' '}
        {LEGAL_SYSTEM.BRAND}{' '}
        collects, uses, protects and
        manages information in connection
        with its services.
      </p>

      <div
        className="legal-document-meta"
        aria-label="Privacy Policy metadata"
        data-testid="privacy-policy-metadata"
      >
        {LEGAL_UI.SHOW_VERSION && (
          <span className="legal-document-meta__item">
            <strong>
              Version:
            </strong>{' '}
            <span
              data-document-version-value
            >
              {DOCUMENT.version}
            </span>
          </span>
        )}

        {LEGAL_UI.SHOW_LAST_UPDATED && (
          <span className="legal-document-meta__item">
            <strong>
              Last updated:
            </strong>{' '}
            <time
              dateTime={
                DOCUMENT.lastUpdatedISO
              }
            >
              {DOCUMENT.lastUpdated}
            </time>
          </span>
        )}

        {LEGAL_UI.SHOW_EFFECTIVE_DATE && (
          <span className="legal-document-meta__item">
            <strong>
              Effective:
            </strong>{' '}
            <time
              dateTime={
                DOCUMENT.effectiveDateISO
              }
            >
              {DOCUMENT.effectiveDate}
            </time>
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
        aria-label="Privacy Policy actions"
      >
        {showPrintButton && (
          <button
            type="button"
            className="legal-button legal-button--secondary"
            onClick={handlePrint}
            aria-label="Print Privacy Policy"
          >
            Print
          </button>
        )}

        {showCopyLink && (
          <button
            type="button"
            className="legal-button legal-button--secondary"
            onClick={handleCopyLink}
            aria-label="Copy link to Privacy Policy"
          >
            {copyState ===
            COPY_STATES.COPIED
              ? 'Link Copied'
              : copyState ===
                  COPY_STATES.ERROR
                ? 'Copy Failed'
                : 'Copy Link'}
          </button>
        )}
      </div>
    </div>
  </header>

  {/* ======================================================================
      PAGE BODY
      ==================================================================== */}

  <div
    className="legal-page__body"
    data-testid="privacy-policy-body"
  >
    {showTableOfContents && (
      <aside
        className="legal-page__sidebar"
        aria-label="Privacy Policy navigation"
      >
        <nav
          className="legal-toc"
          aria-label="Privacy Policy table of contents"
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
                  <a
                    href={
                      section.href
                    }
                    className={`legal-toc__link${
                      section.active
                        ? ' is-active'
                        : ''
                    }`}
                    onClick={(event) => {
                      event.preventDefault();

                      scrollToSection(
                        section.id,
                        true,
                        true,
                      );
                    }}
                    aria-current={
                      section.active
                        ? 'location'
                        : undefined
                    }
                    aria-label={`Go to section ${section.number}: ${section.title}`}
                    data-section-id={
                      section.id
                    }
                  >
                    {section.shortTitle}
                  </a>
                </li>
              ),
            )}
          </ol>
        </nav>
      </aside>
    )}

    {/* ====================================================================
        DOCUMENT CONTENT
        ================================================================== */}

    <article
      className="legal-document"
      aria-describedby="privacy-policy-description"
      data-testid="privacy-policy-document"
    >
      <div
        className="legal-document__notice"
        role="note"
        aria-label="Important Privacy Policy notice"
      >
        <strong>
          Important:
        </strong>{' '}
        Please read this Privacy Policy
        carefully. By using TITech Community
        Capital services, you may provide or
        generate information that is subject
        to this policy and applicable law.
      </div>

      {/* ==================================================================
          1. INTRODUCTION
          ================================================================= */}

      <section
        id="pp-1"
        ref={(node) =>
          registerSectionRef(
            'pp-1',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-1-title"
        data-section-id="pp-1"
        data-section-number="1"
      >
        <SectionHeading id="pp-1-title">
          1. Introduction
        </SectionHeading>

        <p>
          TITech Community Capital Ltd
          (“TITech Community Capital,”
          “TITech,” “we,” “us,” or “our”)
          respects your privacy and is
          committed to protecting personal
          information entrusted to us.
        </p>

        <p>
          This Privacy Policy describes how
          we collect, receive, use, disclose,
          retain and protect information when
          you access or use TITech Community
          Capital applications, websites,
          APIs, financial and community
          finance services, communications
          channels and related services.
        </p>

        <p>
          This policy should be read together
          with our Terms of Service and other
          applicable legal notices and
          disclosures.
        </p>
      </section>

      {/* ==================================================================
          2. INFORMATION WE COLLECT
          ================================================================= */}

      <section
        id="pp-2"
        ref={(node) =>
          registerSectionRef(
            'pp-2',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-2-title"
        data-section-id="pp-2"
        data-section-number="2"
      >
        <SectionHeading id="pp-2-title">
          2. Information We Collect
        </SectionHeading>

        <p>
          Depending on how you interact with
          TITech Community Capital, we may
          collect information necessary to
          provide, secure, improve and support
          our services.
        </p>

        <h3>
          2.1 Information You Provide
        </h3>

        <ul>
          <li>
            Name and contact information.
          </li>

          <li>
            Account credentials and
            authentication information.
          </li>

          <li>
            Identification and verification
            information where required for
            applicable services.
          </li>

          <li>
            Community, group or organization
            membership information.
          </li>

          <li>
            Savings, contribution,
            transaction and account
            information.
          </li>

          <li>
            Communications and support
            requests.
          </li>

          <li>
            Information submitted through
            forms, surveys or other voluntary
            interactions.
          </li>
        </ul>

        <h3>
          2.2 Information Collected
          Automatically
        </h3>

        <p>
          We may collect technical and
          interaction information such as
          browser type, device information,
          IP address, operating-system
          information, access timestamps,
          application events, diagnostic data
          and security-related logs.
        </p>

        <h3>
          2.3 Financial and Transaction
          Information
        </h3>

        <p>
          Where applicable to the services
          you use, we may process information
          relating to savings, contributions,
          payments, transfers, balances,
          transaction references and related
          financial activity.
        </p>
      </section>

      {/* ==================================================================
          3. HOW WE USE YOUR DATA
          ================================================================= */}

      <section
        id="pp-3"
        ref={(node) =>
          registerSectionRef(
            'pp-3',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-3-title"
        data-section-id="pp-3"
        data-section-number="3"
      >
        <SectionHeading id="pp-3-title">
          3. How We Use Your Data
        </SectionHeading>

        <p>
          We use information for legitimate
          operational, contractual, security,
          compliance and service-delivery
          purposes, including to:
        </p>

        <ul>
          <li>
            Create and manage accounts.
          </li>

          <li>
            Provide community finance and
            savings services.
          </li>

          <li>
            Process and reconcile
            transactions.
          </li>

          <li>
            Verify identity and prevent
            unauthorized activity.
          </li>

          <li>
            Detect, investigate and prevent
            fraud and abuse.
          </li>

          <li>
            Maintain system security and
            reliability.
          </li>

          <li>
            Provide customer support.
          </li>

          <li>
            Communicate service-related
            information.
          </li>

          <li>
            Improve products, features and
            user experience.
          </li>

          <li>
            Meet applicable legal,
            regulatory and audit obligations.
          </li>

          <li>
            Establish, exercise or defend
            legal rights.
          </li>
        </ul>
      </section>

      {/* ==================================================================
          4. DATA SECURITY
          ================================================================= */}

      <section
        id="pp-4"
        ref={(node) =>
          registerSectionRef(
            'pp-4',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-4-title"
        data-section-id="pp-4"
        data-section-number="4"
      >
        <SectionHeading id="pp-4-title">
          4. Data Security
        </SectionHeading>

        <p>
          TITech Community Capital applies
          technical, organizational and
          operational safeguards designed to
          protect information against
          unauthorized access, alteration,
          disclosure, loss and destruction.
        </p>

        <p>
          Depending on the nature of the
          information and the service
          involved, safeguards may include
          access controls, authentication,
          encryption, monitoring, logging,
          network protections, backup
          controls, secure development
          practices and incident-response
          procedures.
        </p>

        <p>
          No method of electronic transmission
          or storage can be guaranteed to be
          completely secure. You are also
          responsible for protecting your
          credentials and devices from
          unauthorized access.
        </p>
      </section>

      {/* ==================================================================
          5. DATA SHARING
          ================================================================= */}

      <section
        id="pp-5"
        ref={(node) =>
          registerSectionRef(
            'pp-5',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-5-title"
        data-section-id="pp-5"
        data-section-number="5"
      >
        <SectionHeading id="pp-5-title">
          5. Data Sharing
        </SectionHeading>

        <p>
          We do not sell personal information
          merely because you use TITech
          Community Capital services.
        </p>

        <p>
          Information may be shared where
          reasonably necessary to operate the
          platform, provide requested services,
          protect users and the platform,
          satisfy legal obligations or support
          legitimate business operations.
        </p>

        <h3>
          5.1 Service Providers
        </h3>

        <p>
          We may use trusted service providers
          for hosting, infrastructure,
          communications, analytics, security,
          identity verification, payment
          processing, customer support and
          other operational functions.
        </p>

        <h3>
          5.2 Community or Organization
          Administrators
        </h3>

        <p>
          Where TITech Community Capital is
          provided through a community,
          cooperative, SACCO, savings group,
          organization or other tenant, certain
          information may be accessible to
          authorized administrators according
          to the applicable service
          configuration and permissions.
        </p>

        <h3>
          5.3 Legal and Regulatory
          Requirements
        </h3>

        <p>
          Information may be disclosed where
          required or permitted by applicable
          law, regulation, court order,
          governmental authority or lawful
          process.
        </p>
      </section>

      {/* ==================================================================
          6. YOUR RIGHTS
          ================================================================= */}

      <section
        id="pp-6"
        ref={(node) =>
          registerSectionRef(
            'pp-6',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-6-title"
        data-section-id="pp-6"
        data-section-number="6"
      >
        <SectionHeading id="pp-6-title">
          6. Your Rights
        </SectionHeading>

        <p>
          Subject to applicable law and
          legitimate limitations, you may have
          rights relating to your personal
          information, including rights to:
        </p>

        <ul>
          <li>
            Request access to personal
            information we hold about you.
          </li>

          <li>
            Request correction of inaccurate
            information.
          </li>

          <li>
            Request deletion where legally
            permissible.
          </li>

          <li>
            Object to or request restriction
            of certain processing.
          </li>

          <li>
            Withdraw consent where processing
            is based on consent.
          </li>

          <li>
            Request information about how your
            personal data is processed.
          </li>
        </ul>

        <p>
          Some requests may be subject to
          identity verification, legal
          requirements, contractual
          obligations, fraud-prevention
          requirements or legitimate record
          retention requirements.
        </p>
      </section>

      {/* ==================================================================
          7. COOKIES & TRACKING
          ================================================================= */}

      <section
        id="pp-7"
        ref={(node) =>
          registerSectionRef(
            'pp-7',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-7-title"
        data-section-id="pp-7"
        data-section-number="7"
      >
        <SectionHeading id="pp-7-title">
          7. Cookies & Tracking
        </SectionHeading>

        <p>
          TITech Community Capital may use
          cookies, local storage, session
          technologies and similar mechanisms
          to support essential functionality,
          security, preferences, analytics and
          other permitted purposes.
        </p>

        <p>
          Essential technologies may be
          necessary for account authentication,
          security, session management and
          core application functionality.
        </p>

        <p>
          Where applicable, non-essential
          technologies may be subject to
          consent or preference controls.
        </p>
      </section>

      {/* ==================================================================
          8. DATA RETENTION
          ================================================================= */}

      <section
        id="pp-8"
        ref={(node) =>
          registerSectionRef(
            'pp-8',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-8-title"
        data-section-id="pp-8"
        data-section-number="8"
      >
        <SectionHeading id="pp-8-title">
          8. Data Retention
        </SectionHeading>

        <p>
          We retain information for as long
          as reasonably necessary to provide
          services, maintain business and
          financial records, satisfy legal and
          regulatory obligations, resolve
          disputes, enforce agreements and
          protect our legitimate interests.
        </p>

        <p>
          Different categories of information
          may have different retention periods.
          Financial, transaction, audit,
          security and regulatory records may
          need to be retained for longer periods
          than ordinary application data.
        </p>
      </section>

      {/* ==================================================================
          9. CHILDREN'S PRIVACY
          ================================================================= */}

      <section
        id="pp-9"
        ref={(node) =>
          registerSectionRef(
            'pp-9',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-9-title"
        data-section-id="pp-9"
        data-section-number="9"
      >
        <SectionHeading id="pp-9-title">
          9. Children's Privacy
        </SectionHeading>

        <p>
          TITech Community Capital services
          are not intended to bypass applicable
          age restrictions or legal safeguards
          protecting children.
        </p>

        <p>
          Where a service is subject to
          minimum-age requirements, users must
          meet those requirements before
          registering or using the applicable
          service.
        </p>

        <p>
          If you believe that information
          relating to a child has been provided
          improperly, please contact us so that
          we can assess the matter and take
          appropriate action.
        </p>
      </section>

      {/* ==================================================================
          10. INTERNATIONAL DATA TRANSFERS
          ================================================================= */}

      <section
        id="pp-10"
        ref={(node) =>
          registerSectionRef(
            'pp-10',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-10-title"
        data-section-id="pp-10"
        data-section-number="10"
      >
        <SectionHeading id="pp-10-title">
          10. International Data Transfers
        </SectionHeading>

        <p>
          Depending on the infrastructure,
          service providers and locations
          involved in operating the platform,
          information may be processed or
          stored in jurisdictions outside your
          immediate location.
        </p>

        <p>
          Where applicable, TITech Community
          Capital will take reasonable measures
          to ensure that international transfers
          are handled in accordance with
          applicable data-protection and
          privacy requirements.
        </p>
      </section>

      {/* ==================================================================
          11. CHANGES
          ================================================================= */}

      <section
        id="pp-11"
        ref={(node) =>
          registerSectionRef(
            'pp-11',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-11-title"
        data-section-id="pp-11"
        data-section-number="11"
      >
        <SectionHeading id="pp-11-title">
          11. Changes to This Policy
        </SectionHeading>

        <p>
          We may update this Privacy Policy
          from time to time to reflect changes
          in our services, technology, legal
          requirements, regulatory expectations
          or operational practices.
        </p>

        <p>
          When changes are made, we will update
          the policy version and “Last updated”
          information. Where required by
          applicable law or the nature of the
          change, we may provide additional
          notice or request renewed acceptance.
        </p>
      </section>

      {/* ==================================================================
          12. CONTACT
          ================================================================= */}

      <section
        id="pp-12"
        ref={(node) =>
          registerSectionRef(
            'pp-12',
            node,
          )
        }
        className="legal-section"
        aria-labelledby="pp-12-title"
        data-section-id="pp-12"
        data-section-number="12"
      >
        <SectionHeading id="pp-12-title">
          12. Privacy Contact Information
        </SectionHeading>

        <p>
          If you have questions, requests or
          concerns regarding this Privacy
          Policy or the handling of your
          personal information, please contact
          TITech Community Capital.
        </p>

        <address className="legal-contact">
          <p>
            <strong>
              {CONTACT.address}
            </strong>
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
            Data Protection:{' '}
            <a
              href={`mailto:${CONTACT.dataProtectionEmail}`}
            >
              {CONTACT.dataProtectionEmail}
            </a>
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

      <footer
        className="legal-document__footer"
        data-testid="privacy-policy-footer"
      >
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
      aria-label="Back to top of Privacy Policy"
    >
      Back to top
    </button>
  )}

  {/* ======================================================================
      SCREEN-READER STATUS
      ==================================================================== */}

  <div
    className="legal-visually-hidden"
    aria-live={
      LEGAL_ACCESSIBILITY.DEFAULT_ARIA_LIVE
    }
    aria-atomic="true"
    role="status"
    data-testid="privacy-policy-status"
  >
    {accessibilityStatus}
  </div>

  {/* ======================================================================
      CURRENT SECTION ACCESSIBILITY CONTEXT
      ==================================================================== */}

  <div
    className="legal-visually-hidden"
    aria-hidden="true"
    data-active-section={
      activeSection
    }
  >
    Current section:{' '}
    {activeSectionTitle}
  </div>
</main>


);
}

/* ============================================================================

* PROP TYPES
* ========================================================================== */

PrivacyPolicy.propTypes = {
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

/* ============================================================================

* DEFAULT EXPORT CONTRACT
*
* The component above intentionally remains the default export so existing
* route configuration does not need to change.
* ========================================================================== */