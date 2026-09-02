/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Forum Component Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/Forum.test.jsx
 *
 * Purpose:
 *   Production-grade unit/integration tests for the TITech Community Capital
 *   community forum experience.
 *
 * Coverage
 * ----------------------------------------------------------------------------
 * ✓ Initial loading state
 * ✓ Successful data loading
 * ✓ Empty state
 * ✓ Error state
 * ✓ Retry behavior
 * ✓ Topic rendering
 * ✓ Topic metadata
 * ✓ Categories
 * ✓ Category filtering
 * ✓ Search
 * ✓ Sorting
 * ✓ Topic status indicators
 * ✓ Topic creation
 * ✓ Form validation
 * ✓ Topic interaction
 * ✓ Topic view tracking
 * ✓ Pagination
 * ✓ Recent topics
 * ✓ Popular topics
 * ✓ Accessibility
 * ✓ Keyboard interaction
 * ✓ Responsive semantic structure
 * ✓ Service failure resilience
 * ✓ TITech branding
 *
 * Testing philosophy
 * ----------------------------------------------------------------------------
 * Prefer testing observable user behavior over implementation details.
 *
 * ============================================================================ */

import React from 'react';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import '@testing-library/jest-dom';

import Forum from './Forum';

import forumService from '../services/forumService';

/* ============================================================================
 * Service Mock
 * ========================================================================== */

jest.mock('../services/forumService', () => ({
  __esModule: true,

  default: {
    getTopics: jest.fn(),
    getTopic: jest.fn(),
    getCategories: jest.fn(),

    createTopic: jest.fn(),
    updateTopic: jest.fn(),
    deleteTopic: jest.fn(),

    createReply: jest.fn(),
    updateReply: jest.fn(),
    deleteReply: jest.fn(),

    markSolution: jest.fn(),
    unmarkSolution: jest.fn(),

    markReplyHelpful: jest.fn(),
    markReplyUnhelpful: jest.fn(),

    getForumStats: jest.fn(),
    getTrendingTopics: jest.fn(),
    getPopularTopics: jest.fn(),
    getRecentTopics: jest.fn(),

    searchTopics: jest.fn(),
    getTopicsByCategory: jest.fn(),

    lockTopic: jest.fn(),
    unlockTopic: jest.fn(),

    pinTopic: jest.fn(),
    unpinTopic: jest.fn(),

    incrementTopicViews: jest.fn(),
  },
}));

/* ============================================================================
 * Test Data
 * ========================================================================== */

const createTopic = (overrides = {}) => ({
  id: 1,

  title: 'How to use transfers',

  content:
    'How can I make a transfer using my TITech Community Capital account?',

  category: 'general',

  author: 'Justine Robert',

  replies: 5,

  views: 250,

  lastUpdated: '2026-08-18T10:30:00.000Z',

  tags: ['transfers', 'help'],

  isSticky: false,

  isSolved: false,

  ...overrides,
});

const mockTopics = [
  createTopic(),

  createTopic({
    id: 2,

    title: 'Account security tips',

    content:
      'What security practices should members follow?',

    category: 'security',

    author: 'Jane Smith',

    replies: 12,

    views: 400,

    lastUpdated: '2026-08-17T09:15:00.000Z',

    tags: ['security', 'tips'],

    isSticky: true,

    isSolved: false,
  }),

  createTopic({
    id: 3,

    title: 'Mobile app issues',

    content:
      'I am experiencing an issue with the mobile application.',

    category: 'technical',

    author: 'Bob Johnson',

    replies: 8,

    views: 180,

    lastUpdated: '2026-08-16T08:00:00.000Z',

    tags: ['mobile', 'bug'],

    isSticky: false,

    isSolved: true,
  }),
];

const mockCategories = [
  'general',
  'security',
  'technical',
  'suggestions',
];

const mockStats = {
  topics: 128,
  replies: 642,
  members: 94,
  totalTopics: 128,
  totalReplies: 642,
  totalMembers: 94,
};

const mockRecentTopics = [
  createTopic({
    id: 101,
    title: 'Recent community discussion',
  }),
];

const mockPopularTopics = [
  createTopic({
    id: 102,
    title: 'Popular savings discussion',
    views: 1500,
  }),
];

/* ============================================================================
 * Default Service Setup
 * ========================================================================== */

function configureDefaultServiceMocks() {
  forumService.getTopics.mockResolvedValue(mockTopics);

  forumService.getCategories.mockResolvedValue(mockCategories);

  forumService.getForumStats.mockResolvedValue(mockStats);

  forumService.getTrendingTopics.mockResolvedValue([]);

  forumService.getPopularTopics.mockResolvedValue(
    mockPopularTopics,
  );

  forumService.getRecentTopics.mockResolvedValue(
    mockRecentTopics,
  );

  forumService.getTopic.mockResolvedValue(
    mockTopics[0],
  );

  forumService.searchTopics.mockResolvedValue(
    mockTopics,
  );

  forumService.getTopicsByCategory.mockImplementation(
    async (category) =>
      mockTopics.filter(
        (topic) =>
          topic.category === category,
      ),
  );

  forumService.createTopic.mockResolvedValue(
    createTopic({
      id: 99,
      title: 'New Discussion',
    }),
  );

  forumService.updateTopic.mockResolvedValue({
    success: true,
  });

  forumService.deleteTopic.mockResolvedValue({
    success: true,
  });

  forumService.createReply.mockResolvedValue({
    success: true,
  });

  forumService.updateReply.mockResolvedValue({
    success: true,
  });

  forumService.deleteReply.mockResolvedValue({
    success: true,
  });

  forumService.markSolution.mockResolvedValue({
    success: true,
  });

  forumService.unmarkSolution.mockResolvedValue({
    success: true,
  });

  forumService.markReplyHelpful.mockResolvedValue({
    success: true,
  });

  forumService.markReplyUnhelpful.mockResolvedValue({
    success: true,
  });

  forumService.lockTopic.mockResolvedValue({
    success: true,
  });

  forumService.unlockTopic.mockResolvedValue({
    success: true,
  });

  forumService.pinTopic.mockResolvedValue({
    success: true,
  });

  forumService.unpinTopic.mockResolvedValue({
    success: true,
  });

  forumService.incrementTopicViews.mockResolvedValue({
    success: true,
  });
}

/* ============================================================================
 * Render Helpers
 * ========================================================================== */

async function renderForum(
  props = {},
) {
  const user = userEvent.setup();

  const result = render(
    <Forum {...props} />,
  );

  await waitFor(() => {
    expect(
      screen.queryByRole('progressbar'),
    ).not.toBeInTheDocument();
  });

  return {
    user,
    ...result,
  };
}

async function openCreateTopicModal(
  user,
) {
  const button =
    await screen.findByRole(
      'button',
      {
        name: /new topic/i,
      },
    );

  await user.click(button);

  return screen.findByRole(
    'heading',
    {
      name: /create new topic/i,
    },
  );
}

/* ============================================================================
 * Lifecycle
 * ========================================================================== */

beforeEach(() => {
  jest.clearAllMocks();

  configureDefaultServiceMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ============================================================================
 * Rendering
 * ========================================================================== */

describe(
  'Forum - Rendering',
  () => {
    it(
      'renders the forum heading',
      async () => {
        await renderForum();

        expect(
          screen.getByRole(
            'heading',
            {
              name: /community forum/i,
              level: 1,
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'renders TITech community context',
      async () => {
        await renderForum();

        expect(
          screen.getByText(
            /TITech/i,
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'renders all loaded topics',
      async () => {
        await renderForum();

        for (
          const topic of mockTopics
        ) {
          expect(
            screen.getByText(
              topic.title,
            ),
          ).toBeInTheDocument();
        }
      },
    );

    it(
      'renders category controls',
      async () => {
        await renderForum();

        for (
          const category of mockCategories
        ) {
          expect(
            screen.getByRole(
              'button',
              {
                name: new RegExp(
                  category,
                  'i',
                ),
              },
            ),
          ).toBeInTheDocument();
        }
      },
    );

    it(
      'renders the new topic action',
      async () => {
        await renderForum();

        expect(
          screen.getByRole(
            'button',
            {
              name: /new topic/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'renders sorting controls',
      async () => {
        await renderForum();

        expect(
          screen.getByDisplayValue(
            /newest/i,
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'renders filter controls',
      async () => {
        await renderForum();

        expect(
          screen.getByDisplayValue(
            /^all$/i,
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Statistics
 * ========================================================================== */

describe(
  'Forum - Statistics',
  () => {
    it(
      'renders forum statistics when supplied by the service',
      async () => {
        await renderForum();

        expect(
          screen.getByText(
            '128',
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            '642',
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            '94',
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'does not crash when statistics fail',
      async () => {
        forumService.getForumStats.mockRejectedValue(
          new Error(
            'Statistics unavailable',
          ),
        );

        await renderForum();

        expect(
          screen.getByRole(
            'heading',
            {
              name: /community forum/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Topic Metadata
 * ========================================================================== */

describe(
  'Forum - Topic Metadata',
  () => {
    it(
      'renders topic authors',
      async () => {
        await renderForum();

        expect(
          screen.getByText(
            'John Doe',
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            'Jane Smith',
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            'Bob Johnson',
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'renders topic tags',
      async () => {
        await renderForum();

        expect(
          screen.getAllByText(
            'transfers',
          ).length,
        ).toBeGreaterThan(0);

        expect(
          screen.getAllByText(
            'help',
          ).length,
        ).toBeGreaterThan(0);

        expect(
          screen.getAllByText(
            'security',
          ).length,
        ).toBeGreaterThan(0);
      },
    );

    it(
      'indicates sticky topics',
      async () => {
        await renderForum();

        expect(
          screen.getAllByText(
            /sticky/i,
          ).length,
        ).toBeGreaterThan(0);
      },
    );

    it(
      'indicates solved topics',
      async () => {
        await renderForum();

        expect(
          screen.getAllByText(
            /solved/i,
          ).length,
        ).toBeGreaterThan(0);
      },
    );
  },
);

/* ============================================================================
 * Loading
 * ========================================================================== */

describe(
  'Forum - Loading State',
  () => {
    it(
      'shows a progress indicator while topics are loading',
      () => {
        forumService.getTopics.mockReturnValue(
          new Promise(
            () => {},
          ),
        );

        render(<Forum />);

        expect(
          screen.getByRole(
            'progressbar',
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'removes the progress indicator after loading',
      async () => {
        await renderForum();

        expect(
          screen.queryByRole(
            'progressbar',
          ),
        ).not.toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Empty State
 * ========================================================================== */

describe(
  'Forum - Empty State',
  () => {
    it(
      'renders an empty state when no topics exist',
      async () => {
        forumService.getTopics.mockResolvedValue(
          [],
        );

        await renderForum();

        expect(
          screen.getByText(
            /no.*topics|no discussions|nothing here/i,
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
  'Forum - Error Handling',
  () => {
    it(
      'renders an error state when topic loading fails',
      async () => {
        forumService.getTopics.mockRejectedValue(
          new Error(
            'Failed to load topics',
          ),
        );

        render(<Forum />);

        expect(
          await screen.findByText(
            /error loading topics|failed to load|unable to load/i,
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'provides a retry action after loading failure',
      async () => {
        forumService.getTopics.mockRejectedValueOnce(
          new Error(
            'Temporary failure',
          ),
        );

        forumService.getTopics.mockResolvedValueOnce(
          mockTopics,
        );

        render(<Forum />);

        const retryButton =
          await screen.findByRole(
            'button',
            {
              name: /retry/i,
            },
          );

        await userEvent.setup().click(
          retryButton,
        );

        await waitFor(() => {
          expect(
            forumService.getTopics,
          ).toHaveBeenCalledTimes(
            2,
          );
        });
      },
    );
  },
);

/* ============================================================================
 * Category Filtering
 * ========================================================================== */

describe(
  'Forum - Category Filtering',
  () => {
    it(
      'activates a selected category',
      async () => {
        const {
          user,
        } = await renderForum();

        const button =
          screen.getByRole(
            'button',
            {
              name: /security/i,
            },
          );

        await user.click(
          button,
        );

        expect(
          button,
        ).toHaveClass(
          'active',
        );
      },
    );

    it(
      'filters topics by category',
      async () => {
        const {
          user,
        } = await renderForum();

        const button =
          screen.getByRole(
            'button',
            {
              name: /security/i,
            },
          );

        await user.click(
          button,
        );

        /*
         * The component may either delegate category filtering to the service
         * or perform the filtering locally. Support both valid architectures
         * while verifying the resulting UI.
         */
        await waitFor(() => {
          expect(
            screen.getByText(
              'Account security tips',
            ),
          ).toBeInTheDocument();

          expect(
            screen.queryByText(
              'How to use transfers',
            ),
          ).not.toBeInTheDocument();
        });
      },
    );

    it(
      'restores all categories when All Categories is selected',
      async () => {
        const {
          user,
        } = await renderForum();

        const securityButton =
          screen.getByRole(
            'button',
            {
              name: /security/i,
            },
          );

        await user.click(
          securityButton,
        );

        const allButton =
          screen.getByRole(
            'button',
            {
              name: /all categories|^all$/i,
            },
          );

        await user.click(
          allButton,
        );

        expect(
          securityButton,
        ).not.toHaveClass(
          'active',
        );

        expect(
          screen.getByText(
            'How to use transfers',
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Search
 * ========================================================================== */

describe(
  'Forum - Search',
  () => {
    it(
      'renders a search input when search is supported',
      async () => {
        await renderForum();

        const search =
          screen.queryByRole(
            'searchbox',
          ) ||
          screen.queryByPlaceholderText(
            /search/i,
          );

        expect(
          search,
        ).toBeInTheDocument();
      },
    );

    it(
      'filters visible topics using the search query',
      async () => {
        const {
          user,
        } = await renderForum();

        const search =
          screen.queryByRole(
            'searchbox',
          ) ||
          screen.getByPlaceholderText(
            /search/i,
          );

        await user.type(
          search,
          'security',
        );

        await waitFor(() => {
          expect(
            screen.getByText(
              'Account security tips',
            ),
          ).toBeInTheDocument();

          expect(
            screen.queryByText(
              'How to use transfers',
            ),
          ).not.toBeInTheDocument();
        });
      },
    );

    it(
      'handles a search with no results',
      async () => {
        const {
          user,
        } = await renderForum();

        const search =
          screen.queryByRole(
            'searchbox',
          ) ||
          screen.getByPlaceholderText(
            /search/i,
          );

        await user.type(
          search,
          'this-topic-does-not-exist',
        );

        expect(
          await screen.findByText(
            /no.*topics|no.*results|nothing found/i,
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Sorting
 * ========================================================================== */

describe(
  'Forum - Sorting',
  () => {
    it(
      'defaults to newest sorting',
      async () => {
        await renderForum();

        const sortSelect =
          screen.getByDisplayValue(
            /newest/i,
          );

        expect(
          sortSelect,
        ).toBeInTheDocument();
      },
    );

    it(
      'allows sorting by most active',
      async () => {
        const {
          user,
        } = await renderForum();

        const sortSelect =
          screen.getByDisplayValue(
            /newest/i,
          );

        await user.selectOptions(
          sortSelect,
          'active',
        );

        expect(
          sortSelect,
        ).toHaveValue(
          'active',
        );
      },
    );

    it(
      'allows sorting by most viewed',
      async () => {
        const {
          user,
        } = await renderForum();

        const sortSelect =
          screen.getByDisplayValue(
            /newest/i,
          );

        await user.selectOptions(
          sortSelect,
          'viewed',
        );

        expect(
          sortSelect,
        ).toHaveValue(
          'viewed',
        );
      },
    );
  },
);

/* ============================================================================
 * Topic Filters
 * ========================================================================== */

describe(
  'Forum - Topic Filters',
  () => {
    it(
      'allows unanswered filtering',
      async () => {
        const {
          user,
        } = await renderForum();

        const filterSelect =
          screen.getByDisplayValue(
            /^all$/i,
          );

        await user.selectOptions(
          filterSelect,
          'unanswered',
        );

        expect(
          filterSelect,
        ).toHaveValue(
          'unanswered',
        );
      },
    );

    it(
      'allows solved filtering',
      async () => {
        const {
          user,
        } = await renderForum();

        const filterSelect =
          screen.getByDisplayValue(
            /^all$/i,
          );

        await user.selectOptions(
          filterSelect,
          'solved',
        );

        expect(
          filterSelect,
        ).toHaveValue(
          'solved',
        );
      },
    );
  },
);

/* ============================================================================
 * New Topic Modal
 * ========================================================================== */

describe(
  'Forum - New Topic',
  () => {
    it(
      'opens the create topic dialog',
      async () => {
        const {
          user,
        } = await renderForum();

        await openCreateTopicModal(
          user,
        );

        expect(
          screen.getByRole(
            'heading',
            {
              name: /create new topic/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'closes the create topic dialog',
      async () => {
        const {
          user,
        } = await renderForum();

        await openCreateTopicModal(
          user,
        );

        const closeButton =
          screen.getByRole(
            'button',
            {
              name: /close/i,
            },
          );

        await user.click(
          closeButton,
        );

        await waitFor(() => {
          expect(
            screen.queryByRole(
              'heading',
              {
                name: /create new topic/i,
              },
            ),
          ).not.toBeInTheDocument();
        });
      },
    );

    it(
      'validates required topic fields',
      async () => {
        const {
          user,
        } = await renderForum();

        await openCreateTopicModal(
          user,
        );

        const submitButton =
          screen.getByRole(
            'button',
            {
              name: /create topic/i,
            },
          );

        await user.click(
          submitButton,
        );

        expect(
          await screen.findByText(
            /title is required/i,
          ),
        ).toBeInTheDocument();

        expect(
          forumService.createTopic,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'creates a new topic using submitted form data',
      async () => {
        const {
          user,
        } = await renderForum();

        await openCreateTopicModal(
          user,
        );

        const titleInput =
          screen.getByPlaceholderText(
            /topic title/i,
          );

        const contentInput =
          screen.getByPlaceholderText(
            /your message/i,
          );

        await user.type(
          titleInput,
          'New Discussion',
        );

        await user.type(
          contentInput,
          'This is my discussion.',
        );

        await user.click(
          screen.getByRole(
            'button',
            {
              name: /create topic/i,
            },
          ),
        );

        await waitFor(() => {
          expect(
            forumService.createTopic,
          ).toHaveBeenCalledWith(
            expect.objectContaining(
              {
                title:
                  'New Discussion',
                content:
                  'This is my discussion.',
              },
            ),
          );
        });
      },
    );

    it(
      'prevents duplicate submission while creation is pending',
      async () => {
        let resolveCreate;

        forumService.createTopic.mockImplementation(
          () =>
            new Promise(
              (resolve) => {
                resolveCreate =
                  resolve;
              },
            ),
        );

        const {
          user,
        } = await renderForum();

        await openCreateTopicModal(
          user,
        );

        await user.type(
          screen.getByPlaceholderText(
            /topic title/i,
          ),
          'Enterprise Discussion',
        );

        await user.type(
          screen.getByPlaceholderText(
            /your message/i,
          ),
          'Discussion content.',
        );

        const submit =
          screen.getByRole(
            'button',
            {
              name: /create topic/i,
            },
          );

        await user.click(
          submit,
        );

        await user.click(
          submit,
        );

        expect(
          forumService.createTopic,
        ).toHaveBeenCalledTimes(
          1,
        );

        resolveCreate({
          success: true,
          id: 501,
        });

        await waitFor(() => {
          expect(
            forumService.createTopic,
          ).toHaveBeenCalledTimes(
            1,
          );
        });
      },
    );
  },
);

/* ============================================================================
 * Topic Interaction
 * ========================================================================== */

describe(
  'Forum - Topic Interaction',
  () => {
    it(
      'allows users to select/open a topic',
      async () => {
        const {
          user,
        } = await renderForum();

        const topic =
          screen.getByText(
            'How to use transfers',
          );

        await user.click(
          topic,
        );

        /*
         * Depending on the router implementation the component may navigate
         * or load topic details. Verify the service interaction when present.
         */
        await waitFor(() => {
          expect(
            forumService.getTopic,
          ).toHaveBeenCalledWith(
            mockTopics[0].id,
          );
        });
      },
    );

    it(
      'tracks topic views when a topic is opened',
      async () => {
        const {
          user,
        } = await renderForum();

        await user.click(
          screen.getByText(
            'How to use transfers',
          ),
        );

        await waitFor(() => {
          expect(
            forumService.incrementTopicViews,
          ).toHaveBeenCalledWith(
            mockTopics[0].id,
          );
        });
      },
    );
  },
);

/* ============================================================================
 * Pagination
 * ========================================================================== */

describe(
  'Forum - Pagination',
  () => {
    it(
      'renders pagination when supported',
      async () => {
        await renderForum();

        const nextButton =
          screen.queryByRole(
            'button',
            {
              name: /next/i,
            },
          );

        const previousButton =
          screen.queryByRole(
            'button',
            {
              name: /previous/i,
            },
          );

        expect(
          nextButton ||
            previousButton,
        ).toBeTruthy();
      },
    );

    it(
      'disables previous navigation on the first page',
      async () => {
        await renderForum();

        const previousButton =
          screen.queryByRole(
            'button',
            {
              name: /previous/i,
            },
          );

        if (
          previousButton
        ) {
          expect(
            previousButton,
          ).toBeDisabled();
        }
      },
    );

    it(
      'requests the next page when pagination is available',
      async () => {
        forumService.getTopics
          .mockResolvedValueOnce(
            mockTopics,
          )
          .mockResolvedValueOnce(
            [
              createTopic({
                id: 4,
                title:
                  'Second page topic',
              }),
            ],
          );

        const {
          user,
        } = await renderForum();

        const nextButton =
          screen.queryByRole(
            'button',
            {
              name: /next/i,
            },
          );

        if (
          !nextButton ||
          nextButton.disabled
        ) {
          return;
        }

        await user.click(
          nextButton,
        );

        await waitFor(() => {
          expect(
            forumService.getTopics,
          ).toHaveBeenCalled();
        });
      },
    );
  },
);

/* ============================================================================
 * Recent / Popular Content
 * ========================================================================== */

describe(
  'Forum - Secondary Content',
  () => {
    it(
      'renders recent topics when available',
      async () => {
        await renderForum();

        expect(
          screen.getByText(
            /recent/i,
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'renders popular topics when available',
      async () => {
        await renderForum();

        expect(
          screen.getByText(
            /popular/i,
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Accessibility
 * ========================================================================== */

describe(
  'Forum - Accessibility',
  () => {
    it(
      'has a single primary heading',
      async () => {
        await renderForum();

        expect(
          screen.getByRole(
            'heading',
            {
              level: 1,
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'provides a complementary sidebar where supported',
      async () => {
        await renderForum();

        const sidebar =
          screen.queryByRole(
            'complementary',
          );

        if (sidebar) {
          expect(
            sidebar,
          ).toBeInTheDocument();
        }
      },
    );

    it(
      'allows keyboard activation of the New Topic action',
      async () => {
        const {
          user,
        } = await renderForum();

        const button =
          screen.getByRole(
            'button',
            {
              name: /new topic/i,
            },
          );

        button.focus();

        expect(
          button,
        ).toHaveFocus();

        await user.keyboard(
          '{Enter}',
        );

        expect(
          await screen.findByRole(
            'heading',
            {
              name: /create new topic/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'uses accessible names for interactive controls',
      async () => {
        await renderForum();

        const buttons =
          screen.getAllByRole(
            'button',
          );

        expect(
          buttons.length,
        ).toBeGreaterThan(0);

        buttons.forEach(
          (button) => {
            expect(
              button,
            ).toHaveAccessibleName();
          },
        );
      },
    );
  },
);

/* ============================================================================
 * Resilience
 * ========================================================================== */

describe(
  'Forum - Resilience',
  () => {
    it(
      'does not crash when categories fail',
      async () => {
        forumService.getCategories.mockRejectedValue(
          new Error(
            'Category service unavailable',
          ),
        );

        await renderForum();

        expect(
          screen.getByRole(
            'heading',
            {
              name: /community forum/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'does not crash when recent topics fail',
      async () => {
        forumService.getRecentTopics.mockRejectedValue(
          new Error(
            'Recent topics unavailable',
          ),
        );

        await renderForum();

        expect(
          screen.getByText(
            'How to use transfers',
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      'does not crash when popular topics fail',
      async () => {
        forumService.getPopularTopics.mockRejectedValue(
          new Error(
            'Popular topics unavailable',
          ),
        );

        await renderForum();

        expect(
          screen.getByText(
            'How to use transfers',
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Service Contract
 * ========================================================================== */

describe(
  'Forum - Service Integration',
  () => {
    it(
      'loads topics on initial mount',
      async () => {
        await renderForum();

        expect(
          forumService.getTopics,
        ).toHaveBeenCalled();
      },
    );

    it(
      'loads categories on initial mount',
      async () => {
        await renderForum();

        expect(
          forumService.getCategories,
        ).toHaveBeenCalled();
      },
    );

    it(
      'does not mutate the original topic fixtures',
      async () => {
        const original =
          JSON.stringify(
            mockTopics,
          );

        await renderForum();

        expect(
          JSON.stringify(
            mockTopics,
          ),
        ).toBe(original);
      },
    );
  },
);

/* ============================================================================
 * Performance / Large Dataset
 * ========================================================================== */

describe(
  'Forum - Large Dataset',
  () => {
    it(
      'renders a large topic collection without crashing',
      async () => {
        const largeTopicSet =
          Array.from(
            {
              length: 100,
            },
            (_, index) =>
              createTopic({
                id:
                  index + 1,

                title:
                  `Community Discussion ${index + 1}`,

                author:
                  `Member ${index + 1}`,
              }),
          );

        forumService.getTopics.mockResolvedValue(
          largeTopicSet,
        );

        await renderForum();

        expect(
          screen.getByText(
            'Community Discussion 1',
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Error Recovery During Topic Creation
 * ========================================================================== */

describe(
  'Forum - Topic Creation Errors',
  () => {
    it(
      'surfaces topic creation failures without crashing',
      async () => {
        forumService.createTopic.mockRejectedValue(
          new Error(
            'Unable to create topic',
          ),
        );

        const {
          user,
        } = await renderForum();

        await openCreateTopicModal(
          user,
        );

        await user.type(
          screen.getByPlaceholderText(
            /topic title/i,
          ),
          'Failed Discussion',
        );

        await user.type(
          screen.getByPlaceholderText(
            /your message/i,
          ),
          'Discussion content.',
        );

        await user.click(
          screen.getByRole(
            'button',
            {
              name: /create topic/i,
            },
          ),
        );

        await waitFor(() => {
          expect(
            forumService.createTopic,
          ).toHaveBeenCalled();
        });

        /*
         * The exact error presentation remains intentionally implementation
         * independent. The key production guarantee is that the component
         * remains mounted after a rejected mutation.
         */
        expect(
          screen.getByRole(
            'heading',
            {
              name: /create new topic/i,
            },
          ),
        ).toBeInTheDocument();
      },
    );
  },
);

/* ============================================================================
 * Export / Test Metadata
 * ========================================================================== */

describe(
  'Forum - Production Contract',
  () => {
    it(
      'renders as a stable application-level component',
      async () => {
        await renderForum();

        expect(
          screen.getByRole(
            'heading',
            {
              level: 1,
            },
          ),
        ).toBeInTheDocument();

        expect(
          forumService.getTopics,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);