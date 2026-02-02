---
title: Bot Development Guide
description: Guide for developing and extending the MoeNet Telegram Bot
---

# Bot Development Guide

## Overview

The MoeNet DN42 Bot is built with [grammY](https://grammy.dev/) and runs on Bun.

## Project Structure

```text
packages/bot/src/
├── index.ts          # Entry point, webhook setup
├── config.ts         # Environment configuration
├── middleware.ts     # Rate limiting, metrics
├── storage.ts        # Redis session adapter
├── i18n.ts           # Localization (EN/ZH)
├── commands/
│   ├── index.ts      # Command registration
│   ├── help.ts       # /start, /help, /cancel
│   ├── user.ts       # /login, /logout, /whoami
│   ├── peer.ts       # /peer, /info, /modify, /remove, /status, /restart
│   ├── tools.ts      # /ping, /trace, /whois, /dig, /route, /findnoc
│   ├── admin.ts      # /addpeer, /pending, /nodes
│   ├── block.ts      # /block
│   ├── maintenance.ts # /main
│   ├── community.ts  # /community, /latency
│   └── stats.ts      # /stats, /rank
└── providers/
    └── nodes.ts      # Agent endpoint provider
```

## Development

### Local Development

```bash
cd packages/bot
bun run dev
```

**Note**: Local development requires a public webhook URL. Use [ngrok](https://ngrok.com/) or similar:

```bash
ngrok http 8443
# Update WEBHOOK_DOMAIN in .env
```

### Build

```bash
bun run build
# Output: dist/index.js
```

## Session Data

Session is stored per-user and persists login state and peer creation wizard data:

```typescript
interface SessionData {
    asn?: number;           // Logged in ASN
    person?: string;        // MNT identifier
    isAdmin?: boolean;
    peerFlow?: {
        step: string;       // Current wizard step
        routerUuid?: string;
        serverEndpoint?: string;
        // ... wizard fields
    };
}
```

## Adding a New Command

1. Create handler in `commands/`:

```typescript
// commands/mycommand.ts
import type { Bot } from 'grammy';
import type { BotContext } from '../index';

export function registerMyCommand(bot: Bot<BotContext>) {
    bot.command('mycommand', async (ctx) => {
        await ctx.reply('Hello!');
    });
}
```

1. Register in `commands/index.ts`:

```typescript
import { registerMyCommand } from './mycommand';

export function registerCommands(bot: Bot<BotContext>) {
    // ... existing
    registerMyCommand(bot);
}
```

1. Add to command menu in `index.ts`:

```typescript
await bot.api.setMyCommands([
    // ... existing
    { command: 'mycommand', description: 'My command 我的命令' },
]);
```

## Middleware

### Rate Limiting

```typescript
import { rateLimitMiddleware } from './middleware';

bot.use(rateLimitMiddleware());
```

Configurable via:

- `RATE_LIMIT_MAX` (default: 20)
- `RATE_LIMIT_WINDOW_MS` (default: 60000)

### Metrics

```typescript
import { metricsMiddleware, getMetricsSummary } from './middleware';

bot.use(metricsMiddleware());

// Expose via HTTP
app.get('/metrics', (c) => c.json(getMetricsSummary()));
```

## Localization (i18n)

Use bilingual messages from `i18n.ts`:

```typescript
import { MSG, bi, t, getLocale } from '../i18n';

// Show both languages
await ctx.reply(bi(MSG.NOT_LOGGED_IN));

// Show based on user language
const locale = getLocale(ctx.from?.language_code);
await ctx.reply(t(MSG.LOGIN_SUCCESS, locale));
```

## Redis Session

Sessions are stored in Redis when `REDIS_URL` is configured:

- Key format: `bot:session:{userId}`
- TTL: 7 days
- Fallback: In-memory (lost on restart)

## API Integration

The bot communicates with the API service:

```typescript
import config from '../config';

const response = await fetch(`${config.apiUrl}/session`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiToken}`,
    },
    body: JSON.stringify({ action: 'create', ... }),
});
```

## Admin Notifications

Peer creation triggers admin notification:

```typescript
if (config.adminChatId) {
    await ctx.api.sendMessage(config.adminChatId, notification);
}
```

## Error Handling

Global error handler in `index.ts`:

```typescript
bot.catch((err) => {
    console.error('[Bot] Error:', err);
});
```

## Deployment

The bot runs as a Docker container with webhook mode:

```yaml
bot:
  build:
    context: .
    dockerfile: packages/bot/Dockerfile
  environment:
    - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
    - WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN}
    - REDIS_URL=redis://moenet-redis:6379
  depends_on:
    - redis
    - api
```
