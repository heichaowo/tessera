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

## Bot Commands

| Category | Commands |
|----------|----------|
| User | /login, /logout, /whoami |
| Peer | /peer, /info, /modify, /remove, /restart |
| Tools | /ping, /tcping, /trace, /route, /path, /whois, /dig, /findnoc |
| Admin | /approve, /reject, /nodes |
| Stats | /stats, /rank, /peerlist, /community, /latency |

## API Endpoints

- `POST /agent` - Agent API (sessions, modify, report, heartbeat)
- `POST /auth` - Authentication (query, request, challenge)
- `POST /session` - Peering management
- `POST /admin` - Admin operations

## License

MIT
