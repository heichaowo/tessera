import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { z } from 'zod';

// Import schemas
import {
    AuthQuerySchema,
    AuthRequestSchema,
    AuthChallengeSchema,
    AuthRequestBodySchema,
} from '../../src/schemas/auth';

describe('Auth Schema Validation', () => {
    describe('AuthQuerySchema', () => {
        test('should accept valid ASN', () => {
            const result = AuthQuerySchema.safeParse({
                action: 'query',
                asn: '4242420001',
            });
            expect(result.success).toBe(true);
        });

        test('should reject non-numeric ASN', () => {
            const result = AuthQuerySchema.safeParse({
                action: 'query',
                asn: 'invalid',
            });
            expect(result.success).toBe(false);
        });

        test('should reject ASN outside DN42 range', () => {
            const result = AuthQuerySchema.safeParse({
                action: 'query',
                asn: '123456',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('AuthRequestSchema', () => {
        test('should accept valid request', () => {
            const result = AuthRequestSchema.safeParse({
                action: 'request',
                authState: 'jwt-token-here',
                authMethod: 0,
            });
            expect(result.success).toBe(true);
        });

        test('should reject missing authState', () => {
            const result = AuthRequestSchema.safeParse({
                action: 'request',
                authMethod: 0,
            });
            expect(result.success).toBe(false);
        });

        test('should reject negative authMethod', () => {
            const result = AuthRequestSchema.safeParse({
                action: 'request',
                authState: 'token',
                authMethod: -1,
            });
            expect(result.success).toBe(false);
        });
    });

    describe('AuthChallengeSchema', () => {
        test('should accept email code challenge', () => {
            const result = AuthChallengeSchema.safeParse({
                action: 'challenge',
                authState: 'jwt-token',
                data: 'ABC123',
            });
            expect(result.success).toBe(true);
        });

        test('should accept PGP challenge', () => {
            const result = AuthChallengeSchema.safeParse({
                action: 'challenge',
                authState: 'jwt-token',
                data: {
                    publicKey: '-----BEGIN PGP PUBLIC KEY-----...',
                    signedMessage: '-----BEGIN PGP SIGNED MESSAGE-----...',
                },
            });
            expect(result.success).toBe(true);
        });

        test('should reject invalid PGP data', () => {
            const result = AuthChallengeSchema.safeParse({
                action: 'challenge',
                authState: 'jwt-token',
                data: {
                    publicKey: '',  // Empty not allowed
                },
            });
            expect(result.success).toBe(false);
        });
    });

    describe('AuthRequestBodySchema (Discriminated Union)', () => {
        test('should route to correct schema based on action', () => {
            const query = AuthRequestBodySchema.safeParse({
                action: 'query',
                asn: '4242420001',
            });
            expect(query.success).toBe(true);

            const request = AuthRequestBodySchema.safeParse({
                action: 'request',
                authState: 'token',
                authMethod: 0,
            });
            expect(request.success).toBe(true);

            const challenge = AuthRequestBodySchema.safeParse({
                action: 'challenge',
                authState: 'token',
                data: 'code',
            });
            expect(challenge.success).toBe(true);
        });

        test('should reject unknown action', () => {
            const result = AuthRequestBodySchema.safeParse({
                action: 'unknown',
            });
            expect(result.success).toBe(false);
        });
    });
});
