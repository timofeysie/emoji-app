import { describe, it, expect, beforeEach } from "vitest";
import {
  loadUserProfile,
  saveUserProfile,
  resolveUsername,
  DEFAULT_USERNAME,
  MAX_USERNAME_LENGTH,
  USER_PROFILE_STORAGE_KEY,
} from "@/features/landGrab/userProfile";
import { AVATAR_CELL_COUNT } from "@/features/landGrab/pixelAvatar";

describe("resolveUsername", () => {
  it("trims surrounding whitespace", () => {
    expect(resolveUsername("  Captain  ")).toBe("Captain");
  });

  it("falls back to the default when empty or blank", () => {
    expect(resolveUsername("")).toBe(DEFAULT_USERNAME);
    expect(resolveUsername("   ")).toBe(DEFAULT_USERNAME);
  });

  it("clamps to the max length", () => {
    const long = "x".repeat(MAX_USERNAME_LENGTH + 10);
    expect(resolveUsername(long)).toHaveLength(MAX_USERNAME_LENGTH);
  });
});

describe("loadUserProfile / saveUserProfile", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns the default profile when nothing is stored", () => {
    expect(loadUserProfile()).toEqual({ schemaVersion: 1, username: DEFAULT_USERNAME, avatar: null });
  });

  it("round-trips a username through localStorage", () => {
    saveUserProfile({ schemaVersion: 1, username: "Skipper" });
    expect(loadUserProfile().username).toBe("Skipper");
  });

  it("round-trips a custom avatar through localStorage", () => {
    const avatar = new Array(AVATAR_CELL_COUNT).fill(null);
    avatar[0] = "#ff0000";
    saveUserProfile({ schemaVersion: 1, username: "Skipper", avatar });
    expect(loadUserProfile().avatar).toEqual(avatar);
  });

  it("drops a stored avatar that's the wrong shape", () => {
    window.localStorage.setItem(
      USER_PROFILE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, username: "Skipper", avatar: ["#ff0000"] }),
    );
    expect(loadUserProfile().avatar).toBeNull();
  });

  it("collapses an all-blank stored avatar to null", () => {
    window.localStorage.setItem(
      USER_PROFILE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, username: "Skipper", avatar: new Array(AVATAR_CELL_COUNT).fill(null) }),
    );
    expect(loadUserProfile().avatar).toBeNull();
  });

  it("defaults avatar to null for an old blob saved before avatars existed", () => {
    window.localStorage.setItem(
      USER_PROFILE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, username: "Skipper" }),
    );
    expect(loadUserProfile().avatar).toBeNull();
  });

  it("resolves a stored username on read", () => {
    window.localStorage.setItem(
      USER_PROFILE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, username: "  Skipper  " }),
    );
    expect(loadUserProfile().username).toBe("Skipper");
  });

  it("falls back to the default when storage is corrupt", () => {
    window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, "{ not json");
    expect(loadUserProfile().username).toBe(DEFAULT_USERNAME);
  });

  it("ignores an unknown schema version", () => {
    window.localStorage.setItem(
      USER_PROFILE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 99, username: "Ghost" }),
    );
    expect(loadUserProfile().username).toBe(DEFAULT_USERNAME);
  });
});
