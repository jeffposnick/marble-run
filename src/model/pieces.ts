/**
 * The catalogue of snap-together pieces.
 *
 * Every piece lives in one grid cell. In its local frame the marble enters through the −z face
 * (travelling towards +z) and leaves through the face given by `exit`. A piece placed at `level`
 * has its entry port at that level and its exit port `drop` levels lower, so chains of pieces
 * always run downhill.
 */

export type PieceType = "start" | "straight" | "ramp" | "curve-left" | "curve-right" | "finish";

/** Exit face in the piece's local frame. */
export type LocalExit = "forward" | "left" | "right";

export interface PieceSpec {
  readonly type: PieceType;
  readonly label: string;
  readonly description: string;
  /** Levels lost between entry and exit. */
  readonly drop: number;
  /** Whether a marble can arrive from a neighbouring piece. */
  readonly hasEntry: boolean;
  /** Where the marble leaves, or null if it never leaves (the finish cup). */
  readonly exit: LocalExit | null;
  /** Base colour of the plastic, as a hex number. */
  readonly color: number;
  /** Single-key shortcut. */
  readonly key: string;
}

export const PIECES: Readonly<Record<PieceType, PieceSpec>> = {
  start: {
    type: "start",
    label: "Start",
    description: "Marbles are released here",
    drop: 1,
    hasEntry: false,
    exit: "forward",
    color: 0x2bb673,
    key: "1",
  },
  straight: {
    type: "straight",
    label: "Straight",
    description: "Gentle straight channel",
    drop: 1,
    hasEntry: true,
    exit: "forward",
    color: 0x2f8fe0,
    key: "2",
  },
  ramp: {
    type: "ramp",
    label: "Ramp",
    description: "Steep drop of four levels",
    drop: 4,
    hasEntry: true,
    exit: "forward",
    color: 0xf2a72b,
    key: "3",
  },
  "curve-left": {
    type: "curve-left",
    label: "Curve left",
    description: "Quarter turn to the left",
    drop: 1,
    hasEntry: true,
    exit: "left",
    color: 0xe0465a,
    key: "4",
  },
  "curve-right": {
    type: "curve-right",
    label: "Curve right",
    description: "Quarter turn to the right",
    drop: 1,
    hasEntry: true,
    exit: "right",
    color: 0x9b59d0,
    key: "5",
  },
  finish: {
    type: "finish",
    label: "Finish cup",
    description: "Catches marbles at the end of the run",
    drop: 0,
    hasEntry: true,
    exit: null,
    color: 0xf4d03f,
    key: "6",
  },
};

export const PIECE_TYPES = Object.keys(PIECES) as PieceType[];

export function isPieceType(value: unknown): value is PieceType {
  return typeof value === "string" && Object.hasOwn(PIECES, value);
}
