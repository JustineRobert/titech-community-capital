// ============================================================================
// TITech Community Capital
// frontend/src/pages/CreateGroup.jsx
//
// Enterprise Group Creation Workflow
// Production Grade
//
// Workflow:
// 1. Group Information
// 2. Members
// 3. Review
// 4. Create
//
// Security / Reliability:
// - Defensive validation
// - Email normalization
// - Duplicate prevention
// - CSV size limits
// - CSV validation
// - Abortable requests
// - Unmount protection
// - Duplicate-submit protection
// - Defensive API error handling
// - No client-side trust of server responses
// - Accessible form controls
// - Keyboard-friendly navigation
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'react-toastify';

import api from '../services/api';

import './CreateGroup.css';

// ============================================================================
// CONSTANTS
// ============================================================================

const GROUP_TYPES = Object.freeze([
  {
    value: 'savings',
    label: 'Savings Group',
    description: 'Traditional community savings pool',
  },
  {
    value: 'investment',
    label: 'Investment Group',
    description: 'Focus on investment opportunities',
  },
  {
    value: 'community',
    label: 'Community Support',
    description: 'General community support and welfare',
  },
]);

const STEPS = Object.freeze([
  {
    id: 1,
    label: 'Information',
    description: 'Group details',
  },
  {
    id: 2,
    label: 'Members',
    description: 'Add members',
  },
  {
    id: 3,
    label: 'Review',
    description: 'Confirm details',
  },
  {
    id: 4,
    label: 'Create',
    description: 'Create group',
  },
]);

const DEFAULT_GROUP_TYPE = GROUP_TYPES[0].value;

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const MAX_GROUP_NAME_LENGTH = 120;

const MAX_MEMBER_COUNT = 1000;

const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024;

const MAX_CSV_ROWS = 1000;

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_REGEX.test(normalizeEmail(value));
}

function uniqueEmails(emails) {
  const seen = new Set();
  const result = [];

  for (const email of emails) {
    const normalized = normalizeEmail(email);

    if (!normalized || !isValidEmail(normalized)) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function validateMemberEmails(emails) {
  const invalid = [];
  const duplicates = [];
  const cleaned = [];

  const seen = new Set();

  for (const raw of Array.isArray(emails) ? emails : []) {
    const original = normalizeString(raw);

    if (!original) {
      continue;
    }

    const email = normalizeEmail(original);

    if (!isValidEmail(email)) {
      invalid.push(original);
      continue;
    }

    if (seen.has(email)) {
      duplicates.push(email);
      continue;
    }

    seen.add(email);
    cleaned.push(email);
  }

  return {
    invalid,
    duplicates,
    cleaned,
  };
}

function getApiErrorMessage(error, fallback = 'An unexpected error occurred.') {
  if (!error) {
    return fallback;
  }

  if (
    error.name === 'AbortError' ||
    error.code === 'ERR_CANCELED' ||
    error.code === 'ECONNABORTED'
  ) {
    return 'Request was cancelled.';
  }

  const responseData = error?.response?.data;

  if (typeof responseData === 'string' && responseData.trim()) {
    return responseData.trim();
  }

  if (responseData?.message) {
    return String(responseData.message);
  }

  if (Array.isArray(responseData?.errors)) {
    const messages = responseData.errors
      .map((item) => {
        if (typeof item === 'string') return item;
        return item?.message || item?.msg || null;
      })
      .filter(Boolean);

    if (messages.length) {
      return messages.join(', ');
    }
  }

  if (error?.message) {
    return String(error.message);
  }

  return fallback;
}

// ============================================================================
// CSV PARSER
// ============================================================================

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];

    if (character === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current.trim());

  return values;
}

function parseCSVText(text) {
  const normalizedText = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = normalizedText.split('\n');

  const emails = [];
  const errors = [];

  let nonEmptyRows = 0;

  lines.forEach((line, index) => {
    const rowNumber = index + 1;
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    nonEmptyRows += 1;

    if (nonEmptyRows > MAX_CSV_ROWS) {
      errors.push(
        `CSV contains more than ${MAX_CSV_ROWS.toLocaleString()} rows.`,
      );
      return;
    }

    const columns = parseCSVLine(trimmedLine);

    const candidate = columns
      .map((column) => normalizeString(column))
      .find(Boolean);

    if (!candidate) {
      errors.push(`Row ${rowNumber}: no email address found.`);
      return;
    }

    // Allow a simple header row.
    if (
      rowNumber === 1 &&
      ['email', 'email address', 'member email'].includes(
        candidate.toLowerCase(),
      )
    ) {
      return;
    }

    emails.push(candidate);
  });

  return {
    emails,
    errors,
  };
}

// ============================================================================
// STEP INDICATOR
// ============================================================================

function StepIndicator({ currentStep }) {
  return (
    <nav
      className="create-group-steps"
      aria-label="Group creation progress"
    >
      <ol className="create-group-steps-list">
        {STEPS.map((step, index) => {
          const completed = currentStep > step.id;
          const active = currentStep === step.id;

          return (
            <React.Fragment key={step.id}>
              <li
                className={[
                  'create-group-step',
                  active ? 'create-group-step--active' : '',
                  completed ? 'create-group-step--completed' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={active ? 'step' : undefined}
              >
                <div className="create-group-step-marker">
                  {completed ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    step.id
                  )}
                </div>

                <div className="create-group-step-content">
                  <span className="create-group-step-label">
                    {step.label}
                  </span>

                  <span className="create-group-step-description">
                    {step.description}
                  </span>
                </div>
              </li>

              {index < STEPS.length - 1 && (
                <li
                  className={[
                    'create-group-step-connector',
                    currentStep > step.id
                      ? 'create-group-step-connector--completed'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

StepIndicator.propTypes = {
  currentStep: PropTypes.number.isRequired,
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CreateGroup() {
  const navigate = useNavigate();

  const mountedRef = useRef(false);
  const submittingRef = useRef(false);
  const abortControllerRef = useRef(null);

  // --------------------------------------------------------------------------
  // Form state
  // --------------------------------------------------------------------------

  const [step, setStep] = useState(1);

  const [groupName, setGroupName] = useState('');

  const [groupType, setGroupType] =
    useState(DEFAULT_GROUP_TYPE);

  const [memberEmails, setMemberEmails] =
    useState(['']);

  // --------------------------------------------------------------------------
  // UI state
  // --------------------------------------------------------------------------

  const [error, setError] = useState('');

  const [csvErrors, setCsvErrors] = useState([]);

  const [csvFileName, setCsvFileName] = useState('');

  const [loading, setLoading] = useState(false);

  const [statusMessage, setStatusMessage] = useState('');

  const [createdGroupId, setCreatedGroupId] = useState(null);

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {
          // Ignore abort cleanup errors.
        }
      }
    };
  }, []);

  // ==========================================================================
  // DERIVED VALUES
  // ==========================================================================

  const selectedGroupType = useMemo(
    () =>
      GROUP_TYPES.find(
        (type) => type.value === groupType,
      ) || GROUP_TYPES[0],
    [groupType],
  );

  const memberValidation = useMemo(
    () => validateMemberEmails(memberEmails),
    [memberEmails],
  );

  const validMembers = memberValidation.cleaned;

  const memberCount = validMembers.length;

  const groupNameError = useMemo(() => {
    const value = normalizeString(groupName);

    if (!value) {
      return 'Group name is required.';
    }

    if (value.length > MAX_GROUP_NAME_LENGTH) {
      return `Group name must not exceed ${MAX_GROUP_NAME_LENGTH} characters.`;
    }

    return '';
  }, [groupName]);

  const progressPercentage = useMemo(() => {
    if (step >= 4) {
      return 100;
    }

    return Math.round(
      ((step - 1) / (STEPS.length - 1)) * 100,
    );
  }, [step]);

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  const validateStep = useCallback(
    (targetStep = step) => {
      setError('');

      if (targetStep === 1) {
        if (groupNameError) {
          setError(groupNameError);
          return false;
        }

        if (
          !GROUP_TYPES.some(
            (type) => type.value === groupType,
          )
        ) {
          setError('Please select a valid group type.');
          return false;
        }

        return true;
      }

      if (targetStep === 2) {
        const { invalid, cleaned } =
          validateMemberEmails(memberEmails);

        if (cleaned.length === 0) {
          setError(
            'Please add at least one valid member email address.',
          );
          return false;
        }

        if (cleaned.length > MAX_MEMBER_COUNT) {
          setError(
            `A group cannot contain more than ${MAX_MEMBER_COUNT.toLocaleString()} members.`,
          );
          return false;
        }

        if (invalid.length > 0) {
          setError(
            `Invalid email address${
              invalid.length > 1 ? 'es' : ''
            }: ${invalid.join(', ')}`,
          );
          return false;
        }

        setMemberEmails(cleaned);

        return true;
      }

      if (targetStep === 3) {
        if (!validateStep(1)) {
          return false;
        }

        return validateStep(2);
      }

      return true;
    },
    [
      step,
      groupNameError,
      groupType,
      memberEmails,
    ],
  );

  // ==========================================================================
  // GROUP NAME HANDLER
  // ==========================================================================

  const handleGroupNameChange = useCallback((event) => {
    const value = event.target.value;

    setGroupName(
      value.slice(0, MAX_GROUP_NAME_LENGTH),
    );

    setError('');
  }, []);

  // ==========================================================================
  // MEMBER HANDLERS
  // ==========================================================================

  const handleEmailChange = useCallback(
    (index, value) => {
      setMemberEmails((previous) =>
        previous.map((email, currentIndex) =>
          currentIndex === index ? value : email,
        ),
      );

      setError('');
    },
    [],
  );

  const handleAddEmail = useCallback(() => {
    setMemberEmails((previous) => {
      if (previous.length >= MAX_MEMBER_COUNT) {
        return previous;
      }

      return [...previous, ''];
    });

    setError('');
  }, []);

  const handleRemoveEmail = useCallback((index) => {
    setMemberEmails((previous) => {
      if (previous.length <= 1) {
        return [''];
      }

      return previous.filter(
        (_, currentIndex) => currentIndex !== index,
      );
    });

    setError('');
  }, []);

  const handleNormalizeMembers = useCallback(() => {
    const { cleaned } =
      validateMemberEmails(memberEmails);

    setMemberEmails(
      cleaned.length > 0 ? cleaned : [''],
    );

    setError('');

    if (cleaned.length > 0) {
      toast.success(
        `${cleaned.length.toLocaleString()} unique member${
          cleaned.length === 1 ? '' : 's'
        } ready.`,
      );
    } else {
      toast.info('No valid member email addresses found.');
    }
  }, [memberEmails]);

  // ==========================================================================
  // CSV UPLOAD
  // ==========================================================================

  const handleCsvUpload = useCallback(
    async (event) => {
      const input = event.target;
      const file = input?.files?.[0];

      setCsvErrors([]);
      setCsvFileName('');
      setError('');

      if (!file) {
        return;
      }

      if (file.size > MAX_CSV_SIZE_BYTES) {
        const message =
          `CSV file is too large. Maximum allowed size is ${
            MAX_CSV_SIZE_BYTES / 1024 / 1024
          } MB.`;

        setCsvErrors([message]);
        setError(message);

        input.value = '';

        return;
      }

      if (
        file.type &&
        ![
          'text/csv',
          'application/csv',
          'application/vnd.ms-excel',
        ].includes(file.type) &&
        !file.name.toLowerCase().endsWith('.csv')
      ) {
        const message =
          'Please upload a valid CSV file.';

        setCsvErrors([message]);
        setError(message);

        input.value = '';

        return;
      }

      setCsvFileName(file.name);

      try {
        const text = await file.text();

        if (!mountedRef.current) {
          return;
        }

        const {
          emails,
          errors: parseErrors,
        } = parseCSVText(text);

        const {
          invalid,
          cleaned,
        } = validateMemberEmails(emails);

        const combinedErrors = [
          ...parseErrors,
        ];

        if (invalid.length > 0) {
          combinedErrors.push(
            `Invalid email address${
              invalid.length > 1 ? 'es' : ''
            }: ${invalid.join(', ')}`,
          );
        }

        if (cleaned.length > MAX_MEMBER_COUNT) {
          combinedErrors.push(
            `The CSV contains more than ${MAX_MEMBER_COUNT.toLocaleString()} valid members.`,
          );
        }

        if (combinedErrors.length > 0) {
          setCsvErrors(combinedErrors);
        }

        if (cleaned.length > 0) {
          const limitedMembers =
            cleaned.slice(0, MAX_MEMBER_COUNT);

          setMemberEmails(limitedMembers);

          toast.success(
            `Loaded ${limitedMembers.length.toLocaleString()} member${
              limitedMembers.length === 1
                ? ''
                : 's'
            } from CSV.`,
          );
        } else {
          setMemberEmails(['']);

          if (combinedErrors.length === 0) {
            setCsvErrors([
              'No valid email addresses were found in the CSV.',
            ]);
          }
        }
      } catch (parseError) {
        const message =
          getApiErrorMessage(
            parseError,
            'Failed to read the CSV file.',
          );

        setCsvErrors([message]);
        setError(message);

        toast.error(message);
      } finally {
        input.value = '';
      }
    },
    [],
  );

  // ==========================================================================
  // NAVIGATION
  // ==========================================================================

  const handleNext = useCallback(() => {
    setError('');

    if (!validateStep(step)) {
      return;
    }

    setStep((currentStep) =>
      Math.min(STEPS.length, currentStep + 1),
    );

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, [step, validateStep]);

  const handleBack = useCallback(() => {
    if (loading) {
      return;
    }

    setError('');

    setStep((currentStep) =>
      Math.max(1, currentStep - 1),
    );

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, [loading]);

  // ==========================================================================
  // CREATE GROUP
  // ==========================================================================

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();

      if (loading || submittingRef.current) {
        return;
      }

      setError('');

      if (!validateStep(3)) {
        return;
      }

      const cleanedMembers =
        uniqueEmails(memberEmails);

      if (cleanedMembers.length === 0) {
        setStep(2);
        setError(
          'At least one valid member email is required.',
        );
        return;
      }

      if (cleanedMembers.length > MAX_MEMBER_COUNT) {
        setStep(2);
        setError(
          `A maximum of ${MAX_MEMBER_COUNT.toLocaleString()} members is allowed.`,
        );
        return;
      }

      submittingRef.current = true;

      setLoading(true);
      setStatusMessage('Creating your group...');
      setStep(4);

      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch {
          // Ignore previous request cancellation errors.
        }
      }

      const controller =
        new AbortController();

      abortControllerRef.current = controller;

      const payload = {
        name: normalizeString(groupName),
        type: groupType,
        members: cleanedMembers,
      };

      try {
        const response = await api.post(
          '/groups',
          payload,
          {
            signal: controller.signal,
          },
        );

        if (!mountedRef.current) {
          return;
        }

        const responseData =
          response?.data?.data ??
          response?.data ??
          {};

        const returnedGroupId =
          responseData?.id ??
          responseData?._id ??
          responseData?.groupId ??
          null;

        setCreatedGroupId(returnedGroupId);
        setStatusMessage(
          'Group created successfully.',
        );

        toast.success(
          'TITech Community Capital group created successfully.',
        );

        // Give the success state a moment to render
        // before navigation.
        window.setTimeout(() => {
          if (!mountedRef.current) {
            return;
          }

          navigate(
            returnedGroupId
              ? `/groups/${encodeURIComponent(
                  returnedGroupId,
                )}`
              : '/groups',
            {
              replace: true,
            },
          );
        }, 500);
      } catch (requestError) {
        if (!mountedRef.current) {
          return;
        }

        const aborted =
          requestError?.name ===
            'AbortError' ||
          requestError?.code ===
            'ERR_CANCELED';

        if (aborted) {
          setLoading(false);
          setStatusMessage('');
          setStep(3);
          return;
        }

        const message =
          getApiErrorMessage(
            requestError,
            'Failed to create the group. Please try again.',
          );

        setError(message);
        setStatusMessage('');
        setStep(3);

        toast.error(message);
      } finally {
        submittingRef.current = false;

        if (mountedRef.current) {
          setLoading(false);
        }

        if (
          abortControllerRef.current ===
          controller
        ) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      loading,
      validateStep,
      memberEmails,
      groupName,
      groupType,
      navigate,
    ],
  );

  // ==========================================================================
  // CANCEL
  // ==========================================================================

  const handleCancel = useCallback(() => {
    if (loading) {
      return;
    }

    navigate(-1);
  }, [loading, navigate]);

  // ==========================================================================
  // KEYBOARD SUPPORT
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) {
        handleCancel();
      }
    };

    window.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [handleCancel, loading]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <main
      className="create-group-page"
      aria-labelledby="create-group-heading"
    >
      <div className="create-group-container">
        {/* ==================================================================
            PAGE HEADER
            ================================================================== */}

        <header className="create-group-header">
          <div className="create-group-header-icon">
            <Users
              size={24}
              aria-hidden="true"
            />
          </div>

          <div>
            <p className="create-group-eyebrow">
              TITech Community Capital
            </p>

            <h1 id="create-group-heading">
              Create New Group
            </h1>

            <p className="create-group-subtitle">
              Set up a community group and invite
              its members securely.
            </p>
          </div>
        </header>

        {/* ==================================================================
            PROGRESS
            ================================================================== */}

        <StepIndicator currentStep={step} />

        <div
          className="create-group-progress"
          aria-hidden="true"
        >
          <div
            className="create-group-progress-bar"
            style={{
              width: `${progressPercentage}%`,
            }}
          />
        </div>

        {/* ==================================================================
            ERROR
            ================================================================== */}

        {error && (
          <div
            className="create-group-alert create-group-alert--error"
            role="alert"
          >
            <AlertCircle
              size={20}
              aria-hidden="true"
            />

            <div>
              <strong>Unable to continue</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              className="create-group-alert-close"
              onClick={() => setError('')}
              aria-label="Dismiss error"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* ==================================================================
            SUCCESS
            ================================================================== */}

        {createdGroupId && (
          <div
            className="create-group-alert create-group-alert--success"
            role="status"
          >
            <CheckCircle2
              size={20}
              aria-hidden="true"
            />

            <div>
              <strong>Group created</strong>
              <p>
                Your group has been created
                successfully. Redirecting...
              </p>
            </div>
          </div>
        )}

        {/* ==================================================================
            FORM
            ================================================================== */}

        <form
          className="create-group-card"
          onSubmit={handleSubmit}
          noValidate
          aria-busy={loading}
        >
          {/* ================================================================
              STEP 1 — INFORMATION
              ================================================================ */}

          {step === 1 && (
            <section
              className="create-group-section"
              aria-labelledby="group-info-heading"
            >
              <div className="create-group-section-header">
                <div className="create-group-section-icon">
                  <ShieldCheck
                    size={20}
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <h2 id="group-info-heading">
                    Group Information
                  </h2>

                  <p>
                    Provide the basic details for
                    your community group.
                  </p>
                </div>
              </div>

              <div className="create-group-form-grid">
                {/* Group name */}

                <div className="create-group-field create-group-field--full">
                  <label
                    htmlFor="group-name"
                    className="create-group-label"
                  >
                    Group name
                    <span
                      className="create-group-required"
                      aria-hidden="true"
                    >
                      *
                    </span>
                  </label>

                  <input
                    id="group-name"
                    name="groupName"
                    type="text"
                    value={groupName}
                    onChange={
                      handleGroupNameChange
                    }
                    maxLength={
                      MAX_GROUP_NAME_LENGTH
                    }
                    autoComplete="organization"
                    placeholder="e.g. Katosi Savings Group"
                    className={[
                      'create-group-input',
                      groupNameError &&
                      groupName.length > 0
                        ? 'create-group-input--error'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-required="true"
                    aria-invalid={
                      Boolean(
                        groupNameError &&
                          groupName.length > 0,
                      )
                    }
                    aria-describedby="group-name-help"
                    disabled={loading}
                  />

                  <div
                    id="group-name-help"
                    className="create-group-field-meta"
                  >
                    <span>
                      Use a clear name members
                      will recognize.
                    </span>

                    <span>
                      {groupName.length}/
                      {MAX_GROUP_NAME_LENGTH}
                    </span>
                  </div>
                </div>

                {/* Group type */}

                <div className="create-group-field create-group-field--full">
                  <label
                    htmlFor="group-type"
                    className="create-group-label"
                  >
                    Group type
                    <span
                      className="create-group-required"
                      aria-hidden="true"
                    >
                      *
                    </span>
                  </label>

                  <select
                    id="group-type"
                    name="groupType"
                    value={groupType}
                    onChange={(event) =>
                      setGroupType(
                        event.target.value,
                      )
                    }
                    className="create-group-input"
                    disabled={loading}
                    aria-required="true"
                  >
                    {GROUP_TYPES.map(
                      (type) => (
                        <option
                          key={type.value}
                          value={type.value}
                        >
                          {type.label}
                        </option>
                      ),
                    )}
                  </select>

                  <p className="create-group-field-help">
                    {
                      selectedGroupType.description
                    }
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              STEP 2 — MEMBERS
              ================================================================ */}

          {step === 2 && (
            <section
              className="create-group-section"
              aria-labelledby="group-members-heading"
            >
              <div className="create-group-section-header">
                <div className="create-group-section-icon">
                  <Mail
                    size={20}
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <h2 id="group-members-heading">
                    Add Members
                  </h2>

                  <p>
                    Add members individually or
                    import them from a CSV file.
                  </p>
                </div>
              </div>

              {/* CSV */}

              <div className="create-group-import-card">
                <div className="create-group-import-icon">
                  <FileSpreadsheet
                    size={22}
                    aria-hidden="true"
                  />
                </div>

                <div className="create-group-import-content">
                  <h3>Import members from CSV</h3>

                  <p>
                    Upload a CSV containing email
                    addresses. The first column is
                    used.
                  </p>

                  <label
                    htmlFor="member-csv"
                    className="create-group-upload-button"
                  >
                    <FileSpreadsheet
                      size={16}
                      aria-hidden="true"
                    />
                    Choose CSV file
                  </label>

                  <input
                    id="member-csv"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={
                      handleCsvUpload
                    }
                    className="create-group-file-input"
                    disabled={loading}
                  />

                  {csvFileName && (
                    <p className="create-group-file-name">
                      <CheckCircle2
                        size={15}
                        aria-hidden="true"
                      />
                      {csvFileName}
                    </p>
                  )}

                  <p className="create-group-field-help">
                    Maximum file size:{' '}
                    {MAX_CSV_SIZE_BYTES /
                      1024 /
                      1024}{' '}
                    MB. Maximum{' '}
                    {MAX_CSV_ROWS.toLocaleString()}{' '}
                    rows.
                  </p>
                </div>
              </div>

              {/* CSV errors */}

              {csvErrors.length > 0 && (
                <div
                  className="create-group-alert create-group-alert--warning"
                  role="alert"
                >
                  <AlertCircle
                    size={20}
                    aria-hidden="true"
                  />

                  <div>
                    <strong>
                      CSV validation warnings
                    </strong>

                    <ul>
                      {csvErrors
                        .slice(0, 10)
                        .map(
                          (csvError) => (
                            <li
                              key={csvError}
                            >
                              {csvError}
                            </li>
                          ),
                        )}
                    </ul>

                    {csvErrors.length >
                      10 && (
                      <p>
                        +
                        {csvErrors.length -
                          10}{' '}
                        additional
                        issue
                        {csvErrors.length -
                          10 ===
                        1
                          ? ''
                          : 's'}
                        .
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Manual members */}

              <div className="create-group-members-header">
                <div>
                  <h3>Member email addresses</h3>

                  <p>
                    {memberCount.toLocaleString()}{' '}
                    valid member
                    {memberCount === 1
                      ? ''
                      : 's'}{' '}
                    added.
                  </p>
                </div>

                <button
                  type="button"
                  className="create-group-secondary-button"
                  onClick={
                    handleNormalizeMembers
                  }
                  disabled={loading}
                >
                  Normalize list
                </button>
              </div>

              <div
                className="create-group-members-list"
                aria-label="Member email addresses"
              >
                {memberEmails.map(
                  (email, index) => {
                    const normalized =
                      normalizeEmail(
                        email,
                      );

                    const invalid =
                      Boolean(
                        normalized &&
                          !isValidEmail(
                            normalized,
                          ),
                      );

                    return (
                      <div
                        className="create-group-member-row"
                        key={`member-${index}`}
                      >
                        <div className="create-group-member-number">
                          {index + 1}
                        </div>

                        <div className="create-group-member-input-wrapper">
                          <input
                            type="email"
                            value={email}
                            onChange={(
                              event,
                            ) =>
                              handleEmailChange(
                                index,
                                event
                                  .target
                                  .value,
                              )
                            }
                            placeholder={`Member ${
                              index + 1
                            } email`}
                            className={[
                              'create-group-input',
                              invalid
                                ? 'create-group-input--error'
                                : '',
                            ]
                              .filter(
                                Boolean,
                              )
                              .join(
                                ' ',
                              )}
                            autoComplete="email"
                            disabled={
                              loading
                            }
                            aria-label={`Member ${
                              index + 1
                            } email`}
                            aria-invalid={
                              invalid
                            }
                          />

                          {invalid && (
                            <span className="create-group-input-error-message">
                              Please enter a
                              valid email
                              address.
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          className="create-group-icon-button create-group-icon-button--danger"
                          onClick={() =>
                            handleRemoveEmail(
                              index,
                            )
                          }
                          disabled={
                            loading
                          }
                          aria-label={`Remove member ${
                            index + 1
                          }`}
                          title="Remove member"
                        >
                          <Trash2
                            size={17}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    );
                  },
                )}
              </div>

              <div className="create-group-member-actions">
                <button
                  type="button"
                  className="create-group-secondary-button"
                  onClick={
                    handleAddEmail
                  }
                  disabled={
                    loading ||
                    memberEmails.length >=
                      MAX_MEMBER_COUNT
                  }
                >
                  <Plus
                    size={17}
                    aria-hidden="true"
                  />
                  Add member
                </button>

                <span>
                  Maximum{' '}
                  {MAX_MEMBER_COUNT.toLocaleString()}{' '}
                  members
                </span>
              </div>
            </section>
          )}

          {/* ================================================================
              STEP 3 — REVIEW
              ================================================================ */}

          {step === 3 && (
            <section
              className="create-group-section"
              aria-labelledby="group-review-heading"
            >
              <div className="create-group-section-header">
                <div className="create-group-section-icon">
                  <CheckCircle2
                    size={20}
                    aria-hidden="true"
                  />
                </div>

                <div>
                  <h2 id="group-review-heading">
                    Review Group
                  </h2>

                  <p>
                    Review the information before
                    creating the group.
                  </p>
                </div>
              </div>

              <div className="create-group-review">
                <div className="create-group-review-item">
                  <span>Group name</span>
                  <strong>
                    {groupName.trim() ||
                      'Not provided'}
                  </strong>
                </div>

                <div className="create-group-review-item">
                  <span>Group type</span>
                  <strong>
                    {selectedGroupType.label}
                  </strong>
                </div>

                <div className="create-group-review-item">
                  <span>Members</span>
                  <strong>
                    {memberCount.toLocaleString()}
                  </strong>
                </div>
              </div>

              <div className="create-group-review-members">
                <div className="create-group-review-members-header">
                  <h3>Members</h3>

                  <span>
                    {memberCount.toLocaleString()}
                  </span>
                </div>

                <div
                  className="create-group-review-members-list"
                  role="list"
                  aria-label="Group members"
                >
                  {validMembers.map(
                    (email) => (
                      <div
                        key={email}
                        role="listitem"
                        className="create-group-review-member"
                      >
                        <div className="create-group-review-avatar">
                          {email
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <span>
                          {email}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>

              <div className="create-group-security-note">
                <ShieldCheck
                  size={20}
                  aria-hidden="true"
                />

                <div>
                  <strong>
                    Secure group creation
                  </strong>

                  <p>
                    TITech Community Capital
                    will validate the group and
                    member information on the
                    server before creating the
                    group.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ================================================================
              STEP 4 — CREATE / SUCCESS
              ================================================================ */}

          {step === 4 && (
            <section
              className="create-group-success"
              aria-labelledby="group-creation-status"
            >
              {loading ? (
                <>
                  <div className="create-group-success-icon create-group-success-icon--loading">
                    <Loader2
                      size={36}
                      className="create-group-spinner"
                      aria-hidden="true"
                    />
                  </div>

                  <h2 id="group-creation-status">
                    Creating your group
                  </h2>

                  <p>
                    Please wait while TITech
                    Community Capital securely
                    creates your group.
                  </p>

                  <div
                    className="create-group-status-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={100}
                    aria-label="Group creation in progress"
                  >
                    <div className="create-group-status-bar-indeterminate" />
                  </div>

                  <span
                    className="create-group-status-message"
                    role="status"
                    aria-live="polite"
                  >
                    {statusMessage}
                  </span>
                </>
              ) : (
                <>
                  <div className="create-group-success-icon">
                    <Check
                      size={36}
                      aria-hidden="true"
                    />
                  </div>

                  <h2 id="group-creation-status">
                    Group created successfully
                  </h2>

                  <p>
                    Your TITech Community
                    Capital group is ready.
                  </p>
                </>
              )}
            </section>
          )}

          {/* ================================================================
              ACTIONS
              ================================================================ */}

          <footer className="create-group-actions">
            <div className="create-group-actions-left">
              {step > 1 && step < 4 && (
                <button
                  type="button"
                  className="create-group-secondary-button"
                  onClick={handleBack}
                  disabled={loading}
                >
                  <ArrowLeft
                    size={17}
                    aria-hidden="true"
                  />
                  Back
                </button>
              )}
            </div>

            <div className="create-group-actions-right">
              {step < 4 && (
                <button
                  type="button"
                  className="create-group-ghost-button"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  Cancel
                </button>
              )}

              {step === 1 && (
                <button
                  type="button"
                  className="create-group-primary-button"
                  onClick={handleNext}
                  disabled={loading}
                >
                  Continue
                  <ArrowRight
                    size={17}
                    aria-hidden="true"
                  />
                </button>
              )}

              {step === 2 && (
                <button
                  type="button"
                  className="create-group-primary-button"
                  onClick={handleNext}
                  disabled={
                    loading ||
                    memberCount === 0
                  }
                >
                  Review
                  <ArrowRight
                    size={17}
                    aria-hidden="true"
                  />
                </button>
              )}

              {step === 3 && (
                <button
                  type="submit"
                  className="create-group-primary-button"
                  disabled={
                    loading ||
                    memberCount === 0 ||
                    Boolean(groupNameError)
                  }
                >
                  <ShieldCheck
                    size={17}
                    aria-hidden="true"
                  />
                  Create Group
                </button>
              )}
            </div>
          </footer>
        </form>

        {/* ==================================================================
            FOOTER SECURITY NOTICE
            ================================================================== */}

        <div className="create-group-footer-note">
          <ShieldCheck
            size={15}
            aria-hidden="true"
          />

          <span>
            Group creation is protected by TITech
            Community Capital access controls and
            server-side validation.
          </span>
        </div>
      </div>
    </main>
  );
}