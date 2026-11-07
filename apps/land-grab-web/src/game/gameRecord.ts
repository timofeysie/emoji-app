export {
  buildGameRecord,
  GAME_RECORDS_STORAGE_KEY,
  MAX_STORED_GAME_RECORDS,
} from "@emoji-app/land-grab-core";
export type {
  BuildGameRecordOptions,
  LandGrabGameRecord,
  LandGrabPlayerRecord,
} from "@emoji-app/land-grab-core";

import {
  GAME_RECORDS_STORAGE_KEY,
  MAX_STORED_GAME_RECORDS,
  type LandGrabGameRecord,
} from "@emoji-app/land-grab-core";

export function loadGameRecords(): LandGrabGameRecord[] {
  try {
    const raw = window.localStorage.getItem(GAME_RECORDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is LandGrabGameRecord =>
        typeof row === "object" &&
        row !== null &&
        "schemaVersion" in row &&
        row.schemaVersion === 4,
    );
  } catch {
    return [];
  }
}

export function saveGameRecord(
  record: LandGrabGameRecord,
): LandGrabGameRecord[] {
  const next = [record, ...loadGameRecords()].slice(
    0,
    MAX_STORED_GAME_RECORDS,
  );
  try {
    window.localStorage.setItem(
      GAME_RECORDS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // A match can still finish when browser storage is unavailable.
  }
  return next;
}

export function clearGameRecords(): void {
  try {
    window.localStorage.removeItem(GAME_RECORDS_STORAGE_KEY);
  } catch {
    // There is nothing to clear when browser storage is unavailable.
  }
}
