# MoeNet DN42 Architecture

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Users (Telegram)                        │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Telegram Bot                             │
│                   (grammY + Hono.js + Bun)                      │
│  • Session Management (Redis)                                    │
│  • Rate Limiting                                                 │
│  • Peer Creation Wizard                                          │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Control Plane API                          │
│                      (Hono.js + Bun)                            │
│  • Authentication (GPG/SSH/Email)                                │
│  • Session CRUD                                                  │
│  • Admin Operations                                              │
└─────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│    PostgreSQL │        │     Redis     │        │   Agents      │
│  (persistent) │        │   (session)   │        │  (Go nodes)   │
└───────────────┘        └───────────────┘        └───────────────┘
```

## Components

### moenet-core (Control Plane + Bot)

| Component | Technology | Purpose |
|-----------|------------|---------|
| API | Hono.js + Bun | REST API for agents and admin |
| Bot | grammY + Bun | Telegram Bot for user interaction |
| Database | PostgreSQL | Persistent storage |
| Cache | Redis | Session persistence, rate limiting |

### moenet-agent (Node Agent)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Agent | Go | Manages BGP sessions on nodes |
| BIRD 3.x | C | BGP routing daemon |
| WireGuard | Kernel | Tunnel encryption |
| Babel | - | IGP mesh routing |

### moenet-dn42-infra (Infrastructure)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Ansible | Python | Configuration management |
| Terraform | HCL | Infrastructure provisioning |
| Wiki | Markdown | Documentation |

## Data Flow

### Peer Creation

```text
User → /peer → Bot → API → Database
                ↓
        Bot notifies Admin
                ↓
Admin → /pending → Approve → API → Database (status=QUEUED)
                                      ↓
                              Agent polls API
                                      ↓
                              Agent configures WG + BIRD
                                      ↓
                              Agent reports success → API → Database (status=ACTIVE)
```

### Session Lifecycle

| Status | Code | Description |
|--------|------|-------------|
| DISABLED | 0 | Session disabled |
| ACTIVE | 1 | Running normally |
| ERROR | 2 | Has errors |
| PENDING_REVIEW | 3 | Awaiting approval |
| QUEUED_FOR_SETUP | 4 | Approved, agent will configure |
| QUEUED_FOR_DELETE | 5 | Marked for deletion |
| SETUP_FAILED | 6 | Agent setup failed |

## Network Topology

```text
                    ┌──────────────┐
                    │  AS4242420998│
                    │  (MoeNet)    │
                    └──────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │  jp-edge  │───│  hk-edge  │───│  de-edge  │
     │  Tokyo    │   │  Hong Kong│   │  Frankfurt│
     └───────────┘   └───────────┘   └───────────┘
           │               │               │
     WireGuard +     WireGuard +     WireGuard +
     BIRD BGP        BIRD BGP        BIRD BGP
```

## Repositories

| Repository | Description |
|------------|-------------|
| [moenet-core](https://github.com/heichaowo/moenet-core) | Control Plane + Bot |
| [moenet-agent](https://github.com/moenet/moenet-agent) | Go Node Agent |
| [moenet-dn42-infra](https://github.com/heichaowo/moenet-dn42-infra) | Ansible + Terraform |

## Security

### Authentication Methods

1. **GPG** - Sign challenge with registered GPG key
2. **SSH** - Sign challenge with SSH key in DN42 registry
3. **Email** - One-time code to registered email

### Authorization

- **User**: Can manage own peers only
- **Admin**: Can manage all peers, approve/reject, block users

### Network Security

- WireGuard encryption for all tunnels
- Pre-shared keys optional
- Rate limiting on API and Bot
