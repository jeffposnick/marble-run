import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { BOARD_SIZE, CELL } from "../config.ts";

/** Cap on device pixels per CSS pixel: past 2× the extra fill cost buys little sharpness. */
const MAX_PIXEL_RATIO = 2;

const THEME = {
  light: { background: 0xe9eef5, table: 0xd9c3a5, grid: 0x8a7458 },
  dark: { background: 0x10141c, table: 0x3a3029, grid: 0x6d5c4a },
} as const;

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Invisible plane at y = 0 used for picking grid cells. */
  floor: THREE.Mesh;
  render(): void;
  dispose(): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1); // canvas.width/height are set in device pixels by the ResizeObserver
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.set(-5.5, 5.8, 7.2);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.8, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 25;
  // Left button is reserved for placing pieces (a click) but still orbits on drag.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const applyMotion = () => {
    // Inertial camera glide is decorative motion; drop it when the user asks for less motion.
    controls.enableDamping = !reducedMotion.matches;
  };
  applyMotion();
  reducedMotion.addEventListener("change", applyMotion);
  controls.update();

  // Lighting: soft sky fill plus one shadow-casting key light.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-5, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const extent = (BOARD_SIZE * CELL) / 2 + 1;
  Object.assign(sun.shadow.camera, {
    left: -extent,
    right: extent,
    top: extent,
    bottom: -extent,
    near: 1,
    far: 30,
  });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // Table top with a grid showing where pieces snap.
  const size = BOARD_SIZE * CELL;
  const tableMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(size + 1, 0.2, size + 1), tableMaterial);
  table.position.y = -0.1;
  table.receiveShadow = true;
  scene.add(table);
  const grid = new THREE.GridHelper(size, BOARD_SIZE);
  grid.position.y = 0.002;
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.45;
  scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  scene.add(floor);

  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => {
    const theme = darkScheme.matches ? THEME.dark : THEME.light;
    scene.background = new THREE.Color(theme.background);
    tableMaterial.color.setHex(theme.table);
    gridMaterial.color.setHex(theme.grid);
  };
  applyTheme();
  darkScheme.addEventListener("change", applyTheme);

  // Keep the drawing buffer at the canvas's exact device-pixel size so the scene stays sharp.
  const resize = (width: number, height: number) => {
    const scale = Math.min(1, MAX_PIXEL_RATIO / devicePixelRatio);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const dpc = entry.devicePixelContentBoxSize?.[0];
    if (dpc) resize(dpc.inlineSize, dpc.blockSize);
    else {
      resize(
        Math.round(entry.contentRect.width * devicePixelRatio),
        Math.round(entry.contentRect.height * devicePixelRatio),
      );
    }
  });
  const supportsDevicePixelBox =
    typeof ResizeObserverEntry !== "undefined" &&
    "devicePixelContentBoxSize" in ResizeObserverEntry.prototype;
  observer.observe(canvas, supportsDevicePixelBox ? { box: "device-pixel-content-box" } : {});

  return {
    renderer,
    scene,
    camera,
    controls,
    floor,
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      reducedMotion.removeEventListener("change", applyMotion);
      darkScheme.removeEventListener("change", applyTheme);
      controls.dispose();
      envTexture.dispose();
      renderer.dispose();
    },
  };
}
