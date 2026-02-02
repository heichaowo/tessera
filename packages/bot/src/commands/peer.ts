import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import { isChinaIP, resolveEndpoint, CN_REJECTION_MESSAGE } from '../providers/chinaIp';

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
            await ctx.reply('❌ Please /login first.\n请先登录');
            return;
        }

        const asn = ctx.session.asn;

        // Show identity confirmation
        await ctx.reply(
            `👤 *Identity Confirmation 身份确认*\n\n` +
            `You are logged in as \`AS${asn}\`\n` +
            `当前登录身份: \`AS${asn}\`\n\n` +
            `_Use /cancel at any step to cancel / 任意步骤输入 /cancel 可取消_\n\n` +
            `Starting peer creation wizard...\n` +
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
            let nodeListText = '📡 *Node List 节点列表*\n\n';
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

                nodeListText += `• \`${label}\` ${status}\n`;
            }

            if (peerableNodes.length === 0) {
                await ctx.reply(
                    `${nodeListText}\n❌ No available nodes for peering.\n没有可用节点`,
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
                    `${nodeListText}\n只有一个可选节点，自动选择 \`${selectedLabel}\``,
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
                `${nodeListText}\n选择节点 / Select node:`,
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
            `🔧 *Server WireGuard Info*\n服务器 WireGuard 信息\n\n` +
            `📍 Node: \`${flow.routerName}\`\n` +
            `🌐 Endpoint: \`${flow.serverEndpoint}:${flow.serverPort}\`\n` +
            `🔑 PublicKey: \`${flow.serverPubkey}\`\n` +
            `📶 LLA: \`${flow.serverLla}\`\n\n` +
            `请使用以上信息配置你的 WireGuard\n` +
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
     * Prompt for endpoint input
     */
    async function promptEndpoint(ctx: BotContext) {
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
    async function promptMtu(ctx: BotContext) {
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
            `📝 *Step 5: Pre-Shared Key (PSK)*\n第五步: 预共享密钥\n\n` +
            `Use PSK for extra security?\n使用 PSK 增加安全性?\n\n` +
            `• 🔄 Auto Generate - 自动生成 PSK\n` +
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
            await ctx.reply('🚫 Peer creation cancelled.\n已取消 Peer 创建');
            return;
        }

        switch (flow.step) {
            // ===== Modify menu handlers (dn42-bot style) =====
            case 'modify_menu': {
                const uuid = flow.routerUuid;
                if (!uuid) {
                    ctx.session.peerFlow = undefined;
                    return;
                }

                // Handle Abort modification
                if (text === 'Abort modification' || text === '/cancel') {
                    ctx.session.peerFlow = undefined;
                    await ctx.reply(
                        'Abort modification, operation has been canceled.\n放弃修改，操作已取消。',
                        { reply_markup: { remove_keyboard: true } }
                    );
                    return;
                }

                // Handle Finish modification
                if (text === 'Finish modification') {
                    const backup = flow.backup;
                    const current = flow.current;

                    if (!backup || !current) {
                        ctx.session.peerFlow = undefined;
                        await ctx.reply('❌ Error: No session data', { reply_markup: { remove_keyboard: true } });
                        return;
                    }

                    // Check if any changes were made
                    const hasChanges = JSON.stringify(backup) !== JSON.stringify(current);
                    if (!hasChanges) {
                        ctx.session.peerFlow = undefined;
                        await ctx.reply(
                            'No changes detected, operation cancelled.\n未检测到任何变更，操作已取消。',
                            { reply_markup: { remove_keyboard: true } }
                        );
                        return;
                    }

                    // Build diff text showing changes
                    const diffLines: string[] = [];
                    diffLines.push('Region:');
                    diffLines.push(`    ${flow.routerName || 'Unknown'}`);
                    diffLines.push('Basic:');
                    diffLines.push(`    ASN:         ${flow.asn || ''}`);

                    const oldChannel = backup.mpbgp ? 'IPv6 & IPv4' : 'IPv6 only';
                    const newChannel = current.mpbgp ? 'IPv6 & IPv4' : 'IPv6 only';
                    if (oldChannel !== newChannel) {
                        diffLines.push(`    Channel:     ${oldChannel}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${newChannel}`);
                    } else {
                        diffLines.push(`    Channel:     ${newChannel}`);
                    }

                    // IPv6 diff
                    if (backup.ipv6 !== current.ipv6) {
                        diffLines.push(`    Peer IPv6:   ${backup.ipv6 || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.ipv6 || 'Not set'}`);
                    } else {
                        diffLines.push(`    Peer IPv6:   ${current.ipv6 || 'Not set'}`);
                    }

                    // IPv4 diff
                    if (backup.ipv4 !== current.ipv4) {
                        diffLines.push(`    Peer IPv4:   ${backup.ipv4 || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.ipv4 || 'Not set'}`);
                    } else {
                        diffLines.push(`    Peer IPv4:   ${current.ipv4 || 'Not set'}`);
                    }

                    diffLines.push('Tunnel:');
                    const oldEndpoint = backup.endpoint ? `${backup.endpoint}:${backup.port}` : 'Not set';
                    const newEndpoint = current.endpoint ? `${current.endpoint}:${current.port}` : 'Not set';
                    if (oldEndpoint !== newEndpoint) {
                        diffLines.push(`    Endpoint:    ${oldEndpoint}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${newEndpoint}`);
                    } else {
                        diffLines.push(`    Endpoint:    ${newEndpoint}`);
                    }

                    // Contact diff
                    if (backup.contact !== current.contact) {
                        diffLines.push('Contact:');
                        diffLines.push(`    ${backup.contact || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.contact || 'Not set'}`);
                    } else {
                        diffLines.push('Contact:');
                        diffLines.push(`    ${current.contact || 'Not set'}`);
                    }

                    ctx.session.peerFlow = { ...flow, step: 'modify_confirm' };
                    await ctx.reply(
                        'Please check all your information\n请确认你的信息\n\n' +
                        '```ConfirmInfo\n' + diffLines.join('\n') + '\n```\n\n' +
                        'Please enter `yes` to confirm. All other inputs cancel.\n' +
                        '确认无误请输入 `yes`，其他输入表示取消。',
                        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
                    );
                    return;
                }

                // Handle menu options - prompt for input
                const menuMap: Record<string, { step: string; prompt: string }> = {
                    'Region': { step: 'modify_region', prompt: '🌍 *Migrate to Another Node*\n迁移到另一节点\n\n⚠️ This will recreate your peer.\n请选择新节点:' },
                    'Session Type': { step: 'modify_sessionType', prompt: '⚙️ *Session Type*\nBGP 会话类型\n\nSelect:\n1. MP-BGP + ENH (推荐)\n2. MP-BGP Only\n3. IPv6 + IPv4 独立会话\n\nEnter 1, 2, or 3:' },
                    'BGP Address': { step: 'modify_bgpAddress', prompt: '🌐 *BGP Address*\n\nSelect:\n1. Peer IPv6\n2. Peer IPv4\n3. Local IPv6\n4. Local IPv4\n\nEnter 1, 2, 3, or 4:' },
                    'Clearnet Endpoint': { step: 'modify_endpoint', prompt: '📡 *Modify Endpoint*\n\nEnter new endpoint (host:port) or "none":\n输入新端点或 "none":' },
                    'WireGuard PublicKey': { step: 'modify_pubkey', prompt: '🔑 *Modify Public Key*\n\nEnter new WireGuard public key:\n输入新的公钥:' },
                    'PSK': { step: 'modify_psk', prompt: '🔐 *Modify PSK*\n\nEnter:\n1. Generate new PSK\n2. Disable PSK\n\nEnter 1 or 2:' },
                    'MTU': { step: 'modify_mtu', prompt: '📏 *Modify MTU*\n\nEnter new MTU (1280-1500):\n输入新 MTU:' },
                    'Contact': { step: 'modify_contact', prompt: '📞 *Modify Contact*\n修改联系方式\n\nEnter new contact info:\n输入新的联系方式:\n\nExample: Telegram @username, Email, etc.' },
                };

                const action = menuMap[text];
                if (action) {
                    ctx.session.peerFlow = { ...flow, step: action.step };
                    await ctx.reply(action.prompt, { parse_mode: 'Markdown' });
                    return;
                }

                // Unknown input - show menu again
                await ctx.reply('❓ Please select from the menu.\n请从菜单中选择。');
                return;
            }

            case 'modify_confirm': {
                if (text.toLowerCase() !== 'yes') {
                    ctx.session.peerFlow = undefined;
                    await ctx.reply('Modification cancelled.\n修改已取消。');
                    return;
                }

                // Submit all changes to API
                const uuid = flow.routerUuid;
                const current = flow.current;
                if (!uuid || !current) {
                    ctx.session.peerFlow = undefined;
                    await ctx.reply('❌ Error: No session data');
                    return;
                }

                try {
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid,
                        ipv6: current.ipv6 || null,
                        ipv4: current.ipv4 || null,
                        ipv6LinkLocal: current.localIpv6 || null,
                        localIpv4: current.localIpv4 || null,
                        endpoint: current.endpoint || null,
                        mtu: current.mtu,
                        contact: current.contact || null,
                        extensions: (current.mpbgp ? 'mp_bgp' : '') + (current.extendedNexthop ? ',extended_nexthop' : ''),
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(
                            `✅ Modification submitted successfully!\n` +
                            `修改已成功提交！\n\n` +
                            `Node: \`${flow.routerName}\`\n` +
                            `Changes will be applied within a few minutes.\n` +
                            `更改将在几分钟内生效。`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                } catch {
                    await ctx.reply('❌ Failed to submit changes');
                }
                ctx.session.peerFlow = undefined;
                return;
            }

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

                // Check if endpoint is from China
                if (endpoint && endpoint !== '') {
                    try {
                        const ip = await resolveEndpoint(endpoint);
                        if (ip && isChinaIP(ip)) {
                            await ctx.reply(CN_REJECTION_MESSAGE);
                            return;
                        }
                    } catch (e) {
                        console.warn('[Peer] Failed to check China IP:', e);
                        // Continue anyway - don't block on check failure
                    }
                }

                ctx.session.peerFlow = { ...flow, step: port ? 'input_pubkey' : 'input_port', endpoint, port };

                if (port) {
                    await ctx.reply(`✅ Endpoint: \`${endpoint}:${port}\``, { parse_mode: 'Markdown' });
                    await promptPubkey(ctx);
                } else if (endpoint) {
                    await ctx.reply(
                        `📝 *Step 2b: WireGuard Port*\n\n` +
                        `Input your WireGuard listen port (1-65535).\n` +
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
                await ctx.reply('Please use the buttons above to confirm or cancel.\n请使用上方按钮确认或取消');
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
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        ipv6,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ IPv6 updated to \`${ipv6}\`\nIPv6 已更新`, { parse_mode: 'Markdown' });
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
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid,
                        endpoint,
                        port,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Endpoint updated!\n端点已更新`);
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
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        publicKey: text,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Public key updated!\n公钥已更新`);
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
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        mtu,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ MTU updated to ${mtu}!\nMTU 已更新为 ${mtu}`);
                    }
                } catch (e) {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            // New field handlers
            case 'modify_peerIpv6': {
                // Validate IPv6 format
                const ipv6 = text.trim();
                if (!/^(fe80:|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i.test(ipv6)) {
                    await ctx.reply('❌ Invalid IPv6. Use Link-Local (fe80::) or ULA (fd00::/fc00::)');
                    return;
                }

                try {
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        ipv6: ipv6,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Peer IPv6 updated!\n对方 IPv6 已更新为 \`${ipv6}\``, { parse_mode: 'Markdown' });
                    }
                } catch {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_peerIpv4': {
                const ipv4 = text.trim().toLowerCase();
                if (ipv4 !== 'none' && !/^172\.(2[0-3]|1[6-9])\./.test(ipv4)) {
                    await ctx.reply('❌ Invalid DN42 IPv4. Use 172.20.x.x - 172.23.x.x or "none"');
                    return;
                }

                try {
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        ipv4: ipv4 === 'none' ? null : ipv4,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Peer IPv4 updated!\n对方 IPv4 已更新`);
                    }
                } catch {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_localIpv6': {
                const ipv6 = text.trim();
                if (!/^(fe80:|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i.test(ipv6)) {
                    await ctx.reply('❌ Invalid IPv6. Use Link-Local (fe80::) or ULA (fd00::/fc00::)');
                    return;
                }

                try {
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        ipv6LinkLocal: ipv6,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Local IPv6 updated!\n我方 IPv6 已更新为 \`${ipv6}\``, { parse_mode: 'Markdown' });
                    }
                } catch {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_localIpv4': {
                const ipv4 = text.trim().toLowerCase();
                if (ipv4 !== 'none' && !/^172\.(2[0-3]|1[6-9])\./.test(ipv4)) {
                    await ctx.reply('❌ Invalid DN42 IPv4. Use 172.20.x.x - 172.23.x.x or "none"');
                    return;
                }

                try {
                    const result = await apiRequest('/admin', 'POST', {
                        action: 'updateSession',
                        uuid: flow.routerUuid,
                        localIpv4: ipv4 === 'none' ? null : ipv4,
                    }, config.apiToken);

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Failed: ${result.message}`);
                    } else {
                        await ctx.reply(`✅ Local IPv4 updated!\n我方 IPv4 已更新`);
                    }
                } catch {
                    await ctx.reply('❌ Update failed');
                }
                ctx.session.peerFlow = undefined;
                break;
            }

            case 'modify_contact': {
                const contact = text.trim();
                if (contact.length < 3 || contact.length > 200) {
                    await ctx.reply('❌ Contact must be 3-200 characters');
                    return;
                }

                // Update current state (will be submitted on Finish modification)
                if (flow.current) {
                    flow.current.contact = contact;
                }
                await ctx.reply(`✅ Contact set to: ${contact}\n联系方式已设为: ${contact}\n\nContinue modifying or select "Finish modification".\n继续修改或选择"Finish modification"提交。`);
                ctx.session.peerFlow = { ...flow, step: 'modify_menu' };
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

    /**
     * Handle confirm callback
     */
    bot.callbackQuery('peer:confirm', async (ctx) => {
        const flow = ctx.session.peerFlow;
        // Use targetAsn for admin mode, otherwise session asn
        const asn = flow?.isAdminMode ? flow.targetAsn : ctx.session.asn;
        if (!flow || !asn) return;

        await ctx.answerCallbackQuery('Creating peer...');
        await ctx.editMessageText('⏳ Creating peer...\n正在创建 Peer...');

        try {
            // Call API to create session - use adminCreate for admin mode
            const action = flow.isAdminMode ? 'adminCreate' : 'create';
            const result = await apiRequest('/admin', 'POST', {
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

    /**
     * /info - Show peer info
     */
    bot.command('info', async (ctx) => {
        // Check if admin specifying ASN
        const args = ctx.match?.trim().split(/\s+/) || [];
        let targetAsn = ctx.session.asn;
        let isAdminMode = false;

        const username = ctx.from?.username?.toLowerCase();
        const adminUsername = config.adminUsername?.toLowerCase().replace('@', '');
        const isAdmin = username === adminUsername || ctx.session.isAdmin === true;

        if (args[0] && /^\d+$/.test(args[0].replace(/^AS/i, ''))) {
            if (!isAdmin) {
                await ctx.reply('❌ Only admin can view other ASN info\n只有管理员可以查看其他 ASN 的信息');
                return;
            }
            targetAsn = parseInt(args[0].replace(/^AS/i, ''), 10);
            isAdminMode = true;
        }

        if (!targetAsn) {
            await ctx.reply('❌ Please /login first.\n请先登录');
            return;
        }

        try {
            // Admin mode: use admin API; User mode: use session API
            const result = isAdminMode
                ? await apiRequest('/admin', 'POST', { action: 'enumSessions', asn: targetAsn }, config.apiToken)
                : await apiRequest('/session', 'POST', { action: 'list', asn: targetAsn });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions: Array<{ uuid: string; router: string; status: number; ipv6?: string; endpoint?: string }> = result.data?.sessions || [];

            if (sessions.length === 0) {
                await ctx.reply(
                    `📊 *Peer Info for AS${targetAsn}*\n\n` +
                    `No peers found.\n没有 Peer\n\n` +
                    `Use /peer to create one.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            let message = `📊 *Peer Info for AS${targetAsn}*\n\n`;

            for (const [i, s] of sessions.entries()) {
                const statusIcon = s.status === 1 ? '🟢' : s.status === 3 ? '⏳' : '❌';
                const statusText = s.status === 1 ? 'Active' : s.status === 3 ? 'Pending' : 'Inactive';

                message += `*${i + 1}. ${s.router}* ${statusIcon} ${statusText}\n`;

                if (s.ipv6) message += `   IPv6: \`${s.ipv6}\`\n`;
                if (s.endpoint) message += `   Endpoint: \`${s.endpoint}\`\n`;
                message += `\n`;
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
        await ctx.reply('Use /status to check WG/BGP status\n使用 /status 查看状态');
    });

    bot.callbackQuery('info:modify', async (ctx) => {
        await ctx.answerCallbackQuery('Use /modify command');
        await ctx.reply('Use /modify to modify a peer\n使用 /modify 修改 Peer');
    });

    /**
     * /modify - Modify existing peer
     */
    bot.command('modify', async (ctx) => {
        // Check if admin specifying ASN
        const args = ctx.match?.trim().split(/\s+/) || [];
        let targetAsn = ctx.session.asn;
        let isAdminMode = false;

        const username = ctx.from?.username?.toLowerCase();
        const adminUsername = config.adminUsername?.toLowerCase().replace('@', '');
        const isAdmin = username === adminUsername || ctx.session.isAdmin === true;

        if (args[0] && /^\d+$/.test(args[0].replace(/^AS/i, ''))) {
            if (!isAdmin) {
                await ctx.reply('❌ Only admin can modify other ASN peers\n只有管理员可以修改其他 ASN 的 Peer');
                return;
            }
            targetAsn = parseInt(args[0].replace(/^AS/i, ''), 10);
            isAdminMode = true;
        }

        if (!targetAsn) {
            await ctx.reply('❌ Please /login first.\n请先登录');
            return;
        }

        try {
            const result = isAdminMode
                ? await apiRequest('/admin', 'POST', { action: 'enumSessions', asn: targetAsn }, config.apiToken)
                : await apiRequest('/session', 'POST', { action: 'list', asn: targetAsn });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = result.data?.sessions || [];

            if (sessions.length === 0) {
                await ctx.reply(`ℹ️ AS${targetAsn} has no peers to modify.\nAS${targetAsn} 没有可修改的 Peer`);
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
                `🔧 *Modify Peer for AS${targetAsn}*\n修改 AS${targetAsn} 的 Peer\n\n` +
                `Select peer to modify:\n选择要修改的 Peer:`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } catch (error) {
            console.error('[Modify] Error:', error);
            await ctx.reply('❌ Failed to fetch peers.');
        }
    });

    /**
     * Handle modify peer selection - show field selection with ReplyKeyboard (dn42-bot style)
     */
    bot.callbackQuery(/^modify:peer:(.+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        if (!uuid) return;

        await ctx.answerCallbackQuery();

        try {
            // Fetch full session details via admin API
            const result = await apiRequest('/admin', 'POST', {
                action: 'getSession',
                uuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed to fetch session: ${result.message}`);
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const session = result.data?.session as any;
            if (!session) {
                await ctx.editMessageText('❌ Session not found');
                return;
            }

            // Parse credential for backup
            let pubkey = '';
            let hasPsk = false;
            if (session.credential) {
                try {
                    const cred = typeof session.credential === 'string'
                        ? JSON.parse(session.credential)
                        : session.credential;
                    pubkey = cred.pubkey || cred.public_key || '';
                    hasPsk = !!cred.psk;
                } catch {
                    pubkey = String(session.credential).slice(0, 44);
                }
            }

            // Parse extensions
            const extensions = session.extensions || '';
            const hasMpbgp = extensions.includes('mp_bgp') || extensions.includes('mpbgp');
            const hasEnh = extensions.includes('extended_nexthop') || extensions.includes('enh');

            // Store backup state for diff tracking (dn42-bot style)
            ctx.session.peerFlow = {
                step: 'modify_menu',
                routerUuid: uuid,
                routerName: session.routerName || session.router,
                asn: session.asn,
                backup: {
                    endpoint: session.endpoint || '',
                    port: session.port || '',
                    ipv6: session.ipv6 || '',
                    ipv4: session.ipv4 || '',
                    localIpv6: session.ipv6LinkLocal || '',
                    localIpv4: session.localIpv4 || '',
                    pubkey,
                    psk: hasPsk,
                    mtu: session.mtu || 1420,
                    mpbgp: hasMpbgp,
                    extendedNexthop: hasEnh,
                    contact: session.contact || '',
                },
                // Current values (will be modified by user)
                current: {
                    endpoint: session.endpoint || '',
                    port: session.port || '',
                    ipv6: session.ipv6 || '',
                    ipv4: session.ipv4 || '',
                    localIpv6: session.ipv6LinkLocal || '',
                    localIpv4: session.localIpv4 || '',
                    pubkey,
                    psk: hasPsk,
                    mtu: session.mtu || 1420,
                    mpbgp: hasMpbgp,
                    extendedNexthop: hasEnh,
                    contact: session.contact || '',
                },
            };

            // Build current info display
            const channel = hasMpbgp ? 'IPv6 & IPv4' : 'IPv6 only';
            const mpbgpText = hasMpbgp ? (hasEnh ? 'IPv6 (ENH)' : 'IPv6') : 'Not supported';
            const endpoint = session.endpoint || 'Not set';

            const currentInfo =
                `\`\`\`CurrentInfo\n` +
                `Region:\n` +
                `    ${session.routerName || session.router || 'Unknown'}\n` +
                `Basic:\n` +
                `    ASN:         ${session.asn}\n` +
                `    Channel:     ${channel}\n` +
                `    MP-BGP:      ${mpbgpText}\n` +
                `    Peer IPv6:   ${session.ipv6 || 'Not set'}\n` +
                `    Peer IPv4:   ${session.ipv4 || 'Not set'}\n` +
                `    Local IPv6:  ${session.ipv6LinkLocal || 'Not set'}\n` +
                `    Local IPv4:  ${session.localIpv4 || 'Not set'}\n` +
                `Tunnel:\n` +
                `    Endpoint:    ${endpoint}\n` +
                `    PublicKey:   ${pubkey ? pubkey.slice(0, 20) + '...' : 'Not set'}\n` +
                `    PSK:         ${hasPsk ? 'Enabled' : 'Not enabled'}\n` +
                `    MTU:         ${session.mtu || 1420}\n` +
                `Contact:\n` +
                `    ${session.contact || 'Not set'}\n` +
                `\`\`\``;

            // Delete old message and send new one with ReplyKeyboard
            await ctx.deleteMessage();

            // Send ReplyKeyboard menu (dn42-bot style)
            await ctx.reply(
                `🔧 *Modify Peer*\n修改 Peer\n\n` +
                `Current information is as follows\n当前信息如下\n\n` +
                currentInfo + `\n\n` +
                `Select the item to be modified:\n选择想要修改的内容:\n\n` +
                `- \`Region\` - Migration to another node\n` +
                `- \`Session Type\` - Change BGP session type\n` +
                `- \`BGP Address\` - Change BGP addresses\n` +
                `- \`Clearnet Endpoint\` - Change WireGuard endpoint\n` +
                `- \`WireGuard PublicKey\` - Change public key\n` +
                `- \`PSK\` - Enable/Disable Pre-Shared Key\n` +
                `- \`MTU\` - Change tunnel MTU\n` +
                `- \`Contact\` - Change contact info\n\n` +
                `- \`Finish modification\` - Submit changes\n` +
                `- \`Abort modification\` - Cancel all changes`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            [{ text: 'Region' }, { text: 'Clearnet Endpoint' }],
                            [{ text: 'Session Type' }, { text: 'WireGuard PublicKey' }],
                            [{ text: 'BGP Address' }, { text: 'PSK' }],
                            [{ text: 'MTU' }, { text: 'Contact' }],
                            [{ text: 'Finish modification' }, { text: 'Abort modification' }],
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: false,
                    }
                }
            );
        } catch (error) {
            console.error('[Modify Peer] Error:', error);
            await ctx.editMessageText('❌ Failed to fetch session details');
        }
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
            case 'region':
                // Fetch available routers for node selection
                promptText = `🌍 *Migrate to Another Node*\n迁移到另一节点\n\n` +
                    `⚠️ This will recreate your peer on a different node.\n` +
                    `这将在不同节点重建你的 Peer。\n\n` +
                    `Select new node:\n选择新节点:`;
                // Build node keyboard dynamically
                try {
                    const nodeResult = await apiRequest('/node', 'POST', { action: 'list' }, config.apiToken);
                    const nodes = nodeResult.data?.nodes;
                    if (nodeResult.code === 0 && Array.isArray(nodes)) {
                        keyboard = new InlineKeyboard();
                        for (const node of nodes) {
                            if (node.status === 1) { // Only active nodes
                                keyboard.text(`📍 ${node.name}`, `modify:region:${uuid}:${node.uuid}`).row();
                            }
                        }
                        keyboard.text('🚫 Cancel 取消', 'modify:cancel');
                    }
                } catch {
                    promptText = `❌ Failed to fetch nodes\n获取节点列表失败`;
                }
                ctx.session.peerFlow = undefined; // Uses buttons
                break;
            case 'sessionType':
                promptText = `⚙️ *Session Type*\nBGP 会话类型\n\n` +
                    `Select session type:\n选择会话类型:`;
                keyboard = new InlineKeyboard()
                    .text('MP-BGP + ENH (推荐)', `modify:sessionType:${uuid}:mpbgp_enh`).row()
                    .text('MP-BGP Only', `modify:sessionType:${uuid}:mpbgp`).row()
                    .text('IPv6 + IPv4 独立会话', `modify:sessionType:${uuid}:separate`).row()
                    .text('🚫 Cancel 取消', 'modify:cancel');
                ctx.session.peerFlow = undefined; // Uses buttons
                break;
            case 'peerIpv6':
                promptText = `🌐 *Modify Peer IPv6*\n修改对方 IPv6\n\n` +
                    `Enter new IPv6 address for BGP:\n` +
                    `输入对方的 BGP IPv6 地址:\n\n` +
                    `Supported: \`fe80::/64\` Link-Local or \`fd00::/8\` ULA`;
                break;
            case 'peerIpv4':
                promptText = `🌍 *Modify Peer IPv4*\n修改对方 IPv4\n\n` +
                    `Enter new IPv4 address for BGP:\n` +
                    `输入对方的 BGP IPv4 地址:\n\n` +
                    `Example: \`172.20.x.x\`\n` +
                    `Or send "none" to clear`;
                break;
            case 'localIpv6':
                promptText = `📍 *Modify Local IPv6*\n修改我方 IPv6\n\n` +
                    `Enter new local IPv6 address:\n` +
                    `输入我方的 IPv6 地址:\n\n` +
                    `Supported: \`fe80::/64\` Link-Local or \`fd00::/8\` ULA`;
                break;
            case 'localIpv4':
                promptText = `📍 *Modify Local IPv4*\n修改我方 IPv4\n\n` +
                    `Enter new local IPv4 address:\n` +
                    `输入我方的 IPv4 地址:\n\n` +
                    `Example: \`172.20.x.x\`\n` +
                    `Or send "none" to clear`;
                break;
            case 'ipv6':  // Legacy compatibility
                promptText = `🌐 *Modify IPv6*\n\n` +
                    `Enter new IPv6 address for BGP:\n` +
                    `输入新的 BGP IPv6 地址:\n\n` +
                    `Supported: \`fe80::/64\` Link-Local or \`fc00::/7\` ULA`;
                break;
            case 'endpoint':
                promptText = `📡 *Modify Endpoint*\n\n` +
                    `Enter new endpoint (domain:port or IP:port):\n` +
                    `输入新端点 (域名:端口 或 IP:端口):\n\n` +
                    `Example: \`tunnel.example.com:51820\`\n` +
                    `Or send "none" for no endpoint`;
                break;
            case 'pubkey':
                promptText = `🔑 *Modify Public Key*\n\n` +
                    `Enter new WireGuard public key:\n` +
                    `输入新的 WireGuard 公钥:\n\n` +
                    `Format: 44 characters, ends with \`=\``;
                break;
            case 'mtu':
                promptText = `📏 *Modify MTU*\n\n` +
                    `Enter new MTU (1280-1500):\n` +
                    `输入新的 MTU (1280-1500):`;
                keyboard = new InlineKeyboard()
                    .text('1420 (Default)', `modify:mtu:${uuid}:1420`)
                    .text('1400', `modify:mtu:${uuid}:1400`).row()
                    .text('1380', `modify:mtu:${uuid}:1380`)
                    .text('1360', `modify:mtu:${uuid}:1360`).row()
                    .text('🚫 Cancel 取消', 'modify:cancel');
                ctx.session.peerFlow = undefined; // Uses buttons or text
                break;
            case 'psk':
                promptText = `🔐 *Modify PSK*\n\n` +
                    `Choose action:\n选择操作:`;
                keyboard = new InlineKeyboard()
                    .text('🔄 Generate New 生成新密钥', `modify:psk:${uuid}:generate`).row()
                    .text('❌ Disable PSK 禁用', `modify:psk:${uuid}:disable`).row()
                    .text('🚫 Cancel 取消', 'modify:cancel');
                ctx.session.peerFlow = undefined; // PSK uses buttons, not text
                break;
            case 'contact':
                promptText = `📞 *Modify Contact*\n修改联系方式\n\n` +
                    `Enter new contact info:\n` +
                    `输入新的联系方式:\n\n` +
                    `Example: Telegram @username, Email, etc.`;
                break;
            default:
                promptText = `❌ Unknown field: ${field}`;
        }

        await ctx.editMessageText(promptText, { parse_mode: 'Markdown', reply_markup: keyboard });
    });

    /**
     * Handle modify cancel
     */
    bot.callbackQuery('modify:cancel', async (ctx) => {
        ctx.session.peerFlow = undefined;
        await ctx.answerCallbackQuery('Cancelled');
        await ctx.editMessageText('🚫 Modify cancelled.\n已取消修改');
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

            const result = await apiRequest('/admin', 'POST', {
                action: 'updateSession',
                uuid,
                psk,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed: ${result.message}`);
                return;
            }

            if (action === 'generate') {
                await ctx.editMessageText(
                    `✅ *PSK Updated*\n已更新 PSK\n\n` +
                    `New PSK:\n\`${psk}\`\n\n` +
                    `⚠️ Save this key! Configure it on your side.\n` +
                    `请保存并在你的配置中使用此密钥。`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.editMessageText('✅ PSK disabled\nPSK 已禁用');
            }
        } catch (error) {
            console.error('[Modify PSK] Error:', error);
            await ctx.editMessageText('❌ Update failed');
        }
    });

    /**
     * Handle Session Type modify callbacks
     */
    bot.callbackQuery(/^modify:sessionType:(.+):(.+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        const typeVal = ctx.match?.[2];
        if (!uuid || !typeVal) return;

        await ctx.answerCallbackQuery('Updating...');

        try {
            // Map selection to extensions value
            let extensions = '';
            switch (typeVal) {
                case 'mpbgp_enh':
                    extensions = 'mpbgp,enh';
                    break;
                case 'mpbgp':
                    extensions = 'mpbgp';
                    break;
                case 'separate':
                    extensions = '';
                    break;
            }

            const result = await apiRequest('/admin', 'POST', {
                action: 'updateSession',
                uuid,
                extensions,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed: ${result.message}`);
                return;
            }

            const typeNames: Record<string, string> = {
                'mpbgp_enh': 'MP-BGP + ENH',
                'mpbgp': 'MP-BGP Only',
                'separate': 'IPv6 + IPv4 独立会话'
            };

            await ctx.editMessageText(
                `✅ *Session Type Updated*\n会话类型已更新\n\n` +
                `New Type: ${typeNames[typeVal] || typeVal}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Modify SessionType] Error:', error);
            await ctx.editMessageText('❌ Update failed');
        }
    });

    /**
     * Handle MTU quick select callbacks
     */
    bot.callbackQuery(/^modify:mtu:(.+):(\d+)$/, async (ctx) => {
        const uuid = ctx.match?.[1];
        const mtu = parseInt(ctx.match?.[2] || '1420', 10);
        if (!uuid) return;

        await ctx.answerCallbackQuery('Updating...');

        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'updateSession',
                uuid,
                mtu,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Failed: ${result.message}`);
                return;
            }

            await ctx.editMessageText(
                `✅ *MTU Updated*\nMTU 已更新\n\n` +
                `New MTU: ${mtu}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Modify MTU] Error:', error);
            await ctx.editMessageText('❌ Update failed');
        }
    });

    /**
     * Handle Region migration callbacks
     */
    bot.callbackQuery(/^modify:region:(.+):(.+)$/, async (ctx) => {
        const sessionUuid = ctx.match?.[1];
        const newNodeUuid = ctx.match?.[2];
        if (!sessionUuid || !newNodeUuid) return;

        await ctx.answerCallbackQuery('Migrating peer...');

        try {
            // Call API to migrate session to new node
            const result = await apiRequest('/admin', 'POST', {
                action: 'migrate',
                uuid: sessionUuid,
                newRouter: newNodeUuid,
            }, config.apiToken);

            if (result.code !== 0) {
                await ctx.editMessageText(`❌ Migration failed: ${result.message}`);
                return;
            }

            await ctx.editMessageText(
                `✅ *Peer Migration Initiated*\nPeer 迁移已启动\n\n` +
                `Your peer will be recreated on the new node.\n` +
                `Peer 将在新节点上重建。\n\n` +
                `⚠️ Please wait a few minutes for changes to apply.\n` +
                `请等待几分钟让更改生效。`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Modify Region] Error:', error);
            await ctx.editMessageText('❌ Migration failed');
        }
    });

    /**
     * /remove - Remove peer
     */
    bot.command('remove', async (ctx) => {
        // Check if admin specifying ASN
        const args = ctx.match?.trim().split(/\s+/) || [];
        let targetAsn = ctx.session.asn;
        let isAdminMode = false;

        const username = ctx.from?.username?.toLowerCase();
        const adminUsername = config.adminUsername?.toLowerCase().replace('@', '');
        const isAdmin = username === adminUsername || ctx.session.isAdmin === true;

        if (args[0] && /^\d+$/.test(args[0].replace(/^AS/i, ''))) {
            if (!isAdmin) {
                await ctx.reply('❌ Only admin can remove other ASN peers\n只有管理员可以删除其他 ASN 的 Peer');
                return;
            }
            targetAsn = parseInt(args[0].replace(/^AS/i, ''), 10);
            isAdminMode = true;
        }

        if (!targetAsn) {
            await ctx.reply('❌ Please /login first.\n请先登录');
            return;
        }

        try {
            const result = isAdminMode
                ? await apiRequest('/admin', 'POST', { action: 'enumSessions', asn: targetAsn }, config.apiToken)
                : await apiRequest('/session', 'POST', { action: 'list', asn: targetAsn });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = result.data?.sessions || [];

            if (sessions.length === 0) {
                await ctx.reply(`ℹ️ AS${targetAsn} has no peers to remove.\nAS${targetAsn} 没有可删除的 Peer`);
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
                `🗑️ *Remove Peer for AS${targetAsn}*\n删除 AS${targetAsn} 的 Peer\n\n` +
                `Select peer to remove:\n选择要删除的 Peer:`,
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
                await ctx.reply('❌ Only admin can restart other ASN peers\n只有管理员可以重启其他 ASN 的 Peer');
                return;
            }
            targetAsn = parseInt(args[0].replace(/^AS/i, ''), 10);
        }

        if (!targetAsn) {
            await ctx.reply('❌ Please /login first.\n请先登录');
            return;
        }

        // Fetch user's active sessions
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'list',
                asn: targetAsn,
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = (result.data?.sessions || []).filter(s => s.status === 1);

            if (sessions.length === 0) {
                await ctx.reply(`❌ AS${targetAsn} has no active peers\nAS${targetAsn} 没有活跃的 Peer`);
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
                    `🔄 *Restart Peer*\n重启 Peer\n\n` +
                    `Select node for AS${targetAsn}:\n选择要重启的节点:`,
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
        await ctx.reply(`⏳ Restarting peer for AS${asn} @ ${router}...\n正在重启...`);

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
                    `✅ *Peer Restarted*\n已重启 Peer\n\n` +
                    `AS${asn} @ ${router}\n` +
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
            await ctx.reply('❌ Please /login first.\n请先登录');
            return;
        }

        await ctx.reply('⏳ Checking status...\n正在检查状态...');

        try {
            // Get user's sessions
            const result = await apiRequest('/admin', 'POST', {
                action: 'list',
                asn,
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message}`);
                return;
            }

            const sessions = (result.data?.sessions || []).filter((s: { status: number }) => s.status === 1);

            if (sessions.length === 0) {
                await ctx.reply('ℹ️ You have no active peers.\n你没有活跃的 Peer');
                return;
            }

            // Check status for each session
            const { getAgentEndpoint } = await import('../providers/nodes');
            let statusMessage = `📊 *Status for AS${asn}*\n\n`;

            for (const session of sessions) {
                const router = session.router;
                statusMessage += `📍 *${router}*\n`;

                try {
                    const endpoint = await getAgentEndpoint(router);
                    if (!endpoint) {
                        statusMessage += `   ❌ Agent unreachable\n\n`;
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

                        statusMessage += `   WG: ${wgIcon} ${data.wg_status || 'unknown'}\n`;
                        statusMessage += `   BGP: ${bgpIcon} ${data.bgp_status || 'unknown'}\n`;
                        if (data.last_handshake) {
                            statusMessage += `   Handshake: ${data.last_handshake}\n`;
                        }
                        if (data.transfer) {
                            statusMessage += `   Traffic: ↓${data.transfer.rx} ↑${data.transfer.tx}\n`;
                        }
                    } else {
                        statusMessage += `   ⚠️ Status check failed\n`;
                    }
                } catch (e) {
                    statusMessage += `   ❌ Error checking status\n`;
                }
                statusMessage += `\n`;
            }

            await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Status] Error:', error);
            await ctx.reply('❌ Failed to check status.');
        }
    });
}
