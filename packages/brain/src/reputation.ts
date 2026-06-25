/**
 * Peer reputation memory — what each agent has learned about its peers.
 *
 * Persisted to a JSON file so decisions improve across runs: agents remember
 * latency stability, flaps, and whether past peerings delivered, then feed a
 * composite score (0..1) back into ranking and negotiation. This is the
 * adaptive layer — the same node looks better or worse next round based on how
 * it actually behaved.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface PeerObservation {
	latencyMs?: number;
	flapped?: boolean;
	outcome?: "ok" | "degraded" | "failed";
}

export interface PeerRep {
	peer: string;
	sessions: number;
	ewmaLatencyMs: number | null;
	flaps: number;
	oks: number;
	fails: number;
	lastOutcome: "ok" | "degraded" | "failed" | "none";
}

const NEUTRAL = 0.5; // prior for an unknown peer
const EWMA_ALPHA = 0.3;

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

export class ReputationStore {
	// agent -> peer -> rep
	private data: Record<string, Record<string, PeerRep>> = {};

	constructor(private readonly file: string) {
		this.load();
	}

	private load(): void {
		if (!existsSync(this.file)) return;
		try {
			this.data = JSON.parse(readFileSync(this.file, "utf-8"));
		} catch {
			this.data = {};
		}
	}

	private save(): void {
		try {
			writeFileSync(this.file, JSON.stringify(this.data, null, 2));
		} catch {
			/* best-effort persistence */
		}
	}

	get(agent: string, peer: string): PeerRep | undefined {
		return this.data[agent]?.[peer];
	}

	/** Composite reputation score in [0,1]; neutral for unknown peers. */
	score(agent: string, peer: string): number {
		const r = this.get(agent, peer);
		if (!r || r.sessions === 0) return NEUTRAL;
		const total = r.oks + r.fails;
		const okRate = total > 0 ? r.oks / total : NEUTRAL;
		const flapPenalty = Math.min(1, r.flaps / 5);
		const recent = r.lastOutcome === "failed" ? 0 : r.lastOutcome === "degraded" ? 0.5 : 1;
		return clamp01(0.45 * okRate + 0.35 * (1 - flapPenalty) + 0.2 * recent);
	}

	/** Reputation map for a set of peers (peerName -> score), for ranking. */
	scores(agent: string, peers: string[]): Record<string, number> {
		const out: Record<string, number> = {};
		for (const p of peers) out[p] = this.score(agent, p);
		return out;
	}

	record(agent: string, peer: string, obs: PeerObservation): void {
		const byPeer = (this.data[agent] ??= {});
		const r: PeerRep = byPeer[peer] ?? {
			peer,
			sessions: 0,
			ewmaLatencyMs: null,
			flaps: 0,
			oks: 0,
			fails: 0,
			lastOutcome: "none",
		};

		r.sessions += 1;
		if (obs.latencyMs != null) {
			r.ewmaLatencyMs =
				r.ewmaLatencyMs == null
					? obs.latencyMs
					: EWMA_ALPHA * obs.latencyMs + (1 - EWMA_ALPHA) * r.ewmaLatencyMs;
		}
		if (obs.flapped) r.flaps += 1;
		if (obs.outcome) {
			r.lastOutcome = obs.outcome;
			if (obs.outcome === "ok") r.oks += 1;
			else if (obs.outcome === "failed") r.fails += 1;
		}

		byPeer[peer] = r;
		this.save();
	}
}
