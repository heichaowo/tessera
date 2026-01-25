import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

interface ApiResponse {
    code: number;
    message: string;
    data?: {
        stats?: NetworkStats;
        routers?: RouterStats[];
        sessions?: SessionInfo[];
    };
}

interface NetworkStats {
    totalPeers: number;
    activePeers: number;
    pendingPeers: number;
    totalNodes: number;
    activeNodes: number;
}

interface RouterStats {
    name: string;
    location: string;
    sessionCount: number;
    isOpen: boolean;
}

interface SessionInfo {
    asn: number;
    router: string;
    status: number;
}

/**
 * API client
 */
async function apiRequest(endpoint: string, method = 'POST', body?: unknown) {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<ApiResponse>;
}

export function registerStatsCommands(bot: Bot<BotContext>) {
    /**
     * /stats - Show MoeNet network stats
     */
    bot.command('stats', async (ctx) => {
        try {
            // Get network statistics from API
            const result = await apiRequest('/admin', 'POST', {
                action: 'getStats',
            });

            if (result.code !== 0 || !result.data?.stats) {
                // Fallback to enumRouters
                const routerResult = await apiRequest('/admin', 'POST', {
                    action: 'enumRouters',
                });

                const routers = routerResult.data?.routers || [];
                const totalPeers = routers.reduce((sum: number, r: RouterStats) => sum + r.sessionCount, 0);
                const activeNodes = routers.filter((r: RouterStats) => r.isOpen).length;

                await ctx.reply(
                    `📊 *MoeNet Statistics*\n\n` +
                    `🖥️ Nodes: ${routers.length} (${activeNodes} open)\n` +
                    `👥 Total Peers: ${totalPeers}\n\n` +
                    `_Last updated: ${new Date().toISOString().slice(0, 19)}_`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            const stats = result.data.stats;
            await ctx.reply(
                `📊 *MoeNet Statistics*\n\n` +
                `🖥️ Nodes: ${stats.totalNodes} (${stats.activeNodes} active)\n` +
                `👥 Peers: ${stats.activePeers} active / ${stats.totalPeers} total\n` +
                `⏳ Pending: ${stats.pendingPeers}\n\n` +
                `_Last updated: ${new Date().toISOString().slice(0, 19)}_`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Stats] Error:', error);
            await ctx.reply('❌ Failed to fetch statistics.');
        }
    });

    /**
     * /rank - Show node ranking by peer count
     */
    bot.command('rank', async (ctx) => {
        try {
            const result = await apiRequest('/admin', 'POST', {
                action: 'enumRouters',
            });

            const routers = (result.data?.routers || [])
                .sort((a: RouterStats, b: RouterStats) => b.sessionCount - a.sessionCount);

            if (routers.length === 0) {
                await ctx.reply('❌ No nodes found.');
                return;
            }

            let message = `🏆 *Node Ranking*\n节点排行\n\n`;

            routers.forEach((r: RouterStats, i: number) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                const status = r.isOpen ? '🟢' : '🔴';
                message += `${medal} ${status} *${r.name}* - ${r.sessionCount} peers\n`;
            });

            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Rank] Error:', error);
            await ctx.reply('❌ Failed to fetch rankings.');
        }
    });

    /**
     * /peerlist - Show peer list (admin: all peers, user: own peers)
     */
    bot.command('peerlist', async (ctx) => {
        // Check if admin
        const username = ctx.from?.username?.toLowerCase();
        const adminUsername = config.adminUsername?.toLowerCase().replace('@', '');
        const isAdmin = username === adminUsername || ctx.session.isAdmin === true;

        try {
            if (isAdmin) {
                // Admin view: show all peers
                const result = await apiRequest('/admin', 'POST', {
                    action: 'enumSessions',
                });

                if (result.code !== 0) {
                    await ctx.reply(`❌ Error: ${result.message}`);
                    return;
                }

                const sessions = (result.data?.sessions || []).slice(0, 30) as Array<{
                    asn: number;
                    router: string;
                    status: number;
                }>;

                if (sessions.length === 0) {
                    await ctx.reply('📋 No peers in system.\n系统中没有 Peer');
                    return;
                }

                let message = `📋 *All Peers (Admin View)*\n所有 Peer（管理员视图）\n\n`;

                sessions.forEach((s, i: number) => {
                    const statusIcon = s.status === 1 ? '✅' : s.status === 3 ? '⏳' : '❌';
                    message += `${statusIcon} \`AS${s.asn}\` @ ${s.router}\n`;
                });

                message += `\n_共 ${sessions.length} 个 Peer_`;

                await ctx.reply(message, { parse_mode: 'Markdown' });
            } else {
                // User view: show own peers
                if (!ctx.session.asn) {
                    await ctx.reply('❌ Please /login first.\n请先登录');
                    return;
                }

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
                    await ctx.reply('📋 You have no peers.\n你没有 Peer 连接');
                    return;
                }

                let message = `👥 *Your Peers (${sessions.length})*\n\n`;

                sessions.forEach((s: SessionInfo, i: number) => {
                    const statusIcon = s.status === 1 ? '🟢' : s.status === 3 ? '⏳' : '🔴';
                    message += `${i + 1}. ${statusIcon} ${s.router}\n`;
                });

                await ctx.reply(message, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error('[Peerlist] Error:', error);
            await ctx.reply('❌ Failed to fetch peer list.');
        }
    });
}
