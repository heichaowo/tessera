/**
 * Brain entrypoint — runs N autonomous agent brains (one per node identity).
 *
 * Identities come from BRAIN_IDENTITIES, a JSON array of
 *   { name, nodeName, privateKey, jwt, budgetUsd }
 * (node wallet keys live outside git, e.g. demo-wallets.json).
 */

import { AgentBrain } from "./agent";
import config from "./config";
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

const brains = identities.map((id) => new AgentBrain(id));
for (const b of brains) {
	await b.tick();
}
