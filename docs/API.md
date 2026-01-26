# MoeNet Core API Reference

## Overview

The MoeNet Core API provides endpoints for authentication, peering management, and agent communication.

Base URL: `https://api.moenet.work`

## Authentication

### POST /auth

Handles all authentication flows.

#### Query User Info

```json
{
  "action": "query",
  "asn": 4242421080
}
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

```json
{
  "action": "request",
  "asn": 4242421080,
  "method": "gpg"
}
```

**Response:**

```json
{
  "challenge": "base64-encoded-challenge",
  "expires": 300
}
```

#### Verify Challenge

```json
{
  "action": "verify",
  "asn": 4242421080,
  "method": "gpg",
  "signature": "base64-encoded-signature"
}
```

**Response:**

```json
{
  "token": "jwt-token",
  "expiresIn": 86400
}
```

## Peering

All peering endpoints require authentication.

**Headers:**

```
Authorization: Bearer <jwt-token>
```

### POST /session

#### List Sessions

```json
{
  "action": "list"
}
```

**Response:**

```json
{
  "sessions": [
    {
      "uuid": "abc-123",
      "router": "jp-edge",
      "status": 1,
      "ipv6": "fe80::1",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Create Session

```json
{
  "action": "create",
  "router": "uuid-of-router",
  "ipv6": "fe80::1",
  "linkLocal": "fe80::2",
  "endpoint": "example.com:51820",
  "publicKey": "wireguard-public-key",
  "mtu": 1420
}
```

**Response:**

```json
{
  "uuid": "new-session-uuid",
  "status": 3,
  "serverEndpoint": "jp.moenet.work:24001",
  "serverPublicKey": "server-wireguard-key",
  "serverLinkLocal": "fe80::998:1"
}
```

#### Modify Session

```json
{
  "action": "modify",
  "uuid": "session-uuid",
  "endpoint": "new-endpoint.com:51820",
  "mtu": 1400
}
```

#### Delete Session

```json
{
  "action": "delete",
  "uuid": "session-uuid"
}
```

#### Restart Session

```json
{
  "action": "restart",
  "uuid": "session-uuid"
}
```

## Admin

Requires admin privileges.

### POST /admin

#### List Pending Sessions

```json
{
  "action": "pending"
}
```

#### Approve Session

```json
{
  "action": "approve",
  "uuid": "session-uuid"
}
```

#### Reject Session

```json
{
  "action": "reject",
  "uuid": "session-uuid",
  "reason": "Invalid configuration"
}
```

#### Block ASN

```json
{
  "action": "block",
  "asn": 4242421080,
  "reason": "Policy violation"
}
```

#### Unblock ASN

```json
{
  "action": "unblock",
  "asn": 4242421080
}
```

## Agent API

Used by node agents. Requires agent token.

**Headers:**

```
Authorization: Bearer <agent-token>
```

### GET /agent/:router/sessions

Get all sessions for a router.

### POST /agent/:router/heartbeat

Report agent health.

```json
{
  "version": "1.2.0",
  "uptime": 3600,
  "meshPublicKey": "..."
}
```

### POST /agent/:router/report

Report session metrics.

```json
{
  "sessions": [
    {
      "uuid": "abc-123",
      "rtt_ms": 25,
      "routes_imported": 150,
      "state": "established"
    }
  ]
}
```

### POST /agent/:router/modify

Update session status.

```json
{
  "uuid": "abc-123",
  "status": 1,
  "error": null
}
```

### GET /agent/:router/config

Get bootstrap configuration.

## Health & Metrics

### GET /health

```json
{
  "status": "ok"
}
```

### GET /metrics

Returns Prometheus-format metrics.

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden (not admin) |
| 404 | Resource not found |
| 409 | Conflict (duplicate) |
| 429 | Rate limited |
| 500 | Internal error |

Error response format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## Rate Limits

| Route | Limit |
|-------|-------|
| `/agent/*` | 300/min |
| `/auth` | 60/min |
| `/admin` | 30/min |
| Default | 60/min |

Headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
