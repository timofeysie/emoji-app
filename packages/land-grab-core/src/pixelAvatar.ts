/**
 * Pure helpers for the player's custom 8x8 pixel-art avatar. Kept separate from
 * `PixelAvatarEditor` (the React UI) and the Phaser texture code in
 * `LandGrabDemo.tsx` so the grid shape/validation can be unit tested on its own —
 * same split as `botProfile.ts` / `BotProfilePanel.tsx`.
 */

export const AVATAR_SIZE = 8;
export const AVATAR_CELL_COUNT = AVATAR_SIZE * AVATAR_SIZE;

/**
 * Row-major flattened 8x8 grid, length `AVATAR_CELL_COUNT`. Each cell is either
 * a `#rrggbb` hex color or `null` for "leave transparent, show nothing here".
 * `null` in `userProfile` (not this array) means "no custom avatar at all —
 * fall back to the plain color circle".
 */
export type AvatarGrid = (string | null)[];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** An all-transparent starting grid for a brand-new avatar. */
export function createEmptyAvatar(): AvatarGrid {
  return new Array(AVATAR_CELL_COUNT).fill(null);
}

/** True if `value` is a well-formed avatar grid: right length, each cell `null` or a `#rrggbb` hex string. */
export function isValidAvatarGrid(value: unknown): value is AvatarGrid {
  if (!Array.isArray(value) || value.length !== AVATAR_CELL_COUNT) return false;
  return value.every((cell) => cell === null || (typeof cell === "string" && HEX_COLOR_RE.test(cell)));
}

/** True if every cell is transparent — equivalent to no custom avatar at all. */
export function isBlankAvatar(grid: AvatarGrid): boolean {
  return grid.every((cell) => cell === null);
}

/** Parse/sanitize a value loaded from storage: valid grid, blank grid, and anything else all collapse sensibly. */
export function resolveAvatar(value: unknown): AvatarGrid | null {
  if (!isValidAvatarGrid(value)) return null;
  return isBlankAvatar(value) ? null : value;
}
