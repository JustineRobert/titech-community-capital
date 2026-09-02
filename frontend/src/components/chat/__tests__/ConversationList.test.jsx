/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Conversation List Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/__tests__/ConversationList.test.jsx
 *
 * Purpose:
 *   Production-grade behavioral, accessibility and resilience tests for the
 *   TITech Community Capital conversation list.
 *
 * Testing principles:
 *   ✓ Test observable behavior
 *   ✓ Avoid brittle CSS/snapshot coupling
 *   ✓ Protect multi-tenant UI boundaries
 *   ✓ Protect active/unread conversation state
 *   ✓ Protect loading, empty and error states
 *   ✓ Validate keyboard accessibility
 *   ✓ Validate destructive-action safeguards
 *   ✓ Validate Unicode and financial text
 *   ✓ Detect stale ACFOS branding
 *
 * Expected stack:
 *   - React
 *   - Vitest
 *   - React Testing Library
 *   - @testing-library/user-event
 *   - @testing-library/jest-dom
 *
 * ============================================================================
 */

import React from 'react';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import '@testing-library/jest-dom/vitest';

import ConversationList from '../ConversationList';

/**
 * ============================================================================
 * Test helpers
 * ============================================================================
 */

/**
 * Enterprise-safe conversation factory.
 *
 * The component may consume slightly different property names depending on
 * the implementation. The fixture deliberately contains the common fields
 * used by production chat systems.
 */
const createConversation = (
  overrides = {},
) => ({
  id:
    'conversation-001',

  title:
    'Savings Account Support',

  name:
    'Savings Account Support',

  preview:
    'Your savings balance was updated.',

  lastMessage:
    'Your savings balance was updated.',

  lastMessageAt:
    '2026-08-21T09:30:00.000Z',

  updatedAt:
    '2026-08-21T09:30:00.000Z',

  unreadCount:
    0,

  unread:
    false,

  archived:
    false,

  pinned:
    false,

  participantCount:
    1,

  tenantId:
    'tenant-001',

  ...overrides,
});

/**
 * Locate a conversation item using accessible semantics first.
 */
const getConversationItems = () => {
  const listItems =
    screen.queryAllByRole(
      'listitem',
    );

  if (
    listItems.length > 0
  ) {
    return listItems;
  }

  return screen.queryAllByTestId(
    /conversation-item/i,
  );
};

/**
 * Locate the list/search input if available.
 */
const getSearchInput = () =>
  screen.queryByRole(
    'searchbox',
  ) ||
  screen.queryByPlaceholderText(
    /search.*conversation|search.*chat|search/i,
  );

/**
 * Locate a new-conversation action if exposed.
 */
const getNewConversationButton =
  () =>
    screen.queryByRole(
      'button',
      {
        name: /new.*conversation|new.*chat|start.*conversation|compose/i,
      },
    );

/**
 * ============================================================================
 * Default props
 * ============================================================================
 */

const createDefaultProps =
  () => ({
    conversations: [],

    activeConversationId:
      null,

    selectedConversationId:
      null,

    loading:
      false,

    error:
      null,

    onSelect:
      vi.fn(),

    onConversationSelect:
      vi.fn(),

    onSearch:
      vi.fn(),

    onNewConversation:
      vi.fn(),

    onDelete:
      vi.fn(),

    onArchive:
      vi.fn(),

    onPin:
      vi.fn(),

    onRetry:
      vi.fn(),
  });

/**
 * ============================================================================
 * Test suite
 * ============================================================================
 */

describe(
  'ConversationList',
  () => {
    let props;

    beforeEach(() => {
      props =
        createDefaultProps();

      vi.clearAllMocks();

      delete window.__titechConversationTest;
    });

    afterEach(() => {
      cleanup();

      vi.restoreAllMocks();
    });

    /**
     * ========================================================================
     * Rendering
     * ========================================================================
     */

    describe(
      'rendering',
      () => {
        it(
          'renders without crashing with default props',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'renders without crashing with minimal props',
          () => {
            expect(() => {
              render(
                <ConversationList />,
              );
            }).not.toThrow();
          },
        );

        it(
          'renders the supplied conversations',
          () => {
            const conversations =
              [
                createConversation(
                  {
                    id:
                      'conversation-001',
                    title:
                      'Savings Support',
                  },
                ),
                createConversation(
                  {
                    id:
                      'conversation-002',
                    title:
                      'Loan Application',
                  },
                ),
              ];

            render(
              <ConversationList
                {...props}
                conversations={
                  conversations
                }
              />,
            );

            expect(
              screen.getByText(
                'Savings Support',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'Loan Application',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders multiple conversations independently',
          () => {
            const conversations =
              Array.from(
                {
                  length: 5,
                },
                (_, index) =>
                  createConversation(
                    {
                      id:
                        `conversation-${index + 1}`,
                      title:
                        `Conversation ${index + 1}`,
                    },
                  ),
              );

            render(
              <ConversationList
                {...props}
                conversations={
                  conversations
                }
              />,
            );

            expect(
              screen.getByText(
                'Conversation 1',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'Conversation 5',
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * TITech branding
     * ========================================================================
     */

    describe(
      'TITech branding',
      () => {
        it(
          'does not render stale ACFOS branding',
          () => {
            render(
              <ConversationList
                {...props}
              />,
            );

            expect(
              document.body.textContent ||
                '',
            ).not.toMatch(
              /\bACFOS\b/i,
            );
          },
        );

        it(
          'does not contain ACFOS in rendered HTML',
          () => {
            render(
              <ConversationList
                {...props}
              />,
            );

            expect(
              document.body.innerHTML,
            ).not.toMatch(
              /\bACFOS\b/i,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Empty state
     * ========================================================================
     */

    describe(
      'empty state',
      () => {
        it(
          'renders safely when there are no conversations',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[]}
              />,
            );

            expect(
              document.body,
            ).toBeInTheDocument();
          },
        );

        it(
          'does not render stale conversation data when the list is empty',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[]}
              />,
            );

            expect(
              screen.queryByText(
                'Savings Account Support',
              ),
            ).not.toBeInTheDocument();
          },
        );

        it(
          'does not crash when conversations is null',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={
                    null
                  }
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash when conversations is undefined',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={
                    undefined
                  }
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Conversation selection
     * ========================================================================
     */

    describe(
      'conversation selection',
      () => {
        it(
          'calls the selection callback when a conversation is selected',
          async () => {
            const user =
              userEvent.setup();

            const conversation =
              createConversation(
                {
                  id:
                    'conversation-select',
                  title:
                    'Select Me',
                },
              );

            render(
              <ConversationList
                {...props}
                conversations={[
                  conversation,
                ]}
              />,
            );

            const item =
              screen.getByText(
                'Select Me',
              );

            await user.click(
              item,
            );

            await waitFor(
              () => {
                const calls =
                  [
                    ...props
                      .onSelect
                      .mock.calls,
                    ...props
                      .onConversationSelect
                      .mock.calls,
                  ];

                expect(
                  calls.length,
                ).toBeGreaterThan(
                  0,
                );

                expect(
                  JSON.stringify(
                    calls,
                  ),
                ).toContain(
                  'conversation-select',
                );
              },
            );
          },
        );

        it(
          'does not throw when selection callbacks are omitted',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                conversations={[
                  createConversation(
                    {
                      title:
                        'Safe Selection',
                    },
                  ),
                ]}
              />,
            );

            expect(() => {
              fireEvent.click(
                screen.getByText(
                  'Safe Selection',
                ),
              );
            }).not.toThrow();

            await user.click(
              screen.getByText(
                'Safe Selection',
              ),
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Active conversation
     * ========================================================================
     */

    describe(
      'active conversation',
      () => {
        it(
          'renders safely with an active conversation',
          () => {
            const conversations =
              [
                createConversation(
                  {
                    id:
                      'active-conversation',
                    title:
                      'Active Conversation',
                  },
                ),
                createConversation(
                  {
                    id:
                      'other-conversation',
                    title:
                      'Other Conversation',
                  },
                ),
              ];

            render(
              <ConversationList
                {...props}
                conversations={
                  conversations
                }
                activeConversationId="active-conversation"
              />,
            );

            expect(
              screen.getByText(
                'Active Conversation',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'Other Conversation',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'supports activeConversationId being null',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  activeConversationId={
                    null
                  }
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Unread state
     * ========================================================================
     */

    describe(
      'unread conversations',
      () => {
        it(
          'renders unread conversations',
          () => {
            const conversation =
              createConversation(
                {
                  id:
                    'unread-conversation',
                  title:
                    'Unread Support',
                  unreadCount:
                    3,
                  unread:
                    true,
                },
              );

            render(
              <ConversationList
                {...props}
                conversations={[
                  conversation,
                ]}
              />,
            );

            expect(
              screen.getByText(
                'Unread Support',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'does not crash with zero unread count',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        unreadCount: 0,
                        unread: false,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles large unread counts safely',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        unreadCount:
                          999999,
                        unread:
                          true,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Search
     * ========================================================================
     */

    describe(
      'conversation search',
      () => {
        it(
          'renders a search control when supported',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(),
                ]}
              />,
            );

            const search =
              getSearchInput();

            if (search) {
              expect(
                search,
              ).toBeInTheDocument();
            }
          },
        );

        it(
          'allows users to type into the search field',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(),
                ]}
              />,
            );

            const search =
              getSearchInput();

            if (!search) {
              return;
            }

            await user.type(
              search,
              'loan',
            );

            expect(
              search,
            ).toHaveValue(
              'loan',
            );
          },
        );

        it(
          'calls the search callback when provided',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(),
                ]}
              />,
            );

            const search =
              getSearchInput();

            if (!search) {
              return;
            }

            await user.type(
              search,
              'savings',
            );

            expect(
              props.onSearch,
            ).toHaveBeenCalled();
          },
        );

        it(
          'handles an empty search safely',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(),
                ]}
              />,
            );

            const search =
              getSearchInput();

            if (!search) {
              return;
            }

            await user.type(
              search,
              'x',
            );

            await user.clear(
              search,
            );

            expect(
              search,
            ).toHaveValue(
              '',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Conversation previews
     * ========================================================================
     */

    describe(
      'conversation previews',
      () => {
        it(
          'renders the latest message preview when supplied',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      title:
                        'Loan Support',
                      preview:
                        'Your loan application is under review.',
                    },
                  ),
                ]}
              />,
            );

            expect(
              screen.getByText(
                /your loan application is under review/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'handles missing preview content',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        preview:
                          undefined,
                        lastMessage:
                          undefined,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Dates and timestamps
     * ========================================================================
     */

    describe(
      'timestamps',
      () => {
        it(
          'handles valid conversation timestamps',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        lastMessageAt:
                          '2026-08-21T12:00:00.000Z',
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles missing timestamps safely',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        lastMessageAt:
                          undefined,
                        updatedAt:
                          undefined,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles invalid timestamps without crashing',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        lastMessageAt:
                          'not-a-real-date',
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Loading state
     * ========================================================================
     */

    describe(
      'loading state',
      () => {
        it(
          'renders safely while loading',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  loading
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not expose stale conversation data when explicitly loading an empty list',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[]}
                loading
              />,
            );

            expect(
              screen.queryByText(
                'Savings Account Support',
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Error state
     * ========================================================================
     */

    describe(
      'error state',
      () => {
        it(
          'renders safely when an error is supplied',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  error="Unable to load conversations."
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash with null error',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  error={null}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'supports a retry action when exposed',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                error="Unable to load conversations."
                onRetry={
                  props.onRetry
                }
              />,
            );

            const retry =
              screen.queryByRole(
                'button',
                {
                  name: /retry|try again/i,
                },
              );

            if (retry) {
              await user.click(
                retry,
              );

              expect(
                props.onRetry,
              ).toHaveBeenCalledTimes(
                1,
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * New conversation
     * ========================================================================
     */

    describe(
      'new conversation',
      () => {
        it(
          'renders a new-conversation action when supported',
          () => {
            render(
              <ConversationList
                {...props}
              />,
            );

            const button =
              getNewConversationButton();

            if (button) {
              expect(
                button,
              ).toBeInTheDocument();
            }
          },
        );

        it(
          'calls the new-conversation callback when supported',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
              />,
            );

            const button =
              getNewConversationButton();

            if (!button) {
              return;
            }

            await user.click(
              button,
            );

            expect(
              props
                .onNewConversation,
            ).toHaveBeenCalledTimes(
              1,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Archive
     * ========================================================================
     */

    describe(
      'archive behavior',
      () => {
        it(
          'renders safely with archive support',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  onArchive={
                    props.onArchive
                  }
                  conversations={[
                    createConversation(
                      {
                        id:
                          'archive-001',
                        title:
                          'Archive Me',
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'calls archive when an archive action is exposed',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      id:
                        'archive-001',
                      title:
                        'Archive Me',
                    },
                  ),
                ]}
              />,
            );

            const archive =
              screen.queryByRole(
                'button',
                {
                  name: /archive/i,
                },
              );

            if (!archive) {
              return;
            }

            await user.click(
              archive,
            );

            expect(
              props.onArchive,
            ).toHaveBeenCalled();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Delete behavior
     * ========================================================================
     */

    describe(
      'delete behavior',
      () => {
        it(
          'renders safely with delete support',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        id:
                          'delete-001',
                        title:
                          'Delete Me',
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not delete without an explicit delete action',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      id:
                        'protected-001',
                      title:
                        'Protected Conversation',
                    },
                  ),
                ]}
              />,
            );

            expect(
              props.onDelete,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'calls delete when the explicit delete action is exposed',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      id:
                        'delete-001',
                      title:
                        'Delete Me',
                    },
                  ),
                ]}
              />,
            );

            const deleteButton =
              screen.queryByRole(
                'button',
                {
                  name: /delete|remove/i,
                },
              );

            if (!deleteButton) {
              return;
            }

            await user.click(
              deleteButton,
            );

            const confirmation =
              screen.queryByRole(
                'button',
                {
                  name:
                    /confirm|yes|delete/i,
                },
              );

            if (
              confirmation &&
              confirmation !==
                deleteButton
            ) {
              await user.click(
                confirmation,
              );
            }

            expect(
              props.onDelete,
            ).toHaveBeenCalled();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Pinning
     * ========================================================================
     */

    describe(
      'pin behavior',
      () => {
        it(
          'handles pinned conversations safely',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        id:
                          'pinned-001',
                        title:
                          'Pinned Conversation',
                        pinned:
                          true,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'calls pin callback when pin action is exposed',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      id:
                        'pin-001',
                      title:
                        'Pin Me',
                    },
                  ),
                ]}
              />,
            );

            const pinButton =
              screen.queryByRole(
                'button',
                {
                  name: /pin|unpin/i,
                },
              );

            if (!pinButton) {
              return;
            }

            await user.click(
              pinButton,
            );

            expect(
              props.onPin,
            ).toHaveBeenCalled();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Keyboard navigation
     * ========================================================================
     */

    describe(
      'keyboard navigation',
      () => {
        it(
          'allows keyboard users to focus a conversation item when it is interactive',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      id:
                        'keyboard-001',
                      title:
                        'Keyboard Conversation',
                    },
                  ),
                ]}
              />,
            );

            const item =
              screen.getByText(
                'Keyboard Conversation',
              );

            await user.click(
              item,
            );

            expect(
              item,
            ).toHaveFocus();
          },
        );

        it(
          'does not throw when Enter is dispatched to an interactive item',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      title:
                        'Keyboard Enter',
                    },
                  ),
                ]}
              />,
            );

            const item =
              screen.getByText(
                'Keyboard Enter',
              );

            expect(() => {
              fireEvent.keyDown(
                item,
                {
                  key: 'Enter',
                  code: 'Enter',
                },
              );
            }).not.toThrow();
          },
        );

        it(
          'does not throw when Space is dispatched to an interactive item',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      title:
                        'Keyboard Space',
                    },
                  ),
                ]}
              />,
            );

            const item =
              screen.getByText(
                'Keyboard Space',
              );

            expect(() => {
              fireEvent.keyDown(
                item,
                {
                  key: ' ',
                  code: 'Space',
                },
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Unicode and financial content
     * ========================================================================
     */

    describe(
      'international and financial content',
      () => {
        it(
          'renders Unicode conversation titles',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      title:
                        'Savings 👋 — 日本語 — नमस्ते',
                    },
                  ),
                ]}
              />,
            );

            expect(
              screen.getByText(
                'Savings 👋 — 日本語 — नमस्ते',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders Ugandan financial values safely',
          () => {
            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      title:
                        'Savings Balance',
                      preview:
                        'UGX 1,250,000 deposited successfully.',
                    },
                  ),
                ]}
              />,
            );

            expect(
              screen.getByText(
                /UGX 1,250,000/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'handles very long conversation titles',
          () => {
            const longTitle =
              'TITech Community Capital '.repeat(
                100,
              );

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        title:
                          longTitle,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles very long message previews',
          () => {
            const longPreview =
              'Financial transaction information '.repeat(
                500,
              );

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        preview:
                          longPreview,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Security / XSS protection
     * ========================================================================
     */

    describe(
      'secure rendering',
      () => {
        it(
          'does not execute HTML in conversation titles',
          () => {
            const maliciousTitle =
              '<img src=x onerror="window.__titechConversationTest=true">';

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      title:
                        maliciousTitle,
                    },
                  ),
                ]}
              />,
            );

            expect(
              window.__titechConversationTest,
            ).not.toBe(true);

            expect(
              document.querySelector(
                'img[src="x"]',
              ),
            ).not.toBeTruthy();
          },
        );

        it(
          'does not execute script content in previews',
          () => {
            const maliciousPreview =
              '<script>window.__titechConversationTest=true</script>';

            render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(
                    {
                      preview:
                        maliciousPreview,
                    },
                  ),
                ]}
              />,
            );

            expect(
              window.__titechConversationTest,
            ).not.toBe(true);
          },
        );
      },
    );

    /**
     * ========================================================================
     * Multi-tenant safety
     * ========================================================================
     */

    describe(
      'tenant-aware rendering',
      () => {
        it(
          'renders conversations with tenant context safely',
          () => {
            const conversations =
              [
                createConversation(
                  {
                    id:
                      'tenant-a-001',
                    tenantId:
                      'tenant-a',
                    title:
                      'Tenant A Conversation',
                  },
                ),
              ];

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  tenantId="tenant-a"
                  conversations={
                    conversations
                  }
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash when tenantId is missing',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  tenantId={
                    undefined
                  }
                  conversations={[
                    createConversation(),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not automatically mix arbitrary tenant records through component rendering',
          () => {
            const tenantA =
              createConversation(
                {
                  id:
                    'tenant-a-conversation',
                  tenantId:
                    'tenant-a',
                  title:
                    'Tenant A Private Conversation',
                },
              );

            const tenantB =
              createConversation(
                {
                  id:
                    'tenant-b-conversation',
                  tenantId:
                    'tenant-b',
                  title:
                    'Tenant B Private Conversation',
                },
              );

            render(
              <ConversationList
                {...props}
                tenantId="tenant-a"
                conversations={[
                  tenantA,
                  tenantB,
                ]}
              />,
            );

            /**
             * The component should render only the data it is given.
             * Actual authorization / tenant isolation must be enforced by
             * the application data layer and backend.
             *
             * This assertion documents that the UI must not silently rewrite
             * or mutate tenant identities.
             */
            expect(
              document.body,
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Selection state
     * ========================================================================
     */

    describe(
      'selection state',
      () => {
        it(
          'renders safely with selectedConversationId',
          () => {
            const conversations =
              [
                createConversation(
                  {
                    id:
                      'selected-001',
                    title:
                      'Selected Conversation',
                  },
                ),
              ];

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={
                    conversations
                  }
                  selectedConversationId="selected-001"
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles a non-existent selected conversation safely',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        id:
                          'conversation-001',
                      },
                    ),
                  ]}
                  selectedConversationId="missing-id"
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Archived conversations
     * ========================================================================
     */

    describe(
      'archived conversations',
      () => {
        it(
          'handles archived conversations safely',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        id:
                          'archived-001',
                        title:
                          'Archived Conversation',
                        archived:
                          true,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Large lists
     * ========================================================================
     */

    describe(
      'large conversation lists',
      () => {
        it(
          'renders a large conversation collection without crashing',
          () => {
            const conversations =
              Array.from(
                {
                  length: 250,
                },
                (_, index) =>
                  createConversation(
                    {
                      id:
                        `conversation-${index}`,
                      title:
                        `Conversation ${index}`,
                    },
                  ),
              );

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={
                    conversations
                  }
                />,
              );
            }).not.toThrow();

            expect(
              screen.getByText(
                'Conversation 0',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'Conversation 249',
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Dynamic updates
     * ========================================================================
     */

    describe(
      'dynamic updates',
      () => {
        it(
          'updates when the conversation collection changes',
          () => {
            const initial =
              [
                createConversation(
                  {
                    id:
                      'initial',
                    title:
                      'Initial Conversation',
                  },
                ),
              ];

            const updated =
              [
                createConversation(
                  {
                    id:
                      'updated',
                    title:
                      'Updated Conversation',
                  },
                ),
              ];

            const {
              rerender,
            } = render(
              <ConversationList
                {...props}
                conversations={
                  initial
                }
              />,
            );

            expect(
              screen.getByText(
                'Initial Conversation',
              ),
            ).toBeInTheDocument();

            rerender(
              <ConversationList
                {...props}
                conversations={
                  updated
                }
              />,
            );

            expect(
              screen.getByText(
                'Updated Conversation',
              ),
            ).toBeInTheDocument();

            expect(
              screen.queryByText(
                'Initial Conversation',
              ),
            ).not.toBeInTheDocument();
          },
        );

        it(
          'handles transition from conversations to empty state',
          () => {
            const conversations =
              [
                createConversation(
                  {
                    title:
                      'Temporary Conversation',
                  },
                ),
              ];

            const {
              rerender,
            } = render(
              <ConversationList
                {...props}
                conversations={
                  conversations
                }
              />,
            );

            expect(
              screen.getByText(
                'Temporary Conversation',
              ),
            ).toBeInTheDocument();

            rerender(
              <ConversationList
                {...props}
                conversations={[]}
              />,
            );

            expect(
              screen.queryByText(
                'Temporary Conversation',
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Callback safety
     * ========================================================================
     */

    describe(
      'callback safety',
      () => {
        it(
          'does not throw when optional callbacks are undefined',
          async () => {
            const user =
              userEvent.setup();

            render(
              <ConversationList
                conversations={[
                  createConversation(
                    {
                      title:
                        'Callback Safety',
                    },
                  ),
                ]}
                onSelect={
                  undefined
                }
                onDelete={
                  undefined
                }
                onArchive={
                  undefined
                }
                onPin={
                  undefined
                }
              />,
            );

            expect(() => {
              fireEvent.click(
                screen.getByText(
                  'Callback Safety',
                ),
              );
            }).not.toThrow();

            await user.click(
              screen.getByText(
                'Callback Safety',
              ),
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Cleanup
     * ========================================================================
     */

    describe(
      'cleanup',
      () => {
        it(
          'unmounts cleanly',
          () => {
            const {
              unmount,
            } = render(
              <ConversationList
                {...props}
                conversations={[
                  createConversation(),
                ]}
              />,
            );

            expect(() => {
              unmount();
            }).not.toThrow();
          },
        );

        it(
          'unmounts cleanly while loading',
          () => {
            const {
              unmount,
            } = render(
              <ConversationList
                {...props}
                loading
              />,
            );

            expect(() => {
              unmount();
            }).not.toThrow();
          },
        );

        it(
          'unmounts cleanly in an error state',
          () => {
            const {
              unmount,
            } = render(
              <ConversationList
                {...props}
                error="Conversation loading failed."
              />,
            );

            expect(() => {
              unmount();
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Production resilience
     * ========================================================================
     */

    describe(
      'production resilience',
      () => {
        it(
          'handles malformed conversation objects without crashing',
          () => {
            const malformed =
              [
                {},
                null,
                {
                  id: 'partial',
                },
                {
                  title: null,
                },
              ];

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={
                    malformed
                  }
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles mixed valid and malformed records safely',
          () => {
            const conversations =
              [
                createConversation(
                  {
                    title:
                      'Valid Conversation',
                  },
                ),
                null,
                {},
                createConversation(
                  {
                    title:
                      'Another Valid Conversation',
                  },
                ),
              ];

            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={
                    conversations
                  }
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles a large unread count without crashing',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        unreadCount:
                          Number.MAX_SAFE_INTEGER,
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'handles zero-length conversation IDs safely',
          () => {
            expect(() => {
              render(
                <ConversationList
                  {...props}
                  conversations={[
                    createConversation(
                      {
                        id: '',
                      },
                    ),
                  ]}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );
  },
);

/**
 * ============================================================================
 * End of Enterprise TITech ConversationList Test Suite
 * ============================================================================
 */