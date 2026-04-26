# Milestone 2: Data Model Finalization and Collection Design

## Purpose

Finalize MongoDB collection boundaries and contracts for game flows before
implementing Mongoose models.

## Canonical collections

1. `users`
2. `badges`
3. `games`
4. `gameParticipants`
5. `playerBadgeAssignments`
6. `questions`
7. `answerOptions`
8. `nfcCardGroups`
9. `nfcCards`
10. `gameNfcCardGroupAssignments`
11. `guesses`

## Field contracts by collection

### `users`

- **Required:** `_id`, `displayName`, `authProviderId`, `createdAt`, `updatedAt`
- **Optional:** none
- **Immutable:** `_id`, `authProviderId`, `createdAt`
- **Notes:** `authProviderId` is the Cognito `sub` or equivalent auth subject.

### `badges`

- **Required:** `_id`, `externalBadgeId`, `label`, `status`, `createdAt`,
  `updatedAt`
- **Optional:** none
- **Enum:** `status` = `active | inactive | broken | retired`
- **Immutable:** `_id`, `externalBadgeId`, `createdAt`

### `games`

- **Required:** `_id`, `title`, `state`, `createdByUserId`, `createdAt`,
  `updatedAt`
- **Optional:** `startedAt`, `endedAt`
- **Enum:** `state` = `draft | lobby | active | paused | completed | cancelled`
- **Immutable:** `_id`, `createdByUserId`, `createdAt`

### `gameParticipants`

- **Required:** `_id`, `gameId`, `userId`, `role`, `joinedAt`, `status`
- **Optional:** `playMode`, `leftAt`
- **Enum:** `role` = `player | referee | spectator`
- **Enum:** `playMode` = `standard | cut-throat` (required when `role = player`)
- **Enum:** `status` = `active | removed | disconnected`
- **Immutable:** `_id`, `gameId`, `userId`, `joinedAt`

### `playerBadgeAssignments`

- **Required:** `_id`, `gameId`, `userId`, `badgeId`, `assignedAt`, `reason`
- **Optional:** `unassignedAt`
- **Enum:** `reason` = `initial | swap | replacement | recovery | admin_override`
- **Immutable:** `_id`, `gameId`, `userId`, `badgeId`, `assignedAt`
- **Notes:** Active assignment means `unassignedAt = null`.

### `questions`

- **Required:** `_id`, `gameId`, `text`, `sequence`, `mode`, `state`,
  `createdByUserId`, `createdAt`, `updatedAt`
- **Optional:** `openedAt`, `closedAt`
- **Enum:** `mode` = `standard | cut-throat | mixed`
- **Enum:** `state` = `draft | open | closed | scored | archived`
- **Immutable:** `_id`, `gameId`, `sequence`, `createdByUserId`, `createdAt`

### `answerOptions`

- **Required:** `_id`, `questionId`, `text`, `sequence`, `slotLabel`,
  `isCorrect`, `createdAt`
- **Optional:** none
- **Enum:** `slotLabel` = `A | B | C | D | E`
- **Immutable:** `_id`, `questionId`, `sequence`, `slotLabel`, `createdAt`
- **Notes:** Use soft-edit policy for text fixes, never reassign slot labels.

### `nfcCardGroups`

- **Required:** `_id`, `name`, `status`, `createdAt`, `updatedAt`
- **Optional:** `description`
- **Enum:** `status` = `active | inactive | archived`
- **Immutable:** `_id`, `createdAt`

### `nfcCards`

- **Required:** `_id`, `cardUid`, `groupId`, `slotLabel`, `displayName`,
  `status`, `createdAt`, `updatedAt`
- **Optional:** none
- **Enum:** `slotLabel` = `A | B | C | D | E`
- **Enum:** `status` = `active | retired | lost`
- **Immutable:** `_id`, `cardUid`, `groupId`, `createdAt`
- **Notes:** `displayName` holds labels like `Answer Card A`.

### `gameNfcCardGroupAssignments`

- **Required:** `_id`, `gameId`, `groupId`, `assignedAt`, `assignedByUserId`,
  `status`
- **Optional:** `unassignedAt`, `reason`
- **Enum:** `status` = `active | superseded | removed`
- **Immutable:** `_id`, `gameId`, `groupId`, `assignedAt`, `assignedByUserId`
- **Notes:** Enforces one active NFC card group for each game.

### `guesses`

- **Required:** `_id`, `gameId`, `questionId`, `answerOptionId`, `guesserUserId`,
  `createdAt`
- **Optional:** `badgeId`, `cardUid`, `slotLabel`
- **Immutable:** all fields except operational metadata
- **Notes:** Store both raw scan context and resolved target for auditability.

## Reference strategy

Use references (ObjectId links), not embedding, for relationships that need
independent lifecycle management, high-write throughput, or replayable history.

- `games -> questions`: **reference**
- `questions -> answerOptions`: **reference**
- `games -> gameParticipants`: **reference**
- `games -> playerBadgeAssignments`: **reference**
- `games -> guesses`: **reference**
- `nfcCardGroups -> nfcCards`: **reference**
- `games -> gameNfcCardGroupAssignments`: **reference**
- `guesses -> answerOptions`: **reference**

Embedding is limited to bounded value objects only (for example, future
display-only snapshots) and not used in Milestone 2 canonical writes.

## Index matrix

### Uniqueness indexes

- `users`: unique `authProviderId`
- `badges`: unique `externalBadgeId`
- `gameParticipants`: unique compound `(gameId, userId)`
- `questions`: unique compound `(gameId, sequence)`
- `answerOptions`: unique compound `(questionId, sequence)`
- `answerOptions`: unique compound `(questionId, slotLabel)`
- `nfcCards`: unique `cardUid`
- `nfcCards`: unique compound `(groupId, slotLabel)`
- `guesses`: unique compound `(questionId, guesserUserId)`

### Partial uniqueness indexes

- `playerBadgeAssignments`: unique `(gameId, userId)` where `unassignedAt = null`
- `playerBadgeAssignments`: unique `(gameId, badgeId)` where `unassignedAt = null`
- `gameNfcCardGroupAssignments`: unique `(gameId)` where `status = active`

### Query-support indexes

- `games`: `(state, createdAt)`
- `gameParticipants`: `(gameId, role, status)`
- `questions`: `(gameId, state, sequence)`
- `answerOptions`: `(questionId, slotLabel)`
- `guesses`: `(gameId, questionId, createdAt)`
- `guesses`: `(questionId, createdAt)`
- `playerBadgeAssignments`: `(gameId, userId, assignedAt)`
- `nfcCards`: `(groupId, status)`
- `gameNfcCardGroupAssignments`: `(gameId, status, assignedAt)`

## Integrity ownership

Database-enforced:

- Entity uniqueness keys.
- Active-assignment uniqueness via partial indexes.

Service-enforced:

- Exactly one active referee for a game.
- `playMode` required only for `player`.
- `question.state = open` before guess acceptance.
- `answerOptionId` belongs to `questionId`.
- `slotLabel` resolution uses the game's active NFC group.

## Lifecycle mapping to persisted operations

### Core game flow

1. Create game: insert `games`.
2. Join game: upsert `gameParticipants`.
3. Assign player mode: update `gameParticipants.playMode`.
4. Assign badge: insert `playerBadgeAssignments` active row.
5. Open question: update `questions.state = open`, set `openedAt`.
6. Submit guess:
   - lookup active NFC group from `gameNfcCardGroupAssignments`
   - resolve `cardUid -> nfcCards.slotLabel`
   - resolve `slotLabel + questionId -> answerOptionId`
   - insert `guesses` with raw and resolved fields
7. Close question: update `questions.state = closed`, set `closedAt`.
8. Badge swap: set prior `playerBadgeAssignments.unassignedAt`, insert new row.

### NFC card setup flow

1. Create group: insert `nfcCardGroups`.
2. Register cards: insert `nfcCards` with `cardUid`, `slotLabel`, `displayName`.
3. Attach group to game:
   - mark any prior active assignment as `superseded`
   - insert active `gameNfcCardGroupAssignments` row
4. Replace lost card:
   - mark old `nfcCards.status = lost`
   - add replacement `nfcCards` entry
   - preserve prior guess history as immutable records

## Query-shape validation checklist

- Create/read active game lobby quickly by `games.state`.
- Resolve participant role and play mode in one indexed read.
- Resolve open question and its slot map by `questionId`.
- Enforce one guess per user per question under concurrent submissions.
- Resolve badge-card scans within target latency for classroom rounds.

## Milestone 2 sign-off checklist

- [x] Canonical collection list finalized.
- [x] Field contracts finalized, including NFC card grouping.
- [x] Reference strategy documented.
- [x] Index matrix finalized for uniqueness and query paths.
- [x] Core and NFC lifecycle mappings documented.
- [x] Service-vs-database integrity ownership documented.
- [x] Ready to implement Mongoose schemas and repositories.
