/** Shared types for the autonomous peering brain. */

export interface Latency {
	rtt_ms: number;
	loss: number;
}

export interface Capacity {
	max: number;
	used: number;
	available: number;
}

/** A peering target as seen from one node's vantage point. */
export interface Candidate {
	uuid: string;
	name: string;
	regionCode: number;
	sameRegion: boolean;
	payable: boolean;
	payTo: string | null;
	priceUsd: number;
	latency: Latency | null; // this node's own probe to the candidate
	hopCount?: number | null; // AS-path / traceroute hops (future signal)
	capacity: Capacity;
	endpoint: { ipv4: string | null; ipv6: string | null };
	wgPublicKey: string | null;
}

export interface DecisionContext {
	self: { uuid: string; name: string; regionCode: number };
	budgetRemainingUsd: number;
	policy: string;
	candidates: Candidate[];
}

export interface Decision {
	peerUuid: string;
	peerName: string;
	payUsd: number;
	reason: string;
}

export interface RankedCandidate extends Candidate {
	rank: number;
}

/** One autonomous agent: a node identity with its own wallet, budget and auth. */
export interface AgentIdentity {
	name: string;
	nodeName: string; // router name registered in core
	privateKey: `0x${string}`; // node's EOA wallet (payer)
	jwt: string; // bearer token for core's session API
	budgetUsd: number;
}
