# History of the Land Grab Genre

Land Grab merges two mechanics from separate arcade lineages: claiming
territory by enclosing it and treating a player's trail as a hazard. Paper.io
and its web `.io` cousins are where these lineages merged; Land Grab inherits
both halves.

This is a brief tour of each lineage and explains why the DFS/BFS solution in
[`Number-of-Islands.md`](../../docs/problems/Number-of-Islands.md) maps onto the
game so cleanly. The enclosure half of this genre has always been a
flood-fill or connected-components problem wearing a game's clothing.

## Lineage 1: Claim Territory by Enclosing It

### Qix (1981)

**Qix**, released by Taito, is the usual starting point for the "draw a line,
seal off a region" side of the family. The player moves a marker along the
edges of a rectangular field and drags a line, called a Stix, into open space.
Completing the line seals and fills part of the field as claimed territory.

Two threats punish slowness. The Qix itself destroys the player if it touches
an unfinished line. Sparx patrol the claimed and unclaimed boundary looking
for an unfinished line to cut. Claim-by-enclosure, death when a line is cut,
and a percentage-of-board win condition all trace back to this game.

### Clones and Reinventions

- **Xonix** (1984) put its own spin on Qix. A ball bounces around the unclaimed
  outer area while a worm-like enemy wanders the unclaimed inner area.
  Claiming territory shrinks the enemies' roaming room. It was influential in
  Eastern Europe and spawned its own shareware clones.
- **Volfied** (Taito, 1989) reskinned the Qix formula as a science-fiction
  shooter. A ship claims sections of an alien planet while shooting roaming
  enemies.
- **Gals Panic** (Kaneko, 1990) and its sequels reused the Qix mechanic as a
  picture-reveal game. Claiming area uncovers an image instead of only scoring
  points.
- **JezzBall** (Microsoft Entertainment Pack 3, 1992) lets the player fire
  straight walls across a field to pen bouncing balls into progressively
  smaller rooms. Touching a ball while drawing destroys the wall.
- **Rampart** (Atari Games, 1990) is a cousin rather than a direct ancestor.
  Players build and defend castle walls between artillery rounds, without a
  line-drawing or cutting mechanic.

## Lineage 2: The Trail Is a Hazard

### Blockade (1976) and Tron (1982)

Six years before Qix, **Blockade** established a different idea. Two players
move pieces that leave permanent walls behind. Touching any wall, whether
one's own, an opponent's, or the arena edge, ends the game. There is no
enclosure or area scoring; the trail itself is immediately hazardous.

Blockade directly influenced both the Snake family and **Tron** (Bally Midway,
1982). Tron's Light Cycles mode put two riders on a grid leaving solid walls,
with the first rider to crash losing. Tron did not invent the trail-as-wall
idea, but its version became the enduring popular reference.

### Keeping the Light-Cycle Duel Alive Online

- **Achtung, die Kurve!** (also known as Curve Fever or Zatacka, 1995) brought
  real-time multiplayer light-cycle dueling to home computers. Random gaps in
  each trail let opponents slip through. It bridged arcade Tron and later
  browser multiplayer curve games.
- **Armagetron Advanced** (2001) is an open-source, networked 3D Tron clone
  that kept dedicated online play going through the 2000s.

## Where the Lineages Merged

After **Agar.io** (2015) and **Slither.io** (2016) demonstrated the reach of
real-time browser games, developers combined Qix and Xonix enclosure with
Blockade and Tron trail hazards:

- **Splix.io** uses continuous grid movement, shows a trail as soon as a player
  leaves owned territory, and eliminates a player when another player's head
  touches that trail.
- **Paper.io** and **Paper.io 2** brought the combined mechanic to a large
  mobile audience during the 2017 to 2018 hyper-casual boom. The games began
  as single-player experiences against bots and later added multiplayer. This
  is the closest model for Land Grab.
- **Territorial.io** is a related but distinct branch. It focuses on
  many-player territorial conquest by attrition rather than trail drawing.

Paper.io's popularity produced many similar app-store games. The genre has
completed a familiar cycle from arcade original, through home clones, to a
mass-market mobile interpretation.

## The Throughline

Every generation of the enclosure lineage solves the same problem: given a
boundary that was just drawn, which cells are enclosed? That is a flood fill
from the outside in, implemented by `floodFromBorder` in
`packages/land-grab-core/src/grid.ts`.

Determining whether a cut through the middle of a territory split it into
pieces is the number-of-islands problem restricted to one player's cells. It
is implemented in `packages/land-grab-core/src/splitResolution.ts`.

The trail-hazard lineage contributes the other central rule: a trail cell is
an instant hazard to any player who enters it. The graphics and threat model
changed across decades, but the graph algorithm underlying enclosure did not.
