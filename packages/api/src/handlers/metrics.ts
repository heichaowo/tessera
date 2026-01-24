import type { Context } from 'hono';
import { success } from '../common/response';

/**
 * Metrics Handler - Placeholder
 * TODO: Implement metrics endpoint for Prometheus/Grafana
 */
export default async function metricsHandler(c: Context): Promise<Response> {
    return success(c, { message: 'Metrics endpoint - TODO' });
}
