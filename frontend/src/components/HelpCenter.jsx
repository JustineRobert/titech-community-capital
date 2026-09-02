// ============================================================================
// TITech Community Capital
// Enterprise Help Center
// File: frontend/src/components/HelpCenter.jsx
// Production Grade
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
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  FileText,
  Mail,
  MessageCircle,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
  X,
} from "lucide-react";

import "./HelpCenter.css";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TEST_ID = "titech-help-center";

const DEFAULT_SUPPORT_EMAIL =
  "support@titechcommunity.app";

const DEFAULT_CONTACT_EMAIL =
  "info@titechcommunity.app";

const DEFAULT_SUPPORT_ROUTE = "/support";

const DEFAULT_FAQ_LIMIT = 100;

const MAX_SEARCH_LENGTH = 200;

const MAX_TAGS_PER_ITEM = 12;

const CATEGORY = Object.freeze({
  ALL: "all",
  GETTING_STARTED: "getting-started",
  SAVINGS: "savings",
  GROUPS: "groups",
  ACCOUNT: "account",
  SECURITY: "security",
  PAYMENTS: "payments",
  TROUBLESHOOTING: "troubleshooting",
});

const CATEGORY_LABELS = Object.freeze({
  [CATEGORY.ALL]: "All topics",
  [CATEGORY.GETTING_STARTED]: "Getting started",
  [CATEGORY.SAVINGS]: "Savings",
  [CATEGORY.GROUPS]: "Savings groups",
  [CATEGORY.ACCOUNT]: "Account",
  [CATEGORY.SECURITY]: "Security",
  [CATEGORY.PAYMENTS]: "Payments",
  [CATEGORY.TROUBLESHOOTING]: "Troubleshooting",
});

const DEFAULT_CATEGORIES = Object.freeze([
  {
    id: CATEGORY.ALL,
    label: "All topics",
    icon: CircleHelp,
  },
  {
    id: CATEGORY.GETTING_STARTED,
    label: "Getting started",
    icon: BookOpen,
  },
  {
    id: CATEGORY.SAVINGS,
    label: "Savings",
    icon: Wallet,
  },
  {
    id: CATEGORY.GROUPS,
    label: "Savings groups",
    icon: Users,
  },
  {
    id: CATEGORY.ACCOUNT,
    label: "Account",
    icon: Smartphone,
  },
  {
    id: CATEGORY.SECURITY,
    label: "Security",
    icon: ShieldCheck,
  },
  {
    id: CATEGORY.PAYMENTS,
    label: "Payments",
    icon: Wallet,
  },
  {
    id: CATEGORY.TROUBLESHOOTING,
    label: "Troubleshooting",
    icon: CircleHelp,
  },
]);

const DEFAULT_ARTICLES = Object.freeze([
  {
    id: "getting-started",
    title: "Getting started with TITech",
    description:
      "Learn the basics of creating your account and using TITech Community Capital.",
    category: CATEGORY.GETTING_STARTED,
    href: "/help/getting-started",
    icon: BookOpen,
  },
  {
    id: "savings-groups",
    title: "Managing savings groups",
    description:
      "Understand group membership, contributions, savings targets, and group activity.",
    category: CATEGORY.GROUPS,
    href: "/help/savings-groups",
    icon: Users,
  },
  {
    id: "savings",
    title: "Understanding your savings",
    description:
      "Learn how contributions, balances, savings goals, and transaction history work.",
    category: CATEGORY.SAVINGS,
    href: "/help/savings",
    icon: Wallet,
  },
  {
    id: "security",
    title: "Keeping your account secure",
    description:
      "Review account security, authentication, device safety, and suspicious activity guidance.",
    category: CATEGORY.SECURITY,
    href: "/help/security",
    icon: ShieldCheck,
  },
  {
    id: "payments",
    title: "Payments and transactions",
    description:
      "Find guidance about payments, transaction status, receipts, and failed transactions.",
    category: CATEGORY.PAYMENTS,
    href: "/help/payments",
    icon: Wallet,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting common issues",
    description:
      "Find practical steps for resolving common application and connectivity problems.",
    category: CATEGORY.TROUBLESHOOTING,
    href: "/help/troubleshooting",
    icon: CircleHelp,
  },
]);

const DEFAULT_FAQS = Object.freeze([
  {
    id: "faq-account",
    question: "How do I create a TITech account?",
    answer:
      "Use the registration flow to provide the required account information, verify your contact details, and complete any applicable onboarding requirements.",
    category: CATEGORY.GETTING_STARTED,
  },
  {
    id: "faq-group",
    question: "How do I join a savings group?",
    answer:
      "Open the relevant savings group and use the available membership action. Access may depend on the group's configuration and your account permissions.",
    category: CATEGORY.GROUPS,
  },
  {
    id: "faq-contribution",
    question: "How can I make a savings contribution?",
    answer:
      "Open the appropriate savings or group contribution workflow and follow the displayed payment instructions. Always verify the amount and destination before confirming.",
    category: CATEGORY.SAVINGS,
  },
  {
    id: "faq-transaction",
    question: "What should I do if a transaction is pending?",
    answer:
      "Allow the transaction workflow to complete before retrying. Check your transaction history and receipt information first to avoid accidental duplicate operations.",
    category: CATEGORY.PAYMENTS,
  },
  {
    id: "faq-security",
    question: "What should I do if I suspect unauthorized activity?",
    answer:
      "Secure your account immediately, stop sharing authentication credentials, review recent activity, and contact TITech Support through an official support channel.",
    category: CATEGORY.SECURITY,
  },
  {
    id: "faq-password",
    question: "How do I recover access to my account?",
    answer:
      "Use the account recovery flow available on the sign-in screen. Follow the verification instructions and contact support if recovery cannot be completed.",
    category: CATEGORY.ACCOUNT,
  },
]);

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function normalizeSearchQuery(value) {
  return normalizeString(value)
    .slice(0, MAX_SEARCH_LENGTH);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCategory(value) {
  const normalized = normalizeString(
    value,
    CATEGORY.ALL,
  ).toLowerCase();

  return Object.values(CATEGORY).includes(normalized)
    ? normalized
    : CATEGORY.ALL;
}

function normalizeId(value, fallback) {
  const normalized = normalizeString(value);

  return normalized || fallback;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => {
      if (
        tag &&
        typeof tag === "object"
      ) {
        return tag.name ?? tag.label;
      }

      return tag;
    })
    .map((tag) => normalizeString(tag))
    .filter(Boolean)
    .slice(0, MAX_TAGS_PER_ITEM);
}

function normalizeFaq(faq, index) {
  if (
    !faq ||
    typeof faq !== "object"
  ) {
    return null;
  }

  const question = normalizeString(
    faq.question ?? faq.title,
  );

  const answer = normalizeString(
    faq.answer ??
      faq.content ??
      faq.description,
  );

  if (!question || !answer) {
    return null;
  }

  return {
    ...faq,
    id: normalizeId(
      faq.id ?? faq._id,
      `faq-${index + 1}`,
    ),
    question,
    answer,
    category: normalizeCategory(
      faq.category,
    ),
    tags: normalizeTags(faq.tags),
  };
}

function normalizeArticle(article, index) {
  if (
    !article ||
    typeof article !== "object"
  ) {
    return null;
  }

  const title = normalizeString(
    article.title ?? article.name,
  );

  if (!title) {
    return null;
  }

  const href = normalizeString(
    article.href ?? article.to,
    DEFAULT_SUPPORT_ROUTE,
  );

  return {
    ...article,
    id: normalizeId(
      article.id ?? article._id,
      `article-${index + 1}`,
    ),
    title,
    description: normalizeString(
      article.description ??
        article.summary,
    ),
    category: normalizeCategory(
      article.category,
    ),
    href,
    tags: normalizeTags(article.tags),
  };
}

function isInternalRoute(href) {
  return (
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("//")
  );
}

function isExternalHttpUrl(href) {
  if (
    typeof href !== "string" ||
    !href
  ) {
    return false;
  }

  try {
    const url = new URL(href);

    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch {
    return false;
  }
}

function getArticleHref(article) {
  const href = normalizeString(
    article?.href,
    DEFAULT_SUPPORT_ROUTE,
  );

  if (
    isInternalRoute(href) ||
    isExternalHttpUrl(href)
  ) {
    return href;
  }

  return DEFAULT_SUPPORT_ROUTE;
}

function getCategoryLabel(category) {
  const normalized = normalizeCategory(
    category,
  );

  return (
    CATEGORY_LABELS[normalized] ||
    normalized
      .replace(/-/g, " ")
      .replace(/\b\w/g, (character) =>
        character.toUpperCase(),
      )
  );
}

function matchesSearch(item, query) {
  const normalizedQuery =
    normalizeSearchQuery(query)
      .toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    item?.title,
    item?.question,
    item?.answer,
    item?.description,
    item?.category,
    ...normalizeTags(item?.tags),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchableText.includes(
    normalizedQuery,
  );
}

function createStableElementId(
  testId,
  prefix,
  value,
) {
  const safeValue = normalizeString(
    value,
    "item",
  ).replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );

  return `${testId}-${prefix}-${safeValue}`;
}

// ============================================================================
// Help Search
// ============================================================================

const HelpSearch = memo(
  function HelpSearch({
    value,
    onChange,
    onClear,
    resultCount,
    testId,
  }) {
    const hasValue =
      Boolean(
        normalizeSearchQuery(value),
      );

    const inputId =
      `${testId}-search-input`;

    const resultsId =
      `${testId}-search-results`;

    return (
      <div
        className="help-center-search"
        role="search"
        data-testid={`${testId}-search`}
      >
        <label
          className="sr-only"
          htmlFor={inputId}
        >
          Search the TITech Help Center
        </label>

        <Search
          className="help-center-search-icon"
          size={20}
          aria-hidden="true"
          focusable="false"
        />

        <input
          id={inputId}
          className="help-center-search-input"
          type="search"
          value={value}
          onChange={onChange}
          placeholder="Search help articles and FAQs..."
          autoComplete="off"
          spellCheck="false"
          maxLength={MAX_SEARCH_LENGTH}
          aria-describedby={resultsId}
          data-testid={`${testId}-search-input`}
        />

        {hasValue ? (
          <button
            type="button"
            className="help-center-search-clear"
            onClick={onClear}
            aria-label="Clear help center search"
            title="Clear search"
            data-testid={`${testId}-search-clear`}
          >
            <X
              size={18}
              aria-hidden="true"
              focusable="false"
            />
          </button>
        ) : null}

        <span
          id={resultsId}
          className="help-center-search-results"
          aria-live="polite"
          aria-atomic="true"
        >
          {resultCount}{" "}
          {resultCount === 1
            ? "result"
            : "results"}
        </span>
      </div>
    );
  },
);

HelpSearch.displayName =
  "TITechHelpSearch";

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
        className="help-center-categories"
        aria-label="Help categories"
        data-testid={`${testId}-categories`}
      >
        <ul className="help-center-category-list">
          {categories.map(
            (category) => {
              const Icon =
                category.icon ||
                CircleHelp;

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
                      "help-center-category-button",
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
                    aria-pressed={
                      isActive
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
                      {category.label}
                    </span>
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
  "TITechHelpCategoryNavigation";

// ============================================================================
// Help Article Card
// ============================================================================

const HelpArticleCard = memo(
  function HelpArticleCard({
    article,
    testId,
  }) {
    const Icon =
      article.icon ||
      FileText;

    const href =
      getArticleHref(article);

    const titleId =
      createStableElementId(
        testId,
        "article-title",
        article.id,
      );

    const isInternal =
      isInternalRoute(href);

    const titleContent =
      isInternal ? (
        <Link
          to={href}
          aria-label={`Read ${article.title}`}
        >
          {article.title}
        </Link>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Read ${article.title} (opens in a new tab)`}
        >
          {article.title}
        </a>
      );

    return (
      <article
        className="help-center-article-card"
        data-testid={`${testId}-article-${article.id}`}
      >
        <div
          className="help-center-article-icon"
          aria-hidden="true"
        >
          <Icon
            size={22}
            focusable="false"
          />
        </div>

        <div className="help-center-article-content">
          <div className="help-center-article-category">
            {getCategoryLabel(
              article.category,
            )}
          </div>

          <h3
            id={titleId}
            className="help-center-article-title"
          >
            {titleContent}
          </h3>

          {article.description ? (
            <p className="help-center-article-description">
              {article.description}
            </p>
          ) : null}

          {isInternal ? (
            <Link
              to={href}
              className="help-center-article-link"
              aria-labelledby={titleId}
            >
              <span>
                Read article
              </span>

              <ArrowRight
                size={16}
                aria-hidden="true"
                focusable="false"
              />
            </Link>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="help-center-article-link"
              aria-labelledby={titleId}
            >
              <span>
                Read article
              </span>

              <ArrowRight
                size={16}
                aria-hidden="true"
                focusable="false"
              />
            </a>
          )}
        </div>
      </article>
    );
  },
);

HelpArticleCard.displayName =
  "TITechHelpArticleCard";

// ============================================================================
// FAQ Item
// ============================================================================

const FaqItem = memo(
  function FaqItem({
    faq,
    isOpen,
    onToggle,
    testId,
  }) {
    const questionId =
      createStableElementId(
        testId,
        "faq-question",
        faq.id,
      );

    const answerId =
      createStableElementId(
        testId,
        "faq-answer",
        faq.id,
      );

    return (
      <div
        className={[
          "help-center-faq-item",
          isOpen
            ? "is-open"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`${testId}-faq-${faq.id}`}
      >
        <h3 className="help-center-faq-question">
          <button
            type="button"
            id={questionId}
            className="help-center-faq-button"
            aria-expanded={isOpen}
            aria-controls={answerId}
            onClick={() =>
              onToggle(faq.id)
            }
          >
            <span>
              {faq.question}
            </span>

            <ChevronDown
              size={19}
              aria-hidden="true"
              focusable="false"
            />
          </button>
        </h3>

        <div
          id={answerId}
          className="help-center-faq-answer"
          role="region"
          aria-labelledby={questionId}
          hidden={!isOpen}
        >
          <p>
            {faq.answer}
          </p>
        </div>
      </div>
    );
  },
);

FaqItem.displayName =
  "TITechHelpFaqItem";

// ============================================================================
// Support Panel
// ============================================================================

const SupportPanel = memo(
  function SupportPanel({
    supportEmail,
    contactEmail,
    supportRoute,
    testId,
  }) {
    const normalizedSupportEmail =
      normalizeString(
        supportEmail,
        DEFAULT_SUPPORT_EMAIL,
      );

    const normalizedContactEmail =
      normalizeString(
        contactEmail,
        DEFAULT_CONTACT_EMAIL,
      );

    const normalizedSupportRoute =
      normalizeString(
        supportRoute,
        DEFAULT_SUPPORT_ROUTE,
      );

    const supportHref =
      `mailto:${normalizedSupportEmail}`;

    const contactHref =
      `mailto:${normalizedContactEmail}`;

    const hasGeneralContact =
      normalizedContactEmail &&
      normalizedContactEmail !==
        normalizedSupportEmail;

    return (
      <section
        className="help-center-support"
        aria-labelledby={`${testId}-support-title`}
        data-testid={`${testId}-support`}
      >
        <div
          className="help-center-support-icon"
          aria-hidden="true"
        >
          <MessageCircle
            size={26}
            focusable="false"
          />
        </div>

        <div className="help-center-support-content">
          <h2
            id={`${testId}-support-title`}
          >
            Still need help?
          </h2>

          <p>
            If you cannot find the answer
            you need, contact the TITech
            support team through an official
            support channel.
          </p>

          <div className="help-center-support-actions">
            {normalizedSupportEmail ? (
              <a
                href={supportHref}
                className="help-center-support-button help-center-support-button--primary"
                data-testid={`${testId}-support-email`}
              >
                <Mail
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  Contact Support
                </span>
              </a>
            ) : null}

            {normalizedSupportRoute ? (
              <Link
                to={normalizedSupportRoute}
                className="help-center-support-button help-center-support-button--secondary"
                data-testid={`${testId}-support-route`}
              >
                <MessageCircle
                  size={17}
                  aria-hidden="true"
                  focusable="false"
                />

                <span>
                  Support Center
                </span>
              </Link>
            ) : null}

            {hasGeneralContact ? (
              <a
                href={contactHref}
                className="help-center-support-link"
              >
                General enquiries
              </a>
            ) : null}
          </div>
        </div>
      </section>
    );
  },
);

SupportPanel.displayName =
  "TITechHelpSupportPanel";

// ============================================================================
// Main Component
// ============================================================================

function HelpCenter({
  articles = DEFAULT_ARTICLES,
  faqs = DEFAULT_FAQS,
  categories = DEFAULT_CATEGORIES,

  title = "How can we help?",

  description =
    "Find answers, guides, and practical support for using TITech Community Capital.",

  supportEmail =
    DEFAULT_SUPPORT_EMAIL,

  contactEmail =
    DEFAULT_CONTACT_EMAIL,

  supportRoute =
    DEFAULT_SUPPORT_ROUTE,

  showSearch = true,
  showCategories = true,
  showArticles = true,
  showFaqs = true,
  showSupport = true,

  initialCategory = CATEGORY.ALL,

  className = "",

  testId = DEFAULT_TEST_ID,
}) {
  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState(() =>
    normalizeCategory(
      initialCategory,
    ),
  );

  const [
    openFaqId,
    setOpenFaqId,
  ] = useState(null);

  // ========================================================================
  // Normalize External Data
  // ========================================================================

  const normalizedArticles =
    useMemo(
      () =>
        normalizeArray(
          articles,
        )
          .map(normalizeArticle)
          .filter(Boolean),
      [articles],
    );

  const normalizedFaqs =
    useMemo(
      () =>
        normalizeArray(faqs)
          .slice(
            0,
            DEFAULT_FAQ_LIMIT,
          )
          .map(normalizeFaq)
          .filter(Boolean),
      [faqs],
    );

  const normalizedCategories =
    useMemo(() => {
      const source =
        normalizeArray(categories);

      if (source.length === 0) {
        return DEFAULT_CATEGORIES;
      }

      const normalized =
        source
          .map((category) => {
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
                  CATEGORY_LABELS[id] ||
                  category,
                icon: CircleHelp,
              };
            }

            if (
              !category ||
              typeof category !==
                "object"
            ) {
              return null;
            }

            const id =
              normalizeCategory(
                category.id ??
                  category.value ??
                  category.name,
              );

            return {
              ...category,
              id,
              label:
                normalizeString(
                  category.label ??
                    category.name,
                  CATEGORY_LABELS[id] ||
                    "Help",
                ),
              icon:
                category.icon ||
                CircleHelp,
            };
          })
          .filter(Boolean);

      const hasAllCategory =
        normalized.some(
          (category) =>
            category.id ===
            CATEGORY.ALL,
        );

      if (
        !hasAllCategory
      ) {
        normalized.unshift(
          DEFAULT_CATEGORIES[0],
        );
      }

      return normalized.length > 0
        ? normalized
        : DEFAULT_CATEGORIES;
    }, [categories]);

  // ========================================================================
  // Filtering
  // ========================================================================

  const filteredArticles =
    useMemo(() => {
      return normalizedArticles.filter(
        (article) => {
          const categoryMatches =
            selectedCategory ===
              CATEGORY.ALL ||
            article.category ===
              selectedCategory;

          return (
            categoryMatches &&
            matchesSearch(
              article,
              searchQuery,
            )
          );
        },
      );
    }, [
      normalizedArticles,
      selectedCategory,
      searchQuery,
    ]);

  const filteredFaqs =
    useMemo(() => {
      return normalizedFaqs.filter(
        (faq) => {
          const categoryMatches =
            selectedCategory ===
              CATEGORY.ALL ||
            faq.category ===
              selectedCategory;

          return (
            categoryMatches &&
            matchesSearch(
              faq,
              searchQuery,
            )
          );
        },
      );
    }, [
      normalizedFaqs,
      selectedCategory,
      searchQuery,
    ]);

  const totalResults =
    filteredArticles.length +
    filteredFaqs.length;

  const hasSearch =
    Boolean(
      normalizeSearchQuery(
        searchQuery,
      ),
    );

  const hasActiveCategory =
    selectedCategory !==
    CATEGORY.ALL;

  const hasResults =
    totalResults > 0;

  // ========================================================================
  // Event Handlers
  // ========================================================================

  const handleSearchChange =
    useCallback(
      (event) => {
        setSearchQuery(
          normalizeSearchQuery(
            event.target.value,
          ),
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

        setOpenFaqId(null);
      },
      [],
    );

  const handleFaqToggle =
    useCallback(
      (faqId) => {
        setOpenFaqId(
          (currentId) =>
            currentId === faqId
              ? null
              : faqId,
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
      setOpenFaqId(null);
    }, []);

  const containerClassName =
    [
      "help-center",
      className,
    ]
      .filter(Boolean)
      .join(" ");

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <main
      className={containerClassName}
      data-testid={testId}
      data-component="titech-help-center"
    >
      {/* ====================================================================
          Hero
          ==================================================================== */}

      <header className="help-center-hero">
        <div className="help-center-hero-inner">
          <div
            className="help-center-hero-icon"
            aria-hidden="true"
          >
            <CircleHelp
              size={30}
              focusable="false"
            />
          </div>

          <div className="help-center-hero-content">
            <p className="help-center-eyebrow">
              TITech Support
            </p>

            <h1>
              {normalizeString(
                title,
                "How can we help?",
              )}
            </h1>

            <p className="help-center-description">
              {normalizeString(
                description,
                "Find answers, guides, and practical support for using TITech Community Capital.",
              )}
            </p>
          </div>
        </div>

        {showSearch ? (
          <HelpSearch
            value={searchQuery}
            onChange={
              handleSearchChange
            }
            onClear={
              handleClearSearch
            }
            resultCount={
              totalResults
            }
            testId={testId}
          />
        ) : null}
      </header>

      {/* ====================================================================
          Main Layout
          ==================================================================== */}

      <div className="help-center-layout">
        {showCategories ? (
          <aside
            className="help-center-sidebar"
            aria-label="Help center navigation"
          >
            <div className="help-center-sidebar-heading">
              <span>
                Browse topics
              </span>
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

        <div className="help-center-content">
          {/* ================================================================
              Filter Summary
              ================================================================ */}

          {(hasSearch ||
            hasActiveCategory) ? (
            <div
              className="help-center-filter-summary"
              aria-live="polite"
              aria-atomic="true"
            >
              <div>
                <strong>
                  {totalResults}
                </strong>{" "}
                {totalResults === 1
                  ? "result"
                  : "results"}{" "}
                found
              </div>

              <button
                type="button"
                className="help-center-clear-filters"
                onClick={
                  handleClearFilters
                }
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {/* ================================================================
              Articles
              ================================================================ */}

          {showArticles &&
          filteredArticles.length >
            0 ? (
            <section
              className="help-center-section"
              aria-labelledby={`${testId}-articles-title`}
            >
              <div className="help-center-section-heading">
                <div>
                  <p className="help-center-section-eyebrow">
                    Guides
                  </p>

                  <h2
                    id={`${testId}-articles-title`}
                  >
                    Help articles
                  </h2>
                </div>

                <span className="help-center-section-count">
                  {
                    filteredArticles.length
                  }
                </span>
              </div>

              <div className="help-center-articles">
                {filteredArticles.map(
                  (article) => (
                    <HelpArticleCard
                      key={
                        article.id
                      }
                      article={
                        article
                      }
                      testId={
                        testId
                      }
                    />
                  ),
                )}
              </div>
            </section>
          ) : null}

          {/* ================================================================
              FAQs
              ================================================================ */}

          {showFaqs &&
          filteredFaqs.length >
            0 ? (
            <section
              className="help-center-section help-center-faq-section"
              aria-labelledby={`${testId}-faq-title`}
            >
              <div className="help-center-section-heading">
                <div>
                  <p className="help-center-section-eyebrow">
                    Answers
                  </p>

                  <h2
                    id={`${testId}-faq-title`}
                  >
                    Frequently asked
                    questions
                  </h2>
                </div>

                <span className="help-center-section-count">
                  {
                    filteredFaqs.length
                  }
                </span>
              </div>

              <div className="help-center-faq-list">
                {filteredFaqs.map(
                  (faq) => (
                    <FaqItem
                      key={faq.id}
                      faq={faq}
                      isOpen={
                        openFaqId ===
                        faq.id
                      }
                      onToggle={
                        handleFaqToggle
                      }
                      testId={
                        testId
                      }
                    />
                  ),
                )}
              </div>
            </section>
          ) : null}

          {/* ================================================================
              Empty State
              ================================================================ */}

          {!hasResults ? (
            <section
              className="help-center-empty"
              aria-labelledby={`${testId}-empty-title`}
            >
              <div
                className="help-center-empty-icon"
                aria-hidden="true"
              >
                <Search
                  size={27}
                  focusable="false"
                />
              </div>

              <h2
                id={`${testId}-empty-title`}
              >
                No help results found
              </h2>

              <p>
                Try a different search
                term or choose another
                help category.
              </p>

              <button
                type="button"
                className="help-center-empty-button"
                onClick={
                  handleClearFilters
                }
              >
                View all help
              </button>
            </section>
          ) : null}

          {/* ================================================================
              Support
              ================================================================ */}

          {showSupport ? (
            <SupportPanel
              supportEmail={
                normalizeString(
                  supportEmail,
                  DEFAULT_SUPPORT_EMAIL,
                )
              }
              contactEmail={
                normalizeString(
                  contactEmail,
                  DEFAULT_CONTACT_EMAIL,
                )
              }
              supportRoute={
                normalizeString(
                  supportRoute,
                  DEFAULT_SUPPORT_ROUTE,
                )
              }
              testId={testId}
            />
          ) : null}
        </div>
      </div>

      {/* ====================================================================
          Trust Footer
          ==================================================================== */}

      <footer className="help-center-footer">
        <ShieldCheck
          size={16}
          aria-hidden="true"
          focusable="false"
        />

        <span>
          Use official TITech support channels
          and never share passwords, PINs,
          one-time verification codes, or
          other authentication credentials.
        </span>
      </footer>
    </main>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

HelpCenter.propTypes = {
  articles: PropTypes.arrayOf(
    PropTypes.object,
  ),

  faqs: PropTypes.arrayOf(
    PropTypes.object,
  ),

  categories: PropTypes.arrayOf(
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),
  ),

  title: PropTypes.string,

  description: PropTypes.string,

  supportEmail: PropTypes.string,

  contactEmail: PropTypes.string,

  supportRoute: PropTypes.string,

  showSearch: PropTypes.bool,

  showCategories: PropTypes.bool,

  showArticles: PropTypes.bool,

  showFaqs: PropTypes.bool,

  showSupport: PropTypes.bool,

  initialCategory: PropTypes.string,

  className: PropTypes.string,

  testId: PropTypes.string,
};

// ============================================================================
// Default Props
// ============================================================================

HelpCenter.defaultProps = {
  articles: DEFAULT_ARTICLES,

  faqs: DEFAULT_FAQS,

  categories: DEFAULT_CATEGORIES,

  title: "How can we help?",

  description:
    "Find answers, guides, and practical support for using TITech Community Capital.",

  supportEmail:
    DEFAULT_SUPPORT_EMAIL,

  contactEmail:
    DEFAULT_CONTACT_EMAIL,

  supportRoute:
    DEFAULT_SUPPORT_ROUTE,

  showSearch: true,

  showCategories: true,

  showArticles: true,

  showFaqs: true,

  showSupport: true,

  initialCategory:
    CATEGORY.ALL,

  className: "",

  testId:
    DEFAULT_TEST_ID,
};

// ============================================================================
// Static Utilities
// ============================================================================

HelpCenter.CATEGORY =
  CATEGORY;

HelpCenter.DEFAULT_ARTICLES =
  DEFAULT_ARTICLES;

HelpCenter.DEFAULT_FAQS =
  DEFAULT_FAQS;

HelpCenter.DEFAULT_CATEGORIES =
  DEFAULT_CATEGORIES;

// ============================================================================
// Export
// ============================================================================

export default memo(
  HelpCenter,
);