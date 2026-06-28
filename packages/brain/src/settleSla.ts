/**
 * Route A — provider SLA auto-compensation (provider side).
 *
 * Only the large provider's brain (HK) runs this. It polls the control plane
 * for unpaid SLA breach credits owed to its customers, and for each one it
 * transfers the USDC credit to the customer's wallet on Arc, writes a
 * human-readable Memo on-chain, and marks the credit settled. The provider
 * refunds itself when it breaches — no claims process, no human in the loop.
 */

import {
	createWalletClient,
	defineChain,
	http,
	parseUnits,
	toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import config from "./config";
import type { AgentIdentity } from "./types";

const MEMO_ADDR = "0x9702466268ccF55eAB64cdf484d272Ac08d3b75b";
const arcChain = defineChain({
	id: 5042002,
	name: "Arc Testnet",
	nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

interface SlaCredit {
	id: string;
	customer: string;
	customerWallet: string;
	amountUsd: number;
	reason: string;
}

async function listPending(): Promise<SlaCredit[]> {
	const res = await fetch(`${config.coreUrl}/api/v1/sla/pending`, {
		headers: { Authorization: `Bearer ${config.agentApiKey}` },
	});
	if (!res.ok) return [];
	const b = (await res.json()) as { credits?: SlaCredit[] };
	return b.credits ?? [];
}

export async function settleSla(id: AgentIdentity): Promise<void> {
	// Only the SLA provider (HK) pays out credits.
	if (id.nodeName !== config.slaProviderNode || !id.privateKey) return;

	let pending: SlaCredit[];
	try {
		pending = await listPending();
	} catch (e) {
		console.error("[sla] list failed:", e);
		return;
	}
	if (!pending.length) return;

	const wallet = createWalletClient({
		account: privateKeyToAccount(id.privateKey),
		chain: arcChain,
		transport: http(),
	});

	for (const cr of pending) {
		if (!cr.customerWallet) continue;
		if (config.dryRun) {
			console.log(`[sla:dry] credit ${cr.customer} $${cr.amountUsd}`);
			continue;
		}
		try {
			// Real USDC refund: native value transfer (Arc native == USDC, 18dp).
			const payTx = await wallet.sendTransaction({
				to: cr.customerWallet as `0x${string}`,
				value: parseUnits(String(cr.amountUsd), 18),
			});
			// On-chain audit memo.
			const memo =
				`Tessera SLA credit | ${id.nodeName} -> ${cr.customer} | ` +
				`breach: ${cr.reason} | $${cr.amountUsd} | auto-refund pay ${String(payTx).slice(0, 8)}`;
			const memoTx = await wallet.sendTransaction({
				to: MEMO_ADDR,
				data: toHex(memo),
				value: 0n,
			});
			await fetch(`${config.coreUrl}/api/v1/sla/paid`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.agentApiKey}`,
				},
				body: JSON.stringify({ id: cr.id, payTx, memoTx }),
			});
			console.log(
				`[sla] credit ${id.nodeName} -> ${cr.customer} $${cr.amountUsd} ` +
					`pay=${payTx} memo=${memoTx}`,
			);
		} catch (e) {
			console.error(`[sla] credit ${cr.customer} failed:`, e);
		}
	}
}
