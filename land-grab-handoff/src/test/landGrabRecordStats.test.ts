import { describe, it, expect } from "vitest";
import { rankPlayers, matchRating, RATING_WEIGHTS } from "@/features/landGrab/recordStats";
import type {
  LandGrabGameRecord,
  LandGrabPlayerRecord,
} from "@/features/landGrab/gameRecord";
import { DEFAULT_BOT_PROFILE } from "@/features/landGrab/botProfile";

const TOTAL_CELLS = 100;

function player(
  id: string,
  overrides: Partial<LandGrabPlayerRecord> = {},
): LandGrabPlayerRecord {
  const peakOwnedCount = overrides.peakOwnedCount ?? 0;
  return {
    id,
    label: id,
    color: "#38bdf8",
    isBot: id !== "you",
    autopilot: id !== "you",
    ownedCount: 0,
    ownedFraction: 0,
    peakOwnedCount,
    peakOwnedFraction: peakOwnedCount / TOTAL_CELLS,
    captures: 0,
    timesCaptured: 0,
    peakChainLength: 0,
    alive: false,
    profile: { ...DEFAULT_BOT_PROFILE },
    ...overrides,
  };
}

function match(
  winnerId: string,
  players: LandGrabPlayerRecord[],
  endedAt = "2026-09-10T12:00:00.000Z",
): LandGrabGameRecord {
  const winner = players.find((p) => p.id === winnerId);
  if (!winner) throw new Error(`test match has no player ${winnerId}`);
  return {
    schemaVersion: 3,
    endedAt,
    winner,
    players,
    ticks: 100,
    durationMs: 16000,
    board: { rows: 10, cols: 10, totalCells: TOTAL_CELLS },
    rules: { respawnDelayTicks: 12 },
  };
}

describe("matchRating", () => {
  it("scores a win, peak share, and capture nudges", () => {
    expect(
      matchRating({ won: true, peakOwnedFraction: 0.5, captures: 2, timesCaptured: 1 }),
    ).toBeCloseTo(RATING_WEIGHTS.win + 0.5 + 2 * 0.05 - 1 * 0.05);
  });

  it("can go negative for a player who never scored and was sunk repeatedly", () => {
    expect(
      matchRating({ won: false, peakOwnedFraction: 0, captures: 0, timesCaptured: 3 }),
    ).toBeCloseTo(-0.15);
  });
});

describe("rankPlayers", () => {
  it("returns nothing for an empty history", () => {
    expect(rankPlayers([])).toEqual([]);
  });

  it("ranks the winner of a lone match first", () => {
    const ranked = rankPlayers([
      match("bot-red", [
        player("bot-red", { peakOwnedCount: 100, ownedCount: 100, alive: true, captures: 3 }),
        player("you", { peakOwnedCount: 40, timesCaptured: 3 }),
      ]),
    ]);

    expect(ranked.map((r) => r.id)).toEqual(["bot-red", "you"]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].rating).toBeCloseTo(1 + 1 + 3 * 0.05);
    expect(ranked[1].rating).toBeCloseTo(0.4 - 3 * 0.05);
  });

  it("aggregates matches, wins, win rate, peak share, and captures across games", () => {
    const ranked = rankPlayers([
      match("bot-red", [
        player("bot-red", { peakOwnedCount: 80, captures: 2 }),
        player("bot-green", { peakOwnedCount: 60, timesCaptured: 2 }),
      ]),
      match("bot-green", [
        player("bot-red", { peakOwnedCount: 40, timesCaptured: 1 }),
        player("bot-green", { peakOwnedCount: 100, captures: 1 }),
      ]),
    ]);

    const red = ranked.find((r) => r.id === "bot-red")!;
    const green = ranked.find((r) => r.id === "bot-green")!;

    expect(red.matches).toBe(2);
    expect(red.wins).toBe(1);
    expect(red.winRate).toBeCloseTo(0.5);
    expect(red.avgPeakFraction).toBeCloseTo((0.8 + 0.4) / 2);
    expect(red.bestPeakFraction).toBeCloseTo(0.8);
    expect(red.captures).toBe(2);
    expect(red.timesCaptured).toBe(1);
    expect(red.captureDiff).toBe(1);

    expect(green.matches).toBe(2);
    expect(green.wins).toBe(1);
    expect(green.avgPeakFraction).toBeCloseTo((0.6 + 1.0) / 2);
    expect(green.captureDiff).toBe(-1);

    // green's higher average peak share breaks the rating tie in its favour
    expect(ranked.map((r) => r.id)).toEqual(["bot-green", "bot-red"]);
  });

  it("collapses a renamed player to one row using their most recent identity", () => {
    const ranked = rankPlayers([
      match(
        "you",
        [player("you", { label: "NewName", color: "#22c55e", peakOwnedCount: 90, alive: true })],
        "2026-09-11T00:00:00.000Z",
      ),
      match(
        "you",
        [player("you", { label: "OldName", color: "#38bdf8", peakOwnedCount: 50 })],
        "2026-09-10T00:00:00.000Z",
      ),
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].label).toBe("NewName");
    expect(ranked[0].color).toBe("#22c55e");
    expect(ranked[0].matches).toBe(2);
    expect(ranked[0].wins).toBe(2);
  });

  it("breaks an exact rating + win-rate + peak tie on the label, and ranks 1..n", () => {
    const ranked = rankPlayers([
      match("bot-red", [
        player("bot-red", { label: "Red", peakOwnedCount: 50, alive: true }),
        player("bot-blue", { label: "Blue", peakOwnedCount: 50 }),
      ]),
      match("bot-blue", [
        player("bot-red", { label: "Red", peakOwnedCount: 50 }),
        player("bot-blue", { label: "Blue", peakOwnedCount: 50, alive: true }),
      ]),
    ]);
    // each: rating = ((1 + 0.5) + 0.5) / 2 = 1.0, winRate 0.5, avgPeak 0.5 — tie
    expect(ranked[0].rating).toBeCloseTo(ranked[1].rating);
    expect(ranked.map((r) => r.label)).toEqual(["Blue", "Red"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });
});
