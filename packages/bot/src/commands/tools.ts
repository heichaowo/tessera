import type { Bot } from 'grammy';
import type { BotContext } from '../index';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a command with timeout
 */
async function runCommand(cmd: string, timeout = 10000): Promise<string> {
    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout });
        return stdout || stderr || 'No output';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).killed) {
            return 'Command timed out';
        }
        return `Error: ${(error as Error).message}`;
    }
}

export function registerToolsCommands(bot: Bot<BotContext>) {
    /**
     * /ping <target> - Ping IP or domain
     */
    bot.command('ping', async (ctx) => {
        const target = ctx.match?.trim();

        if (!target) {
            await ctx.reply('Usage: /ping <ip or domain>');
            return;
        }

        // Validate target (basic sanitization)
        if (!/^[\w.-]+$/.test(target)) {
            await ctx.reply('❌ Invalid target');
            return;
        }

        await ctx.reply(`🏓 Pinging ${target}...`);

        const result = await runCommand(`ping -c 4 ${target}`);
        await ctx.reply(`\`\`\`\n${result.slice(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
    });

    /**
     * /trace <target> - Traceroute
     */
    bot.command('trace', async (ctx) => {
        const target = ctx.match?.trim();

        if (!target) {
            await ctx.reply('Usage: /trace <ip or domain>');
            return;
        }

        if (!/^[\w.-]+$/.test(target)) {
            await ctx.reply('❌ Invalid target');
            return;
        }

        await ctx.reply(`🔍 Tracing route to ${target}...`);

        const result = await runCommand(`traceroute -m 20 ${target}`, 30000);
        await ctx.reply(`\`\`\`\n${result.slice(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
    });

    /**
     * /whois <query> - WHOIS lookup
     */
    bot.command('whois', async (ctx) => {
        const query = ctx.match?.trim();

        if (!query) {
            await ctx.reply('Usage: /whois <ASN or domain>');
            return;
        }

        if (!/^[\w.-]+$/.test(query)) {
            await ctx.reply('❌ Invalid query');
            return;
        }

        await ctx.reply(`📋 Looking up ${query}...`);

        // Use DN42 WHOIS server for ASN queries
        const server = query.toUpperCase().startsWith('AS') ? 'whois.dn42' : '';
        const serverArg = server ? `-h ${server}` : '';

        const result = await runCommand(`whois ${serverArg} ${query}`);
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
            await ctx.reply('Usage: /dig <domain> [type]');
            return;
        }

        if (!/^[\w.-]+$/.test(domain)) {
            await ctx.reply('❌ Invalid domain');
            return;
        }

        await ctx.reply(`🔎 DNS lookup for ${domain} (${recordType})...`);

        const result = await runCommand(`dig +short ${domain} ${recordType}`);
        await ctx.reply(`\`\`\`\n${result.slice(0, 4000) || 'No records found'}\n\`\`\``, { parse_mode: 'Markdown' });
    });
}
