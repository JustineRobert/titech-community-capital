# TITech Community Capital LTD

# Enterprise Core Middleware Layer

Version: 1.0.0

---

## Overview

The **Core Middleware Layer** provides the foundational HTTP request processing pipeline for the TITech Community Capital fintech platform.

Every incoming HTTP request passes through this layer before reaching authentication, authorization, tenant resolution, controllers, or business services.

The middleware is designed to be:

- Enterprise-grade
- Production-ready
- Immutable where appropriate
- Observable
- Testable
- Cloud-native
- Kubernetes compatible
- Docker compatible
- Fintech security compliant

---

# Architecture

```
Incoming Request
       │
       ▼
Trust Proxy
       │
       ▼
Request ID
       │
       ▼
Correlation ID
       │
       ▼
Request Context
       │
       ▼
Request Logger
       │
       ▼
Request Metrics
       │
       ▼
Security Middleware
       │
       ▼
Authentication
       │
       ▼
Authorization
       │
       ▼
Tenant Resolution
       │
       ▼
Business Controllers
       │
       ▼
Services
       │
       ▼
Database
```

---

# Directory Structure

```
backend/
└── middleware/
    └── core/
        ├── index.js
        ├── trustProxy.js
        ├── requestId.js
        ├── correlationId.js
        ├── requestContext.js
        ├── requestLogger.js
        ├── requestMetrics.js
        └── README.md
```

---

# Middleware Components

## trustProxy.js

### Responsibilities

- Configure Express trust proxy
- Support reverse proxies
- Support Kubernetes ingress
- Support Docker deployments
- Configure client IP resolution
- Prevent duplicate configuration

---

## requestId.js

### Responsibilities

Generate a unique Request ID for every request.

Supports:

- RFC4122 UUID
- Existing X-Request-ID
- Header validation
- Response propagation

Example:

```
X-Request-ID:
b8a6038f-25e4-4d5f-bdad-4d6906fc3c41
```

---

## correlationId.js

Provides distributed request correlation.

Supports:

- Gateway correlation
- Internal services
- Queue workers
- Background jobs

Header:

```
X-Correlation-ID
```

---

## requestContext.js

Creates an immutable request-scoped context.

Contains:

- requestId
- correlationId
- tenant
- authenticated user
- configuration
- logger
- services
- request metadata

Example:

```javascript
req.context
```

---

## requestLogger.js

Enterprise structured request logging.

Automatically records:

- request start
- request completion
- latency
- response size
- request size
- status code
- request ID
- correlation ID
- trace ID

Uses:

```
StructuredLogger
```

---

## requestMetrics.js

Records request metrics.

Metrics include:

- request count
- active requests
- average latency
- minimum latency
- maximum latency
- status codes
- HTTP methods
- route metrics

Updates:

```
RequestMetrics
```

which is registered with:

```
MetricsRegistry
```

---

# Middleware Ordering

Correct ordering is mandatory.

```
Trust Proxy

↓

Request ID

↓

Correlation ID

↓

Request Context

↓

Request Logger

↓

Request Metrics

↓

Security Middleware

↓

Authentication

↓

Authorization

↓

Tenant Resolution

↓

Controllers
```

Changing this order may break:

- tracing
- logging
- metrics
- auditing
- security

---

# Request Context Flow

```
Request

↓

Request ID

↓

Correlation ID

↓

Trace Context

↓

Logger

↓

Metrics

↓

Business Services

↓

Database

↓

Audit

↓

Response
```

---

# Observability Integration

The middleware integrates with:

## Logging

```
StructuredLogger
```

Provides:

- JSON logging
- correlation IDs
- request IDs
- trace IDs

---

## Metrics

```
RequestMetrics
```

Provides:

- latency
- throughput
- status codes
- request counts

---

## Metrics Registry

```
MetricsRegistry
```

Central metrics aggregation.

---

## Prometheus Exporter

```
PrometheusExporter
```

Exposes:

```
/metrics
```

for:

- Prometheus
- Grafana

---

## Trace Context

```
TraceContext
```

Provides:

- AsyncLocalStorage
- trace IDs
- span IDs
- distributed tracing

---

## OpenTelemetry

```
OpenTelemetry
```

Supports:

- service tracing
- database tracing
- external API tracing

---

# Security Integration

After the core middleware:

```
Security Headers

↓

Rate Limiting

↓

CORS

↓

Authentication

↓

Authorization
```

---

# Enterprise Design Principles

Every middleware must be:

- Stateless
- Reentrant
- Dependency injected
- Independently testable
- Immutable where appropriate
- Framework independent where possible

---

# Error Handling

Middleware must:

- never swallow exceptions
- always call next(error)
- preserve trace IDs
- preserve request IDs
- preserve correlation IDs

---

# Performance

Designed for:

- High throughput
- Low allocation
- Zero global mutable request state
- AsyncLocalStorage compatibility

---

# Deployment Compatibility

Supported:

- Docker
- Kubernetes
- Nginx
- HAProxy
- AWS ALB
- Azure Application Gateway
- Cloudflare
- GCP Load Balancer

---

# Testing

Recommended test coverage:

## Unit Tests

- request ID generation
- correlation propagation
- metrics updates
- logger enrichment
- context creation

---

## Integration Tests

Verify:

- middleware ordering
- request lifecycle
- tracing
- structured logging
- metrics generation

---

## Load Testing

Validate:

- latency overhead
- memory usage
- request throughput
- AsyncLocalStorage propagation

---

# Extension Points

Future middleware modules:

```
security/
    securityHeaders.js
    cors.js
    rateLimiter.js

tenant/
    tenantResolver.js

auth/
    authentication.js
    authorization.js

audit/
    auditLogger.js

validation/
    payloadValidator.js
```

---

# Related Components

```
backend/shared/context/
backend/shared/logging/
backend/shared/metrics/
backend/shared/tracing/
backend/shared/events/
backend/shared/config/
backend/bootstrap/
```

---

# Enterprise Objectives

The Core Middleware Layer establishes:

- Request identity
- Distributed tracing
- Structured logging
- Performance metrics
- Immutable request context
- Observability
- Security foundation

It serves as the entry point into the TITech Community Capital enterprise application stack and provides the common execution context required by controllers, services, background workers, payment integrations, ledger processing, notifications, auditing, and future microservices.