import { beforeAll, describe, expect, it } from "vitest";
import { PHYSICS_HZ } from "../src/config.ts";
import { pieceGeometry, trackCollisionMesh } from "../src/geometry/track.ts";
import { Board, type PieceInit } from "../src/model/board.ts";
import { DEMO_BOARD } from "../src/model/demo.ts";
import { PIECE_TYPES } from "../src/model/pieces.ts";
import { inFinishCup, spawnPoint } from "../src/model/run.ts";
import { initPhysics, MarblePhysics, type Impact } from "../src/physics/world.ts";

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

describe("sound events", () => {
  it("reports rolling surfaces and collisions", () => {
    const board = new Board();
    board.load(DEMO_BOARD);
    const physics = new MarblePhysics();
    physics.setTrack(trackCollisionMesh(board.pieces));
    const s = spawnPoint(board.pieces.find((p) => p.type === "start")!);
    // One marble dropped onto the track, and a second dropped onto the first.
    physics.addMarble(s.x, s.y + 0.15, s.z);
    physics.addMarble(s.x, s.y + 0.5, s.z);
    const impacts: Impact[] = [];
    let rollingSteps = 0;
    for (let i = 0; i < 4 * PHYSICS_HZ; i++) {
      physics.step();
      impacts.push(...physics.takeImpacts());
      for (const m of physics.marbles()) if (m.surface === "track" && m.speed > 0.1) rollingSteps++;
    }
    physics.free();
    expect(rollingSteps).toBeGreaterThan(PHYSICS_HZ);
    expect(impacts.some((i) => i.kind === "track" && i.strength > 1.5)).toBe(true);
    expect(impacts.some((i) => i.kind === "glass" && i.strength > 0.5)).toBe(true);
    expect(impacts.every((i) => Number.isFinite(i.strength))).toBe(true);
  });
});
