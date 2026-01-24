/**
 * WHOIS Provider for DN42 registry queries
 * 
 * Native implementation using Bun TCP for WHOIS queries
 * to avoid npm whois package ESM compatibility issues.
 */
export class WhoisProvider {
    private server: string;
    private port: number;

    constructor(server = 'whois.dn42', port = 43) {
        this.server = server;
        this.port = port;
    }

    /**
     * Lookup a DN42 object (ASN, maintainer, person, etc.)
     */
    async lookup(query: string): Promise<string | null> {
        try {
            const socket = await Bun.connect({
                hostname: this.server,
                port: this.port,
                socket: {
                    data(socket, data) {
                        // Data is handled via accumulator below
                    },
                    close() { },
                    error(socket, error) {
                        console.error(`[WHOIS] Socket error:`, error);
                    },
                },
            });

            // Send query
            socket.write(`${query}\r\n`);

            // Read response with timeout
            const chunks: Uint8Array[] = [];
            const decoder = new TextDecoder();

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    socket.end();
                    resolve(chunks.length > 0 ? decoder.decode(Buffer.concat(chunks)) : null);
                }, 5000);

                socket.data = (data) => {
                    chunks.push(new Uint8Array(data));
                };

                socket.drain = () => {
                    clearTimeout(timeout);
                    socket.end();
                    resolve(decoder.decode(Buffer.concat(chunks)));
                };
            });
        } catch (error) {
            console.error(`[WHOIS] Error looking up ${query}:`, error);
            return null;
        }
    }

    /**
     * Parse WHOIS response into key-value pairs
     */
    parseWhois(whoisText: string): Record<string, string | string[]> {
        const lines = whoisText.split('\n');
        const parsed: Record<string, string | string[]> = {};

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip comments and empty lines
            if (trimmed.startsWith('%') || trimmed === '') {
                continue;
            }

            // Split by first colon
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex === -1) continue;

            const key = trimmed.substring(0, colonIndex).trim();
            const value = trimmed.substring(colonIndex + 1).trim();

            // Handle multiple values for same key
            if (parsed[key]) {
                if (Array.isArray(parsed[key])) {
                    (parsed[key] as string[]).push(value);
                } else {
                    parsed[key] = [parsed[key] as string, value];
                }
            } else {
                parsed[key] = value;
            }
        }

        return parsed;
    }

    /**
     * Query ASN and extract authentication methods
     */
    async getAuthMethods(asn: number): Promise<AuthMethods> {
        const result: AuthMethods = {
            person: '',
            pgpFingerprints: [],
            emails: [],
            sshKeys: [],
        };

        try {
            // Query ASN object
            const asnData = await this.lookup(`AS${asn}`);
            if (!asnData) return result;

            const parsed = this.parseWhois(asnData);
            result.person = this.getFirstValue(parsed['descr']) || `AS${asn}`;

            // Get admin-c and mnt-by references
            const adminC = this.getAllValues(parsed['admin-c']);
            const mntBy = this.getAllValues(parsed['mnt-by']);

            // Look up each reference for auth info
            for (const ref of [...adminC, ...mntBy]) {
                await this.extractAuthFromRef(ref, result);
            }

        } catch (error) {
            console.error(`[WHOIS] Error getting auth methods for AS${asn}:`, error);
        }

        return result;
    }

    /**
     * Extract auth methods from a maintainer or person reference
     */
    private async extractAuthFromRef(ref: string, result: AuthMethods): Promise<void> {
        try {
            const data = await this.lookup(ref);
            if (!data) return;

            const parsed = this.parseWhois(data);

            // Get person name
            if (parsed['person'] && !result.person) {
                result.person = this.getFirstValue(parsed['person']) || result.person;
            }

            // Get PGP fingerprints
            const pgpFingerprints = this.getAllValues(parsed['pgp-fingerprint']);
            result.pgpFingerprints.push(...pgpFingerprints);

            // Get emails/contacts
            const emails = [
                ...this.getAllValues(parsed['contact']),
                ...this.getAllValues(parsed['e-mail']),
                ...this.getAllValues(parsed['email']),
            ];
            for (const email of emails) {
                const match = email.match(/[\w.-]+@[\w.-]+\.\w+/);
                if (match) {
                    result.emails.push(match[0].toLowerCase());
                }
            }

            // Get SSH keys from auth entries
            const authEntries = this.getAllValues(parsed['auth']);
            for (const auth of authEntries) {
                if (auth.includes('ssh-')) {
                    result.sshKeys.push(auth);
                } else if (auth.includes('pgp-fingerprint')) {
                    const parts = auth.split(/\s+/);
                    const fpIndex = parts.indexOf('pgp-fingerprint');
                    if (fpIndex !== -1 && parts[fpIndex + 1]) {
                        result.pgpFingerprints.push(parts[fpIndex + 1]);
                    }
                }
            }

        } catch (error) {
            console.error(`[WHOIS] Error extracting auth from ${ref}:`, error);
        }
    }

    private getFirstValue(value: string | string[] | undefined): string | undefined {
        if (Array.isArray(value)) return value[0];
        return value;
    }

    private getAllValues(value: string | string[] | undefined): string[] {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return [value];
    }
}

export interface AuthMethods {
    person: string;
    pgpFingerprints: string[];
    emails: string[];
    sshKeys: string[];
}

// Singleton instance
let whoisProvider: WhoisProvider | null = null;

export function getWhoisProvider(): WhoisProvider {
    if (!whoisProvider) {
        whoisProvider = new WhoisProvider();
    }
    return whoisProvider;
}
