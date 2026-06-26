/**
 * MoeNet Core API Configuration
 */

export default {
	server: {
		port: Number(process.env.PORT) || 3000,
		host: process.env.HOST || "localhost",
	},

	cors: {
		// NOTE: Default '*' is acceptable for API-only (no browser cookies).
		// Set CORS_ORIGINS if adding browser-based admin panel.
		origins: (process.env.CORS_ORIGINS || "*").split(","),
	},

	database: {
		dialect: "postgres" as const,
		host: process.env.DB_HOST || "localhost",
		port: Number(process.env.DB_PORT) || 5432,
		database: process.env.DB_NAME || "moenet",
		username: process.env.DB_USER || "moenet",
		password: process.env.DB_PASSWORD || "",
		logging: process.env.NODE_ENV !== "production",
	},

	redis: {
		host: process.env.REDIS_HOST || "localhost",
		port: Number(process.env.REDIS_PORT) || 6379,
		password: process.env.REDIS_PASSWORD || undefined,
	},

	auth: {
		agentApiKey: process.env.AGENT_API_KEY || "",
		jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
		jwtExpiresIn: "7d",
	},

	dn42: {
		asn: Number(process.env.DN42_ASN) || 4242420998,
		netName: process.env.DN42_NET_NAME || "MOENET-DN42",
		ipv4Prefix: process.env.DN42_IPV4_PREFIX || "172.22.188.0/26",
		ipv6Prefix: process.env.DN42_IPV6_PREFIX || "fd00:4242:7777::/48",
	},

	app: {
		coreUrl: process.env.CORE_URL || "https://api.moenet.work",
		agentDownloadUrl:
			process.env.AGENT_DOWNLOAD_URL ||
			"https://github.com/heichaowo/moenet-agent/releases/latest/download/moenet-agent-linux-amd64",
		birdDownloadUrl:
			process.env.BIRD_DOWNLOAD_URL ||
			"https://github.com/heichaowo/moenet-dn42-binaries/releases/latest/download/bird",
		birdcDownloadUrl:
			process.env.BIRDC_DOWNLOAD_URL ||
			"https://github.com/heichaowo/moenet-dn42-binaries/releases/latest/download/birdc",
	},

	telegram: {
		botToken: process.env.TELEGRAM_BOT_TOKEN || "",
		adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || "",
	},

	smtp: {
		host: process.env.SMTP_HOST || "",
		port: Number(process.env.SMTP_PORT) || 587,
		secure: process.env.SMTP_SECURE === "true",
		user: process.env.SMTP_USER || "",
		pass: process.env.SMTP_PASS || "",
		from: process.env.SMTP_FROM || "MoeNet DN42 <noreply@moenet.work>",
	},

	mailgun: {
		apiKey: process.env.MAILGUN_API_KEY || "",
		domain: process.env.MAILGUN_DOMAIN || "dn42.moenet.work",
		from: process.env.MAILGUN_FROM || "DN42 Bot <bot@dn42.moenet.work>",
	},

	features: {
		enableTelegramBot: process.env.TELEGRAM_BOT_ENABLED === "true",
		telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
		// Auto full-mesh / iBGP backbone. Disabled for the inter-AS demo so the
		// only links are the paid eBGP peerings. Set MESH_ENABLED=true to restore.
		meshEnabled: process.env.MESH_ENABLED === "true",
	},

	// Arc x402 / Circle Nanopayments (testnet)
	arc: {
		// Master switch — when false, peering works exactly as before (no payment).
		enabled: process.env.ARC_X402_ENABLED === "true",
		// CAIP-2 network id; Arc Testnet = eip155:5042002
		network: process.env.ARC_NETWORK || "eip155:5042002",
		// USDC ERC-20 interface on Arc Testnet (6 decimals)
		usdc: process.env.ARC_USDC || "0x3600000000000000000000000000000000000000",
		// Gateway Wallet contract (EIP-3009 verifyingContract)
		gatewayWallet:
			process.env.ARC_GATEWAY_WALLET ||
			"0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
		facilitatorUrl:
			process.env.ARC_FACILITATOR_URL ||
			"https://gateway-api-testnet.circle.com",
		// EIP-3009 validBefore window; Gateway requires >= 7 days (604800s)
		maxTimeoutSeconds: Number(process.env.ARC_MAX_TIMEOUT_SECONDS) || 604800,
		// One-time peering fee, in dollars (e.g. "$0.001")
		peeringPrice: process.env.ARC_PEERING_PRICE || "$0.001",
		// Negotiable price band (USDC). A negotiated price from the agents is
		// clamped into [floor, premium]; outside this, settlement is rejected.
		priceFloorUsd: Number(process.env.ARC_PRICE_FLOOR) || 0.0005,
		pricePremiumUsd: Number(process.env.ARC_PRICE_PREMIUM) || 0.01,
		// M2b-3 usage-based net settlement: price per GB of net traffic
		// imbalance; the net receiver pays the net sender each window.
		usagePricePerGbUsd: Number(process.env.ARC_USAGE_PRICE_PER_GB) || 0.1,
		// Don't bother settling below this dollar amount (avoids dust txns).
		usageMinSettleUsd: Number(process.env.ARC_USAGE_MIN_SETTLE) || 0.0001,
		// Bilateral cross-attestation: a direction's sender-tx vs receiver-rx may
		// differ by packet loss + sampling skew. Flag a discrepancy only when the
		// gap exceeds max(usageDiscrepancyMinBytes, usageLossBandPct * sender).
		// Honest two-sided readings agree to ~0% with occasional sampling-skew
		// outliers up to ~25% on the lossy UDP testbed; gross cheating shows
		// 100%+. 0.4 cleanly separates the two (tighten for real data planes).
		usageLossBandPct: Number(process.env.ARC_USAGE_LOSS_BAND) || 0.4,
		// Floor absorbs heartbeat sampling skew: the two ends sample ~5s apart, so
		// an active direction can differ by ~rate*5s (~1-5MB) with no loss/cheat.
		usageDiscrepancyMinBytes:
			Number(process.env.ARC_USAGE_DISCREPANCY_MIN_BYTES) || 5_000_000,
	},
};
