/** World units are metres; one grid cell is 1 × 1. */
export const CELL = 1;

/** Height of one "level" step. Every piece's ports sit at a whole number of levels. */
export const LEVEL = 0.1;

/** Board is BOARD_SIZE × BOARD_SIZE cells, centred on the origin. */
export const BOARD_SIZE = 10;

/** Highest level a piece may be placed at. */
export const MAX_LEVEL = 30;

/** Lowest level a piece may be placed at (keeps the channel above the floor). */
export const MIN_LEVEL = 2;

/** Default build height for unattached pieces. */
export const DEFAULT_LEVEL = 16;

/** Gradient (rise / run) that every channel has where it meets a neighbour, so joins are smooth. */
export const PORT_SLOPE = LEVEL / CELL;

/** Inner radius of the U-shaped channel. */
export const CHANNEL_RADIUS = 0.14;

/** Wall thickness of the channel. */
export const CHANNEL_THICKNESS = 0.025;

/** How far up the side walls go, in radians measured from the channel bottom. */
export const CHANNEL_WALL_ANGLE = (105 * Math.PI) / 180;

export const MARBLE_RADIUS = 0.07;

/** Most marbles alive at once; the oldest is removed when exceeded. */
export const MAX_MARBLES = 40;

/** Physics runs at a fixed rate, independent of the display refresh rate. */
export const PHYSICS_HZ = 120;
