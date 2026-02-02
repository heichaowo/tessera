---
title: MoeNet Core API Reference
description: REST API endpoints for authentication, peering management, and agent communication
---

# MoeNet Core API Reference

## Overview

The MoeNet Core API provides endpoints for user authentication, peering session management, and agent communication.

**Base URL:** `https://api.moenet.work`

## Table of Contents

- [Authentication](#authentication)
- [Peering](#peering)
- [Admin Operations](#admin-operations)
- [Agent Endpoints](#agent-endpoints)
- [Health & Metrics](#health--metrics)
- [Error Handling](#error-handling)
- [Rate Limits](#rate-limits)

---

## Authentication

### POST /auth

Multi-action endpoint for user authentication.

#### Query User Info

Check if an ASN is registered and available authentication methods.

**Request:**

```bash
curl -X POST https://api.moenet.work/auth \
  -H "Content-Type: application/json" \
  -d '{"action": "query", "asn": 4242421080}'
```

**Response:**

```json
{
  "exists": true,
  "mntner": "EXAMPLE-MNT",
  "methods": ["gpg", "ssh", "email"]
}
```

#### Request Challenge

Request an authentication challenge for signing.

**Request:**

```bash
curl -X POST https://api.moenet.work/auth \
  -H "Content-Type: application/json" \
  -d '{"action": "request", "asn": 4242421080, "method": "gpg"}'
```

**Response:**

```json
{
  "challenge": "base64-encoded-challenge",
  "expires": 300
}
```

#### Verify Challenge

Submit signed challenge to receive JWT token.

**Request:**

```bash
curl -X POST https://api.moenet.work/auth \
  -H "Content-Type: application/json" \
  -d '{
    "action": "verify",
    "asn": 4242421080,
    "method": "gpg",
    "signature": "base64-encoded-signature"
  }'
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 86400
}
```

**Error (Invalid Signature):**

```json
{
  "error": "Invalid signature",
  "code": "AUTH_FAILED"
}
```

---

## Peering

All peering endpoints require authentication.

**Headers:**

```bash
Authorization: Bearer <jwt-token>
```

### POST /session

#### List Sessions

```bash
curl -X POST https://api.moenet.work/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "list"}'
```

**Response:**

```json
{
  "sessions": [
    {
      "uuid": "abc-123",
      "router": "jp1",
      "routerName": "Tokyo #1",
      "status": 1,
      "statusName": "ACTIVE",
      "ipv6": "fe80::1",
      "ipv6LinkLocal": "fe80::2",
      "mtu": 1420,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Create Session

```bash
curl -X POST https://api.moenet.work/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "router": "uuid-of-router",
    "ipv6": "fe80::1",
    "linkLocal": "fe80::2",
    "endpoint": "example.com:51820",
    "publicKey": "wireguard-public-key",
    "mtu": 1420
  }'
```

**Response:**

```json
{
  "uuid": "new-session-uuid",
  "status": 3,
  "statusName": "PENDING_REVIEW",
  "serverEndpoint": "jp.moenet.work:24001",
  "serverPublicKey": "server-wireguard-key",
  "serverLinkLocal": "fe80::998:1"
}
```

#### Modify Session

```bash
curl -X POST https://api.moenet.work/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "modify",
    "uuid": "session-uuid",
    "endpoint": "new-endpoint.com:51820",
    "mtu": 1400
  }'
```

#### Delete Session

```bash
curl -X POST https://api.moenet.work/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "delete", "uuid": "session-uuid"}'
```

#### Restart Session

Triggers WireGuard tunnel restart on the node.

```bash
curl -X POST https://api.moenet.work/session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "restart", "uuid": "session-uuid"}'
```

---

## Admin Operations

Requires admin privileges (verified via Telegram username).

### POST /admin

#### List Pending Sessions

```bash
curl -X POST https://api.moenet.work/admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "pending"}'
```

#### Approve Session

```bash
curl -X POST https://api.moenet.work/admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve", "uuid": "session-uuid"}'
```

#### Reject Session

```bash
curl -X POST https://api.moenet.work/admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "reject",
    "uuid": "session-uuid",
    "reason": "Invalid configuration"
  }'
```

#### Block ASN

```bash
curl -X POST https://api.moenet.work/admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "block",
    "asn": 4242421080,
    "reason": "Policy violation"
  }'
```

#### Unblock ASN

```bash
curl -X POST https://api.moenet.work/admin \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "unblock", "asn": 4242421080}'
```

---

## Agent Endpoints

Used by node agents. Requires agent token.

**Headers:**

```bash
Authorization: Bearer <agent-token>
```

### GET /agent/:router/sessions

Fetch all BGP sessions for a router.

```bash
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  https://api.moenet.work/agent/jp1/sessions
```

### GET /agent/:router/bird-config

Fetch BIRD policy and community configuration.

### GET /agent/:router/mesh

Fetch mesh IGP peer list.

### GET /agent/:router/config

Fetch full bootstrap configuration.

### POST /agent/:router/heartbeat

Report agent health.

```bash
curl -X POST https://api.moenet.work/agent/jp1/heartbeat \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version": "1.2.0", "uptime": 3600, "meshPublicKey": "..."}'
```

### POST /agent/:router/report

Report session metrics.

### POST /agent/:router/modify

Update session status after configuration.

---

## Health & Metrics

### GET /health

```bash
curl https://api.moenet.work/health
```

**Response:**

```json
{
  "status": "ok"
}
```

### GET /metrics

Returns Prometheus-format metrics.

```bash
curl https://api.moenet.work/metrics
```

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad request (invalid JSON, missing fields) |
| 401 | Unauthorized (invalid or missing token) |
| 403 | Forbidden (not admin) |
| 404 | Resource not found |
| 409 | Conflict (duplicate session) |
| 429 | Rate limited |
| 500 | Internal server error |

### Error Response Format

```json
{
  "error": "Detailed error message",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `AUTH_FAILED` | Authentication failed |
| `INVALID_TOKEN` | JWT token invalid or expired |
| `ASN_BLOCKED` | ASN is blocked |
| `SESSION_EXISTS` | Duplicate session for this router |
| `SESSION_NOT_FOUND` | Session UUID not found |
| `NOT_ADMIN` | Admin privileges required |
| `RATE_LIMITED` | Too many requests |

---

## Rate Limits

| Route | Limit |
|-------|-------|
| `/agent/*` | 300/min |
| `/auth` | 60/min |
| `/admin` | 30/min |
| Default | 60/min |

**Response Headers:**

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Remaining requests |
| `X-RateLimit-Reset` | Unix timestamp when limit resets |

**Rate Limited Response (429):**

```json
{
  "error": "Too many requests",
  "code": "RATE_LIMITED",
  "retryAfter": 60
}
```
