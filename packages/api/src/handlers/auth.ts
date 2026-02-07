import type { Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getWhoisProvider } from '../providers/whois';
import { validateBody, isValidationError } from '../schemas/validate';
import { AuthRequestBodySchema, type AuthQueryInput, type AuthRequestInput, type AuthChallengeInput } from '../schemas/auth';
import config from '../config';

/**
 * Supported authentication methods
 */
enum AuthType {
    PASSWORD = 0,
    PGP_CLEAR_SIGN = 1,
    SSH = 2,
    EMAIL = 3,
}

interface AuthMethod {
    id: number;
    type: AuthType;
    data?: string;
}

interface AuthState {
    asn: string;
    person: string;
    availableAuthMethods: AuthMethod[];
    code?: string;
    authMethod?: AuthMethod;
}

/**
 * Auth Handler - Multi-step authentication flow
 * 
 * Flow:
 * 1. query - Returns available auth methods for ASN
 * 2. request - Sends challenge (email code or GPG message)
 * 3. challenge - Verifies response and returns JWT token
 */
export default async function authHandler(c: Context): Promise<Response> {
    const parsed = await validateBody(c, AuthRequestBodySchema);
    if (isValidationError(parsed)) return parsed;

    switch (parsed.action) {
        case 'query':
            return await query(c, parsed as AuthQueryInput);
        case 'request':
            return await request(c, parsed as AuthRequestInput);
        case 'challenge':
            return await challenge(c, parsed as AuthChallengeInput);
    }
}

/**
 * Step 1: Query available auth methods for ASN
 */
async function query(c: Context, body: AuthQueryInput): Promise<Response> {
    const asn = body.asn; // Already validated and transformed to number

    // Query WHOIS for auth methods
    const whois = getWhoisProvider();
    const authInfo = await whois.getAuthMethods(asn);

    // Build available auth methods list
    const availableAuthMethods: AuthMethod[] = [];
    let id = 0;

    // Add PGP fingerprints
    for (const fp of authInfo.pgpFingerprints) {
        availableAuthMethods.push({ id: id++, type: AuthType.PGP_CLEAR_SIGN, data: fp });
    }

    // Add emails
    for (const email of authInfo.emails) {
        availableAuthMethods.push({ id: id++, type: AuthType.EMAIL, data: email });
    }

    // Add SSH keys
    for (const ssh of authInfo.sshKeys) {
        availableAuthMethods.push({ id: id++, type: AuthType.SSH, data: ssh });
    }

    const person = authInfo.person || `AS${asn}`;

    // Sign the auth state
    const authState = await sign(
        { asn, person, availableAuthMethods },
        config.auth.jwtSecret,
        'HS256'
    );

    return success(c, {
        person,
        mntBy: authInfo.mntBy || `AS${asn}-MNT`,
        authState,
        availableAuthMethods: availableAuthMethods.map(m => ({
            id: m.id,
            type: m.type,
            value: m.data,
            name: m.type === AuthType.PGP_CLEAR_SIGN ? `PGP: ${m.data?.substring(0, 16)}...` :
                m.type === AuthType.EMAIL ? m.data :
                    m.type === AuthType.SSH ? 'SSH Key' : 'Password',
        })),
    });
}

/**
 * Step 2: Request authentication challenge
 */
async function request(c: Context, body: { authState?: string; authMethod?: number }): Promise<Response> {
    const { authState: stateToken, authMethod: methodId } = body;

    if (!stateToken || methodId === undefined) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing authState or authMethod');
    }

    // Verify and decode auth state
    let state: AuthState;
    try {
        state = await verify(stateToken, config.auth.jwtSecret, 'HS256') as unknown as AuthState;
    } catch {
        return makeResponse(c, ResponseCode.UNAUTHORIZED, undefined, 'Invalid auth state');
    }

    // Find selected auth method
    const authMethod = state.availableAuthMethods.find(m => m.id === methodId);
    if (!authMethod) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Invalid auth method');
    }

    // Generate random challenge code
    const code = generateRandomCode();

    // Create new auth state with selected method and code
    const newState = await sign(
        {
            asn: state.asn,
            person: state.person,
            authMethod,
            code
        },
        config.auth.jwtSecret,
        'HS256'
    );

    // Return challenge based on auth type
    let authChallenge = '';
    if (authMethod.type === AuthType.PGP_CLEAR_SIGN) {
        authChallenge = code; // User signs this message with their PGP key
    } else if (authMethod.type === AuthType.EMAIL) {
        // TODO: Send email with code
        authChallenge = 'Check your email';
    }

    return success(c, {
        authState: newState,
        authChallenge,
    });
}

/**
 * Step 3: Verify challenge response
 */
async function challenge(c: Context, body: { authState?: string; data?: unknown }): Promise<Response> {
    const { authState: stateToken, data } = body;

    if (!stateToken || !data) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing authState or data');
    }

    // Verify and decode auth state
    let state: AuthState & { code: string; authMethod: AuthMethod };
    try {
        state = await verify(stateToken, config.auth.jwtSecret, 'HS256') as unknown as typeof state;
    } catch {
        return makeResponse(c, ResponseCode.UNAUTHORIZED, undefined, 'Invalid auth state');
    }

    const { authMethod, code, asn, person } = state;
    let authResult = false;

    if (authMethod.type === AuthType.PGP_CLEAR_SIGN) {
        // Expect: { publicKey: string, signedMessage: string }
        const pgpData = data as { publicKey?: string; signedMessage?: string };

        if (!pgpData.publicKey || !pgpData.signedMessage) {
            return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing PGP data');
        }

        // Check if signed message contains the challenge code
        if (pgpData.signedMessage.includes(code)) {
            // TODO: Verify PGP signature using openpgp library
            // For now, just check if code is present
            authResult = true;
        }
    } else if (authMethod.type === AuthType.EMAIL) {
        // Expect: string (the code from email)
        if (typeof data === 'string' && data.trim() === code) {
            authResult = true;
        }
    } else if (authMethod.type === AuthType.PASSWORD) {
        // TODO: Verify password hash
        authResult = false;
    }

    if (!authResult) {
        return success(c, { authResult: false, token: '' });
    }

    // Generate JWT token for authenticated user
    const token = await sign(
        { asn, person, iat: Math.floor(Date.now() / 1000) },
        config.auth.jwtSecret,
        'HS256'
    );

    return success(c, { authResult: true, token });
}

/**
 * Generate random 6-character code
 */
function generateRandomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}
