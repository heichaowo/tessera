import { describe, expect, test, beforeAll } from 'bun:test';
import { WhoisProvider } from '../src/providers/whois';

describe('WhoisProvider', () => {
    let provider: WhoisProvider;

    beforeAll(() => {
        provider = new WhoisProvider();
    });

    describe('lookup', () => {
        test('should fetch ASN data from Burble Explorer', async () => {
            const result = await provider.lookup('AS4242420998');

            expect(result).toBeDefined();
            expect(result?.Attributes).toBeDefined();
            expect(Array.isArray(result?.Attributes)).toBe(true);
        });

        test('should return null for invalid ASN', async () => {
            const result = await provider.lookup('AS9999999999');

            expect(result).toBeNull();
        });
    });

    describe('getAuthMethods', () => {
        test('should extract auth methods for MOENET', async () => {
            const result = await provider.getAuthMethods(4242420998);

            expect(result.person).toBe('MoeNet NOC');
            expect(result.emails).toContain('noc@asn.moe');
            expect(result.sshKeys.length).toBeGreaterThan(0);
        });

        test('should return empty for non-existent ASN', async () => {
            const result = await provider.getAuthMethods(9999999999);

            expect(result.person).toBe('');
            expect(result.emails).toHaveLength(0);
            expect(result.sshKeys).toHaveLength(0);
        });
    });

    describe('detectObjectType', () => {
        test('should detect aut-num type', () => {
            // Access private method via any cast for testing
            const provider = new WhoisProvider() as any;

            expect(provider.detectObjectType('AS4242420998')).toBe('aut-num');
            expect(provider.detectObjectType('as4242420998')).toBe('aut-num');
        });

        test('should detect maintainer type', () => {
            const provider = new WhoisProvider() as any;

            expect(provider.detectObjectType('MOENET-MNT')).toBe('mntner');
        });

        test('should detect person type', () => {
            const provider = new WhoisProvider() as any;

            expect(provider.detectObjectType('MOENET-DN42')).toBe('person');
        });
    });
});
