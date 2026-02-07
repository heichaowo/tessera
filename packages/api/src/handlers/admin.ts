import type { Context } from 'hono';
import { verify } from 'hono/jwt';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getModels } from '../db/dbContext';
import { getRedis } from '../db/redisContext';
import config from '../config';
import { PeeringStatus, SessionPolicy } from '../db/models/bgpSessions';
import { generateUUID, getInterfaceName, getListenPort } from '../common/helpers';

interface JWTPayload {
    asn: string;
    person: string;
}

/**
 * Check if user is an admin
 * Accepts either:
 * 1. API_TOKEN (for bot/internal use)
 * 2. JWT from user with isAdmin flag in database
 */
async function isAdmin(c: Context): Promise<boolean> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return false;

    const token = authHeader.substring(7);

    // Check if it's the API token (for bot/agent)
    if (token === config.auth.agentApiKey) {
        return true;
    }

    // Otherwise verify as JWT
    try {
        const payload = await verify(
            token,
            config.auth.jwtSecret,
            'HS256'
        ) as unknown as JWTPayload;

        const models = getModels();
        const user = await models.users.findOne({
            where: { asn: Number(payload.asn) },
        });

        return user?.get('isAdmin') === true;
    } catch {
        return false;
    }
}

/**
 * Admin Handler - Administrative operations
 * 
 * Actions:
 * - enumRouters: List all routers
 * - setRouter: Add/update router
 * - deleteRouter: Delete router
 * - enumSessions: List all sessions
 * - approveSession: Approve pending session
 * - rejectSession: Reject pending session
 * - deleteSession: Force delete session
 */
export default async function adminHandler(c: Context): Promise<Response> {
    if (!(await isAdmin(c))) {
        return makeResponse(c, ResponseCode.FORBIDDEN, undefined, 'Admin access required');
    }

    const body = await c.req.json();
    const action = body.action;

    switch (action) {
        case 'enumRouters':
            return await enumRouters(c);
        case 'setRouter':
            return await setRouter(c, body);
        case 'createRouter':
            return await createRouter(c, body);
        case 'getRouter':
            return await getRouter(c, body);
        case 'updateRouter':
            return await updateRouter(c, body);
        case 'deleteRouter':
            return await deleteRouter(c, body);
        case 'enumSessions':
            return await enumSessions(c, body);
        case 'approveSession':
            return await approveSession(c, body);
        case 'rejectSession':
            return await rejectSession(c, body);
        case 'deleteSession':
            return await deleteSessionAdmin(c, body);
        case 'getSession':
            return await getSessionAdmin(c, body);
        case 'updateSession':
            return await updateSessionAdmin(c, body);
        case 'setMaintenance':
            return await setMaintenance(c, body);
        case 'createSession':
            return await createSessionAdmin(c, body);
        default:
            return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Invalid action');
    }
}

/**
 * List all routers with session counts
 */
async function enumRouters(c: Context): Promise<Response> {
    const models = getModels();

    const routers = await models.routers.findAll();

    const result = await Promise.all(routers.map(async (router) => {
        const r = router.get();
        const sessionCount = await models.bgpSessions.count({
            where: { router: r.uuid },
        });

        // Compute isOpen: node accepts new peers if capacity allows
        const maxPeers = r.maxPeers as number | null;
        const isOpen = maxPeers === null || sessionCount < maxPeers;

        return {
            ...r,
            sessionCount,
            isOpen,
        };
    }));

    return success(c, { routers: result });
}

/**
 * Add or update a router
 */
async function setRouter(c: Context, body: { type: string; router?: string; data: unknown }): Promise<Response> {
    const { type, router, data } = body;

    if (!data || typeof data !== 'object') {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing router data');
    }

    const models = getModels();
    const routerData = data as Record<string, unknown>;

    try {
        if (type === 'update' && router) {
            await models.routers.update(routerData, {
                where: { uuid: router },
            });
        } else if (type === 'add') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await models.routers.create(routerData as any);
        } else {
            return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Invalid type');
        }
    } catch (error) {
        console.error('[Admin] Error setting router:', error);
        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, 'Failed to save router');
    }

    return success(c, { message: 'Router saved' });
}

/**
 * Create a new router (for /addnode command)
 */
interface CreateRouterBody {
    name: string;
    hostname?: string;
    ipv4?: string | null;
    ipv6?: string | null;
    role?: string;
    region: string;
    location: string;
    provider: string;
    bandwidth: string;
    maxPeers: number;
    allowCnPeers: boolean;
    bootstrapToken?: string;
}

async function createRouter(c: Context, body: CreateRouterBody): Promise<Response> {
    if (!body.name || !body.location) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing required fields');
    }

    const models = getModels();

    // Generate next nodeId
    const lastRouter = await models.routers.findOne({
        order: [['node_id', 'DESC']],
    });
    const nextNodeId = ((lastRouter?.get('nodeId') as number) || 0) + 1;

    // Map region string to regionCode
    const regionCodeMap: Record<string, number> = {
        'AS-E': 101, 'AS-SE': 102, 'AS-S': 103, 'AS-N': 104,
        'NA-E': 201, 'NA-C': 202, 'NA-W': 203, 'CA': 204, 'SA': 205,
        'EU-W': 301, 'EU-C': 302, 'EU-E': 303,
        'OC': 401, 'AF': 501, 'ME': 502,
    };
    const regionCode = regionCodeMap[body.region?.toUpperCase()] || 101;

    // Map role to nodeType
    const nodeType = body.role === 'rr' ? 'rr' : 'client';

    try {
        const router = await models.routers.create({
            name: body.name,
            location: body.location,
            publicIp: body.ipv4 || null,
            publicIpv6: body.ipv6 || null,
            nodeType,
            provider: body.provider || null,
            bandwidth: body.bandwidth || null,
            maxPeers: body.maxPeers || 20,
            allowCnPeers: body.allowCnPeers ?? true,
            bootstrapToken: body.bootstrapToken || null,
            nodeId: nextNodeId,
            regionCode,
            supportsIpv4: !!body.ipv4,
            supportsIpv6: !!body.ipv6,
            // Auto-generate loopback IPs based on regionCode and nodeId
            dn42Loopback4: `172.22.188.${nextNodeId}`,
            dn42Loopback6: `fd00:4242:7777:${regionCode}:${nextNodeId}::1`,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        return success(c, {
            message: 'Router created',
            router: {
                uuid: router.get('uuid'),
                nodeId: router.get('nodeId'),
                name: router.get('name'),
                regionCode: router.get('regionCode'),
                loopback4: router.get('dn42Loopback4'),
                loopback6: router.get('dn42Loopback6'),
            },
        });
    } catch (error) {
        console.error('[Admin] Error creating router:', error);
        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, 'Failed to create router');
    }
}

/**
 * Get a single router by name (for /bootstrap command)
 */
async function getRouter(c: Context, body: { name?: string }): Promise<Response> {
    if (!body.name) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing name');
    }

    const models = getModels();
    const router = await models.routers.findOne({
        where: { name: body.name },
    });

    if (!router) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
    }

    return success(c, { router: router.get() });
}

/**
 * Update a router by name (for updating bootstrapToken)
 */
async function updateRouter(c: Context, body: { name?: string; updates?: Record<string, unknown> }): Promise<Response> {
    if (!body.name || !body.updates) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing name or updates');
    }

    const models = getModels();

    try {
        const [updated] = await models.routers.update(body.updates, {
            where: { name: body.name },
        });

        if (!updated) {
            return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
        }
    } catch (error) {
        console.error('[Admin] Error updating router:', error);
        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, 'Failed to update router');
    }

    return success(c, { message: 'Router updated' });
}

/**
 * Delete a router (supports both uuid and name)
 */
async function deleteRouter(c: Context, body: { router?: string; name?: string }): Promise<Response> {
    const identifier = body.name || body.router;
    if (!identifier) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing router or name');
    }

    const models = getModels();

    // Check if it's a UUID or name
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const whereClause = isUuid ? { uuid: identifier } : { name: identifier };

    try {
        const deleted = await models.routers.destroy({
            where: whereClause,
        });

        if (!deleted) {
            return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
        }
    } catch (error) {
        console.error('[Admin] Error deleting router:', error);
        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, 'Failed to delete router');
    }

    return success(c, { message: 'Router deleted' });
}

/**
 * List all sessions (optionally filtered by status and/or asn)
 */
async function enumSessions(c: Context, body: { status?: number; asn?: number }): Promise<Response> {
    const models = getModels();

    const whereClause: Record<string, unknown> = {};
    if (body.status !== undefined) {
        whereClause.status = body.status;
    }
    if (body.asn !== undefined) {
        whereClause.asn = body.asn;
    }

    const sessions = await models.bgpSessions.findAll({
        where: whereClause,
        order: [['created_at', 'DESC']],
    });

    // Resolve router names
    const routerUuids = [...new Set(sessions.map(s => s.get('router') as string))];
    const routers = await models.routers.findAll({
        where: { uuid: routerUuids },
    });
    const routerMap = new Map(routers.map(r => [r.get('uuid') as string, r.get('name') as string]));

    return success(c, {
        sessions: sessions.map(s => ({
            ...s.get(),
            routerName: routerMap.get(s.get('router') as string) || s.get('router'),
        })),
    });
}

/**
 * Approve a pending session (moves to QUEUED_FOR_SETUP)
 */
async function approveSession(c: Context, body: { uuid?: string }): Promise<Response> {
    if (!body.uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();

    const [updated] = await models.bgpSessions.update(
        { status: PeeringStatus.QUEUED_FOR_SETUP },
        { where: { uuid: body.uuid, status: PeeringStatus.PENDING_REVIEW } }
    );

    if (!updated) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found or not pending');
    }

    return success(c, { message: 'Session approved' });
}

/**
 * Reject a pending session (moves to DISABLED)
 */
async function rejectSession(c: Context, body: { uuid?: string; reason?: string }): Promise<Response> {
    if (!body.uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();

    const [updated] = await models.bgpSessions.update(
        {
            status: PeeringStatus.DISABLED,
            lastError: body.reason || 'Rejected by admin',
        },
        { where: { uuid: body.uuid, status: PeeringStatus.PENDING_REVIEW } }
    );

    if (!updated) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found or not pending');
    }

    return success(c, { message: 'Session rejected' });
}

/**
 * Force delete a session
 */
async function deleteSessionAdmin(c: Context, body: { uuid?: string }): Promise<Response> {
    if (!body.uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();

    // First queue for delete (so agent can clean up)
    const [updated] = await models.bgpSessions.update(
        { status: PeeringStatus.QUEUED_FOR_DELETE },
        { where: { uuid: body.uuid } }
    );

    if (!updated) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found');
    }

    return success(c, { message: 'Session queued for deletion' });
}

/**
 * Get a single session by uuid (for admin/bot)
 */
async function getSessionAdmin(c: Context, body: { uuid?: string }): Promise<Response> {
    if (!body.uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();

    const session = await models.bgpSessions.findOne({
        where: { uuid: body.uuid },
    });

    if (!session) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found');
    }

    // Get router name
    const router = await models.routers.findOne({
        where: { uuid: session.get('router') as string },
    });
    const routerName = router?.get('name') || session.get('router');

    return success(c, {
        session: {
            ...session.get(),
            routerName,
        },
    });
}

/**
 * Update session fields (for bot/admin)
 */
async function updateSessionAdmin(c: Context, body: { uuid?: string;[key: string]: unknown }): Promise<Response> {
    const { uuid, ...updates } = body;

    if (!uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();

    // Define allowed fields for update
    const allowedFields = [
        'ipv4', 'ipv6', 'ipv6LinkLocal', 'localIpv4',
        'endpoint', 'credential', 'mtu', 'extensions',
        'contact', 'data', 'psk'
    ];

    // Build update object with only allowed fields
    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
        if (field in updates) {
            // Convert extensions from comma-separated string to JSON array for JSONB column
            if (field === 'extensions' && typeof updates[field] === 'string') {
                const extStr = updates[field] as string;
                updateData[field] = extStr ? extStr.split(',').map(s => s.trim()).filter(Boolean) : [];
            } else {
                updateData[field] = updates[field];
            }
        }
    }

    if (Object.keys(updateData).length === 0) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'No valid fields to update');
    }

    // Verify session exists
    const session = await models.bgpSessions.findOne({ where: { uuid } });
    if (!session) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found');
    }

    // Update session with error handling for PostgreSQL type errors
    try {
        await models.bgpSessions.update(updateData, { where: { uuid } });
    } catch (error) {
        console.error('[Admin] Error updating session:', error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        // Handle PostgreSQL INET type errors (22P02)
        if (errorMsg.includes('22P02') || errorMsg.includes('invalid input syntax')) {
            return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Invalid IP address format');
        }

        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, `Update failed: ${errorMsg}`);
    }

    return success(c, { message: 'Session updated' });
}

/**
 * Set maintenance mode for a router
 * This calls the agent's maintenance API and stores state in Redis
 */
async function setMaintenance(c: Context, body: { router?: string; enabled?: boolean }): Promise<Response> {
    const { router, enabled } = body;

    if (!router || enabled === undefined) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing router or enabled');
    }

    const models = getModels();
    const routerRecord = await models.routers.findOne({
        where: { name: router },
    });

    if (!routerRecord) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
    }

    const publicIp = routerRecord.get('publicIp') as string;
    if (!publicIp) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Router has no public IP');
    }

    // Call agent's maintenance API
    const agentUrl = `http://${publicIp}:8080/maintenance/${enabled ? 'start' : 'stop'}`;

    try {
        const agentResp = await fetch(agentUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.auth.agentApiKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!agentResp.ok) {
            const errorText = await agentResp.text();
            return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, `Agent returned: ${errorText}`);
        }

        // Store maintenance state in Redis
        try {
            const redis = getRedis();
            await redis.hset(`maintenance:${router}`, {
                enabled: enabled ? '1' : '0',
                changedAt: Date.now().toString(),
            });
        } catch (redisError) {
            console.warn('[Admin] Failed to store maintenance state in Redis:', redisError);
        }

        console.log(`[Admin] Maintenance ${enabled ? 'enabled' : 'disabled'} for ${router}`);
        return success(c, {
            message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
            router,
        });
    } catch (error) {
        console.error('[Admin] Failed to call agent maintenance API:', error);
        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, 'Failed to contact agent');
    }
}

/**
 * Admin create session - creates a peering session directly with ACTIVE status
 * Bypasses JWT auth and review process.
 */
async function createSessionAdmin(c: Context, body: {
    asn: number;
    router: string;
    ipv6?: string;
    endpoint?: string;
    port?: number;
    publicKey?: string;
    mtu?: number;
    psk?: string;
    status?: number;
    extensions?: string;
    contact?: string;
}): Promise<Response> {
    const { asn, router, ipv6, endpoint, port, publicKey, mtu, psk, status, extensions, contact } = body;
    const fullEndpoint = endpoint ? (port ? `${endpoint}:${port}` : endpoint) : null;
    // Default extensions to mp_bgp + extended_nexthop (recommended config)
    // Store as JSON array for JSONB column (agent expects string[])
    const defaultExtensions = ['mp_bgp', 'extended_nexthop'];
    let sessionExtensions: string[];
    if (extensions !== undefined) {
        sessionExtensions = typeof extensions === 'string'
            ? extensions.split(',').map(s => s.trim()).filter(Boolean)
            : (extensions as unknown as string[]);
    } else {
        sessionExtensions = defaultExtensions;
    }

    if (!asn || !router) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing required fields: asn, router');
    }

    const models = getModels();

    // Check if router exists
    const routerRecord = await models.routers.findOne({
        where: { uuid: router },
    });

    if (!routerRecord) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
    }

    // Check if session already exists
    const existingSession = await models.bgpSessions.findOne({
        where: { router, asn },
    });

    if (existingSession) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Session already exists for this ASN on this router');
    }

    const sessionUuid = generateUUID();
    const interfaceName = getInterfaceName(asn);
    const listenPort = getListenPort(asn);
    const sessionStatus = status === 1 ? PeeringStatus.QUEUED_FOR_SETUP : PeeringStatus.PENDING_REVIEW;

    try {
        await models.bgpSessions.create({
            uuid: sessionUuid,
            router,
            asn,
            status: sessionStatus,
            mtu: mtu || 1420,
            policy: SessionPolicy.FULL,
            ipv4: null,
            ipv6: ipv6 || null,
            // Auto-set our local LLA for link-local peering
            ipv6LinkLocal: ipv6 && ipv6.startsWith('fe80') ? 'fe80::998' : null,
            type: 'wireguard',
            extensions: (sessionExtensions.length > 0 ? sessionExtensions : null) as unknown as string,
            interface: interfaceName,
            endpoint: fullEndpoint,
            credential: publicKey ? JSON.stringify({
                public_key: publicKey,
                preshared_key: psk || null,
                listen_port: listenPort,
                endpoint: fullEndpoint,
                mtu: mtu || 1420,
            }) : null,
            data: null,
            lastError: null,
            contact: contact || null,
        });

        console.log(`[Admin] Created session ${sessionUuid} for AS${asn} on ${router} with status ${sessionStatus}`);

        return success(c, {
            uuid: sessionUuid,
            status: sessionStatus,
            message: `Session created with status: ${sessionStatus}`,
        });
    } catch (error) {
        console.error('[Admin] Error creating session:', error);
        return makeResponse(c, ResponseCode.INTERNAL_ERROR, undefined, 'Failed to create session');
    }
}
