/**
 * Offline decision demo — no servers, no testnet required.
 *
 * Feeds a mock candidate set (the LAX node's view of the other three, with
 * geography-accurate RTTs) through the brain's decide(). With meridian
 * unreachable it falls back to the deterministic rules; with meridian up
 * (BRAIN_MODEL via CP) it uses Claude. Either way it prints the chosen peers
 * and the reasoning.
 *
 *   bun run packages/brain/scripts/demo-decide.ts
 *   BRAIN_LLM_ENABLED=false bun run packages/brain/scripts/demo-decide.ts   # force rules
 */

import config from "../src/config";
import { decide } from "../src/decide/llm";
import type { Candidate, DecisionContext } from "../src/types";

function cand(
	name: string,
	regionCode: number,
	sameRegion: boolean,
	rttMs: number,
	available: number,
): Candidate {
	return {
		uuid: `${name}-uuid`,
		name,
		regionCode,
		sameRegion,
		payable: true,
		payTo: `0x${name}`,
		priceUsd: 0.001,
		latency: { rtt_ms: rttMs, loss: 0 },
		hopCount: null,
		capacity: { max: 20, used: 20 - available, available },
		endpoint: { ipv4: null, ipv6: null },
		wgPublicKey: null,
	};
}

// LAX's vantage point: LAS is very close (same region); FRA/BERN far and
// near-tied with each other (150 vs 155ms) — the "ping 差不多" case.
const candidates: Candidate[] = [
	cand("las", 203, true, 8.2, 17),
	cand("fra", 302, false, 150.4, 12),
	cand("bern", 302, false, 155.1, 20),
];

const ctx: DecisionContext = {
	self: { uuid: "lax-uuid", name: "lax", regionCode: 203 },
	budgetRemainingUsd: config.budgetUsd,
	policy: config.policy,
	candidates,
};

console.log("=== LAX brain — candidates ===");
for (const c of candidates) {
	console.log(
		`  ${c.name.padEnd(5)} region ${c.regionCode}  ${c.latency?.rtt_ms}ms  ` +
			`cap ${c.capacity.available}  $${c.priceUsd}`,
	);
}

const { decisions, source } = await decide(ctx);

console.log(`\n=== decision (source: ${source}) ===`);
if (decisions.length === 0) {
	console.log("  (no peers chosen)");
}
for (const d of decisions) {
	console.log(`  → ${d.peerName}: pay $${d.payUsd} — ${d.reason}`);
}
