'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN Callback Registry
 * ============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/mtnCallbackRegistry.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Central composition/dispatch registry for MTN callback processing.
 *
 * Registry responsibility:
 *
 *   provider
 *      ↓
 *   callback type
 *      ↓
 *   normalizer
 *      ↓
 *   validator
 *      ↓
 *   processor
 *
 * The registry deliberately does NOT:
 * - process financial transactions
 * - perform provider communication
 * - post to the ledger
 * - mutate payment state
 * - perform reconciliation
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Normalize provider identity consistently.
 * - Reject malformed definitions at registration time.
 * - Prevent accidental duplicate registrations.
 * - Keep registered definitions immutable.
 * - Never expose internal mutable registry state.
 * - Fail closed when a provider is missing.
 * - Support controlled replacement during application bootstrap.
 * - Preserve operational metadata safely.
 *
 * ============================================================================
 */

const {
    MTNCallbackError,
    MTNCallbackConfigurationError,
} = require('./mtnCallbackErrors');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_PROVIDER =
    'MTN_MOMO';

const MAX_PROVIDER_LENGTH =
    128;

const MAX_METADATA_KEYS =
    50;

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeProvider(
    provider
) {
    if (
        typeof provider !== 'string' ||
        provider.trim() === ''
    ) {
        throw new MTNCallbackError(
            'Callback provider is required.',
            {
                code:
                    'MTN_CALLBACK_PROVIDER_REQUIRED',

                category:
                    'CONFIGURATION',

                retryable:
                    false,
            }
        );
    }

    const normalized =
        provider
            .trim()
            .toUpperCase();

    if (
        normalized.length >
        MAX_PROVIDER_LENGTH
    ) {
        throw new MTNCallbackError(
            'Callback provider exceeds maximum length.',
            {
                code:
                    'MTN_CALLBACK_PROVIDER_INVALID',

                category:
                    'CONFIGURATION',

                retryable:
                    false,
            }
        );
    }

    if (
        !/^[A-Z0-9][A-Z0-9_.-]*$/.test(
            normalized
        )
    ) {
        throw new MTNCallbackError(
            'Callback provider contains unsupported characters.',
            {
                code:
                    'MTN_CALLBACK_PROVIDER_INVALID',

                category:
                    'CONFIGURATION',

                retryable:
                    false,
            }
        );
    }

    return normalized;
}

function sanitizeMetadata(
    metadata
) {
    if (
        metadata === undefined ||
        metadata === null
    ) {
        return Object.freeze({});
    }

    if (
        typeof metadata !== 'object' ||
        Array.isArray(metadata)
    ) {
        throw new MTNCallbackConfigurationError(
            'Callback definition metadata must be an object.',
            {
                code:
                    'MTN_CALLBACK_METADATA_INVALID',
            }
        );
    }

    const entries =
        Object.entries(
            metadata
        );

    if (
        entries.length >
        MAX_METADATA_KEYS
    ) {
        throw new MTNCallbackConfigurationError(
            `Callback definition metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
            {
                code:
                    'MTN_CALLBACK_METADATA_TOO_LARGE',
            }
        );
    }

    const result = {};

    for (
        const [key, value]
        of entries
    ) {
        if (
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor'
        ) {
            throw new MTNCallbackConfigurationError(
                `Unsafe callback metadata key is not permitted: ${key}`,
                {
                    code:
                        'MTN_CALLBACK_METADATA_UNSAFE',
                }
            );
        }

        if (
            typeof value === 'function' ||
            typeof value === 'symbol'
        ) {
            throw new MTNCallbackConfigurationError(
                `Unsupported callback metadata value for ${key}.`,
                {
                    code:
                        'MTN_CALLBACK_METADATA_VALUE_INVALID',
                }
            );
        }

        result[key] =
            value;
    }

    return Object.freeze(
        result
    );
}

function assertFunction(
    value,
    name,
    code
) {
    if (
        typeof value !== 'function'
    ) {
        throw new MTNCallbackConfigurationError(
            `${name} is required and must be a function.`,
            {
                code,
            }
        );
    }
}

function freezeDefinition(
    definition
) {
    return Object.freeze({
        ...definition,

        metadata:
            Object.freeze({
                ...(definition.metadata || {})
            })
    });
}

/**
 * ============================================================================
 * Registry
 * ============================================================================
 */

class MTNCallbackRegistry {

    constructor(options = {}) {

        this.logger =
            options.logger ||
            console;

        this.providers =
            new Map();

        this.defaultProvider =
            normalizeProvider(
                options.defaultProvider ||
                DEFAULT_PROVIDER
            );

        /**
         * By default, duplicate registration is a configuration error.
         *
         * During application bootstrap an explicit replace:true may be used
         * for controlled hot configuration / testing.
         */
        this.allowReplacement =
            options.allowReplacement === true;

        this.strictRegistration =
            options.strictRegistration !==
                undefined
                ? Boolean(
                    options.strictRegistration
                )
                : true;
    }

    /**
     * =========================================================================
     * Register
     * =========================================================================
     */

    register(
        provider,
        definition = {},
        options = {}
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        if (
            !definition ||
            typeof definition !== 'object'
        ) {
            throw new MTNCallbackConfigurationError(
                'Callback provider definition must be an object.',
                {
                    code:
                        'MTN_CALLBACK_DEFINITION_INVALID',
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Required pipeline stages
         * ---------------------------------------------------------------------
         */

        assertFunction(
            definition.normalizer,
            'Callback normalizer',
            'MTN_CALLBACK_NORMALIZER_REQUIRED'
        );

        assertFunction(
            definition.validator,
            'Callback validator',
            'MTN_CALLBACK_VALIDATOR_REQUIRED'
        );

        assertFunction(
            definition.processor,
            'Callback processor',
            'MTN_CALLBACK_PROCESSOR_REQUIRED'
        );

        /**
         * ---------------------------------------------------------------------
         * Optional components
         * ---------------------------------------------------------------------
         */

        if (
            definition.idempotency !==
                undefined &&
            definition.idempotency !==
                null
        ) {
            if (
                typeof definition.idempotency !==
                'object'
            ) {
                throw new MTNCallbackConfigurationError(
                    'Callback idempotency component must be an object.',
                    {
                        code:
                            'MTN_CALLBACK_IDEMPOTENCY_INVALID',
                    }
                );
            }
        }

        if (
            definition.deadLetter !==
                undefined &&
            definition.deadLetter !==
                null
        ) {
            if (
                typeof definition.deadLetter !==
                'object'
            ) {
                throw new MTNCallbackConfigurationError(
                    'Callback dead-letter component must be an object.',
                    {
                        code:
                            'MTN_CALLBACK_DLQ_INVALID',
                    }
                );
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Registration collision
         * ---------------------------------------------------------------------
         */

        const exists =
            this.providers.has(
                normalizedProvider
            );

        const replace =
            options.replace === true;

        if (
            exists &&
            !replace &&
            !this.allowReplacement
        ) {
            throw new MTNCallbackConfigurationError(
                `Callback provider ${normalizedProvider} is already registered.`,
                {
                    code:
                        'MTN_CALLBACK_PROVIDER_ALREADY_REGISTERED',
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Metadata
         * ---------------------------------------------------------------------
         */

        const metadata =
            sanitizeMetadata(
                definition.metadata
            );

        /**
         * ---------------------------------------------------------------------
         * Immutable provider definition
         * ---------------------------------------------------------------------
         */

        const registeredDefinition =
            freezeDefinition({
                provider:
                    normalizedProvider,

                normalizer:
                    definition.normalizer,

                validator:
                    definition.validator,

                processor:
                    definition.processor,

                idempotency:
                    definition.idempotency ||
                    null,

                deadLetter:
                    definition.deadLetter ||
                    null,

                metadata,

                registeredAt:
                    new Date(),

                version:
                    definition.version ||
                    '1.0',

                enabled:
                    definition.enabled !== false,
            });

        this.providers.set(
            normalizedProvider,
            registeredDefinition
        );

        try {
            this.logger.info?.({
                event:
                    'payment.mtn.callback.provider_registered',

                provider:
                    normalizedProvider,

                replaced:
                    exists && replace,
            });
        } catch {
            /**
             * Registry logging must never affect registration.
             */
        }

        return this;
    }

    /**
     * =========================================================================
     * Unregister
     * =========================================================================
     *
     * Unregistering providers in production should generally be disabled
     * unless performed through controlled application lifecycle/configuration.
     * =========================================================================
     */

    unregister(
        provider,
        options = {}
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        const allow =
            options.force === true ||
            options.allow === true;

        if (
            this.strictRegistration &&
            !allow
        ) {
            throw new MTNCallbackConfigurationError(
                `Provider ${normalizedProvider} cannot be unregistered without explicit authorization.`,
                {
                    code:
                        'MTN_CALLBACK_PROVIDER_UNREGISTER_FORBIDDEN',
                }
            );
        }

        const deleted =
            this.providers.delete(
                normalizedProvider
            );

        if (
            deleted
        ) {
            try {
                this.logger.warn?.({
                    event:
                        'payment.mtn.callback.provider_unregistered',

                    provider:
                        normalizedProvider,
                });
            } catch {
                // Logging is non-fatal.
            }
        }

        return deleted;
    }

    /**
     * =========================================================================
     * Get
     * =========================================================================
     */

    get(
        provider
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        return this.providers.get(
            normalizedProvider
        ) || null;
    }

    /**
     * =========================================================================
     * Has
     * =========================================================================
     */

    has(
        provider
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        return this.providers.has(
            normalizedProvider
        );
    }

    /**
     * =========================================================================
     * Resolve
     * =========================================================================
     */

    resolve(
        provider
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider ||
                this.defaultProvider
            );

        const definition =
            this.providers.get(
                normalizedProvider
            );

        if (
            !definition
        ) {
            throw new MTNCallbackConfigurationError(
                `No callback handler registered for provider ${normalizedProvider}.`,
                {
                    code:
                        'MTN_CALLBACK_PROVIDER_NOT_REGISTERED',
                }
            );
        }

        if (
            definition.enabled === false
        ) {
            throw new MTNCallbackConfigurationError(
                `Callback processing is disabled for provider ${normalizedProvider}.`,
                {
                    code:
                        'MTN_CALLBACK_PROVIDER_DISABLED',
                }
            );
        }

        return definition;
    }

    /**
     * =========================================================================
     * Resolve Default
     * =========================================================================
     */

    resolveDefault() {
        return this.resolve(
            this.defaultProvider
        );
    }

    /**
     * =========================================================================
     * Set Default Provider
     * =========================================================================
     */

    setDefaultProvider(
        provider
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        if (
            !this.providers.has(
                normalizedProvider
            )
        ) {
            throw new MTNCallbackConfigurationError(
                `Cannot set unregistered provider ${normalizedProvider} as default.`,
                {
                    code:
                        'MTN_CALLBACK_DEFAULT_PROVIDER_NOT_REGISTERED',
                }
            );
        }

        this.defaultProvider =
            normalizedProvider;

        return this;
    }

    /**
     * =========================================================================
     * List
     * =========================================================================
     */

    list(
        options = {}
    ) {
        const includeDisabled =
            options.includeDisabled === true;

        const providers =
            [];

        for (
            const [
                provider,
                definition
            ]
            of this.providers.entries()
        ) {
            if (
                !includeDisabled &&
                definition.enabled === false
            ) {
                continue;
            }

            providers.push(
                provider
            );
        }

        return Object.freeze(
            providers
        );
    }

    /**
     * =========================================================================
     * List Definitions
     * =========================================================================
     *
     * Does not expose mutable internal references.
     */

    listDefinitions(
        options = {}
    ) {
        const includeDisabled =
            options.includeDisabled === true;

        const result = [];

        for (
            const definition
            of this.providers.values()
        ) {
            if (
                !includeDisabled &&
                definition.enabled === false
            ) {
                continue;
            }

            result.push({
                provider:
                    definition.provider,

                version:
                    definition.version,

                enabled:
                    definition.enabled,

                metadata:
                    {
                        ...definition.metadata
                    },

                registeredAt:
                    new Date(
                        definition.registeredAt.getTime()
                    ),
            });
        }

        return Object.freeze(
            result
        );
    }

    /**
     * =========================================================================
     * Enable Provider
     * =========================================================================
     */

    enable(
        provider
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        const existing =
            this.providers.get(
                normalizedProvider
            );

        if (
            !existing
        ) {
            throw new MTNCallbackConfigurationError(
                `Provider ${normalizedProvider} is not registered.`,
                {
                    code:
                        'MTN_CALLBACK_PROVIDER_NOT_REGISTERED',
                }
            );
        }

        this.providers.set(
            normalizedProvider,
            Object.freeze({
                ...existing,

                enabled:
                    true,
            })
        );

        return this;
    }

    /**
     * =========================================================================
     * Disable Provider
     * =========================================================================
     */

    disable(
        provider
    ) {
        const normalizedProvider =
            normalizeProvider(
                provider
            );

        const existing =
            this.providers.get(
                normalizedProvider
            );

        if (
            !existing
        ) {
            throw new MTNCallbackConfigurationError(
                `Provider ${normalizedProvider} is not registered.`,
                {
                    code:
                        'MTN_CALLBACK_PROVIDER_NOT_REGISTERED',
                }
            );
        }

        /**
         * Do not silently disable the active default provider.
         */
        if (
            normalizedProvider ===
            this.defaultProvider
        ) {
            throw new MTNCallbackConfigurationError(
                `The default callback provider ${normalizedProvider} cannot be disabled.`,
                {
                    code:
                        'MTN_CALLBACK_DEFAULT_PROVIDER_DISABLE_FORBIDDEN',
                }
            );
        }

        this.providers.set(
            normalizedProvider,
            Object.freeze({
                ...existing,

                enabled:
                    false,
            })
        );

        return this;
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {
        const definitions =
            this.listDefinitions({
                includeDisabled:
                    true,
            });

        const enabledCount =
            definitions.filter(
                definition =>
                    definition.enabled
            ).length;

        return {
            status:
                enabledCount > 0
                    ? 'UP'
                    : 'DEGRADED',

            defaultProvider:
                this.defaultProvider,

            providerCount:
                definitions.length,

            enabledProviderCount:
                enabledCount,

            providers:
                definitions,
        };
    }

    /**
     * =========================================================================
     * Clear
     * =========================================================================
     *
     * Intended primarily for tests and controlled application teardown.
     */

    clear(
        options = {}
    ) {
        if (
            this.strictRegistration &&
            options.force !== true
        ) {
            throw new MTNCallbackConfigurationError(
                'Callback registry clear requires explicit force authorization.',
                {
                    code:
                        'MTN_CALLBACK_REGISTRY_CLEAR_FORBIDDEN',
                }
            );
        }

        this.providers.clear();

        return this;
    }
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    MTNCallbackRegistry;