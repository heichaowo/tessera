import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import { registerHelpCommand } from './help';
import { registerUserCommands } from './user';
import { registerPeerCommands } from './peer';
import { registerToolsCommands } from './tools';
import { registerAdminCommands } from './admin';

/**
 * Register all bot commands
 */
export function registerCommands(bot: Bot<BotContext>) {
    registerHelpCommand(bot);
    registerUserCommands(bot);
    registerPeerCommands(bot);
    registerToolsCommands(bot);
    registerAdminCommands(bot);
}
