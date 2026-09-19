import { describe, it, expect } from "vitest";
import {
  BOT_STRATEGIES,
  DEFAULT_BOT_TYPE,
  createBotMemory,
  strategyFor,
} from "@/features/landGrab/botStrategy";
import { BOT_PROFILE_FIELDS, DEFAULT_BOT_PROFILE } from "@/features/landGrab/botProfile";
import {
  createInitialGameState,
  setPlayerFacing,
  stepGame,
  type PlayerConfig,
} from "@/features/landGrab/simulation";

describe("bot strategy registry", () => {
  it("registers the rambler archetype as the default", () => {
    expect(DEFAULT_BOT_TYPE).toBe("rambler");
    expect(BOT_STRATEGIES.rambler.type).toBe("rambler");
    expect(BOT_STRATEGIES.rambler.decide).toBeTypeOf("function");
  });

  it("rambler exposes the full profile field set and the default profile", () => {
    expect(BOT_STRATEGIES.rambler.fields).toBe(BOT_PROFILE_FIELDS);
    expect(BOT_STRATEGIES.rambler.defaultProfile).toBe(DEFAULT_BOT_PROFILE);
  });

  it("strategyFor falls back to the default archetype for an unset type", () => {
    expect(strategyFor(undefined)).toBe(BOT_STRATEGIES.rambler);
    expect(strategyFor("rambler")).toBe(BOT_STRATEGIES.rambler);
  });

  it("createBotMemory returns a fresh bag tagged with the archetype", () => {
    expect(createBotMemory("rambler")).toEqual({ type: "rambler" });
    expect(createBotMemory("rambler")).not.toBe(createBotMemory("rambler"));
  });
});

describe("bot strategy wiring through the simulation", () => {
  it("stamps every player with a botType and a memory bag", () => {
    const configs: PlayerConfig[] = [
      { id: "you", label: "You", color: 0x38bdf8, isBot: false },
      { id: "bot", label: "Bot", color: 0xf87171, isBot: true },
    ];
    const state = createInitialGameState(9, 9, configs);
    expect(state.players.you.botType).toBe("rambler");
    expect(state.players.bot.botType).toBe("rambler");
    expect(state.players.bot.botMemory).toEqual({ type: "rambler" });
  });

  it("honours an explicit botType on the config", () => {
    const state = createInitialGameState(9, 9, [
      { id: "bot", label: "Bot", color: 0xf87171, isBot: true, botType: "rambler" },
    ]);
    expect(state.players.bot.botType).toBe("rambler");
  });

  it("keeps driving bots each tick through the registry (rambler behaviour intact)", () => {
    const configs: PlayerConfig[] = [
      { id: "bot1", label: "Bot 1", color: 0xf87171, isBot: true },
      { id: "bot2", label: "Bot 2", color: 0xfacc15, isBot: true },
    ];
    let state = createInitialGameState(12, 12, configs);
    const start = `${state.players.bot1.head.row},${state.players.bot1.head.col}`;
    let everMoved = false;
    for (let i = 0; i < 40; i++) {
      state = stepGame(state);
      if (`${state.players.bot1.head.row},${state.players.bot1.head.col}` !== start) everMoved = true;
    }
    expect(everMoved).toBe(true); // drove itself off the base at some point (a respawn can land it back home)
    for (const p of Object.values(state.players)) {
      expect(Number.isFinite(p.ownedCount)).toBe(true);
    }
  });

  it("rebuilds a bot's memory bag on respawn", () => {
    const configs: PlayerConfig[] = [
      { id: "p1", label: "You", color: 0x38bdf8, isBot: false },
      { id: "p2", label: "Rival", color: 0xf87171, isBot: true },
    ];
    let state = createInitialGameState(7, 7, configs, { respawnDelayTicks: 1 });
    const grid = state.grid.map((row) => row.slice());
    grid[0][1] = { kind: "trail", playerId: "p2" };
    state = {
      ...state,
      grid,
      players: {
        ...state.players,
        p1: { ...state.players.p1, head: { row: 0, col: 0 }, home: { row: 0, col: 0 }, trail: [], hasStarted: true },
        p2: { ...state.players.p2, head: { row: 5, col: 5 }, home: { row: 5, col: 5 }, trail: [{ row: 0, col: 1 }] },
      },
    };

    setPlayerFacing(state, "p1", "right");
    state = stepGame(state); // p1 cuts p2's trail — p2 is sunk
    expect(state.players.p2.alive).toBe(false);
    const memoryWhileDead = state.players.p2.botMemory;

    for (let i = 0; i < 30 && !state.players.p2.alive; i++) state = stepGame(state);
    expect(state.players.p2.alive).toBe(true);
    expect(state.players.p2.botMemory).toEqual({ type: "rambler" });
    expect(state.players.p2.botMemory).not.toBe(memoryWhileDead); // a fresh bag, not the old ref
  });
});
