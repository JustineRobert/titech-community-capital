/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Attachment Preview
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/AttachmentPreview.jsx
 *
 * Purpose:
 *   Enterprise-grade attachment preview and management component for the
 *   TITech Community Capital chat platform.
 *
 * Capabilities
 * ------------
 * ✓ Image previews
 * ✓ File/document previews
 * ✓ Audio/video indicators
 * ✓ File metadata
 * ✓ Upload state
 * ✓ Processing state
 * ✓ Error state
 * ✓ Retry action
 * ✓ Remove action
 * ✓ Read-only mode
 * ✓ Disabled mode
 * ✓ Keyboard accessibility
 * ✓ Screen-reader support
 * ✓ Safe preview URL handling
 * ✓ File/Blob object URL support
 * ✓ Object URL cleanup
 * ✓ Malformed attachment protection
 * ✓ Multiple attachment support
 * ✓ Stable test selectors
 * ✓ TITech branding consistency
 *
 * Security Boundary
 * -----------------
 * This component is a UI component only.
 *
 * It MUST NOT be considered a security boundary.
 *
 * Backend services MUST independently enforce:
 *   - Authentication
 *   - Tenant authorization
 *   - File size limits
 *   - MIME validation
 *   - File signature validation
 *   - Malware scanning
 *   - Content inspection
 *   - Storage authorization
 *   - Signed URL expiration
 *   - Data-loss prevention rules
 *
 * Never trust client-provided:
 *   - MIME type
 *   - Filename
 *   - File extension
 *   - File size
 *   - URL
 *
 * ============================================================================
 */

import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MAX_FILENAME_LENGTH = 120;

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
]);

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/rtf',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
]);

/**
 * ============================================================================
 * Safe utility helpers
 * ============================================================================
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

const sanitizeFilename = (
  filename,
) => {
  const sanitized =
    toSafeString(
      filename,
    )
      .replace(
        /[\u0000-\u001F\u007F]/g,
        '',
      )
      .trim();

  if (!sanitized) {
    return 'Attachment';
  }

  return sanitized.slice(
    0,
    MAX_FILENAME_LENGTH,
  );
};

const normalizeMimeType = (
  value,
) =>
  toSafeString(
    value,
  )
    .trim()
    .toLowerCase();

const getAttachmentName = (
  attachment,
) =>
  sanitizeFilename(
    attachment?.name ||
      attachment?.filename ||
      attachment?.originalName ||
      'Attachment',
  );

const getExtension = (
  filename,
) => {
  const safeName =
    sanitizeFilename(
      filename,
    );

  const lastDot =
    safeName.lastIndexOf('.');

  if (
    lastDot <= 0 ||
    lastDot >=
      safeName.length - 1
  ) {
    return '';
  }

  return safeName
    .slice(
      lastDot + 1,
    )
    .toUpperCase()
    .slice(
      0,
      10,
    );
};

const formatFileSize = (
  value,
) => {
  const bytes =
    Number(value);

  if (
    !Number.isFinite(
      bytes,
    ) ||
    bytes < 0
  ) {
    return '';
  }

  if (
    bytes === 0
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

  const exponent = Math.min(
    Math.floor(
      Math.log(
        bytes,
      ) /
        Math.log(
          1024,
        ),
    ),
    units.length - 1,
  );

  const amount =
    bytes /
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
 * ============================================================================
 * Attachment classification
 * ============================================================================
 */

const isImageAttachment = (
  attachment,
) => {
  const type =
    normalizeMimeType(
      attachment?.type ||
        attachment?.mimeType,
    );

  if (
    IMAGE_MIME_TYPES.has(
      type,
    )
  ) {
    return true;
  }

  const name =
    toSafeString(
      attachment?.name ||
        attachment?.filename,
    );

  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(
    name,
  );
};

const getAttachmentCategory = (
  attachment,
) => {
  const type =
    normalizeMimeType(
      attachment?.type ||
        attachment?.mimeType,
    );

  if (
    IMAGE_MIME_TYPES.has(
      type,
    ) ||
    isImageAttachment(
      attachment,
    )
  ) {
    return 'image';
  }

  if (
    VIDEO_MIME_TYPES.has(
      type,
    )
  ) {
    return 'video';
  }

  if (
    AUDIO_MIME_TYPES.has(
      type,
    )
  ) {
    return 'audio';
  }

  if (
    DOCUMENT_MIME_TYPES.has(
      type,
    ) ||
    type.includes('pdf') ||
    type.includes('word') ||
    type.includes('excel') ||
    type.includes('spreadsheet') ||
    type.includes('presentation')
  ) {
    return 'document';
  }

  return 'file';
};

/**
 * ============================================================================
 * Safe URL handling
 * ============================================================================
 *
 * Allowed:
 *   http:
 *   https:
 *   blob:
 *   data:image/*
 *
 * Explicitly rejected:
 *   javascript:
 *   vbscript:
 *   file:
 *   data:text/*
 *   data:application/*
 * ============================================================================
 */

const getSafePreviewUrl = (
  value,
) => {
  const raw =
    toSafeString(
      value,
    ).trim();

  if (!raw) {
    return '';
  }

  try {
    const parsed =
      new URL(
        raw,
        window.location.origin,
      );

    const protocol =
      parsed.protocol.toLowerCase();

    if (
      protocol ===
        'http:' ||
      protocol ===
        'https:' ||
      protocol ===
        'blob:'
    ) {
      return parsed.href;
    }

    if (
      protocol ===
        'data:' &&
      /^data:image\//i.test(
        raw,
      )
    ) {
      return raw;
    }

    return '';
  } catch {
    return '';
  }
};

const resolvePreviewUrl = (
  attachment,
) => {
  if (!attachment) {
    return '';
  }

  const candidates = [
    attachment.previewUrl,
    attachment.preview,
    attachment.url,
    attachment.src,
  ];

  for (
    const candidate of candidates
  ) {
    const safeUrl =
      getSafePreviewUrl(
        candidate,
      );

    if (safeUrl) {
      return safeUrl;
    }
  }

  return '';
};

/**
 * ============================================================================
 * Stable attachment identity
 * ============================================================================
 */

const getAttachmentId = (
  attachment,
  index = 0,
) => {
  const explicitId =
    toSafeString(
      attachment?.id ||
        attachment?.attachmentId ||
        attachment?.uuid,
    ).trim();

  if (explicitId) {
    return explicitId;
  }

  const filename =
    getAttachmentName(
      attachment,
    );

  return `attachment-${index}-${filename}`;
};

/**
 * ============================================================================
 * SVG icons
 * ============================================================================
 */

const FileIcon = ({
  category,
}) => {
  const paths = {
    image: (
      <>
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="2"
        />

        <circle
          cx="8.5"
          cy="8.5"
          r="1.5"
        />

        <path
          d="m3 16 5-5 4 4 2.5-2.5L21 19"
        />
      </>
    ),

    document: (
      <>
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"
        />

        <path
          d="M14 2v6h6"
        />

        <path
          d="M8 13h8"
        />

        <path
          d="M8 17h6"
        />
      </>
    ),

    video: (
      <>
        <rect
          x="3"
          y="5"
          width="13"
          height="14"
          rx="2"
        />

        <path
          d="m16 10 5-3v10l-5-3"
        />
      </>
    ),

    audio: (
      <>
        <path
          d="M9 18V5l10-2v13"
        />

        <circle
          cx="6"
          cy="18"
          r="3"
        />

        <circle
          cx="16"
          cy="16"
          r="3"
        />
      </>
    ),

    file: (
      <>
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"
        />

        <path
          d="M14 2v6h6"
        />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[
        category
      ] || paths.file}
    </svg>
  );
};

const RemoveIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const RetryIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path
      d="M3 12a9 9 0 0 1 15.36-6.36L21 8"
    />

    <path
      d="M21 3v5h-5"
    />

    <path
      d="M21 12a9 9 0 0 1-15.36 6.36L3 16"
    />

    <path
      d="M3 21v-5h5"
    />
  </svg>
);

const SpinnerIcon = () => (
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

/**
 * ============================================================================
 * AttachmentPreview
 * ============================================================================
 */

const AttachmentPreview = ({
  attachment,

  onRemove,
  onRetry,

  disabled = false,
  readOnly = false,

  loading = false,

  error = null,

  className = '',

  compact = false,

  showMetadata = true,
  showRemove = true,

  ariaLabel,

  testId = 'titech-attachment-preview',
}) => {
  const [
    imageError,
    setImageError,
  ] = useState(false);

  const [
    objectUrl,
    setObjectUrl,
  ] = useState('');

  /**
   * --------------------------------------------------------------------------
   * Defensive input validation
   * --------------------------------------------------------------------------
   */

  const isValidAttachment =
    attachment &&
    typeof attachment ===
      'object' &&
    !Array.isArray(
      attachment,
    );

  const safeAttachment =
    isValidAttachment
      ? attachment
      : null;

  /**
   * --------------------------------------------------------------------------
   * Derived attachment properties
   * --------------------------------------------------------------------------
   */

  const filename =
    useMemo(
      () =>
        getAttachmentName(
          safeAttachment,
        ),
      [
        safeAttachment,
      ],
    );

  const category =
    useMemo(
      () =>
        getAttachmentCategory(
          safeAttachment,
        ),
      [
        safeAttachment,
      ],
    );

  const mimeType =
    normalizeMimeType(
      safeAttachment?.type ||
        safeAttachment?.mimeType,
    );

  const extension =
    getExtension(
      filename,
    );

  const fileSize =
    safeAttachment?.size ??
    safeAttachment?.fileSize;

  const externalPreviewUrl =
    useMemo(
      () =>
        resolvePreviewUrl(
          safeAttachment,
        ),
      [
        safeAttachment,
      ],
    );

  /**
   * --------------------------------------------------------------------------
   * Local File / Blob preview
   * --------------------------------------------------------------------------
   */

  useEffect(
    () => {
      let createdUrl = '';

      const localFile =
        safeAttachment?.file ||
        safeAttachment?.blob;

      if (
        !localFile ||
        typeof URL ===
          'undefined' ||
        typeof URL.createObjectURL !==
          'function'
      ) {
        setObjectUrl('');
        return undefined;
      }

      try {
        createdUrl =
          URL.createObjectURL(
            localFile,
          );

        setObjectUrl(
          createdUrl,
        );
      } catch {
        setObjectUrl('');
      }

      return () => {
        if (
          createdUrl &&
          typeof URL.revokeObjectURL ===
            'function'
        ) {
          try {
            URL.revokeObjectURL(
              createdUrl,
            );
          } catch {
            // URL cleanup is best-effort.
          }
        }
      };
    },
    [
      safeAttachment?.file,
      safeAttachment?.blob,
    ],
  );

  /**
   * Reset image failure state when source changes.
   */
  useEffect(
    () => {
      setImageError(false);
    },
    [
      externalPreviewUrl,
      objectUrl,
    ],
  );

  /**
   * --------------------------------------------------------------------------
   * State
   * --------------------------------------------------------------------------
   */

  const previewUrl =
    objectUrl ||
    externalPreviewUrl;

  const isImage =
    category ===
    'image';

  const showImage =
    isImage &&
    Boolean(
      previewUrl,
    ) &&
    !imageError;

  const status =
    toSafeString(
      safeAttachment?.status,
    ).toLowerCase();

  const isProcessing =
    Boolean(loading) ||
    status ===
      'uploading' ||
    status ===
      'processing' ||
    status ===
      'pending';

  const hasError =
    Boolean(error) ||
    status ===
      'error' ||
    status ===
      'failed';

  const canRemove =
    typeof onRemove ===
      'function' &&
    !disabled &&
    !readOnly &&
    !isProcessing;

  const canRetry =
    typeof onRetry ===
      'function' &&
    !disabled &&
    hasError;

  const rootClassName = [
    'titech-attachment-preview',
    compact
      ? 'titech-attachment-preview--compact'
      : '',
    isProcessing
      ? 'titech-attachment-preview--processing'
      : '',
    hasError
      ? 'titech-attachment-preview--error'
      : '',
    disabled
      ? 'titech-attachment-preview--disabled'
      : '',
    readOnly
      ? 'titech-attachment-preview--readonly'
      : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * --------------------------------------------------------------------------
   * Actions
   * --------------------------------------------------------------------------
   */

  const handleRemove = () => {
    if (
      !canRemove
    ) {
      return;
    }

    onRemove(
      safeAttachment,
    );
  };

  const handleRetry = () => {
    if (
      !canRetry
    ) {
      return;
    }

    onRetry(
      safeAttachment,
    );
  };

  /**
   * --------------------------------------------------------------------------
   * Accessibility
   * --------------------------------------------------------------------------
   */

  const handleRemoveKeyDown =
    (event) => {
      if (
        event.key ===
          'Enter' ||
        event.key ===
          ' '
      ) {
        event.preventDefault();

        handleRemove();
      }
    };

  /**
   * --------------------------------------------------------------------------
   * Invalid attachment
   * --------------------------------------------------------------------------
   */

  if (
    !safeAttachment
  ) {
    return null;
  }

  /**
   * --------------------------------------------------------------------------
   * Render
   * --------------------------------------------------------------------------
   */

  return (
    <article
      className={
        rootClassName
      }
      data-testid={
        testId
      }
      data-attachment-id={getAttachmentId(
        safeAttachment,
      )}
      data-attachment-category={
        category
      }
      data-attachment-status={
        isProcessing
          ? 'processing'
          : hasError
            ? 'error'
            : 'ready'
      }
      aria-label={
        ariaLabel ||
        `Attachment ${filename}`
      }
    >
      {/* ================================================================== */}
      {/* Media / icon                                                        */}
      {/* ================================================================== */}

      <div
        className="titech-attachment-preview__media"
        data-testid="titech-attachment-media"
      >
        {showImage ? (
          <img
            src={previewUrl}
            alt={`${filename} preview`}
            className="titech-attachment-preview__image"
            loading="lazy"
            decoding="async"
            draggable="false"
            onError={() =>
              setImageError(
                true,
              )
            }
          />
        ) : (
          <div
            className="titech-attachment-preview__icon"
            aria-hidden="true"
          >
            <FileIcon
              category={
                category
              }
            />

            {extension ? (
              <span className="titech-attachment-preview__extension">
                {extension}
              </span>
            ) : null}
          </div>
        )}

        {isProcessing ? (
          <div
            className="titech-attachment-preview__loading"
            role="status"
            aria-live="polite"
          >
            <SpinnerIcon />

            <span className="titech-sr-only">
              Processing attachment
            </span>
          </div>
        ) : null}
      </div>

      {/* ================================================================== */}
      {/* Metadata                                                            */}
      {/* ================================================================== */}

      <div
        className="titech-attachment-preview__details"
      >
        <div
          className="titech-attachment-preview__filename"
          title={filename}
          data-testid="titech-attachment-filename"
        >
          {filename}
        </div>

        {showMetadata ? (
          <div
            className="titech-attachment-preview__metadata"
            data-testid="titech-attachment-metadata"
          >
            {fileSize !==
            undefined ? (
              <span>
                {formatFileSize(
                  fileSize,
                )}
              </span>
            ) : null}

            {mimeType ? (
              <>
                {fileSize !==
                undefined ? (
                  <span
                    aria-hidden="true"
                  >
                    {' '}
                    ·{' '}
                  </span>
                ) : null}

                <span>
                  {mimeType}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {/* ================================================================ */}
        {/* Processing status                                                  */}
        {/* ================================================================ */}

        {isProcessing ? (
          <div
            className="titech-attachment-preview__status"
            role="status"
            aria-live="polite"
          >
            {status ===
            'uploading'
              ? 'Uploading…'
              : 'Processing…'}
          </div>
        ) : null}

        {/* ================================================================ */}
        {/* Error state                                                        */}
        {/* ================================================================ */}

        {hasError ? (
          <div
            className="titech-attachment-preview__error"
            role="alert"
            data-testid="titech-attachment-error"
          >
            {typeof error ===
            'string'
              ? error
              : 'Unable to process this attachment.'}
          </div>
        ) : null}

        {/* ================================================================ */}
        {/* Retry                                                              */}
        {/* ================================================================ */}

        {canRetry ? (
          <button
            type="button"
            className="titech-attachment-preview__retry"
            onClick={
              handleRetry
            }
            disabled={
              disabled
            }
            aria-label={`Retry upload of ${filename}`}
            data-testid="titech-attachment-retry"
          >
            <RetryIcon />

            <span>
              Retry
            </span>
          </button>
        ) : null}
      </div>

      {/* ================================================================== */}
      {/* Remove                                                               */}
      {/* ================================================================== */}

      {showRemove &&
      canRemove ? (
        <button
          type="button"
          className="titech-attachment-preview__remove"
          onClick={
            handleRemove
          }
          onKeyDown={
            handleRemoveKeyDown
          }
          disabled={
            disabled
          }
          aria-label={`Remove ${filename}`}
          title={`Remove ${filename}`}
          data-testid="titech-attachment-remove"
        >
          <RemoveIcon />
        </button>
      ) : null}
    </article>
  );
};

/**
 * ============================================================================
 * MultipleAttachmentPreview
 * ============================================================================
 *
 * Enterprise convenience wrapper for chat composer attachment collections.
 * ============================================================================
 */

export const MultipleAttachmentPreview = ({
  attachments = [],

  onRemove,
  onRetry,

  disabled = false,
  readOnly = false,

  loading = false,

  className = '',
  compact = false,

  showMetadata = true,
  showRemove = true,

  testId =
    'titech-attachments-preview',
}) => {
  const safeAttachments =
    Array.isArray(
      attachments,
    )
      ? attachments.filter(
          (
            item,
          ) =>
            item &&
            typeof item ===
              'object' &&
            !Array.isArray(
              item,
            ),
        )
      : [];

  if (
    safeAttachments.length ===
    0
  ) {
    return null;
  }

  return (
    <div
      className={[
        'titech-attachments-preview',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={
        testId
      }
      aria-label="TITech chat attachments"
    >
      {safeAttachments.map(
        (
          item,
          index,
        ) => (
          <AttachmentPreview
            key={getAttachmentId(
              item,
              index,
            )}
            attachment={
              item
            }
            onRemove={
              onRemove
            }
            onRetry={
              onRetry
            }
            disabled={
              disabled
            }
            readOnly={
              readOnly
            }
            loading={
              loading
            }
            compact={
              compact
            }
            showMetadata={
              showMetadata
            }
            showRemove={
              showRemove
            }
          />
        ),
      )}
    </div>
  );
};

/**
 * ============================================================================
 * Named utility exports
 * ============================================================================
 *
 * Useful for unit tests and other TITech UI components.
 * ============================================================================
 */

export {
  formatFileSize,
  getAttachmentCategory,
  getAttachmentId,
  getAttachmentName,
  getExtension,
  getSafePreviewUrl,
  isImageAttachment,
  normalizeMimeType,
  resolvePreviewUrl,
  sanitizeFilename,
};

/**
 * ============================================================================
 * Default export
 * ============================================================================
 */

export default AttachmentPreview;