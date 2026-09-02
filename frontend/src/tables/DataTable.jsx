// ============================================================================
// TITech Community Capital
// Enterprise DataTable Component
// File: src/components/tables/DataTable.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
  useState,
  useCallback,
} from "react";

import PropTypes from "prop-types";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

// ============================================================================
// Helpers
// ============================================================================

function defaultRowId(
  row,
  index
) {
  return (
    row?._id ||
    row?.id ||
    `row-${index}`
  );
}

function resolveCell(
  column,
  row
) {
  if (
    column.accessorFn
  ) {
    return column.accessorFn(
      row
    );
  }

  if (
    column.accessorKey
  ) {
    return row?.[
      column.accessorKey
    ];
  }

  return "";
}

// ============================================================================
// Component
// ============================================================================

function DataTable({
  columns = [],
  data = [],
  loading = false,
  emptyMessage = "No records found.",
  page = 1,
  pageSize = 20,
  total = 0,
  selectable = false,
  selectedRows = [],
  onSelectionChange,
  onPageChange,
  rowId = defaultRowId,
  onRowClick,
  className = "",
  stickyHeader = true,
  compact = false,
}) {
  const [
    sortState,
    setSortState,
  ] = useState({
    field: null,
    direction: null,
  });

  // ===========================================================================
  // Sorting
  // ===========================================================================

  const handleSort =
    useCallback(
      (column) => {
        if (
          !column.sortable
        ) {
          return;
        }

        setSortState(
          (
            previous
          ) => {
            if (
              previous.field !==
              column.id
            ) {
              return {
                field:
                  column.id,
                direction:
                  "asc",
              };
            }

            if (
              previous.direction ===
              "asc"
            ) {
              return {
                field:
                  column.id,
                direction:
                  "desc",
              };
            }

            return {
              field:
                null,
              direction:
                null,
            };
          }
        );
      },
      []
    );

  const sortedData =
    useMemo(() => {
      if (
        !sortState.field ||
        !sortState.direction
      ) {
        return data;
      }

      const column =
        columns.find(
          (c) =>
            c.id ===
            sortState.field
        );

      if (
        !column
      ) {
        return data;
      }

      const copy =
        [...data];

      copy.sort(
        (a, b) => {
          const aValue =
            resolveCell(
              column,
              a
            );

          const bValue =
            resolveCell(
              column,
              b
            );

          if (
            aValue ==
            null
          ) {
            return -1;
          }

          if (
            bValue ==
            null
          ) {
            return 1;
          }

          if (
            typeof aValue ===
              "number" &&
            typeof bValue ===
              "number"
          ) {
            return sortState.direction ===
              "asc"
              ? aValue -
                  bValue
              : bValue -
                  aValue;
          }

          return sortState.direction ===
            "asc"
            ? String(
                aValue
              ).localeCompare(
                String(
                  bValue
                )
              )
            : String(
                bValue
              ).localeCompare(
                String(
                  aValue
                )
              );
        }
      );

      return copy;
    }, [
      data,
      columns,
      sortState,
    ]);

  // ===========================================================================
  // Selection
  // ===========================================================================

  const toggleRow =
    useCallback(
      (id) => {
        if (
          !onSelectionChange
        ) {
          return;
        }

        const exists =
          selectedRows.includes(
            id
          );

        if (
          exists
        ) {
          onSelectionChange(
            selectedRows.filter(
              (
                item
              ) =>
                item !== id
            )
          );
        } else {
          onSelectionChange(
            [
              ...selectedRows,
              id,
            ]
          );
        }
      },
      [
        selectedRows,
        onSelectionChange,
      ]
    );

  const toggleAll =
    useCallback(() => {
      if (
        !onSelectionChange
      ) {
        return;
      }

      const ids =
        sortedData.map(
          (
            row,
            index
          ) =>
            rowId(
              row,
              index
            )
        );

      const allSelected =
        ids.every(
          (id) =>
            selectedRows.includes(
              id
            )
        );

      if (
        allSelected
      ) {
        onSelectionChange(
          []
        );
      } else {
        onSelectionChange(
          ids
        );
      }
    }, [
      sortedData,
      selectedRows,
      onSelectionChange,
      rowId,
    ]);

  // ===========================================================================
  // Pagination
  // ===========================================================================

  const pageCount =
    Math.max(
      1,
      Math.ceil(
        total /
          pageSize
      )
    );

  const canPrevious =
    page > 1;

  const canNext =
    page <
    pageCount;

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div
      className={`data-table-container ${className}`}
    >
      <div className="data-table-wrapper">
        <table
          className={`data-table ${
            compact
              ? "compact"
              : ""
          }`}
        >
          <thead
            className={
              stickyHeader
                ? "sticky"
                : ""
            }
          >
            <tr>
              {selectable && (
                <th width="50">
                  <input
                    type="checkbox"
                    checked={
                      selectedRows.length >
                        0 &&
                      selectedRows.length ===
                        sortedData.length
                    }
                    onChange={
                      toggleAll
                    }
                  />
                </th>
              )}

              {columns.map(
                (
                  column
                ) => (
                  <th
                    key={
                      column.id
                    }
                    style={{
                      width:
                        column.width,
                      textAlign:
                        column.align,
                    }}
                    onClick={() =>
                      handleSort(
                        column
                      )
                    }
                    className={
                      column.sortable
                        ? "sortable"
                        : ""
                    }
                  >
                    <div className="table-header-content">
                      <span>
                        {
                          column.header
                        }
                      </span>

                      {column.sortable && (
                        <>
                          {sortState.field !==
                            column.id && (
                            <ChevronsUpDown
                              size={
                                14
                              }
                            />
                          )}

                          {sortState.field ===
                            column.id &&
                            sortState.direction ===
                              "asc" && (
                              <ChevronUp
                                size={
                                  14
                                }
                              />
                            )}

                          {sortState.field ===
                            column.id &&
                            sortState.direction ===
                              "desc" && (
                              <ChevronDown
                                size={
                                  14
                                }
                              />
                            )}
                        </>
                      )}
                    </div>
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={
                    columns.length +
                    (selectable
                      ? 1
                      : 0)
                  }
                  className="table-loading"
                >
                  Loading...
                </td>
              </tr>
            )}

            {!loading &&
              sortedData.length ===
                0 && (
                <tr>
                  <td
                    colSpan={
                      columns.length +
                      (selectable
                        ? 1
                        : 0)
                    }
                    className="table-empty"
                  >
                    {
                      emptyMessage
                    }
                  </td>
                </tr>
              )}

            {!loading &&
              sortedData.map(
                (
                  row,
                  index
                ) => {
                  const id =
                    rowId(
                      row,
                      index
                    );

                  const selected =
                    selectedRows.includes(
                      id
                    );

                  return (
                    <tr
                      key={
                        id
                      }
                      className={
                        selected
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        onRowClick?.(
                          row
                        )
                      }
                    >
                      {selectable && (
                        <td>
                          <input
                            type="checkbox"
                            checked={
                              selected
                            }
                            onChange={() =>
                              toggleRow(
                                id
                              )
                            }
                          />
                        </td>
                      )}

                      {columns.map(
                        (
                          column
                        ) => (
                          <td
                            key={`${id}-${column.id}`}
                            style={{
                              textAlign:
                                column.align,
                            }}
                          >
                            {column.cell
                              ? column.cell(
                                  {
                                    row: {
                                      original:
                                        row,
                                    },
                                    value:
                                      resolveCell(
                                        column,
                                        row
                                      ),
                                  }
                                )
                              : resolveCell(
                                  column,
                                  row
                                )}
                          </td>
                        )
                      )}
                    </tr>
                  );
                }
              )}
          </tbody>
        </table>
      </div>

      <div className="table-pagination">
        <div className="table-pagination-info">
          Page {page} of{" "}
          {pageCount}
        </div>

        <div className="table-pagination-actions">
          <button
            type="button"
            disabled={
              !canPrevious
            }
            onClick={() =>
              onPageChange?.(
                page - 1
              )
            }
          >
            <ChevronLeft
              size={16}
            />
          </button>

          <button
            type="button"
            disabled={
              !canNext
            }
            onClick={() =>
              onPageChange?.(
                page + 1
              )
            }
          >
            <ChevronRight
              size={16}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Prop Types
// ============================================================================

DataTable.propTypes = {
  columns:
    PropTypes.array,

  data:
    PropTypes.array,

  loading:
    PropTypes.bool,

  emptyMessage:
    PropTypes.string,

  page:
    PropTypes.number,

  pageSize:
    PropTypes.number,

  total:
    PropTypes.number,

  selectable:
    PropTypes.bool,

  selectedRows:
    PropTypes.array,

  onSelectionChange:
    PropTypes.func,

  onPageChange:
    PropTypes.func,

  rowId:
    PropTypes.func,

  onRowClick:
    PropTypes.func,

  className:
    PropTypes.string,

  stickyHeader:
    PropTypes.bool,

  compact:
    PropTypes.bool,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  DataTable
);