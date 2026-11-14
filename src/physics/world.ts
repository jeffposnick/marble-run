import {
  ActiveEvents,
  ColliderDesc,
  EventQueue,
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
  /** What the marble is resting or rolling on, if anything (other marbles don't count). */
  readonly surface: Surface | null;
}

export type Surface = "track" | "table";

/** A collision worth hearing: a marble striking another marble, the track or the table. */
export interface Impact {
  readonly kind: "glass" | Surface;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How hard the hit was, in m/s: the closing speed of two marbles, or a marble's jolt. */
  readonly strength: number;
}

interface Marble {
  id: number;
  body: RigidBody;
  collider: Collider;
  /** Handles of the static colliders currently touching this marble. */
  contacts: Set<number>;
  /** Linear velocity before the current step, for measuring how hard a collision was. */
  vx: number;
  vy: number;
  vz: number;
  knockCooldown: number;
}

/** Two marbles Rapier says are in (or about to be in) contact. */
interface GlassPair {
  a: Marble;
  b: Marble;
  /** Whether this meeting has already been reported; re-armed once they move apart. */
  hit: boolean;
}

/**
 * Rapier reports contact some steps before surfaces actually meet (it predicts contacts from
 * velocity), so impacts are found from what really happens: a sudden change in a marble's
 * velocity beyond gravity's pull, or two marbles closing on each other and touching.
 */
const KNOCK_THRESHOLD = 0.25;
/** Steps after a knock before the same marble can knock again, so one landing is one sound. */
const KNOCK_COOLDOWN_STEPS = 12;
/** Marbles closer than this (centre to centre, beyond touching) count as touching. */
const TOUCH_SLOP = 0.003;
/** ...and further apart than this count as separated again. */
const SEPARATE_SLOP = 0.01;
/** Impacts not collected by {@link MarblePhysics.takeImpacts} are dropped beyond this many. */
const MAX_QUEUED_IMPACTS = 64;

/** Thin wrapper around a Rapier world holding one track collider and any number of marbles. */
export class MarblePhysics {
  readonly world: World;
  readonly dt = 1 / PHYSICS_HZ;
  #track: Collider | undefined;
  #tableHandles = new Set<number>();
  #marbles = new Map<number, Marble>();
  #byCollider = new Map<number, Marble>();
  #events = new EventQueue(true);
  #glassPairs = new Map<string, GlassPair>();
  #impacts: Impact[] = [];
  #nextId = 1;

  /** Call {@link initPhysics} and await it first. */
  constructor() {
    this.world = new World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    // Floor slab under the whole board, plus low walls so stray marbles stay on the table.
    const half = (BOARD_SIZE * CELL) / 2 + 0.5;
    const floor = this.world.createRigidBody(RigidBodyDesc.fixed());
    const slab = this.world.createCollider(
      ColliderDesc.cuboid(half, 0.05, half)
        .setTranslation(0, -0.05, 0)
        .setFriction(0.8)
        .setRestitution(0.2),
      floor,
    );
    this.#tableHandles.add(slab.handle);
    for (const [x, z, hx, hz] of [
      [half, 0, 0.05, half],
      [-half, 0, 0.05, half],
      [0, half, half, 0.05],
      [0, -half, half, 0.05],
    ] as const) {
      const wall = this.world.createCollider(
        ColliderDesc.cuboid(hx, 0.1, hz).setTranslation(x, 0.1, z),
        floor,
      );
      this.#tableHandles.add(wall.handle);
    }
  }

  /** Replaces the track's collision mesh. */
  setTrack(mesh: MeshData): void {
    if (this.#track) {
      const old = this.#track.handle;
      for (const m of this.#marbles.values()) m.contacts.delete(old);
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
    const collider = this.world.createCollider(
      ColliderDesc.ball(MARBLE_RADIUS)
        .setDensity(2500) // glass, kg/m³
        .setFriction(0.4)
        .setRestitution(0.25)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const id = this.#nextId++;
    const marble: Marble = {
      id,
      body,
      collider,
      contacts: new Set(),
      vx,
      vy: 0,
      vz,
      knockCooldown: 0,
    };
    this.#marbles.set(id, marble);
    this.#byCollider.set(collider.handle, marble);
    return id;
  }

  removeMarble(id: number): void {
    const marble = this.#marbles.get(id);
    if (!marble) return;
    this.#byCollider.delete(marble.collider.handle);
    this.world.removeRigidBody(marble.body);
    this.#marbles.delete(id);
    for (const [key, pair] of this.#glassPairs) {
      if (pair.a === marble || pair.b === marble) this.#glassPairs.delete(key);
    }
  }

  clearMarbles(): void {
    for (const id of this.#marbles.keys()) this.removeMarble(id);
  }

  get marbleCount(): number {
    return this.#marbles.size;
  }

  step(): void {
    for (const m of this.#marbles.values()) {
      const v = m.body.linvel();
      m.vx = v.x;
      m.vy = v.y;
      m.vz = v.z;
    }
    this.world.step(this.#events);
    this.#events.drainCollisionEvents((h1, h2, started) => {
      const m1 = this.#byCollider.get(h1);
      const m2 = this.#byCollider.get(h2);
      if (m1 && m2) {
        const key = m1.id < m2.id ? `${m1.id}:${m2.id}` : `${m2.id}:${m1.id}`;
        if (started) this.#glassPairs.set(key, { a: m1, b: m2, hit: false });
        else this.#glassPairs.delete(key);
        return;
      }
      const marble = m1 ?? m2;
      if (!marble) return;
      const other = m1 ? h2 : h1;
      if (started) marble.contacts.add(other);
      else marble.contacts.delete(other);
    });
    this.#findImpacts();
  }

  #findImpacts(): void {
    const struck = new Set<Marble>();
    for (const pair of this.#glassPairs.values()) {
      const pa = pair.a.body.translation();
      const pb = pair.b.body.translation();
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dz = pb.z - pa.z;
      const gap = Math.hypot(dx, dy, dz) - 2 * MARBLE_RADIUS;
      if (gap > SEPARATE_SLOP) pair.hit = false;
      if (pair.hit || gap > TOUCH_SLOP) continue;
      pair.hit = true;
      // How fast they were closing just before they touched.
      const d = gap + 2 * MARBLE_RADIUS;
      const closing =
        ((pair.a.vx - pair.b.vx) * dx +
          (pair.a.vy - pair.b.vy) * dy +
          (pair.a.vz - pair.b.vz) * dz) /
        d;
      if (closing <= 0) continue;
      struck.add(pair.a).add(pair.b);
      this.#emit("glass", (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2, closing);
    }

    const g = this.world.gravity;
    for (const m of this.#marbles.values()) {
      if (m.knockCooldown > 0) m.knockCooldown--;
      if (m.contacts.size === 0 || m.knockCooldown > 0 || struck.has(m)) continue;
      const v = m.body.linvel();
      const jolt = Math.hypot(
        v.x - m.vx - g.x * this.dt,
        v.y - m.vy - g.y * this.dt,
        v.z - m.vz - g.z * this.dt,
      );
      if (jolt < KNOCK_THRESHOLD) continue;
      m.knockCooldown = KNOCK_COOLDOWN_STEPS;
      const p = m.body.translation();
      this.#emit(this.#surfaceOf(m.contacts) ?? "track", p.x, p.y, p.z, jolt);
    }
  }

  #emit(kind: Impact["kind"], x: number, y: number, z: number, strength: number): void {
    if (this.#impacts.length < MAX_QUEUED_IMPACTS) this.#impacts.push({ kind, x, y, z, strength });
  }

  /** Returns the collisions since the last call, and forgets them. */
  takeImpacts(): Impact[] {
    const impacts = this.#impacts;
    this.#impacts = [];
    return impacts;
  }

  *marbles(): Generator<MarbleState> {
    for (const { id, body, contacts } of this.#marbles.values()) {
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
        surface: this.#surfaceOf(contacts),
      };
    }
  }

  #surfaceOf(contacts: Set<number>): Surface | null {
    if (contacts.size === 0) return null;
    for (const handle of contacts) if (!this.#tableHandles.has(handle)) return "track";
    return "table";
  }

  free(): void {
    this.#events.free();
    this.world.free();
  }
}
