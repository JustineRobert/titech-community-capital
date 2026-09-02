// ============================================================================
// TITech Community Capital
// Group List
// File: frontend/src/pages/dashboard/GroupList.jsx
// Production Grade
// Multi-Tenant | Search | Filters | Pagination | Resilient UI | Accessible
// ============================================================================

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Search,
  Users,
  Calendar,
  PiggyBank,
  ArrowRight,
  Building2,
  Filter,
  RefreshCw,
  X,
} from "lucide-react";

import {
  Card,
  Button,
  Input,
  StatusBadge,
  Pagination,
  Skeleton,
  EmptyState,
} from "../../ui";

import "./GroupList.css";

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 12;

const DEFAULT_GROUP_STATUS = "active";

const STATUS_COLORS = Object.freeze({
  active: "success",
  suspended: "danger",
  inactive: "warning",
  pending: "warning",
});

const STATUS_LABELS = Object.freeze({
  active: "Active",
  suspended: "Suspended",
  inactive: "Inactive",
  pending: "Pending",
});

const STATUS_FILTERS = Object.freeze([
  {
    value: "all",
    label: "All statuses",
  },
  {
    value: "active",
    label: "Active",
  },
  {
    value: "pending",
    label: "Pending",
  },
  {
    value: "inactive",
    label: "Inactive",
  },
  {
    value: "suspended",
    label: "Suspended",
  },
]);

// ============================================================================
// Helpers
// ============================================================================

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const getGroupId = (group, fallbackIndex = 0) =>
  group?._id ??
  group?.id ??
  group?.groupId ??
  group?.uuid ??
  `group-${fallbackIndex}`;

const getGroupStatus = (group) => {
  const normalized = normalizeText(
    group?.status
  );

  return STATUS_COLORS[
    normalized
  ]
    ? normalized
    : DEFAULT_GROUP_STATUS;
};

const getMemberCount = (group) => {
  const explicitCount =
    Number(
      group?.memberCount
    );

  if (
    Number.isFinite(
      explicitCount
    ) &&
    explicitCount >= 0
  ) {
    return explicitCount;
  }

  if (
    Array.isArray(
      group?.members
    )
  ) {
    return group.members.length;
  }

  return 0;
};

const getContributionAmount = (
  group
) => {
  const candidates = [
    group?.totalContributions,
    group?.totalSavings,
    group?.contributionBalance,
    group?.balance,
  ];

  const value =
    candidates.find(
      (candidate) =>
        candidate !==
          null &&
        candidate !==
          undefined &&
        candidate !== ""
    );

  const numericValue =
    Number(value);

  return Number.isFinite(
    numericValue
  )
    ? numericValue
    : 0;
};

const formatCurrency = (
  amount
) => {
  const numericValue =
    Number(amount);

  return new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }
  ).format(
    Number.isFinite(
      numericValue
    )
      ? numericValue
      : 0
  );
};

const formatNumber = (
  value
) => {
  const numericValue =
    Number(value);

  return new Intl.NumberFormat(
    "en-UG"
  ).format(
    Number.isFinite(
      numericValue
    )
      ? numericValue
      : 0
  );
};

const formatDate = (
  value
) => {
  if (!value) {
    return "N/A";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "N/A";
  }

  return new Intl.DateTimeFormat(
    "en-UG",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
    }
  ).format(date);
};

const getSearchableText = (
  group
) =>
  [
    group?.name,
    group?.description,
    group?.code,
    group?.groupCode,
    group?.location,
    group?.district,
    group?.region,
    group?.status,
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(" ");

const hasSearchOrFilter = (
  search,
  statusFilter
) =>
  Boolean(
    normalizeText(search)
  ) ||
  statusFilter !== "all";

// ============================================================================
// Group Card
// ============================================================================

const GroupCard = memo(
  function GroupCard({
    group,
    groupIndex,
    onOpen,
  }) {
    const groupId =
      getGroupId(
        group,
        groupIndex
      );

    const status =
      getGroupStatus(group);

    const memberCount =
      getMemberCount(group);

    const contributionAmount =
      getContributionAmount(
        group
      );

    const description =
      String(
        group?.description ??
          ""
      ).trim();

    const groupName =
      String(
        group?.name ??
          "Unnamed Group"
      ).trim();

    const nextContributionDate =
      group?.nextContributionDate ??
      group?.nextContribution ??
      group?.nextMeetingDate;

    const handleOpen =
      useCallback(() => {
        onOpen?.(group);
      }, [
        group,
        onOpen,
      ]);

    const handleKeyDown =
      useCallback(
        (event) => {
          if (
            event.key ===
              "Enter" ||
            event.key ===
              " "
          ) {
            event.preventDefault();
            handleOpen();
          }
        },
        [handleOpen]
      );

    return (
      <Card
        className="group-card"
        data-group-id={
          groupId
        }
      >
        {/* ============================================================ */}
        {/* Card Header */}
        {/* ============================================================ */}

        <div className="group-card-header">
          <div
            className="group-avatar"
            aria-hidden="true"
          >
            <Building2
              size={22}
            />
          </div>

          <StatusBadge
            status={
              STATUS_COLORS[
                status
              ] ??
              "success"
            }
          >
            {STATUS_LABELS[
              status
            ] ??
              status}
          </StatusBadge>
        </div>

        {/* ============================================================ */}
        {/* Group Identity */}
        {/* ============================================================ */}

        <h3
          title={
            groupName
          }
        >
          {groupName}
        </h3>

        <p className="group-description">
          {description ||
            "No description available."}
        </p>

        {/* ============================================================ */}
        {/* Metadata */}
        {/* ============================================================ */}

        <div
          className="group-meta"
          aria-label={`${groupName} details`}
        >
          <div
            title="Members"
          >
            <Users
              size={16}
              aria-hidden="true"
            />

            <span>
              {formatNumber(
                memberCount
              )}{" "}
              {memberCount ===
              1
                ? "Member"
                : "Members"}
            </span>
          </div>

          <div
            title="Total contributions"
          >
            <PiggyBank
              size={16}
              aria-hidden="true"
            />

            <span>
              {formatCurrency(
                contributionAmount
              )}
            </span>
          </div>

          <div
            title="Next contribution date"
          >
            <Calendar
              size={16}
              aria-hidden="true"
            />

            <span>
              {formatDate(
                nextContributionDate
              )}
            </span>
          </div>
        </div>

        {/* ============================================================ */}
        {/* Action */}
        {/* ============================================================ */}

        <Button
          type="button"
          className="group-open-btn"
          onClick={
            handleOpen
          }
          onKeyDown={
            handleKeyDown
          }
          aria-label={`Open ${groupName}`}
        >
          Open Group

          <ArrowRight
            size={16}
            aria-hidden="true"
          />
        </Button>
      </Card>
    );
  }
);

GroupCard.displayName =
  "GroupCard";

GroupCard.propTypes = {
  group:
    PropTypes.object.isRequired,

  groupIndex:
    PropTypes.number,

  onOpen:
    PropTypes.func,
};

// ============================================================================
// Loading State
// ============================================================================

const GroupListSkeleton =
  memo(
    function GroupListSkeleton() {
      return (
        <div
          className="group-grid group-grid-loading"
          aria-busy="true"
          aria-label="Loading groups"
        >
          {Array.from({
            length: 6,
          }).map(
            (_, index) => (
              <Card
                key={`group-skeleton-${index}`}
                className="group-card group-card-skeleton"
              >
                <Skeleton
                  height={52}
                />

                <Skeleton
                  height={24}
                />

                <Skeleton
                  height={52}
                />

                <Skeleton
                  height={80}
                />

                <Skeleton
                  height={42}
                />
              </Card>
            )
          )}
        </div>
      );
    }
  );

GroupListSkeleton.displayName =
  "GroupListSkeleton";

// ============================================================================
// Main Component
// ============================================================================

function GroupList({
  groups = [],
  loading = false,
  refreshing = false,
  onOpenGroup,
  onRefresh,
}) {
  const [
    search,
    setSearch,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all");

  const [
    page,
    setPage,
  ] = useState(1);

  // ========================================================================
  // Normalize Input
  // ========================================================================

  const normalizedGroups =
    useMemo(
      () =>
        Array.isArray(
          groups
        )
          ? groups.filter(
              Boolean
            )
          : [],
      [groups]
    );

  // ========================================================================
  // Search + Filtering
  // ========================================================================

  const normalizedSearch =
    useMemo(
      () =>
        normalizeText(
          search
        ),
      [search]
    );

  const filteredGroups =
    useMemo(() => {
      return normalizedGroups.filter(
        (group) => {
          const searchableText =
            getSearchableText(
              group
            );

          const matchesSearch =
            !normalizedSearch ||
            searchableText.includes(
              normalizedSearch
            );

          const matchesStatus =
            statusFilter ===
              "all" ||
            getGroupStatus(
              group
            ) ===
              statusFilter;

          return (
            matchesSearch &&
            matchesStatus
          );
        }
      );
    }, [
      normalizedGroups,
      normalizedSearch,
      statusFilter,
    ]);

  // ========================================================================
  // Pagination
  // ========================================================================

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filteredGroups.length /
          PAGE_SIZE
      )
    );

  const safePage =
    Math.min(
      page,
      totalPages
    );

  const paginatedGroups =
    useMemo(() => {
      const start =
        (safePage - 1) *
        PAGE_SIZE;

      return filteredGroups.slice(
        start,
        start +
          PAGE_SIZE
      );
    }, [
      filteredGroups,
      safePage,
    ]);

  // ========================================================================
  // Pagination Bounds
  // ========================================================================

  useEffect(() => {
    if (
      page >
      totalPages
    ) {
      setPage(
        totalPages
      );
    }
  }, [
    page,
    totalPages,
  ]);

  // ========================================================================
  // Reset Pagination When Search/Filter Changes
  // ========================================================================

  useEffect(() => {
    setPage(1);
  }, [
    normalizedSearch,
    statusFilter,
  ]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleSearchChange =
    useCallback(
      (event) => {
        setSearch(
          event?.target
            ?.value ?? ""
        );
      },
      []
    );

  const handleStatusChange =
    useCallback(
      (event) => {
        setStatusFilter(
          event?.target
            ?.value ??
            "all"
        );
      },
      []
    );

  const handlePageChange =
    useCallback(
      (nextPage) => {
        const numericPage =
          Number(
            nextPage
          );

        if (
          Number.isFinite(
            numericPage
          )
        ) {
          setPage(
            Math.min(
              Math.max(
                1,
                numericPage
              ),
              totalPages
            )
          );
        }
      },
      [totalPages]
    );

  const handleOpenGroup =
    useCallback(
      (group) => {
        onOpenGroup?.(
          group
        );
      },
      [onOpenGroup]
    );

  const handleRefresh =
    useCallback(() => {
      onRefresh?.();
    }, [onRefresh]);

  const handleClearFilters =
    useCallback(() => {
      setSearch("");
      setStatusFilter(
        "all"
      );
      setPage(1);
    }, []);

  // ========================================================================
  // Derived State
  // ========================================================================

  const isFiltering =
    hasSearchOrFilter(
      search,
      statusFilter
    );

  const hasGroups =
    normalizedGroups.length >
    0;

  const hasFilteredResults =
    filteredGroups.length >
    0;

  const showingStart =
    hasFilteredResults
      ? (safePage - 1) *
          PAGE_SIZE +
        1
      : 0;

  const showingEnd =
    hasFilteredResults
      ? Math.min(
          safePage *
            PAGE_SIZE,
          filteredGroups.length
        )
      : 0;

  // ========================================================================
  // Loading
  // ========================================================================

  if (loading) {
    return (
      <section
        className="group-list"
        aria-label="Groups"
      >
        <GroupListSkeleton />
      </section>
    );
  }

  // ========================================================================
  // No Groups
  // ========================================================================

  if (!hasGroups) {
    return (
      <section
        className="group-list"
        aria-label="Groups"
      >
        <EmptyState
          title="No Groups Found"
          description="No savings groups are currently available."
        />
      </section>
    );
  }

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <section
      className="group-list"
      aria-label="Savings groups"
    >
      {/* ================================================================== */}
      {/* Toolbar */}
      {/* ================================================================== */}

      <div
        className="group-toolbar"
        role="search"
        aria-label="Search and filter groups"
      >
        {/* Search */}
        <div className="group-search">
          <Search
            size={18}
            aria-hidden="true"
          />

          <Input
            id="group-search"
            name="groupSearch"
            type="search"
            placeholder="Search groups..."
            value={search}
            onChange={
              handleSearchChange
            }
            aria-label="Search groups"
            autoComplete="off"
          />

          {search && (
            <button
              type="button"
              className="group-search-clear"
              onClick={() =>
                setSearch("")
              }
              aria-label="Clear group search"
              title="Clear search"
            >
              <X
                size={16}
                aria-hidden="true"
              />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="group-actions">
          <div className="group-filter">
            <Filter
              size={16}
              aria-hidden="true"
            />

            <label
              htmlFor="group-status-filter"
              className="sr-only"
            >
              Filter groups by status
            </label>

            <select
              id="group-status-filter"
              name="groupStatus"
              value={
                statusFilter
              }
              onChange={
                handleStatusChange
              }
              aria-label="Filter groups by status"
            >
              {STATUS_FILTERS.map(
                ({
                  value,
                  label,
                }) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {label}
                  </option>
                )
              )}
            </select>
          </div>

          {onRefresh && (
            <Button
              type="button"
              variant="secondary"
              onClick={
                handleRefresh
              }
              disabled={
                refreshing
              }
              aria-busy={
                refreshing
              }
              aria-label={
                refreshing
                  ? "Refreshing groups"
                  : "Refresh groups"
              }
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={
                  refreshing
                    ? "group-refresh-spinning"
                    : undefined
                }
              />

              {refreshing
                ? "Refreshing..."
                : "Refresh"}
            </Button>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Summary */}
      {/* ================================================================== */}

      <div
        className="group-summary"
        aria-live="polite"
      >
        <span>
          {hasFilteredResults ? (
            <>
              Showing{" "}
              <strong>
                {showingStart}
              </strong>
              –
              <strong>
                {showingEnd}
              </strong>{" "}
              of{" "}
              <strong>
                {
                  filteredGroups.length
                }
              </strong>{" "}
              groups
            </>
          ) : (
            <>
              <strong>
                0
              </strong>{" "}
              groups found
            </>
          )}
        </span>

        {isFiltering && (
          <Button
            type="button"
            variant="secondary"
            onClick={
              handleClearFilters
            }
            aria-label="Clear group search and filters"
          >
            <X
              size={15}
              aria-hidden="true"
            />
            Clear Filters
          </Button>
        )}
      </div>

      {/* ================================================================== */}
      {/* Filtered Empty State */}
      {/* ================================================================== */}

      {!hasFilteredResults ? (
        <EmptyState
          title="No Matching Groups"
          description="No groups match your current search or status filter."
        />
      ) : (
        <>
          {/* ================================================================ */}
          {/* Grid */}
          {/* ================================================================ */}

          <div
            className="group-grid"
            role="list"
            aria-label="Savings groups"
          >
            {paginatedGroups.map(
              (
                group,
                index
              ) => (
                <div
                  key={getGroupId(
                    group,
                    index
                  )}
                  role="listitem"
                >
                  <GroupCard
                    group={
                      group
                    }
                    groupIndex={
                      index
                    }
                    onOpen={
                      handleOpenGroup
                    }
                  />
                </div>
              )
            )}
          </div>

          {/* ================================================================ */}
          {/* Pagination */}
          {/* ================================================================ */}

          {totalPages > 1 && (
            <div
              className="group-pagination"
              aria-label="Group pagination"
            >
              <Pagination
                page={
                  safePage
                }
                totalPages={
                  totalPages
                }
                onChange={
                  handlePageChange
                }
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ============================================================================
// Prop Types
// ============================================================================

GroupList.propTypes = {
  groups:
    PropTypes.arrayOf(
      PropTypes.object
    ),

  loading:
    PropTypes.bool,

  refreshing:
    PropTypes.bool,

  onOpenGroup:
    PropTypes.func,

  onRefresh:
    PropTypes.func,
};

GroupList.defaultProps = {
  groups: [],
  loading: false,
  refreshing: false,
  onOpenGroup:
    undefined,
  onRefresh:
    undefined,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  GroupList
);