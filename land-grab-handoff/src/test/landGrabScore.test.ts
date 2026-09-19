import { describe, it, expect } from "vitest";
import { captureValue, computeTotalScore } from "@/features/landGrab/score";

describe("captureValue", () => {
  it("is one even share of the board", () => {
    expect(captureValue(120, 4)).toBe(30);
    expect(captureValue(100, 2)).toBe(50);
  });

  it("is 0 when there are no players", () => {
    expect(captureValue(120, 0)).toBe(0);
  });
});

describe("computeTotalScore", () => {
  it("is just the owned cells with no captures", () => {
    expect(computeTotalScore(75, 0, 120, 4)).toBe(75);
  });

  it("adds one board-share bonus per capture", () => {
    // 30 cells + 2 captures * (120 / 4 = 30 each) = 90
    expect(computeTotalScore(30, 2, 120, 4)).toBe(90);
  });

  it("still scores a sunk player (0 cells) from captures alone", () => {
    expect(computeTotalScore(0, 1, 120, 4)).toBe(30);
  });

  it("rounds to a whole number", () => {
    // 10 cells + 1 capture * (100 / 3 = 33.33...) = 43.33... -> 43
    expect(computeTotalScore(10, 1, 100, 3)).toBe(43);
  });
});
