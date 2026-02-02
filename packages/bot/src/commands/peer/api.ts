/**
 * Peer Module - API Client
 *
 * Centralized API request helper for peer-related operations.
 */

import config from '../../config';
import type { APIResponse } from './types';

/**
 * API client for moenet-core
 */
export async function apiRequest(
    endpoint: string,
    method = 'POST',
    body?: unknown,
    token?: string
): Promise<APIResponse> {
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return response.json() as Promise<APIResponse>;
}

/**
 * Fetch routers list
 */
export async function fetchRouters(): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', { action: 'enumRouters' }, config.apiToken);
}

/**
 * Fetch user sessions
 */
export async function fetchUserSessions(asn: number): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', { action: 'enumSessions', asn }, config.apiToken);
}

/**
 * Fetch session details
 */
export async function fetchSessionDetails(uuid: string): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', { action: 'getSession', uuid }, config.apiToken);
}

/**
 * Create new session
 */
export async function createSession(params: {
    asn: number;
    routerUuid: string;
    ipv6: string;
    ipv4?: string;
    localIpv6?: string;
    localIpv4?: string;
    endpoint?: string;
    port?: number;
    pubkey: string;
    psk?: string;
    mtu?: number;
    mpbgp?: boolean;
    extendedNexthop?: boolean;
    contact?: string;
}): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', {
        action: 'createSession',
        ...params,
    }, config.apiToken);
}

/**
 * Update session
 */
export async function updateSession(params: {
    uuid: string;
    ipv6?: string | null;
    ipv4?: string | null;
    ipv6LinkLocal?: string | null;
    localIpv4?: string | null;
    endpoint?: string | null;
    mtu?: number;
    contact?: string | null;
    extensions?: string;
}): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', {
        action: 'updateSession',
        ...params,
    }, config.apiToken);
}

/**
 * Delete session
 */
export async function deleteSession(uuid: string): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', { action: 'deleteSession', uuid }, config.apiToken);
}

/**
 * Restart session
 */
export async function restartSession(uuid: string): Promise<APIResponse> {
    return apiRequest('/admin', 'POST', { action: 'restartSession', uuid }, config.apiToken);
}
