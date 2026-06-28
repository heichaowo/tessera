# Tessera — Proofs

Everything below is **real and verifiable on Arc Testnet**. The transaction
hashes are permanent on-chain records — click any link.

- **Live dashboard:** https://tessera.moenet.work
- **Repo:** https://github.com/heichaowo/tessera
- **Chain:** Arc Testnet (`chainId 5042002`, `eip155:5042002`) · Explorer: https://testnet.arcscan.app

---

## Scope — what this is, and what it isn't

Tessera is a **trustless interconnect-and-settlement layer for decentralized /
overlay network operators** — independent operators with no shared registry (RIR)
relationship and no legal peering contract, whose agents discover each other,
negotiate, settle in USDC on Arc, and stand up real eBGP-over-WireGuard
interconnect. A **wallet identity + on-chain settlement** stand in for the trust
anchors (RIR / RPKI / legal agreements) that such networks lack.

**It is _not_ a replacement for public-internet backbone peering.** Real
default-free-zone peering has two prerequisites an agent + a payment cannot
bypass: (1) physical interconnect — an exchange port, cross-connect, or transit;
and (2) identity & ownership — RIR-allocated ASN/prefixes plus **RPKI**
authorization of who may originate what. Tessera deliberately targets the world
_without_ those legacy trust frameworks: DePIN / Web3 infrastructure meshes,
multi-cloud private backbones, SD-WAN, and research / private overlays. **DN42 +
WireGuard is our testbed**, standing in for any overlay carrier; the
agent / payment / settlement mechanism is 100% real.

**Known gap (roadmap):** an overlay identity layer — an overlay RPKI / registry
(as DN42 itself maintains via a git registry) — to turn "pay to peer" into
"_authorized_ pay to peer." And because BGP routes are transitive, paying for a
single session raises the classic transit-vs-peering question, which our
**usage-based net settlement** answers directly: you pay for the traffic that
actually flows, not for "a session existing."

---

## What to verify in 60 seconds

1. Open the **live dashboard** — 5 autonomous network agents (LAX, LAS, FRA, BERN, HK),
   a live globe of paid eBGP peerings, live per-node traffic, live LLM negotiations,
   and per-event usage settlements.
2. In **Usage net settlements**, click any **`memo ↗`** — it opens a real Arc
   transaction whose data is a human-readable settlement memo.
3. Click **`▶ Simulate a cheating agent`** — watch bilateral cross-attestation flag
   the discrepancy while billing stays on the conservative value; click **`↻ reset`**.
4. Everything reconciles on-chain. No mocks.

---

## On-chain proof

### Circle / Arc contracts used

| Contract | Address |
|---|---|
| USDC (ERC-20, 6dp) | [`0x3600…0000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| Circle Gateway Wallet (x402 batch settlement) | [`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9) |
| Arc Memo contract (on-chain audit) | [`0x9702466268ccF55eAB64cdf484d272Ac08d3b75b`](https://testnet.arcscan.app/address/0x9702466268ccF55eAB64cdf484d272Ac08d3b75b) |

### Layer 1 — Peering establishment fees (x402 + Gateway, batch-settled)

Agents negotiate a price (Sonnet 4.6) and pay an establishment fee in USDC via Circle's
x402 + Gateway. Sub-cent payments are netted off-chain and finalized on Arc in a batch:

- **Batch settlement tx:** [`0xae1a84226b44…ac9b7`](https://testnet.arcscan.app/tx/0xae1a84226b44a48855cfa73c6522cffea739e61a8f091098b9064f66424ac9b7) (`submitBatch`, block 48601019)

### Layer 2 — Usage-based net settlement, with an on-chain Memo per settlement

Real per-tunnel traffic is metered, netted between peers (net receiver pays), and
settled per-event. Each settlement writes a human-readable audit memo on-chain via
the Arc Memo contract. Sample memo transactions (open them — the input decodes to
`Tessera M2b-3 usage settlement | X -> Y | net N MB | $A | cross-attested OK | ...`):

| Settlement | Memo transaction |
|---|---|
| fra → lax | [`0x8a7f6451…2483`](https://testnet.arcscan.app/tx/0x8a7f64518d098072315ab27bfd96edd65778325bcbeaf0904286178454452483) |
| fra → las | [`0x6ffedac1…8951`](https://testnet.arcscan.app/tx/0x6ffedac17d1bcaa90604e3acb85d8a6cd139d2cfe603818137233cd9c0978951) |
| fra → bern | [`0x5641c5ae…51c8`](https://testnet.arcscan.app/tx/0x5641c5ae38d550eeab8f681757040c21f6a6143bc022792029d59fb5062351c8) |
| bern → lax | [`0x9d5f31b0…abdb`](https://testnet.arcscan.app/tx/0x9d5f31b094abd1182adb85a2375e6471ffef0e77aadac0f110002754eae1abdb) |
| hk → las | [`0x75da623b…3100`](https://testnet.arcscan.app/tx/0x75da623b1f29557cf19d8d3f42016bb9bffdb75b45fc3ce2f1b79f41876b3100) |
| hk → fra | [`0xfccff5cd…2655`](https://testnet.arcscan.app/tx/0xfccff5cd4b77329c624ebe6719af2cc2f845e5dede7fce72f24d5e6300202655) |

> The live dashboard's **On-chain ↗** column links the current settlements' memos.
> The hashes above are permanent regardless of what's currently on screen.

### Autonomous agents — wallets & ASNs

Each node is an independent agent with its own EOA wallet and testbed ASN. Click a
wallet to see its real USDC `deposit` / settlement activity on Arc:

| Node | ASN | Wallet |
|---|---|---|
| LAX | AS4242421001 | [`0x9938…3C7E`](https://testnet.arcscan.app/address/0x9938948884D67bA2D1a123e9d8e612a5E4A13C7E) |
| LAS | AS4242421002 | [`0xEC3F…6e5C`](https://testnet.arcscan.app/address/0xEC3FC32431AA97d28897B571731975BdAEF56e5C) |
| FRA | AS4242421003 | [`0xfD83…e42A`](https://testnet.arcscan.app/address/0xfD8389b123E2c29A7C126b94B82a2c5a6660e42A) |
| BERN | AS4242421004 | [`0xC6e7…eaA7`](https://testnet.arcscan.app/address/0xC6e770f3f9E6C2c5aa7E53e8caeD86016759eaA7) |
| HK *(large-provider node)* | AS4242421005 | [`0x40D9…eFF6`](https://testnet.arcscan.app/address/0x40D90B72Feb467C8bb98Cdf5D84720d15e7aeFF6) |

Funder (distributed test USDC to the agents): [`0xe1A5…Ca809`](https://testnet.arcscan.app/address/0xe1A50f55373F97421c4eC39B82d0d6cd502Ca809)

---

## Real data plane (not a simulation of BGP)

The agents establish **real eBGP-over-WireGuard** sessions between distinct ASNs —
a full **5-node, 10-pair mesh** (20/20 directional BGP sessions up). HK is the
**large-provider hub**: all four other agents independently discovered it,
negotiated (Sonnet 4.6), and each **paid HK an establishment fee** to peer it —
*others connect to the large provider, not the reverse* — including HK↔LAX across
the Pacific. Those four inbound establishment fees are visible on HK's wallet
(see table above). On any node:

```
birdc show protocols | grep dn42_
# → dn42_4242421003  BGP  up  Established   (and the rest of the mesh)
```

---

## Trust model (don't-trust-self-report)

Usage is self-reported, so it is **not** trusted blindly:

1. **Bilateral cross-attestation** — both ends report each tunnel; the control plane
   bills on `min(sender_tx, receiver_rx)` (a payee can't inflate; loss is billed to
   no one) and enforces the physical invariant `received ≤ sent`.
2. **Discrepancy flagging + reputation** — gaps beyond a loss band are flagged; the
   `Simulate a cheating agent` button on the live site demonstrates it catching an
   agent that over-reports, with funds protected by the conservative settle value.
3. **On-chain audit** — every settlement's attested net is written as an Arc Memo.

This is strictly stronger than traditional interconnection, which has **no**
cryptographic trust either (bilateral measurement + legal dispute) — automated here,
sub-cent, and tamper-evident.

---

## Honest disclaimer

Real public BGP runs over physical/IX links with registered ASNs and **no WireGuard
tunnel**. We have no public-BGP carrier, so we use a **DN42 + WireGuard testbed**
with testbed sub-ASNs (4242421001–05) to model independent operators. **The mechanism
is 100% real**: autonomous discovery → multi-factor decision → two-sided LLM
negotiation → x402 on-chain payment → real eBGP peering → metered usage settlement.
In production the same logic meters the real data-plane interface (physical port /
sFlow / NetFlow) instead of the WireGuard tunnel — same mechanism, different carrier.
