import type { Context } from 'hono';
import { verify } from 'hono/jwt';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getModels } from '../db/dbContext';
import { getRedis } from '../db/redisContext';
import config from '../config';
import { PeeringStatus } from '../db/models/bgpSessions';

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
        case 'setMaintenance':
            return await setMaintenance(c, body);
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

        return {
            ...r,
            sessionCount,
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
    if (!body.name || !body.region || !body.location) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing required fields');
    }

    const models = getModels();

    // Generate next nodeId
    const lastRouter = await models.routers.findOne({
        order: [['node_id', 'DESC']],
    });
    const nextNodeId = ((lastRouter?.get('nodeId') as number) || 0) + 1;

    try {
        const router = await models.routers.create({
            name: body.name,
            location: body.location,
            region: body.region,
            publicIp: body.ipv4 || null,
            publicIpv6: body.ipv6 || null,
            role: body.role || 'client',
            provider: body.provider || null,
            bandwidth: body.bandwidth || null,
            maxPeers: body.maxPeers || 20,
            allowCnPeers: body.allowCnPeers ?? true,
            bootstrapToken: body.bootstrapToken || null,
            nodeId: nextNodeId,
            supportsIpv4: !!body.ipv4,
            supportsIpv6: !!body.ipv6,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        return success(c, {
            message: 'Router created',
            router: {
                uuid: router.get('uuid'),
                nodeId: router.get('nodeId'),
                name: router.get('name'),
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
 * List all sessions (optionally filtered by status)
 */
async function enumSessions(c: Context, body: { status?: number }): Promise<Response> {
    const models = getModels();

    const whereClause: Record<string, unknown> = {};
    if (body.status !== undefined) {
        whereClause.status = body.status;
    }

    const sessions = await models.bgpSessions.findAll({
        where: whereClause,
        order: [['created_at', 'DESC']],
    });

    return success(c, {
        sessions: sessions.map(s => s.get()),
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
