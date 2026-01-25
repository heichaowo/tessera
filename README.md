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

Required:

- `TELEGRAM_BOT_TOKEN` - Telegram bot token from @BotFather
- `DB_PASSWORD` - PostgreSQL password
- `JWT_SECRET` - Secret for JWT tokens

Bot Agent Configuration (optional):

- `AGENT_HOSTS` - JSON map of node IDs to hostnames
- `NODE_NAMES` - JSON map of node IDs to display names

## Bot Commands

| Category | Commands |
|----------|----------|
| User | /login, /logout, /whoami |
| Peer | /peer, /info, /modify, /remove, /restart |
| Tools | /ping, /tcping, /trace, /route, /path, /whois, /dig, /findnoc |
| Admin | /approve, /reject, /block, /nodes |
| Stats | /stats, /rank, /peerlist, /community, /latency |

## API Endpoints

### Agent API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/:router/sessions` | GET | Get BGP sessions |
| `/agent/:router/modify` | POST | Modify session |
| `/agent/:router/report` | POST | Report metrics |
| `/agent/:router/heartbeat` | POST | Agent heartbeat |
| `/agent/:router/mesh` | GET | Get mesh peers |

### Public API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | POST | Authentication (query, request, challenge) |
| `/session` | POST | Peering management |
| `/admin` | POST | Admin operations |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |

## License

MIT
