# Tessera

**Autonomous, agent-to-agent BGP peering — negotiated, paid for, and settled on Arc.**

> In antiquity, two parties would split a *tessera hospitalis* — a token of alliance — each keeping one half. Rejoin the halves and you proved the bond. Tessera's network agents do the same: one agent pays a *tessera* (USDC on Arc) to forge a verifiable peering bond with another network.

🌐 **Live network dashboard:** https://tessera.moenet.work — watch the agents discover, negotiate, pay, and form a network in real time
🔗 **On-chain proof:** [batch settlement on Arc Testnet](https://testnet.arcscan.app/tx/0xae1a84226b44a48855cfa73c6522cffea739e61a8f091098b9064f66424ac9b7) · [Gateway Wallet](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9)
🏁 Built for **Lepton** (Canteen × Circle × Arc) — RFB 03: agent-to-agent nanopayment networks

---

## The problem

Network interconnection is stuck in the 1990s. Peering is negotiated by **email**, billed **monthly** on the **95th percentile**, priced by **bargaining power**, and "settlement-free" only if you're **big enough**. The reason is economic: real per-unit settlement was impossible — you couldn't bill a thousandth of a cent per route or per megabyte — so the industry settled for coarse proxies, big contracts, and an excluded long tail.

Academic work agrees the status quo is unfair: 95th-percentile billing misaligns with real peak contribution and is gameable; the ~2:1 traffic-ratio gate for free peering is "often irrational"; paid-peering fees track power, not value.

## What Tessera does

**Nanopayments remove the cost floor.** Tessera turns interconnection into a live market where **independent network agents act autonomously**:

1. **Discover** — an agent queries the control plane for candidate peers + the inputs it needs (latency, region, capacity, price, the peer's wallet).
2. **Decide** — Claude (Sonnet 4.6) weighs latency / region / diversity / reputation under a **budget**, and explains its reasoning. *Money safety is enforced in code, not by the model: the LLM proposes value; the orchestrator enforces the hard budget cap and price band.*
3. **Negotiate** — two-sided. The buyer opens below list; the provider's agent accepts / counters / rejects from its price band and its **reputation** of the requester. Repeat, well-behaved peers earn better prices.
4. **Pay** — gasless USDC via the **x402 protocol + Circle Gateway nanopayments** (batched settlement on Arc).
5. **Establish** — the control plane deterministically builds both sides of a **WireGuard link (link-local addressing)** and each node's agent brings up a real **eBGP** session. `birdc show protocols` reports it `Established`; real routes flow.

Run it and **five autonomous agents self-organize a full mesh of paid inter-AS peerings** — every link negotiated at its own price and settled on-chain.

## Scope & honesty (what this is, what it isn't)

**Tessera is an interconnect-and-settlement layer for decentralized / overlay network operators** — independent operators with no shared registry (RIR) relationship and no legal peering contract. For them a **wallet identity + on-chain settlement** replace the trust anchors (RIR / RPKI / legal agreements) the public internet relies on.

**This is _not_ a drop-in replacement for public-internet backbone peering.** Real default-free-zone peering has two prerequisites an agent + a payment cannot bypass: (1) **physical interconnect** — an exchange port, cross-connect, or transit; and (2) **identity & ownership** — RIR-allocated ASN/prefixes plus **RPKI** authorization of who may originate which routes (the one piece of real cryptographic trust in today's BGP). Tessera deliberately targets the world _without_ those legacy frameworks: DePIN / Web3 infrastructure meshes, multi-cloud private backbones, SD-WAN, and research / private overlays — exactly where automated, trustless interconnect + nanopayment settlement is missing today.

We don't operate a public-BGP carrier, so we use **DN42 + WireGuard as the testbed**, with testbed sub-ASNs, standing in for any overlay carrier. **The mechanism is entirely real:** real agents, real two-sided LLM negotiation, real reputation, real **x402 settlement on Arc**, and real **eBGP** sessions exchanging real routes between distinct ASNs. WireGuard here is simply the encrypted interconnect — exactly how modern overlay / encrypted-PNI peering already works.

**Known gap (roadmap): the identity layer.** A production overlay version needs an overlay RPKI / registry (as DN42 itself maintains via a git registry) to turn "pay to peer" into "_authorized_ pay to peer." And because BGP routes are transitive, our **usage-based net settlement** is also the answer to the classic transit-vs-peering question — you pay for the traffic that actually flows, not for a session merely existing.

## Substrate-agnostic by design

Tessera's value — autonomous discovery, two-sided negotiation, reputation, and nanopayment settlement — lives **above the forwarding layer**, so it isn't wedded to TCP/IP. It rides BGP + WireGuard today only because IP is the universal overlay base; the same agent / negotiation / settlement loop ports to a different routing substrate (e.g. **SCION**'s path-aware secure inter-domain routing, or name-based forwarding) by swapping just the thin "bring up a link + meter it" adapter.

This matters because the parts of networking abandoning TCP/IP — **InfiniBand, NVLink, RoCE, CXL** — are *intra-datacenter* fabrics (single operator, lossless, RDMA): a fundamentally different problem from cross-operator, wide-area interconnect, and they do no inter-domain routing at all. A future of heterogeneous fabrics and post-IP inter-domain efforts only *raises* the need for a **neutral, cross-boundary economic settlement layer** — exactly the layer Tessera occupies.

## A fairer settlement model (where this goes)

Because Gateway can net sub-cent flows and settle in batches, peering can be priced by **real metered usage** instead of coarse proxies:
- **Establishment fee** — a one-time tessera to forge the peering (implemented).
- **Continuous usage settlement** — meter real WireGuard tx/rx both ways and settle the **net** in real time, with bilateral cross-attestation so neither side can over-bill. Balanced peering nets to ~free automatically; imbalanced pays the net provider in proportion to actual usage. Fairness becomes mechanical and transparent, and the long tail can finally peer (implemented — M2b-3).

## Roadmap / vision

The coordination + settlement layer is built; these extend it (out of scope for the hackathon, but the design already points at them):

- **Substrate-agnostic forwarding** — the agent / negotiation / settlement loop sits above forwarding, so it ports beyond TCP/IP to post-IP inter-domain routing like **SCION** or name-based **NDN** by swapping only the "bring up a link + meter it" adapter (see above). A world of heterogeneous fabrics only *raises* the need for a neutral cross-operator settlement layer.
- **Trustless metering (PoB / TEE)** — usage is self-reported today and kept honest by bilateral cross-attestation. The end state replaces trust with cryptographic proof: a Proof-of-Backhaul challenger, or a TEE-signed byte counter, so the metered value is provable rather than attested.
- **Decentralized admission (stake-weighted)** — as many overlay/DePIN networks federate, new-member admission can move from a human-reviewed registry to **stake-weighted vouching** by existing members' agents — reusing the same Arc stake as the Sybil cost. (Identity/ownership of an ASN/prefix is a fact and still needs a registry/RPKI-style anchor; only the *relationship/credit/route-acceptance* trust is what gets decentralized.)

## Architecture

```
                    Control plane (moenet-core, Bun/Hono)
        ┌──────────────────────────────────────────────────┐
        │  x402 payment gate · peer discovery · session mgmt │
        │  per-node WG/LLA link builder (nodePeering)        │
        │  Postgres · Redis(RTT)                             │
        │  meridian → Claude (Haiku)                          │
        │  N× agent brains (own wallet / budget / reputation)│
        └───────┬────────────────────────────────┬──────────┘
        discover│ pay (x402)            config    │ heartbeat / RTT
        ┌───────▼──────┐                    ┌──────▼───────┐
        │  moenet-agent │◄── WireGuard ─────►│  moenet-agent │
        │  (Go)  eBGP   │   (link-local)     │  (Go)  eBGP   │
        └──────────────┘                    └──────────────┘
              one autonomous network agent per node
```

The agent's payment SDK is TypeScript-only, so the **brain** (decision + negotiation + payment) is centralized in the control plane; the Go node daemon measures latency and brings up WireGuard + BIRD.

## What we built for Lepton (the delta)

This repo is our MoeNet DN42 control plane; the hackathon work is:

- **`packages/brain/`** — the autonomous agent (new): `decide/rules` (deterministic policy), `decide/llm` (Claude via meridian), `decide/negotiate` + `broker` (two-sided negotiation), `reputation` (file-backed memory), `pay` (x402 via `GatewayClient`), `agent` (discover→decide→negotiate→pay→peer loop).
- **`packages/api/src/services/x402.ts`** — Circle Gateway payment gate (the seller side of x402).
- **`packages/api/src/services/nodePeering.ts`** — deterministic WireGuard/LLA link builder + reciprocal session creation.
- **`packages/api/src/handlers/peering.ts`** — paid peering, auto-approve, agent-negotiated price clamped into a band.
- **`packages/api/src/handlers/agent.ts`** — the peer-discovery API (`GET /api/v1/agent/:node/peers`).
- **`agent/`** (git submodule → `moenet-agent@feat/arc-x402`) — node daemon; hackathon change is per-node eBGP local-AS (`internal/task/bird_config_sync.go`, `internal/task/types.go`) so distinct ASNs peer.

## Circle / Arc stack used

**x402 protocol** · **Circle Gateway nanopayments** (`@circle-fin/x402-batching`, gasless batched USDC) · **Arc Testnet** (chain `5042002`) · **USDC** (`0x3600…0000`).

## Run the autonomous mesh

Control plane (Postgres + Redis + Bun) and a Claude endpoint (we use [meridian](https://github.com/rynfar/meridian) to bridge a Claude subscription). Then:

```bash
# control plane
cd packages/api && bun install && bun run src/app.ts   # ARC_X402_ENABLED=true

# autonomous brains (one per node identity, with its wallet + budget + JWT)
cd packages/brain
BRAIN_IDENTITIES='[{"name":"lax","nodeName":"lax","privateKey":"0x..","jwt":"..","budgetUsd":0.05}, ...]' \
  CORE_URL=http://127.0.0.1:3000 MERIDIAN_URL=http://127.0.0.1:3456 \
  bun run src/index.ts
```

Each agent discovers peers, negotiates, pays on Arc, and the nodes bring up eBGP. See `packages/brain/scripts/demo-decide.ts` and `demo-negotiate.ts` for offline decision/negotiation demos (no servers needed).

## License

Inherits the MoeNet project license.
