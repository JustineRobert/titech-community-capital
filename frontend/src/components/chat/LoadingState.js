'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Loading State
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/LoadingState.js
 *
 * Purpose:
 *   Reusable, accessible and production-grade loading-state component for
 *   TITech Community Capital chat and communication interfaces.
 *
 * Supported scenarios
 * ----------------------------------------------------------------------------
 * ✓ Conversation loading
 * ✓ Message loading
 * ✓ Search loading
 * ✓ Attachment loading
 * ✓ Upload processing
 * ✓ AI response generation
 * ✓ Initial page loading
 * ✓ Refreshing
 * ✓ Retrying
 * ✓ Sending
 * ✓ Skeleton mode
 * ✓ Spinner mode
 * ✓ Inline loading mode
 * ✓ Full-height loading mode
 * ✓ Progress indication
 * ✓ Determinate progress
 * ✓ Indeterminate progress
 * ✓ Accessible live status
 * ✓ Ref API
 * ✓ Custom loader / illustration
 * ✓ Responsive presentation
 * ✓ Reduced-motion compatible
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * This component is presentation/orchestration only.
 *
 * It MUST NOT:
 *   - authorize users
 *   - perform tenant security decisions
 *   - execute financial transactions
 *   - approve loans
 *   - make fraud decisions
 *   - modify authoritative financial records
 *
 * Those responsibilities remain in TITech's trusted application/service
 * layers.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

import PropTypes from 'prop-types';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_LABEL =
  'Loading…';

const DEFAULT_VARIANT =
  'spinner';

const DEFAULT_SIZE =
  'medium';

const DEFAULT_PROGRESS =
  0;


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
    const result =
      String(value).trim();

    return result ||
      fallback;
  } catch {
    return fallback;
  }
};


const clampProgress = (
  value,
) => {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return DEFAULT_PROGRESS;
  }

  return Math.min(
    100,
    Math.max(
      0,
      numeric,
    ),
  );
};


/* ============================================================================
 * Icons / indicators
 * ========================================================================== */

const Spinner = ({
  size = 22,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
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


const UploadIcon = ({
  size = 34,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 20h14" />
  </svg>
);


const MessageIcon = ({
  size = 34,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 4a8.38 8.38 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8Z" />
  </svg>
);


/* ============================================================================
 * Skeleton primitives
 * ========================================================================== */

const SkeletonBlock = ({
  width = '100%',
  height = 14,
  radius = 6,
  className = '',
}) => (
  <span
    aria-hidden="true"
    className={cn(
      'titech-loading-state__skeleton',
      className,
    )}
    style={{
      width,
      height,
      borderRadius:
        radius,
    }}
  />
);


const MessageSkeleton = ({
  rows = 3,
}) => (
  <div
    className="titech-loading-state__message-skeleton"
    aria-hidden="true"
  >
    <div className="titech-loading-state__message-skeleton-avatar">
      <SkeletonBlock
        width={38}
        height={38}
        radius={999}
      />
    </div>

    <div className="titech-loading-state__message-skeleton-content">
      <SkeletonBlock
        width="32%"
        height={10}
      />

      <SkeletonBlock
        width="94%"
        height={12}
      />

      {Array.from({
        length: Math.max(
          1,
          rows - 2,
        ),
      }).map(
        (
          _,
          index,
        ) => (
          <SkeletonBlock
            key={index}
            width={
              index ===
              rows - 3
                ? '62%'
                : '82%'
            }
            height={12}
          />
        ),
      )}
    </div>
  </div>
);


const ConversationSkeleton = ({
  rows = 5,
}) => (
  <div
    className="titech-loading-state__conversation-skeleton"
    aria-hidden="true"
  >
    {Array.from({
      length: Math.max(
        1,
        rows,
      ),
    }).map(
      (
        _,
        index,
      ) => (
        <div
          className="titech-loading-state__conversation-row"
          key={index}
        >
          <SkeletonBlock
            width={42}
            height={42}
            radius={999}
          />

          <div className="titech-loading-state__conversation-content">
            <SkeletonBlock
              width="48%"
              height={11}
            />

            <SkeletonBlock
              width={
                index % 2 ===
                0
                  ? '76%'
                  : '62%'
              }
              height={10}
            />
          </div>

          <SkeletonBlock
            width={40}
            height={9}
          />
        </div>
      ),
    )}
  </div>
);


/* ============================================================================
 * LoadingState
 * ========================================================================== */

const LoadingState =
  forwardRef(
    function LoadingState(
      {
        variant =
          DEFAULT_VARIANT,

        label =
          DEFAULT_LABEL,

        description,

        size =
          DEFAULT_SIZE,

        centered =
          true,

        fullHeight =
          false,

        inline =
          false,

        overlay =
          false,

        transparent =
          false,

        showLabel =
          true,

        showDescription =
          false,

        showBrand =
          false,

        brandName =
          'TITech Community Capital',

        progress,

        progressLabel,

        progressIndeterminate =
          false,

        rows =
          3,

        skeletonRows,

        icon,

        loader,

        content,

        className =
          '',

        contentClassName =
          '',

        labelClassName =
          '',

        descriptionClassName =
          '',

        ariaLabel,

        live =
          true,

        testId =
          'titech-loading-state',

        ...rest
      },
      forwardedRef,
    ) {
      const rootRef =
        useRef(null);

      const normalizedVariant =
        safeText(
          variant,
          DEFAULT_VARIANT,
        ).toLowerCase();

      const normalizedSize =
        ['small', 'medium', 'large'].includes(
          size,
        )
          ? size
          : DEFAULT_SIZE;

      const hasDeterminateProgress =
        progress !==
          undefined &&
        progress !==
          null &&
        !progressIndeterminate;

      const normalizedProgress =
        clampProgress(
          progress,
        );

      const resolvedProgressLabel =
        safeText(
          progressLabel ||
            (
              hasDeterminateProgress
                ? `${normalizedProgress}% complete`
                : label
            ),
          label,
        );

      const resolvedDescription =
        safeText(
          description,
        );

      const computedRole =
        hasDeterminateProgress
          ? 'progressbar'
          : 'status';

      const rootClassName = [
        'titech-loading-state',

        `titech-loading-state--${normalizedVariant}`,

        `titech-loading-state--${normalizedSize}`,

        centered
          ? 'titech-loading-state--centered'
          : '',

        fullHeight
          ? 'titech-loading-state--full-height'
          : '',

        inline
          ? 'titech-loading-state--inline'
          : '',

        overlay
          ? 'titech-loading-state--overlay'
          : '',

        transparent
          ? 'titech-loading-state--transparent'
          : '',

        className,
      ]
        .filter(Boolean)
        .join(' ');

      /**
       * Public ref API.
       */
      useImperativeHandle(
        forwardedRef,
        () => ({
          focus() {
            rootRef.current?.focus();
          },

          getElement() {
            return rootRef.current;
          },
        }),
        [],
      );

      /**
       * Resolve standard visual loader.
       */
      const resolvedLoader =
        useMemo(
          () => {
            if (
              loader
            ) {
              return loader;
            }

            if (
              icon
            ) {
              return icon;
            }

            switch (
              normalizedVariant
            ) {
              case 'upload':
                return (
                  <UploadIcon
                    size={
                      normalizedSize ===
                      'large'
                        ? 40
                        : normalizedSize ===
                            'small'
                          ? 22
                          : 30
                    }
                  />
                );

              case 'message':
              case 'response':
              case 'chat':
                return (
                  <MessageIcon
                    size={
                      normalizedSize ===
                      'large'
                        ? 40
                        : normalizedSize ===
                            'small'
                          ? 22
                          : 30
                    }
                  />
                );

              case 'spinner':
              case 'default':
              default:
                return (
                  <Spinner
                    size={
                      normalizedSize ===
                      'large'
                        ? 30
                        : normalizedSize ===
                            'small'
                          ? 18
                          : 24
                    }
                  />
                );
            }
          },
          [
            icon,
            loader,
            normalizedSize,
            normalizedVariant,
          ],
        );

      /**
       * Render skeleton modes.
       */
      const renderSkeleton =
        () => {
          if (
            normalizedVariant ===
            'message-skeleton'
          ) {
            return (
              <MessageSkeleton
                rows={
                  skeletonRows ||
                  rows
                }
              />
            );
          }

          if (
            normalizedVariant ===
              'conversation-skeleton' ||
            normalizedVariant ===
              'list-skeleton'
          ) {
            return (
              <ConversationSkeleton
                rows={
                  skeletonRows ||
                  rows
                }
              />
            );
          }

          return null;
        };

      const skeleton =
        renderSkeleton();

      return (
        <div
          {...rest}
          ref={
            rootRef
          }
          className={
            rootClassName
          }
          role={
            skeleton
              ? 'status'
              : computedRole
          }
          aria-live={
            live
              ? 'polite'
              : undefined
          }
          aria-label={
            ariaLabel ||
            resolvedProgressLabel
          }
          aria-busy="true"
          aria-valuemin={
            hasDeterminateProgress
              ? 0
              : undefined
          }
          aria-valuemax={
            hasDeterminateProgress
              ? 100
              : undefined
          }
          aria-valuenow={
            hasDeterminateProgress
              ? normalizedProgress
              : undefined
          }
          data-testid={
            testId
          }
          data-loading-variant={
            normalizedVariant
          }
        >
          <div
            className={cn(
              'titech-loading-state__content',
              contentClassName,
            )}
          >

            {showBrand ? (
              <div
                className="titech-loading-state__brand"
                aria-hidden="true"
              >
                {
                  brandName
                }
              </div>
            ) : null}


            {content ? (
              <div className="titech-loading-state__custom-content">
                {content}
              </div>
            ) : skeleton ? (
              skeleton
            ) : (
              <div
                className="titech-loading-state__indicator"
                aria-hidden={
                  !showLabel &&
                  !showDescription
                }
              >
                {resolvedLoader}
              </div>
            )}


            {showLabel &&
            !skeleton ? (
              <div
                className={cn(
                  'titech-loading-state__label',
                  labelClassName,
                )}
              >
                {
                  hasDeterminateProgress
                    ? resolvedProgressLabel
                    : label
                }
              </div>
            ) : null}


            {showDescription &&
            resolvedDescription &&
            !skeleton ? (
              <div
                className={cn(
                  'titech-loading-state__description',
                  descriptionClassName,
                )}
              >
                {
                  resolvedDescription
                }
              </div>
            ) : null}


            {hasDeterminateProgress ? (
              <div
                className="titech-loading-state__progress-wrapper"
                data-testid="titech-loading-progress"
              >
                <div
                  className="titech-loading-state__progress-track"
                  aria-hidden="true"
                >
                  <div
                    className="titech-loading-state__progress-bar"
                    style={{
                      width: `${normalizedProgress}%`,
                    }}
                  />
                </div>

                <span className="titech-loading-state__progress-value">
                  {
                    normalizedProgress
                  }%
                </span>
              </div>
            ) : null}

          </div>
        </div>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

LoadingState.displayName =
  'TITechLoadingState';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

LoadingState.propTypes = {
  variant:
    PropTypes.oneOf([
      'spinner',
      'default',
      'upload',
      'message',
      'response',
      'chat',
      'message-skeleton',
      'conversation-skeleton',
      'list-skeleton',
      'custom',
    ]),

  label:
    PropTypes.string,

  description:
    PropTypes.string,

  size:
    PropTypes.oneOf([
      'small',
      'medium',
      'large',
    ]),

  centered:
    PropTypes.bool,

  fullHeight:
    PropTypes.bool,

  inline:
    PropTypes.bool,

  overlay:
    PropTypes.bool,

  transparent:
    PropTypes.bool,

  showLabel:
    PropTypes.bool,

  showDescription:
    PropTypes.bool,

  showBrand:
    PropTypes.bool,

  brandName:
    PropTypes.string,

  progress:
    PropTypes.number,

  progressLabel:
    PropTypes.string,

  progressIndeterminate:
    PropTypes.bool,

  rows:
    PropTypes.number,

  skeletonRows:
    PropTypes.number,

  icon:
    PropTypes.node,

  loader:
    PropTypes.node,

  content:
    PropTypes.node,

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  labelClassName:
    PropTypes.string,

  descriptionClassName:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  live:
    PropTypes.bool,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

LoadingState.defaultProps = {
  variant:
    DEFAULT_VARIANT,

  label:
    DEFAULT_LABEL,

  description:
    undefined,

  size:
    DEFAULT_SIZE,

  centered:
    true,

  fullHeight:
    false,

  inline:
    false,

  overlay:
    false,

  transparent:
    false,

  showLabel:
    true,

  showDescription:
    false,

  showBrand:
    false,

  brandName:
    'TITech Community Capital',

  progress:
    undefined,

  progressLabel:
    undefined,

  progressIndeterminate:
    false,

  rows:
    3,

  skeletonRows:
    undefined,

  icon:
    undefined,

  loader:
    undefined,

  content:
    undefined,

  className:
    '',

  contentClassName:
    '',

  labelClassName:
    '',

  descriptionClassName:
    '',

  ariaLabel:
    undefined,

  live:
    true,

  testId:
    'titech-loading-state',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  ConversationSkeleton,
  MessageSkeleton,
  SkeletonBlock,
  Spinner,
  UploadIcon,
  MessageIcon,
  clampProgress,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default LoadingState;