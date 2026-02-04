/**
 * Peer UI Components
 * 
 * Reusable UI prompt functions for peer creation and modification flows.
 */

import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../../index';

/**
 * Show server WireGuard info with copy buttons
 */
export async function showServerWgInfo(ctx: BotContext): Promise<void> {
    const flow = ctx.session.peerFlow;
    if (!flow) return;

    const infoText =
        `🔧 *Server WireGuard Info*\n服务器 WireGuard 信息\n\n` +
        `📍 Node: \`${flow.routerName}\`\n` +
        `🌐 Endpoint: \`${flow.serverEndpoint}:${flow.serverPort}\`\n` +
        `🔑 PublicKey: \`${flow.serverPubkey}\`\n` +
        `📶 LLA: \`${flow.serverLla}\`\n\n` +
        `请使用以上信息配置你的 WireGuard\n` +
        `Use above info to configure your WireGuard`;

    const keyboard = new InlineKeyboard()
        .text('Continue ➡️ 继续', 'peer:select_session_type');

    await ctx.reply(infoText, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Prompt for endpoint input
 */
export async function promptEndpoint(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard().text('None (NAT)', 'peer:endpoint:none');

    await ctx.reply(
        `📝 *Step 2: WireGuard Endpoint*\n第二步: WireGuard 端点\n\n` +
        `Input your clearnet address for WireGuard tunnel.\n` +
        `请输入你的公网地址用于 WireGuard 隧道。\n\n` +
        `You can use IPv4 or IPv6. Include port if needed.\n` +
        `可使用 IPv4 或 IPv6，可包含端口如 \`example.com:51820\`\n\n` +
        `If behind NAT with no public IP, click "None".\n` +
        `如果在 NAT 后无公网 IP，点击 "None"。`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
    );
}

/**
 * Prompt for public key input
 */
export async function promptPubkey(ctx: BotContext): Promise<void> {
    await ctx.reply(
        `📝 *Step 3: WireGuard Public Key*\n第三步: WireGuard 公钥\n\n` +
        `Input your WireGuard public key.\n` +
        `请输入你的 WireGuard 公钥。\n\n` +
        `Format: 44 characters, ends with \`=\`\n` +
        `格式: 44个字符，以 \`=\` 结尾`,
        { parse_mode: 'Markdown' }
    );
}

/**
 * Prompt for MTU selection
 */
export async function promptMtu(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('1420 (默认)', 'peer:mtu:1420')
        .text('1400', 'peer:mtu:1400')
        .row()
        .text('1380', 'peer:mtu:1380')
        .text('1280', 'peer:mtu:1280');

    await ctx.reply(
        `📝 *Step 4: MTU Setting*\n第四步: MTU 设置\n\n` +
        `Select WireGuard MTU:\n选择 WireGuard MTU:\n\n` +
        `• \`1420\` - 默认 / Default\n` +
        `• \`1400\` - 适用于某些 VPS\n` +
        `• \`1380\` - 有额外封装时\n` +
        `• \`1280\` - IPv6 最小值`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
    );
}

/**
 * Prompt for PSK option
 */
export async function promptPsk(ctx: BotContext): Promise<void> {
    const keyboard = new InlineKeyboard()
        .text('🔄 Auto Generate 自动生成', 'peer:psk:auto')
        .row()
        .text('❌ No PSK 不使用', 'peer:psk:none');

    await ctx.reply(
        `📝 *Step 5: Pre-Shared Key (PSK)*\n第五步: 预共享密钥\n\n` +
        `Use PSK for extra security?\n使用 PSK 增加安全性?\n\n` +
        `• 🔄 Auto Generate - 自动生成 PSK\n` +
        `• ❌ No PSK - 不使用 PSK`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
    );
}

/**
 * Show confirmation screen
 */
export async function showConfirmation(ctx: BotContext): Promise<void> {
    const flow = ctx.session.peerFlow;
    const asn = ctx.session.asn;
    if (!flow || !asn) return;

    const endpointDisplay = flow.endpoint && flow.port
        ? `\`${flow.endpoint}:${flow.port}\``
        : flow.endpoint
            ? `\`${flow.endpoint}\``
            : 'None (NAT)';

    const pskDisplay = flow.psk ? '✅ Enabled' : '❌ Disabled';

    const confirmText =
        `✅ *Confirm Peer Creation*\n确认创建 Peer\n\n` +
        `📍 Node: \`${flow.routerName}\`\n` +
        `🆔 ASN: \`AS${asn}\`\n` +
        `🌐 Your IPv6: \`${flow.ipv6}\`\n` +
        `📡 Your Endpoint: ${endpointDisplay}\n` +
        `🔑 Your PublicKey: \`${flow.publicKey?.slice(0, 20)}...\`\n` +
        `📏 MTU: \`${flow.mtu || 1420}\`\n` +
        `🔐 PSK: ${pskDisplay}\n\n` +
        `*Server Info:*\n` +
        `🌐 Endpoint: \`${flow.serverEndpoint}:${flow.serverPort}\`\n` +
        `🔑 PublicKey: \`${flow.serverPubkey}\`\n` +
        `📶 LLA: \`${flow.serverLla}\``;

    const keyboard = new InlineKeyboard()
        .text('✅ Confirm 确认', 'peer:confirm')
        .text('❌ Cancel 取消', 'peer:cancel');

    await ctx.reply(confirmText, { parse_mode: 'Markdown', reply_markup: keyboard });
}
