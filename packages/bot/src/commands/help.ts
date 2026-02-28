import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';

const START_WELCOME = `🌐 *MoeNet DN42 Bot*\n\nWelcome to MoeNet DN42 Network.\n欢迎来到 MoeNet DN42 网络。`;

const START_COMMANDS = `*Available Commands 可用命令:*

*User Commands 用户命令:*
• /login - Login with ASN 登录
• /peer - Create new peer 创建 Peer
• /info - View your peers 查看 Peer 列表
• /modify - Modify peer 修改 Peer
• /remove - Remove peer 删除 Peer
• /status - WG/BGP status 状态查询
• /restart - Restart WG+BGP 重启

*Network Tools 网络工具:*
• /lg - Looking glass 路由查询
• /route - BIRD route lookup 路由查找
• /path - AS-Path lookup 路径查询
• /ping - Ping test 连通测试
• /trace - Traceroute 路由追踪
• /tcping - TCP Ping 端口测试
• /whois - DN42 Whois 查询
• /dig - DNS lookup 域名查询
• /findnoc - Find NOC contacts 查找联系人
• /cancel - Cancel operation 取消操作

📞 Contact: ${config.telegramContact || '@heicha'}`;

const CANCELLED = '🚫 Operation cancelled.\n已取消当前操作';

export function registerHelpCommand(bot: Bot<BotContext>) {
    bot.command('start', async (ctx) => {
        await ctx.reply(START_WELCOME, { parse_mode: 'Markdown' });
        await ctx.reply(START_COMMANDS, { parse_mode: 'Markdown' });
    });

    bot.command('help', async (ctx) => {
        await ctx.reply(START_COMMANDS, { parse_mode: 'Markdown' });
    });

    bot.command('cancel', async (ctx) => {
        // Clear any ongoing flow
        ctx.session.peerFlow = undefined;
        await ctx.reply(CANCELLED);
    });
}
