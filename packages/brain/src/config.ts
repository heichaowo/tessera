/** Brain configuration (env-driven). */

export default {
	// moenet-core endpoint + agent API key (for peer discovery).
	coreUrl: process.env.CORE_URL || "http://localhost:3000",
	agentApiKey: process.env.AGENT_API_KEY || "",

	// meridian proxy (Claude Max -> Anthropic API) running on the control plane.
	meridian: {
		url: process.env.MERIDIAN_URL || "http://127.0.0.1:3456",
		apiKey: process.env.MERIDIAN_API_KEY || "x", // placeholder unless meridian auth is on
		model: process.env.BRAIN_MODEL || "claude-sonnet-4-6",
		// Display-only negotiation rounds use a lighter/faster model (Haiku) so the
		// per-call meridian CLI-fork stays cheap; real establishment keeps `model`.
		displayModel: process.env.BRAIN_DISPLAY_MODEL || "claude-haiku-4-5",
		// Abort a stuck LLM call (default 45s, 1 retry) so a hung meridian child
		// can't pile up and exhaust memory; on failure we fall back to rules.
		timeoutMs: Number(process.env.BRAIN_LLM_TIMEOUT_MS) || 45_000,
		// Default on; set BRAIN_LLM_ENABLED=false to force deterministic rules.
		enabled: process.env.BRAIN_LLM_ENABLED !== "false",
	},

	arc: {
		chain: process.env.ARC_CHAIN || "arcTestnet",
	},

	// Negotiable price band (USDC). Providers won't sell below floor; target is
	// the list price; premium is the ceiling for priority/cold-potato peering.
	price: {
		floorUsd: Number(process.env.ARC_PRICE_FLOOR) || 0.0005,
		targetUsd: Number(process.env.ARC_PRICE_TARGET) || 0.001,
		premiumUsd: Number(process.env.ARC_PRICE_PREMIUM) || 0.01,
	},

	// Where agents persist what they have learned about peers (one file per
	// buyer/provider identity lives under this directory).
	reputationDir: process.env.BRAIN_REPUTATION_DIR || ".brain-rep",
	// Peers with reputation below this are avoided entirely.
	reputationFloor: Number(process.env.BRAIN_REPUTATION_FLOOR) || 0.3,
	// Buyers open negotiation at this fraction of the list price.
	openOfferFactor: Number(process.env.BRAIN_OPEN_OFFER) || 0.7,

	// M2b-3 usage settlement loop: when enabled, agents periodically settle
	// their net traffic consumption with peers on-chain.
	usageSettle: {
		enabled: process.env.BRAIN_USAGE_SETTLE === "true",
		windowMs: Number(process.env.BRAIN_USAGE_WINDOW_MS) || 180_000, // ~3 min
	},

	// Skip the one-shot peering-establishment ticks (only run the settlement
	// loop) — avoids re-triggering establishment when running settlement.
	settleOnly: process.env.BRAIN_SETTLE_ONLY === "true",

	// Run a display-only negotiation round each cycle (real Haiku reasoning,
	// no payment) to power the live "Negotiation" panel.
	negotiateDisplay: process.env.BRAIN_NEGOTIATE_DISPLAY === "true",

	// Route A: the node that acts as the large SLA provider. Only this identity's
	// brain pays out SLA breach credits (settleSla is a no-op for the others).
	slaProviderNode: process.env.BRAIN_SLA_PROVIDER || "hk",

	// Decide + log, but don't pay or create sessions (safe local runs).
	dryRun: process.env.BRAIN_DRY_RUN === "true",

	budgetUsd: Number(process.env.BRAIN_BUDGET_USD) || 0.05,

	policy:
		process.env.BRAIN_POLICY ||
		"Build a low-latency, resilient peering mesh within budget. Prefer lower latency. " +
			"When candidates' latencies are within ~20% of each other, prefer fewer hops, then lower price, " +
			"then more free capacity, then same-region. Diversify across regions for resilience. " +
			"Only pick payable candidates that have free capacity, and never exceed the budget.",
};
