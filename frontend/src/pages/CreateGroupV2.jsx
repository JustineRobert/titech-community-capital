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
// - Idempotent group creation support
// - Batched invitation processing
// - Partial-failure handling
// - Retry failed invitation batches
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
import { useNavigate } from 'react-router-dom';
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

import './CreateGroupV2.css';

// ============================================================================
// Constants
// ============================================================================

const MAX_GROUP_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_MEMBERS = 500;

const INVITATION_BATCH_SIZE = 5;

const NAVIGATION_DELAY_MS = 1800;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const GROUP_TYPES = [
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
  {
    value: 'welfare',
    label: 'Welfare Group',
    description: 'Member welfare and mutual support',
  },
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

const getErrorMessage = (error, fallback = 'An unexpected error occurred.') => {
  if (!error) return fallback;

  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  );
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
  error?.code === 'ECONNABORTED' ||
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
  const { user } = useAuth();
  const navigate = useNavigate();

  // --------------------------------------------------------------------------
  // Lifecycle / request management
  // --------------------------------------------------------------------------

  const mountedRef = useRef(false);
  const submitAbortRef = useRef(null);
  const navigationTimerRef = useRef(null);

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

      if (navigationTimerRef.current) {
        clearTimeout(navigationTimerRef.current);
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // RBAC
  // --------------------------------------------------------------------------

  const userRole = String(
    user?.role || user?.roles?.[0] || ''
  ).toLowerCase();

  const canCreateGroup = userRole === 'admin';

  useEffect(() => {
    if (user && !canCreateGroup) {
      toast.error('Only administrators can create groups.');

      navigate('/dashboard', {
        replace: true,
      });
    }
  }, [user, canCreateGroup, navigate]);

  // --------------------------------------------------------------------------
  // Form state
  // --------------------------------------------------------------------------

  const [step, setStep] = useState(1);

  const [groupName, setGroupName] = useState('');
  const [groupType, setGroupType] = useState('savings');
  const [description, setDescription] = useState('');

  const [memberEmails, setMemberEmails] = useState(['']);
  const [memberRoles, setMemberRoles] = useState(['member']);

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
    failures: [],
    successCount: 0,
  });

  const [createdGroupId, setCreatedGroupId] = useState(null);

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

      const role = MEMBER_ROLES.some(
        (candidate) => candidate.value === memberRoles[index]
      )
        ? memberRoles[index]
        : 'member';

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
  }, [memberEmails.length]);

  const handleEmailChange = useCallback((index, value) => {
    setMemberEmails((previous) =>
      previous.map((email, currentIndex) =>
        currentIndex === index ? value : email
      )
    );
  }, []);

  const handleRoleChange = useCallback((index, value) => {
    setMemberRoles((previous) =>
      previous.map((role, currentIndex) =>
        currentIndex === index ? value : role
      )
    );
  }, []);

  const handleRemoveMember = useCallback((index) => {
    setMemberEmails((previous) =>
      previous.length <= 1
        ? ['']
        : previous.filter((_, currentIndex) => currentIndex !== index)
    );

    setMemberRoles((previous) =>
      previous.length <= 1
        ? ['member']
        : previous.filter((_, currentIndex) => currentIndex !== index)
    );

    setError('');
  }, []);

  const normalizeMemberList = useCallback(() => {
    const seen = new Set();
    const emails = [];
    const roles = [];

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
      roles.push(
        MEMBER_ROLES.some(
          (candidate) => candidate.value === memberRoles[index]
        )
          ? memberRoles[index]
          : 'member'
      );
    });

    setMemberEmails(emails.length ? emails : ['']);
    setMemberRoles(roles.length ? roles : ['member']);

    setError('');

    toast.info(
      emails.length
        ? `Normalized ${emails.length} valid member${
            emails.length === 1 ? '' : 's'
          }.`
        : 'No valid members found.'
    );
  }, [memberEmails, memberRoles, validateEmail]);

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
      if (validMembers.length === 0) {
        setError('Please add at least one valid member.');
        return false;
      }

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
    duplicateEmails,
  ]);

  const handleNext = useCallback(() => {
    if (!validateCurrentStep()) return;

    setStep((currentStep) => Math.min(3, currentStep + 1));
  }, [validateCurrentStep]);

  const handleBack = useCallback(() => {
    setError('');

    setStep((currentStep) => Math.max(1, currentStep - 1));
  }, []);

  // ==========================================================================
  // API helpers
  // ==========================================================================

  const createGroup = useCallback(
    async (signal, requestId) => {
      const payload = {
        name: groupName.trim(),
        type: groupType,
        description: description.trim(),
        members: validMembers.map((member) => ({
          email: member.email,
          role: member.role,
        })),
      };

      return api.post('/groups', payload, {
        signal,
        headers: {
          'X-Idempotency-Key': requestId,
          'X-Request-ID': requestId,
        },
      });
    },
    [groupName, groupType, description, validMembers]
  );

  const sendInvitationBatch = useCallback(
    async (groupId, batch, batchIndex, signal, requestId) => {
      return api.post(
        `/groups/${encodeURIComponent(groupId)}/send-invitations`,
        {
          members: batch.map((member) => ({
            email: member.email,
            role: member.role,
          })),
          batchIndex,
        },
        {
          signal,
          headers: {
            'X-Request-ID': `${requestId}-batch-${batchIndex}`,
          },
        }
      );
    },
    []
  );

  // ==========================================================================
  // Group creation
  // ==========================================================================

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();

      if (loading) return;

      setError('');

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

      if (!canCreateGroup) {
        toast.error('You are not authorized to create groups.');
        return;
      }

      if (!user) {
        toast.error('Your session could not be verified.');
        return;
      }

      // Cancel any stale request.
      if (submitAbortRef.current) {
        try {
          submitAbortRef.current.abort();
        } catch (_) {
          // Ignore.
        }
      }

      const controller = new AbortController();
      submitAbortRef.current = controller;

      const requestId = createClientRequestId();

      setLoading(true);
      setProgress({
        current: 0,
        total: 1 + Math.ceil(validMembers.length / INVITATION_BATCH_SIZE),
        message: 'Preparing group creation...',
        failures: [],
        successCount: 0,
      });

      try {
        // --------------------------------------------------------------------
        // Phase 1: Create group
        // --------------------------------------------------------------------

        setProgress((previous) => ({
          ...previous,
          current: 0,
          message: 'Creating TITech Community Capital group...',
        }));

        const groupResponse = await createGroup(
          controller.signal,
          requestId
        );

        if (controller.signal.aborted) {
          throw new DOMException('Request aborted.', 'AbortError');
        }

        const groupId = getGroupId(groupResponse);

        if (!groupId) {
          throw new Error(
            'The server did not return a valid group identifier.'
          );
        }

        if (!mountedRef.current) return;

        setCreatedGroupId(groupId);

        setProgress((previous) => ({
          ...previous,
          current: 1,
          message: 'Group created. Preparing member invitations...',
        }));

        // --------------------------------------------------------------------
        // Phase 2: Send invitations
        // --------------------------------------------------------------------

        const batches = [];

        for (
          let index = 0;
          index < validMembers.length;
          index += INVITATION_BATCH_SIZE
        ) {
          batches.push(
            validMembers.slice(index, index + INVITATION_BATCH_SIZE)
          );
        }

        const failures = [];
        let successCount = 0;

        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index];
          const batchNumber = index + 1;

          if (controller.signal.aborted) {
            throw new DOMException(
              'Request aborted.',
              'AbortError'
            );
          }

          setProgress((previous) => ({
            ...previous,
            current: batchNumber,
            message: `Sending member invitations (${Math.min(
              batchNumber * INVITATION_BATCH_SIZE,
              validMembers.length
            )}/${validMembers.length})...`,
          }));

          try {
            const response = await sendInvitationBatch(
              groupId,
              batch,
              batchNumber,
              controller.signal,
              requestId
            );

            const responseData = getApiData(response);

            const reportedSuccess = Number(
              responseData?.successCount ??
                responseData?.successful ??
                responseData?.sentCount ??
                batch.length
            );

            successCount += Math.min(
              Math.max(reportedSuccess, 0),
              batch.length
            );
          } catch (batchError) {
            if (isAbortError(batchError)) {
              throw batchError;
            }

            failures.push({
              batch: batchNumber,
              error: getErrorMessage(
                batchError,
                'Failed to send invitation batch.'
              ),
              members: batch.map((member) => member.email),
              count: batch.length,
            });
          }

          if (mountedRef.current) {
            setProgress((previous) => ({
              ...previous,
              current: batchNumber + 1,
              successCount,
              failures: [...failures],
            }));
          }
        }

        // --------------------------------------------------------------------
        // Phase 3: Completion
        // --------------------------------------------------------------------

        if (!mountedRef.current) return;

        const completedSteps = batches.length + 1;

        const finalMessage =
          failures.length === 0
            ? 'Group created and all invitations were sent successfully.'
            : `Group created. ${failures.length} invitation batch${
                failures.length === 1 ? '' : 'es'
              } require attention.`;

        setProgress({
          current: completedSteps,
          total: completedSteps,
          message: finalMessage,
          failures,
          successCount,
        });

        setStep(4);

        if (failures.length === 0) {
          toast.success(
            `TITech Community Capital group "${groupName.trim()}" created successfully.`
          );

          navigationTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return;

            navigate(`/groups/${encodeURIComponent(groupId)}`, {
              replace: true,
            });
          }, NAVIGATION_DELAY_MS);
        } else {
          toast.warning(
            'Group created, but some member invitations require attention.'
          );
        }
      } catch (submitError) {
        if (!mountedRef.current) return;

        if (isAbortError(submitError)) {
          setError('Group creation was cancelled.');

          toast.info('Group creation cancelled.');

          setProgress((previous) => ({
            ...previous,
            message: 'Group creation cancelled.',
          }));

          return;
        }

        const message = getErrorMessage(
          submitError,
          'Failed to create the group.'
        );

        setError(message);

        setProgress({
          current: 0,
          total: 0,
          message: '',
          failures: [],
          successCount: 0,
        });

        toast.error(message);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }

        if (submitAbortRef.current === controller) {
          submitAbortRef.current = null;
        }
      }
    },
    [
      loading,
      validateGroupDetails,
      validateCurrentStep,
      canCreateGroup,
      user,
      validMembers,
      createGroup,
      sendInvitationBatch,
      groupName,
      navigate,
    ]
  );

  // ==========================================================================
  // Retry failed invitations
  // ==========================================================================

  const handleRetryFailures = useCallback(async () => {
    if (!createdGroupId || loading) return;

    const failedBatches = progress.failures;

    if (!failedBatches.length) return;

    if (submitAbortRef.current) {
      try {
        submitAbortRef.current.abort();
      } catch (_) {
        // Ignore.
      }
    }

    const controller = new AbortController();
    submitAbortRef.current = controller;

    const requestId = createClientRequestId();

    setLoading(true);
    setError('');

    const retryFailures = [];
    let recoveredCount = progress.successCount;

    try {
      for (let index = 0; index < failedBatches.length; index += 1) {
        const failure = failedBatches[index];

        const members = failure.members.map((email) => ({
          email,
          role:
            validMembers.find((member) => member.email === email)?.role ||
            'member',
        }));

        setProgress((previous) => ({
          ...previous,
          message: `Retrying invitation batch ${index + 1} of ${
            failedBatches.length
          }...`,
        }));

        try {
          const response = await sendInvitationBatch(
            createdGroupId,
            members,
            failure.batch,
            controller.signal,
            requestId
          );

          const data = getApiData(response);

          const successCount = Number(
            data?.successCount ??
              data?.successful ??
              data?.sentCount ??
              members.length
          );

          recoveredCount += Math.min(
            Math.max(successCount, 0),
            members.length
          );
        } catch (retryError) {
          if (isAbortError(retryError)) {
            throw retryError;
          }

          retryFailures.push({
            ...failure,
            error: getErrorMessage(
              retryError,
              'Retry failed.'
            ),
          });
        }
      }

      if (!mountedRef.current) return;

      const completed =
        retryFailures.length === 0;

      setProgress((previous) => ({
        ...previous,
        current: previous.total,
        message: completed
          ? 'All pending invitations have been sent successfully.'
          : 'Some invitations still require attention.',
        failures: retryFailures,
        successCount: recoveredCount,
      }));

      if (completed) {
        toast.success('All pending invitations were sent successfully.');

        navigationTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;

          navigate(
            `/groups/${encodeURIComponent(createdGroupId)}`,
            {
              replace: true,
            }
          );
        }, NAVIGATION_DELAY_MS);
      } else {
        toast.warning(
          'Some invitations still could not be sent.'
        );
      }
    } catch (retryError) {
      if (!mountedRef.current) return;

      if (isAbortError(retryError)) {
        toast.info('Invitation retry cancelled.');
        return;
      }

      const message = getErrorMessage(
        retryError,
        'Failed to retry invitations.'
      );

      setError(message);
      toast.error(message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }

      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  }, [
    createdGroupId,
    loading,
    progress.failures,
    progress.successCount,
    validMembers,
    sendInvitationBatch,
    navigate,
  ]);

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
      </div>

      <div className="form-group">
        <label htmlFor="description" className="form-label">
          Description <span className="optional">(Optional)</span>
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
          <label className="form-label" htmlFor="member-email-0">
            Manual Entry
          </label>

          <span className="member-limit">
            {validMembers.length}/{MAX_MEMBERS}
          </span>
        </div>

        <div className="members-list">
          {memberEmails.map((email, index) => {
            const inputId = `member-email-${index}`;
            const isInvalid =
              Boolean(normalizeEmail(email)) &&
              !validateEmail(email);

            return (
              <div
                key={`${index}-${email}`}
                className="member-entry"
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
                    name={`member-email-${index}`}
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(event) =>
                      handleEmailChange(
                        index,
                        event.target.value
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
                  htmlFor={`member-role-${index}`}
                  className="sr-only"
                >
                  Role for member {index + 1}
                </label>

                <select
                  id={`member-role-${index}`}
                  name={`member-role-${index}`}
                  value={memberRoles[index] || 'member'}
                  onChange={(event) =>
                    handleRoleChange(
                      index,
                      event.target.value
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
                    handleRemoveMember(index)
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

        {invalidMembers.length > 0 && (
          <div className="form-help error-text" role="alert">
            {invalidMembers.length} invalid email
            {invalidMembers.length === 1 ? '' : 's'} need
            attention.
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
          <h2 id="preview-heading">Review & Confirm</h2>
          <p>Verify the group details before creation.</p>
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
            <span className="preview-label">
              Members
            </span>

            <span className="preview-value badge">
              {validMembers.length}
            </span>
          </div>
        </div>
      </div>

      <div className="members-preview">
        <div className="members-preview-header">
          <h3>
            Members to Invite ({validMembers.length})
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

                <div
                  className="member-role-badge"
                  title={roleInfo?.description}
                >
                  {roleInfo?.label || 'Member'}
                </div>
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

          if (!count) return null;

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

      <div className="info-box" role="note">
        <AlertCircle size={16} aria-hidden="true" />

        <span>
          Creating this group will create the group record
          and initiate member invitations.
        </span>
      </div>
    </section>
  );

  const renderStep4 = () => {
    const hasFailures = progress.failures.length > 0;
    const completed =
      progress.total > 0 &&
      progress.current >= progress.total;

    const percentage =
      progress.total > 0
        ? Math.min(
            100,
            Math.round(
              (progress.current / progress.total) * 100
            )
          )
        : 0;

    return (
      <section
        className="step-container"
        aria-labelledby="completion-heading"
      >
        <div className="step-header">
          <div className="step-icon" aria-hidden="true">
            {hasFailures ? (
              <AlertCircle size={20} />
            ) : (
              <CheckCircle size={20} />
            )}
          </div>

          <div>
            <h2 id="completion-heading">
              {hasFailures
                ? 'Completed with Issues'
                : 'Group Creation Complete'}
            </h2>

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
            <div
              className="progress-bar"
              style={{
                width: `${percentage}%`,
              }}
            />
          </div>

          <div className="progress-text">
            {progress.current} of {progress.total}{' '}
            steps completed ({percentage}%)
          </div>
        </div>

        {progress.successCount > 0 && (
          <div className="success-box" role="status">
            <CheckCircle
              size={16}
              aria-hidden="true"
            />

            <span>
              {progress.successCount} member invitation
              {progress.successCount === 1 ? '' : 's'} sent
              successfully.
            </span>
          </div>
        )}

        {hasFailures && (
          <div className="error-box" role="alert">
            <AlertCircle
              size={16}
              aria-hidden="true"
            />

            <div>
              <strong>
                Some invitations could not be sent.
              </strong>

              <ul className="failure-list">
                {progress.failures.map((failure) => (
                  <li
                    key={`failure-${failure.batch}-${failure.error}`}
                  >
                    <strong>
                      Batch {failure.batch}:
                    </strong>{' '}
                    {failure.error} ({failure.count}{' '}
                    member
                    {failure.count === 1 ? '' : 's'}).
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {completed && !hasFailures && (
          <div className="completion-message">
            <p>
              <strong>
                "{groupName.trim()}"
              </strong>{' '}
              has been created successfully.
            </p>

            <p className="redirecting">
              Redirecting to group details...
            </p>
          </div>
        )}

        {completed && hasFailures && (
          <div className="completion-message">
            <p>
              The group was created, but some invitations
              need to be retried.
            </p>
          </div>
        )}
      </section>
    );
  };

  // ==========================================================================
  // Unauthorized fallback
  // ==========================================================================

  if (!user || !canCreateGroup) {
    return (
      <main className="create-group-wrapper">
        <div
          className="create-group-container"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="animate-spin"
            size={24}
            aria-hidden="true"
          />

          <p>Verifying group creation permissions...</p>
        </div>
      </main>
    );
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
              members, and send invitations securely.
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

            const isCurrent = step === currentStep;
            const isComplete = step > currentStep;

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
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}

          {/* --------------------------------------------------------------- */}
          {/* Navigation                                                      */}
          {/* --------------------------------------------------------------- */}

          {step < 4 && (
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
                <button
                  type="submit"
                  disabled={
                    loading ||
                    validMembers.length === 0
                  }
                  className="btn-primary btn-submit"
                >
                  {loading ? (
                    <>
                      <Loader2
                        size={16}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Send
                        size={16}
                        aria-hidden="true"
                      />
                      Create Group
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* Active submission controls                                     */}
          {/* --------------------------------------------------------------- */}

          {loading && step >= 3 && (
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

          {step === 4 && (
            <div className="button-group">
              {progress.failures.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailures}
                  className="btn-secondary"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2
                        size={16}
                        className="animate-spin"
                        aria-hidden="true"
                      />
                      Retrying...
                    </>
                  ) : (
                    '↻ Retry Failed Invitations'
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  navigate(
                    progress.failures.length === 0
                      ? '/dashboard'
                      : '/groups',
                    {
                      replace: true,
                    }
                  )
                }
                className="btn-primary"
                disabled={loading}
              >
                {progress.failures.length === 0
                  ? 'Return to Dashboard'
                  : 'View Groups'}
              </button>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}