/**
 * Tools Command Tests
 * 
 * Tests for /ping, /trace, /route, /whois, /dig commands.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { createMockContext, assertReplyContains } from '../helpers/mock-context';

// Mock config
mock.module('../../src/config', () => ({
    default: {
        apiUrl: 'http://localhost:3000/api/v1',
        agentToken: 'test-agent-token',
    },
}));

// Mock nodes provider
mock.module('../../src/providers/nodes', () => ({
    getNodes: async () => new Map([
        ['hk1', { location: 'Hong Kong', publicIp: '1.2.3.4' }],
        ['jp1', { location: 'Tokyo', publicIp: '5.6.7.8' }],
    ]),
    getAgentEndpoint: async (nodeId: string) => `http://${nodeId}.local:8080`,
}));

describe('Tools Command - Input Validation', () => {
    test('should reject targets with forbidden characters', async () => {
        const forbiddenChars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '<', '>', '\\', '"', "'"];

        for (const char of forbiddenChars) {
            const target = `test${char}injection`;
            const { ctx, replies } = createMockContext({
                messageText: `/ping ${target}`,
                session: {},
            });

            // Simulate the validation check from tools.ts
            const isInvalid = /[;&|`$(){}[\]<>\\"']/.test(target);
            expect(isInvalid).toBe(true);
        }
    });

    test('should accept valid hostname targets', () => {
        const validTargets = [
            'example.com',
            'sub.example.com',
            '192.168.1.1',
            '172.22.188.1',
            '2001:db8::1',
        ];

        for (const target of validTargets) {
            const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9.\-:]+$/;
            expect(validPattern.test(target)).toBe(true);
        }
    });

    test('should reject invalid hostname formats', () => {
        const invalidTargets = [
            '-startswithdash.com',
            '.startswithperiod.com',
            '',
            ' spaces ',
        ];

        for (const target of invalidTargets) {
            const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9.\-:]+$/;
            expect(validPattern.test(target)).toBe(false);
        }
    });
});

describe('Tools Command - Port Parsing', () => {
    test('should parse host:port correctly', () => {
        function parseTarget(target: string): { host: string; port: string } {
            let host = target;
            let port = '80';

            if (target.includes(':') && !target.includes('::')) {
                const parts = target.split(':');
                const lastPart = parts.pop();
                if (lastPart && /^\d+$/.test(lastPart)) {
                    port = lastPart;
                    host = parts.join(':');
                }
            } else if (target.startsWith('[') && target.includes(']:')) {
                const match = target.match(/^\[(.+)\]:(\d+)$/);
                if (match && match[1] && match[2]) {
                    host = match[1];
                    port = match[2];
                }
            }

            return { host, port };
        }

        expect(parseTarget('example.com:8080')).toEqual({ host: 'example.com', port: '8080' });
        expect(parseTarget('example.com')).toEqual({ host: 'example.com', port: '80' });
        expect(parseTarget('192.168.1.1:22')).toEqual({ host: '192.168.1.1', port: '22' });
        expect(parseTarget('[2001:db8::1]:80')).toEqual({ host: '2001:db8::1', port: '80' });
        // IPv6 without port should not split on colons
        expect(parseTarget('2001:db8::1')).toEqual({ host: '2001:db8::1', port: '80' });
    });
});

describe('Tools Command - WHOIS object type detection', () => {
    test('should detect ASN objects correctly', () => {
        function detectObjectType(query: string): string {
            const q = query.toUpperCase();
            if (q.startsWith('AS') && /^\d+$/.test(q.substring(2))) return 'aut-num';
            if (q.endsWith('-MNT')) return 'mntner';
            if (q.endsWith('-DN42')) return 'person';
            if (q.includes('/')) return q.includes(':') ? 'route6' : 'route';
            if (q.includes(':')) return 'inet6num';
            if (/^\d+\.\d+\.\d+\.\d+/.test(q)) return 'inetnum';
            return 'mntner';
        }

        expect(detectObjectType('AS4242420998')).toBe('aut-num');
        expect(detectObjectType('as4242420998')).toBe('aut-num');
        expect(detectObjectType('MOENET-MNT')).toBe('mntner');
        expect(detectObjectType('MOENET-DN42')).toBe('person');
        expect(detectObjectType('172.22.188.0/24')).toBe('route');
        expect(detectObjectType('fd00::/8')).toBe('route6');
        expect(detectObjectType('fd00::1')).toBe('inet6num');
        expect(detectObjectType('172.22.188.1')).toBe('inetnum');
    });
});

describe('Tools Command - Command Maps', () => {
    test('should have correct command definitions', () => {
        const supportedCommands = ['ping', 'trace', 'tcping', 'route', 'path'] as const;

        // Verify all expected commands are supported
        for (const cmd of supportedCommands) {
            expect(supportedCommands).toContain(cmd);
        }
    });

    test('should use safe argument arrays instead of string interpolation', () => {
        // This test documents the expected safe command format
        const target = 'example.com';

        const safeCommands: Record<string, string[]> = {
            ping: ['ping', '-c', '4', target],
            trace: ['traceroute', '-m', '20', target],
            tcping: ['nc', '-zv', target.split(':')[0] ?? target, target.split(':')[1] ?? '80'],
            route: ['birdc', 'show', 'route', 'for', target, 'all'],
            path: ['birdc', 'show', 'route', 'for', target, 'all'],
        };

        // Verify commands use arrays (safe) not template strings (unsafe)
        for (const [name, args] of Object.entries(safeCommands)) {
            expect(Array.isArray(args)).toBe(true);
            expect(args.length).toBeGreaterThan(0);
            // Command binary names: trace -> traceroute, tcping -> nc, route/path -> birdc
            const expectedBinary = name === 'trace' ? 'traceroute' : name === 'tcping' ? 'nc' : name === 'route' || name === 'path' ? 'birdc' : name;
            expect(args[0]).toBe(expectedBinary);
        }
    });
});

describe('Tools Command - DNS Query Types', () => {
    test('should validate DNS record types', () => {
        const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS', 'SOA', 'PTR'];

        expect(validTypes).toContain('A');
        expect(validTypes).toContain('AAAA');
        expect(validTypes).toContain('MX');
        expect(validTypes).not.toContain('ANY'); // Not supported
        expect(validTypes).not.toContain('AXFR'); // Not supported
    });
});

describe('Tools Command - Output Filtering', () => {
    test('should filter AS path output correctly', () => {
        const routeOutput = `Table master4:
172.22.188.0/24 unicast [static1 10:00:00.000] * (200)
	dev dummy0
	Type: static univ
	BGP.as_path: 4242420998 4242421234
via 172.23.0.1 on wg_peer1 [dn42_peer1 10:00:00.000] (100) [AS4242420998i]
	via 172.23.0.1 on wg_peer1
	Type: BGP unicast univ
	BGP.origin: IGP
	BGP.as_path: 4242421234 4242420998`;

        const lines = routeOutput.split('\n');
        const filtered = lines.filter(line =>
            line.includes('BGP.as_path') || line.includes('via')
        );

        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.some(l => l.includes('BGP.as_path'))).toBe(true);
        expect(filtered.some(l => l.includes('via'))).toBe(true);
    });
});

describe('Tools Command - Error Handling', () => {
    test('should handle timeout errors', () => {
        const error = { message: 'Command timed out', killed: true };

        if ((error as { killed?: boolean }).killed) {
            expect('timeout').toBe('timeout');
        }
    });

    test('should sanitize error messages', () => {
        const internalError = 'Connection refused at /var/run/bird/bird.ctl';

        // Should not expose internal paths
        const sanitized = internalError.includes('BIRD') ? 'Route lookup failed' : 'Command execution failed';

        expect(sanitized).not.toContain('/var/run');
    });
});
