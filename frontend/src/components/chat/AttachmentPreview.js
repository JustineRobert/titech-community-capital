/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Attachment Preview
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/AttachmentPreview.js
 *
 * Purpose:
 *   Secure, accessible and reusable attachment preview component for the
 *   TITech Community Capital chat experience.
 *
 * Responsibilities
 * ----------------
 * ✓ Render image previews
 * ✓ Render generic file previews
 * ✓ Display filename and metadata
 * ✓ Support attachment removal
 * ✓ Support disabled/read-only states
 * ✓ Support upload/processing states
 * ✓ Support upload errors
 * ✓ Handle malformed attachment objects defensively
 * ✓ Prevent unsafe URL protocols
 * ✓ Avoid rendering executable HTML
 * ✓ Avoid exposing sensitive internal metadata
 * ✓ Support keyboard accessibility
 * ✓ Support screen readers
 * ✓ Provide predictable test selectors
 * ✓ Work with File, Blob and normalized attachment objects
 * ✓ Support multiple attachment rendering
 * ✓ TITech branding consistency
 *
 * Security
 * --------
 * This component is presentation-only.
 *
 * It MUST NOT:
 *   - Trust client-side file extensions
 *   - Authorize uploads
 *   - Execute uploaded content
 *   - Treat MIME type as authoritative security validation
 *   - Expose access tokens, signed URLs or internal storage metadata
 *
 * Server-side validation MUST independently enforce:
 *   - MIME/type validation
 *   - File-size limits
 *   - Malware scanning
 *   - Content inspection
 *   - Authorization
 *   - Tenant isolation
 *   - Object-storage permissions
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

const MAX_DISPLAY_NAME_LENGTH = 120;

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
]);

const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/rtf',
  'text/plain',
  'text/csv',
]);

/**
 * ============================================================================
 * Utility functions
 * ============================================================================
 */

/**
 * Safely convert an unknown value into a string.
 */
function safeString(
  value,
) {
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
}

/**
 * Remove potentially dangerous control characters from filenames.
 */
function sanitizeFilename(
  filename,
) {
  const value =
    safeString(filename)
      .replace(
        /[\u0000-\u001F\u007F]/g,
        '',
      )
      .trim();

  if (!value) {
    return 'Attachment';
  }

  return value.slice(
    0,
    MAX_DISPLAY_NAME_LENGTH,
  );
}

/**
 * Extract the extension from a filename.
 */
function getExtension(
  filename,
) {
  const name =
    sanitizeFilename(
      filename,
    );

  const lastDot =
    name.lastIndexOf('.');

  if (
    lastDot <= 0 ||
    lastDot === name.length - 1
  ) {
    return '';
  }

  return name
    .slice(lastDot + 1)
    .toUpperCase()
    .slice(0, 10);
}

/**
 * Safely normalize MIME type.
 */
function normalizeMimeType(
  type,
) {
  return safeString(
    type,
  )
    .trim()
    .toLowerCase();
}

/**
 * Determine whether an attachment is an image.
 */
function isImageAttachment(
  attachment,
) {
  const type =
    normalizeMimeType(
      attachment?.type ||
        attachment?.mimeType,
    );

  if (
    IMAGE_TYPES.has(type)
  ) {
    return true;
  }

  const name =
    safeString(
      attachment?.name ||
        attachment?.filename,
    ).toLowerCase();

  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(
    name,
  );
}

/**
 * Determine attachment category.
 */
function getAttachmentCategory(
  attachment,
) {
  const type =
    normalizeMimeType(
      attachment?.type ||
        attachment?.mimeType,
    );

  if (
    IMAGE_TYPES.has(type) ||
    isImageAttachment(attachment)
  ) {
    return 'image';
  }

  if (
    VIDEO_TYPES.has(type)
  ) {
    return 'video';
  }

  if (
    AUDIO_TYPES.has(type)
  ) {
    return 'audio';
  }

  if (
    DOCUMENT_TYPES.has(type) ||
    type.includes('pdf') ||
    type.includes('word') ||
    type.includes('spreadsheet') ||
    type.includes('excel') ||
    type.includes('presentation')
  ) {
    return 'document';
  }

  return 'file';
}

/**
 * Format byte values for human-readable display.
 */
function formatFileSize(
  bytes,
) {
  const numericBytes =
    Number(bytes);

  if (
    !Number.isFinite(
      numericBytes,
    ) ||
    numericBytes < 0
  ) {
    return '';
  }

  if (
    numericBytes === 0
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
        numericBytes,
      ) /
        Math.log(1024),
    ),
    units.length - 1,
  );

  const value =
    numericBytes /
    Math.pow(
      1024,
      exponent,
    );

  return `${value.toFixed(
    exponent === 0
      ? 0
      : value >= 10
        ? 1
        : 2,
  )} ${units[exponent]}`;
}

/**
 * Validate a preview URL.
 *
 * Only http(s), blob and data:image URLs are allowed for preview purposes.
 *
 * NOTE:
 * `data:` URLs are restricted to image media because arbitrary data URLs
 * should never be rendered by this component.
 */
function getSafePreviewUrl(
  value,
) {
  const raw =
    safeString(value).trim();

  if (!raw) {
    return '';
  }

  try {
    const url =
      new URL(
        raw,
        window.location.origin,
      );

    const protocol =
      url.protocol.toLowerCase();

    if (
      protocol === 'https:' ||
      protocol === 'http:' ||
      protocol === 'blob:'
    ) {
      return url.href;
    }

    if (
      protocol === 'data:' &&
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
}

/**
 * Resolve a possible preview source.
 */
function resolvePreviewSource(
  attachment,
) {
  if (!attachment) {
    return '';
  }

  const possibleSources = [
    attachment.previewUrl,
    attachment.preview,
    attachment.url,
    attachment.src,
  ];

  for (
    const source of possibleSources
  ) {
    const safe =
      getSafePreviewUrl(
        source,
      );

    if (safe) {
      return safe;
    }
  }

  return '';
}

/**
 * Determine an attachment display name.
 */
function getAttachmentName(
  attachment,
) {
  return sanitizeFilename(
    attachment?.name ||
      attachment?.filename ||
      attachment?.originalName ||
      'Attachment',
  );
}

/**
 * Generate a stable-ish attachment identifier.
 */
function getAttachmentId(
  attachment,
  index,
) {
  const suppliedId =
    safeString(
      attachment?.id ||
        attachment?.attachmentId ||
        attachment?.uuid,
    ).trim();

  if (suppliedId) {
    return suppliedId;
  }

  const name =
    getAttachmentName(
      attachment,
    );

  return `attachment-${index}-${name}`;
}

/**
 * ============================================================================
 * Icons
 * ============================================================================
 *
 * Inline SVG icons keep this component independent of an icon library.
 * ============================================================================
 */

function FileIcon({
  category = 'file',
}) {
  const iconPaths = {
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
      {
        iconPaths[
          category
        ] ||
        iconPaths.file
      }
    </svg>
  );
}

function RemoveIcon() {
  return (
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
}

function SpinnerIcon() {
  return (
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
}

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
}) => {
  const [
    imageError,
    setImageError,
  ] = useState(false);

  /**
   * Object URL generated from a File/Blob.
   */
  const [
    objectUrl,
    setObjectUrl,
  ] = useState('');

  const normalizedAttachment =
    attachment || {};

  const name =
    useMemo(
      () =>
        getAttachmentName(
          normalizedAttachment,
        ),
      [
        normalizedAttachment,
      ],
    );

  const category =
    useMemo(
      () =>
        getAttachmentCategory(
          normalizedAttachment,
        ),
      [
        normalizedAttachment,
      ],
    );

  const mimeType =
    normalizeMimeType(
      normalizedAttachment.type ||
        normalizedAttachment.mimeType,
    );

  const extension =
    getExtension(
      name,
    );

  const fileSize =
    normalizedAttachment.size ??
    normalizedAttachment.fileSize;

  /**
   * Resolve an existing preview URL.
   */
  const externalPreviewUrl =
    useMemo(
      () =>
        resolvePreviewSource(
          normalizedAttachment,
        ),
      [
        normalizedAttachment,
      ],
    );

  /**
   * Generate a temporary local URL when a File/Blob is supplied.
   */
  useEffect(
    () => {
      let active = true;
      let generatedUrl = '';

      const file =
        normalizedAttachment.file ||
        normalizedAttachment.blob;

      if (
        file &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL ===
          'function'
      ) {
        try {
          generatedUrl =
            URL.createObjectURL(
              file,
            );

          if (active) {
            setObjectUrl(
              generatedUrl,
            );
          }
        } catch {
          if (active) {
            setObjectUrl('');
          }
        }
      } else {
        setObjectUrl('');
      }

      return () => {
        active = false;

        if (
          generatedUrl &&
          typeof URL !== 'undefined' &&
          typeof URL.revokeObjectURL ===
            'function'
        ) {
          try {
            URL.revokeObjectURL(
              generatedUrl,
            );
          } catch {
            // Ignore URL cleanup failures.
          }
        }
      };
    },
    [
      normalizedAttachment.file,
      normalizedAttachment.blob,
    ],
  );

  /**
   * Reset image-error state whenever the source changes.
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

  const previewUrl =
    objectUrl ||
    externalPreviewUrl;

  const isImage =
    category === 'image';

  const hasImagePreview =
    isImage &&
    Boolean(previewUrl) &&
    !imageError;

  const hasError =
    Boolean(error) ||
    normalizedAttachment.status ===
      'error';

  const isProcessing =
    Boolean(loading) ||
    normalizedAttachment.status ===
      'uploading' ||
    normalizedAttachment.status ===
      'processing' ||
    normalizedAttachment.status ===
      'pending';

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
    hasError
      ? 'titech-attachment-preview--error'
      : '',
    isProcessing
      ? 'titech-attachment-preview--processing'
      : '',
    disabled
      ? 'titech-attachment-preview--disabled'
      : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleRemove =
    () => {
      if (
        !canRemove
      ) {
        return;
      }

      onRemove(
        normalizedAttachment,
      );
    };

  const handleRetry =
    () => {
      if (
        !canRetry
      ) {
        return;
      }

      onRetry(
        normalizedAttachment,
      );
    };

  const handleKeyDown =
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
   * Defensive handling for malformed attachment input.
   */
  if (
    !attachment ||
    typeof attachment !==
      'object'
  ) {
    return null;
  }

  return (
    <article
      className={
        rootClassName
      }
      data-testid="titech-attachment-preview"
      data-attachment-id={getAttachmentId(
        normalizedAttachment,
        0,
      )}
      data-category={
        category
      }
      data-status={
        isProcessing
          ? 'processing'
          : hasError
            ? 'error'
            : 'ready'
      }
      aria-label={
        ariaLabel ||
        `Attachment: ${name}`
      }
    >
      {/* ================================================================== */}
      {/* Preview area                                                        */}
      {/* ================================================================== */}

      <div
        className="titech-attachment-preview__media"
        data-testid="titech-attachment-media"
      >
        {hasImagePreview ? (
          <img
            src={previewUrl}
            alt={`${name} preview`}
            className="titech-attachment-preview__image"
            loading="lazy"
            decoding="async"
            onError={() =>
              setImageError(
                true,
              )
            }
          />
        ) : (
          <div
            className="titech-attachment-preview__file-icon"
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
            className="titech-attachment-preview__processing"
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
      {/* Attachment information                                              */}
      {/* ================================================================== */}

      <div
        className="titech-attachment-preview__content"
      >
        <div
          className="titech-attachment-preview__name"
          title={name}
          data-testid="titech-attachment-name"
        >
          {name}
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

        {isProcessing ? (
          <div
            className="titech-attachment-preview__status"
            aria-live="polite"
          >
            {normalizedAttachment.status ===
            'uploading'
              ? 'Uploading…'
              : 'Processing…'}
          </div>
        ) : null}

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
            aria-label={`Retry ${name}`}
            data-testid="titech-attachment-retry"
          >
            Retry
          </button>
        ) : null}
      </div>

      {/* ================================================================== */}
      {/* Remove action                                                       */}
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
            handleKeyDown
          }
          disabled={
            disabled
          }
          aria-label={`Remove ${name}`}
          title={`Remove ${name}`}
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
 * Convenience component for rendering an attachment collection.
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
}) => {
  const safeAttachments =
    Array.isArray(
      attachments,
    )
      ? attachments
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
      data-testid="titech-attachments-preview"
      aria-label="TITech attachments"
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
 * Static helper exports
 * ============================================================================
 *
 * These exports are useful for unit tests and other chat components without
 * exposing internal implementation details of the visual component.
 * ============================================================================
 */

export {
  formatFileSize,
  getAttachmentCategory,
  getAttachmentName,
  getExtension,
  getSafePreviewUrl,
  isImageAttachment,
  sanitizeFilename,
};

/**
 * ============================================================================
 * Default export
 * ============================================================================
 */

export default AttachmentPreview;