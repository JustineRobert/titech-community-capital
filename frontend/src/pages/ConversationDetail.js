// ============================================================================
// TITech Community Capital
// Enterprise Conversation Detail
//
// File:
// frontend/src/pages/ConversationDetail.js
//
// Production Grade
// ============================================================================
//
// Responsibilities
// - Conversation detail rendering
// - Route-aware conversation loading
// - Defensive API handling
// - Loading / empty / error states
// - Conversation read-state synchronization
// - Archive action with confirmation
// - Keyboard accessibility
// - Error boundary isolation
// - Abort-safe requests
// - Safe rendering of untrusted conversation metadata
// - Responsive enterprise UI
//
// Architecture
// - AuthContext remains authoritative for authentication.
// - Existing enterprise API client remains authoritative for HTTP/session
//   behavior.
// - No redux/ directory.
// - No actions/ directory.
// - Does not persist access or refresh tokens.
// - MessagePanel remains responsible for message-level functionality.
//
// ============================================================================

"use strict";

import React, {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ArrowLeft,
  Archive,
  AlertCircle,
  Check,
  Clock,
  MoreVertical,
  RefreshCw,
  Users,
  X,
} from "lucide-react";

import {
  useNavigate,
  useParams,
} from "react-router-dom";

import { toast } from "react-toastify";

import MessagePanel from "../components/chat/MessagePanel";
import api from "../services/api";

// ============================================================================
// Constants
// ============================================================================

const CONVERSATIONS_ENDPOINT =
  "/api/conversations";

const DEFAULT_STATUS =
  "active";

const MAX_TITLE_LENGTH =
  120;

const REQUEST_TIMEOUT_FALLBACK =
  15000;

// ============================================================================
// Utility Helpers
// ============================================================================

function normalizeId(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    if (value._id) {
      return String(value._id);
    }

    if (value.id) {
      return String(value.id);
    }
  }

  return String(value);
}

function normalizeConversation(payload) {
  if (!payload) {
    return null;
  }

  const data =
    payload?.data?.data ??
    payload?.data ??
    payload;

  if (
    Array.isArray(data)
  ) {
    return data[0] || null;
  }

  return data;
}

function getConversationId(
  conversation
) {
  return normalizeId(
    conversation?.id ||
      conversation?._id
  );
}

function getParticipantName(
  participant
) {
  if (!participant) {
    return "Unknown";
  }

  return (
    participant.name ||
    participant.fullName ||
    participant.displayName ||
    participant.email ||
    participant.username ||
    normalizeId(
      participant.id ||
        participant._id
    ) ||
    "Unknown"
  );
}

function getInitials(value) {
  const normalized =
    String(value || "C")
      .trim();

  if (!normalized) {
    return "C";
  }

  const parts =
    normalized
      .split(/\s+/)
      .filter(Boolean);

  if (parts.length >= 2) {
    return (
      `${parts[0][0]}${parts[1][0]}`
    ).toUpperCase();
  }

  return normalized
    .slice(0, 2)
    .toUpperCase();
}

function normalizeStatus(
  status
) {
  const normalized =
    String(
      status ||
        DEFAULT_STATUS
    )
      .trim()
      .toLowerCase();

  return normalized || DEFAULT_STATUS;
}

function getErrorMessage(
  error,
  fallback
) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  );
}

function isAbortError(error) {
  return (
    error?.name ===
      "AbortError" ||
    error?.code ===
      "ERR_CANCELED" ||
    error?.code ===
      "ECONNABORTED"
  );
}

// ============================================================================
// Error Boundary
// ============================================================================

class ConversationErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(
    error
  ) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(
    error,
    info
  ) {
    // Do not expose internal stack traces to users.
    // Keep logging defensive so the boundary itself never crashes.
    try {
      console.error(
        "[TITech] ConversationDetail render error",
        {
          message:
            error?.message,
          componentStack:
            info?.componentStack,
        }
      );
    } catch {
      // Intentionally ignored.
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (
      !this.state.hasError
    ) {
      return this.props.children;
    }

    return (
      <section
        role="alert"
        aria-live="assertive"
        className="flex min-h-[360px] items-center justify-center bg-white p-6"
      >
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle
              size={24}
              aria-hidden="true"
            />
          </div>

          <h2 className="text-lg font-semibold text-red-900">
            Conversation unavailable
          </h2>

          <p className="mt-2 text-sm leading-6 text-red-700">
            Something went wrong while
            rendering this conversation.
            Please try again.
          </p>

          <button
            type="button"
            onClick={
              this.handleRetry
            }
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
            />
            Try again
          </button>
        </div>
      </section>
    );
  }
}

ConversationErrorBoundary.propTypes = {
  children:
    require("prop-types").node,
};

// ============================================================================
// Loading State
// ============================================================================

const ConversationLoading = memo(
  function ConversationLoading() {
    return (
      <div
        className="flex h-full min-h-[420px] flex-col bg-white"
        role="status"
        aria-live="polite"
        aria-label="Loading conversation"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-4">
          <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />

          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-32 animate-pulse rounded bg-gray-100" />
          </div>
        </div>

        <div className="flex-1 space-y-5 p-6">
          <div className="h-16 w-3/4 animate-pulse rounded-xl bg-gray-100" />
          <div className="ml-auto h-16 w-2/3 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-20 w-3/4 animate-pulse rounded-xl bg-gray-100" />
        </div>

        <span className="sr-only">
          Loading conversation…
        </span>
      </div>
    );
  }
);

// ============================================================================
// Empty State
// ============================================================================

const ConversationEmptyState =
  memo(function ConversationEmptyState({
    onBack,
  }) {
    return (
      <section
        className="flex min-h-[420px] items-center justify-center bg-white p-6"
        aria-labelledby="conversation-empty-title"
      >
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <Users
              size={26}
              aria-hidden="true"
            />
          </div>

          <h1
            id="conversation-empty-title"
            className="text-xl font-semibold text-gray-900"
          >
            No conversation selected
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-600">
            Select a conversation from
            the messaging workspace to
            view its messages.
          </p>

          <button
            type="button"
            onClick={onBack}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <ArrowLeft
              size={16}
              aria-hidden="true"
            />
            Back to conversations
          </button>
        </div>
      </section>
    );
  });

// ============================================================================
// Error State
// ============================================================================

const ConversationLoadError =
  memo(function ConversationLoadError({
    message,
    onRetry,
    onBack,
    retrying = false,
  }) {
    return (
      <section
        className="flex min-h-[420px] items-center justify-center bg-white p-6"
        role="alert"
        aria-live="assertive"
      >
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle
              size={28}
              aria-hidden="true"
            />
          </div>

          <h1 className="text-xl font-semibold text-gray-900">
            Unable to load conversation
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-600">
            {message ||
              "The conversation could not be loaded."}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <RefreshCw
                size={16}
                className={
                  retrying
                    ? "animate-spin"
                    : ""
                }
                aria-hidden="true"
              />
              {retrying
                ? "Retrying…"
                : "Retry"}
            </button>

            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <ArrowLeft
                size={16}
                aria-hidden="true"
              />
              Back
            </button>
          </div>
        </div>
      </section>
    );
  });

// ============================================================================
// Conversation Header
// ============================================================================

const ConversationHeader =
  memo(function ConversationHeader({
    conversation,
    conversationId,
    onBack,
    onArchive,
    archiving,
  }) {
    const participants = Array.isArray(
      conversation?.participants
    )
      ? conversation.participants
      : [];

    const participantNames =
      participants
        .map(getParticipantName)
        .filter(Boolean);

    const primaryName =
      participantNames[0] ||
      "Conversation";

    const title = String(
      conversation?.title ||
        primaryName ||
        "Conversation"
    ).slice(
      0,
      MAX_TITLE_LENGTH
    );

    const status =
      normalizeStatus(
        conversation?.status
      );

    const unreadCount = Math.max(
      0,
      Number(
        conversation?.unreadCount ||
          0
      )
    );

    const statusLabel =
      status.charAt(0).toUpperCase() +
      status.slice(1);

    const participantSummary =
      participantNames.length === 0
        ? "No participants"
        : participantNames.length === 1
        ? participantNames[0]
        : participantNames.length === 2
        ? `${participantNames[0]} and ${participantNames[1]}`
        : `${participantNames[0]} and ${
            participantNames.length - 1
          } others`;

    return (
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            aria-label="Back to conversations"
            title="Back"
          >
            <ArrowLeft
              size={18}
              aria-hidden="true"
            />
          </button>

          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700"
            aria-hidden="true"
          >
            {getInitials(
              primaryName
            )}
          </div>

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1
                className="truncate text-sm font-semibold text-gray-900 sm:text-base"
                title={title}
              >
                {title}
              </h1>

              <span
                className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex ${
                  status ===
                  "active"
                    ? "bg-green-100 text-green-700"
                    : status ===
                      "archived"
                    ? "bg-gray-100 text-gray-600"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {statusLabel}
              </span>
            </div>

            <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
              <span className="truncate">
                {participantSummary}
              </span>

              {unreadCount > 0 && (
                <>
                  <span
                    aria-hidden="true"
                  >
                    •
                  </span>

                  <span className="font-medium text-blue-600">
                    {unreadCount} unread
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className="hidden text-[11px] text-gray-400 lg:inline"
            title={conversationId}
          >
            ID: {conversationId}
          </span>

          <button
            type="button"
            onClick={onArchive}
            disabled={
              archiving ||
              status ===
                "archived"
            }
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            aria-label={
              status ===
              "archived"
                ? "Conversation archived"
                : "Archive conversation"
            }
          >
            {archiving ? (
              <RefreshCw
                size={15}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Archive
                size={15}
                aria-hidden="true"
              />
            )}

            <span className="hidden sm:inline">
              {archiving
                ? "Archiving…"
                : status ===
                  "archived"
                ? "Archived"
                : "Archive"}
            </span>
          </button>

          <div className="relative hidden md:block">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Conversation options"
              title="Conversation options"
            >
              <MoreVertical
                size={18}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </header>
    );
  });

// ============================================================================
// Main Component
// ============================================================================

function ConversationDetail({
  conversationId:
    propConversationId,
}) {
  const navigate =
    useNavigate();

  const params =
    useParams();

  const routeConversationId =
    params?.conversationId ||
    params?.conversationID ||
    params?.id ||
    null;

  const conversationId =
    normalizeId(
      propConversationId ||
        routeConversationId
    );

  const mountedRef =
    useRef(true);

  const requestControllerRef =
    useRef(null);

  const [conversation, setConversation] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  const [retrying, setRetrying] =
    useState(false);

  const [archiving, setArchiving] =
    useState(false);

  const [error, setError] =
    useState("");

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (
        requestControllerRef.current
      ) {
        try {
          requestControllerRef.current.abort();
        } catch {
          // Ignore abort cleanup failures.
        }
      }
    };
  }, []);

  // ==========================================================================
  // Navigate Back
  // ==========================================================================

  const navigateBack =
    useCallback(() => {
      // Prefer normal browser/router history.
      // This keeps ConversationDetail independent from a specific
      // Redux implementation.
      navigate(-1);
    }, [navigate]);

  // ==========================================================================
  // Load Conversation
  // ==========================================================================

  const loadConversation =
    useCallback(
      async ({
        isRetry = false,
      } = {}) => {
        if (!conversationId) {
          setConversation(null);
          setError("");
          return;
        }

        if (
          requestControllerRef.current
        ) {
          try {
            requestControllerRef.current.abort();
          } catch {
            // Ignore previous request cancellation.
          }
        }

        const controller =
          new AbortController();

        requestControllerRef.current =
          controller;

        if (isRetry) {
          setRetrying(true);
        } else {
          setLoading(true);
        }

        setError("");

        try {
          const response =
            await api.get(
              `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(
                conversationId
              )}`,
              {
                signal:
                  controller.signal,
                timeout:
                  REQUEST_TIMEOUT_FALLBACK,
              }
            );

          if (
            !mountedRef.current ||
            controller.signal.aborted
          ) {
            return;
          }

          const normalized =
            normalizeConversation(
              response
            );

          if (!normalized) {
            throw new Error(
              "The requested conversation was not found."
            );
          }

          setConversation(
            normalized
          );
        } catch (err) {
          if (
            isAbortError(err)
          ) {
            return;
          }

          if (
            !mountedRef.current
          ) {
            return;
          }

          const status =
            err?.response?.status;

          if (
            status === 401
          ) {
            setError(
              "Your session has expired. Please sign in again."
            );

            return;
          }

          if (
            status === 403
          ) {
            setError(
              "You do not have permission to view this conversation."
            );

            return;
          }

          if (
            status === 404
          ) {
            setError(
              "This conversation could not be found. It may have been removed or archived."
            );

            return;
          }

          setError(
            getErrorMessage(
              err,
              "Failed to load the conversation."
            )
          );
        } finally {
          if (
            mountedRef.current &&
            requestControllerRef.current ===
              controller
          ) {
            setLoading(false);
            setRetrying(false);
            requestControllerRef.current =
              null;
          }
        }
      },
      [conversationId]
    );

  // ==========================================================================
  // Initial / ID Change Load
  // ==========================================================================

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  // ==========================================================================
  // Mark Conversation Read
  // ==========================================================================

  useEffect(() => {
    if (
      !conversation ||
      !conversationId
    ) {
      return;
    }

    const unreadCount =
      Number(
        conversation.unreadCount ||
          0
      );

    if (
      unreadCount <= 0
    ) {
      return;
    }

    let cancelled = false;

    const markRead =
      async () => {
        try {
          await api.post(
            `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(
              conversationId
            )}/read`
          );

          if (
            !cancelled &&
            mountedRef.current
          ) {
            setConversation(
              (current) =>
                current
                  ? {
                      ...current,
                      unreadCount: 0,
                    }
                  : current
            );
          }
        } catch (err) {
          // Marking read should not make the conversation unusable.
          if (
            !cancelled &&
            mountedRef.current
          ) {
            console.warn(
              "[TITech] Failed to mark conversation as read",
              err
            );
          }
        }
      };

    markRead();

    return () => {
      cancelled = true;
    };
  }, [
    conversation,
    conversationId,
  ]);

  // ==========================================================================
  // Archive
  // ==========================================================================

  const handleArchive =
    useCallback(
      async () => {
        if (
          !conversationId ||
          archiving
        ) {
          return;
        }

        const confirmed =
          window.confirm(
            "Archive this conversation? It will no longer appear as an active conversation."
          );

        if (!confirmed) {
          return;
        }

        setArchiving(true);

        try {
          await api.post(
            `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(
              conversationId
            )}/archive`
          );

          if (
            !mountedRef.current
          ) {
            return;
          }

          setConversation(
            (current) =>
              current
                ? {
                    ...current,
                    status:
                      "archived",
                  }
                : current
          );

          toast.success(
            "Conversation archived successfully."
          );
        } catch (err) {
          if (
            !mountedRef.current
          ) {
            return;
          }

          const message =
            getErrorMessage(
              err,
              "Failed to archive the conversation."
            );

          toast.error(message);
        } finally {
          if (
            mountedRef.current
          ) {
            setArchiving(false);
          }
        }
      },
      [
        archiving,
        conversationId,
      ]
    );

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown =
      (event) => {
        // Escape navigates back unless the user is interacting with a
        // form control where Escape may have another semantic meaning.
        if (
          event.key !==
          "Escape"
        ) {
          return;
        }

        const target =
          event.target;

        const tagName =
          target?.tagName?.toLowerCase();

        if (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select"
        ) {
          return;
        }

        navigateBack();
      };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [navigateBack]);

  // ==========================================================================
  // Derived State
  // ==========================================================================

  const conversationKey =
    useMemo(
      () =>
        conversation
          ? getConversationId(
              conversation
            )
          : "",
      [conversation]
    );

  // ==========================================================================
  // Render: No Selection
  // ==========================================================================

  if (
    !conversationId
  ) {
    return (
      <ConversationErrorBoundary>
        <ConversationEmptyState
          onBack={
            navigateBack
          }
        />
      </ConversationErrorBoundary>
    );
  }

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (
    loading &&
    !conversation
  ) {
    return (
      <ConversationErrorBoundary>
        <ConversationLoading />
      </ConversationErrorBoundary>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  if (
    error &&
    !conversation
  ) {
    return (
      <ConversationErrorBoundary>
        <ConversationLoadError
          message={error}
          retrying={
            retrying
          }
          onRetry={() =>
            loadConversation({
              isRetry:
                true,
            })
          }
          onBack={
            navigateBack
          }
        />
      </ConversationErrorBoundary>
    );
  }

  // ==========================================================================
  // Render: Conversation
  // ==========================================================================

  return (
    <ConversationErrorBoundary>
      <section
        className="flex h-full min-h-[420px] flex-col overflow-hidden bg-white md:rounded-xl md:border md:border-gray-200 md:shadow-sm"
        aria-label="Conversation detail"
      >
        <ConversationHeader
          conversation={
            conversation
          }
          conversationId={
            conversationKey ||
            conversationId
          }
          onBack={
            navigateBack
          }
          onArchive={
            handleArchive
          }
          archiving={
            archiving
          }
        />

        {error && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
          >
            <AlertCircle
              size={15}
              aria-hidden="true"
            />

            <span className="flex-1">
              {error}
            </span>

            <button
              type="button"
              onClick={() =>
                loadConversation()
              }
              className="font-semibold underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        <main
          className="min-h-0 flex-1 overflow-hidden bg-gray-50"
          aria-label="Conversation messages"
        >
          <MessagePanel
            conversation={
              conversation
            }
          />
        </main>

        <footer className="hidden shrink-0 items-center justify-between border-t border-gray-100 bg-white px-4 py-2 text-[11px] text-gray-400 sm:flex">
          <div className="flex items-center gap-2">
            <Check
              size={13}
              aria-hidden="true"
            />
            <span>
              TITech Community
              Capital messaging
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Clock
                size={12}
                aria-hidden="true"
              />
              Secure session
            </span>

            <span
              className="font-mono"
              title={
                conversationKey ||
                conversationId
              }
            >
              {(
                conversationKey ||
                conversationId
              ).slice(0, 12)}
              …
            </span>
          </div>
        </footer>
      </section>
    </ConversationErrorBoundary>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

ConversationDetail.propTypes = {
  conversationId:
    require("prop-types").string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  ConversationDetail
);