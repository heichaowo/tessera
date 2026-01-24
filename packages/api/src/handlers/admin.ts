import type { Context } from 'hono';
import { verify } from 'hono/jwt';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getModels } from '../db/dbContext';
import config from '../config';
import { PeeringStatus } from '../db/models/bgpSessions';

interface JWTPayload {
    asn: string;
    person: string;
}

/**
 * Check if user is an admin
 */
async function isAdmin(c: Context): Promise<boolean> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return false;

    try {
        const payload = await verify(
            authHeader.substring(7),
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
            await models.routers.create(routerData);
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
 * Delete a router
 */
async function deleteRouter(c: Context, body: { router?: string }): Promise<Response> {
    if (!body.router) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing router');
    }

    const models = getModels();

    try {
        const deleted = await models.routers.destroy({
            where: { uuid: body.router },
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
