/**
 * TITech Community Capital — fiscal calendar control boundary.
 *
 * This service is deliberately persistence-neutral. Period persistence and
 * ledger posting remain separate authorities.
 */

const PERIOD_STATUS = Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED', LOCKED: 'LOCKED' });

class FiscalCalendarServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FiscalCalendarServiceError';
    this.code = code;
  }
}

class FiscalCalendarService {
  normalizePeriod({ tenantId, year, startDate, endDate, status = PERIOD_STATUS.OPEN } = {}) {
    if (!tenantId) throw new FiscalCalendarServiceError('TENANT_REQUIRED', 'tenantId is required.');
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < 1900 || numericYear > 9999) {
      throw new FiscalCalendarServiceError('INVALID_YEAR', 'year must be a valid four-digit fiscal year.');
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new FiscalCalendarServiceError('INVALID_BOUNDS', 'startDate must be before endDate and both must be valid dates.');
    }
    const normalizedStatus = String(status).toUpperCase();
    if (!Object.values(PERIOD_STATUS).includes(normalizedStatus)) {
      throw new FiscalCalendarServiceError('INVALID_STATUS', `Unsupported fiscal period status: ${normalizedStatus}`);
    }
    return Object.freeze({
      tenantId: String(tenantId),
      year: numericYear,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: normalizedStatus,
    });
  }

  isPostable(period) {
    return period?.status === PERIOD_STATUS.OPEN;
  }

  diagnostics() {
    return { module: 'FiscalCalendarService', status: 'IMPLEMENTED', statuses: PERIOD_STATUS };
  }
}

const createFiscalCalendarService = (options = {}) => new FiscalCalendarService(options);

export { FiscalCalendarService, FiscalCalendarServiceError, createFiscalCalendarService, PERIOD_STATUS };
export default FiscalCalendarService;
