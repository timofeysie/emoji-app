# Overall Plan for LandGrab

LandGrab (currently `src/features/landGrab/` in this `popover-play` playground repo) is
being extracted into its own real-time multiplayer game, reusing infrastructure patterns
and an AWS account already proven out by another project (the "emoji-app", a NestJS/Express
+ React app deployed via Terraform to ECS on Fargate — see
[`emoji-app-readme.md`](./emoji-app-readme.md) and
[`emoji-app-web-sockets.md`](./emoji-app-web-sockets.md)).

## Current state (baseline, for context)

- LandGrab today is **entirely client-side**: a Phaser 3 scene running a deterministic,
  pure-TypeScript simulation (`simulation.ts`, `grid.ts`, `botStrategy.ts`, etc. — no DOM
  dependency, so this logic already runs anywhere JS runs, including a Node server).
- Single-player-vs-bots only. No networking exists. "Multiplayer" is new, not an extension
  of existing code.
- Persistence is a JSON blob in `localStorage` (`userProfile.ts`, `gameRecord.ts`) — no
  backend, no accounts.
- Deployed statically to GitHub Pages (`.github/workflows/deploy.yml`) with client-side
  `BrowserRouter`. Deep links 404 because GH Pages has no server-side rewrite — this goes
  away automatically once the app moves to a Node-served SPA (see Deployment, below),
  matching how emoji-app serves its built SPA from the same Express/Nest process that
  serves `/api/*`.
- Default grid is ~16×24 cells (scales with viewport, up to roughly 40×60 on a large
  desktop screen). Base tick is `TICK_MS = 160`, and the existing UI defaults to a `2x`
  time-scale locally — i.e. the local single-player experience already runs at an
  **effective ~80ms/tick (~12.5 ticks/sec)**. This number matters for the performance
  discussion below.

## Decisions made so far

- **Clean cut-and-remove extraction.** The full current ruleset and actions move out of
  `popover-play` into the new app; nothing stays behind as a stripped showcase copy.
- **No accounts, no persisted data.** Casual game: each session, a player supplies a
  display name and sketches/picks an 8×8 avatar, same as today's local flow. Nothing
  needs to survive between sessions or sync across devices.
- **i18n is website-chrome only.** The game itself (HUD, in-canvas labels, rules) does not
  need translation. Only the surrounding site (landing/marketing/info pages) needs
  English + Korean.
- **Client shell: Expo (React Native), not Ionic.** The Expo app is the always-on
  "front door" — installable from Play Store (and eventually App Store) — that stays
  available even when the AWS backend is torn down. It shows a waiting-room/practice
  experience (local bots) when the backend is down, and connects to the real multiplayer
  backend when it's up.
- **Expo wraps a WebView around the deployed web client — locked in.** Phaser can't run
  natively in React Native (see Architecture), and wrapping the web build reuses the
  rendering and simulation code as-is. No native reimplementation of the renderer.
- **Backend deploy pattern: reuse emoji-app's proven Terraform/ECS/Fargate/ALB setup**,
  including its destroy/apply cost-management workflow, rather than inventing a new one.
- **Full `terraform destroy` weekly, not scale-to-zero.** The ~3–5 min cold-start on
  `apply` is a non-issue because the stack gets warmed up hours ahead of the tournament,
  not moments before — so there's no reason to pay for the scale-to-zero middle ground
  (ALB kept warm at ~$18/mo) instead of taking the full teardown savings.
- **Formal Kids/Families app-store listing, designed in from the start** — not bolted on
  at submission time. See Child-friendly / app-store policy considerations, below.
- **Region: keep `ap-southeast-2` (Sydney)**, the same region emoji-app already runs in.
  No region migration to plan or test against — see Performance, below, for why the
  netcode carries this rather than the region choice.
- **Avatar editor stays free-form 8×8 sketching, no curated-palette restriction.** At 8×8
  resolution there isn't enough canvas to render genuinely obscene material, so the
  earlier "constrain what's drawable" mitigation isn't needed. Combined with the
  server-side username filter (below), this is considered sufficient for the
  Kids/Families UGC requirement.
- **Start simple.** Get a working multiplayer version of the *current* ruleset live first;
  larger gameplay/UX changes (mobile-first redesign, lobby polish, etc.) come after.

## Architecture

```text
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ Expo (React Native) app      │        │ Web (browser)                     │
│  - Play Store / App Store    │        │  - same client bundle, browser-   │
│  - "always on" waiting room  │        │    hosted, deep-linkable          │
│  - embeds the game client    │        │                                    │
│    via WebView (see below)   │        │                                    │
└──────────────┬───────────────┘        └──────────────┬─────────────────────┘
               │  WebSocket (game state) + REST (health/lobby)                │
               ▼                                                              ▼
                        ┌───────────────────────────────────────────┐
                        │ Node game server (Express/Nest, like       │
                        │ emoji-app) — server-authoritative           │
                        │ simulation.ts tick loop, on ECS/Fargate/ALB │
                        └───────────────────────────────────────────┘
```

**Why Expo wraps a WebView instead of re-implementing rendering natively:** the game
renders via **Phaser 3**, a canvas/WebGL engine tied to the DOM — it isn't portable to
React Native's native view tree. Re-implementing the rendering layer natively (e.g. with
`react-native-skia`) would mean maintaining two renderers for one game. Wrapping the
already-deployed web build in an Expo WebView reuses 100% of the Phaser rendering and the
simulation code, and is the same pattern as the Ionic/Cordova-wrapped hyper-casual games
this genre is usually shipped as. **Locked in.**

**Backend serves the SPA too**, same as emoji-app (`client-react` bundled next to the
compiled server): browser and `/api`/`/ws` share one origin, which sidesteps CORS and — as
a side effect — fixes the deep-linking problem, since the Node process can fall back
unmatched routes to `index.html` (unlike GitHub Pages' static hosting).

## Multiplayer networking model

- **Server-authoritative simulation.** The server runs the same deterministic
  `simulation.ts` tick loop as today's client (it's already pure TS with no DOM
  dependency — this ports with no rewrite). Clients never resolve captures, ownership, or
  splits themselves for anyone but their own predicted movement; they send **direction
  intents** and receive authoritative snapshots back.
- **Practice/waiting-room mode reuses the exact same simulation code client-side**
  (bots-only, no server) so practice genuinely reflects tournament rules — no second
  implementation to keep in sync.

### Performance: is it fast enough for multiple players at the current 2x rate?

Splitting this into the two things that actually gate it:

**Compute — not the bottleneck.** Per tick, the server does an O(players) read of queued
directions plus an O(1) position/trail update per player; the expensive part
(`grid.ts` flood-fill, `splitResolution.ts`) only runs on the rare tick where a loop
actually closes, not every tick. At the current grid sizes (hundreds to a few thousand
cells) and small match sizes (a handful of players per room), a single minimal Fargate
task (the same 256 CPU/512MB tier emoji-app already runs on) can hold many concurrent
rooms at 80ms/tick without strain. WebSockets on ECS+ALB are already a proven path in this
same AWS account (emoji-app's `/ws` broadcast) — the transport isn't a new risk.

**Network latency — the actual constraint.** At an 80ms tick (today's effective rate:
`TICK_MS=160` × the default `2x` UI speed), the budget for "input travels to server, tick
resolves, result travels back" is tight relative to real-world round-trip times,
*especially* for the stated English + Korean audience served from a single AWS region —
whatever region is picked, some players are always going to be 100ms+ away from it (Sydney
is bad for Seoul; Seoul would in turn be worse for a US/European player). Rather than
chasing a region choice that can never be good for everyone, the plan leans entirely on
netcode that's tolerant of a single region and a spread-out player base — sketched below.

This genre (Paper.io, Splix.io, and their ancestors) is inherently latency-tolerant
compared to a twitch shooter — movement is discrete, one-direction-per-cell, not
precision-aimed — so the standard, well-proven mitigation (Valve/Source and Gabriel
Gambetta's "client-server game architecture" model, adapted from continuous physics to
discrete grid steps) is enough, but it needs to be designed in from the start, not bolted
on.

### Client-side prediction / reconciliation / interpolation (sketch)

**Your own avatar — predict, then reconcile:**

1. On input, the client immediately advances its *own* local copy of the tick logic by
   one step in the intended direction and renders that — the player sees instant
   feedback, never waiting a round trip to see themselves move.
2. Every input sent to the server is tagged with a client-generated sequence number, and
   the client keeps a small buffer of "sent but not yet confirmed" inputs.
3. The server resolves the authoritative tick and broadcasts a snapshot back tagged with
   the highest input sequence number it has incorporated for that client.
4. On receiving a snapshot, the client discards acknowledged inputs from its buffer,
   resets its own local state to the authoritative one, then **replays** any
   still-unacknowledged inputs on top of it to arrive back at the correct predicted
   position. In the common case (no mismatch) this replay is a no-op; it only visibly
   corrects anything when a move was actually rejected server-side (see next point).
5. Divergence here is binary and rare, not a continuous drift to smooth over: a predicted
   move is either exactly what the server did, or it was invalid (e.g. a 180° reversal
   the ruleset already forbids) and got dropped. On mismatch, snap to the authoritative
   cell — optionally tween over one tick so it doesn't look like a hard teleport, but a
   plain snap is a fine v1.

**Everyone else — interpolate, don't predict:** the client never runs prediction for
other players (it doesn't have their next input, and predicting wrong is worse than a
small visible delay). Instead, render other avatars by tweening their sprite from their
last known cell to their newly-reported cell over roughly one tick's duration as each new
snapshot arrives, rather than snapping instantly — this hides jitter in exactly when
snapshots arrive over a lossy connection, at the cost of rendering opponents a tick or so
"in the past," which is imperceptible for this pace of game.

**Territory/trail state is server-truth only, no prediction needed** — it only changes on
capture/enclosure events, which are rare relative to movement and far less
latency-sensitive to get instantaneous feedback on.

Bandwidth is not a concern at these grid sizes: even a full-grid snapshot every tick is a
few KB/sec per client; delta-encoding (send changed cells + head positions, not the whole
grid) is still worth doing but is a nice-to-have, not a blocker.

**Recommendation:** don't assume the 2x/80ms rate carries over unchanged — decouple the
multiplayer tick rate from the local-practice speed slider as a config value, and validate
this sketch with a small throwaway prototype (server tick loop + two real clients on
different networks/regions, e.g. one in Korea) before building the rest of the netcode on
top of an assumed number.

## Anti-cheat (sketch)

Given this is casual, free, no-accounts, and kid-friendly (i.e. no economic stakes), the
right amount of anti-cheat is "the server can't be lied to," not a full anti-tamper
system:

1. **Server owns the outcome.** Since the server runs the authoritative
   `simulation.ts` tick, a modified client can only ever affect *its own* predicted
   rendering — it cannot grant itself territory, invulnerability, or someone else's loss.
   This one property removes most of the incentive to cheat.
2. **Validate inputs, not trust them.** Per message from a client: rate-limit to one
   direction change per tick, reject a 180° reversal (the ruleset already forbids this —
   `geometry.ts`'s `OPPOSITE` — so the server enforces a rule it already encodes, no new
   logic), reject inputs tagged for a tick already resolved (replay/duplicate
   protection), and ignore any message not associated with that socket's own player slot.
3. **Session tokens, not accounts.** Even with no persistent identity, the server should
   hand each socket a short-lived, per-match session token at lobby join so one connection
   can't puppet another player's slot. This is cheap and doesn't require the account
   system the "no sign up" decision rules out.
4. **Deliberately out of scope for v1:** device fingerprinting, obfuscation, replay
   analysis after the fact. There's no ranked ladder or real-money stake yet to justify
   the cost — revisit if a persistent leaderboard is added later.

## Deployment (modeled on emoji-app)

- **Reuse the proven pattern**: Docker image → ECR → ECS on Fargate behind an ALB, TLS via
  ACM + Route 53, GitHub Actions plans Terraform on PR and applies on merge, WebSockets
  confirmed working through ALB already.
- **State separation for the weekly destroy/apply cycle** — carry over emoji-app's
  existing split explicitly:
  - **Survives `terraform destroy`:** ECR images, Secrets Manager values, the S3
    Terraform-state bucket + DynamoDB lock table, the ACM certificate, the Route 53 hosted
    zone/domain.
  - **Recreated on `terraform apply`:** ECS cluster/service/task, ALB, listeners, target
    group, security groups, IAM roles. Same expectation as emoji-app: apply blocks until
    ECS reports healthy (emoji-app's own docs cite ~3–5 minutes).
  - LandGrab has no database requirement under the "no accounts, no persisted data"
    decision, which is simpler than emoji-app (which keeps MongoDB Atlas external to AWS
    specifically so it survives teardown) — there's nothing stateful to snapshot/restore
    here as long as that decision holds.
- **Full `terraform destroy` weekly — decided.** emoji-app's docs mention scaling ECS to
  `desired-count 0` as a middle ground that avoids the ~3–5 minute cold-start of a full
  destroy/apply cycle, but that risk only matters if the wake-up happens right before
  players arrive. It doesn't here: the plan is to `apply` hours ahead of the tournament
  start, well clear of the cold-start window, so full teardown's larger savings win
  outright with no practical downside.
- **Smoke test after the warm-up apply, well before players arrive.** Verify health (an
  equivalent of emoji-app's `curl /api/version` check) as soon as `apply` finishes, hours
  before start — not as a last-minute check right before the tournament, but early enough
  to still fix a bad apply if the smoke test fails.
- **Region: `ap-southeast-2` (Sydney)**, unchanged from emoji-app. A single region can't
  be equally close to every player (see Performance, above), so the netcode — not a
  region choice — is what's carrying the English+Korean latency spread.

## Child-friendly / app-store policy considerations

- **Building for formal Kids/Families listing from day one — decided.** Rather than
  shipping a general-audience app and retrofitting Google Play "Designed for Families" /
  Apple Kids Category compliance later, the constraints that listing imposes (no
  behavioral ads or ad SDKs, no external links out of the app, no third-party analytics
  beyond the small set of pre-approved "kids" SDKs, stricter data-minimization) are
  treated as requirements from the start. This makes eventual submission closer to a
  formality than a retrofit, at the cost of ruling out some conveniences (e.g. a generic
  analytics SDK, or a "leave feedback" link straight to an external form) that would
  otherwise be easy to bolt on later.
- **"No accounts, no persisted data" is a genuine simplification** for privacy compliance
  — no PII stored, nothing to disclose as retained. But it does **not** remove the need
  for a privacy policy page or the store's data-safety questionnaire (server logs still
  see IP addresses). A Google Play developer account already exists, which covers that
  logistics piece.
- **New risk introduced specifically by going multiplayer with real strangers**: today's
  name + sketched avatar is cosmetic and only ever seen by the local player. Once it's
  visible to other real people (including other children) in a live lobby, it becomes
  user-generated content that a Kids/Families listing specifically scrutinizes — see
  Moderation, below.

### Moderation: can it be fully automated, or does someone need to watch games live?

Fully automated is the right target here, and realistic for what this game actually
exposes — the surface is a **display name** and a **static 8×8 pixel avatar**, not
free-text chat or voice, which is what usually forces live human moderation:

- **Usernames — a standard, fully automated text filter.** Server-side (never
  client-only, so a modified client can't bypass it) reject/replace names against a
  maintained profanity/slur wordlist with basic evasion-normalization (leetspeak,
  lookalike unicode, spacing tricks). On a hit, fall back to an auto-generated safe name
  (e.g. `Player482`) rather than just refusing — no human in the loop needed per name.
  This is the same first-line approach large UGC platforms use; a human only enters the
  picture later, periodically, to tune the wordlist from aggregated report data — not to
  watch live games.
- **Avatars — no detection needed; the format itself is the mitigation.** At 8×8
  resolution there's genuinely not enough canvas to render obscene material — an
  automated image classifier would be both unreliable (too little signal to judge intent)
  and unnecessary to build. The current free-form pixel editor stays as-is: no curated
  palette restriction. This is combined with the avatar being ephemeral (never persisted
  or made public beyond the current match, per the "no persisted data" decision) as a
  second, independent reason the worst case stays bounded.
- **A lightweight, automatable backstop for anything the filter misses**: a per-match
  "report player" action that auto-kicks/mutes after a small report threshold within that
  match. This satisfies the platform expectation of "a mechanism to act on abuse" without
  a standing moderator watching games, since the action is a threshold rule, not a human
  judgment call.
- **Explicit non-goal, and a scope boundary worth keeping**: none of this generalizes to
  free-text chat. If open chat is ever added, that reopens the question and likely *does*
  require either a much heavier automated pipeline or human-reviewed reports — worth
  treating "no open chat" as a deliberate constraint to preserve the automated-only
  moderation story, not an oversight to fix later.

## Matchmaking / lobby (not a blocker, design later)

- While the backend is torn down (most of the week), the Expo app's waiting room runs the
  existing bots-only practice mode locally (reusing `simulation.ts` unchanged) so there's
  always something to do.
- When infra is up, the same screen becomes a lobby: players get a live countdown/update
  toward the next real match. Bracket structure, room sizing, and exact lobby UX are
  intentionally undesigned for now — flagged as easy to iterate on once the multiplayer
  skeleton (extraction + server-authoritative sim + basic deploy) exists, not before.

All prior open questions (Expo WebView vs. native, destroy-vs-scale-to-zero, region,
Kids/Families category, avatar editor, moderation approach) are now resolved above —
nothing outstanding is blocking a start on phase 1.

## Suggested phasing

1. **Multiplayer skeleton, current ruleset unchanged**: extract the feature, stand up the
   server-authoritative `simulation.ts` on Node, basic WebSocket protocol (direction
   intents in, snapshots out), and the prediction/reconciliation/interpolation sketch
   above, validated against real-world latency (including a Korea-based test client).
   Include the server-side username filter and per-match report/auto-kick from the start,
   since the session/socket plumbing they need is already being built here. Deploy via the
   emoji-app Terraform pattern (full weekly destroy, warm-up apply hours ahead). No
   mobile-first redesign, no i18n, no app-store packaging yet.
2. **Expo wrapper + waiting room**: package the deployed web client in an Expo WebView,
   build the bots-only local waiting room, wire it to detect backend up/down.
3. **Mobile-first touch layout and casual-game feel.**
4. **Website-chrome i18n (English/Korean).**
5. **App-store submission logistics** (privacy policy page, data-safety questionnaire,
   Kids/Families category submission) — should be close to a formality by this point
   since the constraints were designed in from phase 1, not discovered here.
