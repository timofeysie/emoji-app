import { useEffect, useRef, useState } from "react";
import type { BotProfile } from "@emoji-app/land-grab-core";
import { BOT_STRATEGIES, strategyFor, type BotType } from "@emoji-app/land-grab-core";
import type { GameRules, PlayerConfig } from "@emoji-app/land-grab-core";
import { resolveUsername } from "./userProfile";
import { PlayerAvatarPreview, PlayerProfileEditor } from "./PlayerProfileEditor";
import type { AvatarGrid } from "@emoji-app/land-grab-core";

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(parseFloat(value.toFixed(2)));
}

/** Archetype help shown from the picker question button. `Record<BotType, …>` keeps every archetype covered. */
const ARCHETYPE_BLURB: Record<BotType, string> = {
  rambler: "Greedy roamer — strikes out into open water, then beelines home to bank a small loop.",
  surveyor: "Territory farmer — hugs its own frontier one cell out and folds in short, chunky loops.",
  invader: "Raider — hunts a rival into a head-on stand-off, then jukes aside and cuts their wake as they pass.",
};

function HintPopover({ id, label, hint }: { id: string; label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="contents">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary p-0 text-xs font-bold text-muted-foreground hover:text-foreground sm:h-6 sm:w-6"
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-background/60 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            id={id}
            role="tooltip"
            className="fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 rounded-lg border border-border bg-card p-3 text-left text-xs leading-relaxed text-foreground shadow-xl sm:absolute sm:inset-x-0 sm:top-full sm:mt-2 sm:w-auto sm:translate-y-0"
          >
            {hint}
          </div>
        </>
      )}
    </div>
  );
}

export interface BotProfilePanelProps {
  configs: PlayerConfig[];
  humanId: string;
  /** The human player's chosen name (raw, as typed). */
  username: string;
  /** The human player's custom pixel-art avatar, or `null` to use the tinted default. */
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
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 sm:p-4" data-testid="bot-profile-panel">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">Profiles &amp; tuning</h3>
        <div className="grid gap-2 sm:grid-cols-[minmax(20rem,1fr)_auto] lg:flex lg:items-center">
          <label className="grid min-h-11 grid-cols-[auto_minmax(5rem,1fr)_2rem_auto] items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Respawn delay</span>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={rules.respawnDelayTicks}
              onChange={(e) => onRulesChange({ respawnDelayTicks: Number(e.target.value) })}
              className="min-w-0 accent-primary"
            />
            <span className="w-8 tabular-nums text-foreground">{rules.respawnDelayTicks}</span>
            <span>ticks</span>
          </label>
          <button
            type="button"
            onClick={onResetAll}
            className="min-h-11 w-full rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-opacity hover:opacity-90 sm:w-auto"
          >
            Reset all
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {configs.map((config) => {
          const isHuman = config.id === humanId;
          const driven = !isHuman || autopilot[config.id];
          const profile = profiles[config.id];
          const archetype = strategyFor(botTypes[config.id]);
          return (
            <details
              key={config.id}
              data-testid={`bot-card-${config.id}`}
              className="group rounded-lg border border-border bg-background/40"
            >
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-3 select-none [&::-webkit-details-marker]:hidden">
                <PlayerAvatarPreview
                  avatar={isHuman ? avatar : null}
                  seedColor={colorToHex(config.color)}
                  size={28}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {isHuman ? resolveUsername(username) : config.label}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                      {isHuman ? "you" : "bot"}
                    </span>
                    {driven && (
                      <span className="rounded border border-primary/40 px-1 py-px text-[10px] uppercase tracking-wide text-primary">
                        {archetype.label}
                      </span>
                    )}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-transform group-open:rotate-180"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="2">
                    <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </summary>

              <div className="border-t border-border p-3 sm:p-4">
                {driven && (
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onResetProfile(config.id)}
                      className="min-h-10 w-full rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-opacity hover:opacity-90 sm:w-auto"
                    >
                      Reset profile
                    </button>
                  </div>
                )}

                {isHuman && (
                  <PlayerProfileEditor
                    username={username}
                    avatar={avatar}
                    seedColor={colorToHex(config.color)}
                    onUsernameChange={onUsernameChange}
                    onAvatarChange={onAvatarChange}
                    className="mb-3"
                  />
                )}

                {isHuman && (
                  <label className="mb-3 flex min-h-11 items-center gap-3 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={!!autopilot[config.id]}
                      onChange={(e) => onAutopilotChange(config.id, e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    Autopilot — hand this boat to the bot scorer
                  </label>
                )}

                {driven && (
                  <div className="flex flex-col gap-3">
                    <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">Archetype</span>
                        <HintPopover
                          id={`${config.id}-archetype-hint`}
                          label="archetype"
                          hint={ARCHETYPE_BLURB[archetype.type]}
                        />
                      </div>
                      <select
                        value={botTypes[config.id] ?? archetype.type}
                        onChange={(e) => onBotTypeChange(config.id, e.target.value as BotType)}
                        className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground sm:w-auto"
                      >
                        {Object.values(BOT_STRATEGIES).map((strategy) => (
                          <option key={strategy.type} value={strategy.type}>
                            {strategy.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {archetype.fields.map((field) => {
                      const inputId = `${config.id}-${field.key}`;
                      return (
                        <div key={field.key} className="relative">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <label htmlFor={inputId} className="text-xs text-foreground">
                                {field.label}
                              </label>
                              <HintPopover
                                id={`${inputId}-hint`}
                                label={field.label}
                                hint={field.hint}
                              />
                            </div>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
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
                            className="h-10 w-full accent-primary"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
