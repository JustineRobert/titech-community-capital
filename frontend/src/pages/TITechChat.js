'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat Page
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat.js
 *
 * Purpose:
 *   Production-grade TITech enterprise messaging workspace.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * ✓ Redux-backed conversation state
 * ✓ Lazy-loaded conversation modules
 * ✓ Responsive master/detail layout
 * ✓ Mobile conversation navigation
 * ✓ Keyboard navigation
 * ✓ Accessible tab/list semantics
 * ✓ Conversation refresh/retry
 * ✓ Defensive selector handling
 * ✓ Suspense loading boundaries
 * ✓ Error isolation
 * ✓ Stable test selectors
 * ✓ Tenant-aware page context
 * ✓ TITech branding consistency
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This page is a presentation/orchestration layer.
 *
 * Authoritative:
 *   - authentication
 *   - authorization
 *   - tenant isolation
 *   - message persistence
 *   - financial/business rules
 *
 * MUST remain enforced by TITech's trusted service/API layers.
 *
 * ============================================================================
 */

import React, {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useDispatch,
  useSelector,
} from 'react-redux';

import PropTypes from 'prop-types';

import {
  AlertCircle,
  Inbox,
  RefreshCw,
  Search,
  ChevronLeft,
  Menu,
  X,
} from 'lucide-react';

import Spinner from '../components/ui/Spinner';

import {
  fetchConversations,
  setActiveConversation,
  selectActiveConversationId,
  selectConversationsLoading,
  selectConversationsSummary,
} from '../store/chat';

import logger from '../utils/logger';

import './TITechChat.css';


/* ============================================================================
 * Lazy-loaded modules
 * ========================================================================== */

const ConversationList = lazy(
  () =>
    import(
      '../components/chat/ConversationList'
    ),
);

const ConversationDetail = lazy(
  () =>
    import(
      '../components/chat/ConversationDetail'
    ),
);


/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_TITLE =
  'TITechChat';

const DEFAULT_CONVERSATIONS_LABEL =
  'Conversations';

const MOBILE_BREAKPOINT =
  768;

const FALLBACK_TEST_ID =
  'titech-chat';


/* ============================================================================
 * Utility helpers
 * ========================================================================== */

const cn = (
  ...classes
) =>
  classes
    .filter(Boolean)
    .join(' ');


const normalizeId = (
  value,
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  try {
    return String(
      value,
    );
  } catch {
    return '';
  }
};


const getConversationId = (
  conversation,
) =>
  normalizeId(
    conversation?.id ??
      conversation?.conversationId ??
      conversation?._id ??
      conversation?.uuid,
  );


const safeArray = (
  value,
) =>
  Array.isArray(
    value,
  )
    ? value
    : [];


const isBrowser =
  typeof window !==
    'undefined';


/* ============================================================================
 * Loading boundary
 * ========================================================================== */

function ChatLoadingFallback({
  label =
    'Loading TITechChat…',
}) {
  return (
    <div
      className="titech-chat__loading"
      role="status"
      aria-live="polite"
      aria-label={
        label
      }
    >
      <Spinner
        label={
          label
        }
      />

      <span className="titech-chat__loading-text">
        {
          label
        }
      </span>
    </div>
  );
}


/* ============================================================================
 * Error boundary
 * ========================================================================== */

class ChatSectionErrorBoundary extends React.Component {
  constructor(
    props,
  ) {
    super(
      props,
    );

    this.state = {
      hasError:
        false,

      error:
        null,
    };
  }

  static getDerivedStateFromError(
    error,
  ) {
    return {
      hasError:
        true,

      error,
    };
  }

  componentDidCatch(
    error,
    errorInfo,
  ) {
    logger?.error?.(
      'TITechChat section render failure',
      {
        error:
          error?.message,

        componentStack:
          errorInfo?.componentStack,
      },
    );

    this.props.onError?.(
      error,
      errorInfo,
    );
  }

  handleRetry = () => {
    this.setState({
      hasError:
        false,

      error:
        null,
    });

    this.props.onRetry?.();
  };

  render() {
    if (
      !this.state.hasError
    ) {
      return this.props.children;
    }

    return (
      <div
        className="titech-chat__section-error"
        role="alert"
        aria-live="assertive"
      >
        <AlertCircle
          size={30}
          aria-hidden="true"
        />

        <h3>
          TITechChat could not load this section
        </h3>

        <p>
          The messaging interface encountered an unexpected UI error.
        </p>

        {process.env?.NODE_ENV ===
        'development' &&
        this.state.error?.message ? (
          <details>
            <summary>
              Development details
            </summary>

            <code>
              {
                this.state
                  .error
                  .message
              }
            </code>
          </details>
        ) : null}

        <button
          type="button"
          className="titech-chat__button titech-chat__button--primary"
          onClick={
            this.handleRetry
          }
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
          />
          Retry
        </button>
      </div>
    );
  }
}

ChatSectionErrorBoundary.propTypes = {
  children:
    PropTypes.node
      .isRequired,

  onError:
    PropTypes.func,

  onRetry:
    PropTypes.func,
};


/* ============================================================================
 * Empty conversation state
 * ========================================================================== */

function EmptyConversationState({
  title =
    'No conversation selected',

  description =
    'Select a conversation from the list to begin.',

  onShowList,
  mobile,
}) {
  return (
    <div
      className="titech-chat__empty"
      role="status"
      aria-live="polite"
      data-testid="titech-chat-empty"
    >
      <div
        className="titech-chat__empty-icon"
        aria-hidden="true"
      >
        <Inbox
          size={34}
        />
      </div>

      <h2>
        {
          title
        }
      </h2>

      <p>
        {
          description
        }
      </p>

      {mobile &&
      typeof onShowList ===
        'function' ? (
        <button
          type="button"
          className="titech-chat__button titech-chat__button--primary"
          onClick={
            onShowList
          }
        >
          <Menu
            size={17}
            aria-hidden="true"
          />
          Browse conversations
        </button>
      ) : null}
    </div>
  );
}


/* ============================================================================
 * TITechChat
 * ========================================================================== */

function TITechChat({
  initialConversationId =
    null,

  title =
    DEFAULT_TITLE,

  testId =
    FALLBACK_TEST_ID,

  className =
    '',
}) {
  const dispatch =
    useDispatch();

  const activeConversationId =
    useSelector(
      selectActiveConversationId,
    );

  const loading =
    useSelector(
      selectConversationsLoading,
    );

  const conversationsSummary =
    useSelector(
      selectConversationsSummary,
    );


  /* ==========================================================================
   * State
   * ======================================================================== */

  const [
    listVisibleOnMobile,
    setListVisibleOnMobile,
  ] = useState(
    true,
  );

  const [
    isMobile,
    setIsMobile,
  ] = useState(
    () =>
      isBrowser
        ? window.innerWidth <
          MOBILE_BREAKPOINT
        : false,
  );

  const [
    refreshError,
    setRefreshError,
  ] = useState(
    '',
  );

  const [
    refreshing,
    setRefreshing,
  ] = useState(
    false,
  );


  /* ==========================================================================
   * Refs
   * ======================================================================== */

  const pageRef =
    useRef(null);

  const listRef =
    useRef(null);

  const detailRef =
    useRef(null);

  const lastInitialConversationRef =
    useRef(null);


  /* ==========================================================================
   * Normalize conversations
   * ======================================================================== */

  const conversations =
    useMemo(
      () =>
        safeArray(
          conversationsSummary,
        ).filter(
          conversation =>
            Boolean(
              getConversationId(
                conversation,
              ),
            ),
        ),
      [
        conversationsSummary,
      ],
    );


  const conversationIds =
    useMemo(
      () =>
        conversations.map(
          conversation =>
            getConversationId(
              conversation,
            ),
        ),
      [
        conversations,
      ],
    );


  /* ==========================================================================
   * Active conversation normalization
   * ======================================================================== */

  const normalizedActiveId =
    normalizeId(
      activeConversationId,
    );


  const hasActiveConversation =
    Boolean(
      normalizedActiveId &&
        conversationIds.includes(
          normalizedActiveId,
        ),
    );


  /* ==========================================================================
   * Active conversation
   * ======================================================================== */

  const activeConversation =
    useMemo(
      () =>
        conversations.find(
          conversation =>
            getConversationId(
              conversation,
            ) ===
            normalizedActiveId,
        ) || null,
      [
        conversations,
        normalizedActiveId,
      ],
    );


  /* ==========================================================================
   * Responsive handling
   * ======================================================================== */

  useEffect(
    () => {
      if (
        !isBrowser
      ) {
        return undefined;
      }

      const handleResize =
        () => {
          const nextIsMobile =
            window.innerWidth <
            MOBILE_BREAKPOINT;

          setIsMobile(
            nextIsMobile,
          );

          if (
            !nextIsMobile
          ) {
            setListVisibleOnMobile(
              true,
            );
          }
        };

      handleResize();

      window.addEventListener(
        'resize',
        handleResize,
      );

      return () =>
        window.removeEventListener(
          'resize',
          handleResize,
        );
    },
    [],
  );


  /* ==========================================================================
   * Fetch conversations
   * ======================================================================== */

  const loadConversations =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        try {
          if (
            silent
          ) {
            setRefreshing(
              true,
            );
          }

          setRefreshError(
            '',
          );

          const action =
            dispatch(
              fetchConversations(),
            );

          if (
            action &&
            typeof action.then ===
              'function'
          ) {
            await action.unwrap?.();
          }
        } catch (
          error
        ) {
          const message =
            error?.message ||
            'Unable to load conversations.';

          setRefreshError(
            message,
          );

          logger?.warn?.(
            'Failed to fetch conversations in TITechChat',
            {
              error:
                error?.message,
            },
          );
        } finally {
          if (
            silent
          ) {
            setRefreshing(
              false,
            );
          }
        }
      },
      [
        dispatch,
      ],
    );


  /* ==========================================================================
   * Initial data loading
   * ======================================================================== */

  useEffect(
    () => {
      loadConversations();
    },
    [
      loadConversations,
    ],
  );


  /* ==========================================================================
   * Initial conversation selection
   * ======================================================================== */

  useEffect(
    () => {
      if (
        !initialConversationId
      ) {
        return;
      }

      const requestedId =
        normalizeId(
          initialConversationId,
        );

      if (
        !requestedId ||
        requestedId ===
          lastInitialConversationRef.current
      ) {
        return;
      }

      const exists =
        conversationIds.includes(
          requestedId,
        );

      if (
        !exists
      ) {
        return;
      }

      if (
        normalizedActiveId !==
        requestedId
      ) {
        dispatch(
          setActiveConversation(
            requestedId,
          ),
        );
      }

      lastInitialConversationRef.current =
        requestedId;

      if (
        isMobile
      ) {
        setListVisibleOnMobile(
          false,
        );
      }
    },
    [
      conversationIds,
      dispatch,
      initialConversationId,
      isMobile,
      normalizedActiveId,
    ],
  );


  /* ==========================================================================
   * Recover from stale active conversation
   * ======================================================================== */

  useEffect(
    () => {
      if (
        !normalizedActiveId ||
        conversations.length ===
          0
      ) {
        return;
      }

      if (
        hasActiveConversation
      ) {
        return;
      }

      const firstConversation =
        conversations[0];

      const firstId =
        getConversationId(
          firstConversation,
        );

      if (
        firstId
      ) {
        dispatch(
          setActiveConversation(
            firstId,
          ),
        );
      }
    },
    [
      conversations,
      dispatch,
      hasActiveConversation,
      normalizedActiveId,
    ],
  );


  /* ==========================================================================
   * Select conversation
   * ======================================================================== */

  const selectConversation =
    useCallback(
      conversationId => {
        const normalizedId =
          normalizeId(
            conversationId,
          );

        if (
          !normalizedId
        ) {
          return;
        }

        dispatch(
          setActiveConversation(
            normalizedId,
          ),
        );

        if (
          isMobile
        ) {
          setListVisibleOnMobile(
            false,
          );
        }
      },
      [
        dispatch,
        isMobile,
      ],
    );


  /* ==========================================================================
   * Scroll selected conversation into view
   * ======================================================================== */

  const scrollConversationIntoView =
    useCallback(
      conversationId => {
        if (
          !conversationId ||
          !isBrowser
        ) {
          return;
        }

        try {
          const elements =
            listRef.current?.querySelectorAll?.(
              '[data-conversation-id]',
            );

          if (
            !elements
          ) {
            return;
          }

          const target =
            Array.from(
              elements,
            ).find(
              element =>
                normalizeId(
                  element.getAttribute(
                    'data-conversation-id',
                  ),
                ) ===
                normalizeId(
                  conversationId,
                ),
            );

          target?.scrollIntoView?.({
            block:
              'nearest',

            behavior:
              'smooth',
          });
        } catch (
          error
        ) {
          logger?.debug?.(
            'Unable to scroll TITechChat conversation into view',
            {
              error:
                error?.message,
            },
          );
        }
      },
      [],
    );


  /* ==========================================================================
   * Keyboard navigation
   * ======================================================================== */

  const handleKeyboardNavigation =
    useCallback(
      event => {
        if (
          !conversationIds.length
        ) {
          return;
        }

        const target =
          event.target;

        const tagName =
          target?.tagName?.toLowerCase?.();

        if (
          tagName ===
            'input' ||
          tagName ===
            'textarea' ||
          target?.isContentEditable
        ) {
          return;
        }

        const currentIndex =
          conversationIds.indexOf(
            normalizedActiveId,
          );

        switch (
          event.key
        ) {
          case 'ArrowDown': {
            event.preventDefault();

            const nextIndex =
              currentIndex <
              0
                ? 0
                : Math.min(
                    conversationIds.length -
                      1,
                    currentIndex +
                      1,
                  );

            const nextId =
              conversationIds[
                nextIndex
              ];

            selectConversation(
              nextId,
            );

            requestAnimationFrame(
              () =>
                scrollConversationIntoView(
                  nextId,
                ),
            );

            break;
          }

          case 'ArrowUp': {
            event.preventDefault();

            const previousIndex =
              currentIndex <
              0
                ? 0
                : Math.max(
                    0,
                    currentIndex -
                      1,
                  );

            const previousId =
              conversationIds[
                previousIndex
              ];

            selectConversation(
              previousId,
            );

            requestAnimationFrame(
              () =>
                scrollConversationIntoView(
                  previousId,
                ),
            );

            break;
          }

          case 'Enter': {
            if (
              isMobile &&
              normalizedActiveId
            ) {
              event.preventDefault();

              setListVisibleOnMobile(
                false,
              );
            }

            break;
          }

          case 'Escape': {
            if (
              isMobile
            ) {
              event.preventDefault();

              setListVisibleOnMobile(
                true,
              );

              listRef.current?.querySelector?.(
                '[data-conversation-id]',
              )?.focus?.();
            }

            break;
          }

          default:
            break;
        }
      },
      [
        conversationIds,
        isMobile,
        normalizedActiveId,
        scrollConversationIntoView,
        selectConversation,
      ],
    );


  useEffect(
    () => {
      if (
        !isBrowser
      ) {
        return undefined;
      }

      window.addEventListener(
        'keydown',
        handleKeyboardNavigation,
      );

      return () =>
        window.removeEventListener(
          'keydown',
          handleKeyboardNavigation,
        );
    },
    [
      handleKeyboardNavigation,
    ],
  );


  /* ==========================================================================
   * Page focus
   * ======================================================================== */

  const focusConversationList =
    useCallback(
      () => {
        const target =
          listRef.current?.querySelector?.(
            '[data-conversation-id]',
          );

        target?.focus?.();
      },
      [],
    );


  /* ==========================================================================
   * Mobile controls
   * ======================================================================== */

  const showConversationList =
    useCallback(
      () => {
        setListVisibleOnMobile(
          true,
        );

        requestAnimationFrame(
          () => {
            focusConversationList();
          },
        );
      },
      [
        focusConversationList,
      ],
    );


  const showConversationDetail =
    useCallback(
      () => {
        if (
          normalizedActiveId
        ) {
          setListVisibleOnMobile(
            false,
          );
        }
      },
      [
        normalizedActiveId,
      ],
    );


  /* ==========================================================================
   * Suspense fallback
   * ======================================================================== */

  const suspenseFallback =
    useMemo(
      () => (
        <ChatLoadingFallback
          label="Loading TITechChat…"
        />
      ),
      [],
    );


  /* ==========================================================================
   * Render
   * ======================================================================== */

  return (
    <main
      ref={
        pageRef
      }
      className={cn(
        'titech-chat',
        className,
      )}
      aria-label={
        title
      }
      data-testid={
        testId
      }
      data-active-conversation-id={
        normalizedActiveId ||
        undefined
      }
      data-mobile={
        isMobile
          ? 'true'
          : 'false'
      }
    >

      {/* ======================================================================
          Page toolbar
          ==================================================================== */}

      <header className="titech-chat__toolbar">

        <div className="titech-chat__toolbar-title">

          <span className="titech-chat__brand">
            TITechChat
          </span>

          <h1>
            {
              title
            }
          </h1>

          <span className="titech-chat__toolbar-count">
            {conversations.length}{' '}
            {conversations.length ===
            1
              ? 'conversation'
              : 'conversations'}
          </span>

        </div>


        <div className="titech-chat__toolbar-actions">

          {isMobile ? (
            <button
              type="button"
              className="titech-chat__button titech-chat__button--secondary"
              onClick={
                listVisibleOnMobile
                  ? showConversationDetail
                  : showConversationList
              }
              disabled={
                !normalizedActiveId &&
                !listVisibleOnMobile
              }
              aria-label={
                listVisibleOnMobile
                  ? 'Show conversation'
                  : 'Show conversations'
              }
            >
              {listVisibleOnMobile ? (
                <>
                  <ChevronLeft
                    size={16}
                    aria-hidden="true"
                  />
                  Conversation
                </>
              ) : (
                <>
                  <Menu
                    size={16}
                    aria-hidden="true"
                  />
                  Conversations
                </>
              )}
            </button>
          ) : null}

          <button
            type="button"
            className="titech-chat__button titech-chat__button--secondary"
            onClick={() =>
              loadConversations({
                silent:
                  true,
              })
            }
            disabled={
              loading ||
              refreshing
            }
            aria-label="Refresh TITech conversations"
            title="Refresh conversations"
          >
            <RefreshCw
              size={16}
              className={
                loading ||
                refreshing
                  ? 'titech-chat__spin'
                  : undefined
              }
              aria-hidden="true"
            />

            <span>
              {
                refreshing
                  ? 'Refreshing…'
                  : 'Refresh'
              }
            </span>
          </button>

        </div>

      </header>


      {/* ======================================================================
          Refresh error
          ==================================================================== */}

      {refreshError ? (
        <div
          className="titech-chat__refresh-error"
          role="alert"
        >
          <AlertCircle
            size={17}
            aria-hidden="true"
          />

          <span>
            {
              refreshError
            }
          </span>

          <button
            type="button"
            onClick={() =>
              loadConversations()
            }
          >
            Retry
          </button>
        </div>
      ) : null}


      {/* ======================================================================
          Master/detail workspace
          ==================================================================== */}

      <div className="titech-chat__workspace">

        {/* ====================================================================
            Conversation list
            ================================================================== */}

        <aside
          ref={
            listRef
          }
          className={cn(
            'titech-chat__sidebar',

            (
              !isMobile ||
              listVisibleOnMobile
            ) &&
              'titech-chat__sidebar--visible',

            isMobile &&
              !listVisibleOnMobile &&
              'titech-chat__sidebar--hidden',
          )}
          aria-label={
            DEFAULT_CONVERSATIONS_LABEL
          }
        >

          <div className="titech-chat__sidebar-header">

            <div>
              <h2>
                Conversations
              </h2>

              <p>
                Select a conversation to continue.
              </p>
            </div>

            {isMobile ? (
              <button
                type="button"
                className="titech-chat__icon-button"
                onClick={
                  showConversationDetail
                }
                disabled={
                  !normalizedActiveId
                }
                aria-label="Close conversation list"
                title="Close conversation list"
              >
                <X
                  size={17}
                  aria-hidden="true"
                />
              </button>
            ) : null}

          </div>


          <div className="titech-chat__sidebar-content">

            {loading &&
            conversations.length ===
              0 ? (
              <ChatLoadingFallback
                label="Loading conversations…"
              />
            ) : conversations.length ===
              0 ? (
              <div
                className="titech-chat__list-empty"
                role="status"
              >
                <Search
                  size={28}
                  aria-hidden="true"
                />

                <h3>
                  No conversations
                </h3>

                <p>
                  There are currently no TITech conversations available.
                </p>

                <button
                  type="button"
                  className="titech-chat__button titech-chat__button--primary"
                  onClick={() =>
                    loadConversations({
                      silent:
                        true,
                    })
                  }
                  disabled={
                    refreshing
                  }
                >
                  <RefreshCw
                    size={16}
                    aria-hidden="true"
                  />
                  Refresh
                </button>
              </div>
            ) : (
              <ChatSectionErrorBoundary
                onError={
                  error =>
                    logger?.warn?.(
                      'ConversationList failed inside TITechChat',
                      {
                        error:
                          error?.message,
                      },
                    )
                }
              >
                <Suspense
                  fallback={
                    suspenseFallback
                  }
                >
                  <ConversationList
                    conversations={
                      conversations
                    }
                    activeConversationId={
                      normalizedActiveId
                    }
                    onConversationSelect={
                      selectConversation
                    }
                  />
                </Suspense>
              </ChatSectionErrorBoundary>
            )}

          </div>

        </aside>


        {/* ====================================================================
            Conversation detail
            ================================================================== */}

        <section
          ref={
            detailRef
          }
          className={cn(
            'titech-chat__detail',

            (
              !isMobile ||
              !listVisibleOnMobile
            ) &&
              'titech-chat__detail--visible',

            isMobile &&
              listVisibleOnMobile &&
              'titech-chat__detail--hidden',
          )}
          aria-label="Conversation detail"
          aria-live="polite"
        >

          <div className="titech-chat__detail-header">

            {isMobile ? (
              <button
                type="button"
                className="titech-chat__icon-button"
                onClick={
                  showConversationList
                }
                aria-label="Show conversations"
                title="Show conversations"
              >
                <ChevronLeft
                  size={18}
                  aria-hidden="true"
                />
              </button>
            ) : null}

            <div className="titech-chat__detail-heading">

              <h2>
                {activeConversation
                  ?.title ||
                  activeConversation
                    ?.name ||
                  (
                    hasActiveConversation
                      ? 'Conversation'
                      : 'No conversation selected'
                  )}
              </h2>

              <p>
                {hasActiveConversation
                  ? 'Messages and conversation actions'
                  : 'Select a conversation to begin'}
              </p>

            </div>

          </div>


          <div className="titech-chat__detail-content">

            {hasActiveConversation ? (
              <ChatSectionErrorBoundary
                onError={
                  error =>
                    logger?.error?.(
                      'ConversationDetail failed inside TITechChat',
                      {
                        error:
                          error?.message,
                      },
                    )
                }
              >
                <Suspense
                  fallback={
                    suspenseFallback
                  }
                >
                  <ConversationDetail
                    conversationId={
                      normalizedActiveId
                    }
                    conversation={
                      activeConversation
                    }
                  />
                </Suspense>
              </ChatSectionErrorBoundary>
            ) : (
              <EmptyConversationState
                mobile={
                  isMobile
                }
                onShowList={
                  showConversationList
                }
              />
            )}

          </div>

        </section>

      </div>


      {/* ======================================================================
          Keyboard help
          ==================================================================== */}

      <footer className="titech-chat__footer">

        <span>
          Keyboard:
          {' '}
          ↑ / ↓ to navigate
        </span>

        <span>
          Enter to open
        </span>

        <span>
          Esc to return to conversations
        </span>

      </footer>

    </main>
  );
}


/* ============================================================================
 * PropTypes
 * ========================================================================== */

TITechChat.propTypes = {
  initialConversationId:
    PropTypes.string,

  title:
    PropTypes.string,

  websocketUrl:
    PropTypes.string,

  testId:
    PropTypes.string,

  className:
    PropTypes.string,
};


/* ============================================================================
 * Defaults
 * ========================================================================== */

TITechChat.defaultProps = {
  initialConversationId:
    null,

  title:
    DEFAULT_TITLE,

  testId:
    FALLBACK_TEST_ID,

  className:
    '',
};


/* ============================================================================
 * Metadata
 * ========================================================================== */

TITechChat.displayName =
  'TITechChat';


/* ============================================================================
 * Export
 * ========================================================================== */

export {
  ChatLoadingFallback,
  ChatSectionErrorBoundary,
  EmptyConversationState,
  getConversationId,
  normalizeId,
};

export default memo(
  TITechChat,
);