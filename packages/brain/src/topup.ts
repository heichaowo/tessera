/**
 * Auto top-up — keep each node's wallet above a floor so it can always fund its
 * Gateway deposits, replenished from a central funder wallet.
 *
 * Same by-design pattern as SLA auto-compensation: the operator keeps the
 * funder wallet capitalised, and the system distributes to the node wallets on
 * its own. No human transfers any individual payment; the funder → node moves
 * are autonomous, bounded (only tops a wallet that dipped below `floorUsd`, only
 * up to `targetUsd`), and capped by the funder's own balance.
 */

import {
	createPublicClient,
	createWalletClient,
	defineChain,
	formatUnits,
	http,
	parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import config from "./config";
import type { AgentIdentity } from "./types";

const arcChain = defineChain({
	id: 5042002,
	name: "Arc Testnet",
	nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

/** Refill any node wallet that has dipped below the floor, up to the target. */
export async function topUpNodes(identities: AgentIdentity[]): Promise<void> {
	if (!config.topup.enabled || !config.topup.funderKey) return;

	const pub = createPublicClient({ chain: arcChain, transport: http() });
	const funder = createWalletClient({
		account: privateKeyToAccount(config.topup.funderKey),
		chain: arcChain,
		transport: http(),
	});

	for (const id of identities) {
		if (!id.privateKey) continue;
		const addr = privateKeyToAccount(id.privateKey).address;

		let balUsd: number;
		try {
			balUsd = Number(formatUnits(await pub.getBalance({ address: addr }), 18));
		} catch (e) {
			console.error(`[topup] ${id.nodeName} balance read failed:`, e);
			continue;
		}
		if (balUsd >= config.topup.floorUsd) continue;

		// Arc has sub-second finality, so by the next cycle this balance reflects
		// the refill — no need for a per-node cooldown to avoid double-sending.
		const needUsd = config.topup.targetUsd - balUsd;
		try {
			const tx = await funder.sendTransaction({
				to: addr,
				value: parseUnits(needUsd.toFixed(6), 18),
			});
			console.log(
				`[topup] ${id.nodeName} ${balUsd.toFixed(3)} → +${needUsd.toFixed(2)} USDC tx=${tx}`,
			);
		} catch (e) {
			console.error(`[topup] ${id.nodeName} transfer failed:`, e);
		}
	}
}
