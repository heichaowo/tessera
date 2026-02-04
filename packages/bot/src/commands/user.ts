import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../index';
import config from '../config';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    ICONS,
    DIVIDER,
    formatTemplate,
    LOGIN_SUCCESS,
    LOGIN_SIGNATURE_CHALLENGE,
    CANCELLED,
} from '../templates';
import {
    START_WELCOME,
    START_COMMANDS,
    LOGIN_EMAIL_SENT,
    ERROR_NOT_LOGGED_IN,
} from '../i18n';

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

interface APIResponse {
    code: number;
    message?: string;
    data?: {
        person?: string;
        mntBy?: string;
        availableAuthMethods?: Array<{
            type: number;
            value?: string;
            fingerprint?: string;
        }>;
        [key: string]: unknown;
    };
}

interface ChallengeData {
    asn: number;
    mntBy: string;
    challenge: string;
    method: 'gpg' | 'ssh' | 'email';
    gpgFp?: string;
    sshKey?: string;
}

// Store for verification challenges
const challengeStore = new Map<number, ChallengeData>();

// =============================================================================
// API Client
// =============================================================================

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

// =============================================================================
// GPG Verification (Full Implementation)
// =============================================================================

/**
 * Extract primary key fingerprint from GPG output.
 * GPG signatures may use subkeys, but DN42 registry stores primary key fingerprints.
 */
function extractFingerprintFromGpgOutput(stderr: string): string {
    let primaryFingerprint = '';
    let subkeyFingerprint = '';

    for (const line of stderr.split('\n')) {
        if (line.includes('Primary key fingerprint:')) {
            const parts = line.split(':');
            const lastPart = parts[parts.length - 1];
            if (parts.length > 1 && lastPart) {
                primaryFingerprint = lastPart.trim().replace(/ /g, '').toUpperCase();
            }
        } else if (line.includes('Subkey fingerprint:')) {
            const parts = line.split(':');
            const lastPart = parts[parts.length - 1];
            if (parts.length > 1 && lastPart) {
                subkeyFingerprint = lastPart.trim().replace(/ /g, '').toUpperCase();
            }
        } else if (line.toLowerCase().includes('fingerprint:') && !primaryFingerprint) {
            const parts = line.split(':');
            const lastPart = parts[parts.length - 1];
            if (parts.length > 1 && lastPart) {
                primaryFingerprint = lastPart.trim().replace(/ /g, '').toUpperCase();
            }
        } else if (line.toLowerCase().includes('using') && line.toLowerCase().includes('key') && !subkeyFingerprint) {
            const words = line.split(/\s+/);
            for (const word of words) {
                if (word.length >= 16 && /^[0-9A-Fa-f]+$/.test(word)) {
                    subkeyFingerprint = word.toUpperCase();
                }
            }
        }
    }

    return primaryFingerprint || subkeyFingerprint;
}

/**
 * Decrypt GPG signed message to get original content
 */
async function gpgDecryptChallenge(sigPath: string): Promise<{ content: string | null; stderr: string }> {
    try {
        const { stdout, stderr } = await execAsync(`gpg --decrypt "${sigPath}" 2>&1`);
        return { content: stdout.trim(), stderr };
    } catch (error) {
        const e = error as Error & { stderr?: string };
        return { content: null, stderr: e.stderr || String(e) };
    }
}

/**
 * Import GPG key from keyserver
 */
async function recvGpgKeyFromKeyserver(fingerprint: string, keyserver: string): Promise<boolean> {
    try {
        await execAsync(`gpg --keyserver "${keyserver}" --recv-keys "${fingerprint}"`, { timeout: 30000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Verify GPG signature and check if fingerprint matches
 */
async function tryGpgVerifyFingerprint(
    sigPath: string,
    gpgFingerprints: string[]
): Promise<{ success: boolean; fingerprint?: string; error?: string }> {
    try {
        const { stderr } = await execAsync(`gpg --verify "${sigPath}" 2>&1`);
        const signatureFingerprint = extractFingerprintFromGpgOutput(stderr);

        if (!signatureFingerprint) {
            return { success: false, error: 'Could not extract fingerprint from signature' };
        }

        const fingerprintsUpper = gpgFingerprints.map(fp => fp.replace(/ /g, '').toUpperCase());

        const fingerprintMatched = fingerprintsUpper.some(fp =>
            signatureFingerprint.includes(fp) || fp.includes(signatureFingerprint)
        );

        if (!fingerprintMatched) {
            return { success: false, fingerprint: signatureFingerprint, error: 'Fingerprint not matched' };
        }

        return { success: true, fingerprint: signatureFingerprint };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

/**
 * Full GPG signature verification (dn42-bot style)
 */
async function verifyGpgSignatureFull(
    signature: string,
    expectedContent: string,
    gpgFingerprints: string[]
): Promise<{ verified: boolean; fingerprint?: string; needsManualKey?: boolean; error?: string }> {
    const tmpDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const sigFile = path.join(tmpDir, `sig_${uniqueId}.asc`);

    try {
        await fs.writeFile(sigFile, signature);

        // Step 1: Verify challenge string matches
        const { content } = await gpgDecryptChallenge(sigFile);

        if (!content || !content.includes(expectedContent)) {
            return {
                verified: false,
                error: `Challenge mismatch. Expected: ${expectedContent}, Got: ${content || '(unable to decrypt)'}`,
            };
        }

        // Step 2: Try to verify fingerprint directly
        let result = await tryGpgVerifyFingerprint(sigFile, gpgFingerprints);

        if (result.success) {
            return { verified: true, fingerprint: result.fingerprint };
        }

        // Step 3: Try to fetch key from keyservers
        const keyservers = [
            'hkps://keys.openpgp.org',
            'hkps://keyserver.ubuntu.com',
        ];

        for (const fp of gpgFingerprints) {
            for (const keyserver of keyservers) {
                await recvGpgKeyFromKeyserver(fp.replace(/ /g, ''), keyserver);
            }
        }

        // Retry verification
        result = await tryGpgVerifyFingerprint(sigFile, gpgFingerprints);

        if (result.success) {
            return { verified: true, fingerprint: result.fingerprint };
        }

        // Step 4: Need manual key upload
        return { verified: false, needsManualKey: true, error: result.error };

    } finally {
        try {
            await fs.unlink(sigFile);
        } catch { }
    }
}

// =============================================================================
// SSH Verification (Full Implementation)
// =============================================================================

/**
 * Full SSH signature verification
 */
async function verifySshSignatureFull(
    signature: string,
    challenge: string,
    sshKey: string
): Promise<{ verified: boolean; error?: string }> {
    const tmpDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const sigFile = path.join(tmpDir, `ssh_sig_${uniqueId}.sig`);
    const pubFile = path.join(tmpDir, `ssh_pub_${uniqueId}.pub`);
    const allowFile = path.join(tmpDir, `ssh_allow_${uniqueId}.txt`);

    try {
        await fs.writeFile(sigFile, signature);
        await fs.writeFile(pubFile, sshKey);
        await fs.writeFile(allowFile, `user ${sshKey}\n`);

        // Escape challenge to prevent shell injection
        const safeChallenge = challenge.replace(/'/g, "'\\''");
        const result = await execAsync(
            `echo -n '${safeChallenge}' | ssh-keygen -Y verify -f "${allowFile}" -I user -n file -s "${sigFile}"`,
            { timeout: 10000 }
        );

        return { verified: result.stdout.includes('Good signature') || result.stderr.includes('Good signature') };

    } catch (error) {
        const e = error as Error & { stdout?: string; stderr?: string };
        // ssh-keygen outputs "Good signature" even with non-zero exit in some cases
        if (e.stdout?.includes('Good signature') || e.stderr?.includes('Good signature')) {
            return { verified: true };
        }
        return { verified: false, error: String(error) };
    } finally {
        for (const f of [sigFile, pubFile, allowFile]) {
            try { await fs.unlink(f); } catch { }
        }
    }
}

// =============================================================================
// Command Registration
// =============================================================================

export function registerUserCommands(bot: Bot<BotContext>) {
    /**
     * /start - Welcome message
     */
    bot.command(['start', 'help'], async (ctx) => {
        // Auto-login admin user
        const username = ctx.from?.username?.toLowerCase();
        const adminUsername = config.adminUsername.toLowerCase().replace('@', '');

        if (username === adminUsername && !ctx.session.asn) {
            ctx.session.asn = config.localAsn || 4242420998;
            ctx.session.person = 'MOENET-MNT';
            ctx.session.isAdmin = true;
        }

        // Send welcome message (plain text with link preview)
        await ctx.reply(START_WELCOME, { link_preview_options: { is_disabled: false } });

        // Send command list as second message (with code block)
        await ctx.reply(START_COMMANDS, { parse_mode: 'Markdown' });
    });

    /**
     * /cancel - Global cancel handler
     */
    bot.command('cancel', async (ctx) => {
        const userId = ctx.from?.id;
        if (userId) {
            challengeStore.delete(userId);
            ctx.session.awaitingAsn = false;
        }
        await ctx.reply(
            `${ICONS.cancel} Operation cancelled. No ongoing operations.\n操作已取消。没有正在进行的操作。`
        );
    });

    /**
     * /login - Start authentication flow
     */
    bot.command('login', async (ctx) => {
        // Check if already logged in
        if (ctx.session.asn) {
            await ctx.reply(
                `${ICONS.info} *Already logged in 已登录*\n${DIVIDER}\n` +
                `Current identity 当前身份: \`${ctx.session.person || `AS${ctx.session.asn}`}\`\n\n` +
                `Use /logout to sign out.\n使用 /logout 退出。`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Mark that we're awaiting ASN input
        ctx.session.awaitingAsn = true;
        await ctx.reply(
            `${ICONS.login} *DN42 Login 登录*\n${DIVIDER}\n` +
            `Enter your ASN\n请输入你的 ASN\n\n` +
            `Example: \`AS4242420998\` or \`4242420998\`\n\n` +
            `/cancel to abort 取消`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle ASN input for login
    bot.on('message:text', async (ctx, next) => {
        // Only process if explicitly awaiting ASN input
        if (!ctx.session.awaitingAsn) {
            return next();
        }

        const text = ctx.message.text.trim();

        // Cancel
        if (text === '/cancel') {
            ctx.session.awaitingAsn = false;
            await ctx.reply(`${ICONS.cancel} ${CANCELLED}`);
            return;
        }

        // Check if it looks like an ASN
        const asnMatch = text.match(/^(?:AS)?(\d+)$/i);
        if (!asnMatch?.[1]) {
            await ctx.reply(`${ICONS.error} Invalid ASN format. Example: 4242420998\n无效的 ASN 格式。`);
            return;
        }

        const asn = parseInt(asnMatch[1]);

        if (asn < 4242420000 || asn > 4242429999) {
            await ctx.reply(`${ICONS.error} Invalid ASN. DN42 range: 4242420000-4242429999`);
            return;
        }

        // Clear awaiting flag
        ctx.session.awaitingAsn = false;

        // Query auth methods from API
        try {
            const result = await apiRequest('/auth', 'POST', {
                action: 'query',
                asn: String(asn),
            });

            if (result.code !== 0) {
                await ctx.reply(`${ICONS.error} Error: ${result.message ?? 'Unknown error'}`);
                return;
            }

            const person = result.data?.person;
            const mntBy = result.data?.mntBy || `AS${asn}-MNT`;
            const availableAuthMethods = result.data?.availableAuthMethods || [];

            if (availableAuthMethods.length === 0) {
                await ctx.reply(
                    `${ICONS.error} *No authentication methods found*\n` +
                    `在 Registry 中未找到认证方式\n\n` +
                    `ASN: \`AS${asn}\`\n\n` +
                    `Please make sure your WHOIS object has pgp-fingerprint or contact email.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Parse auth methods
            const gpgFingerprints: string[] = [];
            const sshKeys: string[] = [];
            const emails: string[] = [];

            for (const method of availableAuthMethods) {
                if (method.type === 1 && method.fingerprint) {
                    gpgFingerprints.push(method.fingerprint);
                } else if (method.type === 2 && method.value) {
                    sshKeys.push(method.value);
                } else if (method.type === 3 && method.value) {
                    emails.push(method.value);
                }
            }

            // Build auth method keyboard
            const keyboard = new InlineKeyboard();

            if (gpgFingerprints.length > 0) {
                keyboard.text('🔐 GPG Signature GPG 签名', `login:gpg:${asn}`).row();
            }
            if (sshKeys.length > 0) {
                keyboard.text('🔑 SSH Signature SSH 签名', `login:ssh:${asn}`).row();
            }
            if (emails.length > 0) {
                keyboard.text('📧 Email 邮箱', `login:email:${asn}`).row();
            }

            // Store available auth data
            challengeStore.set(ctx.from.id, {
                asn,
                mntBy,
                challenge: '',
                method: 'email', // default
                gpgFp: gpgFingerprints[0],
                sshKey: sshKeys[0],
            });

            await ctx.reply(
                `👤 *${person}* (AS${asn})\n\n` +
                `Choose authentication method. Use /cancel to interrupt.\n` +
                `选择验证方式。使用 /cancel 终止操作。`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard,
                }
            );
        } catch (error) {
            console.error('[Login] Error:', error);
            await ctx.reply(`${ICONS.error} Failed to query authentication methods`);
        }
    });

    // Handle GPG login
    bot.callbackQuery(/^login:gpg:(\d+)$/, async (ctx) => {
        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr);
        const userId = ctx.from.id;

        // Get stored data
        const stored = challengeStore.get(userId);
        const gpgFp = stored?.gpgFp || '';

        // Generate challenge
        const challenge = crypto.randomBytes(16).toString('hex');

        // Store challenge
        challengeStore.set(userId, {
            asn,
            mntBy: stored?.mntBy || `AS${asn}-MNT`,
            challenge,
            method: 'gpg',
            gpgFp,
        });

        const fpDisplay = gpgFp.length > 16 ? `${gpgFp.slice(0, 8)}...${gpgFp.slice(-8)}` : gpgFp;

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `🔐 *GPG Signature Challenge*\n` +
            `🔐 *GPG 签名挑战*\n` +
            `${DIVIDER}\n` +
            `Selected GPG Fingerprint 选择的 GPG 指纹:\n` +
            `- \`${fpDisplay}\`\n\n` +
            `Challenge String 挑战字符串:\n` +
            `\`${challenge}\`\n\n` +
            `Please sign the challenge string with your GPG private key and send the signature.\n` +
            `请使用你的 GPG 私钥对挑战字符串进行签名，并发送签名结果。\n\n` +
            `Command 命令:\n` +
            `\`echo -n '${challenge}' | gpg --clearsign\`\n\n` +
            `Send the complete signed message (including headers). Use /cancel to interrupt.\n` +
            `发送完整的签名消息（包括头部）。使用 /cancel 终止操作。`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle SSH login
    bot.callbackQuery(/^login:ssh:(\d+)$/, async (ctx) => {
        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr);
        const userId = ctx.from.id;

        const stored = challengeStore.get(userId);
        const sshKey = stored?.sshKey || '';

        // Generate challenge
        const challenge = crypto.randomBytes(16).toString('hex');

        // Store challenge
        challengeStore.set(userId, {
            asn,
            mntBy: stored?.mntBy || `AS${asn}-MNT`,
            challenge,
            method: 'ssh',
            sshKey,
        });

        const sshKeyDisplay = sshKey.length > 60 ? `\`${sshKey.slice(0, 60)}...\`` : `\`${sshKey}\``;

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `🔑 *SSH Signature Challenge*\n` +
            `🔑 *SSH 签名挑战*\n` +
            `${DIVIDER}\n` +
            `Selected SSH Public Key 选择的 SSH 公钥:\n` +
            `- ${sshKeyDisplay}\n\n` +
            `Challenge String 挑战字符串:\n` +
            `\`${challenge}\`\n\n` +
            `Please sign the challenge string with your SSH private key and send the signature.\n` +
            `请使用你的 SSH 私钥对挑战字符串进行签名，并发送签名结果。\n\n` +
            `Command 命令:\n` +
            `\`echo -n '${challenge}' | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n file\`\n\n` +
            `Send the output signature. Use /cancel to interrupt.\n` +
            `发送输出的签名内容。使用 /cancel 终止操作。`,
            { parse_mode: 'Markdown' }
        );
    });

    // Handle Email login
    bot.callbackQuery(/^login:email:(\d+)$/, async (ctx) => {
        const asnStr = ctx.match?.[1];
        if (!asnStr) return;
        const asn = parseInt(asnStr);
        const userId = ctx.from.id;

        const stored = challengeStore.get(userId);

        // Generate 6-digit code
        const code = String(Math.floor(100000 + Math.random() * 900000));

        // Store code
        challengeStore.set(userId, {
            asn,
            mntBy: stored?.mntBy || `AS${asn}-MNT`,
            challenge: code,
            method: 'email',
        });

        // Send email via API
        try {
            const result = await apiRequest('/auth', 'POST', {
                action: 'sendEmail',
                asn: String(asn),
                code,
            });

            if (result.code !== 0) {
                await ctx.answerCallbackQuery(`${ICONS.error} ${result.message}`);
                return;
            }

            await ctx.answerCallbackQuery();
            await ctx.editMessageText(LOGIN_EMAIL_SENT, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('[Email] Error:', error);
            await ctx.answerCallbackQuery(`${ICONS.error} Failed to send email`);
        }
    });

    // Handle signature/code verification
    bot.on('message:text', async (ctx, next) => {
        const userId = ctx.from.id;
        const stored = challengeStore.get(userId);

        if (!stored || !stored.challenge) {
            return next();
        }

        const text = ctx.message.text.trim();

        // Cancel
        if (text === '/cancel') {
            challengeStore.delete(userId);
            await ctx.reply(`${ICONS.cancel} ${CANCELLED}`);
            return;
        }

        const { asn, mntBy, challenge, method } = stored;

        try {
            if (method === 'email') {
                // Verify email code
                if (text === challenge) {
                    challengeStore.delete(userId);
                    ctx.session.asn = asn;
                    ctx.session.person = mntBy;
                    await ctx.reply(
                        `${ICONS.success} *Signature verified successfully!*\n` +
                        `${ICONS.success} *签名验证成功！*\n\n` +
                        `Welcome! \`${mntBy}  AS${asn}\`\n` +
                        `欢迎你！\`${mntBy}  AS${asn}\``,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply(`${ICONS.error} Invalid code. Try again.\n验证码错误，请重试。`);
                }
            } else if (method === 'gpg') {
                // Verify GPG signature (full implementation)
                const gpgFps = stored.gpgFp ? [stored.gpgFp] : [];
                const result = await verifyGpgSignatureFull(text, challenge, gpgFps);

                if (result.verified) {
                    challengeStore.delete(userId);
                    ctx.session.asn = asn;
                    ctx.session.person = mntBy;
                    await ctx.reply(
                        `${ICONS.success} *Signature verified successfully!*\n` +
                        `${ICONS.success} *签名验证成功！*\n\n` +
                        `Welcome! \`${mntBy}  AS${asn}\`\n` +
                        `欢迎你！\`${mntBy}  AS${asn}\``,
                        { parse_mode: 'Markdown' }
                    );
                } else if (result.needsManualKey) {
                    await ctx.reply(
                        `${ICONS.warning} Could not verify the signature with available keys.\n` +
                        `无法使用可用的密钥验证签名。\n\n` +
                        `Error: ${result.error}\n\n` +
                        `Please try /login again or contact @HeiCha for help.\n` +
                        `请重试 /login 或联系 @HeiCha 寻求帮助。`
                    );
                    challengeStore.delete(userId);
                } else {
                    await ctx.reply(
                        `${ICONS.error} *Signature verification failed*\n签名验证失败\n\n` +
                        `${result.error || 'Unknown error'}\n\n` +
                        `Use /login to try again.\n使用 /login 重试。`,
                        { parse_mode: 'Markdown' }
                    );
                    challengeStore.delete(userId);
                }
            } else if (method === 'ssh') {
                // Verify SSH signature (full implementation)
                const sshKey = stored.sshKey || '';
                const result = await verifySshSignatureFull(text, challenge, sshKey);

                if (result.verified) {
                    challengeStore.delete(userId);
                    ctx.session.asn = asn;
                    ctx.session.person = mntBy;
                    await ctx.reply(
                        `${ICONS.success} *Signature verified successfully!*\n` +
                        `${ICONS.success} *签名验证成功！*\n\n` +
                        `Welcome! \`${mntBy}  AS${asn}\`\n` +
                        `欢迎你！\`${mntBy}  AS${asn}\``,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.reply(
                        `${ICONS.error} *Signature verification failed*\n签名验证失败\n\n` +
                        `${result.error || 'Unknown error'}\n\n` +
                        `Use /login to try again.\n使用 /login 重试。`,
                        { parse_mode: 'Markdown' }
                    );
                    challengeStore.delete(userId);
                }
            }
        } catch (error) {
            console.error('[Login] Verification error:', error);
            await ctx.reply(`${ICONS.error} Verification error: ${(error as Error).message}`);
        }
    });

    /**
     * /logout - Clear session
     */
    bot.command('logout', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(`${ICONS.error} You are not logged in.\n你尚未登录。`);
            return;
        }

        const asn = ctx.session.asn;
        ctx.session.asn = undefined;
        ctx.session.person = undefined;
        ctx.session.isAdmin = undefined;

        await ctx.reply(`${ICONS.logout} Logged out from AS${asn}\n已退出 AS${asn}`);
    });

    /**
     * /whoami - Show current user
     */
    bot.command('whoami', async (ctx) => {
        if (!ctx.session.asn) {
            await ctx.reply(ERROR_NOT_LOGGED_IN);
            return;
        }

        const { asn, person, isAdmin } = ctx.session;
        const adminBadge = isAdmin ? ' 👑 Admin' : '';

        await ctx.reply(
            `👤 *Current User 当前用户*\n${DIVIDER}\n\n` +
            `ASN: \`AS${asn}\`\n` +
            `Name: ${person}${adminBadge}`,
            { parse_mode: 'Markdown' }
        );
    });
}
