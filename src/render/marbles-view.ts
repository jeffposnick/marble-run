import * as THREE from "three";
import { MARBLE_RADIUS } from "../config.ts";
import type { MarbleState } from "../physics/world.ts";

const HUES = [0.0, 0.08, 0.15, 0.33, 0.52, 0.6, 0.75, 0.88];

/** A swirl texture so a marble's spin is visible as it rolls. */
function swirlTexture(): THREE.Texture {
  const size = 128;
  const canvas = new OffscreenCanvas(size * 2, size);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size * 2, size);
  ctx.strokeStyle = "rgba(255,255,255,0.0)";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse((i * size * 2) / 3 + 30, size / 2, 26, size * 0.48, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Snapshot {
  prev: THREE.Vector3;
  next: THREE.Vector3;
  prevQ: THREE.Quaternion;
  nextQ: THREE.Quaternion;
  mesh: THREE.Mesh;
}

/** Renders marbles, interpolating between fixed physics steps for smooth motion at any refresh rate. */
export class MarblesView {
  readonly root = new THREE.Group();
  #geometry = new THREE.SphereGeometry(MARBLE_RADIUS, 32, 16);
  #texture = swirlTexture();
  #materials = HUES.map(
    (h) =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color().setHSL(h, 0.75, 0.5),
        map: this.#texture,
        roughness: 0.08,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        sheen: 0.3,
      }),
  );
  #marbles = new Map<number, Snapshot>();
  #count = 0;

  /** Records a physics step. Call once per step, after stepping. */
  capture(states: Iterable<MarbleState>): void {
    const seen = new Set<number>();
    for (const s of states) {
      seen.add(s.id);
      let snap = this.#marbles.get(s.id);
      if (!snap) {
        const mesh = new THREE.Mesh(
          this.#geometry,
          this.#materials[this.#count++ % this.#materials.length],
        );
        mesh.castShadow = true;
        this.root.add(mesh);
        const p = new THREE.Vector3(s.x, s.y, s.z);
        const q = new THREE.Quaternion(s.qx, s.qy, s.qz, s.qw);
        snap = { prev: p.clone(), next: p, prevQ: q.clone(), nextQ: q, mesh };
        this.#marbles.set(s.id, snap);
      } else {
        snap.prev.copy(snap.next);
        snap.prevQ.copy(snap.nextQ);
        snap.next.set(s.x, s.y, s.z);
        snap.nextQ.set(s.qx, s.qy, s.qz, s.qw);
      }
    }
    for (const [id, snap] of this.#marbles) {
      if (!seen.has(id)) {
        this.root.remove(snap.mesh);
        this.#marbles.delete(id);
      }
    }
  }

  /** Places meshes `alpha` of the way from the previous to the latest physics step. */
  interpolate(alpha: number): void {
    for (const snap of this.#marbles.values()) {
      snap.mesh.position.lerpVectors(snap.prev, snap.next, alpha);
      snap.mesh.quaternion.slerpQuaternions(snap.prevQ, snap.nextQ, alpha);
    }
  }
}
