# API

Critical APIs should use stable machine-readable error codes and request IDs. Success responses use `{ success: true, data, meta }`; failures use `{ success: false, error: { code, message, requestId } }`.

The repository's existing canonical API versioning should be retained; new routes must not introduce a competing versioning scheme.
