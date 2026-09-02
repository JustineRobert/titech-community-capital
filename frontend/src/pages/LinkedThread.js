/**
 * ============================================================================
 * TITech Community Capital
 * Linked Thread Page
 * File: frontend/src/pages/LinkedThread.js
 *
 * Enterprise Production Grade
 * ----------------------------------------------------------------------------
 * Responsibilities
 * - Display a linked community discussion/thread
 * - Resolve thread identifiers from supported route parameters
 * - Load thread details through the enterprise API client
 * - Normalize multiple backend response contracts defensively
 * - Handle loading, empty, not-found, error, and refresh states
 * - Prevent stale requests and post-unmount state updates
 * - Support request cancellation and retry
 * - Provide accessible navigation and status announcements
 * - Preserve deep-link compatibility
 * - Avoid exposing internal API or infrastructure details
 * - Safely render user-generated content as text
 * - Support long-message expansion without unsafe HTML
 * - Maintain TITech terminology consistently
 * - Avoid sensitive client-side state
 * ============================================================================
 */

'use strict';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Link,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react';

import Spinner from '../components/ui/Spinner';
import logger from '../../utils/logger';
import './LinkedThread.css';

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_ERROR_MESSAGE =
  'We could not load this discussion thread. Please try again.';

const NOT_FOUND_MESSAGE =
  'The requested discussion thread could not be found.';

const MISSING_ID_MESSAGE =
  'No discussion thread identifier was provided.';

const DISCUSSIONS_ROUTE = '/threads';

const API_ENDPOINTS = Object.freeze({
  THREAD: (id) => `/api/threads/${encodeURIComponent(id)}`,
});

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PARTICIPANTS_DISPLAYED = 50;

const MESSAGE_PREVIEW_LENGTH = 500;

const STATUS_LABELS = Object.freeze({
  active: 'Active',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
  resolved: 'Resolved',
  pending: 'Pending',
  locked: 'Locked',
});

const CANCELLATION_CODES = Object.freeze([
  'ERR_CANCELED',
  'ECONNABORTED',
]);

/* ============================================================================
 * Utility Helpers
 * ========================================================================== */

/**
 * Safely determine whether a request error represents cancellation.
 *
 * @param {Error|Object|null} error
 * @returns {boolean}
 */
function isRequestCancelled(error) {
  if (!error) {
    return false;
  }

  return (
    error.name === 'AbortError' ||
    CANCELLATION_CODES.includes(error.code)
  );
}

/**
 * Safely extract an entity identifier.
 *
 * @param {unknown} entity
 * @returns {string|null}
 */
function getEntityId(entity) {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const value =
    entity._id ??
    entity.id ??
    entity.threadId ??
    entity.threadID ??
    entity.uuid ??
    null;

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  return String(value);
}

/**
 * Normalize an API response into a thread object.
 *
 * Supported contracts include:
 * - { data: { data: thread } }
 * - { data: thread }
 * - { thread: thread }
 * - { data: { thread: thread } }
 * - thread
 *
 * @param {unknown} payload
 * @returns {Object|null}
 */
function extractThread(payload) {
  if (!payload) {
    return null;
  }

  let current = payload;

  /*
   * Axios-style response:
   * response.data
   */
  if (
    current &&
    typeof current === 'object' &&
    Object.prototype.hasOwnProperty.call(
      current,
      'data',
    )
  ) {
    current = current.data;
  }

  if (!current) {
    return null;
  }

  /*
   * Common API envelope:
   * { data: { thread } }
   */
  if (
    current.thread &&
    typeof current.thread === 'object' &&
    !Array.isArray(current.thread)
  ) {
    return current.thread;
  }

  /*
   * Common API envelope:
   * { data: thread }
   */
  if (
    current.data &&
    typeof current.data === 'object' &&
    !Array.isArray(current.data)
  ) {
    if (
      current.data.thread &&
      typeof current.data.thread === 'object'
    ) {
      return current.data.thread;
    }

    return current.data;
  }

  /*
   * Direct thread response.
   */
  if (
    typeof current === 'object' &&
    !Array.isArray(current)
  ) {
    return current;
  }

  return null;
}

/**
 * Normalize participants from multiple possible backend field names.
 *
 * @param {Object|null} thread
 * @returns {Array}
 */
function normalizeParticipants(thread) {
  const candidates =
    thread?.participants ??
    thread?.members ??
    thread?.users ??
    thread?.participantsList ??
    [];

  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates.filter(Boolean);
}

/**
 * Normalize discussion messages/replies.
 *
 * @param {Object|null} thread
 * @returns {Array}
 */
function normalizeMessages(thread) {
  const candidates =
    thread?.messages ??
    thread?.replies ??
    thread?.comments ??
    thread?.posts ??
    [];

  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates.filter(Boolean);
}

/**
 * Normalize and bound display text.
 *
 * This is intentionally text-only. No HTML is injected into the DOM.
 *
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function normalizeText(value, maxLength) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLength);
}

/**
 * Format dates defensively using the user's locale.
 *
 * @param {unknown} value
 * @param {Object} options
 * @returns {string}
 */
function formatDate(value, options = {}) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  try {
    return new Intl.DateTimeFormat(
      undefined,
      {
        dateStyle:
          options.dateStyle || 'medium',
        timeStyle:
          options.timeStyle,
      },
    ).format(date);
  } catch (_) {
    return date.toLocaleString();
  }
}

/**
 * Resolve a readable display name without exposing unnecessary fields.
 *
 * @param {unknown} user
 * @param {string} fallback
 * @returns {string}
 */
function getDisplayName(
  user,
  fallback = 'Community Member',
) {
  if (!user) {
    return fallback;
  }

  if (typeof user === 'string') {
    return normalizeText(
      user,
      160,
    ) || fallback;
  }

  const value =
    user.name ??
    user.fullName ??
    user.displayName ??
    user.username ??
    null;

  return (
    normalizeText(value, 160) ||
    fallback
  );
}

/**
 * Resolve the first display character for an avatar.
 *
 * @param {unknown} user
 * @returns {string}
 */
function getInitial(user) {
  const name = getDisplayName(user);

  return (
    name.charAt(0).toUpperCase() || 'C'
  );
}

/**
 * Normalize status values.
 *
 * @param {unknown} status
 * @returns {{value: string, label: string}|null}
 */
function normalizeStatus(status) {
  if (
    status === null ||
    status === undefined ||
    status === ''
  ) {
    return null;
  }

  const normalized = String(status)
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  return {
    value: normalized.replace(
      /[^a-z0-9_-]/g,
      '',
    ),
    label:
      STATUS_LABELS[normalized] ||
      normalized.charAt(0).toUpperCase() +
        normalized.slice(1),
  };
}

/**
 * Extract a safe user-facing request error.
 *
 * Internal server details are intentionally not surfaced.
 *
 * @param {unknown} error
 * @returns {string|null}
 */
function getErrorMessage(error) {
  if (!error) {
    return DEFAULT_ERROR_MESSAGE;
  }

  if (isRequestCancelled(error)) {
    return null;
  }

  const status =
    error?.response?.status;

  if (status === 404) {
    return NOT_FOUND_MESSAGE;
  }

  const serverMessage =
    error?.response?.data?.message;

  /*
   * Only use a server-provided message when it is a reasonably
   * bounded string. Otherwise use the generic message.
   */
  if (
    typeof serverMessage === 'string' &&
    serverMessage.trim() &&
    serverMessage.length <= 500
  ) {
    return serverMessage.trim();
  }

  return DEFAULT_ERROR_MESSAGE;
}

/**
 * Resolve a message author from supported backend contracts.
 *
 * @param {Object} message
 * @returns {unknown}
 */
function getMessageAuthor(message) {
  return (
    message?.author ??
    message?.user ??
    message?.createdBy ??
    message?.sender ??
    null
  );
}

/**
 * Resolve a message body from supported backend contracts.
 *
 * @param {Object} message
 * @returns {string}
 */
function getMessageBody(message) {
  return normalizeText(
    message?.content ??
      message?.body ??
      message?.text ??
      message?.message,
    MAX_DESCRIPTION_LENGTH,
  );
}

/**
 * Resolve a message timestamp.
 *
 * @param {Object} message
 * @returns {unknown}
 */
function getMessageDate(message) {
  return (
    message?.createdAt ??
    message?.created_at ??
    message?.timestamp ??
    message?.date ??
    null
  );
}

/**
 * Validate a user-provided/external URL before rendering it as a link.
 *
 * Relative URLs and http(s) URLs are supported. Potentially dangerous
 * protocols such as javascript:, data:, and vbscript: are rejected.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function getSafeExternalUrl(value) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return null;
  }

  const raw = value.trim();

  try {
    const url = new URL(
      raw,
      typeof window !== 'undefined'
        ? window.location.origin
        : 'https://titechcommunity.app',
    );

    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:'
    ) {
      return null;
    }

    return url.href;
  } catch (_) {
    return null;
  }
}

/**
 * Stable message identifier.
 *
 * @param {Object} message
 * @param {number} index
 * @returns {string}
 */
function getMessageKey(message, index) {
  return (
    getEntityId(message) ||
    `message-${index}`
  );
}

/* ============================================================================
 * Component
 * ========================================================================== */

export default function LinkedThread() {
  const params = useParams();
  const navigate = useNavigate();

  const {
    threadId,
    id,
  } = params;

  const resolvedThreadId = useMemo(
    () => {
      const candidate =
        threadId || id || null;

      if (
        candidate === null ||
        candidate === undefined
      ) {
        return null;
      }

      const normalized =
        String(candidate).trim();

      return normalized || null;
    },
    [threadId, id],
  );

  const mountedRef = useRef(false);
  const abortRef = useRef(null);
  const requestSequenceRef =
    useRef(0);

  const [
    thread,
    setThread,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  const [
    expandedMessages,
    setExpandedMessages,
  ] = useState(
    () => new Set(),
  );

  /* ==========================================================================
   * Fetch Thread
   * ======================================================================== */

  const fetchThread = useCallback(
    async ({ silent = false } = {}) => {
      if (!resolvedThreadId) {
        if (mountedRef.current) {
          setThread(null);
          setError(
            MISSING_ID_MESSAGE,
          );
          setLoading(false);
          setRefreshing(false);
        }

        return;
      }

      const requestId =
        ++requestSequenceRef.current;

      /*
       * Cancel the previous request before creating a new one.
       */
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (_) {
          // Abort cleanup is best effort.
        }
      }

      const controller =
        typeof AbortController !==
        'undefined'
          ? new AbortController()
          : null;

      abortRef.current = controller;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        /*
         * Dynamic import keeps this page compatible with existing
         * service-module loading patterns while avoiding unnecessary
         * eager loading.
         */
        const apiModule =
          await import(
            '../services/api'
          );

        const api =
          apiModule?.default ||
          apiModule;

        if (
          !api ||
          typeof api.get !== 'function'
        ) {
          throw new Error(
            'API client unavailable',
          );
        }

        const response =
          await api.get(
            API_ENDPOINTS.THREAD(
              resolvedThreadId,
            ),
            controller
              ? {
                  signal:
                    controller.signal,
                }
              : undefined,
          );

        if (
          !mountedRef.current ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        const normalizedThread =
          extractThread(response);

        if (!normalizedThread) {
          setThread(null);
          setError(
            NOT_FOUND_MESSAGE,
          );
          return;
        }

        /*
         * If the backend returns an identifier, verify that it corresponds
         * to the requested thread. We log a mismatch for observability but
         * do not expose implementation details to the user.
         */
        const returnedId =
          getEntityId(
            normalizedThread,
          );

        if (
          returnedId &&
          returnedId !==
            String(resolvedThreadId)
        ) {
          logger?.warn?.(
            'LinkedThread API returned an unexpected thread identifier',
            {
              requestedThreadId:
                resolvedThreadId,
              returnedThreadId:
                returnedId,
            },
          );
        }

        setThread(
          normalizedThread,
        );
        setError(null);
      } catch (requestError) {
        if (
          !mountedRef.current ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        const message =
          getErrorMessage(
            requestError,
          );

        if (!message) {
          return;
        }

        setError(message);

        logger?.warn?.(
          'LinkedThread fetch failed',
          {
            threadId:
              resolvedThreadId,
            status:
              requestError?.response
                ?.status,
            error:
              requestError?.message ||
              'Unknown request error',
          },
        );
      } finally {
        if (
          mountedRef.current &&
          requestId ===
            requestSequenceRef.current
        ) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [resolvedThreadId],
  );

  /* ==========================================================================
   * Lifecycle
   * ======================================================================== */

  useEffect(() => {
    mountedRef.current = true;

    fetchThread();

    return () => {
      mountedRef.current = false;

      requestSequenceRef.current +=
        1;

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (_) {
          // Ignore cleanup failures.
        }

        abortRef.current = null;
      }
    };
  }, [fetchThread]);

  /*
   * Reset expanded message state when navigating directly from one thread
   * to another without unmounting the page.
   */
  useEffect(() => {
    setExpandedMessages(
      new Set(),
    );
  }, [resolvedThreadId]);

  /* ==========================================================================
   * Actions
   * ======================================================================== */

  const handleRetry = useCallback(() => {
    fetchThread();
  }, [fetchThread]);

  const handleRefresh = useCallback(() => {
    if (refreshing) {
      return;
    }

    fetchThread({
      silent: true,
    });
  }, [fetchThread, refreshing]);

  const handleBack = useCallback(() => {
    if (
      typeof window !==
        'undefined' &&
      window.history.length > 1
    ) {
      navigate(-1);
      return;
    }

    navigate(
      DISCUSSIONS_ROUTE,
    );
  }, [navigate]);

  const handleGoToDiscussions =
    useCallback(() => {
      navigate(
        DISCUSSIONS_ROUTE,
      );
    }, [navigate]);

  const toggleMessage =
    useCallback(
      (messageId) => {
        if (!messageId) {
          return;
        }

        setExpandedMessages(
          (current) => {
            const next =
              new Set(current);

            if (
              next.has(messageId)
            ) {
              next.delete(
                messageId,
              );
            } else {
              next.add(
                messageId,
              );
            }

            return next;
          },
        );
      },
      [],
    );

  /* ==========================================================================
   * Derived Data
   * ======================================================================== */

  const title = useMemo(
    () =>
      normalizeText(
        thread?.title ??
          thread?.subject ??
          thread?.name,
        MAX_TITLE_LENGTH,
      ) ||
      'Community Discussion',
    [thread],
  );

  const description = useMemo(
    () =>
      normalizeText(
        thread?.description ??
          thread?.content ??
          thread?.body ??
          thread?.summary,
        MAX_DESCRIPTION_LENGTH,
      ),
    [thread],
  );

  const participants = useMemo(
    () =>
      normalizeParticipants(
        thread,
      ),
    [thread],
  );

  const messages = useMemo(
    () =>
      normalizeMessages(
        thread,
      ),
    [thread],
  );

  const status = useMemo(
    () =>
      normalizeStatus(
        thread?.status,
      ),
    [thread],
  );

  const createdAt = useMemo(
    () =>
      thread?.createdAt ??
      thread?.created_at ??
      thread?.dateCreated ??
      null,
    [thread],
  );

  const updatedAt = useMemo(
    () =>
      thread?.updatedAt ??
      thread?.updated_at ??
      thread?.lastUpdated ??
      null,
    [thread],
  );

  /* ==========================================================================
   * Render: Missing Thread Identifier
   * ======================================================================== */

  if (!resolvedThreadId) {
    return (
      <main
        className="linked-thread-page"
        aria-labelledby="linked-thread-title"
      >
        <div className="linked-thread-shell">
          <section
            className="linked-thread-state linked-thread-state-error"
            role="alert"
          >
            <AlertCircle
              size={42}
              aria-hidden="true"
            />

            <h1 id="linked-thread-title">
              Discussion unavailable
            </h1>

            <p>
              {MISSING_ID_MESSAGE}
            </p>

            <button
              type="button"
              className="linked-thread-button linked-thread-button-primary"
              onClick={
                handleGoToDiscussions
              }
            >
              <ArrowLeft
                size={18}
                aria-hidden="true"
              />

              Back to Discussions
            </button>
          </section>
        </div>
      </main>
    );
  }

  /* ==========================================================================
   * Render: Loading
   * ======================================================================== */

  if (loading) {
    return (
      <main
        className="linked-thread-page"
        aria-labelledby="linked-thread-loading-title"
      >
        <div className="linked-thread-shell">
          <section
            className="linked-thread-state"
            aria-live="polite"
            aria-busy="true"
          >
            <Spinner label="Loading discussion…" />

            <h1
              id="linked-thread-loading-title"
              className="sr-only"
            >
              Loading discussion
            </h1>
          </section>
        </div>
      </main>
    );
  }

  /* ==========================================================================
   * Render: Error
   * ======================================================================== */

  if (error && !thread) {
    const isNotFound =
      error === NOT_FOUND_MESSAGE;

    return (
      <main
        className="linked-thread-page"
        aria-labelledby="linked-thread-error-title"
      >
        <div className="linked-thread-shell">
          <section
            className="linked-thread-state linked-thread-state-error"
            role="alert"
          >
            <AlertCircle
              size={42}
              aria-hidden="true"
            />

            <h1 id="linked-thread-error-title">
              {isNotFound
                ? 'Discussion not found'
                : 'Unable to load discussion'}
            </h1>

            <p>{error}</p>

            <div className="linked-thread-state-actions">
              <button
                type="button"
                className="linked-thread-button linked-thread-button-primary"
                onClick={
                  handleRetry
                }
              >
                <RefreshCw
                  size={18}
                  aria-hidden="true"
                />

                Try Again
              </button>

              <button
                type="button"
                className="linked-thread-button linked-thread-button-secondary"
                onClick={
                  handleBack
                }
              >
                <ArrowLeft
                  size={18}
                  aria-hidden="true"
                />

                Go Back
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  /* ==========================================================================
   * Render: Main
   * ======================================================================== */

  return (
    <main
      className="linked-thread-page"
      aria-labelledby="linked-thread-title"
    >
      <div className="linked-thread-shell">
        {/* ====================================================================
         * Header
         * ================================================================== */}

        <header className="linked-thread-header">
          <div className="linked-thread-header-actions">
            <button
              type="button"
              className="linked-thread-icon-button"
              onClick={handleBack}
              aria-label="Go back"
              title="Go back"
            >
              <ArrowLeft
                size={20}
                aria-hidden="true"
              />
            </button>

            <div className="linked-thread-header-label">
              <MessageCircle
                size={18}
                aria-hidden="true"
              />

              <span>
                TITech Community
                Discussion
              </span>
            </div>

            <button
              type="button"
              className="linked-thread-icon-button"
              onClick={
                handleRefresh
              }
              disabled={refreshing}
              aria-label="Refresh discussion"
              title="Refresh discussion"
              aria-busy={refreshing}
            >
              <RefreshCw
                size={18}
                aria-hidden="true"
                className={
                  refreshing
                    ? 'linked-thread-spin'
                    : ''
                }
              />
            </button>
          </div>

          <div className="linked-thread-title-row">
            <div>
              <h1 id="linked-thread-title">
                {title}
              </h1>

              {description && (
                <p className="linked-thread-description">
                  {description}
                </p>
              )}
            </div>

            {status && (
              <span
                className={`linked-thread-status linked-thread-status-${status.value}`}
              >
                {status.label}
              </span>
            )}
          </div>

          <div
            className="linked-thread-metadata"
            aria-label="Discussion metadata"
          >
            {createdAt && (
              <span>
                <Calendar
                  size={15}
                  aria-hidden="true"
                />

                <span>
                  Created{' '}
                  {formatDate(
                    createdAt,
                  )}
                </span>
              </span>
            )}

            {updatedAt && (
              <span>
                <Clock
                  size={15}
                  aria-hidden="true"
                />

                <span>
                  Updated{' '}
                  {formatDate(
                    updatedAt,
                  )}
                </span>
              </span>
            )}

            <span>
              <MessageCircle
                size={15}
                aria-hidden="true"
              />

              <span>
                {messages.length}{' '}
                {messages.length === 1
                  ? 'message'
                  : 'messages'}
              </span>
            </span>

            {participants.length >
              0 && (
              <span>
                <User
                  size={15}
                  aria-hidden="true"
                />

                <span>
                  {participants.length}{' '}
                  {participants.length ===
                  1
                    ? 'participant'
                    : 'participants'}
                </span>
              </span>
            )}
          </div>
        </header>

        {/* ====================================================================
         * Inline Error
         * ================================================================== */}

        {error && thread && (
          <div
            className="linked-thread-inline-error"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle
              size={18}
              aria-hidden="true"
            />

            <span>{error}</span>

            <button
              type="button"
              onClick={
                handleRetry
              }
            >
              Retry
            </button>
          </div>
        )}

        {/* ====================================================================
         * Participants
         * ================================================================== */}

        {participants.length >
          0 && (
          <section
            className="linked-thread-participants"
            aria-labelledby="linked-thread-participants-title"
          >
            <div className="linked-thread-section-heading">
              <div>
                <h2 id="linked-thread-participants-title">
                  Participants
                </h2>

                <p>
                  Members participating
                  in this discussion.
                </p>
              </div>
            </div>

            <div
              className="linked-thread-participant-list"
              role="list"
              aria-label="Discussion participants"
            >
              {participants
                .slice(
                  0,
                  MAX_PARTICIPANTS_DISPLAYED,
                )
                .map(
                  (
                    participant,
                    index,
                  ) => {
                    const participantId =
                      getEntityId(
                        participant,
                      ) ||
                      `participant-${index}`;

                    return (
                      <div
                        key={
                          participantId
                        }
                        className="linked-thread-participant"
                        role="listitem"
                      >
                        <span
                          className="linked-thread-avatar"
                          aria-hidden="true"
                        >
                          {getInitial(
                            participant,
                          )}
                        </span>

                        <span>
                          {getDisplayName(
                            participant,
                          )}
                        </span>
                      </div>
                    );
                  },
                )}
            </div>

            {participants.length >
              MAX_PARTICIPANTS_DISPLAYED && (
              <p className="linked-thread-muted">
                Showing the first{' '}
                {
                  MAX_PARTICIPANTS_DISPLAYED
                }{' '}
                participants.
              </p>
            )}
          </section>
        )}

        {/* ====================================================================
         * Messages
         * ================================================================== */}

        <section
          className="linked-thread-messages"
          aria-labelledby="linked-thread-messages-title"
        >
          <div className="linked-thread-section-heading">
            <div>
              <h2 id="linked-thread-messages-title">
                Discussion
              </h2>

              <p>
                Messages and replies
                associated with this
                thread.
              </p>
            </div>
          </div>

          {messages.length ===
          0 ? (
            <div className="linked-thread-empty">
              <MessageCircle
                size={36}
                aria-hidden="true"
              />

              <h3>
                No messages yet
              </h3>

              <p>
                This discussion does
                not contain any
                messages yet.
              </p>
            </div>
          ) : (
            <div className="linked-thread-message-list">
              {messages.map(
                (
                  message,
                  index,
                ) => {
                  const messageId =
                    getMessageKey(
                      message,
                      index,
                    );

                  const author =
                    getMessageAuthor(
                      message,
                    );

                  const authorName =
                    getDisplayName(
                      author,
                    );

                  const body =
                    getMessageBody(
                      message,
                    );

                  const messageDate =
                    getMessageDate(
                      message,
                    );

                  const expanded =
                    expandedMessages.has(
                      messageId,
                    );

                  const safeUrl =
                    getSafeExternalUrl(
                      message?.url,
                    );

                  return (
                    <article
                      key={
                        messageId
                      }
                      className="linked-thread-message"
                    >
                      <div className="linked-thread-message-header">
                        <div className="linked-thread-message-author">
                          <span
                            className="linked-thread-avatar"
                            aria-hidden="true"
                          >
                            {getInitial(
                              author,
                            )}
                          </span>

                          <div>
                            <strong>
                              {
                                authorName
                              }
                            </strong>

                            {messageDate && (
                              <time
                                dateTime={
                                  String(
                                    messageDate,
                                  )
                                }
                              >
                                {formatDate(
                                  messageDate,
                                  {
                                    dateStyle:
                                      'medium',
                                    timeStyle:
                                      'short',
                                  },
                                )}
                              </time>
                            )}
                          </div>
                        </div>

                        {safeUrl && (
                          <a
                            href={
                              safeUrl
                            }
                            className="linked-thread-message-link"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open linked message"
                          >
                            <ExternalLink
                              size={
                                17
                              }
                              aria-hidden="true"
                            />
                          </a>
                        )}
                      </div>

                      <div
                        className={`linked-thread-message-body${
                          expanded
                            ? ' expanded'
                            : ''
                        }`}
                      >
                        {body || (
                          <span className="linked-thread-muted">
                            This message
                            has no
                            displayable
                            content.
                          </span>
                        )}
                      </div>

                      {body.length >
                        MESSAGE_PREVIEW_LENGTH && (
                        <button
                          type="button"
                          className="linked-thread-expand-button"
                          onClick={() =>
                            toggleMessage(
                              messageId,
                            )
                          }
                          aria-expanded={
                            expanded
                          }
                        >
                          {expanded ? (
                            <>
                              <ChevronUp
                                size={
                                  16
                                }
                                aria-hidden="true"
                              />

                              Show less
                            </>
                          ) : (
                            <>
                              <ChevronDown
                                size={
                                  16
                                }
                                aria-hidden="true"
                              />

                              Show more
                            </>
                          )}
                        </button>
                      )}
                    </article>
                  );
                },
              )}
            </div>
          )}
        </section>

        {/* ====================================================================
         * Security / Trust Notice
         * ================================================================== */}

        <aside
          className="linked-thread-security-note"
          role="note"
        >
          <ShieldCheck
            size={20}
            aria-hidden="true"
          />

          <div>
            <strong>
              Community discussion
              safety
            </strong>

            <p>
              Do not share passwords,
              authentication codes,
              payment credentials,
              private keys, or other
              sensitive information in
              discussion messages.
            </p>
          </div>
        </aside>

        {/* ====================================================================
         * Footer Navigation
         * ================================================================== */}

        <footer className="linked-thread-footer">
          <button
            type="button"
            className="linked-thread-button linked-thread-button-secondary"
            onClick={handleBack}
          >
            <ArrowLeft
              size={18}
              aria-hidden="true"
            />

            Back
          </button>

          <Link
            to={DISCUSSIONS_ROUTE}
            className="linked-thread-button linked-thread-button-primary"
          >
            <MessageCircle
              size={18}
              aria-hidden="true"
            />

            All Discussions
          </Link>
        </footer>
      </div>
    </main>
  );
}