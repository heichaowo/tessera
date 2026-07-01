/**
 * Public "reset & rerun" demo control — one-click from-zero mesh rebuild.
 *
 * POST /api/v1/demo/rerun       (public, cooldown-locked): tears the whole mesh
 *   down — deletes every BGP session, so agents reconcile and remove their WG +
 *   BIRD on the next sync — and raises a rebuild flag.
 * POST /api/v1/demo/rerun-claim (agent-authed): the brain claims the flag once
 *   and runs an establishment round, rebuilding the paid mesh from zero.
 *
 * A cooldown lock both rate-limits the public button (anti-grief) and gives the
 * dashboard a "rebuilding" phase to show while the globe reforms.
 */

import type { Context } from "hono";
import { timingSafeCompare } from "../common/helpers";
import config from "../config";
import { getModels } from "../db/dbContext";
import { getRedis } from "../db/redisContext";
import { getClientKey } from "../middleware/rateLimiter";

const LOCK = "demo:rerun:lock";
const FLAG = "demo:rerun:requested";
const PHASE = "demo:rerun:phase";
const COOLDOWN = 240; // seconds — ~one rebuild; also the public button's rate limit

function authed(c: Context): boolean {
	const token = c.req.header("Authorization")?.split("Bearer ")[1];
	return (
		!!token &&
		!!config.auth.agentApiKey &&
		timingSafeCompare(token, config.auth.agentApiKey)
	);
}

/** POST /api/v1/demo/rerun — public: reset the mesh + flag a rebuild. */
export async function demoRerunHandler(c: Context): Promise<Response> {
	const redis = getRedis();
	// Per-IP guard: one visitor can't monopolise the rebuild (5 min/IP); the
	// global cooldown below still paces everyone.
	const ip = getClientKey(c);
	if (ip && ip !== "unknown") {
		const okIp = await redis.set(`demo:rerun:ip:${ip}`, "1", "EX", 300, "NX");
		if (!okIp) {
			const t = await redis.ttl(`demo:rerun:ip:${ip}`);
			return c.json({ ok: false, busy: true, scope: "ip", ttl: t > 0 ? t : 300 });
		}
	}
	// Atomic acquire: SET NX EX in one round-trip so concurrent clicks can't both
	// pass the guard and double-fire the destructive teardown (and the TTL can't
	// be lost between a separate SET and EXPIRE).
	const acquired = await redis.set(LOCK, "1", "EX", COOLDOWN, "NX");
	if (!acquired) {
		const ttl = await redis.ttl(LOCK);
		return c.json({ ok: false, busy: true, ttl: ttl > 0 ? ttl : COOLDOWN });
	}
	await redis.set(PHASE, "tearing down");
	// Tear down: delete every session. Agents reconcile + remove WG/BIRD next sync.
	const models = getModels();
	const deleted = await models.bgpSessions.destroy({ where: {} });
	await redis.set(FLAG, "1");
	return c.json({ ok: true, deleted, cooldown: COOLDOWN });
}

/** POST /api/v1/demo/rerun-claim — agent-authed: brain claims the rebuild once. */
export async function demoRerunClaimHandler(c: Context): Promise<Response> {
	if (!authed(c)) return c.json({ code: 401, message: "Unauthorized" }, 401);
	const redis = getRedis();
	if (!(await redis.get(FLAG))) return c.json({ claimed: false });
	await redis.del(FLAG);
	await redis.set(PHASE, "rebuilding");
	return c.json({ claimed: true });
}

/** Live rerun status for the dashboard banner (null when idle). */
export async function rerunStatus(): Promise<{
	phase: string;
	ttl: number;
} | null> {
	const redis = getRedis();
	const ttl = await redis.ttl(LOCK);
	if (ttl <= 0) return null;
	return { phase: (await redis.get(PHASE)) || "rebuilding", ttl };
}
