import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const info = document.getElementById("info");

// ---------------- FLAT BOUNDS (from layout JSON) ----------------
// Flat spans X: -8.5 to 4.5, Z: -14 to 11.5
const FLAT_BOUNDS = {
  minX: -8.5,
  maxX: 4.5,
  minZ: -14,
  maxZ: 11.5,
  minY: 0,
  maxY: 4,       // max height (ceiling ~2.8m + some buffer)
};

// Main hall center (Slab 2 corridor area)
const MAIN_HALL = {
  x: -1.5,      // center of corridor slab (-3 to 0)
  y: 2.5,       // eye-level height
  z: 1.0,       // center of corridor slab (-2.5 to 4.5)
};

// ---------------- SCENE ----------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

// ---------------- CAMERA ----------------
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.001,
  10000
);

// ---------------- RENDERER ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// ---------------- LIGHTS ----------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// ---------------- CONTROLS ----------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.zoomSpeed = 2;       // we handle zoom manually

controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
};

// ---------------- LOAD MODEL ----------------
const loader = new GLTFLoader();

loader.load(
  "./model.glb",
  (gltf) => {
    const model = gltf.scene;

    // Compute actual model bounds BEFORE scaling
    const box = new THREE.Box3().setFromObject(model);
    const modelSize = box.getSize(new THREE.Vector3());
    const modelCenter = box.getCenter(new THREE.Vector3());

    // The layout JSON uses real-world meters, model should match
    // Center model at origin based on its actual center
    model.position.sub(modelCenter);
    scene.add(model);

    // Re-compute bounds after centering
    const box2 = new THREE.Box3().setFromObject(model);

    // Figure out scale factor: flat is ~13 units wide (X: -8.5 to 4.5)
    // so model should roughly match that
    const flatWidth = FLAT_BOUNDS.maxX - FLAT_BOUNDS.minX; // 13
    const scaleFactor = flatWidth / modelSize.x;
    model.scale.setScalar(scaleFactor);

    // Re-center after scaling
    const box3 = new THREE.Box3().setFromObject(model);
    const center3 = box3.getCenter(new THREE.Vector3());
    model.position.sub(center3);

    // ---- CAMERA: Start at Main Hall ----
    // Scale the hall coords to match the model's actual scale
    const scaleRatio = scaleFactor;
    const startX = MAIN_HALL.x * scaleRatio;
    const startY = MAIN_HALL.y * scaleRatio;
    const startZ = MAIN_HALL.z * scaleRatio;

    camera.position.set(startX, startY, startZ + 3); // slightly behind hall center
    controls.target.set(startX, startY, startZ);     // look into hall
    camera.near = 0.01;
    camera.far = 10000;
    camera.updateProjectionMatrix();
    controls.update();

    // ---- BOUNDS: scaled flat limits ----
    const bMinX = FLAT_BOUNDS.minX * scaleRatio;
    const bMaxX = FLAT_BOUNDS.maxX * scaleRatio;
    const bMinZ = FLAT_BOUNDS.minZ * scaleRatio;
    const bMaxZ = FLAT_BOUNDS.maxZ * scaleRatio;
    const bMinY = FLAT_BOUNDS.minY * scaleRatio;
    const bMaxY = FLAT_BOUNDS.maxY * scaleRatio;

    // ---- CLAMP CAMERA after each control update ----
    controls.addEventListener("change", () => {
      camera.position.x = Math.max(bMinX, Math.min(bMaxX, camera.position.x));
      camera.position.y = Math.max(bMinY, Math.min(bMaxY, camera.position.y));
      camera.position.z = Math.max(bMinZ, Math.min(bMaxZ, camera.position.z));

      controls.target.x = Math.max(bMinX, Math.min(bMaxX, controls.target.x));
      controls.target.y = Math.max(bMinY, Math.min(bMaxY, controls.target.y));
      controls.target.z = Math.max(bMinZ, Math.min(bMaxZ, controls.target.z));
    });

    info.innerHTML = `✅ Starting from Main Hall`;
    setTimeout(() => info.style.display = "none", 3000);
  },
  (xhr) => {
    const pct = xhr.total ? (xhr.loaded / xhr.total * 100).toFixed(1) : "?";
    info.innerHTML = `⏳ Loading... ${pct}%`;
  },
  (err) => {
    info.innerHTML = `❌ Error loading model`;
    console.error("Model error:", err);
  }
);

// ---------------- INFINITE ZOOM ----------------
renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();

  const dir = new THREE.Vector3();
  dir.subVectors(controls.target, camera.position).normalize();

  const speed = camera.position.distanceTo(controls.target) * 0.1;
  const delta = e.deltaY > 0 ? -speed : speed;

  const newPos = camera.position.clone().addScaledVector(dir, delta);
  const newTarget = controls.target.clone().addScaledVector(dir, delta * 0.5);

  camera.position.copy(newPos);
  controls.target.copy(newTarget);
  controls.update();

}, { passive: false });

// ---------------- RESIZE ----------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- ANIMATE ----------------
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();