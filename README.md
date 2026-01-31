# MoeNet Core

Complete rewrite of MoeNet DN42 Control Plane and Telegram Bot using Bun + Hono.js + grammY.

## Architecture

```text
moenet-core/
├── packages/
│   ├── api/              # Hono.js REST API
│   │   └── src/
│   │       ├── handlers/     # Agent, Auth, Peering, Admin, Bootstrap
│   │       ├── db/           # Sequelize models
│   │       └── providers/    # WHOIS
│   │
│   └── bot/              # grammY Telegram Bot
│       └── src/
│           ├── commands/     # User, Peer, Tools, Admin, Nodes, Help
│           ├── middleware.ts # Rate limiting, Metrics
│           ├── storage.ts    # Redis session adapter
│           └── i18n.ts       # Bilingual messages (EN/ZH)
│
├── prometheus.yml        # Prometheus scrape config
└── docker-compose.yml    # Full stack deployment
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

## Services

| Service    | Port  | Domain               |
|------------|-------|---------------------|
| API        | 3000  | api.moenet.work     |
| Bot        | 3001  | bot.moenet.work     |
| Prometheus | 9090  | prom.moenet.work    |
| Grafana    | 3002  | grafana.moenet.work |

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
| `GRAFANA_PASSWORD` | Grafana admin password |

### Bot Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_ADMIN_USERNAME` | Admin username for permissions | - |
| `TELEGRAM_ADMIN_CHAT_ID` | Chat ID for admin alerts | - |
| `TELEGRAM_CONTACT` | Contact shown in help | `@heicha` |
| `LOCAL_ASN` | Local network ASN | `4242420998` |
| `REDIS_URL` | Redis URL for session persistence | (in-memory) |

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
| `/addnode` | Add new node (interactive wizard) |
| `/bootstrap <node>` | Generate bootstrap script for node |
| `/delnode <node>` | Delete a node |
| `/nodes` | List all nodes |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/addpeer` | Add peer for user |
| `/pending` | View pending approvals |
| `/block` | Manage blocklist |
| `/main` | Maintenance mode |

## API Endpoints

### Bootstrap API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/bootstrap/:token` | GET | Get bootstrap script (one-time token) |

### Agent API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/:router/sessions` | GET | Get BGP sessions |
| `/agent/:router/bird-config` | GET | Get BIRD policy config |
| `/agent/:router/modify` | POST | Modify session |
| `/agent/:router/report` | POST | Report metrics |
| `/agent/:router/heartbeat` | POST | Agent heartbeat |
| `/agent/:router/mesh` | GET | Get mesh peers |
| `/agent/:router/config` | GET | Full node config (for bootstrap) |

### Public API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth` | POST | Authentication |
| `/session` | POST | Peering management |
| `/admin` | POST | Admin operations |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |

## BGP Communities

### ✅ Accepted at Node

**Format:** `4242420998:100:<NodeID>`

| Community | Location | Node |
| :--- | :--- | :--- |
| `4242420998:100:1` | Tokyo, JP | JP1 |
| `4242420998:100:2` | Tokyo, JP | JP2 |
| `4242420998:100:3` | Hong Kong, HK | HK1 |
| `4242420998:100:4` | Hong Kong, HK | HK2 |
| `4242420998:100:21` | Los Angeles, US | US1 |
| `4242420998:100:22` | Los Angeles, US | US2 |
| `4242420998:100:23` | Bern, CH | CH |

### ❌ Rejected Routes

**Format:** `4242420998:150:<ReasonID>`

| Community | Reason |
| :--- | :--- |
| `4242420998:150:1` | Self route |
| `4242420998:150:2` | Invalid prefix |
| `4242420998:150:3` | ROA invalid |
| `4242420998:150:4` | Long AS path |
| `4242420998:150:5` | Blocked ASN |

### DN42 Standard Communities

**Latency** `(64511, 1-9)`

| Community | RTT |
| :--- | :--- |
| `(64511, 1)` | < 2.7ms |
| `(64511, 2)` | < 7.3ms |
| `(64511, 3)` | < 20ms |
| `(64511, 4)` | < 55ms |
| `(64511, 5)` | < 148ms |
| `(64511, 6)` | < 403ms |
| `(64511, 7)` | < 1097ms |
| `(64511, 8)` | < 2981ms |
| `(64511, 9)` | >= 2981ms |

**Bandwidth** `(64511, 21-25)`

| Community | Bandwidth |
| :--- | :--- |
| `(64511, 21)` | >= 100 Mbps |
| `(64511, 22)` | >= 10 Gbps |
| `(64511, 23)` | >= 1 Gbps |
| `(64511, 24)` | >= 100 Kbps |
| `(64511, 25)` | >= 10 Mbps |

**Encryption** `(64511, 31-34)`

| Community | Type |
| :--- | :--- |
| `(64511, 31)` | None |
| `(64511, 32)` | Unsafe |
| `(64511, 33)` | Encrypted (WireGuard) |
| `(64511, 34)` | Encrypted (Latency-critical) |

**Region** `(64511, 41-53)`

| Community | Region |
| :--- | :--- |
| `(64511, 41)` | Europe |
| `(64511, 50)` | Asia - East |
| `(64511, 51)` | Oceania |

## Bootstrap Flow

```
┌─────────────┐    /addnode     ┌─────────────┐
│   Admin     │ ──────────────> │   Bot       │
│  (Telegram) │                 │             │
└─────────────┘                 └──────┬──────┘
                                       │ Creates router + token
                                       v
┌─────────────┐    /bootstrap   ┌─────────────┐
│   Admin     │ ──────────────> │   Bot       │
│  (Telegram) │                 │             │
└─────────────┘                 └──────┬──────┘
                                       │ Returns: curl ... | bash
                                       v
┌─────────────┐    curl script  ┌─────────────┐
│  New Server │ ──────────────> │   API       │
│             │ <-------------- │ /bootstrap  │
└──────┬──────┘   Shell Script  └─────────────┘
       │
       v  Runs bootstrap script
┌─────────────┐
│  Configured │ ── Agent starts ── Control Plane connected!
│    Node     │
└─────────────┘
```

## Monitoring

- **Prometheus**: <http://prom.moenet.work> - Metrics collection
- **Grafana**: <http://grafana.moenet.work> - Dashboards

## Documentation

- [Database Schema](docs/DATABASE.md)
- [Production Deployment](docs/PRODUCTION.md)
- [Bot Development](docs/BOT.md)

## License

No License
