/**
 * Offline demo — two-sided negotiation + reputation memory. No servers/testnet.
 *
 * Shows the agentic layer that earns the "autonomous decision" score:
 *  - a buyer ranks peers (reputation-aware) and makes an offer
 *  - the provider negotiates accept / counter / reject from its price band,
 *    giving trusted requesters a better price
 *  - after a bad experience, the buyer's reputation memory drops that peer
 *    below the floor and it re-routes next round (adaptation)
 *
 *   BRAIN_LLM_ENABLED=false bun run packages/brain/scripts/demo-negotiate.ts
 */

import { existsSync, rmSync } from "node:fs";
import config from "../src/config";
import { decide } from "../src/decide/llm";
import { negotiate } from "../src/decide/negotiate";
import { ReputationStore } from "../src/reputation";
import type { Candidate, DecisionContext } from "../src/types";

const LAX_REP = "/tmp/brain-rep-lax.json";
const BERN_REP = "/tmp/brain-rep-bern.json";
for (const f of [LAX_REP, BERN_REP]) if (existsSync(f)) rmSync(f);

const lax = new ReputationStore(LAX_REP); // LAX's memory of its peers
const bern = new ReputationStore(BERN_REP); // BERN's memory of requesters

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
		priceUsd: config.price.targetUsd,
		latency: { rtt_ms: rttMs, loss: 0 },
		hopCount: null,
		capacity: { max: 20, used: 20 - available, available },
		endpoint: { ipv4: null, ipv6: null },
		wgPublicKey: null,
	};
}

const candidates: Candidate[] = [
	cand("las", 203, true, 8.2, 17),
	cand("fra", 302, false, 150.4, 12),
	cand("bern", 302, false, 155.1, 20),
];
const names = candidates.map((c) => c.name);

function ctx(): DecisionContext {
	return {
		self: { uuid: "lax-uuid", name: "lax", regionCode: 203 },
		budgetRemainingUsd: config.budgetUsd,
		policy: config.policy,
		candidates,
		reputation: lax.scores("lax", names),
	};
}

const show = (label: string, ds: { peerName: string; payUsd: number; reason: string }[]) => {
	console.log(label);
	for (const d of ds) console.log(`   → ${d.peerName}: $${d.payUsd} — ${d.reason}`);
};

// ── Round 1 ────────────────────────────────────────────────────────────────
console.log("══ ROUND 1 — first contact (everyone neutral) ══");
const r1 = await decide(ctx());
show(`LAX ranks peers (reputation neutral):`, r1.decisions);

console.log(`\nLAX negotiates with BERN (offers below list to bargain):`);
const offer1 = {
	fromAgent: "lax",
	toNode: "bern",
	offerUsd: 0.0008,
	requesterScore: bern.score("bern", "lax"),
	hasCapacity: true,
};
const n1 = await negotiate(offer1);
console.log(
	`   BERN(rep of lax=${offer1.requesterScore.toFixed(2)}): ${n1.result.decision} @ $${n1.result.priceUsd} — ${n1.result.reason}`,
);

// Experience: the BERN tunnel turns out flappy/degraded for LAX; meanwhile LAX
// behaved well as a customer, so BERN's opinion of LAX improves.
lax.record("lax", "bern", { latencyMs: 155, flapped: true, outcome: "degraded" });
lax.record("lax", "bern", { flapped: true, outcome: "failed" });
bern.record("bern", "lax", { outcome: "ok" });
bern.record("bern", "lax", { outcome: "ok" });

// ── Round 2 ────────────────────────────────────────────────────────────────
console.log("\n══ ROUND 2 — memory kicks in ══");
console.log(
	`LAX reputation now: bern=${lax.score("lax", "bern").toFixed(2)} (floor ${config.reputationFloor}), fra=${lax.score("lax", "fra").toFixed(2)}`,
);
const r2 = await decide(ctx());
show(`LAX re-ranks (bern dropped if below floor → re-routes to fra):`, r2.decisions);

console.log(`\nLAX negotiates with BERN again — but now a trusted customer:`);
const offer2 = {
	fromAgent: "lax",
	toNode: "bern",
	offerUsd: 0.0006,
	requesterScore: bern.score("bern", "lax"),
	hasCapacity: true,
};
const n2 = await negotiate(offer2);
console.log(
	`   BERN(rep of lax=${offer2.requesterScore.toFixed(2)}): ${n2.result.decision} @ $${n2.result.priceUsd} — ${n2.result.reason}`,
);
console.log(
	"\n(trusted requester gets a lower price accepted; flappy provider gets dropped)",
);
