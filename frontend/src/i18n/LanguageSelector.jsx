import React, { useId } from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGE_OPTIONS } from './resources';
import { useI18n } from './I18nProvider';
import './language-selector.css';

export default function LanguageSelector({ className = '' }) {
  const { locale, setLocale, t } = useI18n();
  const generatedId = useId().replace(/:/g, '');
  const inputId = `titech-language-choice-${generatedId}`;
  const classes = ['titech-language-selector', className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-testid="titech-language-selector">
      <Languages aria-hidden="true" focusable="false" size={17} />
      <label className="titech-language-selector__label" htmlFor={inputId}>
        {t('common.language.label')}
      </label>
      <select
        id={inputId}
        className="titech-language-selector__select"
        aria-label={t('common.accessibility.languageSelector')}
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
        data-testid={inputId}
      >
        {LANGUAGE_OPTIONS.map((language) => (
          <option key={language.code} value={language.code} lang={language.code} dir={language.direction}>
            {language.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
