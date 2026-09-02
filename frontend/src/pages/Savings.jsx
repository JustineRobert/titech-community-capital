/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Savings Management
 * File: frontend/src/pages/Savings.jsx
 *
 * Production Grade
 * ----------------------------------------------------------------------------
 * Features
 * - Defensive API response normalization
 * - Abortable requests
 * - Stale-request protection
 * - Automatic refresh with safe cleanup
 * - Retry and refresh states
 * - Financial-data-safe read operations
 * - Search and transaction-type filtering
 * - Stable client-side pagination
 * - Defensive currency/date formatting
 * - Role-aware transaction creation
 * - Accessible controls, table semantics and status messaging
 * - Empty states and resilient error handling
 * - No ACFOS terminology
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
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Eye,
  PiggyBank,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';

import './Savings.css';

/* ============================================================================
 * Constants
 * ========================================================================== */

const PAGE_SIZE = 10;
const AUTO_REFRESH_INTERVAL = 60_000;
const MAX_RENDERED_TRANSACTIONS = 2_000;

const TRANSACTION_TYPES = Object.freeze([
  'all',
  'deposit',
  'withdrawal',
  'interest',
  'adjustment',
]);

const CREATE_TRANSACTION_ROLES = new Set([
  'admin',
  'super_admin',
  'cashier',
  'teller',
]);

const READABLE_TRANSACTION_TYPES = Object.freeze({
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  interest: 'Interest',
  adjustment: 'Adjustment',
});

const DEFAULT_ERROR_MESSAGE =
  'We could not load savings information right now. Please try again.';

/* ============================================================================
 * Helpers
 * ========================================================================== */

function getEntityId(entity, fallback = null) {
  if (!entity) {
    return fallback;
  }

  if (typeof entity !== 'object') {
    return String(entity);
  }

  return (
    entity.id ??
    entity._id ??
    entity.transactionId ??
    entity.referenceId ??
    fallback
  );
}

function normalizeText(value, fallback = '') {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value).trim();
}

function normalizeStatusValue(value) {
  return normalizeText(
    value,
    'unknown',
  ).toLowerCase();
}

function normalizeTransactionType(value) {
  const normalized = normalizeStatusValue(
    value,
  );

  if (TRANSACTION_TYPES.includes(normalized)) {
    return normalized;
  }

  return normalized || 'adjustment';
}

function formatTransactionType(value) {
  const normalized =
    normalizeTransactionType(value);

  return (
    READABLE_TRANSACTION_TYPES[
      normalized
    ] ||
    normalized
      .replace(/[_-]+/g, ' ')
      .replace(
        /\b\w/g,
        (character) =>
          character.toUpperCase(),
      )
  );
}

function formatCurrency(value) {
  const numericValue = Number(value);

  const safeValue = Number.isFinite(
    numericValue,
  )
    ? numericValue
    : 0;

  try {
    return new Intl.NumberFormat(
      'en-UG',
      {
        style: 'currency',
        currency: 'UGX',
        maximumFractionDigits: 0,
      },
    ).format(safeValue);
  } catch {
    return `UGX ${Math.round(
      safeValue,
    ).toLocaleString('en-UG')}`;
  }
}

function formatDate(value) {
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
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      },
    ).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

function formatDateTime(value) {
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
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function getApiErrorMessage(error) {
  if (!error) {
    return DEFAULT_ERROR_MESSAGE;
  }

  if (
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'AbortError' ||
    error?.name === 'CanceledError'
  ) {
    return null;
  }

  const status =
    error?.response?.status;

  if (status === 401) {
    return 'Your session has expired. Please sign in again.';
  }

  if (status === 403) {
    return 'You do not have permission to access savings information.';
  }

  if (status === 404) {
    return 'Savings information could not be found.';
  }

  if (status === 429) {
    return 'Too many requests. Please wait and try again.';
  }

  const serverMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error;

  if (
    typeof serverMessage === 'string' &&
    serverMessage.trim()
  ) {
    return serverMessage.trim();
  }

  return DEFAULT_ERROR_MESSAGE;
}

function extractCollection(payload) {
  const candidates = [
    payload?.data?.items,
    payload?.data?.transactions,
    payload?.data?.savings,
    payload?.data?.data,
    payload?.items,
    payload?.transactions,
    payload?.savings,
    payload?.data,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeTransaction(transaction, index) {
  const id = getEntityId(
    transaction,
    `savings-${index}`,
  );

  return {
    ...transaction,

    id,
    _id: transaction?._id ?? id,

    reference: normalizeText(
      transaction?.reference ||
        transaction?.transactionReference ||
        transaction?.referenceNumber ||
        transaction?.transactionId,
      '—',
    ),

    memberName: normalizeText(
      transaction?.memberName ||
        transaction?.member?.name ||
        transaction?.user?.name ||
        transaction?.accountHolderName,
      'Unknown Member',
    ),

    memberId: getEntityId(
      transaction?.member ||
        transaction?.user ||
        transaction?.memberId ||
        transaction?.userId,
      null,
    ),

    type: normalizeTransactionType(
      transaction?.type ||
        transaction?.transactionType ||
        'adjustment',
    ),

    amount: Number(
      transaction?.amount ??
        transaction?.value ??
        0,
    ),

    balance:
      transaction?.balance ===
      undefined
        ? null
        : Number(
            transaction?.balance ?? 0,
          ),

    createdAt:
      transaction?.createdAt ||
      transaction?.date ||
      transaction?.transactionDate ||
      transaction?.timestamp ||
      null,

    channel: normalizeText(
      transaction?.channel ||
        transaction?.paymentChannel ||
        transaction?.source,
      '—',
    ),

    status: normalizeStatusValue(
      transaction?.status || 'completed',
    ),
  };
}

function calculateSignedAmount(transaction) {
  const amount = Number(
    transaction?.amount || 0,
  );

  if (!Number.isFinite(amount)) {
    return 0;
  }

  switch (
    normalizeTransactionType(
      transaction?.type,
    )
  ) {
    case 'withdrawal':
      return -Math.abs(amount);

    case 'deposit':
    case 'interest':
      return Math.abs(amount);

    case 'adjustment': {
      const explicitSignedAmount =
        Number(
          transaction?.signedAmount,
        );

      if (
        Number.isFinite(
          explicitSignedAmount,
        )
      ) {
        return explicitSignedAmount;
      }

      return amount;
    }

    default:
      return 0;
  }
}

/* ============================================================================
 * Statistic Card
 * ========================================================================== */

function StatsCard({
  title,
  value,
  icon: Icon,
  tone = 'default',
}) {
  return (
    <article
      className={`savings-stat-card savings-stat-card--${tone}`}
      aria-label={`${title}: ${value}`}
    >
      <div
        className="savings-stat-icon"
        aria-hidden="true"
      >
        <Icon size={22} />
      </div>

      <div className="savings-stat-content">
        <span className="savings-stat-label">
          {title}
        </span>

        <strong className="savings-stat-value">
          {value}
        </strong>
      </div>
    </article>
  );
}

/* ============================================================================
 * Transaction Badge
 * ========================================================================== */

function TransactionBadge({
  type,
}) {
  const normalized =
    normalizeTransactionType(type);

  return (
    <span
      className={`transaction-badge transaction-${normalized}`}
    >
      {formatTransactionType(
        normalized,
      )}
    </span>
  );
}

/* ============================================================================
 * Skeleton
 * ========================================================================== */

function SavingsSkeletonRow() {
  return (
    <tr
      aria-hidden="true"
      className="savings-skeleton-row"
    >
      <td>
        <span className="savings-skeleton savings-skeleton--short" />
      </td>

      <td>
        <span className="savings-skeleton savings-skeleton--medium" />
      </td>

      <td>
        <span className="savings-skeleton savings-skeleton--badge" />
      </td>

      <td>
        <span className="savings-skeleton savings-skeleton--medium" />
      </td>

      <td>
        <span className="savings-skeleton savings-skeleton--short" />
      </td>

      <td>
        <span className="savings-skeleton savings-skeleton--short" />
      </td>

      <td>
        <span className="savings-skeleton savings-skeleton--action" />
      </td>
    </tr>
  );
}

/* ============================================================================
 * Empty State
 * ========================================================================== */

function SavingsEmptyState({
  filtered,
  onClearFilters,
}) {
  return (
    <tr>
      <td
        colSpan={7}
        className="savings-empty-cell"
      >
        <div className="savings-empty-state">
          <div
            className="savings-empty-icon"
            aria-hidden="true"
          >
            <PiggyBank size={26} />
          </div>

          <h3>
            {filtered
              ? 'No matching transactions'
              : 'No savings transactions'}
          </h3>

          <p>
            {filtered
              ? 'Try changing your search or transaction filter.'
              : 'Savings activity will appear here once transactions are recorded.'}
          </p>

          {filtered && (
            <button
              type="button"
              className="secondary-btn"
              onClick={onClearFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ============================================================================
 * Main Component
 * ========================================================================== */

export default function Savings() {
  const navigate = useNavigate();

  const { user } = useAuth();

  const mountedRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const requestSequenceRef = useRef(0);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    transactions,
    setTransactions,
  ] = useState([]);

  const [
    error,
    setError,
  ] = useState('');

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    typeFilter,
    setTypeFilter,
  ] = useState('all');

  const [
    page,
    setPage,
  ] = useState(1);

  /* --------------------------------------------------------------------------
   * Permissions
   * ------------------------------------------------------------------------ */

  const userRole = useMemo(
    () =>
      String(
        user?.role || '',
      ).toLowerCase(),
    [user?.role],
  );

  const canCreate = useMemo(
    () =>
      CREATE_TRANSACTION_ROLES.has(
        userRole,
      ),
    [userRole],
  );

  /* --------------------------------------------------------------------------
   * Load transactions
   * ------------------------------------------------------------------------ */

  const fetchTransactions =
    useCallback(
      async ({
        silent = false,
      } = {}) => {
        const requestId =
          ++requestSequenceRef.current;

        if (
          abortControllerRef.current
        ) {
          try {
            abortControllerRef.current.abort();
          } catch {
            // Ignore cancellation cleanup failures.
          }
        }

        const controller =
          typeof AbortController !==
          'undefined'
            ? new AbortController()
            : null;

        abortControllerRef.current =
          controller;

        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError('');

        try {
          const response =
            await api.get(
              '/api/savings',
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

          const collection =
            extractCollection(
              response,
            );

          const normalized =
            collection
              .slice(
                0,
                MAX_RENDERED_TRANSACTIONS,
              )
              .map(
                normalizeTransaction,
              );

          setTransactions(
            normalized,
          );
        } catch (requestError) {
          if (
            !mountedRef.current ||
            requestId !==
              requestSequenceRef.current
          ) {
            return;
          }

          const message =
            getApiErrorMessage(
              requestError,
            );

          if (!message) {
            return;
          }

          setError(message);

          if (!silent) {
            toast.error(message);
          }
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
      [],
    );

  /* --------------------------------------------------------------------------
   * Initial load + automatic refresh
   * ------------------------------------------------------------------------ */

  useEffect(() => {
    mountedRef.current = true;

    fetchTransactions();

    refreshTimerRef.current =
      window.setInterval(() => {
        if (
          typeof document !==
            'undefined' &&
          document.visibilityState ===
            'hidden'
        ) {
          return;
        }

        fetchTransactions({
          silent: true,
        });
      }, AUTO_REFRESH_INTERVAL);

    return () => {
      mountedRef.current = false;

      if (
        refreshTimerRef.current
      ) {
        window.clearInterval(
          refreshTimerRef.current,
        );

        refreshTimerRef.current =
          null;
      }

      requestSequenceRef.current +=
        1;

      if (
        abortControllerRef.current
      ) {
        try {
          abortControllerRef.current.abort();
        } catch {
          // Ignore cleanup errors.
        }

        abortControllerRef.current =
          null;
      }
    };
  }, [fetchTransactions]);

  /* --------------------------------------------------------------------------
   * Search/filter normalization
   * ------------------------------------------------------------------------ */

  const normalizedSearch =
    useMemo(
      () =>
        search
          .trim()
          .toLowerCase(),
      [search],
    );

  const filteredTransactions =
    useMemo(() => {
      return transactions.filter(
        (transaction) => {
          if (
            typeFilter !== 'all' &&
            transaction.type !==
              typeFilter
          ) {
            return false;
          }

          if (!normalizedSearch) {
            return true;
          }

          const searchableText = [
            transaction.reference,
            transaction.memberName,
            transaction.memberId,
            transaction.channel,
            transaction.type,
            transaction.status,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return searchableText.includes(
            normalizedSearch,
          );
        },
      );
    }, [
      transactions,
      typeFilter,
      normalizedSearch,
    ]);

  /* --------------------------------------------------------------------------
   * Pagination
   * ------------------------------------------------------------------------ */

  const totalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(
          filteredTransactions.length /
            PAGE_SIZE,
        ),
      ),
    [filteredTransactions.length],
  );

  useEffect(() => {
    setPage((currentPage) =>
      Math.min(
        Math.max(1, currentPage),
        totalPages,
      ),
    );
  }, [totalPages]);

  const paginatedTransactions =
    useMemo(() => {
      const safePage = Math.min(
        Math.max(page, 1),
        totalPages,
      );

      const start =
        (safePage - 1) *
        PAGE_SIZE;

      return filteredTransactions.slice(
        start,
        start + PAGE_SIZE,
      );
    }, [
      filteredTransactions,
      page,
      totalPages,
    ]);

  const pageStart =
    filteredTransactions.length ===
    0
      ? 0
      : (Math.min(
          Math.max(page, 1),
          totalPages,
        ) -
          1) *
          PAGE_SIZE +
        1;

  const pageEnd = Math.min(
    pageStart +
      paginatedTransactions.length -
      1,
    filteredTransactions.length,
  );

  /* --------------------------------------------------------------------------
   * Portfolio statistics
   * ------------------------------------------------------------------------ */

  const stats = useMemo(() => {
    let deposits = 0;
    let withdrawals = 0;
    let interest = 0;
    let adjustments = 0;
    let totalSigned = 0;

    transactions.forEach(
      (transaction) => {
        const amount = Number(
          transaction.amount || 0,
        );

        if (!Number.isFinite(amount)) {
          return;
        }

        switch (transaction.type) {
          case 'deposit':
            deposits += Math.abs(
              amount,
            );
            break;

          case 'withdrawal':
            withdrawals += Math.abs(
              amount,
            );
            break;

          case 'interest':
            interest += Math.abs(
              amount,
            );
            break;

          case 'adjustment':
            adjustments += amount;
            break;

          default:
            break;
        }

        totalSigned +=
          calculateSignedAmount(
            transaction,
          );
      },
    );

    const currentBalance =
      transactions.some(
        (transaction) =>
          Number.isFinite(
            Number(
              transaction.balance,
            ),
          ) &&
          transaction.balance !==
            null,
      )
        ? Number(
            [...transactions]
              .reverse()
              .find(
                (transaction) =>
                  transaction.balance !==
                    null &&
                  Number.isFinite(
                    Number(
                      transaction.balance,
                    ),
                  ),
              )?.balance ?? 0,
          )
        : totalSigned;

    return {
      count: transactions.length,
      deposits,
      withdrawals,
      interest,
      adjustments,
      balance: currentBalance,
    };
  }, [transactions]);

  /* --------------------------------------------------------------------------
   * Filter reset
   * ------------------------------------------------------------------------ */

  const clearFilters = useCallback(() => {
    setSearch('');
    setTypeFilter('all');
    setPage(1);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [
    normalizedSearch,
    typeFilter,
  ]);

  /* --------------------------------------------------------------------------
   * Retry / refresh
   * ------------------------------------------------------------------------ */

  const handleRetry = useCallback(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleRefresh = useCallback(() => {
    fetchTransactions({
      silent: true,
    });
  }, [fetchTransactions]);

  /* --------------------------------------------------------------------------
   * Navigation
   * ------------------------------------------------------------------------ */

  const handleCreateTransaction =
    useCallback(() => {
      navigate('/savings/new');
    }, [navigate]);

  const handleViewTransaction =
    useCallback(
      (transactionId) => {
        if (!transactionId) {
          return;
        }

        navigate(
          `/savings/${encodeURIComponent(
            String(transactionId),
          )}`,
        );
      },
      [navigate],
    );

  const handlePreviousPage =
    useCallback(() => {
      setPage((currentPage) =>
        Math.max(
          1,
          currentPage - 1,
        ),
      );
    }, []);

  const handleNextPage =
    useCallback(() => {
      setPage((currentPage) =>
        Math.min(
          totalPages,
          currentPage + 1,
        ),
      );
    }, [totalPages]);

  /* ==========================================================================
   * Loading State
   * ======================================================================== */

  if (
    loading &&
    transactions.length === 0
  ) {
    return (
      <main
        className="savings-page"
        aria-labelledby="savings-loading-title"
      >
        <h1
          id="savings-loading-title"
          className="sr-only"
        >
          Loading savings portfolio
        </h1>

        <div
          className="savings-table-wrapper savings-loading-shell"
          aria-busy="true"
        >
          <table className="savings-table">
            <tbody>
              <SavingsSkeletonRow />
              <SavingsSkeletonRow />
              <SavingsSkeletonRow />
              <SavingsSkeletonRow />
              <SavingsSkeletonRow />
              <SavingsSkeletonRow />
            </tbody>
          </table>
        </div>
      </main>
    );
  }

  /* ==========================================================================
   * Render
   * ======================================================================== */

  return (
    <main
      className="savings-page"
      aria-labelledby="savings-page-title"
    >
      {/* ----------------------------------------------------------------------
       * Header
       * -------------------------------------------------------------------- */}

      <header className="savings-header">
        <div className="savings-header-content">
          <div>
            <div className="savings-eyebrow">
              TITech Community Capital
            </div>

            <h1 id="savings-page-title">
              Savings Portfolio
            </h1>

            <p>
              Monitor deposits,
              withdrawals,
              interest and
              account activity.
            </p>
          </div>

          <div className="savings-header-actions">
            <button
              type="button"
              className="secondary-btn refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <RefreshCw
                size={17}
                className={
                  refreshing
                    ? 'animate-spin'
                    : ''
                }
                aria-hidden="true"
              />

              <span>
                {refreshing
                  ? 'Refreshing…'
                  : 'Refresh'}
              </span>
            </button>

            {canCreate && (
              <button
                type="button"
                className="primary-btn"
                onClick={
                  handleCreateTransaction
                }
              >
                <Plus
                  size={18}
                  aria-hidden="true"
                />

                <span>
                  New Transaction
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------------------
       * Statistics
       * -------------------------------------------------------------------- */}

      <section
        className="savings-stats"
        aria-label="Savings portfolio summary"
      >
        <StatsCard
          title="Transactions"
          value={stats.count.toLocaleString(
            'en-UG',
          )}
          icon={Wallet}
        />

        <StatsCard
          title="Deposits"
          value={formatCurrency(
            stats.deposits,
          )}
          icon={ArrowDownCircle}
          tone="positive"
        />

        <StatsCard
          title="Withdrawals"
          value={formatCurrency(
            stats.withdrawals,
          )}
          icon={ArrowUpCircle}
          tone="warning"
        />

        <StatsCard
          title="Interest"
          value={formatCurrency(
            stats.interest,
          )}
          icon={TrendingUp}
          tone="positive"
        />

        <StatsCard
          title="Current Balance"
          value={formatCurrency(
            stats.balance,
          )}
          icon={PiggyBank}
          tone="primary"
        />
      </section>

      {/* ----------------------------------------------------------------------
       * Error Banner
       * -------------------------------------------------------------------- */}

      {error && (
        <div
          className="error-box"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle
            size={19}
            aria-hidden="true"
          />

          <div className="error-box-content">
            <strong>
              Savings data unavailable
            </strong>

            <p>{error}</p>
          </div>

          <button
            type="button"
            className="secondary-btn"
            onClick={handleRetry}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
            />
            Retry
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------------
       * Filters
       * -------------------------------------------------------------------- */}

      <section
        className="savings-filter-panel"
        aria-label="Savings transaction filters"
      >
        <div className="savings-filter-search">
          <Search
            size={18}
            aria-hidden="true"
          />

          <label
            className="sr-only"
            htmlFor="savings-search"
          >
            Search savings transactions
          </label>

          <input
            id="savings-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Search reference, member, channel…"
            value={search}
            onChange={(event) => {
              setSearch(
                event.target.value,
              );
            }}
          />

          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() =>
                setSearch('')
              }
              aria-label="Clear savings search"
            >
              ×
            </button>
          )}
        </div>

        <div className="savings-filter-control">
          <label
            htmlFor="savings-type-filter"
          >
            Transaction Type
          </label>

          <select
            id="savings-type-filter"
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value,
              )
            }
          >
            {TRANSACTION_TYPES.map(
              (type) => (
                <option
                  key={type}
                  value={type}
                >
                  {type === 'all'
                    ? 'All Transactions'
                    : formatTransactionType(
                        type,
                      )}
                </option>
              ),
            )}
          </select>
        </div>

        {(search ||
          typeFilter !== 'all') && (
          <button
            type="button"
            className="secondary-btn clear-filter-btn"
            onClick={
              clearFilters
            }
          >
            Clear Filters
          </button>
        )}
      </section>

      {/* ----------------------------------------------------------------------
       * Table Summary
       * -------------------------------------------------------------------- */}

      <div className="savings-table-toolbar">
        <div>
          <strong>
            Savings Transactions
          </strong>

          <span>
            {filteredTransactions.length.toLocaleString(
              'en-UG',
            )}{' '}
            matching record
            {filteredTransactions.length ===
            1
              ? ''
              : 's'}
          </span>
        </div>

        <div
          className="savings-sync-status"
          aria-live="polite"
        >
          {refreshing
            ? 'Synchronizing…'
            : 'Live data'}
        </div>
      </div>

      {/* ----------------------------------------------------------------------
       * Table
       * -------------------------------------------------------------------- */}

      <div className="savings-table-wrapper">
        <table className="savings-table">
          <caption className="sr-only">
            TITech Community Capital
            savings transactions
          </caption>

          <thead>
            <tr>
              <th scope="col">
                Reference
              </th>

              <th scope="col">
                Member
              </th>

              <th scope="col">
                Type
              </th>

              <th scope="col">
                Amount
              </th>

              <th scope="col">
                Date
              </th>

              <th scope="col">
                Channel
              </th>

              <th scope="col">
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {paginatedTransactions.length ===
            0 ? (
              <SavingsEmptyState
                filtered={
                  Boolean(
                    search ||
                      typeFilter !==
                        'all',
                  )
                }
                onClearFilters={
                  clearFilters
                }
              />
            ) : (
              paginatedTransactions.map(
                (transaction) => {
                  const transactionId =
                    getEntityId(
                      transaction,
                    );

                  return (
                    <tr
                      key={
                        transactionId
                      }
                      className="savings-table-row"
                    >
                      <td
                        data-label="Reference"
                      >
                        <div className="reference-cell">
                          <strong>
                            {
                              transaction.reference
                            }
                          </strong>

                          {transaction.status !==
                            'completed' && (
                            <span className="reference-status">
                              {
                                transaction.status
                              }
                            </span>
                          )}
                        </div>
                      </td>

                      <td
                        data-label="Member"
                      >
                        <div className="member-cell">
                          <strong>
                            {
                              transaction.memberName
                            }
                          </strong>

                          {transaction.memberId && (
                            <span>
                              {
                                transaction.memberId
                              }
                            </span>
                          )}
                        </div>
                      </td>

                      <td data-label="Type">
                        <TransactionBadge
                          type={
                            transaction.type
                          }
                        />
                      </td>

                      <td data-label="Amount">
                        <div
                          className={`amount-cell amount-cell--${transaction.type}`}
                        >
                          {formatCurrency(
                            transaction.amount,
                          )}
                        </div>
                      </td>

                      <td data-label="Date">
                        <time
                          dateTime={
                            transaction.createdAt ||
                            undefined
                          }
                          title={formatDateTime(
                            transaction.createdAt,
                          )}
                        >
                          {formatDate(
                            transaction.createdAt,
                          )}
                        </time>
                      </td>

                      <td data-label="Channel">
                        {
                          transaction.channel
                        }
                      </td>

                      <td data-label="Actions">
                        <div className="action-buttons">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() =>
                              handleViewTransaction(
                                transactionId,
                              )
                            }
                            aria-label={`View transaction ${transaction.reference}`}
                            title="View transaction"
                          >
                            <Eye
                              size={16}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                },
              )
            )}
          </tbody>
        </table>
      </div>

      {/* ----------------------------------------------------------------------
       * Pagination
       * -------------------------------------------------------------------- */}

      <footer className="pagination">
        <div className="pagination-summary">
          {filteredTransactions.length >
          0 ? (
            <>
              Showing{' '}
              <strong>
                {pageStart}
              </strong>
              –
              <strong>
                {pageEnd}
              </strong>{' '}
              of{' '}
              <strong>
                {filteredTransactions.length.toLocaleString(
                  'en-UG',
                )}
              </strong>
            </>
          ) : (
            'No records to display'
          )}
        </div>

        <div className="pagination-controls">
          <button
            type="button"
            disabled={
              page <= 1 ||
              filteredTransactions.length ===
                0
            }
            onClick={
              handlePreviousPage
            }
            aria-label="Previous savings transaction page"
          >
            Previous
          </button>

          <span
            aria-live="polite"
            className="pagination-page"
          >
            Page{' '}
            <strong>
              {Math.min(
                Math.max(page, 1),
                totalPages,
              )}
            </strong>{' '}
            of{' '}
            <strong>
              {totalPages}
            </strong>
          </span>

          <button
            type="button"
            disabled={
              page >= totalPages ||
              filteredTransactions.length ===
                0
            }
            onClick={
              handleNextPage
            }
            aria-label="Next savings transaction page"
          >
            Next
          </button>
        </div>
      </footer>
    </main>
  );
}