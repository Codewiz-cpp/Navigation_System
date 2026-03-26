// ---------------- THREE JS SCENE ----------------

let scene = new THREE.Scene();

let camera = new THREE.PerspectiveCamera(
75,
window.innerWidth / (window.innerHeight*0.8),
0.1,
1000
);

let renderer = new THREE.WebGLRenderer({antialias:true});

renderer.setSize(window.innerWidth,window.innerHeight*0.8);

document.getElementById("viewer").appendChild(renderer.domElement);


// lights
const light = new THREE.HemisphereLight(0xffffff,0x444444,1.5);
scene.add(light);


// camera
camera.position.set(0,6,12);


// controls
const controls = new THREE.OrbitControls(camera,renderer.domElement);


// ---------------- LOAD BUILDING ----------------

const loader = new THREE.GLTFLoader();

let building;

loader.load(

"./model.glb",

function(gltf){

building = gltf.scene;

scene.add(building);

},

undefined,

function(err){
console.error(err);
}

);


// ---------------- USER MARKER ----------------

const markerGeo = new THREE.SphereGeometry(0.2,32,32);

const markerMat = new THREE.MeshBasicMaterial({color:0xff0000});

const userMarker = new THREE.Mesh(markerGeo,markerMat);

scene.add(userMarker);


// ---------------- NAVIGATION NODES ----------------

const nodes = {

entrance:{x:0,y:0,z:0},

corridor:{x:-3,y:0,z:-4},

hall:{x:-5,y:0,z:-3},

kitchen:{x:-2,y:0,z:-6},

room:{x:-4,y:0,z:-10}

};


// ---------------- GRAPH ----------------

const graph = {

entrance:["corridor"],

corridor:["entrance","hall","kitchen"],

hall:["corridor"],

kitchen:["corridor","room"],

room:["kitchen"]

};


// ---------------- PATHFINDING ----------------

function heuristic(a,b){

return Math.hypot(
nodes[a].x-nodes[b].x,
nodes[a].z-nodes[b].z
);

}

function getPath(start,end){

let open=[start];

let came={};

let g={};

let f={};

Object.keys(nodes).forEach(n=>{

g[n]=Infinity;
f[n]=Infinity;

});

g[start]=0;
f[start]=heuristic(start,end);

while(open.length>0){

let current=open.reduce((a,b)=>f[a]<f[b]?a:b);

if(current===end){

let path=[];

while(current){

path.unshift(current);

current=came[current];

}

return path;

}

open=open.filter(n=>n!==current);

for(let n of graph[current]){

let temp=g[current]+heuristic(current,n);

if(temp<g[n]){

came[n]=current;

g[n]=temp;

f[n]=temp+heuristic(n,end);

if(!open.includes(n)) open.push(n);

}

}

}

return [];

}


// ---------------- DRAW 3D PATH ----------------

function drawPath(path){

let pts=[];

path.forEach(p=>{

let n=nodes[p];

pts.push(new THREE.Vector3(n.x,n.y,n.z));

});

let geo=new THREE.BufferGeometry().setFromPoints(pts);

let mat=new THREE.LineBasicMaterial({color:0x00ffff});

let line=new THREE.Line(geo,mat);

scene.add(line);

}


// ---------------- SET USER POSITION ----------------

function setPosition(x,y,z){

userMarker.position.set(x,y,z);

}


// ---------------- QR SCANNER ----------------

function onScanSuccess(decodedText){

let data=JSON.parse(decodedText);

setPosition(data.x,data.y,data.z);

let path=getPath(data.name,"room");

drawPath(path);

}

const scanner=new Html5QrcodeScanner("reader",{fps:10,qrbox:250});

scanner.render(onScanSuccess);


// ---------------- RENDER LOOP ----------------

function animate(){

requestAnimationFrame(animate);

controls.update();

renderer.render(scene,camera);

}

animate();