import { exitPort, rotationFor, type PieceInit, type Rotation } from "./board.ts";
import type { PieceType } from "./pieces.ts";

/** One letter per piece in a {@link path} route. */
const STEP: Record<string, PieceType> = {
  s: "straight",
  r: "ramp",
  l: "curve-left",
  t: "curve-right", // "t" for "turn right", since "r" is the ramp
  f: "finish",
};

/**
 * Lays a chain of joined pieces, the way a player snaps them together: each piece goes where the
 * previous one exits, at that exit's level and direction.
 *
 * `route` is one letter per piece: `s` straight, `r` ramp, `l` curve left, `t` curve right (turn),
 * `f` finish cup. Spaces are ignored, so routes can be grouped for reading. The first piece is a
 * start unless `from` says otherwise, sitting at (x, z) with its top at `level`, facing `rot`
 * (0: +z, 1: +x, 2: −z, 3: −x).
 */
export function path(
  x: number,
  z: number,
  level: number,
  rot: Rotation,
  route: string,
  from: "start" | "loose" = "start",
): PieceInit[] {
  const steps = [...route.replaceAll(/\s/g, "")].map((c) => {
    const type = STEP[c];
    if (!type) throw new Error(`Unknown route step "${c}"`);
    return type;
  });
  const pieces: PieceInit[] = [];
  let last: PieceInit | undefined;
  if (from === "start") {
    last = { type: "start", x, z, level, rot };
    pieces.push(last);
  }
  for (const type of steps) {
    if (last) {
      const port = exitPort(last);
      if (!port) throw new Error("Route continues past a finish cup");
      last = { type, x: port.x, z: port.z, level: port.level, rot: rotationFor(port.dir) };
    } else {
      last = { type, x, z, level, rot };
    }
    pieces.push(last);
  }
  return pieces;
}
