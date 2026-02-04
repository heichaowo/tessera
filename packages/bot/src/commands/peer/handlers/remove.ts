/**
 * Peer Remove Flow Handlers
 * 
 * Handles remove:select, remove:confirm, remove:cancel, and restart callbacks.
 */

import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../../../index';
import config from '../../../config';
import { apiRequest } from '../api';

/**
 * Register all remove flow callback handlers
 */
export function registerRemoveHandlers(bot: Bot<BotContext>) {
    /**
     * Handle remove selection
     */
    bot.callbackQuery(/^remove:select:(.+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        if (!uuid) return;

        await ctx.answerCallbackQuery();

        const keyboard = new InlineKeyboard()
            .text('✅ Confirm Delete 确认删除', `remove:confirm:${uuid}`)
            .text('❌ Cancel 取消', 'remove:cancel');

        await ctx.editMessageText(
            `⚠️ *Confirm Deletion*\n确认删除\n\n` +
            `Are you sure you want to remove this peer?\n` +
            `确定要删除此 Peer 吗?\n\n` +
            `Session: \`${uuid.slice(0, 8)}...\``,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    /**
     * Handle remove confirmation
     */
    bot.callbackQuery(/^remove:confirm:(.+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        if (!uuid) return;

        await ctx.answerCallbackQuery('Removing...');

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'delete',
                uuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed to remove: ${result.message}`);
                return;
            }

            await ctx.editMessageText('✅ Peer removed successfully!\n成功删除 Peer!');
        } catch (error) {
            console.error('[Remove] Error:', error);
            await ctx.editMessageText('❌ Failed to remove peer.');
        }
    });

    /**
     * Handle remove cancel
     */
    bot.callbackQuery('remove:cancel', async (ctx) => {
        await ctx.answerCallbackQuery('Cancelled');
        await ctx.editMessageText('🚫 Remove cancelled.\n已取消删除');
    });

    /**
     * Handle restart callback
     */
    bot.callbackQuery(/^restart:(\d+):([^:]+):(.+)$/, async (ctx) => {
        const asn = parseInt(ctx.match?.[1] || '0', 10);
        const router = ctx.match?.[2];
        const uuid = ctx.match?.[3];
        if (!asn || !router || !uuid) return;

        await ctx.answerCallbackQuery('Restarting...');
        await ctx.editMessageText('⏳ Restarting WireGuard and BGP...\n正在重启 WireGuard 和 BGP...');

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'restart',
                uuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Restart failed: ${result.message}`);
                return;
            }

            await ctx.reply(
                `✅ *Restart Complete*\n重启完成\n\n` +
                `📍 Node: \`${router}\`\n` +
                `🆔 ASN: \`AS${asn}\`\n\n` +
                `WireGuard and BGP have been restarted.\n` +
                `WireGuard 和 BGP 已重启。`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Restart] Error:', error);
            await ctx.reply('❌ Restart failed.');
        }
    });
}
