---
title: MoeNet Core Architecture
description: Control Plane architecture for MoeNet DN42 network
---

# MoeNet Core Architecture

## Overview

MoeNet Core is the Control Plane for the MoeNet DN42 network. It provides a REST API for agent communication and a Telegram Bot for user interaction.

## System Architecture

<!-- Diagram: MoeNet Core control plane showing Telegram Bot, REST API, PostgreSQL, Redis, and Agent connections -->

```text
┌─────────────────────────────────────────────────────────────────┐
│                       Users (Telegram)                          │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Telegram Bot                              │
│                   (grammY + Hono.js + Bun)                       │
│  • Session Management (Redis)                                    │
│  • Rate Limiting                                                 │
│  • Peer Creation Wizard                                          │
│  • Admin Commands (/addnode, /bootstrap)                         │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Control Plane API                           │
│                      (Hono.js + Bun)                             │
│  • Agent Authentication (JWT)                                    │
│  • Session CRUD                                                  │
│  • Bootstrap Token Management                                    │
│  • BIRD Policy Distribution                                      │
└─────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│  PostgreSQL   │        │     Redis     │        │    Agents     │
│  (persistent) │        │   (session)   │        │   (Go nodes)  │
└───────────────┘        └───────────────┘        └───────────────┘
```

## Directory Structure

```text
moenet-core/
├── packages/
│   ├── api/                    # Hono.js REST API
│   │   └── src/
│   │       ├── app.ts          # Entry point
│   │       ├── config.ts       # Configuration loader
│   │       ├── routes.ts       # Route registration
│   │       ├── handlers/       # Request handlers
│   │       │   ├── agent.ts    # Agent API (/agent/:router/*)
│   │       │   ├── auth.ts     # Authentication
│   │       │   ├── bootstrap.ts # Bootstrap token API
│   │       │   ├── peering.ts  # Peering management
│   │       │   └── admin.ts    # Admin operations
│   │       ├── db/
│   │       │   ├── dbContext.ts   # Sequelize init
│   │       │   ├── redisContext.ts # Redis init
│   │       │   └── models/     # Sequelize models
│   │       ├── middleware/
│   │       │   ├── rateLimiter.ts
│   │       │   └── requestId.ts
│   │       ├── providers/
│   │       │   ├── whois.ts    # DN42 WHOIS lookup
│   │       │   └── chinaIp.ts  # China IP detection
│   │       └── tests/          # Test files
│   │
│   └── bot/                    # grammY Telegram Bot
│       └── src/
│           ├── index.ts        # Entry point
│           ├── bot.ts          # Bot instance
│           ├── middleware.ts   # Rate limiting, metrics
│           ├── storage.ts      # Redis session adapter
│           ├── i18n.ts         # Bilingual (EN/ZH)
│           ├── commands/
│           │   ├── user.ts     # /start, /help, /login
│           │   ├── peer.ts     # /peer, /info, /modify
│           │   ├── peer/       # Modular peer handlers
│           │   │   ├── handlers/   # Callback handlers
│           │   │   ├── ui.ts       # UI prompt helpers
│           │   │   └── api.ts      # Shared API client
│           │   ├── tools.ts    # /ping, /trace, /whois
│           │   ├── admin.ts    # /pending, /block
│           │   ├── nodes.ts    # /addnode, /bootstrap
│           │   └── help.ts     # Command help
│           ├── providers/
│           │   └── chinaIp.ts  # China IP detection
│           └── services/
│               └── dn42Validator.ts # IP ownership validation
│
├── docker-compose.yml          # Full stack deployment
├── prometheus.yml              # Prometheus config
├── migrations/                 # Database migrations
└── docs/                       # Documentation
```

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Bun | Latest | Runtime and package manager |
| TypeScript | 5.9.3 | Type-safe JavaScript |
| Hono | 4.6.0 | Web framework |
| grammY | 1.21.0 | Telegram Bot framework |
| Sequelize | 6.37.0 | PostgreSQL ORM |
| Zod | 4.3.6 | Schema validation |
| Biome | Latest | Linting and formatting |
| Redis | ioredis 5.4.x | Session storage |
| PostgreSQL | 16 | Persistent storage |

### TypeScript Configuration

> [!IMPORTANT]
> Strict mode is enabled with these critical flags:
>
> - `noUncheckedIndexedAccess`: Array access may be undefined
> - `verbatimModuleSyntax`: Explicit import/export type annotations
> - `noImplicitOverride`: Override keyword required

## API Endpoints

### Agent API (`/agent/:router/*`)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/sessions` | GET | Token | Get BGP sessions for node |
| `/bird-config` | GET | Token | Get BIRD policy config |
| `/config` | GET | Token | Get full node config (bootstrap) |
| `/modify` | POST | Token | Modify session status |
| `/report` | POST | Token | Report metrics |
| `/heartbeat` | POST | Token | Agent heartbeat |
| `/mesh` | GET | Token | Get mesh peers |

### Bootstrap API

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/bootstrap/:token` | GET | Token | Get bootstrap script (one-time) |

### Public API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |
| `/auth` | POST | User authentication |
| `/session` | POST | Create/modify sessions |
| `/admin` | POST | Admin operations |

## Bot Commands

### User Commands

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show all commands |
| `/login` | Login with ASN (GPG/SSH/Email) |
| `/logout`, `/whoami` | Session management |
| `/peer` | Create new peer (wizard) |
| `/info` | View your peers |
| `/modify` | Modify peer settings |
| `/remove` | Delete a peer |
| `/status` | Check WG/BGP status |
| `/restart` | Restart WG tunnel |
| `/cancel` | Cancel current operation |

### Network Tools

| Command | Description |
|---------|-------------|
| `/ping <target>` | Ping from nodes |
| `/trace <target>` | Traceroute |
| `/whois <query>` | DN42 whois lookup |
| `/dig <domain>` | DNS lookup |
| `/route <prefix>` | BGP route lookup |
| `/findnoc <asn>` | Find NOC contact |

### Node Management (Admin)

| Command | Description |
|---------|-------------|
| `/addnode` | Add new node (wizard) |
| `/bootstrap <node>` | Generate bootstrap script |
| `/delnode <node>` | Delete a node |
| `/nodes` | List all nodes |

## Data Flow

### Peer Creation Flow

```text
User → /peer → Bot → API → Database (PENDING_REVIEW)
                ↓
        Bot notifies Admin
                ↓
Admin → /pending → Approve → API → Database (QUEUED_FOR_SETUP)
                                      ↓
                              Agent polls /sessions
                                      ↓
                              Agent configures WG + BIRD
                                      ↓
                              Agent POST /modify → ACTIVE
```

### Bootstrap Flow

```text
┌─────────────┐    /addnode     ┌─────────────┐
│   Admin     │ ───────────────→│   Bot       │
│  (Telegram) │                 │             │
└─────────────┘                 └──────┬──────┘
                                       │ Creates router + bootstrap_token
                                       ▼
┌─────────────┐    /bootstrap   ┌─────────────┐
│   Admin     │ ───────────────→│   Bot       │
│  (Telegram) │                 │             │
└─────────────┘                 └──────┬──────┘
                                       │ Returns: curl ... | bash
                                       ▼
┌─────────────┐    curl script  ┌─────────────┐
│  New Server │ ───────────────→│   API       │
│             │ ←───────────────│ /bootstrap  │
└──────┬──────┘   Shell Script  └─────────────┘
       │
       ▼  Runs bootstrap script → Agent starts → Connected!
```

## Database Schema

See [DATABASE.md](./DATABASE.md) for complete schema.

Key tables:

- `routers` - Node definitions
- `sessions` - BGP peering sessions
- `bird_policies` - BIRD filter policies
- `users` - Authenticated users

## Session Storage (Redis)

Session state stored in Redis for Bot:

```typescript
interface SessionData {
    userId?: number;
    asnNumber?: number;
    email?: string;
    authMethod?: 'gpg' | 'ssh' | 'email';
    step?: string;
    peerData?: Partial<PeerConfig>;
}
```

## Authentication

### User Authentication Methods

1. **GPG** - Sign challenge with registered GPG key
2. **SSH** - Sign challenge with SSH key in DN42 registry  
3. **Email** - One-time code to registered email

### Agent Authentication

- JWT tokens issued per agent
- Tokens stored in `routers.agent_token`
- Validated via Bearer header

## Security

- Rate limiting on API and Bot (configurable per endpoint)
- Request ID tracking for debugging
- CORS configured for allowed origins
- Zod validation on all external input

## Monitoring

| Service | Port | Domain |
|---------|------|--------|
| API | 3000 | api.moenet.work |
| Bot | 3001 | bot.moenet.work |
| Prometheus | 9090 | prom.moenet.work |
| Grafana | 3002 | grafana.moenet.work |

## Development

```bash
# Install dependencies
bun install

# Development mode
bun run dev:api   # API only
bun run dev:web   # Web only (if applicable)

# Run tests
bun test

# Lint
bun run lint
```

## Related Documentation

- [API Reference](./API.md)
- [Database Schema](./DATABASE.md)
- [Bot Development](./BOT.md)
- [Production Deployment](./PRODUCTION.md)
