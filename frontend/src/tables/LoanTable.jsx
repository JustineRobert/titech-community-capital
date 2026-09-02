// ============================================================================
// TITech Community Capital
// Enterprise Loan Table
// File: src/components/tables/LoanTable.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useMemo,
  useCallback,
} from "react";

import PropTypes from "prop-types";

import {
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Download,
} from "lucide-react";

import DataTable from "./DataTable";
import StatusBadge from "../ui/StatusBadge";

// ============================================================================
// Helpers
// ============================================================================

function formatCurrency(
  value
) {
  return new Intl.NumberFormat(
    "en-UG",
    {
      style: "currency",
      currency: "UGX",
      maximumFractionDigits: 0,
    }
  ).format(
    Number(value || 0)
  );
}

function formatDate(
  value
) {
  if (!value) {
    return "-";
  }

  try {
    return new Date(
      value
    ).toLocaleDateString(
      "en-UG"
    );
  } catch {
    return "-";
  }
}

function getStatusVariant(
  status
) {
  switch (
    String(
      status
    ).toLowerCase()
  ) {
    case "approved":
      return "success";

    case "disbursed":
      return "info";

    case "rejected":
      return "danger";

    case "pending":
      return "warning";

    case "completed":
      return "success";

    case "defaulted":
      return "danger";

    default:
      return "secondary";
  }
}

// ============================================================================
// Component
// ============================================================================

function LoanTable({
  data = [],
  loading = false,
  total = 0,
  page = 1,
  pageSize = 20,
  selectable = false,
  selectedRows = [],
  onSelectionChange,
  onPageChange,
  onView,
  onApprove,
  onReject,
  onDisburse,
  onExport,
  className,
  emptyMessage =
    "No loans found.",
}) {
  const columns =
    useMemo(
      () => [
        {
          id: "loanNumber",
          accessorKey:
            "loanNumber",
          header:
            "Loan #",
          sortable: true,
          width: 160,
        },

        {
          id: "member",
          header:
            "Member",
          accessorFn:
            (row) =>
              row.member
                ?.fullName ||
              row.member
                ?.name ||
              row.memberName ||
              "-",
          sortable: true,
        },

        {
          id: "amount",
          header:
            "Amount",
          accessorFn:
            (row) =>
              formatCurrency(
                row.amount
              ),
          sortable: true,
          align: "right",
        },

        {
          id: "interestRate",
          header:
            "Interest %",
          accessorFn:
            (row) =>
              `${Number(
                row.interestRate ||
                  0
              )}%`,
          align: "right",
        },

        {
          id: "term",
          header:
            "Term",
          accessorFn:
            (row) =>
              `${
                row.termMonths ||
                row.term ||
                0
              } months`,
        },

        {
          id: "balance",
          header:
            "Outstanding",
          accessorFn:
            (row) =>
              formatCurrency(
                row.balance ||
                  row.outstandingAmount
              ),
          align: "right",
        },

        {
          id: "status",
          header:
            "Status",
          cell: ({
            row,
          }) => (
            <StatusBadge
              status={
                row.original
                  .status
              }
              variant={getStatusVariant(
                row.original
                  .status
              )}
            />
          ),
          sortable: true,
        },

        {
          id: "createdAt",
          header:
            "Created",
          accessorFn:
            (row) =>
              formatDate(
                row.createdAt
              ),
          sortable: true,
        },

        {
          id: "actions",
          header:
            "Actions",
          width: 260,
          cell: ({
            row,
          }) => {
            const loan =
              row.original;

            return (
              <div className="table-actions">
                {onView && (
                  <button
                    type="button"
                    className="table-action-btn"
                    onClick={() =>
                      onView(
                        loan
                      )
                    }
                    title="View"
                  >
                    <Eye size={16} />
                  </button>
                )}

                {onApprove &&
                  loan.status ===
                    "pending" && (
                    <button
                      type="button"
                      className="table-action-btn success"
                      onClick={() =>
                        onApprove(
                          loan
                        )
                      }
                      title="Approve"
                    >
                      <CheckCircle
                        size={16}
                      />
                    </button>
                  )}

                {onReject &&
                  loan.status ===
                    "pending" && (
                    <button
                      type="button"
                      className="table-action-btn danger"
                      onClick={() =>
                        onReject(
                          loan
                        )
                      }
                      title="Reject"
                    >
                      <XCircle
                        size={16}
                      />
                    </button>
                  )}

                {onDisburse &&
                  loan.status ===
                    "approved" && (
                    <button
                      type="button"
                      className="table-action-btn primary"
                      onClick={() =>
                        onDisburse(
                          loan
                        )
                      }
                      title="Disburse"
                    >
                      <Clock
                        size={16}
                      />
                    </button>
                  )}
              </div>
            );
          },
        },
      ],
      [
        onView,
        onApprove,
        onReject,
        onDisburse,
      ]
    );

  const handleExport =
    useCallback(() => {
      if (
        typeof onExport ===
        "function"
      ) {
        onExport(data);
      }
    }, [
      onExport,
      data,
    ]);

  return (
    <div
      className={`loan-table ${className}`}
    >
      <div className="table-toolbar">
        <div className="table-summary">
          <strong>
            {total ||
              data.length}
          </strong>{" "}
          loans
        </div>

        {onExport && (
          <button
            type="button"
            className="table-export-btn"
            onClick={
              handleExport
            }
          >
            <Download
              size={16}
            />
            Export
          </button>
        )}
      </div>

      <DataTable
        columns={
          columns
        }
        data={data}
        loading={
          loading
        }
        total={
          total ||
          data.length
        }
        page={page}
        pageSize={
          pageSize
        }
        selectable={
          selectable
        }
        selectedRows={
          selectedRows
        }
        onSelectionChange={
          onSelectionChange
        }
        onPageChange={
          onPageChange
        }
        emptyMessage={
          emptyMessage
        }
        rowId={(row) =>
          row._id ||
          row.id ||
          row.loanNumber
        }
      />
    </div>
  );
}

// ============================================================================
// Props
// ============================================================================

LoanTable.propTypes = {
  data:
    PropTypes.array,

  loading:
    PropTypes.bool,

  total:
    PropTypes.number,

  page:
    PropTypes.number,

  pageSize:
    PropTypes.number,

  selectable:
    PropTypes.bool,

  selectedRows:
    PropTypes.array,

  onSelectionChange:
    PropTypes.func,

  onPageChange:
    PropTypes.func,

  onView:
    PropTypes.func,

  onApprove:
    PropTypes.func,

  onReject:
    PropTypes.func,

  onDisburse:
    PropTypes.func,

  onExport:
    PropTypes.func,

  className:
    PropTypes.string,

  emptyMessage:
    PropTypes.string,
};

// ============================================================================
// Export
// ============================================================================

export default memo(
  LoanTable
);