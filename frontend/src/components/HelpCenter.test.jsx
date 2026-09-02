// ============================================================================
// TITech Community Capital
// Enterprise Help Center Tests
// File: frontend/src/components/HelpCenter.test.jsx
// Production Grade
// ============================================================================

"use strict";

import React from "react";

import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import "@testing-library/jest-dom";

import {
  MemoryRouter,
} from "react-router-dom";

import HelpCenter from "./HelpCenter";

// ============================================================================
// Test Utilities
// ============================================================================

const renderHelpCenter = (
  props = {},
  initialEntries = ["/help"],
) =>
  render(
    <MemoryRouter
      initialEntries={initialEntries}
    >
      <HelpCenter {...props} />
    </MemoryRouter>,
  );

const getTestId = (
  testId = "titech-help-center",
) => testId;

// ============================================================================
// Test Data
// ============================================================================

const TEST_ARTICLES = [
  {
    id: "article-account",
    title: "Account setup",
    description:
      "Learn how to configure your TITech account.",
    category: "getting-started",
    href: "/help/account",
  },
  {
    id: "article-savings",
    title: "Savings guide",
    description:
      "Learn how savings contributions work.",
    category: "savings",
    href: "/help/savings",
  },
  {
    id: "article-security",
    title: "Account security",
    description:
      "Learn how to protect your account.",
    category: "security",
    href: "/help/security",
  },
];

const TEST_FAQS = [
  {
    id: "faq-one",
    question:
      "How do I make a contribution?",
    answer:
      "Open the contribution workflow and follow the displayed instructions.",
    category: "savings",
  },
  {
    id: "faq-two",
    question:
      "How do I secure my account?",
    answer:
      "Never share your password, PIN, or verification code.",
    category: "security",
  },
];

const TEST_CATEGORIES = [
  {
    id: "all",
    label: "All topics",
  },
  {
    id: "savings",
    label: "Savings",
  },
  {
    id: "security",
    label: "Security",
  },
];

// ============================================================================
// Rendering
// ============================================================================

describe(
  "HelpCenter",
  () => {
    describe(
      "rendering",
      () => {
        test(
          "renders the TITech Help Center",
          () => {
            renderHelpCenter();

            expect(
              screen.getByTestId(
                getTestId(),
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders the default hero content",
          () => {
            renderHelpCenter();

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "How can we help?",
                  level: 1,
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                "TITech Support",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /Find answers, guides/i,
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders the default help sections",
          () => {
            renderHelpCenter();

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "Help articles",
                  level: 2,
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByRole(
                "heading",
                {
                  name: /Frequently asked questions/i,
                  level: 2,
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders the TITech trust footer",
          () => {
            renderHelpCenter();

            expect(
              screen.getByText(
                /Use official TITech support channels/i,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Search
    // ========================================================================

    describe(
      "search",
      () => {
        test(
          "renders the help search input",
          () => {
            renderHelpCenter();

            expect(
              screen.getByRole(
                "searchbox",
                {
                  name: /search the titech help center/i,
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "filters articles and FAQs by search query",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
            });

            const searchInput =
              screen.getByRole(
                "searchbox",
              );

            fireEvent.change(
              searchInput,
              {
                target: {
                  value: "security",
                },
              },
            );

            expect(
              screen.getByText(
                "Account security",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                "How do I secure my account?",
              ),
            ).toBeInTheDocument();

            expect(
              screen.queryByText(
                "Savings guide",
              ),
            ).not.toBeInTheDocument();

            expect(
              screen.queryByText(
                "How do I make a contribution?",
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "search is case insensitive",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
            });

            fireEvent.change(
              screen.getByRole(
                "searchbox",
              ),
              {
                target: {
                  value: "SECURITY",
                },
              },
            );

            expect(
              screen.getByText(
                "Account security",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "searches article descriptions",
          () => {
            renderHelpCenter({
              articles: [
                {
                  id: "description-search",
                  title:
                    "Contribution guide",
                  description:
                    "This article explains mobile money contributions.",
                  category:
                    "payments",
                  href:
                    "/help/contributions",
                },
              ],
            });

            fireEvent.change(
              screen.getByRole(
                "searchbox",
              ),
              {
                target: {
                  value: "mobile money",
                },
              },
            );

            expect(
              screen.getByText(
                "Contribution guide",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "shows a clear button when search has a value",
          () => {
            renderHelpCenter();

            const searchInput =
              screen.getByRole(
                "searchbox",
              );

            fireEvent.change(
              searchInput,
              {
                target: {
                  value: "savings",
                },
              },
            );

            expect(
              screen.getByRole(
                "button",
                {
                  name: /clear help center search/i,
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "clears the search query",
          () => {
            renderHelpCenter();

            const searchInput =
              screen.getByRole(
                "searchbox",
              );

            fireEvent.change(
              searchInput,
              {
                target: {
                  value: "savings",
                },
              },
            );

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: /clear help center search/i,
                },
              ),
            );

            expect(
              searchInput,
            ).toHaveValue("");

            expect(
              screen.getByText(
                "Help articles",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "announces the result count",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
            });

            fireEvent.change(
              screen.getByRole(
                "searchbox",
              ),
              {
                target: {
                  value: "security",
                },
              },
            );

            expect(
              screen.getByText(
                "2 results",
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Categories
    // ========================================================================

    describe(
      "categories",
      () => {
        test(
          "renders category navigation",
          () => {
            renderHelpCenter({
              categories:
                TEST_CATEGORIES,
            });

            expect(
              screen.getByRole(
                "navigation",
                {
                  name: "Help categories",
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByRole(
                "button",
                {
                  name: "Savings",
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByRole(
                "button",
                {
                  name: "Security",
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "filters content by selected category",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
              categories:
                TEST_CATEGORIES,
            });

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: "Savings",
                },
              ),
            );

            expect(
              screen.getByText(
                "Savings guide",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                "How do I make a contribution?",
              ),
            ).toBeInTheDocument();

            expect(
              screen.queryByText(
                "Account security",
              ),
            ).not.toBeInTheDocument();

            expect(
              screen.queryByText(
                "How do I secure my account?",
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "marks the active category",
          () => {
            renderHelpCenter({
              categories:
                TEST_CATEGORIES,
            });

            const savingsButton =
              screen.getByRole(
                "button",
                {
                  name: "Savings",
                },
              );

            fireEvent.click(
              savingsButton,
            );

            expect(
              savingsButton,
            ).toHaveAttribute(
              "aria-current",
              "page",
            );
          },
        );

        test(
          "clearing filters returns to all topics",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              categories:
                TEST_CATEGORIES,
            });

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: "Security",
                },
              ),
            );

            expect(
              screen.queryByText(
                "Savings guide",
              ),
            ).not.toBeInTheDocument();

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: /clear filters/i,
                },
              ),
            );

            expect(
              screen.getByText(
                "Savings guide",
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // FAQ
    // ========================================================================

    describe(
      "FAQ interactions",
      () => {
        test(
          "renders FAQ questions",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            expect(
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByRole(
                "button",
                {
                  name: "How do I secure my account?",
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "FAQ answers are initially collapsed",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            expect(
              screen.queryByText(
                /Open the contribution workflow/i,
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "opens an FAQ",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            const question =
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              );

            expect(
              question,
            ).toHaveAttribute(
              "aria-expanded",
              "false",
            );

            fireEvent.click(
              question,
            );

            expect(
              question,
            ).toHaveAttribute(
              "aria-expanded",
              "true",
            );

            expect(
              screen.getByText(
                /Open the contribution workflow/i,
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "closes an opened FAQ",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            const question =
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              );

            fireEvent.click(
              question,
            );

            fireEvent.click(
              question,
            );

            expect(
              question,
            ).toHaveAttribute(
              "aria-expanded",
              "false",
            );

            expect(
              screen.queryByText(
                /Open the contribution workflow/i,
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "opening one FAQ closes another",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            const first =
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              );

            const second =
              screen.getByRole(
                "button",
                {
                  name: "How do I secure my account?",
                },
              );

            fireEvent.click(
              first,
            );

            expect(
              first,
            ).toHaveAttribute(
              "aria-expanded",
              "true",
            );

            fireEvent.click(
              second,
            );

            expect(
              first,
            ).toHaveAttribute(
              "aria-expanded",
              "false",
            );

            expect(
              second,
            ).toHaveAttribute(
              "aria-expanded",
              "true",
            );
          },
        );
      },
    );

    // ========================================================================
    // Articles
    // ========================================================================

    describe(
      "articles",
      () => {
        test(
          "renders article titles and descriptions",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
            });

            expect(
              screen.getByText(
                "Account setup",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /configure your TITech account/i,
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders internal article links",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
            });

            const link =
              screen.getByRole(
                "link",
                {
                  name: "Read Account setup",
                },
              );

            expect(
              link,
            ).toHaveAttribute(
              "href",
              "/help/account",
            );
          },
        );

        test(
          "renders the article read action",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
            });

            expect(
              screen.getAllByRole(
                "link",
                {
                  name: "Read Account setup",
                },
              ),
            ).toHaveLength(2);
          },
        );
      },
    );

    // ========================================================================
    // Support
    // ========================================================================

    describe(
      "support",
      () => {
        test(
          "renders the support panel",
          () => {
            renderHelpCenter();

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "Still need help?",
                  level: 2,
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByTestId(
                "titech-help-center-support",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders the configured support email",
          () => {
            renderHelpCenter({
              supportEmail:
                "support@example.com",
            });

            const link =
              screen.getByTestId(
                "titech-help-center-support-email",
              );

            expect(
              link,
            ).toHaveAttribute(
              "href",
              "mailto:support@example.com",
            );
          },
        );

        test(
          "renders the support center route",
          () => {
            renderHelpCenter({
              supportRoute:
                "/contact-support",
            });

            const link =
              screen.getByTestId(
                "titech-help-center-support-route",
              );

            expect(
              link,
            ).toHaveAttribute(
              "href",
              "/contact-support",
            );
          },
        );

        test(
          "renders general enquiries when email differs",
          () => {
            renderHelpCenter({
              supportEmail:
                "support@example.com",
              contactEmail:
                "info@example.com",
            });

            expect(
              screen.getByRole(
                "link",
                {
                  name: "General enquiries",
                },
              ),
            ).toHaveAttribute(
              "href",
              "mailto:info@example.com",
            );
          },
        );

        test(
          "does not render general enquiries when emails match",
          () => {
            renderHelpCenter({
              supportEmail:
                "support@example.com",
              contactEmail:
                "support@example.com",
            });

            expect(
              screen.queryByRole(
                "link",
                {
                  name: "General enquiries",
                },
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Conditional Rendering
    // ========================================================================

    describe(
      "conditional sections",
      () => {
        test(
          "can hide search",
          () => {
            renderHelpCenter({
              showSearch: false,
            });

            expect(
              screen.queryByRole(
                "searchbox",
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "can hide categories",
          () => {
            renderHelpCenter({
              showCategories:
                false,
            });

            expect(
              screen.queryByRole(
                "navigation",
                {
                  name: "Help categories",
                },
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "can hide articles",
          () => {
            renderHelpCenter({
              showArticles:
                false,
            });

            expect(
              screen.queryByRole(
                "heading",
                {
                  name: "Help articles",
                },
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "can hide FAQs",
          () => {
            renderHelpCenter({
              showFaqs: false,
            });

            expect(
              screen.queryByRole(
                "heading",
                {
                  name: /Frequently asked questions/i,
                },
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "can hide support",
          () => {
            renderHelpCenter({
              showSupport: false,
            });

            expect(
              screen.queryByRole(
                "heading",
                {
                  name: "Still need help?",
                },
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Empty State
    // ========================================================================

    describe(
      "empty state",
      () => {
        test(
          "renders empty state when there are no results",
          () => {
            renderHelpCenter({
              articles: [],
              faqs: [],
            });

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "No help results found",
                  level: 2,
                },
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByRole(
                "button",
                {
                  name: "View all help",
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders empty state for an unmatched search",
          () => {
            renderHelpCenter();

            fireEvent.change(
              screen.getByRole(
                "searchbox",
              ),
              {
                target: {
                  value:
                    "this-does-not-exist",
                },
              },
            );

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "No help results found",
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "view all help clears search and category",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
              categories:
                TEST_CATEGORIES,
            });

            fireEvent.change(
              screen.getByRole(
                "searchbox",
              ),
              {
                target: {
                  value:
                    "not-found",
                },
              },
            );

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "No help results found",
                },
              ),
            ).toBeInTheDocument();

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: "View all help",
                },
              ),
            );

            expect(
              screen.getByText(
                "Account setup",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                "Savings guide",
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Defensive Normalization
    // ========================================================================

    describe(
      "defensive data handling",
      () => {
        test(
          "ignores malformed articles",
          () => {
            renderHelpCenter({
              articles: [
                null,
                undefined,
                {},
                {
                  title: "",
                },
                {
                  title:
                    "Valid article",
                  category:
                    "savings",
                  href:
                    "/help/valid",
                },
              ],
              faqs: [],
            });

            expect(
              screen.getByText(
                "Valid article",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "ignores malformed FAQs",
          () => {
            renderHelpCenter({
              articles: [],
              faqs: [
                null,
                {},
                {
                  question:
                    "",
                  answer:
                    "",
                },
                {
                  question:
                    "Valid question",
                  answer:
                    "Valid answer",
                  category:
                    "savings",
                },
              ],
            });

            expect(
              screen.getByRole(
                "button",
                {
                  name: "Valid question",
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "accepts string categories",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              categories: [
                "all",
                "savings",
                "security",
              ],
            });

            expect(
              screen.getByRole(
                "button",
                {
                  name: "savings",
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "falls back to default categories when supplied categories are invalid",
          () => {
            renderHelpCenter({
              categories: [
                {},
                {
                  id: "",
                  label: "",
                },
              ],
            });

            expect(
              screen.getByRole(
                "button",
                {
                  name: "All topics",
                },
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Accessibility
    // ========================================================================

    describe(
      "accessibility",
      () => {
        test(
          "search input has an accessible label",
          () => {
            renderHelpCenter();

            expect(
              screen.getByRole(
                "searchbox",
                {
                  name: /search the titech help center/i,
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "FAQ buttons expose expanded state",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            const button =
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              );

            expect(
              button,
            ).toHaveAttribute(
              "aria-expanded",
              "false",
            );

            fireEvent.click(
              button,
            );

            expect(
              button,
            ).toHaveAttribute(
              "aria-expanded",
              "true",
            );
          },
        );

        test(
          "FAQ answer is associated with its question",
          () => {
            renderHelpCenter({
              faqs:
                TEST_FAQS,
            });

            const button =
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              );

            const controls =
              button.getAttribute(
                "aria-controls",
              );

            expect(
              controls,
            ).toBeTruthy();

            fireEvent.click(
              button,
            );

            expect(
              document.getElementById(
                controls,
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "category navigation exposes current category",
          () => {
            renderHelpCenter({
              categories:
                TEST_CATEGORIES,
            });

            const allButton =
              screen.getByRole(
                "button",
                {
                  name: "All topics",
                },
              );

            expect(
              allButton,
            ).toHaveAttribute(
              "aria-current",
              "page",
            );
          },
        );
      },
    );

    // ========================================================================
    // Custom Configuration
    // ========================================================================

    describe(
      "custom configuration",
      () => {
        test(
          "renders a custom title",
          () => {
            renderHelpCenter({
              title:
                "TITech Knowledge Base",
            });

            expect(
              screen.getByRole(
                "heading",
                {
                  name: "TITech Knowledge Base",
                  level: 1,
                },
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "renders a custom description",
          () => {
            renderHelpCenter({
              description:
                "Custom help content for TITech members.",
            });

            expect(
              screen.getByText(
                "Custom help content for TITech members.",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "uses the configured test id",
          () => {
            renderHelpCenter({
              testId:
                "custom-help-center",
            });

            expect(
              screen.getByTestId(
                "custom-help-center",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByTestId(
                "custom-help-center-search-input",
              ),
            ).toBeInTheDocument();
          },
        );

        test(
          "supports an initial category",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
              categories:
                TEST_CATEGORIES,
              initialCategory:
                "security",
            });

            expect(
              screen.getByText(
                "Account security",
              ),
            ).toBeInTheDocument();

            expect(
              screen.queryByText(
                "Savings guide",
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Combined Filters
    // ========================================================================

    describe(
      "combined filtering",
      () => {
        test(
          "applies category and search filters together",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
              categories:
                TEST_CATEGORIES,
            });

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: "Security",
                },
              ),
            );

            fireEvent.change(
              screen.getByRole(
                "searchbox",
              ),
              {
                target: {
                  value:
                    "account",
                },
              },
            );

            expect(
              screen.getByText(
                "Account security",
              ),
            ).toBeInTheDocument();

            expect(
              screen.queryByText(
                "Savings guide",
              ),
            ).not.toBeInTheDocument();
          },
        );

        test(
          "changing category resets the expanded FAQ",
          () => {
            renderHelpCenter({
              articles:
                TEST_ARTICLES,
              faqs:
                TEST_FAQS,
              categories:
                TEST_CATEGORIES,
            });

            const faq =
              screen.getByRole(
                "button",
                {
                  name: "How do I make a contribution?",
                },
              );

            fireEvent.click(
              faq,
            );

            expect(
              faq,
            ).toHaveAttribute(
              "aria-expanded",
              "true",
            );

            fireEvent.click(
              screen.getByRole(
                "button",
                {
                  name: "Security",
                },
              ),
            );

            expect(
              screen.queryByText(
                /Open the contribution workflow/i,
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    // ========================================================================
    // Security / Branding Regression Tests
    // ========================================================================

    describe(
      "TITech branding and security messaging",
      () => {
        test(
          "does not expose ACFOS branding",
          () => {
            renderHelpCenter();

            const container =
              screen.getByTestId(
                getTestId(),
              );

            expect(
              container.textContent,
            ).not.toMatch(
              /ACFOS/i,
            );
          },
        );

        test(
          "uses TITech branding in support messaging",
          () => {
            renderHelpCenter();

            expect(
              screen.getByText(
                "TITech Support",
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /Protected|official TITech support/i,
              ),
            ).toBeTruthy();
          },
        );

        test(
          "warns users not to share authentication credentials",
          () => {
            renderHelpCenter();

            expect(
              screen.getByText(
                /never share passwords, PINs, one-time verification codes/i,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );
  },
);

// ============================================================================
// Static API Tests
// ============================================================================

describe(
  "HelpCenter static API",
  () => {
    test(
      "exposes category constants",
      () => {
        expect(
          HelpCenter.CATEGORY,
        ).toBeDefined();

        expect(
          HelpCenter.CATEGORY.ALL,
        ).toBe("all");

        expect(
          HelpCenter.CATEGORY.SAVINGS,
        ).toBe("savings");

        expect(
          HelpCenter.CATEGORY.SECURITY,
        ).toBe("security");
      },
    );

    test(
      "exposes default article configuration",
      () => {
        expect(
          Array.isArray(
            HelpCenter.DEFAULT_ARTICLES,
          ),
        ).toBe(true);

        expect(
          HelpCenter.DEFAULT_ARTICLES.length,
        ).toBeGreaterThan(0);
      },
    );

    test(
      "exposes default FAQ configuration",
      () => {
        expect(
          Array.isArray(
            HelpCenter.DEFAULT_FAQS,
          ),
        ).toBe(true);

        expect(
          HelpCenter.DEFAULT_FAQS.length,
        ).toBeGreaterThan(0);
      },
    );

    test(
      "exposes default category configuration",
      () => {
        expect(
          Array.isArray(
            HelpCenter.DEFAULT_CATEGORIES,
          ),
        ).toBe(true);

        expect(
          HelpCenter.DEFAULT_CATEGORIES.length,
        ).toBeGreaterThan(0);
      },
    );
  },
);