# MoeNet Core

MoeNet DN42 Auto-Peering Platform - API and Web Frontend

## Tech Stack

- **API**: Bun + Hono.js + Sequelize
- **Web**: Vue 3 + Vite + Ant Design Vue
- **Database**: PostgreSQL
- **Cache**: Redis

## Quick Start

```bash
# Install dependencies
bun install

# Start API (development)
bun run dev:api

# Start with Docker
docker compose up -d
```

## Project Structure

```
moenet-core/
├── packages/
│   ├── api/              # Backend API (Hono.js)
│   │   ├── src/
│   │   │   ├── handlers/ # HTTP handlers
│   │   │   ├── services/ # Business logic
│   │   │   ├── db/       # Database models
│   │   │   └── common/   # Utilities
│   │   └── Dockerfile
│   │
│   └── web/              # Frontend (Vue 3)
│       └── src/
│
└── docker-compose.yml
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/agent/:router/sessions` | GET | Get BGP sessions |
| `/agent/:router/modify` | POST | Modify session status |
| `/agent/:router/report` | POST | Report metrics |
| `/agent/:router/heartbeat` | POST | Agent heartbeat |
| `/auth` | POST | Authentication |
| `/session` | POST | Peering management |

## Environment Variables

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=moenet
DB_USER=moenet
DB_PASSWORD=
REDIS_HOST=localhost
AGENT_API_KEY=
JWT_SECRET=
```

## License

MIT
