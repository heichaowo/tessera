import type { Hono } from "hono";
import adminHandler from "./handlers/admin";
import agentHandler from "./handlers/agent";
import authHandler from "./handlers/auth";
import bootstrapHandler from "./handlers/bootstrap";
import flapHandler from "./handlers/flap";
import metricsHandler from "./handlers/metrics";
import networkHandler from "./handlers/network";
import peeringHandler from "./handlers/peering";
import usageSettlementHandler, {
	demoCheatHandler,
	demoResetHandler,
	negotiationHandler,
	usageListHandler,
	usageMemoHandler,
} from "./handlers/usageSettlement";

export function registerRoutes(app: Hono) {
	// Bootstrap API (for node initialization)
	app.get("/bootstrap/:token", bootstrapHandler);

	// Agent API (for Go agent communication)
	app.get("/api/v1/agent/:router/:action", agentHandler);
	app.post("/api/v1/agent/:router/:action", agentHandler);
	// Nested action routes (mesh/status)
	app.post("/api/v1/agent/:router/mesh/status", agentHandler);
	// Also support heartbeat without router param
	app.post("/api/v1/agent/heartbeat", agentHandler);

	// Flap detection (FlapAlerted webhooks)
	app.post("/api/v1/flap/alert", flapHandler);
	app.post("/api/v1/flap/resolved", flapHandler);

	// Authentication
	app.post("/api/v1/auth", authHandler);

	// Admin operations
	app.post("/api/v1/admin", adminHandler);

	// Peering management
	app.post("/api/v1/session", peeringHandler);

	// Metrics
	app.get("/api/v1/metrics", metricsHandler);

	// Public read-only network state for the live dashboard
	app.get("/api/v1/network", networkHandler);

	// M2b-3 usage-based net settlement (per-tunnel usage + x402-gated settle)
	app.get("/api/v1/usage/:node", usageListHandler);
	app.post("/api/v1/usage-settlement", usageSettlementHandler);
	app.post("/api/v1/usage-settlement/memo", usageMemoHandler);
	app.post("/api/v1/negotiation", negotiationHandler);

	// Public, auto-reverting demo control (simulate a cheating agent)
	app.post("/api/v1/demo/cheat", demoCheatHandler);
	app.post("/api/v1/demo/reset", demoResetHandler);
}
