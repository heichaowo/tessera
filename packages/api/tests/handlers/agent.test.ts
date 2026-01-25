import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';

// Mock the database context before importing handlers
const mockBgpSessions = {
    findAll: mock(() => Promise.resolve([])),
    findOne: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ get: () => ({}) })),
    update: mock(() => Promise.resolve([1])),
};

const mockRouters = {
    findOne: mock(() => Promise.resolve({
        get: (key: string) => {
            const data: Record<string, unknown> = {
                uuid: 'test-router-uuid',
                name: 'test-router',
            };
            return data[key];
        },
    })),
    findAll: mock(() => Promise.resolve([])),
};

mock.module('../db/dbContext', () => ({
    getModels: () => ({
        bgpSessions: mockBgpSessions,
        routers: mockRouters,
        users: {},
        settings: {},
        auditLogs: { create: mock(() => Promise.resolve()) },
    }),
}));

// Mock bcrypt helper
mock.module('../common/helpers', () => ({
    bcryptCompare: mock(async (expected: string, token: string) => {
        return token === 'valid-token';
    }),
    generateUUID: () => 'test-uuid-12345',
    getInterfaceName: (asn: number) => `dn42_${asn}`,
}));

// Mock config
mock.module('../config', () => ({
    default: {
        auth: {
            agentApiKey: 'test-key',
            jwtSecret: 'test-secret',
        },
    },
}));

describe('Agent Handler', () => {
    beforeEach(() => {
        // Reset mocks
        mockBgpSessions.findAll.mockClear();
        mockBgpSessions.update.mockClear();
        mockRouters.findOne.mockClear();
    });

    test('should reject requests without auth header', async () => {
        const { default: agentHandler } = await import('../handlers/agent');
        const app = new Hono();
        app.get('/agent/:router/:action', agentHandler);

        const res = await app.request('/agent/test-router/sessions');

        expect(res.status).toBe(401);
    });

    test('should reject requests with invalid token', async () => {
        const { default: agentHandler } = await import('../handlers/agent');
        const app = new Hono();
        app.get('/agent/:router/:action', agentHandler);

        const res = await app.request('/agent/test-router/sessions', {
            headers: { Authorization: 'Bearer invalid-token' },
        });

        expect(res.status).toBe(401);
    });

    test('should return sessions for valid request', async () => {
        mockBgpSessions.findAll.mockImplementation(() => Promise.resolve([
            {
                get: () => ({
                    uuid: 'session-1',
                    asn: 4242420001,
                    status: 2,
                    ipv4: '172.22.1.1',
                    ipv6: null,
                    ipv6LinkLocal: 'fe80::1',
                    type: 'wireguard',
                    extensions: null,
                    interface: 'dn42_420001',
                    endpoint: '1.2.3.4:51820',
                    credential: 'pubkey123',
                    data: null,
                    mtu: 1420,
                    policy: 1,
                    lastError: null,
                }),
            },
        ]));

        const { default: agentHandler } = await import('../handlers/agent');
        const app = new Hono();
        app.get('/agent/:router/:action', agentHandler);

        const res = await app.request('/agent/test-router/sessions', {
            headers: { Authorization: 'Bearer valid-token' },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.code).toBe(0);
        expect(body.data.bgpSessions).toBeDefined();
    });

    test('should handle modify action', async () => {
        const { default: agentHandler } = await import('../handlers/agent');
        const app = new Hono();
        app.post('/agent/:router/:action', agentHandler);

        const res = await app.request('/agent/test-router/modify', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer valid-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                uuid: 'session-uuid',
                status: 2,
            }),
        });

        expect(res.status).toBe(200);
    });

    test('should reject modify with missing uuid', async () => {
        const { default: agentHandler } = await import('../handlers/agent');
        const app = new Hono();
        app.post('/agent/:router/:action', agentHandler);

        const res = await app.request('/agent/test-router/modify', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer valid-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 2 }),
        });

        expect(res.status).toBe(422);
    });

    test('should return 404 for unknown action', async () => {
        const { default: agentHandler } = await import('../handlers/agent');
        const app = new Hono();
        app.get('/agent/:router/:action', agentHandler);

        const res = await app.request('/agent/test-router/unknown-action', {
            headers: { Authorization: 'Bearer valid-token' },
        });

        expect(res.status).toBe(404);
    });
});
