import { describe, expect, it } from "vitest";
import { Board, exitPort, forwardDir, rotateDir } from "../src/model/board.ts";
import { DEMO_BOARD } from "../src/model/demo.ts";

describe("directions", () => {
  it("rotates like three.js rotation.y", () => {
    expect(forwardDir(0)).toEqual({ dx: 0, dz: 1 });
    expect(forwardDir(1)).toEqual({ dx: 1, dz: 0 });
    expect(forwardDir(2)).toEqual({ dx: 0, dz: -1 });
    expect(forwardDir(3)).toEqual({ dx: -1, dz: 0 });
    expect(rotateDir({ dx: 1, dz: 0 }, 1)).toEqual({ dx: 0, dz: -1 });
  });

  it("computes exit ports", () => {
    expect(exitPort({ type: "curve-left", x: 3, z: 3, level: 10, rot: 0 })).toEqual({
      x: 4,
      z: 3,
      dir: { dx: 1, dz: 0 },
      level: 9,
    });
    expect(exitPort({ type: "finish", x: 3, z: 3, level: 10, rot: 0 })).toBeNull();
  });
});

describe("Board", () => {
  it("snaps a new piece onto an open exit", () => {
    const board = new Board();
    board.add({ type: "start", x: 2, z: 2, level: 12, rot: 1 });
    // Wrong preferred rotation and level are corrected by the snap.
    expect(board.snap("straight", 3, 2, 0, 20)).toEqual({ rot: 1, level: 11, linked: true });
    // A cell nothing feeds into keeps the requested values.
    expect(board.snap("straight", 5, 5, 2, 20)).toEqual({ rot: 2, level: 20, linked: false });
    // Start pieces have no entry, so they never snap.
    expect(board.snap("start", 3, 2, 0, 20).linked).toBe(false);
  });

  it("rejects overlapping pieces but allows stacking with clearance", () => {
    const board = new Board();
    board.add({ type: "straight", x: 0, z: 0, level: 10, rot: 0 });
    expect(board.canPlace({ type: "straight", x: 0, z: 0, level: 12, rot: 1 }).ok).toBe(false);
    expect(board.canPlace({ type: "straight", x: 0, z: 0, level: 18, rot: 1 }).ok).toBe(true);
    expect(board.canPlace({ type: "straight", x: -1, z: 0, level: 18, rot: 1 }).ok).toBe(false);
    expect(board.canPlace({ type: "ramp", x: 1, z: 0, level: 4, rot: 0 }).ok).toBe(false);
  });

  it("round-trips through JSON and drops bad entries", () => {
    const board = new Board();
    board.load(DEMO_BOARD);
    expect(board.size).toBe(DEMO_BOARD.pieces.length);
    const copy = new Board();
    copy.load(JSON.parse(JSON.stringify(board)));
    expect(copy.toJSON()).toEqual(board.toJSON());
    copy.load({ pieces: [["bogus", 0, 0, 5, 0], ["straight", 0, 0, 5, 7], "x"] });
    expect(copy.size).toBe(0);
  });

  it("demo track is one connected run from start to finish", () => {
    const board = new Board();
    board.load(DEMO_BOARD);
    expect(board.openExits()).toEqual([]);
    let piece = board.pieces.find((p) => p.type === "start");
    const visited = new Set<number>();
    while (piece && piece.type !== "finish") {
      visited.add(piece.id);
      const port = exitPort(piece);
      piece = port ? board.receiverOf(port) : undefined;
    }
    expect(piece?.type).toBe("finish");
    expect(visited.size).toBe(board.size - 1);
  });
});
