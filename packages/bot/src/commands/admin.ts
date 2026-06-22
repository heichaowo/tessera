import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import { apiRequest } from '../api';
import { isAdmin } from '../guards';
import { calculatePort, normalizeAsn, isAsnInput } from './peer/validators';
import { fetchContacts } from '../services/dn42Registry';
import { DIVIDER } from '../templates';

/**
 * Escape Telegram Markdown v1 special characters in user-supplied text.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/([*_`\[])/g, '\\$1');
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

    // =========================================================================
    // /migrate - Bulk migrate sessions between nodes
    // =========================================================================

    /**
     * /migrate - Start bulk migration flow
     */
    bot.command('migrate', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.');
            return;
        }

        // Fetch all routers
        const result = await apiRequest('/admin', 'POST', { action: 'enumRouters' }, config.apiToken);
        const routers = result.data?.routers || [];

        if (routers.length < 2) {
            await ctx.reply('❌ Need at least 2 nodes to migrate.\n至少需要 2 个节点才能迁移。');
            return;
        }

        let message = `🔄 *Node Migration 节点迁移*\n\n` +
            `Select the *source* node (migrate FROM):\n` +
            `选择*源节点*（从哪个节点迁出）:\n\n`;

        const keyboard = new InlineKeyboard();
        for (const r of routers) {
            const name = r.name || r.uuid;
            const region = r.region || '';
            keyboard.text(`📍 ${name} ${region ? `(${region})` : ''}`, `migrate:from:${r.uuid}`).row();
        }
        keyboard.text('🚫 Cancel 取消', 'migrate:cancel');

        await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // Handle source node selection
    bot.callbackQuery(/^migrate:from:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        const fromRouter = ctx.match[1];
        await ctx.answerCallbackQuery();

        // Fetch routers to show targets (exclude source)
        const result = await apiRequest('/admin', 'POST', { action: 'enumRouters' }, config.apiToken);
        const routers = (result.data?.routers || []).filter((r: { uuid: string }) => r.uuid !== fromRouter);
        const sourceRouter = (result.data?.routers || []).find((r: { uuid: string }) => r.uuid === fromRouter!);
        const sourceName = sourceRouter?.name || fromRouter!.slice(0, 8);

        let message = `🔄 *Migration 迁移*\n\n` +
            `From 源: \`${sourceName}\`\n\n` +
            `Select the *target* node (migrate TO):\n` +
            `选择*目标节点*（迁移到哪个节点）:\n\n`;

        const keyboard = new InlineKeyboard();
        for (const r of routers) {
            const name = r.name || r.uuid;
            const region = r.region || '';
            keyboard.text(`📍 ${name} ${region ? `(${region})` : ''}`, `migrate:to:${fromRouter}:${r.uuid}`).row();
        }
        keyboard.text('🚫 Cancel 取消', 'migrate:cancel');

        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // Handle target node selection → dry run preview
    bot.callbackQuery(/^migrate:to:(.+):(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        const fromRouter = ctx.match[1];
        const toRouter = ctx.match[2];
        await ctx.answerCallbackQuery('Loading preview...');

        // Dry run to preview
        const result = await apiRequest('/admin', 'POST', {
            action: 'bulkMigrate',
            fromRouter,
            toRouter,
            dryRun: true,
        }, config.apiToken);

        if (result.code !== 0) {
            await ctx.editMessageText(`❌ Error: ${result.message}`);
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = result.data as any;
        const fromName = data.fromRouter as string;
        const toName = data.toRouter as string;
        const count = data.count as number;
        const sessions = (data.sessions || []) as Array<{ asn: number; contact: string | null }>;

        if (count === 0) {
            await ctx.editMessageText(
                `✅ No active sessions on \`${fromName}\`.\n` +
                `\`${fromName}\` 上没有活跃的会话。`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        let message = `🔄 *Migration Preview 迁移预览*\n\n` +
            `From 源: \`${fromName}\`\n` +
            `To 目标: \`${toName}\`\n` +
            `Sessions 会话数: *${count}*\n\n`;

        for (const s of sessions.slice(0, 20)) {
            message += `• AS${s.asn}${s.contact ? ` (${escapeMarkdown(s.contact)})` : ''}\n`;
        }
        if (count > 20) {
            message += `\n...+${count - 20} more\n`;
        }

        message += `\n⚠️ *Confirm to execute migration?*\n` +
            `确认执行迁移？所有会话将从 ${fromName} 迁移到 ${toName}。`;

        const keyboard = new InlineKeyboard()
            .text('✅ Confirm 确认迁移', `migrate:exec:${fromRouter}:${toRouter}`)
            .text('🚫 Cancel 取消', 'migrate:cancel');

        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    // Handle migration execution
    bot.callbackQuery(/^migrate:exec:(.+):(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.answerCallbackQuery('❌ Admin only');
            return;
        }

        const fromRouter = ctx.match[1];
        const toRouter = ctx.match[2];
        await ctx.answerCallbackQuery('Migrating...');
        await ctx.editMessageText('⏳ Migration in progress...\n正在执行迁移...');

        const result = await apiRequest('/admin', 'POST', {
            action: 'bulkMigrate',
            fromRouter,
            toRouter,
            dryRun: false,
        }, config.apiToken);

        if (result.code !== 0) {
            await ctx.editMessageText(`❌ Migration failed: ${result.message}\n迁移失败: ${result.message}`);
            return;
        }

        const { fromRouter: fromName, toRouter: toName, migrated, failed, results } = result.data as {
            fromRouter: string; toRouter: string; migrated: number; failed: number;
            results: Array<{ asn: number; status: string; error?: string }>;
        };

        let message = `✅ *Migration Complete 迁移完成*\n\n` +
            `From 源: \`${fromName}\`\n` +
            `To 目标: \`${toName}\`\n\n` +
            `✅ Migrated 已迁移: *${migrated}*\n`;

        if (failed > 0) {
            message += `❌ Failed 失败: *${failed}*\n\n`;
            message += `*Failures:*\n`;
            for (const r of results.filter(r => r.status === 'error')) {
                message += `• AS${r.asn}: ${r.error}\n`;
            }
        }

        message += `\n⏳ Users will be notified automatically once new sessions are active.\n` +
            `用户将在新会话激活后自动收到通知。`;

        await ctx.editMessageText(message, { parse_mode: 'Markdown' });

        // Store pending migration notifications in API (Redis-backed)
        // Will be triggered when agent reports sessions as ENABLED
        if (migrated > 0) {
            const migratedAsns = results
                .filter(r => r.status === 'ok')
                .map(r => r.asn);

            await apiRequest('/admin', 'POST', {
                action: 'storeMigrationNotify',
                asns: migratedAsns,
                fromRouter: fromName,
                toRouter: toName,
                adminChatId: ctx.chat?.id,
            }, config.apiToken);
        }
    });

    // Handle cancel
    bot.callbackQuery('migrate:cancel', async (ctx) => {
        await ctx.answerCallbackQuery('Cancelled');
        await ctx.editMessageText('🚫 Migration cancelled.\n迁移已取消。');
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
            await ctx.reply('❌ Invalid ASN format\n无效的 ASN 格式');
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
            await ctx.reply('❌ Invalid WireGuard public key (should be 44 chars base64)\n无效的 WireGuard 公钥');
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
                    `${msgText}\n❌ No available nodes for peering\n当前没有可 Peer 的节点`,
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
     * /announce <message> - Broadcast announcement with node targeting + dual channel
     */
    bot.command('announce', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.\n需要管理员权限。');
            return;
        }

        // Fetch routers for node selection (needed for both paths)
        const routerResult = await apiRequest('/admin', 'POST', { action: 'enumRouters' }, config.apiToken);
        const routers = routerResult.data?.routers || [];

        const message = ctx.match?.trim() || undefined;

        // Init flow with optional pre-filled message
        ctx.session.announceFlow = {
            message,
            routerUuids: routers.map((r: { uuid: string }) => r.uuid),
            routerNames: routers.map((r: { name: string }) => r.name),
        };

        await showAnnounceMenu(ctx);
    });

    /** Build and display the announce main menu */
    async function showAnnounceMenu(ctx: BotContext, editMessage = false) {
        const flow = ctx.session.announceFlow;
        if (!flow) return;

        const msgStatus = flow.message
            ? `✅ ${flow.message.length > 40 ? flow.message.slice(0, 40) + '...' : flow.message}`
            : '❌ Not set 未填写';

        const nodeStatus = flow.selectedRouters !== undefined
            ? (flow.selectedRouters.length === 0
                ? '🌐 All nodes 全部节点'
                : `📍 ${flow.selectedRouters.length} node(s) 节点`)
            : '❌ Not set 未选择';

        const targetInfo = flow.targetCount
            ? `\nTargets 用户: 👥 ${flow.targetCount.tg + flow.targetCount.email} (📱TG ${flow.targetCount.tg} + 📧Email ${flow.targetCount.email})`
            : '';

        const text =
            `📢 *Announce 公告*\n${DIVIDER}\n` +
            `Content 内容: ${escapeMarkdown(msgStatus)}\n` +
            `Scope 范围: ${escapeMarkdown(nodeStatus)}` +
            targetInfo;

        const keyboard = new InlineKeyboard()
            .text(`📝 ${flow.message ? 'Edit' : 'Set'} Content ${flow.message ? '修改' : '填写'}内容`, 'ann:msg')
            .row()
            .text('🌐 All users 全部用户', 'ann:all')
            .row();

        if (flow.routerNames.length > 0) {
            keyboard.text('📍 Select nodes 选择节点', 'ann:select:' + '0'.repeat(flow.routerNames.length))
                .row();
        }

        // Only show preview if message is filled
        if (flow.message && flow.selectedRouters !== undefined) {
            keyboard.text('✅ Preview & Send 预览发送', 'ann:preview').row();
        }

        keyboard.text('🚫 Cancel 取消', 'ann:cancel');

        if (editMessage) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        }
    }

    // ann:msg → ask for message text
    bot.callbackQuery('ann:msg', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();

        if (!ctx.session.announceFlow) return;
        ctx.session.announceFlow.awaitingMessage = true;

        const keyboard = new InlineKeyboard()
            .text('⬅️ Back 返回', 'ann:back');

        await ctx.editMessageText(
            `📢 *Announce — Content 内容*\n${DIVIDER}\n` +
            `Enter announcement message below.\n` +
            `请输入公告内容。`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    // ann:back → return to announce menu
    bot.callbackQuery('ann:back', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();
        if (!ctx.session.announceFlow) {
            await ctx.editMessageText('❌ Session expired. Run /announce again.\n会话已过期，请重新执行 /announce');
            return;
        }
        ctx.session.announceFlow.awaitingMessage = false;
        await showAnnounceMenu(ctx, true);
    });

    // Handle text input for announce message
    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.announceFlow;
        if (!flow?.awaitingMessage) return next();

        const text = ctx.message.text.trim();

        // If a command, cancel flow and pass through
        if (text.startsWith('/')) {
            ctx.session.announceFlow = undefined;
            return next();
        }

        flow.awaitingMessage = false;
        flow.message = text;
        ctx.session.announceFlow = flow;
        await showAnnounceMenu(ctx);
    });

    // Build node selection keyboard from bitmask
    function buildNodeKeyboard(
        routerNames: string[],
        bitmask: string,
    ): InlineKeyboard {
        const keyboard = new InlineKeyboard();

        for (let i = 0; i < routerNames.length; i++) {
            const selected = bitmask[i] === '1';
            const label = `${selected ? '☑️' : '☐'} ${routerNames[i]}`;
            // Toggle: flip bit at index i
            const newBitmask = bitmask.substring(0, i) + (selected ? '0' : '1') + bitmask.substring(i + 1);
            keyboard.text(label, `ann:t:${i}:${newBitmask}`);

            // Two per row
            if (i % 2 === 1 || i === routerNames.length - 1) {
                keyboard.row();
            }
        }

        const selectedCount = (bitmask.match(/1/g) || []).length;
        keyboard.text(`✅ Done 确认选择 (${selectedCount})`, `ann:done:${bitmask}`).row();
        keyboard.text('🚫 Cancel 取消', 'ann:cancel');

        return keyboard;
    }

    // Handle "Select nodes" → show toggle keyboard
    bot.callbackQuery(/^ann:select:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();

        const bitmask = ctx.match[1]!;
        const flow = ctx.session.announceFlow;
        if (!flow) { await ctx.editMessageText('❌ Session expired. Run /announce again.\n会话已过期，请重新执行 /announce'); return; }

        const keyboard = buildNodeKeyboard(flow.routerNames, bitmask);

        await ctx.editMessageText(
            `📢 *Select Nodes 选择节点*\n\n` +
            `Message 消息:\n${escapeMarkdown(flow.message || '')}\n\n` +
            `Tap nodes to toggle selection:\n` +
            `点击节点切换选中状态：`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    // Handle toggle button
    bot.callbackQuery(/^ann:t:(\d+):(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        const selectedCount = (ctx.match[2]!.match(/1/g) || []).length;
        await ctx.answerCallbackQuery(`${selectedCount} node(s) selected`);

        const bitmask = ctx.match[2]!;
        const flow = ctx.session.announceFlow;
        if (!flow) { await ctx.editMessageText('❌ Session expired. Run /announce again.\n会话已过期，请重新执行 /announce'); return; }

        const keyboard = buildNodeKeyboard(flow.routerNames, bitmask);

        await ctx.editMessageText(
            `📢 *Select Nodes 选择节点*\n\n` +
            `Message 消息:\n${escapeMarkdown(flow.message || '')}\n\n` +
            `Tap nodes to toggle selection:\n` +
            `点击节点切换选中状态：`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    // Handle "Done" → store selection, go to preview or back to menu
    bot.callbackQuery(/^ann:done:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }

        const bitmask = ctx.match[1]!;
        const flow = ctx.session.announceFlow;
        if (!flow) { await ctx.editMessageText('❌ Session expired. Run /announce again.\n会话已过期，请重新执行 /announce'); return; }

        const selectedCount = (bitmask.match(/1/g) || []).length;
        if (selectedCount === 0) {
            await ctx.answerCallbackQuery('⚠️ Select at least 1 node 至少选择 1 个节点');
            return;
        }

        await ctx.answerCallbackQuery(`${selectedCount} node(s) selected`);

        // Resolve selected router UUIDs and store in session
        const selectedRouters = flow.routerUuids.filter((_: string, i: number) => bitmask[i] === '1');
        const targetCount = await fetchTargetCount(selectedRouters);
        ctx.session.announceFlow = { ...flow, selectedRouters, targetCount };

        // If message is filled → go to preview; otherwise → back to menu
        if (flow.message) {
            const selectedNames = flow.routerNames.filter((_: string, i: number) => bitmask[i] === '1');
            await sendAnnouncePreview(ctx, flow.message, selectedRouters, selectedNames);
        } else {
            await showAnnounceMenu(ctx, true);
        }
    });

    // Handle "All users" → store selection, go to preview or back to menu
    bot.callbackQuery('ann:all', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();

        const flow = ctx.session.announceFlow;
        if (!flow) { await ctx.editMessageText('❌ Session expired. Run /announce again.\n会话已过期，请重新执行 /announce'); return; }

        const targetCount = await fetchTargetCount([]);
        ctx.session.announceFlow = { ...flow, selectedRouters: [], targetCount };

        // If message is filled → go to preview; otherwise → back to menu
        if (flow.message) {
            await sendAnnouncePreview(ctx, flow.message, [], []);
        } else {
            await showAnnounceMenu(ctx, true);
        }
    });

    /** Fetch target user count for given routers (empty = all) */
    async function fetchTargetCount(routers: string[]): Promise<{ tg: number; email: number }> {
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'getNotificationTargets',
                ...(routers.length > 0 ? { routers } : {}),
            }, config.apiToken);

            if (result.code === 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data = result.data as any;
                const tg = ((data?.targets || []) as NotificationTarget[]).length;
                const email = ((data?.emailFallbacks || []) as Array<{ asn: number; email: string }>).length;
                return { tg, email };
            }
        } catch {
            // Non-critical, return zeros
        }
        return { tg: 0, email: 0 };
    }

    // Handle "Preview & Send" from main menu
    bot.callbackQuery('ann:preview', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery('Loading preview... 加载预览...');

        const flow = ctx.session.announceFlow;
        if (!flow?.message || flow.selectedRouters === undefined) {
            await ctx.editMessageText('❌ Missing content or scope.\n缺少内容或范围。');
            return;
        }

        const routers = flow.selectedRouters;
        const routerNames = routers.length > 0
            ? routers.map(uuid => {
                const idx = flow.routerUuids.indexOf(uuid);
                return idx !== -1 ? flow.routerNames[idx]! : uuid;
            })
            : [];

        await sendAnnouncePreview(ctx, flow.message, routers, routerNames);
    });

    // Shared: fetch targets → show confirm
    async function sendAnnouncePreview(
        ctx: BotContext,
        message: string,
        routers: string[],
        routerNames: string[],
    ) {
        const result = await apiRequest('/admin', 'POST', {
            action: 'getNotificationTargets',
            ...(routers.length > 0 ? { routers } : {}),
        }, config.apiToken);

        if (result.code !== 0) {
            await ctx.editMessageText(`❌ Error: ${result.message}`);
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = result.data as any;
        const tgTargets = (data?.targets || []) as NotificationTarget[];
        const emailTargets = (data?.emailFallbacks || []) as Array<{ asn: number; email: string }>;

        const scope = routerNames.length > 0
            ? `Nodes 节点: ${routerNames.join(', ')}`
            : 'All nodes 全部节点';

        let preview = `📢 *Announcement Confirm 确认发送*\n\n` +
            `${scope}\n\n` +
            `Message 消息:\n${escapeMarkdown(message)}\n\n` +
            `📱 Telegram: *${tgTargets.length}* users\n` +
            `📧 Email: *${emailTargets.length}* users\n` +
            `👥 Total 总计: *${tgTargets.length + emailTargets.length}* unique users`;

        if (tgTargets.length === 0 && emailTargets.length === 0) {
            preview += `\n\n⚠️ No reachable users found.\n未找到可通知的用户。`;
            await ctx.editMessageText(preview, { parse_mode: 'Markdown' });
            return;
        }

        // Store in session, use simple callback_data (64-byte limit)
        const keyboard = new InlineKeyboard()
            .text('✅ Send 发送', 'ann:send')
            .text('🚫 Cancel 取消', 'ann:cancel');

        await ctx.editMessageText(preview, { parse_mode: 'Markdown', reply_markup: keyboard });
    }

    // Handle send confirm (also used by retry)
    bot.callbackQuery('ann:send', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery('Sending...');

        const flow = ctx.session.announceFlow;
        if (!flow) { await ctx.editMessageText('❌ Session expired. Run /announce again.'); return; }

        const routers = flow.selectedRouters || [];

        await ctx.editMessageText('⏳ Sending announcement...\n正在发送公告...');

        // Fetch targets
        const result = await apiRequest('/admin', 'POST', {
            action: 'getNotificationTargets',
            ...(routers.length > 0 ? { routers } : {}),
        }, config.apiToken);

        if (result.code !== 0) {
            await ctx.editMessageText(`❌ Failed: ${result.message}`);
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = result.data as any;
        const tgTargets = (data?.targets || []) as NotificationTarget[];
        const emailTargets = (data?.emailFallbacks || []) as Array<{ asn: number; email: string }>;
        const allAsns = (data?.allAsns || []) as number[];

        // Dynamic fallback: for ASNs with no contact at all, fetch from DN42 registry
        const coveredAsns = new Set([
            ...tgTargets.map(t => t.asn),
            ...emailTargets.map(t => t.asn),
        ]);
        const unreachableAsns = allAsns.filter(a => !coveredAsns.has(a));

        if (unreachableAsns.length > 0) {
            for (const asn of unreachableAsns) {
                try {
                    const contacts = await fetchContacts(asn);
                    // Find first email-like contact
                    const email = contacts.find(c => c.includes('@') && !c.startsWith('@'));
                    if (email) {
                        emailTargets.push({ asn, email });
                        // Backfill contact into the session for future use
                        apiRequest('/admin', 'POST', {
                            action: 'updateSessionContact',
                            asn,
                            contact: email,
                        }, config.apiToken).catch(() => {});
                    }
                } catch {
                    // Burble API unavailable, skip this ASN
                }
            }
        }

        const sendResult = await executeSend(ctx, flow.message || '', tgTargets, emailTargets);
        await showSendReport(ctx, sendResult, flow);
    });

    // Handle retry - only re-send failed items
    bot.callbackQuery('ann:retry', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery('Retrying...');

        const flow = ctx.session.announceFlow;
        if (!flow) { await ctx.editMessageText('❌ Session expired. Run /announce again.'); return; }

        const retryTg = (flow.failedTg || []) as NotificationTarget[];
        const retryEmail = (flow.failedEmail || []) as Array<{ asn: number; email: string }>;

        if (retryTg.length === 0 && retryEmail.length === 0) {
            await ctx.editMessageText('✅ No failed items to retry.\n没有需要重试的项。');
            return;
        }

        await ctx.editMessageText('🔄 Retrying failed items...\n正在重试失败项...');

        const sendResult = await executeSend(ctx, flow.message || '', retryTg, retryEmail);
        await showSendReport(ctx, sendResult, flow, true);
    });

    /**
     * Execute the actual send: TG + Email, return categorized results.
     */
    async function executeSend(
        ctx: BotContext,
        message: string,
        tgTargets: NotificationTarget[],
        emailTargets: Array<{ asn: number; email: string }>,
    ) {
        const adminTgId = ctx.from?.id;
        let tgSent = 0;
        const failedTg: NotificationTarget[] = [];

        for (const target of tgTargets) {
            if (target.telegramId === adminTgId) continue;
            try {
                await ctx.api.sendMessage(
                    target.telegramId,
                    `📢 *MoeNet Announcement 公告*\n\n${escapeMarkdown(message)}`,
                    { parse_mode: 'Markdown' }
                );
                tgSent++;
            } catch (error) {
                console.error(`[Announce] TG failed AS${target.asn}:`, error);
                failedTg.push(target);
            }
        }

        let emailSent = 0;
        const failedEmail: Array<{ asn: number; email: string }> = [];

        if (emailTargets.length > 0) {
            const emailResult = await apiRequest('/admin', 'POST', {
                action: 'sendBulkEmail',
                message,
                targets: emailTargets,
            }, config.apiToken);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const emailData = emailResult.data as any;
            emailSent = emailData?.sent || 0;
            const emailErrors = (emailData?.errors || []) as Array<{ asn: number; error: string }>;

            // Match failed ASNs back to email targets
            const failedAsnSet = new Set(emailErrors.map((e: { asn: number }) => e.asn));
            for (const t of emailTargets) {
                if (failedAsnSet.has(t.asn)) {
                    failedEmail.push(t);
                }
            }
        }

        return { tgSent, emailSent, failedTg, failedEmail };
    }

    /**
     * Show categorized send report with retry button if there are failures.
     */
    async function showSendReport(
        ctx: BotContext,
        result: { tgSent: number; emailSent: number; failedTg: NotificationTarget[]; failedEmail: Array<{ asn: number; email: string }> },
        flow: NonNullable<BotContext['session']['announceFlow']>,
        isRetry = false,
    ) {
        const { tgSent, emailSent, failedTg, failedEmail } = result;
        const totalFailed = failedTg.length + failedEmail.length;
        const prefix = isRetry ? '🔄 *Retry Report 重试报告*' : '📢 *Announcement Report 公告报告*';

        let report = `${prefix}\n\n` +
            `📱 TG: ✅ ${tgSent} sent, ❌ ${failedTg.length} failed\n` +
            `📧 Email: ✅ ${emailSent} sent, ❌ ${failedEmail.length} failed\n` +
            `👥 Total reached 总到达: *${tgSent + emailSent}*`;

        // Categorized failure details
        if (totalFailed > 0) {
            // Find ASNs that failed on BOTH channels
            const tgFailedAsns = new Set(failedTg.map(t => t.asn));
            const emailFailedAsns = new Set(failedEmail.map(t => t.asn));
            const bothFailed = [...tgFailedAsns].filter(a => emailFailedAsns.has(a));
            const tgOnlyFailed = failedTg.filter(t => !emailFailedAsns.has(t.asn));
            const emailOnlyFailed = failedEmail.filter(t => !tgFailedAsns.has(t.asn));

            report += `\n\n*Failures 失败详情:*`;

            if (bothFailed.length > 0) {
                report += `\n🔴 Both TG+Email 双通道失败:`;
                for (const asn of bothFailed) {
                    report += `\n  • AS${asn}`;
                }
            }
            if (tgOnlyFailed.length > 0) {
                report += `\n📱 TG only TG失败:`;
                for (const t of tgOnlyFailed) {
                    report += `\n  • AS${t.asn} (id: ${t.telegramId})`;
                }
            }
            if (emailOnlyFailed.length > 0) {
                report += `\n📧 Email only 邮件失败:`;
                for (const t of emailOnlyFailed) {
                    report += `\n  • AS${t.asn} (${t.email})`;
                }
            }
        }

        // Store failures in session for retry
        if (totalFailed > 0) {
            ctx.session.announceFlow = { ...flow, failedTg, failedEmail };

            const keyboard = new InlineKeyboard()
                .text(`🔄 Retry ${totalFailed} failed 重试失败项`, 'ann:retry')
                .text('✅ Done 完成', 'ann:done:dismiss');

            await ctx.editMessageText(report, { parse_mode: 'Markdown', reply_markup: keyboard });
        } else {
            // All succeeded - clean up
            ctx.session.announceFlow = undefined;
            await ctx.editMessageText(report, { parse_mode: 'Markdown' });
        }
    }

    // Handle dismiss (after retry or done)
    bot.callbackQuery('ann:done:dismiss', async (ctx) => {
        await ctx.answerCallbackQuery('Done');
        ctx.session.announceFlow = undefined;
        // Remove the retry button but keep the report text
        const text = ctx.callbackQuery.message?.text || 'Done';
        await ctx.editMessageText(text);
    });

    // Handle cancel
    bot.callbackQuery('ann:cancel', async (ctx) => {
        await ctx.answerCallbackQuery('Cancelled');
        await ctx.editMessageText('🚫 Announcement cancelled.\n公告已取消。');
        ctx.session.announceFlow = undefined;
    });

    /**
     * /notify - Send notification to specific ASN users (inline keyboard flow)
     */
    bot.command('notify', async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('❌ Admin access required.\n需要管理员权限。');
            return;
        }

        const args = ctx.match?.trim() || '';

        // Shortcut: /notify <ASN,...> <message> → direct send (keep backward compat)
        if (args) {
            const spaceIdx = args.indexOf(' ');
            if (spaceIdx !== -1) {
                const asnPart = args.slice(0, spaceIdx);
                const message = args.slice(spaceIdx + 1).trim();
                const asns = asnPart.split(',').map(s => normalizeAsn(s.trim())).filter(n => !isNaN(n));

                if (asns.length > 0 && message) {
                    await executeDirectNotify(ctx, asns, message);
                    return;
                }
            }

            // Single arg might be ASN → pre-fill targets
            const asns = args.split(',').map(s => normalizeAsn(s.trim())).filter(n => !isNaN(n));
            if (asns.length > 0) {
                ctx.session.notifyFlow = { asns };
                await showNotifyMenu(ctx);
                return;
            }
        }

        // No args → show main menu
        ctx.session.notifyFlow = {};
        await showNotifyMenu(ctx);
    });

    /** Build and display the notify main menu */
    async function showNotifyMenu(ctx: BotContext, editMessage = false) {
        const flow = ctx.session.notifyFlow;
        if (!flow) return;

        const msgStatus = flow.message
            ? `✅ ${flow.message.length > 30 ? flow.message.slice(0, 30) + '...' : flow.message}`
            : '❌ Not set 未填写';
        const asnStatus = flow.asns && flow.asns.length > 0
            ? `✅ ${flow.asns.map(a => `AS${a}`).join(', ')}`
            : '❌ Not set 未选择';

        const text =
            `🔔 *Notify 通知*\n${DIVIDER}\n` +
            `Content 内容: ${escapeMarkdown(msgStatus)}\n` +
            `Targets 目标: ${escapeMarkdown(asnStatus)}`;

        const keyboard = new InlineKeyboard()
            .text(`📝 ${flow.message ? 'Edit' : 'Set'} Content ${flow.message ? '修改' : '填写'}内容`, 'ntf:msg')
            .row()
            .text(`👥 ${flow.asns?.length ? 'Edit' : 'Select'} ASN ${flow.asns?.length ? '修改' : '选择'}目标`, 'ntf:asn')
            .row();

        // Only show preview if both fields are filled
        if (flow.message && flow.asns && flow.asns.length > 0) {
            keyboard.text('✅ Preview & Send 预览发送', 'ntf:preview').row();
        }

        keyboard.text('🚫 Cancel 取消', 'ntf:cancel');

        if (editMessage) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        } else {
            await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        }
    }

    // ntf:msg → ask for message text
    bot.callbackQuery('ntf:msg', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();

        if (!ctx.session.notifyFlow) ctx.session.notifyFlow = {};
        ctx.session.notifyFlow.awaitingMessage = true;

        const keyboard = new InlineKeyboard()
            .text('⬅️ Back 返回', 'ntf:back');

        await ctx.editMessageText(
            `🔔 *Notify — Content 内容*\n${DIVIDER}\n` +
            `Enter notification message below.\n` +
            `请输入通知内容。`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    // ntf:asn → ask for ASN input
    bot.callbackQuery('ntf:asn', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();

        if (!ctx.session.notifyFlow) ctx.session.notifyFlow = {};
        ctx.session.notifyFlow.awaitingAsns = true;

        const keyboard = new InlineKeyboard()
            .text('⬅️ Back 返回', 'ntf:back');

        await ctx.editMessageText(
            `🔔 *Notify — Targets 目标*\n${DIVIDER}\n` +
            `Enter ASN(s), comma separated.\n` +
            `请输入 ASN，逗号分隔。\n\n` +
            `Example 示例: \`998\`, \`0998,1234\``,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    // ntf:back → return to notify menu
    bot.callbackQuery('ntf:back', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();
        if (!ctx.session.notifyFlow) {
            await ctx.editMessageText('❌ Session expired. Run /notify again.\n会话已过期，请重新执行 /notify');
            return;
        }
        ctx.session.notifyFlow.awaitingMessage = false;
        ctx.session.notifyFlow.awaitingAsns = false;
        await showNotifyMenu(ctx, true);
    });

    // Handle text input for notify flow
    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.notifyFlow;
        if (!flow) return next();

        const text = ctx.message.text.trim();

        // If a command, cancel flow and pass through
        if (text.startsWith('/')) {
            ctx.session.notifyFlow = undefined;
            return next();
        }

        // Awaiting message content
        if (flow.awaitingMessage) {
            flow.awaitingMessage = false;
            flow.message = text;
            ctx.session.notifyFlow = flow;
            await showNotifyMenu(ctx);
            return;
        }

        // Awaiting ASN input
        if (flow.awaitingAsns) {
            const asns = text.split(',').map(s => normalizeAsn(s.trim())).filter(n => !isNaN(n));
            if (asns.length === 0) {
                await ctx.reply(
                    `❌ Invalid ASN format. Example: 998, 0998, AS4242420998\n` +
                    `无效的 ASN 格式。`
                );
                return;
            }
            flow.awaitingAsns = false;
            flow.asns = asns;
            ctx.session.notifyFlow = flow;
            await showNotifyMenu(ctx);
            return;
        }

        return next();
    });

    // ntf:preview → show confirmation
    bot.callbackQuery('ntf:preview', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery();

        const flow = ctx.session.notifyFlow;
        if (!flow?.message || !flow?.asns?.length) {
            await ctx.editMessageText('❌ Missing content or targets.\n缺少内容或目标。');
            return;
        }

        const asnList = flow.asns.map(a => `AS${a}`).join(', ');

        const keyboard = new InlineKeyboard()
            .text('✅ Send 发送', 'ntf:send')
            .text('🚫 Cancel 取消', 'ntf:cancel');

        await ctx.editMessageText(
            `🔔 *Notify Preview 通知预览*\n${DIVIDER}\n\n` +
            `*Targets 目标:* ${escapeMarkdown(asnList)}\n\n` +
            `*Content 内容:*\n${escapeMarkdown(flow.message)}\n\n` +
            `Confirm send?\n确认发送？`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    // ntf:send → execute send
    bot.callbackQuery('ntf:send', async (ctx) => {
        if (!isAdmin(ctx)) { await ctx.answerCallbackQuery('❌ Admin only'); return; }
        await ctx.answerCallbackQuery('Sending... 发送中...');

        const flow = ctx.session.notifyFlow;
        if (!flow?.message || !flow?.asns?.length) {
            await ctx.editMessageText('❌ Session expired.\n会话已过期。');
            return;
        }

        await ctx.editMessageText('⏳ Sending notifications...\n正在发送通知...');

        await executeDirectNotify(ctx, flow.asns, flow.message);
        ctx.session.notifyFlow = undefined;
    });

    // ntf:cancel → abort
    bot.callbackQuery('ntf:cancel', async (ctx) => {
        ctx.session.notifyFlow = undefined;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText('❌ Cancelled.\n已取消。');
    });

    /**
     * Execute direct notification to specific ASNs.
     *
     * Args:
     *   ctx: Bot context.
     *   asns: Target ASN list.
     *   message: Notification message text.
     */
    async function executeDirectNotify(ctx: BotContext, asns: number[], message: string) {
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'getNotificationTargets',
                asns,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Failed to get targets: ${result.message}\n获取目标失败。`);
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
            const targetedAsns = new Set(targets.map(t => Number(t.asn)));
            for (const asn of asns) {
                if (!targetedAsns.has(Number(asn))) {
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
            await ctx.reply('❌ Notification failed.\n通知发送失败。');
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

/**
 * Notify migrated users about their session migration.
 * Resolves ASN → telegramId via getNotificationTargets API.
 */
async function notifyMigratedUsers(
    ctx: BotContext,
    fromName: string,
    toName: string,
    migratedResults: Array<{ asn: number }>,
) {
    if (migratedResults.length === 0) return;

    const asns = migratedResults.map(r => r.asn);

    try {
        // Resolve ASNs to telegram IDs
        const targetsResult = await apiRequest('/admin', 'POST', {
            action: 'getNotificationTargets',
            asns,
        }, config.apiToken);

        if (targetsResult.code !== 0) {
            console.error('[MigrateNotify] Failed to resolve targets:', targetsResult.message);
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const targets = ((targetsResult.data as any)?.targets || []) as NotificationTarget[];
        let sent = 0;

        for (const target of targets) {
            const message =
                `🔄 *Peer Migration Notice*\n` +
                `Peer 迁移通知\n\n` +
                `Your peer \`AS${target.asn}\` has been migrated:\n` +
                `您的 Peer \`AS${target.asn}\` 已迁移:\n\n` +
                `📍 From 原节点: \`${fromName}\`\n` +
                `📍 To 新节点: \`${toName}\`\n\n` +
                `⚠️ *Action Required:*\n` +
                `Please update your WireGuard Endpoint to the new node's address.\n` +
                `Use \`/info\` to view your updated peer configuration.\n\n` +
                `⚠️ *需要操作:*\n` +
                `请更新您的 WireGuard Endpoint 为新节点地址。\n` +
                `使用 \`/info\` 查看更新后的 Peer 配置。`;

            try {
                await ctx.api.sendMessage(target.telegramId, message, {
                    parse_mode: 'Markdown',
                });
                sent++;
            } catch (e) {
                console.error(`[MigrateNotify] Failed to notify AS${target.asn} (${target.telegramId}):`, e);
            }
        }

        if (sent > 0) {
            await ctx.api.sendMessage(
                ctx.chat!.id,
                `📨 Migration notification sent to ${sent}/${asns.length} users.\n` +
                `已向 ${sent}/${asns.length} 个用户发送迁移通知。`
            );
        }
    } catch (error) {
        console.error('[MigrateNotify] Error:', error);
    }
}
