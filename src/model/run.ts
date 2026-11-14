/** Gameplay helpers shared by the app and the tests: where marbles spawn and where they finish. */
import { LEVEL, MARBLE_RADIUS } from "../config.ts";
import { cellCenter, rotatePoint } from "../geometry/track.ts";
import type { PieceInit } from "./board.ts";

/** Spawn point just inside the closed end of a start piece. */
export function spawnPoint(start: PieceInit): { x: number; y: number; z: number } {
  const c = cellCenter(start.x, start.z);
  const [dx, dz] = rotatePoint(0, -0.2, start.rot);
  return { x: c.x + dx, y: start.level * LEVEL + MARBLE_RADIUS + 0.03, z: c.z + dz };
}

/** True when a world point is resting inside a finish piece's bowl. */
export function inFinishCup(finish: PieceInit, p: { x: number; y: number; z: number }): boolean {
  const c = cellCenter(finish.x, finish.z);
  const [bx, bz] = rotatePoint(0, 0.12, finish.rot);
  const dx = p.x - (c.x + bx);
  const dz = p.z - (c.z + bz);
  const rim = finish.level * LEVEL - 0.08;
  return Math.hypot(dx, dz) < 0.34 && p.y < rim && p.y > rim - 0.2;
}
