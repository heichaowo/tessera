/**
 * DN42 Registry Service
 * 
 * Shared functions for querying the Burble DN42 Explorer REST API.
 * Used by tools commands (/whois, /findnoc) and peer creation flow.
 */

const BURBLE_API = 'https://explorer.burble.com/api/registry';

export interface WhoisResult {
    Attributes: [string, string][];
    Backlinks?: string[];
}

/**
 * Lookup WHOIS using Burble REST API.
 * 
 * Detects object type from the query string and fetches
 * the corresponding record from the registry.
 */
export async function lookupWhois(query: string): Promise<WhoisResult | null> {
    const q = query.toUpperCase();
    let objectType = 'mntner';
    if (q.startsWith('AS') && /^\d+$/.test(q.substring(2))) objectType = 'aut-num';
    else if (q.endsWith('-MNT')) objectType = 'mntner';
    else if (q.endsWith('-DN42')) objectType = 'person';
    else if (q.includes('/')) objectType = q.includes(':') ? 'route6' : 'route';
    else if (q.includes(':')) objectType = 'inet6num';
    else if (/^\d+\.\d+\.\d+\.\d+/.test(q)) objectType = 'inetnum';

    const objectKey = objectType === 'aut-num' ? query.toUpperCase() : query;

    try {
        const response = await fetch(`${BURBLE_API}/${objectType}/${objectKey}`);
        if (!response.ok) return null;

        const data = await response.json() as Record<string, WhoisResult>;
        const key = `${objectType}/${objectKey}`;
        return data[key] || null;
    } catch {
        return null;
    }
}

/**
 * Format WHOIS result as text.
 */
export function formatWhoisResult(data: WhoisResult): string {
    if (!data.Attributes) return 'No data';
    return data.Attributes.map(([key, value]) => `${key}: ${value}`).join('\n');
}

/**
 * Get a single attribute value from a WHOIS result.
 */
export function getWhoisAttr(data: WhoisResult, key: string): string | undefined {
    const attr = data.Attributes?.find(a => a[0] === key);
    return attr ? attr[1] : undefined;
}

/**
 * Get all attribute values for a given key from a WHOIS result.
 */
export function getAllWhoisAttr(data: WhoisResult, key: string): string[] {
    if (!data.Attributes) return [];
    return data.Attributes.filter(a => a[0] === key).map(a => a[1]);
}

/**
 * Fetch contact information for a DN42 ASN.
 * 
 * Queries the Burble registry for the ASN record, extracts
 * admin-c reference, fetches the person record, and collects
 * all e-mail and contact fields.
 * 
 * Args:
 *     asn: The ASN number (without AS prefix).
 * 
 * Returns:
 *     Array of contact strings (e.g., email addresses, contact handles).
 *     Empty array if no contacts found or API fails.
 */
export async function fetchContacts(asn: number): Promise<string[]> {
    try {
        // Get ASN record
        const asnData = await lookupWhois(`AS${asn}`);
        if (!asnData) return [];

        const contacts: string[] = [];

        // Extract admin-c reference(s)
        const adminCs = getAllWhoisAttr(asnData, 'admin-c');

        for (const adminC of adminCs) {
            // Extract handle from markdown link "[NAME](person/NAME)"
            let handle = adminC;
            const match = adminC.match(/\[([^\]]+)\]/);
            if (match?.[1]) handle = match[1];

            // Get person record
            const personData = await lookupWhois(handle);
            if (!personData) continue;

            // Collect e-mail and contact fields
            for (const email of getAllWhoisAttr(personData, 'e-mail')) {
                if (email && !contacts.includes(email)) {
                    contacts.push(email);
                }
            }
            for (const contact of getAllWhoisAttr(personData, 'contact')) {
                if (contact && !contacts.includes(contact)) {
                    contacts.push(contact);
                }
            }
        }

        return contacts;
    } catch {
        return [];
    }
}
