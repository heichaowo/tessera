import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import * as i18n from '../i18n/messages';

interface APIResponse {
    code: number;
    message?: string;
    data?: {
        routers?: Array<{ uuid: string; name: string; isOpen: boolean; location?: string }>;
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

export function registerPeerCommands(bot: Bot<BotContext>) {
    /**
     * /peer - Start peer creation flow
     */
    bot.command('peer', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(i18n.ERROR_NOT_LOGGED_IN);
            return;
        }

        // Show identity confirmation
        await ctx.reply(
            i18n.fmt(i18n.PEER_IDENTITY, { asn: ctx.session.asn }),
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

            const routers = result.data.routers.filter((r: { isOpen: boolean }) => r.isOpen);

            if (routers.length === 0) {
                await ctx.reply('❌ No available nodes for peering.');
                return;
            }

            // Build inline keyboard for node selection
            const keyboard = new InlineKeyboard();
            routers.forEach((r: { name: string; location?: string; uuid: string }, i: number) => {
                keyboard.text(`${r.name} - ${r.location ?? 'Unknown'}`, `peer:node:${r.uuid}`);
                if ((i + 1) % 2 === 0) keyboard.row();
            });

            // Initialize peer flow in session
            ctx.session.peerFlow = { step: 'select_node' };

            await ctx.reply(i18n.PEER_SELECT_NODE, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
        } catch (error) {
            console.error('[Peer] Error:', error);
            await ctx.reply('❌ Failed to fetch nodes.');
        }
    });

    // Handle node selection
    bot.callbackQuery(/^peer:node:(.+)$/, async (ctx) => {
        const routerUuid = ctx.match[1];

        ctx.session.peerFlow = {
            step: 'input_ipv6',
            router: routerUuid,
        };

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(i18n.PEER_INPUT_IPV6, { parse_mode: 'Markdown' });
    });

    // Handle text input during peer flow
    bot.on('message:text', async (ctx, next) => {
        const flow = ctx.session.peerFlow;
        if (!flow) return next();

        const text = ctx.message.text.trim();

        switch (flow.step) {
            case 'input_ipv6': {
                // Validate IPv6
                if (!isValidIPv6(text)) {
                    await ctx.reply('❌ Invalid IPv6 address. Please try again.');
                    return;
                }
                ctx.session.peerFlow = { ...flow, step: 'input_endpoint', ipv6: text };
                await ctx.reply(i18n.PEER_INPUT_ENDPOINT, { parse_mode: 'Markdown' });
                break;
            }

            case 'input_endpoint': {
                const endpoint = text.toLowerCase() === 'none' ? null : text;
                ctx.session.peerFlow = { ...flow, step: 'input_port', endpoint: endpoint || undefined };
                await ctx.reply(i18n.PEER_INPUT_PORT, { parse_mode: 'Markdown' });
                break;
            }

            case 'input_port': {
                const port = parseInt(text);
                if (isNaN(port) || port < 1 || port > 65535) {
                    await ctx.reply('❌ Invalid port number. Please enter 1-65535.');
                    return;
                }
                ctx.session.peerFlow = { ...flow, step: 'input_pubkey', port: port.toString() };
                await ctx.reply(i18n.PEER_INPUT_PUBKEY, { parse_mode: 'Markdown' });
                break;
            }

            case 'input_pubkey': {
                // Validate WireGuard public key (base64, 44 chars)
                if (!isValidWgPubkey(text)) {
                    await ctx.reply('❌ Invalid WireGuard public key. Should be 44 characters base64.');
                    return;
                }

                ctx.session.peerFlow = { ...flow, step: 'confirm', publicKey: text };

                // Show confirmation
                const confirmMsg = i18n.fmt(i18n.PEER_CONFIRM, {
                    node: flow.router || 'Unknown',
                    asn: ctx.session.asn || 0,
                    ipv6: flow.ipv6 || 'N/A',
                    endpoint: flow.endpoint || 'N/A',
                    port: flow.port || 'N/A',
                    pubkey: text,
                });

                await ctx.reply(confirmMsg, { parse_mode: 'Markdown' });
                break;
            }

            case 'confirm': {
                if (text.toLowerCase() !== 'yes') {
                    ctx.session.peerFlow = undefined;
                    await ctx.reply(i18n.CANCELLED);
                    return;
                }

                // Create peer via API
                try {
                    // TODO: Get user's JWT token and call peering API
                    const result = await apiRequest('/session', 'POST', {
                        action: 'create',
                        data: {
                            router: flow.router,
                            ipv6: flow.ipv6,
                            endpoint: flow.endpoint ? `${flow.endpoint}:${flow.port}` : undefined,
                            publicKey: flow.publicKey,
                        },
                    }, ''); // Need user token here

                    if (result.code !== 0) {
                        await ctx.reply(`❌ Error: ${result.message}`);
                        return;
                    }

                    // TODO: Get actual my-side info from result
                    const successMsg = i18n.fmt(i18n.PEER_CREATED, {
                        my_endpoint: 'node.moenet.work',
                        my_port: '51820',
                        my_pubkey: 'xxxxxxxxxxxxx',
                        my_address: 'fd00:4242:7777::1',
                    });

                    await ctx.reply(successMsg, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error('[Peer] Create error:', error);
                    await ctx.reply('❌ Failed to create peer.');
                }

                ctx.session.peerFlow = undefined;
                break;
            }

            default:
                return next();
        }
    });

    /**
     * /info - Show peer info
     */
    bot.command('info', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(i18n.ERROR_NOT_LOGGED_IN);
            return;
        }

        // TODO: Fetch user's sessions from API
        await ctx.reply(
            `📊 *Peer Info for AS${ctx.session.asn}*\n\n` +
            'Fetching your peer information...',
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /modify - Modify existing peer
     */
    bot.command('modify', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(i18n.ERROR_NOT_LOGGED_IN);
            return;
        }

        await ctx.reply(
            '🔧 *Modify Peer*\n\n' +
            'This feature is under development.',
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /remove - Remove peer
     */
    bot.command('remove', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(i18n.ERROR_NOT_LOGGED_IN);
            return;
        }

        await ctx.reply(
            '🗑️ *Remove Peer*\n\n' +
            'This feature is under development.',
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /restart - Restart tunnel
     */
    bot.command('restart', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(i18n.ERROR_NOT_LOGGED_IN);
            return;
        }

        await ctx.reply(
            '🔄 *Restart Tunnel*\n\n' +
            'This feature is under development.',
            { parse_mode: 'Markdown' }
        );
    });
}

// Validation helpers
function isValidIPv6(ip: string): boolean {
    // Simple validation - allows link-local and ULA
    return /^[0-9a-f:]+$/i.test(ip) && ip.includes(':');
}

function isValidWgPubkey(key: string): boolean {
    return /^[A-Za-z0-9+/]{43}=$/.test(key);
}
