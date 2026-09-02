// ============================================================================
// TITech Community Capital – Group List Page
// File: frontend/src/pages/GroupList.jsx
//
// Enterprise Production Grade
// ============================================================================
//
// Responsibilities:
// - Load available community savings groups
// - Display group metadata
// - Allow authenticated users to join groups
// - Optimistic membership update with rollback
// - Prevent duplicate join operations
// - Abort stale/unmounted requests
// - Handle authentication/network/server failures safely
// - Maintain bounded client-side rendering
// - Accessible loading, error, empty and success states
// - Compatible with TITech Enterprise API Client
//
// Security:
// - Authentication is delegated to services/api.js
// - No access/refresh tokens are read directly
// - Backend authorization remains authoritative
// - Tenant context is supplied by the API client
// - Client-side membership state is never treated as authoritative
//
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';

import { useAuth } from '../context/AuthContext';
import Spinner from '../components/ui/Spinner';
import logger from '../utils/logger';

import api from '../services/api';

import './GroupList.css';

// ============================================================================
// Constants
// ============================================================================

const MAX_GROUPS = 500;
const MAX_DESCRIPTION_LENGTH = 220;

const DEFAULT_ERROR_MESSAGE =
  'We could not load the available groups. Please try again.';

const DEFAULT_JOIN_ERROR =
  'We could not join this group. Please try again.';

// ============================================================================
// Utility Functions
// ============================================================================

function isAbortError(error) {
  return (
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'AbortError' ||
    error?.name === 'CanceledError' ||
    error?.message === 'canceled'
  );
}

function getErrorMessage(error, fallback) {
  if (error?.response?.data?.message) {
    return String(error.response.data.message);
  }

  if (error?.response?.data?.error) {
    return String(error.response.data.error);
  }

  if (
    error?.code === 'CLIENT_OFFLINE' ||
    error?.isOffline
  ) {
    return 'You appear to be offline. Please reconnect and try again.';
  }

  if (error?.response?.status === 401) {
    return 'Your session has expired. Please sign in again.';
  }

  if (error?.response?.status === 403) {
    return 'You are not authorized to perform this action.';
  }

  if (error?.response?.status === 404) {
    return 'The requested group could not be found.';
  }

  if (error?.response?.status === 409) {
    return 'You are already a member of this group.';
  }

  if (error?.response?.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  return (
    error?.message ||
    fallback ||
    'An unexpected error occurred.'
  );
}

function getGroupId(group) {
  return (
    group?._id ||
    group?.id ||
    group?.groupId ||
    null
  );
}

function getUserId(user) {
  return (
    user?._id ||
    user?.id ||
    user?.userId ||
    null
  );
}

function getMemberId(member) {
  if (!member) {
    return null;
  }

  if (typeof member === 'string') {
    return member;
  }

  return (
    member?._id ||
    member?.id ||
    member?.userId ||
    null
  );
}

function normalizeGroups(payload) {
  const data =
    payload?.data?.data ??
    payload?.data ??
    payload ??
    [];

  if (!Array.isArray(data)) {
    return [];
  }

  const seen = new Set();

  return data
    .filter((group) => {
      const id = getGroupId(group);

      if (!id || seen.has(String(id))) {
        return false;
      }

      seen.add(String(id));
      return true;
    })
    .slice(0, MAX_GROUPS);
}

function normalizeGroup(group) {
  if (!group || typeof group !== 'object') {
    return null;
  }

  return {
    ...group,
    _id: getGroupId(group),
    members: Array.isArray(group.members)
      ? group.members.slice(0, MAX_GROUPS)
      : [],
  };
}

function truncateDescription(value) {
  const description = String(value || '').trim();

  if (!description) {
    return 'No description provided.';
  }

  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }

  return `${description.slice(
    0,
    MAX_DESCRIPTION_LENGTH
  ).trim()}…`;
}

function getMemberCount(group) {
  if (Number.isFinite(Number(group?.memberCount))) {
    return Math.max(
      0,
      Number(group.memberCount)
    );
  }

  if (Array.isArray(group?.members)) {
    return group.members.length;
  }

  return 0;
}

function isUserMember(group, userId) {
  if (!group || !userId) {
    return false;
  }

  if (group.isMember === true) {
    return true;
  }

  if (group.member === true) {
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

  const isJoining =
    joining === String(groupId);

  const alreadyMember =
    isUserMember(group, userId);

  const memberCount =
    getMemberCount(group);

  const groupName =
    String(
      group?.name ||
      group?.title ||
      'Unnamed Group'
    ).trim();

  const description =
    truncateDescription(
      group?.description
    );

  const statusLabel = alreadyMember
    ? 'Member'
    : isJoining
      ? 'Joining'
      : 'Available';

  return (
    <li className="group-list-card">
      <article
        className="group-list-card__content"
        aria-labelledby={`group-name-${groupId}`}
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
                id={`group-name-${groupId}`}
                className="group-list-card__title"
              >
                {groupName}
              </h3>

              <span
                className={`group-list-card__status ${
                  alreadyMember
                    ? 'group-list-card__status--member'
                    : ''
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
          {groupId ? (
            <Link
              to={`/groups/${groupId}`}
              className="group-list-card__details-button"
              aria-label={`View details for ${groupName}`}
            >
              View details
            </Link>
          ) : null}

          {alreadyMember ? (
            <Link
              to={`/groups/${groupId}`}
              className="group-list-card__join-button group-list-card__join-button--member"
            >
              Open group
            </Link>
          ) : (
            <button
              type="button"
              onClick={() =>
                onJoin(groupId)
              }
              disabled={
                !groupId ||
                isJoining ||
                joining !== null
              }
              className="group-list-card__join-button"
              aria-busy={isJoining}
              aria-disabled={
                !groupId ||
                isJoining ||
                joining !== null
              }
            >
              {isJoining
                ? 'Joining…'
                : 'Join group'}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

GroupCard.defaultProps = {
  group: null,
  userId: null,
  joining: null,
  onJoin: () => {},
};

// ============================================================================
// Group List
// ============================================================================

export default function GroupList() {
  const { user } = useAuth();

  const [groups, setGroups] = useState([]);
  const [joining, setJoining] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState(null);

  const [lastUpdated, setLastUpdated] =
    useState(null);

  const mountedRef =
    useRef(false);

  const fetchAbortRef =
    useRef(null);

  const joinAbortRef =
    useRef(null);

  const joinSnapshotRef =
    useRef(null);

  const userId = useMemo(
    () => getUserId(user),
    [user]
  );

  // ==========================================================================
  // Fetch Groups
  // ==========================================================================

  const fetchGroups = useCallback(
    async ({
      silent = false,
    } = {}) => {
      if (!mountedRef.current) {
        return;
      }

      if (fetchAbortRef.current) {
        try {
          fetchAbortRef.current.abort();
        } catch (_) {
          // Ignore cancellation failures.
        }
      }

      const controller =
        new AbortController();

      fetchAbortRef.current =
        controller;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const response =
          await api.get(
            '/api/groups',
            {
              signal:
                controller.signal,
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
        setLastUpdated(
          new Date()
        );
      } catch (err) {
        if (
          isAbortError(err) ||
          controller.signal.aborted
        ) {
          return;
        }

        const message =
          getErrorMessage(
            err,
            DEFAULT_ERROR_MESSAGE
          );

        if (mountedRef.current) {
          setError(message);
        }

        try {
          logger?.warn?.(
            'TITech GroupList fetch failed',
            {
              error:
                message,
              status:
                err?.response
                  ?.status,
            }
          );
        } catch (_) {
          // Logging must never break application flow.
        }
      } finally {
        if (
          mountedRef.current &&
          fetchAbortRef.current ===
            controller
        ) {
          setLoading(false);
          setRefreshing(false);
          fetchAbortRef.current =
            null;
        }
      }
    },
    []
  );

  // ==========================================================================
  // Initial Load
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    fetchGroups();

    return () => {
      mountedRef.current = false;

      if (fetchAbortRef.current) {
        try {
          fetchAbortRef.current.abort();
        } catch (_) {
          // Ignore abort failures.
        }
      }

      if (joinAbortRef.current) {
        try {
          joinAbortRef.current.abort();
        } catch (_) {
          // Ignore abort failures.
        }
      }

      fetchAbortRef.current = null;
      joinAbortRef.current = null;
    };
  }, [fetchGroups]);

  // ==========================================================================
  // Join Group
  // ==========================================================================

  const joinGroup = useCallback(
    async (groupId) => {
      const normalizedGroupId =
        String(groupId || '').trim();

      if (!normalizedGroupId) {
        toast.error(
          'This group cannot be joined because its identifier is missing.'
        );
        return;
      }

      if (!userId) {
        toast.error(
          'Please sign in before joining a group.'
        );
        return;
      }

      if (joining !== null) {
        return;
      }

      const targetGroup =
        groups.find(
          (group) =>
            String(
              getGroupId(group)
            ) ===
            normalizedGroupId
        );

      if (!targetGroup) {
        toast.error(
          'The selected group is no longer available.'
        );
        return;
      }

      if (
        isUserMember(
          targetGroup,
          userId
        )
      ) {
        toast.info(
          'You are already a member of this group.'
        );
        return;
      }

      // ----------------------------------------------------------------------
      // Cancel any stale join request.
      // ----------------------------------------------------------------------

      if (joinAbortRef.current) {
        try {
          joinAbortRef.current.abort();
        } catch (_) {
          // Ignore cancellation failures.
        }
      }

      const controller =
        new AbortController();

      joinAbortRef.current =
        controller;

      // ----------------------------------------------------------------------
      // Preserve exact state for rollback.
      // ----------------------------------------------------------------------

      joinSnapshotRef.current =
        groups;

      setJoining(
        normalizedGroupId
      );

      // ----------------------------------------------------------------------
      // Optimistic UI update.
      //
      // This is only a presentation optimization.
      // The backend remains authoritative.
      // ----------------------------------------------------------------------

      setGroups((currentGroups) =>
        currentGroups.map(
          (group) => {
            const currentId =
              String(
                getGroupId(group)
              );

            if (
              currentId !==
              normalizedGroupId
            ) {
              return group;
            }

            const members =
              Array.isArray(
                group.members
              )
                ? [
                    ...group.members,
                  ]
                : [];

            const alreadyExists =
              members.some(
                (member) =>
                  String(
                    getMemberId(
                      member
                    )
                  ) ===
                  String(userId)
              );

            if (
              !alreadyExists
            ) {
              members.push({
                _id: userId,
                id: userId,
                name:
                  user?.name ||
                  user?.fullName ||
                  user?.email ||
                  'You',
              });
            }

            return {
              ...group,
              members:
                members.slice(
                  0,
                  MAX_GROUPS
                ),
              memberCount:
                Math.max(
                  getMemberCount(
                    group
                  ),
                  members.length
                ),
              isMember: true,
              __optimisticJoin:
                true,
            };
          }
        )
      );

      try {
        await api.post(
          `/api/groups/join/${encodeURIComponent(
            normalizedGroupId
          )}`,
          null,
          {
            signal:
              controller.signal,
          }
        );

        if (
          !mountedRef.current ||
          controller.signal.aborted
        ) {
          return;
        }

        toast.success(
          'You successfully joined the group.'
        );

        // --------------------------------------------------------------------
        // Reconcile optimistic state against server state.
        // --------------------------------------------------------------------

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

        const message =
          getErrorMessage(
            err,
            DEFAULT_JOIN_ERROR
          );

        // --------------------------------------------------------------------
        // Roll back optimistic update.
        // --------------------------------------------------------------------

        if (
          mountedRef.current &&
          Array.isArray(
            joinSnapshotRef.current
          )
        ) {
          setGroups(
            joinSnapshotRef.current
          );
        }

        if (
          mountedRef.current
        ) {
          toast.error(
            message
          );
        }

        try {
          logger?.error?.(
            'TITech GroupList join failed',
            {
              groupId:
                normalizedGroupId,
              status:
                err?.response
                  ?.status,
              error:
                message,
            }
          );
        } catch (_) {
          // Logging must never break application flow.
        }
      } finally {
        if (
          mountedRef.current &&
          joinAbortRef.current ===
            controller
        ) {
          setJoining(null);
          joinAbortRef.current =
            null;
          joinSnapshotRef.current =
            null;
        }
      }
    },
    [
      fetchGroups,
      groups,
      joining,
      user,
      userId,
    ]
  );

  // ==========================================================================
  // Derived State
  // ==========================================================================

  const hasGroups =
    groups.length > 0;

  const isAuthenticated =
    Boolean(userId);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main
      className="group-list-page"
      aria-labelledby="group-list-heading"
    >
      <section className="group-list-container">
        {/* ==================================================================
            Page Header
            ================================================================== */}

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
              Discover a community group,
              connect with members and
              build your savings together.
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
              aria-busy={
                refreshing
              }
              aria-label="Refresh available groups"
            >
              {refreshing
                ? 'Refreshing…'
                : 'Refresh'}
            </button>

            <Link
              to="/groups/create"
              className="group-list-create-button"
            >
              Create group
            </Link>
          </div>
        </header>

        {/* ==================================================================
            Authentication Notice
            ================================================================== */}

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
                You can browse available
                groups, but membership
                actions require an
                authenticated TITech
                account.
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

        {/* ==================================================================
            Error State
            ================================================================== */}

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

        {/* ==================================================================
            Loading State
            ================================================================== */}

        {loading && (
          <div
            className="group-list-loading"
            role="status"
            aria-live="polite"
            aria-label="Loading available groups"
          >
            <Spinner label="Loading available groups…" />

            <span>
              Loading community groups…
            </span>
          </div>
        )}

        {/* ==================================================================
            Empty State
            ================================================================== */}

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
                There are currently no
                community savings groups
                available to join.
              </p>

              <Link
                to="/groups/create"
                className="group-list-empty-button"
              >
                Create the first group
              </Link>
            </div>
          )}

        {/* ==================================================================
            Group Grid
            ================================================================== */}

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
                    {groups.length.toLocaleString()}{' '}
                    {groups.length === 1
                      ? 'group'
                      : 'groups'}{' '}
                    available
                  </p>
                </div>

                {lastUpdated && (
                  <time
                    className="group-list-updated"
                    dateTime={
                      lastUpdated.toISOString()
                    }
                  >
                    Updated{' '}
                    {lastUpdated.toLocaleTimeString(
                      [],
                      {
                        hour:
                          '2-digit',
                        minute:
                          '2-digit',
                      }
                    )}
                  </time>
                )}
              </div>

              <ul className="group-list-grid">
                {groups.map(
                  (group) => {
                    const id =
                      getGroupId(
                        group
                      );

                    if (!id) {
                      return null;
                    }

                    return (
                      <GroupCard
                        key={String(id)}
                        group={normalizeGroup(
                          group
                        )}
                        userId={userId}
                        joining={
                          joining
                        }
                        onJoin={
                          joinGroup
                        }
                      />
                    );
                  }
                )}
              </ul>
            </section>
          )}
      </section>
    </main>
  );
}