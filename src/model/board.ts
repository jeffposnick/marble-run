import { BOARD_SIZE, MAX_LEVEL, MIN_LEVEL } from "../config.ts";
import { isPieceType, PIECES, type LocalExit, type PieceType } from "./pieces.ts";

/** Quarter turns about the vertical axis. */
export type Rotation = 0 | 1 | 2 | 3;

export interface Dir {
  readonly dx: number;
  readonly dz: number;
}

export interface PieceInit {
  readonly type: PieceType;
  readonly x: number;
  readonly z: number;
  /** Level of the entry port (or of the top of the start piece). */
  readonly level: number;
  readonly rot: Rotation;
}

export interface Piece extends PieceInit {
  readonly id: number;
}

export interface Port {
  /** Cell the port leads into. */
  readonly x: number;
  readonly z: number;
  /** Direction the marble is travelling as it crosses the port. */
  readonly dir: Dir;
  readonly level: number;
}

export interface Snap {
  readonly rot: Rotation;
  readonly level: number;
  /** True when the piece's entry lines up with an existing piece's exit. */
  readonly linked: boolean;
}

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

const LOCAL_EXIT_DIR: Record<LocalExit, Dir> = {
  forward: { dx: 0, dz: 1 },
  left: { dx: 1, dz: 0 },
  right: { dx: -1, dz: 0 },
};

/**
 * Rotates a local direction by `rot` quarter turns, matching three.js's `rotation.y`
 * (a positive angle turns +z towards +x).
 */
export function rotateDir(dir: Dir, rot: Rotation): Dir {
  let { dx, dz } = dir;
  for (let i = 0; i < rot; i++) [dx, dz] = [dz, -dx];
  return { dx: dx + 0, dz: dz + 0 }; // `+ 0` normalises -0
}

export function forwardDir(rot: Rotation): Dir {
  return rotateDir(LOCAL_EXIT_DIR.forward, rot);
}

export function rotationFor(dir: Dir): Rotation {
  for (const rot of [0, 1, 2, 3] as const) {
    const f = forwardDir(rot);
    if (f.dx === dir.dx && f.dz === dir.dz) return rot;
  }
  throw new Error(`Not a grid direction: ${dir.dx},${dir.dz}`);
}

export function exitPort(piece: PieceInit): Port | null {
  const spec = PIECES[piece.type];
  if (!spec.exit) return null;
  const dir = rotateDir(LOCAL_EXIT_DIR[spec.exit], piece.rot);
  return { x: piece.x + dir.dx, z: piece.z + dir.dz, dir, level: piece.level - spec.drop };
}

/** Level of the lowest point of a piece's channel (or the finish cup's floor). */
export function lowestLevel(piece: PieceInit): number {
  return piece.type === "finish" ? piece.level - 3 : piece.level - PIECES[piece.type].drop;
}

/** Vertical extent of a piece in levels, including its walls and clearance below. */
export function verticalSpan(piece: PieceInit): [number, number] {
  return [lowestLevel(piece) - 2, piece.level + 3];
}

export function inBounds(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < BOARD_SIZE && z < BOARD_SIZE;
}

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}

/** A grid of placed pieces plus the snapping rules that join them. */
export class Board {
  #pieces = new Map<number, Piece>();
  #nextId = 1;
  #listeners = new Set<() => void>();

  get pieces(): Piece[] {
    return [...this.#pieces.values()];
  }

  get size(): number {
    return this.#pieces.size;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  get(id: number): Piece | undefined {
    return this.#pieces.get(id);
  }

  piecesAt(x: number, z: number): Piece[] {
    return this.pieces.filter((p) => p.x === x && p.z === z);
  }

  canPlace(candidate: PieceInit, ignoreId?: number): PlaceCheck {
    if (!inBounds(candidate.x, candidate.z)) return { ok: false, reason: "Outside the board" };
    if (candidate.level > MAX_LEVEL) return { ok: false, reason: "Too high" };
    if (lowestLevel(candidate) < MIN_LEVEL) return { ok: false, reason: "Too close to the floor" };
    const [lo, hi] = verticalSpan(candidate);
    for (const other of this.piecesAt(candidate.x, candidate.z)) {
      if (other.id === ignoreId) continue;
      const [olo, ohi] = verticalSpan(other);
      if (lo < ohi && olo < hi) return { ok: false, reason: "Overlaps another piece" };
    }
    return { ok: true };
  }

  add(init: PieceInit): Piece {
    const check = this.canPlace(init);
    if (!check.ok) throw new Error(check.reason);
    const piece: Piece = { ...init, id: this.#nextId++ };
    this.#pieces.set(piece.id, piece);
    this.#emit();
    return piece;
  }

  remove(id: number): Piece | undefined {
    const piece = this.#pieces.get(id);
    if (piece) {
      this.#pieces.delete(id);
      this.#emit();
    }
    return piece;
  }

  clear(): void {
    this.#pieces.clear();
    this.#emit();
  }

  /** Exits of existing pieces that lead into cell (x, z). */
  feedsInto(x: number, z: number): Port[] {
    const ports: Port[] = [];
    for (const piece of this.#pieces.values()) {
      const port = exitPort(piece);
      if (port && port.x === x && port.z === z) ports.push(port);
    }
    return ports;
  }

  /** The piece that accepts a marble leaving through `port`, if any. */
  receiverOf(port: Port): Piece | undefined {
    const rot = rotationFor(port.dir);
    return this.piecesAt(port.x, port.z).find(
      (p) => PIECES[p.type].hasEntry && p.rot === rot && p.level === port.level,
    );
  }

  /** Exit ports that nothing is attached to yet. */
  openExits(): Port[] {
    const open: Port[] = [];
    for (const piece of this.#pieces.values()) {
      const port = exitPort(piece);
      if (port && !this.receiverOf(port)) open.push(port);
    }
    return open;
  }

  /**
   * Works out how a new piece dropped on (x, z) should sit. A piece with an entry snaps onto any
   * free exit that leads into the cell, taking that exit's level and direction (preferring the
   * caller's rotation if several fit). Otherwise it keeps the caller's rotation and level.
   */
  snap(type: PieceType, x: number, z: number, preferredRot: Rotation, freeLevel: number): Snap {
    if (PIECES[type].hasEntry) {
      const candidates = this.feedsInto(x, z)
        .filter((port) => !this.receiverOf(port))
        .map((port) => ({ rot: rotationFor(port.dir), level: port.level, linked: true }))
        .filter((s) => this.canPlace({ type, x, z, level: s.level, rot: s.rot }).ok);
      const best = candidates.find((c) => c.rot === preferredRot) ?? candidates[0];
      if (best) return best;
    }
    return { rot: preferredRot, level: clampLevel(freeLevel), linked: false };
  }

  toJSON(): SavedBoard {
    return {
      version: 1,
      pieces: this.pieces.map((p) => [p.type, p.x, p.z, p.level, p.rot]),
    };
  }

  /** Replaces the board's contents. Invalid or overlapping entries are skipped. */
  load(data: unknown): void {
    this.#pieces.clear();
    for (const init of parseSaved(data)) {
      if (this.canPlace(init).ok) {
        const piece: Piece = { ...init, id: this.#nextId++ };
        this.#pieces.set(piece.id, piece);
      }
    }
    this.#emit();
  }
}

export interface SavedBoard {
  version: 1;
  pieces: [PieceType, number, number, number, Rotation][];
}

function parseSaved(data: unknown): PieceInit[] {
  if (typeof data !== "object" || data === null || !("pieces" in data)) return [];
  const list = (data as { pieces: unknown }).pieces;
  if (!Array.isArray(list)) return [];
  const result: PieceInit[] = [];
  for (const entry of list) {
    if (!Array.isArray(entry) || entry.length !== 5) continue;
    const [type, x, z, level, rot] = entry as unknown[];
    if (
      isPieceType(type) &&
      Number.isInteger(x) &&
      Number.isInteger(z) &&
      Number.isInteger(level) &&
      (rot === 0 || rot === 1 || rot === 2 || rot === 3)
    ) {
      result.push({ type, x: x as number, z: z as number, level: level as number, rot });
    }
  }
  return result;
}
