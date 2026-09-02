// ============================================================================
// TITech Community Capital
// Enterprise Savings Table
// File: src/components/tables/SavingsTable.jsx
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
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
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
    case "completed":
    case "posted":
    case "approved":
      return "success";

    case "pending":
      return "warning";

    case "failed":
    case "reversed":
      return "danger";

    case "processing":
      return "info";

    default:
      return "secondary";
  }
}

// ============================================================================
// Component
// ============================================================================

function SavingsTable({
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
  onDeposit,
  onWithdraw,
  onExport,
  className,
  emptyMessage =
    "No savings records found.",
}) {
  const columns =
    useMemo(
      () => [
        {
          id: "accountNumber",
          accessorKey:
            "accountNumber",
          header:
            "Account #",
          sortable: true,
          width: 180,
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
          id: "product",
          header:
            "Product",
          accessorFn:
            (row) =>
              row.product
                ?.name ||
              row.productName ||
              row.accountType ||
              "Savings",
          sortable: true,
        },

        {
          id: "balance",
          header:
            "Balance",
          accessorFn:
            (row) =>
              formatCurrency(
                row.balance
              ),
          sortable: true,
          align: "right",
        },

        {
          id: "availableBalance",
          header:
            "Available",
          accessorFn:
            (row) =>
              formatCurrency(
                row.availableBalance ??
                  row.balance
              ),
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
          id: "lastTransactionDate",
          header:
            "Last Activity",
          accessorFn:
            (row) =>
              formatDate(
                row.lastTransactionDate ||
                  row.updatedAt
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
            const account =
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
                        account
                      )
                    }
                  >
                    <Eye
                      size={16}
                    />
                  </button>
                )}

                {onDeposit && (
                  <button
                    type="button"
                    className="table-action-btn success"
                    title="Deposit"
                    onClick={() =>
                      onDeposit(
                        account
                      )
                    }
                  >
                    <ArrowUpCircle
                      size={16}
                    />
                  </button>
                )}

                {onWithdraw && (
                  <button
                    type="button"
                    className="table-action-btn warning"
                    title="Withdraw"
                    onClick={() =>
                      onWithdraw(
                        account
                      )
                    }
                  >
                    <ArrowDownCircle
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
        onDeposit,
        onWithdraw,
      ]
    );

  const handleExport =
    useCallback(() => {
      onExport?.(data);
    }, [
      onExport,
      data,
    ]);

  return (
    <div
      className={`savings-table ${className}`}
    >
      <div className="table-toolbar">
        <div className="table-summary">
          <Wallet
            size={16}
          />

          <span>
            {total ||
              data.length}{" "}
            savings account
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
          row.accountNumber
        }
      />
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

SavingsTable.propTypes = {
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

  onDeposit:
    PropTypes.func,

  onWithdraw:
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
  SavingsTable
);