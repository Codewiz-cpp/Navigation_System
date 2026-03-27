import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ─────────────────────────────────────────────
//  LAYOUT DATA  (parsed from Layout.json)
//  Slab polygons define room floor areas.
//  The JSON uses [X, Z] pairs (Y is up in Three.js).
// ─────────────────────────────────────────────
const ROOMS = [
  {
    name: "Room",
    polygon: [[-6,4],[2.5,4],[2.5,11.5],[-6,11.5]],
  },
  {
    name: "Hall",
    polygon: [[-8.5,-14],[-8.5,-2.5],[-3,-2.5],[-3,-14]],
  },
  {
    name: "Kitchen",
    polygon: [[0,-2.5],[4.5,-2.5],[4.5,-8],[0,-8]],
  },
  {
    name: "Main Entrance",
    polygon: [[0,-8],[0,-14],[4.5,-14],[4.5,-8]],
  },
  {
    name: "Corridor",
    polygon: [[-3,-14],[0,-14],[0,4],[-3,4]],
  },
];

// Named doors/gates extracted from JSON
// wall_f5px62weyrekkgiw: start(4.5,-2.5) → end(4.5,-14), Main Gate pos=10.5 → Z = -2.5 - 10.5 = -13
// wall_qfhgllxtl0qmry7f: start(4.5,-14) → end(-8.5,-14), Aahan Gate pos=5 → X = 4.5 - 5 = -0.5
// wall_52que9931hd63rgk: start(-8.5,-14) → end(-8.5,-2.5), Balcony Gate pos=10 → Z = -14 + 10 = -4
// wall_ylf7hddqpnrosv9o: start(0,4) → end(0,-2.5), Sandeep Room pos=1 → Z = 4-1=3, Washroom pos=3.5 → Z=0.5
const DOOR_LABELS = [
  { name: "Main Gate",    x: 4.5,   z: -13   },
  { name: "Aahan Gate",   x: -0.5,  z: -14   },
  { name: "Balcony Gate", x: -8.5,  z: -4    },
  { name: "Sandeep Room", x: 0,     z: 3     },
  { name: "Washroom",     x: 0,     z: 0.5   },
];

// Main Gate world position (layout coords) — camera spawns just inside it
const MAIN_GATE_LAYOUT = { x: 4.5, z: -13 };

// ─────────────────────────────────────────────
//  FLAT BOUNDS  (layout extents, meters)
// ─────────────────────────────────────────────
const FLAT_BOUNDS = {
  minX: -8.5, maxX: 4.5,
  minZ: -14,  maxZ: 11.5,
  minY: 0,    maxY: 4,
};

// Wall height ~2.8 m → half wall height ≈ 1.4 m
const HUMAN_EYE_HEIGHT = 1.4;

// ─────────────────────────────────────────────
//  SCENE
// ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 30, 120);

// ─────────────────────────────────────────────
//  CAMERA
// ─────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  1000
);

// ─────────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ─────────────────────────────────────────────
//  LIGHTS
// ─────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xfff5e0, 1.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xc0d8ff, 0.8);
fill.position.set(-10, 10, -10);
scene.add(fill);

// ─────────────────────────────────────────────
//  CONTROLS
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;         // smooth deceleration
controls.rotateSpeed = 0.6;
controls.panSpeed = 0.8;
controls.minDistance = 0;
controls.maxDistance = Infinity;
controls.zoomSpeed = 0;                // disable built-in zoom
controls.maxPolarAngle = Math.PI / 2 + 0.15;  // don't go underground

controls.mouseButtons = {
  LEFT:   THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT:  THREE.MOUSE.PAN,
};

controls.touches = {
  ONE:   THREE.TOUCH.ROTATE,
  TWO:   THREE.TOUCH.DOLLY_PAN,
};

// ─────────────────────────────────────────────
//  SMOOTH ZOOM via wheel
// ─────────────────────────────────────────────
let zoomVelocity = 0;
const ZOOM_FRICTION = 0.88;

renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  const dist = camera.position.distanceTo(controls.target);
  // Accumulate velocity — gives smooth, momentum-based zoom
  zoomVelocity += (e.deltaY > 0 ? -1 : 1) * dist * 0.06;
}, { passive: false });

// ─────────────────────────────────────────────
//  CSS2D-style ROOM LABELS  (pure HTML overlay)
// ─────────────────────────────────────────────
const labelContainer = document.createElement("div");
labelContainer.style.cssText = `
  position:fixed; top:0; left:0; width:100%; height:100%;
  pointer-events:none; overflow:hidden; z-index:10;
`;
document.body.appendChild(labelContainer);

const labelObjects = [];   // { el, worldPos }

function polyCenter(polygon) {
  let sx = 0, sz = 0;
  for (const [x, z] of polygon) { sx += x; sz += z; }
  return { x: sx / polygon.length, z: sz / polygon.length };
}

function makeLabelEl(text, isRoom) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position:absolute;
    transform:translate(-50%,-50%);
    background: ${isRoom
      ? "rgba(0,0,0,0.55)"
      : "rgba(20,80,180,0.70)"};
    color: ${isRoom ? "#ffe0a0" : "#b0d8ff"};
    font-family: 'Segoe UI', sans-serif;
    font-size: ${isRoom ? "13px" : "11px"};
    font-weight: ${isRoom ? "700" : "500"};
    letter-spacing: 0.05em;
    padding: ${isRoom ? "5px 10px" : "3px 8px"};
    border-radius: 6px;
    border: 1px solid ${isRoom ? "rgba(255,210,100,0.4)" : "rgba(100,160,255,0.4)"};
    white-space: nowrap;
    backdrop-filter: blur(4px);
    text-transform: uppercase;
    transition: opacity 0.2s;
    opacity: 0;
  `;
  labelContainer.appendChild(el);
  return el;
}

function initLabels(scaleFactor) {
  // Room floor labels (from slab data)
  for (const room of ROOMS) {
    const c = polyCenter(room.polygon);
    // world position: center of room at eye-height in 3D
    const worldPos = new THREE.Vector3(
      c.x * scaleFactor,
      HUMAN_EYE_HEIGHT * scaleFactor * 0.5,
      c.z * scaleFactor
    );
    const el = makeLabelEl(room.name, true);
    labelObjects.push({ el, worldPos });
  }

  // Door labels
  for (const d of DOOR_LABELS) {
    const worldPos = new THREE.Vector3(
      d.x * scaleFactor,
      HUMAN_EYE_HEIGHT * scaleFactor * 0.85,
      d.z * scaleFactor
    );
    const el = makeLabelEl(d.name, false);
    labelObjects.push({ el, worldPos });
  }
}

// Project world position → screen, update each label element
const _tmp = new THREE.Vector3();
function updateLabels() {
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const camDist = camera.position.distanceTo(controls.target);

  for (const { el, worldPos } of labelObjects) {
    _tmp.copy(worldPos);
    _tmp.project(camera);

    // Behind camera?
    if (_tmp.z > 1) { el.style.opacity = "0"; continue; }

    const sx = ( _tmp.x * 0.5 + 0.5) * w;
    const sy = (-_tmp.y * 0.5 + 0.5) * h;

    // Fade by distance
    const dist = worldPos.distanceTo(camera.position);
    const fade = Math.max(0, Math.min(1, 1 - (dist - 2) / 60));

    el.style.left    = sx + "px";
    el.style.top     = sy + "px";
    el.style.opacity = fade.toString();
  }
}

// ─────────────────────────────────────────────
//  INFO OVERLAY
// ─────────────────────────────────────────────
const info = document.getElementById("info") || (() => {
  const d = document.createElement("div");
  d.id = "info";
  d.style.cssText = `
    position:fixed; top:16px; left:50%; transform:translateX(-50%);
    background:rgba(0,0,0,0.7); color:#fff;
    padding:8px 18px; border-radius:8px; font-family:sans-serif;
    font-size:14px; z-index:20; pointer-events:none;
  `;
  document.body.appendChild(d);
  return d;
})();

// ─────────────────────────────────────────────
//  LOAD MODEL
// ─────────────────────────────────────────────
const loader = new GLTFLoader();
let scaleFactor = 1;
let bounds = {};          // scaled camera bounds
let humanY = 1.65;        // eye height in scaled coords

loader.load(
  "./model.glb",
  (gltf) => {
    const model = gltf.scene;

    // Enable shadows on all meshes
    model.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    // ── Compute model bounds ──
    const box = new THREE.Box3().setFromObject(model);
    const modelSize = box.getSize(new THREE.Vector3());
    const modelCenter = box.getCenter(new THREE.Vector3());

    // Center at origin
    model.position.sub(modelCenter);
    scene.add(model);

    // ── Scale so X spans layout width (13 m) ──
    const flatWidth = FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX; // 13
    scaleFactor = flatWidth / modelSize.x;
    model.scale.setScalar(scaleFactor);

    // Re-center after scale
    const box2 = new THREE.Box3().setFromObject(model);
    const center2 = box2.getCenter(new THREE.Vector3());
    model.position.sub(center2);

    // ── Scaled bounds for camera clamping ──
    bounds = {
      minX: FLAT_BOUNDS.minX * scaleFactor,
      maxX: FLAT_BOUNDS.maxX * scaleFactor,
      minZ: FLAT_BOUNDS.minZ * scaleFactor,
      maxZ: FLAT_BOUNDS.maxZ * scaleFactor,
      minY: 0.05 * scaleFactor,
      maxY: FLAT_BOUNDS.maxY * scaleFactor,
    };

    humanY = HUMAN_EYE_HEIGHT * scaleFactor;

    // ── Camera: start just inside Main Gate (4.5, -13), looking inward (toward X=-1) ──
    const gx = MAIN_GATE_LAYOUT.x * scaleFactor;
    const gz = MAIN_GATE_LAYOUT.z * scaleFactor;
    // Step 1 unit inside the wall (toward -X direction)
    camera.position.set(gx - 1.0 * scaleFactor, humanY, gz);
    controls.target.set(gx - 4.0 * scaleFactor, humanY * 0.95, gz);
    camera.near = 0.01;
    camera.far  = 1000;
    camera.updateProjectionMatrix();
    controls.update();

    // ── Build room labels ──
    initLabels(scaleFactor);

    info.innerHTML = "🏠 Use mouse to explore • Scroll to zoom";
    setTimeout(() => info.style.opacity = "0", 3500);
    setTimeout(() => info.style.display = "none", 4000);
  },
  (xhr) => {
    const pct = xhr.total ? (xhr.loaded / xhr.total * 100).toFixed(1) : "?";
    info.innerHTML = `⏳ Loading… ${pct}%`;
  },
  (err) => {
    info.innerHTML = "❌ Error loading model";
    console.error(err);
  }
);

// ─────────────────────────────────────────────
//  CLAMP helpers
// ─────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function clampCamera() {
  if (!bounds.minX) return;

  // Clamp target (orbit center) — XZ only, Y is governed by humanY
  controls.target.x = clamp(controls.target.x, bounds.minX, bounds.maxX);
  controls.target.z = clamp(controls.target.z, bounds.minZ, bounds.maxZ);
  controls.target.y = humanY * 0.95;

  // Detect if camera is already at an XZ wall before clamping
  const hitXWall = camera.position.x <= bounds.minX || camera.position.x >= bounds.maxX;
  const hitZWall = camera.position.z <= bounds.minZ || camera.position.z >= bounds.maxZ;

  // Clamp camera position
  camera.position.x = clamp(camera.position.x, bounds.minX, bounds.maxX);
  camera.position.z = clamp(camera.position.z, bounds.minZ, bounds.maxZ);
  // Soft-lock Y to humanY (±0.4 m freedom for slight tilt)
  camera.position.y = clamp(camera.position.y, humanY - 0.4 * scaleFactor, humanY + 0.4 * scaleFactor);

  // ── KEY FIX: if we hit a boundary, kill zoom velocity so scroll never "freezes" ──
  if (hitXWall || hitZWall) {
    // Check if the zoom direction is pushing deeper into the wall; if so, zero it
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    if ((hitXWall && Math.abs(dir.x) > 0.3) || (hitZWall && Math.abs(dir.z) > 0.3)) {
      zoomVelocity = 0;
    }
  }
}

// ─────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  // Apply smooth zoom momentum
  if (Math.abs(zoomVelocity) > 0.0001) {
    const dir = new THREE.Vector3()
      .subVectors(controls.target, camera.position)
      .normalize();

    camera.position.addScaledVector(dir, zoomVelocity);
    // Nudge target slightly so orbit sphere re-centers
    controls.target.addScaledVector(dir, zoomVelocity * 0.3);

    zoomVelocity *= ZOOM_FRICTION;
    if (Math.abs(zoomVelocity) < 0.001) zoomVelocity = 0;
  }

  clampCamera();
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
}

animate();