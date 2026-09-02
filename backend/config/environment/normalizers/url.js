'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/environment/normalizers/url.js
 *
 * Purpose:
 *   Enterprise production-grade URL/URI environment value normalizer.
 *
 * Responsibilities:
 *   - Normalize raw TITech URL and URI configuration values.
 *   - Validate protocol/scheme policy.
 *   - Support HTTP/HTTPS, MongoDB, Redis, SMTP and other explicitly allowed
 *     URI schemes.
 *   - Support host, port, path, query and fragment validation.
 *   - Normalize trailing slashes where configured.
 *   - Normalize hostname casing.
 *   - Preserve encoded path/query content.
 *   - Reject malformed or ambiguous URLs.
 *   - Prevent unsafe schemes such as javascript:, data: and file: unless
 *     explicitly permitted.
 *   - Provide configurable localhost/private-network policies.
 *   - Protect credentials from diagnostic output.
 *   - Provide deterministic fingerprints.
 *   - Support defaults without mutating process.env.
 *   - Return immutable normalization results when configured.
 *
 * IMPORTANT:
 *
 *   This module normalizes URL/URI VALUES only.
 *
 *   It does NOT:
 *     - load dotenv files.
 *     - mutate process.env.
 *     - merge configuration layers.
 *     - determine configuration precedence.
 *     - validate complete application configuration.
 *     - connect to MongoDB.
 *     - connect to Redis.
 *     - initialize queues.
 *     - start Express.
 *     - start the HTTP server.
 *     - execute business or financial transactions.
 *
 * Related modules:
 *
 *   backend/config/environment/normalizeEnvironment.js
 *   backend/config/environment/normalizers/string.js
 *   backend/config/environment/normalizers/number.js
 *   backend/config/environment/normalizers/boolean.js
 *   backend/config/environment/environmentValidator.js
 *   backend/config/environment/secretMasker.js
 *
 * =============================================================================
 */

const crypto =
    require('node:crypto');

const net =
    require('node:net');

const { URL } =
    require('node:url');

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {
    // eslint-disable-next-line global-require
    loggerModule =
        require('../../../utils/logger');
} catch {
    loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'environment-normalizer-url';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const URL_INPUT_TYPES =
    Object.freeze({
        AUTO:
            'auto',

        STRING:
            'string',

        URL:
            'url',
    });

const URL_MODES =
    Object.freeze({
        URL:
            'url',

        ORIGIN:
            'origin',

        HOST:
            'host',

        HOSTNAME:
            'hostname',

        PORT:
            'port',

        PATHNAME:
            'pathname',

        SEARCH:
            'search',

        SEARCH_PARAMS:
            'searchParams',

        PROTOCOL:
            'protocol',
    });

const DEFAULTS =
    Object.freeze({
        strict:
            true,

        failClosed:
            true,

        inputType:
            URL_INPUT_TYPES.AUTO,

        mode:
            URL_MODES.URL,

        trim:
            true,

        allowEmpty:
            false,

        emptyDefault:
            undefined,

        defaultValue:
            undefined,

        normalizeProtocol:
            true,

        normalizeHostname:
            true,

        normalizeTrailingSlash:
            false,

        removeDefaultPort:
            false,

        preserveHash:
            true,

        preserveSearch:
            true,

        preservePath:
            true,

        allowCredentials:
            false,

        allowUsername:
            false,

        allowPassword:
            false,

        redactCredentials:
            true,

        allowLocalhost:
            true,

        allowLoopback:
            true,

        allowPrivateNetwork:
            false,

        allowIpLiterals:
            true,

        allowIpv4:
            true,

        allowIpv6:
            true,

        requireHostname:
            false,

        requirePort:
            false,

        requirePath:
            false,

        requireProtocol:
            true,

        allowRelative:
            false,

        allowFragments:
            true,

        allowQuery:
            true,

        allowNonStandardPorts:
            true,

        allowHttp:
            true,

        allowHttps:
            true,

        allowWs:
            true,

        allowWss:
            true,

        allowMongo:
            true,

        allowMongoSrv:
            true,

        allowRedis:
            true,

        allowRediss:
            true,

        allowSmtp:
            true,

        allowSmtps:
            true,

        allowAmqp:
            true,

        allowAmqps:
            true,

        allowFile:
            false,

        allowData:
            false,

        allowJavascript:
            false,

        allowedProtocols:
            null,

        blockedProtocols:
            Object.freeze([
                'javascript:',
                'data:',
                'vbscript:',
            ]),

        minPort:
            1,

        maxPort:
            65535,

        maxLength:
            32_768,

        maxHostnameLength:
            253,

        maxPathLength:
            8_192,

        maxQueryLength:
            16_384,

        maxFragmentLength:
            8_192,

        fingerprintAlgorithm:
            'sha256',

        freezeResult:
            true,

        includeSourceValue:
            false,

        includeCredentials:
            false,

        normalizeSearchParams:
            false,

        metadata:
            null,

        maxMetadataKeys:
            100,
    });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class UrlNormalizationError extends Error {

    constructor(
        message,
        options = {},
    ) {

        super(message);

        this.name =
            'UrlNormalizationError';

        this.code =
            options.code ||
            'ENVIRONMENT_URL_NORMALIZATION_ERROR';

        this.variable =
            options.variable ||
            null;

        this.path =
            options.path ||
            null;

        this.input =
            options.input ===
                undefined
                ? null
                : options.input;

        this.cause =
            options.cause ||
            null;

        this.details =
            Object.freeze({
                ...(options.details || {}),
            });

        Error.captureStackTrace?.(
            this,
            UrlNormalizationError,
        );
    }
}

/**
 * =============================================================================
 * Utilities
 * =============================================================================
 */

function clone(
    value,
) {

    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    if (
        typeof structuredClone ===
        'function'
    ) {

        try {
            return structuredClone(
                value,
            );
        } catch {
            // Recursive fallback.
        }
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return value.map(
            item =>
                clone(
                    item,
                ),
        );
    }

    if (
        typeof value ===
        'object'
    ) {

        const output = {};

        for (
            const [
                key,
                item,
            ] of Object.entries(
                value,
            )
        ) {

            output[key] =
                clone(
                    item,
                );
        }

        return output;
    }

    return value;
}

function deepFreeze(
    value,
    seen = new WeakSet(),
) {

    if (
        value === null ||
        value === undefined ||
        typeof value !==
            'object'
    ) {

        return value;
    }

    if (
        seen.has(
            value,
        )
    ) {

        return value;
    }

    seen.add(
        value,
    );

    for (
        const key of
        Reflect.ownKeys(
            value,
        )
    ) {

        try {
            deepFreeze(
                value[key],
                seen,
            );
        } catch {
            // Best effort.
        }
    }

    try {
        Object.freeze(
            value,
        );
    } catch {
        // Best effort.
    }

    return value;
}

function normalizeOptions(
    options = {},
) {

    return {
        ...DEFAULTS,
        ...options,

        blockedProtocols:
            [
                ...(
                    options.blockedProtocols ||
                    DEFAULTS.blockedProtocols
                ),
            ],

        allowedProtocols:
            options.allowedProtocols
                ? [
                    ...options.allowedProtocols,
                ]
                : null,
    };
}

function normalizeText(
    value,
    options,
) {

    let output =
        String(
            value,
        );

    if (
        options.trim
    ) {

        output =
            output.trim();
    }

    if (
        output.length >
        options.maxLength
    ) {

        throw new UrlNormalizationError(
            'TITech URL input exceeds the configured maximum length.',
            {
                code:
                    'URL_INPUT_TOO_LONG',
            },
        );
    }

    return output;
}

function normalizeProtocol(
    protocol,
) {

    return String(
        protocol ||
        '',
    )
        .trim()
        .toLowerCase()
        .replace(
            /:$/,
            '',
        ) + ':';
}

function isIpAddress(
    hostname,
) {

    return (
        net.isIP(
            hostname,
        ) !== 0
    );
}

function isIpv4(
    hostname,
) {

    return (
        net.isIP(
            hostname,
        ) === 4
    );
}

function isIpv6(
    hostname,
) {

    return (
        net.isIP(
            hostname,
        ) === 6
    );
}

function isLoopbackAddress(
    hostname,
) {

    if (
        hostname ===
        'localhost'
    ) {

        return true;
    }

    const family =
        net.isIP(
            hostname,
        );

    if (
        family ===
        4
    ) {

        const parts =
            hostname
                .split('.')
                .map(
                    Number,
                );

        return (
            parts.length ===
                4 &&
            parts[0] ===
                127
        );
    }

    if (
        family ===
        6
    ) {

        return (
            hostname
                .toLowerCase() ===
            '::1'
        );
    }

    return false;
}

function isPrivateIpv4(
    hostname,
) {

    if (
        !isIpv4(
            hostname,
        )
    ) {

        return false;
    }

    const [
        a,
        b,
        c,
        d,
    ] =
        hostname
            .split('.')
            .map(
                Number,
            );

    if (
        a === 10
    ) {

        return true;
    }

    if (
        a === 172 &&
        b >= 16 &&
        b <= 31
    ) {

        return true;
    }

    if (
        a === 192 &&
        b === 168
    ) {

        return true;
    }

    if (
        a === 169 &&
        b === 254
    ) {

        return true;
    }

    /**
     * Carrier-grade NAT.
     */
    if (
        a === 100 &&
        b >= 64 &&
        b <= 127
    ) {

        return true;
    }

    return false;
}

function isPrivateIpv6(
    hostname,
) {

    if (
        !isIpv6(
            hostname,
        )
    ) {

        return false;
    }

    const normalized =
        hostname
            .toLowerCase();

    return (
        normalized.startsWith(
            'fc',
        ) ||
        normalized.startsWith(
            'fd',
        ) ||
        normalized.startsWith(
            'fe8',
        ) ||
        normalized.startsWith(
            'fe9',
        ) ||
        normalized.startsWith(
            'fea',
        ) ||
        normalized.startsWith(
            'feb',
        )
    );
}

function isPrivateNetwork(
    hostname,
) {

    return (
        isPrivateIpv4(
            hostname,
        ) ||
        isPrivateIpv6(
            hostname,
        )
    );
}

function isDefaultPort(
    protocol,
    port,
) {

    const normalized =
        normalizeProtocol(
            protocol,
        );

    const numericPort =
        Number(
            port,
        );

    if (
        numericPort ===
        0
    ) {

        return true;
    }

    const defaults = {
        'http:':
            80,

        'https:':
            443,

        'ws:':
            80,

        'wss:':
            443,

        'mongodb:':
            27017,

        'redis:':
            6379,

        'rediss:':
            6379,

        'smtp:':
            25,

        'smtps:':
            465,

        'amqp:':
            5672,

        'amqps:':
            5671,
    };

    return (
        defaults[
            normalized
        ] ===
        numericPort
    );
}

function sanitizeMetadata(
    metadata,
    options,
) {

    if (
        !metadata ||
        typeof metadata !==
        'object'
    ) {

        return {};
    }

    const result =
        {};

    let count =
        0;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            metadata,
        )
    ) {

        if (
            count >=
            options.maxMetadataKeys
        ) {

            break;
        }

        if (
            key ===
                '__proto__' ||
            key ===
                'prototype' ||
            key ===
                'constructor'
        ) {

            continue;
        }

        result[key] =
            clone(
                value,
            );

        count +=
            1;
    }

    return result;
}

function stableStringify(
    value,
) {

    if (
        value === null ||
        typeof value !==
            'object'
    ) {

        return JSON.stringify(
            value,
        );
    }

    if (
        Array.isArray(
            value,
        )
    ) {

        return `[${value
            .map(
                item =>
                    stableStringify(
                        item,
                    ),
            )
            .join(',')}]`;
    }

    return `{${Object.keys(
        value,
    )
        .sort()
        .map(
            key =>
                `${JSON.stringify(
                    key,
                )}:${stableStringify(
                    value[key],
                )}`,
        )
        .join(',')}}`;
}

function fingerprint(
    value,
    options = DEFAULTS,
) {

    return crypto
        .createHash(
            options.fingerprintAlgorithm ||
                DEFAULTS
                    .fingerprintAlgorithm,
        )
        .update(
            stableStringify(
                value,
            ),
            'utf8',
        )
        .digest(
            'hex',
        );
}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console;

        if (
            typeof logger?.[level] ===
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
        }

    } catch {
        // URL normalization remains independent of logging.
    }
}

/**
 * =============================================================================
 * Protocol policy
 * =============================================================================
 */

function isProtocolAllowed(
    protocol,
    options,
) {

    const normalized =
        normalizeProtocol(
            protocol,
        );

    if (
        options.allowedProtocols
    ) {

        return options.allowedProtocols
            .map(
                normalizeProtocol,
            )
            .includes(
                normalized,
            );
    }

    if (
        options.blockedProtocols
            .map(
                normalizeProtocol,
            )
            .includes(
                normalized,
            )
    ) {

        return false;
    }

    switch (
        normalized
    ) {

        case 'http:':
            return options.allowHttp;

        case 'https:':
            return options.allowHttps;

        case 'ws:':
            return options.allowWs;

        case 'wss:':
            return options.allowWss;

        case 'mongodb:':
            return options.allowMongo;

        case 'mongodb+srv:':
            return options.allowMongoSrv;

        case 'redis:':
            return options.allowRedis;

        case 'rediss:':
            return options.allowRediss;

        case 'smtp:':
            return options.allowSmtp;

        case 'smtps:':
            return options.allowSmtps;

        case 'amqp:':
            return options.allowAmqp;

        case 'amqps:':
            return options.allowAmqps;

        case 'file:':
            return options.allowFile;

        case 'data:':
            return options.allowData;

        case 'javascript:':
            return options.allowJavascript;

        default:
            /**
             * Unknown schemes are denied in strict mode.
             */
            return !options.strict;
    }
}

/**
 * =============================================================================
 * Credential policy
 * =============================================================================
 */

function hasCredentials(
    url,
) {

    return Boolean(
        url.username ||
        url.password,
    );
}

function redactUrlCredentials(
    url,
) {

    const cloneUrl =
        new URL(
            url.toString(),
        );

    cloneUrl.username =
        '';

    cloneUrl.password =
        '';

    return cloneUrl;
}

function buildSafeUrl(
    url,
    options,
) {

    const safeUrl =
        options.redactCredentials ||
        !options.includeCredentials
            ? redactUrlCredentials(
                url,
            )
            : new URL(
                url.toString(),
            );

    return safeUrl.toString();
}

/**
 * =============================================================================
 * Host policy
 * =============================================================================
 */

function validateHostname(
    url,
    options,
) {

    const hostname =
        url.hostname
            .toLowerCase();

    if (
        options.requireHostname &&
        !hostname
    ) {

        throw new UrlNormalizationError(
            'TITech URL must contain a hostname.',
            {
                code:
                    'URL_HOSTNAME_REQUIRED',
            },
        );
    }

    if (
        hostname.length >
        options.maxHostnameLength
    ) {

        throw new UrlNormalizationError(
            'TITech URL hostname exceeds the configured maximum length.',
            {
                code:
                    'URL_HOSTNAME_TOO_LONG',
            },
        );
    }

    if (
        isLoopbackAddress(
            hostname,
        )
    ) {

        if (
            !options.allowLoopback &&
            !(
                hostname ===
                'localhost' &&
                options.allowLocalhost
            )
        ) {

            throw new UrlNormalizationError(
                'Loopback addresses are not allowed by the TITech URL policy.',
                {
                    code:
                        'URL_LOOPBACK_NOT_ALLOWED',
                },
            );
        }
    }

    if (
        hostname ===
        'localhost'
    ) {

        if (
            !options.allowLocalhost
        ) {

            throw new UrlNormalizationError(
                'localhost is not allowed by the TITech URL policy.',
                {
                    code:
                        'URL_LOCALHOST_NOT_ALLOWED',
                },
            );
        }
    }

    if (
        isPrivateNetwork(
            hostname,
        ) &&
        !options.allowPrivateNetwork
    ) {

        throw new UrlNormalizationError(
            'Private-network IP addresses are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_PRIVATE_NETWORK_NOT_ALLOWED',
            },
        );
    }

    if (
        isIpv4(
            hostname,
        ) &&
        !options.allowIpv4
    ) {

        throw new UrlNormalizationError(
            'IPv4 addresses are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_IPV4_NOT_ALLOWED',
            },
        );
    }

    if (
        isIpv6(
            hostname,
        ) &&
        !options.allowIpv6
    ) {

        throw new UrlNormalizationError(
            'IPv6 addresses are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_IPV6_NOT_ALLOWED',
            },
        );
    }

    if (
        isIpAddress(
            hostname,
        ) &&
        !options.allowIpLiterals
    ) {

        throw new UrlNormalizationError(
            'IP-literal hosts are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_IP_LITERAL_NOT_ALLOWED',
            },
        );
    }

    return hostname;
}

/**
 * =============================================================================
 * Port policy
 * =============================================================================
 */

function validatePort(
    url,
    options,
) {

    const port =
        url.port;

    if (
        !port
    ) {

        if (
            options.requirePort
        ) {

            throw new UrlNormalizationError(
                'TITech URL must specify a port.',
                {
                    code:
                        'URL_PORT_REQUIRED',
                },
            );
        }

        return null;
    }

    const numericPort =
        Number(
            port,
        );

    if (
        !Number.isInteger(
            numericPort,
        )
    ) {

        throw new UrlNormalizationError(
            'TITech URL contains an invalid port.',
            {
                code:
                    'URL_PORT_INVALID',
            },
        );
    }

    if (
        numericPort <
            options.minPort ||
        numericPort >
            options.maxPort
    ) {

        throw new UrlNormalizationError(
            'TITech URL port is outside the allowed range.',
            {
                code:
                    'URL_PORT_OUT_OF_RANGE',
            },
        );
    }

    if (
        !options.allowNonStandardPorts &&
        !isDefaultPort(
            url.protocol,
            numericPort,
        )
    ) {

        throw new UrlNormalizationError(
            'Non-standard URL ports are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_NON_STANDARD_PORT_NOT_ALLOWED',
            },
        );
    }

    return numericPort;
}

/**
 * =============================================================================
 * URL structural policy
 * =============================================================================
 */

function validateUrlStructure(
    url,
    options,
) {

    const protocol =
        normalizeProtocol(
            url.protocol,
        );

    if (
        options.requireProtocol &&
        !url.protocol
    ) {

        throw new UrlNormalizationError(
            'TITech URL protocol is required.',
            {
                code:
                    'URL_PROTOCOL_REQUIRED',
            },
        );
    }

    if (
        !isProtocolAllowed(
            protocol,
            options,
        )
    ) {

        throw new UrlNormalizationError(
            `TITech URL protocol "${protocol}" is not permitted.`,
            {
                code:
                    'URL_PROTOCOL_NOT_ALLOWED',

                details: {
                    protocol,
                },
            },
        );
    }

    if (
        !options.allowCredentials &&
        hasCredentials(
            url,
        )
    ) {

        throw new UrlNormalizationError(
            'Credentials are not allowed in TITech configuration URLs.',
            {
                code:
                    'URL_CREDENTIALS_NOT_ALLOWED',
            },
        );
    }

    if (
        !options.allowUsername &&
        url.username
    ) {

        throw new UrlNormalizationError(
            'URL username is not permitted by the TITech URL policy.',
            {
                code:
                    'URL_USERNAME_NOT_ALLOWED',
            },
        );
    }

    if (
        !options.allowPassword &&
        url.password
    ) {

        throw new UrlNormalizationError(
            'URL password is not permitted by the TITech URL policy.',
            {
                code:
                    'URL_PASSWORD_NOT_ALLOWED',
            },
        );
    }

    validateHostname(
        url,
        options,
    );

    validatePort(
        url,
        options,
    );

    if (
        url.pathname.length >
        options.maxPathLength
    ) {

        throw new UrlNormalizationError(
            'TITech URL pathname exceeds the configured maximum length.',
            {
                code:
                    'URL_PATH_TOO_LONG',
            },
        );
    }

    if (
        url.search.length >
        options.maxQueryLength
    ) {

        throw new UrlNormalizationError(
            'TITech URL query exceeds the configured maximum length.',
            {
                code:
                    'URL_QUERY_TOO_LONG',
            },
        );
    }

    if (
        url.hash.length >
        options.maxFragmentLength
    ) {

        throw new UrlNormalizationError(
            'TITech URL fragment exceeds the configured maximum length.',
            {
                code:
                    'URL_FRAGMENT_TOO_LONG',
            },
        );
    }

    if (
        !options.allowQuery &&
        url.search
    ) {

        throw new UrlNormalizationError(
            'URL query parameters are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_QUERY_NOT_ALLOWED',
            },
        );
    }

    if (
        !options.allowFragments &&
        url.hash
    ) {

        throw new UrlNormalizationError(
            'URL fragments are not allowed by the TITech URL policy.',
            {
                code:
                    'URL_FRAGMENT_NOT_ALLOWED',
            },
        );
    }

    if (
        options.requirePath &&
        !url.pathname
    ) {

        throw new UrlNormalizationError(
            'TITech URL pathname is required.',
            {
                code:
                    'URL_PATH_REQUIRED',
            },
        );
    }
}

/**
 * =============================================================================
 * URL canonicalization
 * =============================================================================
 */

function canonicalizeUrl(
    url,
    options,
) {

    const normalized =
        new URL(
            url.toString(),
        );

    if (
        options.normalizeProtocol
    ) {

        normalized.protocol =
            normalizeProtocol(
                normalized.protocol,
            );
    }

    if (
        options.normalizeHostname &&
        normalized.hostname
    ) {

        normalized.hostname =
            normalized.hostname
                .toLowerCase();
    }

    if (
        options.normalizeTrailingSlash
    ) {

        if (
            normalized.pathname.length >
            1
        ) {

            normalized.pathname =
                normalized.pathname.replace(
                    /\/+$/,
                    '',
                ) ||
                '/';
        }
    }

    if (
        options.removeDefaultPort &&
        normalized.port &&
        isDefaultPort(
            normalized.protocol,
            normalized.port,
        )
    ) {

        normalized.port =
            '';
    }

    if (
        !options.preserveSearch
    ) {

        normalized.search =
            '';
    }

    if (
        !options.preserveHash
    ) {

        normalized.hash =
            '';
    }

    if (
        !options.preservePath
    ) {

        normalized.pathname =
            '/';
    }

    if (
        options.normalizeSearchParams
    ) {

        const entries =
            [
                ...normalized
                    .searchParams
                    .entries(),
            ]
                .sort(
                    (
                        left,
                        right,
                    ) =>
                        left[0].localeCompare(
                            right[0],
                        ) ||
                        left[1].localeCompare(
                            right[1],
                        ),
                );

        normalized.search =
            '';

        for (
            const [
                key,
                value,
            ] of entries
        ) {

            normalized.searchParams.append(
                key,
                value,
            );
        }
    }

    return normalized;
}

/**
 * =============================================================================
 * Relative URL handling
 * =============================================================================
 */

function normalizeRelative(
    input,
    options,
) {

    if (
        !options.allowRelative
    ) {

        throw new UrlNormalizationError(
            'Relative URLs are not permitted by the TITech URL policy.',
            {
                code:
                    'URL_RELATIVE_NOT_ALLOWED',
            },
        );
    }

    let base =
        options.baseUrl;

    if (
        !base
    ) {

        throw new UrlNormalizationError(
            'A baseUrl is required when relative TITech URLs are enabled.',
            {
                code:
                    'URL_RELATIVE_BASE_REQUIRED',
            },
        );
    }

    try {

        base =
            new URL(
                String(
                    base,
                ),
            );

        return new URL(
            input,
            base,
        );

    } catch (
        error
    ) {

        throw new UrlNormalizationError(
            'Invalid TITech relative URL or base URL.',
            {
                code:
                    'URL_RELATIVE_INVALID',

                cause:
                    error,
            },
        );
    }
}

/**
 * =============================================================================
 * Mode extraction
 * =============================================================================
 */

function extractModeValue(
    url,
    mode,
    options,
) {

    switch (
        mode
    ) {

        case URL_MODES.ORIGIN:

            return url.origin;

        case URL_MODES.HOST:

            return url.host;

        case URL_MODES.HOSTNAME:

            return url.hostname;

        case URL_MODES.PORT:

            return url.port
                ? Number(
                    url.port,
                )
                : null;

        case URL_MODES.PATHNAME:

            return url.pathname;

        case URL_MODES.SEARCH:

            return options.allowQuery
                ? url.search
                : '';

        case URL_MODES.SEARCH_PARAMS:

            return Object.fromEntries(
                url.searchParams.entries(),
            );

        case URL_MODES.PROTOCOL:

            return url.protocol;

        case URL_MODES.URL:
        default:

            return buildSafeUrl(
                url,
                options,
            );
    }
}

/**
 * =============================================================================
 * URL extraction / parsing
 * =============================================================================
 */

function parseUrlInput(
    value,
    options,
) {

    if (
        value instanceof URL
    ) {

        return new URL(
            value.toString(),
        );
    }

    const input =
        normalizeText(
            value,
            options,
        );

    if (
        input ===
        ''
    ) {

        if (
            options.allowEmpty
        ) {

            if (
                options.emptyDefault !==
                undefined
            ) {

                return parseUrlInput(
                    options.emptyDefault,
                    options,
                );
            }

            if (
                options.defaultValue !==
                undefined
            ) {

                return parseUrlInput(
                    options.defaultValue,
                    options,
                );
            }
        }

        throw new UrlNormalizationError(
            'Empty TITech URL value is not allowed.',
            {
                code:
                    'URL_EMPTY_VALUE',
            },
        );
    }

    try {

        /**
         * Protocol-relative URLs are not accepted automatically because their
         * effective scheme depends on an external runtime context.
         */
        if (
            input.startsWith(
                '//',
            )
        ) {

            if (
                !options.allowRelative
            ) {

                throw new UrlNormalizationError(
                    'Protocol-relative TITech URLs are not permitted.',
                    {
                        code:
                            'URL_PROTOCOL_RELATIVE_NOT_ALLOWED',
                    },
                );
            }

            return normalizeRelative(
                input,
                options,
            );
        }

        /**
         * Relative URLs require an explicit base URL.
         */
        if (
            !/^[a-z][a-z0-9+.-]*:/i.test(
                input,
            )
        ) {

            return normalizeRelative(
                input,
                options,
            );
        }

        return new URL(
            input,
        );

    } catch (
        error
    ) {

        if (
            error instanceof
            UrlNormalizationError
        ) {

            throw error;
        }

        throw new UrlNormalizationError(
            `Invalid TITech URL "${sanitizeInputForMessage(
                input,
            )}".`,
            {
                code:
                    'URL_INVALID',

                cause:
                    error,
            },
        );
    }
}

function sanitizeInputForMessage(
    value,
) {

    const text =
        String(
            value,
        );

    return text.length >
        256
        ? `${text.slice(
            0,
            256,
        )}[TRUNCATED]`
        : text;
}

/**
 * =============================================================================
 * NumberNormalizer-style public engine
 * =============================================================================
 */

class UrlNormalizer {

    constructor(
        options = {},
    ) {

        this.options =
            Object.freeze(
                normalizeOptions(
                    options,
                ),
            );

        this.state =
            'created';

        this.normalizationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;
    }

    /**
     * -------------------------------------------------------------------------
     * Normalize.
     * -------------------------------------------------------------------------
     */

    normalize(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        this.state =
            'normalizing';

        try {

            if (
                (
                    value ===
                        undefined ||
                    value ===
                        null
                ) &&
                config.defaultValue !==
                    undefined
            ) {

                value =
                    config.defaultValue;
            }

            const inputType =
                value instanceof URL
                    ? URL_INPUT_TYPES.URL
                    : typeof value ===
                        'string'
                        ? URL_INPUT_TYPES.STRING
                        : URL_INPUT_TYPES.AUTO;

            if (
                config.inputType ===
                URL_INPUT_TYPES.URL &&
                !(value instanceof URL)
            ) {

                throw new UrlNormalizationError(
                    'TITech URL inputType "url" requires a URL instance.',
                    {
                        code:
                            'URL_INPUT_TYPE_INVALID',
                    },
                );
            }

            if (
                config.inputType ===
                URL_INPUT_TYPES.STRING &&
                typeof value !==
                'string'
            ) {

                throw new UrlNormalizationError(
                    'TITech URL inputType "string" requires a string value.',
                    {
                        code:
                            'URL_STRING_INPUT_TYPE_INVALID',
                    },
                );
            }

            const parsed =
                parseUrlInput(
                    value,
                    config,
                );

            validateUrlStructure(
                parsed,
                config,
            );

            const canonical =
                canonicalizeUrl(
                    parsed,
                    config,
                );

            /**
             * Run structural validation once more after normalization so an
             * option such as trailing-slash removal cannot accidentally produce
             * an invalid state.
             */
            validateUrlStructure(
                canonical,
                config,
            );

            const extracted =
                extractModeValue(
                    canonical,
                    config.mode,
                    config,
                );

            const result =
                this.buildResult(
                    value,
                    canonical,
                    extracted,
                    inputType,
                    config,
                );

            this.lastResult =
                result;

            this.lastError =
                null;

            this.state =
                'ready';

            this.normalizationCount +=
                1;

            log(
                'debug',
                {
                    variable:
                        config.variable ||
                        null,

                    path:
                        config.path ||
                        null,

                    protocol:
                        canonical.protocol,

                    hostname:
                        canonical.hostname,
                },
                'TITech environment URL normalization completed.',
            );

            return config.freezeResult
                ? deepFreeze(
                    result,
                )
                : result;

        } catch (
            error
        ) {

            this.state =
                'failed';

            this.lastError =
                error;

            throw (
                error instanceof
                UrlNormalizationError
                    ? error
                    : new UrlNormalizationError(
                        'TITech URL normalization failed.',
                        {
                            code:
                                'URL_NORMALIZATION_FAILED',

                            variable:
                                config.variable,

                            path:
                                config.path,

                            cause:
                                error,
                        },
                    )
            );
        }
    }

    /**
     * -------------------------------------------------------------------------
     * Value only.
     * -------------------------------------------------------------------------
     */

    value(
        input,
        options = {},
    ) {

        return this.normalize(
            input,
            {
                ...options,
                freezeResult:
                    false,
            },
        ).value;
    }

    /**
     * -------------------------------------------------------------------------
     * Require URL.
     * -------------------------------------------------------------------------
     */

    require(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                allowEmpty:
                    false,

                defaultValue:
                    undefined,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Origin.
     * -------------------------------------------------------------------------
     */

    origin(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.ORIGIN,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Host.
     * -------------------------------------------------------------------------
     */

    host(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.HOST,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Hostname.
     * -------------------------------------------------------------------------
     */

    hostname(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.HOSTNAME,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Port.
     * -------------------------------------------------------------------------
     */

    port(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.PORT,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Path.
     * -------------------------------------------------------------------------
     */

    pathname(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.PATHNAME,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Search/query.
     * -------------------------------------------------------------------------
     */

    search(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.SEARCH,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Search parameters.
     * -------------------------------------------------------------------------
     */

    searchParams(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.SEARCH_PARAMS,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Protocol.
     * -------------------------------------------------------------------------
     */

    protocol(
        input,
        options = {},
    ) {

        return this.value(
            input,
            {
                ...options,

                mode:
                    URL_MODES.PROTOCOL,
            },
        );
    }

    /**
     * -------------------------------------------------------------------------
     * Validate.
     * -------------------------------------------------------------------------
     */

    validate(
        value,
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        const parsed =
            parseUrlInput(
                value,
                config,
            );

        validateUrlStructure(
            parsed,
            config,
        );

        return deepFreeze({
            valid:
                true,

            protocol:
                parsed.protocol,

            hostname:
                parsed.hostname,

            port:
                parsed.port
                    ? Number(
                        parsed.port,
                    )
                    : null,

            hasCredentials:
                hasCredentials(
                    parsed,
                ),

            origin:
                parsed.origin,

            fingerprint:
                fingerprint(
                    buildSafeUrl(
                        parsed,
                        {
                            ...config,
                            includeCredentials:
                                false,
                            redactCredentials:
                                true,
                        },
                    ),
                    config,
                ),

            variable:
                config.variable ||
                null,

            path:
                config.path ||
                null,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Build normalization result.
     * -------------------------------------------------------------------------
     */

    buildResult(
        rawValue,
        canonicalUrl,
        extracted,
        inputType,
        options,
    ) {

        const safeUrl =
            buildSafeUrl(
                canonicalUrl,
                options,
            );

        const metadata =
            sanitizeMetadata(
                options.metadata,
                options,
            );

        const result = {
            value:
                extracted,

            url:
                safeUrl,

            type:
                'url',

            mode:
                options.mode,

            inputType,

            protocol:
                canonicalUrl.protocol,

            hostname:
                canonicalUrl.hostname,

            port:
                canonicalUrl.port
                    ? Number(
                        canonicalUrl.port,
                    )
                    : null,

            origin:
                canonicalUrl.origin,

            pathname:
                canonicalUrl.pathname,

            hasCredentials:
                hasCredentials(
                    canonicalUrl,
                ),

            variable:
                options.variable ||
                null,

            path:
                options.path ||
                null,

            metadata,

            fingerprint:
                fingerprint(
                    safeUrl,
                    options,
                ),

            timestamp:
                new Date().toISOString(),
        };

        if (
            options.includeSourceValue
        ) {

            result.sourceValue =
                options.redactCredentials
                    ? safeUrl
                    : String(
                        rawValue,
                    );
        }

        if (
            options.includeCredentials &&
            options.allowCredentials
        ) {

            result.credentials =
                {
                    username:
                        canonicalUrl.username ||
                        null,

                    password:
                        canonicalUrl.password ||
                        null,
                };
        }

        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * Describe policy.
     * -------------------------------------------------------------------------
     */

    describe(
        options = {},
    ) {

        const config =
            normalizeOptions({
                ...this.options,
                ...options,
            });

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            inputType:
                config.inputType,

            mode:
                config.mode,

            strict:
                config.strict,

            requireProtocol:
                config.requireProtocol,

            requireHostname:
                config.requireHostname,

            requirePort:
                config.requirePort,

            requirePath:
                config.requirePath,

            allowCredentials:
                config.allowCredentials,

            allowLocalhost:
                config.allowLocalhost,

            allowLoopback:
                config.allowLoopback,

            allowPrivateNetwork:
                config.allowPrivateNetwork,

            normalizeProtocol:
                config.normalizeProtocol,

            normalizeHostname:
                config.normalizeHostname,

            normalizeTrailingSlash:
                config.normalizeTrailingSlash,

            removeDefaultPort:
                config.removeDefaultPort,

            allowedProtocols:
                config.allowedProtocols,

            blockedProtocols:
                [
                    ...config.blockedProtocols,
                ],

            maxLength:
                config.maxLength,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Snapshot.
     * -------------------------------------------------------------------------
     */

    snapshot() {

        return deepFreeze({
            component:
                COMPONENT,

            service:
                SERVICE_NAME,

            application:
                APPLICATION_NAME,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            lastResult:
                clone(
                    this.lastResult,
                ),

            lastError:
                this.lastError
                    ? {
                        name:
                            this.lastError.name,

                        code:
                            this.lastError.code,

                        message:
                            this.lastError.message,
                    }
                    : null,

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * -------------------------------------------------------------------------
     * Readiness.
     * -------------------------------------------------------------------------
     */

    readiness() {

        return {
            status:
                this.state ===
                    'failed'
                    ? 'not_ready'
                    : 'ready',

            ready:
                this.state !==
                'failed',

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Health.
     * -------------------------------------------------------------------------
     */

    health() {

        const readiness =
            this.readiness();

        return {
            status:
                readiness.ready
                    ? 'healthy'
                    : 'unhealthy',

            healthy:
                readiness.ready,

            state:
                this.state,

            normalizationCount:
                this.normalizationCount,

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * -------------------------------------------------------------------------
     * Reset.
     * -------------------------------------------------------------------------
     */

    reset() {

        this.state =
            'created';

        this.normalizationCount =
            0;

        this.lastResult =
            null;

        this.lastError =
            null;

        return this;
    }
}

/**
 * =============================================================================
 * Singleton
 * =============================================================================
 */

const urlNormalizer =
    new UrlNormalizer();

/**
 * =============================================================================
 * Convenience functions
 * =============================================================================
 */

function normalize(
    value,
    options,
) {

    return urlNormalizer.normalize(
        value,
        options,
    );
}

function value(
    valueInput,
    options,
) {

    return urlNormalizer.value(
        valueInput,
        options,
    );
}

function requireUrl(
    valueInput,
    options,
) {

    return urlNormalizer.require(
        valueInput,
        options,
    );
}

function origin(
    valueInput,
    options,
) {

    return urlNormalizer.origin(
        valueInput,
        options,
    );
}

function host(
    valueInput,
    options,
) {

    return urlNormalizer.host(
        valueInput,
        options,
    );
}

function hostname(
    valueInput,
    options,
) {

    return urlNormalizer.hostname(
        valueInput,
        options,
    );
}

function port(
    valueInput,
    options,
) {

    return urlNormalizer.port(
        valueInput,
        options,
    );
}

function pathname(
    valueInput,
    options,
) {

    return urlNormalizer.pathname(
        valueInput,
        options,
    );
}

function search(
    valueInput,
    options,
) {

    return urlNormalizer.search(
        valueInput,
        options,
    );
}

function searchParams(
    valueInput,
    options,
) {

    return urlNormalizer.searchParams(
        valueInput,
        options,
    );
}

function protocol(
    valueInput,
    options,
) {

    return urlNormalizer.protocol(
        valueInput,
        options,
    );
}

function validate(
    valueInput,
    options,
) {

    return urlNormalizer.validate(
        valueInput,
        options,
    );
}

function describe(
    options,
) {

    return urlNormalizer.describe(
        options,
    );
}

function snapshot() {

    return urlNormalizer.snapshot();
}

function readiness() {

    return urlNormalizer.readiness();
}

function health() {

    return urlNormalizer.health();
}

function reset() {

    return urlNormalizer.reset();
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Singleton and class.
         */
        urlNormalizer,

        UrlNormalizer,

        UrlNormalizationError,

        /**
         * Constants.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        URL_INPUT_TYPES,

        URL_MODES,

        DEFAULTS,

        /**
         * Core.
         */
        normalize,

        value,

        require:
            requireUrl,

        /**
         * URL projections.
         */
        origin,

        host,

        hostname,

        port,

        pathname,

        search,

        searchParams,

        protocol,

        /**
         * Validation.
         */
        validate,

        /**
         * Diagnostics.
         */
        describe,

        snapshot,

        readiness,

        health,

        /**
         * Utility.
         */
        fingerprint,

        stableStringify,

        isIpAddress,

        isIpv4,

        isIpv6,

        isLoopbackAddress,

        isPrivateNetwork,

        isDefaultPort,

        /**
         * Reset.
         */
        reset,
    });