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

/**
 * Check if user is admin
 */
function isAdmin(ctx: BotContext): boolean {
    const username = ctx.from?.username?.toLowerCase();
    const adminUsername = config.adminUsername.toLowerCase().replace('@', '');
    return username === adminUsername || ctx.session.isAdmin === true;
}

export function registerAdminCommands(bot: Bot<BotContext>) {
    /**
     * /approve [uuid] - Approve pending peer
     */
    bot.command('approve', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const uuid = ctx.match?.trim();

        if (!uuid) {
            // List pending sessions
            try {
                const result = await apiRequest('/admin', 'POST', {
                    action: 'enumSessions',
                    status: 3, // PENDING_REVIEW
                }, config.apiToken);

                if (result.code !== 0) {
                    await ctx.reply(`❌ Error: ${result.message}`);
                    return;
                }

                const sessions = result.data?.sessions || [];

                if (sessions.length === 0) {
                    await ctx.reply('✅ No pending sessions.');
                    return;
                }

                let message = '📋 *Pending Sessions:*\n\n';
                sessions.forEach((s: { uuid: string; asn: number; router: string }) => {
                    message += `• AS${s.asn} → ${s.router}\n  \`${s.uuid}\`\n`;
                });
                message += '\nUse `/approve <uuid>` to approve.';

                await ctx.reply(message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('[Approve] Error:', error);
                await ctx.reply('❌ Failed to fetch pending sessions.');
            }
            return;
        }

        // Approve specific session
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'approveSession',
                uuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            await ctx.reply(`✅ Session approved: \`${uuid}\``, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Approve] Error:', error);
            await ctx.reply('❌ Failed to approve session.');
        }
    });

    /**
     * /nodes - List all nodes
     */
    bot.command('nodes', async (ctx) => {
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'enumRouters',
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const routers = result.data?.routers || [];

            if (routers.length === 0) {
                await ctx.reply('❌ No nodes found.');
                return;
            }

            let message = '🌐 *MoeNet Nodes:*\n\n';
            routers.forEach((r: { name: string; location: string; sessionCount: number; isOpen: boolean }) => {
                const status = r.isOpen ? '🟢' : '🔴';
                message += `${status} *${r.name}*\n   📍 ${r.location}\n   👥 ${r.sessionCount} peers\n\n`;
            });

            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Nodes] Error:', error);
            await ctx.reply('❌ Failed to fetch nodes.');
        }
    });

    /**
     * /reject [uuid] [reason] - Reject pending peer
     */
    bot.command('reject', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const args = ctx.match?.trim().split(/\s+/) || [];
        const uuid = args[0];
        const reason = args.slice(1).join(' ') || 'Rejected by admin';

        if (!uuid) {
            await ctx.reply('Usage: /reject <uuid> [reason]');
            return;
        }

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'rejectSession',
                uuid,
                reason,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            await ctx.reply(`✅ Session rejected: \`${uuid}\``, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Reject] Error:', error);
            await ctx.reply('❌ Failed to reject session.');
        }
    });
}
