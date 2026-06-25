/**
 * x402 buyer test harness — verifies the seller-side payment gate end to end.
 *
 * Pays for a peering session on Arc Testnet using a Gateway balance, exercising
 * the full 402 -> sign -> settle -> 200 flow against moenet-core.
 *
 * Prereqs:
 *   - BUYER_PRIVATE_KEY: EOA private key, funded with Arc Testnet USDC
 *     (faucet: https://faucet.circle.com). Needs native USDC for the one-time
 *     Gateway deposit, and Gateway balance for the payment itself.
 *   - A router in the DB whose `wallet_address` is set (the payee).
 *   - moenet-core running with ARC_X402_ENABLED=true.
 *
 * Usage:
 *   BUYER_PRIVATE_KEY=0x... CORE_URL=http://localhost:3000 JWT=<bearer> \
 *   ROUTER_UUID=<uuid> bun run packages/api/scripts/x402-pay.ts
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";

const pk = process.env.BUYER_PRIVATE_KEY;
const jwt = process.env.JWT;
const routerUuid = process.env.ROUTER_UUID;
const coreUrl = process.env.CORE_URL ?? "http://localhost:3000";

if (!pk || !jwt || !routerUuid) {
	console.error(
		"Missing env. Required: BUYER_PRIVATE_KEY, JWT, ROUTER_UUID (optional: CORE_URL)",
	);
	process.exit(1);
}

const client = new GatewayClient({
	chain: "arcTestnet",
	privateKey: pk as `0x${string}`,
});

// Ensure a Gateway balance exists (one-time on-chain deposit).
const balances = await client.getBalances();
console.log(`Gateway available: ${balances.gateway.formattedAvailable} USDC`);
if (balances.gateway.available < 100_000n) {
	console.log("Depositing 0.5 USDC into Gateway...");
	const dep = await client.deposit("0.5");
	console.log(`Deposit tx: ${dep.depositTxHash}`);
}

// Pay for a peering session. client.pay() runs the full x402 negotiation:
// initial POST -> 402 + PAYMENT-REQUIRED -> EIP-3009 sign -> retry -> 200.
const url = `${coreUrl}/api/v1/session`;
console.log(`Paying ${url} (create session for router ${routerUuid})...`);

const { status, data } = await client.pay(url, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		Authorization: `Bearer ${jwt}`,
	},
	body: { action: "create", data: { router: routerUuid } },
});

console.log(`HTTP ${status}`);
console.log("Response:", JSON.stringify(data, null, 2));
