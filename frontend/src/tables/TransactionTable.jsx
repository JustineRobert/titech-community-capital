// ============================================================================
// TITech Community Capital
// Enterprise Transaction Table
// File: src/components/tables/TransactionTable.jsx
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
  Download,
  Receipt,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  AlertTriangle,
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
    ).toLocaleString(
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
    case "completed":
    case "success":
    case "successful":
    case "posted":
      return "success";

    case "pending":
    case "processing":
      return "warning";

    case "failed":
    case "rejected":
      return "danger";

    case "reversed":
      return "info";

    default:
      return "secondary";
  }
}

function getTypeIcon(
  type
) {
  switch (
    String(
      type
    ).toLowerCase()
  ) {
    case "deposit":
    case "credit":
    case "saving":
      return (
        <ArrowUpCircle
          size={16}
        />
      );

    case "withdrawal":
    case "debit":
    case "repayment":
      return (
        <ArrowDownCircle
          size={16}
        />
      );

    case "reversal":
      return (
        <RefreshCw
          size={16}
        />
      );

    default:
      return (
        <Receipt
          size={16}
        />
      );
  }
}

// ============================================================================
// Component
// ============================================================================

function TransactionTable({
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
  onReverse,
  onFlag,
  onExport,
  className,
  emptyMessage =
    "No transactions found.",
}) {
  const columns =
    useMemo(
      () => [
        {
          id: "reference",
          accessorKey:
            "reference",
          header:
            "Reference",
          sortable: true,
          width: 220,
        },

        {
          id: "type",
          header:
            "Type",
          sortable: true,
          cell: ({
            row,
          }) => (
            <div className="transaction-type">
              {getTypeIcon(
                row.original
                  .type
              )}

              <span>
                {row
                  .original
                  .type ||
                  "-"}
              </span>
            </div>
          ),
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
          id: "channel",
          header:
            "Channel",
          accessorFn:
            (row) =>
              row.channel ||
              row.paymentMethod ||
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
          id: "status",
          header:
            "Status",
          sortable: true,
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
        },

        {
          id: "createdAt",
          header:
            "Date",
          accessorFn:
            (row) =>
              formatDate(
                row.createdAt ||
                  row.transactionDate
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
            const tx =
              row.original;

            return (
              <div className="table-actions">
                {onView && (
                  <button
                    type="button"
                    className="table-action-btn"
                    title="View"
                    onClick={() =>
                      onView(
                        tx
                      )
                    }
                  >
                    <Eye
                      size={16}
                    />
                  </button>
                )}

                {onReverse &&
                  tx.status ===
                    "completed" && (
                    <button
                      type="button"
                      className="table-action-btn info"
                      title="Reverse"
                      onClick={() =>
                        onReverse(
                          tx
                        )
                      }
                    >
                      <RefreshCw
                        size={16}
                      />
                    </button>
                  )}

                {onFlag && (
                  <button
                    type="button"
                    className="table-action-btn warning"
                    title="Flag"
                    onClick={() =>
                      onFlag(
                        tx
                      )
                    }
                  >
                    <AlertTriangle
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
        onReverse,
        onFlag,
      ]
    );

  const handleExport =
    useCallback(() => {
      onExport?.(data);
    }, [
      data,
      onExport,
    ]);

  return (
    <div
      className={`transaction-table ${className}`}
    >
      <div className="table-toolbar">
        <div className="table-summary">
          <Receipt
            size={16}
          />

          <span>
            {total ||
              data.length}{" "}
            transaction
            {(total ||
              data.length) !==
              1 && "s"}
          </span>
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
          row.reference
        }
      />
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

TransactionTable.propTypes = {
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

  onReverse:
    PropTypes.func,

  onFlag:
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
  TransactionTable
);