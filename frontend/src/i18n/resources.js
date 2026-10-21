import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enFinancial from './locales/en/financial.json';
import enInclusive from './locales/en/inclusive.json';
import enMeetings from './locales/en/meetings.json';
import enEducation from './locales/en/education.json';
import swCommon from './locales/sw/common.json';
import swAuth from './locales/sw/auth.json';
import swFinancial from './locales/sw/financial.json';
import swInclusive from './locales/sw/inclusive.json';
import swMeetings from './locales/sw/meetings.json';
import swEducation from './locales/sw/education.json';
import frCommon from './locales/fr/common.json';
import frAuth from './locales/fr/auth.json';
import frFinancial from './locales/fr/financial.json';
import frInclusive from './locales/fr/inclusive.json';
import frMeetings from './locales/fr/meetings.json';
import frEducation from './locales/fr/education.json';
import arCommon from './locales/ar/common.json';
import arAuth from './locales/ar/auth.json';
import arFinancial from './locales/ar/financial.json';
import arInclusive from './locales/ar/inclusive.json';
import arMeetings from './locales/ar/meetings.json';
import arEducation from './locales/ar/education.json';

export const RESOURCES = Object.freeze({
  en: Object.freeze({ common: enCommon, auth: enAuth, financial: enFinancial, inclusive: enInclusive, meetings: enMeetings, education: enEducation }),
  sw: Object.freeze({ common: swCommon, auth: swAuth, financial: swFinancial, inclusive: swInclusive, meetings: swMeetings, education: swEducation }),
  fr: Object.freeze({ common: frCommon, auth: frAuth, financial: frFinancial, inclusive: frInclusive, meetings: frMeetings, education: frEducation }),
  ar: Object.freeze({ common: arCommon, auth: arAuth, financial: arFinancial, inclusive: arInclusive, meetings: arMeetings, education: arEducation }),
});

export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ code: 'en', nativeName: 'English', direction: 'ltr' }),
  Object.freeze({ code: 'sw', nativeName: 'Kiswahili', direction: 'ltr' }),
  Object.freeze({ code: 'fr', nativeName: 'Français', direction: 'ltr' }),
  Object.freeze({ code: 'ar', nativeName: 'العربية', direction: 'rtl' }),
]);
