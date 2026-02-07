import { Bot, Context, session, type SessionFlavor, webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { registerCommands } from './commands';
import config from './config';
import { rateLimitMiddleware, metricsMiddleware, getMetricsSummary } from './middleware';
import { createRedisStorage } from './storage';

/**
 * Session data for user state
 */
interface SessionData {
    asn?: number;
    person?: string;
    isAdmin?: boolean;
    awaitingAsn?: boolean;
    peerFlow?: {
        step: string;
        isAdminMode?: boolean;
        targetAsn?: number;
        routerName?: string;
        sessionUuid?: string;
        serverEndpoint?: string;
        serverPort?: number;
        serverPubkey?: string;
        serverLla?: string;
        sessionType?: 'ipv6_only' | 'ipv6_ipv4';
        ipv6?: string;
        localIpv6?: string;
        ipv4?: string;
        localIpv4?: string;
        endpoint?: string;
        port?: number;
        publicKey?: string;
        mtu?: number;
        psk?: string | null;
        contact?: string;
        nodeMap?: Record<string, { uuid: string; endpoint: string; pubkey: string; nodeId: number; regionCode: number; name?: string }>;
        // For modify flow - diff tracking (dn42-bot style)
        asn?: number;
        // Pending migration (deferred until confirm)
        pendingMigration?: { nodeUuid: string; nodeName: string };
        backup?: {
            endpoint: string;
            port: string;
            ipv6: string;
            ipv4: string;
            localIpv6: string;
            localIpv4: string;
            pubkey: string;
            psk: boolean;
            mtu: number;
            mpbgp: boolean;
            extendedNexthop: boolean;
            contact: string;
        };
        current?: {
            endpoint: string;
            port: string;
            ipv6: string;
            ipv4: string;
            localIpv6: string;
            localIpv4: string;
            pubkey: string;
            psk: boolean;
            mtu: number;
            mpbgp: boolean;
            extendedNexthop: boolean;
            contact: string;
        };
    };
    nodeWizard?: {
        step: 'name' | 'hostname' | 'ipv4' | 'ipv6' | 'role' | 'region' | 'location' | 'provider' | 'bandwidth' | 'max_peers' | 'allow_cn' | 'confirm';
        data: Record<string, unknown>;
    };
}

export type BotContext = Context & SessionFlavor<SessionData>;

/**
 * Create and configure the Telegram bot
 */
export function createBot(): Bot<BotContext> {
    const bot = new Bot<BotContext>(config.telegramToken);

    // Session middleware - use Redis if available, else in-memory
    const redisStorage = createRedisStorage<SessionData>();
    bot.use(session({
        initial: (): SessionData => ({}),
        storage: redisStorage || undefined,
    }));

    // Rate limiting middleware
    bot.use(rateLimitMiddleware());

    // Metrics collection middleware
    bot.use(metricsMiddleware());

    // Error handler
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
        { command: 'start', description: 'Start / Help 开始' },
        { command: 'help', description: 'Show commands 帮助' },
        { command: 'login', description: 'Login with ASN 登录' },
        { command: 'logout', description: 'Logout 登出' },
        { command: 'peer', description: 'Create peer 建立连接' },
        { command: 'info', description: 'Peer status 连接状态' },
        { command: 'modify', description: 'Modify peer 修改连接' },
        { command: 'remove', description: 'Remove peer 删除连接' },
        { command: 'status', description: 'WG/BGP status 状态' },
        { command: 'restart', description: 'Restart peer 重启连接' },
        { command: 'ping', description: 'Ping test 网络测试' },
        { command: 'trace', description: 'Traceroute 路由追踪' },
        { command: 'whois', description: 'WHOIS lookup 信息查询' },
        { command: 'dig', description: 'DNS lookup DNS查询' },
        { command: 'cancel', description: 'Cancel operation 取消操作' },
    ]);
}

/**
 * Main entry point
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

    // Create Hono app for webhook and metrics
    const app = new Hono();

    // Health check endpoint
    app.get('/health', (c) => c.json({ status: 'ok' }));

    // Metrics endpoint
    app.get('/metrics', (c) => c.json(getMetricsSummary()));

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
    console.log(`📊 Metrics: http://localhost:${port}/metrics`);
    console.log(`🚀 Starting server on port ${port}...`);

    Bun.serve({
        port,
        fetch: app.fetch,
    });

    console.log(`✅ Bot running on port ${port}`);
}

main();
