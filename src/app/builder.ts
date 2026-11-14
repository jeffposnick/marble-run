import * as THREE from "three";
import { BOARD_SIZE, CELL, LEVEL, MAX_LEVEL, MIN_LEVEL } from "../config.ts";
import { cellCenter } from "../geometry/track.ts";
import { exitPort, inBounds, type Board, type PieceInit, type Rotation } from "../model/board.ts";
import { PIECES, type PieceType } from "../model/pieces.ts";
import type { Stage } from "../render/scene.ts";
import type { GhostState, TrackView } from "../render/track-view.ts";

export type Tool = PieceType | "erase";

export interface BuilderEvents {
  toolChanged(tool: Tool): void;
  heightChanged(level: number): void;
  announce(message: string): void;
}

/** Pointer travel (CSS px) below which a press counts as a click rather than a camera drag. */
const CLICK_SLOP = 6;

/** Handles choosing, previewing, placing and removing pieces with pointer and keyboard. */
export class Builder {
  tool: Tool = "straight";
  rot: Rotation = 0;
  freeLevel: number;
  /** Cell under the pointer or keyboard cursor. */
  cursor: { x: number; z: number } | null = null;

  #raycaster = new THREE.Raycaster();
  #ndc = new THREE.Vector2();
  #down: { x: number; y: number; id: number } | null = null;
  #hovered: number | undefined;
  #portTargets = new THREE.Group();
  #portBox = new THREE.BoxGeometry(CELL * 0.9, 0.3, CELL * 0.9);
  #invisible = new THREE.MeshBasicMaterial({ visible: false });

  constructor(
    private readonly stage: Stage,
    private readonly board: Board,
    private readonly view: TrackView,
    private readonly events: BuilderEvents,
    initialLevel: number,
  ) {
    this.freeLevel = initialLevel;
    stage.scene.add(this.#portTargets);
    const canvas = stage.renderer.domElement;
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointerleave", this.#onPointerLeave);
    canvas.addEventListener("keydown", this.#onCanvasKey);
    canvas.addEventListener("focus", () => {
      if (!this.cursor && !this.jumpToOpenEnd(false)) this.#setCursor({ x: 4, z: 4 });
    });
    board.onChange(() => this.#rebuildPortTargets());
    this.#rebuildPortTargets();
  }

  // ---------- Public commands (used by toolbar and shortcuts) ----------

  setTool(tool: Tool): void {
    this.tool = tool;
    this.events.toolChanged(tool);
    this.refresh();
  }

  rotate(): void {
    this.rot = ((this.rot + 1) % 4) as Rotation;
    this.refresh();
    const preview = this.preview();
    if (preview && preview.state === "linked") {
      this.events.announce("Rotation is set by the track end this piece snaps to");
    }
  }

  changeHeight(delta: number): void {
    const next = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, this.freeLevel + delta));
    if (next === this.freeLevel) return;
    this.freeLevel = next;
    this.events.heightChanged(next);
    this.refresh();
  }

  /** Moves the cursor to the next open track end. Returns false if there is none. */
  jumpToOpenEnd(announce = true): boolean {
    const open = this.board.openExits().filter((p) => inBounds(p.x, p.z));
    if (open.length === 0) {
      if (announce) this.events.announce("No open track ends");
      return false;
    }
    const index = this.cursor
      ? open.findIndex((p) => p.x === this.cursor!.x && p.z === this.cursor!.z)
      : -1;
    const port = open[(index + 1) % open.length]!;
    this.#setCursor({ x: port.x, z: port.z });
    if (announce) this.events.announce(`Cursor at open end, ${this.#describeCell(port)}`);
    return true;
  }

  /** Places the current piece at the cursor. */
  place(): void {
    const preview = this.preview();
    if (!preview || this.tool === "erase") return;
    if (preview.state === "blocked") {
      this.events.announce(`Can’t place here: ${preview.reason}`);
      return;
    }
    const piece = this.board.add(preview.piece);
    const spec = PIECES[piece.type];
    this.events.announce(
      `${spec.label} placed at ${this.#describeCell(piece)}, height ${piece.level}` +
        (preview.state === "linked" ? ", connected" : ""),
    );
  }

  /** Removes the piece under the pointer, or the top piece in the cursor's cell. */
  eraseAtCursor(): void {
    let id = this.#hovered;
    if (id === undefined && this.cursor) {
      const stack = this.board
        .piecesAt(this.cursor.x, this.cursor.z)
        .toSorted((a, b) => b.level - a.level);
      id = stack[0]?.id;
    }
    const removed = id === undefined ? undefined : this.board.remove(id);
    if (removed) this.events.announce(`${PIECES[removed.type].label} removed`);
    else this.events.announce("Nothing to remove here");
    this.#hovered = undefined;
    this.refresh();
  }

  /** What would be placed at the cursor with the current tool. */
  preview(): { piece: PieceInit; state: GhostState; reason?: string } | null {
    if (!this.cursor || this.tool === "erase") return null;
    const { x, z } = this.cursor;
    const snap = this.board.snap(this.tool, x, z, this.rot, this.freeLevel);
    const piece: PieceInit = { type: this.tool, x, z, level: snap.level, rot: snap.rot };
    const check = this.board.canPlace(piece);
    if (!check.ok) return { piece, state: "blocked", reason: check.reason };
    return { piece, state: snap.linked ? "linked" : "free" };
  }

  /** Re-renders the ghost and highlight after any change. */
  refresh(): void {
    if (this.tool === "erase") {
      if (this.#hovered === undefined && this.cursor) {
        const top = this.board
          .piecesAt(this.cursor.x, this.cursor.z)
          .toSorted((a, b) => b.level - a.level)[0];
        this.view.highlight(top?.id);
      } else {
        this.view.highlight(this.#hovered);
      }
      this.view.showGhost(
        this.cursor ? { type: "straight", ...this.cursor, level: MIN_LEVEL, rot: 0 } : null,
        "blocked",
        false,
      );
      return;
    }
    this.view.highlight(undefined);
    const preview = this.preview();
    this.view.showGhost(preview?.piece ?? null, preview?.state);
  }

  // ---------- Pointer ----------

  #pick(event: PointerEvent): THREE.Intersection | undefined {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    this.#ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#ndc, this.stage.camera);
    const targets =
      this.tool === "erase"
        ? [...this.view.pickables, this.stage.floor]
        : [...this.#portTargets.children, this.stage.floor];
    return this.#raycaster.intersectObjects(targets, false)[0];
  }

  #onPointerMove = (event: PointerEvent): void => {
    if (this.#down && event.pointerId === this.#down.id) {
      const moved = Math.hypot(event.clientX - this.#down.x, event.clientY - this.#down.y);
      if (moved > CLICK_SLOP) return; // orbiting: leave the preview where it is
    }
    const hit = this.#pick(event);
    const pieceId = hit?.object.userData.pieceId as number | undefined;
    this.#hovered = this.tool === "erase" ? pieceId : undefined;
    const cell =
      (hit?.object.userData.cell as { x: number; z: number } | undefined) ??
      (hit ? this.#cellAt(hit.point) : null);
    this.cursor = cell && inBounds(cell.x, cell.z) ? cell : null;
    this.refresh();
  };

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    this.#down = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };

  #onPointerUp = (event: PointerEvent): void => {
    const down = this.#down;
    this.#down = null;
    if (!down || event.pointerId !== down.id) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP) return;
    this.#onPointerMove(event); // make sure the cursor matches where the click landed
    if (this.tool === "erase") {
      if (this.#hovered !== undefined) this.eraseAtCursor();
    } else {
      this.place();
    }
  };

  #onPointerLeave = (): void => {
    if (document.activeElement === this.stage.renderer.domElement) return; // keep keyboard cursor
    this.cursor = null;
    this.#hovered = undefined;
    this.refresh();
  };

  #cellAt(point: THREE.Vector3): { x: number; z: number } {
    const offset = (BOARD_SIZE - 1) / 2;
    return { x: Math.round(point.x / CELL + offset), z: Math.round(point.z / CELL + offset) };
  }

  /** Invisible boxes sitting where each open end leads, so aiming at the gap picks that cell. */
  #rebuildPortTargets(): void {
    this.#portTargets.clear();
    for (const port of this.board.openExits()) {
      if (!inBounds(port.x, port.z)) continue;
      const box = new THREE.Mesh(this.#portBox, this.#invisible);
      const c = cellCenter(port.x, port.z);
      box.position.set(c.x, port.level * LEVEL + 0.05, c.z);
      box.userData.cell = { x: port.x, z: port.z };
      box.updateMatrixWorld();
      this.#portTargets.add(box);
    }
  }

  // ---------- Keyboard ----------

  #setCursor(cell: { x: number; z: number }): void {
    this.cursor = {
      x: Math.min(BOARD_SIZE - 1, Math.max(0, cell.x)),
      z: Math.min(BOARD_SIZE - 1, Math.max(0, cell.z)),
    };
    this.#hovered = undefined;
    this.refresh();
  }

  /** Arrow keys move relative to the camera, so "up" always means "away from me". */
  #screenDirections(): { up: [number, number]; right: [number, number] } {
    const az = this.stage.controls.getAzimuthalAngle();
    const quarter = (((Math.round(az / (Math.PI / 2)) % 4) + 4) % 4) as Rotation;
    const forward: [number, number][] = [
      [0, -1],
      [-1, 0],
      [0, 1],
      [1, 0],
    ];
    const [fx, fz] = forward[quarter]!;
    return { up: [fx, fz], right: [-fz, fx] };
  }

  #onCanvasKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { up, right } = this.#screenDirections();
    const moves: Record<string, [number, number]> = {
      ArrowUp: up,
      ArrowDown: [-up[0], -up[1]],
      ArrowRight: right,
      ArrowLeft: [-right[0], -right[1]],
    };
    const move = moves[event.key];
    if (move) {
      const from = this.cursor ?? { x: 4, z: 4 };
      this.#setCursor({ x: from.x + move[0], z: from.z + move[1] });
      this.#announceCursor();
    } else if (event.key === "Enter" || event.key === " ") {
      if (this.tool === "erase") this.eraseAtCursor();
      else {
        this.place();
        this.#advanceAfterPlace();
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      this.eraseAtCursor();
    } else {
      return;
    }
    event.preventDefault();
  };

  /** After a keyboard placement, hop to the cell the new piece leads into. */
  #advanceAfterPlace(): void {
    if (!this.cursor) return;
    const placed = this.board
      .piecesAt(this.cursor.x, this.cursor.z)
      .toSorted((a, b) => b.id - a.id)[0];
    const port = placed && exitPort(placed);
    if (port && inBounds(port.x, port.z)) this.#setCursor({ x: port.x, z: port.z });
  }

  #announceCursor(): void {
    if (!this.cursor) return;
    const preview = this.preview();
    const stack = this.board.piecesAt(this.cursor.x, this.cursor.z);
    let message = this.#describeCell(this.cursor);
    if (stack.length > 0) {
      message += `, has ${stack.map((p) => PIECES[p.type].label.toLowerCase()).join(" and ")}`;
    }
    if (preview?.state === "linked") message += ", connects to track";
    else if (preview?.state === "blocked") message += `, blocked: ${preview.reason}`;
    this.events.announce(message);
  }

  #describeCell(cell: { x: number; z: number }): string {
    return `column ${cell.x + 1}, row ${cell.z + 1}`;
  }
}
