/**
 * Peer Module - UI Prompts
 *
 * Common prompt messages and keyboard builders for peer interactions.
 */

import type { BotContext } from '../../index';
import { BUTTONS, backButtonRow, buttonRow } from './helpers';

/**
 * Prompt for endpoint input
 */
export async function promptEndpoint(ctx: BotContext): Promise<void> {
    await ctx.reply(
        '📡 *Endpoint Configuration*\n\n' +
        'Enter your clearnet endpoint (domain:port or IP:port).\n' +
        '输入你的明网端点 (域名:端口 或 IP:端口)。\n\n' +
        'Type `none` if you don\'t have a public endpoint.\n' +
        '如果没有公共端点请输入 `none`。',
        { parse_mode: 'Markdown' }
    );
}

/**
 * Prompt for public key input
 */
export async function promptPubkey(ctx: BotContext): Promise<void> {
    await ctx.reply(
        '🔑 *WireGuard Public Key*\n\n' +
        'Enter your WireGuard public key:\n' +
        '输入你的 WireGuard 公钥:\n\n' +
        'Example: `wJXLTmRqHqJ2tJz0Cs3nLzk+DmMV38P/iZVfdWShqk8=`',
        { parse_mode: 'Markdown' }
    );
}

/**
 * Prompt for MTU selection
 */
export async function promptMtu(ctx: BotContext): Promise<void> {
    await ctx.reply(
        '📏 *MTU Settings*\n\n' +
        'Select common MTU or enter custom value (1280-1500):\n' +
        '选择常用 MTU 或输入自定义值:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    buttonRow('1420 (Default)', '1400'),
                    buttonRow('1380', '1360'),
                    buttonRow('1340', '1320'),
                    backButtonRow(),
                ],
                resize_keyboard: true,
            }
        }
    );
}

/**
 * Prompt for PSK option
 */
export async function promptPsk(ctx: BotContext): Promise<void> {
    await ctx.reply(
        '🔐 *Pre-Shared Key (PSK)*\n\n' +
        'PSK adds an extra layer of security.\n' +
        'PSK 增加额外的安全性。\n\n' +
        'Select an option:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    buttonRow('🔄 Auto Generate 自动生成'),
                    buttonRow('❌ No PSK 不使用'),
                    backButtonRow(),
                ],
                resize_keyboard: true,
            }
        }
    );
}

/**
 * Common error messages
 */
export const ERROR_MESSAGES = {
    NOT_LOGGED_IN: '❌ You are not logged in. Use /login first.\n你还没有登录，请先使用 /login 登录。',
    NO_SESSION_DATA: '❌ Error: No session data',
    INVALID_SELECTION: '❌ Invalid selection. Please choose from the menu.',
    FETCH_FAILED: '❌ Failed to fetch data. Please try again.',
    SUBMIT_FAILED: '❌ Failed to submit. Please try again.',
} as const;

/**
 * Success message helper
 */
export function successMessage(field: string, value: string): string {
    return `✅ ${field} updated: \`${value}\`\n${field}已更新`;
}
