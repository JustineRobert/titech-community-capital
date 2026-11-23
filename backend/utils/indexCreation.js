/**
 * Safe, observable index creation primitive shared by index-management jobs.
 * MongoDB createIndex is idempotent for an identical key/options definition;
 * incompatible existing indexes are surfaced as errors and never hidden.
 */
export function validateIndexDefinition(keys, options = {}) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).length === 0) {
    throw new TypeError('MongoDB index keys must be a non-empty object.');
  }

  for (const [field, direction] of Object.entries(keys)) {
    if (!field.trim()) throw new TypeError('MongoDB index field names cannot be empty.');
    if (![1, -1, 'text', '2dsphere', '2d', 'hashed'].includes(direction)) {
      throw new TypeError(`Unsupported index direction for ${field}: ${String(direction)}`);
    }
  }

  if (options.name !== undefined && (typeof options.name !== 'string' || !options.name.trim())) {
    throw new TypeError('MongoDB index name must be a non-empty string when provided.');
  }

  return true;
}

export async function ensureIndex(collection, keys, options = {}) {
  if (!collection || typeof collection.createIndex !== 'function') {
    throw new TypeError('A MongoDB collection with createIndex() is required.');
  }

  validateIndexDefinition(keys, options);

  try {
    return await collection.createIndex(keys, options);
  } catch (cause) {
    const collectionName = collection.collectionName || collection.name || 'unknown collection';
    const error = new Error(
      `Failed to create index on ${collectionName} (${JSON.stringify(keys)}): ${cause.message}`,
      { cause },
    );
    error.code = cause.code;
    error.collectionName = collectionName;
    error.indexKeys = keys;
    throw error;
  }
}
