// ============================================================================
// TITech Community Capital
// Enterprise Pagination Component
// File: src/components/ui/Pagination.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

// ============================================================================
// Helpers
// ============================================================================

function createPages(
  currentPage,
  totalPages,
  siblingCount = 1
) {
  const totalPageNumbers =
    siblingCount * 2 + 5;

  if (
    totalPageNumbers >=
    totalPages
  ) {
    return Array.from(
      {
        length:
          totalPages,
      },
      (_, i) => i + 1
    );
  }

  const leftSibling =
    Math.max(
      currentPage -
        siblingCount,
      1
    );

  const rightSibling =
    Math.min(
      currentPage +
        siblingCount,
      totalPages
    );

  const showLeftDots =
    leftSibling > 2;

  const showRightDots =
    rightSibling <
    totalPages - 1;

  if (!showLeftDots) {
    const pages =
      Array.from(
        {
          length:
            3 +
            siblingCount *
              2,
        },
        (_, i) =>
          i + 1
      );

    return [
      ...pages,
      "...",
      totalPages,
    ];
  }

  if (!showRightDots) {
    const pages =
      Array.from(
        {
          length:
            3 +
            siblingCount *
              2,
        },
        (_, i) =>
          totalPages -
          (3 +
            siblingCount *
              2) +
          i +
          1
      );

    return [
      1,
      "...",
      ...pages,
    ];
  }

  const middle =
    Array.from(
      {
        length:
          rightSibling -
            leftSibling +
            1,
      },
      (_, i) =>
        leftSibling +
        i
    );

  return [
    1,
    "...",
    ...middle,
    "...",
    totalPages,
  ];
}

// ============================================================================
// Component
// ============================================================================

function Pagination({
  page = 1,
  totalPages = 1,
  totalItems = 0,
  pageSize = 10,
  siblingCount = 1,
  showSummary = true,
  showPageSize = false,
  pageSizeOptions = [
    10,
    20,
    50,
    100,
  ],
  onPageChange,
  onPageSizeChange,
  className = "",
}) {
  const pages =
    useMemo(
      () =>
        createPages(
          page,
          totalPages,
          siblingCount
        ),
      [
        page,
        totalPages,
        siblingCount,
      ]
    );

  const startItem =
    totalItems === 0
      ? 0
      : (page - 1) *
          pageSize +
        1;

  const endItem =
    Math.min(
      page * pageSize,
      totalItems
    );

  const goToPage =
    (
      nextPage
    ) => {
      if (
        nextPage <
          1 ||
        nextPage >
          totalPages ||
        nextPage === page
      ) {
        return;
      }

      onPageChange?.(
        nextPage
      );
    };

  if (
    totalPages <= 1 &&
    !showSummary
  ) {
    return null;
  }

  return (
    <div
      className={`tt-pagination ${className}`}
    >
      <div className="tt-pagination-left">
        {showSummary && (
          <span className="tt-pagination-summary">
            Showing{" "}
            <strong>
              {startItem}
            </strong>{" "}
            -
            <strong>
              {endItem}
            </strong>{" "}
            of{" "}
            <strong>
              {
                totalItems
              }
            </strong>
          </span>
        )}

        {showPageSize && (
          <div className="tt-pagination-size">
            <span>
              Rows:
            </span>

            <select
              value={
                pageSize
              }
              onChange={(
                e
              ) =>
                onPageSizeChange?.(
                  Number(
                    e.target
                      .value
                  )
                )
              }
            >
              {pageSizeOptions.map(
                (
                  option
                ) => (
                  <option
                    key={
                      option
                    }
                    value={
                      option
                    }
                  >
                    {
                      option
                    }
                  </option>
                )
              )}
            </select>
          </div>
        )}
      </div>

      <div className="tt-pagination-controls">
        <button
          type="button"
          className="tt-pagination-btn"
          disabled={
            page === 1
          }
          onClick={() =>
            goToPage(1)
          }
        >
          <ChevronsLeft
            size={16}
          />
        </button>

        <button
          type="button"
          className="tt-pagination-btn"
          disabled={
            page === 1
          }
          onClick={() =>
            goToPage(
              page - 1
            )
          }
        >
          <ChevronLeft
            size={16}
          />
        </button>

        {pages.map(
          (
            item,
            index
          ) =>
            item ===
            "..." ? (
              <span
                key={`ellipsis-${index}`}
                className="tt-pagination-ellipsis"
              >
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={`tt-pagination-page ${
                  page ===
                  item
                    ? "active"
                    : ""
                }`}
                onClick={() =>
                  goToPage(
                    item
                  )
                }
              >
                {item}
              </button>
            )
        )}

        <button
          type="button"
          className="tt-pagination-btn"
          disabled={
            page ===
            totalPages
          }
          onClick={() =>
            goToPage(
              page + 1
            )
          }
        >
          <ChevronRight
            size={16}
          />
        </button>

        <button
          type="button"
          className="tt-pagination-btn"
          disabled={
            page ===
            totalPages
          }
          onClick={() =>
            goToPage(
              totalPages
            )
          }
        >
          <ChevronsRight
            size={16}
          />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

Pagination.propTypes = {
  page:
    PropTypes.number,

  totalPages:
    PropTypes.number,

  totalItems:
    PropTypes.number,

  pageSize:
    PropTypes.number,

  siblingCount:
    PropTypes.number,

  showSummary:
    PropTypes.bool,

  showPageSize:
    PropTypes.bool,

  pageSizeOptions:
    PropTypes.arrayOf(
      PropTypes.number
    ),

  onPageChange:
    PropTypes.func,

  onPageSizeChange:
    PropTypes.func,

  className:
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  Pagination
);