/**
 * Provider-side negotiation. When an agent requests peering, the *provider*
 * node's brain evaluates the offer against its capacity, its price band, and
 * its reputation of the requester, then accepts / counters / rejects.
 *
 * This makes peering a two-sided agent-to-agent negotiation rather than a fixed
 * tariff: a trusted requester gets a better price; an unknown one pays closer
 * to list; a flappy / bad-history one is refused. Deterministic by default,
 * with an optional LLM (meridian) layer that falls back to the rules.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import config from "../config";

export interface PeerOffer {
	fromAgent: string;
	toNode: string;
	offerUsd: number;
	requesterScore: number; // provider's reputation of the requester (0..1)
	hasCapacity: boolean;
	premium?: boolean; // requester wants priority / cold-potato
}

export interface NegotiationResult {
	decision: "accept" | "counter" | "reject";
	priceUsd: number;
	reason: string;
}

/** Deterministic negotiation — also the LLM fallback. */
export function negotiateByRules(offer: PeerOffer): NegotiationResult {
	const { floorUsd, targetUsd, premiumUsd } = config.price;
	const list = offer.premium ? premiumUsd : targetUsd;

	if (!offer.hasCapacity) {
		return { decision: "reject", priceUsd: list, reason: "no free peer slots" };
	}
	if (offer.requesterScore < config.reputationFloor) {
		return {
			decision: "reject",
			priceUsd: list,
			reason: `requester reputation too low (${offer.requesterScore.toFixed(2)})`,
		};
	}

	// Better reputation -> willing to go closer to the floor.
	const minAccept = floorUsd + (list - floorUsd) * (1 - offer.requesterScore);

	if (offer.offerUsd >= list) {
		return { decision: "accept", priceUsd: list, reason: "offer meets list price" };
	}
	if (offer.offerUsd >= minAccept) {
		return {
			decision: "accept",
			priceUsd: offer.offerUsd,
			reason: `offer ${offer.offerUsd} ≥ my minimum ${minAccept.toFixed(5)} (good standing)`,
		};
	}
	return {
		decision: "counter",
		priceUsd: list,
		reason: `offer ${offer.offerUsd} below minimum ${minAccept.toFixed(5)}; counter at list`,
	};
}

const Result = z.object({
	decision: z.enum(["accept", "counter", "reject"]),
	priceUsd: z.number().nonnegative(),
	reason: z.string(),
});

const client = new Anthropic({
	baseURL: config.meridian.url,
	apiKey: config.meridian.apiKey,
});

const SYSTEM = `You are the provider-side peering negotiator for a BGP node.
A peer is requesting a paid WireGuard+BGP session with you. Decide accept / counter / reject and the price.
Price band (USDC): floor=${config.price.floorUsd}, list/target=${config.price.targetUsd}, premium=${config.price.premiumUsd}.
Never sell below floor. Reward trusted requesters (high reputation) with prices nearer the floor; charge unknown ones near list; reject if you have no capacity or reputation is below ${config.reputationFloor}.
Respond with STRICT JSON only: {"decision":"accept|counter|reject","priceUsd":<number>,"reason":"<short why>"}`;

export async function negotiate(offer: PeerOffer): Promise<{
	result: NegotiationResult;
	source: "llm" | "rules";
}> {
	if (!config.meridian.enabled) {
		return { result: negotiateByRules(offer), source: "rules" };
	}
	try {
		const msg = await client.messages.create({
			model: config.meridian.model,
			max_tokens: 512,
			system: SYSTEM,
			messages: [{ role: "user", content: JSON.stringify(offer) }],
		});
		const text = msg.content
			.filter((b) => b.type === "text")
			.map((b) => (b as { text: string }).text)
			.join("");
		const parsed = Result.parse(JSON.parse(extractJson(text)));

		// Guardrail: never below floor; reject stays reject.
		const priceUsd =
			parsed.decision === "reject"
				? parsed.priceUsd
				: Math.max(config.price.floorUsd, parsed.priceUsd);
		return { result: { ...parsed, priceUsd }, source: "llm" };
	} catch (err) {
		console.warn(
			`[brain] negotiation LLM failed (${(err as Error).message}); using rules`,
		);
		return { result: negotiateByRules(offer), source: "rules" };
	}
}

function extractJson(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced?.[1]) return fenced[1].trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return text.slice(start, end + 1);
	return text.trim();
}
