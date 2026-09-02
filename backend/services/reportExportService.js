// ============================================================================
// File: backend/services/reportExportService.js
// Description: Enterprise Report Export Service
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const logger = require("../utils/logger");

// ============================================================================
// Constants
// ============================================================================

const REPORT_FORMATS = {
  PDF: "PDF",
  XLSX: "XLSX",
  CSV: "CSV",
  JSON: "JSON"
};

const REPORT_TYPES = {
  SAVINGS: "SAVINGS",
  LOANS: "LOANS",
  REPAYMENTS: "REPAYMENTS",
  MEMBERS: "MEMBERS",
  KYC: "KYC",
  AML: "AML",
  FRAUD: "FRAUD",
  BILLING: "BILLING",
  SETTLEMENTS: "SETTLEMENTS",
  AUDIT: "AUDIT"
};

const EXPORT_ROOT =
  process.env.REPORT_EXPORT_PATH ||
  path.join(process.cwd(), "exports");

// ============================================================================
// Error Class
// ============================================================================

class ReportExportError extends Error {
  constructor(
    message,
    code = "REPORT_EXPORT_ERROR",
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name = "ReportExportError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {
      recursive: true
    });
  }
}

function generateReportId() {
  return `report_${crypto.randomUUID()}`;
}

function generateFilename(
  reportType,
  format
) {
  const timestamp =
    Date.now();

  return `${reportType}_${timestamp}.${format.toLowerCase()}`;
}

function buildExportDirectory(
  tenantId
) {
  return path.join(
    EXPORT_ROOT,
    String(tenantId || "system")
  );
}

// ============================================================================
// PDF Export
// ============================================================================

async function exportPDF({
  filePath,
  title,
  data
}) {
  return new Promise(
    (resolve, reject) => {
      try {
        const doc =
          new PDFDocument({
            margin: 50
          });

        const stream =
          fs.createWriteStream(
            filePath
          );

        doc.pipe(stream);

        doc
          .fontSize(20)
          .text(title);

        doc.moveDown();

        data.forEach(
          (row, index) => {
            doc
              .fontSize(10)
              .text(
                `${index + 1}. ${JSON.stringify(
                  row
                )}`
              );

            doc.moveDown(
              0.5
            );
          }
        );

        doc.end();

        stream.on(
          "finish",
          () => resolve()
        );

        stream.on(
          "error",
          reject
        );
      } catch (error) {
        reject(error);
      }
    }
  );
}

// ============================================================================
// Excel Export
// ============================================================================

async function exportExcel({
  filePath,
  sheetName,
  data
}) {
  const workbook =
    new ExcelJS.Workbook();

  const worksheet =
    workbook.addWorksheet(
      sheetName
    );

  if (
    data &&
    data.length > 0
  ) {
    worksheet.columns =
      Object.keys(
        data[0]
      ).map((key) => ({
        header: key,
        key
      }));

    worksheet.addRows(data);
  }

  await workbook.xlsx.writeFile(
    filePath
  );
}

// ============================================================================
// CSV Export
// ============================================================================

async function exportCSV({
  filePath,
  data
}) {
  if (
    !data ||
    data.length === 0
  ) {
    await fs.promises.writeFile(
      filePath,
      ""
    );

    return;
  }

  const headers =
    Object.keys(data[0]);

  const rows = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) =>
          JSON.stringify(
            row[h]
          )
        )
        .join(",")
    )
  ];

  await fs.promises.writeFile(
    filePath,
    rows.join("\n")
  );
}

// ============================================================================
// JSON Export
// ============================================================================

async function exportJSON({
  filePath,
  data
}) {
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(
      data,
      null,
      2
    )
  );
}

// ============================================================================
// Main Export Function
// ============================================================================

async function exportReport({
  tenantId,
  reportType,
  format,
  title,
  data,
  generatedBy,
  metadata = {}
}) {
  const reportId =
    generateReportId();

  try {
    const exportDir =
      buildExportDirectory(
        tenantId
      );

    ensureDirectoryExists(
      exportDir
    );

    const filename =
      generateFilename(
        reportType,
        format
      );

    const filePath =
      path.join(
        exportDir,
        filename
      );

    switch (format) {
      case REPORT_FORMATS.PDF:
        await exportPDF({
          filePath,
          title,
          data
        });
        break;

      case REPORT_FORMATS.XLSX:
        await exportExcel({
          filePath,
          sheetName:
            reportType,
          data
        });
        break;

      case REPORT_FORMATS.CSV:
        await exportCSV({
          filePath,
          data
        });
        break;

      case REPORT_FORMATS.JSON:
        await exportJSON({
          filePath,
          data
        });
        break;

      default:
        throw new Error(
          `Unsupported format: ${format}`
        );
    }

    const result = {
      success: true,

      reportId,

      tenantId,

      reportType,

      format,

      title,

      filePath,

      filename,

      generatedBy,

      generatedAt:
        new Date(),

      metadata
    };

    logger.info(
      "Report exported",
      {
        reportId,
        reportType,
        format
      }
    );

    return result;
  } catch (error) {
    logger.error(
      "Report export failed",
      {
        error:
          error.message
      }
    );

    throw new ReportExportError(
      error.message,
      "EXPORT_FAILED"
    );
  }
}

// ============================================================================
// Specialized Reports
// ============================================================================

async function exportLoanReport(
  payload
) {
  return exportReport({
    ...payload,
    reportType:
      REPORT_TYPES.LOANS
  });
}

async function exportSavingsReport(
  payload
) {
  return exportReport({
    ...payload,
    reportType:
      REPORT_TYPES.SAVINGS
  });
}

async function exportAMLReport(
  payload
) {
  return exportReport({
    ...payload,
    reportType:
      REPORT_TYPES.AML
  });
}

async function exportFraudReport(
  payload
) {
  return exportReport({
    ...payload,
    reportType:
      REPORT_TYPES.FRAUD
  });
}

async function exportKYCReport(
  payload
) {
  return exportReport({
    ...payload,
    reportType:
      REPORT_TYPES.KYC
  });
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "report-export-service",

    status: "UP",

    exportPath:
      EXPORT_ROOT,

    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  REPORT_FORMATS,
  REPORT_TYPES,

  ReportExportError,

  exportReport,

  exportLoanReport,
  exportSavingsReport,
  exportAMLReport,
  exportFraudReport,
  exportKYCReport,

  healthCheck
};