# Audit Log Hash Chain System

## 1. Objective

Ensure:
- Immutable logs
- Tamper detection
- Regulatory compliance

---

## 2. Core Principle

Every log is linked to the previous using cryptographic hashing.

This creates a **chain of trust**.

---

## 3. Schema

```json
{
  "_id": "...",
  "tenantId": "...",
  "action": "transaction.created",
  "data": {},
  "previousHash": "...",
  "hash": "...",
  "createdAt": "ISODate"
}