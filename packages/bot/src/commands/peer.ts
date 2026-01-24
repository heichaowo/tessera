import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

/**
 * API client for moenet-core
 */
async function apiRequest(endpoint: string, method = 'POST', body?: unknown, token?: string) {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
}

export function registerPeerCommands(bot: Bot<BotContext>) {
    /**
     * /peer - Start peer creation flow
     */
    bot.command('peer', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.');
            return;
        }

        // Fetch available nodes
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'enumRouters',
            }, config.apiToken);

            if (result.code !== 0 || !result.data?.routers) {
                await ctx.reply('❌ Failed to fetch nodes.');
                return;
            }

            const routers = result.data.routers.filter((r: { isOpen: boolean }) => r.isOpen);

            if (routers.length === 0) {
                await ctx.reply('❌ No available nodes for peering.');
                return;
            }

            // Show node selection
            let message = '🌐 *Select a node to peer with:*\n\n';
            routers.forEach((r: { name: string; location: string; uuid: string }, i: number) => {
                message += `${i + 1}. *${r.name}* - ${r.location}\n`;
            });
            message += '\nReply with the node number.';

            // Store routers in session for later reference
            ctx.session.peerFlow = {
                step: 'select_node',
            };

            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Peer] Error:', error);
            await ctx.reply('❌ Failed to fetch nodes.');
        }
    });

    /**
     * /info - Show peer info
     */
    bot.command('info', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.');
            return;
        }

        try {
            // TODO: Get user's JWT token and fetch sessions
            await ctx.reply(
                `📊 *Peer Info for AS${ctx.session.asn}*\n\n` +
                'Use /login to authenticate and view your peers.',
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Info] Error:', error);
            await ctx.reply('❌ Failed to fetch peer info.');
        }
    });

    /**
     * /modify - Modify existing peer
     */
    bot.command('modify', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.');
            return;
        }

        await ctx.reply(
            '🔧 *Modify Peer*\n\n' +
            'This feature is under development.\n' +
            'Please use /info to view your current peers.',
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /remove - Remove peer
     */
    bot.command('remove', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.');
            return;
        }

        await ctx.reply(
            '🗑️ *Remove Peer*\n\n' +
            'This feature is under development.\n' +
            'Please contact an admin to remove peers.',
            { parse_mode: 'Markdown' }
        );
    });
}
