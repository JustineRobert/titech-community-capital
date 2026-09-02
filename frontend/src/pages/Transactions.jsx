// ============================================================================
// TITech Community Capital
// Enterprise Transactions Management
// File: frontend/src/pages/Transactions.jsx
//
// Production Grade
// ----------------------------------------------------------------------------
// Responsibilities
// - Secure transaction portfolio visibility
// - Defensive API response normalization
// - Search, type and status filtering
// - Stable pagination with automatic page correction
// - Financial-safe display formatting
// - Export support
// - Refresh and retry handling
// - Abortable requests
// - Stale-request protection
// - Accessible table and controls
// - Responsive enterprise presentation
// - Safe error handling without exposing implementation details
// - Consistent TITech terminology
// ============================================================================

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
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  Filter,
  RefreshCw,
  Search,
  Wallet,
  XCircle,
} from 'lucide-react';

import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

import api from '../services/api';

import './Transactions.css';

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 15;
const AUTO_REFRESH_INTERVAL = 60_000;
const MAX_VISIBLE_TRANSACTIONS = 5_000;

const TRANSACTION_TYPES = Object.freeze([
  'all',
  'deposit',
  'withdrawal',
  'loan_disbursement',
  'loan_repayment',
  'transfer',
  'fee',
  'adjustment',
]);

const TRANSACTION_STATUSES = Object.freeze([
  'all',
  'pending',
  'processing',
  'completed',
  'failed',
  'reversed',
]);

const SAFE_ERROR_MESSAGE =
  'Unable to load transactions. Please try again.';

const EXPORT_ERROR_MESSAGE =
  'Unable to export transactions at this time.';

const EMPTY_STATE_MESSAGE =
  'No transactions match the current filters.';

// ============================================================================
// Formatting Helpers
// ============================================================================

function toSafeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat(
    'en-UG',
    {
      style: 'currency',
      currency: 'UGX',
      maximumFractionDigits: 0,
    },
  ).format(toSafeNumber(value));
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
      'en-UG',
      {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      },
    ).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatLabel(value) {
  const normalized = String(
    value || '',
  )
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return 'Unknown';
  }

  return normalized.replace(
    /\b\w/g,
    (character) => character.toUpperCase(),
  );
}

function normalizeValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

// ============================================================================
// Response Helpers
// ============================================================================

function extractCollection(response) {
  const candidates = [
    response?.data?.data,
    response?.data?.transactions,
    response?.data?.items,
    response?.data,
    response,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeTransaction(transaction, index) {
  const source =
    transaction &&
    typeof transaction === 'object'
      ? transaction
      : {};

  const id =
    source._id ??
    source.id ??
    source.transactionId ??
    source.uuid ??
    `transaction-${index}`;

  const reference =
    source.reference ??
    source.transactionReference ??
    source.referenceNumber ??
    source.txnReference ??
    '—';

  const memberName =
    source.memberName ??
    source.member?.name ??
    source.user?.name ??
    source.customerName ??
    source.accountName ??
    'Unknown member';

  const phone =
    source.phone ??
    source.member?.phone ??
    source.user?.phone ??
    '';

  const type =
    normalizeValue(
      source.type ??
        source.transactionType ??
        source.category,
    ) || 'unknown';

  const status =
    normalizeValue(
      source.status ??
        source.transactionStatus,
    ) || 'unknown';

  const amount = toSafeNumber(
    source.amount ??
      source.value ??
      source.transactionAmount,
  );

  const channel =
    source.channel ??
    source.paymentChannel ??
    source.method ??
    '—';

  const createdAt =
    source.createdAt ??
    source.created_at ??
    source.timestamp ??
    source.date ??
    null;

  return {
    ...source,
    _id: String(id),
    reference: String(reference),
    memberName: String(memberName),
    phone: String(phone),
    type,
    status,
    amount,
    channel: String(channel),
    createdAt,
  };
}

// ============================================================================
// Abort / Cancellation Helpers
// ============================================================================

function isCancellationError(error) {
  return (
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError' ||
    String(error?.message || '')
      .toLowerCase()
      .includes('canceled')
  );
}

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({ status }) {
  const normalized =
    normalizeValue(status) || 'unknown';

  const isCompleted =
    normalized === 'completed';

  const isFailed =
    normalized === 'failed' ||
    normalized === 'reversed';

  return (
    <span
      className={`transaction-status transaction-status-${normalized}`}
      aria-label={`Transaction status: ${formatLabel(
        normalized,
      )}`}
    >
      {isCompleted && (
        <CheckCircle2
          size={13}
          aria-hidden="true"
        />
      )}

      {isFailed && (
        <XCircle
          size={13}
          aria-hidden="true"
        />
      )}

      {formatLabel(normalized)}
    </span>
  );
}

StatusBadge.defaultProps = {
  status: 'unknown',
};

// ============================================================================
// Type Badge
// ============================================================================

function TypeBadge({ type }) {
  const normalized =
    normalizeValue(type) || 'unknown';

  return (
    <span
      className={`transaction-type transaction-type-${normalized}`}
    >
      {formatLabel(normalized)}
    </span>
  );
}

TypeBadge.defaultProps = {
  type: 'unknown',
};

// ============================================================================
// Statistics Card
// ============================================================================

function StatsCard({
  title,
  value,
  icon: Icon,
  tone = 'default',
}) {
  return (
    <article
      className={`transaction-stat-card transaction-stat-card-${tone}`}
    >
      <div
        className="transaction-stat-icon"
        aria-hidden="true"
      >
        <Icon size={22} />
      </div>

      <div className="transaction-stat-content">
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

// ============================================================================
// Skeleton
// ============================================================================

function TransactionSkeleton() {
  return (
    <tr
      className="transaction-skeleton-row"
      aria-hidden="true"
    >
      <td colSpan={8}>
        <div className="transaction-skeleton">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function Transactions() {
  const navigate = useNavigate();

  const mountedRef = useRef(false);
  const abortRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const exportingRef = useRef(false);

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
    statusFilter,
    setStatusFilter,
  ] = useState('all');

  const [
    page,
    setPage,
  ] = useState(1);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(null);

  // ==========================================================================
  // Fetch Transactions
  // ==========================================================================

  const fetchTransactions = useCallback(
    async ({
      silent = false,
    } = {}) => {
      const requestId =
        ++requestSequenceRef.current;

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // Ignore cancellation cleanup failures.
        }
      }

      const controller =
        typeof AbortController !==
        'undefined'
          ? new AbortController()
          : null;

      abortRef.current =
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
            '/api/transactions',
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
              MAX_VISIBLE_TRANSACTIONS,
            )
            .map(
              normalizeTransaction,
            );

        setTransactions(
          normalized,
        );

        setLastUpdated(
          new Date(),
        );
      } catch (requestError) {
        if (
          !mountedRef.current ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        if (
          isCancellationError(
            requestError,
          )
        ) {
          return;
        }

        const status =
          requestError?.response
            ?.status;

        const serverMessage =
          requestError?.response
            ?.data?.message;

        const nextError =
          status >= 500
            ? SAFE_ERROR_MESSAGE
            : typeof serverMessage ===
                'string' &&
              serverMessage.trim()
            ? serverMessage.trim()
            : SAFE_ERROR_MESSAGE;

        setError(nextError);

        if (!silent) {
          toast.error(nextError, {
            toastId:
              'titech-transactions-load-error',
          });
        }

        // Operational logging only; sensitive payloads are excluded.
        if (
          import.meta.env?.DEV
        ) {
          // eslint-disable-next-line no-console
          console.error(
            '[TITech Transactions] Load failed',
            {
              status,
              message:
                requestError?.message,
            },
          );
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

  // ==========================================================================
  // Lifecycle / Auto Refresh
  // ==========================================================================

  useEffect(() => {
    mountedRef.current = true;

    fetchTransactions();

    refreshTimerRef.current =
      window.setInterval(
        () => {
          /*
           * Avoid polling when the browser tab is hidden.
           * This reduces unnecessary API traffic and improves operational
           * efficiency without changing the user-visible behavior.
           */
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
        },
        AUTO_REFRESH_INTERVAL,
      );

    return () => {
      mountedRef.current = false;

      requestSequenceRef.current += 1;

      if (
        refreshTimerRef.current
      ) {
        window.clearInterval(
          refreshTimerRef.current,
        );

        refreshTimerRef.current =
          null;
      }

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // Ignore cleanup failures.
        }

        abortRef.current = null;
      }
    };
  }, [fetchTransactions]);

  // ==========================================================================
  // Derived Filtering
  // ==========================================================================

  const filteredTransactions =
    useMemo(() => {
      const query =
        normalizeValue(search);

      return transactions.filter(
        (transaction) => {
          const haystack = [
            transaction.reference,
            transaction.memberName,
            transaction.phone,
            transaction.channel,
            transaction.type,
            transaction.status,
          ]
            .map(normalizeValue)
            .join(' ');

          const matchesSearch =
            !query ||
            haystack.includes(
              query,
            );

          const matchesType =
            typeFilter ===
              'all' ||
            transaction.type ===
              typeFilter;

          const matchesStatus =
            statusFilter ===
              'all' ||
            transaction.status ===
              statusFilter;

          return (
            matchesSearch &&
            matchesType &&
            matchesStatus
          );
        },
      );
    }, [
      transactions,
      search,
      typeFilter,
      statusFilter,
    ]);

  // ==========================================================================
  // Pagination
  // ==========================================================================

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredTransactions.length /
        PAGE_SIZE,
    ),
  );

  useEffect(() => {
    setPage((currentPage) =>
      Math.min(
        Math.max(
          1,
          currentPage,
        ),
        totalPages,
      ),
    );
  }, [totalPages]);

  const paginatedTransactions =
    useMemo(() => {
      const start =
        (page - 1) *
        PAGE_SIZE;

      return filteredTransactions.slice(
        start,
        start + PAGE_SIZE,
      );
    }, [
      filteredTransactions,
      page,
    ]);

  // ==========================================================================
  // Filter Reset
  // ==========================================================================

  const hasActiveFilters =
    Boolean(
      search.trim() ||
        typeFilter !== 'all' ||
        statusFilter !== 'all',
    );

  const resetFilters =
    useCallback(() => {
      setSearch('');
      setTypeFilter('all');
      setStatusFilter('all');
      setPage(1);
    }, []);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    typeFilter,
    statusFilter,
  ]);

  // ==========================================================================
  // Statistics
  // ==========================================================================

  const stats = useMemo(() => {
    const deposits =
      transactions
        .filter(
          (transaction) =>
            transaction.type ===
            'deposit',
        )
        .reduce(
          (sum, transaction) =>
            sum +
            toSafeNumber(
              transaction.amount,
            ),
          0,
        );

    const withdrawals =
      transactions
        .filter(
          (transaction) =>
            transaction.type ===
            'withdrawal',
        )
        .reduce(
          (sum, transaction) =>
            sum +
            toSafeNumber(
              transaction.amount,
            ),
          0,
        );

    const completed =
      transactions.filter(
        (transaction) =>
          transaction.status ===
          'completed',
      ).length;

    const pending =
      transactions.filter(
        (transaction) =>
          transaction.status ===
            'pending' ||
          transaction.status ===
            'processing',
      ).length;

    return {
      total:
        transactions.length,
      deposits,
      withdrawals,
      net:
        deposits -
        withdrawals,
      completed,
      pending,
    };
  }, [transactions]);

  // ==========================================================================
  // Retry
  // ==========================================================================

  const handleRetry =
    useCallback(() => {
      setPage(1);

      fetchTransactions();
    }, [fetchTransactions]);

  // ==========================================================================
  // Manual Refresh
  // ==========================================================================

  const handleRefresh =
    useCallback(() => {
      fetchTransactions({
        silent: true,
      });
    }, [fetchTransactions]);

  // ==========================================================================
  // Export
  // ==========================================================================

  const handleExport =
    useCallback(async () => {
      if (exportingRef.current) {
        return;
      }

      exportingRef.current = true;

      try {
        const response =
          await api.get(
            '/api/transactions/export',
            {
              responseType:
                'blob',
            },
          );

        const blob =
          response?.data;

        if (
          !blob ||
          typeof window ===
            'undefined'
        ) {
          throw new Error(
            'Export response was empty.',
          );
        }

        const contentType =
          response?.headers?.[
            'content-type'
          ] ||
          'text/csv;charset=utf-8';

        const safeBlob =
          blob instanceof Blob
            ? blob
            : new Blob(
                [blob],
                {
                  type:
                    contentType,
                },
              );

        const url =
          window.URL.createObjectURL(
            safeBlob,
          );

        const anchor =
          document.createElement(
            'a',
          );

        const filename =
          `titech-transactions-${new Date()
            .toISOString()
            .slice(0, 10)}.csv`;

        anchor.href = url;
        anchor.download =
          filename;

        document.body.appendChild(
          anchor,
        );

        anchor.click();

        anchor.remove();

        window.URL.revokeObjectURL(
          url,
        );

        toast.success(
          'Transaction export downloaded.',
          {
            toastId:
              'titech-transactions-export-success',
          },
        );
      } catch (exportError) {
        if (
          import.meta.env?.DEV
        ) {
          // eslint-disable-next-line no-console
          console.error(
            '[TITech Transactions] Export failed',
            {
              message:
                exportError?.message,
              status:
                exportError?.response
                  ?.status,
            },
          );
        }

        toast.error(
          EXPORT_ERROR_MESSAGE,
          {
            toastId:
              'titech-transactions-export-error',
          },
        );
      } finally {
        exportingRef.current =
          false;
      }
    }, []);

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const handleViewTransaction =
    useCallback(
      (transactionId) => {
        if (!transactionId) {
          return;
        }

        navigate(
          `/transactions/${encodeURIComponent(
            transactionId,
          )}`,
        );
      },
      [navigate],
    );

  // ==========================================================================
  // Format Last Updated
  // ==========================================================================

  const lastUpdatedLabel =
    useMemo(() => {
      if (!lastUpdated) {
        return 'Not yet synchronized';
      }

      return formatDate(
        lastUpdated,
      );
    }, [lastUpdated]);

  // ==========================================================================
  // Loading
  // ==========================================================================

  if (loading) {
    return (
      <main
        className="transactions-page"
        aria-labelledby="transactions-loading-title"
      >
        <section className="transactions-loading">
          <h1
            id="transactions-loading-title"
            className="sr-only"
          >
            Loading TITech transactions
          </h1>

          <div className="transactions-loading-header">
            <div className="transactions-loading-title" />
            <div className="transactions-loading-button" />
          </div>

          <div className="transactions-loading-stats">
            {Array.from(
              { length: 4 },
              (_, index) => (
                <div
                  key={index}
                  className="transactions-loading-stat"
                />
              ),
            )}
          </div>

          <div className="transactions-table-wrapper">
            <table className="transactions-table">
              <tbody>
                <TransactionSkeleton />
                <TransactionSkeleton />
                <TransactionSkeleton />
                <TransactionSkeleton />
                <TransactionSkeleton />
              </tbody>
            </table>
          </div>
        </section>
      </main>
    );
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <main
      className="transactions-page"
      aria-labelledby="transactions-heading"
    >
      <div className="transactions-shell">
        {/* ==================================================================
         * Header
         * ================================================================ */}

        <header className="transactions-header">
          <div className="transactions-title-block">
            <div className="transactions-title-icon">
              <Wallet
                size={22}
                aria-hidden="true"
              />
            </div>

            <div>
              <p className="transactions-eyebrow">
                TITech Community Capital
              </p>

              <h1
                id="transactions-heading"
              >
                Transactions
              </h1>

              <p>
                Monitor and review
                financial activity across
                the platform.
              </p>
            </div>
          </div>

          <div className="transactions-header-actions">
            <span className="transactions-sync-status">
              <span
                className="transactions-sync-dot"
                aria-hidden="true"
              />
              Last updated:{' '}
              {lastUpdatedLabel}
            </span>

            <button
              type="button"
              className="secondary-btn"
              onClick={
                handleRefresh
              }
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <RefreshCw
                size={17}
                aria-hidden="true"
                className={
                  refreshing
                    ? 'is-spinning'
                    : ''
                }
              />

              <span>
                {refreshing
                  ? 'Refreshing'
                  : 'Refresh'}
              </span>
            </button>

            <button
              type="button"
              className="primary-btn"
              onClick={
                handleExport
              }
              disabled={
                exportingRef.current
              }
            >
              <Download
                size={17}
                aria-hidden="true"
              />

              <span>
                Export
              </span>
            </button>
          </div>
        </header>

        {/* ==================================================================
         * KPI Cards
         * ================================================================ */}

        <section
          className="transactions-stats"
          aria-label="Transaction portfolio summary"
        >
          <StatsCard
            title="Transactions"
            value={stats.total}
            icon={CreditCard}
          />

          <StatsCard
            title="Deposits"
            value={formatCurrency(
              stats.deposits,
            )}
            icon={
              ArrowDownCircle
            }
            tone="success"
          />

          <StatsCard
            title="Withdrawals"
            value={formatCurrency(
              stats.withdrawals,
            )}
            icon={
              ArrowUpCircle
            }
            tone="warning"
          />

          <StatsCard
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            tone="success"
          />
        </section>

        {/* ==================================================================
         * Filters
         * ================================================================ */}

        <section
          className="transactions-filter-panel"
          aria-label="Transaction filters"
        >
          <div className="transactions-filter-heading">
            <Filter
              size={17}
              aria-hidden="true"
            />

            <div>
              <h2>Filter transactions</h2>
              <p>
                Search by member,
                reference, phone or
                transaction channel.
              </p>
            </div>
          </div>

          <div className="transactions-filters">
            <label
              className="transactions-search-box"
              htmlFor="transaction-search"
            >
              <Search
                size={18}
                aria-hidden="true"
              />

              <input
                id="transaction-search"
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder="Search transactions..."
                value={search}
                onChange={(
                  event,
                ) =>
                  setSearch(
                    event.target
                      .value,
                  )
                }
                aria-label="Search transactions"
              />
            </label>

            <label
              className="transactions-select-field"
              htmlFor="transaction-type-filter"
            >
              <span>
                Transaction type
              </span>

              <select
                id="transaction-type-filter"
                value={typeFilter}
                onChange={(
                  event,
                ) =>
                  setTypeFilter(
                    event.target
                      .value,
                  )
                }
              >
                {TRANSACTION_TYPES.map(
                  (type) => (
                    <option
                      key={type}
                      value={type}
                    >
                      {formatLabel(
                        type,
                      )}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label
              className="transactions-select-field"
              htmlFor="transaction-status-filter"
            >
              <span>
                Transaction status
              </span>

              <select
                id="transaction-status-filter"
                value={
                  statusFilter
                }
                onChange={(
                  event,
                ) =>
                  setStatusFilter(
                    event.target
                      .value,
                  )
                }
              >
                {TRANSACTION_STATUSES.map(
                  (status) => (
                    <option
                      key={status}
                      value={status}
                    >
                      {formatLabel(
                        status,
                      )}
                    </option>
                  ),
                )}
              </select>
            </label>

            {hasActiveFilters && (
              <button
                type="button"
                className="filter-reset-btn"
                onClick={
                  resetFilters
                }
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="transactions-filter-summary">
            Showing{' '}
            <strong>
              {paginatedTransactions.length}
            </strong>{' '}
            of{' '}
            <strong>
              {
                filteredTransactions.length
              }
            </strong>{' '}
            matching transactions
          </div>
        </section>

        {/* ==================================================================
         * Error
         * ================================================================ */}

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

            <div>
              <strong>
                Transaction data could
                not be refreshed.
              </strong>

              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={
                handleRetry
              }
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
              />

              Retry
            </button>
          </div>
        )}

        {/* ==================================================================
         * Table
         * ================================================================ */}

        <section
          className="transactions-table-section"
          aria-labelledby="transactions-table-title"
        >
          <div className="transactions-table-header">
            <div>
              <h2
                id="transactions-table-title"
              >
                Transaction activity
              </h2>

              <p>
                Financial activity visible
                to your authorized TITech
                account.
              </p>
            </div>

            {stats.pending > 0 && (
              <span className="transactions-pending-indicator">
                {stats.pending}{' '}
                pending / processing
              </span>
            )}
          </div>

          <div className="transactions-table-wrapper">
            <table className="transactions-table">
              <caption className="sr-only">
                TITech Community Capital
                transaction activity
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

                  <th
                    scope="col"
                    className="amount-column"
                  >
                    Amount
                  </th>

                  <th scope="col">
                    Status
                  </th>

                  <th scope="col">
                    Channel
                  </th>

                  <th scope="col">
                    Date
                  </th>

                  <th
                    scope="col"
                    className="actions-column"
                  >
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {paginatedTransactions.length ===
                0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="transactions-empty-cell"
                    >
                      <div className="transactions-empty-state">
                        <CreditCard
                          size={34}
                          aria-hidden="true"
                        />

                        <h3>
                          No transactions
                          found
                        </h3>

                        <p>
                          {hasActiveFilters
                            ? EMPTY_STATE_MESSAGE
                            : 'There are no transaction records available yet.'}
                        </p>

                        {hasActiveFilters && (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={
                              resetFilters
                            }
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedTransactions.map(
                    (transaction) => (
                      <tr
                        key={
                          transaction._id
                        }
                      >
                        <td>
                          <div className="transaction-reference">
                            <strong>
                              {
                                transaction.reference
                              }
                            </strong>
                            <span>
                              {
                                transaction._id
                              }
                            </span>
                          </div>
                        </td>

                        <td>
                          <div className="transaction-member">
                            <span className="transaction-member-avatar">
                              {transaction.memberName
                                .charAt(
                                  0,
                                )
                                .toUpperCase()}
                            </span>

                            <div>
                              <strong>
                                {
                                  transaction.memberName
                                }
                              </strong>

                              {transaction.phone && (
                                <span>
                                  {
                                    transaction.phone
                                  }
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td>
                          <TypeBadge
                            type={
                              transaction.type
                            }
                          />
                        </td>

                        <td className="amount-column">
                          <strong className="transaction-amount">
                            {formatCurrency(
                              transaction.amount,
                            )}
                          </strong>
                        </td>

                        <td>
                          <StatusBadge
                            status={
                              transaction.status
                            }
                          />
                        </td>

                        <td>
                          <span className="transaction-channel">
                            {
                              transaction.channel
                            }
                          </span>
                        </td>

                        <td>
                          <time
                            dateTime={
                              transaction.createdAt ||
                              undefined
                            }
                            className="transaction-date"
                          >
                            {formatDate(
                              transaction.createdAt,
                            )}
                          </time>
                        </td>

                        <td className="actions-column">
                          <button
                            type="button"
                            className="table-action-button"
                            onClick={() =>
                              handleViewTransaction(
                                transaction._id,
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
                        </td>
                      </tr>
                    ),
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* ================================================================
           * Pagination
           * ============================================================ */}

          <footer className="pagination">
            <span className="pagination-summary">
              Page{' '}
              <strong>
                {page}
              </strong>{' '}
              of{' '}
              <strong>
                {totalPages}
              </strong>
            </span>

            <div className="pagination-controls">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.max(
                        1,
                        current -
                          1,
                      ),
                  )
                }
              >
                Previous
              </button>

              <button
                type="button"
                disabled={
                  page >=
                  totalPages
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.min(
                        totalPages,
                        current +
                          1,
                      ),
                  )
                }
              >
                Next
              </button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}