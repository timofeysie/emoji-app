import { resolveAvatar, type AvatarGrid } from "./pixelAvatar";

/**
 * The local player's profile. Like `gameRecord`, there's no backend yet, so this
 * is just a single JSON blob in `localStorage`; swapping in a real API later only
 * means replacing the two storage helpers.
 */
export interface LandGrabUserProfile {
  /** Bump if the shape below changes so an old blob can be discarded on read. */
  schemaVersion: 1;
  /** What the human player is called in the UI. Never empty — see `resolveUsername`. */
  username: string;
  /** Custom 8x8 pixel-art avatar, or `null` to use the plain color marker. Added after schemaVersion 1 shipped, so it's optional/absent on old blobs rather than forcing a version bump. */
  avatar?: AvatarGrid | null;
}

export const USER_PROFILE_STORAGE_KEY = "landgrab:user-profile";
export const DEFAULT_USERNAME = "You";
export const MAX_USERNAME_LENGTH = 24;

/** Trim, clamp length, and fall back to the default when the result is empty. */
export function resolveUsername(raw: string): string {
  const trimmed = raw.trim().slice(0, MAX_USERNAME_LENGTH);
  return trimmed || DEFAULT_USERNAME;
}

/** The stored profile, or a default one if storage is unavailable / corrupt / unset. */
export function loadUserProfile(): LandGrabUserProfile {
  try {
    const raw = window.localStorage.getItem(USER_PROFILE_STORAGE_KEY);
    if (!raw) return { schemaVersion: 1, username: DEFAULT_USERNAME, avatar: null };
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== 1 || typeof parsed.username !== "string") {
      return { schemaVersion: 1, username: DEFAULT_USERNAME, avatar: null };
    }
    return {
      schemaVersion: 1,
      username: resolveUsername(parsed.username),
      avatar: resolveAvatar(parsed.avatar),
    };
  } catch {
    return { schemaVersion: 1, username: DEFAULT_USERNAME, avatar: null };
  }
}

/** Persist `profile`. Silently no-ops if storage is unavailable. */
export function saveUserProfile(profile: LandGrabUserProfile): void {
  try {
    window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private-mode / quota / no-DOM — the name just isn't remembered.
  }
}
