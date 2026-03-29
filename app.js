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
// ───────────────────────────────────────────────────────────────
const ROUTER_BOX = { w: 0.305, h: 0.740, d: 0.210 };

const ROUTERS = [
  {
    id:       "yours",
    label:    "Your Router",
    bssid:    "AA:BB:CC:DD:EE:01",
    pos:      new THREE.Vector3(-3.5, 1.5, -2.5 + ROUTER_BOX.d / 2),
    wallNorm: new THREE.Vector3(0, 0, 1),
    txPower:  -45,
    pathLoss: 2.8,
    color:    0x00e5a0,
    floor:    0,
  },
  {
    id:       "above",
    label:    "Above Floor",
    bssid:    "AA:BB:CC:DD:EE:02",
    pos:      new THREE.Vector3(-3.5, 1.5 + 3.0, -2.5 + ROUTER_BOX.d / 2),
    wallNorm: new THREE.Vector3(0, 0, 1),
    txPower:  -48,
    pathLoss: 3.2,
    color:    0xff6644,
    floor:    1,
  },
  {
    id:       "below",
    label:    "Below Floor",
    bssid:    "AA:BB:CC:DD:EE:03",
    pos:      new THREE.Vector3(-3.5, 1.5 - 3.0, -2.5 + ROUTER_BOX.d / 2),
    wallNorm: new THREE.Vector3(0, 0, 1),
    txPower:  -48,
    pathLoss: 3.2,
    color:    0x00c8ff,
    floor:    -1,
  },
];

// ───────────────────────────────────────────────────────────────
//  SPAWN & CONSTANTS
// ───────────────────────────────────────────────────────────────
const SPAWN      = { x: 3.5, z: -13, yaw: Math.PI };
const EYE_HEIGHT = 0.6;
const FLOOR_Y    = 0;

const ACCEL    = 18;
const FRICTION = 12;
const MAX_SPD  = 6;

const MOUSE_SENS = 0.0018;
const TOUCH_SENS = 0.004;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

// ═══════════════════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080c10);
scene.fog = new THREE.FogExp2(0x080c10, 0.018);

// ── FPS rig ──────────────────────────────────────────────────
const yawObj   = new THREE.Object3D();
const pitchObj = new THREE.Object3D();
const fpsCam   = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.02, 500);
yawObj.add(pitchObj);
pitchObj.add(fpsCam);
scene.add(yawObj);

// ── Overview camera ──────────────────────────────────────────
const ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
ovCam.position.set(0, 60, 0);
ovCam.lookAt(0, 0, 0);
scene.add(ovCam);

let activeCamera = fpsCam;
let cameraMode   = "fps";

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
//  PLAYER POSITION STATE
// ═══════════════════════════════════════════════════════════════
const playerPos = new THREE.Vector2(SPAWN.x, SPAWN.z);

// ═══════════════════════════════════════════════════════════════
//  PLAYER MARKER
// ═══════════════════════════════════════════════════════════════
const playerDot = new THREE.Group();
playerDot.renderOrder = 999;
scene.add(playerDot);

const haloGeo  = new THREE.CircleGeometry(1.2, 48);
const haloMat  = new THREE.MeshBasicMaterial({ color: 0x2196f3, transparent: true, opacity: 0.10, depthWrite: false, side: THREE.DoubleSide });
const haloMesh = new THREE.Mesh(haloGeo, haloMat);
haloMesh.rotation.x = -Math.PI / 2;
playerDot.add(haloMesh);

const pulseGeo  = new THREE.RingGeometry(0.38, 0.48, 48);
const pulseMat  = new THREE.MeshBasicMaterial({ color: 0x00c8ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
pulseMesh.rotation.x = -Math.PI / 2;
playerDot.add(pulseMesh);

const borderGeo  = new THREE.RingGeometry(0.22, 0.33, 48);
const borderMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
const borderMesh = new THREE.Mesh(borderGeo, borderMat);
borderMesh.rotation.x = -Math.PI / 2;
playerDot.add(borderMesh);

const coreGeo  = new THREE.CircleGeometry(0.22, 48);
const coreMat  = new THREE.MeshBasicMaterial({ color: 0x0055cc, transparent: true, opacity: 1.0, depthWrite: false, side: THREE.DoubleSide });
const coreMesh = new THREE.Mesh(coreGeo, coreMat);
coreMesh.rotation.x = -Math.PI / 2;
playerDot.add(coreMesh);

const beamShape = new THREE.Shape();
beamShape.moveTo( 0, 0); beamShape.lineTo(0.09, 0); beamShape.lineTo(0.045, 0.7); beamShape.closePath();
const beamGeo  = new THREE.ShapeGeometry(beamShape);
const beamMat  = new THREE.MeshBasicMaterial({ color: 0x0055cc, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const beamMesh = new THREE.Mesh(beamGeo, beamMat);
beamMesh.rotation.x = -Math.PI / 2;
beamMesh.position.set(-0.045, 0.002, 0);
playerDot.add(beamMesh);

let pulsePhase = 0;

// ═══════════════════════════════════════════════════════════════
//  ROUTER MARKERS
// ═══════════════════════════════════════════════════════════════
const routerMarkers = [];

function buildRouterMesh(r) {
  const group = new THREE.Group();
  group.userData.router = r;
  const isOtherFloor = r.floor !== 0;

  const bodyGeo = new THREE.BoxGeometry(ROUTER_BOX.w, ROUTER_BOX.h, ROUTER_BOX.d);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.6, metalness: 0.5, transparent: isOtherFloor, opacity: isOtherFloor ? 0.35 : 1.0 });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  const stripeGeo = new THREE.BoxGeometry(ROUTER_BOX.w, 0.04, ROUTER_BOX.d + 0.002);
  const stripeMat = new THREE.MeshBasicMaterial({ color: r.color, transparent: isOtherFloor, opacity: isOtherFloor ? 0.4 : 1.0 });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.y = ROUTER_BOX.h / 2 - 0.02;
  group.add(stripe);

  const ledGeo = new THREE.SphereGeometry(0.018, 8, 6);
  const ledMat = new THREE.MeshBasicMaterial({ color: r.color });
  const led    = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(ROUTER_BOX.w * 0.3, ROUTER_BOX.h * 0.3, ROUTER_BOX.d / 2 + 0.005);
  group.add(led);

  const ringGeo = new THREE.RingGeometry(0.022, 0.034, 16);
  const ringMat = new THREE.MeshBasicMaterial({ color: r.color, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(led.position); ring.position.z += 0.001;
  group.add(ring);

  for (let i = 1; i <= 3; i++) {
    const arcGeo = new THREE.RingGeometry(i * 0.05, i * 0.05 + 0.008, 20, 1, -Math.PI * 0.35, Math.PI * 0.7);
    const arcMat = new THREE.MeshBasicMaterial({ color: r.color, side: THREE.DoubleSide, transparent: true, opacity: 0.5 / i });
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.position.set(ROUTER_BOX.w * 0.3, ROUTER_BOX.h * 0.3, ROUTER_BOX.d / 2 + 0.002 + i * 0.001);
    arc.rotation.z = Math.PI / 2;
    group.add(arc);
  }

  if (isOtherFloor) {
    const labelGeo = new THREE.PlaneGeometry(ROUTER_BOX.w * 1.6, 0.12);
    const canvas   = document.createElement("canvas");
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#00000088";
    ctx.roundRect?.(0, 0, 256, 48, 8); ctx.fill();
    ctx.font = "bold 18px 'DM Mono', monospace";
    ctx.fillStyle = "#" + r.color.toString(16).padStart(6,"0");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(r.label, 128, 24);
    const tex  = new THREE.CanvasTexture(canvas);
    const lMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const lMesh = new THREE.Mesh(labelGeo, lMat);
    lMesh.position.set(0, ROUTER_BOX.h / 2 + 0.1, ROUTER_BOX.d / 2);
    group.add(lMesh);
  }

  scene.add(group);
  return group;
}

// ═══════════════════════════════════════════════════════════════
//  UI ELEMENT REFS
// ═══════════════════════════════════════════════════════════════
const hintOverlay  = document.getElementById("hintOverlay");
const viewBtn      = document.getElementById("viewBtn");
const viewBtnLabel = document.getElementById("viewBtnLabel");
const loadFill     = document.getElementById("loadFill");
const toast        = document.getElementById("toast");
const mmLabel      = document.getElementById("mmSrc");
const routerRows   = document.getElementById("routerRows");
const minimapWrap  = document.getElementById("minimap");

let toastTimer = null;
function showToast(msg, dur = 3500) {
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = "0"; }, dur);
}

// ── Build router signal rows in status panel ─────────────────
function buildRouterRows() {
  routerRows.innerHTML = "";
  for (const r of ROUTERS) {
    const hex = "#" + r.color.toString(16).padStart(6,"0");
    routerRows.insertAdjacentHTML("beforeend", `
      <div class="router-row" id="rrow-${r.id}">
        <span class="router-dot" style="background:${hex};box-shadow:0 0 6px ${hex}88"></span>
        <span class="router-name">${r.label}</span>
        <span class="router-rssi" id="rssi-${r.id}" style="color:${hex}">—</span>
        <div class="router-bar">
          <div class="router-fill" id="rbar-${r.id}" style="background:${hex};width:0%"></div>
        </div>
      </div>
    `);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MINIMAP  (canvas injected into #minimap)
// ═══════════════════════════════════════════════════════════════
const MM_W = 210, MM_H = 210, MM_PAD = 12;
const mmCanvas = document.createElement("canvas");
mmCanvas.width = MM_W; mmCanvas.height = MM_H;
mmCanvas.style.cssText = `width:${MM_W}px;height:${MM_H}px;cursor:crosshair;display:block;`;
minimapWrap.insertBefore(mmCanvas, minimapWrap.firstChild);
const mmCtx = mmCanvas.getContext("2d");

const FL_W = FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX;
const FL_H = FLAT_BOUNDS.maxZ - FLAT_BOUNDS.minZ;

function flatToMM(fx, fz) {
  return {
    px: MM_PAD + ((fx - FLAT_BOUNDS.minX) / FL_W) * (MM_W - MM_PAD * 2),
    py: MM_PAD + ((fz - FLAT_BOUNDS.minZ) / FL_H) * (MM_H - MM_PAD * 2),
  };
}
function mmToFlat(px, py) {
  return {
    fx: FLAT_BOUNDS.minX + ((px - MM_PAD) / (MM_W - MM_PAD * 2)) * FL_W,
    fz: FLAT_BOUNDS.minZ + ((py - MM_PAD) / (MM_H - MM_PAD * 2)) * FL_H,
  };
}

const ROOM_COLORS = {
  "Room": "#0d2340", "Hall": "#0d2a14", "Kitchen": "#2a1e0a",
  "Main Entrance": "#1a0f2a", "Corridor": "#141820",
};

function drawMinimap() {
  mmCtx.clearRect(0, 0, MM_W, MM_H);

  // Room polygons
  for (const room of ROOMS) {
    mmCtx.beginPath();
    room.polygon.forEach(([x,z], i) => {
      const { px, py } = flatToMM(x, z);
      i === 0 ? mmCtx.moveTo(px,py) : mmCtx.lineTo(px,py);
    });
    mmCtx.closePath();
    mmCtx.fillStyle   = ROOM_COLORS[room.name] || "#111";
    mmCtx.fill();
    mmCtx.strokeStyle = "rgba(255,255,255,0.08)";
    mmCtx.lineWidth   = 1;
    mmCtx.stroke();
  }

  // Room name labels
  mmCtx.font          = "bold 6.5px 'DM Mono', monospace";
  mmCtx.textAlign     = "center";
  mmCtx.textBaseline  = "middle";
  for (const room of ROOMS) {
    const c = polyCenter2D(room.polygon);
    const { px, py } = flatToMM(c.x, c.z);
    mmCtx.fillStyle = "rgba(200,165,80,0.6)";
    mmCtx.fillText(room.name.toUpperCase(), px, py);
  }

  // Router markers + range ring
  for (const r of ROUTERS) {
    const { px, py } = flatToMM(r.pos.x, r.pos.z);
    const hex = "#" + r.color.toString(16).padStart(6,"0");

    // Range ring
    const rangePx = (6 / FL_W) * (MM_W - MM_PAD * 2);
    mmCtx.beginPath();
    mmCtx.arc(px, py, rangePx, 0, Math.PI * 2);
    mmCtx.strokeStyle = hex + "22";
    mmCtx.lineWidth   = 1;
    mmCtx.stroke();

    // Dot
    mmCtx.beginPath();
    mmCtx.arc(px, py, 4.5, 0, Math.PI * 2);
    mmCtx.fillStyle   = hex;
    mmCtx.shadowColor = hex;
    mmCtx.shadowBlur  = 8;
    mmCtx.fill();
    mmCtx.shadowBlur  = 0;
    mmCtx.strokeStyle = "rgba(255,255,255,0.4)";
    mmCtx.lineWidth   = 1;
    mmCtx.stroke();
  }

  // Door markers
  for (const d of DOOR_LABELS) {
    const { px, py } = flatToMM(d.x, d.z);
    mmCtx.fillStyle   = "rgba(80,140,255,0.85)";
    mmCtx.shadowColor = "rgba(80,140,255,0.5)";
    mmCtx.shadowBlur  = 5;
    mmCtx.fillRect(px-2.5, py-2.5, 5, 5);
    mmCtx.shadowBlur  = 0;
  }

  // Route overlay (drawn before player dot so dot sits on top)
  drawRouteOnMinimap();

  // Accuracy circle
  if (positioning.accuracy > 0) {
    const { px, py } = flatToMM(playerPos.x, playerPos.y);
    const accPx = (positioning.accuracy / FL_W) * (MM_W - MM_PAD * 2);
    mmCtx.beginPath();
    mmCtx.arc(px, py, accPx, 0, Math.PI * 2);
    mmCtx.strokeStyle = "rgba(0,200,255,0.20)";
    mmCtx.lineWidth   = 2;
    mmCtx.stroke();
  }

  // Player dot
  const { px: ppx, py: ppy } = flatToMM(playerPos.x, playerPos.y);

  // Outer pulse
  mmCtx.beginPath();
  mmCtx.arc(ppx, ppy, 7 + 2 * (0.5 + 0.5 * Math.sin(pulsePhase)), 0, Math.PI * 2);
  mmCtx.strokeStyle = "rgba(0,200,255,0.20)";
  mmCtx.lineWidth   = 1.5;
  mmCtx.stroke();

  // Core
  mmCtx.beginPath();
  mmCtx.arc(ppx, ppy, 5, 0, Math.PI * 2);
  mmCtx.fillStyle   = "#00c8ff";
  mmCtx.shadowColor = "#00c8ff";
  mmCtx.shadowBlur  = 10;
  mmCtx.fill();
  mmCtx.shadowBlur  = 0;
  mmCtx.strokeStyle = "#fff";
  mmCtx.lineWidth   = 1.5;
  mmCtx.stroke();

  // Heading arrow
  const hx = ppx + Math.sin(yaw) * 11;
  const hy  = ppy - Math.cos(yaw) * 11;
  mmCtx.beginPath();
  mmCtx.moveTo(ppx, ppy);
  mmCtx.lineTo(hx, hy);
  mmCtx.strokeStyle = "rgba(255,255,255,0.7)";
  mmCtx.lineWidth   = 2;
  mmCtx.lineCap     = "round";
  mmCtx.stroke();
  mmCtx.lineCap     = "butt";
}

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
//  NAVIGATION — DESTINATION PANEL + PATH DRAWING
// ═══════════════════════════════════════════════════════════════

// ── Destinations (rooms + doors merged into one list) ────────
const NAV_DESTINATIONS = [
  ...ROOMS.map(r => {
    const c = polyCenter2D(r.polygon);
    return { name: r.name, x: c.x, z: c.z, icon: "🚪", type: "room" };
  }),
  ...DOOR_LABELS.map(d => ({ name: d.name, x: d.x, z: d.z, icon: "🚪", type: "door" })),
];

// Assign nicer icons per name
const DEST_ICONS = {
  "Room": "🛏", "Hall": "🚶", "Kitchen": "🍳",
  "Main Entrance": "🏠", "Corridor": "🔀",
  "Main Gate": "🚪", "Aahan Gate": "🚪",
  "Balcony Gate": "🌿", "Sandeep Room": "🛋", "Washroom": "🚿",
};
NAV_DESTINATIONS.forEach(d => { d.icon = DEST_ICONS[d.name] || "📍"; });

// ── Simple waypoint graph for path routing ───────────────────
// Each destination snaps to its nearest corridor waypoint first,
// then a direct line is drawn. For a small flat this is enough.
// Corridor centre acts as the hub waypoint.
const CORRIDOR_HUB = { x: -1.5, z: -5.0 };

function buildPath(fromX, fromZ, toX, toZ) {
  // If both points are in roughly the same half, go direct.
  // Otherwise route through the corridor hub to avoid clipping walls.
  const direct = Math.sqrt((toX-fromX)**2 + (toZ-fromZ)**2);
  // Simple heuristic: if destination is far (>8 m) use hub
  if (direct > 8) {
    return [
      { x: fromX, z: fromZ },
      { x: CORRIDOR_HUB.x, z: CORRIDOR_HUB.z },
      { x: toX, z: toZ },
    ];
  }
  return [{ x: fromX, z: fromZ }, { x: toX, z: toZ }];
}

// ── Active route state ───────────────────────────────────────
let activeRoute = null;   // { dest, waypoints: [{x,z}], line3D }
let route3DLine = null;   // THREE.Line in the scene

function setDestination(dest) {
  // Remove old 3D line
  if (route3DLine) { scene.remove(route3DLine); route3DLine = null; }

  if (!dest) {
    activeRoute = null;
    document.getElementById("navPanel").classList.remove("has-route");
    refreshNavButtons();
    return;
  }

  const waypoints = buildPath(playerPos.x, playerPos.y, dest.x, dest.z);
  activeRoute = { dest, waypoints };
  document.getElementById("navPanel").classList.add("has-route");
  refreshNavButtons();

  // Build 3D line (drawn slightly above floor)
  if (scaleFactor > 0) build3DRouteLine(waypoints);
}

function build3DRouteLine(waypoints) {
  if (route3DLine) { scene.remove(route3DLine); route3DLine = null; }
  const pts = waypoints.map(w =>
    new THREE.Vector3(w.x * scaleFactor, 0.06 * scaleFactor, w.z * scaleFactor)
  );
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({
    color:     0x00c8ff,
    linewidth: 2,
    dashSize:  0.3 * scaleFactor,
    gapSize:   0.15 * scaleFactor,
    transparent: true,
    opacity:   0.85,
  });
  route3DLine = new THREE.Line(geo, mat);
  route3DLine.computeLineDistances();
  scene.add(route3DLine);
}

// Re-build route from current position every frame so line stays fresh
let routeRebuildTimer = 0;
function tickRouteRebuild(dt) {
  if (!activeRoute) return;
  routeRebuildTimer += dt;
  if (routeRebuildTimer < 1.0) return;   // rebuild every 1 s
  routeRebuildTimer = 0;
  activeRoute.waypoints = buildPath(playerPos.x, playerPos.y, activeRoute.dest.x, activeRoute.dest.z);
  if (scaleFactor > 0) build3DRouteLine(activeRoute.waypoints);
}

// ── Draw route overlay on minimap ────────────────────────────
function drawRouteOnMinimap() {
  if (!activeRoute) return;
  const wps = activeRoute.waypoints;

  // Dashed path line
  mmCtx.save();
  mmCtx.setLineDash([5, 3]);
  mmCtx.beginPath();
  wps.forEach((wp, i) => {
    const { px, py } = flatToMM(wp.x, wp.z);
    i === 0 ? mmCtx.moveTo(px, py) : mmCtx.lineTo(px, py);
  });
  mmCtx.strokeStyle = "#00c8ff";
  mmCtx.lineWidth   = 2;
  mmCtx.shadowColor = "#00c8ff";
  mmCtx.shadowBlur  = 6;
  mmCtx.stroke();
  mmCtx.restore();

  // Destination pin
  const dest = activeRoute.dest;
  const { px: dpx, py: dpy } = flatToMM(dest.x, dest.z);
  mmCtx.beginPath();
  mmCtx.arc(dpx, dpy, 6, 0, Math.PI * 2);
  mmCtx.fillStyle   = "#ff4d6a";
  mmCtx.shadowColor = "#ff4d6a";
  mmCtx.shadowBlur  = 10;
  mmCtx.fill();
  mmCtx.shadowBlur  = 0;
  mmCtx.strokeStyle = "#fff";
  mmCtx.lineWidth   = 1.5;
  mmCtx.stroke();

  // Distance label above pin
  const distM = Math.sqrt((dest.x - playerPos.x)**2 + (dest.z - playerPos.y)**2).toFixed(1);
  mmCtx.font      = "bold 7px 'DM Mono', monospace";
  mmCtx.fillStyle = "#fff";
  mmCtx.textAlign = "center";
  mmCtx.fillText(`${distM} m`, dpx, dpy - 10);
}

// ── Build panel buttons ──────────────────────────────────────
function buildNavPanel() {
  const roomsEl = document.getElementById("navRooms");
  const doorsEl = document.getElementById("navDoors");
  roomsEl.innerHTML = "";
  doorsEl.innerHTML = "";

  for (const dest of NAV_DESTINATIONS) {
    const btn = document.createElement("button");
    btn.className   = "nav-dest-btn";
    btn.dataset.name = dest.name;
    const distM = Math.sqrt((dest.x - playerPos.x)**2 + (dest.z - playerPos.y)**2).toFixed(0);
    btn.innerHTML = `
      <span class="dest-icon">${dest.icon}</span>
      <span>${dest.name}</span>
      <span class="dest-dist">${distM} m</span>
    `;
    btn.addEventListener("click", () => {
      const already = activeRoute?.dest?.name === dest.name;
      setDestination(already ? null : dest);
    });
    (dest.type === "room" ? roomsEl : doorsEl).appendChild(btn);
  }
}

function refreshNavButtons() {
  document.querySelectorAll(".nav-dest-btn").forEach(btn => {
    const isActive = btn.dataset.name === activeRoute?.dest?.name;
    btn.classList.toggle("active", isActive);
    // Update distance
    const dest = NAV_DESTINATIONS.find(d => d.name === btn.dataset.name);
    if (dest) {
      const distM = Math.sqrt((dest.x - playerPos.x)**2 + (dest.z - playerPos.y)**2).toFixed(0);
      const distEl = btn.querySelector(".dest-dist");
      if (distEl) distEl.textContent = distM + " m";
    }
  });
}

// Panel open/close toggle
document.getElementById("navToggle").addEventListener("click", () => {
  document.getElementById("navPanel").classList.toggle("open");
});

// Clear route button
document.getElementById("navClearBtn").addEventListener("click", () => {
  setDestination(null);
});

// ═══════════════════════════════════════════════════════════════
//  STATUS PANEL UPDATE
// ═══════════════════════════════════════════════════════════════
function updateStatusPanel() {
  const p = positioning;

  document.getElementById("posSource").textContent  = p.source;
  document.getElementById("coordX").innerHTML       = `${playerPos.x.toFixed(2)}<span class="coord-unit">m</span>`;
  document.getElementById("coordZ").innerHTML       = `${playerPos.y.toFixed(2)}<span class="coord-unit">m</span>`;
  document.getElementById("accVal").textContent     = `±${p.accuracy.toFixed(1)} m`;
  document.getElementById("stepCount").textContent  = p.steps;
  document.getElementById("headingVal").textContent = `${(p.heading * 180 / Math.PI).toFixed(0)}°`;
  mmLabel.textContent = p.source;

  // Accuracy bar — map 0–8m accuracy range → bar width
  const accPct = Math.min(100, (p.accuracy / 8) * 100);
  document.getElementById("accFill").style.width = accPct + "%";

  // Per-router RSSI + signal bar
  for (const r of ROUTERS) {
    const rssiEl = document.getElementById(`rssi-${r.id}`);
    const barEl  = document.getElementById(`rbar-${r.id}`);
    if (!rssiEl || !barEl) continue;
    const val = p.rssi[r.id];
    if (val !== undefined) {
      rssiEl.textContent = val.toFixed(0) + " dBm";
      // Map -100 dBm (bad) → 0% to -30 dBm (great) → 100%
      const pct = Math.max(0, Math.min(100, ((val + 100) / 70) * 100));
      barEl.style.width = pct + "%";
    } else {
      rssiEl.textContent = "—";
      barEl.style.width  = "0%";
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  INPUT — KEYBOARD
// ═══════════════════════════════════════════════════════════════
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "KeyV") toggleCameraMode();
});
document.addEventListener("keyup", (e) => { keys[e.code] = false; });

// ═══════════════════════════════════════════════════════════════
//  INPUT — POINTER LOCK
// ═══════════════════════════════════════════════════════════════
let pointerLocked = false;

renderer.domElement.addEventListener("click", () => {
  if (cameraMode === "fps") {
    dismissHint();
    if (!pointerLocked) renderer.domElement.requestPointerLock();
  }
});

// Also dismiss on any key press or touch so mobile users aren't stuck
document.addEventListener("keydown", (e) => {
  if (e.code !== "KeyV") dismissHint();
}, { capture: true });

renderer.domElement.addEventListener("touchstart", () => {
  dismissHint();
}, { passive: true });

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  // Re-show hint only if user never dismissed it and lock was released in FPS mode
  if (!pointerLocked && cameraMode === "fps" && !hintDismissed) {
    hintOverlay.style.display = "flex";
  }
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
    yaw   -= (e.touches[0].clientX - touchLast.x) * TOUCH_SENS;
    pitch -= (e.touches[0].clientY - touchLast.y) * TOUCH_SENS;
    pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  } else if (e.touches.length === 2) {
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const fwd  = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    yawObj.position.addScaledVector(fwd, -(midY - touchLast.y) * 0.015 * scaleFactor);
    clampPosition();
    touchLast = { x: touchLast.x, y: midY };
  }
}, { passive: false });

renderer.domElement.addEventListener("touchend",    () => { touchLast = null; });
renderer.domElement.addEventListener("touchcancel", () => { touchLast = null; });

// ═══════════════════════════════════════════════════════════════
//  CAMERA MODE TOGGLE
// ═══════════════════════════════════════════════════════════════
let hintDismissed = false;

function dismissHint() {
  hintDismissed = true;
  hintOverlay.style.display = "none";
}

function toggleCameraMode() {
  if (cameraMode === "fps") {
    cameraMode   = "overview";
    activeCamera = ovCam;
    if (pointerLocked) document.exitPointerLock();
    hintOverlay.style.display = "none";
    viewBtnLabel.textContent  = "FPS View";
  } else {
    cameraMode   = "fps";
    activeCamera = fpsCam;
    viewBtnLabel.textContent  = "Overview";
    // Only re-show hint if user has never interacted
    if (!hintDismissed) hintOverlay.style.display = "flex";
  }
}

viewBtn.addEventListener("click", toggleCameraMode);

// ═══════════════════════════════════════════════════════════════
//  ROOM LABELS  (3D projected HTML)
// ═══════════════════════════════════════════════════════════════
const labelContainer = document.getElementById("labelContainer");
const labelObjects   = [];

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
    background:${isRoom ? "rgba(8,12,16,0.80)" : "rgba(8,30,80,0.80)"};
    color:${isRoom ? "#d4a84b" : "#7ab8ff"};
    font-family:'Syne',sans-serif;
    font-size:${isRoom ? "12px" : "10px"};
    font-weight:${isRoom ? "700" : "600"};
    letter-spacing:0.10em; padding:${isRoom ? "4px 10px" : "3px 8px"};
    border-radius:5px;
    border:1px solid ${isRoom ? "rgba(212,168,75,0.20)" : "rgba(120,180,255,0.20)"};
    white-space:nowrap; backdrop-filter:blur(4px);
    text-transform:uppercase; opacity:0; transition:opacity 0.12s;
    pointer-events:none;
  `;
  labelContainer.appendChild(el);
  return el;
}

function initLabels(sf) {
  for (const room of ROOMS) {
    const c = polyCenter2D(room.polygon);
    labelObjects.push({ el: makeLabelEl(room.name, true),  worldPos: new THREE.Vector3(c.x * sf, EYE_HEIGHT * sf * 0.4, c.z * sf) });
  }
  for (const d of DOOR_LABELS) {
    labelObjects.push({ el: makeLabelEl(d.name, false), worldPos: new THREE.Vector3(d.x * sf, EYE_HEIGHT * sf * 0.9, d.z * sf) });
  }
}

const _proj    = new THREE.Vector3();
const _camWPos = new THREE.Vector3();

function updateLabels() {
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
    el.style.left    = ((_proj.x * 0.5 + 0.5) * W) + "px";
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
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    scene.add(model);

    const sz = box.getSize(new THREE.Vector3());
    scaleFactor = (FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX) / sz.x;
    model.scale.setScalar(scaleFactor);

    const box2 = new THREE.Box3().setFromObject(model);
    model.position.sub(box2.getCenter(new THREE.Vector3()));

    const inset = 0.25 * scaleFactor;
    eyeY = EYE_HEIGHT * scaleFactor;
    bounds = {
      minX: FLAT_BOUNDS.minX * scaleFactor + inset,
      maxX: FLAT_BOUNDS.maxX * scaleFactor - inset,
      minZ: FLAT_BOUNDS.minZ * scaleFactor + inset,
      maxZ: FLAT_BOUNDS.maxZ * scaleFactor - inset,
    };

    for (const r of ROUTERS) {
      const mesh = buildRouterMesh(r);
      routerMarkers.push(mesh);
      mesh.scale.setScalar(scaleFactor);
      mesh.position.set(r.pos.x * scaleFactor, r.pos.y * scaleFactor, r.pos.z * scaleFactor);
    }

    const flatW  = (FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX) * scaleFactor;
    const flatH  = (FLAT_BOUNDS.maxZ - FLAT_BOUNDS.minZ) * scaleFactor;
    const aspect = window.innerWidth / window.innerHeight;
    const halfH  = Math.max(flatW / aspect, flatH) / 2 * 1.15;
    ovCam.left   = -halfH * aspect; ovCam.right  =  halfH * aspect;
    ovCam.top    =  halfH;          ovCam.bottom = -halfH;
    ovCam.position.set(0, flatW * 2, 0);
    ovCam.lookAt(0, 0, 0);
    ovCam.updateProjectionMatrix();

    yawObj.position.set(SPAWN.x * scaleFactor, eyeY, SPAWN.z * scaleFactor);
    playerPos.set(SPAWN.x, SPAWN.z);
    yaw = SPAWN.yaw;

    buildRouterRows();
    buildNavPanel();
    initLabels(scaleFactor);
    initDeadReckoning();
    initWifiPositioning();

    loadFill.style.width = "100%";
    setTimeout(() => { loadFill.style.opacity = "0"; }, 600);
    showToast("🏠 Click anywhere to explore  ·  V for overview", 4000);
  },
  (xhr) => {
    const pct = xhr.total ? (xhr.loaded / xhr.total * 100).toFixed(0) : "?";
    loadFill.style.width = (xhr.total ? (xhr.loaded / xhr.total * 80) : 30) + "%";
    showToast(`Loading model… ${pct}%`, 9999);
  },
  (err) => {
    showToast("❌ Failed to load model");
    console.error(err);
  }
);

// ═══════════════════════════════════════════════════════════════
//  POSITIONING ENGINE
// ═══════════════════════════════════════════════════════════════
const positioning = {
  source:   "WASD",
  accuracy: 0,
  rssi:     {},
  steps:    0,
  heading:  0,
};

const kalman = {
  x: SPAWN.x, z: SPAWN.z,
  covX: 5.0,  covZ: 5.0,
  Q: 0.5, R_wifi: 2.0, R_dr: 0.3,
};

function kalmanPredict(dx, dz, dt) {
  kalman.x += dx; kalman.z += dz;
  kalman.covX += kalman.Q * dt; kalman.covZ += kalman.Q * dt;
}
function kalmanUpdate(measX, measZ, R) {
  const Kx = kalman.covX / (kalman.covX + R);
  kalman.x += Kx * (measX - kalman.x); kalman.covX = (1 - Kx) * kalman.covX;
  const Kz = kalman.covZ / (kalman.covZ + R);
  kalman.z += Kz * (measZ - kalman.z); kalman.covZ = (1 - Kz) * kalman.covZ;
  playerPos.set(kalman.x, kalman.z);
  syncPlayerToScene();
}

function rssiToDistance(rssi, router) {
  return Math.pow(10, (router.txPower - rssi) / (10 * router.pathLoss));
}

function trilaterate(measurements) {
  let px = kalman.x, pz = kalman.z;
  for (let iter = 0; iter < 50; iter++) {
    let gradX = 0, gradZ = 0, totalW = 0;
    for (const { router, dist } of measurements) {
      const dx = px - router.pos.x, dz = pz - router.pos.z;
      const d3d = Math.sqrt(dx*dx + dz*dz + router.pos.y*router.pos.y);
      if (d3d < 0.01) continue;
      const err = d3d - dist, w = 1 / (dist * dist);
      gradX += w * err * (dx / d3d); gradZ += w * err * (dz / d3d); totalW += w;
    }
    if (totalW < 0.001) break;
    px -= 0.3 * gradX / totalW; pz -= 0.3 * gradZ / totalW;
  }
  return { x: px, z: pz };
}

let wifiAvailable = false;
const DEV_SIMULATE_WIFI = true;

function initWifiPositioning() { pollWifiServer(); }
function pollWifiServer() {
  setInterval(async () => {
    try {
      const res  = await fetch("http://localhost:8765/wifi", { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      processWifiScan(data.networks || []);
      wifiAvailable = true;
    } catch {
      if (DEV_SIMULATE_WIFI) simulateWifi();
    }
  }, 2500);
}

function simulateWifi() {
  const measurements = [];
  for (const router of ROUTERS) {
    const dx   = playerPos.x - router.pos.x;
    const dz   = playerPos.y - router.pos.z;
    const dy   = -router.pos.y;
    const dist = Math.sqrt(dx*dx + dz*dz + dy*dy);
    const rssi = router.txPower - 10 * router.pathLoss * Math.log10(Math.max(dist, 0.5))
                 + (Math.random() - 0.5) * 6;
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
  kalmanUpdate(
    Math.max(FLAT_BOUNDS.minX, Math.min(FLAT_BOUNDS.maxX, x)),
    Math.max(FLAT_BOUNDS.minZ, Math.min(FLAT_BOUNDS.maxZ, z)),
    kalman.R_wifi
  );
}

let drActive = false, lastAccelTime = 0;
const accelBuf = [], STEP_LEN = 0.65;

function initDeadReckoning() {
  if (typeof DeviceMotionEvent === "undefined") return;
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    DeviceMotionEvent.requestPermission().then(s => { if (s === "granted") listenMotion(); }).catch(() => {});
  } else { listenMotion(); }
  if (typeof DeviceOrientationEvent !== "undefined") {
    window.addEventListener("deviceorientation", (e) => {
      if (e.alpha !== null) positioning.heading = e.alpha * Math.PI / 180;
    });
  }
}

function listenMotion() {
  drActive = true;
  window.addEventListener("devicemotion", (e) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    const mag = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
    const now = Date.now(), dt = (now - lastAccelTime) / 1000;
    lastAccelTime = now;
    accelBuf.push(mag); if (accelBuf.length > 5) accelBuf.shift();
    const avg = accelBuf.reduce((a,b) => a+b,0) / accelBuf.length;
    if (mag > avg + 1.2 && dt > 0.25) {
      positioning.steps++;
      const h = positioning.heading || yaw;
      kalmanPredict(Math.sin(h) * STEP_LEN, -Math.cos(h) * STEP_LEN, dt);
      kalman.x = Math.max(FLAT_BOUNDS.minX, Math.min(FLAT_BOUNDS.maxX, kalman.x));
      kalman.z = Math.max(FLAT_BOUNDS.minZ, Math.min(FLAT_BOUNDS.maxZ, kalman.z));
      playerPos.set(kalman.x, kalman.z);
      syncPlayerToScene();
      positioning.source   = "DeadReck";
      positioning.accuracy = Math.min(3 + positioning.steps * 0.1, 8);
    }
  });
}

function syncPlayerToScene() {
  if (!bounds) return;
  yawObj.position.set(playerPos.x * scaleFactor, eyeY, playerPos.y * scaleFactor);
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function clampPosition() {
  if (!bounds) return;
  yawObj.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, yawObj.position.x));
  yawObj.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, yawObj.position.z));
  yawObj.position.y = eyeY;
  playerPos.set(yawObj.position.x / scaleFactor, yawObj.position.z / scaleFactor);
  kalman.x = playerPos.x; kalman.z = playerPos.y;
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

  yawObj.rotation.y   = yaw;
  pitchObj.rotation.x = pitch;

  if (bounds && cameraMode === "fps") {
    const mf = (keys["KeyW"] || keys["ArrowUp"])    ? 1 : 0;
    const mb = (keys["KeyS"] || keys["ArrowDown"])  ? 1 : 0;
    const ml = (keys["KeyA"] || keys["ArrowLeft"])  ? 1 : 0;
    const mr = (keys["KeyD"] || keys["ArrowRight"]) ? 1 : 0;

    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(   Math.cos(yaw), 0, -Math.sin(yaw));
    _wish.set(0,0,0).addScaledVector(_forward, mf-mb).addScaledVector(_right, mr-ml);

    const moving = _wish.lengthSq() > 0;
    if (moving) _wish.normalize();

    const maxSpd = MAX_SPD * scaleFactor;
    if (moving) {
      vel.addScaledVector(_wish, ACCEL * scaleFactor * dt);
      if (vel.length() > maxSpd) vel.setLength(maxSpd);
    } else {
      const loss = FRICTION * scaleFactor * dt;
      const cur  = vel.length();
      if (cur > loss) vel.setLength(cur - loss); else vel.set(0,0,0);
    }

    yawObj.position.addScaledVector(vel, dt);
    clampPosition();

    if (moving) kalmanPredict(vel.x * dt / scaleFactor, vel.z * dt / scaleFactor, dt);
  }

  // Player dot
  playerDot.position.set(yawObj.position.x, 0.012 * scaleFactor, yawObj.position.z);
  playerDot.rotation.y = yaw;
  playerDot.scale.setScalar(scaleFactor);

  // Pulse animation
  pulsePhase += dt * 1.8;
  const pulse  = 0.5 + 0.5 * Math.sin(pulsePhase);
  const pulse2 = 0.5 + 0.5 * Math.sin(pulsePhase * 0.6);
  pulseMesh.scale.setScalar(1.0 + pulse * 0.55);
  pulseMat.opacity  = 0.6 * (1 - pulse * 0.7);
  haloMat.opacity   = 0.06 + 0.07 * pulse2;
  coreMat.color.setHSL(0.58, 1.0, 0.32 + pulse * 0.12);

  if (cameraMode === "overview") {
    ovCam.position.x = yawObj.position.x;
    ovCam.position.z = yawObj.position.z;
    ovCam.lookAt(yawObj.position.x, 0, yawObj.position.z);
  }

  tickRouteRebuild(dt);
  refreshNavButtons();
  updateLabels();
  drawMinimap();
  updateStatusPanel();
  renderer.render(scene, activeCamera);
}

animate();

// ═══════════════════════════════════════════════════════════════
//  COMPANION SERVER INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════
console.log(`
%c📡 WiFi Trilateration — Companion Server Setup
%cRun on Android (Termux):  pkg install nodejs termux-api
Then: node wifi-server.js  (see full instructions in source)

Current mode: %cDEV_SIMULATE_WIFI = true
`,
  "color:#00c8ff; font-weight:bold; font-size:13px",
  "color:#7a8fa8; font-size:10px",
  "color:#00e5a0; font-size:10px"
);