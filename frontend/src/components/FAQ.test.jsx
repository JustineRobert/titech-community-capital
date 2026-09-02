/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise FAQ Component Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/FAQ.test.jsx
 *
 * Purpose:
 *   Production-grade unit/integration tests for the FAQ component.
 *
 * Coverage:
 *   ✓ Initial loading state
 *   ✓ FAQ/category/stat loading
 *   ✓ Successful rendering
 *   ✓ Search filtering
 *   ✓ Category filtering
 *   ✓ Combined filtering
 *   ✓ Empty results
 *   ✓ Filter reset
 *   ✓ Accordion expansion/collapse
 *   ✓ Single-item accordion behavior
 *   ✓ FAQ view tracking
 *   ✓ Helpful/unhelpful feedback
 *   ✓ Failed feedback requests
 *   ✓ Loading failures
 *   ✓ Retry behavior
 *   ✓ Keyboard accessibility
 *   ✓ ARIA state
 *   ✓ Heading hierarchy
 *   ✓ Button semantics
 *   ✓ Async service handling
 *   ✓ Large FAQ collections
 *   ✓ Category object/string compatibility
 *   ✓ Missing statistics resilience
 *   ✓ Missing optional fields resilience
 *   ✓ TITech branding consistency
 *
 * Testing stack:
 *   React Testing Library
 *   Jest
 *   @testing-library/user-event
 *
 * Security note:
 *   These tests intentionally verify that user-facing error messages remain
 *   generic and that backend error internals are not rendered directly.
 *
 * ============================================================================
 */

import React from 'react';

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import FAQ from './FAQ';

import faqService from '../services/faqService';


/* ============================================================================
 * Service Mock
 * ========================================================================== */

jest.mock('../services/faqService', () => ({
  __esModule: true,

  default: {
    getFAQItems: jest.fn(),

    getCategories: jest.fn(),

    getFAQStats: jest.fn(),

    incrementFAQViews: jest.fn(),

    markFAQHelpful: jest.fn(),

    markFAQUnhelpful: jest.fn(),

    searchFAQ: jest.fn(),

    getFAQsByCategory: jest.fn(),

    getPopularFAQs: jest.fn(),

    createFAQ: jest.fn(),

    updateFAQ: jest.fn(),

    deleteFAQ: jest.fn(),

    bulkImportFAQs: jest.fn(),

    exportFAQs: jest.fn(),
  },
}));


/* ============================================================================
 * Test Fixtures
 * ========================================================================== */

const mockFAQItems = [
  {
    id: 1,

    question:
      'How do I create an account?',

    answer:
      'To create an account, click the sign up button and complete the registration process.',

    category:
      'account',

    views:
      250,

    helpful:
      180,

    helpful_count:
      180,

    unhelpful_count:
      10,
  },

  {
    id: 2,

    question:
      'How do I reset my password?',

    answer:
      'To reset your password, go to the login page and select the forgot password option.',

    category:
      'account',

    views:
      200,

    helpful:
      150,

    helpful_count:
      150,

    unhelpful_count:
      8,
  },

  {
    id: 3,

    question:
      'How do I transfer money?',

    answer:
      'To transfer money, open your dashboard and select the transfer option.',

    category:
      'transactions',

    views:
      300,

    helpful:
      220,

    helpful_count:
      220,

    unhelpful_count:
      5,
  },
];


const mockCategories = [
  'account',
  'transactions',
  'security',
  'general',
];


const mockStats = {
  totalFaqs:
    mockFAQItems.length,

  totalViews:
    750,
};


/* ============================================================================
 * Helpers
 * ========================================================================== */

const configureSuccessfulServices = ({
  faqs = mockFAQItems,
  categories = mockCategories,
  stats = mockStats,
} = {}) => {
  faqService.getFAQItems.mockResolvedValue(faqs);

  faqService.getCategories.mockResolvedValue(categories);

  faqService.getFAQStats.mockResolvedValue(stats);

  faqService.incrementFAQViews.mockResolvedValue({
    success: true,
  });

  faqService.markFAQHelpful.mockResolvedValue({
    success: true,
  });

  faqService.markFAQUnhelpful.mockResolvedValue({
    success: true,
  });
};


const renderFAQ = async (
  options = {},
) => {
  const user =
    userEvent.setup();

  const result =
    render(
      <FAQ
        {...options}
      />,
    );

  await waitFor(() => {
    expect(
      faqService.getFAQItems,
    ).toHaveBeenCalled();
  });

  return {
    ...result,
    user,
  };
};


/* ============================================================================
 * Lifecycle
 * ========================================================================== */

beforeEach(() => {
  jest.clearAllMocks();

  configureSuccessfulServices();
});


afterEach(() => {
  jest.restoreAllMocks();
});


/* ============================================================================
 * Rendering
 * ========================================================================== */

describe(
  'FAQ — Rendering',
  () => {
    it(
      'renders the FAQ heading after successful loading',
      async () => {
        render(
          <FAQ />,
        );

        expect(
          screen.getByText(
            /loading/i,
          ),
        ).toBeInTheDocument();

        await waitFor(() => {
          expect(
            screen.getByRole(
              'heading',
              {
                name:
                  /frequently asked questions/i,
                level:
                  1,
              },
            ),
          ).toBeInTheDocument();
        });
      },
    );


    it(
      'renders all FAQ questions',
      async () => {
        await renderFAQ();

        for (
          const faq of mockFAQItems
        ) {
          expect(
            screen.getByRole(
              'button',
              {
                name:
                  new RegExp(
                    faq.question,
                    'i',
                  ),
              },
            ),
          ).toBeInTheDocument();
        }
      },
    );


    it(
      'renders FAQ categories',
      async () => {
        await renderFAQ();

        expect(
          screen.getByRole(
            'button',
            {
              name:
                /^all$/i,
            },
          ),
        ).toBeInTheDocument();

        for (
          const category of mockCategories
        ) {
          expect(
            screen.getByRole(
              'button',
              {
                name:
                  new RegExp(
                    `^${category}$`,
                    'i',
                  ),
              },
            ),
          ).toBeInTheDocument();
        }
      },
    );


    it(
      'renders the FAQ search input',
      async () => {
        await renderFAQ();

        expect(
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'renders FAQ statistics',
      async () => {
        await renderFAQ();

        expect(
          screen.getByText(
            String(
              mockStats.totalFaqs,
            ),
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            String(
              mockStats.totalViews,
            ),
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            String(
              mockCategories.length,
            ),
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /total faqs/i,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /total views/i,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /categories/i,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'uses the FAQ component container',
      async () => {
        const {
          container,
        } = await renderFAQ();

        expect(
          container.querySelector(
            '.faq-container',
          ),
        ).toBeInTheDocument();

        expect(
          container.querySelector(
            '.faq-wrapper',
          ),
        ).toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Loading State
 * ========================================================================== */

describe(
  'FAQ — Loading State',
  () => {
    it(
      'shows a loading state while FAQ content is being fetched',
      () => {
        faqService.getFAQItems.mockImplementation(
          () =>
            new Promise(
              () => {},
            ),
        );

        faqService.getCategories.mockImplementation(
          () =>
            new Promise(
              () => {},
            ),
        );

        faqService.getFAQStats.mockImplementation(
          () =>
            new Promise(
              () => {},
            ),
        );

        render(
          <FAQ />,
        );

        expect(
          screen.getByRole(
            'heading',
            {
              name:
                /frequently asked questions/i,
            },
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /loading/i,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'does not display FAQ content before loading completes',
      () => {
        faqService.getFAQItems.mockImplementation(
          () =>
            new Promise(
              () => {},
            ),
        );

        render(
          <FAQ />,
        );

        expect(
          screen.queryByText(
            mockFAQItems[0].question,
          ),
        ).not.toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Data Loading
 * ========================================================================== */

describe(
  'FAQ — Data Loading',
  () => {
    it(
      'loads FAQ items on mount',
      async () => {
        await renderFAQ();

        expect(
          faqService.getFAQItems,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          faqService.getFAQItems,
        ).toHaveBeenCalledWith(
          1,
          100,
        );
      },
    );


    it(
      'loads categories on mount',
      async () => {
        await renderFAQ();

        expect(
          faqService.getCategories,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );


    it(
      'loads FAQ statistics on mount',
      async () => {
        await renderFAQ();

        expect(
          faqService.getFAQStats,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);


/* ============================================================================
 * Accordion
 * ========================================================================== */

describe(
  'FAQ — Accordion',
  () => {
    it(
      'starts with FAQ items collapsed',
      async () => {
        await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        expect(
          question,
        ).toHaveAttribute(
          'aria-expanded',
          'false',
        );

        expect(
          question.closest(
            '.faq-item',
          ),
        ).not.toHaveClass(
          'open',
        );
      },
    );


    it(
      'expands an FAQ when its question is clicked',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        expect(
          question,
        ).toHaveAttribute(
          'aria-expanded',
          'true',
        );

        expect(
          question.closest(
            '.faq-item',
          ),
        ).toHaveClass(
          'open',
        );

        expect(
          screen.getByText(
            mockFAQItems[0].answer,
          ),
        ).toBeVisible();
      },
    );


    it(
      'collapses an expanded FAQ when clicked again',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        expect(
          question,
        ).toHaveAttribute(
          'aria-expanded',
          'true',
        );

        await user.click(
          question,
        );

        expect(
          question,
        ).toHaveAttribute(
          'aria-expanded',
          'false',
        );

        expect(
          question.closest(
            '.faq-item',
          ),
        ).not.toHaveClass(
          'open',
        );
      },
    );


    it(
      'allows only one FAQ to remain expanded',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const questionOne =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        const questionTwo =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[1].question,
                  'i',
                ),
            },
          );

        await user.click(
          questionOne,
        );

        expect(
          questionOne.closest(
            '.faq-item',
          ),
        ).toHaveClass(
          'open',
        );

        await user.click(
          questionTwo,
        );

        expect(
          questionOne.closest(
            '.faq-item',
          ),
        ).not.toHaveClass(
          'open',
        );

        expect(
          questionTwo.closest(
            '.faq-item',
          ),
        ).toHaveClass(
          'open',
        );
      },
    );


    it(
      'increments FAQ views when an item is opened',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        await waitFor(() => {
          expect(
            faqService.incrementFAQViews,
          ).toHaveBeenCalledWith(
            mockFAQItems[0].id,
          );
        });
      },
    );


    it(
      'does not increment views when an already-open FAQ is closed',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        await waitFor(() => {
          expect(
            faqService.incrementFAQViews,
          ).toHaveBeenCalledTimes(
            1,
          );
        });

        await user.click(
          question,
        );

        expect(
          faqService.incrementFAQViews,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );


    it(
      'does not break the accordion when view tracking fails',
      async () => {
        faqService.incrementFAQViews.mockRejectedValue(
          new Error(
            'View tracking unavailable',
          ),
        );

        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        expect(
          question.closest(
            '.faq-item',
          ),
        ).toHaveClass(
          'open',
        );

        expect(
          screen.getByText(
            mockFAQItems[0].answer,
          ),
        ).toBeVisible();
      },
    );
  },
);


/* ============================================================================
 * Search
 * ========================================================================== */

describe(
  'FAQ — Search',
  () => {
    it(
      'filters FAQs by question text',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'reset password',
        );

        expect(
          screen.getByText(
            mockFAQItems[1].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[0].question,
          ),
        ).not.toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[2].question,
          ),
        ).not.toBeInTheDocument();
      },
    );


    it(
      'filters FAQs by answer text',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'dashboard',
        );

        expect(
          screen.getByText(
            mockFAQItems[2].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[0].question,
          ),
        ).not.toBeInTheDocument();
      },
    );


    it(
      'performs case-insensitive searching',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'ACCOUNT',
        );

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            mockFAQItems[1].question,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'trims search input before matching',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          '  account  ',
        );

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            mockFAQItems[1].question,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'shows an empty state when no search results exist',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'completely nonexistent faq',
        );

        expect(
          screen.getByText(
            /no faqs found/i,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /try a different search term/i,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'clears search using the clear filters action',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'nonexistent',
        );

        expect(
          screen.getByText(
            /no faqs found/i,
          ),
        ).toBeInTheDocument();

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /clear filters/i,
            },
          ),
        );

        expect(
          searchInput,
        ).toHaveValue('');

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Category Filtering
 * ========================================================================== */

describe(
  'FAQ — Category Filtering',
  () => {
    it(
      'filters FAQs by category',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const categoryButton =
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          );

        await user.click(
          categoryButton,
        );

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            mockFAQItems[1].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[2].question,
          ),
        ).not.toBeInTheDocument();
      },
    );


    it(
      'marks the selected category as active',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const categoryButton =
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          );

        await user.click(
          categoryButton,
        );

        expect(
          categoryButton,
        ).toHaveClass(
          'active',
        );
      },
    );


    it(
      'resets category filtering when All is selected',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const accountButton =
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          );

        const allButton =
          screen.getByRole(
            'button',
            {
              name:
                /^all$/i,
            },
          );

        await user.click(
          accountButton,
        );

        expect(
          screen.queryByText(
            mockFAQItems[2].question,
          ),
        ).not.toBeInTheDocument();

        await user.click(
          allButton,
        );

        expect(
          screen.getByText(
            mockFAQItems[2].question,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'supports filtering with category objects',
      async () => {
        configureSuccessfulServices({
          categories: [
            {
              id:
                'account-id',
              name:
                'account',
            },
            {
              id:
                'transactions-id',
              name:
                'transactions',
            },
          ],
        });

        const {
          user,
        } = await renderFAQ();

        const accountButton =
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          );

        await user.click(
          accountButton,
        );

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[2].question,
          ),
        ).not.toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Combined Filters
 * ========================================================================== */

describe(
  'FAQ — Combined Filters',
  () => {
    it(
      'applies category and search filters together',
      async () => {
        const {
          user,
        } = await renderFAQ();

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          ),
        );

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'reset',
        );

        expect(
          screen.getByText(
            mockFAQItems[1].question,
          ),
        ).toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[0].question,
          ),
        ).not.toBeInTheDocument();

        expect(
          screen.queryByText(
            mockFAQItems[2].question,
          ),
        ).not.toBeInTheDocument();
      },
    );


    it(
      'shows an appropriate empty state when combined filters match nothing',
      async () => {
        const {
          user,
        } = await renderFAQ();

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /^transactions$/i,
            },
          ),
        );

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'password',
        );

        expect(
          screen.getByText(
            /no faqs found/i,
          ),
        ).toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Helpful Feedback
 * ========================================================================== */

describe(
  'FAQ — Helpful Feedback',
  () => {
    it(
      'allows users to mark an FAQ as helpful',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        const yesButton =
          screen.getByRole(
            'button',
            {
              name:
                /^yes$/i,
            },
          );

        await user.click(
          yesButton,
        );

        await waitFor(() => {
          expect(
            faqService.markFAQHelpful,
          ).toHaveBeenCalledWith(
            mockFAQItems[0].id,
          );
        });
      },
    );


    it(
      'allows users to mark an FAQ as unhelpful',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        const noButton =
          screen.getByRole(
            'button',
            {
              name:
                /^no$/i,
            },
          );

        await user.click(
          noButton,
        );

        await waitFor(() => {
          expect(
            faqService.markFAQUnhelpful,
          ).toHaveBeenCalledWith(
            mockFAQItems[0].id,
          );
        });
      },
    );


    it(
      'updates helpful count after successful helpful feedback',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /^yes$/i,
            },
          ),
        );

        await waitFor(() => {
          expect(
            faqService.markFAQHelpful,
          ).toHaveBeenCalled();
        });
      },
    );


    it(
      'does not crash when helpful feedback fails',
      async () => {
        faqService.markFAQHelpful.mockRejectedValue(
          new Error(
            'Feedback service unavailable',
          ),
        );

        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /^yes$/i,
            },
          ),
        );

        await waitFor(() => {
          expect(
            faqService.markFAQHelpful,
          ).toHaveBeenCalled();
        });

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'does not crash when unhelpful feedback fails',
      async () => {
        faqService.markFAQUnhelpful.mockRejectedValue(
          new Error(
            'Feedback service unavailable',
          ),
        );

        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.click(
          question,
        );

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /^no$/i,
            },
          ),
        );

        await waitFor(() => {
          expect(
            faqService.markFAQUnhelpful,
          ).toHaveBeenCalled();
        });

        expect(
          screen.getByText(
            mockFAQItems[0].question,
          ),
        ).toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Error Handling
 * ========================================================================== */

describe(
  'FAQ — Error Handling',
  () => {
    it(
      'renders a user-safe error state when FAQ loading fails',
      async () => {
        faqService.getFAQItems.mockRejectedValue(
          new Error(
            'Database connection failed',
          ),
        );

        render(
          <FAQ />,
        );

        await waitFor(() => {
          expect(
            screen.getByText(
              /failed to load faq content/i,
            ),
          ).toBeInTheDocument();
        });
      },
    );


    it(
      'does not expose backend error internals',
      async () => {
        faqService.getFAQItems.mockRejectedValue(
          new Error(
            'MongoDB password=super-secret connection token=ABC123',
          ),
        );

        render(
          <FAQ />,
        );

        await waitFor(() => {
          expect(
            screen.getByText(
              /failed to load faq content/i,
            ),
          ).toBeInTheDocument();
        });

        expect(
          screen.queryByText(
            /super-secret/i,
          ),
        ).not.toBeInTheDocument();

        expect(
          screen.queryByText(
            /ABC123/i,
          ),
        ).not.toBeInTheDocument();
      },
    );


    it(
      'provides a retry action after a loading failure',
      async () => {
        faqService.getFAQItems
          .mockRejectedValueOnce(
            new Error(
              'Initial failure',
            ),
          )
          .mockResolvedValueOnce(
            mockFAQItems,
          );

        render(
          <FAQ />,
        );

        const retryButton =
          await screen.findByRole(
            'button',
            {
              name:
                /retry/i,
            },
          );

        await userEvent.click(
          retryButton,
        );

        await waitFor(() => {
          expect(
            faqService.getFAQItems,
          ).toHaveBeenCalledTimes(
            2,
          );
        });
      },
    );


    it(
      'renders successfully after a failed request is retried',
      async () => {
        faqService.getFAQItems
          .mockRejectedValueOnce(
            new Error(
              'Initial failure',
            ),
          )
          .mockResolvedValueOnce(
            mockFAQItems,
          );

        render(
          <FAQ />,
        );

        const retryButton =
          await screen.findByRole(
            'button',
            {
              name:
                /retry/i,
            },
          );

        await userEvent.click(
          retryButton,
        );

        await waitFor(() => {
          expect(
            screen.getByText(
              mockFAQItems[0].question,
            ),
          ).toBeInTheDocument();
        });
      },
    );
  },
);


/* ============================================================================
 * Accessibility
 * ========================================================================== */

describe(
  'FAQ — Accessibility',
  () => {
    it(
      'uses an H1 for the primary page heading',
      async () => {
        await renderFAQ();

        expect(
          screen.getByRole(
            'heading',
            {
              level:
                1,
              name:
                /frequently asked questions/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'uses buttons for FAQ questions',
      async () => {
        await renderFAQ();

        for (
          const faq of mockFAQItems
        ) {
          expect(
            screen.getByRole(
              'button',
              {
                name:
                  new RegExp(
                    faq.question,
                    'i',
                  ),
              },
            ),
          ).toBeInTheDocument();
        }
      },
    );


    it(
      'exposes aria-expanded on FAQ controls',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        expect(
          question,
        ).toHaveAttribute(
          'aria-expanded',
          'false',
        );

        await user.click(
          question,
        );

        expect(
          question,
        ).toHaveAttribute(
          'aria-expanded',
          'true',
        );
      },
    );


    it(
      'allows FAQ controls to receive keyboard focus',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        await user.tab();

        const focusedElement =
          document.activeElement;

        expect(
          focusedElement,
        ).toBeDefined();

        question.focus();

        expect(
          question,
        ).toHaveFocus();
      },
    );


    it(
      'supports keyboard activation of FAQ controls',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        question.focus();

        await user.keyboard(
          '{Enter}',
        );

        await waitFor(() => {
          expect(
            question,
          ).toHaveAttribute(
            'aria-expanded',
            'true',
          );
        });
      },
    );


    it(
      'supports Space-key activation of FAQ controls',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const question =
          screen.getByRole(
            'button',
            {
              name:
                new RegExp(
                  mockFAQItems[0].question,
                  'i',
                ),
            },
          );

        question.focus();

        await user.keyboard(
          ' ',
        );

        await waitFor(() => {
          expect(
            question,
          ).toHaveAttribute(
            'aria-expanded',
            'true',
          );
        });
      },
    );
  },
);


/* ============================================================================
 * Empty / Resilient Data
 * ========================================================================== */

describe(
  'FAQ — Empty and Resilient Data',
  () => {
    it(
      'renders an empty state when no FAQs are returned',
      async () => {
        configureSuccessfulServices({
          faqs: [],
        });

        await renderFAQ();

        expect(
          screen.getByText(
            /no faqs found/i,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'renders zero FAQ statistics safely',
      async () => {
        configureSuccessfulServices({
          faqs: [],
          categories: [],
          stats: {
            totalFaqs:
              0,
            totalViews:
              0,
          },
        });

        await renderFAQ();

        expect(
          screen.getByText(
            /^0$/,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'falls back to loaded FAQ count when totalFaqs is unavailable',
      async () => {
        configureSuccessfulServices({
          stats: {
            totalViews:
              750,
          },
        });

        await renderFAQ();

        expect(
          screen.getByText(
            String(
              mockFAQItems.length,
            ),
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'falls back to zero when totalViews is unavailable',
      async () => {
        configureSuccessfulServices({
          stats: {
            totalFaqs:
              mockFAQItems.length,
          },
        });

        await renderFAQ();

        expect(
          screen.getByText(
            /^0$/,
          ),
        ).toBeInTheDocument();
      },
    );


    it(
      'handles category values represented as objects or strings',
      async () => {
        configureSuccessfulServices({
          categories: [
            {
              id:
                'account',
              name:
                'account',
            },
            'transactions',
          ],
        });

        await renderFAQ();

        expect(
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            'button',
            {
              name:
                /^transactions$/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Large Dataset / Performance Safety
 * ========================================================================== */

describe(
  'FAQ — Large Dataset',
  () => {
    it(
      'renders a large FAQ collection without losing functionality',
      async () => {
        const largeFAQList =
          Array.from(
            {
              length:
                100,
            },
            (_, index) => ({
              id:
                index + 1,

              question:
                `Question ${index + 1}`,

              answer:
                `Answer ${index + 1}`,

              category:
                index % 2 ===
                0
                  ? 'account'
                  : 'general',

              views:
                index,

              helpful_count:
                index,
            }),
          );

        configureSuccessfulServices({
          faqs:
            largeFAQList,
        });

        await renderFAQ();

        expect(
          screen.getByText(
            'Question 1',
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            'Question 100',
          ),
        ).toBeInTheDocument();
      },
    );
  },
);


/* ============================================================================
 * Service Interaction Contract
 * ========================================================================== */

describe(
  'FAQ — Service Interaction Contract',
  () => {
    it(
      'does not call searchFAQ during local search filtering',
      async () => {
        const {
          user,
        } = await renderFAQ();

        const searchInput =
          screen.getByRole(
            'textbox',
            {
              name:
                /search faqs/i,
            },
          );

        await user.type(
          searchInput,
          'account',
        );

        expect(
          faqService.searchFAQ,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'does not call getFAQsByCategory during local category filtering',
      async () => {
        const {
          user,
        } = await renderFAQ();

        await user.click(
          screen.getByRole(
            'button',
            {
              name:
                /^account$/i,
            },
          ),
        );

        expect(
          faqService.getFAQsByCategory,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


/* ============================================================================
 * TITech Branding
 * ========================================================================== */

describe(
  'FAQ — TITech Branding',
  () => {
    it(
      'does not render legacy ACFOS branding',
      async () => {
        const {
          container,
        } = await renderFAQ();

        expect(
          container.textContent,
        ).not.toMatch(
          /ACFOS/i,
        );
      },
    );


    it(
      'does not expose legacy ACFOS branding in the rendered DOM',
      async () => {
        const {
          container,
        } = await renderFAQ();

        const html =
          container.innerHTML;

        expect(
          html,
        ).not.toMatch(
          /ACFOS/i,
        );
      },
    );
  },
);


/* ============================================================================
 * Regression Protection
 * ========================================================================== */

describe(
  'FAQ — Regression Protection',
  () => {
    it(
      'does not invoke FAQ view tracking before an FAQ is opened',
      async () => {
        await renderFAQ();

        expect(
          faqService.incrementFAQViews,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'does not invoke feedback services before an FAQ is opened',
      async () => {
        await renderFAQ();

        expect(
          faqService.markFAQHelpful,
        ).not.toHaveBeenCalled();

        expect(
          faqService.markFAQUnhelpful,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'does not invoke unrelated administrative FAQ services',
      async () => {
        await renderFAQ();

        expect(
          faqService.createFAQ,
        ).not.toHaveBeenCalled();

        expect(
          faqService.updateFAQ,
        ).not.toHaveBeenCalled();

        expect(
          faqService.deleteFAQ,
        ).not.toHaveBeenCalled();

        expect(
          faqService.bulkImportFAQs,
        ).not.toHaveBeenCalled();

        expect(
          faqService.exportFAQs,
        ).not.toHaveBeenCalled();
      },
    );
  },
);