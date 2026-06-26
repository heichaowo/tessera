import type { Context } from "hono";
import { getModels } from "../db/dbContext";
import { PeeringStatus } from "../db/models/bgpSessions";

/**
 * Public, read-only network state for the live dashboard (tessera.moenet.work).
 *
 * Exposes only public network facts (node identities, peering pairs, negotiated
 * prices, settlement ids, BGP status) — never wallets' private keys or JWTs.
 */
export default async function networkHandler(c: Context): Promise<Response> {
	const models = getModels();

	const routers = await models.routers.findAll();
	const now = Date.now();
	const nodes = routers.map((r: { get: (k?: string) => unknown }) => {
		const lastSeen = r.get("lastSeen") as Date | null;
		return {
			name: r.get("name") as string,
			asn: r.get("asn") != null ? Number(r.get("asn")) : null,
			regionCode: (r.get("regionCode") as number) ?? null,
			location: (r.get("location") as string) ?? null,
			publicIp: (r.get("publicIp") as string) ?? null,
			nodeId: (r.get("nodeId") as number) ?? null,
			online: lastSeen ? now - new Date(lastSeen).getTime() < 180_000 : false,
			hasWg: !!r.get("wgPublicKey"),
			walletAddress: (r.get("walletAddress") as string) ?? null,
		};
	});
	const nameByUuid = new Map(
		routers.map((r: { get: (k?: string) => unknown }) => [
			r.get("uuid") as string,
			r.get("name") as string,
		]),
	);
	const asnToName = new Map(
		routers
			.filter((r: { get: (k?: string) => unknown }) => r.get("asn") != null)
			.map((r: { get: (k?: string) => unknown }) => [
				Number(r.get("asn")),
				r.get("name") as string,
			]),
	);

	const sessions = await models.bgpSessions.findAll();
	let totalPaid = 0;
	const peerings = sessions.map((s: { get: (k?: string) => unknown }) => {
		const status = s.get("status") as PeeringStatus;
		let payment: { amountUsdc?: string; tx?: string; payer?: string } = {};
		const data = s.get("data") as string | null;
		if (data) {
			try {
				payment = JSON.parse(data).payment ?? {};
			} catch {
				/* ignore */
			}
		}
		const amt = payment.amountUsdc ? Number(payment.amountUsdc) : 0;
		totalPaid += amt;
		const peerAsn = Number(s.get("asn"));
		return {
			onNode: nameByUuid.get(s.get("router") as string) ?? null,
			peerName: asnToName.get(peerAsn) ?? null,
			peerAsn,
			status,
			statusLabel:
				status === PeeringStatus.ENABLED
					? "established"
					: status === PeeringStatus.QUEUED_FOR_SETUP
						? "building"
						: status === PeeringStatus.PROBLEM
							? "converging"
							: String(status),
			priceUsd: amt,
			settlement: payment.tx ?? null,
			payer: payment.payer ?? null,
		};
	});

	const establishedRows = peerings.filter(
		(p) => p.status === PeeringStatus.ENABLED,
	).length;

	return c.json({
		updatedAt: new Date(now).toISOString(),
		stats: {
			nodes: nodes.length,
			nodesOnline: nodes.filter((n) => n.online).length,
			peeringSessions: peerings.length,
			established: establishedRows,
			establishedPairs: Math.floor(establishedRows / 2),
			totalSettlements: peerings.filter((p) => p.settlement).length,
			totalPaidUsd: Number(totalPaid.toFixed(6)),
			chain: "Arc Testnet",
			explorer: "https://testnet.arcscan.app",
			gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
		},
		nodes,
		peerings,
	});
}
