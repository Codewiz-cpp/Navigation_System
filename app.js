// ================================================================
//  INDOOR NAVIGATION — app.js
//  Imports MUST be first. Nothing above them. Ever.
// ================================================================
import * as THREE        from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader }    from "three/addons/loaders/GLTFLoader.js";
 
// ================================================================
//  FLAT LAYOUT  (from Layout.json)
//  All coords relative to Main Entrance = origin (0,0)
//  X: -8.5 → 4.5    Z: -14 → 11.5
// ================================================================
const FLAT  = { minX:-8.5, maxX:4.5, minZ:-14, maxZ:11.5 };
const CX    = (FLAT.minX + FLAT.maxX) / 2;   // -2
const CZ    = (FLAT.minZ + FLAT.maxZ) / 2;   // -1.25
const FW    = FLAT.maxX - FLAT.minX;          // 13
const FD    = FLAT.maxZ - FLAT.minZ;          // 25.5
 
// ================================================================
//  FLOOR CONFIG
//  Each flat has ONE router inside it.
//  Trilateration = ownRouter + router below + router above.
//  ⚠️  Replace x/z/bssid when you measure real values.
// ================================================================
const FLOORS = {
  0: {
    label: "Lower Flat",
    router: { id:"LF", x:-5.8, z:6.2,  label:"Lower Router", bssid:"AA:BB:CC:DD:EE:01" }
  },
  1: {
    label: "Your Flat",
    router: { id:"MF", x:-3.4, z:-2.1, label:"Your Router",  bssid:"AA:BB:CC:DD:EE:02" }
  },
  2: {
    label: "Upper Flat",
    router: { id:"UF", x:1.8,  z:8.4,  label:"Upper Router", bssid:"AA:BB:CC:DD:EE:03" }
  }
};
 
// ================================================================
//  WALLS  [x1, z1, x2, z2]
// ================================================================
const WALLS = [
  [-8.5,-14,  -8.5,-2.5],
  [-8.5,-2.5,  -3, -2.5],
  [ -6,  4,    -3,  4  ],
  [ -6,  4,    -6, 11.5],
  [  2.5,11.5,  2.5, 4 ],
  [  2.5,11.5, -6, 11.5],
  [  2.5, 4,    0,  4  ],
  [  0,  4,    0, -2.5 ],
  [  0, -2.5,  4.5,-2.5],
  [  4.5,-2.5, 4.5,-14 ],
  [  4.5,-14, -8.5,-14 ],
  [ -3, -2.5, -3,  4   ],
  [  0,  4,   -3,  4   ],
  [-8.5,-7.5, -6.5,-7.5],
  [  0,  1.5, -1,  1.5 ],
  [  4.5,-8.5,-0.5,-8.5],
];
 
const ROOMS = [
  { label:"Hall",     cx:-5.75, cz:-8.25 },
  { label:"Corridor", cx:-1.5,  cz:-5.0  },
  { label:"Kitchen",  cx: 2.25, cz:-5.25 },
  { label:"Entrance", cx: 2.25, cz:-11.0 },
  { label:"Bedroom",  cx:-1.75, cz: 7.75 },
];
 
// ================================================================
//  A*  PATHFINDING
// ================================================================
let navCache = null;
 
function buildGrid() {
  if (navCache) return navCache;
  const RES = 0.4;
  const cols = Math.ceil(FW / RES) + 4;
  const rows = Math.ceil(FD / RES) + 4;
  const grid = Array.from({length:rows}, ()=>new Uint8Array(cols));
 
  const w2g = (wx,wz) => [
    Math.round((wx - FLAT.minX) / RES),
    Math.round((wz - FLAT.minZ) / RES),
  ];
 
  for (const [x1,z1,x2,z2] of WALLS) {
    const steps = Math.ceil(Math.hypot(x2-x1,z2-z1) / (RES*0.4));
    for (let i=0; i<=steps; i++) {
      const t=i/steps;
      const [c,r] = w2g(x1+(x2-x1)*t, z1+(z2-z1)*t);
      for (let dr=-1;dr<=1;dr++)
        for (let dc=-1;dc<=1;dc++) {
          const nr=r+dr, nc=c+dc;
          if (nr>=0&&nr<rows&&nc>=0&&nc<cols) grid[nr][nc]=1;
        }
    }
  }
 
  navCache = {
    grid, cols, rows, w2g,
    g2w:(c,r)=>({ x:FLAT.minX+c*RES, z:FLAT.minZ+r*RES }),
  };
  return navCache;
}
 
function aStar(sx,sz,ex,ez) {
  const {grid,cols,rows,w2g,g2w} = buildGrid();
  const [sc,sr]=w2g(sx,sz), [ec,er]=w2g(ex,ez);
  const key=(c,r)=>r*cols+c;
  const h=(c,r)=>Math.abs(c-ec)+Math.abs(r-er);
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const open=new Map([[key(sc,sr),h(sc,sr)]]);
  const gS=new Map([[key(sc,sr),0]]);
  const from=new Map();
 
  for (let it=0; open.size>0&&it<80000; it++) {
    let bk=null,bf=Infinity;
    for (const [k,f] of open) { if(f<bf){bf=f;bk=k;} }
    if (!bk) break;
    const cr=Math.floor(bk/cols), cc=bk%cols;
    if (cc===ec&&cr===er) {
      const path=[]; let cur=bk;
      while(from.has(cur)){path.push(g2w(cur%cols,Math.floor(cur/cols)));cur=from.get(cur);}
      path.push(g2w(sc,sr));
      return path.reverse();
    }
    open.delete(bk);
    const g=gS.get(bk);
    for (const [dc,dr] of DIRS) {
      const nc=cc+dc,nr=cr+dr;
      if(nc<0||nc>=cols||nr<0||nr>=rows||grid[nr][nc]) continue;
      const ng=g+(dc&&dr?1.414:1), nk=key(nc,nr);
      if(ng<(gS.get(nk)??Infinity)){gS.set(nk,ng);from.set(nk,bk);open.set(nk,ng+h(nc,nr));}
    }
  }
  return null;
}
 
// ================================================================
//  WIFI TRILATERATION
//  ⚠️  ANDROID: replace getSimRSSI() with real WifiManager.getScanResults()
//               match by .BSSID → use .level (dBm)
// ================================================================
function getSimRSSI(ux,uz) {
  const out={};
  for (const [fid,cfg] of Object.entries(FLOORS)) {
    const r=cfg.router;
    const d=Math.max(0.5,Math.hypot(ux-r.x,uz-r.z));
    out[fid]=-59-20*Math.log10(d)+(Math.random()-0.5)*3;
  }
  return out;
}
function rssi2d(rssi,txP=-59,n=2.5){ return Math.pow(10,(txP-rssi)/(10*n)); }
 
function trilat3(r1,d1,r2,d2,r3,d3){
  const A=2*(r2.x-r1.x),B=2*(r2.z-r1.z);
  const C=d1*d1-d2*d2-r1.x*r1.x+r2.x*r2.x-r1.z*r1.z+r2.z*r2.z;
  const D=2*(r3.x-r2.x),E=2*(r3.z-r2.z);
  const F=d2*d2-d3*d3-r2.x*r2.x+r3.x*r3.x-r2.z*r2.z+r3.z*r3.z;
  const det=A*E-D*B;
  if(Math.abs(det)<0.001) return trilat2(r1,d1,r2,d2);
  return {x:(C*E-F*B)/det,z:(C*D-A*F)/(B*D-E*A)};
}
function trilat2(r1,d1,r2,d2){
  const dx=r2.x-r1.x,dz=r2.z-r1.z;
  const d=Math.sqrt(dx*dx+dz*dz)||0.001;
  const a=(d1*d1-d2*d2+d*d)/(2*d);
  return {x:r1.x+(a/d)*dx,z:r1.z+(a/d)*dz};
}
 
function runTrilat(fi){
  const rssi=getSimRSSI(user.x,user.z);
  const anchors=[];
  [fi, fi-1, fi+1].forEach(id=>{
    if(FLOORS[id]) anchors.push({r:FLOORS[id].router, d:rssi2d(rssi[id])});
  });
  if(anchors.length>=3) return trilat3(anchors[0].r,anchors[0].d,anchors[1].r,anchors[1].d,anchors[2].r,anchors[2].d);
  if(anchors.length===2) return trilat2(anchors[0].r,anchors[0].d,anchors[1].r,anchors[1].d);
  return null;
}
 
// ================================================================
//  USER STATE
// ================================================================
const user={
  x:2.25, z:-11.0, heading:0, floor:1,
 
  wifiCorrect(){
    const fix=runTrilat(this.floor); if(!fix)return;
    const fx=Math.max(FLAT.minX+0.3,Math.min(FLAT.maxX-0.3,fix.x));
    const fz=Math.max(FLAT.minZ+0.3,Math.min(FLAT.maxZ-0.3,fix.z));
    this.x=this.x*0.6+fx*0.4; this.z=this.z*0.6+fz*0.4; this.clamp();
  },
  // ⚠️ QR: call user.qrReset(x,z) when QR scanned
  qrReset(x,z){ this.x=x;this.z=z;this.clamp();syncAvatar();updateHUD();toast(`📍 QR reset (${x.toFixed(1)},${z.toFixed(1)})`); },
  clamp(){
    this.x=Math.max(FLAT.minX+0.3,Math.min(FLAT.maxX-0.3,this.x));
    this.z=Math.max(FLAT.minZ+0.3,Math.min(FLAT.maxZ-0.3,this.z));
  },
};
 
// ================================================================
//  THREE.JS SCENE
// ================================================================
const scene    = new THREE.Scene();
scene.background = new THREE.Color(0x08101e);
scene.fog      = new THREE.FogExp2(0x08101e, 0.008);
 
const camera   = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.05, 500);
 
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.1;
document.body.appendChild(renderer.domElement);
 
// Lights
scene.add(new THREE.AmbientLight(0xaabbcc, 1.2));
const sun=new THREE.DirectionalLight(0xffffff,1.5);
sun.position.set(5,20,10); sun.castShadow=true;
sun.shadow.mapSize.setScalar(2048);
sun.shadow.camera.left=sun.shadow.camera.bottom=-30;
sun.shadow.camera.right=sun.shadow.camera.top=30;
scene.add(sun);
 
// Soft room accent lights
[[-5.75,3,-8.25,0x4477ff,12,12],[-1.5,3,-5,0x44ffaa,12,12],[2.25,3,-7,0xffaa44,12,12],[-1.75,3,7.75,0xaa44ff,12,12]]
  .forEach(([x,y,z,c,i,d])=>{const l=new THREE.PointLight(c,i,d);l.position.set(x,y,z);scene.add(l);});
 
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=0.07;
controls.minDistance=1; controls.maxDistance=150;
controls.target.set(CX,0,CZ);
 
// ================================================================
//  OVERLAY — walls, floor, routers, labels
// ================================================================
let overlay=null;
 
function buildOverlay(fi){
  if(overlay){ scene.remove(overlay); overlay=null; }
  const g=new THREE.Group(); g.name="overlay";
 
  // ── Floor plane (dark teal, clickable) ──
  const floor=new THREE.Mesh(
    new THREE.PlaneGeometry(FW+1,FD+1),
    new THREE.MeshStandardMaterial({color:0x0d2233,roughness:1,metalness:0})
  );
  floor.name="floorPlane";
  floor.rotation.x=-Math.PI/2;
  floor.position.set(CX,-0.01,CZ);
  floor.receiveShadow=true;
  g.add(floor);
 
  // ── Grid ──
  const grid=new THREE.GridHelper(Math.max(FW,FD)+6,32,0x1a3040,0x1a3040);
  grid.position.set(CX,0.005,CZ);
  g.add(grid);
 
  // ── Walls ──
  const wallMat=new THREE.MeshStandardMaterial({
    color:0x00c8ff, emissive:0x004466, emissiveIntensity:0.6,
    roughness:0.4, transparent:true, opacity:0.88
  });
  for (const [x1,z1,x2,z2] of WALLS) {
    const len=Math.hypot(x2-x1,z2-z1);
    const angle=Math.atan2(x2-x1,z2-z1);
    const mx=(x1+x2)/2, mz=(z1+z2)/2;
 
    const wall=new THREE.Mesh(new THREE.BoxGeometry(0.2,2.8,len),wallMat.clone());
    wall.position.set(mx,1.4,mz);
    wall.rotation.y=angle;
    wall.castShadow=true;
    g.add(wall);
 
    // Glowing top cap
    const cap=new THREE.Mesh(
      new THREE.BoxGeometry(0.08,0.06,len),
      new THREE.MeshBasicMaterial({color:0x00ffff})
    );
    cap.position.set(mx,2.83,mz);
    cap.rotation.y=angle;
    g.add(cap);
  }
 
  // ── Room labels ──
  for(const r of ROOMS){
    const sp=makeSprite(r.label,28,"rgba(160,210,255,0.8)");
    sp.position.set(r.cx,3.2,r.cz);
    sp.scale.set(6,2,1);
    g.add(sp);
  }
 
  // ── Routers: own (inside flat) + neighbor floors ──
  const own  =FLOORS[fi].router;
  const below=FLOORS[fi-1]?.router ?? null;
  const above=FLOORS[fi+1]?.router ?? null;
 
  function addRouter(r, isOwn, tag){
    const col  = isOwn ? 0xffaa00 : 0xff6622;
    const size = isOwn ? 0.30 : 0.20;
    const yPos = 1.6;
 
    // Sphere
    const sph=new THREE.Mesh(
      new THREE.SphereGeometry(size,20,20),
      new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:isOwn?1.4:0.6})
    );
    sph.position.set(r.x,yPos,r.z);
    g.add(sph);
 
    // Animated ripple ring (pulsed in animate loop)
    const ring=new THREE.Mesh(
      new THREE.RingGeometry(0.5,0.58,40),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:isOwn?0.5:0.25,side:THREE.DoubleSide})
    );
    ring.name="routerRing";
    ring.rotation.x=-Math.PI/2;
    ring.position.set(r.x,0.06,r.z);
    g.add(ring);
 
    // Label
    const lbl=makeSprite(`${tag} ${r.label}`,isOwn?24:18,
      isOwn?"rgba(255,190,0,1)":"rgba(255,130,60,0.85)");
    lbl.position.set(r.x,yPos+0.65,r.z);
    lbl.scale.set(5,1.6,1);
    g.add(lbl);
 
    // Vertical dashed line down to floor (thin cylinder)
    const line=new THREE.Mesh(
      new THREE.CylinderGeometry(0.02,0.02,yPos,6),
      new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.3})
    );
    line.position.set(r.x,yPos/2,r.z);
    g.add(line);
  }
 
  addRouter(own,  true,  "📡");
  if(below) addRouter(below, false, "↓");
  if(above) addRouter(above, false, "↑");
 
  scene.add(g);
  overlay=g;
}
 
// ================================================================
//  USER AVATAR  (red puck + direction arrow + pulse ring)
// ================================================================
let avatar=null;
 
function buildAvatar(){
  if(avatar){scene.remove(avatar);avatar=null;}
  const g=new THREE.Group(); g.name="avatar";
 
  // Body puck
  const body=new THREE.Mesh(
    new THREE.CylinderGeometry(0.32,0.32,0.14,32),
    new THREE.MeshStandardMaterial({color:0xff2222,emissive:0xff2222,emissiveIntensity:1.4})
  );
  g.add(body);
 
  // Pulse ring
  const ring=new THREE.Mesh(
    new THREE.RingGeometry(0.46,0.62,48),
    new THREE.MeshBasicMaterial({color:0xff4444,transparent:true,opacity:0.55,side:THREE.DoubleSide})
  );
  ring.name="pulse";
  ring.rotation.x=-Math.PI/2;
  ring.position.y=0.08;
  g.add(ring);
 
  // Direction cone (points in -Z = forward)
  const cone=new THREE.Mesh(
    new THREE.ConeGeometry(0.14,0.44,8),
    new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:0.5})
  );
  cone.rotation.x=Math.PI/2;
  cone.position.set(0,0.07,-0.55);
  g.add(cone);
 
  g.position.set(user.x,0.07,user.z);
  scene.add(g);
  avatar=g;
}
 
function syncAvatar(){
  if(!avatar)return;
  avatar.position.set(user.x,0.07,user.z);
  avatar.rotation.y=user.heading;
}
 
// ================================================================
//  3D FLOATING PATH  — Black Myth Wukong style
//    Catmull-Rom tube + floating orbs + destination beacon
// ================================================================
const pathObjs=[];
 
function clearPath(){
  pathObjs.forEach(o=>scene.remove(o));
  pathObjs.length=0;
}
 
function drawPath(pts){
  clearPath();
  if(!pts||pts.length<2)return;
 
  // Smooth curve
  const curve=new THREE.CatmullRomCurve3(
    pts.map(p=>new THREE.Vector3(p.x,0.85,p.z)),false,"centripetal"
  );
  const segs=Math.max(pts.length*4,40);
 
  // Outer glow tube
  const t1=new THREE.Mesh(
    new THREE.TubeGeometry(curve,segs,0.09,8,false),
    new THREE.MeshBasicMaterial({color:0x00ffaa,transparent:true,opacity:0.09,side:THREE.BackSide})
  );
  scene.add(t1); pathObjs.push(t1);
 
  // Core tube
  const t2=new THREE.Mesh(
    new THREE.TubeGeometry(curve,segs,0.038,8,false),
    new THREE.MeshBasicMaterial({color:0x44ffcc,transparent:true,opacity:0.55})
  );
  scene.add(t2); pathObjs.push(t2);
 
  // Floating orbs every ~1.2m
  let acc=0;
  for(let i=1;i<pts.length;i++){
    acc+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z);
    if(acc>=1.2||i===1){ acc=0; spawnOrb(pts[i].x,pts[i].z); }
  }
 
  // Destination beacon
  buildBeacon(pts[pts.length-1].x,pts[pts.length-1].z);
}
 
function spawnOrb(x,z){
  const g=new THREE.Group();
  g.userData={baseY:0.85,phase:Math.random()*Math.PI*2};
 
  // Core
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.11,16,16),
    new THREE.MeshStandardMaterial({color:0x00ffaa,emissive:0x00ffaa,emissiveIntensity:2.8,transparent:true,opacity:0.95})
  ));
  // Glow shell
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.24,16,16),
    new THREE.MeshBasicMaterial({color:0x00ffaa,transparent:true,opacity:0.11,side:THREE.BackSide})
  ));
 
  g.position.set(x,0.85,z);
  scene.add(g); pathObjs.push(g);
}
 
function buildBeacon(x,z){
  const C=0x00ffaa;
 
  // Light column
  const col=new THREE.Mesh(
    new THREE.CylinderGeometry(0.02,0.4,5.5,16,1,true),
    new THREE.MeshBasicMaterial({color:C,transparent:true,opacity:0.2,side:THREE.DoubleSide})
  );
  col.position.set(x,2.75,z);
  scene.add(col); pathObjs.push(col);
 
  // Inner bright column
  const col2=new THREE.Mesh(
    new THREE.CylinderGeometry(0.01,0.12,5.5,8,1,true),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.15,side:THREE.DoubleSide})
  );
  col2.position.set(x,2.75,z);
  scene.add(col2); pathObjs.push(col2);
 
  // Base ring
  const base=new THREE.Mesh(
    new THREE.TorusGeometry(0.5,0.06,8,48),
    new THREE.MeshStandardMaterial({color:C,emissive:C,emissiveIntensity:2})
  );
  base.rotation.x=Math.PI/2;
  base.position.set(x,0.07,z);
  scene.add(base); pathObjs.push(base);
 
  // Spinning ring
  const spin=new THREE.Mesh(
    new THREE.TorusGeometry(0.8,0.035,8,48),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.4})
  );
  spin.position.set(x,2.4,z);
  spin.name="spinRing";
  scene.add(spin); pathObjs.push(spin);
 
  // Top orb
  const top=new THREE.Mesh(
    new THREE.SphereGeometry(0.24,20,20),
    new THREE.MeshStandardMaterial({color:C,emissive:C,emissiveIntensity:4})
  );
  top.position.set(x,5.5,z);
  scene.add(top); pathObjs.push(top);
 
  // Top orb glow
  const topG=new THREE.Mesh(
    new THREE.SphereGeometry(0.46,20,20),
    new THREE.MeshBasicMaterial({color:C,transparent:true,opacity:0.09,side:THREE.BackSide})
  );
  topG.position.set(x,5.5,z);
  scene.add(topG); pathObjs.push(topG);
}
 
// ================================================================
//  CAMERA MODES
// ================================================================
let camMode="overview";
 
const CAM={
  overview(){
    camMode="overview";
    controls.enabled=true;
    controls.maxPolarAngle=Math.PI*0.2;       // nearly top-down, slight tilt allowed
    camera.position.set(CX, 35, CZ+4);        // high enough to see whole flat
    camera.lookAt(CX,0,CZ);
    controls.target.set(CX,0,CZ);
    controls.update();
    setActive("btnOverview");
  },
  orbit(){
    camMode="orbit";
    controls.enabled=true;
    controls.maxPolarAngle=Math.PI*0.82;
    camera.position.set(CX+8,14,CZ+20);
    camera.lookAt(CX,0,CZ);
    controls.target.set(CX,0,CZ);
    controls.update();
    setActive("btnOrbit");
  },
  pov(){
    camMode="pov";
    controls.enabled=false;
    _syncPOV();
    setActive("btnPOV");
  },
};
 
function _syncPOV(){
  const h=user.heading;
  camera.position.set(user.x+Math.sin(h)*0.15,1.72,user.z+Math.cos(h)*0.15);
  camera.lookAt(user.x+Math.sin(h)*7,1.55,user.z+Math.cos(h)*7);
}
 
function setActive(id){
  ["btnOverview","btnOrbit","btnPOV"].forEach(b=>
    document.getElementById(b)?.classList.toggle("active",b===id));
}
 
// ================================================================
//  KEYBOARD MOVEMENT
// ================================================================
const KEYS={};
window.addEventListener("keydown",e=>{ KEYS[e.code]=true; });
window.addEventListener("keyup",  e=>{ KEYS[e.code]=false; });
window.addEventListener("keydown",e=>{
  if(e.key==="1")CAM.overview();
  if(e.key==="2")CAM.orbit();
  if(e.key==="3")CAM.pov();
  if(e.key.toLowerCase()==="n")document.getElementById("btnNav")?.click();
});
 
function handleMovement(){
  let dx=0,dz=0;
  if(KEYS["KeyW"]||KEYS["ArrowUp"])    dz-=1;
  if(KEYS["KeyS"]||KEYS["ArrowDown"])  dz+=1;
  if(KEYS["KeyA"]||KEYS["ArrowLeft"])  dx-=1;
  if(KEYS["KeyD"]||KEYS["ArrowRight"]) dx+=1;
  if(!dx&&!dz)return;
  const l=Math.sqrt(dx*dx+dz*dz);
  user.x+=(dx/l)*0.06; user.z+=(dz/l)*0.06;
  user.heading=Math.atan2(-dx/l,-dz/l);
  user.clamp(); syncAvatar();
  if(camMode==="pov")_syncPOV();
  updateHUD();
}
 
// ================================================================
//  CLICK TO NAVIGATE
// ================================================================
let navActive=false, destOrb=null;
const RC=new THREE.Raycaster(), MV=new THREE.Vector2();
 
renderer.domElement.addEventListener("click",e=>{
  if(!navActive)return;
  MV.x=(e.clientX/innerWidth)*2-1;
  MV.y=-(e.clientY/innerHeight)*2+1;
  RC.setFromCamera(MV,camera);
  const fp=overlay?.children?.find(c=>c.name==="floorPlane");
  if(!fp)return;
  const hit=RC.intersectObject(fp);
  if(!hit.length)return;
 
  if(destOrb){scene.remove(destOrb);destOrb=null;}
  const {x,z}=hit[0].point;
 
  // Yellow destination orb
  const g=new THREE.Group(); g.userData={baseY:0.85,phase:0};
  [
    [0.17,0xffff00,3,  false],
    [0.34,0xffff00,0,  true ],
  ].forEach(([r,c,ei,back])=>{
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r,16,16),
      back
        ? new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.12,side:THREE.BackSide})
        : new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:ei})
    ));
  });
  g.position.set(x,0.85,z);
  scene.add(g); destOrb=g;
 
  const path=aStar(user.x,user.z,x,z);
  if(path){ drawPath(path); toast(`✅ Path — ${path.length} waypoints`); }
  else     toast("❌ No path — try clicking inside a room");
 
  navActive=false;
  document.getElementById("btnNav")?.classList.remove("active");
  renderer.domElement.style.cursor="default";
});
 
// ================================================================
//  FLOOR SWITCH
// ================================================================
let curFloor=1;
window.switchFloor=function(idx){
  curFloor=parseInt(idx); user.floor=curFloor;
  buildOverlay(curFloor); buildAvatar(); clearPath();
  if(destOrb){scene.remove(destOrb);destOrb=null;}
  updateHUD();
  document.querySelectorAll(".floor-btn").forEach(b=>
    b.classList.toggle("active",parseInt(b.dataset.floor)===curFloor));
  toast(`🏠 ${FLOORS[curFloor].label}`);
};
 
// ================================================================
//  GLB MODEL LOADER  (optional — works without model.glb)
// ================================================================
function hideLoader(){
  const l=document.getElementById("loader");
  if(l){l.style.opacity="0";setTimeout(()=>l.style.display="none",600);}
}
 
new GLTFLoader().load(
  "./model.glb",
  gltf=>{
    const m=gltf.scene;
    const box=new THREE.Box3().setFromObject(m);
    const sz=box.getSize(new THREE.Vector3());
    const sc=Math.min(FW/sz.x,FD/sz.z);
    m.scale.setScalar(sc);
    const box2=new THREE.Box3().setFromObject(m);
    const c2=box2.getCenter(new THREE.Vector3());
    m.position.set(CX-c2.x,-box2.min.y,CZ-c2.z);
    m.traverse(c=>{
      if(!c.isMesh)return;
      c.castShadow=c.receiveShadow=true;
      (Array.isArray(c.material)?c.material:[c.material]).forEach(mat=>{
        mat.transparent=true; mat.opacity=0.78;
      });
    });
    scene.add(m);
    hideLoader(); toast("✅ 3D model loaded");
  },
  xhr=>{
    const p=xhr.total?(xhr.loaded/xhr.total*100).toFixed(0):"?";
    const el=document.getElementById("loadPct");
    if(el)el.textContent=p+"%";
  },
  ()=>{ hideLoader(); toast("Layout overlay mode (no model.glb)"); }
);
 
// ================================================================
//  HUD & TOAST
// ================================================================
function updateHUD(){
  const cfg=FLOORS[curFloor];
  const el=document.getElementById("hudContent"); if(!el)return;
  el.innerHTML=`
    <div class="hud-row"><span class="hud-label">Floor</span><span class="hud-val">${cfg.label}</span></div>
    <div class="hud-row"><span class="hud-label">X</span><span class="hud-val">${user.x.toFixed(2)} m</span></div>
    <div class="hud-row"><span class="hud-label">Z</span><span class="hud-val">${user.z.toFixed(2)} m</span></div>
    <div class="hud-row"><span class="hud-label">Heading</span><span class="hud-val">${(user.heading*180/Math.PI).toFixed(0)}°</span></div>
    <div class="hud-row"><span class="hud-label">Anchor</span><span class="hud-val anchor">${cfg.router.label}</span></div>
  `;
}
 
function toast(msg){
  const t=document.getElementById("toast"); if(!t)return;
  t.textContent=msg; t.style.opacity="1"; t.style.transform="translateY(0)";
  clearTimeout(t._t);
  t._t=setTimeout(()=>{t.style.opacity="0";t.style.transform="translateY(10px)";},3500);
}
 
// ================================================================
//  TEXT SPRITE
// ================================================================
function makeSprite(text,size,color){
  const cv=document.createElement("canvas");
  cv.width=512; cv.height=128;
  const ctx=cv.getContext("2d");
  ctx.font=`bold ${size}px Arial`;
  ctx.fillStyle=color;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(text,256,64);
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false
  }));
}
 
// ================================================================
//  ANIMATION LOOP
// ================================================================
let t0=0;
function animate(now=0){
  requestAnimationFrame(animate);
  const t=now*0.001;
  handleMovement();
  controls.update();
 
  // Avatar pulse ring
  const ring=avatar?.getObjectByName("pulse");
  if(ring){
    ring.material.opacity=0.3+0.35*Math.sin(t*3.5);
    const s=1+0.14*Math.sin(t*2.5); ring.scale.set(s,s,1);
  }
 
  // Path orbs bob + beacon spin
  pathObjs.forEach(o=>{
    if(o.userData?.baseY!==undefined)
      o.position.y=o.userData.baseY+0.18*Math.sin(t*2.2+o.userData.phase);
    if(o.name==="spinRing") o.rotation.y+=0.018;
  });
 
  // Destination orb bob
  if(destOrb) destOrb.position.y=0.85+0.15*Math.sin(t*3.2);
 
  // Router rings ripple
  overlay?.children?.forEach(c=>{
    if(c.name==="routerRing"){
      const s=1+0.18*Math.sin(t*2+c.position.x);
      c.scale.set(s,s,1);
    }
  });
 
  renderer.render(scene,camera);
}
 
// ================================================================
//  INIT  — runs after DOM is ready
// ================================================================
window.addEventListener("DOMContentLoaded",()=>{
  buildOverlay(curFloor);
  buildAvatar();
  CAM.overview();
  updateHUD();
 
  // Button wiring
  document.getElementById("btnOverview")?.addEventListener("click",CAM.overview);
  document.getElementById("btnOrbit")   ?.addEventListener("click",CAM.orbit);
  document.getElementById("btnPOV")     ?.addEventListener("click",CAM.pov);
 
  document.getElementById("btnNav")?.addEventListener("click",()=>{
    navActive=!navActive;
    document.getElementById("btnNav").classList.toggle("active",navActive);
    renderer.domElement.style.cursor=navActive?"crosshair":"default";
    toast(navActive?"🗺 Click on the floor to set destination":"Navigation cancelled");
  });
 
  document.getElementById("btnClear")?.addEventListener("click",()=>{
    clearPath();
    if(destOrb){scene.remove(destOrb);destOrb=null;}
    toast("Path cleared");
  });
 
  document.getElementById("btnWifi")?.addEventListener("click",()=>{
    user.wifiCorrect(); syncAvatar(); updateHUD();
    toast("📡 WiFi fix applied");
  });
 
  document.querySelectorAll(".floor-btn").forEach(b=>
    b.addEventListener("click",()=>window.switchFloor(b.dataset.floor)));
 
  // Periodic WiFi correction every 4s
  setInterval(()=>{ user.wifiCorrect(); syncAvatar(); updateHUD(); },4000);
 
  animate();
});
 
window.addEventListener("resize",()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});