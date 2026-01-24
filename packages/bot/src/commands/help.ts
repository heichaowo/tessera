import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import { START_WELCOME, START_COMMANDS, CANCELLED } from '../i18n/messages';

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
