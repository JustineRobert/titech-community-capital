'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/mail.js
 *
 * Purpose:
 *   Enterprise production-grade mail/email configuration and policy boundary.
 *
 * Responsibilities:
 *   - Centralize email provider configuration.
 *   - Support SMTP and API-based mail providers.
 *   - Normalize mail environment variables.
 *   - Validate production mail configuration.
 *   - Define TLS/security policy.
 *   - Define timeout/retry policy.
 *   - Define sender/reply-to defaults.
 *   - Define template/transactional mail behavior.
 *   - Define rate/concurrency controls.
 *   - Support health/readiness integration.
 *   - Provide safe diagnostics without exposing credentials.
 *   - Keep provider implementation separate from configuration.
 *
 * IMPORTANT:
 *
 *   This file owns MAIL CONFIGURATION AND POLICY.
 *
 *   It does NOT:
 *     - send emails.
 *     - create SMTP transports.
 *     - call provider APIs.
 *     - render templates.
 *     - manage queues.
 *     - implement OTP generation.
 *     - implement password reset logic.
 *     - persist audit records.
 *     - implement business workflows.
 *
 * Provider implementation belongs in the mail service/provider layer.
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
 *   config/mail.js
 *       ↓
 *   mail provider/service
 *       ↓
 *   queue / application
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
 *
 * We deliberately do not require a concrete mail implementation or bootstrap
 * logger here to avoid configuration/lifecycle circular dependencies.
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
    'mail-config';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const MAIL_STATES =
    Object.freeze({

        ENABLED:
            'enabled',

        DISABLED:
            'disabled',

        DEGRADED:
            'degraded',

        INVALID:
            'invalid'

    });

const MAIL_PROVIDERS =
    Object.freeze({

        SMTP:
            'smtp',

        SENDGRID:
            'sendgrid',

        MAILGUN:
            'mailgun',

        SES:
            'ses',

        POSTMARK:
            'postmark',

        RESEND:
            'resend',

        CUSTOM:
            'custom',

        NONE:
            'none'

    });

const MAIL_SECURITY_MODES =
    Object.freeze({

        NONE:
            'none',

        STARTTLS:
            'starttls',

        TLS:
            'tls'

    });

const MAIL_MESSAGE_TYPES =
    Object.freeze({

        TRANSACTIONAL:
            'transactional',

        AUTHENTICATION:
            'authentication',

        SECURITY:
            'security',

        NOTIFICATION:
            'notification',

        MARKETING:
            'marketing',

        SYSTEM:
            'system'

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

        required:
            false,

        provider:
            MAIL_PROVIDERS.SMTP,

        host:
            '127.0.0.1',

        port:
            587,

        secure:
            false,

        securityMode:
            MAIL_SECURITY_MODES.STARTTLS,

        requireTls:
            true,

        rejectUnauthorized:
            true,

        connectionTimeoutMs:
            10_000,

        greetingTimeoutMs:
            10_000,

        socketTimeoutMs:
            30_000,

        sendTimeoutMs:
            30_000,

        healthTimeoutMs:
            5_000,

        shutdownTimeoutMs:
            10_000,

        maxConnections:
            5,

        maxMessagesPerConnection:
            100,

        rateLimitPerSecond:
            10,

        retryAttempts:
            3,

        initialRetryDelayMs:
            500,

        maxRetryDelayMs:
            10_000,

        retryJitterRatio:
            0.20,

        queueEnabled:
            true,

        queueName:
            'mail',

        queuePriority:
            5,

        queueConcurrency:
            5,

        queueAttempts:
            3,

        queueBackoffDelayMs:
            1_000,

        queueRemoveOnComplete:
            1_000,

        queueRemoveOnFail:
            5_000,

        defaultFromName:
            APPLICATION_NAME,

        defaultFromAddress:
            'no-reply@example.com',

        replyToName:
            APPLICATION_NAME,

        replyToAddress:
            'support@example.com',

        bounceAddress:
            null,

        defaultLocale:
            'en-US',

        defaultCharset:
            'UTF-8',

        templateDirectory:
            'backend/templates/email',

        templateCacheEnabled:
            true,

        htmlEnabled:
            true,

        textFallbackEnabled:
            true,

        headersEnabled:
            true,

        messageIdEnabled:
            true,

        diagnosticsEnabled:
            true,

        healthChecksEnabled:
            true,

        failOpenForOptionalNotifications:
            true,

        failClosedForSecurityMessages:
            true,

        failClosedForAuthenticationMessages:
            true,

        allowInsecureTls:
            false,

        allowSelfSignedCertificates:
            false,

        allowUnverifiedCertificates:
            false,

        suppressDeliveryErrors:
            false,

        maxRecipientsPerMessage:
            100,

        maxSubjectLength:
            998,

        maxBodyBytes:
            10 * 1024 * 1024,

        dryRun:
            false,

        developmentSinkEnabled:
            false,

        developmentSinkAddress:
            'devnull@example.com'

    });

/**
 * =============================================================================
 * Sensitive fields
 * =============================================================================
 */

const SENSITIVE_KEYS =
    Object.freeze([
        'password',
        'pass',
        'smtpPassword',
        'smtpPass',
        'apiKey',
        'api_key',
        'secret',
        'clientSecret',
        'client_secret',
        'accessKeyId',
        'secretAccessKey',
        'privateKey',
        'token',
        'authorization',
        'sendgridApiKey',
        'mailgunApiKey',
        'postmarkServerToken',
        'resendApiKey',
        'sesSecretAccessKey',
    ]);

const SENSITIVE_PATTERN =
    /(password|passwd|secret|api[_-]?key|token|authorization|private[_-]?key|access[_-]?key|credential)/i;

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class MailConfigError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(
            message,
        );

        this.name =
            'MailConfigError';

        this.code =
            options.code ||
            'MAIL_CONFIG_ERROR';

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
            this.constructor,
        );

    }

}

/**
 * =============================================================================
 * Utility functions
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

function asFloat(
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

    return Number.isFinite(
        parsed,
    )
        ? parsed
        : fallback;

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

    const source =
        Array.isArray(
            value,
        )
            ? value
            : String(
                value,
            ).split(',');

    return [
        ...new Set(
            source
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

function toEnum(
    value,
    allowed,
    fallback,
) {

    const normalized =
        asString(
            value,
            fallback,
        );

    const match =
        allowed.find(
            item =>
                String(
                    item,
                ).toLowerCase() ===
                String(
                    normalized,
                ).toLowerCase(),
        );

    return (
        match ||
        fallback
    );

}

function toPort(
    value,
    fallback,
) {

    const parsed =
        asPositiveInteger(
            value,
            fallback,
        );

    return (
        parsed >= 1 &&
        parsed <= 65_535
    )
        ? parsed
        : fallback;

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

function isProduction() {

    try {

        if (
            typeof configProvider?.isProduction ===
                'function'
        ) {

            return Boolean(
                configProvider.isProduction(),
            );

        }

        if (
            typeof configProvider?.getEnvironment ===
                'function'
        ) {

            return (
                configProvider.getEnvironment() ===
                'production'
            );

        }

    } catch {

        // Fall through.

    }

    return (
        process.env.NODE_ENV ===
        'production'
    );

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

        // Best effort only.

    }

}

/**
 * =============================================================================
 * Provider-specific environment resolution
 * =============================================================================
 */

function getProviderApiKey(
    provider,
    source,
) {

    switch (
        provider
    ) {

        case MAIL_PROVIDERS.SENDGRID:

            return (
                source.apiKey ||
                env(
                    'SENDGRID_API_KEY',
                ) ||
                null
            );

        case MAIL_PROVIDERS.MAILGUN:

            return (
                source.apiKey ||
                env(
                    'MAILGUN_API_KEY',
                ) ||
                null
            );

        case MAIL_PROVIDERS.POSTMARK:

            return (
                source.apiKey ||
                env(
                    'POSTMARK_SERVER_TOKEN',
                ) ||
                null
            );

        case MAIL_PROVIDERS.RESEND:

            return (
                source.apiKey ||
                env(
                    'RESEND_API_KEY',
                ) ||
                null
            );

        case MAIL_PROVIDERS.SES:

            return (
                source.apiKey ||
                env(
                    'AWS_ACCESS_KEY_ID',
                ) ||
                null
            );

        default:

            return (
                source.apiKey ||
                null
            );

    }

}

function getProviderSecret(
    provider,
    source,
) {

    switch (
        provider
    ) {

        case MAIL_PROVIDERS.SES:

            return (
                source.secretAccessKey ||
                env(
                    'AWS_SECRET_ACCESS_KEY',
                ) ||
                null
            );

        default:

            return (
                source.secret ||
                env(
                    'MAIL_PROVIDER_SECRET',
                ) ||
                null
            );

    }

}

/**
 * =============================================================================
 * Configuration builder
 * =============================================================================
 */

function createMailConfig(
    input = {},
) {

    const source =
        input.mail ||
        input;

    const environment =
        asString(
            source.environment,
            getEnvironment(),
        );

    const provider =
        toEnum(
            source.provider ??
                env(
                    'MAIL_PROVIDER',
                ),
            Object.values(
                MAIL_PROVIDERS,
            ),
            DEFAULTS.provider,
        );

    const securityMode =
        toEnum(
            source.securityMode ??
                env(
                    'MAIL_SECURITY_MODE',
                ),
            Object.values(
                MAIL_SECURITY_MODES,
            ),
            provider ===
                MAIL_PROVIDERS.SMTP
                ? (
                    asBoolean(
                        source.secure ??
                            env(
                                'MAIL_SECURE',
                            ),
                        false,
                    )
                        ? MAIL_SECURITY_MODES.TLS
                        : MAIL_SECURITY_MODES.STARTTLS
                )
                : MAIL_SECURITY_MODES.TLS,
        );

    const secure =
        source.secure ??
        asBoolean(
            env(
                'MAIL_SECURE',
            ),
            securityMode ===
                MAIL_SECURITY_MODES.TLS,
        );

    const config = {

        /**
         * ---------------------------------------------------------------------
         * Identity
         * ---------------------------------------------------------------------
         */

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

        /**
         * ---------------------------------------------------------------------
         * Core
         * ---------------------------------------------------------------------
         */

        enabled:
            source.enabled ??
            asBoolean(
                env(
                    'MAIL_ENABLED',
                ),
                DEFAULTS.enabled,
            ),

        required:
            source.required ??
            asBoolean(
                env(
                    'MAIL_REQUIRED',
                ),
                DEFAULTS.required,
            ),

        provider,

        state:
            MAIL_STATES.ENABLED,

        /**
         * ---------------------------------------------------------------------
         * SMTP
         * ---------------------------------------------------------------------
         */

        smtp:
            {

                host:
                    asString(
                        source.host ??
                            env(
                                'SMTP_HOST',
                            ),
                        DEFAULTS.host,
                    ),

                port:
                    toPort(
                        source.port ??
                            env(
                                'SMTP_PORT',
                            ),
                        DEFAULTS.port,
                    ),

                secure:

                    Boolean(
                        secure,
                    ),

                securityMode,

                requireTls:
                    source.requireTls ??
                    asBoolean(
                        env(
                            'SMTP_REQUIRE_TLS',
                        ),
                        DEFAULTS.requireTls,
                    ),

                rejectUnauthorized:
                    source.rejectUnauthorized ??
                    asBoolean(
                        env(
                            'SMTP_REJECT_UNAUTHORIZED',
                        ),
                        DEFAULTS.rejectUnauthorized,
                    ),

                connectionTimeoutMs:
                    asPositiveInteger(
                        source.connectionTimeoutMs ??
                            env(
                                'SMTP_CONNECTION_TIMEOUT_MS',
                            ),
                        DEFAULTS.connectionTimeoutMs,
                    ),

                greetingTimeoutMs:
                    asPositiveInteger(
                        source.greetingTimeoutMs ??
                            env(
                                'SMTP_GREETING_TIMEOUT_MS',
                            ),
                        DEFAULTS.greetingTimeoutMs,
                    ),

                socketTimeoutMs:
                    asPositiveInteger(
                        source.socketTimeoutMs ??
                            env(
                                'SMTP_SOCKET_TIMEOUT_MS',
                            ),
                        DEFAULTS.socketTimeoutMs,
                    ),

                sendTimeoutMs:
                    asPositiveInteger(
                        source.sendTimeoutMs ??
                            env(
                                'SMTP_SEND_TIMEOUT_MS',
                            ),
                        DEFAULTS.sendTimeoutMs,
                    ),

                maxConnections:
                    asPositiveInteger(
                        source.maxConnections ??
                            env(
                                'SMTP_MAX_CONNECTIONS',
                            ),
                        DEFAULTS.maxConnections,
                    ),

                maxMessagesPerConnection:
                    asPositiveInteger(
                        source.maxMessagesPerConnection ??
                            env(
                                'SMTP_MAX_MESSAGES_PER_CONNECTION',
                            ),
                        DEFAULTS.maxMessagesPerConnection,
                    ),

                rateLimitPerSecond:
                    asPositiveInteger(
                        source.rateLimitPerSecond ??
                            env(
                                'SMTP_RATE_LIMIT_PER_SECOND',
                            ),
                        DEFAULTS.rateLimitPerSecond,
                    ),

                auth:
                    {

                        user:
                            asString(
                                source.user ??
                                    env(
                                        'SMTP_USER',
                                    ),
                                null,
                            ),

                        password:
                            source.password ??
                            env(
                                'SMTP_PASSWORD',
                            ) ||
                            null,

                    },

            },

        /**
         * ---------------------------------------------------------------------
         * Provider API settings
         * ---------------------------------------------------------------------
         */

        providerConfig:
            {

                apiKey:
                    getProviderApiKey(
                        provider,
                        source,
                    ),

                secret:
                    getProviderSecret(
                        provider,
                        source,
                    ),

                endpoint:
                    asString(
                        source.endpoint ??
                            env(
                                'MAIL_PROVIDER_ENDPOINT',
                            ),
                        null,
                    ),

                domain:
                    asString(
                        source.domain ??
                            env(
                                'MAILGUN_DOMAIN',
                            ),
                        null,
                    ),

                region:
                    asString(
                        source.region ??
                            env(
                                'AWS_REGION',
                            ),
                        null,
                    ),

                configurationSet:
                    asString(
                        source.configurationSet ??
                            env(
                                'AWS_SES_CONFIGURATION_SET',
                            ),
                        null,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Sender policy
         * ---------------------------------------------------------------------
         */

        sender:
            {

                fromName:
                    asString(
                        source.fromName ??
                            env(
                                'MAIL_FROM_NAME',
                            ),
                        DEFAULTS.defaultFromName,
                    ),

                fromAddress:
                    asString(
                        source.fromAddress ??
                            env(
                                'MAIL_FROM_ADDRESS',
                            ),
                        DEFAULTS.defaultFromAddress,
                    ),

                replyToName:
                    asString(
                        source.replyToName ??
                            env(
                                'MAIL_REPLY_TO_NAME',
                            ),
                        DEFAULTS.replyToName,
                    ),

                replyToAddress:
                    asString(
                        source.replyToAddress ??
                            env(
                                'MAIL_REPLY_TO_ADDRESS',
                            ),
                        DEFAULTS.replyToAddress,
                    ),

                bounceAddress:
                    asString(
                        source.bounceAddress ??
                            env(
                                'MAIL_BOUNCE_ADDRESS',
                            ),
                        DEFAULTS.bounceAddress,
                    ),

                defaultLocale:
                    asString(
                        source.defaultLocale ??
                            env(
                                'MAIL_DEFAULT_LOCALE',
                            ),
                        DEFAULTS.defaultLocale,
                    ),

                charset:
                    asString(
                        source.charset ??
                            env(
                                'MAIL_CHARSET',
                            ),
                        DEFAULTS.defaultCharset,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Template policy
         * ---------------------------------------------------------------------
         */

        templates:
            {

                directory:
                    asString(
                        source.templateDirectory ??
                            env(
                                'MAIL_TEMPLATE_DIRECTORY',
                            ),
                        DEFAULTS.templateDirectory,
                    ),

                cacheEnabled:
                    source.templateCacheEnabled ??
                    asBoolean(
                        env(
                            'MAIL_TEMPLATE_CACHE_ENABLED',
                        ),
                        DEFAULTS.templateCacheEnabled,
                    ),

                htmlEnabled:
                    source.htmlEnabled ??
                    asBoolean(
                        env(
                            'MAIL_HTML_ENABLED',
                        ),
                        DEFAULTS.htmlEnabled,
                    ),

                textFallbackEnabled:
                    source.textFallbackEnabled ??
                    asBoolean(
                        env(
                            'MAIL_TEXT_FALLBACK_ENABLED',
                        ),
                        DEFAULTS.textFallbackEnabled,
                    ),

                defaultLocale:
                    asString(
                        source.defaultLocale ??
                            env(
                                'MAIL_DEFAULT_LOCALE',
                            ),
                        DEFAULTS.defaultLocale,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Delivery
         * ---------------------------------------------------------------------
         */

        delivery:
            {

                maxRecipientsPerMessage:
                    asPositiveInteger(
                        source.maxRecipientsPerMessage ??
                            env(
                                'MAIL_MAX_RECIPIENTS',
                            ),
                        DEFAULTS.maxRecipientsPerMessage,
                    ),

                maxSubjectLength:
                    asPositiveInteger(
                        source.maxSubjectLength ??
                            env(
                                'MAIL_MAX_SUBJECT_LENGTH',
                            ),
                        DEFAULTS.maxSubjectLength,
                    ),

                maxBodyBytes:
                    asPositiveInteger(
                        source.maxBodyBytes ??
                            env(
                                'MAIL_MAX_BODY_BYTES',
                            ),
                        DEFAULTS.maxBodyBytes,
                    ),

                messageIdEnabled:
                    source.messageIdEnabled ??
                    asBoolean(
                        env(
                            'MAIL_MESSAGE_ID_ENABLED',
                        ),
                        DEFAULTS.messageIdEnabled,
                    ),

                headersEnabled:
                    source.headersEnabled ??
                    asBoolean(
                        env(
                            'MAIL_HEADERS_ENABLED',
                        ),
                        DEFAULTS.headersEnabled,
                    ),

                suppressDeliveryErrors:
                    source.suppressDeliveryErrors ??
                    asBoolean(
                        env(
                            'MAIL_SUPPRESS_DELIVERY_ERRORS',
                        ),
                        DEFAULTS.suppressDeliveryErrors,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Retry
         * ---------------------------------------------------------------------
         */

        retry:
            {

                attempts:
                    asPositiveInteger(
                        source.retryAttempts ??
                            env(
                                'MAIL_RETRY_ATTEMPTS',
                            ),
                        DEFAULTS.retryAttempts,
                    ),

                initialDelayMs:
                    asPositiveInteger(
                        source.initialRetryDelayMs ??
                            env(
                                'MAIL_INITIAL_RETRY_DELAY_MS',
                            ),
                        DEFAULTS.initialRetryDelayMs,
                    ),

                maxDelayMs:
                    asPositiveInteger(
                        source.maxRetryDelayMs ??
                            env(
                                'MAIL_MAX_RETRY_DELAY_MS',
                            ),
                        DEFAULTS.maxRetryDelayMs,
                    ),

                jitterRatio:
                    Math.min(
                        Math.max(
                            asFloat(
                                source.retryJitterRatio ??
                                    env(
                                        'MAIL_RETRY_JITTER_RATIO',
                                    ),
                                DEFAULTS.retryJitterRatio,
                            ),
                            0,
                        ),
                        1,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Queue
         * ---------------------------------------------------------------------
         */

        queue:
            {

                enabled:
                    source.queueEnabled ??
                    asBoolean(
                        env(
                            'MAIL_QUEUE_ENABLED',
                        ),
                        DEFAULTS.queueEnabled,
                    ),

                name:
                    asString(
                        source.queueName ??
                            env(
                                'MAIL_QUEUE_NAME',
                            ),
                        DEFAULTS.queueName,
                    ),

                priority:
                    asPositiveInteger(
                        source.queuePriority ??
                            env(
                                'MAIL_QUEUE_PRIORITY',
                            ),
                        DEFAULTS.queuePriority,
                    ),

                concurrency:
                    asPositiveInteger(
                        source.queueConcurrency ??
                            env(
                                'MAIL_QUEUE_CONCURRENCY',
                            ),
                        DEFAULTS.queueConcurrency,
                    ),

                attempts:
                    asPositiveInteger(
                        source.queueAttempts ??
                            env(
                                'MAIL_QUEUE_ATTEMPTS',
                            ),
                        DEFAULTS.queueAttempts,
                    ),

                backoffDelayMs:
                    asPositiveInteger(
                        source.queueBackoffDelayMs ??
                            env(
                                'MAIL_QUEUE_BACKOFF_DELAY_MS',
                            ),
                        DEFAULTS.queueBackoffDelayMs,
                    ),

                removeOnComplete:
                    asPositiveInteger(
                        source.queueRemoveOnComplete ??
                            env(
                                'MAIL_QUEUE_REMOVE_ON_COMPLETE',
                            ),
                        DEFAULTS.queueRemoveOnComplete,
                    ),

                removeOnFail:
                    asPositiveInteger(
                        source.queueRemoveOnFail ??
                            env(
                                'MAIL_QUEUE_REMOVE_ON_FAIL',
                            ),
                        DEFAULTS.queueRemoveOnFail,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Health / timeouts
         * ---------------------------------------------------------------------
         */

        health:
            {

                enabled:
                    source.healthChecksEnabled ??
                    asBoolean(
                        env(
                            'MAIL_HEALTH_CHECKS_ENABLED',
                        ),
                        DEFAULTS.healthChecksEnabled,
                    ),

                timeoutMs:
                    asPositiveInteger(
                        source.healthTimeoutMs ??
                            env(
                                'MAIL_HEALTH_TIMEOUT_MS',
                            ),
                        DEFAULTS.healthTimeoutMs,
                    ),

                shutdownTimeoutMs:
                    asPositiveInteger(
                        source.shutdownTimeoutMs ??
                            env(
                                'MAIL_SHUTDOWN_TIMEOUT_MS',
                            ),
                        DEFAULTS.shutdownTimeoutMs,

                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Security/failure policy
         * ---------------------------------------------------------------------
         */

        security:
            {

                allowInsecureTls:
                    source.allowInsecureTls ??
                    asBoolean(
                        env(
                            'MAIL_ALLOW_INSECURE_TLS',
                        ),
                        DEFAULTS.allowInsecureTls,
                    ),

                allowSelfSignedCertificates:
                    source.allowSelfSignedCertificates ??
                    asBoolean(
                        env(
                            'MAIL_ALLOW_SELF_SIGNED_CERTIFICATES',
                        ),
                        DEFAULTS.allowSelfSignedCertificates,
                    ),

                allowUnverifiedCertificates:
                    source.allowUnverifiedCertificates ??
                    asBoolean(
                        env(
                            'MAIL_ALLOW_UNVERIFIED_CERTIFICATES',
                        ),
                        DEFAULTS.allowUnverifiedCertificates,
                    ),

                failOpenForOptionalNotifications:
                    source.failOpenForOptionalNotifications ??
                    asBoolean(
                        env(
                            'MAIL_FAIL_OPEN_OPTIONAL_NOTIFICATIONS',
                        ),
                        DEFAULTS.failOpenForOptionalNotifications,
                    ),

                failClosedForSecurityMessages:
                    source.failClosedForSecurityMessages ??
                    asBoolean(
                        env(
                            'MAIL_FAIL_CLOSED_SECURITY_MESSAGES',
                        ),
                        DEFAULTS.failClosedForSecurityMessages,
                    ),

                failClosedForAuthenticationMessages:
                    source.failClosedForAuthenticationMessages ??
                    asBoolean(
                        env(
                            'MAIL_FAIL_CLOSED_AUTH_MESSAGES',
                        ),
                        DEFAULTS.failClosedForAuthenticationMessages,
                    ),

            },

        /**
         * ---------------------------------------------------------------------
         * Development / diagnostics
         * ---------------------------------------------------------------------
         */

        diagnostics:
            {

                enabled:
                    source.diagnosticsEnabled ??
                    asBoolean(
                        env(
                            'MAIL_DIAGNOSTICS_ENABLED',
                        ),
                        DEFAULTS.diagnosticsEnabled,
                    ),

                dryRun:
                    source.dryRun ??
                    asBoolean(
                        env(
                            'MAIL_DRY_RUN',
                        ),
                        DEFAULTS.dryRun,
                    ),

                developmentSinkEnabled:
                    source.developmentSinkEnabled ??
                    asBoolean(
                        env(
                            'MAIL_DEVELOPMENT_SINK_ENABLED',
                        ),
                        DEFAULTS.developmentSinkEnabled,
                    ),

                developmentSinkAddress:
                    asString(
                        source.developmentSinkAddress ??
                            env(
                                'MAIL_DEVELOPMENT_SINK_ADDRESS',
                            ),
                        DEFAULTS.developmentSinkAddress,
                    ),

            },

    };

    return validateMailConfig(
        config,
    );

}

/**
 * =============================================================================
 * Configuration validation
 * =============================================================================
 */

function validateMailConfig(
    config,
) {

    const errors =
        [];

    const warnings =
        [];

    const production =
        config.environment ===
        'production';

    /**
     * -------------------------------------------------------------------------
     * Core provider
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        !Object.values(
            MAIL_PROVIDERS,
        ).includes(
            config.provider,
        )
    ) {

        errors.push({
            code:
                'MAIL_PROVIDER_UNSUPPORTED',

            field:
                'provider',

            message:
                `Unsupported TITech mail provider "${config.provider}".`,
        });

    }

    if (
        config.enabled &&
        config.provider ===
            MAIL_PROVIDERS.NONE
    ) {

        if (
            config.required
        ) {

            errors.push({
                code:
                    'MAIL_REQUIRED_PROVIDER_DISABLED',

                field:
                    'provider',

                message:
                    'TITech mail is required but no provider is configured.',
            });

        }

        warnings.push({
            code:
                'MAIL_PROVIDER_NONE',

            message:
                'TITech mail delivery is explicitly disabled.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * SMTP
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled &&
        config.provider ===
            MAIL_PROVIDERS.SMTP
    ) {

        if (
            !config.smtp.host
        ) {

            errors.push({
                code:
                    'SMTP_HOST_MISSING',

                field:
                    'smtp.host',

                message:
                    'TITech SMTP host is required.',
            });

        }

        if (
            config.smtp.port <
                1 ||
            config.smtp.port >
                65_535
        ) {

            errors.push({
                code:
                    'SMTP_PORT_INVALID',

                field:
                    'smtp.port',
            });

        }

        if (
            production &&
            config.smtp.rejectUnauthorized ===
                false
        ) {

            errors.push({
                code:
                    'SMTP_TLS_VERIFICATION_DISABLED',

                field:
                    'smtp.rejectUnauthorized',

                message:
                    'TITech production SMTP certificate verification cannot be disabled.',
            });

        }

        if (
            production &&
            config.smtp.requireTls ===
                false
        ) {

            errors.push({
                code:
                    'SMTP_TLS_REQUIRED',

                field:
                    'smtp.requireTls',

                message:
                    'TITech production SMTP connections require TLS.',
            });

        }

        /**
         * SMTP authentication is not mandatory for every SMTP deployment
         * because some enterprise relay servers authenticate by network policy.
         * Therefore absence is a warning unless explicitly required.
         */
        const requireAuth =
            asBoolean(
                env(
                    'SMTP_REQUIRE_AUTH',
                ),
                false,
            );

        if (
            requireAuth &&
            (
                !config.smtp.auth.user ||
                !config.smtp.auth.password
            )
        ) {

            errors.push({
                code:
                    'SMTP_AUTH_MISSING',

                field:
                    'smtp.auth',

                message:
                    'TITech SMTP authentication is required but credentials are incomplete.',
            });

        }

    }

    /**
     * -------------------------------------------------------------------------
     * API provider authentication
     * -------------------------------------------------------------------------
     */

    const apiProviders = [
        MAIL_PROVIDERS.SENDGRID,
        MAIL_PROVIDERS.MAILGUN,
        MAIL_PROVIDERS.POSTMARK,
        MAIL_PROVIDERS.RESEND,
    ];

    if (
        config.enabled &&
        apiProviders.includes(
            config.provider,
        ) &&
        !config.providerConfig.apiKey
    ) {

        errors.push({
            code:
                'MAIL_PROVIDER_API_KEY_MISSING',

            field:
                'providerConfig.apiKey',

            message:
                `TITech ${config.provider} API credentials are missing.`,
        });

    }

    if (
        config.enabled &&
        config.provider ===
            MAIL_PROVIDERS.SES
    ) {

        const hasAwsCredentials =
            Boolean(
                env(
                    'AWS_ACCESS_KEY_ID',
                ) &&
                env(
                    'AWS_SECRET_ACCESS_KEY',
                ),
            );

        /**
         * IAM roles/workload identities may provide credentials without static
         * environment variables, so missing keys are warnings rather than
         * unconditional failures.
         */
        if (
            !hasAwsCredentials &&
            !config.providerConfig.region
        ) {

            errors.push({
                code:
                    'SES_CONFIGURATION_MISSING',

                field:
                    'providerConfig',

                message:
                    'TITech SES requires AWS region configuration or an equivalent AWS runtime credential source.',
            });

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Sender configuration
     * -------------------------------------------------------------------------
     */

    if (
        config.enabled
    ) {

        if (
            !isPlausibleEmailAddress(
                config.sender.fromAddress,
            )
        ) {

            errors.push({
                code:
                    'MAIL_FROM_ADDRESS_INVALID',

                field:
                    'sender.fromAddress',

                message:
                    'TITech default sender address is invalid.',
            });

        }

        if (
            config.sender.replyToAddress &&
            !isPlausibleEmailAddress(
                config.sender.replyToAddress,
            )
        ) {

            errors.push({
                code:
                    'MAIL_REPLY_TO_INVALID',

                field:
                    'sender.replyToAddress',

                message:
                    'TITech reply-to address is invalid.',
            });

        }

        if (
            config.sender.bounceAddress &&
            !isPlausibleEmailAddress(
                config.sender.bounceAddress,
            )
        ) {

            errors.push({
                code:
                    'MAIL_BOUNCE_ADDRESS_INVALID',

                field:
                    'sender.bounceAddress',

                message:
                    'TITech bounce address is invalid.',
            });

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Security
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.security.allowInsecureTls
    ) {

        errors.push({
            code:
                'MAIL_INSECURE_TLS_FORBIDDEN',

            field:
                'security.allowInsecureTls',

            message:
                'TITech production mail cannot permit insecure TLS.',
        });

    }

    if (
        production &&
        config.security.allowSelfSignedCertificates
    ) {

        errors.push({
            code:
                'MAIL_SELF_SIGNED_TLS_FORBIDDEN',

            field:
                'security.allowSelfSignedCertificates',

            message:
                'TITech production mail cannot trust self-signed certificates by default.',
        });

    }

    if (
        production &&
        config.security.allowUnverifiedCertificates
    ) {

        errors.push({
            code:
                'MAIL_UNVERIFIED_TLS_FORBIDDEN',

            field:
                'security.allowUnverifiedCertificates',

            message:
                'TITech production mail cannot disable certificate verification.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Queue
     * -------------------------------------------------------------------------
     */

    if (
        config.queue.enabled &&
        config.queue.concurrency <=
            0
    ) {

        errors.push({
            code:
                'MAIL_QUEUE_CONCURRENCY_INVALID',

            field:
                'queue.concurrency',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Message limits
     * -------------------------------------------------------------------------
     */

    if (
        config.delivery.maxRecipientsPerMessage >
        10_000
    ) {

        warnings.push({
            code:
                'MAIL_RECIPIENT_LIMIT_HIGH',

            field:
                'delivery.maxRecipientsPerMessage',
        });

    }

    if (
        config.delivery.maxSubjectLength >
        998
    ) {

        errors.push({
            code:
                'MAIL_SUBJECT_LENGTH_INVALID',

            field:
                'delivery.maxSubjectLength',

            message:
                'TITech email subject length exceeds the protocol limit.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Production operational policy
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        config.diagnostics.dryRun
    ) {

        errors.push({
            code:
                'MAIL_PRODUCTION_DRY_RUN',

            field:
                'diagnostics.dryRun',

            message:
                'TITech production mail cannot run in dry-run mode.',
        });

    }

    if (
        production &&
        config.diagnostics.developmentSinkEnabled
    ) {

        errors.push({
            code:
                'MAIL_DEVELOPMENT_SINK_PRODUCTION',

            field:
                'diagnostics.developmentSinkEnabled',

            message:
                'TITech production mail cannot route messages to the development sink.',
        });

    }

    if (
        config.enabled &&
        config.provider ===
            MAIL_PROVIDERS.SMTP &&
        config.smtp.port ===
            25
    ) {

        warnings.push({
            code:
                'SMTP_PORT_25',

            field:
                'smtp.port',

            message:
                'TITech SMTP is using port 25; STARTTLS or provider-specific relay policy should be verified.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Retry
     * -------------------------------------------------------------------------
     */

    if (
        config.retry.maxDelayMs <
        config.retry.initialDelayMs
    ) {

        errors.push({
            code:
                'MAIL_RETRY_DELAY_INVALID',

            field:
                'retry',

            message:
                'TITech mail maximum retry delay must not be lower than the initial retry delay.',
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Fail-closed security mail
     * -------------------------------------------------------------------------
     */

    if (
        production &&
        !config.security
            .failClosedForSecurityMessages
    ) {

        warnings.push({
            code:
                'MAIL_SECURITY_MESSAGE_NOT_FAIL_CLOSED',

            field:
                'security.failClosedForSecurityMessages',

            message:
                'Security notification delivery is not configured fail-closed.',
        });

    }

    if (
        production &&
        !config.security
            .failClosedForAuthenticationMessages
    ) {

        warnings.push({
            code:
                'MAIL_AUTH_MESSAGE_NOT_FAIL_CLOSED',

            field:
                'security.failClosedForAuthenticationMessages',

            message:
                'Authentication-related mail delivery is not configured fail-closed.',
        });

    }

    if (
        errors.length >
        0
    ) {

        const localError =
            new MailConfigError(
                'TITech mail configuration validation failed.',
                {
                    code:
                        'MAIL_CONFIGURATION_INVALID',

                    details:
                        {
                            errors,
                            warnings,
                        },
                },
            );

        if (
            startupErrors?.configurationError
        ) {

            try {

                throw startupErrors.configurationError(
                    localError.message,
                    {
                        cause:
                            localError,

                        critical:
                            config.required,

                        fatal:
                            config.required,

                        details:
                            {
                                component:
                                    COMPONENT,

                                errors,
                                warnings,
                            },
                    },
                );

            } catch (
                error
            ) {

                throw error;

            }

        }

        throw localError;

    }

    const state =
        !config.enabled
            ? MAIL_STATES.DISABLED
            : warnings.length > 0
                ? MAIL_STATES.DEGRADED
                : MAIL_STATES.ENABLED;

    return deepFreeze({

        ...config,

        state,

        warnings:
            Object.freeze(
                warnings,
            ),

    });

}

function isPlausibleEmailAddress(
    value,
) {

    if (
        typeof value !==
        'string'
    ) {

        return false;

    }

    const normalized =
        value.trim();

    if (
        normalized.length <
            3 ||
        normalized.length >
            320
    ) {

        return false;

    }

    /**
     * Deliberately conservative syntax validation for configuration.
     * Provider-level RFC validation remains authoritative.
     */
    return (
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            normalized,
        )
    );

}

/**
 * =============================================================================
 * Provider capability metadata
 * =============================================================================
 */

function getProviderCapabilities(
    provider,
) {

    const capabilities = {

        [MAIL_PROVIDERS.SMTP]:
            {
                transport:
                    'smtp',

                api:
                    false,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    true,
            },

        [MAIL_PROVIDERS.SENDGRID]:
            {
                transport:
                    'api',

                api:
                    true,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    true,
            },

        [MAIL_PROVIDERS.MAILGUN]:
            {
                transport:
                    'api',

                api:
                    true,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    true,
            },

        [MAIL_PROVIDERS.SES]:
            {
                transport:
                    'api',

                api:
                    true,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    true,
            },

        [MAIL_PROVIDERS.POSTMARK]:
            {
                transport:
                    'api',

                api:
                    true,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    true,
            },

        [MAIL_PROVIDERS.RESEND]:
            {
                transport:
                    'api',

                api:
                    true,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    false,
            },

        [MAIL_PROVIDERS.CUSTOM]:
            {
                transport:
                    'custom',

                api:
                    true,

                supportsHtml:
                    true,

                supportsAttachments:
                    true,

                supportsReplyTo:
                    true,

                supportsBounce:
                    true,
            },

        [MAIL_PROVIDERS.NONE]:
            {
                transport:
                    'none',

                api:
                    false,

                supportsHtml:
                    false,

                supportsAttachments:
                    false,

                supportsReplyTo:
                    false,

                supportsBounce:
                    false,
            },

    };

    return deepFreeze(
        capabilities[
            provider
        ] || {
            transport:
                'unknown',

            api:
                false,

            supportsHtml:
                false,

            supportsAttachments:
                false,

            supportsReplyTo:
                false,

            supportsBounce:
                false,
        },
    );

}

/**
 * =============================================================================
 * Message policy
 * =============================================================================
 */

function getMessagePolicy(
    messageType,
    config = defaultConfig,
) {

    const normalizedType =
        toEnum(
            messageType,
            Object.values(
                MAIL_MESSAGE_TYPES,
            ),
            MAIL_MESSAGE_TYPES.TRANSACTIONAL,
        );

    const security =
        [
            MAIL_MESSAGE_TYPES.SECURITY,
            MAIL_MESSAGE_TYPES.AUTHENTICATION,
        ].includes(
            normalizedType,
        );

    return deepFreeze({

        type:
            normalizedType,

        transactional:
            normalizedType ===
            MAIL_MESSAGE_TYPES.TRANSACTIONAL,

        security,

        authentication:
            normalizedType ===
            MAIL_MESSAGE_TYPES.AUTHENTICATION,

        notification:
            normalizedType ===
            MAIL_MESSAGE_TYPES.NOTIFICATION,

        marketing:
            normalizedType ===
            MAIL_MESSAGE_TYPES.MARKETING,

        system:
            normalizedType ===
            MAIL_MESSAGE_TYPES.SYSTEM,

        failurePolicy:
            security
                ? (
                    normalizedType ===
                    MAIL_MESSAGE_TYPES.AUTHENTICATION
                        ? (
                            config.security
                                .failClosedForAuthenticationMessages
                                ? 'fail_closed'
                                : 'fail_open'
                        )
                        : (
                            config.security
                                .failClosedForSecurityMessages
                                ? 'fail_closed'
                                : 'fail_open'
                        )
                )
                : (
                    config.security
                        .failOpenForOptionalNotifications
                        ? 'fail_open'
                        : 'fail_closed'
                ),

        queue:
            config.queue.enabled,

        retries:
            config.retry.attempts,

    });

}

/**
 * =============================================================================
 * Safe credential metadata
 * =============================================================================
 */

function getCredentialMetadata(
    config = defaultConfig,
) {

    return deepFreeze({

        smtp:
            {
                usernameConfigured:
                    Boolean(
                        config.smtp
                            .auth
                            .user,
                    ),

                passwordConfigured:
                    Boolean(
                        config.smtp
                            .auth
                            .password,
                    ),
            },

        provider:
            {
                apiKeyConfigured:
                    Boolean(
                        config.providerConfig
                            .apiKey,
                    ),

                secretConfigured:
                    Boolean(
                        config.providerConfig
                            .secret,
                    ),
            },

    });

}

/**
 * =============================================================================
 * Safe snapshot
 * =============================================================================
 */

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

        state:
            config.state,

        enabled:
            config.enabled,

        required:
            config.required,

        provider:
            config.provider,

        providerCapabilities:
            getProviderCapabilities(
                config.provider,
            ),

        smtp:
            {
                host:
                    config.smtp
                        .host,

                port:
                    config.smtp
                        .port,

                secure:
                    config.smtp
                        .secure,

                securityMode:
                    config.smtp
                        .securityMode,

                requireTls:
                    config.smtp
                        .requireTls,

                rejectUnauthorized:
                    config.smtp
                        .rejectUnauthorized,

                maxConnections:
                    config.smtp
                        .maxConnections,

                maxMessagesPerConnection:
                    config.smtp
                        .maxMessagesPerConnection,

                rateLimitPerSecond:
                    config.smtp
                        .rateLimitPerSecond,

                credentials:
                    getCredentialMetadata(
                        config,
                    ).smtp,
            },

        providerConfig:
            {
                endpointConfigured:
                    Boolean(
                        config
                            .providerConfig
                            .endpoint,
                    ),

                domainConfigured:
                    Boolean(
                        config
                            .providerConfig
                            .domain,
                    ),

                region:
                    config
                        .providerConfig
                        .region,

                configurationSetConfigured:
                    Boolean(
                        config
                            .providerConfig
                            .configurationSet,
                    ),

                credentials:
                    getCredentialMetadata(
                        config,
                    ).provider,
            },

        sender:
            {
                fromName:
                    config.sender
                        .fromName,

                fromAddress:
                    config.sender
                        .fromAddress,

                replyToName:
                    config.sender
                        .replyToName,

                replyToAddress:
                    config.sender
                        .replyToAddress,

                bounceAddressConfigured:
                    Boolean(
                        config.sender
                            .bounceAddress,
                    ),

                locale:
                    config.sender
                        .defaultLocale,
            },

        templates:
            {
                directory:
                    config.templates
                        .directory,

                cacheEnabled:
                    config.templates
                        .cacheEnabled,

                htmlEnabled:
                    config.templates
                        .htmlEnabled,

                textFallbackEnabled:
                    config.templates
                        .textFallbackEnabled,
            },

        delivery:
            {
                maxRecipientsPerMessage:
                    config.delivery
                        .maxRecipientsPerMessage,

                maxSubjectLength:
                    config.delivery
                        .maxSubjectLength,

                maxBodyBytes:
                    config.delivery
                        .maxBodyBytes,

                messageIdEnabled:
                    config.delivery
                        .messageIdEnabled,

                headersEnabled:
                    config.delivery
                        .headersEnabled,
            },

        retry:
            {
                attempts:
                    config.retry
                        .attempts,

                initialDelayMs:
                    config.retry
                        .initialDelayMs,

                maxDelayMs:
                    config.retry
                        .maxDelayMs,

                jitterRatio:
                    config.retry
                        .jitterRatio,
            },

        queue:
            {
                enabled:
                    config.queue
                        .enabled,

                name:
                    config.queue
                        .name,

                priority:
                    config.queue
                        .priority,

                concurrency:
                    config.queue
                        .concurrency,

                attempts:
                    config.queue
                        .attempts,
            },

        health:
            {
                enabled:
                    config.health
                        .enabled,

                timeoutMs:
                    config.health
                        .timeoutMs,

                shutdownTimeoutMs:
                    config.health
                        .shutdownTimeoutMs,
            },

        security:
            {
                allowInsecureTls:
                    config.security
                        .allowInsecureTls,

                allowSelfSignedCertificates:
                    config.security
                        .allowSelfSignedCertificates,

                allowUnverifiedCertificates:
                    config.security
                        .allowUnverifiedCertificates,

                failOpenForOptionalNotifications:
                    config.security
                        .failOpenForOptionalNotifications,

                failClosedForSecurityMessages:
                    config.security
                        .failClosedForSecurityMessages,

                failClosedForAuthenticationMessages:
                    config.security
                        .failClosedForAuthenticationMessages,
            },

        diagnostics:
            {
                enabled:
                    config.diagnostics
                        .enabled,

                dryRun:
                    config.diagnostics
                        .dryRun,

                developmentSinkEnabled:
                    config.diagnostics
                        .developmentSinkEnabled,

                developmentSinkAddress:
                    config.diagnostics
                        .developmentSinkAddress,
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
 * Environment override diagnostics
 * =============================================================================
 */

function getEnvironmentOverrides() {

    const keys = [

        'MAIL_ENABLED',
        'MAIL_REQUIRED',
        'MAIL_PROVIDER',

        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_SECURE',
        'SMTP_REQUIRE_TLS',
        'SMTP_REJECT_UNAUTHORIZED',
        'SMTP_CONNECTION_TIMEOUT_MS',
        'SMTP_GREETING_TIMEOUT_MS',
        'SMTP_SOCKET_TIMEOUT_MS',
        'SMTP_SEND_TIMEOUT_MS',
        'SMTP_MAX_CONNECTIONS',
        'SMTP_MAX_MESSAGES_PER_CONNECTION',
        'SMTP_RATE_LIMIT_PER_SECOND',
        'SMTP_USER',

        'SENDGRID_API_KEY',
        'MAILGUN_API_KEY',
        'POSTMARK_SERVER_TOKEN',
        'RESEND_API_KEY',

        'MAIL_PROVIDER_ENDPOINT',
        'MAILGUN_DOMAIN',
        'AWS_REGION',
        'AWS_SES_CONFIGURATION_SET',

        'MAIL_FROM_NAME',
        'MAIL_FROM_ADDRESS',
        'MAIL_REPLY_TO_NAME',
        'MAIL_REPLY_TO_ADDRESS',
        'MAIL_BOUNCE_ADDRESS',
        'MAIL_DEFAULT_LOCALE',
        'MAIL_CHARSET',

        'MAIL_TEMPLATE_DIRECTORY',
        'MAIL_TEMPLATE_CACHE_ENABLED',
        'MAIL_HTML_ENABLED',
        'MAIL_TEXT_FALLBACK_ENABLED',

        'MAIL_MAX_RECIPIENTS',
        'MAIL_MAX_SUBJECT_LENGTH',
        'MAIL_MAX_BODY_BYTES',
        'MAIL_MESSAGE_ID_ENABLED',
        'MAIL_HEADERS_ENABLED',

        'MAIL_RETRY_ATTEMPTS',
        'MAIL_INITIAL_RETRY_DELAY_MS',
        'MAIL_MAX_RETRY_DELAY_MS',
        'MAIL_RETRY_JITTER_RATIO',

        'MAIL_QUEUE_ENABLED',
        'MAIL_QUEUE_NAME',
        'MAIL_QUEUE_PRIORITY',
        'MAIL_QUEUE_CONCURRENCY',
        'MAIL_QUEUE_ATTEMPTS',

        'MAIL_HEALTH_CHECKS_ENABLED',
        'MAIL_HEALTH_TIMEOUT_MS',
        'MAIL_SHUTDOWN_TIMEOUT_MS',

        'MAIL_ALLOW_INSECURE_TLS',
        'MAIL_ALLOW_SELF_SIGNED_CERTIFICATES',
        'MAIL_ALLOW_UNVERIFIED_CERTIFICATES',

        'MAIL_DRY_RUN',
        'MAIL_DEVELOPMENT_SINK_ENABLED',
        'MAIL_DEVELOPMENT_SINK_ADDRESS',
        'MAIL_DIAGNOSTICS_ENABLED'

    ];

    const result =
        {};

    for (
        const key of
        keys
    ) {

        const value =
            process.env[key];

        if (
            value === undefined
        ) {

            result[key] =
                undefined;

            continue;

        }

        if (
            isSensitiveKey(
                key,
            )
        ) {

            result[key] =
                '[REDACTED]';

            continue;

        }

        result[key] =
            value;

    }

    return Object.freeze(
        result,
    );

}

function isSensitiveKey(
    key,
) {

    return (
        SENSITIVE_KEYS.includes(
            key,
        ) ||
        SENSITIVE_PATTERN.test(
            key,
        )
    );

}

/**
 * =============================================================================
 * Bootstrap adapter
 * =============================================================================
 */

async function initialize(
    context = {},
    options = {},
) {

    const config =
        options.config
            ? createMailConfig(
                options.config,
            )
            : defaultConfig;

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.mail =
            config;

        context.mailConfig =
            config;

    }

    return config;

}

async function start(
    context = {},
    options = {},
) {

    return initialize(
        context,
        options,
    );

}

async function bootstrap(
    context = {},
    options = {},
) {

    return initialize(
        context,
        options,
    );

}

/**
 * =============================================================================
 * Default configuration
 * =============================================================================
 */

const defaultConfig =
    createMailConfig();

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Core configuration.
         */
        config:
            defaultConfig,

        mail:
            defaultConfig,

        createMailConfig,

        validateMailConfig,

        /**
         * Constants.
         */
        DEFAULTS,

        MAIL_STATES,

        MAIL_PROVIDERS,

        MAIL_SECURITY_MODES,

        MAIL_MESSAGE_TYPES,

        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        /**
         * Provider capabilities.
         */
        getProviderCapabilities,

        /**
         * Message policy.
         */
        getMessagePolicy,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getCredentialMetadata,

        getEnvironmentOverrides,

        /**
         * Lifecycle compatibility.
         */
        initialize,

        start,

        bootstrap,

        /**
         * Error.
         */
        MailConfigError,

    });