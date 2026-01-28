import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import { registerHelpCommand } from './help';
import { registerUserCommands } from './user';
import { registerPeerCommands } from './peer';
import { registerToolsCommands } from './tools';
import { registerAdminCommands } from './admin';
import { registerStatsCommands } from './stats';
import { registerCommunityCommands } from './community';
import { registerBlockCommands } from './block';
import { registerMaintenanceCommands } from './maintenance';
import { registerNodeCommands } from './nodes';

/**
 * Register all bot commands
 */
export function registerCommands(bot: Bot<BotContext>) {
    registerHelpCommand(bot);
    registerUserCommands(bot);
    registerPeerCommands(bot);
    registerToolsCommands(bot);
    registerAdminCommands(bot);
    registerStatsCommands(bot);
    registerCommunityCommands(bot);
    registerBlockCommands(bot);
    registerMaintenanceCommands(bot);
    registerNodeCommands(bot);
}

