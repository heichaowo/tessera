import type { Bot } from 'grammy';
import { InlineKeyboard, Keyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import { isChinaIP, resolveEndpoint, CN_REJECTION_MESSAGE } from '../providers/chinaIp';
import { validateIpOwnership, isLinkLocal, isDN42ULA, isDN42IPv4 } from '../services/dn42Validator';

// Import from new peer module
import {
    // Types
    type APIResponse,
    type PeerState,
    // Step constants
    PEER_CREATE_STEPS,
    PEER_MODIFY_STEPS,
    MODIFY_MENU_OPTIONS,
    BGP_ADDRESS_OPTIONS,
    // Validators 
    isValidIPv6,
    isValidWgPubkey,
    isValidDN42IPv4,
    isValidMTU,
    isValidPort,
    calculatePort,
    parseMTU,
    parseEndpoint,
    // Helpers
    BUTTONS,
    isBackButton,
    isAbortButton,
    isFinishButton,
    getFlowWithCurrent,
    truncatePubkey,
    // UI helpers
    showServerWgInfo,
    promptSessionType,
    promptIpv6,
    promptUlaIpv6,
    promptEndpoint,
    promptPubkey,
    promptMtu,
    promptPsk,
    showConfirmation,
    // Handlers
    registerCreationHandlers,
    registerConfirmHandlers,
    registerModifyHandlers,
    registerRemoveHandlers,
} from './peer/index';

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
 * Show modify menu with ReplyKeyboard (dn42-bot style)
 * This helper is called after each modification to return to the main menu
 */
async function showModifyMenu(ctx: BotContext, isFirstTime = false) {
    const flow = ctx.session.peerFlow;
    if (!flow || !flow.current) return;

    const current = flow.current;
    const channel = current.mpbgp ? 'IPv6 & IPv4' : 'IPv6 only';
    const mpbgpText = current.mpbgp ? (current.extendedNexthop ? 'IPv6 (ENH)' : 'IPv6') : 'Not supported';

    const currentInfo =
        `\`\`\`${isFirstTime ? 'CurrentInfo' : 'ModifiedInfo'}\n` +
        `Region:\n` +
        `    ${flow.routerName || 'Unknown'}\n` +
        `Basic:\n` +
        `    ASN:         ${flow.asn || ''}\n` +
        `    Channel:     ${channel}\n` +
        `    MP-BGP:      ${mpbgpText}\n` +
        `    Peer IPv6:   ${current.ipv6 || 'Not set'}\n` +
        `    Peer IPv4:   ${current.ipv4 || 'Not set'}\n` +
        `    Local IPv6:  ${current.localIpv6 || 'Not set'}\n` +
        `    Local IPv4:  ${current.localIpv4 || 'Not set'}\n` +
        `Tunnel:\n` +
        `    Endpoint:    ${current.endpoint ? (current.port ? `${current.endpoint}:${current.port}` : current.endpoint) : 'Not set'}\n` +
        `    PublicKey:   ${current.pubkey ? current.pubkey.slice(0, 20) + '...' : 'Not set'}\n` +
        `    PSK:         ${current.psk ? 'Enabled' : 'Not enabled'}\n` +
        `    MTU:         ${current.mtu || 1420}\n` +
        `Contact:\n` +
        `    ${current.contact || 'Not set'}\n` +
        `\`\`\``;

    const headerText = isFirstTime
        ? 'Current information is as follows\n当前信息如下'
        : 'You have modified the following information\n已修改以下信息';

    // Set step back to modify_menu
    ctx.session.peerFlow = { ...flow, step: 'modify_menu' };

    await ctx.reply(
        `🔧 *Modify Peer*\n修改 Peer\n\n` +
        `${headerText}\n\n` +
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
                    [{ text: BUTTONS.FINISH }, { text: BUTTONS.ABORT }],
                ],
                resize_keyboard: true,
                one_time_keyboard: false,
            }
        }
    );
}

export function registerPeerCommands(bot: Bot<BotContext>) {

    // Register handlers from extracted modules
    registerCreationHandlers(bot);
    registerConfirmHandlers(bot);
    registerModifyHandlers(bot, showModifyMenu);
    registerRemoveHandlers(bot);

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
            const nodeMap: Record<string, { uuid: string; endpoint: string; pubkey: string; nodeId: number; regionCode: number }> = {};
            const peerableNodes: string[] = [];

            for (const r of routers) {
                const label = `${r.name} (${r.region || r.location || 'Unknown'})`;
                let status = '';

                if (r.isOpen) {
                    status += '✅ Open ';
                    peerableNodes.push(label);
                    nodeMap[label] = {
                        uuid: r.uuid,
                        endpoint: `${r.name}.dn42.moenet.work`,
                        pubkey: r.wgPublicKey || 'N/A',
                        nodeId: r.nodeId || 0,
                        regionCode: r.regionCode || 0,
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
                    serverLla: `fe80::998:${nodeInfo.regionCode}:${nodeInfo.nodeId}:1`,
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

            // Build ReplyKeyboard for node selection
            const keyboard = new Keyboard();
            peerableNodes.forEach((label, i) => {
                const nodeName = (label || '').split(' (')[0] || '';
                keyboard.text(nodeName);
                if ((i + 1) % 2 === 0) keyboard.row();
            });
            keyboard.resized().oneTime();

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


    // Creation callbacks (peer:node, peer:select_session_type, peer:session:*, 
    // peer:ipv6, peer:endpoint:none, peer:mtu, peer:psk) are now in handlers/creation.ts


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
            // ===== Creation wizard ReplyKeyboard handlers =====
            case 'select_node': {
                // Skip admin mode - handled by admin.ts
                if (flow.isAdminMode) {
                    return next();
                }
                // Handle node selection from ReplyKeyboard
                const nodeMap = flow.nodeMap;
                if (!nodeMap) {
                    await ctx.reply('❌ Error: Node map not found', { reply_markup: { remove_keyboard: true } });
                    ctx.session.peerFlow = undefined;
                    return;
                }

                // Find matching node by name
                const matchedLabel = Object.keys(nodeMap).find(label => {
                    const nodeName = label.split(' (')[0] || '';
                    return nodeName.toLowerCase() === text.toLowerCase();
                });

                if (!matchedLabel) {
                    await ctx.reply('❌ Invalid node. Please select from the list.\n无效节点，请从列表中选择。', { reply_markup: { remove_keyboard: true } });
                    return;
                }

                const nodeInfo = nodeMap[matchedLabel];
                if (!nodeInfo) {
                    await ctx.reply('❌ Node info not found', { reply_markup: { remove_keyboard: true } });
                    return;
                }

                const asn = ctx.session.asn || 0;
                const userPort = calculatePort(asn);

                ctx.session.peerFlow = {
                    ...flow,
                    step: 'await_continue',
                    routerName: matchedLabel.split(' (')[0],
                    routerUuid: nodeInfo.uuid,
                    serverEndpoint: nodeInfo.endpoint,
                    serverPort: userPort,
                    serverPubkey: nodeInfo.pubkey,
                    serverLla: `fe80::998:${nodeInfo.regionCode}:${nodeInfo.nodeId}:1`,
                };

                await ctx.reply(`✅ Selected: ${matchedLabel}`, { reply_markup: { remove_keyboard: true } });
                await showServerWgInfo(ctx);
                return;
            }

            case 'await_continue': {
                // Handle "Continue" button from ReplyKeyboard
                if (text.includes('Continue') || text.includes('继续')) {
                    await promptSessionType(ctx);
                    return;
                }
                await ctx.reply('Please click the "Continue" button to proceed.\n请点击 "Continue 继续" 按钮继续。');
                return;
            }

            case 'select_session_type': {
                // Handle session type selection from ReplyKeyboard
                if (text.includes('MP-BGP') || text.includes('ENH')) {
                    ctx.session.peerFlow = { ...flow, step: 'input_ipv6', sessionType: 'ipv6_only' };
                    // Use targetAsn for admin mode, session.asn for user mode
                    const asn = flow.isAdminMode ? (flow.targetAsn || 0) : (ctx.session.asn || 0);
                    const suggested = `fe80::${asn % 10000}`;
                    await ctx.reply(`✅ Session Type: *MP-BGP + ENH*`, { parse_mode: 'Markdown' });
                    await promptIpv6(ctx, suggested);
                    return;
                }
                if (text.includes('ULA') || text.includes('GUA')) {
                    ctx.session.peerFlow = { ...flow, step: 'input_peer_ipv6_ula', sessionType: 'ipv6_ipv4' };
                    await ctx.reply(`✅ Session Type: *ULA/GUA Mode*`, { parse_mode: 'Markdown' });
                    await promptUlaIpv6(ctx);
                    return;
                }
                await ctx.reply('Please select a session type.\n请选择会话类型。');
                return;
            }

            case 'input_mtu': {
                // Handle MTU selection from ReplyKeyboard - use button text exact matches
                const mtuButtons: Record<string, number> = {
                    '1420 (默认)': 1420,
                    '1400': 1400,
                    '1380': 1380,
                    '1280': 1280,
                };
                let mtu = mtuButtons[text];
                if (!mtu) {
                    // Custom MTU input - parse directly
                    const parsed = parseInt(text, 10);
                    if (isNaN(parsed) || parsed < 1280 || parsed > 1500) {
                        await ctx.reply('❌ Invalid MTU. Please enter 1280-1500.\n无效的 MTU，请输入 1280-1500');
                        return;
                    }
                    mtu = parsed;
                }
                ctx.session.peerFlow = { ...flow, step: 'input_psk', mtu };
                await ctx.reply(`✅ MTU: \`${mtu}\``, { parse_mode: 'Markdown' });
                await promptPsk(ctx);
                return;
            }

            case 'input_psk': {
                // Handle PSK selection from ReplyKeyboard
                if (text.includes('Auto') || text.includes('Generate') || text.includes('自动')) {
                    const psk = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
                    ctx.session.peerFlow = { ...flow, step: 'confirm', psk };
                    await ctx.reply(
                        `🔑 *PSK Generated*\n\n\`${psk}\`\n\n` +
                        `⚠️ Save this key! You need it on your side.\n` +
                        `请保存此密钥，稍后配置时需要。`,
                        { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
                    );
                    await showConfirmation(ctx);
                    return;
                }
                if (text.includes('No') || text.includes('不使用')) {
                    ctx.session.peerFlow = { ...flow, step: 'confirm', psk: undefined };
                    await ctx.reply(`✅ PSK: Disabled`, { reply_markup: { remove_keyboard: true } });
                    await showConfirmation(ctx);
                    return;
                }
                await ctx.reply('Please select a PSK option.\n请选择 PSK 选项。');
                return;
            }

            // ===== Modify menu handlers (dn42-bot style) =====
            case 'modify_menu': {
                const uuid = flow.routerUuid;
                if (!uuid) {
                    ctx.session.peerFlow = undefined;
                    return;
                }

                // Handle Abort modification
                if (isAbortButton(text) || text === '/cancel') {
                    ctx.session.peerFlow = undefined;
                    await ctx.reply(
                        'Abort modification, operation has been canceled.\n放弃修改，操作已取消。',
                        { reply_markup: { remove_keyboard: true } }
                    );
                    return;
                }

                // Handle Finish modification
                if (isFinishButton(text)) {
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

                    // Basic section
                    diffLines.push('Basic:');
                    diffLines.push(`    ASN:         ${flow.asn || ''}`);

                    // Session Type (MP-BGP + ENH)
                    const oldSession = backup.mpbgp
                        ? (backup.extendedNexthop ? 'MP-BGP + ENH' : 'MP-BGP Only')
                        : 'IPv6 + IPv4 (独立)';
                    const newSession = current.mpbgp
                        ? (current.extendedNexthop ? 'MP-BGP + ENH' : 'MP-BGP Only')
                        : 'IPv6 + IPv4 (独立)';
                    if (oldSession !== newSession) {
                        diffLines.push(`    Session:     ${oldSession}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${newSession}`);
                    } else {
                        diffLines.push(`    Session:     ${newSession}`);
                    }

                    // BGP Address section
                    diffLines.push('BGP Address:');

                    // Peer IPv6 diff
                    if (backup.ipv6 !== current.ipv6) {
                        diffLines.push(`    Peer IPv6:   ${backup.ipv6 || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.ipv6 || 'Not set'}`);
                    } else {
                        diffLines.push(`    Peer IPv6:   ${current.ipv6 || 'Not set'}`);
                    }

                    // Peer IPv4 diff
                    if (backup.ipv4 !== current.ipv4) {
                        diffLines.push(`    Peer IPv4:   ${backup.ipv4 || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.ipv4 || 'Not set'}`);
                    } else {
                        diffLines.push(`    Peer IPv4:   ${current.ipv4 || 'Not set'}`);
                    }

                    // Local IPv6 diff
                    if (backup.localIpv6 !== current.localIpv6) {
                        diffLines.push(`    Local IPv6:  ${backup.localIpv6 || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.localIpv6 || 'Not set'}`);
                    } else {
                        diffLines.push(`    Local IPv6:  ${current.localIpv6 || 'Not set'}`);
                    }

                    // Local IPv4 diff
                    if (backup.localIpv4 !== current.localIpv4) {
                        diffLines.push(`    Local IPv4:  ${backup.localIpv4 || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.localIpv4 || 'Not set'}`);
                    } else {
                        diffLines.push(`    Local IPv4:  ${current.localIpv4 || 'Not set'}`);
                    }

                    // Tunnel section
                    diffLines.push('Tunnel:');

                    // Endpoint diff
                    const oldEndpoint = backup.endpoint
                        ? (backup.port ? `${backup.endpoint}:${backup.port}` : backup.endpoint)
                        : 'Not set';
                    const newEndpoint = current.endpoint
                        ? (current.port ? `${current.endpoint}:${current.port}` : current.endpoint)
                        : 'Not set';
                    if (oldEndpoint !== newEndpoint) {
                        diffLines.push(`    Endpoint:    ${oldEndpoint}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${newEndpoint}`);
                    } else {
                        diffLines.push(`    Endpoint:    ${newEndpoint}`);
                    }

                    // WG PublicKey diff
                    const oldPubkey = backup.pubkey ? backup.pubkey.slice(0, 20) + '...' : 'Not set';
                    const newPubkey = current.pubkey ? current.pubkey.slice(0, 20) + '...' : 'Not set';
                    if (backup.pubkey !== current.pubkey) {
                        diffLines.push(`    WG Pubkey:   ${oldPubkey}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${newPubkey}`);
                    } else {
                        diffLines.push(`    WG Pubkey:   ${newPubkey}`);
                    }

                    // PSK diff
                    const oldPsk = backup.psk ? 'Enabled' : 'Disabled';
                    const newPsk = current.psk ? 'Enabled' : 'Disabled';
                    if (backup.psk !== current.psk) {
                        diffLines.push(`    PSK:         ${oldPsk}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${newPsk}`);
                    } else {
                        diffLines.push(`    PSK:         ${newPsk}`);
                    }

                    // MTU diff
                    if (backup.mtu !== current.mtu) {
                        diffLines.push(`    MTU:         ${backup.mtu}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.mtu}`);
                    } else {
                        diffLines.push(`    MTU:         ${current.mtu}`);
                    }

                    // Contact section
                    diffLines.push('Contact:');
                    if (backup.contact !== current.contact) {
                        diffLines.push(`    ${backup.contact || 'Not set'}`);
                        diffLines.push('  ->');
                        diffLines.push(`      ${current.contact || 'Not set'}`);
                    } else {
                        diffLines.push(`    ${current.contact || 'Not set'}`);
                    }

                    ctx.session.peerFlow = { ...flow, step: 'modify_confirm' };

                    // Hybrid confirmation: InlineKeyboard buttons + text "yes" fallback
                    const confirmKeyboard = new InlineKeyboard()
                        .text('✅ Confirm 确认', 'modify:submit')
                        .text('❌ Cancel 取消', 'modify:cancel');

                    await ctx.reply(
                        'Please check all your information\n请确认你的信息\n\n' +
                        '```ConfirmInfo\n' + diffLines.join('\n') + '\n```\n\n' +
                        'Click button or type `yes` to confirm.\n' +
                        '点击按钮或输入 `yes` 确认。',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: confirmKeyboard
                        }
                    );
                    return;
                }

                // Handle menu options - use ReplyKeyboard for sub-menus (dn42-bot style)
                console.log(`[DEBUG modify_menu] text="${text}", checking switch cases...`);
                switch (text) {
                    case 'Region': {
                        // Fetch available nodes and show as ReplyKeyboard
                        try {
                            const nodeResult = await apiRequest('/admin', 'POST', { action: 'enumRouters' }, config.apiToken);
                            const nodes = nodeResult.data?.routers;
                            if (nodeResult.code === 0 && Array.isArray(nodes)) {
                                const nodeButtons: { text: string }[][] = [];
                                for (const node of nodes) {
                                    if (node.isOpen !== false && node.uuid !== flow.routerUuid) {
                                        nodeButtons.push([{ text: `📍 ${node.name} (${node.location || 'Unknown'})` }]);
                                    }
                                }
                                nodeButtons.push([{ text: '🔙 Back' }]);

                                // Set step for selection
                                ctx.session.peerFlow = { ...flow, step: 'modify_region' };

                                await ctx.reply(
                                    '🌍 *Migrate to Another Node*\n迁移到另一节点\n\n' +
                                    '⚠️ This will recreate your peer.\n这将重建你的 Peer。\n\n' +
                                    'Select new node:\n选择新节点:',
                                    { parse_mode: 'Markdown', reply_markup: { keyboard: nodeButtons, resize_keyboard: true } }
                                );
                            } else {
                                await ctx.reply('❌ Failed to fetch nodes\n获取节点列表失败');
                            }
                        } catch {
                            await ctx.reply('❌ Failed to fetch nodes\n获取节点列表失败');
                        }
                        return;
                    }

                    case 'Session Type': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_session_type' };
                        await ctx.reply(
                            '⚙️ *Session Type*\nBGP 会话类型\n\n' +
                            'Current: ' + (flow.current?.mpbgp ? (flow.current?.extendedNexthop ? 'MP-BGP + ENH' : 'MP-BGP Only') : 'IPv6 + IPv4 独立会话') + '\n\n' +
                            'Select session type:\n选择会话类型:',
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    keyboard: [
                                        [{ text: 'MP-BGP + ENH (推荐)' }],
                                        [{ text: 'MP-BGP Only' }],
                                        [{ text: 'IPv6 + IPv4 (独立会话)' }],
                                        [{ text: '🔙 Back' }],
                                    ],
                                    resize_keyboard: true,
                                }
                            }
                        );
                        return;
                    }

                    case 'BGP Address': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_bgp_address' };
                        await ctx.reply(
                            '🌐 *BGP Address*\n\n' +
                            `Current:\n` +
                            `• Peer IPv6: \`${flow.current?.ipv6 || 'Not set'}\`\n` +
                            `• Peer IPv4: \`${flow.current?.ipv4 || 'Not set'}\`\n` +
                            `• Local IPv6: \`${flow.current?.localIpv6 || 'Not set'}\`\n` +
                            `• Local IPv4: \`${flow.current?.localIpv4 || 'Not set'}\`\n\n` +
                            'Select which to modify:\n选择要修改的项:',
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    keyboard: [
                                        [{ text: 'Peer IPv6 (对方)' }, { text: 'Peer IPv4 (对方)' }],
                                        [{ text: 'Local IPv6 (我方)' }, { text: 'Local IPv4 (我方)' }],
                                        [{ text: '🔙 Back' }],
                                    ],
                                    resize_keyboard: true,
                                }
                            }
                        );
                        return;
                    }

                    case 'PSK': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_psk' };
                        const pskButtons = flow.current?.psk
                            ? [[{ text: '🔄 Regenerate PSK' }], [{ text: '❌ Disable PSK' }], [{ text: '🔙 Back' }]]
                            : [[{ text: '🔄 Enable & Generate PSK' }], [{ text: '🔙 Back' }]];
                        await ctx.reply(
                            '🔐 *PSK Settings*\n\n' +
                            `Current: \`${flow.current?.psk ? 'Enabled' : 'Not enabled'}\`\n\n` +
                            'Select action:\n选择操作:',
                            {
                                parse_mode: 'Markdown',
                                reply_markup: { keyboard: pskButtons, resize_keyboard: true }
                            }
                        );
                        return;
                    }

                    case 'MTU': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_mtu' };
                        await ctx.reply(
                            '📏 *MTU Settings*\n\n' +
                            `Current: \`${flow.current?.mtu || 1420}\`\n\n` +
                            'Select common MTU or enter custom value (1280-1500):\n' +
                            '选择常用 MTU 或输入自定义值:',
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    keyboard: [
                                        [{ text: '1420 (Default)' }, { text: '1400' }],
                                        [{ text: '1380' }, { text: '1360' }],
                                        [{ text: '1340' }, { text: '1320' }],
                                        [{ text: '🔙 Back' }],
                                    ],
                                    resize_keyboard: true,
                                }
                            }
                        );
                        return;
                    }

                    case 'Clearnet Endpoint': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_endpoint' };
                        await ctx.reply(
                            '📡 *Modify Endpoint*\n\n' +
                            'Enter new endpoint (host:port) or "none":\n' +
                            '输入新端点 (域名:端口) 或 "none":',
                            { parse_mode: 'Markdown' }
                        );
                        return;
                    }

                    case 'WireGuard PublicKey': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_pubkey' };
                        await ctx.reply(
                            '🔑 *Modify Public Key*\n\n' +
                            'Enter new WireGuard public key:\n' +
                            '输入新的 WireGuard 公钥:',
                            { parse_mode: 'Markdown' }
                        );
                        return;
                    }

                    case 'Contact': {
                        ctx.session.peerFlow = { ...flow, step: 'modify_contact' };
                        await ctx.reply(
                            '📞 *Modify Contact*\n修改联系方式\n\n' +
                            'Enter new contact info:\n' +
                            '输入新的联系方式:\n\n' +
                            'Example: Telegram @username, Email, etc.',
                            { parse_mode: 'Markdown' }
                        );
                        return;
                    }
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
                    const backup = flow.backup;

                    // Only include fields that actually changed
                    const requestBody: Record<string, unknown> = {
                        action: 'updateSession',
                        uuid,
                    };

                    // Compare and add only changed fields
                    if (current.ipv6 !== backup?.ipv6) {
                        requestBody.ipv6 = current.ipv6 || null;
                    }
                    if (current.ipv4 !== backup?.ipv4) {
                        requestBody.ipv4 = current.ipv4 || null;
                    }
                    if (current.localIpv6 !== backup?.localIpv6) {
                        requestBody.ipv6LinkLocal = current.localIpv6 || null;
                    }
                    if (current.localIpv4 !== backup?.localIpv4) {
                        requestBody.localIpv4 = current.localIpv4 || null;
                    }
                    if (current.endpoint !== backup?.endpoint || current.port !== backup?.port) {
                        const fullEndpoint = current.endpoint
                            ? (current.port ? `${current.endpoint}:${current.port}` : current.endpoint)
                            : null;
                        requestBody.endpoint = fullEndpoint;
                    }
                    if (current.mtu !== backup?.mtu) {
                        requestBody.mtu = current.mtu;
                    }
                    if (current.contact !== backup?.contact) {
                        requestBody.contact = current.contact || null;
                    }

                    // Build extensions string only if session type changed
                    if (current.mpbgp !== backup?.mpbgp || current.extendedNexthop !== backup?.extendedNexthop) {
                        requestBody.extensions = (current.mpbgp ? 'mp_bgp' : '') + (current.extendedNexthop ? ',extended_nexthop' : '');
                    }
                    console.log('[modify_confirm] Request body:', JSON.stringify(requestBody));
                    const result = await apiRequest('/admin', 'POST', requestBody, config.apiToken);
                    console.log('[modify_confirm] Response:', JSON.stringify(result));

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
                } catch (error) {
                    console.error('[modify_confirm] Error:', error);
                    await ctx.reply(`❌ Failed to submit changes: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
                ctx.session.peerFlow = undefined;
                return;
            }

            // === New ReplyKeyboard-based step handlers ===

            case 'modify_region': {
                if (isBackButton(text)) {
                    await showModifyMenu(ctx);
                    return;
                }

                // Parse node selection (format: "📍 nodeName (location)")
                const nodeMatch = text.match(/📍\s*(.+?)\s*\(/);
                if (!nodeMatch) {
                    await ctx.reply('❌ Invalid selection. Please choose from the menu.');
                    return;
                }

                const selectedNodeName = nodeMatch[1]!.trim();

                // Fetch nodes to get UUID
                try {
                    const nodeResult = await apiRequest('/admin', 'POST', { action: 'enumRouters' }, config.apiToken);
                    const nodes = nodeResult.data?.routers || [];
                    const targetNode = nodes.find((n: { name: string }) => n.name === selectedNodeName);

                    if (!targetNode) {
                        await ctx.reply('❌ Node not found. Please try again.');
                        return;
                    }

                    // Migration is complex - for now just update the router info
                    await ctx.reply(
                        `⚠️ Node migration to \`${selectedNodeName}\` requires manual operation.\n` +
                        `节点迁移到 \`${selectedNodeName}\` 需要手动操作。\n\n` +
                        `Please contact admin for node migration.`,
                        { parse_mode: 'Markdown' }
                    );
                } catch {
                    await ctx.reply('❌ Failed to fetch node info');
                }

                await showModifyMenu(ctx);
                return;
            }

            case 'modify_session_type': {
                if (isBackButton(text)) {
                    await showModifyMenu(ctx);
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                if (text.includes('MP-BGP + ENH')) {
                    current.mpbgp = true;
                    current.extendedNexthop = true;
                    await ctx.reply('✅ Session type updated: MP-BGP + ENH\n会话类型已更新');
                } else if (text.includes('MP-BGP Only')) {
                    current.mpbgp = true;
                    current.extendedNexthop = false;
                    await ctx.reply('✅ Session type updated: MP-BGP Only\n会话类型已更新');
                } else if (text.includes('IPv6 + IPv4')) {
                    current.mpbgp = false;
                    current.extendedNexthop = false;
                    await ctx.reply('✅ Session type updated: IPv6 + IPv4 (独立会话)\n会话类型已更新');
                } else {
                    await ctx.reply('❌ Invalid selection');
                    return;
                }

                ctx.session.peerFlow = { ...flow, current };
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_bgp_address': {
                if (isBackButton(text)) {
                    await showModifyMenu(ctx);
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                if (text.includes('Peer IPv6')) {
                    ctx.session.peerFlow = { ...flow, step: 'modify_peerIpv6' };
                    await ctx.reply(
                        '🌐 *Modify Peer IPv6*\n\n' +
                        `Current: \`${current.ipv6 || 'Not set'}\`\n\n` +
                        'Supported types:\n' +
                        '• fe80::/64 Link-Local\n' +
                        '• fd00::/8 or fc00::/7 ULA\n\n' +
                        'Enter new IPv6:\n输入新的 IPv6:',
                        { parse_mode: 'Markdown' }
                    );
                } else if (text.includes('Peer IPv4')) {
                    ctx.session.peerFlow = { ...flow, step: 'modify_peerIpv4' };
                    await ctx.reply(
                        '🌐 *Modify Peer IPv4*\n\n' +
                        `Current: \`${current.ipv4 || 'Not set'}\`\n\n` +
                        'Supported ranges:\n' +
                        '• 172.20.0.0/14 (DN42)\n' +
                        '• 10.127.0.0/16 (DN42)\n' +
                        '• Enter "none" to disable\n\n' +
                        'Enter new IPv4:\n输入新的 IPv4:',
                        { parse_mode: 'Markdown' }
                    );
                } else if (text.includes('Local IPv6')) {
                    ctx.session.peerFlow = { ...flow, step: 'modify_localIpv6' };
                    await ctx.reply(
                        '🌐 *Modify Local IPv6*\n\n' +
                        `Current: \`${current.localIpv6 || 'Not set'}\`\n\n` +
                        'Enter our IPv6 address for BGP peering:\n' +
                        '输入我方用于 BGP 对等的 IPv6 地址:',
                        { parse_mode: 'Markdown' }
                    );
                } else if (text.includes('Local IPv4')) {
                    ctx.session.peerFlow = { ...flow, step: 'modify_localIpv4' };
                    await ctx.reply(
                        '🌐 *Modify Local IPv4*\n\n' +
                        `Current: \`${current.localIpv4 || 'Not set'}\`\n\n` +
                        'Enter our IPv4 address for BGP peering:\n' +
                        '输入我方用于 BGP 对等的 IPv4 地址:',
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply('❌ Invalid selection');
                }
                return;
            }

            case 'modify_psk': {
                if (isBackButton(text)) {
                    await showModifyMenu(ctx);
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                if (text.includes('Generate') || text.includes('Enable')) {
                    // Generate new PSK
                    const psk = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
                    current.psk = true;
                    ctx.session.peerFlow = { ...flow, current, psk };
                    await ctx.reply(
                        '🔑 *PSK Generated*\n已生成 PSK\n\n' +
                        `\`${psk}\`\n\n` +
                        '⚠️ Save this key! You need to configure it on your side.\n' +
                        '请保存此密钥，稍后需要在你这边配置。',
                        { parse_mode: 'Markdown' }
                    );
                } else if (text.includes('Disable')) {
                    current.psk = false;
                    ctx.session.peerFlow = { ...flow, current };
                    await ctx.reply('✅ PSK disabled\nPSK 已禁用');
                } else {
                    await ctx.reply('❌ Invalid selection');
                    return;
                }

                await showModifyMenu(ctx);
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

            // ULA Mode: Peer IPv6 input
            case 'input_peer_ipv6_ula': {
                const ipv6 = text.includes('/') ? text.split('/')[0] : text;
                if (!isValidIPv6(ipv6 || '')) {
                    await ctx.reply('❌ Invalid IPv6 address. Please try again.\n无效的 IPv6 地址，请重试。');
                    return;
                }

                // Check if ULA/GUA (not link-local)
                if (isLinkLocal(ipv6 || '')) {
                    await ctx.reply(
                        '❌ Link-Local addresses are not allowed in ULA mode.\n' +
                        'ULA 模式不允许使用 Link-Local 地址。\n\n' +
                        'Use MP-BGP + ENH mode for Link-Local addresses.\n' +
                        '请使用 MP-BGP + ENH 模式来使用 Link-Local 地址。'
                    );
                    return;
                }

                // Validate IP ownership (use targetAsn for admin mode)
                const asn = flow.isAdminMode ? (flow.targetAsn || 0) : (ctx.session.asn || 0);
                const validation = await validateIpOwnership(asn, ipv6 || '');
                if (!validation.valid && validation.warning) {
                    await ctx.reply(validation.warning);
                }

                ctx.session.peerFlow = { ...flow, step: 'input_local_ipv6_ula', ipv6 };
                await ctx.reply(
                    `📝 *Local IPv6 Address 我方 IPv6 地址*\n\n` +
                    `Enter the IPv6 address for OUR side (from YOUR IP pool).\n` +
                    `请输入我方使用的 IPv6 地址（从你的 IP 池分配）。\n\n` +
                    `⚠️ Must also be registered in DN42 under your ASN.\n` +
                    `⚠️ 也必须在 DN42 注册表中属于你的 ASN。`,
                    { parse_mode: 'Markdown' }
                );
                break;
            }

            // ULA Mode: Local IPv6 input
            case 'input_local_ipv6_ula': {
                const localIpv6 = text.includes('/') ? text.split('/')[0] : text;
                if (!isValidIPv6(localIpv6 || '')) {
                    await ctx.reply('❌ Invalid IPv6 address. Please try again.\n无效的 IPv6 地址，请重试。');
                    return;
                }

                if (isLinkLocal(localIpv6 || '')) {
                    await ctx.reply(
                        '❌ Link-Local addresses are not allowed in ULA mode.\n' +
                        'ULA 模式不允许使用 Link-Local 地址。'
                    );
                    return;
                }

                // Validate IP ownership (use targetAsn for admin mode)
                const asn = flow.isAdminMode ? (flow.targetAsn || 0) : (ctx.session.asn || 0);
                const validation = await validateIpOwnership(asn, localIpv6 || '');
                if (!validation.valid && validation.warning) {
                    await ctx.reply(validation.warning);
                }

                ctx.session.peerFlow = { ...flow, step: 'input_peer_ipv4_ula', localIpv6 };
                await ctx.reply(
                    `📝 *Peer IPv4 Address 对方 IPv4 地址*\n\n` +
                    `Enter your DN42 IPv4 address (from YOUR IP pool).\n` +
                    `请输入你的 DN42 IPv4 地址（从你的 IP 池分配）。\n\n` +
                    `Allowed ranges 允许的范围:\n` +
                    `• \`172.20.0.0/14\` (DN42)\n` +
                    `• \`10.127.0.0/16\` (DN42)\n` +
                    `• \`44.0.0.0/8\` (ARDC)`,
                    { parse_mode: 'Markdown' }
                );
                break;
            }

            // ULA Mode: Peer IPv4 input
            case 'input_peer_ipv4_ula': {
                const ipv4 = text.trim();
                if (!isDN42IPv4(ipv4)) {
                    await ctx.reply(
                        '❌ Invalid DN42 IPv4 address.\n无效的 DN42 IPv4 地址。\n\n' +
                        'Allowed: 172.20-23.x.x, 10.127.x.x, 44.x.x.x'
                    );
                    return;
                }

                // Validate IP ownership (use targetAsn for admin mode)
                const asn = flow.isAdminMode ? (flow.targetAsn || 0) : (ctx.session.asn || 0);
                const validation = await validateIpOwnership(asn, ipv4);
                if (!validation.valid && validation.warning) {
                    await ctx.reply(validation.warning);
                }

                ctx.session.peerFlow = { ...flow, ipv4, step: 'input_local_ipv4_ula' };
                await ctx.reply(
                    `📝 *Local IPv4 Address 我方 IPv4 地址*\n\n` +
                    `Enter the IPv4 address for OUR side (from YOUR IP pool).\n` +
                    `请输入我方使用的 IPv4 地址（从你的 IP 池分配）。`,
                    { parse_mode: 'Markdown' }
                );
                break;
            }

            // ULA Mode: Local IPv4 input
            case 'input_local_ipv4_ula': {
                const localIpv4 = text.trim();
                if (!isDN42IPv4(localIpv4)) {
                    await ctx.reply(
                        '❌ Invalid DN42 IPv4 address.\n无效的 DN42 IPv4 地址。\n\n' +
                        'Allowed: 172.20-23.x.x, 10.127.x.x, 44.x.x.x'
                    );
                    return;
                }

                // Validate IP ownership (use targetAsn for admin mode)
                const asn = flow.isAdminMode ? (flow.targetAsn || 0) : (ctx.session.asn || 0);
                const validation = await validateIpOwnership(asn, localIpv4);
                if (!validation.valid && validation.warning) {
                    await ctx.reply(validation.warning);
                }

                ctx.session.peerFlow = { ...flow, localIpv4, step: 'input_endpoint' };

                await ctx.reply(
                    `✅ *ULA Mode Addresses Set*\n\n` +
                    `Peer IPv6: \`${flow.ipv6}\`\n` +
                    `Local IPv6: \`${flow.localIpv6}\`\n` +
                    `Peer IPv4: \`${flow.ipv4}\`\n` +
                    `Local IPv4: \`${localIpv4}\``,
                    { parse_mode: 'Markdown' }
                );
                await promptEndpoint(ctx);
                break;
            }

            case 'input_endpoint': {
                let endpoint = text;
                let port: number | undefined;

                // Parse port from endpoint
                if (text.toLowerCase() === 'none' || text.includes('NAT')) {
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
                // Hybrid confirmation: support both InlineKeyboard button AND text "yes"
                if (text.toLowerCase() === 'yes') {
                    // Trigger confirmation logic (same as peer:confirm callback)
                    const asn = flow.isAdminMode ? flow.targetAsn : ctx.session.asn;
                    if (!asn) {
                        ctx.session.peerFlow = undefined;
                        return;
                    }

                    await ctx.reply('⏳ Creating peer...\n正在创建 Peer...');

                    try {
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
                    return;
                }

                // Other text during confirm step - remind about options
                await ctx.reply(
                    'Please use the buttons above OR type `yes` to confirm.\n' +
                    '请使用上方按钮或输入 `yes` 确认',
                    { parse_mode: 'Markdown' }
                );
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
                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                let endpoint = '';
                let port = '';

                if (text.toLowerCase() !== 'none') {
                    // Parse endpoint:port
                    if (text.includes(':')) {
                        const parts = text.split(':');
                        const lastPart = parts.pop();
                        if (lastPart && /^\d+$/.test(lastPart)) {
                            port = lastPart;
                            endpoint = parts.join(':');
                        } else {
                            endpoint = text;
                        }
                    } else {
                        endpoint = text;
                    }
                }

                const oldEndpoint = flow.backup?.endpoint
                    ? (flow.backup?.port ? `${flow.backup.endpoint}:${flow.backup.port}` : flow.backup.endpoint)
                    : 'none';
                const newEndpoint = endpoint ? (port ? `${endpoint}:${port}` : endpoint) : 'none';

                current.endpoint = endpoint;
                current.port = port;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Endpoint updated!\n端点已更新\n\n\`${oldEndpoint}\` → \`${newEndpoint}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_pubkey': {
                if (!isValidWgPubkey(text)) {
                    await ctx.reply('❌ Invalid public key. Should be 44 chars ending with =');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldPubkey = flow.backup?.pubkey ? flow.backup.pubkey.slice(0, 20) + '...' : 'Not set';
                const newPubkey = text.slice(0, 20) + '...';

                current.pubkey = text;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Public key updated!\n公钥已更新\n\n\`${oldPubkey}\` → \`${newPubkey}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_mtu': {
                // Handle '🔙 Back'
                if (isBackButton(text)) {
                    await showModifyMenu(ctx);
                    return;
                }

                // Parse MTU from text (handle "1420 (Default)" format)
                const mtuMatch = text.match(/^(\d+)/);
                const mtu = mtuMatch ? parseInt(mtuMatch[1]!, 10) : parseInt(text, 10);
                if (isNaN(mtu) || mtu < 1280 || mtu > 1500) {
                    await ctx.reply('❌ Invalid MTU. Please enter 1280-1500.');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldMtu = flow.backup?.mtu || 1420;
                current.mtu = mtu;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ MTU updated!\nMTU 已更新\n\n\`${oldMtu}\` → \`${mtu}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            // New field handlers
            case 'modify_peerIpv6': {
                // Validate IPv6 format
                const ipv6 = text.trim();
                if (!/^(fe80:|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i.test(ipv6)) {
                    await ctx.reply('❌ Invalid IPv6. Use Link-Local (fe80::) or ULA (fd00::/fc00::)');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldIpv6 = flow.backup?.ipv6 || 'Not set';
                current.ipv6 = ipv6;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Peer IPv6 updated!\n对方 IPv6 已更新\n\n\`${oldIpv6}\` → \`${ipv6}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_peerIpv4': {
                const ipv4 = text.trim().toLowerCase();
                if (ipv4 !== 'none' && !/^172\.(2[0-3]|1[6-9])\./.test(ipv4)) {
                    await ctx.reply('❌ Invalid DN42 IPv4. Use 172.20.x.x - 172.23.x.x or "none"');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldIpv4 = flow.backup?.ipv4 || 'Not set';
                const newIpv4 = ipv4 === 'none' ? 'none' : ipv4;
                current.ipv4 = ipv4 === 'none' ? '' : ipv4;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Peer IPv4 updated!\n对方 IPv4 已更新\n\n\`${oldIpv4}\` → \`${newIpv4}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_localIpv6': {
                const ipv6 = text.trim();
                if (!/^(fe80:|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i.test(ipv6)) {
                    await ctx.reply('❌ Invalid IPv6. Use Link-Local (fe80::) or ULA (fd00::/fc00::)');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldLocalIpv6 = flow.backup?.localIpv6 || 'Not set';
                current.localIpv6 = ipv6;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Local IPv6 updated!\n我方 IPv6 已更新\n\n\`${oldLocalIpv6}\` → \`${ipv6}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_localIpv4': {
                const ipv4 = text.trim().toLowerCase();
                if (ipv4 !== 'none' && !/^172\.(2[0-3]|1[6-9])\./.test(ipv4)) {
                    await ctx.reply('❌ Invalid DN42 IPv4. Use 172.20.x.x - 172.23.x.x or "none"');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldLocalIpv4 = flow.backup?.localIpv4 || 'Not set';
                const newLocalIpv4 = ipv4 === 'none' ? 'none' : ipv4;
                current.localIpv4 = ipv4 === 'none' ? '' : ipv4;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Local IPv4 updated!\n我方 IPv4 已更新\n\n\`${oldLocalIpv4}\` → \`${newLocalIpv4}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            case 'modify_contact': {
                const contact = text.trim();
                if (contact.length < 3 || contact.length > 200) {
                    await ctx.reply('❌ Contact must be 3-200 characters');
                    return;
                }

                const current = flow.current;
                if (!current) {
                    await showModifyMenu(ctx);
                    return;
                }

                const oldContact = flow.backup?.contact || 'Not set';
                current.contact = contact;
                ctx.session.peerFlow = { ...flow, current };
                await ctx.reply(`✅ Contact updated!\n联系方式已更新\n\n\`${oldContact}\` → \`${contact}\``, { parse_mode: 'Markdown' });
                await showModifyMenu(ctx);
                return;
            }

            // Remove confirmation: hybrid (InlineKeyboard + text "yes")
            case 'remove_confirm': {
                if (text.toLowerCase() === 'yes') {
                    const uuid = flow.routerUuid;
                    if (!uuid) {
                        ctx.session.peerFlow = undefined;
                        await ctx.reply('❌ Error: No session to remove');
                        return;
                    }

                    await ctx.reply('⏳ Removing peer...\n正在删除 Peer...');

                    try {
                        const result = await apiRequest('/admin', 'POST', {
                            action: 'delete',
                            uuid,
                        }, config.apiToken);

                        if (result.code !== 0) {
                            await ctx.reply(`❌ Failed to remove: ${result.message}`);
                        } else {
                            await ctx.reply('✅ Peer removed successfully!\n成功删除 Peer!');
                        }
                    } catch (error) {
                        console.error('[Remove] Text confirm error:', error);
                        await ctx.reply('❌ Failed to remove peer.');
                    }

                    ctx.session.peerFlow = undefined;
                    return;
                }

                // Other text - remind about options
                await ctx.reply(
                    'Please use the buttons above OR type `yes` to confirm deletion.\n' +
                    '请使用上方按钮或输入 `yes` 确认删除',
                    { parse_mode: 'Markdown' }
                );
                return;
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
        // Use targetAsn for admin mode, session.asn for user mode
        const asn = flow?.isAdminMode ? flow.targetAsn : ctx.session.asn;
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


    // Confirm callbacks (peer:confirm, peer:cancel) are now in handlers/confirm.ts


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
            sessions.forEach((s: { uuid: string; router: string; routerName?: string; status: number }) => {
                const displayName = s.routerName || s.router;
                keyboard.text(displayName, `modify:peer:${s.uuid}`).row();
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
            let credEndpoint = '';
            let credListenPort = '';
            if (session.credential) {
                try {
                    const cred = typeof session.credential === 'string'
                        ? JSON.parse(session.credential)
                        : session.credential;
                    pubkey = cred.pubkey || cred.public_key || '';
                    hasPsk = !!(cred.preshared_key || cred.psk);
                    // Extract endpoint from credential if DB endpoint doesn't have port
                    if (cred.endpoint) {
                        credEndpoint = cred.endpoint;
                    }
                    if (cred.listen_port) {
                        credListenPort = String(cred.listen_port);
                    }
                } catch {
                    pubkey = String(session.credential).slice(0, 44);
                }
            }

            // Resolve endpoint: prefer DB endpoint, fall back to credential endpoint
            const rawEndpoint = session.endpoint || credEndpoint || '';

            // Parse host:port from the resolved endpoint
            let resolvedHost = rawEndpoint;
            let resolvedPort = '';
            if (rawEndpoint && rawEndpoint.includes(':')) {
                const parts = rawEndpoint.split(':');
                const lastPart = parts[parts.length - 1];
                // Only treat as port if the last segment is purely numeric
                if (lastPart && /^\d+$/.test(lastPart)) {
                    resolvedPort = lastPart;
                    resolvedHost = parts.slice(0, -1).join(':');
                }
            }

            // Parse extensions (handles both JSON array and string format)
            const rawExt = session.extensions;
            const extStr = Array.isArray(rawExt) ? rawExt.join(',') : (rawExt || '');
            const hasMpbgp = extStr.includes('mp_bgp') || extStr.includes('mpbgp');
            const hasEnh = extStr.includes('extended_nexthop') || extStr.includes('enh');

            // Store backup state for diff tracking (dn42-bot style)
            ctx.session.peerFlow = {
                step: 'modify_menu',
                routerUuid: uuid,
                routerName: session.routerName || session.router,
                asn: session.asn,
                backup: {
                    endpoint: resolvedHost,
                    port: resolvedPort,
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
                    endpoint: resolvedHost,
                    port: resolvedPort,
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
            const endpointDisplay = resolvedHost
                ? (resolvedPort ? `${resolvedHost}:${resolvedPort}` : resolvedHost)
                : 'Not set';

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
                `    Endpoint:    ${endpointDisplay}\n` +
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
     * Handle modify:back - dismiss the inline keyboard and let user continue from menu
     */
    bot.callbackQuery('modify:back', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.deleteMessage();
        // User can continue selecting from ReplyKeyboard menu
    });


    // Modify callbacks (modify:psk, modify:sessionType, modify:mtu, modify:region) 
    // are now in handlers/modify.ts


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


    // Remove callbacks (remove:select, remove:confirm, remove:cancel) 
    // are now in handlers/remove.ts


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
