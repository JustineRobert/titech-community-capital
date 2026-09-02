# Chaos Testing


Purpose:

Validate resilience before production failures.


Tests:


## Mongo Failure

Inject:

- timeout
- network failure


## Redis Failure

Inject:

- connection reset


## Payment Failure

Simulate:

- provider unavailable
- timeout


## Kubernetes Shutdown

Validate:

- graceful cancellation
- retry termination