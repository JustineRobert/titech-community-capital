import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enFinancial from './locales/en/financial.json';
import swCommon from './locales/sw/common.json';
import swAuth from './locales/sw/auth.json';
import swFinancial from './locales/sw/financial.json';
import frCommon from './locales/fr/common.json';
import frAuth from './locales/fr/auth.json';
import frFinancial from './locales/fr/financial.json';
import arCommon from './locales/ar/common.json';
import arAuth from './locales/ar/auth.json';
import arFinancial from './locales/ar/financial.json';

export const RESOURCES = Object.freeze({
  en: Object.freeze({ common: enCommon, auth: enAuth, financial: enFinancial }),
  sw: Object.freeze({ common: swCommon, auth: swAuth, financial: swFinancial }),
  fr: Object.freeze({ common: frCommon, auth: frAuth, financial: frFinancial }),
  ar: Object.freeze({ common: arCommon, auth: arAuth, financial: arFinancial }),
});

export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ code: 'en', nativeName: 'English', direction: 'ltr' }),
  Object.freeze({ code: 'sw', nativeName: 'Kiswahili', direction: 'ltr' }),
  Object.freeze({ code: 'fr', nativeName: 'Français', direction: 'ltr' }),
  Object.freeze({ code: 'ar', nativeName: 'العربية', direction: 'rtl' }),
]);
