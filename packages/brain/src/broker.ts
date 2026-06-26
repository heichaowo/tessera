/**
 * Negotiation broker — runs the two-sided, agent-to-agent price negotiation
 * that sits between a buyer's peering decision and the actual x402 payment.
 *
 * Buyer A opens below the list price; provider B's brain (negotiate()) accepts,
 * counters, or rejects based on its capacity, price band, and its reputation of
 * A. Repeat, well-behaved customers earn prices nearer the floor; unknowns pay
 * closer to list; bad-history requesters are refused. The agreed price is what
 * gets settled on-chain.
 */

import { mkdirSync } from "node:fs";
import config from "./config";
import { negotiate } from "./decide/negotiate";
import { ReputationStore } from "./reputation";

export interface DealResult {
	agreed: boolean;
	priceUsd: number;
	source: "llm" | "rules";
	log: string;
	// structured detail for the live negotiation panel
	requester: string;
	provider: string;
	listUsd: number;
	offerUsd: number;
	decision: "accept" | "counter" | "reject";
	reason: string;
	requesterScore: number;
}

function round6(n: number): number {
	return Math.round(n * 1e6) / 1e6;
}

export class NegotiationBroker {
	// provider node name -> that provider's memory of requesters
	private readonly providerRep = new Map<string, ReputationStore>();

	constructor(private readonly dir: string = config.reputationDir) {
		try {
			mkdirSync(this.dir, { recursive: true });
		} catch {
			/* best effort */
		}
	}

	private rep(node: string): ReputationStore {
		let r = this.providerRep.get(node);
		if (!r) {
			r = new ReputationStore(`${this.dir}/provider-${node}.json`);
			this.providerRep.set(node, r);
		}
		return r;
	}

	/** Buyer `requester` negotiates a peering price with provider `provider`. */
	async negotiateDeal(opts: {
		requester: string;
		provider: string;
		listUsd: number;
		available?: number;
		premium?: boolean;
	}): Promise<DealResult> {
		const rep = this.rep(opts.provider);
		const requesterScore = rep.score(opts.provider, opts.requester);
		const offerUsd = round6(opts.listUsd * config.openOfferFactor);

		const { result, source } = await negotiate({
			fromAgent: opts.requester,
			toNode: opts.provider,
			offerUsd,
			requesterScore,
			hasCapacity: (opts.available ?? 1) > 0,
			premium: opts.premium,
		});

		// Buyer accepts an accept, or a counter at or below the list price.
		let agreed = false;
		let priceUsd = opts.listUsd;
		if (result.decision === "accept") {
			agreed = true;
			priceUsd = result.priceUsd;
		} else if (result.decision === "counter" && result.priceUsd <= opts.listUsd) {
			agreed = true;
			priceUsd = result.priceUsd;
		}

		// Provider remembers the interaction — a closed deal is a good customer,
		// building trust (and a better price) for next time.
		rep.record(opts.provider, opts.requester, {
			outcome: agreed ? "ok" : "failed",
		});

		const verdict = agreed ? `deal $${priceUsd}` : "no deal";
		const log =
			`${opts.requester}→${opts.provider}: offer $${offerUsd} ` +
			`(rep ${requesterScore.toFixed(2)}) → ${result.decision} $${result.priceUsd} ` +
			`[${source}] ⇒ ${verdict} — ${result.reason}`;

		return {
			agreed,
			priceUsd: round6(priceUsd),
			source,
			log,
			requester: opts.requester,
			provider: opts.provider,
			listUsd: opts.listUsd,
			offerUsd,
			decision: result.decision,
			reason: result.reason,
			requesterScore: round6(requesterScore),
		};
	}
}
