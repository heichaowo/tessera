/**
 * Shared throttle for the public demo buttons.
 *
 * A **global** cooldown paces everyone (concurrent judges get a friendly
 * "busy, back in Ns" instead of a storm), and a **per-IP** cooldown stops one
 * visitor from monopolising or griefing a control without blocking the others.
 * Returns a JSON Response when throttled, or null when the caller may proceed.
 *
 * The per-IP layer only bites once serve-dashboard forwards the real client IP
 * (X-Forwarded-For); the global layer works regardless. Nothing here is a
 * security boundary — every demo action is cheap and self-healing — it just
 * keeps the live demo looking good under concurrent or hostile clicking.
 */

import type { Context } from "hono";
import { getRedis } from "../db/redisContext";
import { getClientKey } from "../middleware/rateLimiter";

export async function demoGuard(
	c: Context,
	name: string,
	globalSec: number,
	perIpSec: number,
): Promise<Response | null> {
	const redis = getRedis();
	const ip = getClientKey(c);
	const ipKey = `demo:cd:${name}:ip:${ip}`;
	const gKey = `demo:cd:${name}`;

	// Per-IP first: throttle the specific abuser, not the whole room.
	if (ip && ip !== "unknown") {
		const okIp = await redis.set(ipKey, "1", "EX", perIpSec, "NX");
		if (!okIp) {
			const ttl = await redis.ttl(ipKey);
			return c.json({ ok: false, busy: true, scope: "ip", ttl: ttl > 0 ? ttl : perIpSec });
		}
	}
	// Global pacing.
	const okG = await redis.set(gKey, "1", "EX", globalSec, "NX");
	if (!okG) {
		if (ip && ip !== "unknown") await redis.del(ipKey); // don't burn this IP's turn
		const ttl = await redis.ttl(gKey);
		return c.json({ ok: false, busy: true, scope: "global", ttl: ttl > 0 ? ttl : globalSec });
	}
	return null;
}
