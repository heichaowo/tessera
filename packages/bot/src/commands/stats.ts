import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

/**
 * API client
 */
async function apiRequest(endpoint: string, method = 'POST', body?: unknown) {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
}

export function registerStatsCommands(bot: Bot<BotContext>) {
    /**
     * /stats [asn] - Show DN42 user stats
     */
    bot.command('stats', async (ctx) => {
        const query = ctx.match?.trim().replace(/^AS/i, '') || ctx.session.asn?.toString();

        if (!query || !/^\d+$/.test(query)) {
            await ctx.reply('用法: /stats [ASN]\n例如: /stats 4242420998');
            return;
        }

        await ctx.reply(`📊 Loading stats for AS${query}...`);

        // TODO: Fetch from explorer API
        await ctx.reply(
            `📊 *Stats for AS${query}*\n\n` +
            `This feature will fetch data from DN42 explorer.\n` +
            `此功能将从 DN42 explorer 获取数据。`,
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /rank - Show DN42 global ranking
     */
    bot.command('rank', async (ctx) => {
        await ctx.reply(
            `🏆 *DN42 Global Ranking*\n\n` +
            `This feature will show network rankings.\n` +
            `此功能将显示网络排名。\n\n` +
            `Visit: https://explorer.burble.com/`,
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /peerlist [asn] - Show peer list
     */
    bot.command('peerlist', async (ctx) => {
        const query = ctx.match?.trim().replace(/^AS/i, '') || ctx.session.asn?.toString();

        if (!query || !/^\d+$/.test(query)) {
            await ctx.reply('用法: /peerlist [ASN]\n例如: /peerlist 4242420998');
            return;
        }

        await ctx.reply(
            `👥 *Peer List for AS${query}*\n\n` +
            `This feature will show peer connections.\n` +
            `此功能将显示 Peer 连接情况。`,
            { parse_mode: 'Markdown' }
        );
    });
}
