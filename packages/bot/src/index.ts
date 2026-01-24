import { Bot, Context, session, SessionFlavor } from 'grammy';
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
 * Start the bot
 */
async function main() {
    if (!config.telegramToken) {
        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        process.exit(1);
    }

    const bot = createBot();

    // Set bot commands menu
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
        // Admin
        { command: 'approve', description: 'Approve pending peer' },
        { command: 'nodes', description: 'List nodes' },
        // Help
        { command: 'help', description: 'Show help' },
    ]);

    console.log('🤖 Starting MoeNet DN42 Bot...');

    // Start polling
    bot.start();

    console.log('✅ Bot is running');
}

main();
