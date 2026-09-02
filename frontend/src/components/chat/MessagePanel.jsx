'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Message Panel
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/MessagePanel.jsx
 *
 * Purpose:
 *   Production-grade orchestration shell for the TITechChat enterprise
 *   messaging workspace.
 *
 * Component hierarchy
 * ----------------------------------------------------------------------------
 *
 *   TITech Message Workspace
 *          │
 *          ▼
 *      MessagePanel
 *          │
 *     ┌────┼─────────────┐
 *     ▼    ▼             ▼
 *  Header MessageList   Composer
 *          │
 *          └── MessageBubble
 *                    │
 *                    └── AttachmentPreview
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Active conversation orchestration
 * ✓ Tenant context propagation
 * ✓ Message lifecycle coordination
 * ✓ Composer lifecycle
 * ✓ Reply state
 * ✓ Edit state
 * ✓ Conversation actions
 * ✓ Message actions
 * ✓ Loading/error/empty states
 * ✓ Attachment lifecycle hooks
 * ✓ Typing lifecycle hooks
 * ✓ Auto-scroll delegation
 * ✓ Keyboard shortcuts
 * ✓ Accessibility
 * ✓ Ref API
 * ✓ Defensive callback execution
 * ✓ Responsive/mobile hooks
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Presentation/orchestration only.
 *
 * This component MUST NOT:
 *   - authorize users
 *   - enforce tenant isolation
 *   - approve/reject loans
 *   - execute financial transactions
 *   - make fraud decisions
 *   - mutate authoritative financial records
 *
 * Those responsibilities belong to TITech's trusted API/service layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import ConversationHeader from './ConversationHeader.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import EmptyState from './EmptyState.jsx';
import ErrorState from './ErrorState.js';

import './message-panel.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_COMPOSER_PLACEHOLDER =
  'Write a message…';

const DEFAULT_MESSAGE_MAX_LENGTH =
  2000;

const COMPOSER_FOCUS_SELECTOR =
  'textarea, input[type="text"], input[type="search"]';


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


const safeText = (
  value,
  fallback = '',
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  try {
    return (
      String(value).trim() ||
      fallback
    );
  } catch {
    return fallback;
  }
};


const getConversationId = (
  conversation,
) =>
  conversation?.id ??
  conversation?.conversationId ??
  conversation?.uuid ??
  null;


const getConversationTitle = (
  conversation,
) =>
  safeText(
    conversation?.title ||
      conversation?.name ||
      conversation?.subject ||
      conversation?.conversationTitle,
    'TITech Conversation',
  );


const getConversationStatus = (
  conversation,
) =>
  safeText(
    conversation?.status,
  );


const getConversationParticipants = (
  conversation,
) =>
  Array.isArray(
    conversation?.participants,
  )
    ? conversation.participants
    : [];


const isPromiseLike = (
  value,
) =>
  value &&
  typeof value.then ===
    'function';


/**
 * Invoke an optional callback safely.
 *
 * The helper preserves callback return values so parent components can
 * return promises and the panel can await them where appropriate.
 */
const callHandler = (
  handler,
  ...args
) => {
  if (
    typeof handler !==
    'function'
  ) {
    return undefined;
  }

  return handler(
    ...args,
  );
};


const getComposerElement = (
  root,
) => {
  if (
    !root
  ) {
    return null;
  }

  return root.querySelector(
    COMPOSER_FOCUS_SELECTOR,
  );
};


/* ============================================================================
 * MessagePanel
 * ========================================================================== */

const MessagePanel =
  forwardRef(
    function MessagePanel(
      {
        /* --------------------------------------------------------------------
         * Conversation
         * ------------------------------------------------------------------ */

        conversation =
          null,

        conversations =
          [],

        conversationLoading =
          false,

        conversationError =
          null,

        conversationDisabled =
          false,

        tenant =
          null,

        activeConversationId =
          null,

        currentUserId,

        /* --------------------------------------------------------------------
         * Messages
         * ------------------------------------------------------------------ */

        messages =
          [],

        messagesLoading =
          false,

        messagesInitialLoading,

        messagesLoadingMore =
          false,

        messagesSending =
          false,

        messagesError =
          null,

        hasMoreMessages =
          false,

        unreadMessageCount =
          0,

        newMessageCount =
          0,

        unreadMarkerIndex,

        /* --------------------------------------------------------------------
         * Composer
         * ------------------------------------------------------------------ */

        composerDisabled =
          false,

        composerReadOnly =
          false,

        composerPlaceholder =
          DEFAULT_COMPOSER_PLACEHOLDER,

        composerMaxLength =
          DEFAULT_MESSAGE_MAX_LENGTH,

        composerAllowAttachments =
          true,

        composerMaxFileSize,

        composerAllowedMimeTypes,

        /* --------------------------------------------------------------------
         * Conversation callbacks
         * ------------------------------------------------------------------ */

        onConversationSelect,

        onConversationLoad,

        onConversationRefresh,

        onConversationSearch,

        onNewConversation,

        onConversationArchive,

        onConversationUnarchive,

        onConversationPin,

        onConversationDelete,

        /* --------------------------------------------------------------------
         * Message callbacks
         * ------------------------------------------------------------------ */

        onMessagesLoad,

        onMessagesLoadMore,

        onMessagesRetry,

        onMessageSend,

        onMessageReply,

        onMessageCopy,

        onMessageEdit,

        onMessageDelete,

        onMessageRetry,

        onMessageRegenerate,

        customMessageActions =
          [],

        isUserOwnMessage,

        /* --------------------------------------------------------------------
         * Attachment callbacks
         * ------------------------------------------------------------------ */

        onAttachmentAdd,

        onAttachmentRemove,

        onAttachmentRetry,

        onAttachmentUpload,

        /* --------------------------------------------------------------------
         * Typing
         * ------------------------------------------------------------------ */

        onTypingStart,

        onTypingStop,

        /* --------------------------------------------------------------------
         * Header presentation
         * ------------------------------------------------------------------ */

        showConversationHeader =
          true,

        showTenant =
          true,

        showParticipantCount =
          true,

        showConversationStatus =
          true,

        showConversationSearch =
          false,

        showConversationRefresh =
          true,

        showConversationActions =
          true,

        conversationOnline =
          false,

        conversationTyping =
          false,

        /* --------------------------------------------------------------------
         * Message presentation
         * ------------------------------------------------------------------ */

        showMessageAvatars =
          true,

        showMessageSender =
          true,

        showMessageTimestamps =
          true,

        showMessageStatus =
          true,

        showMessageActions =
          true,

        showMessageAttachments =
          true,

        showEditedLabel =
          true,

        showMessageDateSeparators =
          true,

        groupMessages =
          true,

        autoScroll =
          true,

        /* --------------------------------------------------------------------
         * Empty/error state
         * ------------------------------------------------------------------ */

        showEmptyState =
          true,

        showErrorState =
          true,

        emptyTitle =
          'No conversation selected',

        emptyMessage =
          'Select a TITech conversation to begin messaging.',

        /* --------------------------------------------------------------------
         * Workspace state
         * ------------------------------------------------------------------ */

        loading =
          false,

        disabled =
          false,

        readOnly =
          false,

        compact =
          false,

        mobile =
          false,

        className =
          '',

        ariaLabel =
          'TITech messaging panel',

        testId =
          'titech-message-panel',

        /* --------------------------------------------------------------------
         * Advanced lifecycle hooks
         * ------------------------------------------------------------------ */

        beforeSend,

        afterSend,

        onPanelFocus,

        onPanelBlur,

        onPanelKeyDown,

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const panelId =
        `titech-message-panel-${generatedId}`;

      const rootRef =
        useRef(null);

      const headerRef =
        useRef(null);

      const messageListRef =
        useRef(null);

      const composerContainerRef =
        useRef(null);

      const mountedRef =
        useRef(true);

      const [
        replyMessage,
        setReplyMessage,
      ] =
        useState(
          null,
        );

      const [
        editMessage,
        setEditMessage,
      ] =
        useState(
          null,
        );

      const [
        panelError,
        setPanelError,
      ] =
        useState(
          '',
        );

      const [
        localSending,
        setLocalSending,
      ] =
        useState(
          false,
        );


      /* ======================================================================
       * Lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          mountedRef.current =
            true;

          return () => {
            mountedRef.current =
              false;
          };
        },
        [],
      );


      /* ======================================================================
       * Derived conversation context
       * ==================================================================== */

      const resolvedConversationId =
        activeConversationId ??
        getConversationId(
          conversation,
        );

      const resolvedConversation =
        conversation;

      const resolvedTitle =
        getConversationTitle(
          resolvedConversation,
        );

      const resolvedStatus =
        getConversationStatus(
          resolvedConversation,
        );

      const participants =
        getConversationParticipants(
          resolvedConversation,
        );

      const conversationSelected =
        resolvedConversationId !==
          null &&
        resolvedConversationId !==
          undefined &&
        String(
          resolvedConversationId,
        ).trim() !== '';

      const effectiveSending =
        Boolean(
          localSending ||
            messagesSending,
        );

      const effectiveDisabled =
        Boolean(
          disabled ||
            conversationDisabled ||
            composerDisabled ||
            loading,
        );

      const effectiveError =
        panelError ||
        conversationError ||
        messagesError;


      /* ======================================================================
       * Conversation lifecycle reset
       * ==================================================================== */

      useEffect(
        () => {
          setReplyMessage(
            null,
          );

          setEditMessage(
            null,
          );

          setPanelError(
            '',
          );
        },
        [
          resolvedConversationId,
        ],
      );


      /* ======================================================================
       * Focus helpers
       * ==================================================================== */

      const focusComposer =
        useCallback(
          () => {
            const composerRoot =
              composerContainerRef.current;

            const input =
              getComposerElement(
                composerRoot,
              );

            if (
              input
            ) {
              input.focus();
              return true;
            }

            return false;
          },
          [],
        );


      const focusMessageList =
        useCallback(
          () => {
            const list =
              messageListRef.current;

            if (
              typeof list?.focus ===
              'function'
            ) {
              list.focus();
              return true;
            }

            return false;
          },
          [],
        );


      /* ======================================================================
       * Conversation selection
       * ==================================================================== */

      const handleConversationSelect =
        useCallback(
          async (
            nextConversation,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            setPanelError(
              '',
            );

            try {
              const result =
                callHandler(
                  onConversationSelect,
                  nextConversation,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }

              if (
                typeof onConversationLoad ===
                'function'
              ) {
                const nextId =
                  getConversationId(
                    nextConversation,
                  );

                if (
                  nextId !==
                    null &&
                  nextId !==
                    undefined
                ) {
                  const loadResult =
                    onConversationLoad(
                      nextId,
                    );

                  if (
                    isPromiseLike(
                      loadResult,
                    )
                  ) {
                    await loadResult;
                  }
                }
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to open the TITech conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onConversationLoad,
            onConversationSelect,
          ],
        );


      /* ======================================================================
       * Header actions
       * ==================================================================== */

      const handleBack =
        useCallback(
          () => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            callHandler(
              onConversationSelect,
              null,
            );
          },
          [
            effectiveDisabled,
            onConversationSelect,
          ],
        );


      const handleConversationSearch =
        useCallback(
          (
            query,
          ) =>
            callHandler(
              onConversationSearch,
              query,
              {
                tenantId:
                  tenant?.id ??
                  tenant?.tenantId ??
                  null,
              },
            ),
          [
            onConversationSearch,
            tenant,
          ],
        );


      const handleConversationRefresh =
        useCallback(
          async () => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            setPanelError(
              '',
            );

            try {
              const conversationResult =
                callHandler(
                  onConversationRefresh,
                  resolvedConversation,
                );

              if (
                isPromiseLike(
                  conversationResult,
                )
              ) {
                await conversationResult;
              }

              const messageResult =
                callHandler(
                  onMessagesLoad,
                  resolvedConversationId,
                );

              if (
                isPromiseLike(
                  messageResult,
                )
              ) {
                await messageResult;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to refresh the TITech conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onConversationRefresh,
            onMessagesLoad,
            resolvedConversation,
            resolvedConversationId,
          ],
        );


      /* ======================================================================
       * New conversation
       * ==================================================================== */

      const handleNewConversation =
        useCallback(
          () => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            setReplyMessage(
              null,
            );

            setEditMessage(
              null,
            );

            callHandler(
              onNewConversation,
            );
          },
          [
            effectiveDisabled,
            onNewConversation,
          ],
        );


      /* ======================================================================
       * Conversation actions
       * ==================================================================== */

      const handleConversationArchive =
        useCallback(
          async (
            target,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onConversationArchive,
                  target,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to archive the conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onConversationArchive,
          ],
        );


      const handleConversationUnarchive =
        useCallback(
          async (
            target,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onConversationUnarchive,
                  target,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to restore the conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onConversationUnarchive,
          ],
        );


      const handleConversationPin =
        useCallback(
          async (
            target,
            nextPinned,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onConversationPin,
                  target,
                  nextPinned,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to update the conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onConversationPin,
          ],
        );


      const handleConversationDelete =
        useCallback(
          async (
            target,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onConversationDelete,
                  target,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to delete the conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onConversationDelete,
          ],
        );


      /* ======================================================================
       * Message reply
       * ==================================================================== */

      const handleMessageReply =
        useCallback(
          (
            message,
          ) => {
            if (
              effectiveDisabled ||
              readOnly
            ) {
              return;
            }

            setEditMessage(
              null,
            );

            setReplyMessage(
              message,
            );

            callHandler(
              onMessageReply,
              message,
            );

            requestAnimationFrame(
              () => {
                focusComposer();
              },
            );
          },
          [
            effectiveDisabled,
            focusComposer,
            onMessageReply,
            readOnly,
          ],
        );


      /* ======================================================================
       * Message edit
       * ==================================================================== */

      const handleMessageEdit =
        useCallback(
          (
            message,
          ) => {
            if (
              effectiveDisabled ||
              readOnly
            ) {
              return;
            }

            setReplyMessage(
              null,
            );

            setEditMessage(
              message,
            );

            callHandler(
              onMessageEdit,
              message,
            );

            requestAnimationFrame(
              () => {
                focusComposer();
              },
            );
          },
          [
            effectiveDisabled,
            focusComposer,
            onMessageEdit,
            readOnly,
          ],
        );


      /* ======================================================================
       * Message copy
       * ==================================================================== */

      const handleMessageCopy =
        useCallback(
          (
            message,
          ) =>
            callHandler(
              onMessageCopy,
              message,
            ),
          [
            onMessageCopy,
          ],
        );


      /* ======================================================================
       * Message delete
       * ==================================================================== */

      const handleMessageDelete =
        useCallback(
          async (
            message,
          ) => {
            if (
              effectiveDisabled ||
              readOnly
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onMessageDelete,
                  message,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to delete the message.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onMessageDelete,
            readOnly,
          ],
        );


      /* ======================================================================
       * Message retry
       * ==================================================================== */

      const handleMessageRetry =
        useCallback(
          async (
            message,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onMessageRetry,
                  message,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to retry the message.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onMessageRetry,
          ],
        );


      /* ======================================================================
       * Response regeneration
       * ==================================================================== */

      const handleMessageRegenerate =
        useCallback(
          async (
            message,
          ) => {
            if (
              effectiveDisabled
            ) {
              return;
            }

            try {
              const result =
                callHandler(
                  onMessageRegenerate,
                  message,
                );

              if (
                isPromiseLike(
                  result,
                )
              ) {
                await result;
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to regenerate the TITech response.',
                );
              }
            }
          },
          [
            effectiveDisabled,
            onMessageRegenerate,
          ],
        );


      /* ======================================================================
       * Send message
       * ==================================================================== */

      const handleMessageSend =
        useCallback(
          async (
            text,
            attachments = [],
          ) => {
            if (
              effectiveDisabled ||
              readOnly ||
              effectiveSending
            ) {
              return;
            }

            const normalizedText =
              safeText(
                text,
              );

            const normalizedAttachments =
              Array.isArray(
                attachments,
              )
                ? attachments
                : [];

            if (
              !normalizedText &&
              normalizedAttachments.length ===
                0
            ) {
              return;
            }

            setPanelError(
              '',
            );

            setLocalSending(
              true,
            );

            const context = {
              conversation:
                resolvedConversation,

              conversationId:
                resolvedConversationId,

              tenant,

              replyTo:
                replyMessage,

              editingMessage:
                editMessage,

              currentUserId,
            };

            try {
              if (
                typeof beforeSend ===
                'function'
              ) {
                const beforeResult =
                  beforeSend(
                    {
                      text:
                        normalizedText,

                      attachments:
                        normalizedAttachments,

                      ...context,
                    },
                  );

                if (
                  isPromiseLike(
                    beforeResult,
                  )
                ) {
                  await beforeResult;
                }
              }

              const sendResult =
                callHandler(
                  onMessageSend,
                  normalizedText,
                  normalizedAttachments,
                  context,
                );

              if (
                isPromiseLike(
                  sendResult,
                )
              ) {
                await sendResult;
              }

              if (
                mountedRef.current
              ) {
                setReplyMessage(
                  null,
                );

                setEditMessage(
                  null,
                );
              }

              if (
                typeof afterSend ===
                'function'
              ) {
                const afterResult =
                  afterSend(
                    sendResult,
                    {
                      text:
                        normalizedText,

                      attachments:
                        normalizedAttachments,

                      ...context,
                    },
                  );

                if (
                  isPromiseLike(
                    afterResult,
                  )
                ) {
                  await afterResult;
                }
              }
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to send the message.',
                );
              }

              throw error;
            } finally {
              if (
                mountedRef.current
              ) {
                setLocalSending(
                  false,
                );
              }
            }
          },
          [
            afterSend,
            beforeSend,
            currentUserId,
            editMessage,
            effectiveDisabled,
            effectiveSending,
            onMessageSend,
            readOnly,
            replyMessage,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      /* ======================================================================
       * Attachment hooks
       * ==================================================================== */

      const handleAttachmentAdd =
        useCallback(
          (
            attachment,
          ) =>
            callHandler(
              onAttachmentAdd,
              attachment,
              {
                conversation:
                  resolvedConversation,

                conversationId:
                  resolvedConversationId,

                tenant,
              },
            ),
          [
            onAttachmentAdd,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      const handleAttachmentRemove =
        useCallback(
          (
            attachment,
            index,
          ) =>
            callHandler(
              onAttachmentRemove,
              attachment,
              index,
              {
                conversationId:
                  resolvedConversationId,

                tenant,
              },
            ),
          [
            onAttachmentRemove,
            resolvedConversationId,
            tenant,
          ],
        );


      const handleAttachmentRetry =
        useCallback(
          (
            attachment,
            index,
          ) =>
            callHandler(
              onAttachmentRetry,
              attachment,
              index,
              {
                conversationId:
                  resolvedConversationId,

                tenant,
              },
            ),
          [
            onAttachmentRetry,
            resolvedConversationId,
            tenant,
          ],
        );


      const handleAttachmentUpload =
        useCallback(
          (
            files,
            metadata = {},
          ) =>
            callHandler(
              onAttachmentUpload,
              files,
              {
                ...metadata,

                conversationId:
                  resolvedConversationId,

                conversation:
                  resolvedConversation,

                tenant,
              },
            ),
          [
            onAttachmentUpload,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      /* ======================================================================
       * Typing
       * ==================================================================== */

      const handleTypingStart =
        useCallback(
          () =>
            callHandler(
              onTypingStart,
              {
                conversation:
                  resolvedConversation,

                conversationId:
                  resolvedConversationId,

                tenant,
              },
            ),
          [
            onTypingStart,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      const handleTypingStop =
        useCallback(
          () =>
            callHandler(
              onTypingStop,
              {
                conversation:
                  resolvedConversation,

                conversationId:
                  resolvedConversationId,

                tenant,
              },
            ),
          [
            onTypingStop,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      /* ======================================================================
       * Keyboard shortcuts
       * ==================================================================== */

      const handlePanelKeyDown =
        useCallback(
          (
            event,
          ) => {
            if (
              typeof onPanelKeyDown ===
              'function'
            ) {
              onPanelKeyDown(
                event,
              );
            }

            if (
              event.defaultPrevented
            ) {
              return;
            }

            /**
             * Ctrl/Cmd + Shift + L
             * Focus composer.
             */
            if (
              (
                event.ctrlKey ||
                event.metaKey
              ) &&
              event.shiftKey &&
              event.key.toLowerCase() ===
                'l'
            ) {
              event.preventDefault();

              focusComposer();

              return;
            }

            /**
             * Escape leaves reply/edit context.
             */
            if (
              event.key ===
              'Escape'
            ) {
              if (
                editMessage
              ) {
                event.preventDefault();

                setEditMessage(
                  null,
                );

                requestAnimationFrame(
                  () => {
                    focusComposer();
                  },
                );

                return;
              }

              if (
                replyMessage
              ) {
                event.preventDefault();

                setReplyMessage(
                  null,
                );

                requestAnimationFrame(
                  () => {
                    focusComposer();
                  },
                );
              }
            }
          },
          [
            editMessage,
            focusComposer,
            onPanelKeyDown,
            replyMessage,
          ],
        );


      /* ======================================================================
       * Public ref API
       * ==================================================================== */

      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          focusComposer,

          focusMessages:
            focusMessageList,

          focusHeader() {
            headerRef.current?.focus?.();
          },

          scrollToBottom(
            behavior =
              'smooth',
          ) {
            return messageListRef.current?.scrollToBottom?.(
              behavior,
            );
          },

          scrollToLatest(
            behavior =
              'smooth',
          ) {
            return messageListRef.current?.scrollToLatest?.(
              behavior,
            );
          },

          scrollToMessage(
            messageId,
            behavior =
              'smooth',
          ) {
            return messageListRef.current?.scrollToMessage?.(
              messageId,
              behavior,
            );
          },

          clearReply() {
            setReplyMessage(
              null,
            );
          },

          clearEdit() {
            setEditMessage(
              null,
            );
          },

          getReplyMessage() {
            return replyMessage;
          },

          getEditMessage() {
            return editMessage;
          },

          getConversation() {
            return resolvedConversation;
          },

          getConversationId() {
            return resolvedConversationId;
          },
        }),
        [
          editMessage,
          focusComposer,
          focusMessageList,
          replyMessage,
          resolvedConversation,
          resolvedConversationId,
        ],
      );


      /* ======================================================================
       * CSS state classes
       * ==================================================================== */

      const rootClassName = cn(
        'titech-message-panel',

        compact &&
          'titech-message-panel--compact',

        mobile &&
          'titech-message-panel--mobile',

        effectiveDisabled &&
          'titech-message-panel--disabled',

        effectiveSending &&
          'titech-message-panel--sending',

        !conversationSelected &&
          'titech-message-panel--no-conversation',

        effectiveError &&
          'titech-message-panel--has-error',

        className,
      );


      /* ======================================================================
       * No conversation selected
       * ==================================================================== */

      if (
        !conversationSelected
      ) {
        return (
          <section
            {...rest}
            ref={
              rootRef
            }
            id={
              panelId
            }
            className={
              rootClassName
            }
            aria-label={
              ariaLabel
            }
            tabIndex={
              -1
            }
            onFocus={
              onPanelFocus
            }
            onBlur={
              onPanelBlur
            }
            onKeyDown={
              handlePanelKeyDown
            }
            data-testid={
              testId
            }
          >
            {showEmptyState ? (
              <EmptyState
                variant="inbox"
                title={
                  emptyTitle
                }
                description={
                  emptyMessage
                }
                primaryAction={
                  typeof onNewConversation ===
                  'function'
                    ? {
                        label:
                          'New conversation',

                        onClick:
                          handleNewConversation,
                      }
                    : undefined
                }
              />
            ) : null}
          </section>
        );
      }


      /* ======================================================================
       * Main render
       * ==================================================================== */

      return (
        <section
          {...rest}
          ref={
            rootRef
          }
          id={
            panelId
          }
          className={
            rootClassName
          }
          aria-label={
            ariaLabel
          }
          tabIndex={
            -1
          }
          onFocus={
            onPanelFocus
          }
          onBlur={
            onPanelBlur
          }
          onKeyDown={
            handlePanelKeyDown
          }
          data-testid={
            testId
          }
          data-conversation-id={
            resolvedConversationId ??
            undefined
          }
          data-tenant-id={
            tenant?.id ??
            tenant?.tenantId ??
            undefined
          }
        >

          {/* =================================================================
              Header
              ================================================================= */}

          {showConversationHeader ? (
            <div
              className="titech-message-panel__header"
              data-testid="titech-message-panel-header"
            >
              <ConversationHeader
                ref={
                  headerRef
                }
                conversation={
                  resolvedConversation
                }
                tenant={
                  tenant
                }
                participants={
                  participants
                }
                online={
                  conversationOnline
                }
                typing={
                  conversationTyping
                }
                status={
                  resolvedStatus
                }
                loading={
                  conversationLoading
                }
                disabled={
                  effectiveDisabled
                }
                showBack={
                  mobile
                }
                showTenant={
                  showTenant
                }
                showParticipantCount={
                  showParticipantCount
                }
                showStatus={
                  showConversationStatus
                }
                showSearch={
                  showConversationSearch
                }
                showRefresh={
                  showConversationRefresh
                }
                showMenu={
                  showConversationActions
                }
                onBack={
                  handleBack
                }
                onSearch={
                  handleConversationSearch
                }
                onRefresh={
                  handleConversationRefresh
                }
                onNewConversation={
                  handleNewConversation
                }
                onPin={
                  handleConversationPin
                }
                onArchive={
                  handleConversationArchive
                }
                onUnarchive={
                  handleConversationUnarchive
                }
                onClose={
                  handleConversationDelete
                }
              />
            </div>
          ) : null}


          {/* =================================================================
              Panel-level error
              ================================================================= */}

          {effectiveError &&
          showErrorState ? (
            <div
              className="titech-message-panel__error"
              data-testid="titech-message-panel-error"
            >
              <ErrorState
                error={
                  effectiveError
                }
                variant="generic"
                onRetry={
                  handleConversationRefresh
                }
              />
            </div>
          ) : null}


          {/* =================================================================
              Messages
              ================================================================= */}

          <div
            className="titech-message-panel__messages"
            data-testid="titech-message-panel-messages"
          >
            <MessageList
              ref={
                messageListRef
              }
              messages={
                messages
              }
              currentUserId={
                currentUserId
              }
              conversationId={
                resolvedConversationId
              }
              tenant={
                tenant
              }
              loading={
                messagesLoading
              }
              initialLoading={
                messagesInitialLoading
              }
              loadingMore={
                messagesLoadingMore
              }
              sending={
                effectiveSending
              }
              error={
                messagesError
              }
              disabled={
                effectiveDisabled
              }
              hasMore={
                hasMoreMessages
              }
              onLoadMore={
                onMessagesLoadMore
              }
              onRetry={
                onMessagesRetry ||
                onMessagesLoad
                  ? () =>
                      callHandler(
                        onMessagesRetry ||
                          onMessagesLoad,
                        resolvedConversationId,
                      )
                  : undefined
              }
              onReply={
                handleMessageReply
              }
              onCopy={
                handleMessageCopy
              }
              onEdit={
                handleMessageEdit
              }
              onDelete={
                handleMessageDelete
              }
              onRetryMessage={
                handleMessageRetry
              }
              onRegenerate={
                handleMessageRegenerate
              }
              customMessageActions={
                customMessageActions
              }
              isUserOwnMessage={
                isUserOwnMessage
              }
              showAvatars={
                showMessageAvatars
              }
              showSender={
                showMessageSender
              }
              showTimestamps={
                showMessageTimestamps
              }
              showStatus={
                showMessageStatus
              }
              showActions={
                showMessageActions
              }
              showAttachments={
                showMessageAttachments
              }
              showEditedLabel={
                showEditedLabel
              }
              showDateSeparators={
                showMessageDateSeparators
              }
              groupMessages={
                groupMessages
              }
              autoScroll={
                autoScroll
              }
              unreadCount={
                unreadMessageCount
              }
              newMessageCount={
                newMessageCount
              }
              unreadMarkerIndex={
                unreadMarkerIndex
              }
              ariaLabel={`Messages for ${resolvedTitle}`}
            />
          </div>


          {/* =================================================================
              Reply / edit context
              ================================================================= */}

          {replyMessage ||
          editMessage ? (
            <div
              className="titech-message-panel__composer-context"
              role="status"
              aria-live="polite"
              data-testid="titech-message-panel-composer-context"
            >
              <div className="titech-message-panel__context-copy">

                <span className="titech-message-panel__context-label">
                  {editMessage
                    ? 'Editing message'
                    : 'Replying to'}
                </span>

                <span className="titech-message-panel__context-text">
                  {safeText(
                    editMessage?.content ||
                      editMessage?.text ||
                      editMessage?.body ||
                      replyMessage?.content ||
                      replyMessage?.text ||
                      replyMessage?.body,
                    'Message',
                  ).slice(
                    0,
                    180,
                  )}
                </span>

              </div>

              <button
                type="button"
                className="titech-message-panel__context-close"
                onClick={() => {
                  setReplyMessage(
                    null,
                  );

                  setEditMessage(
                    null,
                  );

                  focusComposer();
                }}
                disabled={
                  effectiveDisabled
                }
                aria-label={
                  editMessage
                    ? 'Cancel message edit'
                    : 'Cancel reply'
                }
                title={
                  editMessage
                    ? 'Cancel edit'
                    : 'Cancel reply'
                }
              >
                ×
              </button>
            </div>
          ) : null}


          {/* =================================================================
              Composer
              ================================================================= */}

          <div
            ref={
              composerContainerRef
            }
            className="titech-message-panel__composer"
            data-testid="titech-message-panel-composer"
          >
            <Composer
              onSend={
                handleMessageSend
              }
              onTypingStart={
                handleTypingStart
              }
              onTypingStop={
                handleTypingStop
              }
              placeholder={
                composerPlaceholder
              }
              allowAttachments={
                composerAllowAttachments
              }
              maxFileSize={
                composerMaxFileSize
              }
              allowedMimeTypes={
                composerAllowedMimeTypes
              }
              disabled={
                effectiveDisabled
              }
              autoFocus={
                !mobile
              }
              maxMessageLength={
                composerMaxLength
              }
              ariaLabel={`Compose message for ${resolvedTitle}`}
            />
          </div>

        </section>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

MessagePanel.displayName =
  'TITechMessagePanel';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

MessagePanel.propTypes = {
  conversation:
    PropTypes.object,

  conversations:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  conversationLoading:
    PropTypes.bool,

  conversationError:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  conversationDisabled:
    PropTypes.bool,

  tenant:
    PropTypes.object,

  activeConversationId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  currentUserId:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),

  messages:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  messagesLoading:
    PropTypes.bool,

  messagesInitialLoading:
    PropTypes.bool,

  messagesLoadingMore:
    PropTypes.bool,

  messagesSending:
    PropTypes.bool,

  messagesError:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.object,
    ]),

  hasMoreMessages:
    PropTypes.bool,

  unreadMessageCount:
    PropTypes.number,

  newMessageCount:
    PropTypes.number,

  unreadMarkerIndex:
    PropTypes.number,

  composerDisabled:
    PropTypes.bool,

  composerReadOnly:
    PropTypes.bool,

  composerPlaceholder:
    PropTypes.string,

  composerMaxLength:
    PropTypes.number,

  composerAllowAttachments:
    PropTypes.bool,

  composerMaxFileSize:
    PropTypes.number,

  composerAllowedMimeTypes:
    PropTypes.arrayOf(
      PropTypes.string,
    ),

  onConversationSelect:
    PropTypes.func,

  onConversationLoad:
    PropTypes.func,

  onConversationRefresh:
    PropTypes.func,

  onConversationSearch:
    PropTypes.func,

  onNewConversation:
    PropTypes.func,

  onConversationArchive:
    PropTypes.func,

  onConversationUnarchive:
    PropTypes.func,

  onConversationPin:
    PropTypes.func,

  onConversationDelete:
    PropTypes.func,

  onMessagesLoad:
    PropTypes.func,

  onMessagesLoadMore:
    PropTypes.func,

  onMessagesRetry:
    PropTypes.func,

  onMessageSend:
    PropTypes.func,

  onMessageReply:
    PropTypes.func,

  onMessageCopy:
    PropTypes.func,

  onMessageEdit:
    PropTypes.func,

  onMessageDelete:
    PropTypes.func,

  onMessageRetry:
    PropTypes.func,

  onMessageRegenerate:
    PropTypes.func,

  customMessageActions:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  isUserOwnMessage:
    PropTypes.func,

  onAttachmentAdd:
    PropTypes.func,

  onAttachmentRemove:
    PropTypes.func,

  onAttachmentRetry:
    PropTypes.func,

  onAttachmentUpload:
    PropTypes.func,

  onTypingStart:
    PropTypes.func,

  onTypingStop:
    PropTypes.func,

  showConversationHeader:
    PropTypes.bool,

  showTenant:
    PropTypes.bool,

  showParticipantCount:
    PropTypes.bool,

  showConversationStatus:
    PropTypes.bool,

  showConversationSearch:
    PropTypes.bool,

  showConversationRefresh:
    PropTypes.bool,

  showConversationActions:
    PropTypes.bool,

  conversationOnline:
    PropTypes.bool,

  conversationTyping:
    PropTypes.bool,

  showMessageAvatars:
    PropTypes.bool,

  showMessageSender:
    PropTypes.bool,

  showMessageTimestamps:
    PropTypes.bool,

  showMessageStatus:
    PropTypes.bool,

  showMessageActions:
    PropTypes.bool,

  showMessageAttachments:
    PropTypes.bool,

  showEditedLabel:
    PropTypes.bool,

  showMessageDateSeparators:
    PropTypes.bool,

  groupMessages:
    PropTypes.bool,

  autoScroll:
    PropTypes.bool,

  showEmptyState:
    PropTypes.bool,

  showErrorState:
    PropTypes.bool,

  emptyTitle:
    PropTypes.string,

  emptyMessage:
    PropTypes.string,

  loading:
    PropTypes.bool,

  disabled:
    PropTypes.bool,

  readOnly:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  mobile:
    PropTypes.bool,

  className:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  testId:
    PropTypes.string,

  beforeSend:
    PropTypes.func,

  afterSend:
    PropTypes.func,

  onPanelFocus:
    PropTypes.func,

  onPanelBlur:
    PropTypes.func,

  onPanelKeyDown:
    PropTypes.func,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

MessagePanel.defaultProps = {
  conversation:
    null,

  conversations:
    [],

  conversationLoading:
    false,

  conversationError:
    null,

  conversationDisabled:
    false,

  tenant:
    null,

  activeConversationId:
    null,

  currentUserId:
    undefined,

  messages:
    [],

  messagesLoading:
    false,

  messagesInitialLoading:
    undefined,

  messagesLoadingMore:
    false,

  messagesSending:
    false,

  messagesError:
    null,

  hasMoreMessages:
    false,

  unreadMessageCount:
    0,

  newMessageCount:
    0,

  unreadMarkerIndex:
    undefined,

  composerDisabled:
    false,

  composerReadOnly:
    false,

  composerPlaceholder:
    DEFAULT_COMPOSER_PLACEHOLDER,

  composerMaxLength:
    DEFAULT_MESSAGE_MAX_LENGTH,

  composerAllowAttachments:
    true,

  composerMaxFileSize:
    undefined,

  composerAllowedMimeTypes:
    undefined,

  onConversationSelect:
    undefined,

  onConversationLoad:
    undefined,

  onConversationRefresh:
    undefined,

  onConversationSearch:
    undefined,

  onNewConversation:
    undefined,

  onConversationArchive:
    undefined,

  onConversationUnarchive:
    undefined,

  onConversationPin:
    undefined,

  onConversationDelete:
    undefined,

  onMessagesLoad:
    undefined,

  onMessagesLoadMore:
    undefined,

  onMessagesRetry:
    undefined,

  onMessageSend:
    undefined,

  onMessageReply:
    undefined,

  onMessageCopy:
    undefined,

  onMessageEdit:
    undefined,

  onMessageDelete:
    undefined,

  onMessageRetry:
    undefined,

  onMessageRegenerate:
    undefined,

  customMessageActions:
    [],

  isUserOwnMessage:
    undefined,

  onAttachmentAdd:
    undefined,

  onAttachmentRemove:
    undefined,

  onAttachmentRetry:
    undefined,

  onAttachmentUpload:
    undefined,

  onTypingStart:
    undefined,

  onTypingStop:
    undefined,

  showConversationHeader:
    true,

  showTenant:
    true,

  showParticipantCount:
    true,

  showConversationStatus:
    true,

  showConversationSearch:
    false,

  showConversationRefresh:
    true,

  showConversationActions:
    true,

  conversationOnline:
    false,

  conversationTyping:
    false,

  showMessageAvatars:
    true,

  showMessageSender:
    true,

  showMessageTimestamps:
    true,

  showMessageStatus:
    true,

  showMessageActions:
    true,

  showMessageAttachments:
    true,

  showEditedLabel:
    true,

  showMessageDateSeparators:
    true,

  groupMessages:
    true,

  autoScroll:
    true,

  showEmptyState:
    true,

  showErrorState:
    true,

  emptyTitle:
    'No conversation selected',

  emptyMessage:
    'Select a TITech conversation to begin messaging.',

  loading:
    false,

  disabled:
    false,

  readOnly:
    false,

  compact:
    false,

  mobile:
    false,

  className:
    '',

  ariaLabel:
    'TITech messaging panel',

  testId:
    'titech-message-panel',

  beforeSend:
    undefined,

  afterSend:
    undefined,

  onPanelFocus:
    undefined,

  onPanelBlur:
    undefined,

  onPanelKeyDown:
    undefined,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_COMPOSER_PLACEHOLDER,
  DEFAULT_MESSAGE_MAX_LENGTH,
  getConversationId,
  getConversationParticipants,
  getConversationStatus,
  getConversationTitle,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default MessagePanel;