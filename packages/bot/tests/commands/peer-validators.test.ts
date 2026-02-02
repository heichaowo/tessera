/**
 * Tests for peer/validators module
 *
 * Validates the extracted validation functions work correctly.
 */

import { describe, expect, test } from 'bun:test';
import {
    isValidIPv6,
    isValidDN42IPv6,
    isValidWgPubkey,
    isValidDN42IPv4,
    isValidMTU,
    isValidPort,
    isValidContact,
    parseMTU,
    parseEndpoint,
    calculatePort,
    parseNodeSelection,
} from '../../src/commands/peer/validators';

describe('IPv6 Validation', () => {
    test('isValidIPv6 should accept valid IPv6 addresses', () => {
        expect(isValidIPv6('fe80::1')).toBe(true);
        expect(isValidIPv6('fd00::1234')).toBe(true);
        expect(isValidIPv6('2001:db8::1')).toBe(true);
        expect(isValidIPv6('fe80::1/64')).toBe(true);
    });

    test('isValidIPv6 should reject invalid addresses', () => {
        expect(isValidIPv6('192.168.1.1')).toBe(false);
        expect(isValidIPv6('invalid')).toBe(false);
        expect(isValidIPv6('')).toBe(false);
    });

    test('isValidDN42IPv6 should accept DN42 prefixes', () => {
        expect(isValidDN42IPv6('fe80::998')).toBe(true);
        expect(isValidDN42IPv6('fd00::1')).toBe(true);
        expect(isValidDN42IPv6('fdab:1234::1')).toBe(true);
        expect(isValidDN42IPv6('fcab::1')).toBe(true);
    });

    test('isValidDN42IPv6 should reject non-DN42 prefixes', () => {
        expect(isValidDN42IPv6('2001:db8::1')).toBe(false);
    });
});

describe('WireGuard Key Validation', () => {
    test('isValidWgPubkey should accept valid keys', () => {
        expect(isValidWgPubkey('wJXLTmRqHqJ2tJz0Cs3nLzk+DmMV38P/iZVfdWShqk8=')).toBe(true);
        expect(isValidWgPubkey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')).toBe(true);
    });

    test('isValidWgPubkey should reject invalid keys', () => {
        expect(isValidWgPubkey('short')).toBe(false);
        expect(isValidWgPubkey('TooLongKeyThatExceedsFortyFourCharactersTotal123=')).toBe(false);
        expect(isValidWgPubkey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    });
});

describe('DN42 IPv4 Validation', () => {
    test('isValidDN42IPv4 should accept DN42 range', () => {
        expect(isValidDN42IPv4('172.20.1.1')).toBe(true);
        expect(isValidDN42IPv4('172.22.188.1')).toBe(true);
        expect(isValidDN42IPv4('172.23.255.255')).toBe(true);
    });

    test('isValidDN42IPv4 should reject non-DN42 ranges', () => {
        expect(isValidDN42IPv4('172.24.1.1')).toBe(false);
        expect(isValidDN42IPv4('192.168.1.1')).toBe(false);
        expect(isValidDN42IPv4('10.0.0.1')).toBe(false);
    });
});

describe('MTU Validation', () => {
    test('isValidMTU should accept valid range', () => {
        expect(isValidMTU(1280)).toBe(true);
        expect(isValidMTU(1420)).toBe(true);
        expect(isValidMTU(1500)).toBe(true);
    });

    test('isValidMTU should reject invalid range', () => {
        expect(isValidMTU(1279)).toBe(false);
        expect(isValidMTU(1501)).toBe(false);
        expect(isValidMTU(NaN)).toBe(false);
    });

    test('parseMTU should handle various formats', () => {
        expect(parseMTU('1420')).toBe(1420);
        expect(parseMTU('1420 (Default)')).toBe(1420);
        expect(parseMTU('1380 (PPPoE)')).toBe(1380);
        expect(parseMTU('invalid')).toBe(null);
        expect(parseMTU('9999')).toBe(null);
    });
});

describe('Port Validation', () => {
    test('isValidPort should accept valid ports', () => {
        expect(isValidPort(1)).toBe(true);
        expect(isValidPort(51820)).toBe(true);
        expect(isValidPort(65535)).toBe(true);
    });

    test('isValidPort should reject invalid ports', () => {
        expect(isValidPort(0)).toBe(false);
        expect(isValidPort(65536)).toBe(false);
        expect(isValidPort(NaN)).toBe(false);
    });

    test('calculatePort should derive port from ASN', () => {
        expect(calculatePort(4242420998)).toBe(30998);
        expect(calculatePort(4242421234)).toBe(31234);
        expect(calculatePort(4201270001)).toBe(40001);
        expect(calculatePort(4200000001)).toBe(50001);
    });
});

describe('Endpoint Parsing', () => {
    test('parseEndpoint should handle IPv4:port', () => {
        const result = parseEndpoint('1.2.3.4:51820');
        expect(result).toEqual({ host: '1.2.3.4', port: 51820 });
    });

    test('parseEndpoint should handle domain:port', () => {
        const result = parseEndpoint('example.com:51820');
        expect(result).toEqual({ host: 'example.com', port: 51820 });
    });

    test('parseEndpoint should handle host without port', () => {
        const result = parseEndpoint('example.com');
        expect(result).toEqual({ host: 'example.com', port: undefined });
    });

    test('parseEndpoint should handle none', () => {
        expect(parseEndpoint('none')).toBe(null);
        expect(parseEndpoint('NONE')).toBe(null);
    });

    test('parseEndpoint should handle [IPv6]:port format', () => {
        const result = parseEndpoint('[2001:db8::1]:51820');
        expect(result).toEqual({ host: '2001:db8::1', port: 51820 });
    });
});

describe('Node Selection Parsing', () => {
    test('parseNodeSelection should extract node name', () => {
        expect(parseNodeSelection('📍 hk-edge (Hong Kong)')).toBe('hk-edge');
        expect(parseNodeSelection('📍 jp1 (Tokyo)')).toBe('jp1');
        expect(parseNodeSelection('📍 us-west (Los Angeles)')).toBe('us-west');
    });

    test('parseNodeSelection should return null for invalid format', () => {
        expect(parseNodeSelection('invalid')).toBe(null);
        expect(parseNodeSelection('')).toBe(null);
    });
});

describe('Contact Validation', () => {
    test('isValidContact should accept reasonable lengths', () => {
        expect(isValidContact('abc')).toBe(true);
        expect(isValidContact('user@example.com')).toBe(true);
    });

    test('isValidContact should reject too short', () => {
        expect(isValidContact('ab')).toBe(false);
        expect(isValidContact('')).toBe(false);
    });
});
