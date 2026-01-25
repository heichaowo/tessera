import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

/**
 * API client
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
    return response.json() as Promise<ApiResponse>;
}

function isAdmin(ctx: BotContext): boolean {
    const username = ctx.from?.username?.toLowerCase();
    const adminUsername = config.adminUsername.toLowerCase().replace('@', '');
    return username === adminUsername || ctx.session.isAdmin === true;
}

export function registerBlockCommands(bot: Bot<BotContext>) {
    /**
     * /block [asn] - Manage blacklist
     */
    bot.command('block', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const asn = ctx.match?.trim();

        if (!asn) {
            // Show blocklist
            await showBlocklist(ctx);
            return;
        }

        // Block new ASN
        const asnNumber = parseInt(asn.replace(/^AS/i, ''), 10);
        if (isNaN(asnNumber)) {
            await ctx.reply('❌ Invalid ASN format.');
            return;
        }

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'blockAsn',
                asn: asnNumber,
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            await ctx.reply(
                `🚫 *AS${asnNumber} Blocked*\nASN 已加入黑名单`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Block] Error:', error);
            await ctx.reply('❌ Failed to block ASN.');
        }
    });

    // Handle unblock button
    bot.callbackQuery(/^unblock:(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr, 10);

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'unblockAsn',
                asn,
            });

            if (result.code !== 0) {
                await ctx.answerCallbackQuery(`❌ ${result.message}`);
                return;
            }

            await ctx.answerCallbackQuery(`✅ AS${asn} Unblocked`);

            // Refresh list
            await showBlocklist(ctx, ctx.callbackQuery.message?.message_id);
        } catch (error) {
            console.error('[Unblock] Error:', error);
            await ctx.answerCallbackQuery('❌ Failed');
        }
    });

    // Handle refresh button
    bot.callbackQuery('blocklist:refresh', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        await ctx.answerCallbackQuery('Refreshing...');
        await showBlocklist(ctx, ctx.callbackQuery.message?.message_id);
    });
}

/**
 * Show blocklist with unblock buttons
 */
async function showBlocklist(ctx: BotContext, editMessageId?: number) {
    try {
        const result = await apiRequest('/admin', 'POST', {
            action: 'enumBlocklist',
        });

        if (result.code !== 0) {
            const msg = `❌ Error: ${result.message}`;
            if (editMessageId) {
                await ctx.api.editMessageText(ctx.chat!.id, editMessageId, msg);
            } else {
                await ctx.reply(msg);
            }
            return;
        }

        const blocklist = result.data?.blocklist || [];

        if (blocklist.length === 0) {
            const msg = '✅ Blocklist is empty.\n黑名单为空';
            if (editMessageId) {
                await ctx.api.editMessageText(ctx.chat!.id, editMessageId, msg);
            } else {
                await ctx.reply(msg);
            }
            return;
        }

        let message = `🚫 *Blocklist (${blocklist.length})*\n黑名单\n\n`;

        const keyboard = new InlineKeyboard();

        blocklist.forEach((b: BlockedAsn, i: number) => {
            const reason = b.reason ? ` - ${b.reason}` : '';
            message += `${i + 1}. AS${b.asn}${reason}\n`;

            keyboard.text(`🔓 ${i + 1}`, `unblock:${b.asn}`);
            if ((i + 1) % 4 === 0) keyboard.row();
        });

        keyboard.row().text('🔄 Refresh', 'blocklist:refresh');

        message += '\n_Click 🔓 to unblock_';

        if (editMessageId) {
            await ctx.api.editMessageText(ctx.chat!.id, editMessageId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
        } else {
            await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
        }
    } catch (error) {
        console.error('[Blocklist] Error:', error);
        const msg = '❌ Failed to fetch blocklist.';
        if (editMessageId) {
            await ctx.api.editMessageText(ctx.chat!.id, editMessageId, msg);
        } else {
            await ctx.reply(msg);
        }
    }
}

// Type definitions
interface ApiResponse {
    code: number;
    message: string;
    data?: {
        blocklist?: BlockedAsn[];
    };
}

interface BlockedAsn {
    asn: number;
    reason?: string;
    blockedAt?: string;
}
