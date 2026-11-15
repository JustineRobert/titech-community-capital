import { describe, expect, it } from 'vitest';

import TITECH_BRAND, {
  TITECH_VISION,
} from '../../branding/brand';

describe('TITech vision-board brand contract', () => {
  it('exposes the canonical mission, tagline and 2035 vision', () => {
    expect(TITECH_BRAND.tagline).toBe(
      'Community Finance. Stronger Together.',
    );

    expect(TITECH_BRAND.mission).toMatch(
      /empower communities through innovative financial solutions/i,
    );

    expect(TITECH_BRAND.vision).toMatch(
      /more inclusive and prosperous Africa/i,
    );

    expect(TITECH_VISION.strategicPillars).toHaveLength(6);
    expect(TITECH_VISION.coreValues).toHaveLength(5);
  });

  it('uses the normalized vision-board palette', () => {
    expect(TITECH_BRAND.colors.deepBlue).toBe('#0030A0');
    expect(TITECH_BRAND.colors.electricBlue).toBe('#0058D8');
    expect(TITECH_BRAND.colors.brightBlue).toBe('#0066E8');
    expect(TITECH_BRAND.colors.cyan).toBe('#00B8F8');
    expect(TITECH_BRAND.colors.africaGreen).toBe('#008000');
    expect(TITECH_BRAND.colors.limeGreen).toBe('#A8F000');
    expect(TITECH_BRAND.colors.goldYellow).toBe('#F8D800');
    expect(TITECH_BRAND.colors.navyInk).toBe('#082B67');
  });

  it('keeps the official logo contract intact', () => {
    expect(TITECH_BRAND.assets.transparent).toBe(
      '/brand/titech-community-capital-transparent.png',
    );
    expect(TITECH_BRAND.assets.favicon).toBe('/brand/favicon.ico');
    expect(TITECH_BRAND.assets.visionBoard).toBe(
      '/brand/titech-vision-board.png',
    );
  });
});
