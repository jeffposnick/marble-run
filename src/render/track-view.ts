import * as THREE from "three";
import { CHANNEL_RADIUS, LEVEL } from "../config.ts";
import { cellCenter, merge, pieceGeometry, rotatePoint, type MeshData } from "../geometry/track.ts";
import { lowestLevel, type Board, type Piece, type PieceInit } from "../model/board.ts";
import { PIECES, type PieceType } from "../model/pieces.ts";

export type GhostState = "linked" | "free" | "blocked";

const GHOST_COLORS: Record<GhostState, number> = {
  linked: 0x3ddc84,
  free: 0x7fb2ff,
  blocked: 0xff5a5a,
};

function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function plastic(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.38,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
  });
}

/** Draws the placed pieces, their supports, open-port markers, and the placement ghost. */
export class TrackView {
  readonly root = new THREE.Group();
  #pieces = new THREE.Group();
  #ports = new THREE.Group();
  #geometryCache = new Map<string, THREE.BufferGeometry>();
  #meshes = new Map<number, THREE.Mesh>();
  #pillarGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 12).translate(0, 0.5, 0);
  #footGeometry = new THREE.CylinderGeometry(0.12, 0.14, 0.03, 20).translate(0, 0.015, 0);
  #pillarMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.5 });
  #portGeometry = new THREE.ConeGeometry(0.07, 0.16, 16).rotateX(Math.PI / 2);
  #portMaterial = new THREE.MeshBasicMaterial({
    color: 0x3ddc84,
    transparent: true,
    opacity: 0.85,
  });

  #ghost = new THREE.Group();
  #ghostMesh: THREE.Mesh;
  #ghostMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    roughness: 0.4,
  });
  #cursor: THREE.LineSegments;
  #stem: THREE.Line;

  #highlighted: number | undefined;

  constructor() {
    this.root.add(this.#pieces, this.#ports, this.#ghost);
    this.#ghostMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.#ghostMaterial);
    this.#ghostMesh.renderOrder = 2;
    const square = new THREE.EdgesGeometry(
      new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
    );
    this.#cursor = new THREE.LineSegments(square, new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.#cursor.position.y = 0.006;
    this.#stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.05, gapSize: 0.05 }),
    );
    this.#ghost.add(this.#ghostMesh, this.#cursor, this.#stem);
    this.#ghost.visible = false;
  }

  #geometry(type: PieceType, level: number): THREE.BufferGeometry {
    const key = `${type}:${level}`;
    let geometry = this.#geometryCache.get(key);
    if (!geometry) {
      const g = pieceGeometry({ type, level });
      const all: MeshData = { positions: [], indices: [] };
      merge(all, g.collision);
      for (const s of g.shell) merge(all, s);
      geometry = toBufferGeometry(all);
      this.#geometryCache.set(key, geometry);
    }
    return geometry;
  }

  /** Rebuilds the scene graph from the board. */
  sync(board: Board): void {
    for (const child of this.#pieces.children) {
      if (child instanceof THREE.Mesh && child.material !== this.#pillarMaterial) {
        (child.material as THREE.Material).dispose();
      }
    }
    this.#pieces.clear();
    this.#meshes.clear();
    this.#highlighted = undefined;

    const pieces = board.pieces;
    for (const piece of pieces) {
      const mesh = new THREE.Mesh(
        this.#geometry(piece.type, piece.level),
        plastic(PIECES[piece.type].color),
      );
      const c = cellCenter(piece.x, piece.z);
      mesh.position.set(c.x, 0, c.z);
      mesh.rotation.y = (piece.rot * Math.PI) / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pieceId = piece.id;
      this.#pieces.add(mesh);
      this.#meshes.set(piece.id, mesh);
      this.#addSupport(piece, pieces);
    }

    this.#ports.clear();
    for (const port of board.openExits()) {
      const marker = new THREE.Mesh(this.#portGeometry, this.#portMaterial);
      const c = cellCenter(port.x - port.dir.dx, port.z - port.dir.dz);
      marker.position.set(
        c.x + port.dir.dx * 0.62,
        port.level * LEVEL + CHANNEL_RADIUS * 0.6,
        c.z + port.dir.dz * 0.62,
      );
      marker.lookAt(
        marker.position.x + port.dir.dx,
        marker.position.y,
        marker.position.z + port.dir.dz,
      );
      this.#ports.add(marker);
    }
  }

  #addSupport(piece: Piece, all: readonly Piece[]): void {
    const { support } = pieceGeometry(piece);
    const c = cellCenter(piece.x, piece.z);
    const [sx, sz] = rotatePoint(support.x, support.z, piece.rot);
    // Stand on the floor, or on top of the highest piece underneath in the same cell.
    const below = all
      .filter((p) => p.x === piece.x && p.z === piece.z && p.level < lowestLevel(piece))
      .map((p) => p.level * LEVEL + CHANNEL_RADIUS * 1.3);
    const base = Math.max(0, ...below);
    const top = support.y - 0.02;
    if (top - base < 0.03) return;
    const pillar = new THREE.Mesh(this.#pillarGeometry, this.#pillarMaterial);
    pillar.position.set(c.x + sx, base, c.z + sz);
    pillar.scale.y = top - base;
    pillar.castShadow = true;
    this.#pieces.add(pillar);
    if (base === 0) {
      const foot = new THREE.Mesh(this.#footGeometry, this.#pillarMaterial);
      foot.position.set(c.x + sx, 0, c.z + sz);
      foot.receiveShadow = true;
      this.#pieces.add(foot);
    }
  }

  /** Meshes that can be picked, tagged with `userData.pieceId`. */
  get pickables(): THREE.Object3D[] {
    return [...this.#meshes.values()];
  }

  highlight(id: number | undefined): void {
    if (id === this.#highlighted) return;
    const set = (pid: number | undefined, on: boolean) => {
      const mesh = pid === undefined ? undefined : this.#meshes.get(pid);
      if (mesh) (mesh.material as THREE.MeshPhysicalMaterial).emissive.setHex(on ? 0x772222 : 0);
    };
    set(this.#highlighted, false);
    set(id, true);
    this.#highlighted = id;
  }

  /** Shows the placement preview, or hides it when `piece` is null. */
  showGhost(piece: PieceInit | null, state: GhostState = "free", showPiece = true): void {
    if (!piece) {
      this.#ghost.visible = false;
      return;
    }
    const c = cellCenter(piece.x, piece.z);
    this.#ghost.visible = true;
    this.#ghostMesh.visible = showPiece;
    this.#ghostMesh.geometry = this.#geometry(piece.type, piece.level);
    this.#ghostMesh.position.set(c.x, 0, c.z);
    this.#ghostMesh.rotation.y = (piece.rot * Math.PI) / 2;
    this.#ghostMaterial.color.setHex(GHOST_COLORS[state]);
    this.#cursor.position.set(c.x, 0.006, c.z);
    (this.#cursor.material as THREE.LineBasicMaterial).color.setHex(GHOST_COLORS[state]);
    const height = showPiece ? Math.max(0.01, lowestLevel(piece) * LEVEL - 0.03) : 0.01;
    this.#stem.visible = showPiece;
    this.#stem.position.set(c.x, 0, c.z);
    this.#stem.scale.y = height;
    this.#stem.computeLineDistances();
  }
}
