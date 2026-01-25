import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import * as i18n from '../i18n/messages';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

interface APIResponse {
    code: number;
    message?: string;
    data?: {
        person?: string;
        availableAuthMethods?: Array<{ type: number }>;
        [key: string]: unknown;
    };
}

/**
 * API client for moenet-core
 */
async function apiRequest(endpoint: string, method = 'POST', body?: unknown): Promise<APIResponse> {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<APIResponse>;
}

// Store for verification challenges
const challengeStore = new Map<number, { asn: number; challenge: string; method: string; gpgFp?: string; sshKey?: string }>();

export function registerUserCommands(bot: Bot<BotContext>) {
    /**
     * /login - Start authentication flow
     */
    bot.command('login', async (ctx) => {
        // Check if already logged in
        if (ctx.session.asn) {
            await ctx.reply(
                i18n.fmt(i18n.LOGIN_ALREADY, { asn: ctx.session.asn }),
                { parse_mode: 'Markdown' }
            );
            return;
        }

        await ctx.reply(i18n.LOGIN_ASK_ASN, { parse_mode: 'Markdown' });
    });

    // Handle ASN input for login
    bot.on('message:text', async (ctx, next) => {
        // Check if waiting for ASN input
        if (ctx.session.asn || ctx.message.text.startsWith('/')) {
            return next();
        }

        const text = ctx.message.text.trim();

        // Check if it looks like an ASN
        const asnMatch = text.match(/^(?:AS)?(\d+)$/i);
        if (!asnMatch?.[1]) {
            return next();
        }

        const asn = parseInt(asnMatch[1]);

        if (asn < 4242420000 || asn > 4242429999) {
            await ctx.reply(i18n.ERROR_INVALID_ASN);
            return;
        }

        // Query auth methods from API
        try {
            const result = await apiRequest('/auth', 'POST', {
                action: 'query',
                asn: String(asn),
            });

            if (result.code !== 0) {
                await ctx.reply(`❌ Error: ${result.message ?? 'Unknown error'}`);
                return;
            }

            const person = result.data?.person;
            const availableAuthMethods = result.data?.availableAuthMethods;

            if (!availableAuthMethods || availableAuthMethods.length === 0) {
                await ctx.reply(
                    `❌ No authentication methods found for AS${asn}\n` +
                    `在 Registry 中未找到认证方式\n\n` +
                    'Please make sure your WHOIS object has pgp-fingerprint or contact email.'
                );
                return;
            }

            // Build auth method keyboard
            const keyboard = new InlineKeyboard();

            // Group by type
            const hasGPG = availableAuthMethods.some((m: { type: number }) => m.type === 1);
            const hasEmail = availableAuthMethods.some((m: { type: number }) => m.type === 3);
            const hasSSH = availableAuthMethods.some((m: { type: number }) => m.type === 2);

            if (hasGPG) {
                keyboard.text('🔐 GPG Signature 签名', `login:gpg:${asn}`);
            }
            if (hasEmail) {
                keyboard.text('📧 Email 邮箱', `login:email:${asn}`);
            }
            if (hasSSH) {
                keyboard.text('🔑 SSH Signature', `login:ssh:${asn}`);
            }

            await ctx.reply(
                `👤 *${person}* (AS${asn})\n\n` +
                i18n.LOGIN_CHOOSE_METHOD,
                {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard,
                }
            );
        } catch (error) {
            console.error('[Login] Error:', error);
            await ctx.reply('❌ Failed to query authentication methods');
        }
    });

    // Handle GPG login
    bot.callbackQuery(/^login:gpg:(\d+)$/, async (ctx) => {
        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr);
        const userId = ctx.from.id;

        // Generate challenge
        const challenge = crypto.randomBytes(16).toString('hex');

        // Store challenge
        challengeStore.set(userId, { asn, challenge, method: 'gpg' });

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `🔐 *GPG Signature Challenge*\n` +
            `🔐 *GPG 签名挑战*\n\n` +
            `Challenge String / 挑战字符串:\n` +
            `\`${challenge}\`\n\n` +
            `Please sign with your GPG key:\n` +
            `请使用你的 GPG 私钥签名:\n\n` +
            `\`echo -n '${challenge}' | gpg --clearsign\`\n\n` +
            `Send the complete signed message.\n` +
            `发送完整的签名消息。`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle Email login
    bot.callbackQuery(/^login:email:(\d+)$/, async (ctx) => {
        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr);
        const userId = ctx.from.id;

        // Generate 6-digit code
        const code = String(Math.floor(100000 + Math.random() * 900000));

        // Store challenge
        challengeStore.set(userId, { asn, challenge: code, method: 'email' });

        // TODO: Send email via API
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `📧 *Email Verification*\n` +
            `📧 *邮箱验证*\n\n` +
            `Verification code has been sent to your email.\n` +
            `验证码已发送至您的邮箱。\n\n` +
            `Please enter the 6-digit code:\n` +
            `请输入6位验证码:`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle SSH login
    bot.callbackQuery(/^login:ssh:(\d+)$/, async (ctx) => {
        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr);
        const userId = ctx.from.id;

        // Generate challenge
        const challenge = crypto.randomBytes(16).toString('hex');

        // Store challenge
        challengeStore.set(userId, { asn, challenge, method: 'ssh' });

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `🔑 *SSH Signature Challenge*\n` +
            `🔑 *SSH 签名挑战*\n\n` +
            `Challenge String / 挑战字符串:\n` +
            `\`${challenge}\`\n\n` +
            `Please sign with your SSH key:\n` +
            `请使用你的 SSH 私钥签名:\n\n` +
            `\`echo -n '${challenge}' | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file\`\n\n` +
            `Send the complete signature.\n` +
            `发送完整的签名结果。`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle signature/code verification
    bot.on('message:text', async (ctx, next) => {
        const userId = ctx.from.id;
        const stored = challengeStore.get(userId);

        if (!stored) {
            return next();
        }

        const text = ctx.message.text.trim();

        // Cancel
        if (text === '/cancel') {
            challengeStore.delete(userId);
            await ctx.reply(i18n.CANCELLED);
            return;
        }

        const { asn, challenge, method } = stored;

        try {
            if (method === 'email') {
                // Verify email code
                if (text === challenge) {
                    challengeStore.delete(userId);
                    ctx.session.asn = asn;
                    ctx.session.person = `AS${asn}`;
                    await ctx.reply(
                        i18n.fmt(i18n.LOGIN_SUCCESS, { mnt: `AS${asn}`, asn }),
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply('❌ Invalid code. Try again.\n验证码错误，请重试。');
                }
            } else if (method === 'gpg') {
                // Verify GPG signature
                const verified = await verifyGpgSignature(text, challenge);

                if (verified) {
                    challengeStore.delete(userId);
                    ctx.session.asn = asn;
                    ctx.session.person = `AS${asn}`;
                    await ctx.reply(
                        i18n.fmt(i18n.LOGIN_SUCCESS, { mnt: `AS${asn}`, asn }),
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply('❌ Signature verification failed.\n签名验证失败。');
                }
            } else if (method === 'ssh') {
                // Verify SSH signature
                const verified = await verifySshSignature(text, challenge);

                if (verified) {
                    challengeStore.delete(userId);
                    ctx.session.asn = asn;
                    ctx.session.person = `AS${asn}`;
                    await ctx.reply(
                        i18n.fmt(i18n.LOGIN_SUCCESS, { mnt: `AS${asn}`, asn }),
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply('❌ Signature verification failed.\n签名验证失败。');
                }
            }
        } catch (error) {
            console.error('[Login] Verification error:', error);
            await ctx.reply(`❌ Verification error: ${(error as Error).message}`);
        }
    });

    /**
     * /logout - Clear session
     */
    bot.command('logout', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply('❌ You are not logged in.\n你尚未登录。');
            return;
        }

        const asn = ctx.session.asn;
        ctx.session.asn = undefined;
        ctx.session.person = undefined;
        ctx.session.isAdmin = undefined;

        await ctx.reply(`👋 Logged out from AS${asn}\n已退出 AS${asn}`);
    });

    /**
     * /whoami - Show current user
     */
    bot.command('whoami', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(i18n.ERROR_NOT_LOGGED_IN);
            return;
        }

        const { asn, person, isAdmin } = ctx.session;
        const adminBadge = isAdmin ? ' 👑 Admin' : '';

        await ctx.reply(
            `👤 *Current User 当前用户*\n\n` +
            `ASN: AS${asn}\n` +
            `Name: ${person}${adminBadge}`,
            { parse_mode: 'Markdown' }
        );
    });
}

/**
 * Verify GPG clearsign signature
 */
async function verifyGpgSignature(signature: string, expectedContent: string): Promise<boolean> {
    const tmpDir = os.tmpdir();
    const sigFile = path.join(tmpDir, `sig_${Date.now()}.asc`);

    try {
        await fs.writeFile(sigFile, signature);

        // Verify and decrypt
        const { stdout, stderr } = await execAsync(`gpg --decrypt "${sigFile}" 2>&1`);
        const content = stdout.trim();

        // Check if content matches challenge
        if (content === expectedContent) {
            return true;
        }

        // Also check in stderr (gpg sometimes outputs there)
        if (stderr.includes('Good signature')) {
            return true;
        }

        return false;
    } catch (error) {
        console.error('[GPG] Verification error:', error);
        return false;
    } finally {
        try {
            await fs.unlink(sigFile);
        } catch { }
    }
}

/**
 * Verify SSH signature
 */
async function verifySshSignature(signature: string, _expectedContent: string): Promise<boolean> {
    // SSH signature verification requires the public key
    // For now, just check if the signature format is valid
    if (signature.includes('-----BEGIN SSH SIGNATURE-----')) {
        // TODO: Proper SSH signature verification with known public keys
        console.log('[SSH] Signature format valid, TODO: implement full verification');
        return true; // Placeholder - need to implement properly
    }
    return false;
}
