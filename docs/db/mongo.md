# MongoDB: what it's for, and running it locally

Status: written 2026-10-09, while implementing xAPI export Step 1a
([`../xAPI/xapi-export-plan.md`](../xAPI/xapi-export-plan.md)). Goal: be
able to iterate locally against a real database before Step 1c (LRS
delivery).

Related:

- [`../deployments.md`](../deployments.md): Milestone 3A Atlas runbook
  (staging).
- [`../manual-tests.md`](../manual-tests.md) §8: older Docker/PowerShell
  smoke test.
- [`../server/milestones.md`](../server/milestones.md): Milestones 2 and
  3A (persistence, Atlas).
- `server/src/persistence/`: `models.ts`, `mongo.service.ts`,
  `game-data.repository.ts`, `player.repository.ts`.

---

## What Mongo is for

MongoDB is the app's only durable store. The server reaches it through
Mongoose: the schemas are in `models.ts`, and the repositories keep
Mongoose out of the controllers.

| Collection | Holds |
| --- | --- |
| `games`, `questions`, `answerOptions` | Games, rounds and their A–E options |
| `guesses` | One row per badge scan: badge (`pairName`), station, slot, time |
| `pairBindings` | Which stations and badges are in which game, join/ready state |
| `nfcCards`, `nfcCardGroups`, `gameNfcCardGroupAssignments` | NFC card sets and which set a game uses |
| `players`, `playerBindings` | **New in Step 1a:** referee-made players (`firstName` + random `externalId`) and time-ranged badge → player bindings |
| `users`, `badges`, `gameParticipants`, `playerBadgeAssignments` | Early Milestone 2 models; mostly unused by today's station-based play |

Not in Mongo:

- Live badge/station status lives in memory (`BadgeStateService`), which
  is why staging runs a single instance.
- Auth is in Cognito.
- xAPI statements will live in the LRS (Veracity).

### What happens without it

`MONGODB_URI` is optional at startup. When it's unset, the server logs
`MONGODB_URI is not set. Mongo persistence is disabled.` and still serves
the SPA, `/api/badges` and `/api/chat`. Every game, question, guess and
player endpoint then fails with `Mongo models are unavailable`. So the game
UI can't be used locally without a database.

### What happens on startup (`mongo.service.ts`)

1. Connects using `MONGODB_URI`.
2. Runs `syncIndexes()`, which creates any missing collections and indexes
   from `models.ts`. **New models need no migration step**: the Step 1a
   `players` / `playerBindings` collections and their unique indexes
   appear on the first start, locally or on staging.
3. Deletes legacy `pairBindings` rows that have no `stationName`.

---

## Environments

| Where | Database | Managed by | How the server gets `MONGODB_URI` |
| --- | --- | --- | --- |
| Unit tests (`npm run test:server`) | None; models are Jest mocks | n/a | `server/src/test/setup.ts` deletes it |
| Local dev | **Local `mongod`** (this doc) or a dev DB on Atlas | You | `.env` |
| Staging (`emoji-staging.kogs.link`) | MongoDB Atlas cluster | **Atlas console, by hand** (Milestone 3A) | Secrets Manager `emoji-app/staging/mongodb-uri`, injected into the ECS task |

**Terraform does not create or manage the database.**
`infra/terraform/envs/staging/main.tf` only *looks up* the Secrets Manager
secret, and `modules/ecs-service/task-definition.tf` injects its
`MONGODB_URI` field into the container. Atlas (project, cluster, users, IP
access list) and the secret's value are managed by hand; see
`infra/terraform/README.md` → "Out of scope here". Nothing in this doc
changes Terraform.

---

## The one gotcha: transactions need a replica set

`GameDataRepository.withOptionalTransaction()` **always** starts a
transaction. It's used by `submitGuess` and `createNfcCardGroup`, so a
station scan always runs inside one. MongoDB allows transactions only on a
replica set (or sharded cluster).

- Atlas is always a replica set, so staging is fine.
- A plain local `mongod` (or `docker run mongo:7` without flags) is
  **standalone**. Games and questions work, but every guess fails with an
  error like `Transaction numbers are only allowed on a replica set member
  or mongos`.

So the local database must run as a **single-node replica set**. It's one
extra config line plus a one-time `rs.initiate()`.

(The new Step 1a player code doesn't use transactions, but testing it
needs guesses, so the gotcha still applies.)

---

## Local setup (macOS, Apple Silicon, Homebrew)

This machine has Homebrew but no Docker, so the main path is Homebrew.
Docker and Atlas alternatives are below.

### 1. Install

```bash
brew tap mongodb/brew
brew install mongodb/brew/mongodb-community@7.0 mongosh
```

7.0 matches the version the older docs used (`mongo:7`). Check which major
version the Atlas staging cluster runs (Atlas console → cluster → Version),
and prefer the same one locally (e.g. `mongodb-community@8.0`).

### 2. Turn on the replica set

Homebrew's service reads `/opt/homebrew/etc/mongod.conf`. Add the
`replication` block, keeping the existing `systemLog`/`storage`/`net`
sections. The result should look like this:

```yaml
systemLog:
  destination: file
  path: /opt/homebrew/var/log/mongodb/mongo.log
  logAppend: true
storage:
  dbPath: /opt/homebrew/var/mongodb
net:
  bindIp: 127.0.0.1
replication:
  replSetName: rs0
```

`bindIp: 127.0.0.1` keeps it local-only, so no auth is needed for dev.

### 3. Start it and initiate the replica set (once)

```bash
brew services start mongodb/brew/mongodb-community@7.0

mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
mongosh --quiet --eval "rs.status().ok"   # → 1
```

`rs.initiate` is needed only once; the config persists in the data
directory. After a reboot, `brew services` starts it again. Stop it with
`brew services stop mongodb/brew/mongodb-community@7.0`.

### 4. Point `.env` at it

```env
MONGODB_URI=mongodb://127.0.0.1:27017/emoji-app?directConnection=true

# Local dev without Cognito (ignored when NODE_ENV=production)
DISABLE_AUTH=true
VITE_DISABLE_AUTH=true

# Required for the server to start at all; any value works if you don't use the chat panel
OPENAI_API_KEY=sk-...
```

Notes:

- `directConnection=true` connects straight to the one node instead of
  discovering the replica set.
- Without `DISABLE_AUTH=true`, `server/src/auth.ts` throws at startup
  unless the three `COGNITO_*` variables are set.
- `.env.example` sets `MONGODB_URI` **twice** (lines 7 and 29, the second
  one `.../xyz`). Keep exactly one in your `.env`, so the database it uses
  is never in doubt. The duplicate in `.env.example` should be removed.
- Use a database name of your own (`emoji-app`). **Never point local dev
  at the staging Atlas URI**: local experiments would write into staging's
  games.

### 5. Run and check

```bash
npm run dev
```

The server log should include:

```text
[MongoService] MongoDB connected and indexes synchronized.
```

Then open <http://localhost:5200/games>. To look at the data directly:

```bash
mongosh emoji-app --quiet --eval "db.getCollectionNames()"
mongosh emoji-app --quiet --eval "db.players.find().toArray()"
```

Optional: [MongoDB Compass](https://www.mongodb.com/products/compass)
(`brew install --cask mongodb-compass`) gives a GUI on the same URI.

### Reset

```bash
mongosh emoji-app --quiet --eval "db.dropDatabase()"
```

Indexes come back on the next server start.

### Alternatives

- **Docker / OrbStack / Colima:** same idea, one container
  (`../manual-tests.md` §8a):

  ```bash
  docker run -d --name emoji-app-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all
  docker exec emoji-app-mongo mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
  ```

- **A dev database on Atlas:** no local install, and transactions already
  work. Create a separate database user and use a different database name
  (e.g. `emoji-app-dev`) on the cluster, add your IP to the access list,
  and put that URI in `.env`. It's slower per request, and it shares a
  cluster with staging, so the local option is preferred.

---

## Exercising Step 1a without hardware

Stations normally create bindings and guesses. Locally, `curl` can play
the station. With no NFC card group attached, `POST /api/guesses` trusts
the `slotLabel` in the body.

Requires `jq` (ships with macOS 15) and the server on port 3000.

```bash
BASE=http://localhost:3000
REF=000000000000000000000001   # demo referee id (no auth yet; Step 0)
post() { curl -s -X "${3:-POST}" "$BASE$1" -H 'Content-Type: application/json' -d "$2"; }

# Game with one round (A correct, B wrong)
GAME=$(post /api/games "{\"title\":\"Step 1a local\",\"createdByUserId\":\"$REF\"}" | jq -r .gameId)
post /api/questions "{\"gameId\":\"$GAME\",\"createdByUserId\":\"$REF\",\"text\":\"안녕하세요?\",\"sequence\":1,\"mode\":\"standard\",
  \"answerOptions\":[{\"text\":\"Hello\",\"sequence\":1,\"slotLabel\":\"A\",\"isCorrect\":true},
                     {\"text\":\"Goodbye\",\"sequence\":2,\"slotLabel\":\"B\",\"isCorrect\":false}]}"

# One station with two badges
post "/api/games/$GAME/pairs" '{"pairName":"station-1","badgeNames":["red","blue"]}'

# draft → ready → lobby → active, then open round 1
# (Start Game auto-opens only `closed` rounds; a new round is `draft`)
for s in ready lobby active; do post "/api/games/$GAME/state" "{\"state\":\"$s\"}"; done
Q=$(curl -s "$BASE/api/games/$GAME" | jq -r '.questions[0].id')
post "/api/questions/$Q/state" "{\"gameId\":\"$GAME\",\"state\":\"open\"}"

# Two scans: red right, blue wrong
post /api/guesses "{\"gameId\":\"$GAME\",\"questionId\":\"$Q\",\"pairName\":\"station-1\",\"badgeName\":\"red\",\"cardUid\":\"X1\",\"slotLabel\":\"A\"}"
post /api/guesses "{\"gameId\":\"$GAME\",\"questionId\":\"$Q\",\"pairName\":\"station-1\",\"badgeName\":\"blue\",\"cardUid\":\"X2\",\"slotLabel\":\"B\"}"
post "/api/games/$GAME/state" '{"state":"completed"}'

# Step 1a: both badges are missing a player
curl -s "$BASE/api/games/$GAME/player-bindings" | jq '{badgeNames, missingBadges}'

# Referee creates players and binds them (no email allowed: 400)
post /api/players '{"firstName":"Mia","email":"x@example.com"}'
MIA=$(post /api/players '{"firstName":"Mia"}' | jq -r .player.id)
LEO=$(post /api/players '{"firstName":"Leo"}' | jq -r .player.id)
post "/api/games/$GAME/player-bindings/red"  "{\"playerId\":\"$MIA\"}" PUT
post "/api/games/$GAME/player-bindings/blue" "{\"playerId\":\"$LEO\"}" PUT

# Now nothing is missing; bindings carry Player labels, not just names
curl -s "$BASE/api/games/$GAME/player-bindings" | jq '{missingBadges, bindings: [.bindings[] | {badgeName, name: .player.firstName, label: .player.label, reason}]}'
```

Check in the UI as well: open the game at
`http://localhost:5200/games/<GAME>`. The **Players** panel under Referee
Controls should show red → Mia and blue → Leo, and the amber "Guesses
without a player" warning should clear once both are bound.

Things worth trying by hand:

- **Swap:** bind red to Leo. Blue loses Leo (one active badge per player),
  red's old binding gets an `unassignedAt`, and the new row's reason is
  `swap`.
- **Unbind with no replacement:** `DELETE
  /api/games/$GAME/player-bindings/red`. Red's earlier guess is still
  covered by its first binding. A *later* guess from red would show up in
  `missingBadges`.
- **Unknown badge:** `PUT .../player-bindings/green` → 404.

---

## Before Step 1c: things this surfaced

- **Play Again wipes the run.** `setGameState` for `completed → ready`
  deletes the game's `guesses` and `pairBindings`
  (`game-data.repository.ts` → `setGameState`). Export (Step 1c) must
  happen **before** Play Again, or the statements have nothing to read.
  Options for 1c:
  - warn in the UI when Play Again is pressed on a completed,
    never-exported game; or
  - record "exported at" on the game.
- **`playerBindings` survive Play Again** (only `pairBindings` are
  cleared). That's intended for now: the same children usually keep their
  badges. Decide in 1c whether a new run should start with no players
  bound, to match how stations work.
- **No transactions in the player code.** Rebinding ends the old rows and
  then inserts the new one. If the insert fails, the badge is simply
  unbound and the referee binds it again. The unique-active indexes stop
  double bindings either way.
- **Local data is not staging data.** Real pilot exports (Veracity
  `emojiapp-pilot`) come from staging. Local runs should export only to
  the `emojiapp-dev` LRS (`../xAPI/LRS.md`).
