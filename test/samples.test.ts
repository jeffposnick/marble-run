import { beforeAll, describe, expect, it } from "vitest";
import { PHYSICS_HZ } from "../src/config.ts";
import { trackCollisionMesh } from "../src/geometry/track.ts";
import { Board } from "../src/model/board.ts";
import { inFinishCup, spawnPoint } from "../src/model/run.ts";
import { SAMPLES } from "../src/model/samples.ts";
import { path } from "../src/model/track-path.ts";
import { initPhysics, MarblePhysics } from "../src/physics/world.ts";

beforeAll(() => initPhysics());

describe("path", () => {
  it("lays each piece where the previous one exits", () => {
    expect(path(2, 2, 20, 1, "s l f")).toEqual([
      { type: "start", x: 2, z: 2, level: 20, rot: 1 },
      { type: "straight", x: 3, z: 2, level: 19, rot: 1 },
      { type: "curve-left", x: 4, z: 2, level: 18, rot: 1 },
      { type: "finish", x: 4, z: 1, level: 17, rot: 2 },
    ]);
  });

  it("rejects unknown steps", () => {
    expect(() => path(0, 0, 20, 0, "sx")).toThrow(/Unknown route step/);
  });
});

describe.each(SAMPLES)("sample $name", (sample) => {
  it("loads every piece", () => {
    const board = new Board();
    board.load(sample.board);
    expect(board.size).toBe(sample.board.pieces.length);
  });

  // Each start's marble is dropped at once, as the Drop button does, with a small nudge so a
  // design can't pass by luck from one exact spawn point.
  it.each([0, 0.015, -0.015])("gets every marble to a finish cup (nudged %f)", (nudge) => {
    const board = new Board();
    board.load(sample.board);
    const physics = new MarblePhysics();
    physics.setTrack(trackCollisionMesh(board.pieces));
    const finishes = board.pieces.filter((p) => p.type === "finish");
    const starts = board.pieces.filter((p) => p.type === "start");
    for (const start of starts) {
      const s = spawnPoint(start);
      physics.addMarble(s.x + nudge, s.y, s.z - nudge);
    }
    const finished = new Set<number>();
    for (let i = 0; i < 30 * PHYSICS_HZ && finished.size < starts.length; i++) {
      physics.step();
      for (const m of physics.marbles()) {
        if (finishes.some((f) => inFinishCup(f, m))) finished.add(m.id);
      }
    }
    physics.free();
    expect(finished.size).toBe(starts.length);
  });
});
