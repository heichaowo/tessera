/**
 * Arc x402 / Circle Nanopayments — seller-side payment gate
 *
 * Verifies and settles gasless USDC payments via Circle Gateway before a
 * protected action runs. Used to gate peering-session creation: the payer
 * (a node operator or an autonomous agent) signs an EIP-3009 authorization
 * offchain, and Gateway settles it in a batch. The fee is paid to the target
 * router's own operator wallet (`payTo`), enabling true agent-to-agent
 * settlement.
 *
 * Flow:
 *   1. No PAYMENT-SIGNATURE header  -> 402 + base64 PAYMENT-REQUIRED header
 *   2. PAYMENT-SIGNATURE present    -> facilitator.settle(); on success the
 *      caller proceeds and a base64 PAYMENT-RESPONSE header is attached.
 */

import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type { Context } from "hono";
import config from "../config";

const facilitator = new BatchFacilitatorClient({
	url: config.arc.facilitatorUrl,
});

interface PaymentRequirements {
	scheme: "exact";
	network: string;
	asset: string;
	amount: string;
	payTo: string;
	maxTimeoutSeconds: number;
	extra: { name: string; version: string; verifyingContract: string };
}

/**
 * Build x402 payment requirements for a given price and payee.
 * Price is a dollar string (e.g. "$0.001") -> atomic USDC units (6 decimals).
 */
function buildRequirements(
	priceUsd: string,
	payTo: string,
): PaymentRequirements {
	const amount = Math.round(
		Number.parseFloat(priceUsd.replace("$", "")) * 1_000_000,
	);

	return {
		scheme: "exact",
		network: config.arc.network,
		asset: config.arc.usdc,
		amount: amount.toString(),
		payTo,
		maxTimeoutSeconds: config.arc.maxTimeoutSeconds,
		extra: {
			name: "GatewayWalletBatched",
			version: "1",
			verifyingContract: config.arc.gatewayWallet,
		},
	};
}

export type PaymentOutcome =
	| { paid: true; payer: string; amountUsdc: string; tx: string | null }
	| { paid: false; response: Response };

/**
 * Require a gasless USDC payment before proceeding.
 *
 * @returns `{ paid: true, ... }` with settlement info when payment succeeds,
 *          or `{ paid: false, response }` — return that Response immediately.
 */
export async function requireGatewayPayment(
	c: Context,
	opts: { price: string; payTo: string; resource: string },
): Promise<PaymentOutcome> {
	const requirements = buildRequirements(opts.price, opts.payTo);
	const signature = c.req.header("PAYMENT-SIGNATURE");

	// No payment yet — challenge the client with payment requirements.
	if (!signature) {
		const paymentRequired = {
			x402Version: 2,
			resource: {
				url: opts.resource,
				description: `MoeNet peering (${opts.price} USDC)`,
				mimeType: "application/json",
			},
			accepts: [requirements],
		};
		c.header(
			"PAYMENT-REQUIRED",
			Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
		);
		return {
			paid: false,
			response: c.json({ code: 402, message: "Payment Required" }, 402),
		};
	}

	// Payment present — settle via Circle Gateway.
	try {
		const payload = JSON.parse(
			Buffer.from(signature, "base64").toString("utf-8"),
		);

		const settle = await facilitator.settle(payload, requirements);

		if (!settle.success) {
			return {
				paid: false,
				response: c.json(
					{
						code: 402,
						message: "Payment settlement failed",
						reason: settle.errorReason,
					},
					402,
				),
			};
		}

		const amountUsdc = (Number(requirements.amount) / 1e6).toString();
		const payer = settle.payer ?? "unknown";

		c.header(
			"PAYMENT-RESPONSE",
			Buffer.from(
				JSON.stringify({
					success: true,
					transaction: settle.transaction ?? null,
					network: requirements.network,
					payer,
				}),
			).toString("base64"),
		);

		return { paid: true, payer, amountUsdc, tx: settle.transaction ?? null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			paid: false,
			response: c.json(
				{ code: 500, message: "Payment processing error", error: message },
				500,
			),
		};
	}
}
