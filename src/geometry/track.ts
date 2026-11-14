/**
 * Procedural geometry for track pieces.
 *
 * Kept free of three.js so the same triangles feed both the renderer and the physics engine (and
 * can be exercised in headless tests). Coordinates are in a piece's local frame: the cell is
 * centred on the origin, the marble enters through the −z face, and y is absolute world height.
 */
import {
  BOARD_SIZE,
  CELL,
  CHANNEL_RADIUS,
  CHANNEL_THICKNESS,
  CHANNEL_WALL_ANGLE,
  LEVEL,
  PORT_SLOPE,
} from "../config.ts";
import type { PieceInit, Rotation } from "../model/board.ts";

export interface MeshData {
  positions: number[];
  indices: number[];
}

/** Separate surfaces so the renderer can keep crisp edges between them. */
export interface PieceGeometry {
  /** Surfaces the marble can touch. These go to the physics engine. */
  collision: MeshData;
  /** Everything else that is only drawn (outer shell, rims, end rings). */
  shell: MeshData[];
  /** Point (local frame) under which the support pillar stands. */
  support: { x: number; y: number; z: number };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A horizontal centre line parametrised by t ∈ [0, 1] at constant speed. */
interface Path2D {
  length: number;
  at(t: number): { x: number; z: number };
  /** Unit tangent in the xz plane. */
  dir(t: number): { x: number; z: number };
}

const HALF = CELL / 2;
const ARC_SEGMENTS = 14;

function line(z0: number, z1: number): Path2D {
  return {
    length: Math.abs(z1 - z0),
    at: (t) => ({ x: 0, z: z0 + (z1 - z0) * t }),
    dir: () => ({ x: 0, z: Math.sign(z1 - z0) }),
  };
}

/** Quarter circle from the −z face to the ±x face; side = +1 exits towards +x (a left turn). */
function quarterTurn(side: 1 | -1): Path2D {
  const r = HALF;
  const cx = side * HALF;
  const cz = -HALF;
  return {
    length: (Math.PI / 2) * r,
    at(t) {
      const phi = (t * Math.PI) / 2;
      return { x: cx - side * r * Math.cos(phi), z: cz + r * Math.sin(phi) };
    },
    dir(t) {
      const phi = (t * Math.PI) / 2;
      return { x: side * Math.sin(phi), z: Math.cos(phi) };
    },
  };
}

/**
 * Cubic Hermite height profile from h0 to h1 whose gradient at both ends is exactly −PORT_SLOPE,
 * so neighbouring pieces meet without a kink.
 */
function heightProfile(h0: number, h1: number, length: number) {
  const m = -PORT_SLOPE * length;
  return {
    at(s: number): number {
      const s2 = s * s;
      const s3 = s2 * s;
      return (
        (2 * s3 - 3 * s2 + 1) * h0 + (s3 - 2 * s2 + s) * m + (-2 * s3 + 3 * s2) * h1 + (s3 - s2) * m
      );
    },
    /** dh / d(arclength) */
    slope(s: number): number {
      const s2 = s * s;
      const d = (6 * s2 - 6 * s) * h0 + (3 * s2 - 4 * s + 1) * m + (-6 * s2 + 6 * s) * h1;
      return (d + (3 * s2 - 2 * s) * m) / length;
    },
  };
}

interface Frame {
  p: Vec3;
  side: Vec3;
  normal: Vec3;
}

function frames(path: Path2D, h0: number, h1: number, samples: number): Frame[] {
  const height = heightProfile(h0, h1, path.length);
  const result: Frame[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const { x, z } = path.at(t);
    const d = path.dir(t);
    const g = height.slope(t);
    // Tangent T = (d.x, g, d.z) / |…|; side = T × up; normal = side × T.
    const inv = 1 / Math.hypot(1, g);
    const tx = d.x * inv;
    const ty = g * inv;
    const tz = d.z * inv;
    const side = { x: -tz, y: 0, z: tx };
    const sl = Math.hypot(side.x, side.z);
    side.x /= sl;
    side.z /= sl;
    const normal = {
      x: side.y * tz - side.z * ty,
      y: side.z * tx - side.x * tz,
      z: side.x * ty - side.y * tx,
    };
    result.push({ p: { x, y: height.at(t), z }, side, normal });
  }
  return result;
}

/** 2D profile point (u across the channel, v up from the channel bottom). */
type ProfilePoint = [u: number, v: number];

function arc(radius: number, from: number, to: number, segments = ARC_SEGMENTS): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments;
    pts.push([radius * Math.sin(a), CHANNEL_RADIUS - radius * Math.cos(a)]);
  }
  return pts;
}

function place(frame: Frame, [u, v]: ProfilePoint): Vec3 {
  return {
    x: frame.p.x + frame.side.x * u + frame.normal.x * v,
    y: frame.p.y + frame.side.y * u + frame.normal.y * v,
    z: frame.p.z + frame.side.z * u + frame.normal.z * v,
  };
}

/**
 * Sweeps an open profile along the frames. Triangles wind so their front faces look towards
 * the profile's left-hand side when walking along it (for the inner arc: into the channel).
 */
function sweep(fr: Frame[], profile: ProfilePoint[]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  const cols = profile.length;
  for (const f of fr) {
    for (const pt of profile) {
      const v = place(f, pt);
      positions.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < fr.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices };
}

/** Flat ring that closes the wall thickness at one end of a channel. */
function endRing(frame: Frame, inner: ProfilePoint[], outer: ProfilePoint[], flip: boolean) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const pt of [...inner, ...outer]) {
    const v = place(frame, pt);
    positions.push(v.x, v.y, v.z);
  }
  const n = inner.length;
  for (let j = 0; j < n - 1; j++) {
    const a = j;
    const b = j + 1;
    const c = n + j;
    const d = n + j + 1;
    if (flip) indices.push(a, b, c, b, d, c);
    else indices.push(a, c, b, b, c, d);
  }
  return { positions, indices };
}

/** Solid wall across the channel (used to close the back of the start piece). */
function endCap(frame: Frame, inner: ProfilePoint[], flip: boolean): MeshData {
  const top = inner[inner.length - 1]?.[1] ?? CHANNEL_RADIUS;
  const center = place(frame, [0, top]);
  const positions = [center.x, center.y, center.z];
  const indices: number[] = [];
  for (const pt of inner) {
    const v = place(frame, pt);
    positions.push(v.x, v.y, v.z);
  }
  for (let j = 1; j < inner.length; j++) {
    if (flip) indices.push(0, j + 1, j);
    else indices.push(0, j, j + 1);
  }
  return { positions, indices };
}

function channel(
  path: Path2D,
  h0: number,
  h1: number,
  samples: number,
  opts: { capStart?: boolean } = {},
): PieceGeometry {
  const fr = frames(path, h0, h1, samples);
  const w = CHANNEL_WALL_ANGLE;
  const inner = arc(CHANNEL_RADIUS, -w, w);
  const outerR = CHANNEL_RADIUS + CHANNEL_THICKNESS;
  const outer = arc(outerR, -w, w);
  const lipL: ProfilePoint[] = [outer[0]!, inner[0]!];
  const lipR: ProfilePoint[] = [inner[inner.length - 1]!, outer[outer.length - 1]!];

  const first = fr[0]!;
  const last = fr[fr.length - 1]!;
  const collision = sweep(fr, inner);
  const shell = [
    sweep(fr, outer.toReversed()),
    sweep(fr, lipL),
    sweep(fr, lipR),
    endRing(first, inner, outer, false),
    endRing(last, inner, outer, true),
  ];
  if (opts.capStart) {
    const cap = endCap(first, inner, false);
    merge(collision, cap);
    shell.push(endCap(first, inner, true));
  }
  const mid = fr[Math.floor(fr.length / 2)]!.p;
  return { collision, shell, support: { x: mid.x, y: mid.y, z: mid.z } };
}

export function merge(into: MeshData, from: MeshData): MeshData {
  const offset = into.positions.length / 3;
  into.positions.push(...from.positions);
  for (const i of from.indices) into.indices.push(i + offset);
  return into;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Bowl that catches marbles; the wall is low where the feed channel arrives and high elsewhere. */
function finishCup(entryHeight: number): PieceGeometry {
  const bowlZ = 0.12;
  const bowlR = 0.33;
  const depth = 0.1;
  const feedEnd = bowlZ - bowlR + 0.05;
  const feedPath = line(-HALF, feedEnd);
  const feedDrop = PORT_SLOPE * feedPath.length;
  const feed = channel(feedPath, entryHeight, entryHeight - feedDrop, 6);

  const channelBottom = entryHeight - feedDrop;
  const rimY = channelBottom - 0.07;
  const floorY = rimY - depth;
  const lowWall = channelBottom - 0.045;
  const highWall = channelBottom + 0.2;

  const rings = 10;
  const wallRings = 3;
  const seg = 40;
  const radial: Array<(theta: number) => [number, number]> = [];
  for (let i = 0; i <= rings; i++) {
    const r = (bowlR * i) / rings;
    radial.push(() => [r, floorY + depth * (r / bowlR) ** 2]);
  }
  for (let i = 1; i <= wallRings; i++) {
    radial.push((theta) => {
      // ψ = angle away from the entry side (which faces −z).
      const psi = Math.acos(Math.max(-1, Math.min(1, -Math.cos(theta))));
      const top = lowWall + (highWall - lowWall) * smoothstep(0.35, 1.3, psi);
      return [bowlR + 0.012 * i, rimY + ((top - rimY) * i) / wallRings];
    });
  }

  const build = (radiusOffset: number, yOffset: number): MeshData => {
    const positions: number[] = [];
    const indices: number[] = [];
    const cols = seg + 1;
    for (const ring of radial) {
      for (let j = 0; j <= seg; j++) {
        const theta = (j / seg) * Math.PI * 2;
        const [r, y] = ring(theta);
        const rr = r + radiusOffset;
        positions.push(Math.sin(theta) * rr, y + yOffset, bowlZ + Math.cos(theta) * rr);
      }
    }
    for (let i = 0; i < radial.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * cols + j;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return { positions, indices };
  };

  const inside = build(0, 0);
  const outside = build(CHANNEL_THICKNESS, -CHANNEL_THICKNESS);
  // Outside faces outwards: flip winding.
  for (let k = 0; k < outside.indices.length; k += 3) {
    const tmp = outside.indices[k + 1]!;
    outside.indices[k + 1] = outside.indices[k + 2]!;
    outside.indices[k + 2] = tmp;
  }
  merge(feed.collision, inside);
  feed.shell.push(outside);
  return { ...feed, support: { x: 0, y: floorY - CHANNEL_THICKNESS, z: bowlZ } };
}

/** Builds a piece's geometry in its local frame (with absolute heights). */
export function pieceGeometry(piece: Pick<PieceInit, "type" | "level">): PieceGeometry {
  const top = piece.level * LEVEL;
  const step = LEVEL;
  switch (piece.type) {
    case "start":
      return channel(line(-0.3, HALF), top, top - step, 8, { capStart: true });
    case "straight":
      return channel(line(-HALF, HALF), top, top - step, 8);
    case "ramp":
      return channel(line(-HALF, HALF), top, top - 4 * step, 18);
    case "curve-left":
      return channel(quarterTurn(1), top, top - step, 20);
    case "curve-right":
      return channel(quarterTurn(-1), top, top - step, 20);
    case "finish":
      return finishCup(top);
  }
}

/** World-space centre of a grid cell. */
export function cellCenter(x: number, z: number): { x: number; z: number } {
  const offset = (BOARD_SIZE - 1) / 2;
  return { x: (x - offset) * CELL, z: (z - offset) * CELL };
}

/** Same rotation three.js applies for `rotation.y = rot · π/2`. */
export function rotatePoint(x: number, z: number, rot: Rotation): [number, number] {
  for (let i = 0; i < rot; i++) [x, z] = [z, -x];
  return [x, z];
}

/** Transforms a mesh from a piece's local frame into world space. */
export function toWorld(mesh: MeshData, piece: Pick<PieceInit, "x" | "z" | "rot">): MeshData {
  const c = cellCenter(piece.x, piece.z);
  const positions: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [x, z] = rotatePoint(mesh.positions[i]!, mesh.positions[i + 2]!, piece.rot);
    positions.push(x + c.x, mesh.positions[i + 1]!, z + c.z);
  }
  return { positions, indices: [...mesh.indices] };
}

/**
 * Merges every piece's collision surface into one world-space mesh. Coordinates are snapped to a
 * fine grid so vertices where two pieces meet become identical and can be welded by the physics
 * engine, which removes bumps at the joins.
 */
export function trackCollisionMesh(pieces: readonly PieceInit[]): MeshData {
  const out: MeshData = { positions: [], indices: [] };
  for (const piece of pieces) merge(out, toWorld(pieceGeometry(piece).collision, piece));
  const q = 1e5;
  for (let i = 0; i < out.positions.length; i++) {
    out.positions[i] = Math.round(out.positions[i]! * q) / q + 0;
  }
  return out;
}
