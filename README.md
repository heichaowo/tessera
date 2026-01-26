# MoeNet Core

Complete rewrite of MoeNet DN42 Control Plane and Telegram Bot using Bun + Hono.js + grammY.

## Architecture

```
moenet-core/
├── packages/
│   ├── api/          # Hono.js REST API
│   │   └── src/
│   │       ├── handlers/   # Agent, Auth, Peering, Admin
│   │       ├── db/         # Sequelize models
│   │       └── providers/  # WHOIS
│   │
│   └── bot/          # grammY Telegram Bot
│       └── src/
│           ├── commands/   # User, Peer, Tools, Admin
│           └── i18n/       # Bilingual messages
│
└── docker-compose.yml
```

## Quick Start

```bash
# Install dependencies
bun install

# Copy environment file
cp .env.example .env
# Edit .env with your values

# Development
bun run dev

# Production (Docker)
docker-compose up -d
```

## Environment Variables

See `.env.example` for all available configuration options.

### Required

- `TELEGRAM_BOT_TOKEN` - Telegram bot token from @BotFather
- `DB_PASSWORD` - PostgreSQL password
- `JWT_SECRET` - Secret for JWT tokens
- `WEBHOOK_DOMAIN` - Domain for webhook (e.g. `bot.example.com`)
- `WEBHOOK_SECRET` - Secret token for webhook validation

### Bot Configuration

- `TELEGRAM_ADMIN_USERNAME` - Admin username for notifications
- `TELEGRAM_ADMIN_CHAT_ID` - Chat ID for admin alerts
- `RATE_LIMIT_MAX` - Max requests per window (default: 20)
- `RATE_LIMIT_WINDOW_MS` - Window in ms (default: 60000)
- `REDIS_URL` - Redis URL for session persistence (optional)

### Agent Configuration

- `AGENT_HOSTS` - JSON map of node IDs to hostnames
- `NODE_NAMES` - JSON map of node IDs to display names
- `AGENT_TOKEN` - Bearer token for agent API

## Bot Commands

### User Commands

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show all commands |
| `/login` | Login with ASN |
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
| `/ping` | Ping from nodes |
| `/trace`, `/traceroute` | Traceroute |
| `/whois` | DN42 whois lookup |
| `/dig` | DNS lookup |
| `/route`, `/path` | BGP route lookup |
| `/findnoc` | Find NOC contact |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/addpeer` | Add peer for user |
| `/pending` | View pending approvals |
| `/nodes` | List all nodes |
| `/block` | Manage blocklist |

## API Endpoints

### Agent API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/:router/sessions` | GET | Get BGP sessions |
| `/agent/:router/modify` | POST | Modify session |
| `/agent/:router/report` | POST | Report metrics |
| `/agent/:router/heartbeat` | POST | Agent heartbeat (with meshPublicKey) |
| `/agent/:router/mesh` | GET | Get mesh peers |
| `/agent/:router/config` | GET | Get full agent config (Bootstrap mode) |

### Public API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | POST | Authentication (query, request, challenge) |
| `/session` | POST | Peering management |
| `/admin` | POST | Admin operations |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |

## Robustness Features

### Rate Limiting

Redis-based sliding window rate limiting per route:

| Route | Limit |
|-------|-------|
| `/agent/*` | 300/min |
| `/auth` | 60/min |
| `/admin` | 30/min |
| Default | 60/min |

Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Bootstrap Mode

Agents can fetch their full configuration from the Control Plane using the `/config` endpoint:

```json
{
  "bootstrap": {
    "controlPlaneUrl": "https://api.moenet.work",
    "nodeName": "jp-edge",
    "token": "your-token"
  }
}
```

The agent fetches `nodeId`, `region`, `loopback IPs`, and other settings from the database.

### Input Validation

All API endpoints use [Zod](https://zod.dev) schema validation:

```typescript
import { validateBody } from './schemas';
import { AuthRequestBodySchema } from './schemas/auth';

const parsed = await validateBody(c, AuthRequestBodySchema);
if (parsed instanceof Response) return parsed;
```

Schemas: `src/schemas/auth.ts`, `src/schemas/agent.ts`, `src/schemas/peering.ts`

### Structured Logging

JSON-formatted logs with request context:

```typescript
import { logger } from './common/logger';

logger.info('Session created', { sessionId, asn });
logger.error('Failed to sync', error, { routerId });
```

### Audit Logging

Security-critical actions are logged to `audit_logs` table:

```typescript
import { auditUserAction } from './services/auditLog';

await auditUserAction(c, 'session.create', userAsn, { type: 'session', id: sessionId });
```

Event types: `auth.*`, `session.*`, `admin.*`, `agent.*`

## License

MIT
