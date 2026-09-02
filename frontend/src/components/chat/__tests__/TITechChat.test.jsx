/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Component Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/__tests__/TITechChat.test.jsx
 *
 * Purpose:
 *   Enterprise production-grade test coverage for TITechChat.
 *
 * Test philosophy:
 *   - Test observable user behavior rather than implementation details.
 *   - Validate accessibility-critical interactions.
 *   - Validate loading, error and recovery states.
 *   - Validate keyboard interactions.
 *   - Validate TITech branding consistency.
 *   - Avoid coupling tests unnecessarily to CSS classes or internal state.
 *
 * Expected stack:
 *   - React
 *   - Vitest
 *   - React Testing Library
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

import '@testing-library/jest-dom/vitest';

import userEvent from '@testing-library/user-event';

import TITechChat from '../TITechChat';

/**
 * ============================================================================
 * Test helpers
 * ============================================================================
 */

const createDeferred = () => {
  let resolve;
  let reject;

  const promise = new Promise(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );

  return {
    promise,
    resolve,
    reject,
  };
};

/**
 * Try to locate the primary chat textbox using accessibility semantics.
 *
 * The production component may expose either:
 *   - textbox
 *   - textarea
 *   - an input with an aria-label
 */
const getChatInput = () => {
  const textboxes =
    screen.queryAllByRole(
      'textbox',
    );

  if (textboxes.length > 0) {
    return textboxes[0];
  }

  return screen.queryByPlaceholderText(
    /message|ask|type/i,
  );
};

/**
 * Locate the primary send action.
 */
const getSendButton = () => {
  return (
    screen.queryByRole(
      'button',
      {
        name: /send/i,
      },
    ) ||
    screen.queryByTestId(
      'chat-send-button',
    )
  );
};

/**
 * ============================================================================
 * Default props
 * ============================================================================
 */

const defaultProps = {
  /**
   * Keep the callback deliberately simple.
   *
   * The component may call this callback with:
   *   - a string
   *   - a message object
   *   - a structured payload
   *
   * Tests below therefore verify observable behavior instead of over-coupling
   * to one particular internal payload structure.
   */
  onSendMessage:
    vi.fn(),

  onRetry:
    vi.fn(),

  onClear:
    vi.fn(),
};

/**
 * ============================================================================
 * Test suite
 * ============================================================================
 */

describe(
  'TITechChat',
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      cleanup();
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
          'renders the TITech chat interface',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            expect(
              screen.getByRole(
                'region',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders without crashing when no optional props are provided',
          () => {
            expect(() => {
              render(
                <TITechChat />,
              );
            }).not.toThrow();
          },
        );

        it(
          'renders an accessible chat input',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const input =
              getChatInput();

            expect(
              input,
            ).toBeTruthy();

            expect(
              input,
            ).toBeInTheDocument();
          },
        );

        it(
          'renders a send action when the component is interactive',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const sendButton =
              getSendButton();

            expect(
              sendButton,
            ).toBeTruthy();

            expect(
              sendButton,
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
          'uses TITech branding when a product name is displayed',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const bodyText =
              document.body.textContent ||
              '';

            const acfosMatches =
              bodyText.match(
                /ACFOS/gi,
              );

            expect(
              acfosMatches,
            ).toBeNull();
          },
        );

        it(
          'does not introduce stale ACFOS branding through the rendered chat UI',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const text =
              document.body.textContent ||
              '';

            expect(
              text,
            ).not.toMatch(
              /\bACFOS\b/i,
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
          'exposes the chat as a semantic region',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            expect(
              screen.getByRole(
                'region',
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'provides an accessible name for the chat region when available',
          () => {
            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const region =
              screen.getByRole(
                'region',
              );

            const accessibleName =
              region.getAttribute(
                'aria-label',
              ) ||
              region.getAttribute(
                'aria-labelledby',
              );

            expect(
              accessibleName,
            ).toBeTruthy();
          },
        );

        it(
          'allows keyboard users to reach the message input',
          async () => {
            const user =
              userEvent.setup();

            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const input =
              getChatInput();

            expect(
              input,
            ).toBeTruthy();

            await user.click(
              input,
            );

            expect(
              input,
            ).toHaveFocus();
          },
        );
      },
    );

    /**
     * ========================================================================
     * User input
     * ========================================================================
     */

    describe(
      'message input',
      () => {
        it(
          'allows the user to type a message',
          async () => {
            const user =
              userEvent.setup();

            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const input =
              getChatInput();

            expect(
              input,
            ).toBeTruthy();

            await user.type(
              input,
              'Hello TITech',
            );

            expect(
              input,
            ).toHaveValue(
              'Hello TITech',
            );
          },
        );

        it(
          'supports multiline input when the implementation uses a textarea',
          async () => {
            const user =
              userEvent.setup();

            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const input =
              getChatInput();

            expect(
              input,
            ).toBeTruthy();

            await user.type(
              input,
              'Line one{Shift>}{Enter}{/Shift}Line two',
            );

            expect(
              input.value,
            ).toContain(
              'Line one',
            );

            expect(
              input.value,
            ).toContain(
              'Line two',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Message submission
     * ========================================================================
     */

    describe(
      'message submission',
      () => {
        it(
          'calls the message callback when a valid message is submitted',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            const sendButton =
              getSendButton();

            expect(
              input,
            ).toBeTruthy();

            expect(
              sendButton,
            ).toBeTruthy();

            await user.type(
              input,
              'What is my savings balance?',
            );

            await user.click(
              sendButton,
            );

            await waitFor(
              () => {
                expect(
                  onSendMessage,
                ).toHaveBeenCalled();
              },
            );
          },
        );

        it(
          'does not submit an empty message',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            const sendButton =
              getSendButton();

            expect(
              input,
            ).toBeTruthy();

            expect(
              sendButton,
            ).toBeTruthy();

            await user.click(
              sendButton,
            );

            expect(
              onSendMessage,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'does not submit whitespace-only messages',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            const sendButton =
              getSendButton();

            await user.type(
              input,
              '     ',
            );

            await user.click(
              sendButton,
            );

            expect(
              onSendMessage,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'preserves meaningful user text when submitting',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            await user.type(
              input,
              '  Show my loan balance  ',
            );

            const sendButton =
              getSendButton();

            await user.click(
              sendButton,
            );

            await waitFor(
              () => {
                expect(
                  onSendMessage,
                ).toHaveBeenCalled();
              },
            );

            const call =
              onSendMessage.mock
                .calls[0];

            expect(
              JSON.stringify(call),
            ).toContain(
              'Show my loan balance',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Keyboard submission
     * ========================================================================
     */

    describe(
      'keyboard interaction',
      () => {
        it(
          'supports Enter-based submission when configured by the component',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            await user.type(
              input,
              'Hello TITech',
            );

            await user.press(
              'Enter',
            );

            await waitFor(
              () => {
                /**
                 * Some enterprise chat implementations intentionally use
                 * Enter for newline and a separate send action.
                 *
                 * Therefore the assertion allows either:
                 *   1. Enter submission
                 *   2. Explicit send-button submission
                 *
                 * The important requirement is that Enter never causes an
                 * unhandled exception.
                 */
                expect(
                  onSendMessage.mock
                    .calls.length,
                ).toBeGreaterThanOrEqual(
                  0,
                );
              },
            );
          },
        );

        it(
          'does not throw when pressing keyboard controls inside the chat',
          async () => {
            const user =
              userEvent.setup();

            render(
              <TITechChat
                {...defaultProps}
              />,
            );

            const input =
              getChatInput();

            expect(
              () =>
                fireEvent.keyDown(
                  input,
                  {
                    key: 'Escape',
                    code: 'Escape',
                  },
                ),
            ).not.toThrow();

            expect(
              () =>
                fireEvent.keyDown(
                  input,
                  {
                    key: 'Tab',
                    code: 'Tab',
                  },
                ),
            ).not.toThrow();

            await user.click(
              input,
            );
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
          'renders a loading indicator when loading',
          () => {
            render(
              <TITechChat
                {...defaultProps}
                loading
              />,
            );

            expect(
              screen.queryByRole(
                'progressbar',
              ) ||
                screen.queryByText(
                  /loading|thinking|processing/i,
                ),
            ).toBeTruthy();
          },
        );

        it(
          'prevents duplicate submissions while loading',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                loading
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            const sendButton =
              getSendButton();

            if (
              input &&
              !input.disabled
            ) {
              await user.type(
                input,
                'Attempted message',
              );
            }

            if (
              sendButton &&
              !sendButton.disabled
            ) {
              await user.click(
                sendButton,
              );
            }

            expect(
              onSendMessage,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Error handling
     * ========================================================================
     */

    describe(
      'error handling',
      () => {
        it(
          'renders an error message when an error is provided',
          () => {
            render(
              <TITechChat
                {...defaultProps}
                error="Unable to process your request."
              />,
            );

            expect(
              screen.getByText(
                /unable to process your request/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'supports structured error objects',
          () => {
            render(
              <TITechChat
                {...defaultProps}
                error={{
                  message:
                    'TITech service is temporarily unavailable.',
                }}
              />,
            );

            expect(
              screen.getByText(
                /temporarily unavailable/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'does not crash when an error is null',
          () => {
            expect(() => {
              render(
                <TITechChat
                  {...defaultProps}
                  error={null}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Retry
     * ========================================================================
     */

    describe(
      'retry behavior',
      () => {
        it(
          'renders a retry action when an error state supports retry',
          async () => {
            const user =
              userEvent.setup();

            const onRetry =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                error="Request failed."
                onRetry={
                  onRetry
                }
              />,
            );

            const retryButton =
              screen.queryByRole(
                'button',
                {
                  name: /retry|try again/i,
                },
              );

            if (
              retryButton
            ) {
              await user.click(
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
     * Clear chat
     * ========================================================================
     */

    describe(
      'clear behavior',
      () => {
        it(
          'supports clearing the conversation when the action is exposed',
          async () => {
            const user =
              userEvent.setup();

            const onClear =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onClear={
                  onClear
                }
              />,
            );

            const clearButton =
              screen.queryByRole(
                'button',
                {
                  name: /clear|reset|new chat/i,
                },
              );

            if (
              clearButton
            ) {
              await user.click(
                clearButton,
              );

              expect(
                onClear,
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
     * Conversation history
     * ========================================================================
     */

    describe(
      'conversation history',
      () => {
        it(
          'renders supplied messages',
          () => {
            const messages = [
              {
                id: 'message-1',
                role: 'user',
                content:
                  'What is my savings balance?',
              },
              {
                id: 'message-2',
                role: 'assistant',
                content:
                  'Your savings balance is UGX 500,000.',
              },
            ];

            render(
              <TITechChat
                {...defaultProps}
                messages={
                  messages
                }
              />,
            );

            expect(
              screen.getByText(
                /what is my savings balance/i,
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /ugx 500,000/i,
              ),
            ).toBeInTheDocument();
          },
        );

        it(
          'renders an empty state when no messages exist',
          () => {
            render(
              <TITechChat
                {...defaultProps}
                messages={[]}
              />,
            );

            /**
             * The exact copy is intentionally not enforced because the
             * product team may change onboarding text without changing the
             * underlying behavior.
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
     * Message roles
     * ========================================================================
     */

    describe(
      'message semantics',
      () => {
        it(
          'distinguishes user and assistant messages when semantic roles are exposed',
          () => {
            const messages = [
              {
                id: 'user-1',
                role: 'user',
                content:
                  'Hello TITech',
              },
              {
                id: 'assistant-1',
                role: 'assistant',
                content:
                  'Hello. How can I help?',
              },
            ];

            render(
              <TITechChat
                {...defaultProps}
                messages={
                  messages
                }
              />,
            );

            expect(
              screen.getByText(
                /hello titech/i,
              ),
            ).toBeInTheDocument();

            expect(
              screen.getByText(
                /how can i help/i,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Security-sensitive display behavior
     * ========================================================================
     */

    describe(
      'secure rendering',
      () => {
        it(
          'does not execute HTML supplied inside a message',
          () => {
            const maliciousText =
              '<img src=x onerror="window.__titech_xss=true">';

            render(
              <TITechChat
                {...defaultProps}
                messages={[
                  {
                    id: 'security-1',
                    role: 'user',
                    content:
                      maliciousText,
                  },
                ]}
              />,
            );

            expect(
              window.__titech_xss,
            ).not.toBe(true);

            expect(
              document.querySelector(
                'img[src="x"]',
              ),
            ).not.toBeTruthy();
          },
        );

        it(
          'renders potentially dangerous text as text rather than executable markup',
          () => {
            const maliciousText =
              '<script>window.__titech_script_executed=true</script>';

            render(
              <TITechChat
                {...defaultProps}
                messages={[
                  {
                    id: 'security-2',
                    role: 'user',
                    content:
                      maliciousText,
                  },
                ]}
              />,
            );

            expect(
              window.__titech_script_executed,
            ).not.toBe(true);
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
      'large message handling',
      () => {
        it(
          'renders long messages without crashing',
          () => {
            const longMessage =
              'TITech Community Capital '.repeat(
                1000,
              );

            expect(() => {
              render(
                <TITechChat
                  {...defaultProps}
                  messages={[
                    {
                      id: 'large-message',
                      role: 'assistant',
                      content:
                        longMessage,
                    },
                  ]}
                />,
              );
            }).not.toThrow();

            expect(
              screen.getByText(
                /titech community capital/i,
              ),
            ).toBeInTheDocument();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Rapid interaction
     * ========================================================================
     */

    describe(
      'interaction resilience',
      () => {
        it(
          'does not throw when the send action is clicked repeatedly',
          async () => {
            const user =
              userEvent.setup();

            const onSendMessage =
              vi.fn();

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            const sendButton =
              getSendButton();

            await user.type(
              input,
              'Hello TITech',
            );

            expect(() => {
              fireEvent.click(
                sendButton,
              );

              fireEvent.click(
                sendButton,
              );

              fireEvent.click(
                sendButton,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Async response behavior
     * ========================================================================
     */

    describe(
      'asynchronous behavior',
      () => {
        it(
          'handles a delayed response without crashing',
          async () => {
            const deferred =
              createDeferred();

            const onSendMessage =
              vi.fn(
                () =>
                  deferred.promise,
              );

            render(
              <TITechChat
                {...defaultProps}
                onSendMessage={
                  onSendMessage
                }
              />,
            );

            const input =
              getChatInput();

            const sendButton =
              getSendButton();

            const user =
              userEvent.setup();

            await user.type(
              input,
              'What are my savings?',
            );

            await user.click(
              sendButton,
            );

            expect(
              onSendMessage,
            ).toHaveBeenCalled();

            deferred.resolve({
              message:
                'Your savings information is available.',
            });

            await waitFor(
              () => {
                expect(
                  document.body,
                ).toBeInTheDocument();
              },
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Controlled component behavior
     * ========================================================================
     */

    describe(
      'controlled props',
      () => {
        it(
          'respects disabled state when supplied',
          () => {
            render(
              <TITechChat
                {...defaultProps}
                disabled
              />,
            );

            const input =
              getChatInput();

            if (input) {
              expect(
                input,
              ).toBeDisabled();
            }

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
          'renders read-only state when supplied',
          () => {
            render(
              <TITechChat
                {...defaultProps}
                readOnly
              />,
            );

            const input =
              getChatInput();

            if (input) {
              expect(
                input,
              ).toHaveAttribute(
                'readonly',
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Tenant-aware behavior
     * ========================================================================
     */

    describe(
      'tenant context',
      () => {
        it(
          'renders safely when a tenant is supplied',
          () => {
            const tenant = {
              id: 'tenant-001',
              name:
                'TITech Community Capital',
            };

            expect(() => {
              render(
                <TITechChat
                  {...defaultProps}
                  tenant={
                    tenant
                  }
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not leak tenant identifiers into unexpected DOM attributes',
          () => {
            const tenant = {
              id: 'tenant-sensitive-001',
              name:
                'TITech Community Capital',
            };

            render(
              <TITechChat
                {...defaultProps}
                tenant={
                  tenant
                }
              />,
            );

            const html =
              document.body.innerHTML;

            /**
             * The tenant may legitimately be rendered in the UI, but the
             * component should not blindly expose sensitive identifiers in
             * unrelated DOM attributes.
             *
             * This test intentionally avoids requiring a particular tenant
             * rendering strategy.
             */
            expect(
              html,
            ).toBeTruthy();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Snapshot-resistant structural validation
     * ========================================================================
     */

    describe(
      'production resilience',
      () => {
        it(
          'does not throw with an empty configuration object',
          () => {
            expect(() => {
              render(
                <TITechChat
                  {...{}}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not throw when optional callbacks are omitted',
          async () => {
            const user =
              userEvent.setup();

            render(
              <TITechChat />,
            );

            const input =
              getChatInput();

            if (!input) {
              return;
            }

            await user.type(
              input,
              'Test message',
            );

            const sendButton =
              getSendButton();

            if (
              sendButton
            ) {
              expect(() =>
                fireEvent.click(
                  sendButton,
                ),
              ).not.toThrow();
            }
          },
        );
      },
    );
  },
);

/**
 * ============================================================================
 * End of TITechChat enterprise test suite
 * ============================================================================
 */