import { describe, expect, test } from 'bun:test';

import {
    CreateSessionSchema,
    ListSessionsSchema,
    GetSessionSchema,
    DeleteSessionSchema,
    PeeringRequestSchema,
} from '../../src/schemas/peering';

describe('Peering Schema Validation', () => {
    describe('CreateSessionSchema', () => {
        test('should accept valid create request', () => {
            const result = CreateSessionSchema.safeParse({
                action: 'create',
                data: {
                    router: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                    endpoint: 'example.com:51820',
                    publicKey: 'dGVzdHB1YmxpY2tleWJhc2U2NDQ0Y2hhcmFjdGVycz0=',
                    ipv4: '172.22.1.1',
                    mtu: 1420,
                },
            });
            expect(result.success).toBe(true);
        });

        test('should reject invalid router UUID', () => {
            const result = CreateSessionSchema.safeParse({
                action: 'create',
                data: {
                    router: 'not-a-uuid',
                },
            });
            expect(result.success).toBe(false);
        });

        test('should reject invalid WireGuard public key', () => {
            const result = CreateSessionSchema.safeParse({
                action: 'create',
                data: {
                    router: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                    publicKey: 'too-short',
                },
            });
            expect(result.success).toBe(false);
        });

        test('should reject invalid endpoint format', () => {
            const result = CreateSessionSchema.safeParse({
                action: 'create',
                data: {
                    router: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                    endpoint: 'missing-port',
                },
            });
            expect(result.success).toBe(false);
        });

        test('should reject MTU out of range', () => {
            const low = CreateSessionSchema.safeParse({
                action: 'create',
                data: {
                    router: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                    mtu: 1000, // Below 1280
                },
            });
            expect(low.success).toBe(false);

            const high = CreateSessionSchema.safeParse({
                action: 'create',
                data: {
                    router: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                    mtu: 10000, // Above 9000
                },
            });
            expect(high.success).toBe(false);
        });
    });

    describe('GetSessionSchema', () => {
        test('should accept valid get request', () => {
            const result = GetSessionSchema.safeParse({
                action: 'get',
                uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            });
            expect(result.success).toBe(true);
        });

        test('should reject invalid UUID', () => {
            const result = GetSessionSchema.safeParse({
                action: 'get',
                uuid: 'not-valid',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('DeleteSessionSchema', () => {
        test('should accept valid delete request', () => {
            const result = DeleteSessionSchema.safeParse({
                action: 'delete',
                uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('PeeringRequestSchema (Discriminated Union)', () => {
        test('should correctly discriminate by action', () => {
            const create = PeeringRequestSchema.safeParse({
                action: 'create',
                data: { router: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            });
            expect(create.success).toBe(true);

            const list = PeeringRequestSchema.safeParse({
                action: 'list',
            });
            expect(list.success).toBe(true);

            const get = PeeringRequestSchema.safeParse({
                action: 'get',
                uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            });
            expect(get.success).toBe(true);
        });
    });
});
