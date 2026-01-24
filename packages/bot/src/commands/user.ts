import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

/**
 * API client for moenet-core
 */
async function apiRequest(endpoint: string, method = 'POST', body?: unknown) {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
}

export function registerUserCommands(bot: Bot<BotContext>) {
    /**
     * /login - Start authentication flow
     */
    bot.command('login', async (ctx) => {
        await ctx.reply(
            '🔐 *Login to MoeNet DN42*\n\n' +
            'Please enter your ASN (e.g., 4242421234):',
            { parse_mode: 'Markdown' }
        );

        // Set up conversation handler for ASN input
        bot.on('message:text', async (ctx) => {
            const text = ctx.message.text;

            // Check if it's an ASN
            if (/^\d+$/.test(text)) {
                const asn = Number(text);

                if (asn < 4242420000 || asn > 4242429999) {
                    await ctx.reply('❌ Invalid ASN. Must be in DN42 range (4242420000-4242429999)');
                    return;
                }

                try {
                    // Query auth methods from API
                    const result = await apiRequest('/auth', 'POST', {
                        action: 'query',
                        asn: text,
                    });

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Error: ${result.message}`);
                        return;
                    }

                    const { person, availableAuthMethods } = result.data;

                    if (!availableAuthMethods || availableAuthMethods.length === 0) {
                        await ctx.reply(
                            `❌ No authentication methods found for AS${asn}\n\n` +
                            'Please make sure your WHOIS object has:\n' +
                            '- pgp-fingerprint\n' +
                            '- or contact email'
                        );
                        return;
                    }

                    // Show available auth methods
                    let message = `👤 *${person}* (AS${asn})\n\n` +
                        'Available authentication methods:\n';

                    availableAuthMethods.forEach((m: { id: number; name: string; type: number }) => {
                        const icon = m.type === 1 ? '🔑' : m.type === 3 ? '📧' : '🔒';
                        message += `${icon} ${m.id}: ${m.name}\n`;
                    });

                    message += '\nReply with the method number to continue.';

                    await ctx.reply(message, { parse_mode: 'Markdown' });

                    // Store auth state in session
                    // Note: In production, store authState token from API
                } catch (error) {
                    console.error('[Login] Error:', error);
                    await ctx.reply('❌ Failed to query authentication methods');
                }
            }
        }, { once: true } as never);
    });

    /**
     * /logout - Clear session
     */
    bot.command('logout', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ You are not logged in.');
            return;
        }

        const asn = ctx.session.asn;
        ctx.session.asn = undefined;
        ctx.session.person = undefined;
        ctx.session.isAdmin = undefined;

        await ctx.reply(`👋 Logged out from AS${asn}`);
    });

    /**
     * /whoami - Show current user
     */
    bot.command('whoami', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ You are not logged in. Use /login to authenticate.');
            return;
        }

        const { asn, person, isAdmin } = ctx.session;
        const adminBadge = isAdmin ? ' 👑 Admin' : '';

        await ctx.reply(
            `👤 *Current User*\n\n` +
            `ASN: AS${asn}\n` +
            `Name: ${person}${adminBadge}`,
            { parse_mode: 'Markdown' }
        );
    });
}
