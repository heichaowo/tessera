# MoeNet Core

Complete rewrite of MoeNet DN42 Control Plane and Telegram Bot using Bun + Hono.js + grammY.

## Architecture

```text
moenet-core/
├── packages/
│   ├── api/              # Hono.js REST API
│   │   └── src/
│   │       ├── handlers/     # Agent, Auth, Peering, Admin
│   │       ├── db/           # Sequelize models
│   │       └── providers/    # WHOIS
│   │
│   └── bot/              # grammY Telegram Bot
│       └── src/
│           ├── commands/     # User, Peer, Tools, Admin, Help
│           ├── middleware.ts # Rate limiting, Metrics
│           ├── storage.ts    # Redis session adapter
│           ├── i18n.ts       # Bilingual messages (EN/ZH)
│           └── providers/    # Node provider
│
├── docs/                 # Documentation
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
docker compose up -d
```

## Environment Variables

See `.env.example` for all available configuration options.

### Required

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `DB_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | Secret for JWT tokens |
| `WEBHOOK_DOMAIN` | Domain for webhook (e.g. `bot.example.com`) |
| `WEBHOOK_SECRET` | Secret token for webhook validation |

### Bot Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_ADMIN_USERNAME` | Admin username for permissions | - |
| `TELEGRAM_ADMIN_CHAT_ID` | Chat ID for admin alerts | - |
| `TELEGRAM_CONTACT` | Contact shown in help | `@heicha` |
| `LOCAL_ASN` | Local network ASN | `4242420998` |
| `RATE_LIMIT_MAX` | Max requests per window | `20` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | `60000` |
| `REDIS_URL` | Redis URL for session persistence | (in-memory) |

### Agent Configuration

| Variable | Description |
|----------|-------------|
| `AGENT_HOSTS` | JSON map of node IDs to hostnames |
| `NODE_NAMES` | JSON map of node IDs to display names |
| `AGENT_TOKEN` | Bearer token for agent API |
| `AGENT_PORT` | Agent API port (default: 8080) |

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

### Admin Commands

| Command | Description |
|---------|-------------|
| `/addpeer` | Add peer for user |
| `/pending` | View pending approvals |
| `/nodes` | List all nodes |
| `/block` | Manage blocklist |
| `/main` | Maintenance mode |

## Bot Features

### Rate Limiting

Per-user rate limiting with configurable window:

- Default: 20 requests per 60 seconds
- Configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`

### Session Persistence

Redis-based session storage:

- Sessions persist across bot restarts
- 7-day TTL for inactive sessions
- Falls back to in-memory if Redis unavailable

### Metrics Endpoint

`GET /metrics` returns:

```json
{
  "uptime_seconds": 3600,
  "total_requests": 1234,
  "errors": 5,
  "rate_limited": 10,
  "top_commands": [{"command": "ping", "count": 100}]
}
```

## API Endpoints

### Agent API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/:router/sessions` | GET | Get BGP sessions |
| `/agent/:router/modify` | POST | Modify session |
| `/agent/:router/report` | POST | Report metrics |
| `/agent/:router/heartbeat` | POST | Agent heartbeat |
| `/agent/:router/mesh` | GET | Get mesh peers |
| `/agent/:router/config` | GET | Bootstrap config |

### Public API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | POST | Authentication |
| `/session` | POST | Peering management |
| `/admin` | POST | Admin operations |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |

## Documentation

- [Database Schema](docs/DATABASE.md)
- [Production Deployment](docs/PRODUCTION.md)
- [Bot Development](docs/BOT.md)

## License

MIT
