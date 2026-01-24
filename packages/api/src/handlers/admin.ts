import type { Context } from 'hono';
import { success } from '../common/response';

/**
 * Admin Handler - Placeholder
 * TODO: Implement admin operations
 */
export default async function adminHandler(c: Context): Promise<Response> {
    return success(c, { message: 'Admin endpoint - TODO' });
}
