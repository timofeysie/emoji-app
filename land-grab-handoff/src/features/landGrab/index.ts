export { LandGrabDemo } from "./LandGrabDemo";
export { createInitialGameState, setPlayerFacing, stepGame, DEFAULT_GAME_RULES } from "./simulation";
export type { GameState, GameRules, PlayerConfig, PlayerState, CaptureEvent } from "./simulation";
export { applyCaptureEvents, clearDeadChains, appendHeadHistory, chainPositions } from "./chainTrail";
export type { ChainMap } from "./chainTrail";
export {
  DEFAULT_BOT_PROFILE,
  BOT_PROFILE_FIELDS,
  SURVEYOR_EXTRA_FIELDS,
  SURVEYOR_PROFILE_FIELDS,
  INVADER_EXTRA_FIELDS,
  INVADER_PROFILE_FIELDS,
  cloneProfile,
} from "./botProfile";
export type { BotProfile, BotProfileField } from "./botProfile";
export { BOT_STRATEGIES, DEFAULT_BOT_TYPE, createBotMemory, strategyFor } from "./botStrategy";
export type { BotType, BotMemory, BotStrategy } from "./botStrategy";
export {
  createSurveyorMemory,
  nearestOwnedDistance,
  nearestNeutralDistance,
  isFrontierAdjacent,
  estimateEnclosedArea,
  nearestRivalHeadDistance,
} from "./surveyorStrategy";
export type { SurveyorMemory } from "./surveyorStrategy";
export {
  createInvaderMemory,
  nearestLivingRival,
  alignmentAxis,
  nearestRivalTrailDistance,
} from "./invaderStrategy";
export type { InvaderMemory } from "./invaderStrategy";
export {
  buildGameRecord,
  saveGameRecord,
  loadGameRecords,
  clearGameRecords,
  GAME_RECORDS_STORAGE_KEY,
  MAX_STORED_GAME_RECORDS,
} from "./gameRecord";
export type { LandGrabGameRecord, LandGrabPlayerRecord, BuildGameRecordOptions } from "./gameRecord";
export {
  createReplayLog,
  recordFrame,
  frameGridAt,
  frameChainsAt,
  frameHeadHistoryAt,
  MAX_REPLAY_TICKS,
} from "./replayLog";
export type {
  ReplayLog,
  ReplayFrame,
  ReplayPlayerFrame,
  ReplayCellChange,
  ReplayPlayerMeta,
} from "./replayLog";
export { LandGrabReplay } from "./LandGrabReplay";
export type { LandGrabReplayProps } from "./LandGrabReplay";
export { rankPlayers, matchRating, RATING_WEIGHTS } from "./recordStats";
export type { PlayerRanking } from "./recordStats";
export { MatchRecordsPanel } from "./MatchRecordsPanel";
export { MatchRecordsChart } from "./MatchRecordsChart";
export {
  loadUserProfile,
  saveUserProfile,
  resolveUsername,
  DEFAULT_USERNAME,
  MAX_USERNAME_LENGTH,
  USER_PROFILE_STORAGE_KEY,
} from "./userProfile";
export type { LandGrabUserProfile } from "./userProfile";
export {
  AVATAR_SIZE,
  AVATAR_CELL_COUNT,
  createEmptyAvatar,
  isValidAvatarGrid,
  isBlankAvatar,
  resolveAvatar,
} from "./pixelAvatar";
export type { AvatarGrid } from "./pixelAvatar";
export { PixelAvatarEditor } from "./PixelAvatarEditor";
export type { PixelAvatarEditorProps } from "./PixelAvatarEditor";
export { resolveCapture, createEmptyGrid, countOwnedCells } from "./grid";
export type { CellState } from "./grid";
export { resolveTerritorySplit } from "./splitResolution";
export type { Direction, Vec2 } from "./types";
export { computeTotalScore, captureValue } from "./score";
