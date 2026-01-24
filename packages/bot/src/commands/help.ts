import type { Bot } from 'grammy';
import type { BotContext } from '../index';

const HELP_MESSAGE = `
🌐 *MoeNet DN42 Auto-Peering Bot*

*User Commands:*
/login - Login with your ASN
/logout - Logout
/whoami - Show current user

*Peer Commands:*
/peer - Create a new peer
/modify - Modify existing peer
/remove - Remove peer
/info - Check peer status

*Network Tools:*
/ping <ip> - Ping IP/Domain
/trace <ip> - Traceroute
/whois <query> - WHOIS lookup
/dig <domain> - DNS lookup

*Admin Commands:*
/approve - Approve pending peer
/nodes - List all nodes

*Other:*
/help - Show this message
/cancel - Cancel current operation
`;

const WELCOME_MESSAGE = `
👋 Welcome to MoeNet DN42!

Use /login to authenticate with your ASN.
Use /help to see all available commands.

🔗 Website: https://dn42.moenet.work
`;

export function registerHelpCommand(bot: Bot<BotContext>) {
    bot.command('start', async (ctx) => {
        await ctx.reply(WELCOME_MESSAGE, { parse_mode: 'Markdown' });
    });

    bot.command('help', async (ctx) => {
        await ctx.reply(HELP_MESSAGE, { parse_mode: 'Markdown' });
    });

    bot.command('cancel', async (ctx) => {
        // Clear any ongoing flow
        ctx.session.peerFlow = undefined;
        await ctx.reply('❌ Operation cancelled.');
    });
}
