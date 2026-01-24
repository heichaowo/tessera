import type { Hono } from 'hono';
import agentHandler from './handlers/agent';
import authHandler from './handlers/auth';
import adminHandler from './handlers/admin';
import peeringHandler from './handlers/peering';
import metricsHandler from './handlers/metrics';

export function registerRoutes(app: Hono) {
    // Agent API (for Go agent communication)
    app.get('/agent/:router/:action', agentHandler);
    app.post('/agent/:router/:action', agentHandler);

    // Authentication
    app.post('/auth', authHandler);

    // Admin operations
    app.post('/admin', adminHandler);

    // Peering management
    app.post('/session', peeringHandler);

    // Metrics
    app.get('/metrics', metricsHandler);
}
