/**
 * TITech Community Capital — backend branding contract.
 */
const path = require('path');
const BRAND_ROOT = path.resolve(__dirname);
module.exports = Object.freeze({
  name: 'TITech',
  productName: 'Community Capital',
  fullName: 'TITech Community Capital',
  legalName: 'TITech Community Capital LTD',
  emailFromName: 'TITech Community Capital',
  assets: Object.freeze({
    transparent: path.join(BRAND_ROOT, 'assets', 'titech-community-capital-transparent.png'),
    full: path.join(BRAND_ROOT, 'assets', 'titech-community-capital-full.png'),
    monochrome: path.join(BRAND_ROOT, 'assets', 'titech-community-capital-monochrome.png'),
  }),
  colors: Object.freeze({
    electricBlue: '#159FE8',
    deepBlue: '#0B4FD8',
    limeGreen: '#8BE617',
    goldYellow: '#F8C51B',
    cyan: '#2BD8E9',
    navyInk: '#0B1F3A',
  }),
});
