/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Loan Portfolio
 * File: frontend/src/pages/Loans.jsx
 *
 * Production Grade
 * ----------------------------------------------------------------------------
 * Responsibilities
 * - Display and manage the TITech loan portfolio
 * - Load loans through the enterprise API client
 * - Normalize resilient API response envelopes
 * - Support search, status filtering and pagination
 * - Provide portfolio-level operational statistics
 * - Prevent stale requests and state updates after unmount
 * - Support retry and manual/automatic refresh
 * - Preserve financial display integrity
 * - Provide accessible loading, empty and error states
 * - Avoid exposing backend implementation details
 * - Maintain TITech terminology consistently
 *
 * Important
 * - Financial mutations must remain server-authoritative.
 * - The frontend never calculates or persists ledger balances.
 * - Approval requests should be idempotent on the backend.
 * ============================================================================
 */

"use strict";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  CheckCircle,
  Eye,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../services/api";
import { formatExactIntegerCurrency } from "../utils/moneyDisplay";
import "./Loans.css";

/* ============================================================================
 * Constants
 * ========================================================================== */

const PAGE_SIZE = 10;
const AUTO_REFRESH_INTERVAL = 60_000;
const MAX_SEARCH_LENGTH = 100;

const API_ENDPOINTS = Object.freeze({
  LOANS: "/api/v1/loans",
});

const STATUS_OPTIONS = Object.freeze([
  "all",
  "draft",
  "pending",
  "credit_review",
  "manual_review",
  "approved",
  "disbursed",
  "active",
  "completed",
  "rejected",
  "cancelled",
  "defaulted",
  "written_off",
  "recovered",
  "restructured",
]);

const STATUS_LABELS = Object.freeze({
  all: "All statuses",
  draft: "Draft",
  pending: "Pending",
  credit_review: "Credit review",
  manual_review: "Manual review",
  approved: "Approved",
  disbursed: "Disbursed",
  active: "Active",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  defaulted: "Defaulted",
  written_off: "Written off",
  recovered: "Recovered",
  restructured: "Restructured",
});

const DEFAULT_ERROR_MESSAGE =
  "We could not load the loan portfolio. Please try again.";

const MAX_LOANS_PER_RESPONSE = 5000;

/* ============================================================================
 * Helpers
 * ========================================================================== */

/**
 * Safely normalize an arbitrary identifier.
 */
function getEntityId(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  return (
    entity._id ??
    entity.id ??
    entity.loanId ??
    entity.loanID ??
    entity.uuid ??
    null
  );
}

/**
 * Normalize a status for comparisons and CSS class names.
 */
function normalizeStatus(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return normalized || "pending";
}

/**
 * Return a human-readable status label.
 */
function getStatusLabel(value) {
  const normalized = normalizeStatus(value);

  return (
    STATUS_LABELS[normalized] ||
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) =>
        character.toUpperCase()
      )
  );
}

/**
 * Format exact integer monetary values for display only. Unsafe coercions are
 * rejected; authoritative loan balances remain in the backend ledger services.
 */
function formatCurrency(value) {
  return formatExactIntegerCurrency(value, "UGX", "en-UG");
}

/**
 * Format a date without throwing.
 */
function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("en-UG", {
      dateStyle: "medium",
    }).format(date);
  } catch (_) {
    return date.toLocaleDateString();
  }
}

/**
 * Normalize searchable text.
 */
function normalizeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Extract a readable error without leaking internal backend details.
 */
function getErrorMessage(error, fallback = DEFAULT_ERROR_MESSAGE) {
  if (!error) {
    return fallback;
  }

  if (
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED" ||
    error?.code === "ECONNABORTED"
  ) {
    return null;
  }

  const status = error?.response?.status;

  if (status === 401) {
    return "Your session has expired. Please sign in again.";
  }

  if (status === 403) {
    return "You are not authorized to perform this operation.";
  }

  if (status === 404) {
    return "The requested loan could not be found.";
  }

  const serverMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error;

  if (
    typeof serverMessage === "string" &&
    serverMessage.trim()
  ) {
    return serverMessage.trim();
  }

  return fallback;
}

/**
 * Extract a loan array from common enterprise API envelopes.
 *
 * Supported:
 * - { data: [...] }
 * - { data: { data: [...] } }
 * - { data: { loans: [...] } }
 * - { loans: [...] }
 * - [...]
 */
function extractLoans(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload?.data ?? payload;

  if (Array.isArray(root)) {
    return root;
  }

  if (!root || typeof root !== "object") {
    return [];
  }

  if (Array.isArray(root.loans)) {
    return root.loans;
  }

  if (Array.isArray(root.data)) {
    return root.data;
  }

  if (Array.isArray(root.results)) {
    return root.results;
  }

  if (Array.isArray(root.items)) {
    return root.items;
  }

  return [];
}

/**
 * Normalize an individual loan for safe UI consumption.
 */
function normalizeLoan(loan) {
  if (!loan || typeof loan !== "object") {
    return null;
  }

  const id = getEntityId(loan);

  if (!id) {
    return null;
  }

  const member =
    loan.member ||
    loan.borrower ||
    loan.customer ||
    null;

  const memberName =
    loan.memberName ||
    loan.borrowerName ||
    loan.customerName ||
    member?.name ||
    member?.fullName ||
    member?.displayName ||
    member?.username ||
    "Unknown member";

  const loanNumber =
    loan.loanNumber ||
    loan.loanNo ||
    loan.reference ||
    loan.referenceNumber ||
    loan.code ||
    String(id);

  return {
    ...loan,

    _id: id,

    loanNumber: String(loanNumber),

    memberName: String(memberName),

    status: normalizeStatus(loan.status),

    amount:
      loan.amount ??
      loan.principal ??
      loan.requestedAmount ??
      null,

    balance: loan.balance ?? loan.outstandingBalance ?? loan.remainingBalance ?? null,

    createdAt:
      loan.createdAt ??
      loan.created_at ??
      loan.dateCreated ??
      null,
  };
}

/**
 * Normalize a loan collection.
 */
function normalizeLoans(payload) {
  return extractLoans(payload)
    .slice(0, MAX_LOANS_PER_RESPONSE)
    .map(normalizeLoan)
    .filter(Boolean);
}

/* ============================================================================
 * Status Badge
 * ========================================================================== */

function LoanStatusBadge({ status }) {
  const normalized = normalizeStatus(status);

  return (
    <span
      className={`loan-status loan-status-${normalized}`}
      aria-label={`Loan status: ${getStatusLabel(
        normalized
      )}`}
    >
      {getStatusLabel(normalized)}
    </span>
  );
}

/* ============================================================================
 * Statistics Card
 * ========================================================================== */

function StatsCard({
  title,
  value,
  icon: Icon,
  description,
}) {
  return (
    <article
      className="loan-stat-card"
      aria-label={`${title}: ${value}`}
    >
      <div
        className="loan-stat-icon"
        aria-hidden="true"
      >
        <Icon size={24} />
      </div>

      <div className="loan-stat-content">
        <h2>{title}</h2>

        <p>{value}</p>

        {description && (
          <span>{description}</span>
        )}
      </div>
    </article>
  );
}

/* ============================================================================
 * Skeleton
 * ========================================================================== */

function LoanSkeleton() {
  return (
    <tr
      className="loan-skeleton-row"
      aria-hidden="true"
    >
      <td colSpan={7}>
        <div className="loan-skeleton" />
      </td>
    </tr>
  );
}

/* ============================================================================
 * Main Component
 * ========================================================================== */

export default function Loans() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const memberIdFilter = searchParams.get("memberId") || "";

  const mountedRef = useRef(false);
  const abortRef = useRef(null);
  const refreshRef = useRef(null);
  const requestSequenceRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [loans, setLoans] = useState([]);
  const [portfolioSummary, setPortfolioSummary] = useState({ total: 0, recordedPrincipal: null, active: 0, pending: 0, defaulted: 0 });

  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");

  const [page, setPage] = useState(1);
  const [serverPagination, setServerPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 0 });



  /* ==========================================================================
   * Fetch Loans
   * ======================================================================== */

  const fetchLoans = useCallback(
    async ({ silent = false } = {}) => {
      const requestId =
        ++requestSequenceRef.current;

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (_) {
          // Ignore cancellation cleanup failures.
        }
      }

      const controller =
        typeof AbortController !==
        "undefined"
          ? new AbortController()
          : null;

      abortRef.current = controller;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      try {
        const response = await api.get(
          API_ENDPOINTS.LOANS,
          { params: { page, limit: PAGE_SIZE, search: search.trim() || undefined, status: statusFilter, memberId: memberIdFilter || undefined }, ...(controller ? { signal: controller.signal } : {}) }
        );

        if (
          !mountedRef.current ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        const normalizedLoans = normalizeLoans(response);
        setLoans(normalizedLoans);
        const payload = response?.data ?? response;
        const data = payload?.data ?? payload;
        setServerPagination(data?.pagination || { page, limit: PAGE_SIZE, total: normalizedLoans.length, pages: normalizedLoans.length ? 1 : 0 });
        setPortfolioSummary(data?.summary || { total: Number(data?.pagination?.total) || normalizedLoans.length, recordedPrincipal: null, active: 0, pending: 0, defaulted: 0 });
      } catch (requestError) {
        if (
          !mountedRef.current ||
          requestId !==
            requestSequenceRef.current
        ) {
          return;
        }

        const message = getErrorMessage(
          requestError
        );

        if (!message) {
          return;
        }

        setError(message);
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
    [memberIdFilter, page, search, statusFilter]
  );

  /* ==========================================================================
   * Lifecycle
   * ======================================================================== */

  useEffect(() => {
    mountedRef.current = true;

    fetchLoans();

    refreshRef.current = window.setInterval(
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          fetchLoans({
            silent: true,
          });
        }
      },
      AUTO_REFRESH_INTERVAL
    );

    return () => {
      mountedRef.current = false;

      requestSequenceRef.current += 1;

      if (refreshRef.current) {
        window.clearInterval(
          refreshRef.current
        );

        refreshRef.current = null;
      }

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch (_) {
          // Ignore cancellation cleanup failures.
        }

        abortRef.current = null;
      }

    };
  }, [fetchLoans]);

  /* ==========================================================================
   * Search
   * ======================================================================== */

  const handleSearchChange = useCallback(
    (event) => {
      const value =
        event?.target?.value ?? "";

      setSearch(
        value.slice(0, MAX_SEARCH_LENGTH)
      );

      setPage(1);
    },
    []
  );

  /* ==========================================================================
   * Status Filter
   * ======================================================================== */

  const handleStatusChange = useCallback(
    (event) => {
      setStatusFilter(
        event?.target?.value || "all"
      );

      setPage(1);
    },
    []
  );

  /* ==========================================================================
   * Filtering
   * ======================================================================== */

  const filteredLoans = useMemo(() => {
    const normalizedSearch =
      normalizeSearchText(search);

    return loans.filter((loan) => {
      const searchableFields = [
        loan.loanNumber,
        loan.memberName,
        loan.member?.memberNumber,
        loan.purpose,
        loan.description,
        loan.reason,
        loan.status,
        loan._id,
      ];

      const matchesSearch =
        !normalizedSearch ||
        searchableFields.some((value) =>
          normalizeSearchText(value).includes(
            normalizedSearch
          )
        );

      const matchesStatus =
        statusFilter === "all" ||
        normalizeStatus(loan.status) ===
          statusFilter;

      return (
        matchesSearch && matchesStatus
      );
    });
  }, [
    loans,
    search,
    statusFilter,
  ]);

  /* ==========================================================================
   * Pagination
   * ======================================================================== */

  const totalPages = Math.max(1, Number(serverPagination.pages) || 1);
  const paginatedLoans = filteredLoans;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  /* ==========================================================================
   * Statistics
   * ======================================================================== */

  const stats = useMemo(() => {
    const summary = portfolioSummary;
    return {
      totalLoans: Number(summary.total ?? loans.length),
      totalAmount: summary.recordedPrincipal ?? null,
      active: Number(summary.active ?? loans.filter((loan) => ["active", "disbursed"].includes(normalizeStatus(loan.status))).length),
      pending: Number(summary.pending ?? loans.filter((loan) => ["pending", "credit_review", "manual_review"].includes(normalizeStatus(loan.status))).length),
      defaulted: Number(summary.defaulted ?? loans.filter((loan) => ["defaulted", "written_off"].includes(normalizeStatus(loan.status))).length),
    };
  }, [loans, portfolioSummary]);

  /* ==========================================================================
   * Retry
   * ======================================================================== */

  const handleRetry = useCallback(() => {
    fetchLoans();
  }, [fetchLoans]);

  /* ==========================================================================
   * Manual Refresh
   * ======================================================================== */

  const handleRefresh = useCallback(() => {
    if (refreshing) {
      return;
    }

    fetchLoans({
      silent: true,
    });
  }, [fetchLoans, refreshing]);

  /* ==========================================================================
   * Navigation
   * ======================================================================== */


  const handleViewLoan = useCallback(
    (loanId) => {
      if (!loanId) {
        return;
      }

      navigate(
        `/loans/${encodeURIComponent(
          loanId
        )}`
      );
    },
    [navigate]
  );


  /* ==========================================================================
   * Pagination Controls
   * ======================================================================== */

  const goToPreviousPage =
    useCallback(() => {
      setPage((currentPage) =>
        Math.max(1, currentPage - 1)
      );
    }, []);

  const goToNextPage =
    useCallback(() => {
      setPage((currentPage) =>
        Math.min(
          totalPages,
          currentPage + 1
        )
      );
    }, [totalPages]);

  /* ==========================================================================
   * Loading State
   * ======================================================================== */

  if (loading) {
    return (
      <main
        className="loans-page"
        aria-labelledby="loans-loading-title"
      >
        <header className="loans-header">
          <div>
            <h1 id="loans-loading-title">
              Loan Portfolio
            </h1>

            <p>
              Loading the TITech loan
              portfolio…
            </p>
          </div>
        </header>

        <section
          className="loans-table-wrapper"
          aria-busy="true"
          aria-live="polite"
        >
          <table className="loans-table">
            <thead>
              <tr>
                <th>Loan ID</th>
                <th>Member</th>
                <th>Amount</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              <LoanSkeleton />
              <LoanSkeleton />
              <LoanSkeleton />
              <LoanSkeleton />
              <LoanSkeleton />
            </tbody>
          </table>
        </section>
      </main>
    );
  }

  /* ==========================================================================
   * Main Render
   * ======================================================================== */

  return (
    <main
      className="loans-page"
      aria-labelledby="loans-page-title"
    >
      {/* ======================================================================
       * Header
       * ==================================================================== */}

      <header className="loans-header">
        <div className="loans-header-content">
          <div className="loans-page-title-group">
            <span
              className="loans-eyebrow"
              aria-hidden="true"
            >
              TITech Community Capital · Community Finance. Stronger Together.
            </span>

            <h1 id="loans-page-title">
              Loan Portfolio
            </h1>

            <p>
              Review tenant-scoped loan records and portfolio activity. Financial approval, disbursement and repayment actions remain in authorized backend workflows.
            </p>
          </div>

          <div className="loans-header-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-busy={refreshing}
              title="Refresh loan portfolio"
            >
              <RefreshCw
                size={18}
                aria-hidden="true"
                className={
                  refreshing
                    ? "loan-refresh-spin"
                    : ""
                }
              />

              <span>
                {refreshing
                  ? "Refreshing…"
                  : "Refresh"}
              </span>
            </button>

          </div>
        </div>
      </header>

      {/* ======================================================================
       * Portfolio Statistics
       * ==================================================================== */}

      <section
        className="loan-stats"
        aria-label="Loan portfolio statistics"
      >
        <StatsCard
          title="Loans"
          value={stats.totalLoans}
          icon={CreditCard}
          description="Total portfolio records"
        />

        <StatsCard
          title="Portfolio"
          value={stats.totalAmount === null || stats.totalAmount === undefined ? "Not reported" : formatCurrency(stats.totalAmount)}
          icon={CreditCard}
          description="Total recorded principal"
        />

        <StatsCard
          title="Active"
          value={stats.active}
          icon={CheckCircle}
          description="Currently active loans"
        />

        <StatsCard
          title="Pending"
          value={stats.pending}
          icon={Clock}
          description="Awaiting approval"
        />

        <StatsCard
          title="Defaulted"
          value={stats.defaulted}
          icon={XCircle}
          description="Defaulted loans"
        />
      </section>

      {/* ======================================================================
       * Filters
       * ==================================================================== */}

      <section
        className="loan-filters"
        aria-label="Loan portfolio filters"
      >
        <div className="search-box">
          <Search
            size={18}
            aria-hidden="true"
          />

          <label
            htmlFor="loan-search"
            className="sr-only"
          >
            Search loans
          </label>

          <input
            id="loan-search"
            type="search"
            placeholder="Search by loan ID, purpose or member…"
            value={search}
            onChange={
              handleSearchChange
            }
            maxLength={
              MAX_SEARCH_LENGTH
            }
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <div className="loan-status-filter">
          <label
            htmlFor="loan-status-filter"
            className="sr-only"
          >
            Filter loans by status
          </label>

          <select
            id="loan-status-filter"
            value={statusFilter}
            onChange={
              handleStatusChange
            }
          >
            {STATUS_OPTIONS.map(
              (status) => (
                <option
                  key={status}
                  value={status}
                >
                  {STATUS_LABELS[
                    status
                  ] ||
                    getStatusLabel(
                      status
                    )}
                </option>
              )
            )}
          </select>
        </div>
      </section>

      {/* ======================================================================
       * Error State
       * ==================================================================== */}

      {error && (
        <section
          className="error-box"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle
            size={20}
            aria-hidden="true"
          />

          <div>
            <strong>
              Unable to load portfolio
            </strong>

            <p>{error}</p>
          </div>

          <button
            type="button"
            onClick={handleRetry}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
            />

            <span>Retry</span>
          </button>
        </section>
      )}

      {/* ======================================================================
       * Data Table
       * ==================================================================== */}

      <section
        className="loans-table-wrapper"
        aria-label="Loan portfolio"
      >
        <div className="loans-table-header">
          <div>
            <h2>Loans</h2>

            <p
              aria-live="polite"
              aria-atomic="true"
            >
              {Number(serverPagination.total) || 0}{" "}
              {Number(serverPagination.total) === 1
                ? "loan"
                : "loans"}{" "}
              found
            </p>
          </div>

          <div
            className="loans-security-indicator"
            title="Financial actions are authorized by the TITech backend"
          >
            <ShieldCheck
              size={17}
              aria-hidden="true"
            />

            <span>
              Tenant-scoped read-only records
            </span>
          </div>
        </div>

        {paginatedLoans.length === 0 ? (
          <div
            className="loans-empty-state"
            role="status"
          >
            <CreditCard
              size={40}
              aria-hidden="true"
            />

            <h3>
              {loans.length === 0
                ? "No loans found"
                : "No matching loans"}
            </h3>

            <p>
              {loans.length === 0
                ? "There are no loan records available in the portfolio yet."
                : "Try adjusting your search or status filter."}
            </p>

            {(search ||
              statusFilter !== "all") && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setPage(1);
                }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="loans-table-scroll">
            <table className="loans-table">
              <caption className="sr-only">
                TITech Community Capital
                loan portfolio
              </caption>

              <thead>
                <tr>
                  <th scope="col">
                    Loan ID
                  </th>

                  <th scope="col">
                    Member
                  </th>

                  <th scope="col">
                    Amount
                  </th>

                  <th scope="col">
                    Recorded balance*
                  </th>

                  <th scope="col">
                    Status
                  </th>

                  <th scope="col">
                    Created
                  </th>

                  <th scope="col">
                    <span className="sr-only">
                      Actions
                    </span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {paginatedLoans.map(
                  (loan) => {
                    const loanId =
                      getEntityId(loan);

                    return (
                      <tr
                        key={String(
                          loanId
                        )}
                      >
                        <td>
                          <button
                            type="button"
                            className="loan-number-button"
                            onClick={() =>
                              handleViewLoan(
                                loanId
                              )
                            }
                          >
                            {
                              loan.loanNumber
                            }
                          </button>
                        </td>

                        <td>
                          <div className="loan-member">
                            <strong>
                              {
                                loan.memberName
                              }
                            </strong>
                          </div>
                        </td>

                        <td>
                          <span className="loan-amount">
                            {formatCurrency(
                              loan.amount
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="loan-balance">
                            {loan.balance === null ? "Not available" : formatCurrency(loan.balance)}
                          </span>
                        </td>

                        <td>
                          <LoanStatusBadge
                            status={
                              loan.status
                            }
                          />
                        </td>

                        <td>
                          <time
                            dateTime={
                              loan.createdAt ||
                              undefined
                            }
                          >
                            {formatDate(
                              loan.createdAt
                            )}
                          </time>
                        </td>

                        <td>
                          <div className="action-buttons" aria-label={`Actions for loan ${loan.loanNumber}`}>
                            <button type="button" onClick={() => handleViewLoan(loanId)} title="View loan" aria-label={`View loan ${loan.loanNumber}`}>
                              <Eye size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ====================================================================
         * Pagination
         * ================================================================== */}

        {totalPages > 1 && (
          <footer
            className="pagination"
            aria-label="Loan pagination"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={
                goToPreviousPage
              }
              aria-label="Previous page"
            >
              <ChevronLeft
                size={18}
                aria-hidden="true"
              />

              <span>
                Previous
              </span>
            </button>

            <span
              className="pagination-status"
              aria-live="polite"
            >
              Page {page} of{" "}
              {totalPages}
            </span>

            <button
              type="button"
              disabled={
                page >= totalPages
              }
              onClick={
                goToNextPage
              }
              aria-label="Next page"
            >
              <span>Next</span>

              <ChevronRight
                size={18}
                aria-hidden="true"
              />
            </button>
          </footer>
        )}
      </section>

      {/* ======================================================================
       * Operational Notice
       * ==================================================================== */}

      <aside
        className="loans-operational-note"
        role="note"
      >
        <ShieldCheck
          size={18}
          aria-hidden="true"
        />

        <p>
          Loan approvals and financial
          balances are controlled by the
          TITech backend. The values displayed
          here are for operational visibility
          and do not replace the authoritative
          financial ledger.
        </p>
      </aside>
    </main>
  );
}