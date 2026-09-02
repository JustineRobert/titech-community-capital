// ============================================================================
// TITech Community Capital LTD
// Enterprise Legal Documents
// File: frontend/src/components/LegalDocuments.jsx
// Production Grade
// ============================================================================
//
// Purpose
// ----------------------------------------------------------------------------
// Centralized, reusable legal-document presentation component for TITech
// Community Capital.
//
// Responsibilities
// ----------------------------------------------------------------------------
// ✓ Terms and conditions
// ✓ Privacy policy
// ✓ Cookie policy
// ✓ Acceptable use policy
// ✓ KYC / AML policy
// ✓ Data protection information
// ✓ Complaints / dispute information
// ✓ Regulatory / compliance documents
// ✓ Document search
// ✓ Category filtering
// ✓ Document status
// ✓ Version metadata
// ✓ Effective-date metadata
// ✓ Internal React Router navigation
// ✓ Safe external navigation
// ✓ Loading state
// ✓ Error state
// ✓ Empty state
// ✓ Accessibility
// ✓ Defensive API/configuration normalization
// ✓ Stable test selectors
// ✓ TITech branding consistency
//
// Security Boundary
// ----------------------------------------------------------------------------
// This component is presentation-only.
//
// It MUST NOT be treated as:
// - a legal authorization boundary;
// - a tenant-isolation boundary;
// - a KYC/AML decision engine;
// - a regulatory compliance engine;
// - a document-signature authority;
// - an accounting or financial authorization boundary.
//
// The authoritative legal-document content, publication state, version,
// effective date and jurisdiction must be controlled by the backend/content
// management layer and appropriate legal/compliance governance.
//
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";
import { Link } from "react-router-dom";

import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Cookie,
  ExternalLink,
  FileCheck2,
  FileText,
  Gavel,
  Info,
  LockKeyhole,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

import "./LegalDocuments.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_ID =
  "titech-legal-documents";

const DEFAULT_TITLE =
  "Legal & compliance";

const DEFAULT_DESCRIPTION =
  "Review the policies, terms, and legal information that govern your use of TITech Community Capital.";

const DEFAULT_EMPTY_LABEL =
  "No legal documents found.";

const DEFAULT_ERROR_MESSAGE =
  "Legal documents are temporarily unavailable. Please try again later.";

const DEFAULT_SEARCH_PLACEHOLDER =
  "Search legal documents...";

const DEFAULT_DOCUMENT_LIMIT =
  100;

const CATEGORY = Object.freeze({
  ALL: "all",
  TERMS: "terms",
  PRIVACY: "privacy",
  COOKIES: "cookies",
  SECURITY: "security",
  COMPLIANCE: "compliance",
  DATA_PROTECTION: "data-protection",
  ACCEPTABLE_USE: "acceptable-use",
  COMPLAINTS: "complaints",
  OTHER: "other",
});

const STATUS = Object.freeze({
  CURRENT: "current",
  DRAFT: "draft",
  ARCHIVED: "archived",
  PENDING: "pending",
});

const DEFAULT_CATEGORIES = Object.freeze([
  {
    id: CATEGORY.ALL,
    label: "All documents",
    icon: BookOpen,
  },
  {
    id: CATEGORY.TERMS,
    label: "Terms",
    icon: Gavel,
  },
  {
    id: CATEGORY.PRIVACY,
    label: "Privacy",
    icon: LockKeyhole,
  },
  {
    id: CATEGORY.COOKIES,
    label: "Cookies",
    icon: Cookie,
  },
  {
    id: CATEGORY.SECURITY,
    label: "Security",
    icon: ShieldCheck,
  },
  {
    id: CATEGORY.COMPLIANCE,
    label: "Compliance",
    icon: FileCheck2,
  },
  {
    id: CATEGORY.DATA_PROTECTION,
    label: "Data protection",
    icon: LockKeyhole,
  },
  {
    id: CATEGORY.ACCEPTABLE_USE,
    label: "Acceptable use",
    icon: Users,
  },
  {
    id: CATEGORY.COMPLAINTS,
    label: "Complaints",
    icon: Info,
  },
]);

const DEFAULT_DOCUMENTS = Object.freeze([
  {
    id: "terms-of-service",
    title: "Terms of Service",
    description:
      "The terms and conditions governing access to and use of TITech Community Capital services.",
    category: CATEGORY.TERMS,
    href: "/legal/terms",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: Gavel,
    external: false,
  },
  {
    id: "privacy-policy",
    title: "Privacy Policy",
    description:
      "Information about how TITech collects, uses, protects, retains, and handles personal information.",
    category: CATEGORY.PRIVACY,
    href: "/legal/privacy",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: LockKeyhole,
    external: false,
  },
  {
    id: "cookie-policy",
    title: "Cookie Policy",
    description:
      "Information about cookies, local storage technologies, analytics, and related preferences.",
    category: CATEGORY.COOKIES,
    href: "/legal/cookies",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: Cookie,
    external: false,
  },
  {
    id: "security-policy",
    title: "Security Policy",
    description:
      "An overview of TITech's security practices, responsible disclosure guidance, and security expectations.",
    category: CATEGORY.SECURITY,
    href: "/legal/security",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: ShieldCheck,
    external: false,
  },
  {
    id: "kyc-aml-policy",
    title: "KYC & AML Policy",
    description:
      "Information concerning applicable customer verification, financial crime prevention, and compliance processes.",
    category: CATEGORY.COMPLIANCE,
    href: "/legal/kyc-aml",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: FileCheck2,
    external: false,
  },
  {
    id: "data-protection",
    title: "Data Protection Notice",
    description:
      "Additional information about personal-data handling, data rights, retention, and protection responsibilities.",
    category: CATEGORY.DATA_PROTECTION,
    href: "/legal/data-protection",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: LockKeyhole,
    external: false,
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use Policy",
    description:
      "Rules and expectations for responsible, lawful, and secure use of TITech services.",
    category: CATEGORY.ACCEPTABLE_USE,
    href: "/legal/acceptable-use",
    status: STATUS.CURRENT,
    version: "1.0",
    effectiveDate: null,
    updatedAt: null,
    icon: Users,
    external: false,
  },
]);

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeString(
  value,
  fallback = "",
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    const normalized =
      String(value).trim();

    return normalized || fallback;
  } catch {
    return fallback;
  }
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function normalizeCategory(value) {
  const normalized =
    normalizeString(
      value,
      CATEGORY.ALL,
    ).toLowerCase();

  return Object.values(
    CATEGORY,
  ).includes(normalized)
    ? normalized
    : CATEGORY.OTHER;
}

function normalizeStatus(value) {
  const normalized =
    normalizeString(
      value,
      STATUS.CURRENT,
    ).toLowerCase();

  return Object.values(
    STATUS,
  ).includes(normalized)
    ? normalized
    : STATUS.CURRENT;
}

function normalizeId(
  value,
  fallback,
) {
  const normalized =
    normalizeString(value);

  return normalized || fallback;
}

function normalizeDocument(
  document,
  index,
) {
  if (
    !document ||
    typeof document !== "object"
  ) {
    return null;
  }

  const title =
    normalizeString(
      document.title ??
        document.name ??
        document.label,
    );

  if (!title) {
    return null;
  }

  const href =
    normalizeString(
      document.href ??
        document.url ??
        document.path ??
        document.to,
    );

  if (!href) {
    return null;
  }

  const explicitExternal =
    document.external ??
    document.isExternal;

  const external =
    typeof explicitExternal ===
    "boolean"
      ? explicitExternal
      : /^(https?:|mailto:|tel:)/i.test(
          href,
        );

  return {
    ...document,

    id: normalizeId(
      document.id ??
        document._id ??
        document.documentId,
      `legal-document-${index + 1}`,
    ),

    title,

    description:
      normalizeString(
        document.description ??
          document.summary ??
          document.subtitle,
      ),

    category:
      normalizeCategory(
        document.category ??
          document.type,
      ),

    href,

    status:
      normalizeStatus(
        document.status ??
          document.state,
      ),

    version:
      normalizeString(
        document.version ??
          document.versionNumber,
      ),

    effectiveDate:
      document.effectiveDate ??
      document.effectiveFrom ??
      null,

    updatedAt:
      document.updatedAt ??
      document.lastUpdated ??
      null,

    jurisdiction:
      normalizeString(
        document.jurisdiction,
      ),

    icon:
      document.icon ||
      FileText,

    external,
  };
}

function normalizeDate(
  value,
  locale = "en-UG",
) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(
      locale,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
      },
    ).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

function matchesSearch(
  document,
  query,
) {
  const normalizedQuery =
    normalizeString(
      query,
    ).toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    document.title,
    document.description,
    document.category,
    document.status,
    document.version,
    document.jurisdiction,
    ...(Array.isArray(
      document.tags,
    )
      ? document.tags
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchableText.includes(
    normalizedQuery,
  );
}

function getCategoryLabel(
  category,
) {
  const normalized =
    normalizeCategory(category);

  const match =
    DEFAULT_CATEGORIES.find(
      (item) =>
        item.id === normalized,
    );

  if (match) {
    return match.label;
  }

  return normalized
    .replace(/-/g, " ")
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

function getStatusLabel(
  status,
) {
  switch (
    normalizeStatus(status)
  ) {
    case STATUS.CURRENT:
      return "Current";

    case STATUS.DRAFT:
      return "Draft";

    case STATUS.ARCHIVED:
      return "Archived";

    case STATUS.PENDING:
      return "Pending";

    default:
      return "Current";
  }
}

// ============================================================================
// Search
// ============================================================================

const LegalDocumentSearch = memo(
  function LegalDocumentSearch({
    value,
    onChange,
    onClear,
    resultCount,
    placeholder,
    testId,
  }) {
    const hasValue =
      Boolean(
        normalizeString(value),
      );

    return (
      <div
        className="legal-documents-search"
        role="search"
        data-testid={`${testId}-search`}
      >
        <label
          className="sr-only"
          htmlFor={`${testId}-search-input`}
        >
          Search TITech legal documents
        </label>

        <Search
          className="legal-documents-search-icon"
          size={19}
          aria-hidden="true"
          focusable="false"
        />

        <input
          id={`${testId}-search-input`}
          className="legal-documents-search-input"
          type="search"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck="false"
          aria-describedby={`${testId}-search-results`}
          data-testid={`${testId}-search-input`}
        />

        {hasValue ? (
          <button
            type="button"
            className="legal-documents-search-clear"
            onClick={onClear}
            aria-label="Clear legal document search"
            title="Clear search"
            data-testid={`${testId}-search-clear`}
          >
            <X
              size={17}
              aria-hidden="true"
              focusable="false"
            />
          </button>
        ) : null}

        <span
          id={`${testId}-search-results`}
          className="legal-documents-search-count"
          aria-live="polite"
        >
          {resultCount}{" "}
          {resultCount === 1
            ? "document"
            : "documents"}
        </span>
      </div>
    );
  },
);

LegalDocumentSearch.displayName =
  "TITechLegalDocumentSearch";

// ============================================================================
// Category Navigation
// ============================================================================

const CategoryNavigation = memo(
  function CategoryNavigation({
    categories,
    selectedCategory,
    onSelect,
    testId,
  }) {
    return (
      <nav
        className="legal-documents-categories"
        aria-label="Legal document categories"
        data-testid={`${testId}-categories`}
      >
        <ul className="legal-documents-category-list">
          {categories.map(
            (category) => {
              const Icon =
                category.icon ||
                FileText;

              const isActive =
                category.id ===
                selectedCategory;

              return (
                <li
                  key={category.id}
                >
                  <button
                    type="button"
                    className={[
                      "legal-documents-category-button",
                      isActive
                        ? "is-active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-current={
                      isActive
                        ? "page"
                        : undefined
                    }
                    onClick={() =>
                      onSelect(
                        category.id,
                      )
                    }
                    data-category={
                      category.id
                    }
                    data-testid={`${testId}-category-${category.id}`}
                  >
                    <Icon
                      size={17}
                      aria-hidden="true"
                      focusable="false"
                    />

                    <span>
                      {
                        category.label
                      }
                    </span>

                    {isActive ? (
                      <ChevronRight
                        size={15}
                        aria-hidden="true"
                        focusable="false"
                      />
                    ) : null}
                  </button>
                </li>
              );
            },
          )}
        </ul>
      </nav>
    );
  },
);

CategoryNavigation.displayName =
  "TITechLegalCategoryNavigation";

// ============================================================================
// Status Badge
// ============================================================================

const DocumentStatus = memo(
  function DocumentStatus({
    status,
  }) {
    const normalized =
      normalizeStatus(status);

    return (
      <span
        className={[
          "legal-documents-status",
          `legal-documents-status--${normalized}`,
        ].join(" ")}
        data-status={normalized}
      >
        {normalized ===
        STATUS.CURRENT ? (
          <CheckCircle2
            size={13}
            aria-hidden="true"
            focusable="false"
          />
        ) : null}

        <span>
          {getStatusLabel(
            normalized,
          )}
        </span>
      </span>
    );
  },
);

DocumentStatus.displayName =
  "TITechLegalDocumentStatus";

// ============================================================================
// Legal Document Card
// ============================================================================

const LegalDocumentCard = memo(
  function LegalDocumentCard({
    document,
    locale,
    testId,
  }) {
    const Icon =
      document.icon ||
      FileText;

    const effectiveDate =
      normalizeDate(
        document.effectiveDate,
        locale,
      );

    const updatedAt =
      normalizeDate(
        document.updatedAt,
        locale,
      );

    const isArchived =
      document.status ===
      STATUS.ARCHIVED;

    const linkLabel = document.external
      ? `Open ${document.title} in a new window`
      : `Read ${document.title}`;

    const metadata = [];

    if (document.version) {
      metadata.push(
        `Version ${document.version}`,
      );
    }

    if (effectiveDate) {
      metadata.push(
        `Effective ${effectiveDate}`,
      );
    }

    return (
      <article
        className={[
          "legal-document-card",
          isArchived
            ? "legal-document-card--archived"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`${testId}-document-${document.id}`}
        data-document-id={
          document.id
        }
        data-status={
          document.status
        }
      >
        <div className="legal-document-card-icon">
          <Icon
            size={22}
            aria-hidden="true"
            focusable="false"
          />
        </div>

        <div className="legal-document-card-content">
          <div className="legal-document-card-topline">
            <span className="legal-document-card-category">
              {getCategoryLabel(
                document.category,
              )}
            </span>

            <DocumentStatus
              status={
                document.status
              }
            />
          </div>

          <h3 className="legal-document-card-title">
            {document.external ? (
              <a
                href={document.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={
                  linkLabel
                }
                data-testid={`${testId}-document-link-${document.id}`}
              >
                {document.title}
                <ExternalLink
                  size={16}
                  aria-hidden="true"
                  focusable="false"
                />
              </a>
            ) : (
              <Link
                to={document.href}
                aria-label={
                  linkLabel
                }
                data-testid={`${testId}-document-link-${document.id}`}
              >
                {document.title}
              </Link>
            )}
          </h3>

          {document.description ? (
            <p className="legal-document-card-description">
              {
                document.description
              }
            </p>
          ) : null}

          {metadata.length >
          0 ? (
            <div
              className="legal-document-card-meta"
              aria-label="Document metadata"
            >
              {metadata.map(
                (item) => (
                  <span
                    key={item}
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
          ) : null}

          {document.jurisdiction ? (
            <div className="legal-document-card-jurisdiction">
              <span>
                Jurisdiction:
              </span>{" "}
              <strong>
                {
                  document.jurisdiction
                }
              </strong>
            </div>
          ) : null}

          <div className="legal-document-card-actions">
            {document.external ? (
              <a
                href={document.href}
                target="_blank"
                rel="noopener noreferrer"
                className="legal-document-card-link"
              >
                <span>
                  Open document
                </span>

                <ExternalLink
                  size={15}
                  aria-hidden="true"
                  focusable="false"
                />
              </a>
            ) : (
              <Link
                to={document.href}
                className="legal-document-card-link"
              >
                <span>
                  Read document
                </span>

                <ArrowRight
                  size={15}
                  aria-hidden="true"
                  focusable="false"
                />
              </Link>
            )}

            {updatedAt ? (
              <span className="legal-document-card-updated">
                Updated{" "}
                {updatedAt}
              </span>
            ) : null}
          </div>
        </div>
      </article>
    );
  },
);

LegalDocumentCard.displayName =
  "TITechLegalDocumentCard";

// ============================================================================
// Main Component
// ============================================================================

function LegalDocuments({
  documents = DEFAULT_DOCUMENTS,
  categories = DEFAULT_CATEGORIES,

  title = DEFAULT_TITLE,

  description =
    DEFAULT_DESCRIPTION,

  initialCategory =
    CATEGORY.ALL,

  showSearch = true,

  showCategories = true,

  showStatus = true,

  showMetadata = true,

  loading = false,

  error = false,

  errorMessage =
    DEFAULT_ERROR_MESSAGE,

  emptyLabel =
    DEFAULT_EMPTY_LABEL,

  locale = "en-UG",

  className = "",

  testId =
    DEFAULT_TEST_ID,

  onDocumentSelect,

  onRetry,
}) {
  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState(
    normalizeCategory(
      initialCategory,
    ),
  );

  const normalizedDocuments =
    useMemo(
      () =>
        normalizeArray(
          documents,
        )
          .slice(
            0,
            DEFAULT_DOCUMENT_LIMIT,
          )
          .map(
            normalizeDocument,
          )
          .filter(Boolean),
      [documents],
    );

  const normalizedCategories =
    useMemo(() => {
      const source =
        normalizeArray(
          categories,
        );

      if (
        source.length === 0
      ) {
        return DEFAULT_CATEGORIES;
      }

      const normalized =
        source
          .map(
            (category) => {
              if (
                typeof category ===
                "string"
              ) {
                const id =
                  normalizeCategory(
                    category,
                  );

                return {
                  id,
                  label:
                    getCategoryLabel(
                      id,
                    ),
                  icon: FileText,
                };
              }

              const id =
                normalizeCategory(
                  category.id ??
                    category.value,
                );

              return {
                ...category,
                id,
                label:
                  normalizeString(
                    category.label ??
                      category.name,
                    getCategoryLabel(
                      id,
                    ),
                  ),
                icon:
                  category.icon ||
                  FileText,
              };
            },
          )
          .filter(
            (category) =>
              Boolean(
                category.id,
              ),
          );

      return normalized.length > 0
        ? normalized
        : DEFAULT_CATEGORIES;
    }, [categories]);

  const filteredDocuments =
    useMemo(
      () =>
        normalizedDocuments.filter(
          (document) => {
            const categoryMatches =
              selectedCategory ===
                CATEGORY.ALL ||
              document.category ===
                selectedCategory;

            return (
              categoryMatches &&
              matchesSearch(
                document,
                searchQuery,
              )
            );
          },
        ),
      [
        normalizedDocuments,
        selectedCategory,
        searchQuery,
      ],
    );

  const handleSearchChange =
    useCallback(
      (event) => {
        setSearchQuery(
          event.target.value,
        );
      },
      [],
    );

  const handleClearSearch =
    useCallback(() => {
      setSearchQuery("");
    }, []);

  const handleCategorySelect =
    useCallback(
      (category) => {
        setSelectedCategory(
          normalizeCategory(
            category,
          ),
        );
      },
      [],
    );

  const handleClearFilters =
    useCallback(() => {
      setSearchQuery("");
      setSelectedCategory(
        CATEGORY.ALL,
      );
    }, []);

  const handleDocumentClick =
    useCallback(
      (document) => {
        if (
          typeof onDocumentSelect ===
          "function"
        ) {
          onDocumentSelect(
            document,
          );
        }
      },
      [onDocumentSelect],
    );

  const hasSearch =
    Boolean(
      normalizeString(
        searchQuery,
      ),
    );

  const hasCategoryFilter =
    selectedCategory !==
    CATEGORY.ALL;

  const hasResults =
    filteredDocuments.length > 0;

  const rootClassName = [
    "legal-documents",
    loading
      ? "legal-documents--loading"
      : "",
    error
      ? "legal-documents--error"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // ==========================================================================
  // Loading State
  // ==========================================================================

  if (loading) {
    return (
      <main
        className={rootClassName}
        data-testid={testId}
        data-component="titech-legal-documents"
        data-state="loading"
        aria-busy="true"
        aria-label="Loading legal documents"
      >
        <header className="legal-documents-header">
          <div className="legal-documents-header-icon">
            <FileText
              size={28}
              aria-hidden="true"
              focusable="false"
            />
          </div>

          <div>
            <p className="legal-documents-eyebrow">
              TITech Legal
            </p>

            <h1>{title}</h1>

            <p className="legal-documents-description">
              {description}
            </p>
          </div>
        </header>

        <section
          className="legal-documents-loading"
          aria-label="Loading legal documents"
        >
          {[
            "one",
            "two",
            "three",
            "four",
          ].map((item) => (
            <div
              key={item}
              className="legal-documents-skeleton"
              aria-hidden="true"
            >
              <span className="legal-documents-skeleton-icon" />

              <div className="legal-documents-skeleton-content">
                <span className="legal-documents-skeleton-line legal-documents-skeleton-line--small" />
                <span className="legal-documents-skeleton-line legal-documents-skeleton-line--title" />
                <span className="legal-documents-skeleton-line legal-documents-skeleton-line--description" />
              </div>
            </div>
          ))}
        </section>
      </main>
    );
  }

  // ==========================================================================
  // Error State
  // ==========================================================================

  if (error) {
    return (
      <main
        className={rootClassName}
        data-testid={testId}
        data-component="titech-legal-documents"
        data-state="error"
        aria-live="polite"
      >
        <section
          className="legal-documents-state"
          role="alert"
        >
          <div className="legal-documents-state-icon legal-documents-state-icon--error">
            <AlertCircle
              size={25}
              aria-hidden="true"
              focusable="false"
            />
          </div>

          <p className="legal-documents-eyebrow">
            TITech Legal
          </p>

          <h1>
            Legal information
          </h1>

          <p>
            {normalizeString(
              errorMessage,
              DEFAULT_ERROR_MESSAGE,
            )}
          </p>

          {typeof onRetry ===
          "function" ? (
            <button
              type="button"
              className="legal-documents-retry-button"
              onClick={onRetry}
              data-testid={`${testId}-retry`}
            >
              Try again
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  // ==========================================================================
  // Main Content
  // ==========================================================================

  return (
    <main
      className={rootClassName}
      data-testid={testId}
      data-component="titech-legal-documents"
      data-state="ready"
    >
      {/* ======================================================================
          Header
          ==================================================================== */}

      <header className="legal-documents-header">
        <div className="legal-documents-header-icon">
          <FileText
            size={28}
            aria-hidden="true"
            focusable="false"
          />
        </div>

        <div className="legal-documents-header-content">
          <p className="legal-documents-eyebrow">
            TITech Legal & Compliance
          </p>

          <h1>{title}</h1>

          <p className="legal-documents-description">
            {description}
          </p>
        </div>
      </header>

      {/* ======================================================================
          Search
          ==================================================================== */}

      {showSearch ? (
        <LegalDocumentSearch
          value={searchQuery}
          onChange={
            handleSearchChange
          }
          onClear={
            handleClearSearch
          }
          resultCount={
            filteredDocuments.length
          }
          placeholder={
            DEFAULT_SEARCH_PLACEHOLDER
          }
          testId={testId}
        />
      ) : null}

      {/* ======================================================================
          Layout
          ==================================================================== */}

      <div className="legal-documents-layout">
        {showCategories ? (
          <aside
            className="legal-documents-sidebar"
            aria-label="Legal document navigation"
          >
            <div className="legal-documents-sidebar-heading">
              Browse legal information
            </div>

            <CategoryNavigation
              categories={
                normalizedCategories
              }
              selectedCategory={
                selectedCategory
              }
              onSelect={
                handleCategorySelect
              }
              testId={testId}
            />
          </aside>
        ) : null}

        <section
          className="legal-documents-content"
          aria-labelledby={`${testId}-results-title`}
        >
          {/* ================================================================
              Filter Summary
              ================================================================ */}

          {(hasSearch ||
            hasCategoryFilter) ? (
            <div
              className="legal-documents-filter-summary"
              aria-live="polite"
            >
              <div>
                <strong>
                  {
                    filteredDocuments.length
                  }
                </strong>{" "}
                {filteredDocuments.length ===
                1
                  ? "document"
                  : "documents"}{" "}
                found
              </div>

              <button
                type="button"
                className="legal-documents-clear-filters"
                onClick={
                  handleClearFilters
                }
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {/* ================================================================
              Results Heading
              ================================================================ */}

          <div className="legal-documents-section-heading">
            <div>
              <p className="legal-documents-section-eyebrow">
                Official information
              </p>

              <h2
                id={`${testId}-results-title`}
              >
                Legal documents
              </h2>
            </div>

            <span className="legal-documents-count">
              {
                filteredDocuments.length
              }
            </span>
          </div>

          {/* ================================================================
              Documents
              ================================================================ */}

          {hasResults ? (
            <div className="legal-documents-grid">
              {filteredDocuments.map(
                (document) => (
                  <div
                    key={
                      document.id
                    }
                    onClick={() =>
                      handleDocumentClick(
                        document,
                      )
                    }
                    onKeyDown={(
                      event,
                    ) => {
                      if (
                        event.key ===
                          "Enter" ||
                        event.key ===
                          " "
                      ) {
                        handleDocumentClick(
                          document,
                        );
                      }
                    }}
                  >
                    <LegalDocumentCard
                      document={
                        document
                      }
                      locale={
                        locale
                      }
                      showStatus={
                        showStatus
                      }
                      showMetadata={
                        showMetadata
                      }
                      testId={
                        testId
                      }
                    />
                  </div>
                ),
              )}
            </div>
          ) : (
            <section
              className="legal-documents-empty"
              aria-labelledby={`${testId}-empty-title`}
            >
              <div className="legal-documents-empty-icon">
                <Search
                  size={25}
                  aria-hidden="true"
                  focusable="false"
                />
              </div>

              <h2
                id={`${testId}-empty-title`}
              >
                No legal documents found
              </h2>

              <p>
                {emptyLabel}
              </p>

              <button
                type="button"
                className="legal-documents-empty-button"
                onClick={
                  handleClearFilters
                }
              >
                View all documents
              </button>
            </section>
          )}

          {/* ================================================================
              Trust / Security Notice
              ================================================================ */}

          <aside
            className="legal-documents-trust"
            aria-label="Legal document security notice"
          >
            <ShieldCheck
              size={19}
              aria-hidden="true"
              focusable="false"
            />

            <div>
              <strong>
                Use official TITech
                information
              </strong>

              <p>
                Always verify that legal
                documents are accessed
                through an official TITech
                channel. The authoritative
                version and applicable
                effective date are
                determined by TITech's
                controlled legal and
                compliance processes.
              </p>
            </div>
          </aside>
        </section>
      </div>

      {/* ======================================================================
          Footer
          ==================================================================== */}

      <footer className="legal-documents-footer">
        <Info
          size={15}
          aria-hidden="true"
          focusable="false"
        />

        <span>
          Legal documents may be updated
          from time to time. Review the
          applicable version and effective
          date before relying on a document.
        </span>
      </footer>
    </main>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

LegalDocuments.propTypes = {
  documents:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  categories:
    PropTypes.arrayOf(
      PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object,
      ]),
    ),

  title:
    PropTypes.string,

  description:
    PropTypes.string,

  initialCategory:
    PropTypes.string,

  showSearch:
    PropTypes.bool,

  showCategories:
    PropTypes.bool,

  showStatus:
    PropTypes.bool,

  showMetadata:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  error:
    PropTypes.bool,

  errorMessage:
    PropTypes.string,

  emptyLabel:
    PropTypes.string,

  locale:
    PropTypes.string,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,

  onDocumentSelect:
    PropTypes.func,

  onRetry:
    PropTypes.func,
};

// ============================================================================
// Default Props
// ============================================================================

LegalDocuments.defaultProps = {
  documents:
    DEFAULT_DOCUMENTS,

  categories:
    DEFAULT_CATEGORIES,

  title:
    DEFAULT_TITLE,

  description:
    DEFAULT_DESCRIPTION,

  initialCategory:
    CATEGORY.ALL,

  showSearch:
    true,

  showCategories:
    true,

  showStatus:
    true,

  showMetadata:
    true,

  loading:
    false,

  error:
    false,

  errorMessage:
    DEFAULT_ERROR_MESSAGE,

  emptyLabel:
    DEFAULT_EMPTY_LABEL,

  locale:
    "en-UG",

  className:
    "",

  testId:
    DEFAULT_TEST_ID,

  onDocumentSelect:
    undefined,

  onRetry:
    undefined,
};

// ============================================================================
// Static Constants
// ============================================================================

LegalDocuments.CATEGORY =
  CATEGORY;

LegalDocuments.STATUS =
  STATUS;

LegalDocuments.DEFAULT_DOCUMENTS =
  DEFAULT_DOCUMENTS;

LegalDocuments.DEFAULT_CATEGORIES =
  DEFAULT_CATEGORIES;

// ============================================================================
// Static Utilities
// ============================================================================

LegalDocuments.normalizeDocument =
  normalizeDocument;

LegalDocuments.normalizeCategory =
  normalizeCategory;

LegalDocuments.normalizeStatus =
  normalizeStatus;

LegalDocuments.normalizeDate =
  normalizeDate;

LegalDocuments.matchesSearch =
  matchesSearch;

// ============================================================================
// Metadata
// ============================================================================

LegalDocuments.displayName =
  "TITechLegalDocuments";

// ============================================================================
// Export
// ============================================================================

export default memo(
  LegalDocuments,
);