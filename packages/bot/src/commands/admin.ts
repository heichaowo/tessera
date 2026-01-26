import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
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
    return response.json() as Promise<ApiResponse>;
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
     * /pending - List pending peers with approve/reject buttons
     */
    bot.command('pending', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        await showPendingList(ctx);
    });

    // Handle admin:pending callback (from notification)
    bot.callbackQuery('admin:pending', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        await ctx.answerCallbackQuery();
        await showPendingList(ctx);
    });

    // Handle approve button
    bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        const uuid = ctx.match[1];

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'approveSession',
                uuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.answerCallbackQuery(`❌ ${result.message}`);
                return;
            }

            await ctx.answerCallbackQuery('✅ Approved!');

            // Refresh the list
            await showPendingList(ctx, ctx.callbackQuery.message?.message_id);
        } catch (error) {
            console.error('[Approve] Error:', error);
            await ctx.answerCallbackQuery('❌ Failed');
        }
    });

    // Handle reject button
    bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        const uuid = ctx.match[1];

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'rejectSession',
                uuid,
                reason: 'Rejected by admin',
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.answerCallbackQuery(`❌ ${result.message}`);
                return;
            }

            await ctx.answerCallbackQuery('✅ Rejected!');

            // Refresh the list
            await showPendingList(ctx, ctx.callbackQuery.message?.message_id);
        } catch (error) {
            console.error('[Reject] Error:', error);
            await ctx.answerCallbackQuery('❌ Failed');
        }
    });

    // Handle refresh button
    bot.callbackQuery('pending:refresh', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        await ctx.answerCallbackQuery('Refreshing...');
        await showPendingList(ctx, ctx.callbackQuery.message?.message_id);
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
            routers.forEach((r: RouterInfo) => {
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
     * /addpeer - Admin command to directly add peer (bypasses approval)
     * Usage: /addpeer <ASN> [node] [endpoint:port] [pubkey] [ipv6]
     * If only ASN provided, starts interactive wizard
     */
    bot.command('addpeer', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const args = ctx.match?.trim().split(/\s+/) || [];

        // No args - show help
        if (args.length === 0 || args[0] === '') {
            await ctx.reply(
                `🔧 *Admin Add Peer 管理员添加 Peer*\n\n` +
                `Usage 用法:\n` +
                `• \`/addpeer <ASN>\` - 交互式向导\n` +
                `• \`/addpeer <ASN> <node> <endpoint:port> <pubkey> <ipv6>\` - 一行命令\n\n` +
                `Example 示例:\n` +
                `\`/addpeer 4242420998\` - 启动向导\n` +
                `\`/addpeer 4242420998 hk-edge tunnel.example.com:51820 PUBKEY fd00::1\`\n\n` +
                `Note: Peer will be created with ACTIVE status (no approval needed)\n` +
                `注意: Peer 将以 ACTIVE 状态创建（无需审批）`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const asnStr = args[0] || '';
        const asn = parseInt(asnStr.replace(/^AS/i, ''), 10);

        if (isNaN(asn)) {
            await ctx.reply('❌ Invalid ASN format');
            return;
        }

        // Single arg (ASN only) - start interactive wizard
        if (args.length === 1) {
            await ctx.reply(
                `🔧 *Admin Add Peer Wizard*\n` +
                `为 AS${asn} 添加 Peer\n\n` +
                `Starting wizard...`,
                { parse_mode: 'Markdown' }
            );

            // Initialize peerFlow in admin mode
            ctx.session.peerFlow = {
                step: 'admin_select_node',
                isAdminMode: true,
                targetAsn: asn,
            };

            // Trigger node selection (same as /peer)
            await startNodeSelection(ctx, asn);
            return;
        }

        // Full command mode - at least 5 args needed
        if (args.length < 5) {
            await ctx.reply(
                `❌ Not enough arguments.\n\n` +
                `Use \`/addpeer ${asn}\` for interactive wizard, or provide all 5 args:\n` +
                `\`/addpeer <ASN> <node> <endpoint:port> <pubkey> <ipv6>\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        const node = args[1] || '';
        const endpointPort = args[2] || '';
        const pubkey = args[3] || '';
        const ipv6 = args[4] || '';
        const [endpoint, port] = endpointPort.split(':');

        if (!pubkey || pubkey.length !== 44) {
            await ctx.reply('❌ Invalid WireGuard public key (should be 44 chars base64)');
            return;
        }

        await ctx.reply(
            `⏳ Creating peer...\n正在创建 Peer...\n\n` +
            `ASN: \`AS${asn}\`\n` +
            `Node: \`${node}\`\n` +
            `Endpoint: \`${endpoint}:${port}\``,
            { parse_mode: 'Markdown' }
        );

        try {
            const result = await apiRequest('/session', 'POST', {
                action: 'adminCreate',
                asn,
                router: node,
                endpoint,
                port: parseInt(port || '51820', 10),
                publicKey: pubkey,
                ipv6,
                status: 1, // ACTIVE
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            await ctx.reply(
                `✅ *Peer Created 已创建*\n\n` +
                `ASN: \`AS${asn}\`\n` +
                `Node: \`${node}\`\n` +
                `Status: \`ACTIVE\` (免审核)`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[AddPeer] Error:', error);
            await ctx.reply(`❌ Failed to create peer: ${(error as Error).message}`);
        }
    });

    /**
     * Start node selection for admin wizard
     * Shares the same logic as /peer but marks as admin mode
     */
    async function startNodeSelection(ctx: BotContext, asn: number) {
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'enumRouters',
            }, config.apiToken);

            if (result.code !== 0 || !result.data?.routers) {
                await ctx.reply('❌ Failed to fetch nodes.');
                ctx.session.peerFlow = undefined;
                return;
            }

            const routers = result.data.routers.filter((r: RouterInfo) => r.isOpen);

            if (routers.length === 0) {
                await ctx.reply('❌ No available nodes.');
                ctx.session.peerFlow = undefined;
                return;
            }

            // Build keyboard
            const keyboard = new InlineKeyboard();
            const nodeMap: Record<string, { uuid: string; endpoint: string; pubkey: string; nodeId: number }> = {};

            routers.forEach((r, i) => {
                const label = r.name;
                keyboard.text(label, `peer:node:${label}`);
                if ((i + 1) % 2 === 0) keyboard.row();
                nodeMap[label] = {
                    uuid: r.uuid,
                    endpoint: r.endpoint || r.name,
                    pubkey: r.wgPubkey || 'N/A',
                    nodeId: r.nodeId || 0,
                };
            });

            ctx.session.peerFlow = {
                ...ctx.session.peerFlow!,
                step: 'select_node',
                nodeMap,
            };

            // Calculate port for this ASN
            let userPort: number;
            if (asn >= 4242420000 && asn <= 4242429999) {
                userPort = 30000 + (asn % 10000);
            } else if (asn >= 4201270000 && asn <= 4201279999) {
                userPort = 40000 + (asn % 10000);
            } else {
                userPort = 50000 + (asn % 10000);
            }

            await ctx.reply(
                `📡 *Select Node for AS${asn}*\n选择节点\n\n` +
                `Port will be: \`${userPort}\``,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } catch (error) {
            console.error('[AddPeer Wizard] Error:', error);
            await ctx.reply('❌ Failed to fetch nodes.');
            ctx.session.peerFlow = undefined;
        }
    }
}

/**
 * Show pending sessions list with inline buttons
 */
async function showPendingList(ctx: BotContext, editMessageId?: number) {
    try {
        const result = await apiRequest('/admin', 'POST', {
            action: 'enumSessions',
            status: 3, // PENDING_REVIEW
        }, config.apiToken);

        if (result.code !== 0) {
            const msg = `❌ Error: ${result.message}`;
            if (editMessageId) {
                await ctx.api.editMessageText(ctx.chat!.id, editMessageId, msg);
            } else {
                await ctx.reply(msg);
            }
            return;
        }

        const sessions = result.data?.sessions || [];

        if (sessions.length === 0) {
            const msg = '✅ No pending requests.\n没有待审批的请求。';
            if (editMessageId) {
                await ctx.api.editMessageText(ctx.chat!.id, editMessageId, msg);
            } else {
                await ctx.reply(msg);
            }
            return;
        }

        let message = `📋 *Pending (${sessions.length})*\n待审批请求\n\n`;

        const keyboard = new InlineKeyboard();

        sessions.forEach((s: SessionInfo, i: number) => {
            const endpoint = s.ipv4EndpointAddress || s.ipv6EndpointAddress || 'N/A';
            const shortId = s.uuid.slice(0, 8);

            message += `*${i + 1}. AS${s.asn}* → ${s.router}\n`;
            message += `   Endpoint: \`${endpoint}\`\n`;
            message += `   ID: \`${shortId}...\`\n\n`;

            // Add approve/reject buttons for each session
            keyboard
                .text(`✅ ${i + 1}`, `approve:${s.uuid}`)
                .text(`❌ ${i + 1}`, `reject:${s.uuid}`)
                .row();
        });

        // Add refresh button
        keyboard.text('🔄 Refresh', 'pending:refresh');

        if (editMessageId) {
            await ctx.api.editMessageText(ctx.chat!.id, editMessageId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
        } else {
            await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
        }
    } catch (error) {
        console.error('[Pending] Error:', error);
        const msg = '❌ Failed to fetch pending requests.';
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
        sessions?: SessionInfo[];
        routers?: RouterInfo[];
    };
}

interface SessionInfo {
    uuid: string;
    asn: number;
    router: string;
    ipv4EndpointAddress?: string;
    ipv6EndpointAddress?: string;
}

interface RouterInfo {
    uuid: string;
    name: string;
    location: string;
    sessionCount: number;
    isOpen: boolean;
    endpoint?: string;
    wgPubkey?: string;
    nodeId?: number;
}
