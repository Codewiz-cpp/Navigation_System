import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ═══════════════════════════════════════════════════════════════
//  LAYOUT  (from Layout.json — all coords in flat-space metres)
// ═══════════════════════════════════════════════════════════════
const ROOMS = [
  { name: "Room",          polygon: [[-6,4],[2.5,4],[2.5,11.5],[-6,11.5]] },
  { name: "Hall",          polygon: [[-8.5,-14],[-8.5,-2.5],[-3,-2.5],[-3,-14]] },
  { name: "Kitchen",       polygon: [[0,-2.5],[4.5,-2.5],[4.5,-8],[0,-8]] },
  { name: "Main Entrance", polygon: [[0,-8],[0,-14],[4.5,-14],[4.5,-8]] },
  { name: "Corridor",      polygon: [[-3,-14],[0,-14],[0,4],[-3,4]] },
];

const DOOR_LABELS = [
  { name: "Main Gate",    x: 4.5,  z: -13  },
  { name: "Aahan Gate",   x: -0.5, z: -14  },
  { name: "Balcony Gate", x: -8.5, z: -4   },
  { name: "Sandeep Room", x: 0,    z: 3    },
  { name: "Washroom",     x: 0,    z: 0.5  },
];

const FLAT_BOUNDS = { minX: -8.5, maxX: 4.5, minZ: -14, maxZ: 11.5 };

// ───────────────────────────────────────────────────────────────
//  WIFI ROUTERS
//
//  YOUR router position decoded from Layout.json (item_mno3ljxjvvzicruy):
//    parent wall: wall_x86zqzle6k5tah6k
//      start(-8.5, -2.5) → end(-3, -2.5), direction +X
//    position along wall = 5  →  worldX = -8.5 + 5 = -3.5
//    worldZ = -2.5 (wall surface); nudge half-depth inward so box sits on wall
//    worldY = 1.5 m (JSON position[1] = centre of panel)
//    rotation = π  →  panel face points into Hall (+Z)
//    asset dims × scale: (0.5×0.61)W × (1.0×0.74)H × (0.3×0.7)D
//                      ≈  0.305 W  ×  0.740 H  ×  0.210 D  metres
//
//  ABOVE / BELOW routers: identical XZ wall position in their floor
//    (same flat layout). Vertical offset = ±3.0 m (floor height ≈ 3 m).
//    Their y in YOUR coordinate space = 1.5 ± 3.0.
//
//  BSSIDs: replace with real MACs from Android → Settings → WiFi → tap router
//  txPower: stand exactly 1 m from router, note RSSI, enter here
// ───────────────────────────────────────────────────────────────
const ROUTER_BOX = { w: 0.305, h: 0.740, d: 0.210 }; // metres

const ROUTERS = [
  {
    id:       "yours",
    label:    "Your Router",
    bssid:    "AA:BB:CC:DD:EE:01",  // ← replace with actual MAC
    pos:      new THREE.Vector3(-3.5, 1.5, -2.5 + ROUTER_BOX.d / 2),
    wallNorm: new THREE.Vector3(0, 0, 1),  // faces into Hall (+Z)
    txPower:  -45,
    pathLoss: 2.8,
    color:    0x00ff88,
    floor:    0,
  },
  {
    id:       "above",
    label:    "Above Floor Router",
    bssid:    "AA:BB:CC:DD:EE:02",  // ← replace
    pos:      new THREE.Vector3(-3.5, 1.5 + 3.0, -2.5 + ROUTER_BOX.d / 2),
    wallNorm: new THREE.Vector3(0, 0, 1),
    txPower:  -48,
    pathLoss: 3.2,  // concrete slab adds ~8 dB extra attenuation
    color:    0xff6644,
    floor:    1,
  },
  {
    id:       "below",
    label:    "Below Floor Router",
    bssid:    "AA:BB:CC:DD:EE:03",  // ← replace
    pos:      new THREE.Vector3(-3.5, 1.5 - 3.0, -2.5 + ROUTER_BOX.d / 2),
    wallNorm: new THREE.Vector3(0, 0, 1),
    txPower:  -48,
    pathLoss: 3.2,
    color:    0x4488ff,
    floor:    -1,
  },
];

// ───────────────────────────────────────────────────────────────
//  SPAWN & CONSTANTS
// ───────────────────────────────────────────────────────────────
const SPAWN        = { x: 3.5, z: -13, yaw: Math.PI };
const EYE_HEIGHT   = 0.6;    // m — half wall height
const FLOOR_Y      = 0;      // flat-space floor

// Movement
const ACCEL    = 18;
const FRICTION = 12;
const MAX_SPD  = 6;

// Look
const MOUSE_SENS = 0.0018;
const TOUCH_SENS = 0.004;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

// ═══════════════════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.FogExp2(0x0d1117, 0.018);

// ═══════════════════════════════════════════════════════════════
//  CAMERAS
//  Two cameras: FPS rig (walk-around) + Overview (top-down)
// ═══════════════════════════════════════════════════════════════

// ── FPS rig ──────────────────────────────────────────────────
const yawObj   = new THREE.Object3D();
const pitchObj = new THREE.Object3D();
const fpsCam   = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.02, 500);
yawObj.add(pitchObj);
pitchObj.add(fpsCam);
scene.add(yawObj);

// ── Overview camera ──────────────────────────────────────────
// Orthographic, looking straight down, auto-sized to flat bounds
const ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
ovCam.position.set(0, 60, 0);
ovCam.lookAt(0, 0, 0);
scene.add(ovCam);

let activeCamera = fpsCam;
let cameraMode   = "fps";   // "fps" | "overview"

// State set after model loads
let scaleFactor = 1;
let eyeY        = EYE_HEIGHT;
let bounds      = null;

let yaw   = SPAWN.yaw;
let pitch = 0;

// ═══════════════════════════════════════════════════════════════
//  RENDERER
// ═══════════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ═══════════════════════════════════════════════════════════════
//  LIGHTS
// ═══════════════════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0xfff5e0, 1.6));

const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near   = 0.5;
sun.shadow.camera.far    = 200;
sun.shadow.camera.left   = -30;
sun.shadow.camera.right  = 30;
sun.shadow.camera.top    = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xc0d8ff, 0.7);
fill.position.set(-10, 10, -10);
scene.add(fill);

// ═══════════════════════════════════════════════════════════════
//  PLAYER POSITION STATE  (flat-space, metres)
//  This is the single source of truth for where the user IS.
//  Both WASD and WiFi/DR write here; the 3D dot + minimap read it.
// ═══════════════════════════════════════════════════════════════
const playerPos = new THREE.Vector2(SPAWN.x, SPAWN.z);  // x,z in layout metres

// ═══════════════════════════════════════════════════════════════
//  PLAYER MARKER  — Google-Maps-style pulsing dot + heading beam
//  Everything is a flat disc/ring lying on the XZ plane (Y-up).
//  The group is placed at floor level and rotated by yaw each frame.
// ═══════════════════════════════════════════════════════════════
const playerDot = new THREE.Group();
playerDot.renderOrder = 999;
scene.add(playerDot);

// ── Accuracy halo (large, very faint) ──────────────────────────
const haloGeo = new THREE.CircleGeometry(1.2, 48);
const haloMat = new THREE.MeshBasicMaterial({
  color: 0x2196f3, transparent: true, opacity: 0.10,
  depthWrite: false, side: THREE.DoubleSide,
});
const haloMesh = new THREE.Mesh(haloGeo, haloMat);
haloMesh.rotation.x = -Math.PI / 2;
playerDot.add(haloMesh);

// ── Outer pulse ring ────────────────────────────────────────────
const pulseGeo = new THREE.RingGeometry(0.38, 0.48, 48);
const pulseMat = new THREE.MeshBasicMaterial({
  color: 0x2196f3, transparent: true, opacity: 0.55,
  depthWrite: false, side: THREE.DoubleSide,
});
const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
pulseMesh.rotation.x = -Math.PI / 2;
playerDot.add(pulseMesh);

// ── White border ring ───────────────────────────────────────────
const borderGeo = new THREE.RingGeometry(0.22, 0.33, 48);
const borderMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.95,
  depthWrite: false, side: THREE.DoubleSide,
});
const borderMesh = new THREE.Mesh(borderGeo, borderMat);
borderMesh.rotation.x = -Math.PI / 2;
playerDot.add(borderMesh);

// ── Core blue dot ───────────────────────────────────────────────
const coreGeo = new THREE.CircleGeometry(0.22, 48);
const coreMat = new THREE.MeshBasicMaterial({
  color: 0x1565c0, transparent: true, opacity: 1.0,
  depthWrite: false, side: THREE.DoubleSide,
});
const coreMesh = new THREE.Mesh(coreGeo, coreMat);
coreMesh.rotation.x = -Math.PI / 2;
playerDot.add(coreMesh);

// ── Heading beam (thin tapered triangle, points forward) ────────
// Built from a custom flat triangle shape
const beamShape = new THREE.Shape();
beamShape.moveTo( 0,      0   );   // base-left
beamShape.lineTo( 0.09,   0   );   // base-right
beamShape.lineTo( 0.045,  0.7 );   // tip (forward)
beamShape.closePath();
const beamGeo = new THREE.ShapeGeometry(beamShape);
const beamMat = new THREE.MeshBasicMaterial({
  color: 0x1565c0, transparent: true, opacity: 0.85,
  depthWrite: false, side: THREE.DoubleSide,
});
const beamMesh = new THREE.Mesh(beamGeo, beamMat);
// Shape lies in XY plane; rotate to XZ and centre it on core
beamMesh.rotation.x = -Math.PI / 2;
beamMesh.position.set(-0.045, 0.002, 0);  // centre beam at origin
playerDot.add(beamMesh);

// ── Pulse animation state ───────────────────────────────────────
let pulsePhase = 0;

// ═══════════════════════════════════════════════════════════════
//  ROUTER MARKERS  — wall-mounted panel boxes (like the real device)
//  Geometry mirrors the electric-panel asset:  W × H × D  metres
//  Above/below floor routers are shown semi-transparent (ghost)
//  because they physically live outside the rendered flat.
// ═══════════════════════════════════════════════════════════════
const routerMarkers = [];   // filled after scaleFactor known (in loader)

function buildRouterMesh(r) {
  const group = new THREE.Group();
  group.userData.router = r;

  const isOtherFloor = r.floor !== 0;

  // ── Main panel body ────────────────────────────────────────
  const bodyGeo = new THREE.BoxGeometry(ROUTER_BOX.w, ROUTER_BOX.h, ROUTER_BOX.d);
  const bodyMat = new THREE.MeshStandardMaterial({
    color:       0x2a2a3a,
    roughness:   0.6,
    metalness:   0.4,
    transparent: isOtherFloor,
    opacity:     isOtherFloor ? 0.35 : 1.0,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // ── Coloured accent stripe (top edge, router brand colour) ─
  const stripeGeo = new THREE.BoxGeometry(ROUTER_BOX.w, 0.04, ROUTER_BOX.d + 0.002);
  const stripeMat = new THREE.MeshBasicMaterial({
    color:       r.color,
    transparent: isOtherFloor,
    opacity:     isOtherFloor ? 0.4 : 1.0,
  });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.y = ROUTER_BOX.h / 2 - 0.02;
  group.add(stripe);

  // ── LED indicator dot (front face, centre) ─────────────────
  const ledGeo = new THREE.SphereGeometry(0.018, 8, 6);
  const ledMat = new THREE.MeshBasicMaterial({ color: r.color });
  const led    = new THREE.Mesh(ledGeo, ledMat);
  // Front face of panel = +Z when facing into room
  led.position.set(ROUTER_BOX.w * 0.3, ROUTER_BOX.h * 0.3, ROUTER_BOX.d / 2 + 0.005);
  group.add(led);

  // LED glow ring
  const ringGeo = new THREE.RingGeometry(0.022, 0.034, 16);
  const ringMat = new THREE.MeshBasicMaterial({
    color: r.color, side: THREE.DoubleSide,
    transparent: true, opacity: 0.45,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(led.position);
  ring.position.z += 0.001;
  group.add(ring);

  // ── WiFi fan arcs (3 arcs, visible on front face) ──────────
  for (let i = 1; i <= 3; i++) {
    const arcGeo = new THREE.RingGeometry(i * 0.05, i * 0.05 + 0.008, 20, 1,
                                          -Math.PI * 0.35, Math.PI * 0.7);
    const arcMat = new THREE.MeshBasicMaterial({
      color: r.color, side: THREE.DoubleSide,
      transparent: true, opacity: 0.5 / i,
    });
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.position.set(ROUTER_BOX.w * 0.3, ROUTER_BOX.h * 0.3,
                     ROUTER_BOX.d / 2 + 0.002 + i * 0.001);
    arc.rotation.z = Math.PI / 2;  // arcs fan upward
    group.add(arc);
  }

  // ── Floor label for other-floor routers ────────────────────
  // (shown as a thin floating text box above the panel)
  if (isOtherFloor) {
    const labelGeo = new THREE.PlaneGeometry(ROUTER_BOX.w * 1.6, 0.12);
    const canvas   = document.createElement("canvas");
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#00000088";
    ctx.roundRect(0, 0, 256, 48, 8);
    ctx.fill();
    ctx.font = "bold 20px 'Segoe UI'";
    ctx.fillStyle = "#" + r.color.toString(16).padStart(6,"0");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(r.label, 128, 24);
    const tex  = new THREE.CanvasTexture(canvas);
    const lMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const lMesh = new THREE.Mesh(labelGeo, lMat);
    lMesh.position.set(0, ROUTER_BOX.h / 2 + 0.1, ROUTER_BOX.d / 2);
    lMesh.rotation.y = 0;
    group.add(lMesh);
  }

  scene.add(group);
  return group;
}

// ═══════════════════════════════════════════════════════════════
//  INPUT — KEYBOARD
// ═══════════════════════════════════════════════════════════════
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "KeyV") toggleCameraMode();   // V = toggle view
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });

// ═══════════════════════════════════════════════════════════════
//  INPUT — POINTER LOCK (FPS mouse look)
// ═══════════════════════════════════════════════════════════════
let pointerLocked = false;

renderer.domElement.addEventListener("click", () => {
  if (cameraMode === "fps" && !pointerLocked)
    renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  hintOverlay.style.display = (pointerLocked || cameraMode === "overview") ? "none" : "flex";
});

document.addEventListener("mousemove", (e) => {
  if (!pointerLocked || cameraMode !== "fps") return;
  yaw   -= e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
  pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
});

// ═══════════════════════════════════════════════════════════════
//  INPUT — TOUCH
// ═══════════════════════════════════════════════════════════════
let touchLast = null;

renderer.domElement.addEventListener("touchstart", (e) => {
  e.preventDefault();
  touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: false });

renderer.domElement.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!touchLast) return;
  if (e.touches.length === 1) {
    const dx = e.touches[0].clientX - touchLast.x;
    const dy = e.touches[0].clientY - touchLast.y;
    yaw   -= dx * TOUCH_SENS;
    pitch -= dy * TOUCH_SENS;
    pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  } else if (e.touches.length === 2) {
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const dy   = midY - touchLast.y;
    const fwd  = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    yawObj.position.addScaledVector(fwd, -dy * 0.015 * scaleFactor);
    clampPosition();
    touchLast = { x: touchLast.x, y: midY };
  }
}, { passive: false });

renderer.domElement.addEventListener("touchend",    () => { touchLast = null; });
renderer.domElement.addEventListener("touchcancel", () => { touchLast = null; });

// ═══════════════════════════════════════════════════════════════
//  CAMERA MODE TOGGLE
// ═══════════════════════════════════════════════════════════════
function toggleCameraMode() {
  if (cameraMode === "fps") {
    cameraMode   = "overview";
    activeCamera = ovCam;
    if (pointerLocked) document.exitPointerLock();
    hintOverlay.style.display = "none";
    legend.textContent = "Overview Mode  |  Click map to teleport  |  V = FPS view";
  } else {
    cameraMode   = "fps";
    activeCamera = fpsCam;
    hintOverlay.style.display = pointerLocked ? "none" : "flex";
    legend.textContent = "WASD · move   |   Mouse · look   |   Esc · unlock   |   V · overview";
  }
}

// ═══════════════════════════════════════════════════════════════
//  MINIMAP  (2D canvas overlay, bottom-right)
// ═══════════════════════════════════════════════════════════════
const MM_W  = 200;
const MM_H  = 200;
const mmCanvas = document.createElement("canvas");
mmCanvas.width  = MM_W;
mmCanvas.height = MM_H;
mmCanvas.style.cssText = `
  position:fixed; bottom:20px; right:20px;
  width:${MM_W}px; height:${MM_H}px;
  border-radius:10px; border:1px solid rgba(255,255,255,0.2);
  background:rgba(0,0,0,0.6); z-index:50; cursor:crosshair;
`;
document.body.appendChild(mmCanvas);
const mmCtx = mmCanvas.getContext("2d");

// Flat extents for minimap projection
const FL_W = FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX;  // 13
const FL_H = FLAT_BOUNDS.maxZ - FLAT_BOUNDS.minZ;  // 25.5
const MM_PAD = 10;

function flatToMM(fx, fz) {
  const px = MM_PAD + ((fx - FLAT_BOUNDS.minX) / FL_W) * (MM_W - MM_PAD * 2);
  const py = MM_PAD + ((fz - FLAT_BOUNDS.minZ) / FL_H) * (MM_H - MM_PAD * 2);
  return { px, py };
}

function mmToFlat(px, py) {
  const fx = FLAT_BOUNDS.minX + ((px - MM_PAD) / (MM_W - MM_PAD * 2)) * FL_W;
  const fz = FLAT_BOUNDS.minZ + ((py - MM_PAD) / (MM_H - MM_PAD * 2)) * FL_H;
  return { fx, fz };
}

function drawMinimap() {
  mmCtx.clearRect(0, 0, MM_W, MM_H);

  // Background
  mmCtx.fillStyle = "rgba(10,14,26,0.92)";
  mmCtx.roundRect(0, 0, MM_W, MM_H, 10);
  mmCtx.fill();

  // Room polygons
  const ROOM_COLORS = {
    "Room": "#1a3a5c", "Hall": "#1a3c20", "Kitchen": "#3a2a10",
    "Main Entrance": "#2a1a3c", "Corridor": "#2a2a2a",
  };
  for (const room of ROOMS) {
    const col = ROOM_COLORS[room.name] || "#222";
    mmCtx.beginPath();
    room.polygon.forEach(([x,z], i) => {
      const { px, py } = flatToMM(x, z);
      i === 0 ? mmCtx.moveTo(px, py) : mmCtx.lineTo(px, py);
    });
    mmCtx.closePath();
    mmCtx.fillStyle = col;
    mmCtx.fill();
    mmCtx.strokeStyle = "rgba(255,255,255,0.15)";
    mmCtx.lineWidth = 1;
    mmCtx.stroke();
  }

  // Room name labels
  mmCtx.font = "bold 7px 'Segoe UI'";
  mmCtx.textAlign = "center";
  mmCtx.textBaseline = "middle";
  for (const room of ROOMS) {
    const c = polyCenter2D(room.polygon);
    const { px, py } = flatToMM(c.x, c.z);
    mmCtx.fillStyle = "rgba(255,220,120,0.8)";
    mmCtx.fillText(room.name.toUpperCase(), px, py);
  }

  // Router markers
  for (const r of ROUTERS) {
    const { px, py } = flatToMM(r.pos.x, r.pos.z);
    mmCtx.beginPath();
    mmCtx.arc(px, py, 5, 0, Math.PI * 2);
    mmCtx.fillStyle = "#" + r.color.toString(16).padStart(6,"0");
    mmCtx.fill();
    mmCtx.strokeStyle = "rgba(255,255,255,0.5)";
    mmCtx.lineWidth = 1;
    mmCtx.stroke();
    // Wifi range circle
    mmCtx.beginPath();
    const rangePx = (8 / FL_W) * (MM_W - MM_PAD * 2);
    mmCtx.arc(px, py, rangePx, 0, Math.PI * 2);
    mmCtx.strokeStyle = "#" + r.color.toString(16).padStart(6,"0") + "33";
    mmCtx.lineWidth = 1;
    mmCtx.stroke();
  }

  // Door markers
  for (const d of DOOR_LABELS) {
    const { px, py } = flatToMM(d.x, d.z);
    mmCtx.fillStyle = "rgba(100,160,255,0.9)";
    mmCtx.fillRect(px - 3, py - 3, 6, 6);
  }

  // Accuracy circle (uncertainty radius)
  if (positioning.accuracy > 0) {
    const { px, py } = flatToMM(playerPos.x, playerPos.y);
    const accPx = (positioning.accuracy / FL_W) * (MM_W - MM_PAD * 2);
    mmCtx.beginPath();
    mmCtx.arc(px, py, accPx, 0, Math.PI * 2);
    mmCtx.strokeStyle = "rgba(0,200,255,0.25)";
    mmCtx.lineWidth = 2;
    mmCtx.stroke();
  }

  // Player dot + heading arrow
  const { px: ppx, py: ppy } = flatToMM(playerPos.x, playerPos.y);
  mmCtx.beginPath();
  mmCtx.arc(ppx, ppy, 5, 0, Math.PI * 2);
  mmCtx.fillStyle = "#00ccff";
  mmCtx.fill();
  mmCtx.strokeStyle = "#fff";
  mmCtx.lineWidth = 1.5;
  mmCtx.stroke();

  // Heading arrow
  const hx = ppx + Math.sin(yaw) * 10;
  const hy = ppy - Math.cos(yaw) * 10;
  mmCtx.beginPath();
  mmCtx.moveTo(ppx, ppy);
  mmCtx.lineTo(hx, hy);
  mmCtx.strokeStyle = "#fff";
  mmCtx.lineWidth = 2;
  mmCtx.stroke();

  // Label
  mmCtx.font = "9px 'Segoe UI'";
  mmCtx.fillStyle = "rgba(255,255,255,0.5)";
  mmCtx.textAlign = "left";
  mmCtx.textBaseline = "bottom";
  mmCtx.fillText("MAP", MM_PAD, MM_H - 4);
  mmCtx.textAlign = "right";
  mmCtx.fillText(positioning.source, MM_W - MM_PAD, MM_H - 4);
}

// Minimap click → teleport player
mmCanvas.addEventListener("click", (e) => {
  const rect = mmCanvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (MM_W / rect.width);
  const py = (e.clientY - rect.top)  * (MM_H / rect.height);
  const { fx, fz } = mmToFlat(px, py);
  if (fx >= FLAT_BOUNDS.minX && fx <= FLAT_BOUNDS.maxX &&
      fz >= FLAT_BOUNDS.minZ && fz <= FLAT_BOUNDS.maxZ) {
    playerPos.set(fx, fz);
    syncPlayerToScene();
  }
});

// ═══════════════════════════════════════════════════════════════
//  STATUS PANEL  (top-right)
// ═══════════════════════════════════════════════════════════════
const statusPanel = document.createElement("div");
statusPanel.style.cssText = `
  position:fixed; top:16px; right:16px;
  background:rgba(0,0,0,0.72); color:#fff;
  padding:10px 14px; border-radius:10px;
  font-family:'Segoe UI',monospace; font-size:11px;
  z-index:50; pointer-events:none; line-height:1.7;
  border:1px solid rgba(255,255,255,0.1); min-width:180px;
`;
document.body.appendChild(statusPanel);

function updateStatusPanel() {
  const p = positioning;
  statusPanel.innerHTML = `
    <div style="font-weight:700; font-size:12px; margin-bottom:4px; color:#7dd3fc">📡 Positioning</div>
    <div>Mode: <span style="color:#a3e635">${p.source}</span></div>
    <div>X: <span style="color:#fde68a">${playerPos.x.toFixed(2)} m</span></div>
    <div>Z: <span style="color:#fde68a">${playerPos.y.toFixed(2)} m</span></div>
    <div>Accuracy: <span style="color:#f87171">±${p.accuracy.toFixed(1)} m</span></div>
    <hr style="border-color:rgba(255,255,255,0.1); margin:4px 0">
    <div style="color:#94a3b8; font-size:10px">
      ${ROUTERS.map(r =>
        `<div>${r.label}: <span style="color:#${r.color.toString(16).padStart(6,'0')}">${
          p.rssi[r.id] !== undefined ? p.rssi[r.id].toFixed(0)+" dBm" : "---"
        }</span></div>`
      ).join("")}
    </div>
    <hr style="border-color:rgba(255,255,255,0.1); margin:4px 0">
    <div style="color:#64748b; font-size:9px">
      Steps: ${p.steps} | Heading: ${(p.heading * 180/Math.PI).toFixed(0)}°
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
//  HUD — hint overlay + legend
// ═══════════════════════════════════════════════════════════════
const hintOverlay = document.createElement("div");
hintOverlay.style.cssText = `
  position:fixed; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; z-index:30; pointer-events:none;
`;
hintOverlay.innerHTML = `
  <div style="
    background:rgba(0,0,0,0.82); color:#fff;
    padding:28px 40px; border-radius:16px; text-align:center;
    font-family:'Segoe UI',sans-serif;
    border:1px solid rgba(255,255,255,0.12);
    backdrop-filter:blur(12px); max-width:360px;
  ">
    <div style="font-size:36px; margin-bottom:10px">🏠</div>
    <div style="font-size:20px; font-weight:700; margin-bottom:6px">Click to explore</div>
    <div style="font-size:12px; opacity:0.55; margin-bottom:16px">
      Click the view to capture your mouse
    </div>
    <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 16px; font-size:12px; text-align:left;">
      <span style="opacity:0.5">W A S D</span><span>Walk</span>
      <span style="opacity:0.5">Mouse</span><span>Look around</span>
      <span style="opacity:0.5">V</span><span>Toggle overview / FPS</span>
      <span style="opacity:0.5">Esc</span><span>Release mouse</span>
      <span style="opacity:0.5">Map click</span><span>Teleport</span>
    </div>
    <div style="margin-top:12px; font-size:10px; opacity:0.35;">
      📱 Android: WiFi trilateration + dead reckoning active when available
    </div>
  </div>
`;
document.body.appendChild(hintOverlay);

const legend = document.createElement("div");
legend.style.cssText = `
  position:fixed; bottom:14px; left:50%; transform:translateX(-50%);
  background:rgba(0,0,0,0.5); color:rgba(255,255,255,0.55);
  padding:5px 18px; border-radius:20px;
  font-family:'Segoe UI',sans-serif; font-size:11px;
  z-index:20; pointer-events:none; letter-spacing:0.04em;
`;
legend.textContent = "WASD · move   |   Mouse · look   |   Esc · unlock   |   V · overview";
document.body.appendChild(legend);

// View toggle button (for touch/mobile)
const viewBtn = document.createElement("button");
viewBtn.textContent = "⬆ Overview";
viewBtn.style.cssText = `
  position:fixed; top:16px; left:16px; z-index:50;
  background:rgba(0,0,0,0.65); color:#fff;
  border:1px solid rgba(255,255,255,0.2); border-radius:8px;
  padding:7px 14px; font-size:13px; cursor:pointer;
  font-family:'Segoe UI',sans-serif; backdrop-filter:blur(6px);
`;
viewBtn.addEventListener("click", toggleCameraMode);
document.body.appendChild(viewBtn);

const info = document.getElementById("info") || (() => {
  const d = document.createElement("div");
  d.id = "info";
  d.style.cssText = `
    position:fixed; top:16px; left:50%; transform:translateX(-50%);
    background:rgba(0,0,0,0.7); color:#fff;
    padding:8px 20px; border-radius:8px;
    font-family:'Segoe UI',sans-serif; font-size:14px;
    z-index:40; pointer-events:none; transition:opacity 0.5s;
  `;
  document.body.appendChild(d);
  return d;
})();

// ═══════════════════════════════════════════════════════════════
//  ROOM LABELS  (3D projected HTML)
// ═══════════════════════════════════════════════════════════════
const labelContainer = document.createElement("div");
labelContainer.style.cssText = `
  position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:10;
`;
document.body.appendChild(labelContainer);
const labelObjects = [];

function polyCenter2D(poly) {
  let sx = 0, sz = 0;
  for (const [x,z] of poly) { sx+=x; sz+=z; }
  return { x: sx/poly.length, z: sz/poly.length };
}

function makeLabelEl(text, isRoom) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position:absolute; transform:translate(-50%,-50%);
    background:${isRoom ? "rgba(0,0,0,0.65)" : "rgba(10,60,160,0.75)"};
    color:${isRoom ? "#ffe099" : "#a8d0ff"};
    font-family:'Segoe UI',sans-serif;
    font-size:${isRoom ? "13px" : "11px"};
    font-weight:${isRoom ? "700" : "500"};
    letter-spacing:0.06em; padding:${isRoom ? "5px 11px" : "3px 9px"};
    border-radius:7px;
    border:1px solid ${isRoom ? "rgba(255,210,100,0.35)" : "rgba(80,140,255,0.35)"};
    white-space:nowrap; backdrop-filter:blur(5px);
    text-transform:uppercase; opacity:0; transition:opacity 0.15s;
  `;
  labelContainer.appendChild(el);
  return el;
}

function initLabels(sf) {
  for (const room of ROOMS) {
    const c = polyCenter2D(room.polygon);
    labelObjects.push({
      el: makeLabelEl(room.name, true),
      worldPos: new THREE.Vector3(c.x * sf, EYE_HEIGHT * sf * 0.4, c.z * sf),
    });
  }
  for (const d of DOOR_LABELS) {
    labelObjects.push({
      el: makeLabelEl(d.name, false),
      worldPos: new THREE.Vector3(d.x * sf, EYE_HEIGHT * sf * 0.9, d.z * sf),
    });
  }
}

const _proj    = new THREE.Vector3();
const _camWPos = new THREE.Vector3();
function updateLabels() {
  // Only show labels in FPS mode (overview has its own minimap labels)
  const show = cameraMode === "fps";
  const W = renderer.domElement.clientWidth;
  const H = renderer.domElement.clientHeight;
  activeCamera.getWorldPosition(_camWPos);
  for (const { el, worldPos } of labelObjects) {
    if (!show) { el.style.opacity = "0"; continue; }
    _proj.copy(worldPos).project(activeCamera);
    if (_proj.z > 1) { el.style.opacity = "0"; continue; }
    const dist = worldPos.distanceTo(_camWPos);
    const fade = Math.max(0, Math.min(1, 1 - (dist - 1) / 35));
    el.style.left    = (( _proj.x * 0.5 + 0.5) * W) + "px";
    el.style.top     = ((-_proj.y * 0.5 + 0.5) * H) + "px";
    el.style.opacity = fade.toString();
  }
}

// ═══════════════════════════════════════════════════════════════
//  LOAD MODEL
// ═══════════════════════════════════════════════════════════════
const loader = new GLTFLoader();

loader.load(
  "./model.glb",
  (gltf) => {
    const model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    scene.add(model);

    const sz = box.getSize(new THREE.Vector3());
    scaleFactor = (FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX) / sz.x;
    model.scale.setScalar(scaleFactor);

    // Re-centre after scale
    const box2    = new THREE.Box3().setFromObject(model);
    const center2 = box2.getCenter(new THREE.Vector3());
    model.position.sub(center2);

    const inset = 0.25 * scaleFactor;
    eyeY = EYE_HEIGHT * scaleFactor;
    bounds = {
      minX: FLAT_BOUNDS.minX * scaleFactor + inset,
      maxX: FLAT_BOUNDS.maxX * scaleFactor - inset,
      minZ: FLAT_BOUNDS.minZ * scaleFactor + inset,
      maxZ: FLAT_BOUNDS.maxZ * scaleFactor - inset,
    };

    // Build and position router panel meshes now that scaleFactor is known
    for (const r of ROUTERS) {
      const mesh = buildRouterMesh(r);
      routerMarkers.push(mesh);

      // Scale the panel geometry itself to match world scale
      mesh.scale.setScalar(scaleFactor);

      // Position: router.pos is in layout metres (already includes wall depth offset)
      mesh.position.set(
        r.pos.x * scaleFactor,
        r.pos.y * scaleFactor,   // exact Y from JSON (1.5 m = panel centre)
        r.pos.z * scaleFactor
      );

      // Rotate so panel face aligns with wall normal
      // wallNorm = (0,0,1) means panel already faces +Z — no extra rotation needed
      // If you add routers on other walls, adjust rotation here:
      //   +X wall: mesh.rotation.y = -Math.PI/2
      //   -X wall: mesh.rotation.y =  Math.PI/2
      //   -Z wall: mesh.rotation.y =  Math.PI
    }

    // Size overview camera to see entire flat
    const flatW = (FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX) * scaleFactor;
    const flatH = (FLAT_BOUNDS.maxZ - FLAT_BOUNDS.minZ) * scaleFactor;
    const aspect = window.innerWidth / window.innerHeight;
    const halfH  = Math.max(flatW / aspect, flatH) / 2 * 1.15;
    ovCam.left   = -halfH * aspect;
    ovCam.right  =  halfH * aspect;
    ovCam.top    =  halfH;
    ovCam.bottom = -halfH;
    ovCam.position.set(0, flatW * 2, 0);
    ovCam.lookAt(0, 0, 0);
    ovCam.updateProjectionMatrix();

    // FPS spawn
    yawObj.position.set(SPAWN.x * scaleFactor, eyeY, SPAWN.z * scaleFactor);
    playerPos.set(SPAWN.x, SPAWN.z);
    yaw = SPAWN.yaw;

    initLabels(scaleFactor);

    // Start positioning systems
    initDeadReckoning();
    initWifiPositioning();

    info.innerHTML = "🏠 Click to explore  ·  V for overview";
    setTimeout(() => { info.style.opacity = "0"; }, 4000);
    setTimeout(() => { info.style.display = "none"; }, 4700);
  },
  (xhr) => {
    const pct = xhr.total ? (xhr.loaded / xhr.total * 100).toFixed(1) : "?";
    info.innerHTML = `⏳ Loading… ${pct}%`;
  },
  (err) => { info.innerHTML = "❌ Failed to load model"; console.error(err); }
);

// ═══════════════════════════════════════════════════════════════
//  POSITIONING ENGINE
// ═══════════════════════════════════════════════════════════════

const positioning = {
  source:   "WASD",
  accuracy: 0,
  rssi:     {},       // { routerId: dBm }
  steps:    0,
  heading:  0,        // radians, from gyro
};

// ── Kalman filter state for XZ position ─────────────────────
// Simple 2-state (x,z) scalar Kalman
const kalman = {
  x:    SPAWN.x,
  z:    SPAWN.z,
  covX: 5.0,   // initial uncertainty variance
  covZ: 5.0,
  // Process noise (how much we trust dead reckoning per second)
  Q: 0.5,
  // Measurement noise (how much we trust WiFi trilateration)
  R_wifi: 2.0,   // metres² — WiFi is noisy
  R_dr:   0.3,   // metres² — dead reckoning is smoother
};

function kalmanPredict(dx, dz, dt) {
  kalman.x    += dx;
  kalman.z    += dz;
  kalman.covX += kalman.Q * dt;
  kalman.covZ += kalman.Q * dt;
}

function kalmanUpdate(measX, measZ, R) {
  // X
  const Kx     = kalman.covX / (kalman.covX + R);
  kalman.x    += Kx * (measX - kalman.x);
  kalman.covX  = (1 - Kx) * kalman.covX;
  // Z
  const Kz     = kalman.covZ / (kalman.covZ + R);
  kalman.z    += Kz * (measZ - kalman.z);
  kalman.covZ  = (1 - Kz) * kalman.covZ;

  playerPos.set(kalman.x, kalman.z);
  syncPlayerToScene();
}

// ── WiFi Trilateration ───────────────────────────────────────
// RSSI → distance using log-distance path-loss model:
//   d = 10 ^ ((TxPower - RSSI) / (10 * n))
function rssiToDistance(rssi, router) {
  return Math.pow(10, (router.txPower - rssi) / (10 * router.pathLoss));
}

// Weighted least-squares trilateration (2D, ignoring y)
// Given 3 circles (centre + radius), find intersection in XZ plane
function trilaterate(measurements) {
  // measurements: [{ router, dist }]
  // Use weighted least squares: minimise sum of (dist_i - ||p - r_i||)^2
  // Simple iterative gradient descent for robustness
  let px = kalman.x, pz = kalman.z;
  for (let iter = 0; iter < 50; iter++) {
    let gradX = 0, gradZ = 0, totalW = 0;
    for (const { router, dist } of measurements) {
      const dx   = px - router.pos.x;
      const dz   = pz - router.pos.z;
      const d3d  = Math.sqrt(dx*dx + dz*dz + router.pos.y*router.pos.y);
      if (d3d < 0.01) continue;
      const err  = d3d - dist;
      const w    = 1 / (dist * dist);  // weight inversely by distance² (farther = less reliable)
      gradX     += w * err * (dx / d3d);
      gradZ     += w * err * (dz / d3d);
      totalW    += w;
    }
    if (totalW < 0.001) break;
    px -= 0.3 * gradX / totalW;
    pz -= 0.3 * gradZ / totalW;
  }
  return { x: px, z: pz };
}

// ── WiFi scan (Android Web API) ──────────────────────────────
let wifiAvailable = false;

function initWifiPositioning() {
  // navigator.wifi is not standard — we use a custom approach:
  // On Android Chrome, we can't directly scan WiFi from a webpage.
  // SOLUTION: The user runs a tiny companion local server on their phone
  // (Node.js script below), which exposes a local REST endpoint.
  // The page polls it every 3 seconds.
  // For testing without the server, we simulate RSSI.
  pollWifiServer();
}

let wifiPollInterval = null;

function pollWifiServer() {
  // Try to reach local companion server at localhost:8765
  // The server responds with: { networks: [{ bssid, ssid, rssi }] }
  wifiPollInterval = setInterval(async () => {
    try {
      const res  = await fetch("http://localhost:8765/wifi", { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      processWifiScan(data.networks || []);
      wifiAvailable = true;
    } catch {
      // Server not running — fall back to simulation in dev mode
      if (DEV_SIMULATE_WIFI) simulateWifi();
    }
  }, 2500);
}

// DEV MODE: simulate WiFi RSSI based on WASD position
const DEV_SIMULATE_WIFI = true;

function simulateWifi() {
  const measurements = [];
  for (const router of ROUTERS) {
    const dx   = playerPos.x - router.pos.x;
    const dz   = playerPos.y - router.pos.z;
    const dy   = -router.pos.y;  // user is at y=0
    const dist = Math.sqrt(dx*dx + dz*dz + dy*dy);
    // Simulate RSSI with some noise
    const rssi = router.txPower - 10 * router.pathLoss * Math.log10(Math.max(dist, 0.5))
                 + (Math.random() - 0.5) * 6;  // ±3 dBm noise
    positioning.rssi[router.id] = rssi;
    measurements.push({ router, dist: rssiToDistance(rssi, router) });
  }
  processTrilateration(measurements);
  positioning.source   = "WiFi-SIM";
  positioning.accuracy = 1.5;
}

function processWifiScan(networks) {
  const measurements = [];
  for (const router of ROUTERS) {
    const found = networks.find(n => n.bssid?.toUpperCase() === router.bssid.toUpperCase());
    if (!found) continue;
    positioning.rssi[router.id] = found.rssi;
    measurements.push({ router, dist: rssiToDistance(found.rssi, router) });
  }
  if (measurements.length >= 2) {
    processTrilateration(measurements);
    positioning.source   = `WiFi(${measurements.length})`;
    positioning.accuracy = measurements.length >= 3 ? 1.5 : 3.0;
  }
}

function processTrilateration(measurements) {
  if (measurements.length < 2) return;
  const { x, z } = trilaterate(measurements);
  // Clamp to flat bounds
  const cx = Math.max(FLAT_BOUNDS.minX, Math.min(FLAT_BOUNDS.maxX, x));
  const cz = Math.max(FLAT_BOUNDS.minZ, Math.min(FLAT_BOUNDS.maxZ, z));
  kalmanUpdate(cx, cz, kalman.R_wifi);
}

// ── Dead Reckoning (Accelerometer + Gyroscope) ───────────────
let drActive = false;
let lastAccelTime = 0;
let stepThreshold = 1.2;  // m/s² peak to detect a step
let accelBuf = [];

// Step length model: average human ~0.65 m/step
const STEP_LEN = 0.65;

function initDeadReckoning() {
  if (typeof DeviceMotionEvent === "undefined") return;

  // iOS 13+ requires permission
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    DeviceMotionEvent.requestPermission()
      .then(state => { if (state === "granted") listenMotion(); })
      .catch(() => {});
  } else {
    listenMotion();
  }

  if (typeof DeviceOrientationEvent !== "undefined") {
    window.addEventListener("deviceorientation", (e) => {
      if (e.alpha !== null) {
        // Convert compass heading (degrees from north) to radians
        // alpha = compass bearing, but we need it relative to flat
        positioning.heading = (e.alpha * Math.PI / 180);
      }
    });
  }
}

function listenMotion() {
  drActive = true;
  window.addEventListener("devicemotion", (e) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    const mag = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
    const now = Date.now();
    const dt  = (now - lastAccelTime) / 1000;
    lastAccelTime = now;

    accelBuf.push(mag);
    if (accelBuf.length > 5) accelBuf.shift();

    // Peak detection: step when magnitude crosses threshold
    const avg = accelBuf.reduce((a,b) => a+b, 0) / accelBuf.length;
    if (mag > avg + stepThreshold && dt > 0.25) {
      // Step detected!
      positioning.steps++;
      const h = positioning.heading || yaw;
      const dx = Math.sin(h) * STEP_LEN;
      const dz = -Math.cos(h) * STEP_LEN;  // note: layout Z is inverted

      // Predict step in Kalman filter
      kalmanPredict(dx, dz, dt);

      // Clamp
      kalman.x = Math.max(FLAT_BOUNDS.minX, Math.min(FLAT_BOUNDS.maxX, kalman.x));
      kalman.z = Math.max(FLAT_BOUNDS.minZ, Math.min(FLAT_BOUNDS.maxZ, kalman.z));
      playerPos.set(kalman.x, kalman.z);
      syncPlayerToScene();
      positioning.source   = "DeadReck";
      positioning.accuracy = Math.min(3 + positioning.steps * 0.1, 8);
    }
  });
}

// ── Sync playerPos → yawObj (FPS) and dot (3D) ──────────────
function syncPlayerToScene() {
  if (!bounds) return;
  const sx = playerPos.x * scaleFactor;
  const sz = playerPos.y * scaleFactor;
  yawObj.position.set(sx, eyeY, sz);
  // playerDot position + rotation is driven every frame in animate(); no need to set here
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function clampPosition() {
  if (!bounds) return;
  yawObj.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, yawObj.position.x));
  yawObj.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, yawObj.position.z));
  yawObj.position.y = eyeY;
  // Push back to playerPos so minimap stays in sync
  playerPos.set(yawObj.position.x / scaleFactor, yawObj.position.z / scaleFactor);
  kalman.x = playerPos.x;
  kalman.z = playerPos.y;
}

window.addEventListener("resize", () => {
  fpsCam.aspect = window.innerWidth / window.innerHeight;
  fpsCam.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ═══════════════════════════════════════════════════════════════
//  ANIMATION LOOP
// ═══════════════════════════════════════════════════════════════
const clock    = new THREE.Clock();
const vel      = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _wish    = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Apply look angles
  yawObj.rotation.y   = yaw;
  pitchObj.rotation.x = pitch;

  if (bounds && cameraMode === "fps") {
    // ── WASD movement ──────────────────────────────────────
    const mf = (keys["KeyW"] || keys["ArrowUp"])    ? 1 : 0;
    const mb = (keys["KeyS"] || keys["ArrowDown"])  ? 1 : 0;
    const ml = (keys["KeyA"] || keys["ArrowLeft"])  ? 1 : 0;
    const mr = (keys["KeyD"] || keys["ArrowRight"]) ? 1 : 0;

    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(   Math.cos(yaw), 0, -Math.sin(yaw));

    _wish.set(0,0,0)
      .addScaledVector(_forward, mf - mb)
      .addScaledVector(_right,   mr - ml);

    const moving = _wish.lengthSq() > 0;
    if (moving) _wish.normalize();

    const maxSpd = MAX_SPD * scaleFactor;
    if (moving) {
      vel.addScaledVector(_wish, ACCEL * scaleFactor * dt);
      if (vel.length() > maxSpd) vel.setLength(maxSpd);
      positioning.source = drActive || wifiAvailable ? positioning.source : "WASD";
    } else {
      const loss = FRICTION * scaleFactor * dt;
      const cur  = vel.length();
      if (cur > loss) vel.setLength(cur - loss);
      else vel.set(0, 0, 0);
    }

    yawObj.position.addScaledVector(vel, dt);
    clampPosition();

    // WASD also feeds Kalman so WiFi stays in sync with manual movement
    if (moving) {
      const dx = vel.x * dt / scaleFactor;
      const dz = vel.z * dt / scaleFactor;
      kalmanPredict(dx, dz, dt);
    }
  }

  // ── Player dot — position, heading, pulse animation ─────────
  playerDot.position.set(
    yawObj.position.x,
    0.012 * scaleFactor,   // just above floor, flat on ground
    yawObj.position.z
  );
  playerDot.rotation.y = yaw;

  // Scale everything by scaleFactor so marker stays proportional
  playerDot.scale.setScalar(scaleFactor);

  // Pulse: outer ring breathes in/out, halo fades
  pulsePhase += dt * 1.8;   // ~1.8 rad/s → ~0.28 Hz cycle
  const pulse  = 0.5 + 0.5 * Math.sin(pulsePhase);          // 0..1
  const pulse2 = 0.5 + 0.5 * Math.sin(pulsePhase * 0.6);    // slower second wave

  // Outer ring: scale up and fade out like a sonar ping
  const pingScale = 1.0 + pulse * 0.55;
  pulseMesh.scale.setScalar(pingScale);
  pulseMat.opacity = 0.6 * (1 - pulse * 0.7);

  // Halo breathes gently
  haloMat.opacity  = 0.06 + 0.07 * pulse2;

  // Core brightens slightly on each pulse peak
  coreMat.color.setHSL(0.58, 1.0, 0.32 + pulse * 0.12);

  // ── Overview camera follows player horizontally ─────────
  if (cameraMode === "overview") {
    ovCam.position.x = yawObj.position.x;
    ovCam.position.z = yawObj.position.z;
    ovCam.lookAt(yawObj.position.x, 0, yawObj.position.z);
  }

  updateLabels();
  drawMinimap();
  updateStatusPanel();
  renderer.render(scene, activeCamera);
}

animate();

// ═══════════════════════════════════════════════════════════════
//  COMPANION SERVER INSTRUCTIONS  (logged once to console)
// ═══════════════════════════════════════════════════════════════
console.log(`
%c📡 WiFi Trilateration Companion Server
%cTo enable real WiFi positioning on Android, run this on your phone:

1. Install Node.js (Termux on Android): 
   pkg install nodejs

2. Save this as wifi-server.js and run: node wifi-server.js

─── wifi-server.js ─────────────────────────────────────────────
const http = require('http');
const { execSync } = require('child_process');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/wifi') {
    try {
      // Termux: requires termux-api package
      // pkg install termux-api
      const raw = execSync('termux-wifi-scaninfo', { timeout: 5000 }).toString();
      const networks = JSON.parse(raw).map(n => ({
        bssid: n.bssid,
        ssid:  n.ssid,
        rssi:  n.level
      }));
      res.end(JSON.stringify({ networks }));
    } catch(e) {
      res.end(JSON.stringify({ networks: [], error: e.message }));
    }
  }
}).listen(8765, '0.0.0.0', () => {
  console.log('WiFi server running at http://localhost:8765');
});
────────────────────────────────────────────────────────────────

3. Open your 3D map on the same device or same local network,
   pointing fetch() to http://YOUR_PHONE_IP:8765/wifi

4. Update ROUTERS[].bssid with your actual router MAC addresses
   (visible in Android Settings → WiFi → router info)

Current mode: %cDEV_SIMULATE_WIFI=true (simulated RSSI based on position)
`,
  "color:#00ccff; font-weight:bold; font-size:14px",
  "color:#94a3b8; font-size:11px",
  "color:#a3e635; font-size:11px"
);