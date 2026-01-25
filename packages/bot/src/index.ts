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
        { command: 'ping', description: 'Ping IP/Domain 网络测试' },
        { command: 'tcping', description: 'TCP Ping 端口测试' },
        { command: 'trace', description: 'Traceroute 路由追踪' },
        { command: 'whois', description: 'WHOIS lookup 信息查询' },
        { command: 'dig', description: 'DNS lookup DNS查询' },
        { command: 'findnoc', description: 'Find NOC contact 查找联系人' },
        { command: 'login', description: 'Login with ASN 登录' },
        { command: 'logout', description: 'Logout 登出' },
        { command: 'whoami', description: 'Show current user 当前用户' },
        { command: 'peer', description: 'Create a peer 建立连接' },
        { command: 'modify', description: 'Modify peer 修改连接' },
        { command: 'remove', description: 'Remove peer 删除连接' },
        { command: 'restart', description: 'Restart peer 重启连接' },
        { command: 'info', description: 'Peer status 连接状态' },
        { command: 'peerlist', description: 'Peer list 连接列表' },
        { command: 'stats', description: 'Network stats 网络统计' },
        { command: 'rank', description: 'Node ranking 节点排行' },
        { command: 'main', description: 'Maintenance 维护模式' },
        { command: 'pending', description: 'Pending approvals 待审批' },
        { command: 'nodes', description: 'List nodes 节点列表' },
        { command: 'block', description: 'Blocklist 黑名单' },
        { command: 'help', description: 'Help 帮助' },
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
