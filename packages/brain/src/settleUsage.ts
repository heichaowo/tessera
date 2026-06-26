/**
 * M2b-3 usage-based net settlement (buyer side).
 *
 * Each agent periodically settles its own net consumption: for every peering
 * tunnel, it asks moenet-core to settle. The core nets the metered per-tunnel
 * tx/rx; if this agent is the NET RECEIVER it returns a 402, and GatewayClient
 * pays the net imbalance to the peer's wallet on Arc. Net senders get
 * {settled:false} and pay nothing — the peer settles its own side.
 *
 * "Money safety is in code, not the model": the core computes the amount from
 * real metered bytes and the agent only pays what it actually owes.
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createWalletClient, defineChain, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import config from "./config";
import type { AgentIdentity } from "./types";

// Arc Memo contract (predeployed) — emits a Memo event with a sequential index
// for whatever calldata it receives, giving a permanent on-chain audit record.
const MEMO_ADDR = "0x9702466268ccF55eAB64cdf484d272Ac08d3b75b";
const arcChain = defineChain({
	id: 5042002,
	name: "Arc Testnet",
	nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

/** Emit a human-readable settlement memo on-chain via the Arc Memo contract. */
async function emitMemo(
	pk: `0x${string}`,
	memo: string,
): Promise<`0x${string}`> {
	const wallet = createWalletClient({
		account: privateKeyToAccount(pk),
		chain: arcChain,
		transport: http(),
	});
	return wallet.sendTransaction({
		to: MEMO_ADDR,
		data: toHex(memo),
		value: 0n,
	});
}

interface Tunnel {
	peerAsn: number;
	peerName: string | null;
}

async function listTunnels(nodeName: string): Promise<Tunnel[]> {
	const res = await fetch(`${config.coreUrl}/api/v1/usage/${nodeName}`, {
		headers: { Authorization: `Bearer ${config.agentApiKey}` },
	});
	if (!res.ok) return [];
	const b = (await res.json()) as { tunnels?: Tunnel[] };
	return b.tunnels ?? [];
}

export async function settleUsage(id: AgentIdentity): Promise<void> {
	if (!id.nodeName || !id.privateKey) return;

	let tunnels: Tunnel[];
	try {
		tunnels = await listTunnels(id.nodeName);
	} catch (e) {
		console.error(`[settle] ${id.nodeName} list failed:`, e);
		return;
	}
	if (!tunnels.length) return;

	const client = new GatewayClient({
		chain: config.arc.chain as "arcTestnet",
		privateKey: id.privateKey,
	});
	try {
		const bal = await client.getBalances();
		if (bal.gateway.available < 100_000n) await client.deposit("0.5");
	} catch (e) {
		console.error(`[settle] ${id.nodeName} balance check failed:`, e);
	}

	for (const t of tunnels) {
		if (!t.peerAsn) continue;
		if (config.dryRun) {
			console.log(`[settle:dry] ${id.nodeName} -> peer ${t.peerAsn}`);
			continue;
		}
		try {
			const { data } = await client.pay(
				`${config.coreUrl}/api/v1/usage-settlement`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.agentApiKey}`,
					},
					body: { node: id.nodeName, peerAsn: t.peerAsn },
				},
			);
			// biome-ignore lint/suspicious/noExplicitAny: external JSON shape
			const d = data as any;
			if (d?.settled) {
				console.log(
					`[settle] ${id.nodeName} -> ${d.payee} $${d.amountUsd} ` +
						`(net ${(d.netBytes / 1e6).toFixed(1)}MB) tx=${d.tx ?? "?"}`,
				);
				// Emit an on-chain Memo audit record + link it back to the settlement.
				try {
					const status = d.flags?.length ? "FLAGGED" : "cross-attested OK";
					const memo =
						`Tessera M2b-3 usage settlement | ${d.payer} -> ${d.payee} | ` +
						`net ${(d.netBytes / 1e6).toFixed(1)}MB | $${d.amountUsd} | ${status} | ` +
						`gw ${String(d.tx).slice(0, 8)}`;
					const memoTx = await emitMemo(id.privateKey, memo);
					await fetch(`${config.coreUrl}/api/v1/usage-settlement/memo`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${config.agentApiKey}`,
						},
						body: JSON.stringify({ settlementId: d.tx, memoTx, memo }),
					});
					console.log(`[memo] ${id.nodeName} -> ${d.payee} on-chain memo ${memoTx}`);
				} catch (e) {
					console.error(`[memo] ${id.nodeName} failed:`, e);
				}
			}
		} catch (e) {
			console.error(`[settle] ${id.nodeName} -> ${t.peerAsn} failed:`, e);
		}
	}
}

export async function settleAll(ids: AgentIdentity[]): Promise<void> {
	for (const id of ids) await settleUsage(id);
}
