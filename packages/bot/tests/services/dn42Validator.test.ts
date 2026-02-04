/**
 * Tests for DN42 Validator Service
 */
import { describe, expect, it } from 'bun:test';
import {
    calculateOurLLA,
    suggestPeerLLA,
    isLinkLocal,
    isDN42ULA,
    isDN42IPv4,
} from '../../src/services/dn42Validator';

describe('DN42 Validator', () => {
    describe('calculateOurLLA', () => {
        it('should calculate LLA for jp1 (101:1)', () => {
            expect(calculateOurLLA(101, 1)).toBe('fe80::998:101:1:1');
        });

        it('should calculate LLA for us2 (203:22)', () => {
            expect(calculateOurLLA(203, 22)).toBe('fe80::998:203:22:1');
        });

        it('should calculate LLA for ch (302:36)', () => {
            expect(calculateOurLLA(302, 36)).toBe('fe80::998:302:36:1');
        });
    });

    describe('suggestPeerLLA', () => {
        it('should suggest fe80::3999 for AS4242423999', () => {
            expect(suggestPeerLLA(4242423999)).toBe('fe80::3999');
        });

        it('should suggest fe80::998 for AS4242420998', () => {
            expect(suggestPeerLLA(4242420998)).toBe('fe80::998');
        });

        it('should suggest fe80::1575 for AS4242421575', () => {
            expect(suggestPeerLLA(4242421575)).toBe('fe80::1575');
        });
    });

    describe('isLinkLocal', () => {
        it('should return true for fe80:: addresses', () => {
            expect(isLinkLocal('fe80::1')).toBe(true);
            expect(isLinkLocal('fe80::998:101:1:1')).toBe(true);
            expect(isLinkLocal('FE80::ABCD')).toBe(true);
        });

        it('should return false for non-link-local addresses', () => {
            expect(isLinkLocal('fd00::1')).toBe(false);
            expect(isLinkLocal('2001:db8::1')).toBe(false);
        });
    });

    describe('isDN42ULA', () => {
        it('should return true for fd00:: addresses', () => {
            expect(isDN42ULA('fd00::1')).toBe(true);
            expect(isDN42ULA('fd00:4242:7777:101:1::1')).toBe(true);
        });

        it('should return true for fc00:: addresses', () => {
            expect(isDN42ULA('fc00::1')).toBe(true);
        });

        it('should return false for non-ULA addresses', () => {
            expect(isDN42ULA('fe80::1')).toBe(false);
            expect(isDN42ULA('2001:db8::1')).toBe(false);
        });
    });

    describe('isDN42IPv4', () => {
        it('should return true for DN42 172.20-23.x.x', () => {
            expect(isDN42IPv4('172.20.0.1')).toBe(true);
            expect(isDN42IPv4('172.22.188.1')).toBe(true);
            expect(isDN42IPv4('172.23.255.255')).toBe(true);
        });

        it('should return true for DN42 10.127.x.x', () => {
            expect(isDN42IPv4('10.127.0.1')).toBe(true);
            expect(isDN42IPv4('10.127.255.255')).toBe(true);
        });

        it('should return true for ARDC 44.x.x.x', () => {
            expect(isDN42IPv4('44.0.0.1')).toBe(true);
            expect(isDN42IPv4('44.255.255.255')).toBe(true);
        });

        it('should return false for non-DN42 addresses', () => {
            expect(isDN42IPv4('192.168.1.1')).toBe(false);
            expect(isDN42IPv4('10.0.0.1')).toBe(false);
            expect(isDN42IPv4('172.16.0.1')).toBe(false);
        });
    });
});
