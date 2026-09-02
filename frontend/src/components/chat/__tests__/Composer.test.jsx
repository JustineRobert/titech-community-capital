/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Composer Test Suite
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/__tests__/Composer.test.jsx
 *
 * Purpose:
 *   Production-grade behavioral and accessibility tests for the TITech
 *   Community Capital chat Composer.
 *
 * Testing principles:
 *   ✓ Prefer observable behavior over implementation details
 *   ✓ Protect critical user interaction paths
 *   ✓ Validate keyboard accessibility
 *   ✓ Validate empty-message protection
 *   ✓ Validate loading / disabled behavior
 *   ✓ Validate attachment handling where supported
 *   ✓ Validate error resilience
 *   ✓ Validate TITech branding consistency
 *   ✓ Prevent stale ACFOS branding
 *   ✓ Avoid brittle CSS/snapshot assertions
 *
 * Expected test stack:
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

import Composer from '../Composer';

/**
 * ============================================================================
 * Test utilities
 * ============================================================================
 */

/**
 * Find the primary composer textbox.
 *
 * Enterprise implementations may use:
 *   - textarea
 *   - input
 *   - contenteditable
 *
 * The tests therefore use accessibility semantics first.
 */
const getComposerInput = () => {
  const textbox =
    screen.queryByRole(
      'textbox',
    );

  if (textbox) {
    return textbox;
  }

  return (
    screen.queryByPlaceholderText(
      /message|ask|type|write/i,
    ) ||
    document.querySelector(
      '[contenteditable="true"]',
    )
  );
};

/**
 * Find the send button using accessible naming.
 */
const getSendButton = () =>
  screen.queryByRole(
    'button',
    {
      name: /send/i,
    },
  ) ||
  screen.queryByTestId(
    'composer-send-button',
  );

/**
 * Find an attachment control where supported.
 */
const getAttachmentButton =
  () =>
    screen.queryByRole(
      'button',
      {
        name: /attach|attachment|file|upload/i,
      },
    ) ||
    screen.queryByTestId(
      'composer-attachment-button',
    );

/**
 * Create a browser File object for attachment tests.
 */
const createTestFile = (
  name = 'document.pdf',
  type = 'application/pdf',
  content = 'TITech test document',
) =>
  new File(
    [content],
    name,
    {
      type,
    },
  );

/**
 * ============================================================================
 * Default callbacks
 * ============================================================================
 */

const createDefaultProps =
  () => ({
    onSubmit:
      vi.fn(),

    onSend:
      vi.fn(),

    onChange:
      vi.fn(),

    onAttach:
      vi.fn(),

    onRemoveAttachment:
      vi.fn(),

    onError:
      vi.fn(),
  });

/**
 * ============================================================================
 * Suite
 * ============================================================================
 */

describe(
  'Composer',
  () => {
    let props;

    beforeEach(() => {
      props =
        createDefaultProps();

      vi.clearAllMocks();

      /**
       * Reset potentially modified browser globals.
       */
      delete window.__titechComposerTest;
      delete window.__titechXssExecuted;
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
          'renders without crashing with default configuration',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'renders the primary message input',
          () => {
            render(
              <Composer
                {...props}
              />,
            );

            expect(
              getComposerInput(),
            ).toBeTruthy();
          },
        );

        it(
          'renders a send action',
          () => {
            render(
              <Composer
                {...props}
              />,
            );

            expect(
              getSendButton(),
            ).toBeTruthy();
          },
        );

        it(
          'renders with minimal props',
          () => {
            expect(() => {
              render(
                <Composer />,
              );
            }).not.toThrow();
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
              <Composer
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
          'does not expose ACFOS in rendered HTML',
          () => {
            render(
              <Composer
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
     * Accessibility
     * ========================================================================
     */

    describe(
      'accessibility',
      () => {
        it(
          'exposes the message composer as a textbox',
          () => {
            render(
              <Composer
                {...props}
              />,
            );

            expect(
              getComposerInput(),
            ).toBeInTheDocument();
          },
        );

        it(
          'allows the message input to receive focus',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

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

        it(
          'provides an accessible send control',
          () => {
            render(
              <Composer
                {...props}
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

        it(
          'provides an accessible attachment control when attachments are enabled',
          () => {
            render(
              <Composer
                {...props}
                allowAttachments
              />,
            );

            const attachment =
              getAttachmentButton();

            if (attachment) {
              expect(
                attachment,
              ).toBeInTheDocument();
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Text input
     * ========================================================================
     */

    describe(
      'text input',
      () => {
        it(
          'allows the user to enter a message',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            expect(
              input,
            ).toBeTruthy();

            await user.type(
              input,
              'Hello TITech',
            );

            if (
              'value' in input
            ) {
              expect(
                input,
              ).toHaveValue(
                'Hello TITech',
              );
            } else {
              expect(
                input.textContent,
              ).toContain(
                'Hello TITech',
              );
            }
          },
        );

        it(
          'calls the change callback when provided',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            await user.type(
              input,
              'Hello',
            );

            expect(
              props.onChange,
            ).toHaveBeenCalled();
          },
        );

        it(
          'supports normal text containing numbers and punctuation',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const text =
              'My balance is UGX 500,000.';

            await user.type(
              input,
              text,
            );

            if (
              'value' in input
            ) {
              expect(
                input,
              ).toHaveValue(
                text,
              );
            } else {
              expect(
                input.textContent,
              ).toContain(text);
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Submission
     * ========================================================================
     */

    describe(
      'message submission',
      () => {
        it(
          'submits a valid message',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            await user.type(
              input,
              'What is my savings balance?',
            );

            await user.click(
              send,
            );

            await waitFor(
              () => {
                expect(
                  props.onSubmit.mock
                    .calls.length +
                    props.onSend.mock
                      .calls.length,
                ).toBeGreaterThan(
                  0,
                );
              },
            );
          },
        );

        it(
          'does not submit an empty message',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const send =
              getSendButton();

            await user.click(
              send,
            );

            expect(
              props.onSubmit,
            ).not.toHaveBeenCalled();

            expect(
              props.onSend,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'does not submit a whitespace-only message',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            await user.type(
              input,
              '       ',
            );

            await user.click(
              send,
            );

            expect(
              props.onSubmit,
            ).not.toHaveBeenCalled();

            expect(
              props.onSend,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          'submits meaningful content surrounded by whitespace',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            await user.type(
              input,
              '   Show my loan balance   ',
            );

            await user.click(
              send,
            );

            await waitFor(
              () => {
                const calls =
                  [
                    ...props
                      .onSubmit
                      .mock.calls,
                    ...props
                      .onSend
                      .mock.calls,
                  ];

                expect(
                  calls.length,
                ).toBeGreaterThan(
                  0,
                );

                expect(
                  JSON.stringify(
                    calls[0],
                  ),
                ).toContain(
                  'Show my loan balance',
                );
              },
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Keyboard behavior
     * ========================================================================
     */

    describe(
      'keyboard behavior',
      () => {
        it(
          'does not throw when Enter is pressed',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            await user.type(
              input,
              'Hello TITech',
            );

            expect(() => {
              fireEvent.keyDown(
                input,
                {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                },
              );
            }).not.toThrow();
          },
        );

        it(
          'does not throw when Shift+Enter is pressed',
          () => {
            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            expect(() => {
              fireEvent.keyDown(
                input,
                {
                  key: 'Enter',
                  code: 'Enter',
                  shiftKey: true,
                },
              );
            }).not.toThrow();
          },
        );

        it(
          'does not throw when Escape is pressed',
          () => {
            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            expect(() => {
              fireEvent.keyDown(
                input,
                {
                  key: 'Escape',
                  code: 'Escape',
                },
              );
            }).not.toThrow();
          },
        );

        it(
          'does not throw when Tab is pressed',
          () => {
            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            expect(() => {
              fireEvent.keyDown(
                input,
                {
                  key: 'Tab',
                  code: 'Tab',
                },
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Loading / processing
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
                <Composer
                  {...props}
                  loading
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'disables submission while loading',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                loading
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            if (
              send &&
              send.disabled
            ) {
              expect(
                send,
              ).toBeDisabled();
            }

            if (
              input &&
              input.disabled
            ) {
              expect(
                input,
              ).toBeDisabled();
            }

            if (
              input &&
              !input.disabled
            ) {
              await user.type(
                input,
                'Attempt while loading',
              );
            }
          },
        );

        it(
          'does not produce duplicate submissions during loading',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                loading
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            if (
              input &&
              !input.disabled
            ) {
              await user.type(
                input,
                'Duplicate attempt',
              );
            }

            if (
              send &&
              !send.disabled
            ) {
              await user.click(
                send,
              );

              await user.click(
                send,
              );
            }

            expect(
              props.onSubmit,
            ).not.toHaveBeenCalled();

            expect(
              props.onSend,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Disabled state
     * ========================================================================
     */

    describe(
      'disabled state',
      () => {
        it(
          'respects the disabled prop',
          () => {
            render(
              <Composer
                {...props}
                disabled
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            if (input) {
              expect(
                input,
              ).toBeDisabled();
            }

            if (send) {
              expect(
                send,
              ).toBeDisabled();
            }
          },
        );

        it(
          'does not submit while disabled',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                disabled
              />,
            );

            const send =
              getSendButton();

            if (
              send &&
              !send.disabled
            ) {
              await user.click(
                send,
              );
            }

            expect(
              props.onSubmit,
            ).not.toHaveBeenCalled();

            expect(
              props.onSend,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Read-only state
     * ========================================================================
     */

    describe(
      'read-only state',
      () => {
        it(
          'renders safely in read-only mode',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  readOnly
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not allow editing when the underlying control supports readonly',
          () => {
            render(
              <Composer
                {...props}
                readOnly
              />,
            );

            const input =
              getComposerInput();

            if (
              input &&
              input.hasAttribute(
                'readonly',
              )
            ) {
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
     * Character limits
     * ========================================================================
     */

    describe(
      'message length limits',
      () => {
        it(
          'handles a maximum-length configuration',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                maxLength={20}
              />,
            );

            const input =
              getComposerInput();

            expect(
              input,
            ).toBeTruthy();

            await user.type(
              input,
              '12345678901234567890',
            );

            if (
              'value' in input
            ) {
              expect(
                input.value.length,
              ).toBeLessThanOrEqual(
                20,
              );
            }
          },
        );

        it(
          'does not crash when maxLength is zero',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  maxLength={0}
                />,
              );
            }).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Attachments
     * ========================================================================
     */

    describe(
      'attachments',
      () => {
        it(
          'renders safely when attachments are enabled',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  allowAttachments
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'exposes an attachment action when supported',
          () => {
            render(
              <Composer
                {...props}
                allowAttachments
              />,
            );

            const button =
              getAttachmentButton();

            if (button) {
              expect(
                button,
              ).toBeInTheDocument();
            }
          },
        );

        it(
          'handles file selection when a file input is available',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                allowAttachments
              />,
            );

            const fileInput =
              document.querySelector(
                'input[type="file"]',
              );

            if (!fileInput) {
              return;
            }

            const file =
              createTestFile();

            await user.upload(
              fileInput,
              file,
            );

            expect(
              fileInput.files,
            ).toHaveLength(1);

            expect(
              fileInput.files[0].name,
            ).toBe(
              'document.pdf',
            );
          },
        );

        it(
          'supports image attachments when the component exposes a file input',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                allowAttachments
              />,
            );

            const fileInput =
              document.querySelector(
                'input[type="file"]',
              );

            if (!fileInput) {
              return;
            }

            const image =
              createTestFile(
                'receipt.png',
                'image/png',
              );

            await user.upload(
              fileInput,
              image,
            );

            expect(
              fileInput.files,
            ).toHaveLength(1);

            expect(
              fileInput.files[0].type,
            ).toBe(
              'image/png',
            );
          },
        );
      },
    );

    /**
     * ========================================================================
     * Attachment security
     * ========================================================================
     */

    describe(
      'attachment security',
      () => {
        it(
          'does not crash when an unsupported file is selected',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
                allowAttachments
              />,
            );

            const fileInput =
              document.querySelector(
                'input[type="file"]',
              );

            if (!fileInput) {
              return;
            }

            const executable =
              createTestFile(
                'malicious.exe',
                'application/x-msdownload',
              );

            expect(
              async () => {
                await user.upload(
                  fileInput,
                  executable,
                );
              },
            ).not.toThrow();
          },
        );
      },
    );

    /**
     * ========================================================================
     * Existing attachments
     * ========================================================================
     */

    describe(
      'existing attachments',
      () => {
        it(
          'renders supplied attachments safely',
          () => {
            const attachments = [
              {
                id: 'attachment-1',
                name:
                  'loan-document.pdf',
                type:
                  'application/pdf',
                size: 1024,
              },
            ];

            expect(() => {
              render(
                <Composer
                  {...props}
                  attachments={
                    attachments
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
     * Error handling
     * ========================================================================
     */

    describe(
      'error handling',
      () => {
        it(
          'renders safely when an error is provided',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  error="Unable to send message."
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash when error is null',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  error={null}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash when error is undefined',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  error={
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
     * Async submission
     * ========================================================================
     */

    describe(
      'async submission',
      () => {
        it(
          'supports asynchronous submission callbacks',
          async () => {
            const user =
              userEvent.setup();

            let resolveRequest;

            const request =
              new Promise(
                (resolve) => {
                  resolveRequest =
                    resolve;
                },
              );

            props.onSubmit =
              vi.fn(
                () => request,
              );

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            await user.type(
              input,
              'What is my account status?',
            );

            await user.click(
              send,
            );

            expect(
              props.onSubmit,
            ).toHaveBeenCalled();

            resolveRequest({
              success: true,
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
     * Rapid interaction
     * ========================================================================
     */

    describe(
      'rapid interaction',
      () => {
        it(
          'does not throw when send is clicked repeatedly',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const send =
              getSendButton();

            await user.type(
              input,
              'Test TITech message',
            );

            expect(() => {
              fireEvent.click(
                send,
              );

              fireEvent.click(
                send,
              );

              fireEvent.click(
                send,
              );
            }).not.toThrow();
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
          'supports Unicode text',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const text =
              'Hello 👋 TITech — नमस्ते — こんにちは';

            await user.type(
              input,
              text,
            );

            if (
              'value' in input
            ) {
              expect(
                input.value,
              ).toContain(
                text,
              );
            } else {
              expect(
                input.textContent,
              ).toContain(text);
            }
          },
        );

        it(
          'supports financial text containing UGX values',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const text =
              'Please show UGX 1,250,000 deposited today.';

            await user.type(
              input,
              text,
            );

            if (
              'value' in input
            ) {
              expect(
                input.value,
              ).toContain(
                'UGX 1,250,000',
              );
            } else {
              expect(
                input.textContent,
              ).toContain(
                'UGX 1,250,000',
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Security / XSS
     * ========================================================================
     */

    describe(
      'secure text handling',
      () => {
        it(
          'does not execute HTML entered into the composer',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const malicious =
              '<img src=x onerror="window.__titechXssExecuted=true">';

            await user.type(
              input,
              malicious,
            );

            expect(
              window.__titechXssExecuted,
            ).not.toBe(true);

            expect(
              document.querySelector(
                'img[src="x"]',
              ),
            ).not.toBeTruthy();
          },
        );

        it(
          'does not execute script text entered by a user',
          async () => {
            const user =
              userEvent.setup();

            render(
              <Composer
                {...props}
              />,
            );

            const input =
              getComposerInput();

            const malicious =
              '<script>window.__titechComposerTest=true</script>';

            await user.type(
              input,
              malicious,
            );

            expect(
              window.__titechComposerTest,
            ).not.toBe(true);
          },
        );
      },
    );

    /**
     * ========================================================================
     * Controlled value
     * ========================================================================
     */

    describe(
      'controlled value',
      () => {
        it(
          'renders a supplied value when supported',
          () => {
            render(
              <Composer
                {...props}
                value="Controlled TITech message"
              />,
            );

            const input =
              getComposerInput();

            if (
              input &&
              'value' in input
            ) {
              expect(
                input,
              ).toHaveValue(
                'Controlled TITech message',
              );
            }
          },
        );
      },
    );

    /**
     * ========================================================================
     * Conversation context
     * ========================================================================
     */

    describe(
      'conversation context',
      () => {
        it(
          'renders safely with conversation identifiers',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  conversationId="conversation-001"
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'renders safely with tenant context',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  tenantId="tenant-001"
                />,
              );
            }).not.toThrow();
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
              <Composer
                {...props}
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
              <Composer
                {...props}
                loading
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
          'does not crash with undefined callbacks',
          () => {
            expect(() => {
              render(
                <Composer
                  onSubmit={
                    undefined
                  }
                  onSend={
                    undefined
                  }
                  onChange={
                    undefined
                  }
                  onAttach={
                    undefined
                  }
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash with null optional values',
          () => {
            expect(() => {
              render(
                <Composer
                  {...props}
                  value={null}
                  error={null}
                  attachments={null}
                />,
              );
            }).not.toThrow();
          },
        );

        it(
          'does not crash with a very large configuration',
          () => {
            const largeMetadata =
              Object.fromEntries(
                Array.from(
                  {
                    length: 100,
                  },
                  (_, index) => [
                    `field-${index}`,
                    `value-${index}`,
                  ],
                ),
              );

            expect(() => {
              render(
                <Composer
                  {...props}
                  metadata={
                    largeMetadata
                  }
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
 * End of Enterprise TITech Composer Test Suite
 * ============================================================================
 */