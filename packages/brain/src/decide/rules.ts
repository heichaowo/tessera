/**
 * Deterministic peering policy — also the fallback when the LLM is unavailable.
 *
 * Ranking: latency first; within a "near-tie" cluster (latencies within 20%),
 * break ties by hop count (if known) -> price -> free capacity -> same-region.
 * This encodes the operator intent: pick the closest node; when pings are
 * about equal, prefer the one with the shorter path / cheaper / more headroom.
 */

import type {
	Candidate,
	Decision,
	DecisionContext,
	RankedCandidate,
} from "../types";

const NEAR_TIE = 0.2; // within 20% latency counts as "ping 差不多"

function usable(c: Candidate): boolean {
	return c.payable && c.capacity.available > 0 && c.latency != null;
}

export function rankCandidates(ctx: DecisionContext): RankedCandidate[] {
	const sorted = ctx.candidates
		.filter(usable)
		.sort((a, b) => (a.latency?.rtt_ms ?? 0) - (b.latency?.rtt_ms ?? 0));

	// Cluster consecutive near-ties relative to each cluster's lowest latency.
	const clusters: Candidate[][] = [];
	for (const c of sorted) {
		const cluster = clusters.at(-1);
		const base = cluster?.[0]?.latency?.rtt_ms;
		const lat = c.latency?.rtt_ms ?? 0;
		if (cluster && base != null && lat - base <= base * NEAR_TIE) {
			cluster.push(c);
		} else {
			clusters.push([c]);
		}
	}

	const tiebreak = (a: Candidate, b: Candidate): number => {
		if (a.hopCount != null && b.hopCount != null && a.hopCount !== b.hopCount)
			return a.hopCount - b.hopCount;
		if (a.priceUsd !== b.priceUsd) return a.priceUsd - b.priceUsd;
		if (a.capacity.available !== b.capacity.available)
			return b.capacity.available - a.capacity.available;
		if (a.sameRegion !== b.sameRegion) return a.sameRegion ? -1 : 1;
		return (a.latency?.rtt_ms ?? 0) - (b.latency?.rtt_ms ?? 0);
	};

	const ordered = clusters.flatMap((cl) => cl.sort(tiebreak));
	return ordered.map((c, i) => ({ ...c, rank: i + 1 }));
}

/** Pick one peer per region (resilience), greedily, within budget. */
export function decideByRules(ctx: DecisionContext): Decision[] {
	const ranked = rankCandidates(ctx);
	const decisions: Decision[] = [];
	const regionsTaken = new Set<number>();
	let budget = ctx.budgetRemainingUsd;

	for (const c of ranked) {
		if (regionsTaken.has(c.regionCode)) continue;
		if (c.priceUsd > budget) continue;
		decisions.push({
			peerUuid: c.uuid,
			peerName: c.name,
			payUsd: c.priceUsd,
			reason: ruleReason(c, ranked),
		});
		regionsTaken.add(c.regionCode);
		budget -= c.priceUsd;
	}
	return decisions;
}

function ruleReason(c: RankedCandidate, ranked: RankedCandidate[]): string {
	const lat = (c.latency?.rtt_ms ?? 0).toFixed(1);
	if (c.rank === 1) return `lowest latency (${lat}ms)`;
	const rival = ranked.find(
		(r) => r.regionCode === c.regionCode && r.uuid !== c.uuid,
	);
	if (rival) {
		const why =
			c.capacity.available !== rival.capacity.available
				? `more capacity (${c.capacity.available} vs ${rival.capacity.available})`
				: c.priceUsd !== rival.priceUsd
					? "lower price"
					: "shorter path";
		return `best in region ${c.regionCode} (${lat}ms); chosen over ${rival.name} on ${why}`;
	}
	return `region ${c.regionCode} pick (${lat}ms)`;
}
