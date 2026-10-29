// ─── SEARCH ─────────────────────────────────────────────────────────────────
function onSearch(val) {
  const dd = document.getElementById("dropdown");
  document.getElementById("search-clear").style.display = val ? "block" : "none";
  if (!val.trim()) { dd.classList.remove("open"); return; }
  const q = val.toLowerCase().trim();

  // Specialized rooms and offices (cafeteria, nurse, library, ...) — shown first
  const placeResults = places.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.type.toLowerCase().includes(q) ||
    (p.room || "").toLowerCase().includes(q) ||
    (p.aliases || []).some(a => a.toLowerCase().includes(q))
  ).slice(0, 4);

  const staffResults = staff.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.last.toLowerCase().includes(q) ||
    s.first.toLowerCase().includes(q) ||
    s.room.toLowerCase().includes(q) ||
    s.room_raw.toLowerCase().includes(q) ||
    s.dept.toLowerCase().includes(q) ||
    s.role.toLowerCase().includes(q)
  ).slice(0, 9 - placeResults.length);

  if (!placeResults.length && !staffResults.length) {
    dd.innerHTML = `<div class="dd-item"><div class="dd-left"><div class="dd-name" style="color:#aaa">No results found</div></div></div>`;
    dd.classList.add("open"); return;
  }

  const floorName = f => f === 0 ? "Ground" : "First";
  const placeHtml = placeResults.map(p => `<div class="dd-item" data-place="${p.name.replace(/"/g, '&quot;')}">
      <div class="dd-left">
        <div class="dd-name">${p.name}</div>
        <div class="dd-role">${p.type}</div>
      </div>
      <div class="dd-badge dd-badge-place">${floorName(p.floor)}${p.room ? " · " + p.room : ""}</div>
    </div>`).join("");

  const staffHtml = staffResults.map(s => {
    const floorLabel = floorName(s.floor);
    return `<div class="dd-item" data-name="${s.name.replace(/"/g, '&quot;')}">
      <div class="dd-left">
        <div class="dd-name">${s.name}</div>
        <div class="dd-role">${s.role}</div>
      </div>
      <div class="dd-badge">${s.room ? floorLabel + " · " + s.room : "No room listed"}</div>
    </div>`;
  }).join("");

  dd.innerHTML = placeHtml + staffHtml;
  dd.classList.add("open");
}

// Destination is a specialized room / office from data/places.json.
// If the place has its own room rect, that room is highlighted; otherwise the
// whole zone is highlighted and routing uses the place's routeRoom anchor
// (falling back to the nearest room in the zone).
function selectPlace(name) {
  const p = places.find(x => x.name === name);
  if (!p) return;
  const zone = zones.find(z => z.id === p.zone);
  if (!zone) { console.warn('[selectPlace] unknown zone for place:', p); return; }
  document.getElementById("dropdown").classList.remove("open");
  document.getElementById("search").value = p.name;
  document.getElementById("search-clear").style.display = "block";

  destPerson = null;
  destPlace = p;
  destZone = p.zone;
  const roomNum = p.room || p.routeRoom;
  destRoom = roomNum ? { room: roomNum, floor: p.floor } : resolveDestRoom(p.zone);
  // Only highlight a single room when the place IS that room
  destRoomFromZone = !p.room;

  currentPath = null;
  if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
  if (youZone || youRoom) recalculatePath();

  if (p.floor !== currentFloor) switchFloor(p.floor);
  showInfo(zone, null);
}
window.selectPlace = selectPlace;

function selectPerson(name) {
  const s = staff.find(x => x.name === name);
  if (!s) return;
  destPlace = null;
  document.getElementById("dropdown").classList.remove("open");
  document.getElementById("search").value = s.name;
  document.getElementById("search-clear").style.display = "block";

  // Explicit person/room selection — mark destRoom as non-zone so the room rect is highlighted
  destRoom = rooms.find(r => r.room === s.room && r.floor === s.floor) || null;
  destRoomFromZone = false;
  console.log('[selectPerson] destRoom after set:', destRoom);

  // Calculate and draw the waypoint path if a starting location is known
  const startRoom = (typeof resolveStartRoom === "function") ? resolveStartRoom() : youRoom;
  console.log('[selectPerson] resolveStartRoom() returned:', startRoom);
  console.log('[selectPerson] recalculatePath() will NOT be called — Pathfinding.findPath() invoked directly below');
  if (startRoom && typeof Pathfinding !== "undefined") {
    const startLabel = youRoom
      ? (youRoom.label || `Room ${startRoom.room}`)
      : (zones.find(z => z.id === youZone)?.label || `Room ${startRoom.room}`);
    const destLabel = `Room ${s.room}`;
    console.log('[selectPerson] calling Pathfinding.findPath:', startRoom.room, startRoom.floor, '→', s.room, s.floor, '| labels:', startLabel, '→', destLabel);
    currentPath = Pathfinding.findPath(startRoom.room, startRoom.floor, s.room, s.floor, startLabel, destLabel);
    console.log('[selectPerson] Pathfinding.findPath() result:', currentPath);
    currentPath ? Pathfinding.drawPath(currentPath) : Pathfinding.clearPath();
  } else {
    console.log('[selectPerson] findPath SKIPPED — startRoom:', startRoom, '| Pathfinding defined:', typeof Pathfinding !== "undefined");
    currentPath = null;
    if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
  }

  const zone = zones.find(z => z.id === s.zone);
  if (!zone) return;
  if (s.floor !== currentFloor) switchFloor(s.floor);
  showInfo(zone, s);
}
// Explicitly expose on window so inline handlers and console can always reach it
window.selectPerson = selectPerson;

function clearSearch() {
  document.getElementById("search").value = "";
  document.getElementById("dropdown").classList.remove("open");
  document.getElementById("search-clear").style.display = "none";
}

// ─── DROPDOWN CLICK (event delegation — no inline onclick needed) ────────────
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("dropdown").addEventListener("click", function (e) {
    const place = e.target.closest(".dd-item[data-place]");
    if (place) { selectPlace(place.dataset.place); return; }
    const item = e.target.closest(".dd-item[data-name]");
    if (item) selectPerson(item.dataset.name);
  });
});

// ─── START POINT SEARCH ───────────────────────────────────────────────────────
// Lets people type where they are (room number, place, or a person's room)
// instead of tapping the map. Only rooms the pathfinder can route from are offered.
function _routableRooms() {
  if (typeof Pathfinding === "undefined") return [];
  return Pathfinding.debugData().roomConnections || [];
}

function _isRoutable(room, floor) {
  return _routableRooms().some(c => c.room === String(room) && c.floor === floor);
}

function _startOptions(q) {
  const opts = [];
  const seen = new Set();
  const add = o => {
    const key = o.room + "|" + o.floor;
    if (seen.has(key + "|" + o.label) || !_isRoutable(o.room, o.floor)) return;
    seen.add(key + "|" + o.label);
    opts.push(o);
  };
  places.forEach(p => {
    const hit = p.name.toLowerCase().includes(q) || (p.aliases || []).some(a => a.toLowerCase().includes(q));
    if (hit) add({ label: p.name, sub: p.type, room: p.room || p.routeRoom, floor: p.floor, zone: p.zone });
  });
  _routableRooms().slice()
    .sort((a, b) => String(a.room).localeCompare(String(b.room), undefined, { numeric: true }))
    .forEach(c => {
    if (String(c.room).toLowerCase().startsWith(q)) add({ label: `Room ${c.room}`, sub: "Room", room: c.room, floor: c.floor });
  });
  staff.forEach(s => {
    if (s.room && s.name.toLowerCase().includes(q)) add({ label: `${s.name}'s room`, sub: `Room ${s.room}`, room: s.room, floor: s.floor, zone: s.zone });
  });
  return opts.slice(0, 8);
}

let _fromOptions = [];
function onFromSearch(val) {
  const dd = document.getElementById("from-dropdown");
  document.getElementById("from-clear").style.display = val ? "block" : "none";
  const q = val.toLowerCase().trim();
  if (!q) { dd.classList.remove("open"); return; }
  _fromOptions = _startOptions(q);
  if (!_fromOptions.length) {
    dd.innerHTML = `<div class="dd-item"><div class="dd-left"><div class="dd-name" style="color:#aaa">No matching room or place</div></div></div>`;
    dd.classList.add("open"); return;
  }
  dd.innerHTML = _fromOptions.map((o, i) => `<div class="dd-item" data-from="${i}">
      <div class="dd-left">
        <div class="dd-name">${o.label}</div>
        <div class="dd-role">${o.sub}</div>
      </div>
      <div class="dd-badge">${o.floor === 0 ? "Ground" : "First"} · ${o.room}</div>
    </div>`).join("");
  dd.classList.add("open");
}

// Zone for a typed start: the zone containing the room, else the nearest zone on that floor
function _zoneForRoom(room, floor) {
  const r = rooms.find(x => x.room === String(room) && x.floor === floor);
  const fz = zones.filter(z => z.floor === floor);
  if (!r || !fz.length) return fz[0] ? fz[0].id : null;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const inside = fz.find(z => cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h);
  if (inside) return inside.id;
  let best = null, bd = Infinity;
  fz.forEach(z => {
    const d = Math.hypot(z.x + z.w / 2 - cx, z.y + z.h / 2 - cy);
    if (d < bd) { bd = d; best = z; }
  });
  return best ? best.id : null;
}

function setStartPoint(o) {
  youRoom = { room: String(o.room), floor: o.floor, label: o.label };
  youZone = (o.zone && zones.some(z => z.id === o.zone)) ? o.zone : _zoneForRoom(o.room, o.floor);
  document.getElementById("from-dropdown").classList.remove("open");
  document.getElementById("from-search").value = o.label;
  document.getElementById("from-search").blur();
  if (destZone) {
    recalculatePath();
    const zone = zones.find(z => z.id === destZone);
    if (zone) showInfo(zone, destPerson);
  } else {
    if (o.floor !== currentFloor) switchFloor(o.floor);
    updateStatus();
    renderMap();
  }
}
window.setStartPoint = setStartPoint;

function clearFromSearch() {
  const inp = document.getElementById("from-search");
  if (inp) inp.value = "";
  const dd = document.getElementById("from-dropdown");
  if (dd) dd.classList.remove("open");
  const btn = document.getElementById("from-clear");
  if (btn) btn.style.display = "none";
}

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("from-dropdown").addEventListener("click", function (e) {
    const item = e.target.closest(".dd-item[data-from]");
    if (item) setStartPoint(_fromOptions[+item.dataset.from]);
  });
});
