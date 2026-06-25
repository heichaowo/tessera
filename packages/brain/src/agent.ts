/** One autonomous agent brain: discover -> decide -> negotiate -> pay -> peer. */

import type { NegotiationBroker } from "./broker";
import config from "./config";
import { discover } from "./coreClient";
import { decide } from "./decide/llm";
import { payAndPeer } from "./pay";
import type { AgentIdentity } from "./types";

export class AgentBrain {
	private spent = 0;

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
}
