import {
  ColliderDesc,
  init,
  RigidBodyDesc,
  TriMeshFlags,
  World,
  type Collider,
  type RigidBody,
} from "@dimforge/rapier3d-compat";
import { BOARD_SIZE, CELL, MARBLE_RADIUS, PHYSICS_HZ } from "../config.ts";
import type { MeshData } from "../geometry/track.ts";

let ready: Promise<void> | undefined;

/** Loads Rapier's WASM module once. */
export function initPhysics(): Promise<void> {
  ready ??= init();
  return ready;
}

export interface MarbleState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rotation quaternion. */
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly speed: number;
}

interface Marble {
  id: number;
  body: RigidBody;
}

/** Thin wrapper around a Rapier world holding one track collider and any number of marbles. */
export class MarblePhysics {
  readonly world: World;
  readonly dt = 1 / PHYSICS_HZ;
  #track: Collider | undefined;
  #marbles = new Map<number, Marble>();
  #nextId = 1;

  /** Call {@link initPhysics} and await it first. */
  constructor() {
    this.world = new World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    // Floor slab under the whole board, plus low walls so stray marbles stay on the table.
    const half = (BOARD_SIZE * CELL) / 2 + 0.5;
    const floor = this.world.createRigidBody(RigidBodyDesc.fixed());
    this.world.createCollider(
      ColliderDesc.cuboid(half, 0.05, half)
        .setTranslation(0, -0.05, 0)
        .setFriction(0.8)
        .setRestitution(0.2),
      floor,
    );
    for (const [x, z, hx, hz] of [
      [half, 0, 0.05, half],
      [-half, 0, 0.05, half],
      [0, half, half, 0.05],
      [0, -half, half, 0.05],
    ] as const) {
      this.world.createCollider(ColliderDesc.cuboid(hx, 0.1, hz).setTranslation(x, 0.1, z), floor);
    }
  }

  /** Replaces the track's collision mesh. */
  setTrack(mesh: MeshData): void {
    if (this.#track) {
      this.world.removeCollider(this.#track, false);
      this.#track = undefined;
    }
    if (mesh.indices.length === 0) return;
    const desc = ColliderDesc.trimesh(
      new Float32Array(mesh.positions),
      new Uint32Array(mesh.indices),
      TriMeshFlags.FIX_INTERNAL_EDGES_TWO_SIDED,
    )
      .setFriction(0.25)
      .setRestitution(0.15);
    this.#track = this.world.createCollider(desc);
    // Wake sleeping marbles so they react to the new shape.
    for (const m of this.#marbles.values()) m.body.wakeUp();
  }

  addMarble(x: number, y: number, z: number, vx = 0, vz = 0): number {
    const body = this.world.createRigidBody(
      RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(vx, 0, vz)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.25),
    );
    this.world.createCollider(
      ColliderDesc.ball(MARBLE_RADIUS)
        .setDensity(2500) // glass, kg/m³
        .setFriction(0.4)
        .setRestitution(0.25),
      body,
    );
    const id = this.#nextId++;
    this.#marbles.set(id, { id, body });
    return id;
  }

  removeMarble(id: number): void {
    const marble = this.#marbles.get(id);
    if (!marble) return;
    this.world.removeRigidBody(marble.body);
    this.#marbles.delete(id);
  }

  clearMarbles(): void {
    for (const id of this.#marbles.keys()) this.removeMarble(id);
  }

  get marbleCount(): number {
    return this.#marbles.size;
  }

  step(): void {
    this.world.step();
  }

  *marbles(): Generator<MarbleState> {
    for (const { id, body } of this.#marbles.values()) {
      const p = body.translation();
      const q = body.rotation();
      const v = body.linvel();
      yield {
        id,
        x: p.x,
        y: p.y,
        z: p.z,
        qx: q.x,
        qy: q.y,
        qz: q.z,
        qw: q.w,
        speed: Math.hypot(v.x, v.y, v.z),
      };
    }
  }

  free(): void {
    this.world.free();
  }
}
