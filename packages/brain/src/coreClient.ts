/** Thin client for moenet-core's peer discovery API. */

import config from "./config";
import type { Candidate } from "./types";

function priceToUsd(p: string | undefined): number {
	const m = p?.match(/([0-9]*\.?[0-9]+)/);
	return m?.[1] ? Number(m[1]) : 0;
}

export interface Discovery {
	self: { uuid: string; name: string; regionCode: number };
	priceUsd: number;
	candidates: Candidate[];
}

/** GET /api/v1/agent/:node/peers — candidates + decision inputs. */
export async function discover(nodeName: string): Promise<Discovery> {
	const res = await fetch(`${config.coreUrl}/api/v1/agent/${nodeName}/peers`, {
		headers: { Authorization: `Bearer ${config.agentApiKey}` },
	});
	if (!res.ok) throw new Error(`discover ${nodeName}: HTTP ${res.status}`);

	// biome-ignore lint/suspicious/noExplicitAny: external JSON shape
	const body = (await res.json()) as { data: any };
	const d = body.data;
	const priceUsd = priceToUsd(d.price?.base);

	// biome-ignore lint/suspicious/noExplicitAny: external JSON shape
	const candidates: Candidate[] = (d.peers ?? []).map((p: any) => ({
		uuid: p.uuid,
		name: p.name,
		regionCode: p.regionCode,
		sameRegion: p.sameRegion,
		payable: p.payable,
		payTo: p.payTo,
		priceUsd,
		latency: p.latency ?? null,
		hopCount: p.hopCount ?? null,
		capacity: p.capacity,
		endpoint: p.endpoint,
		wgPublicKey: p.wgPublicKey,
	}));

	return { self: d.self, priceUsd, candidates };
}
