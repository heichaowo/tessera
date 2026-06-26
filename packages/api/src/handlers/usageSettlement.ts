import type { Context } from "hono";
import { timingSafeCompare } from "../common/helpers";
import config from "../config";
import { getModels } from "../db/dbContext";
import { getRedis } from "../db/redisContext";
import { requireGatewayPayment } from "../services/x402";

function authed(c: Context): boolean {
	const token = c.req.header("Authorization")?.split("Bearer ")[1];
	return (
		!!token &&
		!!config.auth.agentApiKey &&
		timingSafeCompare(token, config.auth.agentApiKey)
	);
}

// Public, narrow, auto-reverting demo control: makes ONE node (fra) over-report
// its sent bytes by a fixed factor so the live dashboard can show bilateral
// cross-attestation catching the discrepancy. Can do nothing else; expires on
// its own so a public page never gets stuck cheating.
const CHEAT_NODE = "fra";
const CHEAT_FACTOR = 3;
const CHEAT_TTL = 90;

// Attach an on-chain Memo tx hash to a settlement record (called by the brain
// after it emits the Arc Memo). Lets the dashboard link the real /tx/ audit record.
export async function usageMemoHandler(c: Context): Promise<Response> {
	if (!authed(c)) return c.json({ code: 401, message: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const settlementId = String(body.settlementId || "");
	const memoTx = String(body.memoTx || "");
	const memo = String(body.memo || "");
	if (!settlementId || !memoTx) {
		return c.json({ ok: false, reason: "settlementId + memoTx required" });
	}
	const redis = getRedis();
	const list = await redis.lrange("usage_settlements", 0, 199);
	for (let i = 0; i < list.length; i++) {
		try {
			const r = JSON.parse(list[i] as string);
			if (r.tx === settlementId) {
				r.memoTx = memoTx;
				r.memo = memo;
				await redis.lset("usage_settlements", i, JSON.stringify(r));
				return c.json({ ok: true });
			}
		} catch {
			/* skip */
		}
	}
	return c.json({ ok: false, reason: "settlement not found" });
}

// Record an agent-to-agent negotiation (offer/counter/accept + reasoning) for
// the live "Negotiation" panel. Called by the brain each display round.
export async function negotiationHandler(c: Context): Promise<Response> {
	if (!authed(c)) return c.json({ code: 401, message: "Unauthorized" }, 401);
	const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	if (!b.requester || !b.provider) {
		return c.json({ ok: false, reason: "requester + provider required" });
	}
	const redis = getRedis();
	await redis.lpush("negotiations", JSON.stringify({ ts: Date.now(), ...b }));
	await redis.ltrim("negotiations", 0, 49);
	return c.json({ ok: true });
}

// Public demo reset: re-baseline all settled snapshots to current counters and
// clear the settlement display (on-chain memos persist). Cleans up after the
// cheat demo, whose ×3→×1 transition otherwise looks like a counter reset.
export async function demoResetHandler(c: Context): Promise<Response> {
	const redis = getRedis();
	const keys = await redis.keys("tunnel:*");
	let n = 0;
	const now = Date.now();
	for (const k of keys) {
		const h = await redis.hgetall(k);
		if (!h.tx) continue;
		await redis.hset(`settled:${k.slice("tunnel:".length)}`, {
			tx: h.tx,
			rx: h.rx,
			ts: now,
		});
		n++;
	}
	await redis.del("usage_settlements", "usage_flags", "demo:cheat:fra");
	return c.json({ ok: true, rebaselined: n });
}

export async function demoCheatHandler(c: Context): Promise<Response> {
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const redis = getRedis();
	const key = `demo:cheat:${CHEAT_NODE}`;
	if (body.on === false) {
		await redis.del(key);
		return c.json({ active: false, node: CHEAT_NODE });
	}
	await redis.set(key, String(CHEAT_FACTOR));
	await redis.expire(key, CHEAT_TTL);
	return c.json({
		active: true,
		node: CHEAT_NODE,
		factor: CHEAT_FACTOR,
		ttl: CHEAT_TTL,
	});
}

/**
 * GET /api/v1/usage/:node — the node's per-tunnel usage (for the brain to know
 * which peers to settle, and for the dashboard).
 */
export async function usageListHandler(c: Context): Promise<Response> {
	const node = c.req.param("node");
	const redis = getRedis();
	const models = getModels();
	const keys = await redis.keys(`tunnel:${node}:*`);
	const asnToName = new Map<number, string>();
	for (const r of await models.routers.findAll()) {
		const asn = r.get("asn");
		if (asn != null) asnToName.set(Number(asn), r.get("name") as string);
	}
	const tunnels = [] as Array<Record<string, unknown>>;
	for (const k of keys) {
		const h = await redis.hgetall(k);
		const peerAsn = Number(h.peerAsn) || Number(k.split(":")[2]) || 0;
		tunnels.push({
			peerAsn,
			peerName: asnToName.get(peerAsn) ?? null,
			tx: Number(h.tx) || 0,
			rx: Number(h.rx) || 0,
			txBps: Number(h.txBps) || 0,
			rxBps: Number(h.rxBps) || 0,
		});
	}
	return c.json({ node, tunnels });
}

/**
 * POST /api/v1/usage-settlement — M2b-3 usage-based net settlement (x402-gated).
 *
 * A node's brain calls this for each peering tunnel. The core nets the node's
 * per-tunnel cumulative tx/rx (metered from /sys/class/net/dn42_*) against the
 * last-settled snapshot. If the node is the NET RECEIVER (received more than it
 * sent since last settlement), it is challenged to pay the net imbalance
 * (bytes x price/GB) to the peer's wallet via Circle Gateway. Net senders get
 * {settled:false}, so each link is settled once per window by exactly one side.
 */
export default async function usageSettlementHandler(
	c: Context,
): Promise<Response> {
	if (!authed(c)) return c.json({ code: 401, message: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const node = String(body.node || "");
	const peerAsn = Number(body.peerAsn || 0);
	if (!node || !peerAsn) {
		return c.json({ code: 400, message: "node and peerAsn required" }, 400);
	}

	const redis = getRedis();
	const models = getModels();
	const peer = await models.routers.findOne({ where: { asn: peerAsn } });
	if (!peer) return c.json({ settled: false, reason: "unknown peer asn" });
	const peerName = peer.get("name") as string;
	const peerWallet = peer.get("walletAddress") as string | null;
	if (!peerWallet) {
		return c.json({ settled: false, reason: "peer has no wallet" });
	}
	const self = await models.routers.findOne({ where: { name: node } });
	const nodeAsn = self ? Number(self.get("asn")) : 0;

	// Traffic is live, so the net changes between the 402 challenge and the
	// signed retry. We FREEZE the challenged amount + both sides' cumulative
	// snapshots in `pending:` at challenge time and reuse them on the signed
	// retry, so the settled amount matches what the EIP-3009 sig authorized.
	const hasSig = !!c.req.header("PAYMENT-SIGNATURE");
	const pendKey = `pending:${node}:${peerAsn}`;
	let amountUsd: number;
	let netBytes: number;
	// frozen cumulative values to advance both snapshots on settle
	let fz: { aTx: number; aRx: number; bTx: number; bRx: number };
	let flags: string[] = [];
	// transparent per-direction cross-check (sender's claim vs receiver's claim)
	let detail: Record<string, unknown> = {};

	if (hasSig) {
		const pend = await redis.hgetall(pendKey);
		if (!pend.amountUsd) {
			return c.json({ settled: false, reason: "challenge expired, retry" });
		}
		amountUsd = Number(pend.amountUsd);
		netBytes = Number(pend.netBytes) || 0;
		fz = {
			aTx: Number(pend.aTx) || 0,
			aRx: Number(pend.aRx) || 0,
			bTx: Number(pend.bTx) || 0,
			bRx: Number(pend.bRx) || 0,
		};
		flags = pend.flags ? String(pend.flags).split("|").filter(Boolean) : [];
		detail = pend.detail ? JSON.parse(pend.detail) : {};
	} else {
		// A = node (potential payer), B = peer. Each end self-reports its tunnel:
		//   A: tx = A→B sent,   rx = B→A received
		//   B: tx = B→A sent,   rx = A→B received
		const aCur = await redis.hgetall(`tunnel:${node}:${peerAsn}`);
		if (!aCur.tx) return c.json({ settled: false, reason: "no usage data" });
		const bCur = nodeAsn
			? await redis.hgetall(`tunnel:${peerName}:${nodeAsn}`)
			: {};
		const aSnap = await redis.hgetall(`settled:${node}:${peerAsn}`);
		const bSnap = nodeAsn
			? await redis.hgetall(`settled:${peerName}:${nodeAsn}`)
			: {};

		// delta with counter-reset detection (cur < snap => interface reset)
		const d = (cur?: string, snap?: string) => {
			const a = Number(cur) || 0;
			const b = Number(snap) || 0;
			return a >= b ? a - b : a;
		};
		const aTxD = d(aCur.tx, aSnap.tx); // A→B per A
		const aRxD = d(aCur.rx, aSnap.rx); // B→A per A
		const bTxD = d(bCur.tx, bSnap.tx); // B→A per B
		const bRxD = d(bCur.rx, bSnap.rx); // A→B per B

		// Bilateral cross-attestation: settle on min(sender's tx, receiver's rx)
		// per direction — conservative "delivered" bytes that both ends corroborate
		// (a payee can't inflate; loss is billed to no one). Falls back to
		// single-sided if the peer hasn't reported.
		const haveBoth = !!bCur.tx;
		const AtoB = haveBoth ? Math.min(aTxD, bRxD) : aTxD;
		const BtoA = haveBoth ? Math.min(bTxD, aRxD) : aRxD;
		netBytes = BtoA - AtoB; // > 0 => A received more => A pays

		// Discrepancy detection (only when both report). received > sent is
		// physically impossible; a large gap = loss or under-reporting.
		if (haveBoth) {
			const band = (sender: number) =>
				Math.max(
					config.arc.usageDiscrepancyMinBytes,
					sender * config.arc.usageLossBandPct,
				);
			if (bRxD > aTxD + band(aTxD)) flags.push("AtoB:recv>sent");
			else if (aTxD - bRxD > band(aTxD)) flags.push("AtoB:gap");
			if (aRxD > bTxD + band(bTxD)) flags.push("BtoA:recv>sent");
			else if (bTxD - aRxD > band(bTxD)) flags.push("BtoA:gap");
		}

		// Transparent cross-check: each direction's sender-claim vs receiver-claim,
		// the conservative delivered (min) used for billing, and the gap.
		detail = {
			haveBoth,
			ab: {
				from: node,
				to: peerName,
				sent: aTxD,
				recv: bRxD,
				delivered: AtoB,
				gap: aTxD - bRxD,
			},
			ba: {
				from: peerName,
				to: node,
				sent: bTxD,
				recv: aRxD,
				delivered: BtoA,
				gap: bTxD - aRxD,
			},
		};

		if (netBytes <= 0) {
			return c.json({
				settled: false,
				reason: "balanced or net sender",
				netBytes,
				crossAttested: haveBoth,
			});
		}
		amountUsd = (netBytes / 1e9) * config.arc.usagePricePerGbUsd;
		if (amountUsd < config.arc.usageMinSettleUsd) {
			return c.json({ settled: false, reason: "below min", amountUsd, netBytes });
		}
		fz = {
			aTx: Number(aCur.tx) || 0,
			aRx: Number(aCur.rx) || 0,
			bTx: Number(bCur.tx) || 0,
			bRx: Number(bCur.rx) || 0,
		};
		await redis.hset(pendKey, {
			amountUsd,
			netBytes,
			aTx: fz.aTx,
			aRx: fz.aRx,
			bTx: fz.bTx,
			bRx: fz.bRx,
			flags: flags.join("|"),
			detail: JSON.stringify(detail),
		});
		await redis.expire(pendKey, 120);
	}

	const pay = await requireGatewayPayment(c, {
		price: `$${amountUsd.toFixed(6)}`,
		payTo: peerWallet,
		resource: `usage:${node}->${peerName}`,
	});
	if (!pay.paid) return pay.response;

	// Settled — advance BOTH sides' snapshots so neither re-settles this window.
	const now = Date.now();
	await redis.hset(`settled:${node}:${peerAsn}`, {
		tx: fz.aTx,
		rx: fz.aRx,
		ts: now,
	});
	if (nodeAsn && fz.bTx) {
		await redis.hset(`settled:${peerName}:${nodeAsn}`, {
			tx: fz.bTx,
			rx: fz.bRx,
			ts: now,
		});
	}
	await redis.del(pendKey);

	const record = {
		ts: now,
		payer: node,
		payee: peerName,
		payerWallet: (self?.get("walletAddress") as string) || pay.payer,
		payeeWallet: peerWallet,
		netBytes,
		amountUsd: Number(amountUsd.toFixed(6)),
		tx: pay.tx,
		crossAttested: !!fz.bTx,
		flags,
		detail,
	};
	await redis.lpush("usage_settlements", JSON.stringify(record));
	await redis.ltrim("usage_settlements", 0, 199);
	if (flags.length) {
		await redis.lpush(
			"usage_flags",
			JSON.stringify({ ts: now, pair: `${node}~${peerName}`, payer: node, flags, netBytes }),
		);
		await redis.ltrim("usage_flags", 0, 99);
		for (const f of flags) await redis.hincrby(`discrepancy:${node}:${peerAsn}`, f, 1);
	}

	return c.json({ settled: true, ...record });
}
