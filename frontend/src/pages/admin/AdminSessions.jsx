// ============================================================================
// frontend/src/pages/admin/AdminSessions.jsx
// TITech Community Capital
// Enterprise Session Administration Console
// Production Grade
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Globe,
  Monitor,
  RefreshCw,
  Search,
  Shield,
  Smartphone,
  Tablet,
  Users,
} from 'lucide-react';
import { toast } from 'react-toastify';

import api from '../../services/api';

const SESSION_ENDPOINT = '/api/auth/admin/sessions';

const EMPTY_ARRAY = Object.freeze([]);

const safeArray = (value) => (Array.isArray(value) ? value : EMPTY_ARRAY);

const getSessionId = (session) =>
  session?.id ??
  session?._id ??
  session?.sessionId ??
  session?.sid ??
  '';

const getUserId = (session) =>
  session?.userId ??
  session?.user?._id ??
  session?.user?.id ??
  session?.user?.email ??
  '';

const getDeviceInfo = (session) =>
  session?.deviceInfo ??
  session?.device ??
  EMPTY_ARRAY;

const getUserAgent = (session) => {
  const deviceInfo = getDeviceInfo(session);

  return (
    deviceInfo?.ua ??
    deviceInfo?.userAgent ??
    session?.userAgent ??
    ''
  );
};

const getIpAddress = (session) => {
  const deviceInfo = getDeviceInfo(session);

  return (
    deviceInfo?.ip ??
    deviceInfo?.ipAddress ??
    session?.ip ??
    session?.ipAddress ??
    ''
  );
};

const getSessionStatus = (session) => {
  if (session?.revokedAt) {
    return 'revoked';
  }

  if (session?.expiresAt) {
    const expiresAt = new Date(session.expiresAt).getTime();

    if (
      Number.isFinite(expiresAt) &&
      expiresAt <= Date.now()
    ) {
      return 'expired';
    }
  }

  return 'active';
};

const getPayloadSessions = (response) => {
  const data = response?.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  if (Array.isArray(data?.sessions)) {
    return data.sessions;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  return EMPTY_ARRAY;
};

const formatDate = (value) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const getRelativeExpiry = (value) => {
  if (!value) {
    return '';
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const difference = timestamp - Date.now();

  if (difference <= 0) {
    return 'Expired';
  }

  const minutes = Math.floor(difference / 60000);

  if (minutes < 60) {
    return `in ${Math.max(minutes, 1)}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `in ${hours}h`;
  }

  return `in ${Math.floor(hours / 24)}d`;
};

const getDeviceType = (userAgent = '') => {
  const agent = String(userAgent).toLowerCase();

  if (
    agent.includes('ipad') ||
    agent.includes('tablet') ||
    agent.includes('android') &&
      !agent.includes('mobile')
  ) {
    return 'tablet';
  }

  if (
    agent.includes('mobile') ||
    agent.includes('android') ||
    agent.includes('iphone') ||
    agent.includes('ipod')
  ) {
    return 'mobile';
  }

  return 'desktop';
};

const DeviceIcon = ({ userAgent }) => {
  const type = getDeviceType(userAgent);

  if (type === 'mobile') {
    return <Smartphone size={17} aria-hidden="true" />;
  }

  if (type === 'tablet') {
    return <Tablet size={17} aria-hidden="true" />;
  }

  return <Monitor size={17} aria-hidden="true" />;
};

const truncate = (value, maxLength = 32) => {
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…`;
};

const AdminSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [error, setError] = useState('');

  // ==========================================================================
  // FETCH
  // ==========================================================================

  const fetchSessions = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError('');

        const response = await api.get(SESSION_ENDPOINT);

        const payload = getPayloadSessions(response);

        setSessions(payload);
      } catch (requestError) {
        console.error(
          '[TITech AdminSessions] Failed to load sessions:',
          requestError
        );

        const message =
          requestError?.response?.data?.message ||
          requestError?.message ||
          'Failed to load authentication sessions.';

        setError(message);

        if (!silent) {
          toast.error(message);
        } else {
          toast.error('Failed to refresh sessions.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (mounted) {
        await fetchSessions();
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [fetchSessions]);

  // ==========================================================================
  // DERIVED DATA
  // ==========================================================================

  const statistics = useMemo(() => {
    return sessions.reduce(
      (result, session) => {
        const status = getSessionStatus(session);

        result.total += 1;

        if (status === 'active') {
          result.active += 1;
        }

        if (status === 'revoked') {
          result.revoked += 1;
        }

        if (status === 'expired') {
          result.expired += 1;
        }

        return result;
      },
      {
        total: 0,
        active: 0,
        revoked: 0,
        expired: 0,
      }
    );
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return sessions
      .filter((session) => {
        const status = getSessionStatus(session);

        if (
          statusFilter !== 'all' &&
          status !== statusFilter
        ) {
          return false;
        }

        if (!query) {
          return true;
        }

        const searchable = [
          getSessionId(session),
          getUserId(session),
          getIpAddress(session),
          getUserAgent(session),
          session?.user?.name,
          session?.user?.email,
          session?.deviceInfo?.platform,
          session?.deviceInfo?.browser,
          session?.deviceInfo?.os,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return searchable.includes(query);
      })
      .sort((a, b) => {
        const aTime = new Date(
          a?.createdAt || 0
        ).getTime();

        const bTime = new Date(
          b?.createdAt || 0
        ).getTime();

        return bTime - aTime;
      });
  }, [sessions, search, statusFilter]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const refreshSessions = useCallback(() => {
    return fetchSessions({ silent: true });
  }, [fetchSessions]);

  const revokeSession = useCallback(
    async (session) => {
      const sessionId = getSessionId(session);

      if (!sessionId) {
        toast.error(
          'Unable to revoke this session: session identifier is missing.'
        );
        return;
      }

      if (getSessionStatus(session) !== 'active') {
        toast.info(
          'This session is no longer active.'
        );
        return;
      }

      const confirmed = window.confirm(
        'Revoke this authentication session?\n\nThe associated client will need to authenticate again.'
      );

      if (!confirmed) {
        return;
      }

      try {
        setRevokingId(sessionId);

        await api.delete(
          `${SESSION_ENDPOINT}/${encodeURIComponent(
            sessionId
          )}`
        );

        const revokedAt =
          new Date().toISOString();

        setSessions((currentSessions) =>
          currentSessions.map((currentSession) =>
            getSessionId(currentSession) === sessionId
              ? {
                  ...currentSession,
                  revokedAt:
                    currentSession.revokedAt ||
                    revokedAt,
                }
              : currentSession
          )
        );

        toast.success('Session revoked successfully.');
      } catch (requestError) {
        console.error(
          '[TITech AdminSessions] Failed to revoke session:',
          requestError
        );

        toast.error(
          requestError?.response?.data?.message ||
            requestError?.message ||
            'Unable to revoke the session.'
        );
      } finally {
        setRevokingId(null);
      }
    },
    []
  );

  // ==========================================================================
  // ACCESSIBLE LOADING STATE
  // ==========================================================================

  if (loading) {
    return (
      <main
        className="admin-sessions-page"
        aria-busy="true"
        aria-labelledby="admin-sessions-title"
      >
        <div
          className="loading-container"
          role="status"
          aria-live="polite"
        >
          <RefreshCw
            size={40}
            className="animate-spin"
            aria-hidden="true"
          />

          <h1 id="admin-sessions-title">
            Loading Sessions…
          </h1>

          <p>
            Retrieving authentication session data.
          </p>
        </div>
      </main>
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <main
      className="admin-sessions-page"
      aria-labelledby="admin-sessions-title"
    >
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}

      <header className="page-header">
        <div className="page-header-content">
          <div className="page-title-icon" aria-hidden="true">
            <Shield size={28} />
          </div>

          <div>
            <h1 id="admin-sessions-title">
              Session Administration
            </h1>

            <p>
              Monitor and manage authentication sessions
              across TITech Community Capital.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="refresh-btn"
          onClick={refreshSessions}
          disabled={refreshing}
          aria-label="Refresh authentication sessions"
        >
          <RefreshCw
            size={18}
            className={
              refreshing ? 'animate-spin' : ''
            }
            aria-hidden="true"
          />

          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {/* ================================================================== */}
      {/* ERROR BANNER */}
      {/* ================================================================== */}

      {error && (
        <section
          className="sessions-error-banner"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle
            size={20}
            aria-hidden="true"
          />

          <div>
            <strong>
              Unable to retrieve the latest session data
            </strong>

            <p>{error}</p>
          </div>

          <button
            type="button"
            onClick={() => fetchSessions()}
            disabled={refreshing}
          >
            Retry
          </button>
        </section>
      )}

      {/* ================================================================== */}
      {/* STATISTICS */}
      {/* ================================================================== */}

      <section
        className="stats-grid"
        aria-label="Session statistics"
      >
        <article className="stat-card">
          <div className="stat-card-icon">
            <Users size={20} aria-hidden="true" />
          </div>

          <div>
            <span className="stat-label">
              Total Sessions
            </span>

            <strong className="stat-value">
              {statistics.total}
            </strong>
          </div>
        </article>

        <article className="stat-card active">
          <div className="stat-card-icon">
            <CheckCircle2
              size={20}
              aria-hidden="true"
            />
          </div>

          <div>
            <span className="stat-label">
              Active
            </span>

            <strong className="stat-value">
              {statistics.active}
            </strong>
          </div>
        </article>

        <article className="stat-card revoked">
          <div className="stat-card-icon">
            <Ban size={20} aria-hidden="true" />
          </div>

          <div>
            <span className="stat-label">
              Revoked
            </span>

            <strong className="stat-value">
              {statistics.revoked}
            </strong>
          </div>
        </article>

        <article className="stat-card expired">
          <div className="stat-card-icon">
            <Clock3 size={20} aria-hidden="true" />
          </div>

          <div>
            <span className="stat-label">
              Expired
            </span>

            <strong className="stat-value">
              {statistics.expired}
            </strong>
          </div>
        </article>
      </section>

      {/* ================================================================== */}
      {/* TOOLBAR */}
      {/* ================================================================== */}

      <section
        className="toolbar"
        aria-label="Session filters"
      >
        <div className="search-box">
          <Search
            size={18}
            aria-hidden="true"
          />

          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search by session, user, IP, device or browser…"
            aria-label="Search authentication sessions"
            autoComplete="off"
          />

          {search && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear session search"
            >
              ×
            </button>
          )}
        </div>

        <label className="filter-select">
          <span className="sr-only">
            Session status
          </span>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
            aria-label="Filter sessions by status"
          >
            <option value="all">
              All Sessions
            </option>

            <option value="active">
              Active
            </option>

            <option value="revoked">
              Revoked
            </option>

            <option value="expired">
              Expired
            </option>
          </select>
        </label>
      </section>

      {/* ================================================================== */}
      {/* RESULTS SUMMARY */}
      {/* ================================================================== */}

      <div
        className="results-summary"
        aria-live="polite"
      >
        <span>
          Showing{' '}
          <strong>
            {filteredSessions.length}
          </strong>{' '}
          of{' '}
          <strong>
            {sessions.length}
          </strong>{' '}
          sessions
        </span>

        {(search || statusFilter !== 'all') && (
          <button
            type="button"
            className="clear-filters-btn"
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ================================================================== */}
      {/* TABLE */}
      {/* ================================================================== */}

      <section className="sessions-table-wrapper">
        <div className="table-scroll-container">
          <table className="sessions-table">
            <caption className="sr-only">
              TITech Community Capital authentication
              sessions
            </caption>

            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">User</th>
                <th scope="col">Device</th>
                <th scope="col">IP Address</th>
                <th scope="col">Created</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="empty-sessions-state"
                  >
                    <div>
                      <Shield
                        size={32}
                        aria-hidden="true"
                      />

                      <strong>
                        No sessions found
                      </strong>

                      <span>
                        {search ||
                        statusFilter !== 'all'
                          ? 'Try adjusting your search or filters.'
                          : 'There are currently no authentication sessions to display.'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => {
                  const sessionId =
                    getSessionId(session);

                  const userId =
                    getUserId(session);

                  const userAgent =
                    getUserAgent(session);

                  const ipAddress =
                    getIpAddress(session);

                  const status =
                    getSessionStatus(session);

                  const isRevoking =
                    revokingId === sessionId;

                  return (
                    <tr
                      key={
                        sessionId ||
                        `${userId}-${session?.createdAt || Math.random()}`
                      }
                      className={`session-row session-${status}`}
                    >
                      <td>
                        <div className="session-identity">
                          <code
                            title={String(sessionId)}
                          >
                            {truncate(
                              sessionId || 'Unknown',
                              28
                            )}
                          </code>

                          {session?.tokenVersion != null && (
                            <small>
                              Token v
                              {session.tokenVersion}
                            </small>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="user-cell">
                          <strong>
                            {session?.user?.name ||
                              session?.user?.fullName ||
                              'User'}
                          </strong>

                          <span>
                            {session?.user?.email ||
                              userId ||
                              '—'}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div
                          className="device-cell"
                          title={userAgent}
                        >
                          <span className="device-icon">
                            <DeviceIcon
                              userAgent={userAgent}
                            />
                          </span>

                          <div>
                            <strong>
                              {session?.deviceInfo
                                ?.browser ||
                                session?.browser ||
                                'Unknown Browser'}
                            </strong>

                            <span>
                              {session?.deviceInfo
                                ?.os ||
                                session?.os ||
                                truncate(
                                  userAgent,
                                  45
                                )}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="ip-cell">
                          <Globe
                            size={16}
                            aria-hidden="true"
                          />

                          <span>
                            {ipAddress || '—'}
                          </span>
                        </div>
                      </td>

                      <td>
                        <time
                          dateTime={
                            session?.createdAt || undefined
                          }
                          title={formatDate(
                            session?.createdAt
                          )}
                        >
                          {formatDate(
                            session?.createdAt
                          )}
                        </time>
                      </td>

                      <td>
                        <div className="expiry-cell">
                          <time
                            dateTime={
                              session?.expiresAt ||
                              undefined
                            }
                            title={formatDate(
                              session?.expiresAt
                            )}
                          >
                            {formatDate(
                              session?.expiresAt
                            )}
                          </time>

                          {session?.expiresAt && (
                            <small>
                              {getRelativeExpiry(
                                session.expiresAt
                              )}
                            </small>
                          )}
                        </div>
                      </td>

                      <td>
                        {status === 'revoked' && (
                          <span className="status revoked">
                            <AlertTriangle
                              size={14}
                              aria-hidden="true"
                            />
                            Revoked
                          </span>
                        )}

                        {status === 'expired' && (
                          <span className="status expired">
                            <Clock3
                              size={14}
                              aria-hidden="true"
                            />
                            Expired
                          </span>
                        )}

                        {status === 'active' && (
                          <span className="status active">
                            <CheckCircle2
                              size={14}
                              aria-hidden="true"
                            />
                            Active
                          </span>
                        )}
                      </td>

                      <td>
                        {status === 'active' ? (
                          <button
                            type="button"
                            className="revoke-btn"
                            onClick={() =>
                              revokeSession(
                                session
                              )
                            }
                            disabled={isRevoking}
                            aria-label={`Revoke session ${sessionId}`}
                          >
                            <Ban
                              size={16}
                              aria-hidden="true"
                            />

                            {isRevoking
                              ? 'Revoking…'
                              : 'Revoke'}
                          </button>
                        ) : (
                          <span className="action-placeholder">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================== */}
      {/* SECURITY FOOTER */}
      {/* ================================================================== */}

      <footer className="sessions-security-notice">
        <Shield
          size={17}
          aria-hidden="true"
        />

        <p>
          Session administration is restricted to
          authorized TITech administrators. Revoking a
          session immediately invalidates its server-side
          session state where supported by the
          authentication service.
        </p>
      </footer>
    </main>
  );
};

export default AdminSessions;