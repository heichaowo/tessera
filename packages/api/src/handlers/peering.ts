import type { Context } from 'hono';
import { verify } from 'hono/jwt';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getModels } from '../db/dbContext';
import config from '../config';
import { PeeringStatus, SessionPolicy } from '../db/models/bgpSessions';
import { generateUUID, getInterfaceName } from '../common/helpers';

interface JWTPayload {
    asn: string;
    person: string;
}

/**
 * Peering Handler - Session management
 * 
 * Actions:
 * - create: Create new peering session
 * - list: List user's sessions
 * - get: Get session details
 * - delete: Request session deletion
 */
export default async function peeringHandler(c: Context): Promise<Response> {
    const body = await c.req.json();
    const action = body.action;

    // Verify JWT token
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return makeResponse(c, ResponseCode.UNAUTHORIZED);
    }

    let user: JWTPayload;
    try {
        user = await verify(
            authHeader.substring(7),
            config.auth.jwtSecret,
            'HS256'
        ) as unknown as JWTPayload;
    } catch {
        return makeResponse(c, ResponseCode.UNAUTHORIZED, undefined, 'Invalid token');
    }

    switch (action) {
        case 'create':
            return await createSession(c, body, user);
        case 'list':
            return await listSessions(c, user);
        case 'get':
            return await getSession(c, body, user);
        case 'delete':
            return await deleteSession(c, body, user);
        default:
            return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Invalid action');
    }
}

interface CreateSessionRequest {
    router: string;
    endpoint?: string;
    publicKey?: string;
    ipv4?: string;
    ipv6?: string;
    ipv6LinkLocal?: string;
    mtu?: number;
    extensions?: string[];
}

/**
 * Create a new peering session
 */
async function createSession(
    c: Context,
    body: { data?: CreateSessionRequest },
    user: JWTPayload
): Promise<Response> {
    const data = body.data;

    if (!data?.router) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing router');
    }

    const models = getModels();
    const asn = Number(user.asn);

    // Check if router exists
    const router = await models.routers.findOne({
        where: { uuid: data.router },
    });

    if (!router) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
    }

    // Check if session already exists
    const existingSession = await models.bgpSessions.findOne({
        where: {
            router: data.router,
            asn,
        },
    });

    if (existingSession) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Session already exists');
    }

    // Create new session
    const sessionUuid = generateUUID();
    const interfaceName = getInterfaceName(asn);

    await models.bgpSessions.create({
        uuid: sessionUuid,
        router: data.router,
        asn,
        status: PeeringStatus.PENDING_REVIEW,
        mtu: data.mtu || 1420,
        policy: SessionPolicy.FULL,
        ipv4: data.ipv4 || null,
        ipv6: data.ipv6 || null,
        ipv6LinkLocal: data.ipv6LinkLocal || null,
        type: 'wireguard',
        extensions: data.extensions ? JSON.stringify(data.extensions) : null,
        interface: interfaceName,
        endpoint: data.endpoint || null,
        credential: data.publicKey || null,
        data: null,
        lastError: null,
    });

    return success(c, {
        uuid: sessionUuid,
        status: PeeringStatus.PENDING_REVIEW,
        message: 'Session created, pending review',
    });
}

/**
 * List user's sessions
 */
async function listSessions(c: Context, user: JWTPayload): Promise<Response> {
    const models = getModels();
    const asn = Number(user.asn);

    const sessions = await models.bgpSessions.findAll({
        attributes: ['uuid', 'router', 'status', 'ipv4', 'ipv6', 'mtu', 'lastError', 'created_at'],
        where: { asn },
    });

    return success(c, {
        sessions: sessions.map((s: { get: () => unknown }) => s.get()),
    });
}

/**
 * Get session details
 */
async function getSession(
    c: Context,
    body: { uuid?: string },
    user: JWTPayload
): Promise<Response> {
    if (!body.uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();
    const asn = Number(user.asn);

    const session = await models.bgpSessions.findOne({
        where: { uuid: body.uuid, asn },
    });

    if (!session) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found');
    }

    return success(c, { session: session.get() });
}

/**
 * Request session deletion
 */
async function deleteSession(
    c: Context,
    body: { uuid?: string },
    user: JWTPayload
): Promise<Response> {
    if (!body.uuid) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing uuid');
    }

    const models = getModels();
    const asn = Number(user.asn);

    const [updated] = await models.bgpSessions.update(
        { status: PeeringStatus.QUEUED_FOR_DELETE },
        { where: { uuid: body.uuid, asn } }
    );

    if (!updated) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Session not found');
    }

    return success(c, { message: 'Session queued for deletion' });
}
