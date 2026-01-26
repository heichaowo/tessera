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
     * /help - Show all available commands
     */
    bot.command(['help', 'start'], async (ctx) => {
        const isAdmin = ctx.session.isAdmin === true ||
            ctx.from?.username?.toLowerCase() === config.adminUsername?.toLowerCase().replace('@', '');

        let helpText =
            `🌐 *MoeNet DN42 Bot*\\n\\n` +
            `*User Commands 用户命令:*\\n` +
            `• /login - Login with ASN 登录\\n` +
            `• /peer - Create new peer 创建 Peer\\n` +
            `• /info - View your peers 查看 Peer 列表\\n` +
            `• /modify - Modify peer 修改 Peer\\n` +
            `• /remove - Remove peer 删除 Peer\\n` +
            `• /status - WG/BGP status 状态查询\\n` +
            `• /restart - Restart WG+BGP 重启\\n\\n` +
            `*Network Tools 网络工具:*\\n` +
            `• /lg - Looking glass 路由查询\\n` +
            `• /ping - Ping test 连通测试\\n` +
            `• /whois - DN42 Whois 查询\\n` +
            `• /cancel - Cancel operation 取消操作\\n`;

        if (isAdmin) {
            helpText += `\\n*Admin Commands 管理员命令:*\\n` +
                `• /addpeer - Add peer for user\\n` +
                `• /pending - Pending approvals\\n` +
                `• /nodes - Node list\\n`;
        }

        helpText += `\\n📞 Contact: ${config.telegramContact || '@heicha'}`;

        await ctx.reply(helpText, { parse_mode: 'Markdown' });
    });

    /**
     * /cancel - Cancel current operation
     */
    bot.command('cancel', async (ctx) => {
        if (ctx.session.peerFlow) {
            ctx.session.peerFlow = undefined;
            await ctx.reply('🚫 Operation cancelled.\\n已取消当前操作');
        } else {
            await ctx.reply('ℹ️ No active operation to cancel.\\n没有进行中的操作');
        }
    });

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
     * Prompt for MTU selection
     */
    async function promptMtu(ctx: BotContext) {
        const keyboard = new InlineKeyboard()
            .text('1420 (默认)', 'peer:mtu:1420')
            .text('1400', 'peer:mtu:1400')
            .row()
            .text('1380', 'peer:mtu:1380')
            .text('1280', 'peer:mtu:1280');

        await ctx.reply(
            `📝 *Step 4: MTU Setting*\\n第四步: MTU 设置\\n\\n` +
            `Select WireGuard MTU:\\n选择 WireGuard MTU:\\n\\n` +
            `• \`1420\` - 默认 / Default\\n` +
            `• \`1400\` - 适用于某些 VPS\\n` +
            `• \`1380\` - 有额外封装时\\n` +
            `• \`1280\` - IPv6 最小值`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    }

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
     * Prompt for PSK option
     */
    async function promptPsk(ctx: BotContext) {
        const keyboard = new InlineKeyboard()
            .text('🔄 Auto Generate 自动生成', 'peer:psk:auto')
            .row()
            .text('❌ No PSK 不使用', 'peer:psk:none');

        await ctx.reply(
            `📝 *Step 5: Pre-Shared Key (PSK)*\\n第五步: 预共享密钥\\n\\n` +
            `Use PSK for extra security?\\n使用 PSK 增加安全性?\\n\\n` +
            `• 🔄 Auto Generate - 自动生成 PSK\\n` +
            `• ❌ No PSK - 不使用 PSK`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    }

    /**
     * Handle PSK selection callback
     */
    bot.callbackQuery(/^peer:psk:(auto|none)$/, async (ctx) => {
        const choice = ctx.match?.[1];
        if (!ctx.session.peerFlow) return;

        if (choice === 'auto') {
            // Generate PSK (32 bytes base64)
            const psk = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
            ctx.session.peerFlow.psk = psk;
            await ctx.answerCallbackQuery();
            await ctx.editMessageText(`✅ PSK Generated`);
            await ctx.reply(
                `🔑 *PSK Generated*\\n已生成 PSK\\n\\n` +
                `\`${psk}\`\\n\\n` +
                `⚠️ Save this key! You need to configure it on your side.\\n` +
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
                ctx.session.peerFlow = { ...flow, step: 'input_mtu', publicKey: text };
                await promptMtu(ctx);
                break;
            }

            case 'input_mtu': {
                const mtu = parseInt(text, 10);
                if (isNaN(mtu) || mtu < 1280 || mtu > 1500) {
                    await ctx.reply('❌ Invalid MTU. Please enter 1280-1500.');
                    return;
                }
                ctx.session.peerFlow = { ...flow, step: 'input_psk', mtu };
                await promptPsk(ctx);
                break;
            }

            case 'confirm': {
                // Text during confirm step - ignore, they should use buttons
                await ctx.reply('Please use the buttons above to confirm or cancel.\\n请使用上方按钮确认或取消');
                break;
            }

            // Modify handlers
            case 'modify_ipv6': {
                const ipv6 = text.includes('/') ? text.split('/')[0] : text;
                if (!isValidIPv6(ipv6 || '')) {
                    await ctx.reply('❌ Invalid IPv6 address. Please try again.');
                    return;
                }

                try {
                    const result = await apiRequest('/session', 'POST', {
                        action: 'update',
                        uuid: flow.routerUuid,
                        ipv6,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ IPv6 updated to \`${ipv6}\`\\nIPv6 已更新`, { parse_mode: 'Markdown' });
                    }
                } catch (e) {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_endpoint': {
                const uuid = flow.routerUuid;
                let endpoint: string | null = null;
                let port: number | null = null;

                if (text.toLowerCase() !== 'none') {
                    // Parse endpoint:port
                    if (text.includes(':')) {
                        const parts = text.split(':');
                        const lastPart = parts.pop();
                        if (lastPart && /^\d+$/.test(lastPart)) {
                            port = parseInt(lastPart, 10);
                            endpoint = parts.join(':');
                        } else {
                            endpoint = text;
                        }
                    } else {
                        endpoint = text;
                    }
                }

                try {
                    const result = await apiRequest('/session', 'POST', {
                        action: 'update',
                        uuid,
                        endpoint,
                        port,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Endpoint updated!\\n端点已更新`);
                    }
                } catch (e) {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_pubkey': {
                if (!isValidWgPubkey(text)) {
                    await ctx.reply('❌ Invalid public key. Should be 44 chars ending with =');
                    return;
                }

                try {
                    const result = await apiRequest('/session', 'POST', {
                        action: 'update',
                        uuid: flow.routerUuid,
                        publicKey: text,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Public key updated!\\n公钥已更新`);
                    }
                } catch (e) {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_mtu': {
                const mtu = parseInt(text, 10);
                if (isNaN(mtu) || mtu < 1280 || mtu > 1500) {
                    await ctx.reply('❌ Invalid MTU. Please enter 1280-1500.');
                    return;
                }

                try {
                    const result = await apiRequest('/session', 'POST', {
                        action: 'update',
                        uuid: flow.routerUuid,
                        mtu,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ MTU updated to ${mtu}!\\nMTU 已更新为 ${mtu}`);
                    }
                } catch (e) {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
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

        const pskDisplay = flow.psk ? '✅ Enabled' : '❌ Disabled';

        const confirmText =
            `✅ *Confirm Peer Creation*\\n确认创建 Peer\\n\\n` +
            `📍 Node: \`${flow.routerName}\`\\n` +
            `🆔 ASN: \`AS${asn}\`\\n` +
            `🌐 Your IPv6: \`${flow.ipv6}\`\\n` +
            `📡 Your Endpoint: ${endpointDisplay}\\n` +
            `🔑 Your PublicKey: \`${flow.publicKey?.slice(0, 20)}...\`\\n` +
            `📏 MTU: \`${flow.mtu || 1420}\`\\n` +
            `🔐 PSK: ${pskDisplay}\\n\\n` +
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
        // Use targetAsn for admin mode, otherwise session asn
        const asn = flow?.isAdminMode ? flow.targetAsn : ctx.session.asn;
        if (!flow || !asn) return;

        await ctx.answerCallbackQuery('Creating peer...');
        await ctx.editMessageText('⏳ Creating peer...\\n正在创建 Peer...');

        try {
            // Call API to create session - use adminCreate for admin mode
            const action = flow.isAdminMode ? 'adminCreate' : 'create';
            const result = await apiRequest('/session', 'POST', {
                action,
                asn,
                router: flow.routerUuid,
                ipv6: flow.ipv6,
                endpoint: flow.endpoint && flow.port ? `${flow.endpoint}:${flow.port}` : undefined,
                publicKey: flow.publicKey,
                mtu: flow.mtu || 1420,
                psk: flow.psk,
                status: flow.isAdminMode ? 1 : undefined, // ACTIVE for admin, undefined for normal
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.reply(`❌ Failed to create peer: ${result.message}`);
                ctx.session.peerFlow = undefined;
                return;
            }

            // Success message differs based on mode
            const statusText = flow.isAdminMode
                ? `✅ Status: ACTIVE (免审核)`
                : `⏳ Status: Pending Review\\n等待管理员审核`;

            const successText =
                `🎉 *Peer Created Successfully!*\\n成功创建 Peer!\\n\\n` +
                `📍 Node: \`${flow.routerName}\`\\n` +
                `🆔 ASN: \`AS${asn}\`\\n\\n` +
                `*Your WireGuard Config:*\\n` +
                `\`\`\`\\n` +
                `[Peer]\\n` +
                `PublicKey = ${flow.serverPubkey}\\n` +
                `Endpoint = ${flow.serverEndpoint}:${flow.serverPort}\\n` +
                `AllowedIPs = 172.20.0.0/14, 172.31.0.0/16, fd00::/8, fe80::/64\\n` +
                `\`\`\`\\n\\n` +
                statusText;

            await ctx.reply(successText, { parse_mode: 'Markdown' });

            // Notify admin if not in admin mode
            if (!flow.isAdminMode && config.adminChatId) {
                try {
                    const adminNotification =
                        `🔔 *New Peer Request*\\n新的 Peer 申请\\n\\n` +
                        `🆔 ASN: \`AS${asn}\`\\n` +
                        `📍 Node: \`${flow.routerName}\`\\n` +
                        `🌐 IPv6: \`${flow.ipv6}\`\\n` +
                        `📡 Endpoint: ${flow.endpoint ? `\`${flow.endpoint}:${flow.port}\`` : 'NAT'}\\n\\n` +
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

            const sessions: Array<{ uuid: string; router: string; status: number; ipv6?: string; endpoint?: string }> = result.data?.sessions || [];

            if (sessions.length === 0) {
                await ctx.reply(
                    `📊 *Peer Info for AS${ctx.session.asn}*\\n\\n` +
                    `You have no peers.\\n你没有 Peer\\n\\n` +
                    `Use /peer to create one.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            let message = `📊 *Peer Info for AS${ctx.session.asn}*\\n\\n`;

            for (const [i, s] of sessions.entries()) {
                const statusIcon = s.status === 1 ? '🟢' : s.status === 3 ? '⏳' : '❌';
                const statusText = s.status === 1 ? 'Active' : s.status === 3 ? 'Pending' : 'Inactive';

                message += `*${i + 1}. ${s.router}* ${statusIcon} ${statusText}\\n`;

                if (s.ipv6) message += `   IPv6: \`${s.ipv6}\`\\n`;
                if (s.endpoint) message += `   Endpoint: \`${s.endpoint}\`\\n`;
                message += `\\n`;
            }

            const keyboard = new InlineKeyboard()
                .text('🔄 Check Status', 'info:status')
                .text('🔧 Modify', 'info:modify');

            await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
        } catch (error) {
            console.error('[Info] Error:', error);
            await ctx.reply('❌ Failed to fetch peer info.');
        }
    });

    // Handle info:status and info:modify callbacks
    bot.callbackQuery('info:status', async (ctx) => {
        await ctx.answerCallbackQuery('Use /status command');
        await ctx.reply('Use /status to check WG/BGP status\\n使用 /status 查看状态');
    });

    bot.callbackQuery('info:modify', async (ctx) => {
        await ctx.answerCallbackQuery('Use /modify command');
        await ctx.reply('Use /modify to modify a peer\\n使用 /modify 修改 Peer');
    });

    /**
     * /modify - Modify existing peer
     */
    bot.command('modify', async (ctx) => {
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
                await ctx.reply('ℹ️ You have no peers to modify.\\n你没有可修改的 Peer');
                return;
            }

            // Build selection keyboard
            const keyboard = new InlineKeyboard();
            sessions.forEach((s: { uuid: string; router: string; status: number }) => {
                const statusIcon = s.status === 1 ? '🟢' : s.status === 3 ? '⏳' : '❌';
                keyboard.text(`${statusIcon} ${s.router}`, `modify:peer:${s.uuid}`).row();
            });
            keyboard.text('🚫 Cancel 取消', 'modify:cancel');

            await ctx.reply(
                `🔧 *Modify Peer*\\n修改 Peer\\n\\n` +
                `Select peer to modify:\\n选择要修改的 Peer:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } catch (error) {
            console.error('[Modify] Error:', error);
            await ctx.reply('❌ Failed to fetch peers.');
        }
    });

    /**
     * Handle modify peer selection - show field selection
     */
    bot.callbackQuery(/^modify:peer:(.+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        if (!uuid) return;

        await ctx.answerCallbackQuery();

        const keyboard = new InlineKeyboard()
            .text('🌐 IPv6', `modify:field:${uuid}:ipv6`)
            .text('📡 Endpoint', `modify:field:${uuid}:endpoint`).row()
            .text('🔑 PubKey', `modify:field:${uuid}:pubkey`)
            .text('📏 MTU', `modify:field:${uuid}:mtu`).row()
            .text('🔐 PSK', `modify:field:${uuid}:psk`).row()
            .text('🚫 Cancel 取消', 'modify:cancel');

        await ctx.editMessageText(
            `🔧 *Modify Peer*\\n修改 Peer\\n\\n` +
            `Session: \`${uuid.slice(0, 8)}...\`\\n\\n` +
            `Select field to modify:\\n选择要修改的字段:`,
            { parse_mode: 'Markdown', reply_markup: keyboard }
        );
    });

    /**
     * Handle modify field selection - prompt for new value
     */
    bot.callbackQuery(/^modify:field:(.+):(.+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        const field = ctx.match?.[2];
        if (!uuid || !field) return;

        await ctx.answerCallbackQuery();

        // Store modify state in peerFlow
        ctx.session.peerFlow = {
            step: `modify_${field}`,
            routerUuid: uuid,
        };

        let promptText = '';
        let keyboard: InlineKeyboard | undefined;
        switch (field) {
            case 'ipv6':
                promptText = `🌐 *Modify IPv6*\\n\\n` +
                    `Enter new IPv6 address for BGP:\\n` +
                    `输入新的 BGP IPv6 地址:\\n\\n` +
                    `Supported: \`fe80::/64\` Link-Local or \`fc00::/7\` ULA`;
                break;
            case 'endpoint':
                promptText = `📡 *Modify Endpoint*\\n\\n` +
                    `Enter new endpoint (domain:port or IP:port):\\n` +
                    `输入新端点 (域名:端口 或 IP:端口):\\n\\n` +
                    `Example: \`tunnel.example.com:51820\`\\n` +
                    `Or send "none" for no endpoint`;
                break;
            case 'pubkey':
                promptText = `🔑 *Modify Public Key*\\n\\n` +
                    `Enter new WireGuard public key:\\n` +
                    `输入新的 WireGuard 公钥:\\n\\n` +
                    `Format: 44 characters, ends with \`=\``;
                break;
            case 'mtu':
                promptText = `📏 *Modify MTU*\\n\\n` +
                    `Enter new MTU (1280-1500):\\n` +
                    `输入新的 MTU (1280-1500):`;
                break;
            case 'psk':
                promptText = `🔐 *Modify PSK*\\n\\n` +
                    `Choose action:\\n选择操作:`;
                keyboard = new InlineKeyboard()
                    .text('🔄 Generate New 生成新密钥', `modify:psk:${uuid}:generate`).row()
                    .text('❌ Disable PSK 禁用', `modify:psk:${uuid}:disable`).row()
                    .text('🚫 Cancel 取消', 'modify:cancel');
                ctx.session.peerFlow = undefined; // PSK uses buttons, not text
                break;
        }

        await ctx.editMessageText(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    /**
     * Handle modify cancel
     */
    bot.callbackQuery('modify:cancel', async (ctx) => {
        ctx.session.peerFlow = undefined;
        await ctx.answerCallbackQuery('Cancelled');
        await ctx.editMessageText('🚫 Modify cancelled.\\n已取消修改');
    });

    /**
     * Handle PSK modify callbacks
     */
    bot.callbackQuery(/^modify:psk:(.+):(generate|disable)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        const action = ctx.match?.[2];
        if (!uuid || !action) return;

        await ctx.answerCallbackQuery('Updating...');

        try {
            let psk: string | null = null;
            if (action === 'generate') {
                psk = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
            }

            const result = await apiRequest('/session', 'POST', {
                action: 'update',
                uuid,
                psk,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed: ${result.message}`);
                return;
            }

            if (action === 'generate') {
                await ctx.editMessageText(
                    `✅ *PSK Updated*\\n已更新 PSK\\n\\n` +
                    `New PSK:\\n\`${psk}\`\\n\\n` +
                    `⚠️ Save this key! Configure it on your side.\\n` +
                    `请保存并在你的配置中使用此密钥。`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.editMessageText('✅ PSK disabled\\nPSK 已禁用');
            }
        } catch (error) {
            console.error('[Modify PSK] Error:', error);
            await ctx.editMessageText('❌ Update failed');
        }
    });

    /**
     * /remove - Remove peer
     */
    bot.command('remove', async (ctx) => {
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
                await ctx.reply('ℹ️ You have no peers to remove.\\n你没有可删除的 Peer');
                return;
            }

            // Build selection keyboard
            const keyboard = new InlineKeyboard();
            sessions.forEach((s: { uuid: string; router: string; status: number }) => {
                const statusIcon = s.status === 1 ? '🟢' : s.status === 3 ? '⏳' : '❌';
                keyboard.text(`${statusIcon} ${s.router}`, `remove:select:${s.uuid}`).row();
            });
            keyboard.text('🚫 Cancel 取消', 'remove:cancel');

            await ctx.reply(
                `🗑️ *Remove Peer*\\n删除 Peer\\n\\n` +
                `Select peer to remove:\\n选择要删除的 Peer:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } catch (error) {
            console.error('[Remove] Error:', error);
            await ctx.reply('❌ Failed to fetch peers.');
        }
    });

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
            `⚠️ *Confirm Deletion*\\n确认删除\\n\\n` +
            `Are you sure you want to remove this peer?\\n` +
            `确定要删除此 Peer 吗?\\n\\n` +
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
            const result = await apiRequest('/session', 'POST', {
                action: 'delete',
                uuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed to remove: ${result.message}`);
                return;
            }

            await ctx.editMessageText('✅ Peer removed successfully!\\n成功删除 Peer!');
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
        await ctx.editMessageText('🚫 Remove cancelled.\\n已取消删除');
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

    /**
     * /status - Show WireGuard and BGP status for all peers
     */
    bot.command('status', async (ctx) => {
        const asn = ctx.session.asn;
        if (!asn) {
            await ctx.reply('❌ Please /login first.\\n请先登录');
            return;
        }

        await ctx.reply('⏳ Checking status...\\n正在检查状态...');

        try {
            // Get user's sessions
            const result = await apiRequest('/session', 'POST', {
                action: 'list',
                asn,
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = (result.data?.sessions || []).filter((s: { status: number }) => s.status === 1);

            if (sessions.length === 0) {
                await ctx.reply('ℹ️ You have no active peers.\\n你没有活跃的 Peer');
                return;
            }

            // Check status for each session
            const { getAgentEndpoint } = await import('../providers/nodes');
            let statusMessage = `📊 *Status for AS${asn}*\\n\\n`;

            for (const session of sessions) {
                const router = session.router;
                statusMessage += `📍 *${router}*\\n`;

                try {
                    const endpoint = await getAgentEndpoint(router);
                    if (!endpoint) {
                        statusMessage += `   ❌ Agent unreachable\\n\\n`;
                        continue;
                    }

                    const peerName = `dn42_${asn}`;
                    const response = await fetch(`${endpoint}/status/${peerName}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${config.agentToken || ''}`,
                        },
                    });

                    if (response.ok) {
                        const data = await response.json() as {
                            wg_status?: string;
                            bgp_status?: string;
                            last_handshake?: string;
                            transfer?: { rx: string; tx: string };
                        };

                        const wgIcon = data.wg_status === 'up' ? '🟢' : '🔴';
                        const bgpIcon = data.bgp_status?.includes('Established') ? '🟢' : '🟡';

                        statusMessage += `   WG: ${wgIcon} ${data.wg_status || 'unknown'}\\n`;
                        statusMessage += `   BGP: ${bgpIcon} ${data.bgp_status || 'unknown'}\\n`;
                        if (data.last_handshake) {
                            statusMessage += `   Handshake: ${data.last_handshake}\\n`;
                        }
                        if (data.transfer) {
                            statusMessage += `   Traffic: ↓${data.transfer.rx} ↑${data.transfer.tx}\\n`;
                        }
                    } else {
                        statusMessage += `   ⚠️ Status check failed\\n`;
                    }
                } catch (e) {
                    statusMessage += `   ❌ Error checking status\\n`;
                }
                statusMessage += `\\n`;
            }

            await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Status] Error:', error);
            await ctx.reply('❌ Failed to check status.');
        }
    });

    /**
     * /lg - Looking Glass for route queries
     * Usage: /lg <prefix> [node]
     */
    bot.command('lg', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];

        if (args.length === 0 || args[0] === '') {
            await ctx.reply(
                `🔍 *Looking Glass*\\n路由查询\\n\\n` +
                `Usage 用法:\\n` +
                `\`/lg <prefix>\` - 查询路由\\n` +
                `\`/lg <prefix> <node>\` - 指定节点查询\\n\\n` +
                `Example 示例:\\n` +
                `\`/lg 172.20.0.0/14\`\\n` +
                `\`/lg fd00::/8 hk-edge\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const prefix = args[0] || '';
        const nodeName = args[1];

        await ctx.reply(`⏳ Looking up routes for \`${prefix}\`...`, { parse_mode: 'Markdown' });

        try {
            const { getAgentEndpoint, getAllNodes } = await import('../providers/nodes');
            let nodes: string[] = [];

            if (nodeName) {
                nodes = [nodeName];
            } else {
                // Query first available node
                const allNodes = await getAllNodes();
                nodes = allNodes.slice(0, 1);
            }

            if (nodes.length === 0) {
                await ctx.reply('❌ No nodes available');
                return;
            }

            let resultMessage = `🔍 *Route Lookup: \`${prefix}\`*\\n\\n`;

            for (const node of nodes) {
                const endpoint = await getAgentEndpoint(node);
                if (!endpoint) {
                    resultMessage += `📍 *${node}*: ❌ Unreachable\\n\\n`;
                    continue;
                }

                try {
                    const response = await fetch(`${endpoint}/route/${encodeURIComponent(prefix)}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${config.agentToken || ''}`,
                        },
                    });

                    if (response.ok) {
                        const data = await response.json() as {
                            routes?: Array<{
                                network: string;
                                via?: string;
                                as_path?: string;
                                best?: boolean;
                            }>;
                        };

                        resultMessage += `📍 *${node}*\\n`;
                        if (data.routes && data.routes.length > 0) {
                            for (const route of data.routes.slice(0, 5)) {
                                const best = route.best ? '★ ' : '  ';
                                resultMessage += `${best}\`${route.network}\`\\n`;
                                if (route.via) resultMessage += `    via ${route.via}\\n`;
                                if (route.as_path) resultMessage += `    AS path: ${route.as_path}\\n`;
                            }
                            if (data.routes.length > 5) {
                                resultMessage += `   ... and ${data.routes.length - 5} more\\n`;
                            }
                        } else {
                            resultMessage += `   No routes found\\n`;
                        }
                    } else {
                        resultMessage += `📍 *${node}*: ⚠️ Query failed\\n`;
                    }
                } catch (e) {
                    resultMessage += `📍 *${node}*: ❌ Error\\n`;
                }
                resultMessage += `\\n`;
            }

            await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[LG] Error:', error);
            await ctx.reply('❌ Route lookup failed.');
        }
    });

    /**
     * /ping - Ping test from nodes
     * Usage: /ping <target> [node]
     */
    bot.command('ping', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];

        if (args.length === 0 || args[0] === '') {
            await ctx.reply(
                `🏓 *Ping Test*\\n\\n` +
                `Usage: \`/ping <target> [node]\`\\n\\n` +
                `Examples:\\n` +
                `\`/ping 172.20.0.53\`\\n` +
                `\`/ping fd00::1 hk-edge\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        const target = args[0];
        const nodeName = args[1];

        await ctx.reply(`🏓 Pinging \`${target}\`...`, { parse_mode: 'Markdown' });

        try {
            const { getAgentEndpoint, getAllNodes } = await import('../providers/nodes');
            const nodes = nodeName ? [nodeName] : (await getAllNodes()).slice(0, 1);

            if (nodes.length === 0) {
                await ctx.reply('❌ No nodes available');
                return;
            }

            let resultMessage = `🏓 *Ping Results for \`${target}\`*\\n\\n`;

            for (const node of nodes) {
                const endpoint = await getAgentEndpoint(node);
                if (!endpoint) {
                    resultMessage += `📍 *${node}*: ❌ Unreachable\\n`;
                    continue;
                }

                try {
                    const response = await fetch(`${endpoint}/ping`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.agentToken || ''}`,
                        },
                        body: JSON.stringify({ target }),
                    });

                    if (response.ok) {
                        const data = await response.json() as {
                            success?: boolean;
                            rtt?: string;
                            loss?: string;
                        };

                        if (data.success) {
                            resultMessage += `📍 *${node}*: ✅ ${data.rtt || 'OK'}\\n`;
                        } else {
                            resultMessage += `📍 *${node}*: ❌ ${data.loss || 'Failed'}\\n`;
                        }
                    } else {
                        resultMessage += `📍 *${node}*: ⚠️ Error\\n`;
                    }
                } catch (e) {
                    resultMessage += `📍 *${node}*: ❌ Error\\n`;
                }
            }

            await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Ping] Error:', error);
            await ctx.reply('❌ Ping failed.');
        }
    });

    /**
     * /whois - DN42 Whois lookup
     * Usage: /whois <query>
     */
    bot.command('whois', async (ctx) => {
        const query = ctx.match?.trim();

        if (!query) {
            await ctx.reply(
                `🔍 *DN42 Whois*\\n\\n` +
                `Usage: \`/whois <query>\`\\n\\n` +
                `Examples:\\n` +
                `\`/whois AS4242420998\`\\n` +
                `\`/whois 172.20.0.0/14\`\\n` +
                `\`/whois MOENET-MNT\``,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        await ctx.reply(`🔍 Looking up \`${query}\`...`, { parse_mode: 'Markdown' });

        try {
            // Query DN42 whois server
            const response = await fetch(`https://explorer.burble.com/api/registry/aut-num/${encodeURIComponent(query)}`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
            });

            if (response.ok) {
                const data = await response.json() as Record<string, unknown>;
                let result = `🔍 *Whois: \`${query}\`*\\n\\n`;

                // Format key fields
                const fields = ['aut-num', 'as-name', 'descr', 'admin-c', 'tech-c', 'mnt-by'];
                for (const field of fields) {
                    if (data[field]) {
                        const value = Array.isArray(data[field]) ? (data[field] as string[]).join(', ') : data[field];
                        result += `*${field}*: \`${value}\`\\n`;
                    }
                }

                await ctx.reply(result || `No data found for ${query}`, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply(`ℹ️ No results for \`${query}\``, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('[Whois] Error:', error);
            await ctx.reply('❌ Whois lookup failed.');
        }
    });
}
