# Backend API Specification

## Help Center, FAQ & Community Forum

**TITech Community Capital Ltd — Community Savings Platform**

This document defines the production-grade backend API contract and implementation guidance for the Help Center, FAQ, and Community Forum capabilities.

It is intended for backend engineers, frontend/mobile engineers, QA engineers, DevOps/SRE engineers, security reviewers, technical architects, and integration partners.

The specification is designed to preserve the requested endpoint surface while adding enterprise-grade controls for:

* Authentication and authorization
* Multi-tenant isolation
* Input validation
* Content moderation
* Abuse prevention
* Idempotency
* Auditability
* Pagination
* Search
* Caching
* Soft deletion
* Optimistic concurrency
* Observability
* Secure error handling
* Data retention
* Operational resilience

> **Architecture compatibility:** The logical data model in this document is relationally expressed for clarity. It is a logical API/domain specification and must not force a database technology change. The existing TITech backend architecture and persistence layer remain authoritative for physical implementation.

---

# Table of Contents

1. [Purpose & Scope](#purpose--scope)
2. [API Contract Standards](#api-contract-standards)
3. [Base URL & Versioning](#base-url--versioning)
4. [Authentication & Authorization](#authentication--authorization)
5. [Multi-Tenant Security](#multi-tenant-security)
6. [Domain Model](#domain-model)
7. [Logical Database Schema](#logical-database-schema)
8. [API Endpoints](#api-endpoints)
9. [Request & Response Standards](#request--response-standards)
10. [Help Center API](#help-center-api)
11. [FAQ API](#faq-api)
12. [Community Forum API](#community-forum-api)
13. [Moderation & Reporting API](#moderation--reporting-api)
14. [Search API](#search-api)
15. [Pagination, Filtering & Sorting](#pagination-filtering--sorting)
16. [Idempotency & Concurrency](#idempotency--concurrency)
17. [Error Handling](#error-handling)
18. [Rate Limiting & Abuse Protection](#rate-limiting--abuse-protection)
19. [Caching](#caching)
20. [Validation & Content Security](#validation--content-security)
21. [Audit Logging](#audit-logging)
22. [Observability](#observability)
23. [Data Retention & Soft Deletes](#data-retention--soft-deletes)
24. [Request/Response Examples](#requestresponse-examples)
25. [Operational Requirements](#operational-requirements)
26. [Testing Requirements](#testing-requirements)
27. [Implementation Checklist](#implementation-checklist)
28. [Versioning & Change Management](#versioning--change-management)
29. [Document Metadata](#document-metadata)

---

# Purpose & Scope

The Help Center, FAQ, and Community Forum subsystem provides:

### Help Center

* Knowledge-base articles
* Article categories
* Article search
* Featured content
* Popular/trending content
* Helpfulness feedback
* Administrative content management

### FAQ

* Frequently asked questions
* FAQ categories
* FAQ search
* Popular FAQs
* Helpfulness feedback
* Administrative CRUD
* Controlled bulk import

### Community Forum

* Community topics
* Replies
* Categories
* Tags
* Topic search
* Topic voting
* Topic following
* Solutions
* Sticky topics
* Locked topics
* Trending and popular content
* Content reporting
* Moderation workflows

---

# API Contract Standards

## Response Envelope

Successful single-resource responses should use:

```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully",
  "requestId": "req_01J..."
}
```

Successful collection responses should use:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasNext": true,
    "hasPrevious": false
  },
  "requestId": "req_01J..."
}
```

For backward-compatible clients, resource-specific top-level aliases such as `articles`, `topics`, `replies`, or `items` may be retained during a transition period.

## Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields failed validation",
    "details": {
      "fields": [
        {
          "field": "title",
          "code": "REQUIRED",
          "message": "Title is required"
        }
      ]
    }
  },
  "requestId": "req_01J..."
}
```

## Request Correlation

Clients should send:

```http
X-Request-ID: <unique-request-id>
```

The backend must:

1. Validate inbound request IDs.
2. Generate one when absent.
3. Propagate the ID through application logs.
4. Return the ID in the response.
5. Include it in audit and tracing context where supported.

---

# Base URL & Versioning

## Local Development

```text
http://localhost:5000
```

## API Prefix

```text
/api
```

Examples:

```text
GET /api/help/articles
GET /api/faq
GET /api/forum/topics
```

## Versioning

The current documented route surface is:

```text
/api/...
```

If a future breaking contract is introduced, use an explicit versioning strategy rather than silently changing existing response semantics.

Preferred future versioning model:

```text
/api/v2/...
```

Non-breaking additions should not require a new API version.

---

# Authentication & Authorization

## Authentication

Protected endpoints require:

```http
Authorization: Bearer <accessToken>
```

Legacy compatibility may permit:

```http
x-auth-token: <accessToken>
```

The preferred production mechanism is:

```http
Authorization: Bearer <accessToken>
```

## Optional Machine-to-Machine Authentication

Where explicitly implemented for trusted internal services:

```http
X-API-Key: <service-api-key>
```

> `X-API-Key` must not be treated as a general-purpose replacement for user authentication. It is intended for explicitly authorized service integrations and must be scoped, rotated, stored securely, and audited.

## Authorization Levels

| Level              | Typical Permissions                                                                   |
| ------------------ | ------------------------------------------------------------------------------------- |
| Public             | Read published articles, published FAQs, public forum content where permitted         |
| Authenticated User | Create topics, replies, feedback, votes, follows, reports                             |
| Moderator          | Moderate community content, review reports, lock topics, manage abusive content       |
| Admin              | Full Help/FAQ CRUD, moderation administration, reporting, bulk imports, configuration |
| Service            | Restricted internal operations using explicit service authorization                   |

## Resource Authorization

Authorization must be enforced server-side for every protected operation.

Examples:

* Users may update only resources they own unless elevated privileges apply.
* Users may not modify another tenant's content.
* Users may not mark arbitrary users' forum replies as solutions.
* Moderators may only access moderation capabilities assigned to their role.
* Admin privileges must be explicitly checked.
* Deleted or archived resources must not automatically become accessible through direct IDs.

---

# Multi-Tenant Security

TITech is designed as a multi-tenant financial SaaS platform.

Every tenant-scoped Help Center, FAQ, and Forum resource must be evaluated against the authenticated tenant context where tenancy applies.

## Tenant Resolution

Tenant context must come from a trusted authenticated source, for example:

```text
Authenticated JWT claims
Tenant/session context
Validated service identity
```

Do not trust a user-supplied tenant ID alone.

## Tenant Isolation Rules

The backend must ensure:

```text
tenant A cannot read tenant B content
tenant A cannot update tenant B content
tenant A cannot report tenant B private content
tenant A cannot infer tenant B administrative data
```

## Public Global Content

Global platform content may be explicitly marked:

```text
scope = global
```

Tenant content may be:

```text
scope = tenant
tenantId = <tenant-id>
```

Resource resolution should always apply the appropriate scope filter.

---

# Domain Model

## Help Article

Conceptual fields:

```text
id
tenantId
title
content
category
authorId
status
views
helpfulCount
unhelpfulCount
isFeatured
createdAt
updatedAt
publishedAt
deletedAt
version
```

Recommended lifecycle:

```text
draft
published
archived
deleted
```

---

## FAQ

Conceptual fields:

```text
id
tenantId
question
answer
category
authorId
status
views
helpfulCount
unhelpfulCount
displayOrder
publishedAt
createdAt
updatedAt
deletedAt
version
```

Recommended lifecycle:

```text
draft
published
archived
deleted
```

---

## Forum Topic

Conceptual fields:

```text
id
tenantId
title
content
category
authorId
views
repliesCount
isSticky
isLocked
isSolved
solutionReplyId
status
lastReplyAt
createdAt
updatedAt
deletedAt
version
```

Recommended lifecycle:

```text
open
locked
archived
deleted
```

---

## Forum Reply

Conceptual fields:

```text
id
tenantId
topicId
authorId
content
upvotes
downvotes
isSolution
status
createdAt
updatedAt
deletedAt
version
```

---

## Forum Tag

Conceptual fields:

```text
id
tenantId
name
description
usageCount
createdAt
updatedAt
```

Tag uniqueness must be scoped correctly.

For tenant-scoped tags:

```text
UNIQUE(tenantId, normalizedName)
```

For globally shared tags:

```text
UNIQUE(normalizedName)
```

---

## Helpful Vote

A user may submit only one active helpfulness vote per content item.

Logical uniqueness:

```text
(userId, contentType, contentId)
```

A vote update should replace the user's prior vote rather than create duplicate records.

---

## Topic Follower

Logical uniqueness:

```text
(userId, topicId)
```

Creating an existing follow relationship should be idempotent.

---

## Content Report

Conceptual fields:

```text
id
tenantId
reporterId
contentType
contentId
reason
description
status
reviewedBy
resolutionNotes
createdAt
updatedAt
resolvedAt
```

Recommended status lifecycle:

```text
pending
reviewed
resolved
dismissed
```

---

# Logical Database Schema

> The following DDL is a logical relational representation. Adapt data types, references, timestamps, and indexing to the existing production persistence implementation.

## Help Articles

```sql
CREATE TABLE help_articles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  author_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  views BIGINT NOT NULL DEFAULT 0,
  helpful_count BIGINT NOT NULL DEFAULT 0,
  unhelpful_count BIGINT NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  version BIGINT NOT NULL DEFAULT 1,

  INDEX idx_help_tenant_category (tenant_id, category),
  INDEX idx_help_tenant_status (tenant_id, status),
  INDEX idx_help_created_at (created_at),
  INDEX idx_help_featured (tenant_id, is_featured),
  INDEX idx_help_deleted_at (deleted_at)
);
```

---

## FAQs

```sql
CREATE TABLE faqs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NULL,
  question VARCHAR(500) NOT NULL,
  answer LONGTEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  author_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'published',
  views BIGINT NOT NULL DEFAULT 0,
  helpful_count BIGINT NOT NULL DEFAULT 0,
  unhelpful_count BIGINT NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  version BIGINT NOT NULL DEFAULT 1,

  INDEX idx_faq_tenant_category (tenant_id, category),
  INDEX idx_faq_tenant_status (tenant_id, status),
  INDEX idx_faq_display_order (tenant_id, display_order),
  INDEX idx_faq_created_at (created_at)
);
```

---

## Forum Topics

```sql
CREATE TABLE forum_topics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  author_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  views BIGINT NOT NULL DEFAULT 0,
  replies_count BIGINT NOT NULL DEFAULT 0,
  is_sticky BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_solved BOOLEAN NOT NULL DEFAULT FALSE,
  solution_reply_id BIGINT NULL,
  last_reply_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  version BIGINT NOT NULL DEFAULT 1,

  INDEX idx_forum_tenant_category (tenant_id, category),
  INDEX idx_forum_tenant_status (tenant_id, status),
  INDEX idx_forum_created_at (tenant_id, created_at),
  INDEX idx_forum_last_reply (tenant_id, last_reply_at),
  INDEX idx_forum_sticky (tenant_id, is_sticky)
);
```

> The `solution_reply_id` foreign-key dependency should be created only after the reply table exists, or handled as an application-level reference where the underlying database implementation requires it.

---

## Forum Replies

```sql
CREATE TABLE forum_replies (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NOT NULL,
  topic_id BIGINT NOT NULL,
  author_id VARCHAR(128) NOT NULL,
  content LONGTEXT NOT NULL,
  upvotes BIGINT NOT NULL DEFAULT 0,
  downvotes BIGINT NOT NULL DEFAULT 0,
  is_solution BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  version BIGINT NOT NULL DEFAULT 1,

  INDEX idx_reply_topic (tenant_id, topic_id),
  INDEX idx_reply_author (tenant_id, author_id),
  INDEX idx_reply_created_at (tenant_id, created_at)
);
```

---

## Forum Tags

```sql
CREATE TABLE forum_tags (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NULL,
  name VARCHAR(100) NOT NULL,
  normalized_name VARCHAR(100) NOT NULL,
  description VARCHAR(255),
  usage_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_tag_tenant_name (tenant_id, normalized_name)
);
```

---

## Forum Topic Tags

```sql
CREATE TABLE forum_topic_tags (
  topic_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,

  PRIMARY KEY (topic_id, tag_id),
  INDEX idx_topic_tags_tag_id (tag_id)
);
```

---

## Helpful Votes

```sql
CREATE TABLE helpful_votes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NULL,
  user_id VARCHAR(128) NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  content_id VARCHAR(128) NOT NULL,
  vote_type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_helpful_vote (
    tenant_id,
    user_id,
    content_type,
    content_id
  ),

  INDEX idx_helpful_content (
    tenant_id,
    content_type,
    content_id
  )
);
```

---

## Forum Topic Followers

```sql
CREATE TABLE forum_topic_followers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  topic_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_topic_follower (
    tenant_id,
    user_id,
    topic_id
  ),

  INDEX idx_follower_user (
    tenant_id,
    user_id
  ),

  INDEX idx_follower_topic (
    tenant_id,
    topic_id
  )
);
```

---

## Content Reports

```sql
CREATE TABLE content_reports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id VARCHAR(128) NULL,
  reporter_id VARCHAR(128) NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  content_id VARCHAR(128) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  description LONGTEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(128) NULL,
  resolution_notes LONGTEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,

  INDEX idx_report_status (
    tenant_id,
    status
  ),

  INDEX idx_report_content (
    tenant_id,
    content_type,
    content_id
  ),

  INDEX idx_report_created_at (
    tenant_id,
    created_at
  )
);
```

---

# API Endpoints

# Help Center API

## Get Articles

```http
GET /api/help/articles
```

### Authentication

Public for published global/tenant content where configured.

### Query Parameters

```text
page
limit
category
status
sort = newest | popular | trending
search
```

Defaults:

```text
page = 1
limit = 10
sort = newest
```

### Example

```http
GET /api/help/articles?page=1&limit=10&category=basics&sort=newest
Accept: application/json
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "help_001",
      "title": "Getting Started",
      "content": "...",
      "category": "basics",
      "views": 250,
      "helpfulCount": 45,
      "unhelpfulCount": 2,
      "isFeatured": false,
      "createdAt": "2026-08-15T10:00:00.000Z",
      "updatedAt": "2026-08-15T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 150,
    "pages": 15,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

---

## Search Articles

```http
GET /api/help/search
```

### Query Parameters

```text
q       required
page    default 1
limit   default 10
category optional
```

### Example

```http
GET /api/help/search?q=password&page=1&limit=10
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "help_001",
      "title": "Resetting Your Password",
      "category": "account",
      "snippet": "Learn how to reset...",
      "score": 0.98
    }
  ],
  "query": "password",
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "pages": 1,
    "hasNext": false,
    "hasPrevious": false
  }
}
```

---

## Get Article by ID

```http
GET /api/help/articles/:id
```

### Response

```json
{
  "success": true,
  "data": {
    "article": {
      "id": "help_001",
      "title": "Getting Started",
      "content": "...",
      "category": "basics",
      "views": 250,
      "helpfulCount": 45,
      "unhelpfulCount": 2,
      "relatedArticles": []
    }
  }
}
```

---

## Get Article Categories

```http
GET /api/help/categories
```

### Response

```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "cat_001",
        "name": "basics",
        "count": 10
      }
    ]
  }
}
```

---

## Mark Article Helpful

```http
POST /api/help/articles/:id/helpful
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "message": "Thanks for your feedback!",
  "data": {
    "helpfulCount": 46,
    "unhelpfulCount": 2
  }
}
```

Repeated submission with the same logical user/content combination must not inflate the count.

---

## Mark Article Unhelpful

```http
POST /api/help/articles/:id/unhelpful
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "data": {
    "helpfulCount": 45,
    "unhelpfulCount": 3
  }
}
```

---

## Get Featured Articles

```http
GET /api/help/articles/featured
```

### Query Parameters

```text
limit = 6
```

### Response

```json
{
  "success": true,
  "data": {
    "articles": []
  }
}
```

---

## Create Article — Admin

```http
POST /api/help/articles
Authorization: Bearer <adminAccessToken>
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Request

```json
{
  "title": "New Article",
  "content": "Article content",
  "category": "basics",
  "isFeatured": false,
  "status": "draft"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "article": {
      "id": "help_001",
      "title": "New Article",
      "category": "basics",
      "status": "draft"
    }
  }
}
```

---

## Update Article — Admin

```http
PUT /api/help/articles/:id
Authorization: Bearer <adminAccessToken>
Content-Type: application/json
If-Match: <resource-version>
```

### Request

```json
{
  "title": "Updated Article",
  "content": "Updated content",
  "category": "account",
  "isFeatured": true
}
```

### Response

```json
{
  "success": true,
  "data": {
    "article": {}
  }
}
```

A stale `If-Match` value should return `409 CONFLICT` or the platform's standard concurrency error.

---

## Delete Article — Admin

```http
DELETE /api/help/articles/:id
Authorization: Bearer <adminAccessToken>
```

### Response

```json
{
  "success": true,
  "message": "Article deleted"
}
```

Deletion should normally be implemented as a soft delete.

---

# FAQ API

## Get FAQs

```http
GET /api/faq
```

### Query Parameters

```text
page = 1
limit = 20
category
sort = order | popular | newest
```

### Response

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

---

## Search FAQs

```http
GET /api/faq/search
```

### Query Parameters

```text
q       required
limit   default 20
```

### Response

```json
{
  "success": true,
  "data": {
    "results": []
  }
}
```

---

## Get FAQ Categories

```http
GET /api/faq/categories
```

### Response

```json
{
  "success": true,
  "data": {
    "categories": []
  }
}
```

---

## Mark FAQ Helpful

```http
POST /api/faq/:id/helpful
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "data": {
    "helpfulCount": 120,
    "unhelpfulCount": 2
  }
}
```

---

## Mark FAQ Unhelpful

```http
POST /api/faq/:id/unhelpful
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
```

---

## Get Popular FAQs

```http
GET /api/faq/popular?limit=5
```

### Response

```json
{
  "success": true,
  "data": {
    "items": []
  }
}
```

---

## Create FAQ — Admin

```http
POST /api/faq
Authorization: Bearer <adminAccessToken>
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Request

```json
{
  "question": "How do I reset my password?",
  "answer": "Follow the password reset process...",
  "category": "account",
  "displayOrder": 1,
  "status": "published"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "item": {}
  }
}
```

---

## Update FAQ — Admin

```http
PUT /api/faq/:id
Authorization: Bearer <adminAccessToken>
Content-Type: application/json
If-Match: <resource-version>
```

### Request

```json
{
  "question": "How do I reset my password?",
  "answer": "Updated answer",
  "category": "account",
  "displayOrder": 1
}
```

---

## Bulk Import FAQs — Admin

```http
POST /api/faq/bulk-import
Authorization: Bearer <adminAccessToken>
Content-Type: multipart/form-data
Idempotency-Key: <unique-key>
```

### Form Data

```text
file=<CSV or JSON file>
```

### Production Requirements

The import processor must:

* Validate file type.
* Enforce maximum file size.
* Validate encoding.
* Validate every record.
* Reject malicious file payloads.
* Prevent duplicate imports.
* Produce row-level errors.
* Avoid partial corruption.
* Audit the importing administrator.
* Support deterministic retry behavior.

### Response

```json
{
  "success": true,
  "data": {
    "imported": 50,
    "skipped": 2,
    "errors": [],
    "message": "Successfully imported 50 FAQs"
  }
}
```

---

# Community Forum API

## Get Topics

```http
GET /api/forum/topics
```

### Query Parameters

```text
page = 1
limit = 20
sort = newest | active | viewed
category
filter = all | unanswered | solved
tag
```

### Response

```json
{
  "success": true,
  "data": {
    "topics": [
      {
        "id": "topic_001",
        "title": "How to transfer money?",
        "category": "general",
        "author": {
          "id": "user_001",
          "name": "Justine Robert"
        },
        "repliesCount": 5,
        "views": 250,
        "tags": [],
        "isSticky": false,
        "isLocked": false,
        "isSolved": false,
        "lastReplyAt": "2026-08-15T10:05:00.000Z",
        "createdAt": "2026-08-15T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

---

## Get Single Topic

```http
GET /api/forum/topics/:id
```

### Response

```json
{
  "success": true,
  "data": {
    "topic": {
      "id": "topic_001",
      "title": "How to transfer money?",
      "content": "I want to know how to transfer money.",
      "category": "general",
      "author": {
        "id": "user_001",
        "name": "Justine Robert"
      },
      "replies": [
        {
          "id": "reply_001",
          "author": {
            "id": "user_002",
            "name": "Example User"
          },
          "content": "Here is the solution...",
          "upvotes": 5,
          "downvotes": 0,
          "isSolution": false,
          "createdAt": "2026-08-15T10:05:00.000Z"
        }
      ]
    }
  }
}
```

---

## Create Topic

```http
POST /api/forum/topics
Authorization: Bearer <accessToken>
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Request

```json
{
  "title": "How to transfer money?",
  "content": "I want to know how to transfer money between accounts.",
  "category": "general",
  "tags": [
    "transfer",
    "help"
  ]
}
```

### Response

```json
{
  "success": true,
  "data": {
    "topic": {
      "id": "topic_001",
      "title": "How to transfer money?",
      "status": "open"
    }
  }
}
```

---

## Update Topic

```http
PUT /api/forum/topics/:id
Authorization: Bearer <accessToken>
Content-Type: application/json
If-Match: <resource-version>
```

### Request

```json
{
  "title": "Updated title",
  "content": "Updated content",
  "category": "general",
  "tags": [
    "transfer",
    "help"
  ]
}
```

Only the topic owner or an authorized moderator/admin may update the resource.

---

## Delete Topic

```http
DELETE /api/forum/topics/:id
Authorization: Bearer <accessToken>
```

### Response

```json
{
  "success": true,
  "message": "Topic deleted"
}
```

The preferred implementation is soft deletion.

---

## Create Reply

```http
POST /api/forum/topics/:topicId/replies
Authorization: Bearer <accessToken>
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Request

```json
{
  "content": "Here's the solution..."
}
```

### Response

```json
{
  "success": true,
  "data": {
    "reply": {
      "id": "reply_001",
      "topicId": "topic_001",
      "content": "Here's the solution..."
    }
  }
}
```

### Validation

A reply must fail when:

* Topic does not exist.
* Topic is deleted.
* Topic is locked.
* User is not authorized to participate.
* Content violates moderation/security rules.

---

## Update Reply

```http
PUT /api/forum/topics/:topicId/replies/:replyId
Authorization: Bearer <accessToken>
Content-Type: application/json
If-Match: <resource-version>
```

### Request

```json
{
  "content": "Updated reply..."
}
```

---

## Delete Reply

```http
DELETE /api/forum/topics/:topicId/replies/:replyId
Authorization: Bearer <accessToken>
```

### Response

```json
{
  "success": true,
  "message": "Reply deleted"
}
```

---

## Mark as Solution

```http
POST /api/forum/topics/:topicId/replies/:replyId/mark-solution
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "message": "Reply marked as solution",
  "data": {
    "topicId": "topic_001",
    "solutionReplyId": "reply_001",
    "isSolved": true
  }
}
```

Only the topic owner or an authorized moderator/admin should be permitted to select the solution.

The operation must be transactional so that:

```text
topic.isSolved = true
topic.solutionReplyId = replyId
reply.isSolution = true
```

remain consistent.

---

## Get Topic Replies

```http
GET /api/forum/topics/:topicId/replies
```

### Query Parameters

```text
page = 1
limit = 20
sort = newest | oldest | helpful
```

### Response

```json
{
  "success": true,
  "data": {
    "replies": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "pages": 1,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

---

## Vote on Reply

```http
POST /api/forum/topics/:topicId/replies/:replyId/vote
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
Content-Type: application/json
```

### Request

```json
{
  "voteType": "up"
}
```

Allowed values:

```text
up
down
```

### Response

```json
{
  "success": true,
  "data": {
    "upvotes": 6,
    "downvotes": 0,
    "userVote": "up"
  }
}
```

The same user must not be able to inflate vote totals through repeated submissions.

---

## Remove Reply Vote

Recommended complementary endpoint:

```http
DELETE /api/forum/topics/:topicId/replies/:replyId/vote
Authorization: Bearer <accessToken>
```

### Response

```json
{
  "success": true,
  "data": {
    "upvotes": 5,
    "downvotes": 0,
    "userVote": null
  }
}
```

---

## Mark Sticky

```http
POST /api/forum/topics/:id/sticky
Authorization: Bearer <adminAccessToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "data": {
    "isSticky": true
  }
}
```

---

## Unmark Sticky

Recommended complementary endpoint:

```http
DELETE /api/forum/topics/:id/sticky
Authorization: Bearer <adminAccessToken>
```

---

## Lock Topic

```http
POST /api/forum/topics/:id/lock
Authorization: Bearer <moderatorOrAdminToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "data": {
    "isLocked": true
  }
}
```

---

## Unlock Topic

Recommended complementary endpoint:

```http
DELETE /api/forum/topics/:id/lock
Authorization: Bearer <moderatorOrAdminToken>
```

---

## Get Forum Categories

```http
GET /api/forum/categories
```

### Response

```json
{
  "success": true,
  "data": {
    "categories": []
  }
}
```

---

## Get Forum Statistics

```http
GET /api/forum/stats
```

### Response

```json
{
  "success": true,
  "data": {
    "totalTopics": 100,
    "totalReplies": 500,
    "totalUsers": 50,
    "todayTopics": 5,
    "todayReplies": 25
  }
}
```

Statistics must respect tenant scope and authorization.

---

## Search Topics

```http
GET /api/forum/search
```

### Query Parameters

```text
q          required
category   optional
page       default 1
limit      default 20
```

### Response

```json
{
  "success": true,
  "data": {
    "results": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "pages": 0,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

---

## Get Recent Topics

```http
GET /api/forum/topics/recent?limit=5
```

### Response

```json
{
  "success": true,
  "data": {
    "topics": []
  }
}
```

---

## Get Popular Topics

```http
GET /api/forum/topics/popular
```

### Query Parameters

```text
limit = 5
timeframe = day | week | month | all
```

### Response

```json
{
  "success": true,
  "data": {
    "topics": []
  }
}
```

---

## Follow/Unfollow Topic

```http
POST /api/forum/topics/:id/follow
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
```

### Response

```json
{
  "success": true,
  "data": {
    "following": true
  }
}
```

Recommended complementary endpoint:

```http
DELETE /api/forum/topics/:id/follow
Authorization: Bearer <accessToken>
```

---

## Get Followed Topics

Recommended endpoint:

```http
GET /api/forum/topics/following
Authorization: Bearer <accessToken>
```

### Response

```json
{
  "success": true,
  "data": {
    "topics": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "pages": 0,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

---

## Get Trending Topics

```http
GET /api/forum/topics/trending
```

### Query Parameters

```text
limit = 10
timeframe = week
```

Trending calculations should be performed using server-side metrics rather than client-provided scores.

---

# Moderation & Reporting API

## Report Content

```http
POST /api/forum/report
Authorization: Bearer <accessToken>
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Request

```json
{
  "contentType": "topic",
  "contentId": "topic_001",
  "reason": "spam",
  "description": "This topic appears to be promotional spam."
}
```

Allowed content types:

```text
topic
reply
article
faq
```

Allowed reasons should be configurable, for example:

```text
spam
offensive
misinformation
harassment
fraud
impersonation
privacy
other
```

### Response

```json
{
  "success": true,
  "data": {
    "reportId": "report_001",
    "status": "pending"
  },
  "message": "Report submitted"
}
```

---

## List Reports — Moderator/Admin

Recommended endpoint:

```http
GET /api/admin/content-reports
Authorization: Bearer <moderatorOrAdminToken>
```

### Query Parameters

```text
page
limit
status
contentType
reason
from
to
```

### Response

```json
{
  "success": true,
  "data": {
    "reports": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "pages": 0,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

---

## Resolve Report

Recommended endpoint:

```http
PUT /api/admin/content-reports/:reportId/resolve
Authorization: Bearer <moderatorOrAdminToken>
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Request

```json
{
  "resolution": "resolved",
  "resolutionNotes": "Content removed after moderator review."
}
```

### Response

```json
{
  "success": true,
  "data": {
    "status": "resolved",
    "resolvedAt": "2026-08-15T20:00:00.000Z"
  }
}
```

The moderation action must produce an audit record.

---

# Search API

Search must be implemented server-side.

## Search Requirements

Search should support:

```text
case-insensitive matching
stemming where supported
tokenization
category filtering
tenant filtering
status filtering
pagination
relevance scoring
```

Search must never bypass:

```text
tenant authorization
resource visibility
deleted/archived status
moderation restrictions
```

## Search Input Security

Search queries must have:

* Maximum length.
* Maximum complexity.
* Input normalization.
* Rate limiting.
* Query timeout protection.
* Safe database/query construction.

Reject or sanitize pathological search expressions.

---

# Pagination, Filtering & Sorting

## Pagination

Default:

```text
page = 1
limit = 20
```

Maximum:

```text
limit <= 100
```

The exact maximum may be reduced per endpoint.

## Standard Pagination Response

```json
{
  "page": 1,
  "limit": 20,
  "total": 100,
  "pages": 5,
  "hasNext": true,
  "hasPrevious": false
}
```

## Sorting

Only allow explicit server-defined values.

Example:

```text
newest
oldest
popular
active
viewed
helpful
order
trending
```

Never interpolate arbitrary request values directly into database sort expressions.

---

# Idempotency & Concurrency

## Idempotent Operations

The following operations should support idempotency:

```text
Create article
Create FAQ
Bulk import
Create topic
Create reply
Mark helpful
Mark unhelpful
Vote
Mark solution
Follow topic
Sticky topic
Lock topic
Submit report
Resolve moderation action
```

## Idempotency Header

```http
Idempotency-Key: <unique-key>
```

Keys should be:

* Client-generated.
* Unique per logical operation.
* Reused for retries of the same operation.
* Stored with operation status.
* Expired according to documented retention policy.

## Idempotency Response

A replayed successful request should return the prior logical result rather than creating another resource/action.

Recommended metadata:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "idempotentReplay": true
  }
}
```

---

# Optimistic Concurrency

Mutable resources should expose a version indicator.

Example:

```json
{
  "id": "topic_001",
  "version": 4
}
```

Clients may use:

```http
If-Match: 4
```

When a stale version is detected:

```http
409 Conflict
```

Example:

```json
{
  "success": false,
  "error": {
    "code": "CONCURRENT_UPDATE",
    "message": "The resource was modified by another request",
    "details": {
      "currentVersion": 5
    }
  }
}
```

---

# Error Handling

## Standard Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  },
  "requestId": "req_01J..."
}
```

## Common Error Codes

| Code                   | HTTP Status | Description                               |
| ---------------------- | ----------: | ----------------------------------------- |
| `BAD_REQUEST`          |         400 | Malformed request                         |
| `VALIDATION_ERROR`     |         400 | Invalid request data                      |
| `UNAUTHORIZED`         |         401 | Authentication required/failed            |
| `FORBIDDEN`            |         403 | Insufficient permissions                  |
| `NOT_FOUND`            |         404 | Resource not found                        |
| `CONFLICT`             |         409 | Resource/state conflict                   |
| `CONCURRENT_UPDATE`    |         409 | Stale resource version                    |
| `DUPLICATE_ENTRY`      |         409 | Duplicate resource/operation              |
| `UNPROCESSABLE_ENTITY` |         422 | Domain validation failure                 |
| `RATE_LIMIT_EXCEEDED`  |         429 | Rate limit exceeded                       |
| `PAYLOAD_TOO_LARGE`    |         413 | Request/file too large                    |
| `CONTENT_BLOCKED`      |         422 | Content failed moderation/security policy |
| `INTERNAL_ERROR`       |         500 | Unexpected server error                   |
| `SERVICE_UNAVAILABLE`  |         503 | Temporary service unavailability          |

## 400 Example

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required",
    "details": {
      "fields": [
        {
          "field": "title",
          "code": "REQUIRED"
        }
      ]
    }
  }
}
```

## 401 Example

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication is required"
  }
}
```

## 403 Example

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this operation"
  }
}
```

## 404 Example

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

## 409 Example

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "The topic is locked and cannot accept new replies"
  }
}
```

## 429 Example

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

---

# Rate Limiting & Abuse Protection

Rate limits must be applied at multiple levels where appropriate:

```text
IP
authenticated user
tenant
endpoint
operation type
administrative role
```

Do not rely solely on IP-based throttling because many legitimate users may share an egress IP.

## Recommended Default Limits

These values are baseline configuration and should be tuned using actual traffic.

| Endpoint Type       | Baseline Limit | Window |
| ------------------- | -------------: | ------ |
| Public reads        |           1000 | 1 hour |
| Authenticated reads |           2000 | 1 hour |
| Writes              |            100 | 1 hour |
| Search              |            200 | 1 hour |
| Feedback/votes      |            100 | 1 hour |
| Reports             |             20 | 1 hour |
| Admin operations    |            100 | 1 hour |
| Bulk imports        |             10 | 1 hour |

For high-risk operations, use tighter burst and sustained-rate limits.

## Rate Limit Headers

Where supported:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1776195600
Retry-After: 60
```

---

# Caching

## Cacheable Content

Strong candidates:

```text
Published Help articles
Published FAQs
Categories
Featured articles
Popular FAQs
Popular topics
Trending topics
Forum statistics
```

## Cache Invalidation

Cache invalidation must occur after successful writes affecting the resource or aggregate.

Examples:

```text
Article update -> invalidate article cache
FAQ update -> invalidate FAQ cache
Topic reply -> invalidate topic/replies/popularity caches
Topic lock -> invalidate topic cache
Report moderation -> invalidate affected content cache
```

Do not cache private responses in a shared cache unless the cache key includes tenant and authorization scope correctly.

---

# Validation & Content Security

## Text Validation

Validate:

```text
Required fields
Maximum length
Minimum length where required
Allowed Unicode
Malformed control characters
Whitespace normalization
```

## Title Limits

Recommended:

```text
Article title: 1-255 characters
FAQ question: 1-500 characters
Forum topic title: 1-255 characters
```

Actual limits should be centralized as constants.

## Content Sanitization

User-generated rich text must be sanitized before persistence or rendering.

Defend against:

```text
XSS
HTML injection
script injection
event-handler injection
malicious URLs
javascript: URLs
unsafe embedded content
```

Prefer an allowlist sanitizer over a denylist.

## URL Validation

Links originating from user content should be validated and normalized.

Disallowed examples may include:

```text
javascript:
data:
vbscript:
```

unless explicitly supported by a controlled rendering layer.

## Spam Controls

Use one or more of:

```text
rate limiting
duplicate-content detection
velocity checks
link-count limits
account age checks
reputation thresholds
moderation queues
automated abuse detection
```

---

# Audit Logging

All administrative and moderation operations must be auditable.

## Minimum Audit Fields

```text
auditId
tenantId
actorId
actorRole
action
resourceType
resourceId
requestId
timestamp
ipAddress
userAgent
outcome
reason
before
after
```

## Auditable Actions

At minimum:

```text
CREATE_ARTICLE
UPDATE_ARTICLE
DELETE_ARTICLE
CREATE_FAQ
UPDATE_FAQ
BULK_IMPORT_FAQS
DELETE_FAQ
LOCK_TOPIC
UNLOCK_TOPIC
STICKY_TOPIC
UNSTICKY_TOPIC
DELETE_TOPIC
DELETE_REPLY
MARK_SOLUTION
REMOVE_SOLUTION
REVIEW_REPORT
RESOLVE_REPORT
DISMISS_REPORT
MODERATION_ACTION
```

Sensitive values should be redacted.

Do not write:

```text
access tokens
refresh tokens
API keys
passwords
provider secrets
private keys
```

to audit logs.

---

# Observability

The subsystem must integrate with the platform's observability architecture.

## Structured Logging

Include:

```text
requestId
tenantId
userId
route
method
statusCode
latencyMs
resourceType
resourceId
errorCode
```

## Metrics

Recommended counters/histograms:

```text
help_article_requests_total
help_article_searches_total
help_article_feedback_total

faq_requests_total
faq_searches_total
faq_feedback_total
faq_bulk_imports_total

forum_topics_created_total
forum_replies_created_total
forum_votes_total
forum_reports_total
forum_moderation_actions_total

content_moderation_blocks_total

api_request_duration_seconds
api_request_errors_total
rate_limit_exceeded_total
```

## Tracing

Where OpenTelemetry is enabled:

```text
HTTP request span
controller/service span
database operation span
search span
cache span
moderation span
audit-log span
```

Propagate:

```text
traceId
spanId
requestId
tenantId
userId
```

Do not place secrets into tracing attributes.

---

# Data Retention & Soft Deletes

## Soft Delete

Resources should normally use:

```text
deletedAt
status
```

rather than immediate destructive deletion.

Default application queries must exclude:

```text
deletedAt IS NOT NULL
```

unless the endpoint explicitly supports administrative recovery or audit retrieval.

## Retention

Retention periods should be defined separately according to:

```text
tenant policy
platform policy
legal requirements
regulatory requirements
security requirements
```

Do not permanently delete audit evidence before the applicable retention policy permits it.

---

# Request/Response Examples

## Get Help Articles

```bash
curl -X GET \
  "http://localhost:5000/api/help/articles?page=1&limit=10&category=basics" \
  -H "Accept: application/json"
```

---

## Search FAQ

```bash
curl -X GET \
  "http://localhost:5000/api/faq/search?q=password&limit=20" \
  -H "Accept: application/json"
```

---

## Create Forum Topic

```bash
curl -X POST \
  "http://localhost:5000/api/forum/topics" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: forum-topic-001" \
  -H "X-Request-ID: req-forum-001" \
  -d '{
    "title": "How to transfer money?",
    "content": "I want to know how to transfer money between accounts.",
    "category": "general",
    "tags": [
      "transfer",
      "help"
    ]
  }'
```

---

## Reply to Topic

```bash
curl -X POST \
  "http://localhost:5000/api/forum/topics/topic_001/replies" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: forum-reply-001" \
  -d '{
    "content": "Here is the solution..."
  }'
```

---

## Mark Reply as Solution

```bash
curl -X POST \
  "http://localhost:5000/api/forum/topics/topic_001/replies/reply_001/mark-solution" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Idempotency-Key: mark-solution-001"
```

---

## Report Content

```bash
curl -X POST \
  "http://localhost:5000/api/forum/report" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: report-001" \
  -d '{
    "contentType": "topic",
    "contentId": "topic_001",
    "reason": "spam",
    "description": "This appears to be promotional spam."
  }'
```

---

## Admin Create FAQ

```bash
curl -X POST \
  "http://localhost:5000/api/faq" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: faq-create-001" \
  -d '{
    "question": "How do I reset my password?",
    "answer": "Use the password reset flow from the login screen.",
    "category": "account",
    "displayOrder": 1,
    "status": "published"
  }'
```

---

# Operational Requirements

## Controllers

Controllers should remain thin.

Recommended responsibility:

```text
parse request
authenticate/authorize
validate request
call domain/application service
map service result to API response
```

Business rules must not be duplicated across controllers.

---

## Services

Recommended service boundaries:

```text
HelpArticleService
HelpCategoryService
HelpSearchService

FaqService
FaqCategoryService
FaqImportService
FaqSearchService

ForumTopicService
ForumReplyService
ForumVoteService
ForumFollowerService
ForumSearchService
ForumModerationService
ForumReportingService
ForumStatisticsService
```

The exact filenames and folders must remain compatible with the existing repository architecture.

---

## Repositories

Repository/data-access layers should isolate persistence concerns.

Examples:

```text
HelpArticleRepository
FaqRepository
ForumTopicRepository
ForumReplyRepository
ForumTagRepository
ContentReportRepository
```

Repositories must apply tenant scoping and soft-delete rules consistently.

---

## Validation

Use centralized validation schemas/constants.

Do not duplicate field validation independently across:

```text
controller
service
frontend
```

The backend remains the source of truth.

---

## Transactions

Use database transactions where multiple records must remain consistent.

Examples:

### Mark Solution

```text
Topic update
+
Reply update
```

### Vote Update

```text
Existing vote update
+
Aggregate counter update
```

### Reply Creation

```text
Reply creation
+
Topic reply-count update
+
Topic last-reply timestamp update
```

### Bulk FAQ Import

Use bounded batches and recoverable processing instead of one uncontrolled transaction for an arbitrarily large file.

---

# Testing Requirements

## Unit Tests

Test:

```text
validation
authorization
domain rules
service logic
vote transitions
solution transitions
moderation state transitions
pagination calculations
search filters
idempotency behavior
```

## Integration Tests

Test:

```text
controller -> service -> repository
authentication
tenant isolation
database persistence
soft deletes
audit logging
rate limiting
cache invalidation
```

## Security Tests

At minimum:

```text
XSS payloads
HTML injection
authorization bypass
tenant breakout
IDOR
duplicate vote attempts
duplicate feedback attempts
duplicate report attempts
duplicate topic creation
malicious file uploads
oversized requests
rate-limit bypass
search abuse
```

## Concurrency Tests

Test concurrent:

```text
topic replies
votes
solution marking
topic locking
article updates
FAQ updates
```

Verify that race conditions do not corrupt:

```text
counts
states
relationships
audit history
```

---

# Implementation Checklist

## API

* [ ] Standard response envelope implemented.
* [ ] Standard error envelope implemented.
* [ ] Request IDs generated and propagated.
* [ ] API routes are documented.
* [ ] Authentication middleware applied.
* [ ] Authorization middleware applied.
* [ ] Tenant context enforced.
* [ ] Resource ownership checks implemented.
* [ ] Pagination implemented.
* [ ] Sorting allowlists implemented.
* [ ] Search validation implemented.
* [ ] Idempotency implemented for mutation endpoints.
* [ ] Concurrency protection implemented.
* [ ] Soft-delete filters implemented.

## Help Center

* [ ] Articles CRUD implemented.
* [ ] Categories implemented.
* [ ] Featured articles implemented.
* [ ] Popular/trending logic implemented.
* [ ] Search implemented.
* [ ] Helpful/unhelpful voting implemented.
* [ ] Admin authorization implemented.
* [ ] Audit logging implemented.

## FAQ

* [ ] FAQ CRUD implemented.
* [ ] Categories implemented.
* [ ] Search implemented.
* [ ] Popular FAQs implemented.
* [ ] Helpful/unhelpful voting implemented.
* [ ] Bulk import implemented.
* [ ] Import validation implemented.
* [ ] Import deduplication implemented.
* [ ] Import audit logging implemented.

## Forum

* [ ] Topics implemented.
* [ ] Replies implemented.
* [ ] Categories implemented.
* [ ] Tags implemented.
* [ ] Topic search implemented.
* [ ] Reply voting implemented.
* [ ] Topic following implemented.
* [ ] Solutions implemented.
* [ ] Sticky topics implemented.
* [ ] Topic locking implemented.
* [ ] Recent topics implemented.
* [ ] Popular topics implemented.
* [ ] Trending topics implemented.
* [ ] Topic/report moderation implemented.
* [ ] Forum statistics implemented.

## Security

* [ ] JWT validation enforced.
* [ ] Admin authorization enforced.
* [ ] Moderator authorization enforced.
* [ ] Tenant isolation verified.
* [ ] XSS protection applied.
* [ ] Request size limits applied.
* [ ] File upload limits applied.
* [ ] Rate limiting applied.
* [ ] Sensitive information redacted.
* [ ] Audit logging enabled.

## Reliability

* [ ] Database indexes created.
* [ ] Slow queries monitored.
* [ ] Search latency monitored.
* [ ] Cache strategy implemented.
* [ ] Cache invalidation tested.
* [ ] Idempotency replay tested.
* [ ] Concurrency tested.
* [ ] Error handling standardized.
* [ ] Graceful degradation defined.

---

# Versioning & Change Management

Changes to this API must be classified as:

```text
PATCH-compatible
MINOR-compatible
BREAKING
SECURITY
OPERATIONAL
```

## Non-Breaking Changes

Examples:

```text
Adding optional response fields
Adding optional request fields
Adding new endpoints
Adding new search filters
Adding new categories
```

## Potentially Breaking Changes

Examples:

```text
Removing response fields
Changing field types
Changing endpoint semantics
Changing authentication rules
Removing accepted enum values
Changing pagination semantics
Changing error codes relied upon by clients
```

## Breaking Changes

Breaking changes must:

* Be explicitly documented.
* Receive architecture/security review where applicable.
* Be versioned where required.
* Include migration guidance.
* Include automated regression coverage.
* Have a deprecation period where operationally appropriate.

---

# API Endpoint Quick Reference

| Capability         | Method   | Endpoint                                                    | Access          |
| ------------------ | -------- | ----------------------------------------------------------- | --------------- |
| List Articles      | `GET`    | `/api/help/articles`                                        | Public/Auth     |
| Search Articles    | `GET`    | `/api/help/search`                                          | Public/Auth     |
| Article Details    | `GET`    | `/api/help/articles/:id`                                    | Public/Auth     |
| Article Categories | `GET`    | `/api/help/categories`                                      | Public          |
| Article Helpful    | `POST`   | `/api/help/articles/:id/helpful`                            | Auth            |
| Article Unhelpful  | `POST`   | `/api/help/articles/:id/unhelpful`                          | Auth            |
| Featured Articles  | `GET`    | `/api/help/articles/featured`                               | Public          |
| Create Article     | `POST`   | `/api/help/articles`                                        | Admin           |
| Update Article     | `PUT`    | `/api/help/articles/:id`                                    | Admin           |
| Delete Article     | `DELETE` | `/api/help/articles/:id`                                    | Admin           |
| List FAQs          | `GET`    | `/api/faq`                                                  | Public          |
| Search FAQs        | `GET`    | `/api/faq/search`                                           | Public          |
| FAQ Categories     | `GET`    | `/api/faq/categories`                                       | Public          |
| FAQ Helpful        | `POST`   | `/api/faq/:id/helpful`                                      | Auth            |
| FAQ Unhelpful      | `POST`   | `/api/faq/:id/unhelpful`                                    | Auth            |
| Popular FAQs       | `GET`    | `/api/faq/popular`                                          | Public          |
| Create FAQ         | `POST`   | `/api/faq`                                                  | Admin           |
| Update FAQ         | `PUT`    | `/api/faq/:id`                                              | Admin           |
| Bulk Import FAQs   | `POST`   | `/api/faq/bulk-import`                                      | Admin           |
| List Topics        | `GET`    | `/api/forum/topics`                                         | Public/Auth     |
| Topic Details      | `GET`    | `/api/forum/topics/:id`                                     | Public/Auth     |
| Create Topic       | `POST`   | `/api/forum/topics`                                         | Auth            |
| Update Topic       | `PUT`    | `/api/forum/topics/:id`                                     | Owner/Mod/Admin |
| Delete Topic       | `DELETE` | `/api/forum/topics/:id`                                     | Owner/Mod/Admin |
| Create Reply       | `POST`   | `/api/forum/topics/:topicId/replies`                        | Auth            |
| Update Reply       | `PUT`    | `/api/forum/topics/:topicId/replies/:replyId`               | Owner/Mod/Admin |
| Delete Reply       | `DELETE` | `/api/forum/topics/:topicId/replies/:replyId`               | Owner/Mod/Admin |
| Mark Solution      | `POST`   | `/api/forum/topics/:topicId/replies/:replyId/mark-solution` | Owner/Mod/Admin |
| List Replies       | `GET`    | `/api/forum/topics/:topicId/replies`                        | Public/Auth     |
| Vote Reply         | `POST`   | `/api/forum/topics/:topicId/replies/:replyId/vote`          | Auth            |
| Remove Vote        | `DELETE` | `/api/forum/topics/:topicId/replies/:replyId/vote`          | Auth            |
| Sticky Topic       | `POST`   | `/api/forum/topics/:id/sticky`                              | Admin           |
| Lock Topic         | `POST`   | `/api/forum/topics/:id/lock`                                | Mod/Admin       |
| Forum Categories   | `GET`    | `/api/forum/categories`                                     | Public          |
| Forum Statistics   | `GET`    | `/api/forum/stats`                                          | Auth/Scoped     |
| Search Topics      | `GET`    | `/api/forum/search`                                         | Public/Auth     |
| Recent Topics      | `GET`    | `/api/forum/topics/recent`                                  | Public/Auth     |
| Popular Topics     | `GET`    | `/api/forum/topics/popular`                                 | Public/Auth     |
| Trending Topics    | `GET`    | `/api/forum/topics/trending`                                | Public/Auth     |
| Follow Topic       | `POST`   | `/api/forum/topics/:id/follow`                              | Auth            |
| Unfollow Topic     | `DELETE` | `/api/forum/topics/:id/follow`                              | Auth            |
| Followed Topics    | `GET`    | `/api/forum/topics/following`                               | Auth            |
| Report Content     | `POST`   | `/api/forum/report`                                         | Auth            |
| List Reports       | `GET`    | `/api/admin/content-reports`                                | Mod/Admin       |
| Resolve Report     | `PUT`    | `/api/admin/content-reports/:reportId/resolve`              | Mod/Admin       |

---

# Production Readiness Criteria

This API should not be considered production-ready merely because the endpoints return successful HTTP responses.

Production readiness requires all of the following:

```text
Authentication enforcement
Authorization enforcement
Tenant isolation
Input validation
Output validation
Safe content rendering
Rate limiting
Idempotency
Concurrency protection
Soft-delete behavior
Audit logging
Structured logging
Metrics
Tracing
Caching strategy
Database indexes
Search safeguards
Moderation controls
File upload controls
Error normalization
Automated tests
Security testing
Operational monitoring
Documented versioning
```

The API must fail closed for authorization and tenant-boundary checks.

---

# Document Metadata

**Document:** `docs/api/BACKEND_API_SPECIFICATION.md`
**Platform:** TITech Community Capital Ltd — Community Savings Platform
**Domain:** Help Center, FAQ & Community Forum
**API Version:** `1.x`
**Specification Status:** Production-Grade Backend API Specification
**Last Updated:** August 16, 2026

**Primary Example User:**

```text
Name: Justine Robert
Email: justine@titech.com
```

**Authoritative Integration Rule:**

> The actual deployed route registration, middleware chain, service layer, validation schemas, persistence implementation, and security controls are authoritative at runtime. This document defines the intended production-grade API contract and implementation requirements and must remain synchronized with the deployed backend.

**Change Control:**

```text
No breaking API change without explicit versioning or migration strategy.
No authorization bypass for documentation convenience.
No tenant-isolation bypass.
No direct mutation of protected historical/audit records.
No production secret values in examples.
```