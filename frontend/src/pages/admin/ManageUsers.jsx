// ============================================================================
// TITech Community Capital
// Enterprise Admin User Management Console
// File: frontend/src/pages/admin/ManageUsers.jsx
// Production Grade
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import PropTypes from 'prop-types';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Mail,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'react-toastify';

import { useAuthorization } from '../../components/AdminRoute';
import Modal from '../../components/common/Modal';
import api from '../../services/api';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT_BY = 'name';
const DEFAULT_SORT_ORDER = 'asc';

const ROLE_OPTIONS = [
  {
    value: 'admin',
    label: 'Administrator',
  },
  {
    value: 'manager',
    label: 'Manager',
  },
  {
    value: 'member',
    label: 'Member',
  },
];

const STATUS_OPTIONS = [
  {
    value: 'active',
    label: 'Active',
  },
  {
    value: 'pending',
    label: 'Pending',
  },
  {
    value: 'suspended',
    label: 'Suspended',
  },
  {
    value: 'disabled',
    label: 'Disabled',
  },
];

const EMPTY_USER = {
  name: '',
  email: '',
  role: 'member',
  status: 'active',
};

// ============================================================================
// HELPERS
// ============================================================================

const getUserId = (user) => {
  if (!user) {
    return '';
  }

  const id =
    user.id ??
    user._id ??
    user.userId ??
    '';

  return id == null ? '' : String(id);
};

const getUserName = (user) =>
  user?.name ||
  user?.fullName ||
  user?.displayName ||
  'Unnamed User';

const getUserEmail = (user) =>
  user?.email ||
  user?.emailAddress ||
  'No email';

const normalizeUsersResponse = (response) => {
  const payload = response?.data;

  if (Array.isArray(payload)) {
    return {
      items: payload,
      totalPages: 1,
      total: payload.length,
    };
  }

  const items =
    payload?.items ??
    payload?.users ??
    payload?.data ??
    [];

  const safeItems = Array.isArray(items)
    ? items
    : [];

  const totalPages = Math.max(
    1,
    Number(
      payload?.totalPages ??
        payload?.pagination?.totalPages ??
        1
    ) || 1
  );

  const total = Math.max(
    safeItems.length,
    Number(
      payload?.total ??
        payload?.pagination?.total ??
        payload?.count ??
        safeItems.length
    ) || 0
  );

  return {
    items: safeItems,
    totalPages,
    total,
  };
};

const normalizeMutationResponse = (response) => {
  const payload = response?.data;

  return (
    payload?.data ??
    payload?.user ??
    payload ??
    null
  );
};

const getErrorMessage = (
  error,
  fallback = 'An unexpected error occurred.'
) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;

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

const normalizeUserForEdit = (user) => ({
  ...EMPTY_USER,
  ...(user || {}),
  name:
    user?.name ??
    user?.fullName ??
    user?.displayName ??
    '',
  email:
    user?.email ??
    user?.emailAddress ??
    '',
  role: user?.role ?? 'member',
  status: user?.status ?? 'active',
});

const validateUser = (user) => {
  const errors = {};

  const name = String(user?.name || '').trim();
  const email = String(user?.email || '').trim();

  if (!name) {
    errors.name = 'Name is required.';
  } else if (name.length < 2) {
    errors.name =
      'Name must contain at least 2 characters.';
  } else if (name.length > 120) {
    errors.name =
      'Name cannot exceed 120 characters.';
  }

  if (!email) {
    errors.email = 'Email address is required.';
  } else if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    errors.email =
      'Enter a valid email address.';
  }

  if (
    !ROLE_OPTIONS.some(
      (option) => option.value === user?.role
    )
  ) {
    errors.role = 'Select a valid user role.';
  }

  if (
    !STATUS_OPTIONS.some(
      (option) => option.value === user?.status
    )
  ) {
    errors.status = 'Select a valid user status.';
  }

  return errors;
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function ManageUsers({
  initialUsers = [],
  apiBase = '/api/admin',
}) {
  const {
    authorized,
    loading: authorizationLoading,
  } = useAuthorization({
    roles: ['admin'],
  });

  // ==========================================================================
  // DATA STATE
  // ==========================================================================

  const [users, setUsers] = useState(
    Array.isArray(initialUsers)
      ? initialUsers
      : []
  );

  const [loadingUsers, setLoadingUsers] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] = useState('');

  const [totalUsers, setTotalUsers] =
    useState(
      Array.isArray(initialUsers)
        ? initialUsers.length
        : 0
    );

  // ==========================================================================
  // SEARCH / SORT / PAGINATION
  // ==========================================================================

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] =
    useState('');

  const [page, setPage] = useState(1);
  const [pageSize] = useState(
    DEFAULT_PAGE_SIZE
  );

  const [totalPages, setTotalPages] =
    useState(1);

  const [sortBy, setSortBy] = useState(
    DEFAULT_SORT_BY
  );

  const [sortOrder, setSortOrder] = useState(
    DEFAULT_SORT_ORDER
  );

  // ==========================================================================
  // MODAL / EDIT STATE
  // ==========================================================================

  const [modalOpen, setModalOpen] =
    useState(false);

  const [selectedUser, setSelectedUser] =
    useState(null);

  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] =
    useState(null);

  const [formErrors, setFormErrors] =
    useState({});

  // ==========================================================================
  // SEARCH DEBOUNCE
  // ==========================================================================

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [search]);

  // ==========================================================================
  // FETCH USERS
  // ==========================================================================

  const fetchUsers = useCallback(
    async ({ silent = false } = {}) => {
      if (!authorized) {
        return;
      }

      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoadingUsers(true);
        }

        setError('');

        const query = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          sortBy,
          sortOrder,
          search: debouncedSearch,
        });

        const response = await api.get(
          `${apiBase}/users?${query.toString()}`
        );

        const normalized =
          normalizeUsersResponse(response);

        setUsers(normalized.items);
        setTotalPages(normalized.totalPages);
        setTotalUsers(normalized.total);
      } catch (requestError) {
        console.error(
          '[TITech ManageUsers] Failed to fetch users:',
          requestError
        );

        const message = getErrorMessage(
          requestError,
          'Failed to load users.'
        );

        setError(message);

        if (silent) {
          toast.error(
            'Failed to refresh users.'
          );
        } else {
          toast.error(message);
        }
      } finally {
        setLoadingUsers(false);
        setRefreshing(false);
      }
    },
    [
      authorized,
      page,
      pageSize,
      sortBy,
      sortOrder,
      debouncedSearch,
      apiBase,
    ]
  );

  useEffect(() => {
    if (!authorizationLoading && authorized) {
      fetchUsers();
    }
  }, [
    authorizationLoading,
    authorized,
    fetchUsers,
  ]);

  // ==========================================================================
  // SORT
  // ==========================================================================

  const toggleSort = useCallback((field) => {
    setPage(1);

    setSortBy((currentField) => {
      if (currentField !== field) {
        setSortOrder('asc');
        return field;
      }

      setSortOrder((currentOrder) =>
        currentOrder === 'asc'
          ? 'desc'
          : 'asc'
      );

      return currentField;
    });
  }, []);

  // ==========================================================================
  // EDIT MODAL
  // ==========================================================================

  const handleEdit = useCallback((user) => {
    setSelectedUser(
      normalizeUserForEdit(user)
    );
    setFormErrors({});
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (saving) {
      return;
    }

    setModalOpen(false);
    setSelectedUser(null);
    setFormErrors({});
  }, [saving]);

  const handleEditChange = useCallback(
    (event) => {
      const {
        name,
        value,
      } = event.target;

      setSelectedUser((current) => ({
        ...current,
        [name]: value,
      }));

      setFormErrors((current) => {
        if (!current[name]) {
          return current;
        }

        const next = {
          ...current,
        };

        delete next[name];

        return next;
      });
    },
    []
  );

  // ==========================================================================
  // SAVE USER
  // ==========================================================================

  const handleSave = useCallback(
    async (event) => {
      event?.preventDefault();

      if (!selectedUser) {
        return;
      }

      const validationErrors =
        validateUser(selectedUser);

      if (
        Object.keys(validationErrors).length > 0
      ) {
        setFormErrors(validationErrors);
        toast.error(
          'Please correct the highlighted fields.'
        );
        return;
      }

      const id = getUserId(selectedUser);

      if (!id) {
        toast.error(
          'Unable to update user: user identifier is missing.'
        );
        return;
      }

      try {
        setSaving(true);

        const payload = {
          name: String(
            selectedUser.name
          ).trim(),
          email: String(
            selectedUser.email
          ).trim(),
          role: selectedUser.role,
          status: selectedUser.status,
        };

        const response = await api.put(
          `${apiBase}/users/${encodeURIComponent(id)}`,
          payload
        );

        const updatedUser =
          normalizeMutationResponse(response);

        const safeUpdatedUser =
          updatedUser &&
          typeof updatedUser === 'object'
            ? {
                ...selectedUser,
                ...updatedUser,
              }
            : {
                ...selectedUser,
                ...payload,
              };

        setUsers((currentUsers) =>
          currentUsers.map((user) =>
            getUserId(user) === id
              ? safeUpdatedUser
              : user
          )
        );

        setModalOpen(false);
        setSelectedUser(null);
        setFormErrors({});

        toast.success(
          'User updated successfully.'
        );
      } catch (requestError) {
        console.error(
          '[TITech ManageUsers] Failed to update user:',
          requestError
        );

        toast.error(
          getErrorMessage(
            requestError,
            'Failed to update user.'
          )
        );
      } finally {
        setSaving(false);
      }
    },
    [
      selectedUser,
      apiBase,
    ]
  );

  // ==========================================================================
  // DELETE USER
  // ==========================================================================

  const handleDelete = useCallback(
    async (user) => {
      const userId = getUserId(user);

      if (!userId) {
        toast.error(
          'Unable to delete user: user identifier is missing.'
        );
        return;
      }

      const userName = getUserName(user);

      const confirmed = window.confirm(
        `Delete ${userName}?\n\nThis is a privileged administrative action and may permanently remove the user account.`
      );

      if (!confirmed) {
        return;
      }

      try {
        setDeletingId(userId);
        setError('');

        await api.delete(
          `${apiBase}/users/${encodeURIComponent(
            userId
          )}`
        );

        setUsers((currentUsers) =>
          currentUsers.filter(
            (currentUser) =>
              getUserId(currentUser) !== userId
          )
        );

        setTotalUsers((currentTotal) =>
          Math.max(0, currentTotal - 1)
        );

        toast.success(
          'User deleted successfully.'
        );

        // If the last record on the current page
        // was deleted, return to the previous page.
        if (
          users.length === 1 &&
          page > 1
        ) {
          setPage((currentPage) =>
            Math.max(1, currentPage - 1)
          );
        }
      } catch (requestError) {
        console.error(
          '[TITech ManageUsers] Failed to delete user:',
          requestError
        );

        toast.error(
          getErrorMessage(
            requestError,
            'Failed to delete user.'
          )
        );
      } finally {
        setDeletingId(null);
      }
    },
    [
      apiBase,
      page,
      users.length,
    ]
  );

  // ==========================================================================
  // PAGINATION
  // ==========================================================================

  const goToPage = useCallback(
    (nextPage) => {
      const normalizedPage = Math.max(
        1,
        Math.min(
          totalPages,
          Number(nextPage) || 1
        )
      );

      setPage(normalizedPage);
    },
    [totalPages]
  );

  // ==========================================================================
  // DERIVED VALUES
  // ==========================================================================

  const displayedRange = useMemo(() => {
    if (totalUsers === 0) {
      return {
        from: 0,
        to: 0,
      };
    }

    const from =
      (page - 1) * pageSize + 1;

    const to = Math.min(
      page * pageSize,
      totalUsers
    );

    return {
      from,
      to,
    };
  }, [
    page,
    pageSize,
    totalUsers,
  ]);

  // ==========================================================================
  // AUTHORIZATION STATES
  // ==========================================================================

  if (authorizationLoading) {
    return (
      <main
        className="admin-manage-users-page"
        aria-busy="true"
      >
        <div
          className="admin-page-loading"
          role="status"
          aria-live="polite"
        >
          <RefreshCw
            size={36}
            className="animate-spin"
            aria-hidden="true"
          />

          <h1>Checking authorization…</h1>

          <p>
            Verifying administrator access.
          </p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main
        className="admin-manage-users-page"
        aria-labelledby="access-denied-title"
      >
        <section
          className="access-denied-state"
          role="alert"
        >
          <Shield
            size={42}
            aria-hidden="true"
          />

          <h1 id="access-denied-title">
            Access Denied
          </h1>

          <p>
            You do not have permission to access
            user administration.
          </p>
        </section>
      </main>
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <main
      className="admin-manage-users-page"
      aria-labelledby="manage-users-title"
    >
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}

      <header className="admin-users-header">
        <div className="admin-users-title">
          <div
            className="admin-users-title-icon"
            aria-hidden="true"
          >
            <UserCog size={28} />
          </div>

          <div>
            <h1 id="manage-users-title">
              Manage Users
            </h1>

            <p>
              Manage TITech Community Capital
              accounts, roles and account status.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="refresh-users-btn"
          onClick={() =>
            fetchUsers({ silent: true })
          }
          disabled={
            refreshing || loadingUsers
          }
          aria-label="Refresh user list"
        >
          <RefreshCw
            size={18}
            className={
              refreshing
                ? 'animate-spin'
                : ''
            }
            aria-hidden="true"
          />

          {refreshing
            ? 'Refreshing…'
            : 'Refresh'}
        </button>
      </header>

      {/* ================================================================== */}
      {/* SUMMARY */}
      {/* ================================================================== */}

      <section
        className="admin-users-summary"
        aria-label="User management summary"
      >
        <div className="users-summary-card">
          <Users
            size={20}
            aria-hidden="true"
          />

          <div>
            <span>Total Users</span>
            <strong>{totalUsers}</strong>
          </div>
        </div>

        <div className="users-summary-card">
          <CheckCircle2
            size={20}
            aria-hidden="true"
          />

          <div>
            <span>Current Page</span>

            <strong>
              {displayedRange.from}–
              {displayedRange.to}
            </strong>
          </div>
        </div>

        <div className="users-summary-card">
          <Shield
            size={20}
            aria-hidden="true"
          />

          <div>
            <span>Page</span>

            <strong>
              {page} / {totalPages}
            </strong>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* TOOLBAR */}
      {/* ================================================================== */}

      <section
        className="users-toolbar"
        aria-label="User search and filtering"
      >
        <div className="users-search-box">
          <Search
            size={19}
            aria-hidden="true"
          />

          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email…"
            aria-label="Search users by name or email"
            autoComplete="off"
          />

          {search && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              aria-label="Clear user search"
            >
              <X
                size={17}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </section>

      {/* ================================================================== */}
      {/* ERROR */}
      {/* ================================================================== */}

      {error && (
        <section
          className="admin-users-error"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle
            size={19}
            aria-hidden="true"
          />

          <div>
            <strong>
              Unable to load users
            </strong>

            <p>{error}</p>
          </div>

          <button
            type="button"
            onClick={() => fetchUsers()}
          >
            Retry
          </button>
        </section>
      )}

      {/* ================================================================== */}
      {/* LOADING */}
      {/* ================================================================== */}

      {loadingUsers && (
        <div
          className="users-loading-indicator"
          role="status"
          aria-live="polite"
        >
          <RefreshCw
            size={17}
            className="animate-spin"
            aria-hidden="true"
          />

          Loading users…
        </div>
      )}

      {/* ================================================================== */}
      {/* TABLE */}
      {/* ================================================================== */}

      <section className="users-table-card">
        <div className="users-table-wrapper">
          <table className="users-table">
            <caption className="sr-only">
              TITech Community Capital user
              administration table
            </caption>

            <thead>
              <tr>
                {[
                  {
                    key: 'name',
                    label: 'User',
                  },
                  {
                    key: 'email',
                    label: 'Email',
                  },
                  {
                    key: 'role',
                    label: 'Role',
                  },
                  {
                    key: 'status',
                    label: 'Status',
                  },
                ].map((column) => {
                  const active =
                    sortBy === column.key;

                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        active
                          ? sortOrder === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="sortable-header"
                        onClick={() =>
                          toggleSort(
                            column.key
                          )
                        }
                      >
                        <span>
                          {column.label}
                        </span>

                        {active ? (
                          sortOrder ===
                          'asc' ? (
                            <ChevronUp
                              size={15}
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown
                              size={15}
                              aria-hidden="true"
                            />
                          )
                        ) : (
                          <ChevronDown
                            size={15}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </th>
                  );
                })}

                <th scope="col">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="users-empty-state"
                  >
                    <div>
                      <Users
                        size={34}
                        aria-hidden="true"
                      />

                      <strong>
                        No users found
                      </strong>

                      <span>
                        {debouncedSearch
                          ? 'Try a different search term.'
                          : 'There are currently no users to display.'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const id = getUserId(user);
                  const name =
                    getUserName(user);
                  const email =
                    getUserEmail(user);
                  const isDeleting =
                    deletingId === id;

                  return (
                    <tr
                      key={
                        id ||
                        `${email}-${name}`
                      }
                    >
                      <td>
                        <div className="user-primary-cell">
                          <div className="user-avatar">
                            {name
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div>
                            <strong>
                              {name}
                            </strong>

                            {id && (
                              <small>
                                ID: {id}
                              </small>
                            )}
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="user-email-cell">
                          <Mail
                            size={15}
                            aria-hidden="true"
                          />

                          <span>
                            {email}
                          </span>
                        </div>
                      </td>

                      <td>
                        <RoleBadge
                          role={user?.role}
                        />
                      </td>

                      <td>
                        <StatusBadge
                          status={user?.status}
                        />
                      </td>

                      <td>
                        <div className="user-actions">
                          <button
                            type="button"
                            className="edit-user-btn"
                            onClick={() =>
                              handleEdit(user)
                            }
                            disabled={
                              isDeleting
                            }
                            aria-label={`Edit ${name}`}
                          >
                            <Edit3
                              size={16}
                              aria-hidden="true"
                            />

                            Edit
                          </button>

                          <button
                            type="button"
                            className="delete-user-btn"
                            onClick={() =>
                              handleDelete(user)
                            }
                            disabled={
                              isDeleting
                            }
                            aria-label={`Delete ${name}`}
                          >
                            {isDeleting ? (
                              <RefreshCw
                                size={16}
                                className="animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Trash2
                                size={16}
                                aria-hidden="true"
                              />
                            )}

                            {isDeleting
                              ? 'Deleting…'
                              : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ================================================================ */}
        {/* PAGINATION */}
        {/* ================================================================ */}

        <footer className="users-pagination">
          <span
            className="pagination-summary"
            aria-live="polite"
          >
            {totalUsers === 0
              ? 'No users'
              : `Showing ${displayedRange.from}–${displayedRange.to} of ${totalUsers}`}
          </span>

          <div className="pagination-controls">
            <button
              type="button"
              onClick={() =>
                goToPage(page - 1)
              }
              disabled={
                page <= 1 ||
                loadingUsers
              }
            >
              Previous
            </button>

            <span
              aria-current="page"
              className="pagination-current"
            >
              Page {page} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() =>
                goToPage(page + 1)
              }
              disabled={
                page >= totalPages ||
                loadingUsers
              }
            >
              Next
            </button>
          </div>
        </footer>
      </section>

      {/* ================================================================== */}
      {/* EDIT USER MODAL */}
      {/* ================================================================== */}

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Edit User"
        size="md"
      >
        {selectedUser ? (
          <form
            className="edit-user-form"
            onSubmit={handleSave}
            noValidate
          >
            <div className="edit-user-modal-header">
              <div className="edit-user-modal-icon">
                <UserCog
                  size={22}
                  aria-hidden="true"
                />
              </div>

              <div>
                <h2>
                  Update Account
                </h2>

                <p>
                  Modify the selected user's
                  account profile and access
                  status.
                </p>
              </div>
            </div>

            {/* ============================================================ */}
            {/* NAME */}
            {/* ============================================================ */}

            <div className="form-field">
              <label htmlFor="edit-user-name">
                Full Name
              </label>

              <input
                id="edit-user-name"
                name="name"
                type="text"
                value={
                  selectedUser.name ?? ''
                }
                onChange={
                  handleEditChange
                }
                autoComplete="name"
                aria-invalid={Boolean(
                  formErrors.name
                )}
                aria-describedby={
                  formErrors.name
                    ? 'edit-user-name-error'
                    : undefined
                }
                disabled={saving}
                required
              />

              {formErrors.name && (
                <FieldError
                  id="edit-user-name-error"
                  message={
                    formErrors.name
                  }
                />
              )}
            </div>

            {/* ============================================================ */}
            {/* EMAIL */}
            {/* ============================================================ */}

            <div className="form-field">
              <label htmlFor="edit-user-email">
                Email Address
              </label>

              <input
                id="edit-user-email"
                name="email"
                type="email"
                value={
                  selectedUser.email ?? ''
                }
                onChange={
                  handleEditChange
                }
                autoComplete="email"
                aria-invalid={Boolean(
                  formErrors.email
                )}
                aria-describedby={
                  formErrors.email
                    ? 'edit-user-email-error'
                    : undefined
                }
                disabled={saving}
                required
              />

              {formErrors.email && (
                <FieldError
                  id="edit-user-email-error"
                  message={
                    formErrors.email
                  }
                />
              )}
            </div>

            {/* ============================================================ */}
            {/* ROLE */}
            {/* ============================================================ */}

            <div className="form-field">
              <label htmlFor="edit-user-role">
                Role
              </label>

              <select
                id="edit-user-role"
                name="role"
                value={
                  selectedUser.role ??
                  'member'
                }
                onChange={
                  handleEditChange
                }
                aria-invalid={Boolean(
                  formErrors.role
                )}
                disabled={saving}
              >
                {ROLE_OPTIONS.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={
                        option.value
                      }
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>

              {formErrors.role && (
                <FieldError
                  message={
                    formErrors.role
                  }
                />
              )}
            </div>

            {/* ============================================================ */}
            {/* STATUS */}
            {/* ============================================================ */}

            <div className="form-field">
              <label htmlFor="edit-user-status">
                Account Status
              </label>

              <select
                id="edit-user-status"
                name="status"
                value={
                  selectedUser.status ??
                  'active'
                }
                onChange={
                  handleEditChange
                }
                aria-invalid={Boolean(
                  formErrors.status
                )}
                disabled={saving}
              >
                {STATUS_OPTIONS.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={
                        option.value
                      }
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>

              {formErrors.status && (
                <FieldError
                  message={
                    formErrors.status
                  }
                />
              )}
            </div>

            {/* ============================================================ */}
            {/* AUDIT INFORMATION */}
            {/* ============================================================ */}

            {(selectedUser.createdAt ||
              selectedUser.updatedAt) && (
              <div className="edit-user-metadata">
                {selectedUser.createdAt && (
                  <div>
                    <span>
                      Created
                    </span>

                    <strong>
                      {formatDate(
                        selectedUser.createdAt
                      )}
                    </strong>
                  </div>
                )}

                {selectedUser.updatedAt && (
                  <div>
                    <span>
                      Last Updated
                    </span>

                    <strong>
                      {formatDate(
                        selectedUser.updatedAt
                      )}
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* WARNING */}
            {/* ============================================================ */}

            {(selectedUser.role ===
              'admin' ||
              selectedUser.status ===
                'suspended' ||
              selectedUser.status ===
                'disabled') && (
              <div
                className="edit-user-warning"
                role="note"
              >
                <AlertTriangle
                  size={17}
                  aria-hidden="true"
                />

                <span>
                  Changes to privileged roles
                  or account status can affect
                  platform access immediately.
                </span>
              </div>
            )}

            {/* ============================================================ */}
            {/* ACTIONS */}
            {/* ============================================================ */}

            <div className="edit-user-actions">
              <button
                type="button"
                onClick={closeModal}
                className="cancel-btn"
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="save-user-btn"
                disabled={
                  saving ||
                  Object.keys(formErrors)
                    .length > 0
                }
                aria-busy={saving}
              >
                {saving ? (
                  <>
                    <RefreshCw
                      size={17}
                      className="animate-spin"
                      aria-hidden="true"
                    />

                    Saving…
                  </>
                ) : (
                  <>
                    <CheckCircle2
                      size={17}
                      aria-hidden="true"
                    />

                    Save Changes
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div
            className="edit-user-loading"
            role="status"
          >
            <RefreshCw
              size={28}
              className="animate-spin"
              aria-hidden="true"
            />

            Loading user…
          </div>
        )}
      </Modal>

      {/* ================================================================== */}
      {/* SECURITY FOOTER */}
      {/* ================================================================== */}

      <footer className="admin-users-security-notice">
        <Shield
          size={17}
          aria-hidden="true"
        />

        <p>
          User administration is restricted to
          authorized TITech administrators. Role,
          status and account deletion changes are
          privileged operations and should follow
          TITech's audit and authorization controls.
        </p>
      </footer>
    </main>
  );
}

// ============================================================================
// ROLE BADGE
// ============================================================================

const RoleBadge = ({ role }) => {
  const normalizedRole = String(
    role || 'member'
  ).toLowerCase();

  const option =
    ROLE_OPTIONS.find(
      (item) =>
        item.value === normalizedRole
    ) || ROLE_OPTIONS[2];

  return (
    <span
      className={`user-role-badge role-${normalizedRole}`}
    >
      <Shield
        size={14}
        aria-hidden="true"
      />

      {option.label}
    </span>
  );
};

RoleBadge.propTypes = {
  role: PropTypes.string,
};

// ============================================================================
// STATUS BADGE
// ============================================================================

const StatusBadge = ({ status }) => {
  const normalizedStatus = String(
    status || 'active'
  ).toLowerCase();

  const option =
    STATUS_OPTIONS.find(
      (item) =>
        item.value === normalizedStatus
    ) || STATUS_OPTIONS[0];

  const isPositive =
    normalizedStatus === 'active';

  return (
    <span
      className={`user-status-badge status-${normalizedStatus}`}
    >
      {isPositive ? (
        <CheckCircle2
          size={14}
          aria-hidden="true"
        />
      ) : (
        <AlertTriangle
          size={14}
          aria-hidden="true"
        />
      )}

      {option.label}
    </span>
  );
};

StatusBadge.propTypes = {
  status: PropTypes.string,
};

// ============================================================================
// FIELD ERROR
// ============================================================================

const FieldError = ({ id, message }) => (
  <span
    id={id}
    className="field-error"
    role="alert"
  >
    <AlertTriangle
      size={13}
      aria-hidden="true"
    />

    {message}
  </span>
);

FieldError.propTypes = {
  id: PropTypes.string,
  message: PropTypes.string.isRequired,
};

// ============================================================================
// PROP TYPES
// ============================================================================

ManageUsers.propTypes = {
  initialUsers: PropTypes.arrayOf(
    PropTypes.object
  ),
  apiBase: PropTypes.string,
};