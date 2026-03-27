import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ─────────────────────────────────────────────────────────────
//  LAYOUT  (from Layout.json)
// ─────────────────────────────────────────────────────────────
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

// Spawn just inside Main Gate, facing inward (-X direction = yaw of π)
const SPAWN = { x: 3.5, z: -13, yaw: Math.PI };

const FLAT_BOUNDS = { minX: -8.5, maxX: 4.5, minZ: -14, maxZ: 11.5 };

// Half of ~2.8 m wall height
const EYE_HEIGHT = 1.4;

// Movement tuning
const ACCEL    = 18;   // units/s² — acceleration
const FRICTION = 12;   // units/s² — drag when no key held
const MAX_SPD  = 6;    // units/s  — top walking speed

// Look tuning
const MOUSE_SENS = 0.0018;
const TOUCH_SENS = 0.004;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

// ─────────────────────────────────────────────────────────────
//  SCENE
// ─────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 40, 130);

// ─────────────────────────────────────────────────────────────
//  FPS CAMERA RIG
//  yawObj   — positioned at eye level, rotates around Y (left/right)
//  pitchObj — child of yawObj, rotates around X (up/down)
//  camera   — child of pitchObj (pure projection, no rotation here)
// ─────────────────────────────────────────────────────────────
const yawObj   = new THREE.Object3D();
const pitchObj = new THREE.Object3D();
const camera   = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.02, 500);
yawObj.add(pitchObj);
pitchObj.add(camera);
scene.add(yawObj);

let scaleFactor = 1;
let eyeY        = EYE_HEIGHT;
let bounds      = null;

let yaw   = SPAWN.yaw;
let pitch = 0;

// ─────────────────────────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ─────────────────────────────────────────────────────────────
//  LIGHTS
// ─────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xfff5e0, 1.4));

const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
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

const fill = new THREE.DirectionalLight(0xc0d8ff, 0.6);
fill.position.set(-10, 10, -10);
scene.add(fill);

// ─────────────────────────────────────────────────────────────
//  INPUT — KEYBOARD
// ─────────────────────────────────────────────────────────────
const keys = {};
document.addEventListener("keydown", (e) => { keys[e.code] = true;  });
document.addEventListener("keyup",   (e) => { keys[e.code] = false; });

// ─────────────────────────────────────────────────────────────
//  INPUT — POINTER LOCK (desktop mouse look)
// ─────────────────────────────────────────────────────────────
let pointerLocked = false;

renderer.domElement.addEventListener("click", () => {
  if (!pointerLocked) renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  hintOverlay.style.display = pointerLocked ? "none" : "flex";
});

document.addEventListener("mousemove", (e) => {
  if (!pointerLocked) return;
  yaw   -= e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
  pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
});

// ─────────────────────────────────────────────────────────────
//  INPUT — TOUCH (mobile: 1-finger = look, 2-finger swipe = walk)
// ─────────────────────────────────────────────────────────────
let touchLast = null;

renderer.domElement.addEventListener("touchstart", (e) => {
  e.preventDefault();
  touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: false });

renderer.domElement.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!touchLast) return;

  if (e.touches.length === 1) {
    // Single finger → look
    const dx = e.touches[0].clientX - touchLast.x;
    const dy = e.touches[0].clientY - touchLast.y;
    yaw   -= dx * TOUCH_SENS;
    pitch -= dy * TOUCH_SENS;
    pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    touchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  } else if (e.touches.length === 2) {
    // Two fingers → walk forward/back based on vertical swipe
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const dy   = midY - touchLast.y;
    const fwd  = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    yawObj.position.addScaledVector(fwd, -dy * 0.015 * scaleFactor);
    clampPosition();
    touchLast = { x: touchLast.x, y: midY };
  }
}, { passive: false });

renderer.domElement.addEventListener("touchend",   () => { touchLast = null; });
renderer.domElement.addEventListener("touchcancel",() => { touchLast = null; });

// ─────────────────────────────────────────────────────────────
//  HUD — click-to-start overlay + control legend
// ─────────────────────────────────────────────────────────────
const hintOverlay = document.createElement("div");
hintOverlay.style.cssText = `
  position:fixed; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; z-index:30; pointer-events:none;
`;
hintOverlay.innerHTML = `
  <div style="
    background:rgba(0,0,0,0.75); color:#fff;
    padding:28px 40px; border-radius:16px; text-align:center;
    font-family:'Segoe UI',sans-serif;
    border:1px solid rgba(255,255,255,0.12);
    backdrop-filter:blur(10px); max-width:340px;
  ">
    <div style="font-size:36px; margin-bottom:10px">🏠</div>
    <div style="font-size:20px; font-weight:700; margin-bottom:6px">Click to explore</div>
    <div style="font-size:13px; opacity:0.6; margin-bottom:18px">
      Click the view to capture your mouse and start walking
    </div>
    <div style="
      display:grid; grid-template-columns:auto 1fr;
      gap:7px 18px; font-size:13px; text-align:left;
    ">
      <span style="opacity:0.5">W / ↑</span><span>Move forward</span>
      <span style="opacity:0.5">S / ↓</span><span>Move back</span>
      <span style="opacity:0.5">A / ←</span><span>Strafe left</span>
      <span style="opacity:0.5">D / →</span><span>Strafe right</span>
      <span style="opacity:0.5">🖱 Mouse</span><span>Look around</span>
      <span style="opacity:0.5">Esc</span><span>Release mouse</span>
    </div>
    <div style="margin-top:14px; font-size:11px; opacity:0.4">
      📱 Mobile: drag to look · two-finger swipe to walk
    </div>
  </div>
`;
document.body.appendChild(hintOverlay);

const legend = document.createElement("div");
legend.style.cssText = `
  position:fixed; bottom:14px; left:50%; transform:translateX(-50%);
  background:rgba(0,0,0,0.5); color:rgba(255,255,255,0.6);
  padding:5px 18px; border-radius:20px;
  font-family:'Segoe UI',sans-serif; font-size:11px;
  z-index:20; pointer-events:none; letter-spacing:0.05em;
`;
legend.textContent = "WASD · move   |   Mouse · look   |   Esc · unlock";
document.body.appendChild(legend);

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

// ─────────────────────────────────────────────────────────────
//  ROOM LABELS
// ─────────────────────────────────────────────────────────────
const labelContainer = document.createElement("div");
labelContainer.style.cssText = `
  position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:10;
`;
document.body.appendChild(labelContainer);

const labelObjects = [];

function polyCenter(poly) {
  let sx = 0, sz = 0;
  for (const [x,z] of poly) { sx+=x; sz+=z; }
  return { x: sx/poly.length, z: sz/poly.length };
}

function makeLabelEl(text, isRoom) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position:absolute; transform:translate(-50%,-50%);
    background:${isRoom ? "rgba(0,0,0,0.6)" : "rgba(10,60,160,0.72)"};
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
    const c = polyCenter(room.polygon);
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
  const W = renderer.domElement.clientWidth;
  const H = renderer.domElement.clientHeight;
  camera.getWorldPosition(_camWPos);
  for (const { el, worldPos } of labelObjects) {
    _proj.copy(worldPos).project(camera);
    if (_proj.z > 1) { el.style.opacity = "0"; continue; }
    const dist = worldPos.distanceTo(_camWPos);
    const fade = Math.max(0, Math.min(1, 1 - (dist - 1) / 35));
    el.style.left    = (( _proj.x * 0.5 + 0.5) * W) + "px";
    el.style.top     = ((-_proj.y * 0.5 + 0.5) * H) + "px";
    el.style.opacity = fade.toString();
  }
}

// ─────────────────────────────────────────────────────────────
//  LOAD MODEL
// ─────────────────────────────────────────────────────────────
const loader = new GLTFLoader();

loader.load(
  "./model.glb",
  (gltf) => {
    const model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });

    // Centre
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    scene.add(model);

    // Scale X to layout width
    const sz = box.getSize(new THREE.Vector3());
    scaleFactor = (FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX) / sz.x;
    model.scale.setScalar(scaleFactor);

    // Re-centre after scale
    new THREE.Box3().setFromObject(model).getCenter(model.position).negate();

    // Bounds with a small inset so player can't touch outer walls
    const inset = 0.25 * scaleFactor;
    eyeY = EYE_HEIGHT * scaleFactor;
    bounds = {
      minX: FLAT_BOUNDS.minX * scaleFactor + inset,
      maxX: FLAT_BOUNDS.maxX * scaleFactor - inset,
      minZ: FLAT_BOUNDS.minZ * scaleFactor + inset,
      maxZ: FLAT_BOUNDS.maxZ * scaleFactor - inset,
    };

    // Place player just inside Main Gate
    yawObj.position.set(SPAWN.x * scaleFactor, eyeY, SPAWN.z * scaleFactor);
    yaw = SPAWN.yaw;

    initLabels(scaleFactor);

    info.innerHTML = "🏠 Click anywhere to start exploring";
    setTimeout(() => { info.style.opacity = "0"; }, 4000);
    setTimeout(() => { info.style.display = "none"; }, 4700);
  },
  (xhr) => {
    const pct = xhr.total ? (xhr.loaded / xhr.total * 100).toFixed(1) : "?";
    info.innerHTML = `⏳ Loading… ${pct}%`;
  },
  (err) => { info.innerHTML = "❌ Failed to load model"; console.error(err); }
);

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function clampPosition() {
  if (!bounds) return;
  yawObj.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, yawObj.position.x));
  yawObj.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, yawObj.position.z));
  yawObj.position.y = eyeY; // always locked to eye height
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
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

  if (bounds) {
    // Build wish direction from WASD / arrow keys
    const mf = (keys["KeyW"] || keys["ArrowUp"])    ? 1 : 0;
    const mb = (keys["KeyS"] || keys["ArrowDown"])  ? 1 : 0;
    const ml = (keys["KeyA"] || keys["ArrowLeft"])  ? 1 : 0;
    const mr = (keys["KeyD"] || keys["ArrowRight"]) ? 1 : 0;

    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(   Math.cos(yaw), 0, -Math.sin(yaw));

    _wish.set(0, 0, 0)
      .addScaledVector(_forward, mf - mb)
      .addScaledVector(_right,   mr - ml);

    const moving = _wish.lengthSq() > 0;
    if (moving) _wish.normalize();

    const maxSpd = MAX_SPD * scaleFactor;

    if (moving) {
      // Accelerate
      vel.addScaledVector(_wish, ACCEL * scaleFactor * dt);
      if (vel.length() > maxSpd) vel.setLength(maxSpd);
    } else {
      // Friction / deceleration
      const loss = FRICTION * scaleFactor * dt;
      const cur  = vel.length();
      if (cur > loss) vel.setLength(cur - loss);
      else vel.set(0, 0, 0);
    }

    // Apply velocity
    yawObj.position.addScaledVector(vel, dt);
    clampPosition();
  }

  updateLabels();
  renderer.render(scene, camera);
}

animate();