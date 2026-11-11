
// ============================================================================
// TITech Community Capital
// Enterprise Community Savings Group Directory
//
// File: frontend/src/pages/GroupList.jsx
//
// Responsibilities:
// - Load community savings groups
// - Normalize supported API response formats
// - Display group information
// - Support authenticated group membership requests
// - Prevent duplicate join operations
// - Reconcile membership against server responses
// - Abort obsolete requests
// - Handle network, authentication and server failures
// - Enforce bounded client-side rendering
// - Provide accessible loading, empty and error states
//
// Security:
// - Existing TITech authentication context is authoritative.
// - Existing RBAC policy determines Create Group visibility.
// - API client manages authentication and tenant context.
// - Backend remains authoritative for membership authorization.
// - Client-side membership status is never an authorization boundary.
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Link } from "react-router-dom";

import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";

import {
  hasTitechRole,
  TITECH_ROLES,
} from "../security/rbacPolicy";

import Spinner from "../components/ui/Spinner";

import logger from "../utils/logger";

import api from "../services/api";

import "./GroupList.css";

// ============================================================================
// Constants
// ============================================================================

const MAX_GROUPS = 500;

const MAX_MEMBERS_PER_GROUP = 500;

const MAX_DESCRIPTION_LENGTH = 220;

const MAX_SERVER_MESSAGE_LENGTH = 240;

const DEFAULT_ERROR_MESSAGE =
  "We could not load the available groups. Please try again.";

const DEFAULT_JOIN_ERROR =
  "We could not join this group. Please try again.";

// ============================================================================
// Utilities
// ============================================================================

function isAbortError(error) {
  return (
    error?.code === "ERR_CANCELED" ||
    error?.name === "AbortError" ||
    error?.name === "CanceledError" ||
    error?.message === "canceled"
  );
}

/**
 * Return user-safe error messages.
 */
function getErrorMessage(error, fallback) {
  const status = error?.response?.status;

  if (
    error?.code === "CLIENT_OFFLINE" ||
    error?.isOffline
  ) {
    return "You appear to be offline. Please reconnect and try again.";
  }

  switch (status) {
    case 400:
      return "The request could not be processed. Please check your information.";

    case 401:
      return "Your session has expired. Please sign in again.";

    case 403:
      return "You are not authorized to perform this action.";

    case 404:
      return "The requested group could not be found.";

    case 409:
      return "You may already be a member of this group.";

    case 422:
      return "The group membership request could not be validated.";

    case 429:
      return "Too many requests. Please wait a moment and try again.";

    case 500:
    case 502:
    case 503:
    case 504:
      return "The TITech service is temporarily unavailable. Please try again.";

    default:
      break;
  }

  // Permit a bounded API message where the server supplied one.
  const serverMessage =
    error?.response?.data?.message;

  if (
    typeof serverMessage === "string" &&
    serverMessage.trim()
  ) {
    return serverMessage
      .trim()
      .slice(0, MAX_SERVER_MESSAGE_LENGTH);
  }

  return (
    fallback ||
    "An unexpected error occurred."
  );
}

/**
 * Safely extract a group identifier.
 */
function getGroupId(group) {
  const id =
    group?._id ??
    group?.id ??
    group?.groupId ??
    null;

  if (
    id === null ||
    id === undefined ||
    String(id).trim() === ""
  ) {
    return null;
  }

  return id;
}

/**
 * Extract authenticated user identifier.
 */
function getUserId(user) {
  const id =
    user?._id ??
    user?.id ??
    user?.userId ??
    null;

  if (
    id === null ||
    id === undefined ||
    String(id).trim() === ""
  ) {
    return null;
  }

  return id;
}

/**
 * Extract member identifier.
 *
 * Supports common representations returned by membership APIs.
 */
function getMemberId(member) {
  if (!member) {
    return null;
  }

  if (
    typeof member === "string" ||
    typeof member === "number"
  ) {
    return member;
  }

  return (
    member?._id ??
    member?.id ??
    member?.userId ??
    member?.memberId ??
    member?.user?._id ??
    member?.user?.id ??
    null
  );
}

/**
 * Normalize membership states.
 */
function normalizeMembershipStatus(status) {
  if (
    typeof status !== "string" &&
    typeof status !== "number"
  ) {
    return null;
  }

  const normalized = String(status)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return normalized || null;
}

/**
 * Support common API response envelopes:
 *
 * response.data
 * response.data.data
 * response.data.groups
 * response.groups
 * response.items
 * response.results
 */
function normalizeGroups(payload) {
  const queue = [payload];

  const visited = new Set();

  let data = null;

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      data = current;
      break;
    }

    if (
      !current ||
      typeof current !== "object" ||
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);

    for (const key of [
      "data",
      "groups",
      "items",
      "results",
      "records",
    ]) {
      if (current[key] !== undefined) {
        queue.push(current[key]);
      }
    }
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const seen = new Set();

  return data
    .filter((group) => {
      if (
        !group ||
        typeof group !== "object"
      ) {
        return false;
      }

      const id = getGroupId(group);

      if (
        id === null ||
        seen.has(String(id))
      ) {
        return false;
      }

      seen.add(String(id));

      return true;
    })
    .slice(0, MAX_GROUPS);
}

/**
 * Normalize a group before rendering.
 */
function normalizeGroup(group) {
  if (
    !group ||
    typeof group !== "object"
  ) {
    return null;
  }

  return {
    ...group,

    _id: getGroupId(group),

    members: Array.isArray(group.members)
      ? group.members.slice(
          0,
          MAX_MEMBERS_PER_GROUP
        )
      : [],
  };
}

/**
 * Safely display bounded group descriptions.
 */
function truncateDescription(value) {
  const description =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!description) {
    return "No description provided.";
  }

  if (
    description.length <=
    MAX_DESCRIPTION_LENGTH
  ) {
    return description;
  }

  return (
    description
      .slice(0, MAX_DESCRIPTION_LENGTH)
      .trim() + "…"
  );
}

/**
 * Resolve group member count.
 */
function getMemberCount(group) {
  const count = group?.memberCount;

  if (
    count !== null &&
    count !== undefined &&
    count !== "" &&
    Number.isFinite(Number(count))
  ) {
    return Math.max(0, Number(count));
  }

  if (Array.isArray(group?.members)) {
    return group.members.length;
  }

  return 0;
}

/**
 * Resolve the authenticated user's membership record.
 */
function getUserMembership(group, userId) {
  if (!group || !userId) {
    return null;
  }

  const matchingRole = Array.isArray(
    group.memberRoles
  )
    ? group.memberRoles.find(
        (entry) =>
          String(getMemberId(entry)) ===
          String(userId)
      )
    : null;

  if (matchingRole) {
    return matchingRole;
  }

  const matchingMember = Array.isArray(
    group.members
  )
    ? group.members.find(
        (entry) =>
          String(getMemberId(entry)) ===
          String(userId)
      )
    : null;

  return matchingMember || null;
}

/**
 * Determine the authenticated user's membership state.
 */
function getMembershipStatus(group, userId) {
  if (!group || !userId) {
    return null;
  }

  const membership = getUserMembership(
    group,
    userId
  );

  const rawStatus =
    membership?.membershipStatus ??
    membership?.invitationStatus ??
    membership?.status ??
    group.membershipStatus ??
    null;

  return normalizeMembershipStatus(rawStatus);
}

/**
 * Determine whether the current authenticated user
 * is already a group member.
 */
function isUserMember(group, userId) {
  if (!group || !userId) {
    return false;
  }

  if (
    group.isMember === true ||
    group.member === true
  ) {
    return true;
  }

  const membershipStatus =
    getMembershipStatus(group, userId);

  if (
    ["active", "reinstated"].includes(
      membershipStatus
    )
  ) {
    return true;
  }

  if (!Array.isArray(group.members)) {
    return false;
  }

  return group.members.some(
    (member) =>
      String(getMemberId(member)) ===
      String(userId)
  );
}

/**
 * Resolve join response status from supported response envelopes.
 */
function getJoinResponseStatus(response) {
  const candidates = [
    response?.data?.data,
    response?.data,
    response,
  ];

  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object"
    ) {
      continue;
    }

    const status =
      candidate.membershipStatus ??
      candidate.membership?.membershipStatus ??
      candidate.membership?.status ??
      null;

    if (status) {
      return normalizeMembershipStatus(status);
    }
  }

  return null;
}

// ============================================================================
// Group Card
// ============================================================================

function GroupCard({
  group,
  userId,
  joining,
  onJoin,
}) {
  const groupId = getGroupId(group);

  const normalizedId = groupId
    ? String(groupId)
    : null;

  const isJoining =
    normalizedId !== null &&
    joining === normalizedId;

  const alreadyMember =
    isUserMember(group, userId);

  const membershipStatus =
    getMembershipStatus(group, userId);

  const hasPendingMembership =
    membershipStatus === "pending";

  const memberCount =
    getMemberCount(group);

  const groupName = String(
    group?.name ||
    group?.title ||
    "Unnamed Group"
  ).trim();

  const description =
    truncateDescription(
      group?.description
    );

  const statusLabel = alreadyMember
    ? "Member"
    : hasPendingMembership
      ? "Pending approval"
      : isJoining
        ? "Joining"
        : "Available";

  return (
    <li className="group-list-card">
      <article
        className="group-list-card__content"
        aria-labelledby={`group-name-${normalizedId}`}
      >

        <div className="group-list-card__header">

          <div className="group-list-card__identity">

            <div
              className="group-list-card__avatar"
              aria-hidden="true"
            >
              {groupName
                .charAt(0)
                .toUpperCase()}
            </div>

            <div>
              <h3
                id={`group-name-${normalizedId}`}
                className="group-list-card__title"
              >
                {groupName}
              </h3>

              <span
                className={`group-list-card__status ${
                  alreadyMember
                    ? "group-list-card__status--member"
                    : ""
                }`}
              >
                {statusLabel}
              </span>
            </div>

          </div>

        </div>

        <p className="group-list-card__description">
          {description}
        </p>

        <dl className="group-list-card__metadata">

          <div className="group-list-card__metadata-item">

            <dt>Members</dt>

            <dd>
              {memberCount.toLocaleString()}
            </dd>

          </div>

          {group?.frequency && (
            <div className="group-list-card__metadata-item">

              <dt>Contribution</dt>

              <dd>
                {String(group.frequency)}
              </dd>

            </div>
          )}

          {group?.status && (
            <div className="group-list-card__metadata-item">

              <dt>Status</dt>

              <dd>
                {String(group.status)}
              </dd>

            </div>
          )}

        </dl>

        <div className="group-list-card__actions">

          {groupId && (
            <Link
              to={`/groups/${encodeURIComponent(
                normalizedId
              )}`}
              className="group-list-card__details-button"
              aria-label={`View details for ${groupName}`}
            >
              View details
            </Link>
          )}

          {alreadyMember ? (
            <Link
              to={`/groups/${encodeURIComponent(
                normalizedId
              )}`}
              className="group-list-card__join-button group-list-card__join-button--member"
            >
              Open group
            </Link>
          ) : hasPendingMembership ? (
            <button
              type="button"
              disabled
              className="group-list-card__join-button group-list-card__join-button--pending"
            >
              Pending approval
            </button>
          ) : !userId ? (
            <Link
              to="/login"
              className="group-list-card__join-button"
              aria-label={`Sign in to join ${groupName}`}
            >
              Sign in to join
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onJoin(normalizedId)}
              disabled={
                !normalizedId ||
                isJoining ||
                joining !== null
              }
              className="group-list-card__join-button"
              aria-busy={isJoining}
            >
              {isJoining
                ? "Joining…"
                : "Join group"}
            </button>
          )}

        </div>

      </article>
    </li>
  );
}

// ============================================================================
// Group List Page
// ============================================================================

export default function GroupList() {

  // --------------------------------------------------------------------------
  // Authentication and RBAC
  // --------------------------------------------------------------------------

  const auth = useAuth();

  const user = auth?.user ?? null;

  const userId = useMemo(
    () => getUserId(user),
    [user]
  );

  // Preserve the existing TITech RBAC policy.
  // This controls frontend presentation only.
  const canCreateGroup = Boolean(
    user &&
    hasTitechRole(
      [
        user?.role,
        ...(Array.isArray(user?.roles)
          ? user.roles
          : []),
      ],
      [
        TITECH_ROLES.PLATFORM_ADMIN,
        TITECH_ROLES.TENANT_ADMIN,
      ]
    )
  );

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const [groups, setGroups] = useState([]);

  const [joining, setJoining] = useState(null);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState(null);

  const [lastUpdated, setLastUpdated] = useState(null);

  // --------------------------------------------------------------------------
  // Request lifecycle references
  // --------------------------------------------------------------------------

  const mountedRef = useRef(false);

  const fetchAbortRef = useRef(null);

  const joinAbortRef = useRef(null);

  // State updates are asynchronous. A ref provides immediate
  // protection against duplicate join requests.
  const joinLockRef = useRef(false);

  // ==========================================================================
  // Fetch Groups
  // ==========================================================================

  const fetchGroups = useCallback(
    async ({ silent = false } = {}) => {

      if (!mountedRef.current) {
        return;
      }

      // Cancel obsolete group-list requests.
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }

      const controller = new AbortController();

      fetchAbortRef.current = controller;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const response = await api.get(
          "/groups",
          {
            signal: controller.signal,
          }
        );

        if (
          !mountedRef.current ||
          controller.signal.aborted
        ) {
          return;
        }

        const normalized =
          normalizeGroups(response);

        setGroups(normalized);

        setLastUpdated(new Date());

      } catch (err) {

        if (
          isAbortError(err) ||
          controller.signal.aborted
        ) {
          return;
        }

        const message = getErrorMessage(
          err,
          DEFAULT_ERROR_MESSAGE
        );

        if (mountedRef.current) {
          setError(message);
        }

        try {
          logger?.warn?.(
            "TITech GroupList fetch failed",
            {
              error: message,
              status: err?.response?.status,
            }
          );
        } catch (_) {
          // Logging must never break application flow.
        }

      } finally {

        // An old request must never clear the state
        // of a newer active request.
        if (
          mountedRef.current &&
          fetchAbortRef.current === controller
        ) {
          setLoading(false);
          setRefreshing(false);
          fetchAbortRef.current = null;
        }
      }
    },
    []
  );

  // ==========================================================================
  // Initial Load and Cleanup
  // ==========================================================================

  useEffect(() => {

    mountedRef.current = true;

    void fetchGroups();

    return () => {

      mountedRef.current = false;

      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
      }

      if (joinAbortRef.current) {
        joinAbortRef.current.abort();
      }

      fetchAbortRef.current = null;

      joinAbortRef.current = null;

      joinLockRef.current = false;
    };

  }, [fetchGroups]);

  // ==========================================================================
  // Join Group
  // ==========================================================================

  const joinGroup = useCallback(
    async (groupId) => {

      const normalizedGroupId =
        String(groupId || "").trim();

      if (!normalizedGroupId) {
        toast.error(
          "This group cannot be joined because its identifier is missing."
        );
        return;
      }

      if (!userId) {
        toast.error(
          "Please sign in before joining a group."
        );

        return;
      }

      // Synchronous protection against rapid repeated clicks.
      if (joinLockRef.current) {
        return;
      }

      const targetGroup = groups.find(
        (group) =>
          String(getGroupId(group)) ===
          normalizedGroupId
      );

      if (!targetGroup) {
        toast.error(
          "The selected group is no longer available."
        );

        return;
      }

      if (isUserMember(targetGroup, userId)) {
        toast.info(
          "You are already a member of this group."
        );

        return;
      }

      if (
        getMembershipStatus(
          targetGroup,
          userId
        ) === "pending"
      ) {
        toast.info(
          "Your membership request is already pending approval."
        );

        return;
      }

      if (!mountedRef.current) {
        return;
      }

      joinLockRef.current = true;

      const controller = new AbortController();

      joinAbortRef.current = controller;

      setJoining(normalizedGroupId);

      try {

        const joinResponse = await api.post(
          `/groups/join/${encodeURIComponent(
            normalizedGroupId
          )}`,
          null,
          {
            signal: controller.signal,
          }
        );

        if (
          !mountedRef.current ||
          controller.signal.aborted
        ) {
          return;
        }

        const responseStatus =
          getJoinResponseStatus(joinResponse);

        if (responseStatus === "active") {

          toast.success(
            "You joined the group."
          );

        } else if (
          responseStatus === "pending"
        ) {

          toast.success(
            "Your membership request is pending approval."
          );

        } else {

          toast.success(
            "Your membership request was submitted."
          );
        }

        // Reconcile against authoritative backend membership state.
        // Do not assume that a successful HTTP response means
        // membership has already become active.
        await fetchGroups({
          silent: true,
        });

      } catch (err) {

        if (
          isAbortError(err) ||
          controller.signal.aborted
        ) {
          return;
        }

        const message = getErrorMessage(
          err,
          DEFAULT_JOIN_ERROR
        );

        if (mountedRef.current) {
          toast.error(message);
        }

        try {
          logger?.error?.(
            "TITech GroupList join failed",
            {
              groupId: normalizedGroupId,
              status: err?.response?.status,
              error: message,
            }
          );
        } catch (_) {
          // Logging must never interrupt application flow.
        }

      } finally {

        if (
          mountedRef.current &&
          joinAbortRef.current === controller
        ) {
          setJoining(null);

          joinAbortRef.current = null;

          joinLockRef.current = false;
        }
      }
    },
    [
      fetchGroups,
      groups,
      userId,
    ]
  );

  // ==========================================================================
  // Derived State
  // ==========================================================================

  const hasGroups = groups.length > 0;

  const isAuthenticated = Boolean(userId);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="group-list-page">

      <section className="group-list-container">

        {/* ================================================================ */}
        {/* Page Header                                                       */}
        {/* ================================================================ */}

        <header className="group-list-header">

          <div>

            <span className="group-list-eyebrow">
              TITech Community Capital
            </span>

            <h1
              id="group-list-heading"
              className="group-list-title"
            >
              Community savings groups
            </h1>

            <p className="group-list-subtitle">
              Discover a community group, connect with
              members and build your savings together.
            </p>

          </div>

          <div className="group-list-header-actions">

            <button
              type="button"
              onClick={() =>
                fetchGroups({
                  silent: true,
                })
              }
              disabled={
                loading ||
                refreshing
              }
              className="group-list-refresh-button"
              aria-busy={refreshing}
              aria-label="Refresh available groups"
            >
              {refreshing
                ? "Refreshing…"
                : "Refresh"}
            </button>

            {canCreateGroup && (
              <Link
                to="/create-group"
                className="group-list-create-button"
              >
                Create group
              </Link>
            )}

          </div>

        </header>

        {/* ================================================================ */}
        {/* Authentication Notice                                            */}
        {/* ================================================================ */}

        {!isAuthenticated && (

          <div
            className="group-list-auth-notice"
            role="status"
          >

            <div>

              <strong>
                Sign in to join a group.
              </strong>

              <p>
                You can browse available groups, but
                membership actions require an authenticated
                TITech account.
              </p>

            </div>

            <Link
              to="/login"
              className="group-list-auth-link"
            >
              Sign in
            </Link>

          </div>
        )}

        {/* ================================================================ */}
        {/* Error State                                                       */}
        {/* ================================================================ */}

        {error && (

          <div
            className="group-list-error"
            role="alert"
            aria-live="assertive"
          >

            <div>

              <strong>
                Unable to load groups
              </strong>

              <p>{error}</p>

              {hasGroups && (
                <p>
                  Previously loaded groups are still
                  displayed. Refresh to retrieve the latest
                  membership information.
                </p>
              )}

            </div>

            <button
              type="button"
              onClick={() =>
                fetchGroups()
              }
              disabled={loading}
              className="group-list-error-button"
            >
              Try again
            </button>

          </div>
        )}

        {/* ================================================================ */}
        {/* Loading State                                                     */}
        {/* ================================================================ */}

        {loading && (

          <div className="group-list-loading">

            <Spinner
              size="lg"
              label="Loading community groups..."
              showLabel
            />

          </div>
        )}

        {/* ================================================================ */}
        {/* Empty State                                                       */}
        {/* ================================================================ */}

        {!loading &&
          !error &&
          !hasGroups && (

            <div
              className="group-list-empty"
              role="status"
            >

              <div
                className="group-list-empty-icon"
                aria-hidden="true"
              >
                +
              </div>

              <h2>
                No groups available
              </h2>

              <p>
                There are currently no community savings
                groups available to join.
              </p>

              {canCreateGroup && (
                <Link
                  to="/create-group"
                  className="group-list-empty-button"
                >
                  Create the first group
                </Link>
              )}

            </div>
          )}

        {/* ================================================================ */}
        {/* Group Results                                                     */}
        {/* ================================================================ */}

        {!loading &&
          hasGroups && (

            <section
              className="group-list-results"
              aria-labelledby="available-groups-heading"
            >

              <div className="group-list-results-header">

                <div>

                  <h2
                    id="available-groups-heading"
                    className="group-list-results-title"
                  >
                    Available groups
                  </h2>

                  <p className="group-list-results-count">

                    {groups.length.toLocaleString()}{" "}

                    {groups.length === 1
                      ? "group"
                      : "groups"}

                    {" "}loaded

                  </p>

                </div>

                {lastUpdated && (

                  <time
                    className="group-list-updated"
                    dateTime={lastUpdated.toISOString()}
                  >
                    Updated{" "}
                    {lastUpdated.toLocaleTimeString(
                      [],
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </time>

                )}

              </div>

              <ul className="group-list-grid">

                {groups.map((group) => {

                  const normalizedGroup =
                    normalizeGroup(group);

                  const id =
                    getGroupId(normalizedGroup);

                  if (!id) {
                    return null;
                  }

                  return (

                    <GroupCard
                      key={String(id)}
                      group={normalizedGroup}
                      userId={userId}
                      joining={joining}
                      onJoin={joinGroup}
                    />

                  );
                })}

              </ul>

              {groups.length >= MAX_GROUPS && (
                <p
                  className="group-list-results-count"
                  role="status"
                >
                  The maximum client-side display limit
                  has been reached. Further groups require
                  server-side pagination.
                </p>
              )}

            </section>
          )}

      </section>

    </div>
  );
}
