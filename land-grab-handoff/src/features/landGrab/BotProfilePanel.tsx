import { useState } from "react";
import type { BotProfile } from "./botProfile";
import { BOT_STRATEGIES, strategyFor, type BotType } from "./botStrategy";
import type { GameRules, PlayerConfig } from "./simulation";
import { MAX_USERNAME_LENGTH, resolveUsername } from "./userProfile";
import { PixelAvatarEditor } from "./PixelAvatarEditor";
import { AVATAR_SIZE, type AvatarGrid } from "./pixelAvatar";

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(parseFloat(value.toFixed(2)));
}

/** One-liner under the archetype picker on each driven card. `Record<BotType, …>` so a new archetype can't skip it. */
const ARCHETYPE_BLURB: Record<BotType, string> = {
  rambler: "Greedy roamer — strikes out into open water, then beelines home to bank a small loop.",
  surveyor: "Territory farmer — hugs its own frontier one cell out and folds in short, chunky loops.",
  invader: "Raider — hunts a rival into a head-on stand-off, then jukes aside and cuts their wake as they pass.",
};

/** The fixed rules a keyboard-controlled human plays by — shown read-only. */
const HUMAN_RULES = [
  "Buffered input: a key press sets the facing used on the next tick.",
  "No 180° flip back onto your own live wake.",
  "Start gate: your boat holds on its base until your first key press (re-arms after a respawn).",
];

/** A tiny live preview of the 8x8 avatar grid, shown wherever the plain color dot would otherwise go. */
function AvatarThumbnail({ avatar, size = 24 }: { avatar: AvatarGrid; size?: number }) {
  return (
    <div
      className="grid rounded-sm overflow-hidden shrink-0"
      style={{ width: size, height: size, gridTemplateColumns: `repeat(${AVATAR_SIZE}, 1fr)` }}
    >
      {avatar.map((color, i) => (
        <div key={i} style={{ backgroundColor: color ?? "transparent" }} />
      ))}
    </div>
  );
}

export interface BotProfilePanelProps {
  configs: PlayerConfig[];
  humanId: string;
  /** The human player's chosen name (raw, as typed). */
  username: string;
  /** The human player's custom pixel-art avatar, or `null` to use the plain color marker. */
  avatar: AvatarGrid | null;
  profiles: Record<string, BotProfile>;
  autopilot: Record<string, boolean>;
  /** Which archetype drives each player — bots always, a human only while on autopilot. */
  botTypes: Record<string, BotType>;
  rules: GameRules;
  onUsernameChange: (value: string) => void;
  onAvatarChange: (avatar: AvatarGrid | null) => void;
  onProfileChange: (id: string, key: keyof BotProfile, value: number) => void;
  onAutopilotChange: (id: string, on: boolean) => void;
  onBotTypeChange: (id: string, type: BotType) => void;
  onResetProfile: (id: string) => void;
  onResetAll: () => void;
  onRulesChange: (patch: Partial<GameRules>) => void;
}

export function BotProfilePanel({
  configs,
  humanId,
  username,
  avatar,
  profiles,
  autopilot,
  botTypes,
  rules,
  onUsernameChange,
  onAvatarChange,
  onProfileChange,
  onAutopilotChange,
  onBotTypeChange,
  onResetProfile,
  onResetAll,
  onRulesChange,
}: BotProfilePanelProps) {
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4" data-testid="bot-profile-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <h3 className="text-sm font-semibold text-foreground">Profiles &amp; tuning</h3>
        <p className="text-xs text-muted-foreground">
          Every bot scores its four moves with these numbers each tick. Changes apply on the next tick — pause first if
          you want to line up an experiment.
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
          <span className="text-foreground font-medium">Respawn delay</span>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={rules.respawnDelayTicks}
            onChange={(e) => onRulesChange({ respawnDelayTicks: Number(e.target.value) })}
            className="w-28 accent-primary"
          />
          <span className="tabular-nums text-foreground w-8">{rules.respawnDelayTicks}</span>
          <span>ticks</span>
        </label>
        <button
          onClick={onResetAll}
          className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Reset all
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {configs.map((config) => {
          const isHuman = config.id === humanId;
          const driven = !isHuman || autopilot[config.id];
          const profile = profiles[config.id];
          const archetype = strategyFor(botTypes[config.id]);
          return (
            <div
              key={config.id}
              data-testid={`bot-card-${config.id}`}
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                {isHuman && avatar ? (
                  <AvatarThumbnail avatar={avatar} size={16} />
                ) : (
                  <span
                    className="w-3 h-3 rounded-full inline-block shrink-0"
                    style={{ backgroundColor: colorToHex(config.color) }}
                  />
                )}
                <span className="text-sm font-medium text-foreground">
                  {isHuman ? resolveUsername(username) : config.label}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-px">
                  {isHuman ? "you" : "bot"}
                </span>
                {driven && (
                  <span className="text-[10px] uppercase tracking-wide text-primary border border-primary/40 rounded px-1 py-px">
                    {archetype.label}
                  </span>
                )}
                {driven && (
                  <button
                    onClick={() => onResetProfile(config.id)}
                    className="ml-auto text-xs text-primary hover:underline"
                  >
                    Reset
                  </button>
                )}
              </div>

              {isHuman && (
                <label className="flex flex-col gap-1 text-xs text-foreground mb-2">
                  <span className="font-medium">Your name</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => onUsernameChange(e.target.value)}
                    maxLength={MAX_USERNAME_LENGTH}
                    placeholder="You"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Shown on the leaderboard and saved to this browser.
                  </span>
                </label>
              )}

              {isHuman && (
                <div className="flex items-center gap-2 mb-2">
                  <AvatarThumbnail avatar={avatar ?? Array(AVATAR_SIZE * AVATAR_SIZE).fill(colorToHex(config.color))} size={28} />
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => setAvatarEditorOpen(true)}
                      className="self-start px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                      {avatar ? "Edit avatar" : "Design avatar"}
                    </button>
                    <span className="text-[11px] text-muted-foreground">
                      Replaces your head marker in-game with this 8×8 sprite.
                    </span>
                  </div>
                  <PixelAvatarEditor
                    open={avatarEditorOpen}
                    onOpenChange={setAvatarEditorOpen}
                    value={avatar}
                    seedColor={colorToHex(config.color)}
                    onSave={onAvatarChange}
                  />
                </div>
              )}

              {isHuman && (
                <label className="flex items-center gap-2 text-xs text-foreground mb-2">
                  <input
                    type="checkbox"
                    checked={!!autopilot[config.id]}
                    onChange={(e) => onAutopilotChange(config.id, e.target.checked)}
                    className="accent-primary"
                  />
                  Autopilot — hand this boat to the bot scorer
                </label>
              )}

              {isHuman && !autopilot[config.id] ? (
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                  {HUMAN_RULES.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <label className="flex items-center justify-between gap-2 text-xs text-foreground">
                    <span className="font-medium">Archetype</span>
                    <select
                      value={botTypes[config.id] ?? archetype.type}
                      onChange={(e) => onBotTypeChange(config.id, e.target.value as BotType)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {Object.values(BOT_STRATEGIES).map((s) => (
                        <option key={s.type} value={s.type}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[11px] leading-snug text-muted-foreground -mt-1">
                    {ARCHETYPE_BLURB[archetype.type]}
                  </p>
                  {archetype.fields.map((field) => {
                    const inputId = `${config.id}-${field.key}`;
                    return (
                      <div key={field.key}>
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor={inputId} className="text-xs text-foreground">
                            {field.label}
                          </label>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatValue(profile[field.key])}
                          </span>
                        </div>
                        <input
                          id={inputId}
                          type="range"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={profile[field.key]}
                          onChange={(e) => onProfileChange(config.id, field.key, Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                        <p className="text-[11px] leading-snug text-muted-foreground">{field.hint}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
