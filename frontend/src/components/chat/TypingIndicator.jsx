'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Typing Indicator
 * ============================================================================
 *
 * File:
 *   frontend/src/components/chat/TypingIndicator.jsx
 *
 * Purpose:
 *   Reusable enterprise-grade typing/presence indicator for TITechChat and
 *   other TITech communication surfaces.
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Single-user typing state
 * ✓ Multiple-user typing state
 * ✓ Participant avatars
 * ✓ Participant names
 * ✓ Participant roles
 * ✓ TITech Assistant typing state
 * ✓ Custom labels
 * ✓ Animated typing dots
 * ✓ Reduced-motion-friendly static mode
 * ✓ Compact / inline / overlay modes
 * ✓ Small / medium / large sizes
 * ✓ Minimum display duration
 * ✓ Accessible live status
 * ✓ Screen-reader announcements
 * ✓ Custom content hooks
 * ✓ Defensive participant normalization
 * ✓ Ref API
 * ✓ Stable test selectors
 * ✓ TITech branding consistency
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Presentation only.
 *
 * This component MUST NOT:
 *   - determine authorization
 *   - enforce tenant isolation
 *   - modify conversation state
 *   - execute financial operations
 *   - infer authoritative presence
 *
 * Typing/presence truth must originate from TITech's real-time/application
 * service layer and be passed into this component.
 *
 * ============================================================================
 */

import React, {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';

import './typing-indicator.css';


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_LABEL =
  'Typing…';

const DEFAULT_ASSISTANT_LABEL =
  'TITech Assistant is typing…';

const DEFAULT_MAX_VISIBLE_NAMES =
  3;

const DEFAULT_DOT_COUNT =
  3;

const DEFAULT_MIN_DISPLAY_MS =
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
    return (
      String(value).trim() ||
      fallback
    );
  } catch {
    return fallback;
  }
};


const getParticipantId = (
  participant,
  index = 0,
) =>
  safeText(
    participant?.id ??
      participant?.userId ??
      participant?.memberId ??
      participant?.uuid,
    `participant-${index}`,
  );


const getParticipantName = (
  participant,
) =>
  safeText(
    participant?.name ||
      participant?.displayName ||
      participant?.fullName ||
      participant?.username ||
      participant?.memberName,
    'Someone',
  );


const getParticipantRole = (
  participant,
) =>
  safeText(
    participant?.role ||
      participant?.type ||
      'user',
    'user',
  ).toLowerCase();


const getAvatarUrl = (
  participant,
) =>
  safeText(
    participant?.avatarUrl ||
      participant?.imageUrl ||
      participant?.photoUrl,
  );


const getInitials = (
  name,
) => {
  const normalized =
    safeText(
      name,
      'TI',
    );

  const words =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (
    words.length ===
    0
  ) {
    return 'TI';
  }

  if (
    words.length ===
    1
  ) {
    return words[0]
      .slice(
        0,
        2,
      )
      .toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};


/**
 * Normalize participant objects and remove malformed entries.
 */
const normalizeParticipants = (
  participants,
) => {
  if (
    !Array.isArray(
      participants,
    )
  ) {
    return [];
  }

  return participants
    .filter(
      (
        participant,
      ) =>
        participant &&
        typeof participant ===
          'object' &&
        !Array.isArray(
          participant,
        ),
    )
    .map(
      (
        participant,
        index,
      ) => ({
        ...participant,

        __titechId:
          getParticipantId(
            participant,
            index,
          ),

        __titechName:
          getParticipantName(
            participant,
          ),

        __titechRole:
          getParticipantRole(
            participant,
          ),
      }),
    );
};


/**
 * Build natural-language typing text.
 */
const buildTypingLabel = ({
  participants = [],
  label,
  assistantLabel,
  maxVisibleNames =
    DEFAULT_MAX_VISIBLE_NAMES,
}) => {
  const explicitLabel =
    safeText(
      label,
    );

  if (
    explicitLabel
  ) {
    return explicitLabel;
  }

  const list =
    Array.isArray(
      participants,
    )
      ? participants
      : [];

  if (
    list.length ===
    0
  ) {
    return DEFAULT_LABEL;
  }

  const safeMax =
    Math.max(
      1,
      Number(
        maxVisibleNames,
      ) ||
        DEFAULT_MAX_VISIBLE_NAMES,
    );

  const visible =
    list.slice(
      0,
      safeMax,
    );

  const names =
    visible.map(
      (
        participant,
      ) =>
        participant.__titechName ||
        getParticipantName(
          participant,
        ),
    );

  const assistantTyping =
    visible.some(
      (
        participant,
      ) =>
        [
          'assistant',
          'ai',
          'agent',
          'bot',
        ].includes(
          participant.__titechRole ||
            getParticipantRole(
              participant,
            ),
        ),
    );

  if (
    list.length ===
    1
  ) {
    if (
      assistantTyping
    ) {
      return safeText(
        assistantLabel,
        DEFAULT_ASSISTANT_LABEL,
      );
    }

    return `${names[0]} is typing…`;
  }

  if (
    list.length ===
    2
  ) {
    return `${names[0]} and ${names[1]} are typing…`;
  }

  if (
    list.length >
    visible.length
  ) {
    const remaining =
      list.length -
      visible.length;

    return `${names.join(
      ', ',
    )} and ${remaining} others are typing…`;
  }

  return `${names.join(
    ', ',
  )} are typing…`;
};


/* ============================================================================
 * SVG primitives
 * ========================================================================== */

const IconBase = ({
  children,
  size = 18,
  className = '',
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);


const MessageIcon = ({
  size = 18,
}) => (
  <IconBase
    size={size}
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 4a8.38 8.38 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8Z" />
  </IconBase>
);


/* ============================================================================
 * Participant avatar
 * ========================================================================== */

const ParticipantAvatar = ({
  participant,
  size = 28,
}) => {
  const [
    imageFailed,
    setImageFailed,
  ] = useState(
    false,
  );

  const name =
    participant?.__titechName ||
    getParticipantName(
      participant,
    );

  const avatarUrl =
    participant?.avatarUrl ||
    participant?.imageUrl ||
    participant?.photoUrl ||
    getAvatarUrl(
      participant,
    );

  return (
    <span
      className="titech-typing-indicator__avatar"
      style={{
        width:
          size,
        height:
          size,
      }}
      aria-hidden="true"
    >
      {avatarUrl &&
      !imageFailed ? (
        <img
          src={
            avatarUrl
          }
          alt=""
          loading="lazy"
          decoding="async"
          onError={() =>
            setImageFailed(
              true,
            )
          }
        />
      ) : (
        <span>
          {
            getInitials(
              name,
            )
          }
        </span>
      )}
    </span>
  );
};


/* ============================================================================
 * Animated typing dots
 * ========================================================================== */

const TypingDots = ({
  count =
    DEFAULT_DOT_COUNT,
  animated =
    true,
  className = '',
}) => {
  const safeCount =
    Math.max(
      1,
      Math.min(
        8,
        Number(
          count,
        ) || DEFAULT_DOT_COUNT,
      ),
    );

  return (
    <span
      className={cn(
        'titech-typing-indicator__dots',
        animated &&
          'titech-typing-indicator__dots--animated',
        className,
      )}
      aria-hidden="true"
    >
      {Array.from({
        length:
          safeCount,
      }).map(
        (
          _,
          index,
        ) => (
          <span
            key={
              index
            }
            className="titech-typing-indicator__dot"
            style={{
              '--titech-typing-index':
                index,
            }}
          />
        ),
      )}
    </span>
  );
};


/* ============================================================================
 * TypingIndicator
 * ========================================================================== */

const TypingIndicator =
  forwardRef(
    function TypingIndicator(
      {
        typing =
          true,

        participants =
          [],

        participant,

        label,

        assistantLabel =
          DEFAULT_ASSISTANT_LABEL,

        maxVisibleNames =
          DEFAULT_MAX_VISIBLE_NAMES,

        showAvatar =
          true,

        showIcon =
          false,

        showLabel =
          true,

        showDots =
          true,

        dotCount =
          DEFAULT_DOT_COUNT,

        animated =
          true,

        compact =
          false,

        inline =
          false,

        overlay =
          false,

        size =
          'medium',

        role,
        statusRole =
          'status',

        announcement,

        ariaLabel,

        minDisplayMs =
          DEFAULT_MIN_DISPLAY_MS,

        className =
          '',

        contentClassName =
          '',

        labelClassName =
          '',

        dotsClassName =
          '',

        customContent,

        testId =
          'titech-typing-indicator',

        ...rest
      },
      forwardedRef,
    ) {
      const generatedId =
        useId();

      const rootRef =
        useRef(null);

      const hideTimerRef =
        useRef(null);

      const [
        visible,
        setVisible,
      ] = useState(
        Boolean(
          typing,
        ),
      );


      /* ======================================================================
       * Normalize participant input
       * ==================================================================== */

      const normalizedParticipants =
        useMemo(
          () => {
            if (
              participant &&
              typeof participant ===
                'object'
            ) {
              return normalizeParticipants(
                [
                  participant,
                ],
              );
            }

            return normalizeParticipants(
              participants,
            );
          },
          [
            participant,
            participants,
          ],
        );


      /* ======================================================================
       * Minimum display lifecycle
       * ==================================================================== */

      useEffect(
        () => {
          if (
            hideTimerRef.current
          ) {
            clearTimeout(
              hideTimerRef.current,
            );

            hideTimerRef.current =
              null;
          }

          if (
            typing
          ) {
            setVisible(
              true,
            );

            return undefined;
          }

          const minimumDisplay =
            Math.max(
              0,
              Number(
                minDisplayMs,
              ) ||
                0,
            );

          if (
            minimumDisplay ===
            0
          ) {
            setVisible(
              false,
            );

            return undefined;
          }

          hideTimerRef.current =
            setTimeout(
              () => {
                setVisible(
                  false,
                );

                hideTimerRef.current =
                  null;
              },
              minimumDisplay,
            );

          return undefined;
        },
        [
          minDisplayMs,
          typing,
        ],
      );


      useEffect(
        () => () => {
          if (
            hideTimerRef.current
          ) {
            clearTimeout(
              hideTimerRef.current,
            );
          }
        },
        [],
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

          getElement() {
            return rootRef.current;
          },

          isVisible() {
            return visible;
          },

          getParticipants() {
            return normalizedParticipants;
          },

          getLabel() {
            return buildTypingLabel({
              participants:
                normalizedParticipants,

              label,

              assistantLabel,

              maxVisibleNames,
            });
          },
        }),
        [
          assistantLabel,
          label,
          maxVisibleNames,
          normalizedParticipants,
          visible,
        ],
      );


      if (
        !visible
      ) {
        return null;
      }


      /* ======================================================================
       * Resolved display state
       * ==================================================================== */

      const resolvedLabel =
        buildTypingLabel({
          participants:
            normalizedParticipants,

          label,

          assistantLabel,

          maxVisibleNames,
        });

      const resolvedAnnouncement =
        safeText(
          announcement ||
            ariaLabel ||
            resolvedLabel,
          DEFAULT_LABEL,
        );

      const primaryParticipant =
        normalizedParticipants[0] ||
        null;

      const resolvedSize =
        [
          'small',
          'medium',
          'large',
        ].includes(
          size,
        )
          ? size
          : 'medium';

      const avatarSize =
        resolvedSize ===
        'large'
          ? 34
          : resolvedSize ===
              'small'
            ? 22
            : 28;

      const iconSize =
        resolvedSize ===
        'large'
          ? 20
          : resolvedSize ===
              'small'
            ? 15
            : 18;

      const resolvedRole =
        role ||
        statusRole ||
        'status';

      const rootClassName =
        cn(
          'titech-typing-indicator',

          `titech-typing-indicator--${resolvedSize}`,

          compact &&
            'titech-typing-indicator--compact',

          inline &&
            'titech-typing-indicator--inline',

          overlay &&
            'titech-typing-indicator--overlay',

          animated &&
            'titech-typing-indicator--animated',

          className,
        );


      /* ======================================================================
       * Render
       * ==================================================================== */

      return (
        <div
          {...rest}
          ref={
            rootRef
          }
          id={
            `titech-typing-indicator-${generatedId}`
          }
          className={
            rootClassName
          }
          role={
            resolvedRole
          }
          aria-live="polite"
          aria-label={
            resolvedAnnouncement
          }
          tabIndex={
            -1
          }
          data-testid={
            testId
          }
          data-typing={
            typing
              ? 'true'
              : 'false'
          }
          data-participant-count={
            normalizedParticipants.length
          }
        >

          {/* ================================================================
              Participant avatar
              ================================================================ */}

          {showAvatar &&
          primaryParticipant ? (
            <ParticipantAvatar
              participant={
                primaryParticipant
              }
              size={
                avatarSize
              }
            />
          ) : null}


          {/* ================================================================
              Optional message icon
              ================================================================ */}

          {showIcon ? (
            <span
              className="titech-typing-indicator__icon"
              aria-hidden="true"
            >
              <MessageIcon
                size={
                  iconSize
                }
              />
            </span>
          ) : null}


          {/* ================================================================
              Content
              ================================================================ */}

          <span
            className={cn(
              'titech-typing-indicator__content',
              contentClassName,
            )}
          >

            {customContent ? (
              <span className="titech-typing-indicator__custom-content">
                {
                  customContent
                }
              </span>
            ) : null}

            {showLabel ? (
              <span
                className={cn(
                  'titech-typing-indicator__label',
                  labelClassName,
                )}
              >
                {
                  resolvedLabel
                }
              </span>
            ) : null}


            {showDots ? (
              <span className="titech-typing-indicator__dots-wrapper">
                <TypingDots
                  count={
                    dotCount
                  }
                  animated={
                    animated
                  }
                  className={
                    dotsClassName
                  }
                />
              </span>
            ) : null}

          </span>

        </div>
      );
    },
  );


/* ============================================================================
 * Metadata
 * ========================================================================== */

TypingIndicator.displayName =
  'TITechTypingIndicator';


/* ============================================================================
 * PropTypes
 * ========================================================================== */

TypingIndicator.propTypes = {
  typing:
    PropTypes.bool,

  participants:
    PropTypes.arrayOf(
      PropTypes.shape({
        id:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        userId:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        memberId:
          PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.number,
          ]),

        uuid:
          PropTypes.string,

        name:
          PropTypes.string,

        displayName:
          PropTypes.string,

        fullName:
          PropTypes.string,

        username:
          PropTypes.string,

        memberName:
          PropTypes.string,

        role:
          PropTypes.string,

        type:
          PropTypes.string,

        avatarUrl:
          PropTypes.string,

        imageUrl:
          PropTypes.string,

        photoUrl:
          PropTypes.string,
      }),
    ),

  participant:
    PropTypes.shape({
      id:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      userId:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      memberId:
        PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.number,
        ]),

      uuid:
        PropTypes.string,

      name:
        PropTypes.string,

      displayName:
        PropTypes.string,

      fullName:
        PropTypes.string,

      username:
        PropTypes.string,

      memberName:
        PropTypes.string,

      role:
        PropTypes.string,

      type:
        PropTypes.string,

      avatarUrl:
        PropTypes.string,

      imageUrl:
        PropTypes.string,

      photoUrl:
        PropTypes.string,
    }),

  label:
    PropTypes.string,

  assistantLabel:
    PropTypes.string,

  maxVisibleNames:
    PropTypes.number,

  showAvatar:
    PropTypes.bool,

  showIcon:
    PropTypes.bool,

  showLabel:
    PropTypes.bool,

  showDots:
    PropTypes.bool,

  dotCount:
    PropTypes.number,

  animated:
    PropTypes.bool,

  compact:
    PropTypes.bool,

  inline:
    PropTypes.bool,

  overlay:
    PropTypes.bool,

  size:
    PropTypes.oneOf([
      'small',
      'medium',
      'large',
    ]),

  role:
    PropTypes.string,

  statusRole:
    PropTypes.string,

  announcement:
    PropTypes.string,

  ariaLabel:
    PropTypes.string,

  minDisplayMs:
    PropTypes.number,

  className:
    PropTypes.string,

  contentClassName:
    PropTypes.string,

  labelClassName:
    PropTypes.string,

  dotsClassName:
    PropTypes.string,

  customContent:
    PropTypes.node,

  testId:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

TypingIndicator.defaultProps = {
  typing:
    true,

  participants:
    [],

  participant:
    undefined,

  label:
    undefined,

  assistantLabel:
    DEFAULT_ASSISTANT_LABEL,

  maxVisibleNames:
    DEFAULT_MAX_VISIBLE_NAMES,

  showAvatar:
    true,

  showIcon:
    false,

  showLabel:
    true,

  showDots:
    true,

  dotCount:
    DEFAULT_DOT_COUNT,

  animated:
    true,

  compact:
    false,

  inline:
    false,

  overlay:
    false,

  size:
    'medium',

  role:
    undefined,

  statusRole:
    'status',

  announcement:
    undefined,

  ariaLabel:
    undefined,

  minDisplayMs:
    DEFAULT_MIN_DISPLAY_MS,

  className:
    '',

  contentClassName:
    '',

  labelClassName:
    '',

  dotsClassName:
    '',

  customContent:
    undefined,

  testId:
    'titech-typing-indicator',
};


/* ============================================================================
 * Named exports
 * ========================================================================== */

export {
  DEFAULT_ASSISTANT_LABEL,
  DEFAULT_DOT_COUNT,
  DEFAULT_LABEL,
  DEFAULT_MAX_VISIBLE_NAMES,
  DEFAULT_MIN_DISPLAY_MS,
  MessageIcon,
  ParticipantAvatar,
  TypingDots,
  buildTypingLabel,
  getAvatarUrl,
  getInitials,
  getParticipantId,
  getParticipantName,
  getParticipantRole,
  normalizeParticipants,
  safeText,
};


/* ============================================================================
 * Default export
 * ========================================================================== */

export default TypingIndicator;