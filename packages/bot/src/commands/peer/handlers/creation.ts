/**
 * Peer Creation Flow Handlers
 * 
 * Handles all callbacks for the peer creation wizard flow.
 */

import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../../../index';
import { calculatePort } from '../validators';
import {
    showServerWgInfo,
    promptEndpoint,
    promptPubkey,
    promptPsk,
    showConfirmation,
} from '../ui';

/**
 * Register all creation flow callback handlers
 */
export function registerCreationHandlers(bot: Bot<BotContext>) {
    /**
     * Handle node selection
     */
    bot.callbackQuery(/^peer:node:(.+)$/, async (ctx) => {
        const selectedLabel = ctx.match?.[1];
        if (!selectedLabel || !ctx.session.peerFlow?.nodeMap) return;

        const nodeInfo = ctx.session.peerFlow.nodeMap[selectedLabel];
        if (!nodeInfo) {
            await ctx.answerCallbackQuery('❌ Invalid node');
            return;
        }

        const asn = ctx.session.asn || 0;
        const userPort = calculatePort(asn);

        ctx.session.peerFlow = {
            ...ctx.session.peerFlow,
            step: 'show_wg_info',
            routerName: selectedLabel.split(' (')[0],
            routerUuid: nodeInfo.uuid,
            serverEndpoint: nodeInfo.endpoint,
            serverPort: userPort,
            serverPubkey: nodeInfo.pubkey,
            serverLla: `fe80::998:${nodeInfo.regionCode}:${nodeInfo.nodeId}:1`,
        };

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ Selected: ${selectedLabel}`);
        await showServerWgInfo(ctx);
    });

    /**
     * Session Type Selection
     */
    bot.callbackQuery('peer:select_session_type', async (ctx) => {
        if (!ctx.session.peerFlow) return;

        await ctx.answerCallbackQuery();

        const keyboard = new InlineKeyboard()
            .text('MP-BGP + ENH (推荐)', 'peer:session:enh')
            .row()
            .text('ULA/GUA 模式', 'peer:session:ula');

        await ctx.reply(
            `📡 *Session Type 会话类型*\n\n` +
            `**MP-BGP + ENH (推荐)**\n` +
            `Uses Link-Local addresses only. No extra IPs needed.\n` +
            `仅使用 Link-Local 地址，无需额外 IP。\n\n` +
            `**ULA/GUA Mode**\n` +
            `Uses your ULA/GUA addresses. You must provide ALL IPs from YOUR pool.\n` +
            `使用你的 ULA/GUA 地址。所有 IP 都必须从你的 IP 池分配。\n\n` +
            `⚠️ We will verify IP ownership in DN42 registry.\n` +
            `⚠️ 我们将在 DN42 注册表验证 IP 所有权。`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    /**
     * Handle ENH mode selection
     */
    bot.callbackQuery('peer:session:enh', async (ctx) => {
        if (!ctx.session.peerFlow) return;

        ctx.session.peerFlow.step = 'input_ipv6';
        ctx.session.peerFlow.sessionType = 'ipv6_only';

        const asn = ctx.session.asn || 0;
        const suggested = `fe80::${asn % 10000}`;

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ Session Type: *MP-BGP + ENH*`, { parse_mode: 'Markdown' });

        const keyboard = new InlineKeyboard().text(suggested, `peer:ipv6:${suggested}`);

        await ctx.reply(
            `📝 *Peer IPv6 Address 对方 IPv6 地址*\n\n` +
            `Enter your Link-Local IPv6 address for BGP peering.\n` +
            `请输入你用于 BGP 对等的 Link-Local IPv6 地址。\n\n` +
            `Suggested 建议: \`${suggested}\`\n` +
            `You can also enter a custom Link-Local address.\n` +
            `你也可以输入其他 Link-Local 地址。`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    /**
     * Handle ULA mode selection
     */
    bot.callbackQuery('peer:session:ula', async (ctx) => {
        if (!ctx.session.peerFlow) return;

        ctx.session.peerFlow.step = 'input_peer_ipv6_ula';
        ctx.session.peerFlow.sessionType = 'ipv6_ipv4';

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ Session Type: *ULA/GUA Mode*`, { parse_mode: 'Markdown' });

        await ctx.reply(
            `📝 *Peer IPv6 Address 对方 IPv6 地址*\n\n` +
            `Enter your ULA/GUA IPv6 address (from YOUR IP pool).\n` +
            `请输入你的 ULA/GUA IPv6 地址（从你的 IP 池分配）。\n\n` +
            `⚠️ Must be registered in DN42 under your ASN.\n` +
            `⚠️ 必须在 DN42 注册表中属于你的 ASN。`,
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * Legacy continue to IPv6 input
     */
    bot.callbackQuery('peer:continue_to_ipv6', async (ctx) => {
        if (!ctx.session.peerFlow) return;

        ctx.session.peerFlow.step = 'input_ipv6';

        const asn = ctx.session.asn || 0;
        const suggested = asn >= 4242420000 && asn <= 4242429999 ? `fe80::${asn % 10000}` : '';

        await ctx.answerCallbackQuery();

        const keyboard = suggested ? new InlineKeyboard().text(suggested, `peer:ipv6:${suggested}`) : undefined;

        await ctx.reply(
            `📝 *Step 1: IPv6 Address*\n第一步: IPv6 地址\n\n` +
            `Input your IPv6 address for BGP peering.\n` +
            `请输入你用于 BGP 对等的 IPv6 地址。\n\n` +
            `Supported types 支持的类型:\n` +
            `• \`fe80::/64\` Link-Local\n` +
            `• \`fc00::/7\` ULA`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    /**
     * Handle IPv6 quick select
     */
    bot.callbackQuery(/^peer:ipv6:(.+)$/, async (ctx) => {
        const ipv6 = ctx.match?.[1];
        if (!ipv6 || !ctx.session.peerFlow) return;

        ctx.session.peerFlow.ipv6 = ipv6;
        ctx.session.peerFlow.step = 'input_endpoint';

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ IPv6: \`${ipv6}\``, { parse_mode: 'Markdown' });
        await promptEndpoint(ctx);
    });

    /**
     * Handle None endpoint
     */
    bot.callbackQuery('peer:endpoint:none', async (ctx) => {
        if (!ctx.session.peerFlow) return;

        ctx.session.peerFlow.endpoint = undefined;
        ctx.session.peerFlow.port = undefined;
        ctx.session.peerFlow.step = 'input_pubkey';

        await ctx.answerCallbackQuery();
        await ctx.editMessageText('✅ Endpoint: None (NAT)');
        await promptPubkey(ctx);
    });

    /**
     * Handle MTU selection callback
     */
    bot.callbackQuery(/^peer:mtu:(\d+)$/, async (ctx) => {
        const mtu = parseInt(ctx.match?.[1] || '1420', 10);
        if (!ctx.session.peerFlow) return;

        ctx.session.peerFlow.mtu = mtu;
        ctx.session.peerFlow.step = 'input_psk';

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ MTU: ${mtu}`);
        await promptPsk(ctx);
    });

    /**
     * Handle PSK selection callback
     */
    bot.callbackQuery(/^peer:psk:(auto|none)$/, async (ctx) => {
        const choice = ctx.match?.[1];
        if (!ctx.session.peerFlow) return;

        if (choice === 'auto') {
            const psk = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
            ctx.session.peerFlow.psk = psk;
            await ctx.answerCallbackQuery();
            await ctx.editMessageText(`✅ PSK Generated`);
            await ctx.reply(
                `🔑 *PSK Generated*\n已生成 PSK\n\n` +
                `\`${psk}\`\n\n` +
                `⚠️ Save this key! You need to configure it on your side.\n` +
                `请保存此密钥，稍后需要在你这边配置。`,
                { parse_mode: 'Markdown' }
            );
        } else {
            ctx.session.peerFlow.psk = null;
            await ctx.answerCallbackQuery();
            await ctx.editMessageText('✅ No PSK');
        }

        ctx.session.peerFlow.step = 'confirm';
        await showConfirmation(ctx);
    });
}
