import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

interface APIResponse {
    code: number;
    message?: string;
    data?: {
        routers?: Array<{
            uuid: string;
            name: string;
            isOpen: boolean;
            location?: string;
            region?: string;
            endpoint?: string;
            wgPubkey?: string;
            nodeId?: number;
            maxPeers?: number;
            currentPeers?: number;
        }>;
        session?: {
            uuid: string;
            serverEndpoint?: string;
            serverPort?: number;
            serverPubkey?: string;
            serverLla?: string;
        };
        sessions?: Array<{
            uuid: string;
            router: string;
            status: number;
        }>;
        [key: string]: unknown;
    };
}

/**
 * API client for moenet-core
 */
async function apiRequest(endpoint: string, method = 'POST', body?: unknown, token?: string): Promise<APIResponse> {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<APIResponse>;
}

/**
 * Calculate user's WG port based on ASN
 */
function calculatePort(asn: number): number {
    if (asn >= 4242420000 && asn <= 4242429999) {
        return 30000 + (asn % 10000);
    } else if (asn >= 4201270000 && asn <= 4201279999) {
        return 40000 + (asn % 10000);
    } else {
        return 50000 + (asn % 10000);
    }
}

/**
 * Validate IPv6 address
 */
function isValidIPv6(ip: string): boolean {
    // Remove prefix if present
    const addr = ip.includes('/') ? ip.split('/')[0] : ip;
    // Simple validation for Link-Local and ULA
    return /^[0-9a-f:]+$/i.test(addr || '') && (addr || '').includes(':');
}

/**
 * Validate WireGuard public key
 */
function isValidWgPubkey(key: string): boolean {
    return /^[A-Za-z0-9+/]{43}=$/.test(key);
}

export function registerPeerCommands(bot: Bot<BotContext>) {
    /**
     * /peer - Start peer creation wizard
     */
    bot.command('peer', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.\\n请先登录');
            return;
        }

        const asn = ctx.session.asn;

        // Show identity confirmation
        await ctx.reply(
            `👤 *Identity Confirmation 身份确认*\\n\\n` +
            `You are logged in as \`AS${asn}\`\\n` +
            `当前登录身份: \`AS${asn}\`\\n\\n` +
            `Starting peer creation wizard...\\n` +
            `正在启动 Peer 创建向导...`,
            { parse_mode: 'Markdown' }
        );

        // Fetch available nodes
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'enumRouters',
            }, config.apiToken);

            if (result.code !== 0 || !result.data?.routers) {
                await ctx.reply('❌ Failed to fetch nodes.');
                return;
            }

            const routers = result.data.routers;

            // Build node display with status
            let nodeListText = '📡 *Node List 节点列表*\\n\\n';
            const nodeMap: Record<string, { uuid: string; endpoint: string; pubkey: string; nodeId: number }> = {};
            const peerableNodes: string[] = [];

            for (const r of routers) {
                const label = `${r.name} (${r.region || r.location || 'Unknown'})`;
                let status = '';

                if (r.isOpen) {
                    status += '✅ Open ';
                    peerableNodes.push(label);
                    nodeMap[label] = {
                        uuid: r.uuid,
                        endpoint: r.endpoint || r.name,
                        pubkey: r.wgPubkey || 'N/A',
                        nodeId: r.nodeId || 0,
                    };
                } else {
                    status += '❌ Closed ';
                }

                if (r.maxPeers && r.maxPeers > 0) {
                    const current = r.currentPeers || 0;
                    if (current >= r.maxPeers) {
                        status += `📊 Full (${current}/${r.maxPeers})`;
                    } else {
                        status += `📊 ${current}/${r.maxPeers}`;
                    }
                }

                nodeListText += `• \`${label}\` ${status}\\n`;
            }

            if (peerableNodes.length === 0) {
                await ctx.reply(
                    `${nodeListText}\\n❌ No available nodes for peering.\\n没有可用节点`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Auto-select if only one node
            if (peerableNodes.length === 1) {
                const selectedLabel = peerableNodes[0] || '';
                const nodeInfo = nodeMap[selectedLabel];
                if (!nodeInfo || !selectedLabel) return;

                const userPort = calculatePort(asn);

                ctx.session.peerFlow = {
                    step: 'show_wg_info',
                    routerName: selectedLabel.split(' (')[0],
                    routerUuid: nodeInfo.uuid,
                    serverEndpoint: nodeInfo.endpoint,
                    serverPort: userPort,
                    serverPubkey: nodeInfo.pubkey,
                    serverLla: `fe80::998:${nodeInfo.nodeId}`,
                    nodeMap,
                };

                await ctx.reply(
                    `${nodeListText}\\n只有一个可选节点，自动选择 \`${selectedLabel}\``,
                    { parse_mode: 'Markdown' }
                );

                // Show WG info
                await showServerWgInfo(ctx);
                return;
            }

            // Build keyboard for node selection
            const keyboard = new InlineKeyboard();
            peerableNodes.forEach((label, i) => {
                const nodeName = (label || '').split(' (')[0] || '';
                keyboard.text(nodeName, `peer:node:${label || ''}`);
                if ((i + 1) % 2 === 0) keyboard.row();
            });

            ctx.session.peerFlow = {
                step: 'select_node',
                nodeMap,
            };

            await ctx.reply(
                `${nodeListText}\\n选择节点 / Select node:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } catch (error) {
            console.error('[Peer] Error:', error);
            await ctx.reply('❌ Failed to fetch nodes.');
        }
    });

    /**
     * Handle node selection callback
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
            serverLla: `fe80::998:${nodeInfo.nodeId}`,
        };

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`✅ Selected: ${selectedLabel}`);
        await showServerWgInfo(ctx);
    });

    /**
     * Show server WG info with copy buttons
     */
    async function showServerWgInfo(ctx: BotContext) {
        const flow = ctx.session.peerFlow;
        if (!flow) return;

        const infoText =
            `🔧 *Server WireGuard Info*\\n服务器 WireGuard 信息\\n\\n` +
            `📍 Node: \`${flow.routerName}\`\\n` +
            `🌐 Endpoint: \`${flow.serverEndpoint}:${flow.serverPort}\`\\n` +
            `🔑 PublicKey: \`${flow.serverPubkey}\`\\n` +
            `📶 LLA: \`${flow.serverLla}\`\\n\\n` +
            `请使用以上信息配置你的 WireGuard\\n` +
            `Use above info to configure your WireGuard`;

        const keyboard = new InlineKeyboard()
            .text('Continue ➡️ 继续', 'peer:continue_to_ipv6');

        await ctx.reply(infoText, { parse_mode: 'Markdown', reply_markup: keyboard });
    }

    /**
     * Continue to IPv6 input
     */
    bot.callbackQuery('peer:continue_to_ipv6', async (ctx) => {
        if (!ctx.session.peerFlow) return;

        ctx.session.peerFlow.step = 'input_ipv6';

        // Suggest Link-Local based on ASN
        const asn = ctx.session.asn || 0;
        const suggested = asn >= 4242420000 && asn <= 4242429999 ? `fe80::${asn % 10000}` : '';

        await ctx.answerCallbackQuery();

        const keyboard = suggested ? new InlineKeyboard().text(suggested, `peer:ipv6:${suggested}`) : undefined;

        await ctx.reply(
            `📝 *Step 1: IPv6 Address*\\n第一步: IPv6 地址\\n\\n` +
            `Input your IPv6 address for BGP peering.\\n` +
            `请输入你用于 BGP 对等的 IPv6 地址。\\n\\n` +
            `Supported types 支持的类型:\\n` +
            `• \`fe80::/64\` Link-Local\\n` +
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
     * Prompt for endpoint input
     */
    async function promptEndpoint(ctx: BotContext) {
        const keyboard = new InlineKeyboard().text('None (NAT)', 'peer:endpoint:none');

        await ctx.reply(
            `📝 *Step 2: WireGuard Endpoint*\\n第二步: WireGuard 端点\\n\\n` +
            `Input your clearnet address for WireGuard tunnel.\\n` +
            `请输入你的公网地址用于 WireGuard 隧道。\\n\\n` +
            `You can use IPv4 or IPv6. Include port if needed.\\n` +
            `可使用 IPv4 或 IPv6，可包含端口如 \`example.com:51820\`\\n\\n` +
            `If behind NAT with no public IP, click "None".\\n` +
            `如果在 NAT 后无公网 IP，点击 "None"。`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    }

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
     * Prompt for public key
     */
    async function promptPubkey(ctx: BotContext) {
        await ctx.reply(
            `📝 *Step 3: WireGuard Public Key*\\n第三步: WireGuard 公钥\\n\\n` +
            `Input your WireGuard public key.\\n` +
            `请输入你的 WireGuard 公钥。\\n\\n` +
            `Format: 44 characters, ends with \`=\`\\n` +
            `格式: 44个字符，以 \`=\` 结尾`,
            { parse_mode: 'Markdown' }
        );
    }

    /**
     * Handle text input during peer flow
     */
    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.peerFlow;
        if (!flow) return next();

        const text = ctx.message.text.trim();

        // Handle /cancel
        if (text === '/cancel') {
            ctx.session.peerFlow = undefined;
            await ctx.reply('🚫 Peer creation cancelled.\\n已取消 Peer 创建');
            return;
        }

        switch (flow.step) {
            case 'input_ipv6': {
                const ipv6 = text.includes('/') ? text.split('/')[0] : text;
                if (!isValidIPv6(ipv6 || '')) {
                    await ctx.reply('❌ Invalid IPv6 address. Please try again.');
                    return;
                }
                ctx.session.peerFlow = { ...flow, step: 'input_endpoint', ipv6 };
                await promptEndpoint(ctx);
                break;
            }

            case 'input_endpoint': {
                let endpoint = text;
                let port: number | undefined;

                // Parse port from endpoint
                if (text.toLowerCase() === 'none') {
                    endpoint = '';
                } else if (text.includes(':') && !text.includes('::')) {
                    // IPv4:port or domain:port
                    const parts = text.split(':');
                    const lastPart = parts.pop();
                    if (lastPart && /^\d+$/.test(lastPart)) {
                        port = parseInt(lastPart, 10);
                        endpoint = parts.join(':');
                    }
                } else if (text.startsWith('[') && text.includes(']:')) {
                    // [IPv6]:port
                    const match = text.match(/^\[(.+)\]:(\d+)$/);
                    if (match && match[1] && match[2]) {
                        endpoint = match[1];
                        port = parseInt(match[2], 10);
                    }
                }

                ctx.session.peerFlow = { ...flow, step: port ? 'input_pubkey' : 'input_port', endpoint, port };

                if (port) {
                    await ctx.reply(`✅ Endpoint: \`${endpoint}:${port}\``, { parse_mode: 'Markdown' });
                    await promptPubkey(ctx);
                } else if (endpoint) {
                    await ctx.reply(
                        `📝 *Step 2b: WireGuard Port*\\n\\n` +
                        `Input your WireGuard listen port (1-65535).\\n` +
                        `请输入你的 WireGuard 监听端口。`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    ctx.session.peerFlow.step = 'input_pubkey';
                    await promptPubkey(ctx);
                }
                break;
            }

            case 'input_port': {
                const port = parseInt(text, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    await ctx.reply('❌ Invalid port. Please enter 1-65535.');
                    return;
                }
                ctx.session.peerFlow = { ...flow, step: 'input_pubkey', port };
                await ctx.reply(`✅ Port: \`${port}\``, { parse_mode: 'Markdown' });
                await promptPubkey(ctx);
                break;
            }

            case 'input_pubkey': {
                if (!isValidWgPubkey(text)) {
                    await ctx.reply('❌ Invalid WireGuard public key. Should be 44 characters ending with =');
                    return;
                }
                ctx.session.peerFlow = { ...flow, step: 'confirm', publicKey: text };
                await showConfirmation(ctx);
                break;
            }

            case 'confirm': {
                // Text during confirm step - ignore, they should use buttons
                await ctx.reply('Please use the buttons above to confirm or cancel.\\n请使用上方按钮确认或取消');
                break;
            }

            default:
                return next();
        }
    });

    /**
     * Show confirmation screen
     */
    async function showConfirmation(ctx: BotContext) {
        const flow = ctx.session.peerFlow;
        const asn = ctx.session.asn;
        if (!flow || !asn) return;

        const endpointDisplay = flow.endpoint && flow.port
            ? `\`${flow.endpoint}:${flow.port}\``
            : flow.endpoint
                ? `\`${flow.endpoint}\``
                : 'None (NAT)';

        const confirmText =
            `✅ *Confirm Peer Creation*\\n确认创建 Peer\\n\\n` +
            `📍 Node: \`${flow.routerName}\`\\n` +
            `🆔 ASN: \`AS${asn}\`\\n` +
            `🌐 Your IPv6: \`${flow.ipv6}\`\\n` +
            `📡 Your Endpoint: ${endpointDisplay}\\n` +
            `🔑 Your PublicKey: \`${flow.publicKey?.slice(0, 20)}...\`\\n\\n` +
            `*Server Info:*\\n` +
            `🌐 Endpoint: \`${flow.serverEndpoint}:${flow.serverPort}\`\\n` +
            `🔑 PublicKey: \`${flow.serverPubkey}\`\\n` +
            `📶 LLA: \`${flow.serverLla}\``;

        const keyboard = new InlineKeyboard()
            .text('✅ Confirm 确认', 'peer:confirm')
            .text('❌ Cancel 取消', 'peer:cancel');

        await ctx.reply(confirmText, { parse_mode: 'Markdown', reply_markup: keyboard });
    }

    /**
     * Handle confirm callback
     */
    bot.callbackQuery('peer:confirm', async (ctx) => {
        const flow = ctx.session.peerFlow;
        const asn = ctx.session.asn;
        if (!flow || !asn) return;

        await ctx.answerCallbackQuery('Creating peer...');
        await ctx.editMessageText('⏳ Creating peer...\\n正在创建 Peer...');

        try {
            // Call API to create session
            const result = await apiRequest('/session', 'POST', {
                action: 'create',
                asn,
                router: flow.routerUuid,
                ipv6: flow.ipv6,
                endpoint: flow.endpoint && flow.port ? `${flow.endpoint}:${flow.port}` : undefined,
                publicKey: flow.publicKey,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Failed to create peer: ${result.message}`);
                ctx.session.peerFlow = undefined;
                return;
            }

            // Success!
            const successText =
                `🎉 *Peer Created Successfully!*\\n成功创建 Peer!\\n\\n` +
                `Your peer request has been submitted.\\n` +
                `已提交 Peer 请求。\\n\\n` +
                `📍 Node: \`${flow.routerName}\`\\n` +
                `🆔 ASN: \`AS${asn}\`\\n\\n` +
                `*Your WireGuard Config:*\\n` +
                `\`\`\`\\n` +
                `[Peer]\\n` +
                `PublicKey = ${flow.serverPubkey}\\n` +
                `Endpoint = ${flow.serverEndpoint}:${flow.serverPort}\\n` +
                `AllowedIPs = 172.20.0.0/14, 172.31.0.0/16, fd00::/8, fe80::/64\\n` +
                `\`\`\`\\n\\n` +
                `⏳ Status: Pending Review\\n` +
                `等待管理员审核`;

            await ctx.reply(successText, { parse_mode: 'Markdown' });
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
        await ctx.editMessageText('🚫 Peer creation cancelled.\\n已取消 Peer 创建');
    });

    /**
     * /info - Show peer info
     */
    bot.command('info', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.\\n请先登录');
            return;
        }

        try {
            const result = await apiRequest('/session', 'POST', {
                action: 'list',
                asn: ctx.session.asn,
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = result.data?.sessions || [];

            if (sessions.length === 0) {
                await ctx.reply('ℹ️ You have no peers.\\n你没有 Peer');
                return;
            }

            let message = `📊 *Peer Info for AS${ctx.session.asn}*\\n\\n`;

            sessions.forEach((s, i) => {
                const statusIcon = s.status === 1 ? '🟢 Active' : s.status === 3 ? '⏳ Pending' : '❌ Inactive';
                message += `${i + 1}. ${statusIcon} @ ${s.router}\\n`;
            });

            await ctx.reply(message, { parse_mode: 'Markdown' });
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
            await ctx.reply('❌ Please /login first.\\n请先登录');
            return;
        }

        await ctx.reply(
            '🔧 *Modify Peer*\\n\\n' +
            'This feature is under development.',
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /remove - Remove peer
     */
    bot.command('remove', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ Please /login first.\\n请先登录');
            return;
        }

        await ctx.reply(
            '🗑️ *Remove Peer*\\n\\n' +
            'This feature is under development.',
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /restart - Restart WireGuard tunnel and BGP session
     */
    bot.command('restart', async (ctx) => {
        // Check if admin specifying ASN
        const args = ctx.match?.trim().split(/\s+/) || [];
        let targetAsn = ctx.session.asn;

        const username = ctx.from?.username?.toLowerCase();
        const adminUsername = config.adminUsername?.toLowerCase().replace('@', '');
        const isAdmin = username === adminUsername || ctx.session.isAdmin === true;

        if (args[0] && /^\d+$/.test(args[0].replace(/^AS/i, ''))) {
            if (!isAdmin) {
                await ctx.reply('❌ Only admin can restart other ASN peers\\n只有管理员可以重启其他 ASN 的 Peer');
                return;
            }
            targetAsn = parseInt(args[0].replace(/^AS/i, ''), 10);
        }

        if (!targetAsn) {
            await ctx.reply('❌ Please /login first.\\n请先登录');
            return;
        }

        // Fetch user's active sessions
        try {
            const result = await apiRequest('/session', 'POST', {
                action: 'list',
                asn: targetAsn,
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = (result.data?.sessions || []).filter(s => s.status === 1);

            if (sessions.length === 0) {
                await ctx.reply(`❌ AS${targetAsn} has no active peers\\nAS${targetAsn} 没有活跃的 Peer`);
                return;
            }

            if (sessions.length === 1) {
                const session = sessions[0];
                if (session) {
                    await executeRestart(ctx, targetAsn, session.router, session.uuid);
                }
            } else {
                const keyboard = new InlineKeyboard();
                for (const s of sessions) {
                    keyboard.text(s.router, `restart:${targetAsn}:${s.uuid}:${s.router}`).row();
                }
                await ctx.reply(
                    `🔄 *Restart Peer*\\n重启 Peer\\n\\n` +
                    `Select node for AS${targetAsn}:\\n选择要重启的节点:`,
                    { parse_mode: 'Markdown', reply_markup: keyboard }
                );
            }
        } catch (_error) {
            console.error('[Restart] Error:', _error);
            await ctx.reply('❌ Failed to fetch sessions.');
        }
    });

    // Handle restart selection callback
    bot.callbackQuery(/^restart:(\d+):([^:]+):(.+)$/, async (ctx) => {
        const asn = parseInt(ctx.match?.[1] || '0', 10);
        const uuid = ctx.match?.[2] || '';
        const router = ctx.match?.[3] || '';

        if (!asn || !uuid || !router) return;

        await ctx.answerCallbackQuery('Restarting...');
        await executeRestart(ctx, asn, router, uuid);
    });

    async function executeRestart(ctx: BotContext, asn: number, router: string, _uuid: string) {
        await ctx.reply(`⏳ Restarting peer for AS${asn} @ ${router}...\\n正在重启...`);

        try {
            const { getAgentEndpoint } = await import('../providers/nodes');
            const endpoint = await getAgentEndpoint(router);

            if (!endpoint) {
                await ctx.reply(`❌ Cannot reach agent for ${router}`);
                return;
            }

            const peerName = `dn42_${asn}`;
            const response = await fetch(`${endpoint}/restart`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.agentToken || ''}`,
                },
                body: JSON.stringify({ peer_name: peerName }),
            });

            if (response.ok) {
                const data = await response.json() as { message?: string; steps?: string[] };
                await ctx.reply(
                    `✅ *Peer Restarted*\\n已重启 Peer\\n\\n` +
                    `AS${asn} @ ${router}\\n` +
                    `${data.message || 'BGP session restarted'}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                const error = await response.text();
                await ctx.reply(`❌ Restart failed: ${error}`);
            }
        } catch (error) {
            console.error('[Restart] Error:', error);
            await ctx.reply(`❌ Failed to restart: ${(error as Error).message}`);
        }
    }
}
