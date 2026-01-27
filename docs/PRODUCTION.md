# Production Deployment

## Prerequisites

- Docker & Docker Compose v2
- Domain with DNS configured
- SSL certificates (Traefik handles this automatically via Let's Encrypt)

## Quick Start

```bash
# Clone and configure
git clone https://github.com/heichaowo/moenet-core.git
cd moenet-core
cp .env.example .env
vim .env  # Configure all required values

# Deploy
docker compose up -d
```

## Services

| Service    | Port   | Description               |
|------------|--------|---------------------------|
| `api`      | 3000   | Hono.js REST API          |
| `bot`      | 8443   | Telegram Bot (webhook)    |
| `postgres` | 5432   | PostgreSQL database       |
| `redis`    | 6379   | Session/cache store       |
| `traefik`  | 80/443 | Reverse proxy with TLS    |

## Environment Variables

### Required

| Variable                  | Description                     |
|---------------------------|---------------------------------|
| `DB_PASSWORD`             | PostgreSQL password             |
| `JWT_SECRET`              | Secret for JWT tokens           |
| `TELEGRAM_BOT_TOKEN`      | Bot token from @BotFather       |
| `TELEGRAM_ADMIN_USERNAME` | Admin username for permissions  |
| `TELEGRAM_ADMIN_CHAT_ID`  | Admin chat ID for notifications |
| `WEBHOOK_DOMAIN`          | Bot webhook domain              |
| `WEBHOOK_SECRET`          | Webhook validation secret       |
| `AGENT_API_KEY`           | Agent authentication key        |

### Optional

| Variable               | Default                     | Description             |
|------------------------|-----------------------------|-------------------------|
| `REDIS_URL`            | `redis://moenet-redis:6379` | Redis connection        |
| `RATE_LIMIT_MAX`       | `20`                        | Bot requests per minute |
| `RATE_LIMIT_WINDOW_MS` | `60000`                     | Rate limit window       |

## Monitoring

```bash
# View all logs
docker compose logs -f

# View specific service
docker compose logs -f bot

# API health check
curl https://api.moenet.work/health

# Bot metrics
curl https://bot.moenet.work/metrics
```

## Backup & Restore

### PostgreSQL

```bash
# Backup
docker exec moenet-postgres pg_dump -U moenet moenet > backup.sql

# Restore
docker exec -i moenet-postgres psql -U moenet moenet < backup.sql
```

### Redis

```bash
# Backup (dump.rdb is auto-persisted)
docker cp moenet-redis:/data/dump.rdb ./redis-backup.rdb

# Restore
docker cp ./redis-backup.rdb moenet-redis:/data/dump.rdb
docker restart moenet-redis
```

## Updating

```bash
cd /opt/moenet-core
git pull origin main
docker compose up -d --build
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

## Troubleshooting

### Bot not receiving updates

```bash
# Check webhook status
curl https://api.telegram.org/bot<token>/getWebhookInfo

# Manually set webhook
curl -X POST "https://api.telegram.org/bot<token>/setWebhook?url=https://bot.moenet.work/bot<token>"
```

### Redis connection issues

```bash
# Check Redis health
docker exec moenet-redis redis-cli ping

# Check bot logs
docker logs moenet-bot | grep -i redis
```
