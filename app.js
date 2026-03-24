// ---------------- MAP SETUP ----------------
var map = L.map('map', {
  crs: L.CRS.Simple
});

var bounds = [[0,0],[1400,900]];

L.imageOverlay('./floorplan.png', bounds).addTo(map);

map.setMaxBounds(bounds);

const origin = { x: 750, y: 100 }; // adjust later if needed

function relative(x, y) {
  return {
    x: x - origin.x,
    y: y - origin.y
  };
}

// ---------------- NODES ----------------
const nodes = {
  entrance: relative(750, 100),

  corridor_top: relative(750, 250),
  corridor_mid: relative(750, 500),
  corridor_bottom: relative(750, 800),

  hall: relative(500, 500),
  kitchen: relative(850, 500),

  room_entry: relative(750, 1000),
  room_center: relative(750, 1200)
};

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
function drawPath(path) {
  let coords = path.map(p => {
    let n = nodes[p];
    return [origin.y + n.y, origin.x + n.x];
  });

  L.polyline(coords, {color: 'blue'}).addTo(map);
}

// ---------------- SIMPLE PATH (MANUAL) ----------------
function getPath(start, end) {
  // simple logic for your map
  if(start === "kitchen" && end === "room_center") {
    return ["kitchen","corridor_mid","corridor_bottom","room_entry","room_center"];
  }
  if(start === "hall" && end === "room_center") {
    return ["hall","corridor_mid","corridor_bottom","room_entry","room_center"];
  }
  return [];
}

// ---------------- QR SCAN ----------------
function onScanSuccess(decodedText) {
  let data = JSON.parse(decodedText);

  setPosition(data.x, data.y);

  let start = data.name;
  let destination = "room_center";

  let path = getPath(start, destination);

  drawPath(path);
}

new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 })
  .render(onScanSuccess);

  setPosition(nodes.entrance.x, nodes.entrance.y);