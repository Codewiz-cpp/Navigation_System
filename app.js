// ---------------- MAP SETUP ----------------
alert("JS IS RUNNING");
console.log("APP RUNNING");
var map = L.map('map', {
  crs: L.CRS.Simple,
  minZoom: -2
});

map.dragging.disable();

// click to get coordinates on the map
  map.on('click', function(e) {
  console.log("X:", e.latlng.lng, "Y:", e.latlng.lat);
});

var bounds = [[0,0],[1400,900]];

L.imageOverlay('./floorplan.png', bounds).addTo(map);

// FORCE FULL IMAGE
map.fitBounds(bounds);

const origin = { x: 661, y: 1266.88 };

function relative(x, y) {
  return {
    x: x - origin.x,
    y: y - origin.y
  };
}

// ---------------- NODES ----------------
const nodes = {
  entrance: relative(661, 1266.88),

  corridor_top: relative(374, 1201.5416717529297),
  corridor_mid: relative(370, 927.5416717529297),
  corridor_bottom: relative(370, 605.5416717529297),

  hall: relative(184, 1075.5416717529297),
  kitchen: relative(528, 939.5416717529297),

  room_entry: relative(368, 489.5416717529297),
  room_center: relative(364, 315.5416717529297)
};

let currentPos = { x: 0, y: 0 };

// ---------------- GRAPH ----------------
const graph = {
  entrance: ["corridor_top"],
  corridor_top: ["entrance", "corridor_mid"],
  corridor_mid: ["corridor_top", "corridor_bottom", "hall", "kitchen"],
  corridor_bottom: ["corridor_mid", "room_entry"],
  room_entry: ["corridor_bottom", "room_center"],
  room_center: ["room_entry"],
  hall: ["corridor_mid"],
  kitchen: ["corridor_mid"]
};

// ---------------- USER MARKER ----------------
var userMarker = L.marker([0,0]).addTo(map);

// ---------------- SET POSITION ----------------
function setPosition(x, y) {
  userMarker.setLatLng([origin.y + y, origin.x + x]);
}

// ---------------- DRAW PATH ----------------
let currentPath;

function drawPath(path) {
  if (currentPath) map.removeLayer(currentPath);

  let coords = path.map(p => {
    let n = nodes[p];
    return [origin.y + n.y, origin.x + n.x];
  });

  currentPath = L.polyline(coords, {color: 'blue'}).addTo(map);
    let navPath = [];
    let navIndex = 0;

}
// follow path
function followPath() {
  if (navIndex >= navPath.length) return;

  let nextNode = nodes[navPath[navIndex]];

  smoothMove(nextNode.x, nextNode.y);

  navIndex++;

  setTimeout(followPath, 800);
}

// A* path
function heuristic(a, b) {
  return Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
}

function getPath(start, end) {
  let openSet = [start];
  let cameFrom = {};

  let gScore = {};
  let fScore = {};

  Object.keys(nodes).forEach(n => {
    gScore[n] = Infinity;
    fScore[n] = Infinity;
  });

  gScore[start] = 0;
  fScore[start] = heuristic(start, end);

  while (openSet.length > 0) {
    let current = openSet.reduce((a, b) => 
      fScore[a] < fScore[b] ? a : b
    );

    if (current === end) {
      let path = [];
      while (current) {
        path.unshift(current);
        current = cameFrom[current];
      }
      return path;
    }

    openSet = openSet.filter(n => n !== current);

    for (let neighbor of graph[current]) {
      let tempG = gScore[current] + heuristic(current, neighbor);

      if (tempG < gScore[neighbor]) {
        cameFrom[neighbor] = current;
        gScore[neighbor] = tempG;
        fScore[neighbor] = tempG + heuristic(neighbor, end);

        if (!openSet.includes(neighbor)) {
          openSet.push(neighbor);
        }
      }
    }
  }

  return [];
}
//smooth movement

function smoothMove(targetX, targetY) {
  let startX = currentPos.x;
  let startY = currentPos.y;

  let steps = 20;
  let i = 0;

  let interval = setInterval(() => {
    let t = i / steps;

    let x = startX + (targetX - startX) * t;
    let y = startY + (targetY - startY) * t;

    setPosition(x, y);

    i++;
    if (i > steps) {
      currentPos.x = targetX;
      currentPos.y = targetY;
      clearInterval(interval);
    }
  }, 20);
}

// ---------------- QR SCAN ----------------
// function onScanSuccess(decodedText) {
//   let data = JSON.parse(decodedText);

//   currentPos.x = data.x;
//   currentPos.y = data.y;

//   setPosition(currentPos.x, currentPos.y);

//   let path = getPath(data.name, "room_center");
//   drawPath(path);

//   scanner.clear(); // stop camera after scan
// }

// const scanner = new Html5QrcodeScanner("reader", {
//   fps: 10,
//   qrbox: 250
// });

// scanner.render(onScanSuccess);

//   currentPos = { x: 0, y: 0 };
//   setPosition(currentPos.x, currentPos.y);
//   currentPos = { x: 0, y: 0 };
// setPosition(currentPos.x, currentPos.y);

//movement function
  function enableMotion() {
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    DeviceMotionEvent.requestPermission().then(res => {
      if (res === "granted") startTracking();
    });
  } else {
    startTracking();
  }
}
//tracking
// function startTracking() {
//   window.addEventListener("devicemotion", function(event) {
//     let acc = event.acceleration;

//     if (!acc) return;

//     currentPos.x += acc.x * 2;
//     currentPos.y += acc.y * 2;

//     setPosition(currentPos.x, currentPos.y);

//     // 🔥 ADD HERE
//     updateNavigation();
//   });
// }
// auto path update
// function updateNavigation() {
//   let nearest = getNearestNode(currentPos);

//   let path = getPath(nearest, "room_center");
//   drawPath(path);
// }
// helper function
function getNearestNode(pos) {
  let minDist = Infinity;
  let closest = null;

  for (let key in nodes) {
    let n = nodes[key];
    let dist = Math.hypot(n.x - pos.x, n.y - pos.y);

    if (dist < minDist) {
      minDist = dist;
      closest = key;
    }
  }

  return closest;
}
// ---------------- QR SCANNER ----------------

function onScanSuccess(decodedText) {
  console.log("QR DATA:", decodedText);

  let data = JSON.parse(decodedText);

  currentPos.x = data.x;
  currentPos.y = data.y;

  setPosition(currentPos.x, currentPos.y);

  drawPath(getPath(data.name, "room_center"));
}

const scanner = new Html5QrcodeScanner("reader", {
  fps: 10,
  qrbox: 250
});

scanner.render(onScanSuccess);
