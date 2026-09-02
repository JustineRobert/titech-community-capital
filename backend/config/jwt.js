'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/jwt.js
 *
 * Purpose:
 *   Enterprise production-grade JWT configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize JWT configuration.
 *   - Define access/refresh token policy.
 *   - Validate JWT configuration.
 *   - Enforce production secret requirements.
 *   - Support asymmetric and symmetric signing algorithms.
 *   - Support issuer/audience validation.
 *   - Support token lifetime configuration.
 *   - Support key rotation metadata.
 *   - Support clock-skew tolerance.
 *   - Provide safe diagnostics without exposing secrets.
 *   - Integrate with configProvider/bootstrap configuration.
 *
 * IMPORTANT:
 *
 *   This file defines JWT CONFIGURATION AND POLICY ONLY.
 *
 *   It does NOT:
 *     - issue JWTs.
 *     - verify JWTs.
 *     - decode tokens.
 *     - authenticate requests.
 *     - refresh tokens.
 *     - revoke sessions.
 *     - persist refresh-token state.
 *     - implement authorization.
 *
 * Runtime implementation belongs in the authentication/token service.
 *
 * =============================================================================
 *
 * Canonical architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   defaults.js
 *       ↓
 *   config/index.js
 *       ↓
 *   config/jwt.js
 *       ↓
 *   authentication/token service
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider =
    null;

try {

    // eslint-disable-next-line global-require
    configProvider =
        require('./configProvider');

} catch {

    configProvider =
        null;

}

/**
 * =============================================================================
 * Optional startup error integration
 * =============================================================================
 */

let startupErrors =
    null;

try {

    // eslint-disable-next-line global-require
    startupErrors =
        require('../bootstrap/startupErrors');

} catch {

    startupErrors =
        null;

}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {

    // eslint-disable-next-line global-require
    loggerModule =
        require('../utils/logger');

} catch {

    loggerModule =
        null;

}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'jwt-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

/**
 * =============================================================================
 * Supported JWT algorithms
 * =============================================================================
 *
 * HS*:
 *   Symmetric secret signing.
 *
 * RS*:
 *   RSA asymmetric signing.
 *
 * ES*:
 *   ECDSA asymmetric signing.
 *
 * EdDSA:
 *   Ed25519/Ed448 support where supported by the JWT implementation.
 *
 * The configuration defaults to HS256 for compatibility, but production
 * deployments should strongly prefer an asymmetric algorithm when an external
 * authorization ecosystem or multi-service verification boundary exists.
 * =============================================================================
 */

const JWT_ALGORITHMS =
    Object.freeze([
        'HS256',
        'HS384',
        'HS512',
        'RS256',
        'RS384',
        'RS512',
        'PS256',
        'PS384',
        'PS512',
        'ES256',
        'ES384',
        'ES512',
        'EdDSA',
    ]);

/**
 * =============================================================================
 * Algorithm families
 * =============================================================================
 */

const JWT_ALGORITHM_FAMILIES =
    Object.freeze({
        SYMMETRIC:
            'symmetric',

        RSA:
            'rsa',

        ECDSA:
            'ecdsa',

        EDDSA:
            'eddsa',
    });

/**
 * =============================================================================
 * Token types
 * =============================================================================
 */

const JWT_TOKEN_TYPES =
    Object.freeze({
        ACCESS:
            'access',

        REFRESH:
            'refresh',

        EMAIL_VERIFICATION:
            'email_verification',

        PASSWORD_RESET:
            'password_reset',

        PHONE_VERIFICATION:
            'phone_verification',

        INVITATION:
            'invitation',

        SERVICE:
            'service',
    });

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({
        enabled:
            true,

        algorithm:
            'HS256',

        accessTokenTtlSeconds:
            900,

        refreshTokenTtlSeconds:
            2_592_000,

        emailVerificationTtlSeconds:
            900,

        passwordResetTtlSeconds:
            900,

        phoneVerificationTtlSeconds:
            900,

        invitationTtlSeconds:
            86_400,

        serviceTokenTtlSeconds:
            900,

        clockToleranceSeconds:
            5,

        issuer:
            APPLICATION_NAME,

        audience:
            SERVICE_NAME,

        subjectRequired:
            true,

        issuerRequired:
            true,

        audienceRequired:
            true,

        expirationRequired:
            true,

        notBeforeRequired:
            false,

        jwtIdRequired:
            true,

        accessTokenTypeRequired:
            true,

        refreshTokenTypeRequired:
            true,

        refreshRotationEnabled:
            true,

        refreshReuseDetection:
            true,

        refreshReuseLimit:
            1,

        allowRefreshTokenReuse:
            false,

        allowExpiredRefresh:
            false,

        allowNoneAlgorithm:
            false,

        allowUnsecuredTokens:
            false,

        allowMissingIssuer:
            false,

        allowMissingAudience:
            false,

        includeIssuedAt:
            true,

        includeJwtId:
            true,

        includeTokenType:
            true,

        includeSessionId:
            true,

        includeTenantId:
            true,

        includeOrganizationId:
            true,

        includeActorId:
            true,

        includeDeviceId:
            true,

        includeRoles:
            true,

        includePermissions:
            true,

        maxRoles:
            100,

        maxPermissions:
            500,

        maxTokenSizeBytes:
            16 * 1024,

        keyRotationEnabled:
            true,

        currentKeyId:
            'primary',

        keyGracePeriodSeconds:
            86_400,

        minimumSecretBytes:
            32,

        productionRequireSecret:
            true,

        productionRequireAsymmetric:
            false,

        verifyIssuer:
            true,

        verifyAudience:
            true,

        verifySubject:
            true,

        verifyJwtId:
            true,

        verifyTokenType:
            true,

        verifyTenant:
            false,

        requireTenantForFinancialOperations:
            true,

        bindRefreshTokenToSession:
            true,

        bindRefreshTokenToDevice:
            false,

        bindRefreshTokenToIp:
            false,

        deterministicJti:
            false,

        diagnosticsEnabled:
            true,

        exposeSecretMetadata:
            false,

        failClosedOnConfigurationError:
            true,
    });

/**
 * =============================================================================
 * Claim names
 * =============================================================================
 */

const JWT_CLAIMS =
    Object.freeze({
        issuer:
            'iss',

        subject:
            'sub',

        audience:
            'aud',

        expiration:
            'exp',

        notBefore:
            'nbf',

        issuedAt:
            'iat',

        jwtId:
            'jti',

        tokenType:
            'typ',

        sessionId:
            'sid',

        tenantId:
            'tid',

        organizationId:
            'oid',

        actorId:
            'aid',

        deviceId:
            'did',

        roles:
            'roles',

        permissions:
            'permissions',
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class JwtConfigError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'JwtConfigError';

        this.code =
            options.code ||
            'JWT_CONFIG_ERROR';

        this.field =
            options.field ||
            null;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            JwtConfigError,
        );

    }

}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function asBoolean(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;

    }

    if (
        typeof value ===
        'boolean'
    ) {

        return value;

    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        [
            '1',
            'true',
            'yes',
            'on',
            'enabled',
        ].includes(
            normalized,
        )
    ) {

        return true;

    }

    if (
        [
            '0',
            'false',
            'no',
            'off',
            'disabled',
        ].includes(
            normalized,
        )
    ) {

        return false;

    }

    return fallback;

}

function asPositiveInteger(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;

    }

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(
            parsed,
        ) ||
        parsed <= 0
    ) {

        return fallback;

    }

    return parsed;

}

function asNonNegativeInteger(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;

    }

    const parsed =
        Number(
            value,
        );

    if (
        !Number.isInteger(
            parsed,
        ) ||
        parsed < 0
    ) {

        return fallback;

    }

    return parsed;

}

function asString(
    value,
    fallback,
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(
            value,
        ).trim();

    return (
        normalized ||
        fallback
    );

}

function asList(
    value,
    fallback = [],
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return [
            ...fallback,
        ];

    }

    const values =
        Array.isArray(
            value,
        )
            ? value
            : String(
                value,
            ).split(',');

    return [
        ...new Set(
            values
                .map(
                    item =>
                        String(
                            item,
                        ).trim(),
                )
                .filter(
                    Boolean,
                ),
        ),
    ];

}

function deepFreeze(
    object,
    seen = new WeakSet(),
) {

    if (
        object === null ||
        object === undefined ||
        typeof object !==
            'object'
    ) {

        return object;

    }

    if (
        seen.has(
            object,
        )
    ) {

        return object;

    }

    seen.add(
        object,
    );

    for (
        const key of
        Reflect.ownKeys(
            object,
        )
    ) {

        try {

            deepFreeze(
                object[key],
                seen,
            );

        } catch {

            // Best effort.

        }

    }

    try {

        Object.freeze(
            object,
        );

    } catch {

        // Best effort.

    }

    return object;

}

function getEnvironment() {

    try {

        if (
            typeof configProvider?.getEnvironment ===
                'function'
        ) {

            return configProvider.getEnvironment();

        }

        if (
            typeof configProvider?.get ===
                'function'
        ) {

            return configProvider.get(
                'app.environment',
                process.env.NODE_ENV ||
                    'development',
            );

        }

    } catch {

        // Fall through.

    }

    return (
        process.env.NODE_ENV ||
        'development'
    );

}

function isProduction() {

    return (
        getEnvironment() ===
        'production'
    );

}

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule
        );

    } catch {

        return null;

    }

}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            logger &&
            typeof logger[level] ===
                'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );

            return;

        }

    } catch {

        // Best effort.

    }

}

/**
 * =============================================================================
 * Environment access
 * =============================================================================
 */

function env(
    key,
    fallback = undefined,
) {

    const value =
        process.env[key];

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return fallback;

    }

    return String(
        value,
    ).trim();

}

/**
 * =============================================================================
 * Algorithm helpers
 * =============================================================================
 */

function getAlgorithmFamily(
    algorithm,
) {

    if (
        /^HS\d+$/i.test(
            algorithm,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .SYMMETRIC;

    }

    if (
        /^RS\d+$/i.test(
            algorithm,
        ) ||
        /^PS\d+$/i.test(
            algorithm,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .RSA;

    }

    if (
        /^ES\d+$/i.test(
            algorithm,
        )
    ) {

        return JWT_ALGORITHM_FAMILIES
            .ECDSA;

    }

    if (
        algorithm ===
        'EdDSA'
    ) {

        return JWT_ALGORITHM_FAMILIES
            .EDDSA;

    }

    return null;

}

function isSymmetricAlgorithm(
    algorithm,
) {

    return (
        getAlgorithmFamily(
            algorithm,
        ) ===
        JWT_ALGORITHM_FAMILIES
            .SYMMETRIC
    );

}

function isAsymmetricAlgorithm(
    algorithm,
) {

    return !isSymmetricAlgorithm(
        algorithm,
    );

}

/**
 * =============================================================================
 * Secret / key helpers
 * =============================================================================
 */

function getConfiguredSecret(
    source,
) {

    return (
        source.secret ||
        env(
            'JWT_SECRET',
        ) ||
        null
    );

}

function getConfiguredPrivateKey(
    source,
) {

    return (
        source.privateKey ||
        env(
            'JWT_PRIVATE_KEY',
        ) ||
        env(
            'JWT_PRIVATE_KEY_BASE64',
        ) ||
        null
    );

}

function getConfiguredPublicKey(
    source,
) {

    return (
        source.publicKey ||
        env(
            'JWT_PUBLIC_KEY',
        ) ||
        env(
            'JWT_PUBLIC_KEY_BASE64',
        ) ||
        null
    );

}

function decodeBase64KeyIfNeeded(
    value,
) {

    if (
        !value
    ) {

        return null;

    }

    const normalized =
        String(
            value,
        ).trim();

    /**
     * PEM values should remain untouched.
     */
    if (
        normalized.includes(
            '-----BEGIN',
        )
    ) {

        return normalized;

    }

    /**
     * Only attempt base64 if explicitly marked by common PEM/base64 format.
     */
    try {

        const decoded =
            Buffer.from(
                normalized,
                'base64',
            ).toString(
                'utf8',
            );

        if (
            decoded.includes(
                '-----BEGIN',
            )
        ) {

            return decoded;

        }

    } catch {

        // Fall through.

    }

    return normalized;

}

function getSecretEntropyBits(
    secret,
) {

    if (
        !secret
    ) {

        return 0;

    }

    return (
        Buffer.byteLength(
            String(
                secret,
            ),
            'utf8',
        ) *
        8
    );

}

function getSecretMetadata(
    secret,
) {

    if (
        !secret
    ) {

        return {
            configured:
                false,

            byteLength:
                0,

            entropyBits:
                0,
        };

    }

    return {
        configured:
            true,

        byteLength:
            Buffer.byteLength(
                String(
                    secret,
                ),
                'utf8',
            ),

        entropyBits:
            getSecretEntropyBits(
                secret,
            ),
    };

}

/**
 * =============================================================================
 * Key ID
 * =============================================================================
 */

function normalizeKeyId(
    value,
) {

    return (
        String(
            value ||
                'primary',
        )
            .trim()
            .replace(
                /[^a-zA-Z0-9._-]/g,
                '-',
            )
            .slice(
                0,
                128,
        ) ||
        'primary'
    );

}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createJwtConfig(
    input = {},
) {

    const source =
        input.jwt ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const algorithm =
        asString(
            source.algorithm,
            env(
                'JWT_ALGORITHM',
                DEFAULTS.algorithm,
            ),
        ).toUpperCase();

    const secret =
        getConfiguredSecret(
            source,
        );

    const privateKey =
        decodeBase64KeyIfNeeded(
            getConfiguredPrivateKey(
                source,
            ),
        );

    const publicKey =
        decodeBase64KeyIfNeeded(
            getConfiguredPublicKey(
                source,
            ),
        );

    const issuer =
        asString(
            source.issuer,
            env(
                'JWT_ISSUER',
                DEFAULTS.issuer,
            ),
        );

    const audience =
        asList(
            source.audience ||
                env(
                    'JWT_AUDIENCE',
                ) ||
                DEFAULTS.audience,
            Array.isArray(
                DEFAULTS.audience,
            )
                ? DEFAULTS.audience
                : [
                    DEFAULTS.audience,
                ],
        );

    const config =
        {

            component:
                COMPONENT,

            serviceName:
                asString(
                    source.serviceName,
                    SERVICE_NAME,
                ),

            applicationName:
                asString(
                    source.applicationName,
                    APPLICATION_NAME,
                ),

            environment,

            enabled:
                source.enabled ??
                asBoolean(
                    env(
                        'JWT_ENABLED',
                    ),
                    DEFAULTS.enabled,
                ),

            algorithm,

            algorithmFamily:
                getAlgorithmFamily(
                    algorithm,
                ),

            signing:
                {
                    secret:
                        isSymmetricAlgorithm(
                            algorithm,
                        )
                            ? secret
                            : null,

                    privateKey:
                        isSymmetricAlgorithm(
                            algorithm,
                        )
                            ? null
                            : privateKey,

                    publicKey:
                        isSymmetricAlgorithm(
                            algorithm,
                        )
                            ? null
                            : publicKey,

                    keyId:
                        normalizeKeyId(
                            source.keyId ||
                                env(
                                    'JWT_KEY_ID',
                                ) ||
                                DEFAULTS.currentKeyId,
                        ),

                    currentKeyId:
                        normalizeKeyId(
                            source.currentKeyId ||
                                env(
                                    'JWT_CURRENT_KEY_ID',
                                ) ||
                                DEFAULTS.currentKeyId,
                        ),

                    rotationEnabled:
                        source.keyRotationEnabled ??
                        asBoolean(
                            env(
                                'JWT_KEY_ROTATION_ENABLED',
                            ),
                            DEFAULTS.keyRotationEnabled,
                        ),

                    gracePeriodSeconds:
                        asPositiveInteger(
                            source.keyGracePeriodSeconds ??
                                env(
                                    'JWT_KEY_GRACE_PERIOD_SECONDS',
                                ),
                            DEFAULTS.keyGracePeriodSeconds,
                        ),
                },

            accessToken:
                {
                    ttlSeconds:
                        asPositiveInteger(
                            source.accessTokenTtlSeconds ??
                                env(
                                    'JWT_ACCESS_TTL_SECONDS',
                                ),
                            DEFAULTS.accessTokenTtlSeconds,
                        ),

                    type:
                        JWT_TOKEN_TYPES.ACCESS,

                    requireType:
                        source.accessTokenTypeRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_ACCESS_TOKEN_TYPE',
                            ),
                            DEFAULTS.accessTokenTypeRequired,
                        ),
                },

            refreshToken:
                {
                    ttlSeconds:
                        asPositiveInteger(
                            source.refreshTokenTtlSeconds ??
                                env(
                                    'JWT_REFRESH_TTL_SECONDS',
                                ),
                            DEFAULTS.refreshTokenTtlSeconds,
                        ),

                    type:
                        JWT_TOKEN_TYPES.REFRESH,

                    requireType:
                        source.refreshTokenTypeRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_REFRESH_TOKEN_TYPE',
                            ),
                            DEFAULTS.refreshTokenTypeRequired,
                        ),

                    rotationEnabled:
                        source.refreshRotationEnabled ??
                        asBoolean(
                            env(
                                'JWT_REFRESH_ROTATION_ENABLED',
                            ),
                            DEFAULTS.refreshRotationEnabled,
                        ),

                    reuseDetection:
                        source.refreshReuseDetection ??
                        asBoolean(
                            env(
                                'JWT_REFRESH_REUSE_DETECTION',
                            ),
                            DEFAULTS.refreshReuseDetection,
                        ),

                    reuseLimit:
                        asNonNegativeInteger(
                            source.refreshReuseLimit ??
                                env(
                                    'JWT_REFRESH_REUSE_LIMIT',
                                ),
                            DEFAULTS.refreshReuseLimit,
                        ),

                    allowReuse:
                        source.allowRefreshTokenReuse ??
                        asBoolean(
                            env(
                                'JWT_ALLOW_REFRESH_REUSE',
                            ),
                            DEFAULTS.allowRefreshTokenReuse,
                        ),

                    allowExpired:
                        source.allowExpiredRefresh ??
                        asBoolean(
                            env(
                                'JWT_ALLOW_EXPIRED_REFRESH',
                            ),
                            DEFAULTS.allowExpiredRefresh,
                        ),

                    bindToSession:
                        source.bindRefreshTokenToSession ??
                        asBoolean(
                            env(
                                'JWT_BIND_REFRESH_TO_SESSION',
                            ),
                            DEFAULTS.bindRefreshTokenToSession,
                        ),

                    bindToDevice:
                        source.bindRefreshTokenToDevice ??
                        asBoolean(
                            env(
                                'JWT_BIND_REFRESH_TO_DEVICE',
                            ),
                            DEFAULTS.bindRefreshTokenToDevice,
                        ),

                    bindToIp:
                        source.bindRefreshTokenToIp ??
                        asBoolean(
                            env(
                                'JWT_BIND_REFRESH_TO_IP',
                            ),
                            DEFAULTS.bindRefreshTokenToIp,
                        ),
                },

            verification:
                {
                    clockToleranceSeconds:
                        asNonNegativeInteger(
                            source.clockToleranceSeconds ??
                                env(
                                    'JWT_CLOCK_TOLERANCE_SECONDS',
                                ),
                            DEFAULTS.clockToleranceSeconds,
                        ),

                    requireSubject:
                        source.subjectRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_SUBJECT',
                            ),
                            DEFAULTS.subjectRequired,
                        ),

                    requireIssuer:
                        source.issuerRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_ISSUER',
                            ),
                            DEFAULTS.issuerRequired,
                        ),

                    requireAudience:
                        source.audienceRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_AUDIENCE',
                            ),
                            DEFAULTS.audienceRequired,
                        ),

                    requireExpiration:
                        source.expirationRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_EXPIRATION',
                            ),
                            DEFAULTS.expirationRequired,
                        ),

                    requireNotBefore:
                        source.notBeforeRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_NOT_BEFORE',
                            ),
                            DEFAULTS.notBeforeRequired,
                        ),

                    requireJwtId:
                        source.jwtIdRequired ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_JTI',
                            ),
                            DEFAULTS.jwtIdRequired,
                        ),

                    verifyIssuer:
                        source.verifyIssuer ??
                        asBoolean(
                            env(
                                'JWT_VERIFY_ISSUER',
                            ),
                            DEFAULTS.verifyIssuer,
                        ),

                    verifyAudience:
                        source.verifyAudience ??
                        asBoolean(
                            env(
                                'JWT_VERIFY_AUDIENCE',
                            ),
                            DEFAULTS.verifyAudience,
                        ),

                    verifySubject:
                        source.verifySubject ??
                        asBoolean(
                            env(
                                'JWT_VERIFY_SUBJECT',
                            ),
                            DEFAULTS.verifySubject,
                        ),

                    verifyJwtId:
                        source.verifyJwtId ??
                        asBoolean(
                            env(
                                'JWT_VERIFY_JTI',
                            ),
                            DEFAULTS.verifyJwtId,
                        ),

                    verifyTokenType:
                        source.verifyTokenType ??
                        asBoolean(
                            env(
                                'JWT_VERIFY_TOKEN_TYPE',
                            ),
                            DEFAULTS.verifyTokenType,
                        ),

                    verifyTenant:
                        source.verifyTenant ??
                        asBoolean(
                            env(
                                'JWT_VERIFY_TENANT',
                            ),
                            DEFAULTS.verifyTenant,
                        ),
                },

            claims:
                {
                    issuer,

                    audience,

                    includeIssuedAt:
                        source.includeIssuedAt ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_IAT',
                            ),
                            DEFAULTS.includeIssuedAt,
                        ),

                    includeJwtId:
                        source.includeJwtId ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_JTI',
                            ),
                            DEFAULTS.includeJwtId,
                        ),

                    includeTokenType:
                        source.includeTokenType ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_TOKEN_TYPE',
                            ),
                            DEFAULTS.includeTokenType,
                        ),

                    includeSessionId:
                        source.includeSessionId ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_SESSION_ID',
                            ),
                            DEFAULTS.includeSessionId,
                        ),

                    includeTenantId:
                        source.includeTenantId ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_TENANT_ID',
                            ),
                            DEFAULTS.includeTenantId,
                        ),

                    includeOrganizationId:
                        source.includeOrganizationId ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_ORGANIZATION_ID',
                            ),
                            DEFAULTS.includeOrganizationId,
                        ),

                    includeActorId:
                        source.includeActorId ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_ACTOR_ID',
                            ),
                            DEFAULTS.includeActorId,
                        ),

                    includeDeviceId:
                        source.includeDeviceId ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_DEVICE_ID',
                            ),
                            DEFAULTS.includeDeviceId,
                        ),

                    includeRoles:
                        source.includeRoles ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_ROLES',
                            ),
                            DEFAULTS.includeRoles,
                        ),

                    includePermissions:
                        source.includePermissions ??
                        asBoolean(
                            env(
                                'JWT_INCLUDE_PERMISSIONS',
                            ),
                            DEFAULTS.includePermissions,
                        ),

                    maxRoles:
                        asPositiveInteger(
                            source.maxRoles ??
                                env(
                                    'JWT_MAX_ROLES',
                                ),
                            DEFAULTS.maxRoles,
                        ),

                    maxPermissions:
                        asPositiveInteger(
                            source.maxPermissions ??
                                env(
                                    'JWT_MAX_PERMISSIONS',
                                ),
                            DEFAULTS.maxPermissions,
                        ),
                },

            specialTokens:
                {
                    emailVerificationTtlSeconds:
                        asPositiveInteger(
                            source.emailVerificationTtlSeconds ??
                                env(
                                    'JWT_EMAIL_VERIFICATION_TTL_SECONDS',
                                ),
                            DEFAULTS.emailVerificationTtlSeconds,
                        ),

                    passwordResetTtlSeconds:
                        asPositiveInteger(
                            source.passwordResetTtlSeconds ??
                                env(
                                    'JWT_PASSWORD_RESET_TTL_SECONDS',
                                ),
                            DEFAULTS.passwordResetTtlSeconds,
                        ),

                    phoneVerificationTtlSeconds:
                        asPositiveInteger(
                            source.phoneVerificationTtlSeconds ??
                                env(
                                    'JWT_PHONE_VERIFICATION_TTL_SECONDS',
                                ),
                            DEFAULTS.phoneVerificationTtlSeconds,
                        ),

                    invitationTtlSeconds:
                        asPositiveInteger(
                            source.invitationTtlSeconds ??
                                env(
                                    'JWT_INVITATION_TTL_SECONDS',
                                ),
                            DEFAULTS.invitationTtlSeconds,
                        ),

                    serviceTokenTtlSeconds:
                        asPositiveInteger(
                            source.serviceTokenTtlSeconds ??
                                env(
                                    'JWT_SERVICE_TOKEN_TTL_SECONDS',
                                ),
                            DEFAULTS.serviceTokenTtlSeconds,
                        ),
                },

            security:
                {
                    allowNoneAlgorithm:
                        source.allowNoneAlgorithm ??
                        asBoolean(
                            env(
                                'JWT_ALLOW_NONE_ALGORITHM',
                            ),
                            DEFAULTS.allowNoneAlgorithm,
                        ),

                    allowUnsecuredTokens:
                        source.allowUnsecuredTokens ??
                        asBoolean(
                            env(
                                'JWT_ALLOW_UNSECURED_TOKENS',
                            ),
                            DEFAULTS.allowUnsecuredTokens,
                        ),

                    allowMissingIssuer:
                        source.allowMissingIssuer ??
                        asBoolean(
                            env(
                                'JWT_ALLOW_MISSING_ISSUER',
                            ),
                            DEFAULTS.allowMissingIssuer,
                        ),

                    allowMissingAudience:
                        source.allowMissingAudience ??
                        asBoolean(
                            env(
                                'JWT_ALLOW_MISSING_AUDIENCE',
                            ),
                            DEFAULTS.allowMissingAudience,
                        ),

                    requireTenantForFinancialOperations:
                        source.requireTenantForFinancialOperations ??
                        asBoolean(
                            env(
                                'JWT_REQUIRE_TENANT_FOR_FINANCIAL_OPERATIONS',
                            ),
                            DEFAULTS.requireTenantForFinancialOperations,
                        ),

                    maximumTokenSizeBytes:
                        asPositiveInteger(
                            source.maxTokenSizeBytes ??
                                env(
                                    'JWT_MAX_TOKEN_SIZE_BYTES',
                                ),
                            DEFAULTS.maxTokenSizeBytes,
                        ),

                    minimumSecretBytes:
                        asPositiveInteger(
                            source.minimumSecretBytes ??
                                env(
                                    'JWT_MIN_SECRET_BYTES',
                                ),
                            DEFAULTS.minimumSecretBytes,
                        ),
                },

            diagnostics:
                {
                    enabled:
                        source.diagnosticsEnabled ??
                        asBoolean(
                            env(
                                'JWT_DIAGNOSTICS_ENABLED',
                            ),
                            DEFAULTS.diagnosticsEnabled,
                        ),

                    exposeSecretMetadata:
                        source.exposeSecretMetadata ??
                        asBoolean(
                            env(
                                'JWT_EXPOSE_SECRET_METADATA',
                            ),
                            DEFAULTS.exposeSecretMetadata,
                        ),
                },

            failClosedOnConfigurationError:
                source.failClosedOnConfigurationError ??
                asBoolean(
                    env(
                        'JWT_FAIL_CLOSED_ON_CONFIGURATION_ERROR',
                    ),
                    DEFAULTS.failClosedOnConfigurationError,
                ),

        };

    return validateJwtConfig(
        config,
    );

}

/**
 * =============================================================================
 * Configuration validation
 * =============================================================================
 */

function validateJwtConfig(
    config,
) {

    const errors =
        [];

    const warnings =
        [];

    /**
     * -------------------------------------------------------------------------
     * Algorithm
     * -------------------------------------------------------------------------
     */

    if (
        !JWT_ALGORITHMS.includes(
            config.algorithm,
        )
    ) {

        errors.push({
            code:
                'JWT_ALGORITHM_UNSUPPORTED',

            field:
                'algorithm',

            message:
                `Unsupported JWT algorithm "${config.algorithm}".`,
        });

    }

    if (
        !config.algorithmFamily
    ) {

        errors.push({
            code:
                'JWT_ALGORITHM_FAMILY_UNKNOWN',

            field:
                'algorithm',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Symmetric signing key
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        isSymmetricAlgorithm(
            config.algorithm,
        )
    ) {

        if (
            isProduction() &&
            DEFAULTS.productionRequireSecret &&
            !config.signing.secret
        ) {

            errors.push({
                code:
                    'JWT_SECRET_MISSING',

                field:
                    'signing.secret',

                message:
                    'TITech production JWT secret is not configured.',
            });

        }

        if (
            config.signing.secret
        ) {

            const length =
                Buffer.byteLength(
                    config.signing.secret,
                    'utf8',
                );

            if (
                length <
                config.security.minimumSecretBytes
            ) {

                errors.push({
                    code:
                        'JWT_SECRET_TOO_SHORT',

                    field:
                        'signing.secret',

                    message:
                        `TITech JWT secret must contain at least ${config.security.minimumSecretBytes} bytes.`,
                });

            }

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Asymmetric signing key
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        isAsymmetricAlgorithm(
            config.algorithm,
        )
    ) {

        if (
            !config.signing.privateKey
        ) {

            errors.push({
                code:
                    'JWT_PRIVATE_KEY_MISSING',

                field:
                    'signing.privateKey',

                message:
                    'TITech asymmetric JWT signing requires a private key.',
            });

        }

        if (
            !config.signing.publicKey
        ) {

            warnings.push({
                code:
                    'JWT_PUBLIC_KEY_MISSING',

                field:
                    'signing.publicKey',

                message:
                    'TITech asymmetric JWT verification key is not configured locally.',
            });

        }

        if (
            config.signing.privateKey
        ) {

            try {

                crypto.createPrivateKey(
                    config.signing.privateKey,
                );

            } catch (
                error
            ) {

                errors.push({
                    code:
                        'JWT_PRIVATE_KEY_INVALID',

                    field:
                        'signing.privateKey',

                    message:
                        'TITech JWT private key could not be parsed.',

                    cause:
                        error.message,
                });

            }

        }

        if (
            config.signing.publicKey
        ) {

            try {

                crypto.createPublicKey(
                    config.signing.publicKey,
                );

            } catch (
                error
            ) {

                errors.push({
                    code:
                        'JWT_PUBLIC_KEY_INVALID',

                    field:
                        'signing.publicKey',

                    message:
                        'TITech JWT public key could not be parsed.',

                    cause:
                        error.message,
                });

            }

        }

    }

    /**
     * -------------------------------------------------------------------------
     * None/unsecured algorithm
     * -------------------------------------------------------------------------
     */

    if (
        config.algorithm ===
            'none' ||
        config.security.allowNoneAlgorithm ||
        config.security.allowUnsecuredTokens
    ) {

        if (
            isProduction()
        ) {

            errors.push({
                code:
                    'JWT_UNSECURED_TOKENS_FORBIDDEN',

                field:
                    'security.allowNoneAlgorithm',

                message:
                    'TITech production JWT configuration cannot permit unsecured tokens.',
            });

        } else {

            warnings.push({
                code:
                    'JWT_UNSECURED_TOKENS_ENABLED',

                message:
                    'Unsecured JWT behavior is enabled outside production.',
            });

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Issuer
     * -------------------------------------------------------------------------
     */

    if (
        config.verification.requireIssuer &&
        !config.claims.issuer &&
        !config.security.allowMissingIssuer
    ) {

        errors.push({
            code:
                'JWT_ISSUER_MISSING',

            field:
                'claims.issuer',

            message:
                'TITech JWT issuer is required.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Audience
     * -------------------------------------------------------------------------
     */

    if (
        config.verification.requireAudience &&
        config.claims.audience.length ===
            0 &&
        !config.security.allowMissingAudience
    ) {

        errors.push({
            code:
                'JWT_AUDIENCE_MISSING',

            field:
                'claims.audience',

            message:
                'TITech JWT audience is required.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Token lifetimes
     * -------------------------------------------------------------------------
     */

    if (
        config.refreshToken.ttlSeconds <=
        config.accessToken.ttlSeconds
    ) {

        warnings.push({
            code:
                'JWT_REFRESH_TTL_NOT_LONGER_THAN_ACCESS',

            message:
                'TITech refresh-token lifetime should generally exceed access-token lifetime.',
        });

    }

    if (
        config.accessToken.ttlSeconds >
        3_600
    ) {

        warnings.push({
            code:
                'JWT_ACCESS_TTL_LONG',

            message:
                'TITech access-token lifetime exceeds one hour.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Refresh security
     * -------------------------------------------------------------------------
     */

    if (
        isProduction() &&
        config.refreshToken.allowReuse
    ) {

        errors.push({
            code:
                'JWT_REFRESH_REUSE_FORBIDDEN',

            field:
                'refreshToken.allowReuse',

            message:
                'TITech production refresh-token reuse is disabled.',
        });

    }

    if (
        isProduction() &&
        !config.refreshToken.rotationEnabled
    ) {

        warnings.push({
            code:
                'JWT_REFRESH_ROTATION_DISABLED',

            field:
                'refreshToken.rotationEnabled',

            message:
                'TITech production refresh-token rotation is disabled.',
        });

    }

    if (
        isProduction() &&
        !config.refreshToken.reuseDetection
    ) {

        warnings.push({
            code:
                'JWT_REFRESH_REUSE_DETECTION_DISABLED',

            field:
                'refreshToken.reuseDetection',

            message:
                'TITech production refresh-token reuse detection is disabled.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Financial tenant requirement
     * -------------------------------------------------------------------------
     */

    if (
        isProduction() &&
        config.security.requireTenantForFinancialOperations &&
        !config.claims.includeTenantId
    ) {

        errors.push({
            code:
                'JWT_FINANCIAL_TENANT_CLAIM_DISABLED',

            field:
                'claims.includeTenantId',

            message:
                'TITech financial operations require tenant context.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Claims size
     * -------------------------------------------------------------------------
     */

    if (
        config.claims.maxRoles <=
            0 ||
        config.claims.maxPermissions <=
            0
    ) {

        errors.push({
            code:
                'JWT_CLAIM_LIMIT_INVALID',

            field:
                'claims',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Errors
     * -------------------------------------------------------------------------
     */

    if (
        errors.length >
        0
    ) {

        const error =
            new JwtConfigError(
                'TITech JWT configuration validation failed.',
                {
                    code:
                        'JWT_CONFIGURATION_INVALID',

                    details: {
                        errors,
                        warnings,
                    },
                },
            );

        if (
            startupErrors?.configurationError
        ) {

            try {

                return startupErrors.configurationError(
                    error.message,
                    {
                        cause:
                            error,

                        critical:
                            config.enabled &&
                            config.failClosedOnConfigurationError,

                        fatal:
                            config.enabled &&
                            config.failClosedOnConfigurationError,

                        details: {
                            component:
                                COMPONENT,

                            errors,
                            warnings,
                        },
                    },
                );

            } catch {

                // Use canonical local error below.

            }

        }

        throw error;

    }

    return deepFreeze({
        ...config,

        warnings:
            Object.freeze(
                warnings,
            ),
    });

}

/**
 * =============================================================================
 * Token policy helpers
 * =============================================================================
 */

function getTokenTtl(
    tokenType,
    config = defaultConfig,
) {

    switch (
        tokenType
    ) {

        case JWT_TOKEN_TYPES.ACCESS:

            return config.accessToken.ttlSeconds;

        case JWT_TOKEN_TYPES.REFRESH:

            return config.refreshToken.ttlSeconds;

        case JWT_TOKEN_TYPES.EMAIL_VERIFICATION:

            return config.specialTokens
                .emailVerificationTtlSeconds;

        case JWT_TOKEN_TYPES.PASSWORD_RESET:

            return config.specialTokens
                .passwordResetTtlSeconds;

        case JWT_TOKEN_TYPES.PHONE_VERIFICATION:

            return config.specialTokens
                .phoneVerificationTtlSeconds;

        case JWT_TOKEN_TYPES.INVITATION:

            return config.specialTokens
                .invitationTtlSeconds;

        case JWT_TOKEN_TYPES.SERVICE:

            return config.specialTokens
                .serviceTokenTtlSeconds;

        default:

            return config.accessToken.ttlSeconds;

    }

}

function isFinancialToken(
    tokenType,
) {

    return [
        JWT_TOKEN_TYPES.ACCESS,
        JWT_TOKEN_TYPES.REFRESH,
        JWT_TOKEN_TYPES.SERVICE,
    ].includes(
        tokenType,
    );

}

/**
 * =============================================================================
 * Claim policy
 * =============================================================================
 */

function getClaimPolicy(
    config = defaultConfig,
) {

    return deepFreeze({

        issuer:
            {
                required:
                    config.verification
                        .requireIssuer,

                value:
                    config.claims
                        .issuer,
            },

        audience:
            {
                required:
                    config.verification
                        .requireAudience,

                values:
                    [
                        ...config.claims
                            .audience,
                    ],
            },

        subject:
            {
                required:
                    config.verification
                        .requireSubject,
            },

        expiration:
            {
                required:
                    config.verification
                        .requireExpiration,
            },

        notBefore:
            {
                required:
                    config.verification
                        .requireNotBefore,
            },

        jwtId:
            {
                required:
                    config.verification
                        .requireJwtId,

                verified:
                    config.verification
                        .verifyJwtId,
            },

        tokenType:
            {
                included:
                    config.claims
                        .includeTokenType,

                verified:
                    config.verification
                        .verifyTokenType,
            },

        tenant:
            {
                included:
                    config.claims
                        .includeTenantId,

                requiredForFinancial:
                    config.security
                        .requireTenantForFinancialOperations,

                verified:
                    config.verification
                        .verifyTenant,
            },

        roles:
            {
                included:
                    config.claims
                        .includeRoles,

                maximum:
                    config.claims
                        .maxRoles,
            },

        permissions:
            {
                included:
                    config.claims
                        .includePermissions,

                maximum:
                    config.claims
                        .maxPermissions,
            },

    });

}

/**
 * =============================================================================
 * Safe diagnostics
 * =============================================================================
 */

function getSecretDiagnostics(
    config,
) {

    const secret =
        config.signing.secret;

    if (
        !config.diagnostics
            .exposeSecretMetadata
    ) {

        return Object.freeze({
            configured:
                Boolean(
                    secret,
                ),

            keyType:
                isSymmetricAlgorithm(
                    config.algorithm,
                )
                    ? 'symmetric'
                    : 'asymmetric',
        });

    }

    return Object.freeze({
        configured:
            Boolean(
                secret,
            ),

        keyType:
            isSymmetricAlgorithm(
                config.algorithm,
            )
                ? 'symmetric'
                : 'asymmetric',

        byteLength:
            secret
                ? Buffer.byteLength(
                    secret,
                    'utf8',
                )
                : 0,

        entropyBits:
            secret
                ? Buffer.byteLength(
                    secret,
                    'utf8',
                ) * 8
                : 0,
    });

}

function getSnapshot(
    config = defaultConfig,
) {

    return deepFreeze({
        component:
            COMPONENT,

        service:
            config.serviceName,

        application:
            config.applicationName,

        environment:
            config.environment,

        enabled:
            config.enabled,

        algorithm:
            config.algorithm,

        algorithmFamily:
            config.algorithmFamily,

        issuer:
            config.claims
                .issuer,

        audience:
            [
                ...config.claims
                    .audience,
            ],

        accessToken:
            {
                ttlSeconds:
                    config.accessToken
                        .ttlSeconds,

                type:
                    config.accessToken
                        .type,

                requireType:
                    config.accessToken
                        .requireType,
            },

        refreshToken:
            {
                ttlSeconds:
                    config.refreshToken
                        .ttlSeconds,

                type:
                    config.refreshToken
                        .type,

                rotationEnabled:
                    config.refreshToken
                        .rotationEnabled,

                reuseDetection:
                    config.refreshToken
                        .reuseDetection,

                bindToSession:
                    config.refreshToken
                        .bindToSession,

                bindToDevice:
                    config.refreshToken
                        .bindToDevice,

                bindToIp:
                    config.refreshToken
                        .bindToIp,
            },

        verification:
            {
                clockToleranceSeconds:
                    config.verification
                        .clockToleranceSeconds,

                requireSubject:
                    config.verification
                        .requireSubject,

                requireIssuer:
                    config.verification
                        .requireIssuer,

                requireAudience:
                    config.verification
                        .requireAudience,

                requireExpiration:
                    config.verification
                        .requireExpiration,

                requireJwtId:
                    config.verification
                        .requireJwtId,

                verifyIssuer:
                    config.verification
                        .verifyIssuer,

                verifyAudience:
                    config.verification
                        .verifyAudience,

                verifySubject:
                    config.verification
                        .verifySubject,

                verifyJwtId:
                    config.verification
                        .verifyJwtId,

                verifyTokenType:
                    config.verification
                        .verifyTokenType,

                verifyTenant:
                    config.verification
                        .verifyTenant,
            },

        claims:
            {
                includeIssuedAt:
                    config.claims
                        .includeIssuedAt,

                includeJwtId:
                    config.claims
                        .includeJwtId,

                includeTokenType:
                    config.claims
                        .includeTokenType,

                includeSessionId:
                    config.claims
                        .includeSessionId,

                includeTenantId:
                    config.claims
                        .includeTenantId,

                includeOrganizationId:
                    config.claims
                        .includeOrganizationId,

                includeActorId:
                    config.claims
                        .includeActorId,

                includeDeviceId:
                    config.claims
                        .includeDeviceId,

                includeRoles:
                    config.claims
                        .includeRoles,

                includePermissions:
                    config.claims
                        .includePermissions,

                maxRoles:
                    config.claims
                        .maxRoles,

                maxPermissions:
                    config.claims
                        .maxPermissions,
            },

        signing:
            {
                keyId:
                    config.signing
                        .keyId,

                currentKeyId:
                    config.signing
                        .currentKeyId,

                rotationEnabled:
                    config.signing
                        .rotationEnabled,

                gracePeriodSeconds:
                    config.signing
                        .gracePeriodSeconds,

                secret:
                    getSecretDiagnostics(
                        config,
                    ),

                privateKeyConfigured:
                    Boolean(
                        config.signing
                            .privateKey,
                    ),

                publicKeyConfigured:
                    Boolean(
                        config.signing
                            .publicKey,
                    ),
            },

        specialTokenTtls:
            {
                emailVerification:
                    config.specialTokens
                        .emailVerificationTtlSeconds,

                passwordReset:
                    config.specialTokens
                        .passwordResetTtlSeconds,

                phoneVerification:
                    config.specialTokens
                        .phoneVerificationTtlSeconds,

                invitation:
                    config.specialTokens
                        .invitationTtlSeconds,

                service:
                    config.specialTokens
                        .serviceTokenTtlSeconds,
            },

        security:
            {
                allowNoneAlgorithm:
                    config.security
                        .allowNoneAlgorithm,

                allowUnsecuredTokens:
                    config.security
                        .allowUnsecuredTokens,

                requireTenantForFinancialOperations:
                    config.security
                        .requireTenantForFinancialOperations,

                maximumTokenSizeBytes:
                    config.security
                        .maximumTokenSizeBytes,
            },

        warnings:
            [
                ...(config.warnings || []),
            ],

        timestamp:
            new Date()
                .toISOString(),
    });

}

/**
 * =============================================================================
 * Default singleton
 * =============================================================================
 */

const defaultConfig =
    createJwtConfig();

/**
 * =============================================================================
 * Runtime provider
 * ============================================================================= */

class JwtConfigProvider {

    constructor(
        config =
            defaultConfig,
    ) {

        this.config =
            config;

        this.initialized =
            true;

        this.initializedAt =
            new Date();

        this.state =
            'ready';

    }

    getConfig() {

        return this.config;

    }

    getAccessTokenConfig() {

        return this.config
            .accessToken;

    }

    getRefreshTokenConfig() {

        return this.config
            .refreshToken;

    }

    getVerificationConfig() {

        return this.config
            .verification;

    }

    getSigningConfig() {

        return this.config
            .signing;

    }

    getClaimPolicy() {

        return getClaimPolicy(
            this.config,
        );

    }

    getTtl(
        tokenType,
    ) {

        return getTokenTtl(
            tokenType,
            this.config,
        );

    }

    isFinancialToken(
        tokenType,
    ) {

        return isFinancialToken(
            tokenType,
        );

    }

    snapshot() {

        return getSnapshot(
            this.config,
        );

    }

    async start(
        context = {},
    ) {

        if (
            context &&
            typeof context ===
                'object'
        ) {

            context.jwtConfig =
                this.config;

            context.jwt =
                this.config;

        }

        return this.config;

    }

    async bootstrap(
        context = {},
    ) {

        return this.start(
            context,
        );

    }

    reset() {

        this.state =
            'created';

        this.initialized =
            false;

        this.initializedAt =
            null;

        return true;

    }

}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const jwtProvider =
    new JwtConfigProvider();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function getConfig() {

    return jwtProvider
        .getConfig();

}

function getAccessTokenConfig() {

    return jwtProvider
        .getAccessTokenConfig();

}

function getRefreshTokenConfig() {

    return jwtProvider
        .getRefreshTokenConfig();

}

function getVerificationConfig() {

    return jwtProvider
        .getVerificationConfig();

}

function getSigningConfig() {

    return jwtProvider
        .getSigningConfig();

}

function getClaimPolicyPublic() {

    return jwtProvider
        .getClaimPolicy();

}

function getTtl(
    tokenType,
) {

    return jwtProvider
        .getTtl(
            tokenType,
        );

}

function getSnapshotPublic() {

    return jwtProvider
        .snapshot();

}

function initialize(
    options = {},
) {

    const config =
        createJwtConfig(
            options,
        );

    jwtProvider.config =
        config;

    jwtProvider.initialized =
        true;

    jwtProvider.initializedAt =
        new Date();

    jwtProvider.state =
        'ready';

    return config;

}

async function start(
    context = {},
) {

    return jwtProvider.start(
        context,
    );

}

async function bootstrap(
    context = {},
) {

    return jwtProvider.bootstrap(
        context,
    );

}

/**
 * =============================================================================
 * Environment diagnostics
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [
        'JWT_ENABLED',
        'JWT_ALGORITHM',
        'JWT_ACCESS_TTL_SECONDS',
        'JWT_REFRESH_TTL_SECONDS',
        'JWT_ISSUER',
        'JWT_AUDIENCE',
        'JWT_CLOCK_TOLERANCE_SECONDS',
        'JWT_REQUIRE_SUBJECT',
        'JWT_REQUIRE_ISSUER',
        'JWT_REQUIRE_AUDIENCE',
        'JWT_REQUIRE_EXPIRATION',
        'JWT_REQUIRE_JTI',
        'JWT_VERIFY_ISSUER',
        'JWT_VERIFY_AUDIENCE',
        'JWT_VERIFY_SUBJECT',
        'JWT_VERIFY_JTI',
        'JWT_VERIFY_TOKEN_TYPE',
        'JWT_VERIFY_TENANT',
        'JWT_REFRESH_ROTATION_ENABLED',
        'JWT_REFRESH_REUSE_DETECTION',
        'JWT_REFRESH_REUSE_LIMIT',
        'JWT_ALLOW_REFRESH_REUSE',
        'JWT_BIND_REFRESH_TO_SESSION',
        'JWT_BIND_REFRESH_TO_DEVICE',
        'JWT_BIND_REFRESH_TO_IP',
        'JWT_KEY_ID',
        'JWT_CURRENT_KEY_ID',
        'JWT_KEY_ROTATION_ENABLED',
        'JWT_KEY_GRACE_PERIOD_SECONDS',
        'JWT_DIAGNOSTICS_ENABLED',
    ];

    const result =
        {};

    for (
        const key of
        keys
    ) {

        result[key] =
            process.env[key];

    }

    /**
     * Never expose JWT_SECRET/private keys.
     */
    result.JWT_SECRET =
        process.env.JWT_SECRET
            ? '[REDACTED]'
            : undefined;

    result.JWT_PRIVATE_KEY =
        process.env.JWT_PRIVATE_KEY
            ? '[REDACTED]'
            : undefined;

    result.JWT_PRIVATE_KEY_BASE64 =
        process.env.JWT_PRIVATE_KEY_BASE64
            ? '[REDACTED]'
            : undefined;

    result.JWT_PUBLIC_KEY =
        process.env.JWT_PUBLIC_KEY
            ? '[CONFIGURED]'
            : undefined;

    result.JWT_PUBLIC_KEY_BASE64 =
        process.env.JWT_PUBLIC_KEY_BASE64
            ? '[CONFIGURED]'
            : undefined;

    return Object.freeze(
        result,
    );

}

/**
 * =============================================================================
 * Bootstrap lifecycle adapter
 * =============================================================================
 */

function registerBootstrapHooks(
    context = {},
    options = {},
) {

    const {
        hooks,
        lifecycle,
    } =
        require('../bootstrap/hooks');

    if (
        hooks.has(
            COMPONENT,
        )
    ) {

        return hooks.get(
            COMPONENT,
        );

    }

    return lifecycle(
        COMPONENT,
        {
            priority:
                options.priority ??
                -500,

            dependencies:
                options.dependencies ||
                [
                    'logger',
                    'environment',
                    'configuration',
                ],

            critical:
                options.critical ??
                true,

            start:
                async hookContext =>
                    start(
                        {
                            ...(hookContext ||
                                {}),
                            ...(
                                context ||
                                {}),
                        },
                    ),

            ready:
                async () =>
                    jwtProvider
                        .initialized ===
                    true,

            health:
                async () =>
                    ({
                        status:
                            jwtProvider
                                .state ===
                            'ready'
                                ? 'healthy'
                                : 'unhealthy',

                        component:
                            COMPONENT,

                        algorithm:
                            jwtProvider
                                .config
                                .algorithm,

                        timestamp:
                            new Date()
                                .toISOString(),
                    }),

            stop:
                async () => true,

            metadata:
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    implementation:
                        'backend/config/jwt.js',
                },
        },
    );

}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Core.
         */
        config:
            defaultConfig,

        jwt:
            defaultConfig,

        provider:
            jwtProvider,

        jwtProvider,

        JwtConfigProvider,

        JwtConfigError,

        /**
         * Constants.
         */
        JWT_ALGORITHMS,

        JWT_ALGORITHM_FAMILIES,

        JWT_TOKEN_TYPES,

        JWT_CLAIMS,

        DEFAULTS,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * Configuration.
         */
        createJwtConfig,

        validateJwtConfig,

        initialize,

        start,

        bootstrap,

        registerBootstrapHooks,

        /**
         * Accessors.
         */
        getConfig,

        getAccessTokenConfig,

        getRefreshTokenConfig,

        getVerificationConfig,

        getSigningConfig,

        getClaimPolicy:
            getClaimPolicyPublic,

        getTtl,

        isFinancialToken,

        /**
         * Algorithm helpers.
         */
        getAlgorithmFamily,

        isSymmetricAlgorithm,

        isAsymmetricAlgorithm,

        /**
         * Diagnostics.
         */
        getSnapshot:
            getSnapshotPublic,

        getEnvironmentOverrides,

    });