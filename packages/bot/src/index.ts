import { Bot, Context, session, type SessionFlavor, webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { registerCommands } from './commands';
import config from './config';

/**
 * Session data for user state
 */
interface SessionData {
    asn?: number;
    person?: string;
    isAdmin?: boolean;
    peerFlow?: {
        step: string;
        router?: string;
        endpoint?: string;
        port?: string;
        publicKey?: string;
        ipv4?: string;
        ipv6?: string;
    };
}

export type BotContext = Context & SessionFlavor<SessionData>;

/**
 * Create and configure the Telegram bot
 */
export function createBot(): Bot<BotContext> {
    const bot = new Bot<BotContext>(config.telegramToken);

    bot.use(session({
        initial: (): SessionData => ({}),
    }));

    bot.catch((err) => {
        console.error('[Bot] Error:', err);
    });

    registerCommands(bot);
    return bot;
}

/**
 * Set bot commands menu
 */
async function setBotCommands(bot: Bot<BotContext>) {
    await bot.api.setMyCommands([
        { command: 'ping', description: 'Ping IP / Domain' },
        { command: 'trace', description: 'Traceroute IP / Domain' },
        { command: 'whois', description: 'WHOIS lookup' },
        { command: 'dig', description: 'DNS lookup' },
        { command: 'login', description: 'Login with ASN' },
        { command: 'logout', description: 'Logout' },
        { command: 'whoami', description: 'Show current user' },
        { command: 'peer', description: 'Create a peer' },
        { command: 'modify', description: 'Modify peer' },
        { command: 'remove', description: 'Remove peer' },
        { command: 'info', description: 'Peer status' },
        { command: 'stats', description: 'Network stats' },
        { command: 'rank', description: 'Node ranking' },
        { command: 'main', description: 'Maintenance Control 维护控制' },
        { command: 'pending', description: 'Pending approvals' },
        { command: 'nodes', description: 'List nodes' },
        { command: 'block', description: 'Manage blocklist' },
        { command: 'help', description: 'Show help' },
    ]);
}

/**
 * Main entry point - Webhook only
 */
async function main() {
    if (!config.telegramToken) {
        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        process.exit(1);
    }

    if (!config.webhookDomain) {
        console.error('❌ WEBHOOK_DOMAIN not configured');
        process.exit(1);
    }

    const bot = createBot();
    await setBotCommands(bot);

    const port = config.webhookPort;
    const webhookUrl = `https://${config.webhookDomain}/bot${config.telegramToken}`;

    // Create Hono app for webhook
    const app = new Hono();

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok' }));

    // Webhook endpoint
    const handleUpdate = webhookCallback(bot, 'hono', {
        secretToken: config.webhookSecret,
    });
    app.post(`/bot${config.telegramToken}`, handleUpdate);

    // Set webhook
    await bot.api.setWebhook(webhookUrl, {
        secret_token: config.webhookSecret,
        drop_pending_updates: true,
    });

    console.log(`🤖 MoeNet DN42 Bot (Webhook)`);
    console.log(`🔗 Webhook: ${webhookUrl}`);
    console.log(`🚀 Starting server on port ${port}...`);

    Bun.serve({
        port,
        fetch: app.fetch,
    });

    console.log(`✅ Bot running on port ${port}`);
}

main();
