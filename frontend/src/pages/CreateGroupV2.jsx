// ============================================================================
// TITech Community Capital – Create Group V2
// File: frontend/src/pages/CreateGroupV2.jsx
// Enterprise production-grade group creation workflow
//
// Features:
// - Role-aware group creation
// - Multi-step workflow
// - CSV member import
// - Defensive CSV validation
// - Duplicate detection
// - Member role assignment
// - Preview before submission
// - Abortable network requests
// - Request correlation and duplicate-name conflict handling
// - Single aggregate persistence for the group and pending invitations
// - Idempotent retry using a stable request key
// - Accessible progress reporting
// - Defensive API response normalization
// - Safe unmount handling
// - TITech Community Capital terminology
// ============================================================================

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  FileText,
  Loader2,
  Send,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { hasTitechRole, TITECH_ROLES } from '../security/rbacPolicy';

import './CreateGroupV2.css';

// ============================================================================
// Constants
// ============================================================================

const MAX_GROUP_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_MEMBERS = 499; // The canonical Group aggregate also contains the creator.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const GROUP_TYPES = [
  { value: 'savings', label: 'Savings Group', description: 'Community savings classification; does not authorize regulated deposit-taking.' },
  { value: 'vsla', label: 'VSLA', description: 'Village savings and loan association classification; lending remains disabled unless separately authorized.' },
  { value: 'sacco', label: 'SACCO', description: 'SACCO group classification only; it does not establish licensing or regulated financial authority.' },
  { value: 'chama', label: 'Chama', description: 'Member-organized savings or investment group classification.' },
  { value: 'rosca', label: 'ROSCA', description: 'Rotating savings and credit association classification; payout rotation requires a separately verified operating workflow.' },
  { value: 'cooperative', label: 'Cooperative', description: 'Cooperative group classification; registration and regulated capabilities are assessed separately.' },
  { value: 'farmer_group', label: 'Farmer Group', description: 'Agricultural producer community classification.' },
  { value: 'producer_organization', label: 'Producer Organization', description: 'Producer organization classification; services remain subject to approved capabilities.' },
  { value: 'investment', label: 'Investment Group', description: 'Community investment group classification; investment activity remains approval-gated.' },
  { value: 'community', label: 'Community Support', description: 'General community support and welfare classification.' },
  { value: 'welfare', label: 'Welfare Group', description: 'Member welfare and mutual support classification.' },
  { value: 'mixed_community_group', label: 'Mixed Community Group', description: 'Multi-purpose community group classification.' },
];

const MEMBER_ROLES = [
  {
    value: 'member',
    label: 'Member',
    description: 'Regular group member',
  },
  {
    value: 'treasurer',
    label: 'Treasurer',
    description: 'Financial management',
  },
  {
    value: 'secretary',
    label: 'Secretary',
    description: 'Record keeping',
  },
];

// ============================================================================
// Utility helpers
// ============================================================================

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

// Row identity must not depend on the row's current array position or email
// value. Stable IDs keep React's DOM node (and keyboard focus) attached to the
// same member row while the controlled email value changes or rows are removed.
let memberRowSequence = 0;

function createMemberRowId() {
  try {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return `member-${cryptoApi.randomUUID()}`;
    }
  } catch (_) {
    // Older browsers may not expose randomUUID; use a UI-only fallback below.
  }

  memberRowSequence += 1;
  return `member-${Date.now().toString(36)}-${memberRowSequence.toString(36)}`;
}

const getErrorMessage = (error, fallback = 'An unexpected error occurred.') => {
  if (!error) return fallback;

  const serverCode = error?.response?.data?.code;
  if (serverCode === 'GROUP_INVITE_MEMBER_UNAVAILABLE') {
    return 'One or more addresses do not match active user accounts in this institution. Complete the person’s institution onboarding first. This group workflow records an in-app invitation; it does not send an external email.';
  }

  const serverMessage =
    error?.response?.data?.message || error?.response?.data?.error;
  if (serverMessage) return serverMessage;

  if (
    error?.code === 'ERR_NETWORK' ||
    error?.message === 'Network Error' ||
    (!error?.response && Boolean(error?.request))
  ) {
    return 'TITech could not confirm the server response. Check your connection. Retrying the unchanged request uses the same idempotency key so an already-created group can be recovered without duplication.';
  }

  if (
    error?.code === 'ECONNABORTED' ||
    error?.code === 'ETIMEDOUT' ||
    error?.name === 'TimeoutError'
  ) {
    return 'The group request timed out and its result is not yet confirmed. Retrying the unchanged request uses the same idempotency key to recover the authoritative result safely.';
  }

  return error?.message || fallback;
};

const getApiData = (response) => {
  if (!response) return null;

  if (Object.prototype.hasOwnProperty.call(response, 'data')) {
    return response.data;
  }

  return response;
};

const getGroupId = (response) => {
  const data = getApiData(response);

  return (
    data?.groupId ||
    data?.group?._id ||
    data?.group?.id ||
    data?._id ||
    data?.id ||
    null
  );
};

const isAbortError = (error) =>
  error?.name === 'AbortError' ||
  error?.code === 'ERR_CANCELED' ||
  /cancell?ed|aborted/i.test(String(error?.message || ''));

const createClientRequestId = () => {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch (_) {
    // Fall through to timestamp/random fallback.
  }

  return `titech-group-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current.trim());

  return values;
};

// ============================================================================
// Component
// ============================================================================

export default function CreateGroupV2() {
  const { user, tenantId } = useAuth();
  const navigate = useNavigate();

  // --------------------------------------------------------------------------
  // Lifecycle / request management
  // --------------------------------------------------------------------------

  const mountedRef = useRef(false);
  const submitAbortRef = useRef(null);
  const idempotencyKeyRef = useRef(createClientRequestId());

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (submitAbortRef.current) {
        try {
          submitAbortRef.current.abort();
        } catch (_) {
          // Ignore abort cleanup failures.
        }
      }

    };
  }, []);

  // --------------------------------------------------------------------------
  // RBAC
  // --------------------------------------------------------------------------

  const canCreateGroup = hasTitechRole(
    [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])],
    [TITECH_ROLES.PLATFORM_ADMIN, TITECH_ROLES.TENANT_ADMIN],
  );


  // --------------------------------------------------------------------------
  // Form state
  // --------------------------------------------------------------------------

  const [step, setStep] = useState(1);

  const [groupName, setGroupName] = useState('');
  const [groupType, setGroupType] = useState('savings');
  const [description, setDescription] = useState('');

  const [memberEmails, setMemberEmails] = useState(['']);
  const [memberRoles, setMemberRoles] = useState(['member']);
  const [memberRowIds, setMemberRowIds] = useState(() => [createMemberRowId()]);

  // --------------------------------------------------------------------------
  // CSV state
  // --------------------------------------------------------------------------

  const [csvFileName, setCsvFileName] = useState('');
  const [csvErrors, setCsvErrors] = useState([]);

  // --------------------------------------------------------------------------
  // UI / workflow state
  // --------------------------------------------------------------------------

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    message: '',
    successCount: 0,
  });

  const [createdGroupId, setCreatedGroupId] = useState(null);
  const [creationComplete, setCreationComplete] = useState(false);

  // ==========================================================================
  // Validation
  // ==========================================================================

  const validateEmail = useCallback((email) => {
    const normalized = normalizeEmail(email);

    return Boolean(normalized) && EMAIL_REGEX.test(normalized);
  }, []);

  const validateGroupDetails = useCallback(() => {
    const name = groupName.trim();
    const descriptionValue = description.trim();

    if (!name) {
      return 'Group name is required.';
    }

    if (name.length < 3) {
      return 'Group name must be at least 3 characters.';
    }

    if (name.length > MAX_GROUP_NAME_LENGTH) {
      return `Group name cannot exceed ${MAX_GROUP_NAME_LENGTH} characters.`;
    }

    if (!GROUP_TYPES.some((type) => type.value === groupType)) {
      return 'Please select a valid group type.';
    }

    if (!descriptionValue) {
      return 'Group description is required.';
    }

    if (descriptionValue.length > MAX_DESCRIPTION_LENGTH) {
      return `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`;
    }

    return null;
  }, [groupName, groupType, description]);

  const validMembers = useMemo(() => {
    const seen = new Set();

    return memberEmails.reduce((members, email, index) => {
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail || !validateEmail(normalizedEmail)) {
        return members;
      }

      if (seen.has(normalizedEmail)) {
        return members;
      }

      seen.add(normalizedEmail);

      const role = memberRoles[index];
      if (!MEMBER_ROLES.some((candidate) => candidate.value === role)) {
        return members;
      }

      members.push({
        email: normalizedEmail,
        role,
        sourceIndex: index,
      });

      return members;
    }, []);
  }, [memberEmails, memberRoles, validateEmail]);

  const invalidMembers = useMemo(
    () =>
      memberEmails.reduce((invalid, email, index) => {
        const normalized = normalizeEmail(email);

        if (normalized && !validateEmail(normalized)) {
          invalid.push({
            email,
            index,
          });
        }

        return invalid;
      }, []),
    [memberEmails, validateEmail]
  );

  const invalidRoles = useMemo(
    () => memberEmails.reduce((invalid, email, index) => {
      if (!normalizeEmail(email)) return invalid;
      if (!MEMBER_ROLES.some((candidate) => candidate.value === memberRoles[index])) {
        invalid.push({ email, index });
      }
      return invalid;
    }, []),
    [memberEmails, memberRoles]
  );

  const invitesCreator = useMemo(() => {
    const ownEmail = normalizeEmail(user?.email);
    return Boolean(ownEmail) && memberEmails.some((email) => normalizeEmail(email) === ownEmail);
  }, [memberEmails, user?.email]);

  const duplicateEmails = useMemo(() => {
    const counts = new Map();

    memberEmails.forEach((email) => {
      const normalized = normalizeEmail(email);

      if (!normalized) return;

      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    });

    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([email]) => email);
  }, [memberEmails]);

  const selectedGroupType = useMemo(
    () => GROUP_TYPES.find((type) => type.value === groupType),
    [groupType]
  );

  // ==========================================================================
  // CSV parsing
  // ==========================================================================

  const parseCSV = useCallback(
    (file) =>
      new Promise((resolve, reject) => {
        if (!file) {
          reject(['No CSV file was selected.']);
          return;
        }

        if (file.size > MAX_CSV_SIZE_BYTES) {
          reject([
            `CSV file is too large. Maximum allowed size is ${
              MAX_CSV_SIZE_BYTES / 1024 / 1024
            } MB.`,
          ]);
          return;
        }

        const fileName = String(file.name || '').toLowerCase();

        if (
          !fileName.endsWith('.csv') &&
          !fileName.endsWith('.txt') &&
          file.type !== 'text/csv'
        ) {
          reject(['Please upload a CSV or plain-text file.']);
          return;
        }

        const reader = new FileReader();

        reader.onerror = () => {
          reject(['Failed to read the CSV file.']);
        };

        reader.onload = (event) => {
          try {
            const text = String(event.target?.result || '')
              .replace(/^\uFEFF/, '')
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n');

            const lines = text
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);

            if (lines.length === 0) {
              reject(['CSV file is empty.']);
              return;
            }

            const members = [];
            const errors = [];
            const seen = new Set();

            lines.forEach((line, index) => {
              const rowNumber = index + 1;
              const columns = parseCsvLine(line);

              const rawEmail = columns[0];
              const rawRole = columns[1];

              const email = normalizeEmail(rawEmail);

              // Support optional header.
              if (
                index === 0 &&
                String(rawEmail || '')
                  .trim()
                  .toLowerCase() === 'email'
              ) {
                return;
              }

              if (!email) {
                errors.push(`Row ${rowNumber}: Email address is required.`);
                return;
              }

              if (!validateEmail(email)) {
                errors.push(
                  `Row ${rowNumber}: Invalid email address "${email}".`
                );
                return;
              }

              if (seen.has(email)) {
                errors.push(
                  `Row ${rowNumber}: Duplicate email address "${email}".`
                );
                return;
              }

              const role = String(rawRole || 'member')
                .trim()
                .toLowerCase();

              if (
                !MEMBER_ROLES.some(
                  (candidate) => candidate.value === role
                )
              ) {
                errors.push(
                  `Row ${rowNumber}: Invalid role "${role}". Valid roles: ${MEMBER_ROLES.map(
                    (candidate) => candidate.value
                  ).join(', ')}.`
                );
                return;
              }

              seen.add(email);

              members.push({
                email,
                role,
              });
            });

            if (members.length > MAX_MEMBERS) {
              errors.push(
                `CSV contains too many members. Maximum allowed is ${MAX_MEMBERS}.`
              );
            }

            if (errors.length > 0) {
              reject(errors);
              return;
            }

            if (members.length === 0) {
              reject(['No valid members were found in the CSV file.']);
              return;
            }

            resolve(members);
          } catch (parseError) {
            reject([
              getErrorMessage(
                parseError,
                'Failed to parse the CSV file.'
              ),
            ]);
          }
        };

        reader.readAsText(file, 'utf-8');
      }),
    [validateEmail]
  );

  // ==========================================================================
  // CSV upload
  // ==========================================================================

  const handleCsvUpload = useCallback(
    async (event) => {
      const file = event?.target?.files?.[0];

      setCsvErrors([]);
      setError('');

      if (!file) return;

      try {
        const members = await parseCSV(file);

        if (!mountedRef.current) return;

        setMemberEmails(members.map((member) => member.email));
        setMemberRoles(members.map((member) => member.role));
        setMemberRowIds(members.map(() => createMemberRowId()));
        setCsvFileName(file.name);

        toast.success(
          `Loaded ${members.length} member${
            members.length === 1 ? '' : 's'
          } from CSV.`
        );
      } catch (csvError) {
        if (!mountedRef.current) return;

        const errors = Array.isArray(csvError)
          ? csvError
          : [getErrorMessage(csvError, 'CSV validation failed.')];

        setCsvErrors(errors);
        setCsvFileName('');

        toast.error('CSV validation failed.');
      } finally {
        // Allow selecting the same file again.
        if (event?.target) {
          event.target.value = '';
        }
      }
    },
    [parseCSV]
  );

  // ==========================================================================
  // Member management
  // ==========================================================================

  const handleAddMember = useCallback(() => {
    setError('');

    if (memberEmails.length >= MAX_MEMBERS) {
      toast.warning(`A maximum of ${MAX_MEMBERS} members is allowed.`);
      return;
    }

    setMemberEmails((previous) => [...previous, '']);
    setMemberRoles((previous) => [...previous, 'member']);
    setMemberRowIds((previous) => [...previous, createMemberRowId()]);
  }, [memberEmails.length]);

  const handleEmailChange = useCallback((rowId, value) => {
    const rowIndex = memberRowIds.indexOf(rowId);
    if (rowIndex < 0) return;

    setMemberEmails((previous) =>
      previous.map((email, currentIndex) =>
        currentIndex === rowIndex ? value : email
      )
    );
  }, [memberRowIds]);

  const handleRoleChange = useCallback((rowId, value) => {
    const rowIndex = memberRowIds.indexOf(rowId);
    if (rowIndex < 0) return;

    setMemberRoles((previous) =>
      previous.map((role, currentIndex) =>
        currentIndex === rowIndex ? value : role
      )
    );
  }, [memberRowIds]);

  const handleRemoveMember = useCallback((rowId) => {
    const rowIndex = memberRowIds.indexOf(rowId);
    if (rowIndex < 0) return;

    setMemberEmails((previous) =>
      previous.length <= 1
        ? ['']
        : previous.filter((_, currentIndex) => currentIndex !== rowIndex)
    );

    setMemberRoles((previous) =>
      previous.length <= 1
        ? ['member']
        : previous.filter((_, currentIndex) => currentIndex !== rowIndex)
    );

    setMemberRowIds((previous) =>
      previous.length <= 1
        ? [createMemberRowId()]
        : previous.filter((currentRowId) => currentRowId !== rowId)
    );

    setError('');
  }, [memberRowIds]);

  const normalizeMemberList = useCallback(() => {
    const seen = new Set();
    const emails = [];
    const roles = [];
    const rowIds = [];

    memberEmails.forEach((email, index) => {
      const normalized = normalizeEmail(email);

      if (!normalized || !validateEmail(normalized)) {
        return;
      }

      if (seen.has(normalized)) {
        return;
      }

      seen.add(normalized);

      emails.push(normalized);
      roles.push(memberRoles[index]);
      rowIds.push(memberRowIds[index] || createMemberRowId());
    });

    setMemberEmails(emails.length ? emails : ['']);
    setMemberRoles(roles.length ? roles : ['member']);
    setMemberRowIds(rowIds.length ? rowIds : [createMemberRowId()]);

    setError('');

    toast.info(
      emails.length
        ? `Normalized ${emails.length} valid member${
            emails.length === 1 ? '' : 's'
          }.`
        : 'No valid members found.'
    );
  }, [memberEmails, memberRoles, memberRowIds, validateEmail]);

  // ==========================================================================
  // Navigation
  // ==========================================================================

  const validateCurrentStep = useCallback(() => {
    setError('');

    if (step === 1) {
      const detailsError = validateGroupDetails();

      if (detailsError) {
        setError(detailsError);
        return false;
      }
    }

    if (step === 2) {
      // Invitations are optional. The backend creates the group and adds the
      // authenticated creator as group_admin in the same aggregate save.
      if (invalidMembers.length > 0) {
        setError(
          `Please correct ${
            invalidMembers.length
          } invalid email address${
            invalidMembers.length === 1 ? '' : 'es'
          }.`
        );
        return false;
      }

      if (invalidRoles.length > 0) {
        setError('Select a supported group role for every proposed member.');
        return false;
      }

      if (invitesCreator) {
        setError('You are already added as the group creator and cannot invite your own account.');
        return false;
      }

      if (duplicateEmails.length > 0) {
        setError(
          `Duplicate email addresses found: ${duplicateEmails.join(', ')}`
        );
        return false;
      }

      if (validMembers.length > MAX_MEMBERS) {
        setError(`A maximum of ${MAX_MEMBERS} members is allowed.`);
        return false;
      }
    }

    return true;
  }, [
    step,
    validateGroupDetails,
    validMembers,
    invalidMembers,
    invalidRoles,
    invitesCreator,
    duplicateEmails,
  ]);

  const handleNext = useCallback(() => {
    if (!validateCurrentStep()) return;

    setStep((currentStep) => Math.min(4, currentStep + 1));
  }, [validateCurrentStep]);

  const handleBack = useCallback(() => {
    setError('');

    setStep((currentStep) => Math.max(1, currentStep - 1));
  }, []);

  // ==========================================================================
  // Canonical atomic group-creation request
  // ==========================================================================

  const createGroup = useCallback(
    async (signal) => {
      const payload = {
        name: groupName.trim(),
        type: groupType,
        description: description.trim(),
        members: validMembers.map(({ email, role }) => ({ email, role })),
      };

      return api.post('/groups', payload, {
        signal,
        headers: {
          'Idempotency-Key': idempotencyKeyRef.current,
          'X-Request-ID': idempotencyKeyRef.current,
        },
      });
    },
    [groupName, groupType, description, validMembers]
  );

  // ==========================================================================
  // Group creation (only from the fourth, explicit confirmation step)
  // ==========================================================================

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();
      if (loading || creationComplete) return;
      setError('');

      if (step !== 4) {
        setError('Review the group preview and proceed to Confirmation before creating the group.');
        return;
      }

      const detailsError = validateGroupDetails();
      if (detailsError) {
        setStep(1);
        setError(detailsError);
        return;
      }

      if (!validateCurrentStep()) {
        setStep(2);
        return;
      }

      if (!tenantId) {
        toast.error('Join an existing tenant before creating a group.');
        return;
      }
      if (!canCreateGroup) {
        toast.error('You are not authorized to create groups.');
        return;
      }
      if (!user) {
        toast.error('Your authenticated session could not be verified.');
        return;
      }

      const controller = new AbortController();
      submitAbortRef.current = controller;
      setLoading(true);
      setProgress({ current: 0, total: 1, message: 'Submitting the confirmed group and pending in-app invitations…', successCount: 0 });

      try {
        const response = await createGroup(controller.signal);
        if (controller.signal.aborted) {
          throw new DOMException('Request aborted.', 'AbortError');
        }
        const groupId = getGroupId(response);
        if (!groupId) {
          throw new Error('The server did not return a persisted group identifier.');
        }
        if (!mountedRef.current) return;

        const data = getApiData(response);
        const invitationSummary = data?.invitationSummary || data?.data?.invitationSummary || {};
        const pendingCount = Number(invitationSummary.pending ?? data?.invitedCount ?? 0);
        const requestedCount = Number(invitationSummary.requested ?? pendingCount);

        setCreatedGroupId(groupId);
        setCreationComplete(true);
        setProgress({
          current: 1,
          total: 1,
          message: 'The group record and its pending in-app invitations were persisted successfully.',
                successCount: pendingCount,
          requestedCount,
          acceptedCount: Number(invitationSummary.accepted ?? 0),
          externalNotificationsSent: Number(invitationSummary.externalNotificationsSent ?? 0),
        });
        toast.success(`TITech Community Capital group “${groupName.trim()}” created successfully.`);
      } catch (submitError) {
        if (!mountedRef.current) return;
        if (isAbortError(submitError)) {
          const message = 'The browser stopped waiting for this request. The server may still have completed it. Check Group Management first; retrying the same details uses the same idempotency key.';
          setError(message);
          setProgress((previous) => ({ ...previous, message }));
          toast.info('The request outcome is not yet confirmed.');
          return;
        }
        const message = getErrorMessage(submitError, 'Failed to create the group.');
        setError(message);
        setProgress({ current: 0, total: 0, message: '', successCount: 0 });
        toast.error(message);
      } finally {
        if (mountedRef.current) setLoading(false);
        if (submitAbortRef.current === controller) submitAbortRef.current = null;
      }
    },
    [loading, creationComplete, step, validateGroupDetails, validateCurrentStep, tenantId, canCreateGroup, user, createGroup, groupName]
  );

  // ==========================================================================
  // Cancel active submission
  // ==========================================================================

  const handleCancelRequest = useCallback(() => {
    if (!submitAbortRef.current) return;

    try {
      submitAbortRef.current.abort();
    } catch (_) {
      // Ignore cancellation failure.
    }
  }, []);

  // ==========================================================================
  // Step rendering
  // ==========================================================================

  const renderStep1 = () => (
    <section className="step-container" aria-labelledby="group-info-heading">
      <div className="step-header">
        <div className="step-icon" aria-hidden="true">
          <FileText size={20} />
        </div>

        <div>
          <h2 id="group-info-heading">Group Information</h2>
          <p>Create a new TITech Community Capital group.</p>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="groupName" className="form-label">
          Group Name <span className="required">*</span>
        </label>

        <input
          id="groupName"
          name="groupName"
          type="text"
          value={groupName}
          onChange={(event) => {
            setGroupName(event.target.value);
            setError('');
          }}
          placeholder="e.g. Women's Savings Circle"
          maxLength={MAX_GROUP_NAME_LENGTH}
          autoComplete="organization"
          className="input-field"
          aria-required="true"
          aria-describedby="group-name-help"
          disabled={loading}
        />

        <small id="group-name-help" className="form-help">
          {groupName.length}/{MAX_GROUP_NAME_LENGTH} characters.
        </small>
      </div>

      <div className="form-group">
        <label htmlFor="groupType" className="form-label">
          Group Type <span className="required">*</span>
        </label>

        <select
          id="groupType"
          name="groupType"
          value={groupType}
          onChange={(event) => {
            setGroupType(event.target.value);
            setError('');
          }}
          className="input-field"
          disabled={loading}
        >
          {GROUP_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>

        {selectedGroupType && (
          <small className="form-help">
            {selectedGroupType.description}
          </small>
        )}
        <p className="form-help group-type-authorization-note" role="note">
          Selecting a group type records its organizational classification only. It does not verify legal registration or enable deposits, lending, payment services, insurance or other regulated activities.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="description" className="form-label">
          Description <span className="required">*</span>
        </label>

        <textarea
          id="description"
          name="description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setError('');
          }}
          placeholder="Describe the group's goals and objectives..."
          maxLength={MAX_DESCRIPTION_LENGTH}
          rows={4}
          className="input-field"
          aria-describedby="description-help"
          disabled={loading}
        />

        <small id="description-help" className="form-help">
          {description.length}/{MAX_DESCRIPTION_LENGTH} characters.
        </small>
      </div>
    </section>
  );

  const renderStep2 = () => (
    <section className="step-container" aria-labelledby="members-heading">
      <div className="step-header">
        <div className="step-icon" aria-hidden="true">
          <Users size={20} />
        </div>

        <div>
          <h2 id="members-heading">Add Members</h2>
          <p>Invite members and assign their group roles.</p>
        </div>
      </div>

      <div className="form-group csv-upload-section">
        <label htmlFor="csvFile" className="form-label">
          <Upload size={16} aria-hidden="true" />
          Upload CSV
          <span className="optional">(Optional)</span>
        </label>

        <input
          id="csvFile"
          name="csvFile"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={handleCsvUpload}
          className="input-field file-input"
          disabled={loading}
          aria-describedby="csv-help"
        />

        <small id="csv-help" className="form-help">
          Format: <strong>email,role</strong>. Example:
          john@example.com,treasurer. Maximum file size:{' '}
          {MAX_CSV_SIZE_BYTES / 1024 / 1024} MB.
        </small>

        {csvFileName && (
          <div className="success-box" role="status">
            <CheckCircle size={16} aria-hidden="true" />
            <span>
              Loaded from: <strong>{csvFileName}</strong>
            </span>
          </div>
        )}

        {csvErrors.length > 0 && (
          <div className="error-box" role="alert">
            <AlertCircle size={16} aria-hidden="true" />

            <div>
              <strong>CSV validation errors:</strong>

              <ul className="error-list">
                {csvErrors.slice(0, 10).map((csvError, index) => (
                  <li key={`${csvError}-${index}`}>
                    {csvError}
                  </li>
                ))}

                {csvErrors.length > 10 && (
                  <li>
                    ...and {csvErrors.length - 10} more error
                    {csvErrors.length - 10 === 1 ? '' : 's'}.
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="divider" aria-hidden="true">
        OR
      </div>

      <div className="form-group">
        <div className="form-label-row">
          <label className="form-label" htmlFor={`member-email-${memberRowIds[0]}`}>
            Manual Entry
          </label>

          <span className="member-limit">
            {validMembers.length}/{MAX_MEMBERS}
          </span>
        </div>

        <div className="members-list">
          {memberEmails.map((email, index) => {
            const rowId = memberRowIds[index];
            const inputId = `member-email-${rowId}`;
            const roleId = `member-role-${rowId}`;
            const isInvalid =
              Boolean(normalizeEmail(email)) &&
              !validateEmail(email);

            return (
              <div
                key={rowId}
                className="member-entry"
                data-member-row-id={rowId}
              >
                <div className="member-email-wrapper">
                  <label
                    htmlFor={inputId}
                    className="sr-only"
                  >
                    Member {index + 1} email address
                  </label>

                  <input
                    id={inputId}
                    name={`member-email-${rowId}`}
                    type="email"
                    placeholder="Existing institution member email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(event) =>
                      handleEmailChange(
                        rowId,
                        event.currentTarget.value
                      )
                    }
                    className={`input-field email-input ${
                      isInvalid ? 'input-error' : ''
                    }`}
                    autoComplete="email"
                    aria-invalid={isInvalid}
                    disabled={loading}
                  />
                </div>

                <label
                  htmlFor={roleId}
                  className="sr-only"
                >
                  Role for member {index + 1}
                </label>

                <select
                  id={roleId}
                  name={roleId}
                  value={memberRoles[index] || 'member'}
                  onChange={(event) =>
                    handleRoleChange(
                      rowId,
                      event.currentTarget.value
                    )
                  }
                  className="input-field role-select"
                  disabled={loading}
                >
                  {MEMBER_ROLES.map((role) => (
                    <option
                      key={role.value}
                      value={role.value}
                    >
                      {role.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() =>
                    handleRemoveMember(rowId)
                  }
                  className="btn-remove"
                  aria-label={`Remove member ${index + 1}`}
                  title="Remove member"
                  disabled={
                    loading ||
                    memberEmails.length <= 1
                  }
                >
                  <Trash2
                    size={16}
                    aria-hidden="true"
                  />
                </button>
              </div>
            );
          })}
        </div>

        <p className="form-help">
          Enter an email address for an active TITech account in this same institution. This creates a pending in-app group invitation; it does not create a user account or send an external email.
        </p>

        {invalidMembers.length > 0 && (
          <div className="form-help error-text" role="alert">
            {invalidMembers.length} invalid email
            {invalidMembers.length === 1 ? '' : 's'} need
            attention.
          </div>
        )}

        {invalidRoles.length > 0 && (
          <div className="form-help error-text" role="alert">
            {invalidRoles.length} proposed member role{invalidRoles.length === 1 ? '' : 's'} need attention.
          </div>
        )}

        {duplicateEmails.length > 0 && (
          <div className="form-help error-text" role="alert">
            Duplicate email
            {duplicateEmails.length === 1 ? '' : 's'}:{' '}
            {duplicateEmails.join(', ')}
          </div>
        )}

        <div className="member-actions">
          <button
            type="button"
            onClick={handleAddMember}
            className="btn-add-member"
            disabled={
              loading ||
              memberEmails.length >= MAX_MEMBERS
            }
          >
            + Add Member
          </button>

          <button
            type="button"
            onClick={normalizeMemberList}
            className="btn-secondary"
            disabled={loading}
          >
            Normalize List
          </button>
        </div>
      </div>

      {validMembers.length > 0 && (
        <div className="valid-count" role="status">
          <CheckCircle size={16} aria-hidden="true" />
          <span>
            {validMembers.length} valid member
            {validMembers.length === 1 ? '' : 's'} ready.
          </span>
        </div>
      )}
    </section>
  );

  const renderStep3 = () => (
    <section className="step-container" aria-labelledby="preview-heading">
      <div className="step-header">
        <div className="step-icon" aria-hidden="true">
          <Eye size={20} />
        </div>

        <div>
          <h2 id="preview-heading">Preview</h2>
          <p>Check the complete group and proposed invitation details before confirmation.</p>
        </div>
      </div>

      <div className="preview-section">
        <h3>Group Details</h3>

        <div className="preview-grid">
          <div className="preview-item">
            <span className="preview-label">
              Group Name
            </span>

            <span className="preview-value">
              {groupName.trim()}
            </span>
          </div>

          <div className="preview-item">
            <span className="preview-label">
              Group Type
            </span>

            <span className="preview-value">
              {selectedGroupType?.label || groupType}
            </span>
          </div>

          {description.trim() && (
            <div className="preview-item full-width">
              <span className="preview-label">
                Description
              </span>

              <span className="preview-value">
                {description.trim()}
              </span>
            </div>
          )}

          <div className="preview-item">
            <span className="preview-label">Active tenant (resolved by the server)</span>
            <span className="preview-value">{user?.tenantName || user?.tenant?.name || tenantId}</span>
          </div>

          <div className="preview-item">
            <span className="preview-label">Proposed invitations</span>
            <span className="preview-value badge">{validMembers.length}</span>
          </div>
        </div>
      </div>

      <div className="members-preview">
        <div className="members-preview-header">
          <h3>
            Proposed Group Invitations ({validMembers.length})
          </h3>
        </div>

        <div className="members-grid">
          {validMembers.map((member) => {
            const roleInfo = MEMBER_ROLES.find(
              (role) => role.value === member.role
            );

            return (
              <article
                key={member.email}
                className="member-card"
              >
                <div className="member-email">
                  {member.email}
                </div>

                <div className="member-role-badge" title={roleInfo?.description}>
                  {roleInfo?.label || 'Member'}
                </div>
                <small className="form-help">Pending invitation · acceptance required</small>
              </article>
            );
          })}
        </div>
      </div>

      <div className="role-distribution">
        <h4>Role Distribution</h4>

        {MEMBER_ROLES.map((role) => {
          const count = validMembers.filter(
            (member) => member.role === role.value
          ).length;

          return (
            <div
              key={role.value}
              className="role-stat"
            >
              <span>{role.label}</span>
              <strong>{count}</strong>
            </div>
          );
        })}
      </div>

      <div className="role-stat">
        <span>Total proposed invitations</span>
        <strong>{validMembers.length}</strong>
      </div>

      <div className="info-box" role="note">
        <AlertCircle size={16} aria-hidden="true" />
        <span>These are pending in-app group invitations for existing active members of this tenant. An invitation is not an accepted membership, does not create a user account, and does not send an external email or SMS.</span>
      </div>
    </section>
  );

  const renderConfirmation = () => (
    <section className="step-container" aria-labelledby="confirmation-heading">
      <div className="step-header">
        <div className="step-icon" aria-hidden="true"><CheckCircle size={20} /></div>
        <div>
          <h2 id="confirmation-heading">Confirmation</h2>
          <p>Confirm that this group and its pending in-app invitations should be created in the active tenant.</p>
        </div>
      </div>
      <div className="preview-section">
        <h3>Final confirmation</h3>
        <div className="preview-grid">
          <div className="preview-item"><span className="preview-label">Group</span><span className="preview-value">{groupName.trim()}</span></div>
          <div className="preview-item"><span className="preview-label">Tenant</span><span className="preview-value">{user?.tenantName || user?.tenant?.name || tenantId}</span></div>
          <div className="preview-item"><span className="preview-label">Proposed invitations</span><span className="preview-value">{validMembers.length}</span></div>
          <div className="preview-item"><span className="preview-label">Accepted memberships</span><span className="preview-value">0 at creation</span></div>
        </div>
      </div>
      <div className="info-box" role="note"><AlertCircle size={16} aria-hidden="true" /><span>Selecting Create Group persists the canonical group and its pending invitations together. Invitees become members only after they authenticate as the intended account and accept. This workflow does not send external email or SMS notifications.</span></div>
      {createdGroupId ? <p className="form-help">Persisted group reference: {createdGroupId}</p> : null}
    </section>
  );

  const renderStep4 = () => {
    const percentage = progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

    return (
      <section className="step-container" aria-labelledby="completion-heading">
        <div className="step-header">
          <div className="step-icon" aria-hidden="true"><CheckCircle size={20} /></div>
          <div>
            <h2 id="completion-heading">Group Creation Complete</h2>
            <p>{progress.message}</p>
          </div>
        </div>

        <div className="progress-section">
          <div
            className="progress-bar-container"
            role="progressbar"
            aria-valuenow={progress.current}
            aria-valuemin={0}
            aria-valuemax={progress.total || 1}
            aria-label="Group creation progress"
          >
            <div className="progress-bar" style={{ width: `${percentage}%` }} />
          </div>
          <div className="progress-text">
            {progress.current} of {progress.total} steps completed ({percentage}%)
          </div>
        </div>

        {progress.successCount > 0 && (
          <div className="success-box" role="status">
            <CheckCircle size={16} aria-hidden="true" />
            <span>
              {progress.successCount} pending in-app group invitation{progress.successCount === 1 ? '' : 's'} recorded. No external email or SMS was sent.
            </span>
          </div>
        )}

        <div className="completion-message">
          <p><strong>“{groupName.trim()}”</strong> has been persisted successfully.</p>
          <p>Group created: Yes · Pending invitations: {progress.successCount} · Accepted memberships: {progress.acceptedCount ?? 0} · External notifications delivered: {progress.externalNotificationsSent ?? 0}.</p>
          {createdGroupId ? <p><Link to={`/groups/${encodeURIComponent(createdGroupId)}`} className="btn-primary">Open Group Dashboard</Link></p> : null}
        </div>
      </section>
    );
  };

  // ==========================================================================
  // Unauthorized fallback
  // ==========================================================================

  if (!user) {
    return <main className="create-group-wrapper"><div className="create-group-container" role="status"><Loader2 className="animate-spin" size={24} aria-hidden="true" /><p>Verifying your authenticated session…</p></div></main>;
  }

  if (!tenantId) {
    return (
      <main className="create-group-wrapper"><div className="create-group-container">
        <header className="create-group-header"><p className="eyebrow">TITech Community Capital</p><h1>Tenant membership required</h1>
          <p>Join an existing tenant with a valid invitation code before creating or joining community groups. No tenant or group will be created automatically.</p></header>
        <div className="info-box" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>Your account does not currently have an active tenant association.</span></div>
        <Link to="/tenant/join" className="btn-primary">Join an Existing Tenant</Link>
      </div></main>
    );
  }

  if (!canCreateGroup) {
    return <main className="create-group-wrapper"><div className="create-group-container">
      <header className="create-group-header"><p className="eyebrow">TITech Community Capital</p><h1>Group creation unavailable</h1><p>Your account is associated with a tenant, but its current role does not have group-creation permission. Contact your tenant administrator.</p></header>
      <Link to="/groups" className="btn-secondary">Return to Groups</Link>
    </div></main>;
  }

  // ==========================================================================
  // Main render
  // ==========================================================================

  return (
    <main
      className="create-group-wrapper"
      aria-labelledby="create-group-title"
    >
      <div className="create-group-container">
        <header className="create-group-header">
          <div>
            <p className="eyebrow">
              TITech Community Capital
            </p>

            <h1 id="create-group-title">
              Create New Group
            </h1>

            <p>
              Establish a community group, configure its
              members, and record secure in-app invitations.
            </p>
          </div>
        </header>

        {/* ------------------------------------------------------------------ */}
        {/* Step indicator                                                     */}
        {/* ------------------------------------------------------------------ */}

        <nav
          className="step-indicator"
          aria-label="Group creation progress"
        >
          {[1, 2, 3, 4].map((currentStep) => {
            const labels = [
              'Information',
              'Members',
              'Preview',
              'Confirmation',
            ];

            const isCurrent = !creationComplete && step === currentStep;
            const isComplete = creationComplete || step > currentStep;

            return (
              <div
                key={currentStep}
                className={`step-indicator-item ${
                  step >= currentStep ? 'active' : ''
                } ${isCurrent ? 'current' : ''}`}
                aria-current={
                  isCurrent ? 'step' : undefined
                }
              >
                <span className="step-dot">
                  {isComplete ? (
                    <CheckCircle
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    currentStep
                  )}
                </span>

                <span className="step-label">
                  {labels[currentStep - 1]}
                </span>
              </div>
            );
          })}
        </nav>

        {/* ------------------------------------------------------------------ */}
        {/* Error state                                                         */}
        {/* ------------------------------------------------------------------ */}

        {error && (
          <div
            className="alert alert-error"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle
              size={18}
              aria-hidden="true"
            />

            <span>{error}</span>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Workflow                                                           */}
        {/* ------------------------------------------------------------------ */}

        <form
          onSubmit={handleSubmit}
          noValidate
          aria-busy={loading}
        >
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {!creationComplete && step === 3 && renderStep3()}
          {!creationComplete && step === 4 && renderConfirmation()}
          {creationComplete && renderStep4()}

          {/* --------------------------------------------------------------- */}
          {/* Navigation                                                      */}
          {/* --------------------------------------------------------------- */}

          {!creationComplete && step < 5 && (
            <div className="button-group">
              {step > 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="btn-secondary"
                  disabled={loading}
                >
                  ← Back
                </button>
              )}

              {step < 3 && (
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn-primary"
                  disabled={loading}
                >
                  Next →
                </button>
              )}

              {step === 3 && (
                <button type="button" onClick={handleNext} className="btn-primary" disabled={loading}>Continue to Confirmation →</button>
              )}

              {step === 4 && (
                <button type="submit" disabled={loading} className="btn-primary btn-submit">
                  {loading ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Creating…</> : <><Send size={16} aria-hidden="true" /> Create Group</>}
                </button>
              )}
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Active submission controls                                     */}
          {/* --------------------------------------------------------------- */}

          {loading && !creationComplete && step === 4 && (
            <div className="submission-controls">
              <button
                type="button"
                onClick={handleCancelRequest}
                className="btn-secondary"
              >
                Cancel Request
              </button>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Completion controls                                            */}
          {/* --------------------------------------------------------------- */}

          {creationComplete && createdGroupId && (
            <div className="button-group">
              <Link to={`/groups/${encodeURIComponent(createdGroupId)}`} className="btn-primary">Open Group Dashboard</Link>
              <button type="button" onClick={() => navigate('/groups', { replace: true })} className="btn-secondary">View All Groups</button>
            </div>
          )}

        </form>
      </div>
    </main>
  );
}