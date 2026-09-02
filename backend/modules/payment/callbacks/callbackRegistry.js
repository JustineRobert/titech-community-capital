/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Registry
 * ============================================================================
 *
 * Central registry responsible for maintaining callback handlers for all
 * payment providers.
 *
 * Responsibilities
 * ---------------
 * • Provider registration
 * • Provider lookup
 * • Duplicate protection
 * • Runtime statistics
 * • Registry inspection
 * • Safe resolution
 * • Health reporting
 */

class CallbackRegistry {

    constructor(options = {}) {

        this.providers = new Map();

        this.options = Object.freeze({
            allowOverwrite: false,
            ...options
        });

        this.statistics = {
            registrations: 0,
            resolutions: 0,
            misses: 0,
            removals: 0
        };
    }

    /**
     * Register a provider callback handler.
     */
    register(provider, handler) {

        this.#validateProvider(provider);
        this.#validateHandler(handler);

        if (
            this.providers.has(provider) &&
            !this.options.allowOverwrite
        ) {
            throw new Error(
                `Callback handler already registered for provider "${provider}".`
            );
        }

        this.providers.set(provider, handler);

        this.statistics.registrations++;

        return handler;
    }

    /**
     * Resolve provider handler.
     */
    resolve(provider) {

        this.statistics.resolutions++;

        if (!this.providers.has(provider)) {

            this.statistics.misses++;

            return null;
        }

        return this.providers.get(provider);
    }

    /**
     * Check provider support.
     */
    supports(provider) {
        return this.providers.has(provider);
    }

    /**
     * Remove provider.
     */
    unregister(provider) {

        const removed = this.providers.delete(provider);

        if (removed) {
            this.statistics.removals++;
        }

        return removed;
    }

    /**
     * Remove every registration.
     */
    clear() {

        const total = this.providers.size;

        this.providers.clear();

        this.statistics.removals += total;
    }

    /**
     * Number of registered providers.
     */
    size() {
        return this.providers.size;
    }

    /**
     * Registered provider names.
     */
    providersList() {
        return [...this.providers.keys()];
    }

    /**
     * Registry snapshot.
     */
    snapshot() {

        return Object.freeze({
            providers: this.providersList(),
            statistics: {
                ...this.statistics
            },
            registeredProviders: this.providers.size
        });
    }

    /**
     * Registry health.
     */
    health() {

        return Object.freeze({
            healthy: this.providers.size > 0,
            registeredProviders: this.providers.size,
            supportedProviders: this.providersList()
        });
    }

    /**
     * Internal validation.
     */
    #validateProvider(provider) {

        if (
            typeof provider !== "string" ||
            provider.trim() === ""
        ) {
            throw new TypeError(
                "Provider must be a non-empty string."
            );
        }
    }

    /**
     * Internal validation.
     */
    #validateHandler(handler) {

        if (
            typeof handler !== "function" &&
            typeof handler !== "object"
        ) {
            throw new TypeError(
                "Callback handler must be a function or handler object."
            );
        }
    }

}

module.exports = CallbackRegistry;