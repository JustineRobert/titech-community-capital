// ============================================================================
// frontend/src/pages/admin/AdminSettings.jsx
// TITech Community Capital
// Enterprise Administration Settings Center
// Production Grade
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Info,
  Lock,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Wallet,
  Users,
} from 'lucide-react';

import { updateSettings } from '../../redux/actions/settingsActions';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SETTINGS = Object.freeze({
  siteName: 'TITech Community Capital',

  enableContributions: true,
  enableLoans: true,
  enableSavings: true,

  enableKYC: true,
  enableAML: true,
  enableFraudDetection: true,
  enableRiskScoring: true,

  enableEmailNotifications: true,
  enableSMSNotifications: false,
  enablePushNotifications: true,

  maintenanceMode: false,

  defaultUserRole: 'member',
  maxLoanAmount: 10000000,
  maxGroupMembers: 500,
});

const USER_ROLES = Object.freeze([
  {
    value: 'member',
    label: 'Member',
  },
  {
    value: 'manager',
    label: 'Manager',
  },
  {
    value: 'admin',
    label: 'Administrator',
  },
]);

const INTEGER_FIELDS = new Set([
  'maxLoanAmount',
  'maxGroupMembers',
]);

// ============================================================================
// HELPERS
// ============================================================================

const normalizeSettings = (settings) => ({
  ...DEFAULT_SETTINGS,
  ...(settings && typeof settings === 'object'
    ? settings
    : {}),
});

const formatDateTime = (value) => {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const getErrorMessage = (error, fallback) =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;

// ============================================================================
// COMPONENT
// ============================================================================

const AdminSettings = () => {
  const dispatch = useDispatch();

  const settingsState = useSelector(
    (state) => state?.settings || {}
  );

  const settings = settingsState?.data;
  const loading = Boolean(settingsState?.loading);
  const error = settingsState?.error;
  const lastUpdated = settingsState?.lastUpdated;

  const [localSettings, setLocalSettings] =
    useState(() => normalizeSettings(settings));

  const [saving, setSaving] = useState(false);
  const [saveAttempted, setSaveAttempted] =
    useState(false);

  // ==========================================================================
  // SYNCHRONIZE STORE → LOCAL FORM
  // ==========================================================================

  useEffect(() => {
    if (!settings) {
      return;
    }

    setLocalSettings(normalizeSettings(settings));
  }, [settings]);

  // ==========================================================================
  // CHANGE HANDLER
  // ==========================================================================

  const handleInputChange = useCallback((event) => {
    const {
      name,
      value,
      type,
      checked,
    } = event.target;

    let nextValue = value;

    if (type === 'checkbox') {
      nextValue = checked;
    } else if (INTEGER_FIELDS.has(name)) {
      nextValue =
        value === '' ? '' : Number(value);
    }

    setLocalSettings((current) => ({
      ...current,
      [name]: nextValue,
    }));
  }, []);

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  const validationErrors = useMemo(() => {
    const errors = [];

    const siteName =
      typeof localSettings.siteName === 'string'
        ? localSettings.siteName.trim()
        : '';

    if (!siteName) {
      errors.push({
        field: 'siteName',
        message: 'Platform name is required.',
      });
    }

    if (siteName.length > 120) {
      errors.push({
        field: 'siteName',
        message:
          'Platform name must not exceed 120 characters.',
      });
    }

    const maxLoanAmount = Number(
      localSettings.maxLoanAmount
    );

    if (
      !Number.isFinite(maxLoanAmount) ||
      maxLoanAmount <= 0
    ) {
      errors.push({
        field: 'maxLoanAmount',
        message:
          'Maximum loan amount must be greater than zero.',
      });
    }

    const maxGroupMembers = Number(
      localSettings.maxGroupMembers
    );

    if (
      !Number.isInteger(maxGroupMembers) ||
      maxGroupMembers < 2
    ) {
      errors.push({
        field: 'maxGroupMembers',
        message:
          'Maximum group members must be at least 2.',
      });
    }

    if (maxGroupMembers > 100000) {
      errors.push({
        field: 'maxGroupMembers',
        message:
          'Maximum group members cannot exceed 100,000.',
      });
    }

    if (
      !USER_ROLES.some(
        (role) =>
          role.value ===
          localSettings.defaultUserRole
      )
    ) {
      errors.push({
        field: 'defaultUserRole',
        message: 'The default user role is invalid.',
      });
    }

    return errors;
  }, [localSettings]);

  const errorsByField = useMemo(() => {
    return validationErrors.reduce(
      (result, item) => {
        result[item.field] = item.message;
        return result;
      },
      {}
    );
  }, [validationErrors]);

  // ==========================================================================
  // DIRTY STATE
  // ==========================================================================

  const isDirty = useMemo(() => {
    return (
      JSON.stringify(localSettings) !==
      JSON.stringify(normalizeSettings(settings))
    );
  }, [localSettings, settings]);

  // ==========================================================================
  // SAVE
  // ==========================================================================

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setSaveAttempted(true);

      if (validationErrors.length > 0) {
        validationErrors.forEach(({ message }) =>
          toast.error(message)
        );
        return;
      }

      if (saving) {
        return;
      }

      try {
        setSaving(true);

        const payload = {
          ...localSettings,
          siteName:
            localSettings.siteName.trim(),
          maxLoanAmount: Number(
            localSettings.maxLoanAmount
          ),
          maxGroupMembers: Number(
            localSettings.maxGroupMembers
          ),
        };

        await dispatch(updateSettings(payload));

        toast.success(
          'Platform settings updated successfully.'
        );
      } catch (saveError) {
        console.error(
          '[TITech AdminSettings] Failed to update settings:',
          saveError
        );

        toast.error(
          getErrorMessage(
            saveError,
            'Failed to update platform settings.'
          )
        );
      } finally {
        setSaving(false);
      }
    },
    [
      dispatch,
      localSettings,
      saving,
      validationErrors,
    ]
  );

  // ==========================================================================
  // RESET LOCAL CHANGES
  // ==========================================================================

  const handleReset = useCallback(() => {
    if (!isDirty) {
      return;
    }

    const confirmed = window.confirm(
      'Discard all unsaved settings changes?'
    );

    if (!confirmed) {
      return;
    }

    setLocalSettings(normalizeSettings(settings));
    setSaveAttempted(false);

    toast.info('Unsaved changes discarded.');
  }, [isDirty, settings]);

  // ==========================================================================
  // LOADING
  // ==========================================================================

  if (loading && !settings) {
    return (
      <main
        className="admin-settings-page"
        aria-busy="true"
        aria-labelledby="admin-settings-title"
      >
        <div
          className="settings-loading"
          role="status"
          aria-live="polite"
        >
          <RefreshCw
            size={42}
            className="animate-spin"
            aria-hidden="true"
          />

          <h1 id="admin-settings-title">
            Loading Settings…
          </h1>

          <p>
            Retrieving TITech Community Capital
            configuration.
          </p>
        </div>
      </main>
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <main
      className="admin-settings-page"
      aria-labelledby="admin-settings-title"
    >
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}

      <header className="settings-header">
        <div className="settings-header-content">
          <div
            className="settings-title-icon"
            aria-hidden="true"
          >
            <Settings size={28} />
          </div>

          <div>
            <h1 id="admin-settings-title">
              Platform Settings
            </h1>

            <p>
              Configure TITech Community Capital
              platform behavior, financial controls,
              compliance features and notifications.
            </p>
          </div>
        </div>

        <div
          className="settings-status"
          title={
            lastUpdated
              ? formatDateTime(lastUpdated)
              : undefined
          }
        >
          <CheckCircle2
            size={18}
            aria-hidden="true"
          />

          <span>
            Last updated:{' '}
            {formatDateTime(lastUpdated)}
          </span>
        </div>
      </header>

      {/* ================================================================== */}
      {/* ERROR */}
      {/* ================================================================== */}

      {error && (
        <section
          className="settings-error"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle
            size={19}
            aria-hidden="true"
          />

          <div>
            <strong>
              Settings service reported an error
            </strong>

            <p>{String(error)}</p>
          </div>
        </section>
      )}

      {/* ================================================================== */}
      {/* UNSAVED CHANGES NOTICE */}
      {/* ================================================================== */}

      {isDirty && (
        <div
          className="settings-unsaved-notice"
          role="status"
          aria-live="polite"
        >
          <Info size={18} aria-hidden="true" />

          <span>
            You have unsaved configuration changes.
          </span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="settings-form"
        noValidate
      >
        {/* ================================================================ */}
        {/* GENERAL */}
        {/* ================================================================ */}

        <section
          className="settings-card"
          aria-labelledby="general-settings-heading"
        >
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Database
                size={20}
                aria-hidden="true"
              />
            </div>

            <div>
              <h2 id="general-settings-heading">
                General Configuration
              </h2>

              <p>
                Core platform identity and default
                account behavior.
              </p>
            </div>
          </div>

          <div className="settings-card-body">
            <div className="form-group">
              <label htmlFor="siteName">
                Platform Name
              </label>

              <input
                id="siteName"
                type="text"
                name="siteName"
                value={localSettings.siteName}
                onChange={handleInputChange}
                maxLength={120}
                autoComplete="organization"
                aria-invalid={
                  saveAttempted &&
                  Boolean(errorsByField.siteName)
                }
                aria-describedby={
                  errorsByField.siteName
                    ? 'siteName-error'
                    : 'siteName-help'
                }
              />

              <small id="siteName-help">
                The name displayed across the
                TITech Community Capital platform.
              </small>

              {saveAttempted &&
                errorsByField.siteName && (
                  <FieldError
                    id="siteName-error"
                    message={
                      errorsByField.siteName
                    }
                  />
                )}
            </div>

            <div className="form-group">
              <label htmlFor="defaultUserRole">
                Default User Role
              </label>

              <select
                id="defaultUserRole"
                name="defaultUserRole"
                value={
                  localSettings.defaultUserRole
                }
                onChange={handleInputChange}
                aria-invalid={
                  saveAttempted &&
                  Boolean(
                    errorsByField.defaultUserRole
                  )
                }
              >
                {USER_ROLES.map((role) => (
                  <option
                    key={role.value}
                    value={role.value}
                  >
                    {role.label}
                  </option>
                ))}
              </select>

              <small>
                Applied when creating users without
                an explicitly assigned role.
              </small>

              {saveAttempted &&
                errorsByField.defaultUserRole && (
                  <FieldError
                    message={
                      errorsByField.defaultUserRole
                    }
                  />
                )}
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* FINANCIAL SERVICES */}
        {/* ================================================================ */}

        <section
          className="settings-card"
          aria-labelledby="financial-settings-heading"
        >
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Wallet
                size={20}
                aria-hidden="true"
              />
            </div>

            <div>
              <h2 id="financial-settings-heading">
                Financial Services
              </h2>

              <p>
                Control availability and operational
                limits for community financial services.
              </p>
            </div>
          </div>

          <div className="settings-card-body">
            <Toggle
              label="Enable Contributions"
              description="Allow members and groups to record and process contributions."
              name="enableContributions"
              value={
                localSettings.enableContributions
              }
              onChange={handleInputChange}
            />

            <Toggle
              label="Enable Savings"
              description="Allow members to use savings functionality."
              name="enableSavings"
              value={localSettings.enableSavings}
              onChange={handleInputChange}
            />

            <Toggle
              label="Enable Loans"
              description="Allow loan applications and loan processing workflows."
              name="enableLoans"
              value={localSettings.enableLoans}
              onChange={handleInputChange}
            />

            <div className="settings-grid">
              <NumberField
                id="maxLoanAmount"
                name="maxLoanAmount"
                label="Maximum Loan Amount"
                suffix="UGX"
                value={
                  localSettings.maxLoanAmount
                }
                onChange={handleInputChange}
                min={1}
                step={1}
                error={
                  saveAttempted
                    ? errorsByField.maxLoanAmount
                    : ''
                }
                helpText="Maximum permitted loan principal per configured loan policy."
              />

              <NumberField
                id="maxGroupMembers"
                name="maxGroupMembers"
                label="Maximum Group Members"
                value={
                  localSettings.maxGroupMembers
                }
                onChange={handleInputChange}
                min={2}
                max={100000}
                step={1}
                error={
                  saveAttempted
                    ? errorsByField.maxGroupMembers
                    : ''
                }
                helpText="Maximum number of members permitted in a community group."
              />
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* COMPLIANCE */}
        {/* ================================================================ */}

        <section
          className="settings-card"
          aria-labelledby="compliance-settings-heading"
        >
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Lock
                size={20}
                aria-hidden="true"
              />
            </div>

            <div>
              <h2 id="compliance-settings-heading">
                Compliance &amp; Risk
              </h2>

              <p>
                Configure controls supporting identity,
                financial crime prevention and risk
                management.
              </p>
            </div>
          </div>

          <div className="settings-card-body">
            <Toggle
              label="Enable KYC"
              description="Enable customer identity verification workflows."
              name="enableKYC"
              value={localSettings.enableKYC}
              onChange={handleInputChange}
              security
            />

            <Toggle
              label="Enable AML Monitoring"
              description="Enable anti-money-laundering monitoring and controls."
              name="enableAML"
              value={localSettings.enableAML}
              onChange={handleInputChange}
              security
            />

            <Toggle
              label="Enable Fraud Detection"
              description="Enable transaction and account fraud detection controls."
              name="enableFraudDetection"
              value={
                localSettings.enableFraudDetection
              }
              onChange={handleInputChange}
              security
            />

            <Toggle
              label="Enable Risk Scoring"
              description="Enable risk assessment and scoring functionality."
              name="enableRiskScoring"
              value={
                localSettings.enableRiskScoring
              }
              onChange={handleInputChange}
              security
            />
          </div>
        </section>

        {/* ================================================================ */}
        {/* NOTIFICATIONS */}
        {/* ================================================================ */}

        <section
          className="settings-card"
          aria-labelledby="notification-settings-heading"
        >
          <div className="settings-card-header">
            <div className="settings-card-icon">
              <Bell
                size={20}
                aria-hidden="true"
              />
            </div>

            <div>
              <h2 id="notification-settings-heading">
                Notifications
              </h2>

              <p>
                Configure the communication channels
                available to the platform.
              </p>
            </div>
          </div>

          <div className="settings-card-body">
            <Toggle
              label="Email Notifications"
              description="Allow platform notifications to be delivered by email."
              name="enableEmailNotifications"
              value={
                localSettings.enableEmailNotifications
              }
              onChange={handleInputChange}
            />

            <Toggle
              label="SMS Notifications"
              description="Allow platform notifications to be delivered by SMS."
              name="enableSMSNotifications"
              value={
                localSettings.enableSMSNotifications
              }
              onChange={handleInputChange}
            />

            <Toggle
              label="Push Notifications"
              description="Allow supported clients to receive push notifications."
              name="enablePushNotifications"
              value={
                localSettings.enablePushNotifications
              }
              onChange={handleInputChange}
            />
          </div>
        </section>

        {/* ================================================================ */}
        {/* MAINTENANCE */}
        {/* ================================================================ */}

        <section
          className="settings-card danger-card"
          aria-labelledby="maintenance-settings-heading"
        >
          <div className="settings-card-header">
            <div className="settings-card-icon danger">
              <AlertTriangle
                size={20}
                aria-hidden="true"
              />
            </div>

            <div>
              <h2 id="maintenance-settings-heading">
                Maintenance Mode
              </h2>

              <p>
                Temporarily restrict normal platform
                operations during planned maintenance or
                emergency intervention.
              </p>
            </div>
          </div>

          <div className="settings-card-body">
            <Toggle
              label="Enable Maintenance Mode"
              description="Place the platform into maintenance mode. Ensure users and financial operations are appropriately notified before activation."
              name="maintenanceMode"
              value={
                localSettings.maintenanceMode
              }
              onChange={handleInputChange}
              danger
            />

            {localSettings.maintenanceMode && (
              <div
                className="maintenance-warning"
                role="alert"
              >
                <AlertTriangle
                  size={18}
                  aria-hidden="true"
                />

                <div>
                  <strong>
                    Maintenance mode is enabled
                  </strong>

                  <p>
                    Platform behavior may be restricted
                    for end users. Verify operational,
                    financial and communication
                    dependencies before saving this
                    configuration.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ================================================================ */}
        {/* VALIDATION SUMMARY */}
        {/* ================================================================ */}

        {saveAttempted &&
          validationErrors.length > 0 && (
            <section
              className="settings-validation-summary"
              role="alert"
              aria-labelledby="settings-validation-heading"
            >
              <AlertTriangle
                size={20}
                aria-hidden="true"
              />

              <div>
                <h2 id="settings-validation-heading">
                  Review configuration
                </h2>

                <ul>
                  {validationErrors.map(
                    ({ field, message }) => (
                      <li key={field}>
                        {message}
                      </li>
                    )
                  )}
                </ul>
              </div>
            </section>
          )}

        {/* ================================================================ */}
        {/* ACTIONS */}
        {/* ================================================================ */}

        <div className="settings-actions">
          <div className="settings-actions-info">
            {isDirty ? (
              <>
                <Info
                  size={16}
                  aria-hidden="true"
                />

                <span>
                  Unsaved changes
                </span>
              </>
            ) : (
              <>
                <CheckCircle2
                  size={16}
                  aria-hidden="true"
                />

                <span>
                  Configuration is up to date
                </span>
              </>
            )}
          </div>

          <div className="settings-action-buttons">
            <button
              type="button"
              className="reset-btn"
              onClick={handleReset}
              disabled={!isDirty || saving}
            >
              Reset Changes
            </button>

            <button
              type="submit"
              className="save-btn"
              disabled={
                saving ||
                validationErrors.length > 0
              }
              aria-busy={saving}
            >
              {saving ? (
                <>
                  <RefreshCw
                    size={18}
                    className="animate-spin"
                    aria-hidden="true"
                  />

                  Saving…
                </>
              ) : (
                <>
                  <Save
                    size={18}
                    aria-hidden="true"
                  />

                  Save Settings
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ================================================================== */}
      {/* SECURITY FOOTER */}
      {/* ================================================================== */}

      <footer className="settings-security-notice">
        <Shield
          size={17}
          aria-hidden="true"
        />

        <p>
          Platform settings can affect financial,
          compliance, notification and availability
          behavior. Only authorized TITech
          administrators should modify production
          configuration.
        </p>
      </footer>
    </main>
  );
};

// ============================================================================
// TOGGLE
// ============================================================================

const Toggle = ({
  label,
  description,
  name,
  value,
  onChange,
  security = false,
  danger = false,
}) => {
  const descriptionId = `${name}-description`;

  return (
    <div
      className={[
        'toggle-row',
        security ? 'security-toggle' : '',
        danger ? 'danger-toggle' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="toggle-copy">
        <label htmlFor={name}>
          {label}
        </label>

        {description && (
          <small id={descriptionId}>
            {description}
          </small>
        )}
      </div>

      <label
        className="toggle-control"
        htmlFor={name}
      >
        <input
          id={name}
          type="checkbox"
          name={name}
          checked={Boolean(value)}
          onChange={onChange}
          aria-describedby={
            description ? descriptionId : undefined
          }
        />

        <span
          className="toggle-slider"
          aria-hidden="true"
        />

        <span className="sr-only">
          {value ? 'Enabled' : 'Disabled'}
        </span>
      </label>
    </div>
  );
};

// ============================================================================
// NUMBER FIELD
// ============================================================================

const NumberField = ({
  id,
  name,
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  error,
  helpText,
}) => {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  return (
    <div className="form-group">
      <label htmlFor={id}>
        {label}
      </label>

      <div
        className={`number-input-wrapper ${
          error ? 'has-error' : ''
        }`}
      >
        <input
          id={id}
          type="number"
          name={name}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          inputMode="numeric"
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? errorId : helpId
          }
        />

        {suffix && (
          <span
            className="number-input-suffix"
            aria-hidden="true"
          >
            {suffix}
          </span>
        )}
      </div>

      {helpText && (
        <small id={helpId}>
          {helpText}
        </small>
      )}

      {error && (
        <FieldError
          id={errorId}
          message={error}
        />
      )}
    </div>
  );
};

// ============================================================================
// FIELD ERROR
// ============================================================================

const FieldError = ({ id, message }) => (
  <span
    id={id}
    className="field-error"
    role="alert"
  >
    <AlertTriangle
      size={14}
      aria-hidden="true"
    />

    {message}
  </span>
);

export default AdminSettings;