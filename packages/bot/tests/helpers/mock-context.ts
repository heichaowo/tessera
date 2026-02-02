/**
 * Mock Context for Grammy Bot Testing
 * 
 * This module provides a mock implementation of Grammy's Context
 * for unit testing bot commands without a real Telegram connection.
 */

import type { Context, SessionFlavor, Api, RawApi } from 'grammy';

/**
 * Session data for user state (mirrored from index.ts)
 */
export interface SessionData {
    asn?: number;
    person?: string;
    isAdmin?: boolean;
    awaitingAsn?: boolean;
    peerFlow?: PeerFlowData;
    nodeWizard?: {
        step: 'name' | 'hostname' | 'ipv4' | 'ipv6' | 'role' | 'region' | 'location' | 'provider' | 'bandwidth' | 'max_peers' | 'allow_cn' | 'confirm';
        data: Record<string, unknown>;
    };
}

export interface PeerFlowData {
    step: string;
    isAdminMode?: boolean;
    targetAsn?: number;
    routerName?: string;
    routerUuid?: string;
    serverEndpoint?: string;
    serverPort?: number;
    serverPubkey?: string;
    serverLla?: string;
    sessionType?: 'ipv6_only' | 'ipv6_ipv4';
    ipv6?: string;
    localIpv6?: string;
    endpoint?: string;
    port?: number;
    publicKey?: string;
    mtu?: number;
    psk?: string | null;
    nodeMap?: Record<string, { uuid: string; endpoint: string; pubkey: string; nodeId: number }>;
    asn?: number;
    backup?: PeerState;
    current?: PeerState;
}

export interface PeerState {
    endpoint: string;
    port: string;
    ipv6: string;
    ipv4: string;
    localIpv6: string;
    localIpv4: string;
    pubkey: string;
    psk: boolean;
    mtu: number;
    mpbgp: boolean;
    extendedNexthop: boolean;
    contact: string;
}

export type MockBotContext = Context & SessionFlavor<SessionData>;

/**
 * Captured replies for verification
 */
export interface CapturedReply {
    text: string;
    options?: Record<string, unknown>;
}

/**
 * Create a mock context for testing
 */
export function createMockContext(options: {
    messageText?: string;
    userId?: number;
    username?: string;
    chatId?: number;
    session?: Partial<SessionData>;
    callbackData?: string;
}): {
    ctx: MockBotContext;
    replies: CapturedReply[];
    editedMessages: CapturedReply[];
    callbackAnswers: string[];
} {
    const {
        messageText = '',
        userId = 123456,
        username = 'testuser',
        chatId = 123456,
        session = {},
        callbackData,
    } = options;

    const replies: CapturedReply[] = [];
    const editedMessages: CapturedReply[] = [];
    const callbackAnswers: string[] = [];

    // Create session object
    const sessionData: SessionData = {
        ...session,
    };

    // Mock message object
    const mockMessage = {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
            id: chatId,
            type: 'private' as const,
        },
        from: {
            id: userId,
            is_bot: false,
            first_name: 'Test',
            username,
        },
        text: messageText,
    };

    // Mock callback query if provided
    const mockCallbackQuery = callbackData ? {
        id: 'callback-1',
        from: mockMessage.from,
        chat_instance: 'test',
        data: callbackData,
        message: mockMessage,
    } : undefined;

    // Create mock API
    const mockApi = {
        sendMessage: async (_chatId: number, text: string, opts?: Record<string, unknown>) => {
            replies.push({ text, options: opts });
            return { message_id: replies.length };
        },
    } as unknown as Api<RawApi>;

    // Create mock context
    const ctx = {
        // Message data
        message: mockMessage,
        callbackQuery: mockCallbackQuery,
        from: mockMessage.from,
        chat: mockMessage.chat,

        // Match for command parsing
        match: messageText.startsWith('/')
            ? messageText.split(' ').slice(1).join(' ')
            : callbackData?.split(':').slice(1) || messageText,

        // Session
        session: sessionData,

        // API
        api: mockApi,

        // Reply methods
        reply: async (text: string, opts?: Record<string, unknown>) => {
            replies.push({ text, options: opts });
            return { message_id: replies.length };
        },

        editMessageText: async (text: string, opts?: Record<string, unknown>) => {
            editedMessages.push({ text, options: opts });
            return true;
        },

        answerCallbackQuery: async (text?: string) => {
            callbackAnswers.push(text || '');
            return true;
        },

        // Add replyWithMarkdown for convenience
        replyWithMarkdown: async (text: string, opts?: Record<string, unknown>) => {
            replies.push({ text, options: { ...opts, parse_mode: 'Markdown' } });
            return { message_id: replies.length };
        },
    } as unknown as MockBotContext;

    return { ctx, replies, editedMessages, callbackAnswers };
}

/**
 * Create mock API request function
 */
export function createMockApiRequest(responses: Record<string, unknown>) {
    return async (endpoint: string, method = 'POST', body?: unknown, _token?: string) => {
        const key = `${method}:${endpoint}`;
        if (responses[key]) {
            return responses[key];
        }
        // Default response based on action in body
        if (body && typeof body === 'object' && 'action' in body) {
            const action = (body as { action: string }).action;
            if (responses[action]) {
                return responses[action];
            }
        }
        return { code: 0, data: {} };
    };
}

/**
 * Assert that a reply contains expected text
 */
export function assertReplyContains(replies: CapturedReply[], expected: string): void {
    const found = replies.some(r => r.text.includes(expected));
    if (!found) {
        const actualTexts = replies.map(r => r.text.slice(0, 100)).join('\n---\n');
        throw new Error(`Expected reply containing "${expected}" but got:\n${actualTexts}`);
    }
}

/**
 * Assert that a reply has a keyboard
 */
export function assertHasKeyboard(replies: CapturedReply[]): void {
    const found = replies.some(r => r.options?.reply_markup);
    if (!found) {
        throw new Error('Expected reply with keyboard but none found');
    }
}
