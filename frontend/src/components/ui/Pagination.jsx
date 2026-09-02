// ============================================================================
// TITech Community Capital
// Enterprise Pagination Component
// File: frontend/src/components/ui/Pagination.jsx
// Production Grade
// ============================================================================

"use strict";

import React, {
  forwardRef,
  memo,
  useCallback,
  useMemo,
} from "react";

import PropTypes from "prop-types";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SIBLING_COUNT = 1;
const DEFAULT_BOUNDARY_COUNT = 1;

const PAGE_SIZES = Object.freeze([
  10,
  20,
  25,
  50,
  100,
]);

const SIZE_CLASSES = Object.freeze({
  sm: "pagination-sm",
  md: "pagination-md",
  lg: "pagination-lg",
});

const VARIANT_CLASSES = Object.freeze({
  default: "pagination-default",
  compact: "pagination-compact",
  outlined: "pagination-outlined",
});

// ============================================================================
// Helpers
// ============================================================================

function cx(...classes) {
  return classes
    .flat()
    .filter(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0
    )
    .join(" ");
}

function toPositiveInteger(
  value,
  fallback
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number < 1
  ) {
    return fallback;
  }

  return Math.floor(number);
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    Math.max(value, minimum),
    maximum
  );
}

/**
 * Generates a stable pagination model.
 *
 * Example:
 *
 * [
 *   1,
 *   "start-ellipsis",
 *   4,
 *   5,
 *   6,
 *   "end-ellipsis",
 *   20
 * ]
 */
function createPaginationRange({
  page,
  totalPages,
  siblingCount,
  boundaryCount,
}) {
  if (totalPages <= 0) {
    return [];
  }

  const safePage = clamp(
    page,
    1,
    totalPages
  );

  const safeSiblingCount =
    Math.max(
      0,
      Math.floor(
        siblingCount
      )
    );

  const safeBoundaryCount =
    Math.max(
      1,
      Math.floor(
        boundaryCount
      )
    );

  const totalVisible =
    safeBoundaryCount * 2 +
    safeSiblingCount * 2 +
    3;

  if (
    totalPages <=
    totalVisible + 1
  ) {
    return Array.from(
      {
        length: totalPages,
      },
      (_, index) =>
        index + 1
    );
  }

  const leftBoundary =
    Math.max(
      safePage -
        safeSiblingCount,
      safeBoundaryCount + 2
    );

  const rightBoundary =
    Math.min(
      safePage +
        safeSiblingCount,
      totalPages -
        safeBoundaryCount -
        1
    );

  const leftPages =
    Array.from(
      {
        length:
          safeBoundaryCount,
      },
      (_, index) =>
        index + 1
    );

  const rightPages =
    Array.from(
      {
        length:
          safeBoundaryCount,
      },
      (_, index) =>
        totalPages -
        safeBoundaryCount +
        index +
        1
    );

  const range = [
    ...leftPages,
  ];

  if (
    leftBoundary >
    safeBoundaryCount + 2
  ) {
    range.push(
      "start-ellipsis"
    );
  } else {
    for (
      let value =
        safeBoundaryCount + 1;
      value <
      leftBoundary;
      value += 1
    ) {
      range.push(value);
    }
  }

  for (
    let value =
      leftBoundary;
    value <=
    rightBoundary;
    value += 1
  ) {
    range.push(value);
  }

  if (
    rightBoundary <
    totalPages -
      safeBoundaryCount -
      1
  ) {
    range.push(
      "end-ellipsis"
    );
  } else {
    for (
      let value =
        rightBoundary + 1;
      value <=
      totalPages -
        safeBoundaryCount;
      value += 1
    ) {
      range.push(value);
    }
  }

  range.push(
    ...rightPages
  );

  return range;
}

function getTotalPages(
  totalItems,
  pageSize
) {
  if (
    totalItems <= 0 ||
    pageSize <= 0
  ) {
    return 0;
  }

  return Math.ceil(
    totalItems / pageSize
  );
}

// ============================================================================
// Pagination Button
// ============================================================================

const PaginationButton = memo(
  function PaginationButton({
    children,
    active = false,
    disabled = false,
    ariaLabel,
    onClick,
    className = "",
  }) {
    return (
      <button
        type="button"
        className={cx(
          "pagination-button",
          active
            ? "pagination-button-active"
            : "",
          disabled
            ? "pagination-button-disabled"
            : "",
          className
        )}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-current={
          active
            ? "page"
            : undefined
        }
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
);

PaginationButton.displayName =
  "PaginationButton";

// ============================================================================
// Pagination Component
// ============================================================================

const Pagination = forwardRef(
  (
    {
      page = DEFAULT_PAGE,
      currentPage,
      totalPages,
      totalItems,
      pageSize = DEFAULT_PAGE_SIZE,
      limit,
      pageCount,

      onPageChange,
      onChange,

      onNext,
      onPrevious,

      showFirstLast = true,
      showPreviousNext = true,
      showPageNumbers = true,

      siblingCount =
        DEFAULT_SIBLING_COUNT,
      boundaryCount =
        DEFAULT_BOUNDARY_COUNT,

      showPageSize = false,
      pageSizeOptions =
        PAGE_SIZES,
      onPageSizeChange,

      showSummary = false,
      summaryTemplate,

      disabled = false,
      loading = false,

      size = "md",
      variant = "default",

      ariaLabel =
        "Pagination navigation",

      className = "",
      listClassName = "",

      renderPage,
      renderEllipsis,

      children,

      ...props
    },
    ref
  ) => {
    // ========================================================================
    // Normalize Inputs
    // ========================================================================

    const resolvedPageSize =
      toPositiveInteger(
        limit ??
          pageSize,
        DEFAULT_PAGE_SIZE
      );

    const resolvedPage =
      toPositiveInteger(
        currentPage ??
          page,
        DEFAULT_PAGE
      );

    const resolvedTotalPages =
      toPositiveInteger(
        pageCount ??
          totalPages,
        totalItems != null
          ? getTotalPages(
              Number(
                totalItems
              ) || 0,
              resolvedPageSize
            )
          : 0
      );

    const safePage =
      resolvedTotalPages > 0
        ? clamp(
            resolvedPage,
            1,
            resolvedTotalPages
          )
        : 1;

    const isBusy =
      Boolean(
        disabled || loading
      );

    // ========================================================================
    // Pagination Range
    // ========================================================================

    const paginationRange =
      useMemo(
        () =>
          createPaginationRange(
            {
              page: safePage,
              totalPages:
                resolvedTotalPages,
              siblingCount,
              boundaryCount,
            }
          ),
        [
          safePage,
          resolvedTotalPages,
          siblingCount,
          boundaryCount,
        ]
      );

    // ========================================================================
    // Event Dispatch
    // ========================================================================

    const emitPageChange =
      useCallback(
        (nextPage) => {
          if (
            isBusy ||
            resolvedTotalPages <= 0
          ) {
            return;
          }

          const normalizedPage =
            clamp(
              Number(nextPage),
              1,
              resolvedTotalPages
            );

          if (
            normalizedPage ===
            safePage
          ) {
            return;
          }

          if (
            typeof onPageChange ===
            "function"
          ) {
            onPageChange(
              normalizedPage
            );
          }

          if (
            typeof onChange ===
            "function"
          ) {
            onChange(
              normalizedPage
            );
          }
        },
        [
          isBusy,
          resolvedTotalPages,
          safePage,
          onPageChange,
          onChange,
        ]
      );

    const goToNext =
      useCallback(() => {
        if (
          safePage >=
          resolvedTotalPages
        ) {
          return;
        }

        const nextPage =
          safePage + 1;

        if (
          typeof onNext ===
          "function"
        ) {
          onNext(nextPage);
        }

        emitPageChange(
          nextPage
        );
      }, [
        safePage,
        resolvedTotalPages,
        onNext,
        emitPageChange,
      ]);

    const goToPrevious =
      useCallback(() => {
        if (safePage <= 1) {
          return;
        }

        const previousPage =
          safePage - 1;

        if (
          typeof onPrevious ===
          "function"
        ) {
          onPrevious(
            previousPage
          );
        }

        emitPageChange(
          previousPage
        );
      }, [
        safePage,
        onPrevious,
        emitPageChange,
      ]);

    const goToFirst =
      useCallback(() => {
        emitPageChange(1);
      }, [
        emitPageChange,
      ]);

    const goToLast =
      useCallback(() => {
        emitPageChange(
          resolvedTotalPages
        );
      }, [
        emitPageChange,
        resolvedTotalPages,
      ]);

    // ========================================================================
    // Page Size
    // ========================================================================

    const handlePageSizeChange =
      useCallback(
        (event) => {
          const nextSize =
            toPositiveInteger(
              event.target.value,
              resolvedPageSize
            );

          if (
            typeof onPageSizeChange ===
            "function"
          ) {
            onPageSizeChange(
              nextSize
            );
          }
        },
        [
          resolvedPageSize,
          onPageSizeChange,
        ]
      );

    // ========================================================================
    // Summary
    // ========================================================================

    const summary =
      useMemo(() => {
        if (
          totalItems == null ||
          resolvedTotalPages ===
            0
        ) {
          return "";
        }

        const total =
          Math.max(
            0,
            Number(totalItems) ||
              0
          );

        const start =
          total === 0
            ? 0
            : (safePage - 1) *
                resolvedPageSize +
              1;

        const end =
          Math.min(
            safePage *
              resolvedPageSize,
            total
          );

        if (
          typeof summaryTemplate ===
          "function"
        ) {
          return summaryTemplate(
            {
              start,
              end,
              total,
              page: safePage,
              pageSize:
                resolvedPageSize,
              totalPages:
                resolvedTotalPages,
            }
          );
        }

        return `Showing ${start}-${end} of ${total}`;
      }, [
        totalItems,
        resolvedTotalPages,
        safePage,
        resolvedPageSize,
        summaryTemplate,
      ]);

    // ========================================================================
    // Empty State
    // ========================================================================

    if (
      resolvedTotalPages <= 1 &&
      !showPageSize &&
      !showSummary &&
      !children
    ) {
      return null;
    }

    // ========================================================================
    // Classes
    // ========================================================================

    const safeSize =
      SIZE_CLASSES[size]
        ? size
        : "md";

    const safeVariant =
      VARIANT_CLASSES[
        variant
      ]
        ? variant
        : "default";

    const classes =
      cx(
        "tt-pagination",
        SIZE_CLASSES[
          safeSize
        ],
        VARIANT_CLASSES[
          safeVariant
        ],
        loading
          ? "pagination-loading"
          : "",
        isBusy
          ? "pagination-disabled"
          : "",
        className
      );

    // ========================================================================
    // Render Page
    // ========================================================================

    const renderPageButton =
      (pageNumber) => {
        if (
          typeof renderPage ===
          "function"
        ) {
          return renderPage({
            page:
              pageNumber,
            currentPage:
              safePage,
            active:
              pageNumber ===
              safePage,
            disabled:
              isBusy,
            onClick:
              () =>
                emitPageChange(
                  pageNumber
                ),
          });
        }

        return (
          <PaginationButton
            key={`page-${pageNumber}`}
            active={
              pageNumber ===
              safePage
            }
            disabled={
              isBusy
            }
            ariaLabel={
              pageNumber ===
              safePage
                ? `Page ${pageNumber}, current page`
                : `Go to page ${pageNumber}`
            }
            onClick={() =>
              emitPageChange(
                pageNumber
              )
            }
          >
            {pageNumber}
          </PaginationButton>
        );
      };

    // ========================================================================
    // Render Ellipsis
    // ========================================================================

    const renderEllipsisItem =
      (key) => {
        if (
          typeof renderEllipsis ===
          "function"
        ) {
          return (
            <React.Fragment
              key={key}
            >
              {renderEllipsis()}
            </React.Fragment>
          );
        }

        return (
          <span
            key={key}
            className="pagination-ellipsis"
            aria-hidden="true"
          >
            <MoreHorizontal
              size={18}
            />
          </span>
        );
      };

    // ========================================================================
    // Render
    // ========================================================================

    return (
      <nav
        ref={ref}
        className={classes}
        aria-label={ariaLabel}
        aria-busy={
          loading
        }
        {...props}
      >
        <div className="pagination-container">
          {showSummary &&
            summary && (
              <div
                className="pagination-summary"
                aria-live="polite"
              >
                {summary}
              </div>
            )}

          <div className="pagination-controls">
            {showPageSize && (
              <div className="pagination-page-size">
                <label
                  htmlFor={`pagination-page-size-${safePage}`}
                  className="pagination-page-size-label"
                >
                  Rows per page
                </label>

                <select
                  id={`pagination-page-size-${safePage}`}
                  className="pagination-page-size-select"
                  value={
                    resolvedPageSize
                  }
                  onChange={
                    handlePageSizeChange
                  }
                  disabled={
                    isBusy
                  }
                  aria-label="Rows per page"
                >
                  {pageSizeOptions
                    .filter(
                      (option) =>
                        Number.isFinite(
                          Number(
                            option
                          )
                        ) &&
                        Number(
                          option
                        ) > 0
                    )
                    .map(
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

            {children}

            {resolvedTotalPages >
              0 && (
              <ul
                className={cx(
                  "pagination-list",
                  listClassName
                )}
              >
                {showFirstLast && (
                  <li>
                    <PaginationButton
                      disabled={
                        isBusy ||
                        safePage <=
                          1
                      }
                      ariaLabel="Go to first page"
                      onClick={
                        goToFirst
                      }
                    >
                      <ChevronsLeft
                        size={18}
                        aria-hidden="true"
                      />
                    </PaginationButton>
                  </li>
                )}

                {showPreviousNext && (
                  <li>
                    <PaginationButton
                      disabled={
                        isBusy ||
                        safePage <=
                          1
                      }
                      ariaLabel="Go to previous page"
                      onClick={
                        goToPrevious
                      }
                    >
                      <ChevronLeft
                        size={18}
                        aria-hidden="true"
                      />
                    </PaginationButton>
                  </li>
                )}

                {showPageNumbers &&
                  paginationRange.map(
                    (
                      item,
                      index
                    ) => {
                      if (
                        typeof item ===
                        "string"
                      ) {
                        return (
                          <li
                            key={`${item}-${index}`}
                          >
                            {renderEllipsisItem(
                              `${item}-${index}`
                            )}
                          </li>
                        );
                      }

                      return (
                        <li
                          key={`page-${item}`}
                        >
                          {renderPageButton(
                            item
                          )}
                        </li>
                      );
                    }
                  )}

                {showPreviousNext && (
                  <li>
                    <PaginationButton
                      disabled={
                        isBusy ||
                        safePage >=
                          resolvedTotalPages
                      }
                      ariaLabel="Go to next page"
                      onClick={
                        goToNext
                      }
                    >
                      <ChevronRight
                        size={18}
                        aria-hidden="true"
                      />
                    </PaginationButton>
                  </li>
                )}

                {showFirstLast && (
                  <li>
                    <PaginationButton
                      disabled={
                        isBusy ||
                        safePage >=
                          resolvedTotalPages
                      }
                      ariaLabel="Go to last page"
                      onClick={
                        goToLast
                      }
                    >
                      <ChevronsRight
                        size={18}
                        aria-hidden="true"
                      />
                    </PaginationButton>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </nav>
    );
  }
);

Pagination.displayName =
  "Pagination";

// ============================================================================
// Prop Types
// ============================================================================

Pagination.propTypes = {
  page:
    PropTypes.number,

  currentPage:
    PropTypes.number,

  totalPages:
    PropTypes.number,

  totalItems:
    PropTypes.number,

  pageSize:
    PropTypes.number,

  limit:
    PropTypes.number,

  pageCount:
    PropTypes.number,

  onPageChange:
    PropTypes.func,

  onChange:
    PropTypes.func,

  onNext:
    PropTypes.func,

  onPrevious:
    PropTypes.func,

  showFirstLast:
    PropTypes.bool,

  showPreviousNext:
    PropTypes.bool,

  showPageNumbers:
    PropTypes.bool,

  siblingCount:
    PropTypes.number,

  boundaryCount:
    PropTypes.number,

  showPageSize:
    PropTypes.bool,

  pageSizeOptions:
    PropTypes.arrayOf(
      PropTypes.number
    ),

  onPageSizeChange:
    PropTypes.func,

  showSummary:
    PropTypes.bool,

  summaryTemplate:
    PropTypes.func,

  disabled:
    PropTypes.bool,

  loading:
    PropTypes.bool,

  size:
    PropTypes.oneOf([
      "sm",
      "md",
      "lg",
    ]),

  variant:
    PropTypes.oneOf([
      "default",
      "compact",
      "outlined",
    ]),

  ariaLabel:
    PropTypes.string,

  className:
    PropTypes.string,

  listClassName:
    PropTypes.string,

  renderPage:
    PropTypes.func,

  renderEllipsis:
    PropTypes.func,

  children:
    PropTypes.node,
};

// ============================================================================
// Named Exports
// ============================================================================

export {
  PaginationButton,
  createPaginationRange,
  getTotalPages,
};

// ============================================================================
// Default Export
// ============================================================================

export default memo(
  Pagination
);