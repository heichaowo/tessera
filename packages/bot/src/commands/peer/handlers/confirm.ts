/**
 * Peer Confirmation Flow Handlers
 * 
 * Handles peer:confirm and peer:cancel callbacks.
 */

import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../../../index';
import config from '../../../config';
import { apiRequest } from '../api';

/**
 * Register confirmation flow callback handlers
 */
export function registerConfirmHandlers(bot: Bot<BotContext>) {
    /**
     * Handle confirm callback
     */
    bot.callbackQuery('peer:confirm', async (ctx) => {
        const flow = ctx.session.peerFlow;
        const asn = flow?.isAdminMode ? flow.targetAsn : ctx.session.asn;
        if (!flow || !asn) return;

        await ctx.answerCallbackQuery('Creating peer...');
        await ctx.editMessageText('⏳ Creating peer...\n正在创建 Peer...');

        try {
            const action = 'createSession';
            const result = await apiRequest('/admin', 'POST', {
                action,
                asn,
                router: flow.routerUuid,
                ipv6: flow.ipv6,
                endpoint: flow.endpoint && flow.port ? `${flow.endpoint}:${flow.port}` : undefined,
                publicKey: flow.publicKey,
                mtu: flow.mtu || 1420,
                psk: flow.psk,
                status: flow.isAdminMode ? 1 : undefined,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Failed to create peer: ${result.message}`);
                ctx.session.peerFlow = undefined;
                return;
            }

            const statusText = flow.isAdminMode
                ? `✅ Status: ACTIVE (免审核)`
                : `⏳ Status: Pending Review\n等待管理员审核`;

            const successText =
                `🎉 *Peer Created Successfully!*\n成功创建 Peer!\n\n` +
                `📍 Node: \`${flow.routerName}\`\n` +
                `🆔 ASN: \`AS${asn}\`\n\n` +
                `*Your WireGuard Config:*\n` +
                `\`\`\`\n` +
                `[Peer]\n` +
                `PublicKey = ${flow.serverPubkey}\n` +
                `Endpoint = ${flow.serverEndpoint}:${flow.serverPort}\n` +
                `AllowedIPs = 172.20.0.0/14, 172.31.0.0/16, fd00::/8, fe80::/64\n` +
                `\`\`\`\n\n` +
                statusText;

            await ctx.reply(successText, { parse_mode: 'Markdown' });

            // Notify admin if not in admin mode
            if (!flow.isAdminMode && config.adminChatId) {
                try {
                    const adminNotification =
                        `🔔 *New Peer Request*\n新的 Peer 申请\n\n` +
                        `🆔 ASN: \`AS${asn}\`\n` +
                        `📍 Node: \`${flow.routerName}\`\n` +
                        `🌐 IPv6: \`${flow.ipv6}\`\n` +
                        `📡 Endpoint: ${flow.endpoint ? `\`${flow.endpoint}:${flow.port}\`` : 'NAT'}\n\n` +
                        `Use /pending to review`;

                    await ctx.api.sendMessage(config.adminChatId, adminNotification, {
                        parse_mode: 'Markdown',
                        reply_markup: new InlineKeyboard()
                            .text('📋 View Pending', 'admin:pending')
                    });
                } catch (e) {
                    console.error('[Notify Admin] Error:', e);
                }
            }

            ctx.session.peerFlow = undefined;
        } catch (error) {
            console.error('[Peer] Create error:', error);
            await ctx.reply('❌ Failed to create peer.');
            ctx.session.peerFlow = undefined;
        }
    });

    /**
     * Handle cancel callback
     */
    bot.callbackQuery('peer:cancel', async (ctx) => {
        ctx.session.peerFlow = undefined;
        await ctx.answerCallbackQuery('Cancelled');
        await ctx.editMessageText('🚫 Peer creation cancelled.\n已取消 Peer 创建');
    });
}
