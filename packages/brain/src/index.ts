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
let negoIdx = 0; // rotates which brain refreshes its display negotiations each cycle
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
		if (config.negotiateDisplay && brains.length) {
			// Rotate: one brain refreshes its negotiations per cycle (not all five
			// at once) so the live feed keeps moving while LLM calls drop ~5×.
			const b = brains[negoIdx++ % brains.length];
			try {
				await b.negotiateRound();
			} catch (e) {
				console.error("[negotiate] round error:", e);
			}
		}
	};
	await run();
	// Self-scheduling (not setInterval): the next cycle starts only AFTER the
	// previous finishes, so a slow round can never overlap and stack concurrent
	// LLM calls — the overlap that piled up hung meridian children and ate RAM.
	const scheduleNext = () =>
		setTimeout(async () => {
			try {
				await run();
			} finally {
				scheduleNext();
			}
		}, config.usageSettle.windowMs);
	scheduleNext();

	// One-click "reset & rerun from zero": the dashboard button tears the mesh
	// down and flags a rebuild; poll briefly and, when claimed, run a single
	// establishment round so every agent re-discovers, re-negotiates, pays, and
	// rebuilds its paid peerings — the from-zero formation the demo shows.
	const checkRerun = async () => {
		try {
			const res = await fetch(`${config.coreUrl}/api/v1/demo/rerun-claim`, {
				method: "POST",
				headers: { Authorization: `Bearer ${config.agentApiKey}` },
			});
			const { claimed } = (await res.json()) as { claimed?: boolean };
			if (!claimed) return;
			console.log("[rerun] claimed — rebuilding mesh from zero");
			// Give agents a moment to tear down the deleted sessions first.
			await new Promise((r) => setTimeout(r, 8000));
			// Two rounds: each brain peers the subset it chooses, so a single
			// round leaves a few pairs uncovered. A second round (reputation now
			// updated, existing pairs deduped 422) fills in most of the rest.
			for (let round = 1; round <= 2; round++) {
				for (const b of brains) {
					try {
						await b.tick();
					} catch (e) {
						console.error("[rerun] tick error:", e);
					}
				}
			}
			console.log("[rerun] rebuild rounds complete");
		} catch {
			/* transient — next poll retries */
		}
	};
	setInterval(checkRerun, 10000);
}
