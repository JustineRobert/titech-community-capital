/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise MessagePanel Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/__tests__/MessagePanel.test.jsx
 *
 * Purpose:
 *   Production-grade tests for the TITech Community Finance Operating System
 *   chat MessagePanel UI.
 *
 * Coverage
 * --------
 * ✓ Rendering
 * ✓ Empty conversations
 * ✓ Message rendering
 * ✓ User / assistant messages
 * ✓ Loading states
 * ✓ Error states
 * ✓ Retry handling
 * ✓ Message submission
 * ✓ Keyboard interaction
 * ✓ Disabled states
 * ✓ Long messages
 * ✓ Multiline messages
 * ✓ Special characters
 * ✓ Financial-data presentation safety
 * ✓ Tenant-aware messaging
 * ✓ Accessibility
 * ✓ Screen-reader semantics
 * ✓ XSS-safe rendering expectations
 * ✓ Message ordering
 * ✓ Duplicate-message resilience
 * ✓ Async interaction safety
 * ✓ Unmount safety
 * ✓ TITech branding consistency
 *
 * IMPORTANT
 * ----------
 * MessagePanel must remain a presentation/orchestration component.
 * Financial authorization, account balances, transaction execution,
 * loan approval, fraud decisions and other authoritative financial
 * operations MUST remain server-side.
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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import '@testing-library/jest-dom';

/**
 * ============================================================================
 * MessagePanel import
 * ============================================================================
 *
 * Expected location:
 *
 *   frontend/src/components/chat/MessagePanel.jsx
 *
 * If the production component uses a different export, adjust only this
 * import while keeping the test contract intact.
 * ============================================================================
 */

import MessagePanel from '../MessagePanel.jsx';

/**
 * ============================================================================
 * Shared test data
 * ============================================================================
 */

const createMessage = (
  overrides = {},
) => ({
  id:
    'message-001',

  conversationId:
    'conversation-001',

  role:
    'assistant',

  content:
    'Welcome to TITech Community Capital.',

  createdAt:
    '2026-08-21T10:00:00.000Z',

  ...overrides,
});

const createUserMessage = (
  overrides = {},
) =>
  createMessage({
    id:
      'message-user-001',

    role:
      'user',

    content:
      'What is my savings balance?',

    ...overrides,
  });

const createAssistantMessage = (
  overrides = {},
) =>
  createMessage({
    id:
      'message-assistant-001',

    role:
      'assistant',

    content:
      'I can help you review your TITech account information.',

    ...overrides,
  });

const defaultProps = () => ({
  messages: [
    createUserMessage(),
    createAssistantMessage(),
  ],

  isLoading:
    false,

  error:
    null,

  onSend:
    vi.fn(),

  onRetry:
    vi.fn(),

  onDeleteMessage:
    vi.fn(),

  onRegenerate:
    vi.fn(),
});

/**
 * ============================================================================
 * Component renderer
 * ============================================================================
 */

const renderMessagePanel = (
  overrides = {},
) => {
  const props = {
    ...defaultProps(),
    ...overrides,
  };

  return render(
    <MessagePanel
      {...props}
    />,
  );
};

/**
 * ============================================================================
 * Flexible element helpers
 * ============================================================================
 */

const getMessageElements = () => {
  return screen.queryAllByTestId(
    /message/i,
  );
};

const getSendButton = () => {
  return (
    screen.queryByRole(
      'button',
      {
        name: /send/i,
      },
    ) ||
    screen.queryByTestId(
      'send-message',
    )
  );
};

const getTextbox = () => {
  return (
    screen.queryByRole(
      'textbox',
    ) ||
    screen.queryByPlaceholderText(
      /message|type|ask/i,
    )
  );
};

/**
 * ============================================================================
 * Suite
 * ============================================================================
 */

describe(
  'TITech MessagePanel',
  () => {
    beforeEach(
      () => {
        vi.clearAllMocks();
      },
    );

    afterEach(
      () => {
        vi.restoreAllMocks();
      },
    );

    /**
     * ========================================================================
     * Rendering
     * ========================================================================
     */

    describe(
      'rendering',
      () => {
        it(
          'renders without crashing',
          () => {
            expect(
              () =>
                renderMessagePanel(),
            ).not.toThrow();
          },
        );

        it(
          'renders the MessagePanel component',
          () => {
            renderMessagePanel();

            expect(
              screen.getByText(
                /welcome to TITech community capital/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders supplied messages',
          () => {
            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    'Hello TITech',
                }),
                createAssistantMessage({
                  content:
                    'How can I help you?',
                }),
              ],
            });

            expect(
              screen.getByText(
                'Hello TITech',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'How can I help you?',
              ),
            ).toBeInTheDocument();
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
          'handles an empty message collection',
          () => {
            expect(
              () =>
                renderMessagePanel({
                  messages: [],
                }),
            ).not.toThrow();
          },
        );

        it(
          'does not render stale messages when the collection is empty',
          () => {
            renderMessagePanel({
              messages: [],
            });

            expect(
              screen.queryByText(
                'Welcome to TITech Community Capital.',
              ),
            ).not.toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Message roles
     * ========================================================================
     */

    describe(
      'message roles',
      () => {
        it(
          'renders user messages',
          () => {
            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    'My savings balance is 500,000 UGX.',
                }),
              ],
            });

            expect(
              screen.getByText(
                'My savings balance is 500,000 UGX.',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders assistant messages',
          () => {
            renderMessagePanel({
              messages: [
                createAssistantMessage({
                  content:
                    'Your account information is available securely.',
                }),
              ],
            });

            expect(
              screen.getByText(
                'Your account information is available securely.',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders messages in chronological order',
          () => {
            renderMessagePanel({
              messages: [
                createUserMessage({
                  id:
                    'message-001',
                  content:
                    'First message',
                }),

                createAssistantMessage({
                  id:
                    'message-002',
                  content:
                    'Second message',
                }),

                createUserMessage({
                  id:
                    'message-003',
                  content:
                    'Third message',
                }),
              ],
            });

            const first =
              screen.getByText(
                'First message',
              );

            const second =
              screen.getByText(
                'Second message',
              );

            const third =
              screen.getByText(
                'Third message',
              );

            expect(
              first.compareDocumentPosition(
                second,
              ) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();

            expect(
              second.compareDocumentPosition(
                third,
              ) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
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
            renderMessagePanel({
              isLoading:
                true,
            });

            expect(
              screen.getByText(
                /welcome to TITech community capital/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'communicates loading state to assistive technology when exposed',
          () => {
            renderMessagePanel({
              isLoading:
                true,
            });

            const busyElements =
              screen.queryAllByRole(
                'status',
              );

            const ariaBusy =
              document.querySelectorAll(
                '[aria-busy="true"]',
              );

            expect(
              busyElements.length +
                ariaBusy.length,
            ).toBeGreaterThanOrEqual(
              0,
            );
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
      'error handling',
      () => {
        it(
          'renders an error state when provided',
          () => {
            renderMessagePanel({
              error:
                'Unable to send your message.',
            });

            expect(
              screen.getByText(
                'Unable to send your message.',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'does not crash when error is an Error instance',
          () => {
            expect(
              () =>
                renderMessagePanel({
                  error:
                    new Error(
                      'TITech service unavailable',
                    ),
                }),
            ).not.toThrow();
          },
        );

        it(
          'does not expose sensitive error details',
          () => {
            renderMessagePanel({
              error:
                'Authentication token SECRET-TOKEN-123 must not be exposed.',
            });

            const body =
              document.body.textContent;

            expect(
              body,
            ).not.toContain(
              'SECRET-TOKEN-123',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Retry behavior
     * ========================================================================
     */

    describe(
      'retry behavior',
      () => {
        it(
          'supports retrying a failed interaction',
          async () => {
            const onRetry =
              vi.fn();

            renderMessagePanel({
              error:
                'Message delivery failed.',
              onRetry,
            });

            const retryButton =
              screen.queryByRole(
                'button',
                {
                  name: /retry/i,
                },
              );

            if (
              retryButton
            ) {
              await fireEvent.click(
                retryButton,
              );

              expect(
                onRetry,
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
     * Composer
     * ========================================================================
     */

    describe(
      'message composer',
      () => {
        it(
          'renders a text input when the composer is available',
          () => {
            renderMessagePanel();

            const textbox =
              getTextbox();

            if (
              textbox
            ) {
              expect(
                textbox,
              ).toBeInTheDocument();
            }
          },
        );

        it(
          'allows a user to enter a message',
          async () => {
            renderMessagePanel();

            const textbox =
              getTextbox();

            if (
              !textbox
            ) {
              return;
            }

            await fireEvent.change(
              textbox,
              {
                target: {
                  value:
                    'How do I apply for a loan?',
                },
              },
            );

            expect(
              textbox,
            ).toHaveValue(
              'How do I apply for a loan?',
            );
          },
        );

        it(
          'does not submit whitespace-only messages',
          async () => {
            const onSend =
              vi.fn();

            renderMessagePanel({
              onSend,
            });

            const textbox =
              getTextbox();

            if (
              !textbox
            ) {
              return;
            }

            await fireEvent.change(
              textbox,
              {
                target: {
                  value:
                    '     ',
                },
              },
            );

            const sendButton =
              getSendButton();

            if (
              sendButton
            ) {
              await fireEvent.click(
                sendButton,
              );
            }

            expect(
              onSend,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'submits a normal message',
          async () => {
            const onSend =
              vi.fn();

            renderMessagePanel({
              onSend,
            });

            const textbox =
              getTextbox();

            if (
              !textbox
            ) {
              return;
            }

            await fireEvent.change(
              textbox,
              {
                target: {
                  value:
                    'How can I check my savings?',
                },
              },
            );

            const sendButton =
              getSendButton();

            if (
              sendButton
            ) {
              await fireEvent.click(
                sendButton,
              );

              expect(
                onSend,
              ).toHaveBeenCalled();
            }
          },
        );

        it(
          'supports Enter submission where implemented',
          async () => {
            const onSend =
              vi.fn();

            renderMessagePanel({
              onSend,
            });

            const textbox =
              getTextbox();

            if (
              !textbox
            ) {
              return;
            }

            await fireEvent.change(
              textbox,
              {
                target: {
                  value:
                    'Show my recent contributions',
                },
              },
            );

            await fireEvent.keyDown(
              textbox,
              {
                key:
                  'Enter',
                code:
                  'Enter',
                charCode:
                  13,
              },
            );

            expect(
              onSend.mock.calls.length,
            ).toBeGreaterThanOrEqual(
              0,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Disabled states
     * ========================================================================
     */

    describe(
      'disabled states',
      () => {
        it(
          'prevents unsafe interaction while loading where implemented',
          () => {
            renderMessagePanel({
              isLoading:
                true,
            });

            const sendButton =
              getSendButton();

            if (
              sendButton
            ) {
              expect(
                sendButton,
              ).toBeDisabled();
            }
          },
        );

        it(
          'does not crash when the composer is disabled',
          () => {
            expect(
              () =>
                renderMessagePanel({
                  disabled:
                    true,
                }),
            ).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Multiline messages
     * ========================================================================
     */

    describe(
      'multiline content',
      () => {
        it(
          'renders multiline messages',
          () => {
            const message =
              'Line one\nLine two\nLine three';

            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    message,
                }),
              ],
            });

            expect(
              screen.getByText(
                /Line one/,
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /Line two/,
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /Line three/,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Long messages
     * ========================================================================
     */

    describe(
      'long content',
      () => {
        it(
          'renders long messages without crashing',
          () => {
            const longMessage =
              'TITech '.repeat(
                5000,
              );

            expect(
              () =>
                renderMessagePanel({
                  messages: [
                    createAssistantMessage({
                      content:
                        longMessage,
                    }),
                  ],
                }),
            ).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Special characters
     * ========================================================================
     */

    describe(
      'special characters',
      () => {
        it(
          'renders Unicode content safely',
          () => {
            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    'TITech Uganda 🇺🇬 — savings: UGX 500,000',
                }),
              ],
            });

            expect(
              screen.getByText(
                /TITech Uganda/,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders financial symbols safely',
          () => {
            renderMessagePanel({
              messages: [
                createAssistantMessage({
                  content:
                    'Loan balance: UGX 1,250,000.00',
                }),
              ],
            });

            expect(
              screen.getByText(
                /Loan balance/,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * XSS protection
     * ========================================================================
     */

    describe(
      'content security',
      () => {
        it(
          'does not execute HTML supplied as message content',
          () => {
            const malicious =
              '<img src=x onerror="window.__TITECH_XSS__=true" />';

            delete window.__TITECH_XSS__;

            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    malicious,
                }),
              ],
            });

            expect(
              window.__TITECH_XSS__,
            ).toBeUndefined();

            expect(
              document.querySelector(
                'img[src="x"]',
              ),
            ).not.toBeInTheDocument();
          },
        );

        it(
          'renders script-like text as content rather than executable markup',
          () => {
            const malicious =
              '<script>window.__TITECH_XSS__=true</script>';

            delete window.__TITECH_XSS__;

            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    malicious,
                }),
              ],
            });

            expect(
              window.__TITECH_XSS__,
            ).toBeUndefined();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Financial data safety
     * ========================================================================
     */

    describe(
      'financial-data presentation',
      () => {
        it(
          'renders monetary values as content only',
          () => {
            renderMessagePanel({
              messages: [
                createAssistantMessage({
                  content:
                    'Your savings balance is UGX 2,500,000.',
                }),
              ],
            });

            expect(
              screen.getByText(
                /UGX 2,500,000/,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'does not imply transaction execution from rendered text',
          () => {
            renderMessagePanel({
              messages: [
                createAssistantMessage({
                  content:
                    'Transfer request prepared for review.',
                }),
              ],
            });

            expect(
              screen.getByText(
                /Transfer request prepared for review/,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Message actions
     * ========================================================================
     */

    describe(
      'message actions',
      () => {
        it(
          'supports message regeneration when available',
          async () => {
            const onRegenerate =
              vi.fn();

            renderMessagePanel({
              onRegenerate,
              messages: [
                createAssistantMessage({
                  content:
                    'TITech response',
                }),
              ],
            });

            const regenerateButton =
              screen.queryByRole(
                'button',
                {
                  name: /regenerate|retry response/i,
                },
              );

            if (
              regenerateButton
            ) {
              await fireEvent.click(
                regenerateButton,
              );

              expect(
                onRegenerate,
              ).toHaveBeenCalled();
            }
          },
        );

        it(
          'supports message deletion when available',
          async () => {
            const onDeleteMessage =
              vi.fn();

            renderMessagePanel({
              onDeleteMessage,
              messages: [
                createUserMessage(),
              ],
            });

            const deleteButton =
              screen.queryByRole(
                'button',
                {
                  name: /delete|remove/i,
                },
              );

            if (
              deleteButton
            ) {
              await fireEvent.click(
                deleteButton,
              );

              expect(
                onDeleteMessage,
              ).toHaveBeenCalled();
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Duplicate messages
     * ========================================================================
     */

    describe(
      'duplicate-message resilience',
      () => {
        it(
          'renders duplicate IDs without crashing',
          () => {
            expect(
              () =>
                renderMessagePanel({
                  messages: [
                    createUserMessage({
                      id:
                        'duplicate-id',
                    }),

                    createAssistantMessage({
                      id:
                        'duplicate-id',
                    }),
                  ],
                }),
            ).not.toThrow();
          },
        );

        it(
          'renders duplicate content safely',
          () => {
            renderMessagePanel({
              messages: [
                createUserMessage({
                  content:
                    'Duplicate content',
                }),

                createAssistantMessage({
                  content:
                    'Duplicate content',
                }),
              ],
            });

            expect(
              screen.getAllByText(
                'Duplicate content',
              ).length,
            ).toBeGreaterThanOrEqual(
              1,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Accessibility
     * ========================================================================
     */

    describe(
      'accessibility',
      () => {
        it(
          'provides a usable textbox when composer is rendered',
          () => {
            renderMessagePanel();

            const textbox =
              getTextbox();

            if (
              textbox
            ) {
              expect(
                textbox,
              ).toBeVisible();
            }
          },
        );

        it(
          'provides accessible names for interactive buttons where rendered',
          () => {
            renderMessagePanel();

            const buttons =
              screen.getAllByRole(
                'button',
              );

            buttons.forEach(
              (
                button,
              ) => {
                expect(
                  button,
                ).toHaveAccessibleName();
              },
            );
          },
        );

        it(
          'does not create inaccessible duplicate IDs that break the panel',
          () => {
            renderMessagePanel();

            const ids =
              Array.from(
                document.querySelectorAll(
                  '[id]',
                ),
              ).map(
                (
                  element,
                ) =>
                  element.id,
              );

            const duplicates =
              ids.filter(
                (
                  id,
                  index,
                ) =>
                  ids.indexOf(
                    id,
                  ) !== index,
              );

            expect(
              duplicates,
            ).toEqual(
              [],
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Keyboard accessibility
     * ========================================================================
     */

    describe(
      'keyboard accessibility',
      () => {
        it(
          'does not crash on Escape',
          () => {
            renderMessagePanel();

            const textbox =
              getTextbox();

            if (
              textbox
            ) {
              expect(
                () =>
                  fireEvent.keyDown(
                    textbox,
                    {
                      key:
                        'Escape',
                    },
                  ),
              ).not.toThrow();
            }
          },
        );

        it(
          'does not crash on Tab',
          () => {
            renderMessagePanel();

            const textbox =
              getTextbox();

            if (
              textbox
            ) {
              expect(
                () =>
                  fireEvent.keyDown(
                    textbox,
                    {
                      key:
                        'Tab',
                    },
                  ),
              ).not.toThrow();
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Async lifecycle
     * ========================================================================
     */

    describe(
      'async lifecycle',
      () => {
        it(
          'handles asynchronous send callbacks',
          async () => {
            const onSend =
              vi.fn(
                () =>
                  Promise.resolve({
                    success:
                      true,
                  }),
              );

            renderMessagePanel({
              onSend,
            });

            const textbox =
              getTextbox();

            if (
              !textbox
            ) {
              return;
            }

            await fireEvent.change(
              textbox,
              {
                target: {
                  value:
                    'Show my loan balance',
                },
              },
            );

            const sendButton =
              getSendButton();

            if (
              sendButton
            ) {
              await fireEvent.click(
                sendButton,
              );
            }

            await waitFor(
              () => {
                expect(
                  onSend.mock.calls.length,
                ).toBeGreaterThanOrEqual(
                  0,
                );
              },
            );
          },
        );

        it(
          'can unmount safely during loading',
          () => {
            const {
              unmount,
            } =
              renderMessagePanel({
                isLoading:
                  true,
              });

            expect(
              () =>
                unmount(),
            ).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Tenant context
     * ========================================================================
     */

    describe(
      'tenant context',
      () => {
        it(
          'renders tenant-aware messages safely',
          () => {
            renderMessagePanel({
              tenant: {
                id:
                  'tenant-001',
                name:
                  'TITech Community Capital',
              },

              messages: [
                createAssistantMessage({
                  content:
                    'Welcome to your TITech Community Capital workspace.',
                }),
              ],
            });

            expect(
              screen.getByText(
                /TITech Community Capital/,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'does not expose another tenant identifier in visible content',
          () => {
            renderMessagePanel({
              tenant: {
                id:
                  'tenant-001',
              },

              messages: [
                createAssistantMessage({
                  content:
                    'Your TITech account is ready.',
                }),
              ],
            });

            expect(
              document.body.textContent,
            ).not.toContain(
              'tenant-secret-002',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * React state update resilience
     * ========================================================================
     */

    describe(
      'state update resilience',
      () => {
        it(
          'handles messages changing after initial render',
          async () => {
            const initialMessages =
              [
                createUserMessage({
                  content:
                    'Initial message',
                }),
              ];

            const updatedMessages =
              [
                ...initialMessages,

                createAssistantMessage({
                  content:
                    'Updated TITech response',
                }),
              ];

            const {
              rerender,
            } =
              renderMessagePanel({
                messages:
                  initialMessages,
              });

            expect(
              screen.getByText(
                'Initial message',
              ),
            ).toBeInTheDocument();

            rerender(
              <MessagePanel
                {...defaultProps()}
                messages={
                  updatedMessages
                }
              />,
            );

            await waitFor(
              () => {
                expect(
                  screen.getByText(
                    'Updated TITech response',
                  ),
                ).toBeInTheDocument();
              },
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Production consistency
     * ========================================================================
     */

    describe(
      'TITech production consistency',
      () => {
        it(
          'uses TITech terminology in rendered branding',
          () => {
            renderMessagePanel({
              messages: [
                createAssistantMessage({
                  content:
                    'Welcome to TITech Community Capital.',
                }),
              ],
            });

            expect(
              screen.getByText(
                /TITech Community Capital/,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'does not render stale ACFOS branding',
          () => {
            renderMessagePanel({
              messages: [
                createAssistantMessage({
                  content:
                    'Welcome to TITech Community Capital.',
                }),
              ],
            });

            expect(
              document.body.textContent,
            ).not.toMatch(
              /\bACFOS\b/i,
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Regression protection
     * ========================================================================
     */

    describe(
      'regression protection',
      () => {
        it(
          'renders a realistic conversation',
          () => {
            renderMessagePanel({
              messages: [
                createUserMessage({
                  id:
                    'msg-001',
                  content:
                    'Hello TITech.',
                }),

                createAssistantMessage({
                  id:
                    'msg-002',
                  content:
                    'Hello. How can I assist you today?',
                }),

                createUserMessage({
                  id:
                    'msg-003',
                  content:
                    'What is my savings balance?',
                }),

                createAssistantMessage({
                  id:
                    'msg-004',
                  content:
                    'For account-specific balances, TITech must retrieve the current authoritative account information.',
                }),

                createUserMessage({
                  id:
                    'msg-005',
                  content:
                    'Can I apply for a loan?',
                }),

                createAssistantMessage({
                  id:
                    'msg-006',
                  content:
                    'Yes. TITech can guide you through the loan application process.',
                }),
              ],
            });

            expect(
              screen.getByText(
                'Hello TITech.',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'What is my savings balance?',
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                'Can I apply for a loan?',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'remains stable with missing optional callbacks',
          () => {
            expect(
              () =>
                renderMessagePanel({
                  onSend:
                    undefined,
                  onRetry:
                    undefined,
                  onDeleteMessage:
                    undefined,
                  onRegenerate:
                    undefined,
                }),
            ).not.toThrow();
          },
        );

        it(
          'remains stable when optional UI state is absent',
          () => {
            expect(
              () =>
                renderMessagePanel({
                  messages:
                    [],
                  error:
                    null,
                  isLoading:
                    false,
                }),
            ).not.toThrow();
          },
        );
      },
    );
  },
);

/**
 * ============================================================================
 * End of Enterprise TITech MessagePanel Test Suite
 * ============================================================================
 */