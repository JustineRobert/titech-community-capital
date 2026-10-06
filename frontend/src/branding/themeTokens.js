/** Canonical TITech runtime color tokens for JS/JSX consumers. */
export const TITECH_COLORS = Object.freeze({
  deepBlue: '#0030A0',
  electricBlue: '#0058D8',
  brightBlue: '#0066E8',
  cyan: '#00B8F8',
  africaGreen: '#008000',
  limeGreen: '#A8F000',
  goldYellow: '#F8D800',
  navyInk: '#082B67',
  white: '#FFFFFF',
});

export const TITECH_COLOR_VARS = Object.freeze({
  deepBlue: 'var(--titech-brand-deep-blue)',
  electricBlue: 'var(--titech-brand-electric-blue)',
  brightBlue: 'var(--titech-brand-bright-blue)',
  cyan: 'var(--titech-brand-cyan)',
  africaGreen: 'var(--titech-brand-green)',
  limeGreen: 'var(--titech-brand-lime)',
  goldYellow: 'var(--titech-brand-gold)',
  navyInk: 'var(--titech-brand-navy)',
  white: 'var(--titech-brand-white)',
});


/**
 * Official eight-color chart sequence for canvas/SVG libraries that cannot
 * consume CSS custom properties reliably. Values are intentionally derived
 * from the same supplied official palette used by official-theme.css.
 */
export const TITECH_CHART_COLORS = Object.freeze([
  TITECH_COLORS.deepBlue,
  TITECH_COLORS.electricBlue,
  TITECH_COLORS.brightBlue,
  TITECH_COLORS.cyan,
  TITECH_COLORS.africaGreen,
  TITECH_COLORS.limeGreen,
  TITECH_COLORS.goldYellow,
  TITECH_COLORS.navyInk,
]);

/**
 * Semantic runtime colors for financial/security states. These deliberately
 * remain distinct from the brand palette so success/warning/danger retain
 * their operational meaning while still being centralized and theme-aware.
 */
export const TITECH_SEMANTIC_COLORS = Object.freeze({
  success: TITECH_COLORS.africaGreen,
  info: TITECH_COLORS.brightBlue,
  warning: '#A35B00',
  danger: '#A61B1B',
  neutral: '#6B829A',
});
