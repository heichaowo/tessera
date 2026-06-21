import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import { calculatePort, normalizeAsn, isAsnInput } from './peer/validators';

/**
 * Escape Telegram Markdown v1 special characters in user-supplied text.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/([*_`\[])/g, '\\$1');
}

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
     * /sessions [status] - List BGP sessions with optional status filter
     */
    bot.command('sessions', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const statusArg = ctx.match?.trim().toLowerCase() || '';

        // Status name → code mapping
        const statusMap: Record<string, number> = {
            disabled: 1, active: 2, enabled: 2,
            pending: 3, review: 3,
            queued: 4, setup: 4,
            delete: 5,
            problem: 6, error: 6,
            teardown: 7,
            rejected: 8,
        };

        // Status code → display name mapping
        const statusNames: Record<number, string> = {
            1: '⚫ Disabled', 2: '🟢 Active',
            3: '🟡 Pending', 4: '🔵 Queued',
            5: '🗑️ Deleting', 6: '🔴 Problem',
            7: '⏳ Teardown', 8: '❌ Rejected',
        };

        try {
            if (!statusArg || statusArg === 'summary') {
                // Summary mode — show counts per status
                const result = await apiRequest('/admin', 'POST', {
                    action: 'enumSessions',
                }, config.apiToken);

                if (result.code !== 0) {
                    await ctx.reply(`❌ Error: ${result.message}`);
                    return;
                }

                const sessions = result.data?.sessions || [];
                const counts: Record<number, number> = {};
                for (const s of sessions as SessionInfo[]) {
                    const st = s.status ?? 0;
                    counts[st] = (counts[st] || 0) + 1;
                }

                let message = `📊 *Session Summary 会话概览*\n\n`;
                message += `Total 总计: *${sessions.length}*\n\n`;

                for (const [code, name] of Object.entries(statusNames)) {
                    const count = counts[Number(code)] || 0;
                    if (count > 0) {
                        message += `${name}: ${count}\n`;
                    }
                }

                message += `\n_Use_ \`/sessions all\` _to list all_\n`;
                message += `_Use_ \`/sessions active\` _to filter_\n`;
                message += `\n可用过滤: active, pending, disabled, problem, rejected`;

                await ctx.reply(message, { parse_mode: 'Markdown' });
                return;
            }

            // Filter mode
            const filterBody: { action: string; status?: number } = { action: 'enumSessions' };
            if (statusArg !== 'all') {
                const statusCode = statusMap[statusArg];
                if (statusCode === undefined) {
                    await ctx.reply(
                        `❌ Unknown status: \`${statusArg}\`\n\n` +
                        `Available filters 可用过滤:\n` +
                        `active, pending, disabled, problem, rejected, queued, teardown, all`,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                filterBody.status = statusCode;
            }

            const result = await apiRequest('/admin', 'POST', filterBody, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = result.data?.sessions || [];

            if (sessions.length === 0) {
                const label = statusArg === 'all' ? 'any status' : statusArg;
                await ctx.reply(`✅ No sessions with status: ${label}\n没有 ${label} 状态的会话`);
                return;
            }

            // Cap at 30 to avoid Telegram message length limit
            const displaySessions = (sessions as SessionInfo[]).slice(0, 30);
            const filterLabel = statusArg === 'all' ? 'All' : statusArg.charAt(0).toUpperCase() + statusArg.slice(1);

            let message = `📋 *Sessions — ${filterLabel} (${sessions.length})*\n\n`;

            for (const s of displaySessions) {
                const statusLabel = statusNames[s.status ?? 0] || `Status ${s.status}`;
                const shortId = s.uuid.slice(0, 8);
                const endpoint = s.ipv4EndpointAddress || s.ipv6EndpointAddress || 'N/A';

                message += `*AS${s.asn}* → ${s.routerName || s.router}\n`;
                message += `   ${statusLabel} | \`${shortId}…\`\n`;
                message += `   Endpoint: \`${endpoint}\`\n\n`;
            }

            if (sessions.length > 30) {
                message += `\n_…and ${sessions.length - 30} more_`;
            }

            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Sessions] Error:', error);
            await ctx.reply('❌ Failed to fetch sessions.');
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

            let message = '📡 *MoeNet Nodes 节点列表*\n\n';
            routers.forEach((r: RouterInfo) => {
                const status = r.isOpen ? '🟢' : '🔴';
                const capacity = r.maxPeers ? `${r.sessionCount || 0}/${r.maxPeers}` : `${r.sessionCount || 0}/∞`;
                const ipv4 = r.supportsIpv4 ? '✓' : '✗';
                const ipv6 = r.supportsIpv6 ? '✓' : '✗';

                message += `${status} *${r.name}*\n`;
                message += `   📍 ${r.location || 'Unknown'}`;
                if (r.provider) message += ` | ${r.provider}`;
                message += `\n`;
                message += `   👥 ${capacity} peers | IPv4:${ipv4} IPv6:${ipv6}`;
                if (!r.allowCnPeers) message += ` | 🚫CN`;
                message += `\n\n`;
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
        const asn = normalizeAsn(asnStr);

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
            const result = await apiRequest('/admin', 'POST', {
                action: 'createSession',
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

            const routers = result.data.routers;

            if (routers.length === 0) {
                await ctx.reply('❌ No available nodes.');
                ctx.session.peerFlow = undefined;
                return;
            }

            // Build node list message with detailed info (dn42-bot style)
            let msgText = '';
            const nodeMap: Record<string, { uuid: string; endpoint: string; pubkey: string; nodeId: number; regionCode: number; name: string }> = {};
            const couldPeer: string[] = [];

            for (const r of routers.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))) {
                // Build label: NAME | City | Provider
                const nodeName = r.name.toUpperCase();
                const city = r.location || '';
                const provider = r.provider || '';
                const label = provider ? `${nodeName} | ${city} | ${provider}` : `${nodeName} | ${city}`;

                // Status section - use different icons
                let statusLines = `- ${label}\n`;

                if (r.isOpen) {
                    statusLines += `  🟢 Open For Peer\n`;
                } else {
                    statusLines += `  🔴 Closed\n`;
                }

                // Capacity
                const current = r.sessionCount || 0;
                const max = r.maxPeers || 0;
                if (max > 0) {
                    statusLines += `  👥 Capacity: ${current} / ${max}\n`;
                } else {
                    statusLines += `  👥 Capacity: ${current} / Unlimited\n`;
                }

                // IPv4/IPv6 support - only show if not supported
                if (r.supportsIpv4 === false) {
                    statusLines += `  ⚠️ IPv4: No\n`;
                }
                if (r.supportsIpv6 === false) {
                    statusLines += `  ⚠️ IPv6: No\n`;
                }

                // CN peer restriction
                if (r.allowCnPeers === false) {
                    statusLines += `  🚫 Not allowed to peer with Chinese Mainland\n`;
                }

                msgText += statusLines + '\n';

                // Add to selectable list if open and has capacity
                const hasCapacity = max === 0 || current < max;
                if (r.isOpen && hasCapacity) {
                    couldPeer.push(label);
                    nodeMap[label] = {
                        uuid: r.uuid,
                        endpoint: r.endpoint || `${r.name}.dn42.moenet.work`,
                        pubkey: r.wgPublicKey || 'N/A',
                        nodeId: r.nodeId || 0,
                        regionCode: r.regionCode || 0,
                        name: r.name,
                    };
                }
            }

            if (couldPeer.length === 0) {
                await ctx.reply(
                    `${msgText}\n❌ 当前没有可 Peer 的节点 / No available nodes for peering`,
                    { reply_markup: { remove_keyboard: true } }
                );
                ctx.session.peerFlow = undefined;
                return;
            }

            // Save nodeMap to session
            ctx.session.peerFlow = {
                ...ctx.session.peerFlow!,
                step: 'select_node',
                nodeMap,
            };

            // Send node list
            await ctx.reply(msgText);

            // Build ReplyKeyboard with one row per option
            const keyboard: { text: string }[][] = couldPeer.map(label => [{ text: label }]);

            // Send selection prompt with ReplyKeyboard
            await ctx.reply(
                'Which node do you want to choose?\n你想选择哪个节点?',
                {
                    reply_markup: {
                        keyboard,
                        resize_keyboard: true,
                        one_time_keyboard: true,
                    }
                }
            );
        } catch (error) {
            console.error('[AddPeer Wizard] Error:', error);
            await ctx.reply('❌ Failed to fetch nodes.');
            ctx.session.peerFlow = undefined;
        }
    }

    /**
     * Handle ReplyKeyboard node selection for admin addpeer wizard
     */
    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.peerFlow;
        if (!flow || flow.step !== 'select_node' || !flow.isAdminMode) {
            return next();
        }

        const text = ctx.message.text.trim();
        const nodeInfo = flow.nodeMap?.[text];

        if (!nodeInfo) {
            // Not a valid node selection, pass to next handler
            return next();
        }

        // Get ASN from flow and calculate port
        const asn = flow.targetAsn || 0;
        const userPort = calculatePort(asn);

        // Update session with selected node
        ctx.session.peerFlow = {
            ...flow,
            step: 'await_continue',
            routerName: nodeInfo.name || text.split(' | ')[1] || text,
            sessionUuid: nodeInfo.uuid,
            serverEndpoint: nodeInfo.endpoint,
            serverPort: userPort,
            serverPubkey: nodeInfo.pubkey,
            serverLla: `fe80::998:${nodeInfo.regionCode}:${nodeInfo.nodeId}:1`,
        };

        // Confirm selection - use routerName from session
        await ctx.reply(`✅ Selected: ${ctx.session.peerFlow.routerName}`, { reply_markup: { remove_keyboard: true } });

        // Import and call showServerWgInfo (reads info from ctx.session.peerFlow)
        const { showServerWgInfo } = await import('./peer/ui');
        await showServerWgInfo(ctx);
    });

    /**
     * /announce <message> - Broadcast announcement to all peer users
     */
    bot.command('announce', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const message = ctx.match?.trim();
        if (!message) {
            await ctx.reply(
                `📢 *Announce 公告*\n\n` +
                `Usage 用法:\n` +
                `• \`/announce <message>\`\n\n` +
                `Sends the message to all users with active peers.\n` +
                `向所有有活跃 Peer 的用户发送消息。`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        await ctx.reply('📢 Sending announcement...\n正在发送公告...');

        try {
            // Get all notification targets
            const result = await apiRequest('/admin', 'POST', {
                action: 'getNotificationTargets',
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Failed to get targets: ${result.message}`);
                return;
            }

            const targets = (result.data as unknown as { targets: NotificationTarget[] })?.targets || [];

            if (targets.length === 0) {
                await ctx.reply('ℹ️ No users with registered Telegram IDs found.\n未找到已注册 Telegram ID 的用户。');
                return;
            }

            const adminTgId = ctx.from?.id;
            let sent = 0;
            let failed = 0;
            const failedAsns: number[] = [];

            for (const target of targets) {
                // Skip sending to admin themselves
                if (target.telegramId === adminTgId) continue;

                try {
                    await ctx.api.sendMessage(
                        target.telegramId,
                        `📢 *MoeNet Announcement 公告*\n\n${escapeMarkdown(message)}`,
                        { parse_mode: 'Markdown' }
                    );
                    sent++;
                } catch (error) {
                    console.error(`[Announce] Failed to send to AS${target.asn} (tgId: ${target.telegramId}):`, error);
                    failed++;
                    failedAsns.push(target.asn);
                }
            }

            let report = `📢 *Announcement Report 公告报告*\n\n` +
                `✅ Sent 已发送: ${sent}\n` +
                `❌ Failed 失败: ${failed}\n` +
                `👥 Total targets 目标总数: ${targets.length}`;

            if (failedAsns.length > 0) {
                report += `\n\nFailed ASNs 失败的 ASN: ${failedAsns.map(a => `AS${a}`).join(', ')}`;
            }

            await ctx.reply(report, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Announce] Error:', error);
            await ctx.reply('❌ Announcement failed.');
        }
    });

    /**
     * /notify <ASN,...> <message> - Send notification to specific ASN users
     */
    bot.command('notify', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        const args = ctx.match?.trim() || '';
        if (!args) {
            await ctx.reply(
                `🔔 *Notify 通知*\n\n` +
                `Usage 用法:\n` +
                `• \`/notify <ASN> <message>\` — single user\n` +
                `• \`/notify <ASN1,ASN2,...> <message>\` — multiple users\n\n` +
                `Example 示例:\n` +
                `\`/notify 0998 Your tunnel is down\`\n` +
                `\`/notify 0998,1234 Maintenance tonight\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Parse: first token = ASN(s), rest = message
        const spaceIdx = args.indexOf(' ');
        if (spaceIdx === -1) {
            await ctx.reply('❌ Missing message. Usage: `/notify <ASN> <message>`', { parse_mode: 'Markdown' });
            return;
        }

        const asnPart = args.slice(0, spaceIdx);
        const message = args.slice(spaceIdx + 1).trim();

        if (!message) {
            await ctx.reply('❌ Message cannot be empty.\n消息不能为空。');
            return;
        }

        // Parse ASN list (comma-separated, supports short form like 0998)
        const asns = asnPart.split(',').map(s => normalizeAsn(s.trim())).filter(n => !isNaN(n));

        if (asns.length === 0) {
            await ctx.reply('❌ Invalid ASN format.\n无效的 ASN 格式。');
            return;
        }

        try {
            // Get notification targets for specific ASNs
            const result = await apiRequest('/admin', 'POST', {
                action: 'getNotificationTargets',
                asns,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Failed to get targets: ${result.message}`);
                return;
            }

            const targets = (result.data as unknown as { targets: NotificationTarget[] })?.targets || [];

            if (targets.length === 0) {
                const asnList = asns.map(a => `AS${a}`).join(', ');
                await ctx.reply(
                    `❌ No registered users found for: ${asnList}\n` +
                    `未找到这些 ASN 的已注册用户。\n\n` +
                    `Users must have logged in via /login to receive notifications.\n` +
                    `用户需要通过 /login 登录过才能接收通知。`
                );
                return;
            }

            let sent = 0;
            let failed = 0;
            const results: string[] = [];

            for (const target of targets) {
                try {
                    await ctx.api.sendMessage(
                        target.telegramId,
                        `🔔 *MoeNet Notification 通知*\n\n${escapeMarkdown(message)}`,
                        { parse_mode: 'Markdown' }
                    );
                    sent++;
                    results.push(`✅ AS${target.asn}`);
                } catch (error) {
                    console.error(`[Notify] Failed to send to AS${target.asn}:`, error);
                    failed++;
                    results.push(`❌ AS${target.asn}`);
                }
            }

            // Check for ASNs that had no targets
            const targetedAsns = new Set(targets.map(t => t.asn));
            for (const asn of asns) {
                if (!targetedAsns.has(asn)) {
                    results.push(`⚠️ AS${asn} (no Telegram ID)`);
                }
            }

            await ctx.reply(
                `🔔 *Notification Report 通知报告*\n\n` +
                `${results.join('\n')}\n\n` +
                `Sent 已发送: ${sent} | Failed 失败: ${failed}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Notify] Error:', error);
            await ctx.reply('❌ Notification failed.');
        }
    });
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
    routerName?: string;
    ipv4EndpointAddress?: string;
    ipv6EndpointAddress?: string;
    ipv6?: string;
    endpoint?: string;
    contact?: string;
    status?: number;
    createdAt?: string;
}

interface RouterInfo {
    uuid: string;
    name: string;
    location: string;
    region?: string;
    sessionCount: number;
    isOpen: boolean;
    endpoint?: string;
    wgPublicKey?: string;
    nodeId?: number;
    regionCode?: number;
    maxPeers?: number;
    supportsIpv4?: boolean;
    supportsIpv6?: boolean;
    provider?: string;
    allowCnPeers?: boolean;
}

interface NotificationTarget {
    asn: number;
    telegramId: number;
}
