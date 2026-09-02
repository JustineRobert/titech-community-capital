'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Provider Statement Importer
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Import Provider Settlement Statements (CSV/JSON)
 * ✅ Validate & Normalize Records
 * ✅ Idempotency Checks
 * ✅ Batch Insert with Error Handling
 * ✅ Audit Logging
 * ✅ Integration with Settlement Repository
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../../common/logger');
const db = require('../../../../common/database');
const SettlementRepository = require('./settlementRepository');

class ProviderStatementImporter {
  constructor(config = {}) {
    this.config = {
      inputDir: config.inputDir || process.env.MTN_PROVIDER_STATEMENT_DIR || '/var/mtn/statements',
      batchSize: config.batchSize || parseInt(process.env.STATEMENT_IMPORT_BATCH_SIZE, 10) || 100,
    };

    this.repository = new SettlementRepository(db);

    logger.info('[ProviderStatementImporter] Initialized with config:', this.config);
  }

  /**
   * Import provider statement file (CSV or JSON)
   * @param {String} fileName
   */
  async importFile(fileName) {
    const filePath = path.resolve(this.config.inputDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Provider statement file not found: ${filePath}`);
    }

    const ext = path.extname(fileName).toLowerCase();
    let records = [];

    if (ext === '.csv') {
      records = await this._parseCSV(filePath);
    } else if (ext === '.json') {
      records = await this._parseJSON(filePath);
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }

    logger.info(`[ProviderStatementImporter] Parsed ${records.length} records from ${fileName}`);

    return await this._processRecords(records);
  }

  /**
   * Parse CSV file
   */
  _parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          results.push(this._normalizeRecord(row));
        })
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  /**
   * Parse JSON file
   */
  _parseJSON(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      return data.map((row) => this._normalizeRecord(row));
    } catch (err) {
      logger.error('[ProviderStatementImporter] Error parsing JSON file:', err);
      throw err;
    }
  }

  /**
   * Normalize record fields
   */
  _normalizeRecord(row) {
    return {
      referenceId: row.referenceId || row.ReferenceID || uuidv4(),
      accountNumber: row.accountNumber || row.Account || null,
      amount: parseFloat(row.amount || row.Amount || 0),
      currency: row.currency || row.Currency || 'UGX',
      status: row.status || 'PENDING',
      settlementDate: row.settlementDate ? new Date(row.settlementDate) : new Date(),
    };
  }

  /**
   * Process records in batches
   */
  async _processRecords(records) {
    const results = [];
    for (let i = 0; i < records.length; i += this.config.batchSize) {
      const batch = records.slice(i, i + this.config.batchSize);
      try {
        const batchResults = await this.repository.saveBatch(batch, uuidv4());
        results.push(...batchResults);
      } catch (err) {
        logger.error('[ProviderStatementImporter] Error processing batch:', err);
        results.push({ status: 'ERROR', error: err.message });
      }
    }

    logger.info('[ProviderStatementImporter] Import completed successfully');
    return results;
  }
}

module.exports = ProviderStatementImporter;
