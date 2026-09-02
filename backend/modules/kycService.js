// backend/modules/kycService.js
'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise KYC Service
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - KYC profile lifecycle management
 * - Identity information management
 * - Document ingestion and verification orchestration
 * - OCR orchestration
 * - Facial verification orchestration
 * - External identity-provider verification
 * - Sanctions / AML screening
 * - KYC risk assessment
 * - Approval / rejection workflow
 * - KYC expiration / reverification
 * - Tenant isolation
 * - Idempotency protection
 * - Cache management
 * - Audit integration
 * - Notification integration
 * - Metrics integration
 * - Domain event publication
 *
 * Architectural principles
 * ----------------------------------------------------------------------------
 * - No direct financial mutations
 * - No cross-tenant access
 * - Fail closed for critical verification decisions
 * - Optional infrastructure dependencies degrade safely
 * - KYC state transitions are explicit
 * - Sensitive identity data is never written to logs
 * - External providers are treated as untrusted dependencies
 * - Public method signatures remain backward compatible
 *
 * NOTE:
 * This service intentionally does not attempt to define jurisdiction-specific
 * KYC rules. Those should be supplied through configuration and/or dedicated
 * compliance policy services.
 * ============================================================================
 */

class KYCService extends EventEmitter {
  constructor({
    db,
    logger,
    cache,
    queueService,
    notificationService,
    documentStorageService,
    auditService,
    riskScoringService,
    amlService,
    sanctionsService,
    ocrService,
    faceVerificationService,
    identityProvider,
    metricsService,
    config = {},
  } = {}) {
    super();

    this.db = db;
    this.logger = logger;
    this.cache = cache;
    this.queueService = queueService;
    this.notificationService = notificationService;
    this.documentStorageService = documentStorageService;
    this.auditService = auditService;
    this.riskScoringService = riskScoringService;
    this.amlService = amlService;
    this.sanctionsService = sanctionsService;
    this.ocrService = ocrService;
    this.faceVerificationService = faceVerificationService;
    this.identityProvider = identityProvider;
    this.metricsService = metricsService;

    this.config = {
      cacheTtl: 300,

      /**
       * Number of calendar months for KYC validity.
       *
       * Can be overridden by tenant/jurisdiction policy.
       */
      expiryMonths: 12,

      autoScreening: true,
      enableFaceVerification: true,
      enableOCR: true,

      /**
       * Security defaults.
       */
      requireIdentityForApproval: true,
      requireIdentityVerificationForApproval: true,
      requireScreeningForApproval: true,
      requireRiskAssessmentForApproval: true,

      /**
       * Risk policy.
       */
      highRiskBlockApproval: true,
      maxApprovalRiskScore: 79,

      /**
       * Document policy.
       */
      maxDocumentsPerProfile: 20,
      maxDocumentSizeBytes: 10 * 1024 * 1024,

      /**
       * Batch processing.
       */
      expirationBatchSize: 500,

      /**
       * Cache namespace.
       */
      cachePrefix: 'kyc',

      /**
       * Idempotency.
       */
      idempotencyTtl: 24 * 60 * 60,

      /**
       * Prevent unrestricted metadata growth.
       */
      maxMetadataKeys: 100,

      /**
       * Screening retry / workflow behavior.
       */
      enqueueScreening: true,
      enqueueRiskAssessment: true,

      /**
       * Event behavior.
       */
      emitEvents: true,

      ...config,
    };

    this._validateDependencies();
  }

  // ===========================================================================
  // Dependency Validation
  // ===========================================================================

  _validateDependencies() {
    if (!this.db) {
      throw new Error('KYCService requires a database dependency.');
    }

    if (!this.logger) {
      this.logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
    }
  }

  // ===========================================================================
  // Utility Helpers
  // ===========================================================================

  _now() {
    return new Date();
  }

  _profileCacheKey(tenantId, customerId) {
    return `${this.config.cachePrefix}:${tenantId}:${customerId}`;
  }

  _idempotencyCacheKey(scope, key) {
    return `kyc:idempotency:${scope}:${key}`;
  }

  _assertTenantContext(tenantId, customerId) {
    if (!tenantId) {
      throw new Error('tenantId is required.');
    }

    if (!customerId) {
      throw new Error('customerId is required.');
    }
  }

  _assertString(value, field, {
    required = false,
    maxLength = 500,
  } = {}) {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      if (required) {
        throw new Error(`${field} is required.`);
      }

      return;
    }

    if (typeof value !== 'string') {
      throw new Error(`${field} must be a string.`);
    }

    if (value.length > maxLength) {
      throw new Error(
        `${field} exceeds the maximum allowed length.`
      );
    }
  }

  _assertMetadata(metadata) {
    if (!metadata) {
      return {};
    }

    if (
      typeof metadata !== 'object' ||
      Array.isArray(metadata)
    ) {
      throw new Error('metadata must be an object.');
    }

    const keys = Object.keys(metadata);

    if (
      keys.length >
      this.config.maxMetadataKeys
    ) {
      throw new Error(
        'metadata contains too many fields.'
      );
    }

    return metadata;
  }

  _sanitizeIdentity(identity = {}) {
    return {
      firstName: identity.firstName,
      lastName: identity.lastName,
      dateOfBirth: identity.dateOfBirth,
      gender: identity.gender,
      nationality: identity.nationality,
      idType: identity.idType,
      idNumber: identity.idNumber,
      phoneNumber: identity.phoneNumber,
      email: identity.email,
      address: identity.address,
    };
  }

  /**
   * Never log complete identity documents or identity numbers.
   */
  _hashIdentifier(value) {
    if (!value) {
      return null;
    }

    return crypto
      .createHash('sha256')
      .update(String(value))
      .digest('hex');
  }

  _safeProfileForLog(profile) {
    if (!profile) {
      return null;
    }

    return {
      id: profile.id,
      tenantId: profile.tenantId,
      customerId: profile.customerId,
      status: profile.status,
      verificationLevel:
        profile.verificationLevel,
      riskLevel: profile.riskLevel,
      riskScore: profile.riskScore,
    };
  }

  _isTerminalStatus(status) {
    return [
      'approved',
    ].includes(status);
  }

  _assertTransition(
    currentStatus,
    nextStatus
  ) {
    const transitions = {
      pending: [
        'pending',
        'submitted',
        'rejected',
        'approved',
        'expired',
      ],

      submitted: [
        'submitted',
        'under_review',
        'rejected',
        'approved',
        'expired',
      ],

      under_review: [
        'under_review',
        'approved',
        'rejected',
        'expired',
      ],

      rejected: [
        'rejected',
        'pending',
        'submitted',
        'under_review',
      ],

      expired: [
        'expired',
        'pending',
        'submitted',
        'under_review',
      ],

      approved: [
        'approved',
        'expired',
        'pending',
      ],
    };

    const allowed =
      transitions[currentStatus] || [];

    if (
      !allowed.includes(nextStatus)
    ) {
      throw new Error(
        `Invalid KYC state transition: ${currentStatus} -> ${nextStatus}`
      );
    }
  }

  async _setProfileStatus(
    profile,
    nextStatus,
    additional = {}
  ) {
    this._assertTransition(
      profile.status,
      nextStatus
    );

    profile.status = nextStatus;
    profile.updatedAt = this._now();

    Object.assign(
      profile,
      additional
    );

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      profile.tenantId,
      profile.customerId
    );

    return profile;
  }

  async _recordMetric(
    name,
    value = 1,
    labels = {}
  ) {
    if (!this.metricsService) {
      return;
    }

    try {
      if (
        typeof this.metricsService.increment ===
        'function'
      ) {
        await this.metricsService.increment(
          name,
          value,
          labels
        );

        return;
      }

      if (
        typeof this.metricsService.inc ===
        'function'
      ) {
        await this.metricsService.inc(
          name,
          value,
          labels
        );
      }
    } catch (error) {
      this.logger.warn(
        'KYC metric recording failed',
        {
          metric: name,
          error: error.message,
        }
      );
    }
  }

  _emitEvent(
    eventName,
    payload
  ) {
    if (!this.config.emitEvents) {
      return;
    }

    try {
      this.emit(
        eventName,
        payload
      );
    } catch (error) {
      this.logger.error(
        'KYC event listener failed',
        {
          eventName,
          error: error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Create KYC Profile
  // ===========================================================================

  async createProfile({
    tenantId,
    customerId,
    type = 'individual',
    metadata = {},
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    this._assertString(
      type,
      'type',
      {
        required: true,
        maxLength: 50,
      }
    );

    metadata =
      this._assertMetadata(metadata);

    const existing =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (existing) {
      return existing;
    }

    const now = this._now();

    const profile = {
      id: crypto.randomUUID(),

      tenantId,
      customerId,

      type,

      status: 'pending',

      verificationLevel: 0,

      riskLevel: 'unknown',
      riskScore: null,

      metadata,

      documents: [],

      identity: null,

      identityVerification: null,

      screening: null,

      faceVerification: null,

      createdAt: now,
      updatedAt: now,
    };

    await this.db.kycProfiles.create(
      profile
    );

    await this._recordMetric(
      'kyc_profiles_created_total',
      1,
      { tenantId }
    );

    await this.audit(
      tenantId,
      customerId,
      'KYC_PROFILE_CREATED',
      this._safeProfileForLog(profile)
    );

    this._emitEvent(
      'kyc.profile.created',
      profile
    );

    return profile;
  }

  // ===========================================================================
  // Get Profile
  // ===========================================================================

  async getProfile(
    tenantId,
    customerId
  ) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    const cacheKey =
      this._profileCacheKey(
        tenantId,
        customerId
      );

    if (this.cache) {
      try {
        const cached =
          await this.cache.get(
            cacheKey
          );

        if (cached) {
          return cached;
        }
      } catch (error) {
        this.logger.warn(
          'KYC cache read failed',
          {
            tenantId,
            customerId,
            error: error.message,
          }
        );
      }
    }

    const profile =
      await this.db.kycProfiles.findOne({
        tenantId,
        customerId,
      });

    if (
      profile &&
      this.cache
    ) {
      try {
        await this.cache.set(
          cacheKey,
          profile,
          this.config.cacheTtl
        );
      } catch (error) {
        this.logger.warn(
          'KYC cache write failed',
          {
            tenantId,
            customerId,
            error: error.message,
          }
        );
      }
    }

    return profile;
  }

  // ===========================================================================
  // Submit Identity Information
  // ===========================================================================

  async submitIdentity({
    tenantId,
    customerId,
    firstName,
    lastName,
    dateOfBirth,
    gender,
    nationality,
    idType,
    idNumber,
    phoneNumber,
    email,
    address,
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    this._assertString(
      firstName,
      'firstName',
      {
        required: true,
        maxLength: 100,
      }
    );

    this._assertString(
      lastName,
      'lastName',
      {
        required: true,
        maxLength: 100,
      }
    );

    this._assertString(
      idType,
      'idType',
      {
        required: true,
        maxLength: 50,
      }
    );

    this._assertString(
      idNumber,
      'idNumber',
      {
        required: true,
        maxLength: 100,
      }
    );

    const profile =
      await this.createProfile({
        tenantId,
        customerId,
      });

    if (
      this._isTerminalStatus(
        profile.status
      )
    ) {
      throw new Error(
        'Approved KYC profiles cannot have identity information replaced directly.'
      );
    }

    const identity = {
      firstName,
      lastName,
      dateOfBirth,
      gender,
      nationality,
      idType,
      idNumber,
      phoneNumber,
      email,
      address,
    };

    profile.identity = identity;

    profile.identityHash =
      this._hashIdentifier(
        idNumber
      );

    profile.identitySubmittedAt =
      this._now();

    profile.updatedAt =
      this._now();

    this._assertTransition(
      profile.status,
      'submitted'
    );

    profile.status =
      'submitted';

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.audit(
      tenantId,
      customerId,
      'KYC_IDENTITY_SUBMITTED',
      {
        profileId: profile.id,
        idType,
        identityHash:
          profile.identityHash,
      }
    );

    await this._recordMetric(
      'kyc_identity_submissions_total',
      1,
      { tenantId }
    );

    this._emitEvent(
      'kyc.identity.submitted',
      {
        profileId: profile.id,
        tenantId,
        customerId,
      }
    );

    /**
     * Screening can be queued instead of blocking the HTTP request.
     */
    if (
      this.config.autoScreening
    ) {
      await this._enqueueScreening(
        tenantId,
        customerId
      );
    }

    return profile;
  }

  // ===========================================================================
  // Upload Documents
  // ===========================================================================

  async uploadDocument({
    tenantId,
    customerId,
    documentType,
    file,
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    this._assertString(
      documentType,
      'documentType',
      {
        required: true,
        maxLength: 100,
      }
    );

    if (!file) {
      throw new Error(
        'Document file is required.'
      );
    }

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'KYC profile not found.'
      );
    }

    if (
      this._isTerminalStatus(
        profile.status
      )
    ) {
      throw new Error(
        'Documents cannot be added directly to an approved KYC profile.'
      );
    }

    profile.documents =
      profile.documents || [];

    if (
      profile.documents.length >=
      this.config.maxDocumentsPerProfile
    ) {
      throw new Error(
        'Maximum number of KYC documents exceeded.'
      );
    }

    if (
      file.size &&
      file.size >
        this.config.maxDocumentSizeBytes
    ) {
      throw new Error(
        'KYC document exceeds the maximum allowed size.'
      );
    }

    if (
      !this.documentStorageService ||
      typeof this.documentStorageService.upload !==
        'function'
    ) {
      throw new Error(
        'Document storage service is unavailable.'
      );
    }

    const stored =
      await this.documentStorageService.upload({
        tenantId,
        customerId,
        file,
      });

    if (!stored || !stored.id) {
      throw new Error(
        'Document storage returned an invalid result.'
      );
    }

    const now = this._now();

    const document = {
      id: crypto.randomUUID(),

      type: documentType,

      fileId: stored.id,

      fileName:
        stored.fileName || null,

      status: 'uploaded',

      uploadedAt: now,

      updatedAt: now,
    };

    profile.documents.push(
      document
    );

    profile.updatedAt = now;

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.audit(
      tenantId,
      customerId,
      'KYC_DOCUMENT_UPLOADED',
      {
        profileId: profile.id,
        documentId: document.id,
        documentType,
        fileId: stored.id,
      }
    );

    await this._recordMetric(
      'kyc_documents_uploaded_total',
      1,
      {
        tenantId,
        documentType,
      }
    );

    if (
      this.config.enableOCR &&
      this.ocrService
    ) {
      await this._enqueueOCR(
        tenantId,
        customerId,
        document.id
      );
    }

    this._emitEvent(
      'kyc.document.uploaded',
      {
        tenantId,
        customerId,
        profileId: profile.id,
        document,
      }
    );

    return document;
  }

  // ===========================================================================
  // OCR Verification
  // ===========================================================================

  async processOCR({
    tenantId,
    customerId,
    document,
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    if (!this.ocrService) {
      throw new Error(
        'OCR service is unavailable.'
      );
    }

    if (!document) {
      throw new Error(
        'Document is required for OCR processing.'
      );
    }

    const result =
      await this.ocrService.extract(
        document
      );

    await this.audit(
      tenantId,
      customerId,
      'KYC_OCR_PROCESSED',
      {
        documentId:
          document.id ||
          document.documentId,
        success:
          Boolean(result),
      }
    );

    this._emitEvent(
      'kyc.ocr.completed',
      {
        tenantId,
        customerId,
        documentId:
          document.id ||
          document.documentId,
      }
    );

    return result;
  }

  // ===========================================================================
  // Face Verification
  // ===========================================================================

  async verifyFace({
    tenantId,
    customerId,
    selfie,
    documentImage,
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    if (
      !this.config.enableFaceVerification
    ) {
      return {
        verified: false,
        reason:
          'Face verification disabled',
      };
    }

    if (
      !this.faceVerificationService
    ) {
      return {
        verified: false,
        reason:
          'Face verification service unavailable',
      };
    }

    if (!selfie) {
      throw new Error(
        'Selfie is required.'
      );
    }

    if (!documentImage) {
      throw new Error(
        'Document image is required.'
      );
    }

    const result =
      await this.faceVerificationService.compare(
        selfie,
        documentImage
      );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (profile) {
      profile.faceVerification = {
        verified:
          Boolean(result?.verified),
        score:
          result?.score ?? null,
        verifiedAt:
          this._now(),
      };

      profile.updatedAt =
        this._now();

      await this.db.kycProfiles.update(
        profile.id,
        profile
      );

      await this.invalidateCache(
        tenantId,
        customerId
      );
    }

    await this.audit(
      tenantId,
      customerId,
      'KYC_FACE_VERIFICATION_COMPLETED',
      {
        verified:
          Boolean(result?.verified),
        score:
          result?.score ?? null,
      }
    );

    return result;
  }

  // ===========================================================================
  // Identity Verification
  // ===========================================================================

  async verifyIdentity(
    tenantId,
    customerId
  ) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'Profile not found.'
      );
    }

    if (!profile.identity) {
      throw new Error(
        'Identity information has not been submitted.'
      );
    }

    if (!this.identityProvider) {
      return {
        verified: false,
        reason:
          'Identity provider unavailable',
      };
    }

    const result =
      await this.identityProvider.verify(
        profile.identity
      );

    profile.identityVerification = {
      ...result,
      verifiedAt:
        this._now(),
    };

    profile.updatedAt =
      this._now();

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.audit(
      tenantId,
      customerId,
      'KYC_IDENTITY_VERIFICATION_COMPLETED',
      {
        verified:
          Boolean(result?.verified),
        provider:
          result?.provider || null,
      }
    );

    await this._recordMetric(
      result?.verified
        ? 'kyc_identity_verification_success_total'
        : 'kyc_identity_verification_failure_total',
      1,
      { tenantId }
    );

    this._emitEvent(
      'kyc.identity.verification.completed',
      {
        tenantId,
        customerId,
        verified:
          Boolean(result?.verified),
      }
    );

    return result;
  }

  // ===========================================================================
  // AML / Sanctions Screening
  // ===========================================================================

  async performScreening(
    tenantId,
    customerId
  ) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'KYC profile not found.'
      );
    }

    if (!profile.identity) {
      throw new Error(
        'Identity information is required before screening.'
      );
    }

    const identity =
      profile.identity;

    const [
      sanctions,
      aml,
    ] = await Promise.all([
      this.sanctionsService
        ? this.sanctionsService.screen(
            identity
          )
        : null,

      this.amlService
        ? this.amlService.screen(
            identity
          )
        : null,
    ]);

    const screening = {
      sanctions,
      aml,
      screenedAt:
        this._now(),
    };

    profile.screening =
      screening;

    profile.updatedAt =
      this._now();

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.audit(
      tenantId,
      customerId,
      'KYC_SCREENING_COMPLETED',
      {
        sanctionsMatches:
          sanctions?.matches?.length ||
          0,
        amlRisk:
          aml?.risk?.level ||
          null,
      }
    );

    await this._recordMetric(
      'kyc_screenings_completed_total',
      1,
      { tenantId }
    );

    this._emitEvent(
      'kyc.screening.completed',
      {
        tenantId,
        customerId,
        profileId: profile.id,
        screening,
      }
    );

    return screening;
  }

  // ===========================================================================
  // Risk Assessment
  // ===========================================================================

  async assessRisk(
    tenantId,
    customerId
  ) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'KYC profile not found.'
      );
    }

    if (!this.riskScoringService) {
      throw new Error(
        'KYC risk scoring service is unavailable.'
      );
    }

    if (
      typeof this.riskScoringService.scoreKYC !==
      'function'
    ) {
      throw new Error(
        'KYC risk scoring implementation is unavailable.'
      );
    }

    const risk =
      await this.riskScoringService.scoreKYC(
        profile
      );

    if (!risk) {
      throw new Error(
        'Risk scoring service returned no result.'
      );
    }

    profile.riskLevel =
      risk.level || 'unknown';

    profile.riskScore =
      Number.isFinite(
        Number(risk.score)
      )
        ? Number(risk.score)
        : null;

    profile.riskAssessedAt =
      this._now();

    profile.updatedAt =
      this._now();

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.audit(
      tenantId,
      customerId,
      'KYC_RISK_ASSESSED',
      {
        riskLevel:
          profile.riskLevel,
        riskScore:
          profile.riskScore,
      }
    );

    this._emitEvent(
      'kyc.risk.assessed',
      {
        tenantId,
        customerId,
        risk,
      }
    );

    return risk;
  }

  // ===========================================================================
  // Approval Eligibility
  // ===========================================================================

  async evaluateApprovalEligibility(
    profile
  ) {
    const failures = [];

    if (
      this.config.requireIdentityForApproval &&
      !profile.identity
    ) {
      failures.push(
        'IDENTITY_NOT_SUBMITTED'
      );
    }

    if (
      this.config
        .requireIdentityVerificationForApproval &&
      profile.identityVerification?.verified !==
        true
    ) {
      failures.push(
        'IDENTITY_NOT_VERIFIED'
      );
    }

    if (
      this.config.requireScreeningForApproval &&
      !profile.screening
    ) {
      failures.push(
        'SCREENING_NOT_COMPLETED'
      );
    }

    if (
      this.config.requireRiskAssessmentForApproval &&
      !Number.isFinite(
        Number(profile.riskScore)
      )
    ) {
      failures.push(
        'RISK_ASSESSMENT_NOT_COMPLETED'
      );
    }

    if (
      this.config.highRiskBlockApproval &&
      (
        profile.riskLevel === 'high' ||
        Number(profile.riskScore) >
          this.config.maxApprovalRiskScore
      )
    ) {
      failures.push(
        'HIGH_RISK_CUSTOMER'
      );
    }

    const sanctionsMatches =
      profile.screening
        ?.sanctions
        ?.matches || [];

    if (
      sanctionsMatches.length > 0
    ) {
      failures.push(
        'SANCTIONS_MATCH'
      );
    }

    return {
      eligible:
        failures.length === 0,
      failures,
    };
  }

  // ===========================================================================
  // Approve KYC
  // ===========================================================================

  async approve({
    tenantId,
    customerId,
    approvedBy,
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    this._assertString(
      approvedBy,
      'approvedBy',
      {
        required: true,
        maxLength: 200,
      }
    );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'KYC profile not found.'
      );
    }

    const eligibility =
      await this.evaluateApprovalEligibility(
        profile
      );

    if (!eligibility.eligible) {
      throw new Error(
        `KYC approval requirements not satisfied: ${eligibility.failures.join(', ')}`
      );
    }

    this._assertTransition(
      profile.status,
      'approved'
    );

    const now =
      this._now();

    profile.status =
      'approved';

    profile.approvedBy =
      approvedBy;

    profile.approvedAt =
      now;

    profile.expiresAt =
      this._calculateExpiryDate(
        now,
        this.config.expiryMonths
      );

    profile.verificationLevel =
      3;

    profile.updatedAt =
      now;

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.notificationService?.send({
      tenantId,
      customerId,
      type: 'kyc_approved',
    });

    await this.audit(
      tenantId,
      customerId,
      'KYC_APPROVED',
      {
        profileId: profile.id,
        approvedBy,
        riskLevel:
          profile.riskLevel,
        riskScore:
          profile.riskScore,
        expiresAt:
          profile.expiresAt,
      }
    );

    await this._recordMetric(
      'kyc_approvals_total',
      1,
      { tenantId }
    );

    this._emitEvent(
      'kyc.approved',
      profile
    );

    return profile;
  }

  // ===========================================================================
  // Reject KYC
  // ===========================================================================

  async reject({
    tenantId,
    customerId,
    reason,
    rejectedBy,
  } = {}) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    this._assertString(
      reason,
      'reason',
      {
        required: true,
        maxLength: 1000,
      }
    );

    this._assertString(
      rejectedBy,
      'rejectedBy',
      {
        required: true,
        maxLength: 200,
      }
    );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'KYC profile not found.'
      );
    }

    this._assertTransition(
      profile.status,
      'rejected'
    );

    const now =
      this._now();

    profile.status =
      'rejected';

    profile.rejectionReason =
      reason;

    profile.rejectedBy =
      rejectedBy;

    profile.rejectedAt =
      now;

    profile.updatedAt =
      now;

    await this.db.kycProfiles.update(
      profile.id,
      profile
    );

    await this.invalidateCache(
      tenantId,
      customerId
    );

    await this.notificationService?.send({
      tenantId,
      customerId,
      type: 'kyc_rejected',
      reason,
    });

    await this.audit(
      tenantId,
      customerId,
      'KYC_REJECTED',
      {
        profileId: profile.id,
        rejectedBy,
        reason,
      }
    );

    await this._recordMetric(
      'kyc_rejections_total',
      1,
      { tenantId }
    );

    this._emitEvent(
      'kyc.rejected',
      {
        profile,
        reason,
      }
    );

    return profile;
  }

  // ===========================================================================
  // Expiry & Reverification
  // ===========================================================================

  async processExpirations(
    options = {}
  ) {
    const now =
      this._now();

    const batchSize =
      Number(
        options.batchSize ||
        this.config.expirationBatchSize
      );

    const query = {
      status: 'approved',
      expiresAt: {
        $lte: now,
      },
    };

    const profiles =
      await this.db.kycProfiles.find(
        query,
        {
          limit: batchSize,
        }
      );

    let processed = 0;
    let failed = 0;

    for (const profile of profiles) {
      try {
        this._assertTransition(
          profile.status,
          'expired'
        );

        profile.status =
          'expired';

        profile.expiredAt =
          now;

        profile.updatedAt =
          now;

        await this.db.kycProfiles.update(
          profile.id,
          profile
        );

        await this.invalidateCache(
          profile.tenantId,
          profile.customerId
        );

        if (this.queueService) {
          await this.queueService.enqueue(
            'kyc-reverification',
            {
              tenantId:
                profile.tenantId,
              customerId:
                profile.customerId,
              profileId:
                profile.id,
            }
          );
        }

        await this.audit(
          profile.tenantId,
          profile.customerId,
          'KYC_EXPIRED',
          {
            profileId:
              profile.id,
            expiredAt:
              now,
          }
        );

        this._emitEvent(
          'kyc.expired',
          profile
        );

        processed += 1;
      } catch (error) {
        failed += 1;

        this.logger.error(
          'KYC expiration processing failed',
          {
            profileId:
              profile.id,
            tenantId:
              profile.tenantId,
            error:
              error.message,
          }
        );
      }
    }

    await this._recordMetric(
      'kyc_expirations_processed_total',
      processed
    );

    return {
      processed,
      failed,
      hasMore:
        profiles.length >=
        batchSize,
      processedAt: now,
    };
  }

  // ===========================================================================
  // Reverification
  // ===========================================================================

  async initiateReverification(
    tenantId,
    customerId
  ) {
    this._assertTenantContext(
      tenantId,
      customerId
    );

    const profile =
      await this.getProfile(
        tenantId,
        customerId
      );

    if (!profile) {
      throw new Error(
        'KYC profile not found.'
      );
    }

    if (
      profile.status !== 'expired' &&
      profile.status !== 'rejected'
    ) {
      throw new Error(
        'KYC reverification is only available for expired or rejected profiles.'
      );
    }

    const updated =
      await this._setProfileStatus(
        profile,
        'pending',
        {
          reverificationRequestedAt:
            this._now(),
        }
      );

    await this.audit(
      tenantId,
      customerId,
      'KYC_REVERIFICATION_INITIATED',
      {
        profileId:
          profile.id,
      }
    );

    this._emitEvent(
      'kyc.reverification.initiated',
      {
        tenantId,
        customerId,
        profileId:
          profile.id,
      }
    );

    return updated;
  }

  // ===========================================================================
  // Queue Helpers
  // ===========================================================================

  async _enqueueScreening(
    tenantId,
    customerId
  ) {
    if (
      !this.queueService ||
      !this.config.enqueueScreening
    ) {
      return null;
    }

    try {
      return await this.queueService.enqueue(
        'kyc-screening',
        {
          tenantId,
          customerId,
        }
      );
    } catch (error) {
      this.logger.error(
        'Failed to enqueue KYC screening',
        {
          tenantId,
          customerId,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  async _enqueueOCR(
    tenantId,
    customerId,
    documentId
  ) {
    if (
      !this.queueService
    ) {
      return null;
    }

    try {
      return await this.queueService.enqueue(
        'kyc-ocr',
        {
          tenantId,
          customerId,
          documentId,
        }
      );
    } catch (error) {
      this.logger.error(
        'Failed to enqueue KYC OCR',
        {
          tenantId,
          customerId,
          documentId,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  // ===========================================================================
  // Expiry Calculation
  // ===========================================================================

  _calculateExpiryDate(
    startDate,
    months
  ) {
    const date =
      new Date(startDate);

    const originalDay =
      date.getDate();

    date.setMonth(
      date.getMonth() + months
    );

    /**
     * Correct month overflow such as:
     * January 31 + 1 month.
     */
    if (
      date.getDate() !==
      originalDay
    ) {
      date.setDate(0);
    }

    return date;
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  async getMetrics(
    tenantId = null
  ) {
    const scope =
      tenantId
        ? { tenantId }
        : {};

    const [
      approved,
      pending,
      rejected,
      expired,
      submitted,
      underReview,
    ] = await Promise.all([
      this.db.kycProfiles.count({
        ...scope,
        status: 'approved',
      }),

      this.db.kycProfiles.count({
        ...scope,
        status: 'pending',
      }),

      this.db.kycProfiles.count({
        ...scope,
        status: 'rejected',
      }),

      this.db.kycProfiles.count({
        ...scope,
        status: 'expired',
      }),

      this.db.kycProfiles.count({
        ...scope,
        status: 'submitted',
      }),

      this.db.kycProfiles.count({
        ...scope,
        status: 'under_review',
      }),
    ]);

    return {
      approved,
      pending,
      rejected,
      expired,
      submitted,
      underReview,

      total:
        approved +
        pending +
        rejected +
        expired +
        submitted +
        underReview,
    };
  }

  // ===========================================================================
  // Cache
  // ===========================================================================

  async invalidateCache(
    tenantId,
    customerId
  ) {
    if (!this.cache) {
      return;
    }

    const cacheKey =
      this._profileCacheKey(
        tenantId,
        customerId
      );

    try {
      await this.cache.del(
        cacheKey
      );
    } catch (error) {
      this.logger.warn(
        'KYC cache invalidation failed',
        {
          tenantId,
          customerId,
          error:
            error.message,
        }
      );
    }
  }

  // ===========================================================================
  // Audit
  // ===========================================================================

  async audit(
    tenantId,
    customerId,
    action,
    payload = {}
  ) {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.log({
        tenantId,
        customerId,
        action,
        payload,
        timestamp:
          this._now(),
      });
    } catch (error) {
      /**
       * Audit failures should never silently disappear,
       * but they should not destroy an already-completed
       * KYC operation unless the caller explicitly configures
       * fail-closed audit behavior at a higher layer.
       */
      this.logger.error(
        'KYC audit failed',
        {
          tenantId,
          customerId,
          action,
          error:
            error.message,
        }
      );
    }
  }
}

module.exports =
  KYCService;