import type { Context } from "hono";
import { getModels } from "../db/dbContext";
import { PeeringStatus } from "../db/models/bgpSessions";
import { getRedis } from "../db/redisContext";
import { rerunStatus } from "./demoRerun";
import { slaSummary } from "./sla";

/**
 * Public, read-only network state for the live dashboard (tessera.moenet.work).
 *
 * Exposes only public network facts (node identities, peering pairs, negotiated
 * prices, settlement ids, BGP status) — never wallets' private keys or JWTs.
 */
export default async function networkHandler(c: Context): Promise<Response> {
	const models = getModels();

	const routers = await models.routers.findAll();
	const now = Date.now();

	// Per-node live traffic (up/down bytes/s + load), if reported.
	let traffic: Record<string, Record<string, string>> = {};
	try {
		const redis = getRedis();
		const entries = await Promise.all(
			routers.map(async (r: { get: (k?: string) => unknown }) => {
				const name = r.get("name") as string;
				return [name, await redis.hgetall(`traffic:${name}`)] as const;
			}),
		);
		traffic = Object.fromEntries(entries);
	} catch {
		/* redis optional */
	}

	const nodes = routers.map((r: { get: (k?: string) => unknown }) => {
		const lastSeen = r.get("lastSeen") as Date | null;
		const name = r.get("name") as string;
		const t = traffic[name] ?? {};
		return {
			name,
			asn: r.get("asn") != null ? Number(r.get("asn")) : null,
			regionCode: (r.get("regionCode") as number) ?? null,
			location: (r.get("location") as string) ?? null,
			publicIp: (r.get("publicIp") as string) ?? null,
			nodeId: (r.get("nodeId") as number) ?? null,
			online: lastSeen ? now - new Date(lastSeen).getTime() < 180_000 : false,
			hasWg: !!r.get("wgPublicKey"),
			walletAddress: (r.get("walletAddress") as string) ?? null,
			upBps: Number(t.upBps) || 0,
			downBps: Number(t.downBps) || 0,
			load: t.load || null,
		};
	});
	const nameByUuid = new Map(
		routers.map((r: { get: (k?: string) => unknown }) => [
			r.get("uuid") as string,
			r.get("name") as string,
		]),
	);
	const asnToName = new Map(
		routers
			.filter((r: { get: (k?: string) => unknown }) => r.get("asn") != null)
			.map((r: { get: (k?: string) => unknown }) => [
				Number(r.get("asn")),
				r.get("name") as string,
			]),
	);

	const sessions = await models.bgpSessions.findAll();
	let totalPaid = 0;
	const peerings = sessions.map((s: { get: (k?: string) => unknown }) => {
		const status = s.get("status") as PeeringStatus;
		let payment: { amountUsdc?: string; tx?: string; payer?: string } = {};
		const data = s.get("data") as string | null;
		if (data) {
			try {
				payment = JSON.parse(data).payment ?? {};
			} catch {
				/* ignore */
			}
		}
		const amt = payment.amountUsdc ? Number(payment.amountUsdc) : 0;
		totalPaid += amt;
		const peerAsn = Number(s.get("asn"));
		return {
			onNode: nameByUuid.get(s.get("router") as string) ?? null,
			peerName: asnToName.get(peerAsn) ?? null,
			peerAsn,
			status,
			statusLabel:
				status === PeeringStatus.ENABLED
					? "established"
					: status === PeeringStatus.QUEUED_FOR_SETUP
						? "building"
						: status === PeeringStatus.PROBLEM
							? "converging"
							: String(status),
			priceUsd: amt,
			settlement: payment.tx ?? null,
			payer: payment.payer ?? null,
		};
	});

	const establishedRows = peerings.filter(
		(p) => p.status === PeeringStatus.ENABLED,
	).length;

	// M2b-3 usage-based net settlements (most recent first), from Redis.
	let usageSettlements: Array<Record<string, unknown>> = [];
	let usageSettledUsd = 0;
	try {
		const redis = getRedis();
		const raw = await redis.lrange("usage_settlements", 0, 49);
		usageSettlements = raw
			.map((s) => {
				try {
					return JSON.parse(s);
				} catch {
					return null;
				}
			})
			.filter((x): x is Record<string, unknown> => !!x);
		for (const r of usageSettlements) {
			usageSettledUsd += Number(r.amountUsd) || 0;
		}
	} catch {
		/* redis optional */
	}
	const usageCrossAttested = usageSettlements.filter(
		(r) => r.crossAttested,
	).length;
	const usageFlagged = usageSettlements.filter(
		(r) => Array.isArray(r.flags) && r.flags.length > 0,
	).length;

	// Prefer monotonic cumulative totals (the rolling-window sum plateaus once
	// the list is capped, so the displayed total stops moving).
	let usageCount = usageSettlements.length;
	try {
		const redis = getRedis();
		const tot = await redis.get("usage_settled_total");
		if (tot != null) usageSettledUsd = Number(tot);
		const cnt = await redis.get("usage_settled_count");
		if (cnt != null) usageCount = Number(cnt);
	} catch {
		/* redis optional */
	}

	// Recent agent-to-agent negotiations (offer/counter/accept + reasoning).
	let negotiations: Array<Record<string, unknown>> = [];
	try {
		const redis = getRedis();
		const raw = await redis.lrange("negotiations", 0, 29);
		negotiations = raw
			.map((s) => {
				try {
					return JSON.parse(s);
				} catch {
					return null;
				}
			})
			.filter((x): x is Record<string, unknown> => !!x);
	} catch {
		/* redis optional */
	}

	// Demo cheat status (auto-reverting) so the dashboard can show a banner.
	let demoCheat: { node: string; ttl: number } | null = null;
	try {
		const redis = getRedis();
		const ttl = await redis.ttl("demo:cheat:fra");
		if (ttl > 0) demoCheat = { node: "fra", ttl };
	} catch {
		/* redis optional */
	}

	// Route A — provider SLA + auto-compensation summary.
	let sla: Record<string, unknown> | null = null;
	try {
		sla = await slaSummary();
	} catch {
		/* redis optional */
	}

	// One-click reset & rerun status (for the "rebuilding from zero" banner).
	let rerun: { phase: string; ttl: number } | null = null;
	try {
		rerun = await rerunStatus();
	} catch {
		/* redis optional */
	}

	return c.json({
		updatedAt: new Date(now).toISOString(),
		stats: {
			nodes: nodes.length,
			nodesOnline: nodes.filter((n) => n.online).length,
			peeringSessions: peerings.length,
			established: establishedRows,
			establishedPairs: Math.floor(establishedRows / 2),
			totalSettlements: peerings.filter((p) => p.settlement).length,
			totalPaidUsd: Number(totalPaid.toFixed(6)),
			usageSettlementCount: usageCount,
			usageSettledUsd: Number(usageSettledUsd.toFixed(6)),
			usageCrossAttested,
			usageFlagged,
			chain: "Arc Testnet",
			explorer: "https://testnet.arcscan.app",
			gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
		},
		nodes,
		peerings,
		usageSettlements,
		negotiations,
		demoCheat,
		sla,
		rerun,
	});
}
