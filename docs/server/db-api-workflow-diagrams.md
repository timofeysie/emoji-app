# DB Entity and API Workflow Diagrams

## Entity relationships (Mongo collections)

```mermaid
flowchart TD
  users[users] -->|creates| games[games]
  users -->|joins| gameParticipants[gameParticipants]
  users -->|submits| guesses[guesses]
  users -->|assigns_group| gameGroupAssignments[gameNfcCardGroupAssignments]

  games --> gameParticipants
  games --> questions[questions]
  games --> playerBadgeAssignments[playerBadgeAssignments]
  games --> gameGroupAssignments
  games --> guesses

  badges[badges] --> playerBadgeAssignments
  questions --> answerOptions[answerOptions]
  questions --> guesses
  answerOptions --> guesses

  nfcCardGroups[nfcCardGroups] --> nfcCards[nfcCards]
  nfcCardGroups --> gameGroupAssignments
  nfcCards -->|cardUid_to_slotLabel| guesses
```

## Sample API workflow (DB-backed round)

```mermaid
sequenceDiagram
  participant Client as TestClientOrUI
  participant Api as NestApi
  participant Repo as GameDataRepository
  participant Db as MongoDB

  Client->>Api: POST /api/games
  Api->>Repo: createGame()
  Repo->>Db: insert games
  Db-->>Repo: gameId
  Repo-->>Api: gameId
  Api-->>Client: 201 { gameId }

  Client->>Api: POST /api/games/:gameId/participants
  Api->>Repo: addParticipant()
  Repo->>Db: upsert gameParticipants
  Api-->>Client: 201 { ok: true }

  Client->>Api: POST /api/games/nfc-card-groups
  Api->>Repo: createNfcCardGroup()
  Repo->>Db: insert nfcCardGroups + nfcCards
  Api-->>Client: 201 { groupId }

  Client->>Api: POST /api/games/:gameId/nfc-card-groups/:groupId/attach
  Api->>Repo: assignNfcCardGroupToGame()
  Repo->>Db: supersede old assignment + insert active assignment
  Api-->>Client: 201 { ok: true }

  Client->>Api: POST /api/questions
  Api->>Repo: createQuestionWithOptions()
  Repo->>Db: insert questions + answerOptions
  Api-->>Client: 201 { questionId }

  Client->>Api: POST /api/questions/:questionId/state { state: open }
  Api->>Repo: setQuestionState(open)
  Repo->>Db: update questions
  Api-->>Client: 200 { ok: true }

  Client->>Api: POST /api/guesses
  Api->>Repo: submitGuess()
  Repo->>Db: read active group, nfc card, answer option
  Repo->>Db: insert guesses
  Api-->>Client: 201 { guessId, answerOptionId }
```

## Endpoint summary

- `POST /api/games`
- `POST /api/games/:gameId/participants`
- `POST /api/games/nfc-card-groups`
- `POST /api/games/:gameId/nfc-card-groups/:groupId/attach`
- `POST /api/questions`
- `POST /api/questions/:questionId/state`
- `POST /api/guesses`
