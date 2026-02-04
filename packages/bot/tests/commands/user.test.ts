/**
 * User Command Tests
 * 
 * Tests for /login, /logout, /whoami commands and auth flows.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { createMockContext, assertReplyContains, assertHasKeyboard, type MockBotContext } from '../helpers/mock-context';

// Mock config before importing handlers
mock.module('../../src/config', () => ({
    default: {
        apiUrl: 'http://localhost:3000/api/v1',
        apiToken: 'test-token',
        adminChatId: 123456,
        adminUsername: 'admin',
        localAsn: 4242420998,
    },
}));

// Mock API responses
const mockAuthResponse = {
    code: 0,
    data: {
        person: 'DN42-TESTUSER',
        mntBy: 'TEST-MNT',
        availableAuthMethods: [
            { type: 1, fingerprint: 'ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234' },
            { type: 2, value: 'ssh-ed25519 AAAAC3NzaC1...' },
            { type: 3, value: 'test@example.com' },
        ],
    },
};

let mockFetch: ReturnType<typeof mock>;

beforeEach(() => {
    // Reset fetch mock
    mockFetch = mock(() => Promise.resolve({
        json: () => Promise.resolve(mockAuthResponse),
        ok: true,
    }));
    global.fetch = mockFetch as unknown as typeof fetch;
});

describe('User Command - /login', () => {
    test('should prompt for ASN when not logged in', async () => {
        const { ctx, replies } = createMockContext({
            messageText: '/login',
            session: { asn: undefined },
        });

        const handlers: Record<string, (ctx: MockBotContext) => Promise<void>> = {};
        const mockBot = {
            command: (name: string | string[], handler: (ctx: MockBotContext) => Promise<void>) => {
                const names = Array.isArray(name) ? name : [name];
                for (const n of names) {
                    handlers[n] = handler;
                }
            },
            callbackQuery: () => { },
            on: () => { },
        };

        const { registerUserCommands } = await import('../../src/commands/user');
        registerUserCommands(mockBot as never);

        await handlers['login']?.(ctx);

        expect(replies.length).toBeGreaterThan(0);
        assertReplyContains(replies, 'ASN');
        expect(ctx.session.awaitingAsn).toBe(true);
    });

    test('should show already logged in message if already authenticated', async () => {
        const { ctx, replies } = createMockContext({
            messageText: '/login',
            session: { asn: 4242420998, person: 'TEST-MNT' },
        });

        const handlers: Record<string, (ctx: MockBotContext) => Promise<void>> = {};
        const mockBot = {
            command: (name: string | string[], handler: (ctx: MockBotContext) => Promise<void>) => {
                const names = Array.isArray(name) ? name : [name];
                for (const n of names) {
                    handlers[n] = handler;
                }
            },
            callbackQuery: () => { },
            on: () => { },
        };

        const { registerUserCommands } = await import('../../src/commands/user');
        registerUserCommands(mockBot as never);

        await handlers['login']?.(ctx);

        expect(replies.length).toBeGreaterThan(0);
        assertReplyContains(replies, 'Already logged in');
    });
});

describe('User Command - /logout', () => {
    test('should clear session on logout', async () => {
        const { ctx, replies } = createMockContext({
            messageText: '/logout',
            session: { asn: 4242420998, person: 'TEST-MNT' },
        });

        const handlers: Record<string, (ctx: MockBotContext) => Promise<void>> = {};
        const mockBot = {
            command: (name: string | string[], handler: (ctx: MockBotContext) => Promise<void>) => {
                const names = Array.isArray(name) ? name : [name];
                for (const n of names) {
                    handlers[n] = handler;
                }
            },
            callbackQuery: () => { },
            on: () => { },
        };

        const { registerUserCommands } = await import('../../src/commands/user');
        registerUserCommands(mockBot as never);

        await handlers['logout']?.(ctx);

        expect(ctx.session.asn).toBeUndefined();
        assertReplyContains(replies, 'Logged out');
    });

    test('should show error if not logged in', async () => {
        const { ctx, replies } = createMockContext({
            messageText: '/logout',
            session: { asn: undefined },
        });

        const handlers: Record<string, (ctx: MockBotContext) => Promise<void>> = {};
        const mockBot = {
            command: (name: string | string[], handler: (ctx: MockBotContext) => Promise<void>) => {
                const names = Array.isArray(name) ? name : [name];
                for (const n of names) {
                    handlers[n] = handler;
                }
            },
            callbackQuery: () => { },
            on: () => { },
        };

        const { registerUserCommands } = await import('../../src/commands/user');
        registerUserCommands(mockBot as never);

        await handlers['logout']?.(ctx);

        assertReplyContains(replies, 'not logged in');
    });
});

describe('User Command - /whoami', () => {
    test('should show current user info', async () => {
        const { ctx, replies } = createMockContext({
            messageText: '/whoami',
            session: { asn: 4242420998, person: 'TEST-MNT' },
        });

        const handlers: Record<string, (ctx: MockBotContext) => Promise<void>> = {};
        const mockBot = {
            command: (name: string | string[], handler: (ctx: MockBotContext) => Promise<void>) => {
                const names = Array.isArray(name) ? name : [name];
                for (const n of names) {
                    handlers[n] = handler;
                }
            },
            callbackQuery: () => { },
            on: () => { },
        };

        const { registerUserCommands } = await import('../../src/commands/user');
        registerUserCommands(mockBot as never);

        await handlers['whoami']?.(ctx);

        assertReplyContains(replies, 'AS4242420998');
        assertReplyContains(replies, 'TEST-MNT');
    });

    test('should show error if not logged in', async () => {
        const { ctx, replies } = createMockContext({
            messageText: '/whoami',
            session: { asn: undefined },
        });

        const handlers: Record<string, (ctx: MockBotContext) => Promise<void>> = {};
        const mockBot = {
            command: (name: string | string[], handler: (ctx: MockBotContext) => Promise<void>) => {
                const names = Array.isArray(name) ? name : [name];
                for (const n of names) {
                    handlers[n] = handler;
                }
            },
            callbackQuery: () => { },
            on: () => { },
        };

        const { registerUserCommands } = await import('../../src/commands/user');
        registerUserCommands(mockBot as never);

        await handlers['whoami']?.(ctx);

        assertReplyContains(replies, 'login');
    });
});

describe('ASN Validation', () => {
    test('should validate DN42 ASN range', () => {
        function isValidDN42ASN(asn: number): boolean {
            return asn >= 4242420000 && asn <= 4242429999;
        }

        expect(isValidDN42ASN(4242420998)).toBe(true);
        expect(isValidDN42ASN(4242420000)).toBe(true);
        expect(isValidDN42ASN(4242429999)).toBe(true);
        expect(isValidDN42ASN(4242430000)).toBe(false);
        expect(isValidDN42ASN(4242419999)).toBe(false);
    });

    test('should parse ASN from text input', () => {
        function parseASN(text: string): number | null {
            const match = text.trim().match(/^(?:AS)?(\d+)$/i);
            return match?.[1] ? parseInt(match[1]) : null;
        }

        expect(parseASN('4242420998')).toBe(4242420998);
        expect(parseASN('AS4242420998')).toBe(4242420998);
        expect(parseASN('as4242420998')).toBe(4242420998);
        expect(parseASN('invalid')).toBeNull();
        expect(parseASN('')).toBeNull();
    });
});

describe('Auth Methods Parsing', () => {
    test('should categorize auth methods by type', () => {
        const methods = [
            { type: 1, fingerprint: 'GPG_FP' },
            { type: 2, value: 'ssh-key' },
            { type: 3, value: 'email@test.com' },
        ];

        const gpg: string[] = [];
        const ssh: string[] = [];
        const email: string[] = [];

        for (const m of methods) {
            if (m.type === 1 && m.fingerprint) gpg.push(m.fingerprint);
            else if (m.type === 2 && m.value) ssh.push(m.value);
            else if (m.type === 3 && m.value) email.push(m.value);
        }

        expect(gpg).toEqual(['GPG_FP']);
        expect(ssh).toEqual(['ssh-key']);
        expect(email).toEqual(['email@test.com']);
    });

    test('should handle empty auth methods', () => {
        const methods: { type: number; value?: string; fingerprint?: string }[] = [];

        const gpg: string[] = [];
        const ssh: string[] = [];
        const email: string[] = [];

        for (const m of methods) {
            if (m.type === 1 && m.fingerprint) gpg.push(m.fingerprint);
            else if (m.type === 2 && m.value) ssh.push(m.value);
            else if (m.type === 3 && m.value) email.push(m.value);
        }

        expect(gpg.length).toBe(0);
        expect(ssh.length).toBe(0);
        expect(email.length).toBe(0);
    });
});
