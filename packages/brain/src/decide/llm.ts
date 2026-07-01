/**
 * LLM-driven peering decision via meridian (Claude Max -> Anthropic API).
 *
 * Feeds the candidate table + budget + policy to Claude (Haiku), which returns
 * which peer(s) to establish and how much to pay, with a short reason that the
 * demo surfaces on screen. Any failure (proxy down, rate limit, bad JSON,
 * empty result) falls back to the deterministic rules — the demo never hangs
 * on the LLM.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import config from "../config";
import type { Decision, DecisionContext } from "../types";
import { decideByRules } from "./rules";

const client = new Anthropic({
	baseURL: config.meridian.url,
	apiKey: config.meridian.apiKey,
	// Bound each call so a hung meridian CLI child aborts instead of piling up.
	timeout: config.meridian.timeoutMs,
	maxRetries: 1,
});

const LlmDecision = z.object({
	decisions: z.array(
		z.object({
			peerName: z.string(),
			payUsd: z.number().nonnegative(),
			reason: z.string(),
		}),
	),
});

const SYSTEM = `You are the autonomous peering brain for a BGP node on a real DN42 network.
Decide which candidate node(s) to establish a paid WireGuard+BGP peering with, and how much USDC to pay each.
${config.policy}
Only choose candidates where payable=true and freeCapacity>0. Never exceed the budget.
Respond with STRICT JSON only (no prose, no markdown fences) in exactly this shape:
{"decisions":[{"peerName":"<name>","payUsd":<number>,"reason":"<short why>"}]}
Pay each chosen peer its priceUsd. Keep each reason short and decision-relevant (cite latency / region / hops / price / capacity).`;

function buildPrompt(ctx: DecisionContext): string {
	const candidates = ctx.candidates.map((c) => ({
		name: c.name,
		regionCode: c.regionCode,
		sameRegion: c.sameRegion,
		latencyMs: c.latency?.rtt_ms ?? null,
		lossPct: c.latency?.loss ?? null,
		hopCount: c.hopCount ?? null,
		priceUsd: c.priceUsd,
		freeCapacity: c.capacity.available,
		payable: c.payable,
	}));
	return JSON.stringify(
		{ self: ctx.self, budgetUsd: ctx.budgetRemainingUsd, candidates },
		null,
		2,
	);
}

export async function decide(
	ctx: DecisionContext,
): Promise<{ decisions: Decision[]; source: "llm" | "rules" }> {
	if (!config.meridian.enabled) {
		return { decisions: decideByRules(ctx), source: "rules" };
	}

	try {
		const msg = await client.messages.create({
			model: config.meridian.model,
			max_tokens: 1024,
			system: SYSTEM,
			messages: [{ role: "user", content: buildPrompt(ctx) }],
		});

		const text = msg.content
			.filter((b) => b.type === "text")
			.map((b) => (b as { text: string }).text)
			.join("");

		const parsed = LlmDecision.parse(JSON.parse(extractJson(text)));

		// Guardrails: map names -> uuids, drop non-payable / over-budget picks,
		// never pay more than the quoted price.
		const byName = new Map(ctx.candidates.map((c) => [c.name, c]));
		const decisions: Decision[] = [];
		let budget = ctx.budgetRemainingUsd;
		for (const d of parsed.decisions) {
			const cand = byName.get(d.peerName);
			if (!cand || !cand.payable || cand.capacity.available <= 0) continue;
			const pay = Math.min(d.payUsd, cand.priceUsd);
			if (pay > budget) continue;
			decisions.push({
				peerUuid: cand.uuid,
				peerName: cand.name,
				payUsd: pay,
				reason: d.reason,
			});
			budget -= pay;
		}

		if (decisions.length === 0) {
			return { decisions: decideByRules(ctx), source: "rules" };
		}
		return { decisions, source: "llm" };
	} catch (err) {
		console.warn(
			`[brain] LLM decision failed (${(err as Error).message}); using rules`,
		);
		return { decisions: decideByRules(ctx), source: "rules" };
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
