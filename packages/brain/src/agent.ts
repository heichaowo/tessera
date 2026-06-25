/** One autonomous agent brain: discover -> decide -> pay -> peer. */

import { discover } from "./coreClient";
import config from "./config";
import { decide } from "./decide/llm";
import { payAndPeer } from "./pay";
import type { AgentIdentity } from "./types";

export class AgentBrain {
	private spent = 0;

	constructor(private readonly id: AgentIdentity) {}

	async tick(): Promise<void> {
		const { self, candidates } = await discover(this.id.nodeName);

		const { decisions, source } = await decide({
			self,
			budgetRemainingUsd: this.id.budgetUsd - this.spent,
			policy: config.policy,
			candidates,
		});

		console.log(
			`[${this.id.name}] ${decisions.length} decision(s) via ${source} ` +
				`(budget left $${(this.id.budgetUsd - this.spent).toFixed(4)})`,
		);

		for (const d of decisions) {
			console.log(`  → ${d.peerName}: pay $${d.payUsd} — ${d.reason}`);
			if (config.dryRun) {
				console.log("    (dry-run: not paying)");
				continue;
			}
			try {
				const r = await payAndPeer({
					privateKey: this.id.privateKey,
					jwt: this.id.jwt,
					routerUuid: d.peerUuid,
				});
				this.spent += d.payUsd;
				console.log(`    paid ${d.peerName}; core responded HTTP ${r.status}`);
			} catch (err) {
				console.error(`    failed to peer ${d.peerName}: ${(err as Error).message}`);
			}
		}
	}
}
