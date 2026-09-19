import { describe, it, expect } from "vitest";
import {
  AVATAR_CELL_COUNT,
  createEmptyAvatar,
  isValidAvatarGrid,
  isBlankAvatar,
  resolveAvatar,
} from "@/features/landGrab/pixelAvatar";

describe("createEmptyAvatar", () => {
  it("is all-null and the right length", () => {
    const grid = createEmptyAvatar();
    expect(grid).toHaveLength(AVATAR_CELL_COUNT);
    expect(grid.every((cell) => cell === null)).toBe(true);
  });
});

describe("isValidAvatarGrid", () => {
  it("accepts a well-formed grid of nulls and hex colors", () => {
    const grid = createEmptyAvatar();
    grid[0] = "#ff0000";
    expect(isValidAvatarGrid(grid)).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isValidAvatarGrid(new Array(10).fill(null))).toBe(false);
  });

  it("rejects a non-hex color string", () => {
    const grid = createEmptyAvatar();
    grid[0] = "red";
    expect(isValidAvatarGrid(grid)).toBe(false);
  });

  it("rejects non-array values", () => {
    expect(isValidAvatarGrid(null)).toBe(false);
    expect(isValidAvatarGrid("nope")).toBe(false);
    expect(isValidAvatarGrid({})).toBe(false);
  });
});

describe("isBlankAvatar", () => {
  it("is true for an all-null grid", () => {
    expect(isBlankAvatar(createEmptyAvatar())).toBe(true);
  });

  it("is false once any cell is painted", () => {
    const grid = createEmptyAvatar();
    grid[63] = "#00ff00";
    expect(isBlankAvatar(grid)).toBe(false);
  });
});

describe("resolveAvatar", () => {
  it("passes through a valid, non-blank grid", () => {
    const grid = createEmptyAvatar();
    grid[0] = "#123456";
    expect(resolveAvatar(grid)).toEqual(grid);
  });

  it("collapses a blank grid to null", () => {
    expect(resolveAvatar(createEmptyAvatar())).toBeNull();
  });

  it("collapses malformed input to null", () => {
    expect(resolveAvatar(undefined)).toBeNull();
    expect(resolveAvatar(["red"])).toBeNull();
  });
});
