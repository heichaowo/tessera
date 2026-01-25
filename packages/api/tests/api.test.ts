import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

interface APIResponse {
    code?: number;
    status?: string;
    version?: string;
    message?: string;
    data?: {
        message?: string;
    };
}

describe('API Health Check', () => {
    const app = new Hono();

    // Health endpoint
    app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }));

    test('should return health status', async () => {
        const res = await app.request('/health');

        expect(res.status).toBe(200);

        const body = await res.json() as APIResponse;
        expect(body.status).toBe('ok');
        expect(body.version).toBe('1.0.0');
    });
});

describe('API Response Format', () => {
    test('success response should have code 0', async () => {
        const { success } = await import('../src/common/response');
        const app = new Hono();

        app.get('/test', (c) => success(c, { message: 'test' }));

        const res = await app.request('/test');
        const body = await res.json() as APIResponse;

        expect(body.code).toBe(0);
        expect(body.message).toBe('Success');
        expect(body.data?.message).toBe('test');
    });

    test('error response should have non-zero code', async () => {
        const { makeResponse, ResponseCode } = await import('../src/common/response');
        const app = new Hono();

        app.get('/error', (c) => makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Bad Request'));

        const res = await app.request('/error');
        const body = await res.json() as APIResponse;

        expect(body.code).toBe(400);
        expect(body.message).toBe('Bad Request');
    });
});
