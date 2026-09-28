/**
 * TITech Community Capital — backend brand + mission contract.
 *
 * This contract mirrors the frontend brand roles so reports, emails and other
 * server-rendered artifacts remain visually and semantically aligned.
 */
const path = require('path');

const BRAND_ROOT = path.resolve(__dirname);

module.exports = Object.freeze({
  name: 'TITech',
  productName: 'Community Capital',
  fullName: 'TITech Community Capital',
  legalName: 'TITech Community Capital LTD',
  emailFromName: 'TITech Community Capital',

  tagline: 'Community Finance. Stronger Together.',
  mission:
    'To empower communities through innovative financial solutions, technology, and education, creating sustainable wealth and shared prosperity across Africa.',
  vision2035:
    'A more inclusive and prosperous Africa powered by trusted community financial infrastructure, strong communities, sustainable growth and opportunity.',
  purpose:
    'Transforming Africa through community finance by building trusted financial infrastructure that connects people, communities, capital and opportunity.',

  assets: Object.freeze({
    transparent: path.join(
      BRAND_ROOT,
      'assets',
      'titech-community-capital-transparent.png',
    ),
    full: path.join(
      BRAND_ROOT,
      'assets',
      'titech-community-capital-full.png',
    ),
    monochrome: path.join(
      BRAND_ROOT,
      'assets',
      'titech-community-capital-monochrome.png',
    ),
  }),

  colors: Object.freeze({
    deepBlue: '#0030A0',
    electricBlue: '#0058D8',
    brightBlue: '#0066E8',
    cyan: '#00B8F8',
    africaGreen: '#008000',
    limeGreen: '#A8F000',
    goldYellow: '#F8D800',
    navyInk: '#082B67',
    white: '#FFFFFF',

    // Backward-compatible aliases.
    primary: '#0030A0',
    secondary: '#0066E8',
    successAccent: '#008000',
    growthAccent: '#A8F000',
    highlight: '#F8D800',
    informationAccent: '#00B8F8',
  }),

  strategicPillars: Object.freeze([
    'Financial Inclusion',
    'Technology Innovation',
    'Community Empowerment',
    'Financial Sustainability',
    'People & Culture',
    'Partnerships & Ecosystem',
  ]),

  coreValues: Object.freeze([
    'Integrity',
    'Innovation',
    'Impact',
    'Collaboration',
    'Excellence',
  ]),
});
