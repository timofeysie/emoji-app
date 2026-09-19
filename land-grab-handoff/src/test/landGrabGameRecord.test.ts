import { describe, it, expect, beforeEach } from "vitest";
import {
  buildGameRecord,
  saveGameRecord,
  loadGameRecords,
  GAME_RECORDS_STORAGE_KEY,
  MAX_STORED_GAME_RECORDS,
  type LandGrabGameRecord,
} from "@/features/landGrab/gameRecord";
import { createInitialGameState, type GameState, type PlayerConfig } from "@/features/landGrab/simulation";
import { DEFAULT_BOT_PROFILE } from "@/features/landGrab/botProfile";

const CONFIGS: PlayerConfig[] = [
  { id: "you", label: "You", color: 0x38bdf8, isBot: false },
  { id: "bot-red", label: "Red Bot", color: 0xf87171, isBot: true },
];

/** A finished 10x12 match that bot-red won on tick 437. */
function decidedState(): GameState {
  const base = createInitialGameState(10, 12, CONFIGS);
  return {
    ...base,
    tick: 437,
    winnerId: "bot-red",
    players: {
      you: {
        ...base.players.you,
        ownedCount: 0,
        peakOwnedCount: 42,
        alive: false,
        captures: 1,
        timesCaptured: 4,
      },
      "bot-red": {
        ...base.players["bot-red"],
        ownedCount: 120,
        peakOwnedCount: 120,
        alive: true,
        captures: 3,
        timesCaptured: 2,
      },
    },
  };
}

describe("buildGameRecord", () => {
  it("captures the winner, board, and timing", () => {
    const record = buildGameRecord(decidedState(), { endedAt: new Date("2026-09-10T12:00:00.000Z") });

    expect(record.schemaVersion).toBe(4);
    expect(record.endedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(record.ticks).toBe(437);
    expect(record.durationMs).toBe(437 * 160); // TICK_MS
    expect(record.board).toEqual({ rows: 10, cols: 12, totalCells: 120 });
    expect(record.rules.respawnDelayTicks).toBe(12);

    expect(record.winner.id).toBe("bot-red");
    expect(record.winner.label).toBe("Red Bot");
    expect(record.winner.color).toBe("#f87171");
    expect(record.winner.isBot).toBe(true);
    expect(record.winner.captures).toBe(3);
    expect(record.winner.timesCaptured).toBe(2);
    expect(record.winner.ownedCount).toBe(120);
    expect(record.winner.ownedFraction).toBeCloseTo(1);
    expect(record.winner.peakOwnedCount).toBe(120);
    expect(record.winner.peakOwnedFraction).toBeCloseTo(1);
    expect(record.winner.profile).toEqual(DEFAULT_BOT_PROFILE);
  });

  it("scores each player as owned cells plus a board-share bonus per current chain length", () => {
    const record = buildGameRecord(decidedState(), { chainLengths: { "bot-red": 3, you: 1 } });
    // 2 players, 120 total cells -> each chain link is worth 120 / 2 = 60.
    expect(record.winner.score).toBe(120 + 3 * 60); // 300
    expect(record.players.find((p) => p.id === "you")?.score).toBe(0 + 1 * 60); // 60
  });

  it("scores from chain length, not the lifetime captures counter, when no chainLengths snapshot is given", () => {
    const record = buildGameRecord(decidedState());
    // bot-red's lifetime captures is 3, but with no chainLengths given its current chain is 0.
    expect(record.winner.captures).toBe(3);
    expect(record.winner.score).toBe(120);
    expect(record.players.find((p) => p.id === "you")?.score).toBe(0);
  });

  it("lists every player in playerOrder", () => {
    const record = buildGameRecord(decidedState());
    expect(record.players.map((p) => p.id)).toEqual(["you", "bot-red"]);
    expect(record.players.find((p) => p.id === "you")?.ownedFraction).toBe(0);
  });

  it("records each player's high-water mark and how often they were sunk", () => {
    const record = buildGameRecord(decidedState());
    const you = record.players.find((p) => p.id === "you");
    expect(you?.ownedCount).toBe(0); // finished with nothing…
    expect(you?.peakOwnedCount).toBe(42); // …but held 42 cells at their best
    expect(you?.peakOwnedFraction).toBeCloseTo(42 / 120);
    expect(you?.timesCaptured).toBe(4);
  });

  it("throws if the game is not decided", () => {
    expect(() => buildGameRecord({ ...decidedState(), winnerId: null })).toThrow();
  });

  it("defaults peakChainLength to 0 when no chain-peaks snapshot is given", () => {
    const record = buildGameRecord(decidedState());
    expect(record.winner.peakChainLength).toBe(0);
    expect(record.players.find((p) => p.id === "you")?.peakChainLength).toBe(0);
  });

  it("records each player's peak chain length from the given snapshot", () => {
    const record = buildGameRecord(decidedState(), { chainPeaks: { "bot-red": 3, you: 1 } });
    expect(record.winner.peakChainLength).toBe(3);
    expect(record.players.find((p) => p.id === "you")?.peakChainLength).toBe(1);
  });
});

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
