'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Transaction Object Utilities
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/utils/TransactionObjectUtils.js
 *
 * Purpose
 * -------
 * Enterprise-grade object utilities used throughout the transaction
 * orchestration, event publishing, reliability, configuration, and
 * observability layers.
 *
 * Capabilities
 * ------------
 * - isPlainObject()
 * - deepFreeze()
 * - deepClone()
 * - createImmutableConfig()
 * - mergeImmutableConfig()
 * - isImmutable()
 * - mergeObjects()
 *
 * Design Goals
 * ------------
 * - Prevent accidental mutation
 * - Preserve circular references
 * - Preserve Dates
 * - Preserve Maps
 * - Preserve Sets
 * - Preserve Buffers
 * - Preserve typed arrays
 * - Preserve RegExp instances
 * - Preserve Error instances
 * - Preserve symbol properties
 * - Preserve property descriptors where practical
 * - Avoid prototype pollution
 * - Safely clone transaction/event payloads
 * - Provide immutable runtime configuration
 * - Maintain backwards compatibility with existing consumers
 *
 * Security Considerations
 * -----------------------
 * These utilities may process untrusted transaction metadata. Object merge
 * operations therefore explicitly reject prototype-pollution keys.
 *
 * ============================================================================
 */

const UNSAFE_KEYS = new Set([
    '__proto__',
    'prototype',
    'constructor'
]);

const MAX_SAFE_RECURSION_DEPTH = 1000;

/**
 * ============================================================================
 * Internal Helpers
 * ============================================================================
 */

/**
 * Determine whether a value is object-like.
 */
function isObjectLike(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}

/**
 * Determine whether a property key is unsafe for object merging.
 *
 * Prevents prototype pollution through payloads such as:
 *
 * {
 *     "__proto__": {...}
 * }
 */
function isUnsafeKey(key) {
    return (
        typeof key === 'string' &&
        UNSAFE_KEYS.has(key)
    );
}

/**
 * Safely define an own property.
 *
 * Using Object.defineProperty avoids accidentally invoking setters inherited
 * from Object.prototype.
 */
function defineOwnProperty(target, key, descriptor) {
    if (isUnsafeKey(key)) {
        return false;
    }

    try {
        Object.defineProperty(
            target,
            key,
            descriptor
        );

        return true;
    } catch (error) {
        /*
         * Some exotic objects may reject descriptor definitions. Fall back
         * to assignment only when safe.
         */
        try {
            target[key] = descriptor.value;
            return true;
        } catch (fallbackError) {
            return false;
        }
    }
}

/**
 * ============================================================================
 * Plain Object Detection
 * ============================================================================
 */

/**
 * Determines whether a value is a plain JavaScript object.
 *
 * Returns true for:
 *
 * - {}
 * - Object.create(null)
 * - Object literals
 *
 * Returns false for:
 *
 * - Arrays
 * - Dates
 * - Maps
 * - Sets
 * - Buffers
 * - RegExp
 * - Errors
 * - Class instances
 * - Typed arrays
 * - Functions
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

/**
 * ============================================================================
 * Deep Freeze
 * ============================================================================
 *
 * Recursively freezes objects and arrays.
 *
 * Characteristics:
 * - Circular-reference safe
 * - Symbol-property aware
 * - Descriptor aware
 * - Handles Maps and Sets
 * - Handles typed arrays where possible
 * - Does not mutate primitive values
 *
 * NOTE:
 * JavaScript's Object.freeze() does not make Map/Set contents semantically
 * immutable. We therefore recursively freeze their keys/values, but mutation
 * through Map#set/delete/clear or Set#add/delete/clear remains possible.
 *
 * For strict immutable Map/Set semantics, callers should use an immutable
 * abstraction rather than relying solely on Object.freeze().
 *
 * @param {*} value
 * @param {WeakSet} seen
 * @returns {*}
 */
function deepFreeze(
    value,
    seen = new WeakSet()
) {
    if (!isObjectLike(value)) {
        return value;
    }

    if (seen.has(value)) {
        return value;
    }

    seen.add(value);

    /*
     * ------------------------------------------------------------------------
     * Map
     * ------------------------------------------------------------------------
     */

    if (value instanceof Map) {
        for (const [key, item] of value.entries()) {
            deepFreeze(key, seen);
            deepFreeze(item, seen);
        }

        try {
            Object.freeze(value);
        } catch (error) {
            // Ignore exotic freeze failures.
        }

        return value;
    }

    /*
     * ------------------------------------------------------------------------
     * Set
     * ------------------------------------------------------------------------
     */

    if (value instanceof Set) {
        for (const item of value.values()) {
            deepFreeze(item, seen);
        }

        try {
            Object.freeze(value);
        } catch (error) {
            // Ignore exotic freeze failures.
        }

        return value;
    }

    /*
     * ------------------------------------------------------------------------
     * WeakMap / WeakSet
     * ------------------------------------------------------------------------
     *
     * Their contents cannot be enumerated. Freeze the container itself.
     */

    if (
        value instanceof WeakMap ||
        value instanceof WeakSet
    ) {
        try {
            Object.freeze(value);
        } catch (error) {
            // Ignore exotic freeze failures.
        }

        return value;
    }

    /*
     * ------------------------------------------------------------------------
     * Object Properties
     * ------------------------------------------------------------------------
     */

    for (const key of Reflect.ownKeys(value)) {
        let child;

        try {
            child = value[key];
        } catch (error) {
            continue;
        }

        if (isObjectLike(child)) {
            deepFreeze(
                child,
                seen
            );
        }
    }

    try {
        Object.freeze(value);
    } catch (error) {
        /*
         * Some exotic objects may reject Object.freeze().
         * We intentionally do not break an entire transaction because of
         * an exotic metadata value.
         */
    }

    return value;
}

/**
 * ============================================================================
 * Deep Clone
 * ============================================================================
 *
 * Enterprise-grade deep clone implementation.
 *
 * Supports:
 *
 * - Primitive values
 * - Objects
 * - Arrays
 * - Dates
 * - Maps
 * - Sets
 * - WeakMap / WeakSet references as opaque objects
 * - RegExp
 * - Error
 * - Buffer
 * - ArrayBuffer
 * - SharedArrayBuffer where available
 * - Typed arrays
 * - DataView
 * - Circular references
 * - Symbol properties
 * - Property descriptors
 *
 * Functions are intentionally returned by reference because functions cannot
 * be meaningfully deep-cloned without changing their semantics.
 *
 * @param {*} value
 * @param {WeakMap} seen
 * @param {number} depth
 * @returns {*}
 */
function deepClone(
    value,
    seen = new WeakMap(),
    depth = 0
) {
    /*
     * ------------------------------------------------------------------------
     * Primitive
     * ------------------------------------------------------------------------
     */

    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return value;
    }

    /*
     * ------------------------------------------------------------------------
     * Functions
     * ------------------------------------------------------------------------
     *
     * Functions remain references.
     */

    if (typeof value === 'function') {
        return value;
    }

    /*
     * ------------------------------------------------------------------------
     * Recursion Guard
     * ------------------------------------------------------------------------
     */

    if (
        depth > MAX_SAFE_RECURSION_DEPTH
    ) {
        throw new RangeError(
            'Maximum deepClone recursion depth exceeded'
        );
    }

    /*
     * ------------------------------------------------------------------------
     * Circular Reference
     * ------------------------------------------------------------------------
     */

    if (seen.has(value)) {
        return seen.get(value);
    }

    /*
     * ------------------------------------------------------------------------
     * Date
     * ------------------------------------------------------------------------
     */

    if (value instanceof Date) {
        const clone = new Date(
            value.getTime()
        );

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * RegExp
     * ------------------------------------------------------------------------
     */

    if (value instanceof RegExp) {
        const clone = new RegExp(
            value.source,
            value.flags
        );

        clone.lastIndex = value.lastIndex;

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * Buffer
     * ------------------------------------------------------------------------
     */

    if (
        typeof Buffer !== 'undefined' &&
        Buffer.isBuffer(value)
    ) {
        const clone = Buffer.from(value);

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * ArrayBuffer
     * ------------------------------------------------------------------------
     */

    if (
        typeof ArrayBuffer !== 'undefined' &&
        value instanceof ArrayBuffer
    ) {
        const clone = value.slice(0);

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * SharedArrayBuffer
     * ------------------------------------------------------------------------
     */

    if (
        typeof SharedArrayBuffer !== 'undefined' &&
        value instanceof SharedArrayBuffer
    ) {
        const clone = new SharedArrayBuffer(
            value.byteLength
        );

        new Uint8Array(clone).set(
            new Uint8Array(value)
        );

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * DataView
     * ------------------------------------------------------------------------
     */

    if (
        typeof DataView !== 'undefined' &&
        value instanceof DataView
    ) {
        const buffer = deepClone(
            value.buffer,
            seen,
            depth + 1
        );

        const clone = new DataView(
            buffer,
            value.byteOffset,
            value.byteLength
        );

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * Typed Arrays
     * ------------------------------------------------------------------------
     */

    if (
        typeof ArrayBuffer !== 'undefined' &&
        ArrayBuffer.isView(value)
    ) {
        /*
         * DataView is handled above.
         */

        if (
            typeof DataView !== 'undefined' &&
            value instanceof DataView
        ) {
            return value;
        }

        const clone = new value.constructor(
            value
        );

        seen.set(
            value,
            clone
        );

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * Map
     * ------------------------------------------------------------------------
     */

    if (value instanceof Map) {
        const clone = new Map();

        seen.set(
            value,
            clone
        );

        for (const [key, item] of value.entries()) {
            clone.set(
                deepClone(
                    key,
                    seen,
                    depth + 1
                ),
                deepClone(
                    item,
                    seen,
                    depth + 1
                )
            );
        }

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * Set
     * ------------------------------------------------------------------------
     */

    if (value instanceof Set) {
        const clone = new Set();

        seen.set(
            value,
            clone
        );

        for (const item of value.values()) {
            clone.add(
                deepClone(
                    item,
                    seen,
                    depth + 1
                )
            );
        }

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * Error Objects
     * ------------------------------------------------------------------------
     */

    if (value instanceof Error) {
        const clone = new value.constructor(
            value.message
        );

        seen.set(
            value,
            clone
        );

        /*
         * Preserve standard Error properties and custom properties.
         */
        for (const key of Reflect.ownKeys(value)) {
            if (
                key === 'message' ||
                key === 'stack'
            ) {
                continue;
            }

            const descriptor =
                Object.getOwnPropertyDescriptor(
                    value,
                    key
                );

            if (!descriptor) {
                continue;
            }

            if ('value' in descriptor) {
                descriptor.value =
                    deepClone(
                        descriptor.value,
                        seen,
                        depth + 1
                    );
            }

            defineOwnProperty(
                clone,
                key,
                descriptor
            );
        }

        if (value.stack) {
            try {
                clone.stack = value.stack;
            } catch (error) {
                // Ignore non-writable stack implementations.
            }
        }

        return clone;
    }

    /*
     * ------------------------------------------------------------------------
     * Weak Collections
     * ------------------------------------------------------------------------
     *
     * WeakMap/WeakSet contents cannot be enumerated safely.
     * Preserve the object reference rather than pretending it was cloned.
     */

    if (
        value instanceof WeakMap ||
        value instanceof WeakSet
    ) {
        return value;
    }

    /*
     * ------------------------------------------------------------------------
     * Generic Object / Array / Class Instance
     * ------------------------------------------------------------------------
     */

    const clone = Array.isArray(value)
        ? []
        : Object.create(
            Object.getPrototypeOf(value)
        );

    seen.set(
        value,
        clone
    );

    /*
     * Reflect.ownKeys() includes:
     *
     * - enumerable properties
     * - non-enumerable properties
     * - symbol properties
     */

    for (const key of Reflect.ownKeys(value)) {
        if (isUnsafeKey(key)) {
            continue;
        }

        const descriptor =
            Object.getOwnPropertyDescriptor(
                value,
                key
            );

        if (!descriptor) {
            continue;
        }

        /*
         * Clone data-property values.
         *
         * Accessor getter/setter functions are preserved by reference because
         * executing getters during cloning can produce side effects.
         */
        if ('value' in descriptor) {
            descriptor.value =
                deepClone(
                    descriptor.value,
                    seen,
                    depth + 1
                );
        }

        defineOwnProperty(
            clone,
            key,
            descriptor
        );
    }

    return clone;
}

/**
 * ============================================================================
 * Immutable Configuration
 * ============================================================================
 */

/**
 * Creates an immutable configuration snapshot.
 *
 * The supplied configuration is never mutated.
 *
 * @param {Object} configuration
 * @returns {Object}
 */
function createImmutableConfig(
    configuration = {}
) {
    if (!isPlainObject(configuration)) {
        throw new TypeError(
            'Configuration must be a plain object'
        );
    }

    const clone = deepClone(
        configuration
    );

    return deepFreeze(
        clone
    );
}

/**
 * ============================================================================
 * Immutable Configuration Merge
 * ============================================================================
 *
 * Creates a new merged configuration.
 *
 * Neither base nor override is mutated.
 *
 * Unsafe prototype-pollution keys are ignored.
 *
 * @param {Object} base
 * @param {Object} override
 * @returns {Object}
 */
function mergeImmutableConfig(
    base = {},
    override = {}
) {
    if (!isPlainObject(base)) {
        throw new TypeError(
            'Base configuration must be a plain object'
        );
    }

    if (!isPlainObject(override)) {
        throw new TypeError(
            'Override configuration must be a plain object'
        );
    }

    const merged = mergeObjects(
        deepClone(base),
        override
    );

    return deepFreeze(
        merged
    );
}

/**
 * ============================================================================
 * Recursive Object Merge
 * ============================================================================
 *
 * Mutates only the supplied target.
 *
 * This function is exported for backwards compatibility and is intentionally
 * kept separate from mergeImmutableConfig().
 *
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function mergeObjects(
    target,
    source
) {
    if (!isPlainObject(target)) {
        throw new TypeError(
            'Merge target must be a plain object'
        );
    }

    if (!isPlainObject(source)) {
        return target;
    }

    for (const key of Reflect.ownKeys(source)) {
        /*
         * Prevent prototype pollution.
         */
        if (isUnsafeKey(key)) {
            continue;
        }

        const descriptor =
            Object.getOwnPropertyDescriptor(
                source,
                key
            );

        if (!descriptor) {
            continue;
        }

        /*
         * Accessor properties are copied as descriptors without executing
         * getters.
         */
        if (!('value' in descriptor)) {
            defineOwnProperty(
                target,
                key,
                descriptor
            );

            continue;
        }

        const value =
            descriptor.value;

        const existing =
            target[key];

        if (
            isPlainObject(value) &&
            isPlainObject(existing)
        ) {
            mergeObjects(
                existing,
                value
            );

            continue;
        }

        descriptor.value =
            deepClone(value);

        defineOwnProperty(
            target,
            key,
            descriptor
        );
    }

    return target;
}

/**
 * ============================================================================
 * Immutable Value Check
 * ============================================================================
 *
 * Performs a recursive immutability check rather than only checking the root
 * object.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isImmutable(
    value,
    seen = new WeakSet()
) {
    if (!isObjectLike(value)) {
        return true;
    }

    if (seen.has(value)) {
        return true;
    }

    seen.add(value);

    if (!Object.isFrozen(value)) {
        return false;
    }

    /*
     * Maps and Sets require checking their contained objects.
     */
    if (value instanceof Map) {
        for (const [key, item] of value.entries()) {
            if (
                !isImmutable(key, seen) ||
                !isImmutable(item, seen)
            ) {
                return false;
            }
        }

        return true;
    }

    if (value instanceof Set) {
        for (const item of value.values()) {
            if (!isImmutable(item, seen)) {
                return false;
            }
        }

        return true;
    }

    /*
     * WeakMap/WeakSet cannot be traversed.
     */
    if (
        value instanceof WeakMap ||
        value instanceof WeakSet
    ) {
        return true;
    }

    for (const key of Reflect.ownKeys(value)) {
        let child;

        try {
            child = value[key];
        } catch (error) {
            continue;
        }

        if (
            isObjectLike(child) &&
            !isImmutable(child, seen)
        ) {
            return false;
        }
    }

    return true;
}

/**
 * ============================================================================
 * Safe Object Snapshot
 * ============================================================================
 *
 * Convenience helper for consumers that need a detached object without
 * changing the existing public API.
 *
 * @param {*} value
 * @returns {*}
 */
function cloneForSnapshot(value) {
    return deepClone(value);
}

/**
 * ============================================================================
 * Safe Freeze Snapshot
 * ============================================================================
 *
 * Convenience helper for producing a detached immutable object.
 *
 * @param {*} value
 * @returns {*}
 */
function immutableSnapshot(value) {
    return deepFreeze(
        deepClone(value)
    );
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports = {
    isPlainObject,
    deepFreeze,
    deepClone,
    createImmutableConfig,
    mergeImmutableConfig,
    mergeObjects,
    isImmutable,

    /*
     * Additional backwards-compatible utility exports.
     */
    cloneForSnapshot,
    immutableSnapshot
};