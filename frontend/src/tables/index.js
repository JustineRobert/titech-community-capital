// ============================================================================
// TITech Community Capital
// Tables Module Exports
// File: src/components/tables/index.js
// Production Grade
// ============================================================================

/**
 * Core Table Components
 */
export { default as DataTable } from "./DataTable";

/**
 * Domain Tables
 */
export { default as LoanTable } from "./LoanTable";
export { default as SavingsTable } from "./SavingsTable";
export { default as TransactionTable } from "./TransactionTable";

/**
 * Future/Planned Tables
 * Uncomment as they are implemented.
 */

// export { default as MemberTable } from "./MemberTable";
// export { default as GroupTable } from "./GroupTable";
// export { default as UserTable } from "./UserTable";
// export { default as AuditLogTable } from "./AuditLogTable";
// export { default as NotificationTable } from "./NotificationTable";
// export { default as WalletTable } from "./WalletTable";
// export { default as KycTable } from "./KycTable";
// export { default as AMLAlertTable } from "./AMLAlertTable";
// export { default as TreasuryTable } from "./TreasuryTable";
// export { default as RegulatoryReportTable } from "./RegulatoryReportTable";
// export { default as SettlementTable } from "./SettlementTable";
// export { default as BillingTable } from "./BillingTable";

/**
 * Aggregate Default Export
 * Enables:
 *
 * import Tables from "@/components/tables";
 * Tables.LoanTable
 */
const Tables = {
  DataTable: undefined,
  LoanTable: undefined,
  SavingsTable: undefined,
  TransactionTable: undefined,
};

import DataTable from "./DataTable";
import LoanTable from "./LoanTable";
import SavingsTable from "./SavingsTable";
import TransactionTable from "./TransactionTable";

Tables.DataTable = DataTable;
Tables.LoanTable = LoanTable;
Tables.SavingsTable = SavingsTable;
Tables.TransactionTable = TransactionTable;

export default Object.freeze(
  Tables
);