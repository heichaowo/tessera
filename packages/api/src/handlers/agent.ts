import type { Context } from 'hono';
import { Op } from 'sequelize';
import { bcryptCompare } from '../common/helpers';
import { makeResponse, ResponseCode, success } from '../common/response';
import { getModels } from '../db/dbContext';
import { validateBody, isValidationError } from '../schemas/validate';
import { ModifySessionSchema, HeartbeatSchema, MetricsReportSchema } from '../schemas/agent';
import config from '../config';
import { PeeringStatus, type BgpSessionAttributes } from '../db/models/bgpSessions';

/**
 * Verify agent API key (simple token comparison)
 */
async function verifyAgentApiKey(c: Context, _router: string): Promise<boolean> {
    const header = c.req.header('Authorization');
    if (!header) return false;

    const token = header.split('Bearer ')[1];
    if (!token) return false;

    // Simple token comparison
    return token === config.auth.agentApiKey;
}

/**
 * Agent API Handler
 * 
 * Routes:
 * - GET/POST /agent/:router/sessions - Get sessions for agent
 * - POST /agent/:router/modify - Modify session status
 * - POST /agent/:router/report - Report metrics
 * - POST /agent/:router/heartbeat - Agent heartbeat
 * - POST /agent/heartbeat - Global heartbeat (node_id in body)
 */
export default async function agentHandler(c: Context): Promise<Response> {
    const { action, router } = c.req.param();

    // Handle global heartbeat (no router in path, node_id in body)
    if (c.req.path === '/api/v1/agent/heartbeat' && !router) {
        return handleGlobalHeartbeat(c);
    }

    // Handle mesh/status nested route
    const meshStatusMatch = c.req.path.match(/^\/api\/v1\/agent\/([^/]+)\/mesh\/status$/);
    if (meshStatusMatch) {
        const routerName = meshStatusMatch[1] as string;
        if (!(await verifyAgentApiKey(c, routerName))) {
            return makeResponse(c, ResponseCode.UNAUTHORIZED);
        }
        const models = getModels();
        const routerRecord = await models.routers.findOne({ where: { name: routerName } });
        if (!routerRecord) {
            return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
        }
        return handleMeshStatus(c, routerRecord.get('uuid') as string);
    }

    if (!router || !action) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Missing router or action');
    }

    // Verify API key
    if (!(await verifyAgentApiKey(c, router))) {
        return makeResponse(c, ResponseCode.UNAUTHORIZED);
    }

    // Verify router exists (lookup by name OR uuid if valid)
    const models = getModels();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(router);
    const whereClause = isUuid
        ? { [Op.or]: [{ uuid: router }, { name: router }] }
        : { name: router };

    const routerRecord = await models.routers.findOne({
        where: whereClause,
    });

    if (!routerRecord) {
        return makeResponse(c, ResponseCode.NOT_FOUND, undefined, 'Router not found');
    }

    const routerUuid = routerRecord.get('uuid') as string;

    // Route to appropriate handler
    switch (action) {
        case 'sessions':
            return await handleSessions(c, routerUuid);
        case 'modify':
            return await handleModify(c, routerUuid);
        case 'report':
            return await handleReport(c, routerUuid);
        case 'heartbeat':
            return await handleHeartbeat(c, routerUuid);
        case 'mesh':
            return await handleMesh(c, routerUuid);
        case 'mesh/status':
            return await handleMeshStatus(c, routerUuid);
        case 'config':
            return await handleConfig(c, routerRecord);
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

    const bgpSessions = sessions.map((session: { get: () => unknown }) => {
        const s = session.get() as BgpSessionAttributes;
        return {
            uuid: s.uuid,
            asn: parseInt(String(s.asn), 10),  // Convert to number for Go agent
            status: s.status,
            ipv4: s.ipv4,
            ipv6: s.ipv6,
            ipv6LinkLocal: s.ipv6LinkLocal,
            type: s.type,
            extensions: s.extensions ? JSON.parse(s.extensions) : [],
            interface: s.interface,
            endpoint: s.endpoint,
            credential: s.credential ? JSON.stringify(s.credential) : '',
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

/**
 * POST /agent/heartbeat (global)
 * Receive heartbeat from agent with node_id in body
 */
async function handleGlobalHeartbeat(c: Context): Promise<Response> {
    // Verify API key (no router param)
    const header = c.req.header('Authorization');
    if (!header) {
        return makeResponse(c, ResponseCode.UNAUTHORIZED);
    }
    const token = header.split('Bearer ')[1];
    if (!token || token !== config.auth.agentApiKey) {
        return makeResponse(c, ResponseCode.UNAUTHORIZED);
    }

    const body = await c.req.json();
    const nodeId = body.node_id;
    const status = body.status || {};

    if (!nodeId) {
        return makeResponse(c, ResponseCode.VALIDATION_ERROR, undefined, 'Missing node_id');
    }

    // Update router mesh_public_key if provided
    if (status.meshPublicKey) {
        const models = getModels();
        await models.routers.update(
            { meshPublicKey: status.meshPublicKey },
            { where: { name: nodeId } }
        );
        console.log(`[Agent ${nodeId}] Updated meshPublicKey: ${status.meshPublicKey.substring(0, 20)}...`);
    }

    console.log(`[Agent ${nodeId}] Heartbeat: load=${status.loadAvg}, uptime=${status.uptime}s`);

    return success(c, {
        received: true,
        timestamp: Date.now(),
    });
}

/**
 * GET /agent/:router/mesh
 * Returns mesh peer configuration for WireGuard tunnel setup
 */
async function handleMesh(c: Context, router: string): Promise<Response> {
    const models = getModels();

    // Get all routers except the requesting one
    const routers = await models.routers.findAll({
        attributes: ['uuid', 'name', 'publicIp', 'meshPublicKey', 'region'],
        where: {
            uuid: { [Op.ne]: router },
        },
    });

    const peers = routers.map((r: { get: (key: string) => unknown }, index: number) => ({
        nodeId: index + 1,  // Use index as stable numeric ID
        nodeName: r.get('name') as string,
        loopbackIpv4: '',
        loopbackIpv6: '',
        publicKey: r.get('meshPublicKey') as string || '',
        endpoint: r.get('publicIp') ? `${r.get('publicIp')}:51820` : '',
        mtu: 1420,
        isRr: false,
    }));

    return success(c, {
        peers,
    });
}

/**
 * POST /agent/:router/mesh/status
 * Receives mesh tunnel status reports from agents
 */
async function handleMeshStatus(c: Context, router: string): Promise<Response> {
    const body = await c.req.json().catch(() => ({}));
    const { node_id, timestamp, peers } = body;

    // Log mesh status (can be extended to store in DB or emit events)
    console.log(`[MeshStatus] ${node_id} reported at ${timestamp}:`, peers);

    // Store mesh status in Redis for real-time monitoring (optional)
    // For now, just acknowledge receipt
    return success(c, {
        received: true,
        timestamp: Date.now(),
    });
}

/**
 * GET /agent/:router/config
 * Returns agent configuration for bootstrap mode
 */
async function handleConfig(
    c: Context,
    // biome-ignore lint/suspicious/noExplicitAny: Sequelize model instance
    routerRecord: any
): Promise<Response> {
    const name = routerRecord.get('name') as string;
    const region = routerRecord.get('region') as string;
    const location = routerRecord.get('location') as string;

    // Build agent configuration
    const agentConfig = {
        node: {
            name,
            id: routerRecord.get('nodeId') as number ?? 0,
            region,
            location,
            provider: routerRecord.get('provider') as string ?? '',
        },
        bird: {
            controlSocket: '/var/run/bird/run/bird.ctl',
            poolSize: 5,
            poolSizeMax: 64,
            peerConfDir: '/etc/bird/peers',
            ebgpConfTemplateFile: '/opt/moenet-agent/templates/ebgp.conf.tmpl',
            ibgpConfDir: '/etc/bird/ibgp.d',
        },
        wireguard: {
            privateKeyPath: '/etc/wireguard/privatekey',
            publicKeyPath: '/etc/wireguard/publickey',
            configDir: '/etc/wireguard',
            persistentKeepaliveInterval: 25,
            dn42Ipv4: routerRecord.get('dn42Loopback4') as string ?? '',
            dn42Ipv6: routerRecord.get('dn42Loopback6') as string ?? '',
            dn42Ipv6LinkLocal: `fe80::998:${routerRecord.get('nodeId') ?? 1}`,
        },
        metric: {
            pingTimeout: 5,
            pingCount: 4,
            pingWorkers: 32,
        },
        autoUpdate: {
            enabled: true,
            checkInterval: 60,
            channel: 'stable',
            githubRepo: 'heichaowo/moenet-agent',
        },
    };

    return success(c, agentConfig);
}
