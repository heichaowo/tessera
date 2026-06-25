/**
 * Node-to-node peering link builder.
 *
 * When one MoeNet node pays to peer with another, the CP already holds both
 * nodes' WireGuard public keys + public IPs (via heartbeat) and their
 * nodeId/regionCode/ASN. So the "WG parameter exchange" collapses to a
 * deterministic computation: this builds the two session rows (one per side)
 * with link-local (LLA) addressing, so each node's agent brings up its half of
 * the WireGuard tunnel + eBGP session. No IP allocation needed (LLA).
 *
 * Port scheme (deterministic, both sides agree): node X listens on
 * `51820 + peerNodeId` for the link to that peer.
 */

import { getInterfaceName } from "../common/helpers";
import { SessionPolicy } from "../db/models/bgpSessions";
import { deriveLLA } from "./ipAllocator";

const WG_PORT_BASE = 51820;
const LINK_MTU = 1420;

/** Fields to set on a session at `local`, peering with `remote`. */
export interface PeerLinkSide {
	router: string; // local router uuid (where this session lives)
	asn: number; // remote (BGP neighbor) ASN
	type: "wireguard";
	interface: string; // dn42_<remoteAsn>
	endpoint: string; // remote publicIp:port to dial
	credential: string; // JSON { public_key, listen_port, endpoint }
	ipv6LinkLocal: string; // remote LLA (BGP neighbor address)
	mtu: number;
	policy: SessionPolicy;
}

/** A node as seen by the link builder. */
export interface PeerNode {
	uuid: string;
	nodeId: number;
	regionCode: number;
	asn: number;
	publicIp: string;
	wgPublicKey: string;
}

/**
 * Read a router model into a PeerNode, or null if it isn't ready to peer
 * (missing wg key / public IP / nodeId / ASN — e.g. its agent hasn't checked
 * in yet).
 */
// biome-ignore lint/suspicious/noExplicitAny: Sequelize model instance
export function toPeerNode(router: any): PeerNode | null {
	const wgPublicKey = router.get("wgPublicKey") as string | null;
	const publicIp = router.get("publicIp") as string | null;
	const nodeId = router.get("nodeId") as number | null;
	const asn = router.get("asn") as number | string | null;
	if (!wgPublicKey || !publicIp || nodeId == null || asn == null) return null;
	return {
		uuid: router.get("uuid") as string,
		nodeId,
		regionCode: (router.get("regionCode") as number) ?? 0,
		asn: Number(asn),
		publicIp,
		wgPublicKey,
	};
}

function listenPort(peerNodeId: number): number {
	return WG_PORT_BASE + peerNodeId;
}

/**
 * Build both sides of an a↔b peering link. Returns the session enrichment for
 * `a`'s router (peer=b) and `b`'s router (peer=a). Pure/deterministic.
 */
export function buildNodePeering(
	a: PeerNode,
	b: PeerNode,
): { aSide: PeerLinkSide; bSide: PeerLinkSide } {
	const aLLA = deriveLLA(a.regionCode, a.nodeId);
	const bLLA = deriveLLA(b.regionCode, b.nodeId);
	const aListen = listenPort(b.nodeId); // a listens for the link to b
	const bListen = listenPort(a.nodeId); // b listens for the link to a

	// Session on A's router: A is local, B is the neighbor.
	const aSide: PeerLinkSide = {
		router: a.uuid,
		asn: b.asn,
		type: "wireguard",
		interface: getInterfaceName(b.asn),
		endpoint: `${b.publicIp}:${bListen}`,
		credential: JSON.stringify({
			public_key: b.wgPublicKey,
			listen_port: aListen,
			endpoint: `${b.publicIp}:${bListen}`,
		}),
		ipv6LinkLocal: bLLA,
		mtu: LINK_MTU,
		policy: SessionPolicy.PEER,
	};

	// Session on B's router: B is local, A is the neighbor.
	const bSide: PeerLinkSide = {
		router: b.uuid,
		asn: a.asn,
		type: "wireguard",
		interface: getInterfaceName(a.asn),
		endpoint: `${a.publicIp}:${aListen}`,
		credential: JSON.stringify({
			public_key: a.wgPublicKey,
			listen_port: bListen,
			endpoint: `${a.publicIp}:${aListen}`,
		}),
		ipv6LinkLocal: aLLA,
		mtu: LINK_MTU,
		policy: SessionPolicy.PEER,
	};

	return { aSide, bSide };
}
