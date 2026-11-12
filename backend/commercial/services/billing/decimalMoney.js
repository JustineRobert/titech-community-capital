/** Compatibility bridge; the canonical helper implementation remains decimalMoney.cjs. */
import decimalMoney from './decimalMoney.cjs';

export const { normalizeDecimal, compare } = decimalMoney;
export default decimalMoney;
