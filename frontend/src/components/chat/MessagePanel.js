/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Message Panel
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/MessagePanel.js
 *
 * Purpose:
 *   Production-grade orchestration component for the TITechChat enterprise
 *   messaging workspace.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   Conversation / Tenant State
 *             │
 *             ▼
 *        MessagePanel
 *             │
 *      ┌──────┼────────┐
 *      ▼      ▼        ▼
 * Header   MessageList Composer
 *             │
 *             ├── MessageBubble
 *             └── AttachmentPreview
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Active conversation lifecycle
 * ✓ Tenant context propagation
 * ✓ Message loading/error state
 * ✓ Message composition
 * ✓ Sending lifecycle
 * ✓ Conversation header
 * ✓ Message viewport
 * ✓ Composer integration
 * ✓ Retry handling
 * ✓ New conversation handling
 * ✓ Search hook integration
 * ✓ Reply/edit state coordination
 * ✓ Attachment support
 * ✓ Keyboard shortcuts
 * ✓ Responsive layout hooks
 * ✓ Accessibility
 * ✓ Ref API
 * ✓ Defensive state handling
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is UI orchestration only.
 *
 * It MUST NOT:
 *   - enforce authorization
 *   - bypass tenant isolation
 *   - execute financial transactions
 *   - approve loans
 *   - perform fraud decisions
 *   - modify authoritative financial records
 *
 * TITech backend/service layers remain authoritative.
 *
 * Branding:
 *   TITech Community Capital
 *
 * ============================================================================
 */

'use strict';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import ConversationHeader from './ConversationHeader';

import MessageList from './MessageList';

import Composer from './Composer';

import EmptyState from './EmptyState';

import ErrorState from './ErrorState';

import LoadingState from './LoadingState';

import './message-panel.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_COMPOSER_PLACEHOLDER =
  'Write a message…';

const DEFAULT_MESSAGE_MAX_LENGTH =
  2000;

const PANEL_FOCUSABLE_SELECTOR =
  'textarea,input,button,[tabindex]:not([tabindex="-1"])';


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
    conversation?.status ||
      '',
  );


const getConversationParticipants = (
  conversation,
) =>
  Array.isArray(
    conversation?.participants,
  )
    ? conversation.participants
    : [];


/**
 * Safely invoke a callback that may return a promise or nothing.
 */
const resolveAsync =
  async (
    callback,
    ...args
  ) => {
    if (
      typeof callback !==
      'function'
    ) {
      return undefined;
    }

    return callback(
      ...args,
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

        activeConversationId,

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
         * State callbacks
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

        onAttachmentAdd,

        onAttachmentRemove,

        onAttachmentRetry,

        onAttachmentUpload,

        onTypingStart,

        onTypingStop,

        /* --------------------------------------------------------------------
         * Conversation header
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
         * Message list
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
         * Layout
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

        testId =
          'titech-message-panel',

        ariaLabel =
          'TITech messaging panel',

        /* --------------------------------------------------------------------
         * Advanced
         * ------------------------------------------------------------------ */

        onPanelFocus,

        onPanelBlur,

        onPanelKeyDown,

        beforeSend,

        afterSend,

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

      const composerRef =
        useRef(null);

      const mountedRef =
        useRef(true);

      const [
        replyMessage,
        setReplyMessage,
      ] = useState(
        null,
      );

      const [
        editMessage,
        setEditMessage,
      ] = useState(
        null,
      );

      const [
        panelError,
        setPanelError,
      ] = useState(
        '',
      );

      const [
        sending,
        setSending,
      ] = useState(
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
       * Derived state
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

      const isConversationSelected =
        Boolean(
          resolvedConversationId,
        );

      const effectiveDisabled =
        Boolean(
          disabled ||
            conversationDisabled ||
            composerDisabled ||
            loading,
        );

      const effectiveSending =
        Boolean(
          sending ||
            messagesSending,
        );

      const resolvedError =
        panelError ||
        conversationError ||
        messagesError;


      /* ======================================================================
       * Reset transient composition state on conversation change
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
              await resolveAsync(
                onConversationSelect,
                nextConversation,
              );
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to open the conversation.',
                );
              }
            }
          },
          [
            effectiveDisabled,
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
              mobile &&
              typeof onConversationSelect ===
                'function'
            ) {
              onConversationSelect(
                null,
              );
            }
          },
          [
            mobile,
            onConversationSelect,
          ],
        );


      const handleSearch =
        useCallback(
          (
            query,
          ) =>
            resolveAsync(
              onConversationSearch,
              query,
            ),
          [
            onConversationSearch,
          ],
        );


      const handleRefreshConversation =
        useCallback(
          async () => {
            setPanelError(
              '',
            );

            try {
              await resolveAsync(
                onConversationRefresh,
                resolvedConversation,
              );

              await resolveAsync(
                onMessagesLoad,
                resolvedConversationId,
              );
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to refresh the conversation.',
                );
              }
            }
          },
          [
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

            onNewConversation?.();
          },
          [
            effectiveDisabled,
            onNewConversation,
          ],
        );


      /* ======================================================================
       * Archive / restore / pin / delete
       * ==================================================================== */

      const handleArchive =
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
              await resolveAsync(
                onConversationArchive,
                target,
              );
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


      const handleUnarchive =
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
              await resolveAsync(
                onConversationUnarchive,
                target,
              );
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


      const handlePin =
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
              await resolveAsync(
                onConversationPin,
                target,
                nextPinned,
              );
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


      const handleDeleteConversation =
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
              await resolveAsync(
                onConversationDelete,
                target,
              );
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
       * Message interactions
       * ==================================================================== */

      const handleReply =
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
              message,
            );

            setEditMessage(
              null,
            );

            onMessageReply?.(
              message,
            );

            requestAnimationFrame(
              () => {
                composerRef.current?.focus?.();
              },
            );
          },
          [
            effectiveDisabled,
            onMessageReply,
            readOnly,
          ],
        );


      const handleEdit =
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
              message,
            );

            setReplyMessage(
              null,
            );

            onMessageEdit?.(
              message,
            );

            requestAnimationFrame(
              () => {
                composerRef.current?.focus?.();
              },
            );
          },
          [
            effectiveDisabled,
            onMessageEdit,
            readOnly,
          ],
        );


      const handleCopy =
        useCallback(
          (
            message,
          ) =>
            resolveAsync(
              onMessageCopy,
              message,
            ),
          [
            onMessageCopy,
          ],
        );


      const handleDeleteMessage =
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
              await resolveAsync(
                onMessageDelete,
                message,
              );
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


      const handleRetryMessage =
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
              await resolveAsync(
                onMessageRetry,
                message,
              );
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


      const handleRegenerate =
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
              await resolveAsync(
                onMessageRegenerate,
                message,
              );
            } catch (
              error
            ) {
              if (
                mountedRef.current
              ) {
                setPanelError(
                  error?.message ||
                    'Unable to regenerate the response.',
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
       * Message send
       * ==================================================================== */

      const handleSend =
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

            if (
              !normalizedText &&
              (
                !Array.isArray(
                  attachments,
                ) ||
                attachments.length ===
                  0
              )
            ) {
              return;
            }

            setPanelError(
              '',
            );

            setSending(
              true,
            );

            try {
              if (
                typeof beforeSend ===
                'function'
              ) {
                await beforeSend({
                  text:
                    normalizedText,

                  attachments:

                    Array.isArray(
                      attachments,
                    )
                      ? attachments
                      : [],

                  conversation:
                    resolvedConversation,

                  conversationId:
                    resolvedConversationId,

                  tenant,

                  replyTo:
                    replyMessage,

                  editing:
                    editMessage,
                });
              }

              /**
               * Existing TITech composer contract:
               *
               * onMessageSend(
               *   text,
               *   attachments,
               *   metadata
               * )
               */
              const result =
                await resolveAsync(
                  onMessageSend,
                  normalizedText,
                  Array.isArray(
                    attachments,
                  )
                    ? attachments
                    : [],
                  {
                    conversation:
                      resolvedConversation,

                    conversationId:
                      resolvedConversationId,

                    tenant,

                    replyTo:
                      replyMessage,

                    editMessage,
                  },
                );

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
                await afterSend(
                  result,
                  {
                    text:
                      normalizedText,

                    attachments:

                      Array.isArray(
                        attachments,
                      )
                        ? attachments
                        : [],

                    conversation:
                      resolvedConversation,

                    conversationId:
                      resolvedConversationId,

                    tenant,
                  },
                );
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
                setSending(
                  false,
                );
              }
            }
          },
          [
            afterSend,
            beforeSend,
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
       * Attachment callbacks
       * ==================================================================== */

      const handleAttachmentAdd =
        useCallback(
          (
            attachment,
          ) => {
            onAttachmentAdd?.(
              attachment,
              {
                conversation:
                  resolvedConversation,

                conversationId:
                  resolvedConversationId,

                tenant,
              },
            );
          },
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
          ) => {
            onAttachmentRemove?.(
              attachment,
              index,
              {
                conversationId:
                  resolvedConversationId,

                tenant,
              },
            );
          },
          [
            onAttachmentRemove,
            resolvedConversationId,
            tenant,
          ],
        );


      const handleAttachmentRetry =
        useCallback(
          async (
            attachment,
            index,
          ) =>
            resolveAsync(
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
            metadata,
          ) =>
            resolveAsync(
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
       * Typing lifecycle
       * ==================================================================== */

      const handleTypingStart =
        useCallback(
          () => {
            onTypingStart?.({
              conversation:
                resolvedConversation,

              conversationId:
                resolvedConversationId,

              tenant,
            });
          },
          [
            onTypingStart,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      const handleTypingStop =
        useCallback(
          () => {
            onTypingStop?.({
              conversation:
                resolvedConversation,

              conversationId:
                resolvedConversationId,

              tenant,
            });
          },
          [
            onTypingStop,
            resolvedConversation,
            resolvedConversationId,
            tenant,
          ],
        );


      /* ======================================================================
       * Focus panel
       * ==================================================================== */

      const focusComposer =
        useCallback(
          () => {
            composerRef.current?.focus?.();
          },
          [],
        );


      const focusMessageList =
        useCallback(
          () => {
            messageListRef.current?.focus?.();
          },
          [],
        );


      /* ======================================================================
       * Keyboard shortcuts
       * ==================================================================== */

      const handlePanelKeyDown =
        useCallback(
          (
            event,
          ) => {
            onPanelKeyDown?.(
              event,
            );

            if (
              event.defaultPrevented
            ) {
              return;
            }

            /**
             * Ctrl/Cmd + Shift + L
             * Focus the composer.
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
             * Escape clears reply/edit mode.
             */
            if (
              event.key ===
              'Escape'
            ) {
              if (
                editMessage
              ) {
                setEditMessage(
                  null,
                );

                return;
              }

              if (
                replyMessage
              ) {
                setReplyMessage(
                  null,
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
       * Ref API
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
            messageListRef.current?.scrollToBottom?.(
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

          getConversation() {
            return resolvedConversation;
          },

          getConversationId() {
            return resolvedConversationId;
          },
        }),
        [
          focusComposer,
          focusMessageList,
          resolvedConversation,
          resolvedConversationId,
        ],
      );


      /* ======================================================================
       * Layout state
       * ==================================================================== */

      const rootClassName = [
        'titech-message-panel',

        compact &&
          'titech-message-panel--compact',

        mobile &&
          'titech-message-panel--mobile',

        effectiveDisabled &&
          'titech-message-panel--disabled',

        effectiveSending &&
          'titech-message-panel--sending',

        !isConversationSelected &&
          'titech-message-panel--no-conversation',

        className,
      ]
        .filter(Boolean)
        .join(' ');


      /* ======================================================================
       * No conversation selected
       * ==================================================================== */

      if (
        !isConversationSelected
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
       * Main panel
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

          {/* ================================================================
              Conversation header
              ================================================================ */}

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
                  handleSearch
                }
                onRefresh={
                  handleRefreshConversation
                }
                onNewConversation={
                  handleNewConversation
                }
                onPin={
                  onConversationPin
                }
                onArchive={
                  onConversationArchive
                }
                onUnarchive={
                  onConversationUnarchive
                }
                onClose={
                  onConversationDelete
                }
                disabled={
                  effectiveDisabled
                }
                loading={
                  conversationLoading
                }
              />
            </div>
          ) : null}


          {/* ================================================================
              Panel-level error
              ================================================================ */}

          {resolvedError &&
          showErrorState ? (
            <div
              className="titech-message-panel__error"
              role="alert"
              data-testid="titech-message-panel-error"
            >
              <ErrorState
                error={
                  resolvedError
                }
                onRetry={
                  handleRefreshConversation
                }
              />
            </div>
          ) : null}


          {/* ================================================================
              Message area
              ================================================================ */}

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
                      resolveAsync(
                        onMessagesRetry ||
                          onMessagesLoad,
                        resolvedConversationId,
                      )
                  : undefined
              }
              onReply={
                handleReply
              }
              onCopy={
                handleCopy
              }
              onEdit={
                handleEdit
              }
              onDelete={
                handleDeleteMessage
              }
              onRetryMessage={
                handleRetryMessage
              }
              onRegenerate={
                handleRegenerate
              }
              customMessageActions={
                customMessageActions
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


          {/* ================================================================
              Reply/edit context
              ================================================================ */}

          {replyMessage ||
          editMessage ? (
            <div
              className="titech-message-panel__composer-context"
              role="status"
              aria-live="polite"
              data-testid="titech-message-panel-context"
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
                      replyMessage?.content ||
                      replyMessage?.text,
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


          {/* ================================================================
              Composer
              ================================================================ */}

          <div
            className="titech-message-panel__composer"
            data-testid="titech-message-panel-composer"
          >
            <Composer
              ref={
                composerRef
              }
              onSend={
                handleSend
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
              readOnly={
                composerReadOnly ||
                readOnly
              }
              maxMessageLength={
                composerMaxLength
              }
              onAttachmentAdd={
                handleAttachmentAdd
              }
              onAttachmentRemove={
                handleAttachmentRemove
              }
              onAttachmentRetry={
                handleAttachmentRetry
              }
              uploadHandler={
                onAttachmentUpload
                  ? handleAttachmentUpload
                  : undefined
              }
              autoFocus={
                mobile
                  ? false
                  : true
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

  onStartConversation:
    PropTypes.func,

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

  testId:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  onPanelFocus:
    PropTypes.func,

  onPanelBlur:
    PropTypes.func,

  onPanelKeyDown:
    PropTypes.func,

  beforeSend:
    PropTypes.func,

  afterSend:
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

  onStartConversation:
    undefined,

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

  testId:
    'titech-message-panel',

  ariaLabel:
    'TITech messaging panel',

  onPanelFocus:
    undefined,

  onPanelBlur:
    undefined,

  onPanelKeyDown:
    undefined,

  beforeSend:
    undefined,

  afterSend:
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