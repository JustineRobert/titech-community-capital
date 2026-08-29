/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Legal Information Page
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/Legal.jsx
 *
 * Purpose:
 *   Production-grade presentation layer for TITech Community Capital legal
 *   information.
 *
 * Architecture:
 *
 *   frontend/src/legal/
 *   ├── index.js
 *   ├── legalRegistry.js
 *   ├── legalTypes.js
 *   └── legalUtils.js
 *
 *   frontend/src/pages/
 *   └── Legal.jsx
 *
 * Design Principles:
 *   ✓ Registry-driven legal metadata
 *   ✓ No duplicate legal registry configuration
 *   ✓ Accessible document landmarks
 *   ✓ WCAG-oriented navigation
 *   ✓ Responsive navigation
 *   ✓ Sticky legal navigation
 *   ✓ Active section tracking
 *   ✓ Deep-link/hash navigation
 *   ✓ Browser back/forward hash support
 *   ✓ Keyboard navigation
 *   ✓ Reduced-motion awareness
 *   ✓ Print support
 *   ✓ Defensive browser API usage
 *   ✓ IntersectionObserver cleanup
 *   ✓ Safe lifecycle management
 *   ✓ Stable section identifiers
 *   ✓ Scroll restoration
 *   ✓ Document version awareness
 *   ✓ Registry validation compatibility
 *   ✓ Future CMS/API compatibility
 *   ✓ No sensitive client-side state
 *   ✓ TITech terminology consistency
 *
 * IMPORTANT:
 *   This component is a software presentation layer.
 *
 *   It does not determine whether TITech Community Capital Ltd is licensed,
 *   authorized, regulated, or legally permitted to perform a regulated
 *   financial activity.
 *
 *   Substantive legal content must be reviewed and approved by appropriately
 *   qualified legal, regulatory, privacy, and compliance professionals.
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

import { Link } from 'react-router-dom';

import {
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

import {
  LEGAL_DOCUMENTS,
  LEGAL_STATUS,
  LEGAL_CATEGORY,
  getPublishedLegalDocuments,
  getPublicLegalDocuments,
} from '../legal';

import './Legal.css';

/* ============================================================================
 * PAGE CONSTANTS
 * ========================================================================== */

const PAGE_CONFIG = Object.freeze({
  organizationName: 'TITech Community Capital Ltd',
  platformName: 'TITech Community Capital Platform',

  /*
   * These values are presentation fallbacks only.
   *
   * The authoritative document version/date should come from the registry
   * whenever available.
   */
  fallbackLastUpdated: 'January 15, 2026',
  fallbackVersion: '1.0',

  legalEmail: 'legal@titechcommunity.app',
  phoneDisplay: '+256 (782) 397907',
  phoneUri: '+256782397907',
  address: 'Kampala, Uganda',
  responseTime: '5 business days',
});

const SCROLL_TOP_THRESHOLD = 420;
const INITIAL_HASH_DELAY = 75;
const SECTION_SCROLL_OFFSET = 24;

const SCROLL_LOCK_RELEASE_MS = 850;
const REDUCED_SCROLL_LOCK_RELEASE_MS = 75;

/* ============================================================================
 * STABLE SECTION CONFIGURATION
 * ========================================================================== */

/**
 * Stable UI section identifiers.
 *
 * These IDs are deliberately kept independent from legal document IDs so
 * legal content can later be supplied by a CMS/API without forcing the
 * browser navigation contract to change.
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
    icon: FileText,
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
 * BROWSER HELPERS
 * ========================================================================== */

/**
 * Safely determine whether reduced motion is preferred.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }

  try {
    return window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  } catch {
    return false;
  }
}

/**
 * Safely obtain the current browser hash.
 *
 * @returns {string|null}
 */
function getHashSectionId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawHash = window.location?.hash;

  if (!rawHash) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(
      rawHash.replace(/^#/, ''),
    );

    return SECTION_IDS.includes(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

/**
 * Replace the current URL hash without causing a page reload.
 *
 * @param {string} id
 */
function replaceSectionHash(id) {
  if (
    typeof window === 'undefined' ||
    !window.history ||
    typeof window.history.replaceState !== 'function' ||
    !SECTION_IDS.includes(id)
  ) {
    return;
  }

  const baseUrl =
    window.location.pathname +
    window.location.search;

  window.history.replaceState(
    null,
    '',
    `${baseUrl}#${encodeURIComponent(id)}`,
  );
}

/**
 * Clear the current URL hash.
 */
function clearSectionHash() {
  if (
    typeof window === 'undefined' ||
    !window.history ||
    typeof window.history.replaceState !== 'function'
  ) {
    return;
  }

  window.history.replaceState(
    null,
    '',
    window.location.pathname +
      window.location.search,
  );
}

/* ============================================================================
 * REGISTRY HELPERS
 * ========================================================================== */

/**
 * Safely retrieve the authoritative registry.
 *
 * The page intentionally avoids assuming that every registry implementation
 * exposes exactly the same runtime shape.
 */
function getRegistryDocuments() {
  if (!Array.isArray(LEGAL_DOCUMENTS)) {
    return [];
  }

  return LEGAL_DOCUMENTS;
}

/**
 * Find a document using likely registry identifiers.
 *
 * @param {Array<object>} documents
 * @param {string[]} identifiers
 * @returns {object|null}
 */
function findRegistryDocument(
  documents,
  identifiers,
) {
  if (!Array.isArray(documents)) {
    return null;
  }

  return (
    documents.find((document) =>
      identifiers.includes(document?.id),
    ) ||
    documents.find((document) =>
      identifiers.includes(document?.slug),
    ) ||
    null
  );
}

/**
 * Safely resolve document metadata from the enterprise registry.
 *
 * @param {string[]} identifiers
 * @param {object} fallback
 * @returns {object}
 */
function resolveDocumentMetadata(
  identifiers,
  fallback,
) {
  const documents = getRegistryDocuments();

  const registryDocument =
    findRegistryDocument(
      documents,
      identifiers,
    );

  if (!registryDocument) {
    return fallback;
  }

  return {
    ...fallback,
    ...registryDocument,
  };
}

/* ============================================================================
 * COMPONENT
 * ========================================================================== */

const Legal = () => {
  const contentRef = useRef(null);
  const observerRef = useRef(null);
  const mountedRef = useRef(false);
  const navigationLockRef = useRef(null);
  const navigationTimerRef = useRef(null);
  const initialNavigationTimerRef =
    useRef(null);

  const [activeSection, setActiveSection] =
    useState('tos-1');

  const [showScrollTop, setShowScrollTop] =
    useState(false);

  const [mobileNavOpen, setMobileNavOpen] =
    useState(false);

  /* ==========================================================================
   * REGISTRY-DRIVEN METADATA
   * ======================================================================== */

  const registryDocuments = useMemo(
    () => getRegistryDocuments(),
    [],
  );

  const publishedDocuments = useMemo(() => {
    try {
      return getPublishedLegalDocuments();
    } catch {
      return registryDocuments.filter(
        (document) =>
          document?.status ===
          LEGAL_STATUS?.PUBLISHED,
      );
    }
  }, [registryDocuments]);

  const publicDocuments = useMemo(() => {
    try {
      return getPublicLegalDocuments();
    } catch {
      return publishedDocuments.filter(
        (document) =>
          document?.public === true,
      );
    }
  }, [publishedDocuments]);

  const termsDocument = useMemo(
    () =>
      resolveDocumentMetadata(
        [
          'terms-of-service',
          'terms',
          'tos',
        ],
        {
          title: 'Terms of Service',
          currentVersion:
            PAGE_CONFIG.fallbackVersion,
          lastUpdated:
            PAGE_CONFIG.fallbackLastUpdated,
        },
      ),
    [],
  );

  const privacyDocument = useMemo(
    () =>
      resolveDocumentMetadata(
        [
          'privacy-policy',
          'privacy',
        ],
        {
          title: 'Privacy Policy',
          currentVersion:
            PAGE_CONFIG.fallbackVersion,
          lastUpdated:
            PAGE_CONFIG.fallbackLastUpdated,
        },
      ),
    [],
  );

  const disclaimerDocument = useMemo(
    () =>
      resolveDocumentMetadata(
        [
          'general-disclaimer',
          'disclaimer',
        ],
        {
          title: 'General Disclaimer',
          currentVersion:
            PAGE_CONFIG.fallbackVersion,
          lastUpdated:
            PAGE_CONFIG.fallbackLastUpdated,
        },
      ),
    [],
  );

  const legalVersion =
    termsDocument?.currentVersion ||
    privacyDocument?.currentVersion ||
    PAGE_CONFIG.fallbackVersion;

  const legalLastUpdated =
    termsDocument?.lastModified ||
    termsDocument?.publishedDate ||
    termsDocument?.effectiveDate ||
    privacyDocument?.lastModified ||
    privacyDocument?.publishedDate ||
    privacyDocument?.effectiveDate ||
    PAGE_CONFIG.fallbackLastUpdated;

  /* ==========================================================================
   * NAVIGATION CONFIGURATION
   * ======================================================================== */

  const navigation = useMemo(
    () => NAV_SECTIONS,
    [],
  );

  /* ==========================================================================
   * SCROLL POSITION
   * ======================================================================== */

  const handleScroll = useCallback(() => {
    const container = contentRef.current;

    if (!container) {
      return;
    }

    const shouldShow =
      container.scrollTop >
      SCROLL_TOP_THRESHOLD;

    setShowScrollTop((previous) =>
      previous === shouldShow
        ? previous
        : shouldShow,
    );
  }, []);

  /* ==========================================================================
   * NAVIGATION LOCK
   * ======================================================================== */

  const releaseNavigationLock =
    useCallback((expectedId = null) => {
      if (
        expectedId === null ||
        navigationLockRef.current ===
          expectedId
      ) {
        navigationLockRef.current = null;
      }
    }, []);

  const scheduleNavigationLockRelease =
    useCallback(
      (id) => {
        if (
          typeof window === 'undefined'
        ) {
          releaseNavigationLock(id);
          return;
        }

        if (
          navigationTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            navigationTimerRef.current,
          );
        }

        const delay =
          prefersReducedMotion()
            ? REDUCED_SCROLL_LOCK_RELEASE_MS
            : SCROLL_LOCK_RELEASE_MS;

        navigationTimerRef.current =
          window.setTimeout(() => {
            if (
              mountedRef.current &&
              navigationLockRef.current ===
                id
            ) {
              navigationLockRef.current =
                null;
            }

            navigationTimerRef.current =
              null;
          }, delay);
      },
      [releaseNavigationLock],
    );

  /* ==========================================================================
   * SCROLL TO TOP
   * ======================================================================== */

  const scrollToTop = useCallback(() => {
    const container = contentRef.current;

    if (!container) {
      return;
    }

    navigationLockRef.current = 'tos-1';

    container.scrollTo({
      top: 0,
      behavior: prefersReducedMotion()
        ? 'auto'
        : 'smooth',
    });

    setActiveSection('tos-1');
    clearSectionHash();
    setMobileNavOpen(false);

    if (
      typeof container.focus ===
        'function' &&
      typeof document !== 'undefined' &&
      document.activeElement !== container
    ) {
      try {
        container.focus({
          preventScroll: true,
        });
      } catch {
        container.focus();
      }
    }

    scheduleNavigationLockRelease(
      'tos-1',
    );
  }, [scheduleNavigationLockRelease]);

  /* ==========================================================================
   * PRINT
   * ======================================================================== */

  const handlePrint = useCallback(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.print !== 'function'
    ) {
      return;
    }

    setMobileNavOpen(false);

    window.setTimeout(() => {
      if (
        mountedRef.current &&
        typeof window.print === 'function'
      ) {
        window.print();
      }
    }, 0);
  }, []);

  /* ==========================================================================
   * SECTION NAVIGATION
   * ======================================================================== */

  const scrollToSection = useCallback(
    (id) => {
      const container = contentRef.current;

      if (
        !container ||
        !SECTION_IDS.includes(id)
      ) {
        return;
      }

      if (
        typeof document === 'undefined' ||
        typeof document.getElementById !==
          'function'
      ) {
        return;
      }

      const target =
        document.getElementById(id);

      if (!target) {
        return;
      }

      const containerRect =
        container.getBoundingClientRect();

      const targetRect =
        target.getBoundingClientRect();

      const nextTop =
        container.scrollTop +
        (targetRect.top -
          containerRect.top) -
        SECTION_SCROLL_OFFSET;

      navigationLockRef.current = id;

      container.scrollTo({
        top: Math.max(0, nextTop),
        behavior: prefersReducedMotion()
          ? 'auto'
          : 'smooth',
      });

      setActiveSection(id);
      replaceSectionHash(id);
      setMobileNavOpen(false);

      scheduleNavigationLockRelease(id);
    },
    [scheduleNavigationLockRelease],
  );

  const handleSectionNavigation =
    useCallback(
      (event, id) => {
        if (event) {
          event.preventDefault();
        }

        scrollToSection(id);
      },
      [scrollToSection],
    );

  /* ==========================================================================
   * INTERSECTION OBSERVER
   * ======================================================================== */

  useEffect(() => {
    const container = contentRef.current;

    if (
      !container ||
      typeof IntersectionObserver ===
        'undefined'
    ) {
      return undefined;
    }

    const sections = SECTION_IDS
      .map((id) =>
        document.getElementById(id),
      )
      .filter(Boolean);

    if (!sections.length) {
      return undefined;
    }

    observerRef.current?.disconnect();

    observerRef.current =
      new IntersectionObserver(
        (entries) => {
          if (!mountedRef.current) {
            return;
          }

          if (navigationLockRef.current) {
            return;
          }

          const visibleEntries = entries
            .filter(
              (entry) =>
                entry.isIntersecting,
            )
            .sort(
              (first, second) =>
                first.boundingClientRect.top -
                second.boundingClientRect.top,
            );

          if (!visibleEntries.length) {
            return;
          }

          const nextId =
            visibleEntries[0]?.target?.id;

          if (
            nextId &&
            SECTION_IDS.includes(nextId)
          ) {
            setActiveSection((previous) =>
              previous === nextId
                ? previous
                : nextId,
            );
          }
        },
        {
          root: container,
          rootMargin:
            '-12% 0px -65% 0px',
          threshold: [
            0,
            0.1,
            0.25,
            0.5,
          ],
        },
      );

    sections.forEach((section) => {
      observerRef.current?.observe(
        section,
      );
    });

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  /* ==========================================================================
   * INITIAL HASH / DEEP LINK
   * ======================================================================== */

  useEffect(() => {
    const hashSectionId =
      getHashSectionId();

    if (!hashSectionId) {
      return undefined;
    }

    if (
      typeof window === 'undefined'
    ) {
      return undefined;
    }

    initialNavigationTimerRef.current =
      window.setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        scrollToSection(
          hashSectionId,
        );
      }, INITIAL_HASH_DELAY);

    return () => {
      if (
        initialNavigationTimerRef.current !==
          null &&
        typeof window !== 'undefined'
      ) {
        window.clearTimeout(
          initialNavigationTimerRef.current,
        );

        initialNavigationTimerRef.current =
          null;
      }
    };
  }, [scrollToSection]);

  /* ==========================================================================
   * SCROLL LISTENER
   * ======================================================================== */

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

  /* ==========================================================================
   * BROWSER HASH NAVIGATION
   * ======================================================================== */

  useEffect(() => {
    if (
      typeof window === 'undefined'
    ) {
      return undefined;
    }

    const handleHashChange = () => {
      const id =
        getHashSectionId();

      if (
        !id ||
        !mountedRef.current
      ) {
        return;
      }

      scrollToSection(id);
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
   * KEYBOARD SHORTCUTS
   * ======================================================================== */

  useEffect(() => {
    if (
      typeof window === 'undefined'
    ) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const activeElement =
        typeof document !== 'undefined'
          ? document.activeElement
          : null;

      if (event.key === 'Escape') {
        if (mobileNavOpen) {
          event.preventDefault();
          setMobileNavOpen(false);
          return;
        }

        if (
          contentRef.current &&
          contentRef.current.scrollTop >
            SCROLL_TOP_THRESHOLD
        ) {
          event.preventDefault();
          scrollToTop();
          return;
        }
      }

      if (
        event.key === 'Home' &&
        event.shiftKey &&
        activeElement?.closest?.(
          '.legal-page',
        )
      ) {
        event.preventDefault();
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
    mobileNavOpen,
    scrollToTop,
  ]);

  /* ==========================================================================
   * BODY SCROLL LOCK
   * ======================================================================== */

  useEffect(() => {
    if (
      typeof document === 'undefined'
    ) {
      return undefined;
    }

    if (!mobileNavOpen) {
      document.body.style.removeProperty(
        'overflow',
      );

      return undefined;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      'hidden';

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [mobileNavOpen]);

  /* ==========================================================================
   * LIFECYCLE SAFETY
   * ======================================================================== */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      observerRef.current?.disconnect();
      observerRef.current = null;

      navigationLockRef.current =
        null;

      if (
        typeof window !== 'undefined'
      ) {
        if (
          navigationTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            navigationTimerRef.current,
          );
        }

        if (
          initialNavigationTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            initialNavigationTimerRef.current,
          );
        }
      }

      navigationTimerRef.current =
        null;

      initialNavigationTimerRef.current =
        null;
    };
  }, []);

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <div
      className="legal-page"
      data-legal-version={
        legalVersion
      }
      data-legal-document-count={
        registryDocuments.length
      }
      data-legal-published-count={
        publishedDocuments.length
      }
      data-legal-public-count={
        publicDocuments.length
      }
    >
      {/* ======================================================================
       * HEADER
       * ==================================================================== */}

      <header
        className="legal-header"
        aria-labelledby="legal-page-title"
      >
        <div className="legal-header-content">
          <div
            className="legal-header-badge"
            aria-label={
              PAGE_CONFIG.organizationName
            }
          >
            <ShieldCheck
              size={20}
              aria-hidden="true"
            />

            <span>
              {PAGE_CONFIG.organizationName}
            </span>
          </div>

          <h1
            id="legal-page-title"
            className="legal-title"
          >
            Legal Information
          </h1>

          <p className="legal-subtitle">
            Terms of Service, Privacy Policy
            &amp; Disclaimer
          </p>

          <p className="legal-description">
            Please review these legal documents
            carefully. They explain the terms governing
            use of the TITech Community Capital Platform,
            our approach to privacy and data protection,
            and important financial and operational
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
              {legalLastUpdated}
            </span>

            <span aria-hidden="true">
              •
            </span>

            <span>
              <strong>
                Version:
              </strong>{' '}
              {legalVersion}
            </span>
          </div>
        </div>
      </header>

      {/* ======================================================================
       * MOBILE NAVIGATION
       * ==================================================================== */}

      <div className="legal-mobile-nav-toggle">
        <button
          type="button"
          className="legal-mobile-nav-button"
          onClick={() =>
            setMobileNavOpen(
              (previous) => !previous,
            )
          }
          aria-expanded={
            mobileNavOpen
          }
          aria-controls="legal-navigation"
          aria-label={
            mobileNavOpen
              ? 'Close legal navigation'
              : 'Open legal navigation'
          }
        >
          {mobileNavOpen ? (
            <X
              size={20}
              aria-hidden="true"
            />
          ) : (
            <Menu
              size={20}
              aria-hidden="true"
            />
          )}

          <span>
            Legal Navigation
          </span>
        </button>
      </div>

      {/* ======================================================================
       * MAIN LAYOUT
       * ==================================================================== */}

      <div className="legal-container">
        {/* ====================================================================
         * SIDEBAR
         * ================================================================== */}

        <aside
          id="legal-navigation"
          className={`legal-sidebar${
            mobileNavOpen
              ? ' mobile-open'
              : ''
          }`}
          aria-label="Legal document navigation"
        >
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
                      {section.links.map(
                        (link) => {
                          const isActive =
                            activeSection ===
                            link.id;

                          return (
                            <a
                              key={link.id}
                              href={`#${link.id}`}
                              className={`nav-link${
                                isActive
                                  ? ' active'
                                  : ''
                              }`}
                              aria-current={
                                isActive
                                  ? 'location'
                                  : undefined
                              }
                              aria-controls={
                                link.id
                              }
                              onClick={(event) =>
                                handleSectionNavigation(
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

          {/* ================================================================
           * SIDEBAR ACTIONS
           * ============================================================ */}

          <div className="legal-nav-actions">
            <Link
              to="/dashboard"
              className="nav-action-link"
              title="Return to Dashboard"
              aria-label="Return to TITech Community Capital Dashboard"
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
              onClick={handlePrint}
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

        {/* ====================================================================
         * LEGAL CONTENT
         * ================================================================== */}

        <main
          ref={contentRef}
          className="legal-content"
          tabIndex={-1}
          aria-labelledby="legal-page-title"
        >
          <article
            className="legal-article"
            data-document-version={
              legalVersion
            }
          >
            {/* ================================================================
             * TERMS OF SERVICE
             * ============================================================ */}

            <section
              className="legal-major-section"
              aria-labelledby="terms-title"
              data-legal-document-id={
                termsDocument?.id ||
                'terms-of-service'
              }
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
                    {termsDocument?.lastModified ||
                      termsDocument?.publishedDate ||
                      termsDocument?.effectiveDate ||
                      PAGE_CONFIG.fallbackLastUpdated}
                  </p>
                </div>
              </div>

              {/* TOS 1 */}
              <section
                id="tos-1"
                className="legal-section"
                aria-labelledby="tos-1-title"
              >
                <h3 id="tos-1-title">
                  1. Acceptance of Terms
                </h3>

                <p>
                  By accessing or using the TITech
                  Community Capital Platform, you
                  acknowledge that you have read,
                  understood, and agree to be bound by
                  these Terms of Service and applicable
                  laws and regulations.
                </p>

                <p>
                  If you do not agree with these Terms,
                  you should discontinue use of the
                  Platform. TITech Community Capital may
                  update these Terms from time to time.
                  Your continued use of the Platform
                  following publication of material
                  changes constitutes acceptance of the
                  revised Terms to the extent permitted
                  by applicable law.
                </p>
              </section>

              {/* TOS 2 */}
              <section
                id="tos-2"
                className="legal-section"
                aria-labelledby="tos-2-title"
              >
                <h3 id="tos-2-title">
                  2. User Rights &amp;
                  Responsibilities
                </h3>

                <p>
                  Subject to these Terms, TITech
                  Community Capital grants you a
                  limited, non-exclusive,
                  non-transferable right to access and
                  use the Platform for lawful purposes.
                </p>

                <h4>
                  User Responsibilities
                </h4>

                <ul>
                  <li>
                    Maintain the confidentiality
                    of your account credentials.
                  </li>

                  <li>
                    Accept responsibility for
                    activity performed through your
                    account.
                  </li>

                  <li>
                    Provide accurate, complete, and
                    current registration
                    information.
                  </li>

                  <li>
                    Comply with applicable laws,
                    regulations, policies, and
                    contractual obligations.
                  </li>

                  <li>
                    Avoid using the Platform for
                    illegal, fraudulent, deceptive,
                    or unauthorized purposes.
                  </li>

                  <li>
                    Keep your contact and account
                    information reasonably current.
                  </li>
                </ul>
              </section>

              {/* TOS 3 */}
              <section
                id="tos-3"
                className="legal-section"
                aria-labelledby="tos-3-title"
              >
                <h3 id="tos-3-title">
                  3. User Conduct
                </h3>

                <p>
                  You agree not to misuse the Platform
                  or interfere with the rights,
                  security, or operation of TITech
                  Community Capital or its users.
                </p>

                <ul>
                  <li>
                    Harass, threaten, intimidate,
                    or deliberately cause distress
                    to another person.
                  </li>

                  <li>
                    Engage in fraud, impersonation,
                    misrepresentation, or deception.
                  </li>

                  <li>
                    Attempt to gain unauthorized
                    access to systems, accounts,
                    APIs, or data.
                  </li>

                  <li>
                    Upload or transmit malicious,
                    harmful, or unlawful content.
                  </li>

                  <li>
                    Infringe intellectual property,
                    privacy, or other legal rights.
                  </li>

                  <li>
                    Interfere with the availability,
                    integrity, or normal operation
                    of the Platform.
                  </li>

                  <li>
                    Send unsolicited commercial
                    messages, spam, or abusive
                    communications.
                  </li>

                  <li>
                    Attempt to reverse engineer,
                    decompile, or otherwise
                    improperly discover protected
                    implementation details.
                  </li>

                  <li>
                    Use the Platform for money
                    laundering, terrorist financing,
                    fraud, or other unlawful
                    financial activity.
                  </li>

                  <li>
                    Engage in unlawful discrimination,
                    harassment, or abusive conduct.
                  </li>
                </ul>
              </section>

              {/* TOS 4 */}
              <section
                id="tos-4"
                className="legal-section"
                aria-labelledby="tos-4-title"
              >
                <h3 id="tos-4-title">
                  4. Payment Terms
                </h3>

                <p>
                  TITech Community Capital may provide
                  technology that facilitates or records
                  financial activity between authorized
                  participants. Specific payment
                  services may also depend on approved
                  payment providers and applicable
                  regulatory requirements.
                </p>

                <h4>
                  Payment Processing
                </h4>

                <ul>
                  <li>
                    Transactions must use
                    authorized payment channels.
                  </li>

                  <li>
                    Payment processing may involve
                    third-party financial or payment
                    service providers.
                  </li>

                  <li>
                    Processing times may vary
                    depending on the selected provider
                    and financial institution.
                  </li>

                  <li>
                    A transaction may fail, be
                    delayed, reversed, rejected, or
                    placed under review.
                  </li>

                  <li>
                    Users may be responsible for
                    fees imposed by their financial
                    institution or payment provider.
                  </li>

                  <li>
                    Transaction records should be
                    reviewed promptly and
                    discrepancies reported through
                    appropriate support channels.
                  </li>
                </ul>

                <h4>
                  Refunds &amp; Reversals
                </h4>

                <ul>
                  <li>
                    Refunds or reversals are subject
                    to the nature of the transaction
                    and applicable provider rules.
                  </li>

                  <li>
                    Certain completed financial
                    transactions may not be
                    reversible.
                  </li>

                  <li>
                    Transaction disputes should be
                    reported as soon as reasonably
                    possible.
                  </li>

                  <li>
                    Resolution may require
                    coordination with a payment
                    provider or financial
                    institution.
                  </li>
                </ul>
              </section>

              {/* TOS 5 */}
              <section
                id="tos-5"
                className="legal-section"
                aria-labelledby="tos-5-title"
              >
                <h3 id="tos-5-title">
                  5. Loan Agreements
                </h3>

                <p>
                  Where the Platform supports
                  community lending, loan arrangements
                  may be established between authorized
                  participants subject to the rules of
                  their group and applicable law.
                </p>

                <ul>
                  <li>
                    Loan terms should be clearly agreed
                    by the relevant parties.
                  </li>

                  <li>
                    Repayment schedules and applicable
                    charges should be documented.
                  </li>

                  <li>
                    TITech Community Capital does not
                    guarantee repayment unless expressly
                    stated in a separate binding
                    agreement.
                  </li>

                  <li>
                    Loan defaults and disputes may
                    require direct resolution between
                    the parties or appropriate legal
                    processes.
                  </li>

                  <li>
                    Users are responsible for
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
                  <strong>
                    Important:
                  </strong>{' '}
                  TITech Community Capital is a
                  technology platform and does not, by
                  itself, constitute a licensed financial
                  institution or provider of personalized
                  financial or legal advice. Obtain
                  appropriate professional advice where
                  necessary.
                </div>
              </section>

              {/* TOS 6 */}
              <section
                id="tos-6"
                className="legal-section"
                aria-labelledby="tos-6-title"
              >
                <h3 id="tos-6-title">
                  6. Limitation of Liability
                </h3>

                <p>
                  To the fullest extent permitted by
                  applicable law, TITech Community
                  Capital will not be liable for
                  indirect, incidental, special,
                  consequential, or punitive damages
                  arising from use of the Platform,
                  including loss of profits, revenue,
                  data, or business opportunities.
                </p>

                <p>
                  Nothing in these Terms excludes or
                  limits liability that cannot lawfully
                  be excluded or limited under
                  applicable law.
                </p>

                <p>
                  Where a limitation of liability is
                  legally enforceable, TITech Community
                  Capital&apos;s aggregate liability will
                  be limited to the maximum extent
                  permitted by applicable law.
                </p>
              </section>
            </section>

            {/* ================================================================
             * PRIVACY POLICY
             * ============================================================ */}

            <section
              className="legal-major-section"
              aria-labelledby="privacy-title"
              data-legal-document-id={
                privacyDocument?.id ||
                'privacy-policy'
              }
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
                    {privacyDocument?.lastModified ||
                      privacyDocument?.publishedDate ||
                      privacyDocument?.effectiveDate ||
                      PAGE_CONFIG.fallbackLastUpdated}
                  </p>
                </div>
              </div>

              {/* PP 1 */}
              <section
                id="pp-1"
                className="legal-section"
                aria-labelledby="pp-1-title"
              >
                <h3 id="pp-1-title">
                  1. Information We Collect
                </h3>

                <p>
                  We collect information necessary to
                  operate the TITech Community Capital
                  Platform, provide requested services,
                  maintain security, and comply with
                  applicable legal obligations.
                </p>

                <h4>
                  Information You Provide
                </h4>

                <ul>
                  <li>
                    Name and contact information.
                  </li>

                  <li>
                    Phone number and address
                    information.
                  </li>

                  <li>
                    Identification and verification
                    information where required.
                  </li>

                  <li>
                    Financial and transaction-related
                    information necessary to provide
                    requested services.
                  </li>

                  <li>
                    Profile and account information
                    you choose to provide.
                  </li>
                </ul>

                <h4>
                  Automatically Collected
                  Information
                </h4>

                <ul>
                  <li>
                    Device type, operating system,
                    browser, and application
                    information.
                  </li>

                  <li>
                    IP address, timestamps, access
                    records, and technical logs.
                  </li>

                  <li>
                    Security and fraud-prevention
                    signals.
                  </li>

                  <li>
                    Cookies and similar technologies
                    where applicable.
                  </li>

                  <li>
                    Location information where
                    enabled and permitted.
                  </li>
                </ul>
              </section>

              {/* PP 2 */}
              <section
                id="pp-2"
                className="legal-section"
                aria-labelledby="pp-2-title"
              >
                <h3 id="pp-2-title">
                  2. How We Use Information
                </h3>

                <p>
                  We may use collected information to:
                </p>

                <ul>
                  <li>
                    Provide, operate, maintain, and
                    improve the Platform.
                  </li>

                  <li>
                    Authenticate users and manage
                    accounts.
                  </li>

                  <li>
                    Process, record, reconcile, and
                    communicate transaction
                    information.
                  </li>

                  <li>
                    Detect, investigate, and prevent
                    fraud, abuse, unauthorized
                    activity, and security incidents.
                  </li>

                  <li>
                    Provide customer support and
                    respond to inquiries.
                  </li>

                  <li>
                    Send service communications and,
                    where legally permitted,
                    promotional communications.
                  </li>

                  <li>
                    Meet legal, regulatory,
                    accounting, and compliance
                    obligations.
                  </li>

                  <li>
                    Analyze system performance and
                    improve reliability and user
                    experience.
                  </li>
                </ul>
              </section>

              {/* PP 3 */}
              <section
                id="pp-3"
                className="legal-section"
                aria-labelledby="pp-3-title"
              >
                <h3 id="pp-3-title">
                  3. Data Security
                </h3>

                <p>
                  TITech Community Capital maintains
                  technical and organizational safeguards
                  designed to protect personal
                  information against unauthorized
                  access, alteration, disclosure,
                  destruction, and misuse.
                </p>

                <ul>
                  <li>
                    Encryption for sensitive data in
                    transit.
                  </li>

                  <li>
                    Secure credential storage and
                    authentication controls.
                  </li>

                  <li>
                    Access controls based on
                    operational requirements and
                    authorization.
                  </li>

                  <li>
                    Security monitoring and audit
                    logging.
                  </li>

                  <li>
                    Backup and recovery controls
                    appropriate to the service.
                  </li>

                  <li>
                    Security testing and vulnerability
                    management processes.
                  </li>
                </ul>

                <p>
                  No internet-based service can
                  guarantee absolute security. Users
                  should also protect their credentials
                  and promptly report suspected
                  unauthorized activity.
                </p>
              </section>

              {/* PP 4 */}
              <section
                id="pp-4"
                className="legal-section"
                aria-labelledby="pp-4-title"
              >
                <h3 id="pp-4-title">
                  4. Your Privacy Rights
                </h3>

                <p>
                  Depending on applicable law and your
                  location, you may have rights
                  concerning your personal information,
                  including:
                </p>

                <ul>
                  <li>
                    <strong>
                      Access:
                    </strong>{' '}
                    Request access to personal
                    information we hold about you.
                  </li>

                  <li>
                    <strong>
                      Rectification:
                    </strong>{' '}
                    Request correction of inaccurate
                    or incomplete information.
                  </li>

                  <li>
                    <strong>
                      Erasure:
                    </strong>{' '}
                    Request deletion where legally
                    permitted.
                  </li>

                  <li>
                    <strong>
                      Restriction:
                    </strong>{' '}
                    Request restriction of certain
                    processing activities where
                    applicable.
                  </li>

                  <li>
                    <strong>
                      Portability:
                    </strong>{' '}
                    Request applicable personal
                    information in a portable format.
                  </li>

                  <li>
                    <strong>
                      Withdrawal of Consent:
                    </strong>{' '}
                    Withdraw consent where processing
                    relies on consent.
                  </li>

                  <li>
                    <strong>
                      Complaint:
                    </strong>{' '}
                    Lodge a complaint with the relevant
                    data protection authority.
                  </li>
                </ul>

                <p>
                  Some rights are subject to legal,
                  regulatory, contractual, security, and
                  operational limitations.
                </p>
              </section>

              {/* PP 5 */}
              <section
                id="pp-5"
                className="legal-section"
                aria-labelledby="pp-5-title"
              >
                <h3 id="pp-5-title">
                  5. Cookies &amp; Tracking
                </h3>

                <p>
                  The Platform may use cookies and
                  related technologies to support
                  functionality, security, preferences,
                  analytics, and service performance.
                </p>

                <h4>
                  Potential Cookie Categories
                </h4>

                <ul>
                  <li>
                    <strong>
                      Essential:
                    </strong>{' '}
                    Required for functionality,
                    authentication, and security.
                  </li>

                  <li>
                    <strong>
                      Performance:
                    </strong>{' '}
                    Used to understand service
                    performance and usage.
                  </li>

                  <li>
                    <strong>
                      Functional:
                    </strong>{' '}
                    Used to remember preferences and
                    settings.
                  </li>

                  <li>
                    <strong>
                      Marketing:
                    </strong>{' '}
                    Where applicable and permitted,
                    used for relevant communications
                    and measurement.
                  </li>
                </ul>

                <p>
                  Browser settings can be used to
                  manage certain cookies. Disabling
                  essential technologies may affect
                  Platform functionality.
                </p>
              </section>

              {/* PP 6 */}
              <section
                id="pp-6"
                className="legal-section"
                aria-labelledby="pp-6-title"
              >
                <h3 id="pp-6-title">
                  6. Third-Party Services
                </h3>

                <p>
                  TITech Community Capital may work
                  with carefully selected third-party
                  providers that support Platform
                  operations.
                </p>

                <ul>
                  <li>
                    Payment and financial service
                    providers.
                  </li>

                  <li>
                    Cloud hosting and infrastructure
                    providers.
                  </li>

                  <li>
                    Security, monitoring, and
                    observability services.
                  </li>

                  <li>
                    Email and communications
                    providers.
                  </li>

                  <li>
                    Customer support and operational
                    services.
                  </li>
                </ul>

                <p>
                  Third-party providers may process
                  information on our behalf subject to
                  applicable agreements, security
                  requirements, and legal obligations.
                  TITech Community Capital does not sell
                  personal information as a business
                  model.
                </p>
              </section>
            </section>

            {/* ================================================================
             * DISCLAIMER
             * ============================================================ */}

            <section
              className="legal-major-section"
              aria-labelledby="disclaimer-title"
              data-legal-document-id={
                disclaimerDocument?.id ||
                'general-disclaimer'
              }
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
                    {disclaimerDocument?.lastModified ||
                      disclaimerDocument?.publishedDate ||
                      disclaimerDocument?.effectiveDate ||
                      PAGE_CONFIG.fallbackLastUpdated}
                  </p>
                </div>
              </div>

              {/* General Disclaimer */}
              <section
                id="disclaimer"
                className="legal-section"
                aria-labelledby="general-disclaimer-title"
              >
                <h3 id="general-disclaimer-title">
                  General Disclaimer
                </h3>

                <p>
                  The TITech Community Capital Platform
                  is provided on an “as-is” and
                  “as-available” basis to the fullest
                  extent permitted by applicable law.
                </p>

                <h4>
                  Warranty Disclaimers
                </h4>

                <ul>
                  <li>
                    We do not guarantee uninterrupted
                    or error-free availability.
                  </li>

                  <li>
                    We do not guarantee that all
                    defects will be corrected
                    immediately.
                  </li>

                  <li>
                    We do not guarantee specific
                    outcomes from use of the Platform.
                  </li>

                  <li>
                    Third-party services and content
                    may be subject to separate terms
                    and risks.
                  </li>

                  <li>
                    Users remain responsible for
                    decisions made using Platform
                    information.
                  </li>
                </ul>
              </section>

              {/* Financial Disclaimer */}
              <section
                id="financial-disclaimer"
                className="legal-section"
                aria-labelledby="financial-disclaimer-title"
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
                  TITech Community Capital is a
                  technology platform and does not
                  provide personalized financial,
                  investment, tax, or legal advice unless
                  expressly stated under a separate
                  authorized service.
                </div>

                <h4>
                  Key Points
                </h4>

                <ul>
                  <li>
                    Financial activity may involve
                    risks, including payment failure,
                    delays, fraud, disputes, and
                    counterparty default.
                  </li>

                  <li>
                    Users should independently assess
                    the risks associated with savings,
                    lending, borrowing, and other
                    financial activity.
                  </li>

                  <li>
                    TITech Community Capital does not
                    guarantee the creditworthiness,
                    reliability, or performance of
                    another participant.
                  </li>

                  <li>
                    Users should seek qualified
                    professional advice where financial
                    or legal advice is required.
                  </li>

                  <li>
                    Financial arrangements must comply
                    with applicable laws and
                    regulations.
                  </li>

                  <li>
                    Users remain responsible for
                    applicable tax, reporting, and
                    regulatory obligations.
                  </li>
                </ul>
              </section>

              {/* Contact Legal */}
              <section
                id="contact-legal"
                className="legal-section"
                aria-labelledby="contact-legal-title"
              >
                <h3 id="contact-legal-title">
                  Contact Legal
                </h3>

                <p>
                  If you have questions regarding these
                  documents, privacy practices, or
                  applicable user rights, please contact
                  the TITech Community Capital legal team
                  through the organization&apos;s approved
                  contact channels.
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
                      href={`mailto:${PAGE_CONFIG.legalEmail}`}
                    >
                      {PAGE_CONFIG.legalEmail}
                    </a>
                  </p>

                  <p>
                    <strong>
                      Phone:
                    </strong>{' '}
                    <a
                      href={`tel:${PAGE_CONFIG.phoneUri}`}
                    >
                      {PAGE_CONFIG.phoneDisplay}
                    </a>
                  </p>

                  <p>
                    <strong>
                      Address:
                    </strong>{' '}
                    {PAGE_CONFIG.address}
                  </p>

                  <p>
                    <strong>
                      Target response time:
                    </strong>{' '}
                    We aim to respond to legal and
                    privacy inquiries within{' '}
                    {PAGE_CONFIG.responseTime},
                    subject to complexity, verification
                    requirements, and applicable law.
                  </p>
                </div>
              </section>
            </section>

            {/* ================================================================
             * DOCUMENT FOOTER
             * ============================================================ */}

            <footer
              className="legal-footer-note"
              aria-label="Legal document footer"
            >
              <p>
                <strong>
                  Last Updated:
                </strong>{' '}
                {legalLastUpdated}{' '}
                <span aria-hidden="true">
                  |
                </span>{' '}
                <strong>
                  Version:
                </strong>{' '}
                {legalVersion}
              </p>

              <p>
                These documents may be updated from time
                to time to reflect changes in the Platform,
                applicable law, regulatory requirements,
                security practices, or business
                operations. Users should review this page
                periodically for updates.
              </p>

              <p className="legal-footer-brand">
                © {new Date().getFullYear()}{' '}
                {PAGE_CONFIG.organizationName}.
                {' '}
                All rights reserved.
              </p>
            </footer>
          </article>

          {/* ================================================================
           * SCROLL TO TOP
           * ============================================================ */}

          {showScrollTop && (
            <button
              type="button"
              className="scroll-top-btn"
              onClick={scrollToTop}
              aria-label="Scroll to top of legal documents"
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
    </div>
  );
};

export default Legal;