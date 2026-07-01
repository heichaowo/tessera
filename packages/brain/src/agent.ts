/** One autonomous agent brain: discover -> decide -> negotiate -> pay -> peer. */

import type { DealResult, NegotiationBroker } from "./broker";
import config from "./config";
import { discover } from "./coreClient";
import { decide } from "./decide/llm";
import { payAndPeer } from "./pay";
import type { AgentIdentity } from "./types";

export class AgentBrain {
	private spent = 0;
	// ② display-negotiation throttle: peers already shown are skipped unless
	// they're this cycle's rotation pick, so the live feed stays genuine + cheap.
	private negoSeen = new Set<string>();
	private peerRot = 0;

	constructor(
		private readonly id: AgentIdentity,
		private readonly broker: NegotiationBroker,
	) {}

	async tick(): Promise<void> {
		const { self, candidates } = await discover(this.id.nodeName);
		const byName = new Map(candidates.map((c) => [c.name, c]));

		const { decisions, source } = await decide({
			self,
			budgetRemainingUsd: this.id.budgetUsd - this.spent,
			policy: config.policy,
			candidates,
		});

		console.log(
			`[${this.id.name}] ${decisions.length} target(s) via ${source} ` +
				`(budget left $${(this.id.budgetUsd - this.spent).toFixed(4)})`,
		);

		for (const d of decisions) {
			const cand = byName.get(d.peerName);

			// Two-sided negotiation before any payment.
			const deal = await this.broker.negotiateDeal({
				requester: this.id.name,
				provider: d.peerName,
				listUsd: d.payUsd,
				available: cand?.capacity.available ?? 1,
			});
			console.log(`  ⚖ ${deal.log}`);
			this.emitNegotiation(deal);

			if (!deal.agreed) continue;

			if (this.id.budgetUsd - this.spent < deal.priceUsd) {
				console.log(`    skip ${d.peerName}: over budget`);
				continue;
			}
			if (config.dryRun) {
				console.log(`    (dry-run: would pay $${deal.priceUsd})`);
				continue;
			}

			try {
				const r = await payAndPeer({
					privateKey: this.id.privateKey,
					jwt: this.id.jwt,
					routerUuid: d.peerUuid,
					agreedPriceUsd: deal.priceUsd,
				});
				this.spent += deal.priceUsd;
				console.log(`    paid $${deal.priceUsd} to ${d.peerName}; core HTTP ${r.status}`);
			} catch (err) {
				console.error(`    failed to peer ${d.peerName}: ${(err as Error).message}`);
			}
		}
	}

	/**
	 * Display-only round: discover -> decide -> negotiate (real Haiku reasoning)
	 * and surface it to the live dashboard, but never pay or establish. Safe to
	 * run repeatedly — powers the "live negotiation" panel and shows reputation
	 * drifting prices toward the floor across rounds.
	 */
	async negotiateRound(): Promise<void> {
		const { self, candidates } = await discover(this.id.nodeName);
		const byName = new Map(candidates.map((c) => [c.name, c]));
		const { decisions } = await decide({
			self,
			budgetRemainingUsd: this.id.budgetUsd,
			policy: config.policy,
			candidates,
		});
		// ② Only spend an LLM call on peers that are new or on this cycle's
		// rotation pick; stable, already-shown pairs are skipped — a real
		// negotiation trickles into the feed instead of re-running all pairs.
		const pick = decisions.length ? this.peerRot++ % decisions.length : 0;
		for (let i = 0; i < decisions.length; i++) {
			const d = decisions[i];
			if (this.negoSeen.has(d.peerName) && i !== pick) continue;
			this.negoSeen.add(d.peerName);
			const cand = byName.get(d.peerName);
			const deal = await this.broker.negotiateDeal({
				requester: this.id.name,
				provider: d.peerName,
				listUsd: d.payUsd,
				available: cand?.capacity.available ?? 1,
				model: config.meridian.displayModel, // display-only → lighter model
			});
			this.emitNegotiation(deal);
		}
	}

	private emitNegotiation(deal: DealResult): void {
		fetch(`${config.coreUrl}/api/v1/negotiation`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.agentApiKey}`,
			},
			body: JSON.stringify({
				requester: deal.requester,
				provider: deal.provider,
				listUsd: deal.listUsd,
				offerUsd: deal.offerUsd,
				decision: deal.decision,
				priceUsd: deal.priceUsd,
				agreed: deal.agreed,
				source: deal.source,
				model: deal.model,
				reason: deal.reason,
				score: deal.requesterScore,
			}),
		}).catch(() => {});
	}
}
