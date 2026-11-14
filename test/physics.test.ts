import { beforeAll, describe, expect, it } from "vitest";
import { PHYSICS_HZ } from "../src/config.ts";
import { pieceGeometry, trackCollisionMesh } from "../src/geometry/track.ts";
import { Board, type PieceInit } from "../src/model/board.ts";
import { DEMO_BOARD } from "../src/model/demo.ts";
import { PIECE_TYPES } from "../src/model/pieces.ts";
import { inFinishCup, spawnPoint } from "../src/model/run.ts";
import { initPhysics, MarblePhysics } from "../src/physics/world.ts";

beforeAll(() => initPhysics());

/** Runs one marble from the first start piece and reports where it went. */
function runMarble(pieces: PieceInit[], seconds: number) {
  const physics = new MarblePhysics();
  physics.setTrack(trackCollisionMesh(pieces));
  const start = pieces.find((p) => p.type === "start")!;
  const finish = pieces.find((p) => p.type === "finish");
  const s = spawnPoint(start);
  physics.addMarble(s.x, s.y, s.z);
  let maxSpeed = 0;
  let finishedAt: number | undefined;
  let last = s;
  for (let i = 0; i < seconds * PHYSICS_HZ; i++) {
    physics.step();
    const [m] = [...physics.marbles()];
    last = m!;
    maxSpeed = Math.max(maxSpeed, m!.speed);
    if (finish && finishedAt === undefined && inFinishCup(finish, m!)) finishedAt = i / PHYSICS_HZ;
  }
  physics.free();
  return { finishedAt, maxSpeed, last };
}

describe("track geometry", () => {
  it.each(PIECE_TYPES)("%s produces a valid mesh", (type) => {
    const g = pieceGeometry({ type, level: 10 });
    const vertexCount = g.collision.positions.length / 3;
    expect(vertexCount).toBeGreaterThan(0);
    expect(g.collision.indices.every((i) => i >= 0 && i < vertexCount)).toBe(true);
    expect(g.collision.positions.every(Number.isFinite)).toBe(true);
  });

  it("welds the vertices where neighbouring pieces meet", () => {
    const board = new Board();
    board.load(DEMO_BOARD);
    const mesh = trackCollisionMesh(board.pieces);
    const seen = new Map<string, number>();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const key = mesh.positions.slice(i, i + 3).join(",");
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const shared = [...seen.values()].filter((n) => n > 1).length;
    // 15 profile points per join × 11 joins.
    expect(shared).toBeGreaterThanOrEqual(15 * 11);
  });
});

describe("marble physics", () => {
  it("rolls the demo run from start to finish cup", () => {
    const board = new Board();
    board.load(DEMO_BOARD);
    const result = runMarble(board.pieces, 15);
    expect(result.finishedAt).toBeDefined();
    expect(result.finishedAt!).toBeLessThan(12);
    // Still in the cup at the end, not bounced out.
    const finish = board.pieces.find((p) => p.type === "finish")!;
    expect(inFinishCup(finish, result.last)).toBe(true);
  });

  it("falls off an open end onto the table", () => {
    const pieces: PieceInit[] = [
      { type: "start", x: 4, z: 4, level: 10, rot: 0 },
      { type: "straight", x: 4, z: 5, level: 9, rot: 0 },
    ];
    const result = runMarble(pieces, 8);
    expect(result.last.y).toBeLessThan(0.2);
  });
});
