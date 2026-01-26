/**
 * Bot Middleware: Rate Limiting, Metrics
 */
import type { Context, NextFunction } from 'grammy';
import config from './config';

/**
 * Rate limit tracking per user
 */
const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

/**
 * Metrics counters
 */
export const metrics = {
    totalRequests: 0,
    commandCounts: new Map<string, number>(),
    errors: 0,
    rateLimited: 0,
    startTime: Date.now(),
};

/**
 * Rate limiting middleware
 * Limits requests per user within a time window
 */
export function rateLimitMiddleware<C extends Context>() {
    return async (ctx: C, next: NextFunction) => {
        const userId = ctx.from?.id;
        if (!userId) {
            return next();
        }

        const now = Date.now();
        const windowMs = config.rateLimit.windowMs;
        const maxRequests = config.rateLimit.maxRequests;

        let userData = rateLimitMap.get(userId);

        if (!userData || now > userData.resetAt) {
            userData = { count: 1, resetAt: now + windowMs };
            rateLimitMap.set(userId, userData);
        } else {
            userData.count++;
        }

        if (userData.count > maxRequests) {
            metrics.rateLimited++;
            const waitSeconds = Math.ceil((userData.resetAt - now) / 1000);
            await ctx.reply(
                `⏱️ Rate limited. Please wait ${waitSeconds}s.\n` +
                `请稍等 ${waitSeconds} 秒后再试。`
            );
            return;
        }

        return next();
    };
}

/**
 * Metrics collection middleware
 */
export function metricsMiddleware<C extends Context>() {
    return async (ctx: C, next: NextFunction) => {
        metrics.totalRequests++;

        // Track command usage
        const command = ctx.message && 'text' in ctx.message
            ? ctx.message.text?.split(' ')[0] || ''
            : '';

        if (command.startsWith('/')) {
            const cmd = command.slice(1).toLowerCase();
            metrics.commandCounts.set(cmd, (metrics.commandCounts.get(cmd) || 0) + 1);
        }

        try {
            await next();
        } catch (error) {
            metrics.errors++;
            throw error;
        }
    };
}

/**
 * Get metrics summary
 */
export function getMetricsSummary(): Record<string, unknown> {
    const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
    const topCommands: Array<{ command: string; count: number }> = [];

    metrics.commandCounts.forEach((count, command) => {
        topCommands.push({ command, count });
    });

    topCommands.sort((a, b) => b.count - a.count);

    return {
        uptime_seconds: uptime,
        total_requests: metrics.totalRequests,
        errors: metrics.errors,
        rate_limited: metrics.rateLimited,
        top_commands: topCommands.slice(0, 10),
        active_rate_limits: rateLimitMap.size,
    };
}

/**
 * Cleanup expired rate limit entries (call periodically)
 */
export function cleanupRateLimits(): void {
    const now = Date.now();
    for (const [userId, data] of rateLimitMap.entries()) {
        if (now > data.resetAt) {
            rateLimitMap.delete(userId);
        }
    }
}

// Cleanup every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);
