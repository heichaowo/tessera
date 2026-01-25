# Production Deployment

## Prerequisites

- Docker & Docker Compose v2
- Domain with DNS configured
- SSL certificates (optional, use reverse proxy)

## Quick Start

```bash
# Clone and configure
git clone https://github.com/heichaowo/moenet-core.git
cd moenet-core
cp .env.example .env
vim .env  # Configure all required values

# Deploy
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PASSWORD` | ✅ | PostgreSQL password |
| `JWT_SECRET` | ✅ | Secret for JWT tokens |
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `TELEGRAM_ADMIN_USERNAME` | ✅ | Admin username |
| `AGENT_API_KEY` | ✅ | Agent authentication key |
| `RESEND_API_KEY` | ❌ | Email service (optional) |
| `AGENT_HOSTS` | ❌ | JSON map of node IDs to hostnames |
| `NODE_NAMES` | ❌ | JSON map of node IDs to display names |

## Monitoring

```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check health
curl http://localhost:3000/health

# Prometheus metrics
curl http://localhost:3000/metrics
```

## Backup

```bash
# Backup PostgreSQL
docker exec moenet-postgres pg_dump -U moenet moenet > backup.sql

# Restore
docker exec -i moenet-postgres psql -U moenet moenet < backup.sql
```

## CI/CD

Push to `main` triggers:

1. Run tests
2. Build Docker images
3. Push to GHCR
4. Deploy to server (if secrets configured)

Required GitHub Secrets:

- `DEPLOY_HOST` - Server hostname
- `DEPLOY_USER` - SSH username
- `DEPLOY_KEY` - SSH private key
