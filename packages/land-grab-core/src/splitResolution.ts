import type { CellState } from "./grid";
import type { Vec2 } from "./types";

/**
 * Split/cut resolution: the `numIslands` scan from
 * docs/problems/Number-of-Islands.md, restricted to one player's owned
 * cells. When an opponent's capture loop (or a dead rival's plowed-through
 * trail reverting to neutral) severs this player's territory, what's left can
 * fall into more than one connected component — same "scan every cell,
 * DFS-sink each new component you find" outer loop as the doc's `numIslands`,
 * just counting this player's land instead of every `'1'`.
 *
 * One component is kept — the rest are what the cut orphaned from the player,
 * and revert to neutral ground (fair game for anyone to claim). The keeper is
 * the component holding the player's piece: `anchors` lists candidate keep
 * points in priority order (head first, then home/base), and the first anchor
 * that lands inside a component wins. If the player owns none of their anchors
 * — their base was captured long ago and they're currently trailing through
 * open ground — the largest remaining component is kept as a best effort so a
 * roaming leader isn't wiped out by a nick somewhere on the map.
 */
export function resolveTerritorySplit(grid: CellState[][], playerId: string, anchors: Vec2[]): CellState[][] {
  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;
  const visited: boolean[][] = Array.from({ length: rowCount }, () => new Array(colCount).fill(false));

  // A cell someone else's live trail is merely crossing (`capturedFrom`) hasn't
  // actually left `playerId` yet — count it as theirs here too, so a stretch of
  // solid land bridged only by an in-progress, uncompleted trail doesn't read as
  // two disconnected islands and lose the piece off the anchor before that
  // trail ever closes a loop or lands a capture.
  function isOwned(row: number, col: number): boolean {
    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return false;
    const cell = grid[row][col];
    if (cell.kind === "territory") return cell.playerId === playerId;
    if (cell.kind === "trail") return cell.capturedFrom === playerId;
    return false;
  }

  function collectComponent(startRow: number, startCol: number): Vec2[] {
    const component: Vec2[] = [];
    const stack: Vec2[] = [{ row: startRow, col: startCol }];
    while (stack.length > 0) {
      const { row, col } = stack.pop()!;
      // Base case: out of bounds, already visited, or not this player's land
      if (row < 0 || row >= rowCount || col < 0 || col >= colCount) continue;
      if (visited[row][col] || !isOwned(row, col)) continue;
      visited[row][col] = true;
      component.push({ row, col });
      stack.push({ row: row - 1, col }, { row: row + 1, col }, { row, col: col - 1 }, { row, col: col + 1 });
    }
    return component;
  }

  const components: Vec2[][] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      if (!isOwned(row, col) || visited[row][col]) continue;
      components.push(collectComponent(row, col));
    }
  }

  // Nothing to resolve: no land, or it's all still one piece.
  if (components.length <= 1) return grid;

  const containsAnchor = (component: Vec2[], anchor: Vec2): boolean =>
    component.some((cell) => cell.row === anchor.row && cell.col === anchor.col);

  let keeper: Vec2[] | undefined;
  for (const anchor of anchors) {
    keeper = components.find((component) => containsAnchor(component, anchor));
    if (keeper) break;
  }
  if (!keeper) {
    // Base and piece are both off this player's land — keep the biggest chunk.
    keeper = components.reduce((biggest, component) => (component.length > biggest.length ? component : biggest));
  }

  const next = grid.map((row) => row.slice());
  for (const component of components) {
    if (component === keeper) continue;
    for (const { row, col } of component) {
      const cell = next[row][col];
      // A plain owned cell goes fully neutral. A cell only counted as owned
      // because someone else's live trail is crossing it (`capturedFrom`)
      // isn't solid ground to void — the trail is still there and mid-run;
      // just drop the now-orphaned claim underneath it, same as if it had
      // been laid over open ground, and leave the trail cell itself alone.
      next[row][col] = cell.kind === "trail" ? { kind: "trail", playerId: cell.playerId } : { kind: "neutral" };
    }
  }
  return next;
}
