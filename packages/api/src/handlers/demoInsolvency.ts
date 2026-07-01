/**
 * Edge case (Route B): insufficient balance → payment default → consequences.
 *
 * A node marked insolvent can't settle its net usage: the settlement endpoint
 * rejects it, and the default is recorded so the dashboard can show the unpaid
 * peering as at-risk and the defaulter's standing dropping — non-payment has a
 * cost. (Standing here is a CP-side default record; the agents' own reputation
 * also drifts down over repeated failures.) The flag auto-reverts via TTL.
 */

import type { Context } from "hono";
import config from "../config";
import { getModels } from "../db/dbContext";
import { getRedis } from "../db/redisContext";
import { demoGuard } from "./demoGuard";

const POOR_TTL = 90; // seconds — auto-reverts so a public page never gets stuck
const DEFAULTS = "payment_defaults";

/** Is this node currently flagged insolvent (can't pay)? */
export async function isPoor(node: string): Promise<boolean> {
	const redis = getRedis();
	return !!(await redis.get(`demo:poor:${node}`));
}

async function recordDefault(node: string, reason: string): Promise<void> {
	const redis = getRedis();
	await redis.lpush(DEFAULTS, JSON.stringify({ node, reason, ts: Date.now() }));
	await redis.ltrim(DEFAULTS, 0, 49);
	await redis.incr(`defaults:${node}`);
}

/**
 * POST /api/v1/demo/insolvent { node? } — public, auto-reverting: mark a node
 * insolvent so its settlements are rejected, and record one default immediately
 * (instant dashboard feedback). Defaults to a non-provider node, round-robin.
 */
export async function demoInsolventHandler(c: Context): Promise<Response> {
	const throttled = await demoGuard(c, "insolvent", 15, 30);
	if (throttled) return throttled;
	const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const redis = getRedis();
	const models = getModels();
	let node = String(b.node || "");
	if (node) {
		// Validate a caller-supplied node against known routers so arbitrary
		// strings can't be written as demo:poor:* keys.
		const known = await models.routers.findOne({ where: { name: node } });
		if (!known) return c.json({ ok: false, reason: "unknown node" });
	} else {
		const provider = await models.routers.findOne({
			where: { asn: config.arc.slaProviderAsn },
		});
		const providerName = (provider?.get("name") as string) || "hk";
		const peers = (await models.routers.findAll())
			.map((r) => r.get("name") as string)
			.filter((n) => n && n !== providerName);
		if (!peers.length) return c.json({ ok: false, reason: "no nodes" });
		const rr = Number(await redis.incr("demo:poor_rr")) - 1;
		node = peers[rr % peers.length] as string;
	}
	await redis.set(`demo:poor:${node}`, "1");
	await redis.expire(`demo:poor:${node}`, POOR_TTL);
	await recordDefault(node, "insufficient balance — couldn't pay net settlement");
	return c.json({ ok: true, node, ttl: POOR_TTL });
}

/** Payment-integrity summary for the dashboard. */
export async function insolvencySummary(): Promise<{
	defaults: Array<Record<string, unknown>>;
	counts: Record<string, number>;
	poor: string[];
}> {
	const redis = getRedis();
	const models = getModels();
	const raw = await redis.lrange(DEFAULTS, 0, 19);
	const defaults = raw
		.map((s) => {
			try {
				return JSON.parse(s);
			} catch {
				return null;
			}
		})
		.filter((x): x is Record<string, unknown> => !!x);
	const counts: Record<string, number> = {};
	const poor: string[] = [];
	for (const r of await models.routers.findAll()) {
		const name = r.get("name") as string;
		const cnt = await redis.get(`defaults:${name}`);
		if (cnt) counts[name] = Number(cnt);
		if (await redis.get(`demo:poor:${name}`)) poor.push(name);
	}
	return { defaults, counts, poor };
}
