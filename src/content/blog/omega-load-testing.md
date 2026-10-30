---
title: "We wanted 1000 players on one server. The first build broke near 190."
description: "The networking math, the bytes on the wire, and what load-testing our Rust game server could actually prove."
pubDate: "2026-10-30"
coverImage: "/journal/omega-load-testing/cover.webp"
coverAlt: "Blue particles accumulating at a narrow aperture, a conceptual networking bottleneck."
coverCaption: "Conceptual editorial illustration · AI-generated · not measured data"
workingDraft: true
---

> **Working draft.** This is the single-article version of the Omega load-testing story. `[MEASURE]` marks data we do not yet have. Open framing and evidence caveats remain visible; the fixed build's capacity beyond the recorded observations is unknown.

<details class="article-contents">
<summary>In this article</summary>

- [Five ramps, one wall](#0-cold-open-five-ramps-one-wall)
- [What Omega is](#1-what-omega-is-and-what-we-set-out-to-prove)
- [The ceiling everyone hits](#2-the-ceiling-everyone-hits)
- [The replication math](#3-the-math-of-sending-a-world-to-n-players)
- [Tab-target MMOs](#4-how-tab-target-mmos-put-hundreds-on-screen)
- [The wire format](#5-omegas-wire-format-bit-by-bit)
- [How we load-tested it](#6-how-we-load-tested-it)
- [Results](#7-results)
- [Which wall did we hit?](#8-which-wall-did-we-hit)
- [Conclusion](#9-conclusion)
- [Appendix A: formula sheet](#appendix-a-formula-sheet)
- [Appendix B: bit layouts](#appendix-b-full-bit-layouts)
- [Appendix C: reproduction](#appendix-c-how-to-reproduce)
- [Appendix D: sources](#appendix-d-sources-grouped-by-section)

</details>

## 0. Cold open: five ramps, one wall

We asked a small ARM server for 200 players. It reached 191 before new players started timing
out. We asked for 250 and it reached 185. Then 500 gave 176, 750 gave 180, and 999 gave 190.

Five join ramps, five requested sizes spread over a factor of five, and every one of them stopped
in the same 15-player band. The server was a Hetzner CAX11: two shared Arm vCPUs, 4 GB of RAM, in
Falkenstein, quoted at the time at $6.99 a month plus $0.60 for an IPv4 address, **$7.59 a month**.
A second CAX11 in the same zone ran the bots. ([Original checkpoint][cax11-conclusion].)

> **Draft note.** The $7.59 is the historical conditional quote retained by the campaign, not a verified
> current price.

The failure had the same shape every time. First the game host's kernel started dropping UDP
datagrams because the socket's receive buffer was full. That happened at **131–164 players**, while
the game process was using only **57–76% of one core**. Later the process CPU climbed to about one
full core, players dropped, new joins timed out, and the controller aborted.

That band sits right next to the numbers the industry ships. Warzone launched at 150 players.
PlanetSide 2 caps a continent at 250 per faction. Star Citizen ran about 100 per server before
server meshing. Battlefield, after trying 128, went back to 64. Is that a coincidence?

This article argues it isn't. The cap falls out of arithmetic, and you can watch the arithmetic
happen in our own bytes.

One warning before we start: **191, 185, 176, 180 and 190 are the peak connected-player counts
from those five attempts, not sustainable player capacities.** Each test gradually added bots—a
"join ramp"—toward its requested population. All five failed before reaching the five-minute
measurement window. The data supports "our first build's attempts to fill the server broke around
180–190 authenticated players." It doesn't establish that a $7.59 server can reliably sustain 190
players.

Eight days later, after a round of correctness fixes to the server, the client and our own
measurement code, a fixed build held **150 players for five clean minutes**. Its 200-player attempt
failed in a way we couldn't measure, because the bot host was dropping packets too. So the fixed
build's ceiling is **unknown**, and saying so is part of the story.

![F1. Game and bot CPU (100% = one logical CPU) and authenticated population during each of the five Strategy ramps. Original build.](/journal/omega-load-testing/strategy-extension-timelines.png)

*F1. CPU and population per Strategy ramp, original build. Source: [Strategy extension report][strategy-ext].*

---

## 1. What Omega is, and what we set out to prove

Omega Realm is a top-down 2D bullet-hell shooter. Its gameplay is minimal on purpose: three
Classes, a shooting attack and one ability each, HP and nothing else, and one monster type. The
game exists to stress-test netcode. The question behind it is whether one server **Instance** (one
running copy of a map) can hold **500–1000 concurrent realtime players**.

The architecture, in one paragraph:

- **`omega-server`** is a Rust binary with a **single-threaded, fixed 30 Hz Tick**. One thread runs
  the simulation, services the network, encodes Snapshots and flushes them.
- Transport is **ENet over UDP**, through the `rusty_enet` crate pinned at 0.4.0 (a Rust transpile
  of ENet 1.3.18). There are three channels: ch0 unreliable sequenced (Snapshots, input confirms),
  ch1 reliable ordered (Baselines, Game events, auth), ch2 unreliable sequenced (client input).
- A Rust crate, **`sim_core`**, holds movement, collision and hit logic. The server runs it, and the
  Godot client runs the same compiled code for prediction through a GDExtension, so the two can't
  diverge.
- The governing rule: **the client requests, the server decides.**

The rest of the article uses a few terms exactly:

| Term | Meaning here |
|---|---|
| **Tick** | One step of the server's authoritative simulation. Ours is 30 Hz, so 33.3 ms. |
| **Frame** | One client render. Not a Tick. |
| **Snapshot** | One replicated world-state message from the server to one client. Ours go out once per Tick. |
| **Baseline** | A full-state Snapshot that later delta Snapshots are encoded against. |
| **AoI** | Area of Interest: the region around a player whose entities that player is sent. |
| **Game event** | A one-shot authoritative occurrence (shot fired, damage, kill), separate from Snapshots. |
| **Instance** | One running copy of a map. The load tests use one Arena Instance, 2000 × 2000 units. |

This article doesn't cover how the game *feels*: prediction, interpolation and render smoothness
are separate work. It is about how many players one Instance can carry, and why.

---

## 2. The ceiling everyone hits

Look at enough realtime games and the same picture comes up. Player caps aren't usually set by one
hard limit. They come from a **fixed CPU budget per Tick** (1/tick-rate seconds, shared by
however many matches you pack onto a core) set against **per-Tick work that grows faster than N**.
Studios trade tick rate against player count against matches per core, then pick a design number
somewhere below the technical ceiling.

| Game | Players | Tick / update rate | What the studio said | Tag |
|---|---|---|---|---|
| Quake III Arena (1999) | `MAX_CLIENTS 64 // absolute limit` | `sv_fps` 20 | Hard-coded in [`q_shared.h`][q3-shared] | [P] |
| Source engine (2004–) | 32 by design, 255 absolute | 66.67 | "really designed for 32 or less players" ([SDK `shareddefs.h`][sdk-shareddefs]) | [P] |
| Apex Legends (2019) | 60 | 20 Hz | ~60 kB/s per client; 60 Hz "would consume 180kB/s" ([Respawn][apex]) | [P] |
| Valorant (2020) | 10 | 128 | ≥3 games per core, 2.34 ms per frame ([Riot][val-128]) | [P] |
| Fortnite (2017) | 100 | 20 → 30 Hz | Per-actor-per-client relevancy "will bottleneck the server's CPU" ([Epic][ue-repgraph]) | [P] |
| Warzone (2020) | 150 → 100 → 120 | ~20 Hz (community) | 150 "works best for the mode" ([Charlie INTEL][wz-150]) | [S] |
| Battlefield 4 (2013) | 64 | 30 default, ≤60 at 64 players | 64 players: one Instance per box, 60 Hz max ([DICE PDF][bf4-hitick]) | [P] |
| Battlefield 6 REDSEC (2025) | 100+ | 30 Hz, "60hz for the final fight" | "They were not running 100 players" ([Insider Gaming][bf6-ig]) | [S] |
| Star Citizen 4.0 (2024) | ~100 per server, 500 per shard | n/p | Server meshing splits authority across processes ([RSI][sc-eptu]) | [S] |

Tags: [P] primary source read directly, [S] first-party statement read through the press, [D]
our arithmetic. The full 20-row table, with every source, is in
[`realtime-player-caps.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/realtime-player-caps.md).

### The cleanest number in the set: Valorant

Riot published the arithmetic. At 128 Hz a Tick lasts 7.8125 ms. Riot needed better than three
games per core to make hosting affordable ("a single game per core would be prohibitively
expensive"), and reserved 10% for the OS, which left **2.34 ms per game per Tick** for 10 players.
A 36-core host runs 108 games, or 1,080 players. ([Riot, 128-tick servers][val-128].)

**D1, the yardstick [D].** 1,080 players ÷ 36 cores = **30 players per core at 128 Hz**, or
30 × 128 = **3,840 player-Ticks per core-second**. Rescaled naively to 30 Hz, that is
3,840 / 30 = **128 players per core**. We'll hold our own numbers up against this in §7. The
rescale is naive on purpose: it assumes per-player cost is constant in N, and the rest of this
article is about why it isn't.

### Why the work grows faster than N

The recurring reasons, in rough order of how often studios name them:

1. **Relevance fan-out is O(N²) per Tick.** Every player is both an observer and something
   observed. If everyone is relevant to everyone, the server must decide, serialise and send about
   N × (N − 1) entity records per Tick. Epic's Replication Graph exists because stock Unreal
   replication checks every actor against every connection, which at Fortnite's 100 players and
   ~50,000 actors "will bottleneck the server's CPU" ([Epic][ue-repgraph]).
2. **The CPU budget per Tick is fixed.** Overrun it and the tick rate drops, or the clock dilates.
3. **Lag-compensated hits multiply with N.** Source keeps "a history of all recent player positions
   for one second" and rewinds "all other players" for every shot ([Valve wiki][vw-smn]). The work
   per shot grows with N, and so does the number of shots.
4. **Downstream bandwidth per client grows with visible entities × rate.** Apex measured about
   60 kB/s per client at 20 Hz and said 60 Hz would mean 180 kB/s: "for triple the bandwidth and
   CPU costs, you can save two frames worth of latency" ([Respawn][apex]).
5. **A Snapshot wants to fit in one datagram.** Lose one fragment of an unreliable Snapshot and the
   whole Snapshot is gone. Quake III caps packets at 1,400 B; Valve's GameNetworkingSockets at 1,300 B.

Two pressures sit on top. Players now expect 60–128 Hz, and every doubling of tick rate halves the
per-Tick budget. And the weakest *client* still has to render, animate and simulate every visible
character: EA kept last-gen consoles at 64 players in Battlefield 2042 to keep "performance stable
for older systems" ([EA FAQ][bf2042-faq]).

### Battlefield: 64 as a design choice, paid for in tick rate

Battlefield is the useful counterexample, because DICE has said in public that the engine could go
higher.

- 2011, DICE CEO Patrick Söderlund: "Technically, we can go to 256, we've tried it. We play tested
  with 128." And: "tested 128 and that it's not fun… there's no point in going higher than 64."
  ([GameRevolution][bf3-256], [S])
- Battlefield 2042 shipped 128-player modes, then removed 128-player Breakthrough in Update 4.1
  because "the value and impact of an individual player, and squad is reduced due to the increased
  intensity and chaos of the combat" ([EA patch notes][bf2042-41], [P]). Battlefield 6 went back to
  64 because 128 "didn't catch on" ([PC Gamer via inkl][bf6-64], [S]).

No first-party DICE or EA source gives CPU or bandwidth as the reason for 64. But the tax is
visible in the tick rate. DICE's 2015 guidance for Battlefield 4 high-tickrate servers, verbatim
([EA-hosted PDF][bf4-hitick], [P]):

- "For 64 player servers we recommend a single instance per hardware, limiting max tickrate to 60hz"
- "For 48/32 player slots we recommend half the number of instances running per hardware (normally
  translates to 2 instances instead of 4 per server)"; "limiting the max tickrate to 120hz"
- "Normally, servers in Battlefield 4 run at 30hz"

**[D]** The "normally 4" is the density at the 30 Hz default. So per box, 4 × 64 × 30 =
**7,680 player-Ticks per second at 30 Hz**, against 1 × 64 × 60 = **3,840 at 60 Hz**. Doubling the
tick rate of a 64-player server costs **four times the hardware per match**, not two. That is
what you expect when each player's Snapshot covers every other player: cost goes as N · k · f, and
k ≈ N − 1.

Why is k ≈ N − 1 in Battlefield? Because the game is built that way. Open combined-arms maps, jets,
artillery and long sightlines mean a player can see, spot, shell or be shot by most of the server.
The only first-party relevance mechanism we found is Battlefield 4's 2014 "High Frequency Bubble",
which sends *more often* to players inside a radius ([Battlelog][bf4-hfb], [P]). It changes the
rate. It isn't a cull. Nothing first-party says Battlefield ever stops sending distant players.

So DICE's levers are N (picked on design grounds) and f (picked on cost grounds). REDSEC, the
Battlefield 6 battle royale, shows both at once: 100+ players at 30 Hz, stepping up to 60 Hz "for
the final fight" once most players are dead ([Sirland][bf6-x30]).

> **Draft note.** The reading "DICE picks N on design and f on cost" is our inference from the sources,
> not a DICE statement. Details: [Battlefield/Rust research note][fps-caps].

### The tech sets the ceiling, design picks the point

The public reason for a cap is very often design, even where the tech could go higher. MAG picked
256 "for game design reasons" and said its architecture "could increase the number players well
beyond" ([PlayStation Blog][mag-psblog]). Raven moved Warzone to 100 for "time-to-action, the map
size… circle timings… total match time" ([TechRadar][wz-100], [S]). The networking ceiling decides
whether a number is possible. Design decides where under it to land.

The few games that get well past ~150 do it by **changing the rules**. Star Citizen splits a world
across server processes (500 players across 8–10 servers is about 50–60 per process [D]). EVE
slows its game clock to 10% speed. Tab-target MMOs change what combat needs from the network. §4
takes those apart. First, the arithmetic.

---

## 3. The math of sending a world to N players

This section derives the formulas. The point it builds to: **bit-packing and delta compression
are constant factors. Only AoI changes the exponent.** The full derivations, with every RFC and
source-file reference, are in [`replication-math.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/replication-math.md); the formula
sheet is Appendix A.

| Symbol | Meaning |
|---|---|
| N | connected players on one Instance |
| k | entities in one client's Snapshot (its visible set) |
| b_e | bits per entity record |
| H_s | Snapshot header bytes (per datagram) |
| H_d | per-datagram overhead below the game (IP + UDP + ENet) |
| f | Snapshot rate, Hz |
| L | max game payload per datagram |
| d | datagrams per Snapshot |

### D2: what each datagram costs before your first byte

An unreliable ENet message alone in an IPv4 datagram carries:

```
H_d = IPv4 20 + UDP 8 + ENet header 2 + SEND_UNRELIABLE command 8 = 38 B
```

The 20 and 8 come from RFC 791 and RFC 768. The ENet sizes come from the `#[repr(C, packed)]`
structs in `rusty_enet` 0.4.0, which match upstream `protocol.h`. ENet's header grows to 4 B when
the datagram carries a reliable command, so the worst case on IPv6 (40 B header, RFC 8200) is
40 + 8 + 4 + 8 = **60 B**.

That overhead is fixed per send, so it dominates small packets. Our 22-byte input packet is
38 / (22 + 38) = **63% header** on IPv4. A 1,200-byte Snapshot is 3.1% header.

### D3: where "1200 bytes" comes from

IPv6 requires every link to carry at least 1,280 octets (RFC 8200 §5). Subtract the worst-case
headers:

```
L_max = 1280 − 40 (IPv6) − 8 (UDP) − 4 (ENet header) − 8 (SEND_UNRELIABLE) = 1220 B
```

So **L = 1200 B** leaves 20 B spare on the strictest legal path. QUIC derives the same rule from the
same numbers (RFC 9000 §14), and Glenn Fiedler gives the same game-side advice: 1,000–1,200 bytes of
payload ([Gaffer On Games][gaffer-frag]). ENet's own fragmentation threshold is higher, at
1392 − 4 − 24 = 1,364 B, and an unreliable packet above it becomes *reliable* fragments by default.
That's the head-of-line-blocking trap a 1,200-byte cap protects against.

### D4: bits per number

A value in a range of width `range`, sent with step `q`, needs

```
bits(range, q) = ceil( log2( range / q + 1 ) )
```

Our Arena is 2,000 units wide, quantized to 0.1 u: ceil(log2(20,001)) = **15 bits**. We send 16
(an i16), one bit over the minimum. Each 10× gain in precision costs about log2(10) ≈ 3.3 bits per
component.

### D5: downstream per client, and egress for the server

```
records per datagram   r = floor( (L − H_s) · 8 / b_e )
datagrams per Snapshot d = ceil( k / r )
down per client        D = f · ( ceil(k · b_e / 8) + d · (H_s + H_d) )
server egress          E = N · D
```

Drop the per-datagram terms and the headline is **bytes/s ≈ k × bytes per entity × f**, per client.
Then:

- **Naive broadcast**, everyone sees everyone: k = N − 1, so E = Θ(N²). Going from 64 to 1000
  players multiplies N(N − 1) by 999,000 / 4,032 = **248×**.
- **AoI**, each client only gets entities within radius R. With uniform density ρ = N / A,
  k ≈ min(N − 1, ρπR², k_max), and E = Θ(N · k). Once k saturates, egress is *linear* in N.

**One case, step by step [D].** N = 1000 at 30 Hz, naive broadcast, our full 63-bit player record,
IPv4, H_s = 12 B:

```
k = 999
r = floor((1200 − 12) × 8 / 63)      = 150 records per datagram
d = ceil(999 / 150)                   = 7 datagrams per Snapshot
payload P = 6 × (12 + 1182) + (12 + 780) = 7,956 B
wire W = P + 7 × 38                    = 8,222 B per Snapshot
D = 30 × 8,222                         = 246.7 kB/s ≈ 1.97 Mbit/s per client
E = 1000 × D                           ≈ 1,973 Mbit/s ≈ 2.0 Gbit/s
datagrams/s = 1000 × 7 × 30            = 210,000
```

With AoI capped at 64 entities, the same Instance needs d = 1, W = 554 B, D = 16.6 kB/s, and
E ≈ **133 Mbit/s**: 14.8× less, close to the asymptotic 999 / 64 = 15.6×.

**F2 data: server egress vs N, our 63-bit records [D].** Players only; projectiles and monsters add
on top with the same formula.

| N | 30 Hz naive | 30 Hz AoI-64 | 60 Hz naive | 60 Hz AoI-64 | Datagrams/s, 30 Hz naive |
|---:|---:|---:|---:|---:|---:|
| 16 | 0.6 Mbit/s | 0.6 | 1.3 | 1.3 | 480 |
| 32 | 2.3 | 2.3 | 4.5 | 4.5 | 960 |
| 64 | 8.4 | 8.4 | 16.8 | 16.8 | 1,920 |
| 100 | 19.9 | 13.3 | 39.8 | 26.6 | 3,000 |
| 150 | 44.1 | 19.9 | 88.1 | 39.9 | 4,500 |
| 200 | 80.1 | 26.6 | 160.1 | 53.2 | 12,000 |
| 500 | 495.8 | 66.5 | 991.7 | 133.0 | 60,000 |
| 1000 | 1,973.3 | 133.0 | 3,946.6 | 265.9 | 210,000 |

<figure id="f2" class="article-figure">
<a href="/journal/omega-load-testing/F2-egress.png" aria-label="Open F2 at full size"><img src="/journal/omega-load-testing/F2-egress.png" alt="F2. Derived server-egress model from the four columns above. Log–log axes; 1 Gbit/s marked. Players only; not a load-test result." loading="lazy" decoding="async" /></a>
<figcaption>F2. Derived server-egress model from the four columns above. Log–log axes; 1 Gbit/s marked. Players only; not a load-test result. <a href="/journal/omega-load-testing/F2-egress.png">Open full size ↗</a></figcaption>
</figure>

How to read it:

- **Tick rate is linear.** 30 → 60 Hz doubles everything.
- **Bit-packing is a constant factor.** Going from a naive 16-byte record (u16 id, three f32, u16
  state) to our 63 bits saves about 2×. Delta compression adds about 1.25× more when everything
  moves (§5).
- **AoI is the only lever that changes the exponent.** At 1000 players, naive broadcast needs 2–4
  Gbit/s of egress at 30–60 Hz, more than one 1 Gbit/s port. AoI-64 needs 0.13–0.27 Gbit/s.
- **Packets per second matter too.** ENet sends at least one datagram per peer per flush, so the
  floor is N × f datagrams per second, and every one is a syscall and kernel work. Naive 1000 at
  60 Hz is 420,000 datagrams per second.

### D6: the transfer bill

1 Gbit/s sustained is 125 MB/s × 2,592,000 s ≈ **324 TB per 30-day month**. So even the AoI-64
case at 133 Mbit/s is about **43 TB a month**. Many VPS plans meter transfer in single-digit TB, so
the egress bill can bind before the link speed does.

### The CPU side of the same formula

Bandwidth is only half of it. The work per Tick is roughly

```
C_tick ≈ C_sim(N, projectiles)       movement, collision, hit checks
       + N · C_aoi                   each client's visible-set query
       + Σ_i k_i · c_rec              serialise k records per recipient   → O(N · k)
       + N · d · c_send               ENet framing and one sendto() per datagram
```

against a budget of 1000 / f_tick ms: **33.3 ms at 30 Hz**. Record writes per Tick are N · k:
999,000 for naive 1000 players, 64,000 with AoI-64. The per-record cost `c_rec` isn't a citable
constant (it depends on your encoder), but as an **illustration only**, at 50 ns per record naive
1000 players costs about 50 ms per Tick in serialisation alone. That blows the 30 Hz budget on one
thread before the simulation has run. AoI-64 costs about 3.2 ms.

### Two caveats

**Delta compression buys less than you'd hope in a shooter.** Delta encoding sends only what
changed since a Baseline. In a bullet hell almost everything moves every Tick, so you still send
almost every position. Our position-only delta record is 49 bits against a 63-bit full record: a
22% saving when everyone moves. It pays off on slow fields (flags, animation, HP) and idle
entities, not on positions.

**AoI isn't magic.** If everyone crowds into one radius (a boss fight, a town square), ρπR² → N
and you're back at Θ(N²). Only a hard cap on k (a byte budget plus priorities) bounds that case.
Plan capacity for the crowd, not the average.

### The real-world AoI example: Rust's 1000-player servers

Rust (Facepunch) is the game people point to when they say a realtime game *can* hold 1000 on one
server. It does, and the math says why. The details are in the
[Battlefield/Rust research note][fps-caps].

- **The relevance model is a hard spatial cull.** Facepunch, 2014: "the world is divided into a grid
  for network reasons. A player is only sent the objects in adjacent cells" ([Devblog 16][rust-fd16],
  [P]). Cells are 32 m and the default far radius is 8 cells, so the subscribed area is a
  544 m square whose corners reach about 360 m. Facepunch calls about 350 m "the size of a default
  network grid" ([Maintenance][rust-maint], [P]). Terrain occlusion culls further.
- **Facepunch keeps R small on purpose.** On extending the network range at sea: "We can't afford
  to do that on the mainland because of player and entity density" ([Shipshape][rust-ship], [P]).

**[D] k for players.** A 4,500 m map is 20.25 km² (including ocean). At N = 1000, ρ ≈ 49 players per
km². With R = 256–350 m, k = ρπR² ≈ **10–19** players. Assume only half the map is land and it
doubles to 20–38. Against N − 1 = 999, that is a 26–98× cut. Even a 100-player crowd at one
monument only raises k for those 100 clients; total replication work stays about 40× below naive
broadcast.

Three qualifications keep this honest:

1. **Rust's "1000" is a wipe-day peak.** Facepunch's own servers cap at 250–400. Community servers
   that touch 1,000–1,600 on wipe day average 150–340 over the week ([O], Rustalyzer, 2026-10-15).
2. **Rust's k is dominated by entities, not players.** Servers hold 150,000–362,299 entities
   (bases, deployables, drops) ([P]). The 2026 per-entity network ranges exist to shrink *entity* k.
3. **The limit Facepunch reports is server CPU per frame, not bandwidth.** "We spend about 19ms to
   process all 200 connected players in a server tick" ([Crafting Update][rust-craft], [P]). And
   bandwidth is small: one commit saved ~105 KB/s, described as 6%, on a 122-player server, which
   implies about **14.3 kB/s per player** [D]. At 1000 players that is roughly 115 Mbit/s, far
   inside one port.

So AoI is what moves Rust from Θ(N²) to Θ(N · k). It gets 1000 players past the bandwidth wall.
It doesn't get them past the CPU wall, which in Facepunch's own numbers sits at a few hundred.
Rust also escapes the fixed-Tick budget: there is no global Tick, and server FPS is allowed to sag
(25–98 observed). Battlefield, at the other end, sets k = N − 1 by design and pays in f.

---

## 4. How tab-target MMOs put hundreds on screen

If the math is that harsh, how does World of Warcraft put 1,500 players in one zone? The short
answer: **it doesn't beat N². It pays it less often, per entity, and it designs combat that
tolerates the server being late.** Full sources: [`mmo-scaling-tab-target.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/mmo-scaling-tab-target.md).

### D7: Blizzard did the arithmetic in public

In 2020 Blizzard rebuilt the Ahn'Qiraj gate event for WoW Classic and explained why it was hard
([Blizzard, Engineer's Workshop][blz-aq]):

> "In this group of 20, the server processes 380 packets (20 total players * 19 recipients = 380
> packets)." … "1,500 players then 2,248,500 packets"
>
> "What we faced is a polynomial problem, which means we can't solve it by throwing faster hardware
> at it because hardware's not exponentially better. Instead, we have to handcraft the optimization
> by deliberately choosing which data should be communicated to players and how often."

Check: 1,500 × 1,499 = 2,248,500. That is the same N(N − 1) fan-out from §3.

### The lever is the latency budget

Each genre has a budget: how late the authoritative result can arrive before combat feels broken.
Claypool & Claypool's measurements put it at about **100 ms** for first-person shooters, **500 ms**
for third-person RPGs, and **1000 ms** for omnipresent games ([CACM 2006][claypool]). Every MMO
scaling trick spends that budget.

- **WoW batched on purpose for ten years.** Blizzard's Celestalon, 2014: "Any action that one unit
  takes on another different unit used to be processed in batches every 400ms" ([Blizzard
  forums][celestalon]). Players treated mutual Polymorphs and posthumous heals as quirks.
- **The global cooldown caps the action rate.** Most abilities share a 1.5 s cooldown (0.75 s at the
  haste floor), so nobody acts more than about once a second.
- **No Lag compensation.** A heal or a target-locked missile resolves against a unit ID on the
  server. Nothing aims at a position the shooter saw 80 ms ago, so there is no rewind buffer and
  no per-shot rewind cost.
- **Movement is sparse and event-driven.** 2007 packet traces show WoW clients on TCP with
  inter-arrival peaks around 200 and 300 ms ([Molnár & Szabó][molnar]). Under the AQ load Blizzard
  went further: dropping facing updates and sending player movement "only whenever a player starts,
  stops, or uses keyboard movement". Blizzard has never published a movement rate in Hz.
- **EVE simulates at 1 Hz.** "Each ballpark runs at a rate of one tick per second" ([CCP
  Masterplan][drakes1]). When a node overloads, **Time Dilation** slows the game clock, down to
  10% ([CCP Veritas][eve-tidi]).
- **Split the crowd.** WoW layers regions and shards zones (a WoW "shard" is a copy of one zone, not
  an Omega Shard); Wintergrasp queued at 120 per faction;
  Albion runs each zone on one thread and queues players proportionally per alliance.

### They still break

The 2006 AQ gate opening put players in "a loop of logging in, disconnecting, and trying to get
back online over a 12-hour period" ([Blizzard][blz-aq]). EVE's B-R5RB battle in 2014 ran at the 10%
dilation floor for about 21 hours of real time to compute "just over 2 hours" of game time
([CCP][br5rb]). Check: 21 h × 10% ≈ 2.1 h.

### What a shooter can't borrow

| Lever | Why a bullet hell can't pull it |
|---|---|
| Low, event-driven movement rate | Projectiles hit *positions*. Coarse remote motion means shots miss what the shooter saw. |
| 400 ms server batching | A dodge is decided in one or two Ticks. 400 ms is longer than a whole dodge. |
| Unit-ID targeting, no Lag compensation | Aim is the skill. A hit has to be checked against where things were. |
| Time Dilation | Twitch feel collapses at any dilation. |
| Culling distant characters | You can't dodge bullets from enemies you can't see. |
| Layering, zone caps, queues | **This one transfers.** Omega already caps per Instance. |

So which levers *can* a bullet hell use? Only the ones from §3: shrink k (real AoI), send fewer
bits per record, send less often, or split the Instance. To see how much room there is, we need to
open up our own bytes.

---

## 5. Omega's wire format, bit by bit

Here is §3's formula with our real constants plugged in, and where every byte goes. Code
references are to `rust/protocol` and `rust/server`. The full research, with line numbers, is
[`omega-wire-format-and-cost.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/omega-wire-format-and-cost.md); full layouts are in
Appendix B.

### Framing

Every packet is `[u8 type][payload]`. There is no length field, because ENet preserves datagram
boundaries. Integers are little-endian. Bit fields are packed **LSB-first**, and any byte-sized
write first pads the current partial byte, so headers stay byte-aligned and only the entity
records form a true bitstream. Decoding is strict: underflow, a bad discriminant or trailing bytes
is an error.

Positions, velocities and the cursor are `trunc(v × 10)` clamped to i16: 0.1-unit steps, truncated
toward zero, the same rule the client uses so prediction matches. Angles are `trunc(rad × 100)`.

### Upstream: `PlayerInput`, 22 bytes, every Tick

| Bytes | Field | Encoding |
|---|---|---|
| 0 | type = 2 | u8 |
| 1 | sequence | u8, wraps at 256, echoed back for Reconciliation |
| 2–3 | input flags | u16 bitfield, 9 of 16 bits used |
| 4–5 | aim angle | i16, rad × 100 |
| 6–9 | predicted position x, y | 2 × i16, 0.1 u |
| 10–13 | predicted velocity x, y | 2 × i16, 0.1 u/s |
| 14–17 | cursor x, y | 2 × i16, 0.1 u (only read on the Tick an ability fires) |
| 18–19 | client render Tick | u16, low 16 bits, input to Lag compensation |
| 20–21 | client RTT | u16, ms |

At 30 Hz that is 22 × 30 = **660 B/s of payload per player**, constant even when the player is idle.
On the wire each input datagram is 28 + 2 + 8 + 22 = 60 B, so **1.8 KB/s**. The input isn't
bit-packed. With 9-bit flags, a 10-bit angle, 15-bit coordinates and the cursor sent only when an
ability fires, it would be about 13–14 B.

### Downstream: the Snapshot

```
Delta Snapshot header (16 B, byte-aligned)
┌──────┬──────────────┬──────────────┬───────┬────────────────┬──────────────┐
│ type │ server_tick  │ server_ms    │ flags │ baseline_tick  │ entity_count │
│ u8   │ u32          │ u32          │ u8    │ u32 (delta only)│ u16          │
└──────┴──────────────┴──────────────┴───────┴────────────────┴──────────────┘
then a bitstream of records, LSB-first, final byte zero-padded:

Moving player, position-only delta record = 49 bits
┌──────┬───────────┬──────┬──────────┬──────────┐
│ kind │ offset    │ mask │ qx       │ qy       │
│ 2 b  │ 10 b      │ 5 b  │ 16 b     │ 16 b     │
└──────┴───────────┴──────┴──────────┴──────────┘
  kind 0 = player (ids 1–999), 1 = projectile (15-bit offset),
  2 = monster, 3 = world effect (14-bit offsets)
```

<figure id="f3" class="article-figure">
<a href="/journal/omega-load-testing/F3-snapshot-layout.png" aria-label="Open F3 at full size"><img src="/journal/omega-load-testing/F3-snapshot-layout.png" alt="F3. Snapshot header and position-only delta records. Header widths scale by byte; record widths share a bit scale." loading="lazy" decoding="async" /></a>
<figcaption>F3. Snapshot header and position-only delta records. Header widths scale by byte; record widths share a bit scale. <a href="/journal/omega-load-testing/F3-snapshot-layout.png">Open full size ↗</a></figcaption>
</figure>

The typed id replaces an old `u16 id + u8 type`: a 2-bit kind plus an offset into that kind's id
range. A player id costs 12 bits, a projectile 17, a monster 16. After the id comes a 5-bit change
mask: POSITION, ANIMATION, FLAGS, REMOVED, FULL. The record carries only the fields the mask selects.

| Record | Player | Projectile | Monster |
|---|---:|---:|---:|
| Baseline (full) | 63 b | 68 b | 67 b |
| Delta, position only | **49 b** | **54 b** | **53 b** |
| Delta, FULL (entity new to this client) | 68 b | 73 b | 72 b |
| Delta, REMOVED | 17 b | 22 b | 21 b |

So a moving entity costs 6–7 bytes per Tick, and the 32-bit absolute position is 60–65% of it.

**What "delta" means here.** Every field is absolute: a full quantized position, a full flags word.
A delta record only *omits* fields that haven't changed since the state the server last sent that
client. There's no arithmetic or XOR delta. Every 100 Ticks (3.3 s) the client gets a **Baseline**,
a full Snapshot on reliable ch1, and acknowledges it. Since the correctness fixes, dependent delta
Snapshots wait for the *exact* Baseline acknowledgement before they reference it (§6).

### AoI and the byte budget

- **AoI:** an entity enters a client's set at 1,000 units and leaves at 1,100 (hysteresis). A
  client's own entity is never culled.
- **Priority:** importance (player 10, projectile 8, monster 4) plus Ticks since last sent, minus a
  distance penalty, plus a change bonus. Admission is greedy in priority order.
- **Budget:** at most 1,200 B per delta Snapshot. Since the fixes this counts the header, rounding
  and pinned removal records, so the whole unreliable payload stays under 1,200 B.

Here is the punchline of this section. The Arena is 2,000 × 2,000 units. An AoI disc of radius
1,000 covers up to π × 1000² / 2000² = **78.5%** of it from the centre. In a measured 50-bot run a
bot saw on average 21.4 players and 35.7 projectiles, **about 42% of everything** in the Instance.
**In this Arena our AoI is a modest cull, not interest management.** In §3's terms, k is still a
fixed fraction of N, so we are on the N² branch.

### Where the bytes go

The breakdown below comes from a local 50-bot run in which a scratch tally classified every
received packet and every record with the real encoder.

> **Draft note.** Evidence caveat. This tally ran locally on commit `62fbfc3`, **before** the correctness
> fixes, with the default (not Strategy) bot behaviour. The fixes changed no layout, so the bit
> costs stand. The fixes do add correctness traffic (exact-ACK waiting, recovery), so the shares
> are indicative. Fixed-build byte shares: **[MEASURE]**.

| Item, per bot per second | B/s | Share of downstream |
|---|---:|---:|
| **Delta Snapshots** (avg 384 B, max 1,057 B) | 11,410 | **83.4%** |
| · projectile records | 7,466 | **54.5%** |
| · player records | 3,399 | 24.8% |
| · 16 B headers | 475 | 3.5% |
| Baselines | 142 | 1.0% |
| ActionConfirm (16 B per Tick, owner only) | 475 | 3.5% |
| **Game events** (132 per second) | 1,627 | **11.9%** |
| · `PROJECTILE_FIRED`, 12 B, every shot in the Instance | 1,125 | 8.2% |
| Total downstream application payload | **13,687** | 100% |

<figure id="f4" class="article-figure">
<a href="/journal/omega-load-testing/F4-payload.png" aria-label="Open F4 at full size"><img src="/journal/omega-load-testing/F4-payload.png" alt="F4. Downstream payload at 50 default bots, from the pre-fix local tally. Nested rows are counted once. Other / rounding is the residual of the printed totals, not a new measurement. Fixed-build shares remain unmeasured." loading="lazy" decoding="async" /></a>
<figcaption>F4. Downstream payload at 50 default bots, from the pre-fix local tally. Nested rows are counted once. Other / rounding is the residual of the printed totals, not a new measurement. Fixed-build shares remain unmeasured. <a href="/journal/omega-load-testing/F4-payload.png">Open full size ↗</a></figcaption>
</figure>

Within the Snapshots alone, projectiles are about **65%** of the bytes and players 30%. Check the
average Snapshot: 16 B header + (16.7 player records × 54.7 b + 37.1 projectile records × 54.2 b +
0.27 monster records × 53 b) / 8 ≈ 16 + 367 = **383 B**, against 384.1 B measured.

Three things stand out:

1. **Projectiles are re-sent every Tick, even though their flight is deterministic.** A projectile
   moves 400 u/s, 13.3 u per Tick, so every visible projectile costs a 54-bit position on every
   Tick: **202.5 B/s per visible projectile, per viewer**. Its origin, direction and fire Tick are
   already in the `PROJECTILE_FIRED` Game event. So we pay twice: once for the reliable event, then
   per Tick for its whole life (1.4–2.0 s nominal range, about 0.9 s on average once hits and walls cut it short). This is the biggest waste in the protocol, and it's a design
   choice, not a bug.
2. **Game events go to every peer.** They aren't AoI-filtered or budgeted. Every client pays for
   every shot fired anywhere in the Instance. That is an O(N) per-recipient term however small the
   AoI gets.
3. **About 1 KB/s per player is fixed** before any other entity is drawn: header, ActionConfirm,
   the player's own record and a 1 Hz metrics packet.

On the wire, ENet and IP add about 74 B per Tick per peer downstream (one datagram: 28 B IP/UDP,
4 B ENet header, 8 B per unreliable command, 6 B per reliable event), about **+16%** on top of the
payload. A 12-byte reliable `PROJECTILE_FIRED` carries a 6-byte command header and costs the client
an 8-byte ACK going back.

### D8: the cost model

Fitting per-entity coefficients to that run gives, per recipient, downstream payload:

```
R(N) ≈ 1.3 KB/s  +  0.42·(N−1)·157  +  0.42·N·1.7·209  +  30·N     [B/s]
     ≈ 1.3 KB/s  +  ~245 B/s · N
E(N) = N · R(N)   → quadratic total egress
```

The 0.42 is the visible fraction, 157 B/s is a visible player, 1.7 is projectile-seconds per player,
209 B/s is a visible projectile, and 30 B/s is the broadcast-event cost each player adds for every
recipient. **[D]** The Snapshot alone reaches the 1,200 B budget when
(1200 − 16) / ((0.42 × 157 + 0.42 × 1.7 × 209) / 30) ≈ **165 players**. Past that the scheduler
starts deferring records, and broadcast Game events keep growing without bound: about 15 KB/s per
recipient at 500 players and 30 KB/s at 1000.

> **Draft note.** The model is fitted at N = 50 with default bots and extrapolated. Nothing in the fit was
> measured above 50.

---

## 6. How we load-tested it

A load test is only as honest as its generator and its pass gates. Ours found bugs before it found
a ceiling, and several of the bugs were in the test itself.

### Setup

- **Two Hetzner CAX11 hosts** in the same Falkenstein zone, one for the game and one for the bots.
  Pinned release ARM builds. Unsigned dev-mode tickets, no API, no persistence, UDP restricted to
  the bot host.
- **The bots are real clients.** `omega-load-test` links the same `protocol` and `sim_core` crates
  as the game, so every bot encodes real input and runs real prediction. It isn't a packet replayer.
- **Workloads:** idle (connect only), movement, combat (always shooting), clustered (everyone
  converges on the origin) and **Strategy**, the gameplay-like one: target selection, orbiting at
  range, intercept aim with error, projectile dodging, sprint, dash and Class abilities.
- **Each cell:** 30 Hz input, 100 ms join stagger, 60 s of warmup, then a **300-second measured
  window**. One observation per cell, no repeats.
- **Pass gates:** 30 Ticks per second held; every bot's input at ≥ 29.7 Hz both as offered and as
  seen on the wire; population held; delivery, decode and UDP error counters clean; received AoI
  correct. *A requested population is not an achieved load.*

Collection was compact: per-second host counters, exact window counters, a 1/64 UDP fingerprint
sample for delivery estimates, no payloads. A compact bundle was 1.12 MiB against 110.5 MiB for full
capture, 99% smaller.

### Round 1: the first bugs

Before and during the first campaign (14 October 2026), the harness exposed:

- **The UDP adapter ignored ENet's requested socket buffers.** The effective receive limit was the
  212,992 B. After the fix, 524,288 B.
- **A cache/Baseline mismatch** let omitted entities re-enter with partial records.
- **New entities couldn't recover** if their first unreliable FULL record was lost.
- **Host maintenance silently restarted captures** and invalidated the first Strategy 100 run.

### Round 2: is it the server, or the bots?

The first Strategy 150 cell failed, and the failure said nothing about the server: the bot host sat
at **97.8% of one core** and offered about 18 inputs per second instead of 30. A profile found the
Strategy bot's target search doing too much work. Searching the smaller visible-entity map restored
every bot to 29.993–30.000 Hz offered, at 78.3% CPU, with the same choices.

Then we reproduced a 200-player ramp with more instrumentation. All 172,927 game-host
receive-buffer errors matched the game socket's own drop counter: these were **socket queue
drops**, not interface or checksum errors. Gaps between socket reads grew from about 26 ms to a
maximum of 443 ms. Bytes of reliable retries grew from 132,337 to 13,688,810 across equal 9-second
windows, about 100×. Raising the receive buffer to 4 MiB effective let all 200 players join, then
collapsed with 159,266 drops. A bigger queue absorbs a burst. It doesn't add throughput.

### Round 3: the correctness campaign

The author's rule for this article was that no result could rest on a build with known bugs. So
we fixed them and reran. The fixes (merged in [PR #44][pr44]):

1. **Delta size accounting.** The 1,200 B budget counted record bits only, so a full delta could
   reach 1,216 B plus pinned removals. The budget now counts the encoded packet.
2. **Exact Baseline ACK gating.** Deltas referenced the last Baseline *sent*, not the last one
   *acknowledged*. Dependent deltas now wait for the exact ACK.
3. **Cross-channel retirement.** An old ch0 delta could recreate an entity after a newer ch1
   Baseline had removed it.
4. **Baseline decoder cap.** Baselines now respect the decoder's entity-count limit.
5. **Recovery AoI filtering.** Full-state recovery now uses AoI selection.
6. **Received-AoI measurement** (ours). The bot checked a Snapshot's entity positions against the
   observer's position from a different moment. It now uses the observer position in the same
   Snapshot. Part of an earlier "AoI failure" was our checker.
7. **Tick-rate estimation** (ours). See the sidebar.

The campaign took **23 attempts, 20 launched workloads, and produced 10 clean cells** out of the 12
planned. That's a 43.5% attempt yield. Our own assessment calls it a campaign-management failure:
too much effort went into repeated harness and storage failures without an early stopping budget.

> **Sidebar: a number that lied.**
> An early report said the server ran at **32.9 Hz**. It runs a fixed 30 Hz accumulator. The bot's
> estimator divided the Tick span (which included the spawn phase) by the fixed run length:
> 30 × 131.6 s / 120 s = 32.9. After the fix it pairs each Snapshot Tick span with its server-clock
> span. On the clean Strategy 150 cell it reports **29.99998120034632 Hz**, and so *fails* the
> unchanged `>= 30` criterion because of the 1 ms clock resolution, while the Tick log shows exactly
> 9,000 Ticks in 300 s. We kept both numbers and didn't round the failure into a pass.
> The 32.9 Hz report itself comes from a historical run whose raw data hasn't been retrieved yet
> ([historical reports][issue28]); the arithmetic is reproduced from code.

---

## 7. Results

Two builds produced results, and they don't mix:

- **Original build** (game `b1266c1`, 14 Oct 2026): the first ladder and the five overload ramps,
  512 KiB effective socket buffers.
- **Fixed build** (game SHA-256 `de92e120…`, 22–24 Oct 2026): the clean correctness campaign, 4 MiB
  effective game socket buffers.

The fixed build that was load-tested is the campaign's binary. The fixes extracted to `master` were
validated locally but not load-tested again.

### The clean cells, fixed build

Each row is one 300-second observation after warmup. All held 30.0 Ticks per second and passed every
campaign gate. ([Accepted results audit][audit].)

| Workload | 50 players, Tick-work p99 | 100 players | 150 players |
|---|---:|---:|---:|
| Idle | — | 8.02 ms | not clean |
| Movement | 5.56 ms | 9.54 ms | 13.61 ms |
| Combat | 6.74 ms | 14.61 ms | — |
| Clustered | 7.19 ms | — | — |
| Strategy | 6.88 ms | 14.15 ms | **26.25 ms** |

**Strategy 150, the headline pass.** All 150 players stayed authenticated for 300 seconds after
warmup. 9,000 Ticks, 30.0 Hz. Tick-work p99 **26.25 ms** of the 33.33 ms budget, maximum 58.0 ms,
ten Ticks over budget. Every peer passed offered and wire cadence (29.81–29.99 Hz on the wire),
delivery and received-AoI gates. Received AoI was checked over 203,603,817 matched positions, with
zero violations. Correctness and UDP error counters were zero on both hosts.

It is one cell under its recorded conditions, not a capacity certificate. Those players weren't
all fighting: the living population ranged from 102 to 143, and the median monster count was zero.

**[D] The p99 grows faster than N, sometimes.** Strategy p99 roughly doubled from 50 to 100 players
(× 2.06) and grew × 1.86 from 100 to 150, for 1.5× the players. Fitting p99 ∝ N^a to each step gives
a ≈ 1.04, then a ≈ 1.53. Movement gives a ≈ 0.78, then 0.88. These are single observations of a tail
percentile, not a cost curve. Treat the exponents as a hint, not a measurement.

### The original ladder and the N² in our bytes

The original build's ladder: Movement passed 50/100/150. Combat passed 50/100; Combat 150 failed
(a ~99% CPU episode for about 11 seconds, then 135 bots disconnected). Clustered passed 50 and
failed at 75 with kernel UDP errors. Strategy passed 50/100; 125 and 150 failed offered-load
validation (the generator problem above), so they say nothing about the server.

**Original Strategy 100**: 30.000 Ticks per second, 29.981 Hz exact wire input, Tick-work p99
15.96 ms, game CPU mean 39.7% of one core, outbound **3,670,419.81 IP bytes/s**.

**D9, the N² in our bytes [D].** Outbound IP bytes per authenticated player-second, original build:

| Strategy | Outbound IP B/s | Per player-second |
|---:|---:|---:|
| 50 | 1,093,347.36 | 21,866.95 |
| 100 | 3,670,419.81 | 36,704.20 |

Doubling N grew per-player bytes **× 1.68** and total egress **× 3.36**. Pure k = N − 1 would give
×2 and ×4. Fixed per-player costs (input confirms, headers, the player's own record) are the likely
reason it's less [D, not isolated].

> **Draft note.** Both rows are original-build. That build's byte counts include recovery traffic and the
> 16 B budget overshoot fixed later. Matched fixed-build outbound bytes per player-second:
> **[MEASURE]**.

**D10, model against measurement [D].** The §5 model predicts about 26 KB/s of payload per client
at N = 100. With ~16% wire overhead that is about 30.2 KB/s, against 36.7 KB/s measured: the
measurement is about 22% higher. Plausible reasons, none isolated: the model was fitted to default
bots, not Strategy bots (which dodge, sprint and use abilities); the original build sent extra FULL
recovery records; outbound IP bytes include reliable retries and Baselines. The order of magnitude
holds. The gap is **unexplained**.

### Overload

The original-build ramps from §0, with the first second in which the game host recorded receive-buffer
errors:

| Requested | Population at first game-host receive errors | Game CPU then | Ramp peak |
|---:|---:|---:|---:|
| 200 | 131–139 | 56.8% | 191 |
| 250 | 157–164 | 69.0% | 185 |
| 500 | 156–162 | 76.2% | 176 |
| 750 | 132–140 | 58.1% | 180 |
| 999 | 150–157 | 64.1% | 190 |

CPU is a one-second average, so a shorter stall or burst can overflow a queue while that second's
average is below 100%. The first game CPU interval at ≥ 95% came later, at 176–191 players.

The fixed build's single **Strategy 200** attempt reached all 200 players, then lost population to
about 80 and aborted 28.7 seconds before measurement. It recorded 135,913 game-host and 299 bot-host
receive-buffer errors. Because the bot host was losing packets too, the attempt **cannot isolate a
server ceiling**. A follow-up to make the bot host's overload measurement trustworthy failed its
own local test and stopped before any remote run ([Strategy overload follow-up][issue46]).

The strangest result: the fixed build's **Idle 150** cell, where bots only connect and send input,
did not pass. Every bot offered input at the right rate, but 113 of 150 peers fell below the
29.7 Hz gate on the wire, on both captures, while Strategy 150 passed. The cause is **unknown**.
An attempt to instrument it failed its local overhead gate (+5.55% against ≤ 2%) and stopped
([Idle150 follow-up][issue45]).

> ![F5. Game and bot CPU against requested population, original build.](/journal/omega-load-testing/cpu-vs-population.png)
>
> *F5. CPU against requested population, original build. Source: [CPU report][cpu-report].*

### D11: against the Valorant yardstick [D, inference]

D1 rescaled Valorant to about 128 players per core at 30 Hz. Original Strategy 100 ran 100 × 30 =
3,000 player-Ticks per second at 39.7% of a core: a naive 7,560 player-Ticks per core-second.
Fixed Strategy 150 ran 4,500 player-Ticks per second on one serial loop. Both are the same order as
Valorant's 3,840, from a 2D sim with no animation and no 3D traces. This comparison is loose:
Valorant's figure is a provisioning target across a whole host, ours is one process's average or
one thread's wall clock.

### D12: transfer and money

At the original Strategy 100 rate, continuous use would move
3,670,419.81 × 86,400 × 30 = **9.51 TB per 30 days** (decimal), or **115.75 TB per 365 days**.
That's arithmetic on a same-zone, old-build observation, not an invoice. Fixed-build external
transfer, the monthly and yearly cost, and any 1000-CCU forecast: **[MEASURE]**.

### What we didn't get

The agreed matrix also had delay, jitter and loss profiles, Snapshot-rate and AoI-radius
comparisons (Snapshot 15 Hz, AoI 600) and genuinely external clients. We have one native Combat 100
control and one 25 ms delay observation. The rest is **[MEASURE]**, deferred to
[Stage 4][issue47].

---

## 8. Which wall did we hit?

<details class="article-draft-note">
<summary>Open framing in this draft</summary>

> Draft framing from the outline: **"the same wall, with a twist: the receive
> path fails before the CPU does."** Alternatives: "here is how far a 2D top-down game can push
> it", or "we found the wall, then found our test was part of it".

</details>

What the data supports today:

- **On the original build, failure began in the receive path.** Socket queue drops started at
  131–164 players while process CPU averaged 57–76% of a core. Near-core CPU, lost players and join
  timeouts followed.
- **The diagnosis matched the drops to the game socket** and saw read gaps and reliable retries
  grow during the failure: amplification after overflow. It did not prove what started it.
- **A larger buffer delayed the overflow without sustaining 200.** Absorbing a burst isn't adding
  throughput.
- **On the fixed build, with 4 MiB buffers, 150 passed cleanly** with p99 at 79% of the Tick budget.
- **The fixed build's limit is unknown.** Its one overload attempt couldn't be measured.

Ranked hypotheses, none proven:

1. **The serial loop runs out of time.** One thread services ENet, runs the Tick, encodes and
   flushes. While it is busy encoding, nobody reads the socket, so a burst of inbound datagrams has
   to fit in the kernel queue. Strategy 150's p99 at 26 ms leaves a 7 ms margin.
2. **Bursts between socket reads overflow the queue.** Input from N clients arrives at 30 × N
   datagrams per second, plus ACKs for every reliable event (and reliable events grow with N).
3. **Reliable retries amplify the backlog.** Once drops start, retransmits add load. The 100×
   growth in retry bytes fits this. Whether retries cause or follow overload isn't established.
4. **Our generator contributes.** It did at Strategy 150 originally, and at Strategy 200 the bot
   host dropped packets too.

One coincidence worth noting, **not claiming**: the §5 model puts the 1,200 B Snapshot budget at
about 165 players, inside the 131–164 receive-error onset. No causal link has been shown, the model
is an extrapolation, and receive-side drops are about inbound traffic, not Snapshot size.

### What 1000 would take

Mapped back to the levers in §2–§4:

1. **Make AoI shrink k.** A 1,000-unit AoI in a 2,000-unit Arena shows ~42% of the Instance. Rust's
   k is 1–2% of N. Either the map grows with N or the radius shrinks.
2. **Stop re-sending deterministic projectiles.** Send the fire event and the removal; let the client
   fly the bullet. That is about 54% of downstream at 50 bots.
3. **AoI-filter Game events.** They're the only term that grows without bound after Snapshots cap.
4. **Get the Tick off one core.** Encode each entity once per Tick and copy bits per recipient;
   serialise per recipient in parallel; or split the Instance (meshing, sharding).
5. **Read the socket off the Tick thread**, so a long Tick doesn't leave the receive queue unattended.

None of these is implemented. Each one changes the game or the server, and each would need its own
measurement.

---

## 9. Conclusion

The player cap isn't folklore. It's a fixed CPU budget per Tick set against work that grows as
N · k, with k ≈ N − 1 whenever everyone can see everyone. Bit-packing and deltas buy constant
factors. AoI changes the exponent, if the map lets it. Tab-target games escape by changing the game
so the server can be late. Rust escapes by keeping k tiny, then hits a CPU wall at a few hundred.
Battlefield keeps everyone relevant on purpose and pays in tick rate.

On a $7.59 box, our first build's join ramps broke near 190, right where the industry stops. Fixing
our bugs, including the ones in our own test, got a clean 150. Past that the ceiling is
**unknown**, and the honest version of this article says so.

The most transferable lesson might be the boring one. Before you trust a capacity number, prove that
the generator offered the load, that the wire carried it, and that your checker measured what it
claims. Ours didn't, at first.

---

## Appendices

The formula sheet, full bit layouts, reproduction steps, and sources follow below.

- **A.** Formula sheet
- **B.** Full bit layouts
- **C.** How to reproduce
- **D.** Sources, grouped by section

<!-- Reference links -->
[cax11-conclusion]: https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/CAX11-CONCLUSION.md
[strategy-ext]: https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/STRATEGY-EXTENSION.md
[cpu-report]: https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/CPU.md
[audit]: https://github.com/Operatorr/godot-networking-poc/issues/31#issuecomment-6382173465
[pr44]: https://github.com/Operatorr/godot-networking-poc/pull/44
[issue28]: https://github.com/Operatorr/godot-networking-poc/issues/28
[issue45]: https://github.com/Operatorr/godot-networking-poc/issues/45
[issue46]: https://github.com/Operatorr/godot-networking-poc/issues/46
[issue47]: https://github.com/Operatorr/godot-networking-poc/issues/47
[fps-caps]: https://github.com/Operatorr/godot-networking-poc/blob/research/fps-caps-battlefield-rust/docs/research/fps-caps-battlefield-rust.md
[q3-shared]: https://github.com/id-Software/Quake-III-Arena/blob/dbe4ddb10315479fc00086f08e25d968b4b43c49/code/game/q_shared.h#L1092
[sdk-shareddefs]: https://github.com/ValveSoftware/source-sdk-2013/blob/be57e3d01ac7d7aa6a2cacbfef187c0b46616db0/src/game/shared/shareddefs.h#L245-L257
[vw-smn]: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
[apex]: https://www.ea.com/games/apex-legends/news/servers-netcode-developer-deep-dive
[val-128]: https://technology.riotgames.com/news/valorants-128-tick-servers
[ue-repgraph]: https://dev.epicgames.com/documentation/en-us/unreal-engine/replication-graph-in-unreal-engine
[wz-150]: https://www.charlieintel.com/call-of-duty-warzone/call-of-duty-warzone-features-150-players-59526/
[wz-100]: https://www.techradar.com/gaming/warzone-developers-explain-decision-to-move-from-150-player-to-100-player-matches-for-an-optimal-and-fun-experience
[bf4-hitick]: https://eaassets-a.akamaihd.net/dice-commerce/battlefield4/assets/patch_notes/HighTickrat_BETA_R1_R4_DS.pdf
[bf4-hfb]: https://battlelog.battlefield.com/bf4/news/view/new-netcode-update-rolling-out/
[bf6-ig]: https://insider-gaming.com/battlefield-redsec-30hz-servers-beats-most-of-the-competition-says-lead-producer/
[bf6-x30]: https://x.com/tiggr_/status/1983276616928383071
[bf6-64]: https://www.inkl.com/news/we-are-subservient-to-the-players-battlefield-6-ditched-128-player-matches-in-favour-of-classic-64-players-after-it-didn-t-catch-on-in-battlefield-2042
[bf3-256]: https://www.gamerevolution.com/news/137-battlefield-3-can-handle-256-players-goes-intimate-instead
[bf2042-41]: https://www.ea.com/en-gb/games/battlefield/battlefield-2042/news/battlefield-2042-update-notes-4-1
[bf2042-faq]: https://www.ea.com/en/games/battlefield/battlefield-2042/faq
[sc-eptu]: https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-4-0-eptu-patch-notes
[mag-psblog]: https://blog.playstation.com/?p=44305
[gaffer-frag]: https://gafferongames.com/post/packet_fragmentation_and_reassembly/
[rust-fd16]: https://rust.facepunch.com/blog/friday-devblog-16
[rust-maint]: https://rust.facepunch.com/news/maintenance
[rust-ship]: https://rust.facepunch.com/news/shipshape
[rust-craft]: https://rust.facepunch.com/news/crafting-update
[blz-aq]: https://news.blizzard.com/en-gb/world-of-warcraft/23504702/engineer-s-workshop-recreating-the-ahn-qiraj-war-effort
[celestalon]: https://us.forums.blizzard.com/en/wow/t/please-fix-spell-batching/437862/4
[claypool]: https://ftp.cs.wpi.edu/pub/techreports/pdf/06-13.pdf
[molnar]: https://regi.hiradastechnika.hu/data/upload/file/2008/2008_1/HT_0801a-8.pdf
[drakes1]: https://www.eveonline.com/article/fixing-lag-drakes-of-destiny-part-1-1
[eve-tidi]: https://www.eveonline.com/news/view/introducing-time-dilation-tidi
[br5rb]: https://www.eveonline.com/news/view/the-bloodbath-of-b-r5rb


---

## Appendix A. Formula sheet

Units: B = byte, b = bit, kB = 1000 B, Mbit = 10⁶ bits. All rates decimal unless marked KiB.
Source: [`replication-math.md` §11](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/replication-math.md), verified against
`rusty_enet` 0.4.0 and RFCs 768, 791, 8200, 9000.

```
Per-datagram overhead
  H_d (IPv4, ENet unreliable, no reliable/ack/checksum) = 20 + 8 + 2 + 8 = 38 B
  H_d (IPv6, with sent_time)                           = 40 + 8 + 4 + 8 = 60 B
  (+2 B ENet header when a reliable command shares the datagram; +8 B per piggy-backed ACK)

Payload limit
  Max ENet payload inside IPv6 minimum MTU             = 1280 − 60 = 1220 B   → use L = 1200 B
  ENet fragmentation threshold (default MTU 1392)      = 1392 − 4 − 24 = 1364 B

Quantization
  bits(range, step) = ceil( log2( range/step + 1 ) )

Snapshot size and rate
  r  = floor( (L − H_s) · 8 / b_e )          records per datagram
  d  = ceil( k / r )                          datagrams per Snapshot
  D  = f · ( ceil(k · b_e / 8) + d · (H_s + H_d) )     downstream per client
  U  = f_in · (I + H_d)                       upstream per client
  E  = N · D                                  server egress

Growth
  k_naive = N − 1                    → E = Θ(N²)
  k_AoI   = min(N − 1, ρπR², k_max)  → E = Θ(N · k)

Delta
  b_delta = p · b_changed + (1 − p) · b_unchanged      savings = 1 − b_delta / b_full

CPU per Tick
  C_tick ≈ C_sim + N · C_aoi + N · k · c_rec + N · d · c_send      budget = 1000 / f_tick ms

Transfer
  1 Gbit/s sustained = 125 MB/s × 2,592,000 s ≈ 324 TB per 30-day month
  B_month = r_out × CCU × 86,400 × calendar_days      (sum 12 calendar months for a year;
                                                     apply allowance rounding per month)
```

**Omega's measured constants (A §5, C2 "wire format").** H_s = 16 B delta / 12 B Baseline;
b_e = 49 b moving player, 54 b projectile, 53 b monster; I = 22 B; f = f_in = 30 Hz; L = 1200 B;
AoI enter 1000 u / exit 1100 u; Arena 2000 × 2000 u.

**Omega cost model (fitted at N = 50, default bots, pre-fix build; extrapolated).**

```
R(N) ≈ 1.3 KB/s + 0.42·(N−1)·157 + 0.42·N·1.7·209 + 30·N    [B/s per recipient, downstream payload]
     ≈ 1.3 KB/s + ~245 B/s · N
Snapshot reaches the 1200 B budget at  N ≈ (1200 − 16) / ((0.42·157 + 0.42·1.7·209) / 30) ≈ 165
Wire ≈ payload × 1.16 downstream
```

**Derived checks used in the drafts.** All reproduced with a throwaway script implementing the
formulas above.

| Id | Calculation | Result |
|---|---|---|
| D1 | 1,080 players / 36 cores; × 128 Hz; / 30 Hz | 30 players/core; 3,840 player-Ticks per core-second; 128 players/core at 30 Hz |
| BF4 | 4 Instances × 64 × 30 Hz vs 1 × 64 × 60 Hz | 7,680 vs 3,840 player-Ticks per box-second |
| D7 | 20 × 19; 1,500 × 1,499 | 380; 2,248,500 |
| D9 | 36,704.20 / 21,866.95; 3,670,419.81 / 1,093,347.36 | × 1.68 per player; × 3.36 total |
| D10 | 26,000 × 1.16 vs 36,704 | 30,160 B/s model vs measured; measured +22% |
| D11 | 100 × 30 / 0.397 | ~7,560 player-Ticks per core-second (naive) |
| D12 | 3,670,419.81 × 86,400 × 30; × 365 | 9,513,728,147,520 B; 115,750,359,128,160 B |
| Rust | 105 KB/s / 6% / 122 players | ~1.75 MB/s total; ~14.3 kB/s per player |

---

## Appendix B. Full bit layouts

Source of truth: `rust/protocol/src/{lib,types,bits,quant,client,snapshot,server}.rs`. Layouts
verified at commit `62fbfc3`; the correctness fixes changed no layout. Bit fields are LSB-first;
any byte-sized write pads the partial byte first.

### B.1 Framing and channels

```
ENet datagram (one per peer per flush; ENet coalesces up to 32 commands)
  [IPv4 20 + UDP 8]                                    28 B   (IPv6: 48 B)
  [ENet header: u16 peer_id | flags]                    2 B
    [+ u16 sent_time]                                  +2 B   only if a reliable command is present
  [command]*   4 B command header + per-type fields + payload
               SEND_UNRELIABLE 8 B · SEND_RELIABLE 6 B · ACKNOWLEDGE 8 B · SEND_FRAGMENT 24 B

Game packet inside a command:  [u8 type][payload]   (no length field)
  client → server types 1–6, server → client types 64–68 (disjoint)
```

| Ch | ENet mode | Server → client | Client → server |
|---|---|---|---|
| 0 | unreliable sequenced | delta Snapshots, ActionConfirm | — |
| 1 | reliable ordered | Baselines, AuthResult, Game events, ServerMetrics | ConnectAuth, BaselineAck, RequestFullState, RespawnRequest, LocalHitReport |
| 2 | unreliable sequenced | — | PlayerInput |

### B.2 `PlayerInput` (type 2, ch2), 22 bytes, byte-aligned

```
byte  0      type = 2                          u8
byte  1      sequence                          u8 (wraps)
bytes 2–3    input_flags                       u16: UP DOWN LEFT RIGHT SHOOT ABILITY SPRINT INTERACT DASH (bits 0–8)
bytes 4–5    aim_angle                         i16, trunc(rad × 100)
bytes 6–9    position x, y                     2 × i16, trunc(u × 10)
bytes 10–13  velocity x, y                     2 × i16, trunc(u/s × 10)
bytes 14–17  cursor x, y                       2 × i16, trunc(u × 10)
bytes 18–19  client_render_tick                u16 (low 16 bits of server Tick)
bytes 20–21  client_rtt_ms                     u16
```

Wire: 28 + 2 + 8 + 22 = 60 B per datagram; 1.8 KB/s at 30 Hz.

### B.3 Snapshot header (type 65), byte-aligned

```
type            u8      = 65
server_tick     u32
server_ms       u32     server monotonic ms (clock-sync heartbeat)
flags           u8      bit0 IS_DELTA, bit1 BASELINE (both set = rejected)
baseline_tick   u32     only when IS_DELTA
entity_count    u16     decoder cap 4096
→ 16 B delta header, 12 B Baseline header; record bitstream follows, final byte zero-padded
```

### B.4 Typed entity id

| Kind (2 b) | Entity | Offset bits | Id range | Total id bits |
|---|---|---:|---|---:|
| 0 | player | 10 | 1–999 (id = offset) | 12 |
| 1 | projectile | 15 | 10000–29999 (offset = id − 10000) | 17 |
| 2 | monster | 14 | 30000–39999 | 16 |
| 3 | world effect | 14 | 40000–49999 (four 2,500-id sub-bands) | 16 |

### B.5 Records

```
Baseline record:  [typed id][anim 3 b][entity_flags 16 b][qx 16 b][qy 16 b]
Delta record:     [typed id][mask 5 b] then, by mask bit:
                    bit0 POSITION  → qx, qy             32 b
                    bit1 ANIMATION → anim                3 b
                    bit2 FLAGS     → entity_flags       16 b
                    bit3 REMOVED   → nothing
                    bit4 FULL      → anim, flags, qx, qy 51 b
                  decode precedence: FULL before REMOVED; mask-0 entities are never encoded
```

| Record shape | Player | Projectile | Monster / world effect |
|---|---:|---:|---:|
| Baseline | 63 | 68 | 67 |
| Delta FULL | 68 | 73 | 72 |
| Delta POSITION | 49 | 54 | 53 |
| Delta POSITION + ANIM | 52 | 57 | 56 |
| Delta POSITION + FLAGS | 65 | 70 | 69 |
| Delta REMOVED | 17 | 22 | 21 |

### B.6 Other per-Tick and broadcast packets

| Packet | Bytes | Recipients | Rate |
|---|---:|---|---|
| ActionConfirm (66, ch0) | 16 | owner | each Tick with input |
| `PROJECTILE_FIRED` (67/12, ch1) | 12 | **all peers** | every shot |
| `DAMAGE` (67/1) | 9 | all peers | per hit |
| `KILL` / `KILL_PVP` | 6 | all peers | per kill |
| `RESPAWN` | 10 | all peers | per respawn |
| `EXP_GAIN` | 8 | all peers | per nearby player per monster kill |
| `PLAYER_INFO` | 11 + name | all peers | join, hydrate, level-up |
| `LEADERBOARD_UPDATE` | 7 + 6 × rows (≤ 67) | all peers | on kill (coalesced per Tick) and every 5 s |
| `PROGRESS` | 13 | owner | XP change |
| `SERVER_METRICS` (68) | 34 | all peers | 1 Hz |
| `BaselineAck` (client) | 5 | server | per Baseline |

### B.7 Delta and Baseline rules, as built after the correctness fixes

- Per-peer cache of the last sent `{position, animation, flags}`. POSITION is set when an axis moved
  by ≥ 0.05 u (half a quantization step); ANIMATION / FLAGS on any change; FULL for entities new to
  the peer.
- Baseline every 100 Ticks on ch1 reliable; the client ACKs; dependent ch0 deltas wait for the exact
  pending Baseline ACK. Old ch0 deltas can't recreate entities after a newer Baseline.
- Budget: the encoded delta (header, rounding and pinned REMOVED records included) stays under
  1,200 B; oversized pinned sets go out as a reliable Baseline.
- AoI 1000 enter / 1100 exit (strict `>`), spatial grid cell 275 u; priority = importance (player 10,
  projectile 8, monster / world effect 4) + Ticks since sent − LOD penalty (0 / 4 / 8 at ≤ 400 /
  ≤ 1000 / beyond) + change bonus. Greedy admission.

---

## Appendix C. How to reproduce

**Local, single machine** (no campaign tooling, no remote hosts):

```bash
# build
./scripts/build_server.sh
cd rust && cargo build --release -p omega-load-test && cd ..

# terminal 1: server under test (dev mode, unsigned tickets)
./scripts/run_server.sh --mode arena --port 8081      # or: omega-server --config <cfg> --allow-unsigned-tickets

# terminal 2: bot swarm
./scripts/run_load_test.sh --scenario baseline                         # 50 bots, 120 s
./scripts/run_load_test.sh --bots 100 --duration 300 --behavior strategy --input-hz 30 --stagger 100 --seed 30 --difficulty 1   # campaign settings
```

Scenarios and flags (`--behavior`, `--difficulty`, `--seed`, `--bandwidth-budget`, `--rate-budget`,
`--assertions`, `--aoi-exit-radius`) are documented in
[`rust/load_test/README.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/rust/load_test/README.md). `stress` (200 bots) needs a config
with `max_players >= 200`.

**The remote CAX11 campaign** used `scripts/load_campaign/` (`one_pass.py init | preflight |
resolve-preflight | all`, plus the compact `article-points-v1` collector). It needs two provisioned
hosts and the private configuration recorded in each report. Build identities, configs, gates and
exact windows are in the reports:

- Original build: [`2026-10-14-one-pass/`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/README.md)
- Diagnosis: [`2026-10-21-udp-diagnosis/CONCLUSION.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-21-udp-diagnosis/CONCLUSION.md)
- Fixed build: [archived campaign at `fcf4f62`](https://github.com/Operatorr/godot-networking-poc/tree/fcf4f62c3d625a24caf8c462e186c8887fa98ce9/docs/netcode/perf-notes/load-test-reports/2026-10-22-clean-runs)
  (game SHA-256 `de92e120bb863948fc4c55fe525d200ac6ebc0d0d214d453ed3efeab159208db`,
  config SHA-256 `0abd2a9041dc33023ff924cae334ce25683838a0c0726cfd8fcb5a0000332370`)

> These steps describe how we ran the campaign. New remote experiments require their own separately reviewed plan; these instructions are not authorization to run experiments against our hosts.

---

## Appendix D. Sources, grouped by section

Tags: [P] primary, read directly · [S] first-party statement read through the press or a mirror ·
[U] unverified · [O] observed third-party data · [D] our arithmetic.

### Our own evidence (A §0, §6–§8; C2)

- [Original CAX11 checkpoint and hypotheses](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/CAX11-CONCLUSION.md),
  [Strategy extension](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/STRATEGY-EXTENSION.md),
  [one-pass README](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/README.md),
  [CPU report](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-one-pass/CPU.md)
- [Fixes and open checks (round 1)](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-14-single-run/fixes-and-open-checks.md)
- [UDP diagnosis conclusion](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/load-test-reports/2026-10-21-udp-diagnosis/CONCLUSION.md)
- [Correctness fixes extracted to master](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/netcode/perf-notes/issue39-correctness-fixes.md), [PR #44](https://github.com/Operatorr/godot-networking-poc/pull/44)
- [Final assessment (archived)](https://github.com/Operatorr/godot-networking-poc/blob/fcf4f62c3d625a24caf8c462e186c8887fa98ce9/docs/netcode/perf-notes/load-test-reports/2026-10-22-clean-runs/FINAL-ASSESSMENT.md),
  [clean Strategy 150](https://github.com/Operatorr/godot-networking-poc/blob/fcf4f62c3d625a24caf8c462e186c8887fa98ce9/docs/netcode/perf-notes/load-test-reports/2026-10-22-clean-runs/clean-strategy150-r2-20261022.md)
- [Accepted bounded results audit](https://github.com/Operatorr/godot-networking-poc/issues/31#issuecomment-6382173465) (author-accepted 2026-10-25)
- [Idle150 delivery follow-up](https://github.com/Operatorr/godot-networking-poc/issues/45), [Strategy overload follow-up](https://github.com/Operatorr/godot-networking-poc/issues/46), [Stage 4 deferred evidence](https://github.com/Operatorr/godot-networking-poc/issues/47)
- Code: `rust/protocol`, `rust/server`, `rust/load_test`; [wire-format research](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/omega-wire-format-and-cost.md)

### Industry case studies (A §2; C1 "the ceiling")

Full table and every link: [`realtime-player-caps.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/realtime-player-caps.md).

- **id Software** [P]: Quake III `q_shared.h`, `sv_init.c`, `cl_main.c`, `net_chan.c` (GPL source, pinned commit)
- **Valve** [P]: Source SDK 2013 `shareddefs.h` L245–257; Source Multiplayer Networking (Valve Developer Wiki); GameNetworkingSockets `steamnetworkingsockets_internal.h`
- **Riot** [P]: Randall, *VALORANT's 128-Tick Servers* (2020); deWet & Straily, *Peeking into VALORANT's Netcode* (2020)
- **Epic** [P]: Replication Graph docs; Fortnite State of Development v5 (2018)
- **Respawn / EA** [P]: *Servers & Netcode Developer Deep Dive* (2021)
- **Activision** [S]: Charlie INTEL (150), TechRadar and VGC (100)
- **CIG** [S/P]: Letter from the Chairman; Server Meshing Test E AAR; Alpha 4.0 EPTU notes
- **Zipper / Sony** [P]: *Five Things You Didn't Know About MAG* (PlayStation Blog, 2011)
- **SOE / Daybreak** [P/P*]: Guinness (1,158); Wrel continent-cap post (mirror)

### Battlefield and Rust (A §2–§3; C1)

Full note: [`fps-caps-battlefield-rust.md`](https://github.com/Operatorr/godot-networking-poc/blob/research/fps-caps-battlefield-rust/docs/research/fps-caps-battlefield-rust.md) (research branch).

- **DICE / EA** [P]: BF4 High Tickrate BETA PDF (Sirland, 2015); Battlelog *Addressing "Netcode" in BF4* and *High Frequency Bubble* (2014); BF2042 Update 4.1 notes; BF2042 Core Feedback: Maps; BF6 Open Beta Debrief; Sirland on X (BF V, BF6, REDSEC). [S]: Söderlund via GameRevolution / TheSixthAxis (2011); Bach via GameWatcher; Insider Gaming (REDSEC); PC Gamer via inkl (BF6 64)
- **Facepunch** [P]: Friday Devblog 16; Devblogs 42, 58, 171; The Performance Update; Maintenance; Shipshape; Spring Clean; Crafting Update; Bags to Riches; commits 549058, 579925, 586937, 587940, 715823. [S]: decompiled convars (RustChangelog), CustomNetworkRange plugin docs. [O]: Rustalyzer, 2026-10-15

### Replication math (A §3; C1 "the math"; C2 recap)

Full derivations: [`replication-math.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/replication-math.md).

- RFC 768 (UDP), RFC 791 (IPv4), RFC 894 (Ethernet), RFC 8200 (IPv6), RFC 9000 §14 (QUIC datagram size)
- ENet `protocol.h` / `enet.h` (lsalzman/enet); `rusty_enet` 0.4.0 crate source
- Fiedler, Gaffer On Games: *Snapshot Compression*, *Snapshot Interpolation*, *State Synchronization*, *Deterministic Lockstep*, *Serialization Strategies*, *Packet Fragmentation and Reassembly*
- Frohnmayer & Gift, *The TRIBES Engine Networking Model*
- Quake III `qcommon.h`, `msg.c`, `net_chan.c`

### Tab-target MMOs (A §4; C1 "MMOs")

Full note: [`mmo-scaling-tab-target.md`](https://github.com/Operatorr/godot-networking-poc/blob/7f9ccd4ac9d32f7adb35d39dac56efd7bc00ed3e/docs/research/mmo-scaling-tab-target.md).

- **Blizzard** [P]: *Engineer's Workshop: Recreating the Ahn'Qiraj War Effort* (2020); Celestalon on 400 ms batching (2014); Kaivax, *Spell Batching in Classic* (2019); Birmingham layering AMA relay (2019); patch 3.2.0 notes
- **CCP** [P]: Masterplan, *Drakes of Destiny* 1–2 (2010); Veritas, *Introducing Time Dilation* (2011) and follow-up (2012); Dolan, *B-R5RB* (2014); FWST-8 and M2-XFE posts
- **ArenaNet** [P]: Loew, *World vs. World: The End of Culling* (2013)
- **Sandbox Interactive** [P, via search index]: *How Albion Online Tackles ZvZ Performance*; Korn, *Cluster Queue* (2021)
- **Academic**: Claypool & Claypool, *Latency and Player Actions in Online Games*, CACM 49(11), 2006; Molnár & Szabó, *On the scaling characteristics of MMORPG traffic*, Híradástechnika 2008
