import { describe, expect, it } from 'vitest';

import {
  TITECH_COLORS,
  TITECH_CHART_COLORS,
  TITECH_COLOR_VARS,
  TITECH_SEMANTIC_COLORS,
} from '../themeTokens.js';

describe('TITech official token bridge', () => {
  it('exposes all nine official palette colors', () => {
    expect(Object.keys(TITECH_COLORS)).toHaveLength(9);
    expect(TITECH_COLORS).toEqual({
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
  });

  it('uses the same official palette for chart sequences', () => {
    expect(TITECH_CHART_COLORS).toEqual([
      TITECH_COLORS.deepBlue,
      TITECH_COLORS.electricBlue,
      TITECH_COLORS.brightBlue,
      TITECH_COLORS.cyan,
      TITECH_COLORS.africaGreen,
      TITECH_COLORS.limeGreen,
      TITECH_COLORS.goldYellow,
      TITECH_COLORS.navyInk,
    ]);
  });

  it('keeps CSS-variable consumers centralized', () => {
    expect(TITECH_COLOR_VARS.deepBlue).toBe('var(--titech-brand-deep-blue)');
    expect(TITECH_COLOR_VARS.goldYellow).toBe('var(--titech-brand-gold)');
  });

  it('keeps operational state colors semantically distinct', () => {
    expect(TITECH_SEMANTIC_COLORS.success).toBe(TITECH_COLORS.africaGreen);
    expect(TITECH_SEMANTIC_COLORS.warning).toBe('#A35B00');
    expect(TITECH_SEMANTIC_COLORS.danger).toBe('#A61B1B');
  });
});
