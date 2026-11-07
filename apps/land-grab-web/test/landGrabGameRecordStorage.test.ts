import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGameRecord,
  saveGameRecord,
  loadGameRecords,
  GAME_RECORDS_STORAGE_KEY,
  MAX_STORED_GAME_RECORDS,
  type LandGrabGameRecord,
} from "../src/game/gameRecord";
import {
  createInitialGameState,
  type GameState,
  type PlayerConfig,
} from "@emoji-app/land-grab-core";

const CONFIGS: PlayerConfig[] = [
  { id: "you", label: "You", color: 0x38bdf8, isBot: false },
  { id: "bot-red", label: "Red Bot", color: 0xf87171, isBot: true },
];

function decidedState(): GameState {
  const base = createInitialGameState(10, 12, CONFIGS);
  return {
    ...base,
    tick: 437,
    winnerId: "bot-red",
    players: {
      you: { ...base.players.you, ownedCount: 0, alive: false },
      "bot-red": {
        ...base.players["bot-red"],
        ownedCount: 120,
        alive: true,
      },
    },
  };
}

describe("saveGameRecord / loadGameRecords", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a record through localStorage", () => {
    const record = buildGameRecord(decidedState());
    saveGameRecord(record);

    const loaded = loadGameRecords();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].winner.id).toBe("bot-red");
    expect(loaded[0].ticks).toBe(437);
  });

  it("keeps newest first and caps the list", () => {
    const base = buildGameRecord(decidedState());
    for (let i = 0; i < MAX_STORED_GAME_RECORDS + 5; i++) {
      saveGameRecord({ ...base, ticks: i } as LandGrabGameRecord);
    }
    const loaded = loadGameRecords();
    expect(loaded).toHaveLength(MAX_STORED_GAME_RECORDS);
    expect(loaded[0].ticks).toBe(MAX_STORED_GAME_RECORDS + 4); // most recent write
  });

  it("returns [] when storage is corrupt", () => {
    window.localStorage.setItem(GAME_RECORDS_STORAGE_KEY, "{ not json");
    expect(loadGameRecords()).toEqual([]);
  });

  it("drops rows from an unknown schema version", () => {
    window.localStorage.setItem(GAME_RECORDS_STORAGE_KEY, JSON.stringify([{ schemaVersion: 99 }]));
    expect(loadGameRecords()).toEqual([]);
  });
});

