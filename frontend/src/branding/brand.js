/**
 * ============================================================================
 * TITech Community Capital — Official Brand Contract
 * File: frontend/src/branding/brand.js
 * ============================================================================
 *
 * This is the single frontend source of truth for official brand assets and
 * shared visual-system aliases. Binary assets are generated from the canonical
 * source at /branding/official and copied by scripts/sync-brand-assets.mjs.
 * ============================================================================
 */

export const TITECH_BRAND = Object.freeze({
  name: 'TITech',
  productName: 'Community Capital',
  fullName: 'TITech Community Capital',
  legalName: 'TITech Community Capital LTD',
  tagline: 'Community financial infrastructure for Africa',

  assets: Object.freeze({
    full: '/brand/titech-community-capital-full.png',
    transparent: '/brand/titech-community-capital-transparent.png',
    monochrome: '/brand/titech-community-capital-monochrome.png',
    appIcon: '/brand/titech-community-capital-app-icon.png',
    icon512: '/brand/titech-community-capital-icon-512.png',
    icon192: '/brand/titech-community-capital-icon-192.png',
    icon96: '/brand/titech-community-capital-icon-96.png',
    icon48: '/brand/titech-community-capital-icon-48.png',
    favicon: '/brand/favicon.ico',
  }),

  colors: Object.freeze({
    electricBlue: '#159FE8',
    deepBlue: '#0B4FD8',
    limeGreen: '#8BE617',
    goldYellow: '#F8C51B',
    cyan: '#2BD8E9',
    navyInk: '#0B1F3A',
    white: '#FFFFFF',
  }),
});

export const BRAND_ASSET_VARIANTS = Object.freeze({
  full: TITECH_BRAND.assets.full,
  transparent: TITECH_BRAND.assets.transparent,
  monochrome: TITECH_BRAND.assets.monochrome,
  icon: TITECH_BRAND.assets.icon512,
  favicon: TITECH_BRAND.assets.favicon,
});

export function getBrandAsset(variant = 'transparent') {
  return BRAND_ASSET_VARIANTS[variant] || BRAND_ASSET_VARIANTS.transparent;
}

export default TITECH_BRAND;
