/**
 * ============================================================================
 * TITech Community Capital — Official Brand + Mission Contract
 * File: frontend/src/branding/brand.js
 * ============================================================================
 *
 * This is the single frontend source of truth for:
 *   - official brand assets
 *   - vision-board aligned color roles
 *   - mission, vision and purpose
 *   - strategic pillars
 *   - core values
 *   - intended community impact
 *   - product positioning language
 *
 * Binary logo assets are generated from the canonical source under
 * /branding/official and synchronized by scripts/sync-brand-assets.mjs.
 * The vision board supplied for this release is retained under
 * /branding/vision as a reference artifact and source of the visual-system
 * color direction.
 * ============================================================================
 */

const colors = Object.freeze({
  // Vision-board palette: sampled from the supplied artwork and normalized
  // into accessible UI roles. Bright accents are intended for highlights,
  // icons and decorative emphasis; dark values are used for readable text.
  deepBlue: '#0030A0',
  electricBlue: '#0058D8',
  brightBlue: '#0066E8',
  cyan: '#00B8F8',
  africaGreen: '#008000',
  limeGreen: '#A8F000',
  goldYellow: '#F8D800',
  navyInk: '#082B67',
  white: '#FFFFFF',

  // Backward-compatible aliases used by existing integrations.
  primary: '#0030A0',
  secondary: '#0066E8',
  successAccent: '#008000',
  growthAccent: '#A8F000',
  highlight: '#F8D800',
  informationAccent: '#00B8F8',
});

export const TITECH_VISION = Object.freeze({
  purpose:
    'Transforming Africa through community finance by building trusted financial infrastructure that connects people, communities, capital and opportunity.',

  mission:
    'To empower communities through innovative financial solutions, technology, and education, creating sustainable wealth and shared prosperity across Africa.',

  vision2035:
    'A more inclusive and prosperous Africa powered by trusted community financial infrastructure, strong communities, sustainable growth and opportunity.',

  positioning:
    'Community financial infrastructure layer connecting savings groups, SACCOs, VSLAs/ROSCAs, cooperatives, community enterprises and financial institutions to interoperable payments, trusted financial records, reconciliation, risk intelligence and institutional capital.',

  tagline: 'Community Finance. Stronger Together.',

  impact: Object.freeze([
    'Financial inclusion for all',
    'Stronger communities and families',
    'Economic empowerment across Africa',
    'Ethical, transparent and sustainable finance',
    'A lasting legacy for future generations',
  ]),

  strategicPillars: Object.freeze([
    Object.freeze({
      key: 'financial-inclusion',
      title: 'Financial Inclusion',
      description: 'Accessible financial services for all communities.',
      colorRole: 'electricBlue',
    }),
    Object.freeze({
      key: 'technology-innovation',
      title: 'Technology Innovation',
      description: 'Digital solutions for real-world challenges.',
      colorRole: 'brightBlue',
    }),
    Object.freeze({
      key: 'community-empowerment',
      title: 'Community Empowerment',
      description: 'Stronger communities and brighter futures.',
      colorRole: 'africaGreen',
    }),
    Object.freeze({
      key: 'financial-sustainability',
      title: 'Financial Sustainability',
      description: 'Resilient systems for long-term growth.',
      colorRole: 'goldYellow',
    }),
    Object.freeze({
      key: 'people-culture',
      title: 'People & Culture',
      description: 'Talented teams and values-driven culture.',
      colorRole: 'limeGreen',
    }),
    Object.freeze({
      key: 'partnerships-ecosystem',
      title: 'Partnerships & Ecosystem',
      description: 'Collaboration for greater impact.',
      colorRole: 'cyan',
    }),
  ]),

  coreValues: Object.freeze([
    Object.freeze({
      key: 'integrity',
      title: 'Integrity',
      statement: 'We do what is right, always.',
    }),
    Object.freeze({
      key: 'innovation',
      title: 'Innovation',
      statement: 'We embrace technology to solve real problems.',
    }),
    Object.freeze({
      key: 'impact',
      title: 'Impact',
      statement: 'We measure success by the lives we transform.',
    }),
    Object.freeze({
      key: 'collaboration',
      title: 'Collaboration',
      statement: 'We win together with our communities and partners.',
    }),
    Object.freeze({
      key: 'excellence',
      title: 'Excellence',
      statement: 'We pursue quality in everything we do.',
    }),
  ]),

  dailyReminders: Object.freeze([
    'Start with gratitude',
    'Focus on impact',
    'Stay disciplined',
    'Keep learning',
    'Build relationships',
    'Leave a legacy',
  ]),

  lifeCommitments: Object.freeze([
    'Faith-centered',
    'Healthy mind, body and spirit',
    'Quality time with family and loved ones',
    'Financial freedom',
    'Travel and experience the world',
    'Mentor and uplift others',
  ]),

  beliefs: Object.freeze([
    'In God and His plan',
    'In the power of technology',
    'In the strength of communities',
    'In the future of Africa',
    'In leaving things better than they were found',
  ]),

  commitments: Object.freeze([
    'Building world-class financial infrastructure for communities',
    'Empowering entrepreneurs and SMEs',
    'Driving financial literacy and education',
    'Creating jobs and opportunities',
    'Leading with empathy, humility and purpose',
    'Continuously learning and evolving',
  ]),
});

export const TITECH_BRAND = Object.freeze({
  name: 'TITech',
  productName: 'Community Capital',
  fullName: 'TITech Community Capital',
  legalName: 'TITech Community Capital LTD',
  tagline: TITECH_VISION.tagline,
  mission: TITECH_VISION.mission,
  vision: TITECH_VISION.vision2035,
  purpose: TITECH_VISION.purpose,

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
    visionBoard: '/brand/titech-vision-board.png',
  }),

  colors,

  colorRoles: Object.freeze({
    primary: colors.deepBlue,
    primaryInteractive: colors.electricBlue,
    primaryBright: colors.brightBlue,
    information: colors.cyan,
    inclusion: colors.electricBlue,
    community: colors.africaGreen,
    growth: colors.limeGreen,
    sustainability: colors.goldYellow,
    text: colors.navyInk,
    surface: colors.white,
  }),

  vision: TITECH_VISION,
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
