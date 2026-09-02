// ============================================================================
// TITech Community Capital
// Enterprise Conversation List
//
// File:
// frontend/src/pages/ConversationList.js
//
// Production Grade
// ============================================================================
//
// FEATURES
// - Defensive conversation normalization
// - Redux/store-backed conversation retrieval
// - Search and filtering
// - Client-side pagination
// - Configurable page size
// - Refresh/retry support
// - Loading skeletons
// - Empty/error states
// - Unread message indicators
// - Accessible keyboard navigation
// - Stable rendering keys
// - Safe timestamp formatting
// - Mounted-request protection
// - Memoized derived state
// - Enterprise-grade defensive defaults
//
// IMPORTANT
//
// This component intentionally does not introduce a new state-management
// dependency. It consumes the existing chat store architecture.
//
// Project consistency:
// - TITech terminology is used throughout.
// - No "ACFOS" references.
// - No redux/actions directory naming is introduced.
// ============================================================================

"use strict";

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PropTypes from "prop-types";

import { useDispatch, useSelector } from "react-redux";

import {
  Search,
  RefreshCw,
  MessageSquare,
  AlertTriangle,
  Inbox,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react";

import ConversationItem from "../components/chat/ConversationItem";
import Spinner from "../components/ui/Spinner";

import {
  fetchConversations,
} from "../store/chat/chatOperations";

import {
  selectConversations,
  selectConversationsLoading,
  selectConversationsError,
} from "../store/chat/chatSelectors";

import logger from "../utils/logger";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;

const PAGE_SIZE_OPTIONS = Object.freeze([
  10,
  25,
  50,
]);

const MAX_SEARCH_LENGTH = 200;

const EMPTY_ARRAY = Object.freeze([]);

const EMPTY_STRING = "";

const DEFAULT_TITLE = "Conversation";

const DEFAULT_LAST_MESSAGE = "";

const DEFAULT_UNREAD_COUNT = 0;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Safely normalize an identifier.
 */
function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    const normalized = String(value).trim();

    return normalized || null;
  }

  if (
    typeof value === "object" &&
    typeof value.toString === "function"
  ) {
    try {
      const normalized = value.toString().trim();

      return normalized || null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Resolve a conversation ID defensively.
 */
function getConversationId(conversation, index = 0) {
  if (!conversation || typeof conversation !== "object") {
    return `conversation-${index}`;
  }

  const id =
    conversation.id ??
    conversation._id ??
    conversation.conversationId ??
    conversation.uuid;

  return (
    normalizeId(id) ||
    `conversation-${index}`
  );
}

/**
 * Safely convert an arbitrary value to a searchable string.
 */
function safeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return EMPTY_STRING;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return EMPTY_STRING;
  }
}

/**
 * Safely normalize participant information.
 */
function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) {
    return EMPTY_ARRAY;
  }

  return participants
    .filter(
      (participant) =>
        participant !== null &&
        participant !== undefined
    )
    .map((participant) => {
      if (
        typeof participant === "string" ||
        typeof participant === "number"
      ) {
        return {
          id: String(participant),
          name: String(participant),
          email: "",
        };
      }

      if (
        typeof participant !== "object"
      ) {
        return {
          id: "",
          name: "",
          email: "",
        };
      }

      return {
        id:
          normalizeId(
            participant.id ??
              participant._id ??
              participant.userId
          ) || "",
        name:
          safeString(
            participant.name ??
              participant.fullName ??
              participant.displayName
          ).trim(),
        email:
          safeString(
            participant.email
          ).trim(),
      };
    });
}

/**
 * Normalize one conversation into a predictable internal representation.
 */
function normalizeConversation(
  conversation,
  index
) {
  if (
    !conversation ||
    typeof conversation !== "object"
  ) {
    return null;
  }

  const id =
    getConversationId(
      conversation,
      index
    );

  const participants =
    normalizeParticipants(
      conversation.participants ??
        conversation.members ??
        conversation.users
    );

  const title =
    safeString(
      conversation.title ??
        conversation.subject ??
        conversation.name
    ).trim() || DEFAULT_TITLE;

  const lastMessage =
    safeString(
      conversation.lastMessage ??
        conversation.preview ??
        conversation.lastMessageText ??
        conversation.latestMessage?.content ??
        conversation.latestMessage?.text
    ).trim();

  const updatedAt =
    conversation.updatedAt ??
    conversation.lastUpdated ??
    conversation.modifiedAt ??
    conversation.lastMessageAt ??
    conversation.createdAt ??
    null;

  const unreadRaw =
    conversation.unreadCount ??
    conversation.unread ??
    conversation.unreadMessages ??
    0;

  const unreadCount =
    Number.isFinite(
      Number(unreadRaw)
    )
      ? Math.max(
          0,
          Number(unreadRaw)
        )
      : DEFAULT_UNREAD_COUNT;

  return {
    id,
    title,
    lastMessage:
      lastMessage ||
      DEFAULT_LAST_MESSAGE,
    updatedAt,
    unreadCount,
    participants,
    raw: conversation,
  };
}

/**
 * Format a conversation timestamp safely.
 */
function formatConversationTime(
  timestamp
) {
  if (!timestamp) {
    return EMPTY_STRING;
  }

  const date =
    timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return EMPTY_STRING;
  }

  const now = new Date();

  const sameDay =
    date.toDateString() ===
    now.toDateString();

  if (sameDay) {
    return new Intl.DateTimeFormat(
      undefined,
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    ).format(date);
  }

  const diff =
    now.getTime() -
    date.getTime();

  const oneDay =
    24 * 60 * 60 * 1000;

  if (
    diff >= 0 &&
    diff < 7 * oneDay
  ) {
    return new Intl.DateTimeFormat(
      undefined,
      {
        weekday: "short",
      }
    ).format(date);
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() !==
        now.getFullYear()
          ? "numeric"
          : undefined,
    }
  ).format(date);
}

/**
 * Build participant search text.
 */
function getParticipantSearchText(
  participants
) {
  if (
    !Array.isArray(participants)
  ) {
    return EMPTY_STRING;
  }

  return participants
    .map(
      (participant) =>
        `${participant?.name || ""} ${
          participant?.email || ""
        }`
    )
    .join(" ");
}

/**
 * Normalize search input.
 */
function normalizeSearchQuery(
  value
) {
  return safeString(value)
    .slice(
      0,
      MAX_SEARCH_LENGTH
    )
    .trim()
    .toLowerCase();
}

// ============================================================================
// LOADING SKELETON
// ============================================================================

const ConversationSkeleton = memo(
  function ConversationSkeleton() {
    return (
      <div
        className="divide-y divide-gray-100"
        aria-hidden="true"
      >
        {[1, 2, 3, 4, 5].map(
          (item) => (
            <div
              key={item}
              className="flex items-center gap-4 px-4 py-4 animate-pulse"
            >
              <div className="h-11 w-11 rounded-full bg-gray-200" />

              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-gray-200" />
                <div className="h-3 w-2/3 rounded bg-gray-200" />
              </div>

              <div className="h-3 w-16 rounded bg-gray-200" />
            </div>
          )
        )}
      </div>
    );
  }
);

// ============================================================================
// EMPTY STATE
// ============================================================================

const EmptyConversationState = memo(
  function EmptyConversationState({
    hasSearch,
    onClearSearch,
  }) {
    return (
      <div
        className="flex flex-col items-center justify-center px-6 py-16 text-center"
        role="status"
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          {hasSearch ? (
            <Search size={26} />
          ) : (
            <Inbox size={26} />
          )}
        </div>

        <h3 className="text-base font-semibold text-gray-900">
          {hasSearch
            ? "No conversations found"
            : "No conversations yet"}
        </h3>

        <p className="mt-2 max-w-md text-sm text-gray-500">
          {hasSearch
            ? "Try a different search term or clear the current filter."
            : "Conversations will appear here when messages are exchanged through the TITech Community Capital platform."}
        </p>

        {hasSearch &&
          typeof onClearSearch ===
            "function" && (
            <button
              type="button"
              onClick={onClearSearch}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <X size={16} />
              Clear search
            </button>
          )}
      </div>
    );
  }
);

EmptyConversationState.propTypes = {
  hasSearch: PropTypes.bool,
  onClearSearch: PropTypes.func,
};

// ============================================================================
// ERROR STATE
// ============================================================================

const ConversationErrorState = memo(
  function ConversationErrorState({
    message,
    onRetry,
  }) {
    return (
      <div
        className="flex flex-col items-center justify-center px-6 py-14 text-center"
        role="alert"
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle size={26} />
        </div>

        <h3 className="text-base font-semibold text-gray-900">
          Unable to load conversations
        </h3>

        <p className="mt-2 max-w-md text-sm text-gray-500">
          {message ||
            "Something went wrong while loading your conversations."}
        </p>

        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    );
  }
);

ConversationErrorState.propTypes = {
  message: PropTypes.string,
  onRetry: PropTypes.func.isRequired,
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function ConversationList({
  initialPageSize = DEFAULT_PAGE_SIZE,
  showSearch = true,
}) {
  const dispatch = useDispatch();

  const mountedRef =
    useRef(false);

  const requestRef =
    useRef(0);

  // --------------------------------------------------------------------------
  // Store
  // --------------------------------------------------------------------------

  const storeConversations =
    useSelector(
      selectConversations
    );

  const storeLoading =
    useSelector(
      selectConversationsLoading
    );

  const storeError =
    useSelector(
      selectConversationsError
    );

  // --------------------------------------------------------------------------
  // Local UI state
  // --------------------------------------------------------------------------

  const [query, setQuery] =
    useState("");

  const [
    pageSize,
    setPageSize,
  ] = useState(() => {
    const numeric =
      Number(initialPageSize);

    return PAGE_SIZE_OPTIONS.includes(
      numeric
    )
      ? numeric
      : DEFAULT_PAGE_SIZE;
  });

  const [page, setPage] =
    useState(1);

  const [refreshing, setRefreshing] =
    useState(false);

  const [localError, setLocalError] =
    useState("");

  // --------------------------------------------------------------------------
  // Normalize conversations
  // --------------------------------------------------------------------------

  const conversations = useMemo(
    () =>
      Array.isArray(
        storeConversations
      )
        ? storeConversations
            .map(
              normalizeConversation
            )
            .filter(Boolean)
        : EMPTY_ARRAY,
    [storeConversations]
  );

  // --------------------------------------------------------------------------
  // Deduplicate conversations
  // --------------------------------------------------------------------------

  const uniqueConversations =
    useMemo(() => {
      const seen =
        new Set();

      return conversations.filter(
        (conversation) => {
          if (
            seen.has(
              conversation.id
            )
          ) {
            return false;
          }

          seen.add(
            conversation.id
          );

          return true;
        }
      );
    }, [conversations]);

  // --------------------------------------------------------------------------
  // Fetch conversations
  // --------------------------------------------------------------------------

  const loadConversations =
    useCallback(
      async ({
        force = false,
      } = {}) => {
        const requestId =
          ++requestRef.current;

        if (!mountedRef.current) {
          return;
        }

        if (force) {
          setRefreshing(true);
        }

        setLocalError("");

        try {
          await dispatch(
            fetchConversations({
              force,
            })
          );

          if (
            !mountedRef.current ||
            requestId !==
              requestRef.current
          ) {
            return;
          }
        } catch (error) {
          if (
            !mountedRef.current ||
            requestId !==
              requestRef.current
          ) {
            return;
          }

          const message =
            error?.response
              ?.data?.message ||
            error?.message ||
            "Failed to load conversations.";

          setLocalError(
            message
          );

          try {
            logger?.warn?.(
              "TITech conversation list loading failed",
              {
                message,
                error:
                  error?.message,
              }
            );
          } catch {
            // Logging must never break UI.
          }
        } finally {
          if (
            mountedRef.current &&
            requestId ===
              requestRef.current
          ) {
            setRefreshing(false);
          }
        }
      },
      [dispatch]
    );

  // --------------------------------------------------------------------------
  // Initial load
  // --------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current =
      true;

    if (
      !Array.isArray(
        storeConversations
      ) ||
      storeConversations.length ===
        0
    ) {
      loadConversations();
    }

    return () => {
      mountedRef.current =
        false;
      requestRef.current +=
        1;
    };
  }, [
    loadConversations,
    storeConversations,
  ]);

  // --------------------------------------------------------------------------
  // Search filtering
  // --------------------------------------------------------------------------

  const normalizedQuery =
    useMemo(
      () =>
        normalizeSearchQuery(
          query
        ),
      [query]
    );

  const filteredConversations =
    useMemo(() => {
      if (!normalizedQuery) {
        return uniqueConversations;
      }

      return uniqueConversations.filter(
        (conversation) => {
          const searchableText =
            [
              conversation.title,
              conversation.lastMessage,
              getParticipantSearchText(
                conversation.participants
              ),
              conversation.id,
            ]
              .join(" ")
              .toLowerCase();

          return searchableText.includes(
            normalizedQuery
          );
        }
      );
    }, [
      uniqueConversations,
      normalizedQuery,
    ]);

  // --------------------------------------------------------------------------
  // Pagination
  // --------------------------------------------------------------------------

  const total =
    filteredConversations.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total / pageSize
      )
    );

  const pageSafe =
    Math.min(
      Math.max(
        1,
        page
      ),
      totalPages
    );

  const pageRows =
    useMemo(() => {
      const start =
        (pageSafe - 1) *
        pageSize;

      return filteredConversations.slice(
        start,
        start + pageSize
      );
    }, [
      filteredConversations,
      pageSafe,
      pageSize,
    ]);

  // --------------------------------------------------------------------------
  // Clamp page when result count changes.
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (page !== pageSafe) {
      setPage(pageSafe);
    }
  }, [
    page,
    pageSafe,
  ]);

  // --------------------------------------------------------------------------
  // Search/page-size reset
  // --------------------------------------------------------------------------

  useEffect(() => {
    setPage(1);
  }, [
    normalizedQuery,
    pageSize,
  ]);

  // --------------------------------------------------------------------------
  // Search change
  // --------------------------------------------------------------------------

  const handleSearchChange =
    useCallback((event) => {
      const value =
        event?.target?.value ??
        "";

      setQuery(
        String(value).slice(
          0,
          MAX_SEARCH_LENGTH
        )
      );

      setPage(1);
    }, []);

  // --------------------------------------------------------------------------
  // Clear search
  // --------------------------------------------------------------------------

  const handleClearSearch =
    useCallback(() => {
      setQuery("");
      setPage(1);
    }, []);

  // --------------------------------------------------------------------------
  // Page size
  // --------------------------------------------------------------------------

  const handlePageSizeChange =
    useCallback(
      (event) => {
        const next =
          Number(
            event?.target?.value
          );

        if (
          !PAGE_SIZE_OPTIONS.includes(
            next
          )
        ) {
          return;
        }

        setPageSize(next);
        setPage(1);
      },
      []
    );

  // --------------------------------------------------------------------------
  // Pagination handlers
  // --------------------------------------------------------------------------

  const goFirst =
    useCallback(() => {
      setPage(1);
    }, []);

  const goPrevious =
    useCallback(() => {
      setPage((current) =>
        Math.max(
          1,
          current - 1
        )
      );
    }, []);

  const goNext =
    useCallback(() => {
      setPage((current) =>
        Math.min(
          totalPages,
          current + 1
        )
      );
    }, [totalPages]);

  const goLast =
    useCallback(() => {
      setPage(totalPages);
    }, [totalPages]);

  // --------------------------------------------------------------------------
  // Refresh
  // --------------------------------------------------------------------------

  const handleRefresh =
    useCallback(() => {
      if (refreshing) {
        return;
      }

      loadConversations({
        force: true,
      });
    }, [
      loadConversations,
      refreshing,
    ]);

  // --------------------------------------------------------------------------
  // Derived loading/error state
  // --------------------------------------------------------------------------

  const loading =
    Boolean(storeLoading);

  const error =
    localError ||
    safeString(
      storeError
    );

  const initialLoading =
    loading &&
    uniqueConversations.length ===
      0 &&
    !refreshing;

  // --------------------------------------------------------------------------
  // Accessibility label
  // --------------------------------------------------------------------------

  const resultDescription =
    normalizedQuery
      ? `${total} conversation${
          total === 1
            ? ""
            : "s"
        } matching ${query}`
      : `${total} conversation${
          total === 1
            ? ""
            : "s"
        }`;

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (initialLoading) {
    return (
      <section
        aria-labelledby="titech-conversations-heading"
        className="flex h-full min-h-[400px] flex-col overflow-hidden bg-gray-50"
      >
        <div className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
          <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-gray-100" />
        </div>

        <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <ConversationSkeleton />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="titech-conversations-heading"
      className="flex h-full min-h-[400px] flex-col overflow-hidden bg-gray-50"
    >
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}

      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <MessageSquare
                  size={21}
                  aria-hidden="true"
                />
              </div>

              <div className="min-w-0">
                <h1
                  id="titech-conversations-heading"
                  className="truncate text-xl font-bold tracking-tight text-gray-900"
                >
                  Conversations
                </h1>

                <p className="mt-0.5 text-sm text-gray-500">
                  TITech Community Capital
                  communications
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {showSearch && (
              <div className="relative">
                <label
                  htmlFor="titech-conversation-search"
                  className="sr-only"
                >
                  Search conversations
                </label>

                <Search
                  size={17}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />

                <input
                  id="titech-conversation-search"
                  type="search"
                  value={query}
                  onChange={
                    handleSearchChange
                  }
                  placeholder="Search conversations..."
                  autoComplete="off"
                  maxLength={
                    MAX_SEARCH_LENGTH
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 sm:w-72"
                  aria-describedby="conversation-results-description"
                />

                {query && (
                  <button
                    type="button"
                    onClick={
                      handleClearSearch
                    }
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Clear conversation search"
                  >
                    <X
                      size={15}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-600">
              <span className="sr-only">
                Conversations per page
              </span>

              <select
                value={pageSize}
                onChange={
                  handlePageSizeChange
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                aria-label="Conversations per page"
              >
                {PAGE_SIZE_OPTIONS.map(
                  (option) => (
                    <option
                      key={option}
                      value={option}
                    >
                      {option} per page
                    </option>
                  )
                )}
              </select>
            </label>

            <button
              type="button"
              onClick={
                handleRefresh
              }
              disabled={
                refreshing
              }
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Refresh conversations"
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={
                  refreshing
                    ? "animate-spin"
                    : ""
                }
              />

              <span className="hidden sm:inline">
                {refreshing
                  ? "Refreshing..."
                  : "Refresh"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* MAIN */}
      {/* ================================================================== */}

      <main className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col p-4 sm:p-6">
        {/* Error banner */}

        {error && (
          <div
            className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800"
            role="alert"
          >
            <AlertTriangle
              size={19}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Conversation service
                unavailable
              </p>

              <p className="mt-1 break-words text-sm text-red-700">
                {error}
              </p>
            </div>

            <button
              type="button"
              onClick={
                handleRefresh
              }
              className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Retry
            </button>
          </div>
        )}

        {/* Results container */}

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div
            id="conversation-results-description"
            className="flex items-center justify-between border-b border-gray-100 bg-gray-50/70 px-4 py-3 sm:px-5"
          >
            <p className="text-sm text-gray-600">
              {resultDescription}
            </p>

            {refreshing && (
              <div
                className="flex items-center gap-2 text-xs font-medium text-blue-600"
                role="status"
                aria-live="polite"
              >
                <Spinner
                  size="sm"
                  label=""
                />
                Updating...
              </div>
            )}
          </div>

          {pageRows.length ===
          0 ? (
            <EmptyConversationState
              hasSearch={
                Boolean(
                  normalizedQuery
                )
              }
              onClearSearch={
                handleClearSearch
              }
            />
          ) : (
            <div className="relative min-h-0">
              <ul
                role="list"
                aria-label="TITech conversations"
                className="divide-y divide-gray-100"
              >
                {pageRows.map(
                  (
                    conversation
                  ) => (
                    <li
                      key={
                        conversation.id
                      }
                      className="relative transition hover:bg-gray-50 focus-within:bg-gray-50"
                    >
                      <ConversationItem
                        conversation={
                          conversation.raw
                        }

                        // The normalized metadata is supplied as data
                        // attributes where supported by the child component.
                        // This does not alter the existing conversation
                        // object shape.
                      />

                      {conversation.unreadCount >
                        0 && (
                        <span
                          className="pointer-events-none absolute right-4 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-blue-600 ring-2 ring-white"
                          aria-label={`${conversation.unreadCount} unread messages`}
                          title={`${conversation.unreadCount} unread messages`}
                        />
                      )}
                    </li>
                  )
                )}
              </ul>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* PAGINATION */}
        {/* ================================================================= */}

        <footer className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-gray-600">
            Showing{" "}
            <strong className="font-semibold text-gray-900">
              {pageRows.length}
            </strong>{" "}
            of{" "}
            <strong className="font-semibold text-gray-900">
              {total}
            </strong>{" "}
            conversations
          </div>

          <nav
            aria-label="Conversation pagination"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              onClick={
                goFirst
              }
              disabled={
                pageSafe === 1
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="First page"
            >
              <ChevronsLeft
                size={16}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={
                goPrevious
              }
              disabled={
                pageSafe === 1
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft
                size={16}
                aria-hidden="true"
              />
            </button>

            <span
              className="min-w-[110px] px-3 text-center text-sm text-gray-600"
              aria-live="polite"
            >
              Page{" "}
              <strong className="font-semibold text-gray-900">
                {pageSafe}
              </strong>{" "}
              of{" "}
              <strong className="font-semibold text-gray-900">
                {totalPages}
              </strong>
            </span>

            <button
              type="button"
              onClick={
                goNext
              }
              disabled={
                pageSafe ===
                totalPages
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight
                size={16}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={
                goLast
              }
              disabled={
                pageSafe ===
                totalPages
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Last page"
            >
              <ChevronsRight
                size={16}
                aria-hidden="true"
              />
            </button>
          </nav>
        </footer>
      </main>
    </section>
  );
}

// ============================================================================
// PROP TYPES
// ============================================================================

ConversationList.propTypes = {
  initialPageSize:
    PropTypes.number,

  showSearch:
    PropTypes.bool,
};

// ============================================================================
// EXPORT
// ============================================================================

export default memo(
  ConversationList
);