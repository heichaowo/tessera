import type { Context } from 'hono';
import { bcryptCompare } from '../common/helpers';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getModels } from '../db/dbContext';
import config from '../config';
import { PeeringStatus, type BgpSessionAttributes } from '../db/models/bgpSessions';

/**
 * Verify agent API key (bcrypt hash of key + router)
 */
async function verifyAgentApiKey(c: Context, router: string): Promise<boolean> {
    const header = c.req.header('Authorization');
    if (!header) return false;

    const token = header.split('Bearer ')[1];
    if (!token) return false;

    try {
        return await bcryptCompare(`${config.auth.agentApiKey}${router}`, token);
    } catch {
        return false;
    }
}

/**
 * Agent API Handler
 * 
 * Routes:
 * - GET/POST /agent/:router/sessions - Get sessions for agent
 * - POST /agent/:router/modify - Modify session status
 * - POST /agent/:router/report - Report metrics
 * - POST /agent/:router/heartbeat - Agent heartbeat
 */
export default async function agentHandler(c: Context): Promise<Response> {
    const { action, router } = c.req.param();

    if (!router || !action) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Missing router or action');
    }

    // Verify API key
    if (!(await verifyAgentApiKey(c, router))) {
        return makeResponse(c, ResponseCode.UNAUTHORIZED);
    }

    // Verify router exists
    const models = getModels();
    const routerExists = await models.routers.count({
        where: { uuid: router },
    });

    if (!routerExists) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
    }

    // Route to appropriate handler
    switch (action) {
        case 'sessions':
            return await handleSessions(c, router);
        case 'modify':
            return await handleModify(c, router);
        case 'report':
            return await handleReport(c, router);
        case 'heartbeat':
            return await handleHeartbeat(c, router);
        default:
            return makeResponse(c, ResponseCode.NOT_FOUND, undefined, `Unknown action: ${action}`);
    }
}

/**
 * GET /agent/:router/sessions
 * Returns all BGP sessions for the agent to configure
 */
async function handleSessions(c: Context, router: string): Promise<Response> {
    const models = getModels();

    const sessions = await models.bgpSessions.findAll({
        attributes: [
            'uuid', 'asn', 'status', 'ipv4', 'ipv6', 'ipv6LinkLocal',
            'type', 'extensions', 'interface', 'endpoint', 'credential',
            'data', 'mtu', 'policy', 'lastError'
        ],
        where: { router },
    });

    const bgpSessions = sessions.map((session) => {
        const s = session.get() as BgpSessionAttributes;
        return {
            uuid: s.uuid,
            asn: s.asn,
            status: s.status,
            ipv4: s.ipv4,
            ipv6: s.ipv6,
            ipv6LinkLocal: s.ipv6LinkLocal,
            type: s.type,
            extensions: s.extensions ? JSON.parse(s.extensions) : [],
            interface: s.interface,
            endpoint: s.endpoint,
            credential: s.credential,
            data: s.data ? JSON.parse(s.data) : null,
            mtu: s.mtu,
            policy: s.policy,
            lastError: s.lastError,
        };
    });

    return success(c, { bgpSessions });
}

/**
 * POST /agent/:router/modify
 * Modify a session status
 */
async function handleModify(c: Context, router: string): Promise<Response> {
    const body = await c.req.json();
    const { uuid, status, lastError } = body;

    if (!uuid || status === undefined) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid or status');
    }

    const models = getModels();

    const [updated] = await models.bgpSessions.update(
        {
            status: status as PeeringStatus,
            lastError: lastError || null,
        },
        { where: { uuid, router } }
    );

    if (!updated) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found');
    }

    return success(c, { updated: true });
}

/**
 * POST /agent/:router/report
 * Receive metrics from agent
 */
async function handleReport(c: Context, router: string): Promise<Response> {
    const body = await c.req.json();

    // TODO: Store metrics in Redis for time-series data
    console.log(`[Agent ${router}] Report:`, body);

    return success(c, { received: true });
}

/**
 * POST /agent/:router/heartbeat
 * Receive heartbeat from agent
 */
async function handleHeartbeat(c: Context, router: string): Promise<Response> {
    const body = await c.req.json();

    // TODO: Update router last_seen timestamp
    // TODO: Store node status in Redis
    console.log(`[Agent ${router}] Heartbeat:`, body);

    return success(c, {
        received: true,
        timestamp: Date.now(),
    });
}
