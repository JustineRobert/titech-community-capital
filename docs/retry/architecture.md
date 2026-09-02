# Enterprise Retry Framework Architecture

## Overview

The TITech Community Capital Enterprise Retry Framework provides distributed resilience capabilities for:

- Financial transactions
- Payment providers
- Database operations
- External APIs
- Messaging systems
- Background jobs


## Architecture
Application Layer

Controllers
Services
Repositories
Jobs

    |
    v

RetryClient SDK

    |
    v

RetryMiddleware

    |
    v

RetryExecutionEngine

    |
    +----------------+

    |                |

RetryDecisionEngine RetryObservability

    |

    v

RetryClassificationEngine

    |

    v

RetryPolicyRegistry



## Components


## Retry Context

Provides:

- requestId
- correlationId
- traceId
- tenantId
- userId
- executionId
- retryId


## Retry Decision Engine

Responsible for:

- retry eligibility
- deadline validation
- budget validation
- circuit breaker checks
- idempotency checks


## Retry Execution Engine

Responsible for:

- execution loop
- delays
- hooks
- cancellation
- lifecycle events


## Observability Layer

Provides:

- metrics
- tracing
- audit events
- diagnostics


## Supported Domains

- MongoDB
- Redis
- MTN MoMo
- Airtel Money
- HTTP APIs
- BullMQ
- Kafka
- RabbitMQ