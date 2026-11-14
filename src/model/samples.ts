import { BOARD_SIZE } from "../config.ts";
import type { PieceInit, Rotation, SavedBoard } from "./board.ts";
import { DEMO_BOARD } from "./demo.ts";
import { path } from "./track-path.ts";

export interface Sample {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly board: SavedBoard;
}

const LAST = BOARD_SIZE - 1;

/** The same pieces turned a quarter turn (clockwise from above) about the board's centre. */
function turned(pieces: PieceInit[], quarterTurns = 1): PieceInit[] {
  let out = pieces;
  for (let i = 0; i < quarterTurns; i++) {
    out = out.map((p) => ({ ...p, x: p.z, z: LAST - p.x, rot: ((p.rot + 1) % 4) as Rotation }));
  }
  return out;
}

/** The mirror image across the board's x centre line: left and right curves swap. */
function mirrored(pieces: PieceInit[]): PieceInit[] {
  const swap = { "curve-left": "curve-right", "curve-right": "curve-left" } as const;
  return pieces.map((p) => ({
    ...p,
    type: p.type === "curve-left" || p.type === "curve-right" ? swap[p.type] : p.type,
    x: LAST - p.x,
    rot: ((4 - p.rot) % 4) as Rotation,
  }));
}

/** The same pieces moved `dx` squares along x and `dz` along z. */
function shifted(pieces: PieceInit[], dx: number, dz: number): PieceInit[] {
  return pieces.map(({ type, x, z, level, rot }) => ({ type, x: x + dx, z: z + dz, level, rot }));
}

function board(...runs: PieceInit[][]): SavedBoard {
  return { version: 1, pieces: runs.flat().map((p) => [p.type, p.x, p.z, p.level, p.rot]) };
}

const lap = (n: number, route: string) => route.repeat(n);

// ---------- 1. Twin Corkscrews ----------
// Two helices, each three and a half laps of a 2 × 3 loop, wound in opposite directions.
const corkscrew = path(3, 2, 30, 0, `s ${lap(3, "llslls")} lls ssf`);

// ---------- 2. Grand Prix ----------
// An outer and an inner circuit round the board. The inner one starts lower but is shorter.
const outerRing = path(1, 1, 30, 0, "sssss l sssss l sssss l ssss f");
const innerRing = path(6, 6, 24, 2, "sss l sss l sss l ss f");

// ---------- 3. Switchback Mountain ----------
// Two zig-zag descents on facing mountainsides: steep ramps down each traverse, hairpin bends at
// the ends.
const switchback = path(1, 8, 30, 1, "r s ll r s tt r s ll s f");
const switchbacks = [switchback, turned(switchback, 2)];

// ---------- 4. Four Corners ----------
// Four identical runs start from the corners and wind into a cluster of cups in the middle.
const cornerRun = path(0, 0, 24, 0, "s r l s r t s l f");
const fourCorners = [0, 1, 2, 3].map((k) => turned(cornerRun, k));

// ---------- 5. The Plunge ----------
// Back-to-back ramps build terrific speed, then long zig-zag run-outs bleed it off.
const plunge = path(0, 8, 30, 1, "rr l s t s l s t s l s t s l s f");
const plunges = [plunge, turned(plunge, 2)];

// ---------- 6. Figure Eight ----------
// Two tracks that each loop round and cross over themselves on a high bridge.
const figureEight = path(4, 1, 30, 0, "ss l l ss t t s t t ss l l s f");
const figureEights = [figureEight, turned(figureEight, 2)];

// ---------- 7. Slalom ----------
// Three racers weave down identical courses of left-right S-bends.
const slalomLane = path(1, 0, 30, 0, "s r lt tl lt tl lt s f");
const slalom = [0, 3, 6].map((dx) => shifted(slalomLane, dx, 0));

// ---------- 8. Rush Hour ----------
// Six straight runs woven into a lattice: the three crossing the board pass high over the three
// running along it.
const rushHour = [
  path(0, 2, 30, 1, "ssssssss f"),
  path(9, 5, 29, 3, "ssssssss f"),
  path(0, 8, 28, 1, "ssssssss f"),
  path(2, 0, 16, 0, "ssssssss f"),
  path(5, 9, 15, 2, "ssssssss f"),
  path(8, 0, 14, 0, "ssssssss f"),
];

// ---------- 9. Leap of Faith ----------
// Three tracks that keep running out. A ramp flings each marble off the end of the track and it
// drops six levels onto the strip below, then does it all over again. One jumps the other way.
const jump = [
  path(0, 2, 30, 1, "r"),
  path(2, 2, 19, 1, "ss", "loose"),
  path(4, 2, 11, 1, "ss l t f", "loose"),
].flat();
const leap = [jump, shifted(jump, 0, 3), turned(jump, 2)];

// ---------- 10. Whirlpool ----------
// One long square spiral that winds inwards to a cup in the very middle.
const whirlpool = path(2, 2, 30, 1, "sss t sss t sss t ss t ss t s t s t t f");

export const SAMPLES: readonly Sample[] = [
  {
    id: "demo",
    name: "Demo run",
    description: "The run you see on your first visit: a winding descent to the finish cup.",
    board: DEMO_BOARD,
  },
  {
    id: "twin-corkscrews",
    name: "Twin Corkscrews",
    description: "Two towering helices wound in opposite directions. Drop and watch them race.",
    board: board(corkscrew, mirrored(corkscrew)),
  },
  {
    id: "grand-prix",
    name: "Grand Prix",
    description: "A long outer circuit and a short, lower inner one. Which marble gets home first?",
    board: board(outerRing, innerRing),
  },
  {
    id: "switchback-mountain",
    name: "Switchback Mountain",
    description: "Steep ramps and hairpin bends zig-zag down two facing mountainsides.",
    board: board(...switchbacks),
  },
  {
    id: "four-corners",
    name: "Four Corners",
    description: "Four runs set off from the corners and meet in a cluster of cups.",
    board: board(...fourCorners),
  },
  {
    id: "the-plunge",
    name: "The Plunge",
    description: "Back-to-back ramps build terrific speed, then long zig-zags bleed it off.",
    board: board(...plunges),
  },
  {
    id: "figure-eights",
    name: "Figure Eights",
    description: "Two tracks that each loop round and cross over themselves on a high bridge.",
    board: board(...figureEights),
  },
  {
    id: "slalom",
    name: "Slalom",
    description: "Three racers weave through tight left-right S-bends side by side.",
    board: board(...slalom),
  },
  {
    id: "rush-hour",
    name: "Rush Hour",
    description: "Six runs woven into a lattice, crossing high over and low under each other.",
    board: board(...rushHour),
  },
  {
    id: "leap-of-faith",
    name: "Leap of Faith",
    description:
      "Three tracks keep running out, so marbles leap off the end onto the track below. Twice.",
    board: board(...leap),
  },
  {
    id: "whirlpool",
    name: "Whirlpool",
    description: "One long square spiral that winds inwards to a cup in the very middle.",
    board: board(whirlpool),
  },
];
