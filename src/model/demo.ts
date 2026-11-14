import type { SavedBoard } from "./board.ts";

/** The run shown on first visit: a winding descent from a tall start to the finish cup. */
export const DEMO_BOARD: SavedBoard = {
  version: 1,
  pieces: [
    ["start", 1, 1, 22, 0],
    ["straight", 1, 2, 21, 0],
    ["ramp", 1, 3, 20, 0],
    ["curve-left", 1, 4, 16, 0],
    ["straight", 2, 4, 15, 1],
    ["straight", 3, 4, 14, 1],
    ["curve-right", 4, 4, 13, 1],
    ["ramp", 4, 5, 12, 0],
    ["curve-left", 4, 6, 8, 0],
    ["straight", 5, 6, 7, 1],
    ["straight", 6, 6, 6, 1],
    ["finish", 7, 6, 5, 1],
  ],
};
