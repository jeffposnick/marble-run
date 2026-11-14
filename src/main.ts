import "./style.css";
import { Vector3 } from "three";
import { MarbleSounds, type Placer } from "./audio/sound.ts";
import { DEFAULT_LEVEL, MAX_MARBLES } from "./config.ts";
import { trackCollisionMesh } from "./geometry/track.ts";
import { Board } from "./model/board.ts";
import { DEMO_BOARD } from "./model/demo.ts";
import { SAMPLES } from "./model/samples.ts";
import { PIECE_TYPES, PIECES } from "./model/pieces.ts";
import { inFinishCup, spawnPoint } from "./model/run.ts";
import { initPhysics, MarblePhysics } from "./physics/world.ts";
import { MarblesView } from "./render/marbles-view.ts";
import { createStage } from "./render/scene.ts";
import { TrackView } from "./render/track-view.ts";
import { Builder, type Tool } from "./app/builder.ts";
import { setupPwa } from "./app/pwa.ts";
import { setupSamplesDialog } from "./app/samples-dialog.ts";
import { $, buildToolButtons, createAnnouncer, installToolbarFallback, storage } from "./app/ui.ts";

const STORAGE_KEY = "marble-run:board";
const SOUND_KEY = "marble-run:sound";
/** Sounds closer to the camera than this (in metres) play at full volume. */
const SOUND_NEAR = 6;
const AUTO_DROP_SECONDS = 1.5;
/** Marbles resting on the table this long are tidied away. */
const FLOOR_REST_SECONDS = 3;
/** Never simulate more than this much time per frame (e.g. after a background tab resumes). */
const MAX_FRAME_SECONDS = 0.1;

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>("board");
  const announce = createAnnouncer($("status"));
  const stage = createStage(canvas);
  setupPwa(announce);

  const board = new Board();
  board.load(storage.read(STORAGE_KEY) ?? DEMO_BOARD);

  const trackView = new TrackView();
  const marblesView = new MarblesView();
  stage.scene.add(trackView.root, marblesView.root);
  trackView.sync(board);

  // ---------- Toolbar & builder ----------
  const heightOutput = $<HTMLOutputElement>("height");
  const hudTool = $("hud-tool");
  const toolButtons = buildToolButtons($("piece-buttons"), (tool) => builder.setTool(tool));
  const builder = new Builder(
    stage,
    board,
    trackView,
    {
      toolChanged(tool: Tool) {
        toolButtons.setActive(tool);
        hudTool.textContent = tool === "erase" ? "Erasing" : `Building: ${PIECES[tool].label}`;
      },
      heightChanged(level) {
        heightOutput.value = `Height ${level}`;
      },
      announce,
    },
    DEFAULT_LEVEL,
  );
  builder.setTool("straight");
  heightOutput.value = `Height ${builder.freeLevel}`;
  installToolbarFallback(document.querySelector<HTMLElement>('[role="toolbar"]')!);

  $("rotate").addEventListener("click", () => builder.rotate());
  $("raise").addEventListener("click", () => builder.changeHeight(1));
  $("lower").addEventListener("click", () => builder.changeHeight(-1));
  // Choosing anything in the narrow-screen "More" menu closes it.
  const moreMenu = $("more-menu");
  moreMenu.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button") && moreMenu.matches(":popover-open")) {
      moreMenu.hidePopover();
    }
  });
  const help = $<HTMLDialogElement>("help");
  $("help-open").addEventListener("click", () => help.showModal());

  // ---------- Sound ----------
  const sounds = new MarbleSounds(storage.read(SOUND_KEY) !== false);
  const soundButton = $("sound");
  const showSound = () => soundButton.setAttribute("aria-pressed", String(sounds.enabled));
  showSound();
  const setSound = (on: boolean) => {
    sounds.setEnabled(on);
    storage.write(SOUND_KEY, on);
    showSound();
    announce(on ? "Sound on" : "Sound off");
  };
  soundButton.addEventListener("click", () => setSound(!sounds.enabled));
  // Browsers only start audio from a user gesture.
  for (const type of ["pointerdown", "keydown"] as const) {
    document.addEventListener(type, () => sounds.unlock(), { capture: true });
  }
  document.addEventListener("visibilitychange", () => sounds.setHidden(document.hidden));
  const scratch = new Vector3();
  const placeSound: Placer = (x, y, z) => {
    scratch.set(x, y, z);
    const distance = scratch.distanceTo(stage.camera.position);
    scratch.project(stage.camera);
    return {
      pan: Math.max(-1, Math.min(1, scratch.x)) * 0.7,
      gain: Math.min(1, SOUND_NEAR / Math.max(distance, 0.001)),
    };
  };

  // ---------- Physics ----------
  await initPhysics();
  const physics = new MarblePhysics();
  $("loading").hidden = true;

  const rebuildTrack = () => physics.setTrack(trackCollisionMesh(board.pieces));
  rebuildTrack();
  board.onChange(() => {
    trackView.sync(board);
    rebuildTrack();
    builder.refresh();
    storage.write(STORAGE_KEY, board.toJSON());
  });

  interface MarbleInfo {
    bornAt: number;
    finished: boolean;
    restingFor: number;
  }
  const marbleInfo = new Map<number, MarbleInfo>();
  let simTime = 0;
  let finishedCount = 0;
  const hudFinished = $("hud-finished");

  const dropMarbles = (quiet = false): void => {
    const starts = board.pieces.filter((p) => p.type === "start");
    if (starts.length === 0) {
      if (!quiet) announce("Add a start piece first");
      return;
    }
    for (const start of starts) {
      const s = spawnPoint(start);
      const id = physics.addMarble(s.x, s.y, s.z);
      marbleInfo.set(id, { bornAt: simTime, finished: false, restingFor: 0 });
    }
    // Keep the scene light: retire the oldest marbles beyond the cap.
    const excess = marbleInfo.size - MAX_MARBLES;
    if (excess > 0) {
      for (const id of [...marbleInfo.keys()].slice(0, excess)) {
        physics.removeMarble(id);
        marbleInfo.delete(id);
      }
    }
    if (!quiet)
      announce(starts.length === 1 ? "Marble dropped" : `${starts.length} marbles dropped`);
  };

  let paused = false;
  const pauseButton = $("pause");
  const setPaused = (value: boolean) => {
    paused = value;
    if (paused) sounds.hush();
    const label = paused ? "Resume" : "Pause";
    $("pause-label").textContent = label;
    pauseButton.setAttribute("aria-label", label);
    pauseButton.title = `${label} (P)`;
    // Two bars while running; a play triangle while paused.
    $("pause-icon").setAttribute("d", paused ? "M8 5l11 7-11 7z" : "M9 5v14M15 5v14");
    announce(paused ? "Paused" : "Resumed");
  };

  let autoDrop = false;
  let autoTimer = 0;
  const autoButton = $("auto");
  const setAutoDrop = (on: boolean) => {
    autoDrop = on;
    autoTimer = AUTO_DROP_SECONDS;
    autoButton.setAttribute("aria-pressed", String(on));
  };

  $("drop").addEventListener("click", () => dropMarbles());
  autoButton.addEventListener("click", () => setAutoDrop(!autoDrop));
  pauseButton.addEventListener("click", () => setPaused(!paused));
  const clearMarbles = () => {
    physics.clearMarbles();
    marbleInfo.clear();
    marblesView.capture(physics.marbles());
    setAutoDrop(false);
  };
  $("clear-marbles").addEventListener("click", () => {
    clearMarbles();
    announce("Marbles cleared");
  });

  const samplesDialog = $<HTMLDialogElement>("samples");
  setupSamplesDialog(samplesDialog, SAMPLES, (sample) => {
    board.load(sample.board);
    clearMarbles();
    announce(`${sample.name} loaded`);
    canvas.focus();
  });
  $("samples-open").addEventListener("click", () => samplesDialog.showModal());

  const confirmClear = $<HTMLDialogElement>("confirm-clear");
  $("clear-board").addEventListener("click", () => confirmClear.showModal());
  confirmClear.addEventListener("close", () => {
    if (confirmClear.returnValue === "clear") {
      board.clear();
      clearMarbles();
      announce("Board cleared");
    }
    confirmClear.returnValue = "";
  });

  // ---------- Shortcuts ----------
  // Single-key shortcuts only fire while focus is on the page, board or toolbar — never in a
  // dialog or form field — so they can't hijack typing or assistive-technology keys.
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("dialog, input, textarea, select, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    const piece = PIECE_TYPES.find((t) => PIECES[t].key === key);
    if (piece) builder.setTool(piece);
    else if (key === "x") builder.setTool("erase");
    else if (key === "r") builder.rotate();
    else if (event.key === "PageUp" || key === "]") builder.changeHeight(1);
    else if (event.key === "PageDown" || key === "[") builder.changeHeight(-1);
    else if (key === "o") {
      builder.jumpToOpenEnd();
      canvas.focus();
    } else if (key === "m") dropMarbles();
    else if (key === "p") setPaused(!paused);
    else if (key === "s") setSound(!sounds.enabled);
    else if (event.key === "?") help.showModal();
    else return;
    event.preventDefault();
  });

  // ---------- Loop ----------
  let last = performance.now();
  let accumulator = 0;

  const updateMarbles = (dt: number) => {
    const finishes = board.pieces.filter((p) => p.type === "finish");
    for (const m of physics.marbles()) {
      const info = marbleInfo.get(m.id);
      if (!info) continue;
      if (!info.finished && finishes.some((f) => inFinishCup(f, m))) {
        info.finished = true;
        finishedCount++;
        hudFinished.textContent = `Finished: ${finishedCount}`;
        announce(`Marble finished in ${(simTime - info.bornAt).toFixed(1)} seconds`);
      }
      const onTable = m.y < 0.12 && m.speed < 0.08;
      info.restingFor = onTable ? info.restingFor + dt : 0;
      if (info.restingFor > FLOOR_REST_SECONDS || m.y < -2) {
        physics.removeMarble(m.id);
        marbleInfo.delete(m.id);
      }
    }
  };

  const frame = (now: number) => {
    const elapsed = Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
    last = now;
    if (!paused) {
      accumulator += elapsed;
      if (autoDrop) {
        autoTimer -= elapsed;
        if (autoTimer <= 0) {
          autoTimer += AUTO_DROP_SECONDS;
          dropMarbles(true);
        }
      }
      while (accumulator >= physics.dt) {
        physics.step();
        simTime += physics.dt;
        accumulator -= physics.dt;
        marblesView.capture(physics.marbles());
      }
      updateMarbles(elapsed);
      sounds.update(physics.marbles(), physics.takeImpacts(), placeSound);
    }
    marblesView.interpolate(paused ? 1 : accumulator / physics.dt);
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  console.error(error);
  const loading = document.getElementById("loading");
  if (loading) {
    loading.hidden = false;
    loading.textContent =
      "Sorry, the marble run couldn’t start. Your browser may not support WebGL.";
  }
});
