import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import { getNodes, getAgentEndpoint } from '../providers/nodes';

/**
 * Execute tool on agent node(s)
 */
async function executeOnAgent(
    command: string,
    target: string,
    nodeId: string
): Promise<string> {
    const nodes = await getNodes();
    const nodeIds = nodeId === 'all'
        ? Array.from(nodes.keys())
        : [nodeId];

    if (nodeIds.length === 0) {
        return await runLocalCommand(command, target);
    }

    const results: string[] = [];

    for (const id of nodeIds) {
        const node = nodes.get(id);
        if (!node) continue;

        const endpoint = await getAgentEndpoint(id);
        if (!endpoint) {
            results.push(`❌ ${id}: No agent endpoint`);
            continue;
        }

        try {
            const response = await fetch(`${endpoint}/${command}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.agentToken || ''}`,
                },
                body: JSON.stringify({ target }),
            });

            if (response.ok) {
                const data = await response.json() as { result?: string };
                const nodeName = node.location || id;
                results.push(`📍 *${nodeName}*\n\`\`\`\n${data.result || 'No output'}\n\`\`\``);
            } else {
                results.push(`❌ ${id}: HTTP ${response.status}`);
            }
        } catch (error) {
            results.push(`❌ ${id}: ${(error as Error).message.slice(0, 50)}`);
        }
    }

    return results.join('\n\n') || 'No results';
}

/**
 * Run command locally (fallback)
 */
async function runLocalCommand(command: string, target: string): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const cmdMap: Record<string, string> = {
        ping: `ping -c 4 ${target}`,
        trace: `traceroute -m 20 ${target}`,
        tcping: `nc -zv ${target.split(':')[0]} ${target.split(':')[1] || 80} 2>&1`,
        route: `birdc show route for ${target} all`,
        path: `birdc show route for ${target} all | grep -E "BGP.as_path|via"`,
    };

    const cmd = cmdMap[command];
    if (!cmd) return 'Unknown command';

    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
        return stdout || stderr || 'No output';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).killed) {
            return 'Command timed out';
        }
        return `Error: ${(error as Error).message}`;
    }
}

/**
 * Build node selection keyboard (async - loads from API)
 */
async function buildNodeKeyboard(command: string, target: string, currentNode = 'all'): Promise<InlineKeyboard> {
    const keyboard = new InlineKeyboard();
    const nodes = await getNodes();

    // All button
    const allLabel = currentNode === 'all' ? '✅ 全部' : '全部';
    keyboard.text(allLabel, `tool:${command}:${target}:all`);

    // Node buttons
    let count = 1;
    for (const [nodeId, node] of nodes) {
        const name = node.location || nodeId;
        const label = currentNode === nodeId ? `✅ ${name}` : name;
        keyboard.text(label, `tool:${command}:${target}:${nodeId}`);

        count++;
        if (count % 3 === 0) keyboard.row();
    }

    return keyboard;
}

export function registerToolsCommands(bot: Bot<BotContext>) {
    // Handle node selection callbacks
    bot.callbackQuery(/^tool:(\w+):([^:]+):(\w+)$/, async (ctx) => {
        const match = ctx.match;
        const command = match[1];
        const target = match[2];
        const node = match[3];

        await ctx.answerCallbackQuery('Executing...');

        const result = await executeOnAgent(command, target, node);
        const keyboard = await buildNodeKeyboard(command, target, node);

        await ctx.editMessageText(result.slice(0, 4000), {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    });

    /**
     * /ping <target> - Ping with node selection
     */
    bot.command('ping', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];
        const target = args[0];
        const node = args[1] || 'all';

        if (!target) {
            await ctx.reply('用法: /ping <IP/域名> [节点]');
            return;
        }

        if (!/^[\w.-]+$/.test(target)) {
            await ctx.reply('❌ Invalid target');
            return;
        }

        const keyboard = await buildNodeKeyboard('ping', target, node);
        const result = await executeOnAgent('ping', target, node);

        await ctx.reply(result.slice(0, 4000), {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    });

    /**
     * /tcping <target> [port] - TCP Ping
     */
    bot.command('tcping', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];
        const target = args[0];
        const port = args[1] || '80';

        if (!target) {
            await ctx.reply('用法: /tcping <IP/域名> [端口]');
            return;
        }

        const targetWithPort = `${target}:${port}`;
        const keyboard = await buildNodeKeyboard('tcping', targetWithPort, 'all');

        await ctx.reply(`🔌 TCPing ${target}:${port}...`, {
            reply_markup: keyboard,
        });

        const result = await executeOnAgent('tcping', targetWithPort, 'all');
        await ctx.reply(result.slice(0, 4000), { parse_mode: 'Markdown' });
    });

    /**
     * /trace <target> - Traceroute with node selection
     */
    bot.command('trace', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];
        const target = args[0];
        const node = args[1] || 'all';

        if (!target) {
            await ctx.reply('用法: /trace <IP/域名> [节点]');
            return;
        }

        if (!/^[\w.-]+$/.test(target)) {
            await ctx.reply('❌ Invalid target');
            return;
        }

        await ctx.reply(`🔍 Tracing route to ${target}...`);

        const keyboard = await buildNodeKeyboard('trace', target, node);
        const result = await executeOnAgent('trace', target, node);

        await ctx.reply(result.slice(0, 4000), {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    });

    /**
     * /route <target> - BIRD route lookup
     */
    bot.command('route', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];
        const target = args[0];
        const node = args[1] || 'all';

        if (!target) {
            await ctx.reply('用法: /route <IP/CIDR> [节点]');
            return;
        }

        const keyboard = await buildNodeKeyboard('route', target, node);
        const result = await executeOnAgent('route', target, node);

        await ctx.reply(result.slice(0, 4000), {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    });

    /**
     * /path <target> - AS-Path lookup
     */
    bot.command('path', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];
        const target = args[0];
        const node = args[1] || 'all';

        if (!target) {
            await ctx.reply('用法: /path <IP/CIDR> [节点]');
            return;
        }

        const keyboard = await buildNodeKeyboard('path', target, node);
        const result = await executeOnAgent('path', target, node);

        await ctx.reply(result.slice(0, 4000), {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    });

    /**
     * /whois <query> - WHOIS lookup
     */
    bot.command('whois', async (ctx) => {
        const query = ctx.match?.trim();

        if (!query) {
            await ctx.reply('用法: /whois <ASN/IP/name>\n例如: /whois AS4242420998');
            return;
        }

        await ctx.reply(`📋 Looking up ${query}...`);

        // Use DN42 WHOIS for ASN queries
        const server = query.toUpperCase().startsWith('AS') ? '-h whois.dn42' : '';
        const result = await runLocalCommand('whois', `${server} ${query}`);

        await ctx.reply(`\`\`\`\n${result.slice(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
    });

    /**
     * /dig <domain> [type] - DNS lookup
     */
    bot.command('dig', async (ctx) => {
        const args = ctx.match?.trim().split(/\s+/) || [];
        const domain = args[0];
        const recordType = args[1]?.toUpperCase() || 'A';

        if (!domain) {
            await ctx.reply('用法: /dig <域名> [类型]\n例如: /dig moenet.dn42 AAAA');
            return;
        }

        const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS', 'SOA', 'PTR'];
        if (!validTypes.includes(recordType)) {
            await ctx.reply(`❌ 不支持的记录类型: ${recordType}\n支持: ${validTypes.join(', ')}`);
            return;
        }

        // Query DN42 DNS
        const result = await runLocalCommand('dig', `@172.20.0.53 ${domain} ${recordType} +short`);

        await ctx.reply(
            `🔍 *DNS Query*\n\n` +
            `Domain: \`${domain}\`\n` +
            `Type: \`${recordType}\`\n` +
            `Server: \`anycast.baka.dn42\`\n\n` +
            `\`\`\`\n${result || 'No records found'}\n\`\`\``,
            { parse_mode: 'Markdown' }
        );
    });

    /**
     * /findnoc <ASN> - Find NOC contacts
     */
    bot.command('findnoc', async (ctx) => {
        const query = ctx.match?.trim().replace(/^AS/i, '');

        if (!query || !/^\d+$/.test(query)) {
            await ctx.reply('用法: /findnoc <ASN>\n例如: /findnoc 4242420998');
            return;
        }

        await ctx.reply(`📞 Looking up NOC for AS${query}...`);

        // Get WHOIS info
        const result = await runLocalCommand('whois', `-h whois.dn42 AS${query}`);

        // Extract contact info
        const lines = result.split('\n');
        const contacts: string[] = [];

        for (const line of lines) {
            if (line.match(/^(admin-c|tech-c|e-mail|contact|person):/i)) {
                contacts.push(line.trim());
            }
        }

        if (contacts.length > 0) {
            await ctx.reply(
                `📞 *NOC Contacts for AS${query}*\n\n\`\`\`\n${contacts.join('\n')}\n\`\`\``,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(`ℹ️ No contact info found for AS${query}\nTry /whois AS${query}`);
        }
    });
}
