'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Composer
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/Composer.jsx
 *
 * Purpose:
 *   Production-grade message composer for TITechChat Enterprise Messaging.
 *
 * Core capabilities
 * ----------------------------------------------------------------------------
 * ✓ Controlled message input
 * ✓ Auto-growing textarea
 * ✓ Attachment selection
 * ✓ Multiple attachments
 * ✓ Client-side file validation
 * ✓ Maximum file size validation
 * ✓ Maximum attachment count
 * ✓ MIME/extension validation
 * ✓ Duplicate attachment protection
 * ✓ Drag & Drop
 * ✓ Clipboard file/image paste
 * ✓ Typing indicators
 * ✓ Keyboard shortcuts
 * ✓ Async send support
 * ✓ Sending/loading states
 * ✓ Error handling
 * ✓ Attachment preview integration
 * ✓ Attachment removal
 * ✓ Attachment retry support
 * ✓ Accessibility / ARIA
 * ✓ Focus management
 * ✓ Mobile-friendly behavior
 * ✓ Reduced-motion compatible UI hooks
 * ✓ Imperative ref API
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * Client-side validation is NOT a security boundary.
 *
 * The backend MUST independently enforce:
 *   - Authentication
 *   - Authorization
 *   - Tenant isolation
 *   - File-size limits
 *   - MIME validation
 *   - File signature validation
 *   - Malware scanning
 *   - Storage authorization
 *   - Rate limiting
 *   - Abuse prevention
 *
 * Financial and regulatory decisions MUST NOT be performed by this component.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import AttachmentPreview from './AttachmentPreview';

import './composer.css';


/* ============================================================================
 * Defaults
 * ========================================================================== */

const DEFAULT_ALLOWED_TYPES = [
  'application/pdf',

  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',

  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  'text/csv',
  'text/plain',

  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',

  'video/mp4',
  'video/webm',
];

const DEFAULT_ACCEPT = DEFAULT_ALLOWED_TYPES.join(
  ',',
);

const DEFAULT_MAX_FILE_SIZE =
  10 * 1024 * 1024;

const DEFAULT_MAX_ATTACHMENTS = 10;

const DEFAULT_MAX_MESSAGE_LENGTH = 2000;

const DEFAULT_TYPING_TIMEOUT = 2500;

const DEFAULT_PLACEHOLDER =
  'Write a message…';


/* ============================================================================
 * Helpers
 * ========================================================================== */

/**
 * Normalize an unknown value to a safe string.
 */
const toSafeString = (
  value,
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  try {
    return String(value);
  } catch {
    return '';
  }
};


/**
 * Sanitize user-visible filename text.
 *
 * This is presentation sanitization, not malware/file validation.
 */
const normalizeFilename = (
 filename,
) => {
  const safeName =
    toSafeString(
      filename,
    )
      .replace(
        /[\u0000-\u001F\u007F]/g,
        '',
      )
      .trim();

  return (
    safeName.slice(
      0,
      160,
    ) ||
    'Attachment'
  );
};


/**
 * Normalize MIME values.
 */
const normalizeMimeType = (
  mimeType,
) =>
  toSafeString(
    mimeType,
  )
    .trim()
    .toLowerCase();


/**
 * File identity used to prevent accidental duplicate attachments.
 */
const getFileIdentity = (
  file,
) => {
  if (!file) {
    return '';
  }

  return [
    normalizeFilename(
      file.name,
    ),

    normalizeMimeType(
      file.type,
    ),

    Number(
      file.size || 0,
    ),

    Number(
      file.lastModified || 0,
    ),
  ].join('|');
};


/**
 * Human-readable file size.
 */
const formatFileSize = (
 bytes,
) => {
  const value =
    Number(bytes);

  if (
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    return '';
  }

  if (
    value === 0
  ) {
    return '0 B';
  }

  const units = [
    'B',
    'KB',
    'MB',
    'GB',
    'TB',
  ];

  const exponent =
    Math.min(
      Math.floor(
        Math.log(
          value,
        ) /
          Math.log(1024),
      ),
      units.length - 1,
    );

  const amount =
    value /
    Math.pow(
      1024,
      exponent,
    );

  const precision =
    exponent === 0
      ? 0
      : amount >= 10
        ? 1
        : 2;

  return `${amount.toFixed(
    precision,
  )} ${units[exponent]}`;
};


/**
 * Determine whether a file matches an accept rule.
 *
 * Supports:
 *   image/*
 *   application/pdf
 *   .pdf
 */
const matchesAcceptRule = (
  file,
  accept,
) => {
  if (
    !file ||
    !accept
  ) {
    return true;
  }

  const rules =
    toSafeString(
      accept,
    )
      .split(',')
      .map(
        (item) =>
          item
            .trim()
            .toLowerCase(),
      )
      .filter(Boolean);

  if (
    rules.length === 0
  ) {
    return true;
  }

  const mimeType =
    normalizeMimeType(
      file.type,
    );

  const filename =
    normalizeFilename(
      file.name,
    ).toLowerCase();

  return rules.some(
    (rule) => {
      if (
        rule === '*/*'
      ) {
        return true;
      }

      if (
        rule.endsWith(
          '/*',
        )
      ) {
        return mimeType.startsWith(
          rule.slice(
            0,
            -1,
          ),
        );
      }

      if (
        rule.startsWith('.')
      ) {
        return filename.endsWith(
          rule,
        );
      }

      return (
        mimeType === rule
      );
    },
  );
};


/**
 * Safely convert various async callback results into an attachment array.
 */
const normalizeAttachmentResult =
  (
    result,
    fallback,
  ) => {
    if (
      Array.isArray(
        result,
      )
    ) {
      return result;
    }

    if (
      result &&
      Array.isArray(
        result.attachments,
      )
    ) {
      return result.attachments;
    }

    if (
      result &&
      result.attachment
    ) {
      return [
        result.attachment,
      ];
    }

    return fallback;
  };


/* ============================================================================
 * Icons
 * ========================================================================== */

const PaperclipIcon =
  () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );


const SendIcon =
  () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );


const LoadingIcon =
  () => (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 2v4" />
      <path d="m16.24 3.76-2.83 2.83" />
      <path d="M22 12h-4" />
      <path d="m20.24 16.24-2.83-2.83" />
      <path d="M12 22v-4" />
      <path d="m7.76 20.24 2.83-2.83" />
      <path d="M2 12h4" />
      <path d="m3.76 7.76 2.83 2.83" />
    </svg>
  );


/* ============================================================================
 * Composer
 * ========================================================================== */

const Composer = forwardRef(
  (
    {
      /**
       * ----------------------------------------------------------------------
       * Messaging
       * ----------------------------------------------------------------------
       */

      onSend,

      onSubmit,

      onTypingStart,

      onTypingStop,

      /**
       * ----------------------------------------------------------------------
       * Optional attachment callbacks
       * ----------------------------------------------------------------------
       */

      onAttachmentAdd,

      onAttachmentRemove,

      onAttachmentRetry,

      uploadHandler,

      /**
       * ----------------------------------------------------------------------
       * External attachments
       * ----------------------------------------------------------------------
       *
       * When supplied, this becomes the externally authoritative attachment
       * collection.
       */

      attachments: externalAttachments,

      /**
       * ----------------------------------------------------------------------
       * UI
       * ----------------------------------------------------------------------
       */

      placeholder =
        DEFAULT_PLACEHOLDER,

      ariaLabel =
        'TITech message composer',

      autoFocus = false,

      disabled = false,

      readOnly = false,

      /**
       * ----------------------------------------------------------------------
       * Attachments
       * ----------------------------------------------------------------------
       */

      allowAttachments =
        true,

      maxAttachments =
        DEFAULT_MAX_ATTACHMENTS,

      maxFileSize =
        DEFAULT_MAX_FILE_SIZE,

      allowedMimeTypes =
        DEFAULT_ALLOWED_TYPES,

      accept,

      /**
       * ----------------------------------------------------------------------
       * Text
       * ----------------------------------------------------------------------
       */

      maxMessageLength =
        DEFAULT_MAX_MESSAGE_LENGTH,

      /**
       * ----------------------------------------------------------------------
       * Behavior
       * ----------------------------------------------------------------------
       */

      sendOnEnter =
        true,

      allowPaste =
        true,

      allowDrop =
        true,

      /**
       * ----------------------------------------------------------------------
       * Appearance
       * ----------------------------------------------------------------------
       */

      showCharacterCount =
        true,

      showAttachmentMetadata =
        true,

      className = '',

      testId =
        'titech-chat-composer',

      /**
       * ----------------------------------------------------------------------
       * External loading states
       * ----------------------------------------------------------------------
       */

      loading = false,

      sending: externalSending =
        false,

      uploading:
        externalUploading = false,

      /**
       * ----------------------------------------------------------------------
       * Advanced
       * ----------------------------------------------------------------------
       */

      typingTimeout =
        DEFAULT_TYPING_TIMEOUT,

      onError,

      onFocus,

      onBlur,

      onKeyDown,

      ...rest
    },
    forwardedRef,
  ) => {
    /* ========================================================================
     * Refs
     * ====================================================================== */

    const textareaRef =
      useRef(null);

    const fileInputRef =
      useRef(null);

    const formRef =
      useRef(null);

    const typingTimeoutRef =
      useRef(null);

    const uploadAbortRef =
      useRef(null);

    const mountedRef =
      useRef(true);

    const typingActiveRef =
      useRef(false);


    /* ========================================================================
     * State
     * ====================================================================== */

    const [
      text,
      setText,
    ] = useState('');

    const [
      internalAttachments,
      setInternalAttachments,
    ] = useState([]);

    const [
      sending,
      setSending,
    ] = useState(false);

    const [
      uploading,
      setUploading,
    ] = useState(false);

    const [
      error,
      setError,
    ] = useState('');

    const [
      isDragging,
      setIsDragging,
    ] = useState(false);


    /* ========================================================================
     * External / internal attachment source
     * ====================================================================== */

    const isAttachmentsControlled =
      externalAttachments !==
      undefined;

    const attachments =
      isAttachmentsControlled
        ? Array.isArray(
            externalAttachments,
          )
          ? externalAttachments
          : []
        : internalAttachments;


    /* ========================================================================
     * Lifecycle
     * ====================================================================== */

    useEffect(
      () => {
        mountedRef.current =
          true;

        return () => {
          mountedRef.current =
            false;

          if (
            typingTimeoutRef.current
          ) {
            clearTimeout(
              typingTimeoutRef.current,
            );
          }

          if (
            uploadAbortRef.current
          ) {
            try {
              uploadAbortRef.current.abort();
            } catch {
              // Best-effort cleanup.
            }
          }
        };
      },
      [],
    );


    /* ========================================================================
     * Auto focus
     * ====================================================================== */

    useEffect(
      () => {
        if (
          autoFocus &&
          !disabled &&
          !readOnly
        ) {
          textareaRef.current?.focus();
        }
      },
      [
        autoFocus,
        disabled,
        readOnly,
      ],
    );


    /* ========================================================================
     * Auto-growing textarea
     * ====================================================================== */

    useEffect(
      () => {
        const element =
          textareaRef.current;

        if (!element) {
          return;
        }

        element.style.height =
          'auto';

        const computedHeight =
          element.scrollHeight;

        element.style.height =
          `${computedHeight}px`;
      },
      [
        text,
      ],
    );


    /* ========================================================================
     * Effective state
     * ====================================================================== */

    const isSending =
      sending ||
      externalSending;

    const isUploading =
      uploading ||
      externalUploading;

    const isBusy =
      Boolean(
        disabled ||
          loading ||
          isSending ||
          isUploading,
      );

    const trimmedText =
      text.trim();

    const hasText =
      trimmedText.length >
      0;

    const hasAttachments =
      attachments.length >
      0;

    const canSend =
      !isBusy &&
      !readOnly &&
      (
        hasText ||
        hasAttachments
      ) &&
      text.length <=
        maxMessageLength;


    /* ========================================================================
     * Accepted types
     * ====================================================================== */

    const acceptedTypes =
      useMemo(
        () =>
          Array.isArray(
            allowedMimeTypes,
          )
            ? allowedMimeTypes
            : DEFAULT_ALLOWED_TYPES,
        [
          allowedMimeTypes,
        ],
      );

    const acceptedAttribute =
      accept ||
      acceptedTypes.join(
        ',',
      );


    /* ========================================================================
     * Public component API
     * ====================================================================== */

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus() {
          textareaRef.current?.focus();
        },

        blur() {
          textareaRef.current?.blur();
        },

        clear() {
          setText('');
        },

        clearAttachments() {
          clearAttachments();
        },

        openFilePicker() {
          fileInputRef.current?.click();
        },

        getValue() {
          return text;
        },

        getAttachments() {
          return attachments;
        },

        submit() {
          return submitMessage();
        },
      }),
      [
        text,
        attachments,
      ],
    );


    /* ========================================================================
     * Error reporting
     * ====================================================================== */

    const reportError =
      useCallback(
        (
          message,
          metadata = {},
        ) => {
          const safeMessage =
            toSafeString(
              message,
            ) ||
            'Unable to process your request.';

          if (
            mountedRef.current
          ) {
            setError(
              safeMessage,
            );
          }

          if (
            typeof onError ===
            'function'
          ) {
            onError(
              safeMessage,
              metadata,
            );
          }
        },
        [
          onError,
        ],
      );


    /* ========================================================================
     * Typing indicators
     * ====================================================================== */

    const stopTyping =
      useCallback(
        () => {
          if (
            typingTimeoutRef.current
          ) {
            clearTimeout(
              typingTimeoutRef.current,
            );

            typingTimeoutRef.current =
              null;
          }

          if (
            typingActiveRef.current
          ) {
            typingActiveRef.current =
              false;

            onTypingStop?.();
          }
        },
        [
          onTypingStop,
        ],
      );


    const emitTyping =
      useCallback(
        () => {
          if (
            isBusy ||
            readOnly
          ) {
            return;
          }

          if (
            !typingActiveRef.current
          ) {
            typingActiveRef.current =
              true;

            onTypingStart?.();
          }

          if (
            typingTimeoutRef.current
          ) {
            clearTimeout(
              typingTimeoutRef.current,
            );
          }

          typingTimeoutRef.current =
            setTimeout(
              () => {
                stopTyping();
              },
              typingTimeout,
            );
        },
        [
          isBusy,
          readOnly,
          onTypingStart,
          stopTyping,
          typingTimeout,
        ],
      );


    /* ========================================================================
     * Text change
     * ====================================================================== */

    const handleTextChange =
      useCallback(
        (event) => {
          const nextValue =
            event.target.value;

          if (
            nextValue.length >
            maxMessageLength
          ) {
            return;
          }

          setError('');

          setText(
            nextValue,
          );

          if (
            nextValue.trim()
          ) {
            emitTyping();
          } else {
            stopTyping();
          }
        },
        [
          emitTyping,
          maxMessageLength,
          stopTyping,
        ],
      );


    /* ========================================================================
     * File validation
     * ====================================================================== */

    const validateFile =
      useCallback(
        (file) => {
          if (!file) {
            return {
              valid:
                false,
              error:
                'Invalid attachment.',
            };
          }

          const fileName =
            normalizeFilename(
              file.name,
            );

          const fileType =
            normalizeMimeType(
              file.type,
            );

          if (
            file.size >
            maxFileSize
          ) {
            return {
              valid:
                false,
              error:
                `${fileName} exceeds the maximum file size of ${formatFileSize(
                  maxFileSize,
                )}.`,
            };
          }

          if (
            !matchesAcceptRule(
              file,
              acceptedAttribute,
            )
          ) {
            return {
              valid:
                false,
              error:
                `Unsupported file type: ${
                  fileType ||
                  'unknown'
                }.`,
            };
          }

          return {
            valid:
              true,
            error:
              '',
          };
        },
        [
          acceptedAttribute,
          maxFileSize,
        ],
      );


    /* ========================================================================
     * Prepare files
     * ====================================================================== */

    const prepareFiles =
      useCallback(
        (
          fileList,
        ) => {
          const files =
            Array.from(
              fileList ||
                [],
            ).filter(Boolean);

          if (
            files.length ===
            0
          ) {
            return {
              validFiles: [],
            };
          }

          const existingKeys =
            new Set(
              attachments.map(
                (
                  attachment,
                ) =>
                  getFileIdentity(
                    attachment.file ||
                      attachment,
                  ),
              ),
            );

          const validFiles =
            [];

          for (
            const file of files
          ) {
            if (
              attachments.length +
                validFiles.length >=
              maxAttachments
            ) {
              reportError(
                `A maximum of ${maxAttachments} attachments is allowed.`,
                {
                  code:
                    'MAX_ATTACHMENTS',
                },
              );

              break;
            }

            const validation =
              validateFile(
                file,
              );

            if (
              !validation.valid
            ) {
              reportError(
                validation.error,
                {
                  code:
                    'INVALID_ATTACHMENT',
                  fileName:
                    file.name,
                },
              );

              continue;
            }

            const identity =
              getFileIdentity(
                file,
              );

            if (
              existingKeys.has(
                identity,
              )
            ) {
              continue;
            }

            existingKeys.add(
              identity,
            );

            validFiles.push(
              {
                id:
                  `local-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2)}`,

                name:
                  normalizeFilename(
                    file.name,
                  ),

                filename:
                  normalizeFilename(
                    file.name,
                  ),

                type:
                  normalizeMimeType(
                    file.type,
                  ),

                size:
                  file.size,

                file,

                status:
                  'pending',
              },
            );
          }

          return {
            validFiles,
          };
        },
        [
          attachments,
          maxAttachments,
          reportError,
          validateFile,
        ],
      );


    /* ========================================================================
     * Add files
     * ====================================================================== */

    const addFiles =
      useCallback(
        async (
          fileList,
        ) => {
          if (
            !allowAttachments ||
            isBusy ||
            readOnly
          ) {
            return;
          }

          setError('');

          const {
            validFiles,
          } =
            prepareFiles(
              fileList,
            );

          if (
            validFiles.length ===
            0
          ) {
            return;
          }

          /**
           * Optional external upload handler.
           *
           * Expected:
           *   uploadHandler(files, { signal })
           *
           * It may return:
           *   Attachment[]
           *   { attachments: Attachment[] }
           *   { attachment: Attachment }
           *
           * If no handler is supplied, local File objects are retained.
           */
          if (
            typeof uploadHandler ===
            'function'
          ) {
            if (
              uploadAbortRef.current
            ) {
              try {
                uploadAbortRef.current.abort();
              } catch {
                // Best effort.
              }
            }

            const controller =
              typeof AbortController !==
              'undefined'
                ? new AbortController()
                : null;

            uploadAbortRef.current =
              controller;

            setUploading(
              true,
            );

            try {
              const result =
                await uploadHandler(
                  validFiles,
                  {
                    signal:
                      controller?.signal,
                  },
                );

              if (
                !mountedRef.current
              ) {
                return;
              }

              const normalized =
                normalizeAttachmentResult(
                  result,
                  validFiles,
                );

              if (
                !isAttachmentsControlled
              ) {
                setInternalAttachments(
                  (
                    current,
                  ) => [
                    ...current,
                    ...normalized,
                  ],
                );
              }

              onAttachmentAdd?.(
                normalized,
              );
            } catch (
              uploadError
            ) {
              if (
                uploadError?.name ===
                'AbortError'
              ) {
                return;
              }

              reportError(
                uploadError?.message ||
                  'Attachment upload failed.',
                {
                  code:
                    'UPLOAD_FAILED',
                  error:
                    uploadError,
                },
              );
            } finally {
              if (
                mountedRef.current
              ) {
                setUploading(
                  false,
                );
              }

              uploadAbortRef.current =
                null;
            }

            return;
          }

          if (
            !isAttachmentsControlled
          ) {
            setInternalAttachments(
              (
                current,
              ) => [
                ...current,
                ...validFiles,
              ],
            );
          }

          onAttachmentAdd?.(
            validFiles,
          );
        },
        [
          allowAttachments,
          isBusy,
          readOnly,
          prepareFiles,
          uploadHandler,
          isAttachmentsControlled,
          onAttachmentAdd,
          reportError,
        ],
      );


    /* ========================================================================
     * File picker
     * ====================================================================== */

    const handleFileChange =
      useCallback(
        async (
          event,
        ) => {
          try {
            await addFiles(
              event.target
                ?.files,
            );
          } finally {
            if (
              event.target
            ) {
              event.target.value =
                '';
            }
          }
        },
        [
          addFiles,
        ],
      );


    /* ========================================================================
     * Open file picker
     * ====================================================================== */

    const openFilePicker =
      useCallback(
        () => {
          if (
            !allowAttachments ||
            isBusy ||
            readOnly
          ) {
            return;
          }

          fileInputRef.current?.click();
        },
        [
          allowAttachments,
          isBusy,
          readOnly,
        ],
      );


    /* ========================================================================
     * Remove attachment
     * ====================================================================== */

    const removeAttachment =
      useCallback(
        (
          target,
          index,
        ) => {
          if (
            isBusy ||
            readOnly
          ) {
            return;
          }

          if (
            !isAttachmentsControlled
          ) {
            setInternalAttachments(
              (
                current,
              ) =>
                current.filter(
                  (
                    item,
                    itemIndex,
                  ) =>
                    index !==
                    itemIndex,
                ),
            );
          }

          onAttachmentRemove?.(
            target,
            index,
          );
        },
        [
          isBusy,
          readOnly,
          isAttachmentsControlled,
          onAttachmentRemove,
        ],
      );


    /* ========================================================================
     * Retry attachment
     * ====================================================================== */

    const retryAttachment =
      useCallback(
        async (
          attachment,
          index,
        ) => {
          if (
            isBusy ||
            readOnly
          ) {
            return;
          }

          if (
            typeof onAttachmentRetry ===
            'function'
          ) {
            try {
              await onAttachmentRetry(
                attachment,
                index,
              );
            } catch (
              retryError
            ) {
              reportError(
                retryError?.message ||
                  'Attachment retry failed.',
                {
                  code:
                    'ATTACHMENT_RETRY_FAILED',
                  error:
                    retryError,
                },
              );
            }

            return;
          }

          if (
            attachment?.file
          ) {
            await addFiles([
              attachment.file,
            ]);
          }
        },
        [
          isBusy,
          readOnly,
          onAttachmentRetry,
          reportError,
          addFiles,
        ],
      );


    /* ========================================================================
     * Clear attachments
     * ====================================================================== */

    const clearAttachments =
      useCallback(
        () => {
          if (
            isAttachmentsControlled
          ) {
            return;
          }

          setInternalAttachments(
            [],
          );

          if (
            fileInputRef.current
          ) {
            fileInputRef.current.value =
              '';
          }
        },
        [
          isAttachmentsControlled,
        ],
      );


    /* ========================================================================
     * Submit
     * ====================================================================== */

    const submitMessage =
      useCallback(
        async (
          event,
        ) => {
          event?.preventDefault();

          if (
            !canSend
          ) {
            return false;
          }

          setError('');
          setSending(
            true,
          );

          try {
            /**
             * Preserve the existing TITech service contract:
             *
             *   onSend(
             *     text,
             *     attachments
             *   )
             *
             * Structured metadata is provided through an additional object
             * only when onSubmit is used explicitly.
             */
            if (
              typeof onSubmit ===
              'function'
            ) {
              await onSubmit(
                {
                  text:
                    trimmedText,

                  message:
                    trimmedText,

                  attachments:
                    attachments,

                  source:
                    'titech-chat-composer',
                },
              );
            } else if (
              typeof onSend ===
              'function'
            ) {
              await onSend(
                trimmedText,
                attachments,
              );
            }

            if (
              mountedRef.current
            ) {
              setText('');

              if (
                !isAttachmentsControlled
              ) {
                setInternalAttachments(
                  [],
                );
              }

              if (
                fileInputRef.current
              ) {
                fileInputRef.current.value =
                  '';
              }
            }

            stopTyping();

            return true;
          } catch (
            sendError
          ) {
            reportError(
              sendError?.message ||
                'Unable to send message.',
              {
                code:
                  'SEND_FAILED',
                error:
                  sendError,
              },
            );

            return false;
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
          attachments,
          canSend,
          isAttachmentsControlled,
          onSend,
          onSubmit,
          reportError,
          stopTyping,
          trimmedText,
        ],
      );


    /* ========================================================================
     * Keyboard handling
     * ====================================================================== */

    const handleKeyDown =
      useCallback(
        (event) => {
          onKeyDown?.(
            event,
          );

          if (
            event.defaultPrevented
          ) {
            return;
          }

          if (
            event.key ===
              'Enter' &&
            !event.shiftKey &&
            sendOnEnter
          ) {
            event.preventDefault();

            submitMessage(
              event,
            );
          }
        },
        [
          onKeyDown,
          sendOnEnter,
          submitMessage,
        ],
      );


    /* ========================================================================
     * Clipboard paste
     * ====================================================================== */

    const handlePaste =
      useCallback(
        (event) => {
          if (
            !allowPaste ||
            !allowAttachments ||
            isBusy ||
            readOnly
          ) {
            return;
          }

          const items =
            Array.from(
              event.clipboardData
                ?.items || [],
            );

          const files =
            items
              .filter(
                (
                  item,
                ) =>
                  item.kind ===
                  'file',
              )
              .map(
                (
                  item,
                ) =>
                  item.getAsFile(),
              )
              .filter(Boolean);

          if (
            files.length >
            0
          ) {
            addFiles(
              files,
            );
          }
        },
        [
          allowPaste,
          allowAttachments,
          isBusy,
          readOnly,
          addFiles,
        ],
      );


    /* ========================================================================
     * Drag and Drop
     * ====================================================================== */

    const handleDragEnter =
      useCallback(
        (event) => {
          if (
            !allowDrop ||
            !allowAttachments ||
            isBusy ||
            readOnly
          ) {
            return;
          }

          event.preventDefault();

          setIsDragging(
            true,
          );
        },
        [
          allowDrop,
          allowAttachments,
          isBusy,
          readOnly,
        ],
      );


    const handleDragOver =
      useCallback(
        (event) => {
          if (
            !allowDrop ||
            !allowAttachments ||
            isBusy ||
            readOnly
          ) {
            return;
          }

          event.preventDefault();

          if (
            event.dataTransfer
          ) {
            event.dataTransfer.dropEffect =
              'copy';
          }

          setIsDragging(
            true,
          );
        },
        [
          allowDrop,
          allowAttachments,
          isBusy,
          readOnly,
        ],
      );


    const handleDragLeave =
      useCallback(
        (event) => {
          if (
            !event.currentTarget.contains(
              event.relatedTarget,
            )
          ) {
            setIsDragging(
              false,
            );
          }
        },
        [],
      );


    const handleDrop =
      useCallback(
        async (
          event,
        ) => {
          if (
            !allowDrop ||
            !allowAttachments ||
            isBusy ||
            readOnly
          ) {
            return;
          }

          event.preventDefault();

          setIsDragging(
            false,
          );

          await addFiles(
            event.dataTransfer
              ?.files,
          );
        },
        [
          allowDrop,
          allowAttachments,
          isBusy,
          readOnly,
          addFiles,
        ],
      );


    /* ========================================================================
     * File input props
     * ====================================================================== */

    const fileInputDisabled =
      disabled ||
      readOnly ||
      loading ||
      isSending ||
      isUploading;


    /* ========================================================================
     * Character counter state
     * ====================================================================== */

    const remainingCharacters =
      maxMessageLength -
      text.length;

    const warningThreshold =
      Math.max(
        20,
        Math.floor(
          maxMessageLength *
            0.05,
        ),
      );

    const counterClass =
      remainingCharacters <=
      0
        ? 'titech-chat-composer__counter--danger'
        : remainingCharacters <=
            warningThreshold
          ? 'titech-chat-composer__counter--warning'
          : '';


    /* ========================================================================
     * Root classes
     * ====================================================================== */

    const rootClassName =
      [
        'titech-chat-composer',

        disabled
          ? 'titech-chat-composer--disabled'
          : '',

        isDragging
          ? 'titech-chat-composer--dragging'
          : '',

        className,
      ]
        .filter(Boolean)
        .join(' ');


    /* ========================================================================
     * Render
     * ====================================================================== */

    return (
      <form
        ref={
          formRef
        }
        {...rest}
        className={
          rootClassName
        }
        onSubmit={
          submitMessage
        }
        onDragEnter={
          handleDragEnter
        }
        onDragOver={
          handleDragOver
        }
        onDragLeave={
          handleDragLeave
        }
        onDrop={
          handleDrop
        }
        aria-label={
          ariaLabel
        }
        data-testid={
          testId
        }
      >

        <div className="titech-chat-composer__container">

          <div className="titech-chat-composer__surface">

            {/* ============================================================ */}
            {/* Drag/drop feedback                                            */}
            {/* ============================================================ */}

            {isDragging ? (
              <div
                className="titech-chat-composer__dropzone titech-chat-composer__dropzone--active"
                role="status"
                aria-live="polite"
              >
                Drop files here to attach them to your TITech message.
              </div>
            ) : null}


            {/* ============================================================ */}
            {/* Attachment previews                                           */}
            {/* ============================================================ */}

            {attachments.length >
            0 ? (
              <div
                className="titech-attachments-preview"
                data-testid="titech-attachments-preview"
              >
                {attachments.map(
                  (
                    attachment,
                    index,
                  ) => (
                    <AttachmentPreview
                      key={
                        attachment?.id ||
                        `${attachment?.name || 'attachment'}-${index}`
                      }
                      attachment={
                        attachment
                      }
                      onRemove={() =>
                        removeAttachment(
                          attachment,
                          index,
                        )
                      }
                      onRetry={() =>
                        retryAttachment(
                          attachment,
                          index,
                        )
                      }
                      disabled={
                        isBusy
                      }
                      readOnly={
                        readOnly
                      }
                      loading={
                        isUploading
                      }
                      showMetadata={
                        showAttachmentMetadata
                      }
                      showRemove={
                        true
                      }
                    />
                  ),
                )}
              </div>
            ) : null}


            {/* ============================================================ */}
            {/* Main input                                                     */}
            {/* ============================================================ */}

            <div className="titech-chat-composer__input-wrapper">

              <textarea
                ref={
                  textareaRef
                }
                value={
                  text
                }
                onChange={
                  handleTextChange
                }
                onKeyDown={
                  handleKeyDown
                }
                onPaste={
                  handlePaste
                }
                onFocus={
                  onFocus
                }
                onBlur={
                  onBlur
                }
                placeholder={
                  placeholder
                }
                disabled={
                  disabled ||
                  loading ||
                  isSending
                }
                readOnly={
                  readOnly
                }
                maxLength={
                  maxMessageLength
                }
                rows={1}
                spellCheck={
                  true
                }
                autoComplete="off"
                aria-label="Message input"
                aria-describedby={
                  error
                    ? 'titech-composer-error'
                    : undefined
                }
                data-testid="titech-chat-input"
              />

              {showCharacterCount ? (
                <span
                  className={[
                    'titech-chat-composer__counter',
                    counterClass,
                  ]
                    .filter(
                      Boolean,
                    )
                    .join(' ')}
                  aria-live="polite"
                >
                  {text.length}/
                  {maxMessageLength}
                </span>
              ) : null}

            </div>


            {/* ============================================================ */}
            {/* Error                                                           */}
            {/* ============================================================ */}

            {error ? (
              <div
                id="titech-composer-error"
                className="titech-chat-composer__validation"
                role="alert"
                data-testid="titech-chat-composer-error"
              >
                {error}
              </div>
            ) : null}


            {/* ============================================================ */}
            {/* Toolbar                                                        */}
            {/* ============================================================ */}

            <div className="titech-chat-composer__toolbar">

              <div className="titech-chat-composer__toolbar-left">

                {allowAttachments ? (
                  <>
                    <button
                      type="button"
                      className="titech-chat-composer__button titech-chat-composer__attachment-button"
                      onClick={
                        openFilePicker
                      }
                      disabled={
                        fileInputDisabled
                      }
                      aria-label="Attach files"
                      title="Attach files"
                      data-testid="titech-chat-attach-button"
                    >
                      <PaperclipIcon />
                    </button>

                    <input
                      ref={
                        fileInputRef
                      }
                      className="titech-chat-composer__attachment-input"
                      type="file"
                      accept={
                        acceptedAttribute
                      }
                      multiple
                      hidden
                      disabled={
                        fileInputDisabled
                      }
                      onChange={
                        handleFileChange
                      }
                      tabIndex={
                        -1
                      }
                      aria-hidden="true"
                    />
                  </>
                ) : null}

              </div>


              <div className="titech-chat-composer__toolbar-right">

                {isSending ||
                isUploading ? (
                  <span
                    className="titech-chat-composer__status titech-chat-composer__status--info"
                    role="status"
                    aria-live="polite"
                  >
                    <LoadingIcon />

                    {isUploading
                      ? 'Uploading…'
                      : 'Sending…'}
                  </span>
                ) : null}


                <button
                  type="submit"
                  className="titech-chat-composer__send-button"
                  disabled={
                    !canSend
                  }
                  aria-label="Send message"
                  title={
                    canSend
                      ? 'Send message'
                      : 'Enter a message or attach a file'
                  }
                  data-testid="titech-chat-send-button"
                >
                  {isSending ? (
                    <LoadingIcon />
                  ) : (
                    <SendIcon />
                  )}
                </button>

              </div>

            </div>


            {/* ============================================================ */}
            {/* Upload progress                                               */}
            {/* ============================================================ */}

            {isUploading ? (
              <div
                className="titech-chat-composer__progress"
                role="progressbar"
                aria-label="Uploading attachments"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div className="titech-chat-composer__progress-bar" />
              </div>
            ) : null}

          </div>
        </div>
      </form>
    );
  },
);


/* ============================================================================
 * Component metadata
 * ========================================================================== */

Composer.displayName =
  'TITechComposer';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

Composer.propTypes = {
  /**
   * Existing contract:
   * onSend(text, attachments)
   */
  onSend:
    PropTypes.func,

  /**
   * Optional structured submit contract:
   * onSubmit({ text, message, attachments, source })
   */
  onSubmit:
    PropTypes.func,

  onTypingStart:
    PropTypes.func,

  onTypingStop:
    PropTypes.func,

  onAttachmentAdd:
    PropTypes.func,

  onAttachmentRemove:
    PropTypes.func,

  onAttachmentRetry:
    PropTypes.func,

  uploadHandler:
    PropTypes.func,

  attachments:
    PropTypes.arrayOf(
      PropTypes.object,
    ),

  placeholder:
    PropTypes.string,

  allowAttachments:
    PropTypes.bool,

  allowPaste:
    PropTypes.bool,

  allowDrop:
    PropTypes.bool,

  maxFileSize:
    PropTypes.number,

  maxAttachments:
    PropTypes.number,

  allowedMimeTypes:
    PropTypes.arrayOf(
      PropTypes.string,
    ),

  accept:
    PropTypes.string,

  disabled:
    PropTypes.bool,

  readOnly:
    PropTypes.bool,

  autoFocus:
    PropTypes.bool,

  maxMessageLength:
    PropTypes.number,

  ariaLabel:
    PropTypes.string,

  sendOnEnter:
    PropTypes.bool,

  showCharacterCount:
    PropTypes.bool,

  showAttachmentMetadata:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  sending:
    PropTypes.bool,

  uploading:
    PropTypes.bool,

  typingTimeout:
    PropTypes.number,

  className:
    PropTypes.string,

  testId:
    PropTypes.string,

  onError:
    PropTypes.func,

  onFocus:
    PropTypes.func,

  onBlur:
    PropTypes.func,

  onKeyDown:
    PropTypes.func,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

Composer.defaultProps = {
  onSend:
    undefined,

  onSubmit:
    undefined,

  onTypingStart:
    undefined,

  onTypingStop:
    undefined,

  onAttachmentAdd:
    undefined,

  onAttachmentRemove:
    undefined,

  onAttachmentRetry:
    undefined,

  uploadHandler:
    undefined,

  attachments:
    undefined,

  placeholder:
    DEFAULT_PLACEHOLDER,

  allowAttachments:
    true,

  allowPaste:
    true,

  allowDrop:
    true,

  maxFileSize:
    DEFAULT_MAX_FILE_SIZE,

  maxAttachments:
    DEFAULT_MAX_ATTACHMENTS,

  allowedMimeTypes:
    DEFAULT_ALLOWED_TYPES,

  accept:
    DEFAULT_ACCEPT,

  disabled:
    false,

  readOnly:
    false,

  autoFocus:
    false,

  maxMessageLength:
    DEFAULT_MAX_MESSAGE_LENGTH,

  ariaLabel:
    'TITech message composer',

  sendOnEnter:
    true,

  showCharacterCount:
    true,

  showAttachmentMetadata:
    true,

  loading:
    false,

  sending:
    false,

  uploading:
    false,

  typingTimeout:
    DEFAULT_TYPING_TIMEOUT,

  className:
    '',

  testId:
    'titech-chat-composer',

  onError:
    undefined,

  onFocus:
    undefined,

  onBlur:
    undefined,

  onKeyDown:
    undefined,
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  Composer,

  DEFAULT_ACCEPT,

  DEFAULT_ALLOWED_TYPES,

  DEFAULT_MAX_ATTACHMENTS,

  DEFAULT_MAX_FILE_SIZE,

  DEFAULT_MAX_MESSAGE_LENGTH,

  formatFileSize,

  getFileIdentity,

  matchesAcceptRule,

  normalizeFilename,

  normalizeMimeType,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default Composer;