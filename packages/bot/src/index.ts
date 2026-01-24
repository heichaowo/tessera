import { Bot, Context, session, SessionFlavor, webhookCallback } from 'grammy';
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
    // Peer creation flow
    peerFlow?: {
        step: string;
        router?: string;
        endpoint?: string;
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

    // Session middleware
    bot.use(session({
        initial: (): SessionData => ({}),
    }));

    // Error handler
    bot.catch((err) => {
        console.error('[Bot] Error:', err);
    });

    // Register all commands
    registerCommands(bot);

    return bot;
}

/**
 * Set bot commands menu
 */
async function setBotCommands(bot: Bot<BotContext>) {
    await bot.api.setMyCommands([
        // Tools
        { command: 'ping', description: 'Ping IP / Domain' },
        { command: 'trace', description: 'Traceroute IP / Domain' },
        { command: 'whois', description: 'WHOIS lookup' },
        { command: 'dig', description: 'DNS lookup' },
        // User
        { command: 'login', description: 'Login with ASN' },
        { command: 'logout', description: 'Logout' },
        { command: 'whoami', description: 'Show current user' },
        // Peer
        { command: 'peer', description: 'Create a peer' },
        { command: 'modify', description: 'Modify peer' },
        { command: 'remove', description: 'Remove peer' },
        { command: 'info', description: 'Peer status' },
        // Stats
        { command: 'stats', description: 'Network stats' },
        { command: 'rank', description: 'Node ranking' },
        // Admin
        { command: 'pending', description: 'Pending approvals' },
        { command: 'nodes', description: 'List nodes' },
        { command: 'block', description: 'Manage blocklist' },
        // Help
        { command: 'help', description: 'Show help' },
    ]);
}

/**
 * Start with webhook mode
 */
async function startWebhook(bot: Bot<BotContext>) {
    const domain = config.webhookDomain;
    const secret = config.webhookSecret;
    const port = config.webhookPort || 8443;

    if (!domain) {
        console.error('❌ WEBHOOK_DOMAIN not configured for webhook mode');
        process.exit(1);
    }

    const webhookUrl = `https://${domain}/bot${config.telegramToken}`;

    // Create Hono app for webhook
    const app = new Hono();

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok' }));

    // Webhook endpoint
    const handleUpdate = webhookCallback(bot, 'hono', {
        secretToken: secret,
    });

    app.post(`/bot${config.telegramToken}`, handleUpdate);

    // Set webhook
    await bot.api.setWebhook(webhookUrl, {
        secret_token: secret,
        drop_pending_updates: true,
    });

    console.log(`🔗 Webhook set: ${webhookUrl}`);
    console.log(`🚀 Starting webhook server on port ${port}...`);

    // Start server
    Bun.serve({
        port,
        fetch: app.fetch,
    });

    console.log(`✅ Bot webhook server running on port ${port}`);
}

/**
 * Start with long-polling mode
 */
async function startPolling(bot: Bot<BotContext>) {
    // Delete webhook if exists
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    console.log('🤖 Starting long-polling...');
    bot.start();
    console.log('✅ Bot is running (polling mode)');
}

/**
 * Main entry point
 */
async function main() {
    if (!config.telegramToken) {
        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        process.exit(1);
    }

    const bot = createBot();

    // Set bot commands
    await setBotCommands(bot);

    const useWebhook = config.webhookEnabled;

    console.log(`🤖 MoeNet DN42 Bot`);
    console.log(`   Mode: ${useWebhook ? 'Webhook' : 'Polling'}`);

    if (useWebhook) {
        await startWebhook(bot);
    } else {
        await startPolling(bot);
    }
}

main();
