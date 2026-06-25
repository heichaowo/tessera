/**
 * Autonomous x402 payment + peering. Uses the node's own EOA wallet to pay the
 * target operator via Circle Gateway, driving moenet-core's payment-gated
 * session-create endpoint. GatewayClient.pay() runs the full 402 negotiation
 * (request -> 402 -> EIP-3009 sign -> retry).
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import config from "./config";

export interface PayResult {
	status: number;
	data: unknown;
}

export async function payAndPeer(opts: {
	privateKey: `0x${string}`;
	jwt: string;
	routerUuid: string;
}): Promise<PayResult> {
	const client = new GatewayClient({
		chain: config.arc.chain as "arcTestnet",
		privateKey: opts.privateKey,
	});

	// Ensure a Gateway balance exists (one-time on-chain deposit).
	const bal = await client.getBalances();
	if (bal.gateway.available < 100_000n) {
		await client.deposit("0.5");
	}

	const { status, data } = await client.pay(`${config.coreUrl}/api/v1/session`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${opts.jwt}`,
		},
		body: { action: "create", data: { router: opts.routerUuid } },
	});

	return { status, data };
}
