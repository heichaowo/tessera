/**
 * Brain entrypoint — runs N autonomous agent brains (one per node identity).
 *
 * Identities come from BRAIN_IDENTITIES, a JSON array of
 *   { name, nodeName, privateKey, jwt, budgetUsd }
 * (node wallet keys live outside git, e.g. demo-wallets.json).
 */

import { AgentBrain } from "./agent";
import { NegotiationBroker } from "./broker";
import config from "./config";
import { settleSla } from "./settleSla";
import { settleAll } from "./settleUsage";
import type { AgentIdentity } from "./types";

function loadIdentities(): AgentIdentity[] {
	const raw = process.env.BRAIN_IDENTITIES;
	if (!raw) {
		console.error(
			"BRAIN_IDENTITIES not set — expected a JSON array of " +
				"{ name, nodeName, privateKey, jwt, budgetUsd }",
		);
		return [];
	}
	const parsed = JSON.parse(raw) as Partial<AgentIdentity>[];
	return parsed.map((p) => ({
		name: p.name ?? p.nodeName ?? "agent",
		nodeName: p.nodeName ?? "",
		privateKey: p.privateKey as `0x${string}`,
		jwt: p.jwt ?? "",
		budgetUsd: p.budgetUsd ?? config.budgetUsd,
	}));
}

const identities = loadIdentities();
if (identities.length === 0) process.exit(1);

console.log(
	`[brain] starting ${identities.length} agent(s) ` +
		`(llm=${config.meridian.enabled ? config.meridian.model : "off"}, ` +
		`dryRun=${config.dryRun})`,
);

const broker = new NegotiationBroker();
const brains = identities.map((id) => new AgentBrain(id, broker));
if (!config.settleOnly) {
	for (const b of brains) {
		await b.tick();
	}
}

// M2b-3: keep the process alive and settle net usage on a recurring window.
if (config.usageSettle.enabled) {
	console.log(
		`[brain] usage settlement loop on (every ${config.usageSettle.windowMs / 1000}s, dryRun=${config.dryRun})`,
	);
	const run = async () => {
		// Route A first: pay out SLA breach credits promptly, before the (slower)
		// usage-settlement sweep, so a breach is auto-refunded within a cycle.
		for (const id of identities) {
			try {
				await settleSla(id);
			} catch (e) {
				console.error("[sla] cycle error:", e);
			}
		}
		try {
			await settleAll(identities);
		} catch (e) {
			console.error("[settle] cycle error:", e);
		}
		if (config.negotiateDisplay) {
			for (const b of brains) {
				try {
					await b.negotiateRound();
				} catch (e) {
					console.error("[negotiate] round error:", e);
				}
			}
		}
	};
	await run();
	setInterval(run, config.usageSettle.windowMs);
}
