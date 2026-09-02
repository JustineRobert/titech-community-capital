/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Composer
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/Composer.js
 *
 * Purpose:
 *   Enterprise-grade message composer for the TITech Community Capital
 *   communication platform.
 *
 * Capabilities
 * ----------------------------------------------------------------------------
 * ✓ Controlled / semi-controlled message input
 * ✓ Text submission
 * ✓ Enter-to-send
 * ✓ Shift+Enter for newline
 * ✓ Attachment selection
 * ✓ Multiple attachments
 * ✓ File validation
 * ✓ File size validation
 * ✓ MIME validation
 * ✓ Duplicate attachment protection
 * ✓ Attachment preview integration
 * ✓ Attachment removal
 * ✓ Attachment retry support
 * ✓ Drag-and-drop uploads
 * ✓ Clipboard image/file paste
 * ✓ Upload state
 * ✓ Sending state
 * ✓ Error state
 * ✓ Character limit
 * ✓ Character counter
 * ✓ Accessible controls
 * ✓ Keyboard navigation
 * ✓ Mobile-friendly input
 * ✓ Abort-safe asynchronous upload handling
 * ✓ External submit compatibility
 * ✓ TITech branding
 *
 * Security Boundary
 * ----------------------------------------------------------------------------
 * Client-side validation is UX protection only.
 *
 * The backend MUST independently enforce:
 *   - Authentication
 *   - Tenant isolation
 *   - Authorization
 *   - File size limits
 *   - MIME validation
 *   - File signature validation
 *   - Malware scanning
 *   - Storage authorization
 *   - Content inspection
 *   - Rate limiting
 *   - Abuse prevention
 *
 * ============================================================================
 */

'use strict';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import AttachmentPreview, {
  MultipleAttachmentPreview,
} from './AttachmentPreview';

import './composer.css';


/* ============================================================================
 * Configuration
 * ========================================================================== */

const DEFAULT_MAX_LENGTH = 5000;

const DEFAULT_MAX_FILE_SIZE =
  10 * 1024 * 1024; // 10 MB

const DEFAULT_MAX_ATTACHMENTS = 10;

const DEFAULT_ACCEPT =
  [
    'image/*',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/*',
    'video/*',
  ].join(',');

const DEFAULT_PLACEHOLDER =
  'Write a message…';


/* ============================================================================
 * MIME / File helpers
 * ========================================================================== */

const normalizeMimeType = (
  value,
) =>
  String(
    value || '',
  )
    .trim()
    .toLowerCase();


const normalizeFilename = (
  value,
) => {
  const name =
    String(
      value ||
        'Attachment',
    )
      .replace(
        /[\u0000-\u001F\u007F]/g,
        '',
      )
      .trim();

  return (
    name.slice(
      0,
      160,
    ) ||
    'Attachment'
  );
};


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
  ];

  const exponent =
    Math.min(
      Math.floor(
        Math.log(
          value,
        ) /
          Math.log(
            1024,
          ),
      ),
      units.length - 1,
    );

  const amount =
    value /
    Math.pow(
      1024,
      exponent,
    );

  return `${amount.toFixed(
    exponent === 0
      ? 0
      : amount >= 10
        ? 1
        : 2,
  )} ${units[exponent]}`;
};


const matchesAccept = (
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
    String(
      accept,
    )
      .split(',')
      .map(
        (rule) =>
          rule
            .trim()
            .toLowerCase(),
      )
      .filter(Boolean);

  if (
    rules.length === 0
  ) {
    return true;
  }

  const mime =
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
        return mime.startsWith(
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
        mime === rule
      );
    },
  );
};


/* ============================================================================
 * Icons
 * ========================================================================== */

const PaperclipIcon = () => (
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


const SendIcon = () => (
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


const MicIcon = () => (
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
    <rect
      x="9"
      y="2"
      width="6"
      height="12"
      rx="3"
    />

    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 19v3" />
    <path d="M8 22h8" />
  </svg>
);


const StopIcon = () => (
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
    strokeLinejoin="round"
  >
    <rect
      x="6"
      y="6"
      width="12"
      height="12"
      rx="2"
    />
  </svg>
);


const LoadingIcon = () => (
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
    <path d="M2 12H6" />
    <path d="m3.76 7.76 2.83 2.83" />
  </svg>
);


/* ============================================================================
 * Composer
 * ========================================================================== */

const Composer = forwardRef(
  (
    {
      value,
      defaultValue = '',

      onChange,
      onSend,

      onSubmit,
      onAttachmentAdd,
      onAttachmentRemove,
      onAttachmentRetry,

      attachments = [],

      disabled = false,
      readOnly = false,

      loading = false,
      sending = false,
      uploading = false,

      error = null,

      placeholder =
        DEFAULT_PLACEHOLDER,

      maxLength =
        DEFAULT_MAX_LENGTH,

      maxFileSize =
        DEFAULT_MAX_FILE_SIZE,

      maxAttachments =
        DEFAULT_MAX_ATTACHMENTS,

      accept =
        DEFAULT_ACCEPT,

      allowAttachments = true,
      allowPaste = true,
      allowDrop = true,
      allowVoice = true,

      sendOnEnter = true,

      autoFocus = false,

      showCharacterCount = true,
      showAttachmentMetadata = true,

      className = '',

      ariaLabel =
        'TITech chat message composer',

      testId =
        'titech-chat-composer',

      uploadHandler,

      recordingHandler,

      onError,

      onFocus,
      onBlur,

      onKeyDown,

      ...rest
    },
    forwardedRef,
  ) => {
    /* ========================================================================
     * State
     * ====================================================================== */

    const isControlled =
      value !== undefined;

    const [
      internalValue,
      setInternalValue,
    ] = useState(
      defaultValue,
    );

    const [
      internalAttachments,
      setInternalAttachments,
    ] = useState(
      [],
    );

    const [
      isDragging,
      setIsDragging,
    ] = useState(
      false,
    );

    const [
      localError,
      setLocalError,
    ] = useState(
      null,
    );

    const [
      isRecording,
      setIsRecording,
    ] = useState(
      false,
    );

    const [
      isUploading,
      setIsUploading,
    ] = useState(
      false,
    );


    /* ========================================================================
     * Refs
     * ====================================================================== */

    const textareaRef =
      useRef(null);

    const fileInputRef =
      useRef(null);

    const mountedRef =
      useRef(true);

    const uploadAbortRef =
      useRef(null);

    const recordingRef =
      useRef(null);


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
            uploadAbortRef.current
          ) {
            try {
              uploadAbortRef.current.abort();
            } catch {
              // Best effort only.
            }
          }
        };
      },
      [],
    );


    /* ========================================================================
     * Derived state
     * ====================================================================== */

    const message =
      isControlled
        ? String(
            value ?? '',
          )
        : internalValue;

    const selectedAttachments =
      Array.isArray(
        attachments,
      )
        ? attachments
        : internalAttachments;

    const attachmentCount =
      selectedAttachments.length;

    const effectiveError =
      error ||
      localError;

    const isBusy =
      Boolean(
        disabled ||
          readOnly ||
          loading ||
          sending ||
          uploading ||
          isUploading,
      );

    const trimmedMessage =
      message.trim();

    const hasMessage =
      trimmedMessage.length >
      0;

    const hasAttachments =
      attachmentCount >
      0;

    const canSend =
      !isBusy &&
      (
        hasMessage ||
        hasAttachments
      ) &&
      message.length <=
        maxLength;

    const remainingCharacters =
      maxLength -
      message.length;

    const counterClass =
      remainingCharacters <=
      Math.max(
        20,
        Math.floor(
          maxLength *
            0.05,
        ),
      )
        ? remainingCharacters <=
          0
          ? 'titech-chat-composer__counter--danger'
          : 'titech-chat-composer__counter--warning'
        : '';


    /* ========================================================================
     * Public API
     * ====================================================================== */

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => {
          textareaRef.current?.focus();
        },

        blur: () => {
          textareaRef.current?.blur();
        },

        clear: () => {
          updateMessage('');
        },

        getValue: () =>
          message,

        getAttachments: () =>
          selectedAttachments,

        clearAttachments: () => {
          setInternalAttachments(
            [],
          );
        },

        openFilePicker: () => {
          fileInputRef.current?.click();
        },
      }),
      [
        message,
        selectedAttachments,
      ],
    );


    /* ========================================================================
     * Message update
     * ====================================================================== */

    const updateMessage =
      useCallback(
        (nextValue) => {
          const safeValue =
            String(
              nextValue ?? '',
            );

          if (
            safeValue.length >
            maxLength
          ) {
            return;
          }

          if (
            !isControlled
          ) {
            setInternalValue(
              safeValue,
            );
          }

          if (
            typeof onChange ===
            'function'
          ) {
            onChange(
              safeValue,
            );
          }
        },
        [
          isControlled,
          maxLength,
          onChange,
        ],
      );


    /* ========================================================================
     * Error helper
     * ====================================================================== */

    const reportError =
      useCallback(
        (
          messageText,
          metadata = {},
        ) => {
          const safeMessage =
            String(
              messageText ||
                'Unable to process this request.',
            );

          if (
            mountedRef.current
          ) {
            setLocalError(
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
     * Attachment validation
     * ====================================================================== */

    const validateFile =
      useCallback(
        (file) => {
          if (
            !file
          ) {
            return {
              valid: false,
              reason:
                'Invalid attachment.',
            };
          }

          if (
            file.size >
            maxFileSize
          ) {
            return {
              valid: false,
              reason:
                `${normalizeFilename(
                  file.name,
                )} exceeds the maximum file size of ${formatFileSize(
                  maxFileSize,
                )}.`,
            };
          }

          if (
            !matchesAccept(
              file,
              accept,
            )
          ) {
            return {
              valid: false,
              reason:
                `${normalizeFilename(
                  file.name,
                )} is not a supported file type.`,
            };
          }

          return {
            valid: true,
            reason: null,
          };
        },
        [
          accept,
          maxFileSize,
        ],
      );


    /* ========================================================================
     * Add attachments
     * ====================================================================== */

    const addFiles =
      useCallback(
        async (
          fileList,
        ) => {
          if (
            !allowAttachments ||
            isBusy
          ) {
            return;
          }

          const files =
            Array.from(
              fileList || [],
            ).filter(Boolean);

          if (
            files.length ===
            0
          ) {
            return;
          }

          setLocalError(
            null,
          );

          const existingKeys =
            new Set(
              selectedAttachments.map(
                (
                  item,
                ) =>
                  getFileIdentity(
                    item.file ||
                      item,
                  ),
              ),
            );

          const validFiles =
            [];

          for (
            const file of files
          ) {
            if (
              selectedAttachments.length +
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
                validation.reason,
                {
                  code:
                    'INVALID_ATTACHMENT',
                  file,
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
              file,
            );
          }

          if (
            validFiles.length ===
            0
          ) {
            return;
          }

          const prepared =
            validFiles.map(
              (
                file,
              ) => ({
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
              }),
            );

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

            setIsUploading(
              true,
            );

            try {
              const result =
                await uploadHandler(
                  prepared,
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

              const uploaded =
                Array.isArray(
                  result,
                )
                  ? result
                  : prepared;

              setInternalAttachments(
                (
                  current,
                ) => [
                  ...current,
                  ...uploaded,
                ],
              );

              if (
                typeof onAttachmentAdd ===
                'function'
              ) {
                onAttachmentAdd(
                  uploaded,
                );
              }
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
                setIsUploading(
                  false,
                );
              }

              uploadAbortRef.current =
                null;
            }

            return;
          }

          setInternalAttachments(
            (
              current,
            ) => [
              ...current,
              ...prepared,
            ],
          );

          if (
            typeof onAttachmentAdd ===
            'function'
          ) {
            onAttachmentAdd(
              prepared,
            );
          }
        },
        [
          allowAttachments,
          isBusy,
          maxAttachments,
          maxFileSize,
          selectedAttachments,
          validateFile,
          reportError,
          uploadHandler,
          onAttachmentAdd,
        ],
      );


    /* ========================================================================
     * File picker
     * ====================================================================== */

    const handleFileChange =
      useCallback(
        (event) => {
          const files =
            event.target
              ?.files;

          addFiles(
            files,
          );

          if (
            event.target
          ) {
            event.target.value =
              '';
          }
        },
        [
          addFiles,
        ],
      );


    const openFilePicker =
      useCallback(
        () => {
          if (
            !allowAttachments ||
            isBusy
          ) {
            return;
          }

          fileInputRef.current?.click();
        },
        [
          allowAttachments,
          isBusy,
        ],
      );


    /* ========================================================================
     * Remove attachment
     * ====================================================================== */

    const handleRemoveAttachment =
      useCallback(
        (
          attachment,
        ) => {
          if (
            isBusy
          ) {
            return;
          }

          setInternalAttachments(
            (
              current,
            ) =>
              current.filter(
                (
                  item,
                ) =>
                  item !==
                  attachment &&
                  item.id !==
                  attachment?.id,
              ),
          );

          if (
            typeof onAttachmentRemove ===
            'function'
          ) {
            onAttachmentRemove(
              attachment,
            );
          }
        },
        [
          isBusy,
          onAttachmentRemove,
        ],
      );


    /* ========================================================================
     * Retry attachment
     * ====================================================================== */

    const handleRetryAttachment =
      useCallback(
        async (
          attachment,
        ) => {
          if (
            !attachment ||
            isBusy
          ) {
            return;
          }

          if (
            typeof onAttachmentRetry ===
            'function'
          ) {
            await onAttachmentRetry(
              attachment,
            );

            return;
          }

          if (
            attachment.file
          ) {
            await addFiles([
              attachment.file,
            ]);
          }
        },
        [
          isBusy,
          onAttachmentRetry,
          addFiles,
        ],
      );


    /* ========================================================================
     * Submit
     * ====================================================================== */

    const submit =
      useCallback(
        async () => {
          if (
            !canSend
          ) {
            return false;
          }

          const payload = {
            text:
              trimmedMessage,

            message:
              trimmedMessage,

            attachments:
              selectedAttachments,

            source:
              'titech-chat-composer',
          };

          setLocalError(
            null,
          );

          try {
            let result;

            if (
              typeof onSubmit ===
              'function'
            ) {
              result =
                await onSubmit(
                  payload,
                );
            } else if (
              typeof onSend ===
              'function'
            ) {
              result =
                await onSend(
                  payload,
                );
            }

            if (
              result !==
                false &&
              mountedRef.current
            ) {
              updateMessage(
                '',
              );

              if (
                typeof attachments ===
                  'undefined'
              ) {
                setInternalAttachments(
                  [],
                );
              }
            }

            return result !==
              false;
          } catch (
            submitError
          ) {
            reportError(
              submitError?.message ||
                'Unable to send the message.',
              {
                code:
                  'SEND_FAILED',
                error:
                  submitError,
              },
            );

            return false;
          }
        },
        [
          canSend,
          trimmedMessage,
          selectedAttachments,
          onSubmit,
          onSend,
          updateMessage,
          attachments,
          reportError,
        ],
      );


    /* ========================================================================
     * Keyboard handling
     * ====================================================================== */

    const handleKeyDown =
      useCallback(
        (event) => {
          if (
            typeof onKeyDown ===
            'function'
          ) {
            onKeyDown(
              event,
            );
          }

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

            submit();
          }
        },
        [
          onKeyDown,
          sendOnEnter,
          submit,
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
            isBusy
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
          addFiles,
        ],
      );


    /* ========================================================================
     * Drag and drop
     * ====================================================================== */

    const handleDragEnter =
      useCallback(
        (event) => {
          if (
            !allowDrop ||
            !allowAttachments ||
            isBusy
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
        ],
      );


    const handleDragOver =
      useCallback(
        (event) => {
          if (
            !allowDrop ||
            !allowAttachments ||
            isBusy
          ) {
            return;
          }

          event.preventDefault();

          event.dataTransfer.dropEffect =
            'copy';

          setIsDragging(
            true,
          );
        },
        [
          allowDrop,
          allowAttachments,
          isBusy,
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
        (event) => {
          if (
            !allowDrop ||
            !allowAttachments ||
            isBusy
          ) {
            return;
          }

          event.preventDefault();

          setIsDragging(
            false,
          );

          addFiles(
            event.dataTransfer
              ?.files,
          );
        },
        [
          allowDrop,
          allowAttachments,
          isBusy,
          addFiles,
        ],
      );


    /* ========================================================================
     * Voice recording
     * ====================================================================== */

    const handleRecording =
      useCallback(
        async () => {
          if (
            !allowVoice ||
            isBusy
          ) {
            return;
          }

          if (
            isRecording
          ) {
            try {
              if (
                typeof recordingHandler ===
                'function'
              ) {
                await recordingHandler(
                  'stop',
                  recordingRef.current,
                );
              }

              recordingRef.current =
                null;

              setIsRecording(
                false,
              );
            } catch (
              recordingError
            ) {
              reportError(
                recordingError?.message ||
                  'Unable to stop voice recording.',
                {
                  code:
                    'RECORDING_STOP_FAILED',
                  error:
                    recordingError,
                },
              );
            }

            return;
          }

          try {
            let recorder;

            if (
              typeof recordingHandler ===
              'function'
            ) {
              recorder =
                await recordingHandler(
                  'start',
                );
            }

            recordingRef.current =
              recorder ||
              null;

            setIsRecording(
              true,
            );
          } catch (
            recordingError
          ) {
            reportError(
              recordingError?.message ||
                'Unable to start voice recording.',
              {
                code:
                  'RECORDING_START_FAILED',
                error:
                  recordingError,
              },
            );
          }
        },
        [
          allowVoice,
          isBusy,
          isRecording,
          recordingHandler,
          reportError,
        ],
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
     * Render
     * ====================================================================== */

    const rootClassName = [
      'titech-chat-composer',

      disabled
        ? 'titech-chat-composer--disabled'
        : '',

      isDragging
        ? 'titech-chat-composer--dragging'
        : '',

      isRecording
        ? 'titech-chat-composer--recording'
        : '',

      className,
    ]
      .filter(Boolean)
      .join(' ');


    return (
      <section
        {...rest}
        className={
          rootClassName
        }
        data-testid={
          testId
        }
        aria-label={
          ariaLabel
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
      >
        <div className="titech-chat-composer__container">
          <div className="titech-chat-composer__surface">

            {/* ============================================================ */}
            {/* Drag and Drop Zone                                             */}
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
            {/* Attachments                                                     */}
            {/* ============================================================ */}

            {selectedAttachments.length >
            0 ? (
              <MultipleAttachmentPreview
                attachments={
                  selectedAttachments
                }
                onRemove={
                  handleRemoveAttachment
                }
                onRetry={
                  handleRetryAttachment
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
            ) : null}


            {/* ============================================================ */}
            {/* Input                                                            */}
            {/* ============================================================ */}

            <div className="titech-chat-composer__input-wrapper">

              <textarea
                ref={
                  textareaRef
                }
                className="titech-chat-composer__input"
                value={
                  message
                }
                onChange={(
                  event,
                ) =>
                  updateMessage(
                    event.target
                      .value,
                  )
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
                maxLength={
                  maxLength
                }
                disabled={
                  disabled
                }
                readOnly={
                  readOnly
                }
                rows={
                  1
                }
                spellCheck={
                  true
                }
                autoComplete="off"
                aria-label={
                  ariaLabel
                }
                aria-describedby={
                  effectiveError
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
                  aria-label={`${remainingCharacters} characters remaining`}
                >
                  {message.length}/
                  {maxLength}
                </span>
              ) : null}
            </div>


            {/* ============================================================ */}
            {/* Error                                                            */}
            {/* ============================================================ */}

            {effectiveError ? (
              <div
                id="titech-composer-error"
                className="titech-chat-composer__validation"
                role="alert"
                data-testid="titech-chat-composer-error"
              >
                {String(
                  effectiveError,
                )}
              </div>
            ) : null}


            {/* ============================================================ */}
            {/* Toolbar                                                         */}
            {/* ============================================================ */}

            <div className="titech-chat-composer__toolbar">

              <div className="titech-chat-composer__toolbar-left">

                {/* -------------------------------------------------------- */}
                {/* Attachment                                                */}
                {/* -------------------------------------------------------- */}

                {allowAttachments ? (
                  <>
                    <button
                      type="button"
                      className="titech-chat-composer__button titech-chat-composer__attachment-button"
                      onClick={
                        openFilePicker
                      }
                      disabled={
                        isBusy
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
                        accept
                      }
                      multiple
                      disabled={
                        isBusy
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


                {/* -------------------------------------------------------- */}
                {/* Voice                                                      */}
                {/* -------------------------------------------------------- */}

                {allowVoice ? (
                  <button
                    type="button"
                    className={[
                      'titech-chat-composer__button',
                      'titech-chat-composer__record-button',

                      isRecording
                        ? 'titech-chat-composer__record-button--recording'
                        : '',
                    ]
                      .filter(
                        Boolean,
                      )
                      .join(' ')}
                    onClick={
                      handleRecording
                    }
                    disabled={
                      disabled ||
                      readOnly ||
                      loading ||
                      sending
                    }
                    aria-label={
                      isRecording
                        ? 'Stop voice recording'
                        : 'Start voice recording'
                    }
                    aria-pressed={
                      isRecording
                    }
                    title={
                      isRecording
                        ? 'Stop recording'
                        : 'Voice message'
                    }
                    data-testid="titech-chat-record-button"
                  >
                    {isRecording ? (
                      <StopIcon />
                    ) : (
                      <MicIcon />
                    )}
                  </button>
                ) : null}

              </div>


              <div className="titech-chat-composer__toolbar-right">

                {/* -------------------------------------------------------- */}
                {/* Sending status                                             */}
                {/* -------------------------------------------------------- */}

                {sending ||
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


                {/* -------------------------------------------------------- */}
                {/* Send                                                       */}
                {/* -------------------------------------------------------- */}

                <button
                  type="button"
                  className="titech-chat-composer__send-button"
                  onClick={
                    submit
                  }
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
                  {sending ? (
                    <LoadingIcon />
                  ) : (
                    <SendIcon />
                  )}
                </button>

              </div>
            </div>


            {/* ============================================================ */}
            {/* Upload progress placeholder                                    */}
            {/* ============================================================ */}

            {isUploading ? (
              <div
                className="titech-chat-composer__progress"
                role="progressbar"
                aria-label="Uploading attachments"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuetext="Uploading attachments"
              >
                <div className="titech-chat-composer__progress-bar" />
              </div>
            ) : null}

          </div>
        </div>
      </section>
    );
  },
);


/* ============================================================================
 * Display Name
 * ========================================================================== */

Composer.displayName =
  'TITechComposer';


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  Composer,
  DEFAULT_ACCEPT,
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_LENGTH,
  formatFileSize,
  getFileIdentity,
  matchesAccept,
  normalizeFilename,
  normalizeMimeType,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default Composer;