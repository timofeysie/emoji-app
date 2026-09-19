# History of the Land Grab Genre

Land Grab merges two mechanics that actually come from two separate 45-year-old arcade
lineages: **claim territory by enclosing it** (the Qix family) and **your trail is a
hazard — touch any trail and you're dead** (the Blockade/Tron family). Paper.io and its
web `.io` cousins are where these two lineages actually merged; Land Grab inherits both
halves. This is a brief tour of each, for context on why the DFS/BFS solution from
[`docs/problems/Number-of-Islands.md`](../../../docs/problems/Number-of-Islands.md)
mapped onto a game so cleanly: the enclosure half of this genre has always been a
flood-fill/connected-components problem wearing a game's clothing.

## Lineage 1: claim territory by enclosing it

### Qix (1981) — the arcade originator

**Qix**, released by Taito, is the usual starting point for the "draw a line, seal off
a region" side of the family. The player moves a marker along the edges of a
rectangular field and drags a line ("Stix") out into open space; completing the line
seals off a section of the field, which fills in as claimed territory. Two threats
punish slowness: the **Qix** itself, an erratic, color-shifting line-shape that
destroys you if it touches your unfinished line, and **Sparx**, sentries that patrol
the claimed/unclaimed boundary looking for an unfinished line to cut. Clear a set
percentage of the field to advance. Claim-by-enclosure, death-by-having-your-line-cut,
a percentage-of-board win condition — all of it traces back to this one game.

### Clones and reinventions (1980s–90s)

- **Xonix** (1984) — a widely bootlegged game of Soviet/Eastern Bloc origin (its
  authorship is murky; it circulated on countless unofficial ports) that put its own
  spin on Qix: instead of one erratic shape, there's a ball bouncing around the
  *unclaimed* outer area and a worm-like enemy wandering the *unclaimed* inner area.
  Claiming territory shrinks the enemies' roaming room rather than requiring a hard
  percentage. Xonix was enormously influential in Eastern Europe and spawned its own
  wave of shareware clones independent of Taito's lineage.
- **Volfied** (Taito, 1989) — Taito's own follow-up, reskinning the Qix formula as a
  sci-fi shooter: a ship claims sections of an alien planet's surface while shooting
  roaming enemies instead of just dodging them.
- **Gals Panic** (Kaneko, 1990) and its many sequels — reused the exact Qix mechanic as
  a "reveal the picture" game: claiming area uncovers an image underneath instead of
  just scoring points. Commercially notable (including a run of adult-content
  variants) and part of why the genre stayed alive in Japanese arcades through the 90s.
- **JezzBall** (bundled in Microsoft Entertainment Pack 3, 1992) — the mechanic most
  people from the Windows 95/98 era actually grew up with. Rather than drawing an
  arbitrary loop, you fire straight walls across the field to pen bouncing balls into
  progressively smaller rooms; touching a ball mid-draw destroys the wall instead of
  killing you outright. Same "enclose territory, timing is everything" DNA, simplified
  to two wall directions.
- **Rampart** (Atari Games, 1990) is often mentioned alongside these but is only a
  cousin, not a direct ancestor — you build and defend castle walls with artillery
  rounds between phases, no line-drawing/cutting mechanic. Worth knowing as a
  contemporary "claim and defend territory" game from the same arcade era.

## Lineage 2: your trail is a hazard

### Blockade (1976) and Tron (1982)

Six years before Qix, **Blockade** (Gremlin Industries, 1976) established a different
idea entirely: two players each move a piece that leaves a solid, permanent wall behind
it, and touching *any* wall — yours, your opponent's, or the arena's edge — ends your
game immediately. No enclosure, no scoring by area; the trail itself is a hazard the
instant it exists. It's the direct ancestor of both the "Snake"/"Nibbles" genre (where
your own trail is a growing body you must not run into) and, six years later, **Tron**
(Bally Midway, 1982) — the arcade cabinet tied to Disney's film, whose "Light Cycles"
mode put two riders on a grid leaving solid walls behind them, the loser being whoever
crashes first. Tron didn't invent the trail-as-wall idea, but it's the version that
stuck in pop culture and gave the mechanic its enduring name: "light cycles."

### Keeping the light-cycle duel alive online

- **Achtung, die Kurve!** (a.k.a. **Curve Fever** / **Zatacka**, 1995, German
  freeware) — real-time multiplayer light-cycle dueling with a twist: each trail has
  random gaps you can slip through. Widely cited as the bridge between arcade Tron and
  the browser-multiplayer "curve" games that followed it, spawning a long line of
  clones (many now literally named `curvefever.io`-style).
- **Armagetron Advanced** (2001) — an open-source, networked 3D Tron light-cycle clone
  that kept dedicated online play going through the 2000s.

## Where the two lineages merged: the io-game/hyper-casual revival (2016–2018)

After **Agar.io** (2015) and **Slither.io** (2016) proved real-time multiplayer browser
games could go viral, several developers fused Qix/Xonix's *enclose territory* idea
with Blockade/Tron's *trail is instant death* idea into one PvP mechanic — which is
exactly Land Grab's rule set:

- **Splix.io** — a browser `.io` game with continuous grid movement, a visible trail
  the moment you leave your own territory, and elimination if any other player's head
  touches your trail: enclosure-to-claim from Qix, trail-crossing-kills from Tron.
- **Paper.io** / **Paper.io 2** — the mobile hit that brought this fused mechanic to a
  mass audience during the 2017–2018 hyper-casual boom (published under Voodoo's
  hyper-casual label), first as single-player-vs-bots, later adding real multiplayer.
  This is the game Land Grab is most directly modeled on, and the one namechecked in
  the [design doc](../../../docs/land-grab/land-grab.md).
- **Territorial.io** — a related but distinct branch: large-scale, many-player
  territorial conquest by attrition rather than trail-drawing, closer to a real-time
  Risk than to Qix or Tron, but sharing the "claim contiguous grid cells" core.

Paper.io's popularity in turn spawned a long tail of near-identical clones across app
stores — a genre cycle (arcade original → home clones → mobile mass-market clone) both
of these lineages have now been through at least twice.

## The throughline

Every generation of the *enclosure* lineage is solving the same problem: **given a
boundary someone just drew, which cells are enclosed?** That's a flood fill from the
outside in, exactly `floodFromBorder` in [`grid.ts`](./grid.ts) — and "did cutting
through the middle of my territory split it into pieces?" is `numIslands` again,
restricted to one player's cells, exactly [`splitResolution.ts`](./splitResolution.ts).
The *trail-hazard* lineage contributes Land Grab's other rule for free: a trail cell is
just a cell tagged "instant death for anyone who steps on it," no algorithm required.
The graphics and the threat model changed across ports and decades; the graph algorithm
underneath the enclosure half never did.
