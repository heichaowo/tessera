/**
 * Route A — provider SLA + automatic nano-compensation.
 *
 * The large provider (HK) commits an availability SLA to every customer that
 * peers it. When a customer's peering to HK breaches (BGP session drops to
 * PROBLEM, or a demo trigger), the control plane accrues a USDC credit owed by
 * HK to that customer. HK's own agent (settleSla.ts) polls the unpaid credits,
 * pays each one on Arc, writes an on-chain Memo, and marks it settled. No claims
 * process, no human in the loop — the provider refunds itself when it breaches.
 */

import type { Context } from "hono";
import { timingSafeCompare } from "../common/helpers";
import config from "../config";
import { getModels } from "../db/dbContext";
import { getRedis } from "../db/redisContext";
import { demoGuard } from "./demoGuard";

const KEY = "sla:credits";

function authed(c: Context): boolean {
	const token = c.req.header("Authorization")?.split("Bearer ")[1];
	return (
		!!token &&
		!!config.auth.agentApiKey &&
		timingSafeCompare(token, config.auth.agentApiKey)
	);
}

interface SlaCredit {
	id: string;
	customer: string;
	customerWallet: string;
	providerAsn: number;
	amountUsd: number;
	reason: string;
	ts: number;
	paid: boolean;
	payTx: string | null;
	memoTx: string | null;
	paidTs?: number;
}

async function readCredits(): Promise<SlaCredit[]> {
	const redis = getRedis();
	const raw = await redis.lrange(KEY, 0, 199);
	return raw
		.map((s) => {
			try {
				return JSON.parse(s) as SlaCredit;
			} catch {
				return null;
			}
		})
		.filter((x): x is SlaCredit => !!x);
}

/**
 * Accrue one SLA breach credit owed by the provider to `customerName`.
 * Called from the demo trigger and from the agent status path on a real drop.
 * Returns null if the customer is unknown.
 */
export async function accrueSlaBreach(
	customerName: string,
	reason: string,
): Promise<SlaCredit | null> {
	const models = getModels();
	const redis = getRedis();
	const cust = await models.routers.findOne({ where: { name: customerName } });
	if (!cust) return null;
	const rec: SlaCredit = {
		id: `${Date.now()}-${customerName}`,
		customer: customerName,
		customerWallet: (cust.get("walletAddress") as string) || "",
		providerAsn: config.arc.slaProviderAsn,
		amountUsd: config.arc.slaCreditUsd,
		reason,
		ts: Date.now(),
		paid: false,
		payTx: null,
		memoTx: null,
	};
	await redis.lpush(KEY, JSON.stringify(rec));
	await redis.ltrim(KEY, 0, 199);
	return rec;
}

/** GET /api/v1/sla/pending — unpaid credits (the provider's agent polls this). */
export async function slaPendingHandler(c: Context): Promise<Response> {
	if (!authed(c)) return c.json({ code: 401, message: "Unauthorized" }, 401);
	const credits = (await readCredits()).filter(
		(r) => !r.paid && r.customerWallet,
	);
	return c.json({ credits });
}

/** POST /api/v1/sla/paid { id, payTx, memoTx } — mark a credit settled. */
export async function slaPaidHandler(c: Context): Promise<Response> {
	if (!authed(c)) return c.json({ code: 401, message: "Unauthorized" }, 401);
	const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const id = String(b.id || "");
	if (!id) return c.json({ ok: false, reason: "id required" });
	const redis = getRedis();
	const raw = await redis.lrange(KEY, 0, 199);
	for (let i = 0; i < raw.length; i++) {
		try {
			const r = JSON.parse(raw[i]) as SlaCredit;
			if (r.id === id && !r.paid) {
				r.paid = true;
				r.payTx = (b.payTx as string) ?? null;
				r.memoTx = (b.memoTx as string) ?? null;
				r.paidTs = Date.now();
				await redis.lset(KEY, i, JSON.stringify(r));
				await redis.incrbyfloat("sla:credited_total", Number(r.amountUsd) || 0);
				await redis.incr("sla:credited_count");
				return c.json({ ok: true });
			}
		} catch {
			/* skip */
		}
	}
	return c.json({ ok: false, reason: "not found" });
}

/**
 * POST /api/v1/demo/sla-breach { customer? } — public, controllable demo:
 * inject one SLA breach so the dashboard can show HK auto-refunding. If no
 * customer is given, round-robins across HK's peers.
 */
export async function demoSlaBreachHandler(c: Context): Promise<Response> {
	const throttled = await demoGuard(c, "sla", 30, 60);
	if (throttled) return throttled;
	const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const models = getModels();
	const redis = getRedis();
	// Hourly cap on the real testnet USDC this button can drain (30 × $0.002).
	const hits = Number(await redis.incr("demo:sla:hour"));
	if (hits === 1) await redis.expire("demo:sla:hour", 3600);
	if (hits > 30)
		return c.json({ ok: false, reason: "hourly SLA-demo cap reached — resets within the hour" });
	let customer = String(b.customer || "");
	if (!customer) {
		const provider = await models.routers.findOne({
			where: { asn: config.arc.slaProviderAsn },
		});
		const providerName = (provider?.get("name") as string) || "hk";
		const peers = (await models.routers.findAll())
			.map((r) => r.get("name") as string)
			.filter((n) => n && n !== providerName);
		if (!peers.length) return c.json({ ok: false, reason: "no customers" });
		const rr = Number(await redis.incr("sla:demo_rr")) - 1;
		customer = peers[rr % peers.length] as string;
	}
	const rec = await accrueSlaBreach(
		customer,
		"availability SLA breach on HK link (RTT/flap)",
	);
	if (!rec) return c.json({ ok: false, reason: "unknown customer" });
	return c.json({ ok: true, breach: rec });
}

/** SLA summary for the public dashboard. */
export async function slaSummary(): Promise<Record<string, unknown>> {
	const redis = getRedis();
	const credits = await readCredits();
	let creditedUsd = 0;
	const t = await redis.get("sla:credited_total");
	if (t != null) creditedUsd = Number(t);
	let creditedCount = 0;
	const cc = await redis.get("sla:credited_count");
	if (cc != null) creditedCount = Number(cc);
	return {
		providerAsn: config.arc.slaProviderAsn,
		creditUsd: config.arc.slaCreditUsd,
		pending: credits.filter((r) => !r.paid).length,
		creditedUsd: Number(creditedUsd.toFixed(6)),
		creditedCount,
		recent: credits.slice(0, 12),
	};
}
