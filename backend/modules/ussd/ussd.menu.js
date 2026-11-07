import { validateUssdResponse } from './ussd.contract.js';

const MAIN_ITEMS = Object.freeze([
  { key: 'accounts', number: '1', label: 'My Accounts' },
  { key: 'savings', number: '2', label: 'Savings' },
  { key: 'loans', number: '3', label: 'Loans' },
  { key: 'statements', number: '4', label: 'Statements' },
  { key: 'onboarding', number: '5', label: 'Join an Institution' },
  { key: 'help', number: '6', label: 'Help', alwaysEnabled: true },
]);

const MENU_ITEMS = Object.freeze({
  accounts: [
    ['1', 'View My Accounts', 'accounts'],
    ['2', 'Check Balance', 'balances'],
    ['3', 'Account Details', 'accountDetails'],
  ],
  savings: [
    ['1', 'Savings Balance', 'savingsRead'],
    ['2', 'Make Contribution', 'savingsContribution'],
    ['3', 'Savings History', 'savingsHistory'],
    ['4', 'Savings Goals', 'savingsGoals'],
  ],
  loans: [
    ['1', 'Loan Eligibility', 'loanEligibility'],
    ['2', 'Apply for Loan', 'loanApplications'],
    ['3', 'Application Status', 'loanStatus'],
    ['4', 'Repayment Information', 'loanRepaymentInfo'],
    ['5', 'Make Repayment', 'loanRepayment'],
  ],
  statements: [
    ['1', 'Mini Statement', 'miniStatements'],
    ['2', 'Savings Statement', 'savingsStatements'],
    ['3', 'Loan Statement', 'loanStatements'],
  ],
  onboarding: [
    ['1', 'Find an Institution', 'institutionDirectory'],
    ['2', 'Start Registration', 'onboarding'],
    ['3', 'Registration Status', 'onboardingStatus'],
  ],
  help: [
    ['1', 'How TITech Works', 'helpContent'],
    ['2', 'USSD Help', 'ussdHelp'],
    ['3', 'Contact Support', 'supportContact'],
    ['4', 'Change Language', 'languageSelection'],
  ],
});

function enabledSet(enabledFeatures) {
  if (!Array.isArray(enabledFeatures)) return new Set();
  return new Set(enabledFeatures.filter((value) => typeof value === 'string'));
}

/**
 * Render a compact English menu from server-authorized institution features.
 * No financial operation is performed here; selection is handled by the
 * injected USSD application service and its existing domain services.
 */
export function renderUssdMenu(menuKey = 'main', options = {}) {
  const language = String(options.language || 'en').toLowerCase();
  if (language !== 'en') {
    throw new Error('Only the human-reviewed English USSD menu is enabled.');
  }

  const enabled = enabledSet(options.enabledFeatures);
  let title;
  let items;

  if (menuKey === 'main') {
    title = 'TITech Community Capital';
    items = MAIN_ITEMS.filter((item) => item.alwaysEnabled || enabled.has(item.key));
  } else {
    const normalizedKey = String(menuKey).toLowerCase();
    const source = MENU_ITEMS[normalizedKey];
    if (!source) throw new RangeError('Unknown USSD menu.');
    title = normalizedKey === 'help'
      ? 'Help'
      : normalizedKey[0].toUpperCase() + normalizedKey.slice(1);
    items = source
      .filter(([, , feature]) => enabled.has(feature))
      .map(([number, label]) => ({ number, label }));
  }

  const lines = [title, ...items.map((item) => `${item.number}. ${item.label}`), '0. Back / Exit'];
  const message = lines.join('\n');
  validateUssdResponse({ action: 'CONTINUE', message }, {
    maxLength: Number.isSafeInteger(options.maxResponseLength) ? options.maxResponseLength : 160,
  });
  return message;
}

export const USSD_MENU_FEATURES = Object.freeze({
  main: MAIN_ITEMS.map((item) => item.key),
  submenus: Object.freeze(Object.fromEntries(
    Object.entries(MENU_ITEMS).map(([key, items]) => [key, items.map((item) => item[2])]),
  )),
});


/**
 * Resolve a single user selection to a typed navigation/action result.
 * The caller must persist the session and execute actions through canonical
 * domain services; this function never mutates accounts or creates payments.
 */
export function resolveUssdSelection({ menuKey = 'main', input, enabledFeatures = [] } = {}) {
  const selection = typeof input === 'string' ? input.trim() : String(input ?? '').trim();
  const currentMenu = String(menuKey).toLowerCase();
  const enabled = enabledSet(enabledFeatures);

  if (!/^\d{1,2}$/.test(selection)) return Object.freeze({ type: 'INVALID' });
  if (selection === '0') {
    return currentMenu === 'main'
      ? Object.freeze({ type: 'EXIT', message: 'Thank you for using TITech Community Capital.' })
      : Object.freeze({ type: 'BACK', target: 'main' });
  }

  if (currentMenu === 'main') {
    const item = MAIN_ITEMS.find((candidate) => candidate.number === selection);
    if (!item) return Object.freeze({ type: 'INVALID' });
    if (!item.alwaysEnabled && !enabled.has(item.key)) return Object.freeze({ type: 'DISABLED' });
    return Object.freeze({ type: 'NAVIGATE', target: item.key });
  }

  const submenu = MENU_ITEMS[currentMenu];
  if (!submenu) return Object.freeze({ type: 'INVALID' });
  const item = submenu.find(([number]) => number === selection);
  if (!item) return Object.freeze({ type: 'INVALID' });
  if (!enabled.has(item[2])) return Object.freeze({ type: 'DISABLED' });
  return Object.freeze({ type: 'ACTION', action: item[2] });
}
