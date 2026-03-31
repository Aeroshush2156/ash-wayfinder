const DEPT_EMOJI = {"Sciences": "⚗️", "Mathematics": "📐", "English": "📖", "Social Studies": "🗺️", "Modern Languages": "🌍", "PE / Health": "🏃", "Visual Arts": "🎨", "Performing Arts": "🎭", "Design & Food Tech": "🍳", "Counseling": "🧠", "Learning Support": "💡", "Library": "📚", "IT / CS": "💻", "Administration": "🏢", "Staff": "👤"};

// ─── STATE ──────────────────────────────────────────────────────────────────
let currentFloor = 0;
let youZone   = null;
let destZone  = null;
let destRoom  = null;   // resolved room used for pathfinding
let destRoomFromZone = false; // true when destRoom was resolved from a zone tap (not an explicit room/person)
let destPerson = null;
let mapScale  = 1;
let youRoom   = null;   // { room, floor } — user's precise starting room
let currentPath = null; // last A* result from Pathfinding.findPath()

// ─── LOAD DATA ───────────────────────────────────────────────────────────────
let staff = [];
let rooms = [];

// Load staff — triggers the initial render
fetch("data/staff.json")
  .then(r => r.json())
  .then(data => {
    staff = data;
    staff.forEach(s => {
      if (s.floor === 1 && s.zone === "modlang") s.zone = "modlang_f";
      if (s.floor === 1 && s.zone === "sciences" && parseFloat(s.room) >= 2.44 && parseFloat(s.room) <= 2.48) s.zone = "hs_sci_f";
    });
    document.getElementById("staff-count").textContent = staff.length + " staff";
    renderMap();
  });

// Load rooms independently — must complete before a user could realistically search
fetch("data/rooms.json")
  .then(r => { if (!r.ok) throw new Error("rooms fetch failed"); return r.json(); })
  .then(data => {
    rooms = Array.isArray(data) ? data : [];
    console.log("[rooms] loaded", rooms.length, "rooms from data/rooms.json");
  })
  .catch(() => {
    const saved = localStorage.getItem("rooms");
    if (saved) {
      try { rooms = JSON.parse(saved); } catch(e) {}
    }
    console.log("[rooms] loaded", rooms.length, "rooms from localStorage");
  });

// ─── RENDER MAP ─────────────────────────────────────────────────────────────
function renderMap() {
  if (typeof editMode !== 'undefined' && editMode) { renderEditMap(); return; }
  const layer = document.getElementById("zones-layer");
  const fl = zones.filter(z => z.floor === currentFloor);
  let html = ``;

  fl.forEach(z => {
    let fill, stroke, opacity = 0.55;
    if (z.id === youZone) { fill="#c7d9ff"; stroke="#4f7fff"; opacity=0.88; }
    else if (z.id === destZone && !destRoom) { fill="#ffc7c7"; stroke="#dc2626"; opacity=0.88; }
    else if (z.id === destZone &&  destRoom) { fill="#ffeaea"; stroke="#f87171"; opacity=0.4; }
    else if (z.type === "special") { fill="#fef9c3"; stroke="#ca8a04"; opacity=0.45; }
    else                        { fill="#d1fae5"; stroke="#16a34a"; opacity=0.5; }

    const count = staff.filter(s => s.zone === z.id && s.floor === currentFloor).length;
    const countLabel = count > 0 ? `${count} staff` : "";

    html += `<g onclick="zoneClick('${z.id}')" style="cursor:pointer" role="button" aria-label="${z.label}">
      <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="7"
        fill="${fill}" stroke="${stroke}" stroke-width="2.5" opacity="${opacity}"/>`;

    const cx = z.x + z.w/2, cy = z.y + z.h/2;
    const labelY = cy;
    const countY = cy + 18;

    html += `<text x="${cx}" y="${labelY}" text-anchor="middle" dominant-baseline="central"
      font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
      font-size="${z.w < 100 ? 10 : 12}" font-weight="700"
      fill="${stroke}">${z.label}</text>`;
    if (countLabel && z.h > 70) {
      html += `<text x="${cx}" y="${countY}" text-anchor="middle" dominant-baseline="central"
        font-family="-apple-system,BlinkMacSystemFont,sans-serif"
        font-size="10" fill="${stroke}" opacity="0.8">${countLabel}</text>`;
    }
    if (z.id === youZone) {
      html += `<text x="${cx}" y="${countY+14}" text-anchor="middle" font-size="10" fill="#4f7fff" font-family="inherit" font-weight="700">📍 You</text>`;
    }
    if (z.id === destZone && !destRoom) {
      html += `<text x="${cx}" y="${countY+14}" text-anchor="middle" font-size="10" fill="#dc2626" font-family="inherit" font-weight="700">🎯 Dest</text>`;
    }
    html += `</g>`;
  });

  layer.innerHTML = html;

  // ── Rooms layer ───────────────────────────────────────────────────────────
  const roomsLayer = document.getElementById("rooms-layer");
  if (roomsLayer) {
    const flRooms = rooms.filter(r => r.floor === currentFloor);
    roomsLayer.innerHTML = flRooms.map(r => {
      const isYouRoom = youRoom !== null &&
                        r.room === youRoom.room &&
                        r.floor === youRoom.floor;
      const isTarget  = !destRoomFromZone &&
                        destRoom !== null &&
                        typeof destRoom === "object" &&
                        r.room === destRoom.room &&
                        r.floor === destRoom.floor;
      const fill   = isYouRoom ? "rgba(199,217,255,0.55)"
                   : isTarget  ? "rgba(220,38,38,.22)"
                   :              "rgba(255,255,255,0.0)";
      const stroke = isYouRoom ? "#4f7fff"
                   : isTarget  ? "#dc2626"
                   :              "rgba(100,100,100,0.35)";
      const sw     = (isYouRoom || isTarget) ? 2.5 : 1;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const fs = Math.max(8, Math.min(Math.floor(r.w * 0.3), Math.floor(r.h * 0.55), 18));
      const labelColor = isYouRoom ? "#4f7fff" : isTarget ? "#dc2626" : "rgba(80,80,80,0.6)";
      return `<g onclick="roomClick('${r.room}', ${r.floor})" style="cursor:pointer" pointer-events="all">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3"
          fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
          font-size="${fs}" font-weight="700" fill="${labelColor}"
          pointer-events="none">${r.room}</text>
        ${isYouRoom ? `<text x="${cx}" y="${r.y + r.h + 14}" text-anchor="middle"
          font-size="10" fill="#4f7fff" font-family="inherit" font-weight="700"
          pointer-events="none">📍 You</text>` : ""}
        ${isTarget ? `<text x="${cx}" y="${r.y + r.h + 14}" text-anchor="middle"
          font-size="10" fill="#dc2626" font-family="inherit" font-weight="700"
          pointer-events="none">🎯 Dest</text>` : ""}
      </g>`;
    }).join("");
  }

  // Keep pathfinding path visible on the correct floor after every re-render
  if (typeof Pathfinding !== "undefined") Pathfinding.setFloor(currentFloor);
}

function switchFloor(f) {
  currentFloor = f;
  document.getElementById("fb0").classList.toggle("active", f===0);
  document.getElementById("fb1").classList.toggle("active", f===1);
  renderMap();
  updateStatus();
}

// ─── ZONE CLICK ─────────────────────────────────────────────────────────────
function zoneClick(id) {
  if (typeof editMode !== 'undefined' && editMode) return;
  if (!youZone) {
    youZone = id;
    updateStatus();
    renderMap();
    document.getElementById("search").focus();
    document.getElementById("search").blur();
  } else if (id !== youZone) {
    destZone = id;
    destRoom = resolveDestRoom(id);
    destRoomFromZone = true;
    destPerson = null;
    currentPath = null;
    if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
    recalculatePath();
    const zone = zones.find(z => z.id === id);
    showInfo(zone, null);
  }
}

// ─── STATUS BAR ─────────────────────────────────────────────────────────────
function updateStatus() {
  const pill = document.getElementById("status-pill");
  const txt  = document.getElementById("status-text");
  const btn  = document.getElementById("clear-btn");
  if (!youZone) {
    pill.className="status-pill gray"; pill.textContent="No location";
    txt.textContent="Tap a zone on the map to set your location"; btn.style.display="none";
  } else if (!destZone) {
    const z = zones.find(x => x.id === youZone);
    pill.className="status-pill blue"; pill.textContent="📍 " + z.label;
    txt.textContent="Now search for a teacher or tap a destination"; btn.style.display="inline";
  } else {
    const yz = zones.find(x => x.id === youZone);
    const dz = zones.find(x => x.id === destZone);
    pill.className="status-pill red"; pill.textContent="🎯 " + dz.label;
    txt.textContent="From " + yz.label; btn.style.display="inline";
  }
}

// ─── INFO PANEL ─────────────────────────────────────────────────────────────
function showInfo(zone, person) {
  destZone = zone.id;
  destPerson = person;
  document.getElementById("info-panel").classList.add("visible");

  const emoji = person ? (DEPT_EMOJI[person.dept] || "👤") : "🏫";
  document.getElementById("info-avatar").textContent = emoji;
  document.getElementById("info-name").textContent = person ? person.name : zone.label;
  document.getElementById("info-role").textContent = person ? person.role : (zone.dept || "");

  document.getElementById("badge-room").textContent = person ? "Room " + person.room : "";
  document.getElementById("badge-room").style.display = person ? "" : "none";
  document.getElementById("badge-floor").textContent = "Floor " + (zone.floor === 0 ? "Ground" : "First");
  document.getElementById("badge-dept").textContent = person ? person.dept : zone.label;

  // Directions
  let dir = "";
  if (!youZone) {
    dir = "Tap a zone on the map to set your starting location and get directions here.";
  } else {
    const yz = zones.find(z => z.id === youZone);
    if (yz.floor !== zone.floor) {
      const up = zone.floor > yz.floor;
      dir = `Head to the stairs from ${yz.label} and go ${up?"up to the First":"down to the Ground"} Floor. Then make your way to the ${zone.label} area${person ? " and look for " + person.name + "." : "."}`;
    } else {
      const personStr = person ? `Ask for ${person.name}${person.room ? " in room " + person.room : ""}.` : "";
      dir = `From ${yz.label}, head to the ${zone.label} area on the ${zone.floor===0?"Ground":"First"} Floor. ${personStr}`;
    }
  }
  document.getElementById("dir-text").textContent = dir;
  document.getElementById("raw-room").textContent = person && person.room_raw && person.room_raw !== person.room
    ? "All listed locations: " + person.room_raw : "";

  // ── Turn-by-turn instructions from pathfinding ────────────────────────────
  const instrEl = document.getElementById("path-instructions");
  if (instrEl) {
    if (currentPath && currentPath.instructions && currentPath.instructions.length) {
      instrEl.style.display = "";
      instrEl.innerHTML =
        `<div class="dir-label" style="margin-top:12px">Step-by-step directions</div>
         <ol style="padding-left:1.3em;margin:6px 0 0;font-size:13px;line-height:1.7;color:#374151">` +
        currentPath.instructions.map(step => `<li>${step}</li>`).join("") +
        `</ol>`;
    } else {
      instrEl.style.display = "none";
      instrEl.innerHTML = "";
    }
  }

  // ── Staff list for zone destinations ─────────────────────────────────────
  const staffListEl = document.getElementById("zone-staff-list");
  if (staffListEl) {
    if (!person) {
      const zoneStaff = staff
        .filter(s => s.zone === zone.id && s.floor === zone.floor)
        .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
      if (zoneStaff.length) {
        staffListEl.style.display = "";
        staffListEl.innerHTML =
          `<div class="dir-label" style="margin-top:12px">Staff in this area</div>
           <ul style="padding-left:0;margin:6px 0 0;list-style:none;font-size:13px;line-height:1.8;color:#374151">` +
          zoneStaff.map(s =>
            `<li style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #f0f0f0;padding:2px 0">
               <span>${s.name}</span>
               <span style="color:#6b7280;white-space:nowrap">Rm ${s.room}</span>
             </li>`
          ).join("") +
          `</ul>`;
      } else {
        staffListEl.style.display = "none";
        staffListEl.innerHTML = "";
      }
    } else {
      staffListEl.style.display = "none";
      staffListEl.innerHTML = "";
    }
  }

  updateStatus();
  renderMap();

  setTimeout(() => document.getElementById("info-panel").scrollIntoView({behavior:"smooth",block:"nearest"}), 100);
}

// ─── ROOM CLICK ──────────────────────────────────────────────────────────────
// Mirrors zoneClick logic so room rects drive start/dest selection correctly,
// and also sets youRoom for precise pathfinding.
function roomClick(room, floor) {
  if (typeof editMode !== 'undefined' && editMode) return;

  // Find the zone that contains this room
  const rd = rooms.find(r => r.room === room && r.floor === floor);
  let zoneId = null;
  if (rd) {
    const cx = rd.x + rd.w / 2, cy = rd.y + rd.h / 2;
    const z = zones.find(z => z.floor === floor &&
      cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h);
    if (z) zoneId = z.id;
  }

  if (!youZone) {
    // First click: set start location (room + zone)
    youRoom = { room, floor };
    if (zoneId) { youZone = zoneId; updateStatus(); }
    renderMap();
    document.getElementById("search").focus();
    document.getElementById("search").blur();
  } else if (zoneId && zoneId !== youZone) {
    // Clicking a room in a different zone: set as destination
    destZone = zoneId;
    destRoom = null;
    destPerson = null;
    currentPath = null;
    if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
    const zone = zones.find(z => z.id === zoneId);
    showInfo(zone, null);
    renderMap();
  } else {
    // Clicking a room in the current start zone: refine your precise room
    youRoom = { room, floor };
    recalculatePath();
    renderMap();
  }
}

// Returns the room rect within a zone whose center is closest to the zone center.
// Falls back to the nearest room on the same floor by Euclidean distance from the
// zone center if no rooms have their center inside the zone bounding box.
function resolveRoomForZone(zoneId) {
  const z = zones.find(z => z.id === zoneId);
  if (!z) return null;
  const cx = z.x + z.w / 2, cy = z.y + z.h / 2;

  const floorRooms = rooms.filter(r => r.floor === z.floor);
  const zoneRooms = floorRooms.filter(r =>
    (r.x + r.w / 2) >= z.x && (r.x + r.w / 2) <= z.x + z.w &&
    (r.y + r.h / 2) >= z.y && (r.y + r.h / 2) <= z.y + z.h
  );

  console.log(`[resolveRoomForZone] zone="${zoneId}" bbox=(${z.x},${z.y} → ${z.x+z.w},${z.y+z.h}) floor=${z.floor} — ${floorRooms.length} floor rooms, ${zoneRooms.length} inside bbox`, zoneRooms.map(r => r.room));

  const candidates = zoneRooms.length ? zoneRooms : floorRooms;
  if (!candidates.length) return null;

  let best = null, bestDist = Infinity;
  candidates.forEach(r => {
    const d = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
    if (d < bestDist) { bestDist = d; best = r; }
  });

  const result = best ? { room: best.room, floor: best.floor } : null;
  console.log(`[resolveRoomForZone] resolved zone="${zoneId}" → room=${result ? result.room : null} (${zoneRooms.length ? 'in bbox' : 'nearest fallback'}, dist=${bestDist.toFixed(1)})`);
  return result;
}

// Returns explicit youRoom, or falls back to the nearest room in youZone.
function resolveStartRoom() {
  if (youRoom) {
    console.log('[resolveStartRoom] using explicit youRoom:', youRoom.room, 'floor', youRoom.floor);
    return youRoom;
  }
  const resolved = resolveRoomForZone(youZone);
  console.log('[resolveStartRoom] resolved from zone', youZone, '→', resolved ? resolved.room : null, resolved ? 'floor ' + resolved.floor : '');
  return resolved;
}

// Returns the nearest room for a destination zone — nearest within bbox, falling
// back to nearest on the same floor if the bbox contains no rooms.
function resolveDestRoom(zoneId) {
  const z = zones.find(z => z.id === zoneId);
  console.log('[resolveDestRoom] zoneId:', zoneId, '| zone object:', z);
  console.log('[resolveDestRoom] rooms array length:', rooms.length, '| rooms:', rooms);
  const resolved = resolveRoomForZone(zoneId);
  console.log('[resolveDestRoom] final result:', resolved);
  return resolved;
}

function recalculatePath() {
  const startRoom = resolveStartRoom();
  if (!startRoom || !destRoom || typeof Pathfinding === "undefined") {
    console.log('[app] recalculatePath skipped — startRoom:', startRoom, 'destRoom:', destRoom, 'Pathfinding defined:', typeof Pathfinding !== "undefined");
    currentPath = null;
    if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
    return;
  }
  const startLabel = youRoom
    ? `Room ${startRoom.room}`
    : (zones.find(z => z.id === youZone)?.label || `Room ${startRoom.room}`);
  const destLabel = destRoomFromZone
    ? (zones.find(z => z.id === destZone)?.label || `Room ${destRoom.room}`)
    : `Room ${destRoom.room}`;
  console.log('[app] calling Pathfinding.findPath:', startRoom.room, startRoom.floor, '→', destRoom.room, destRoom.floor, '| labels:', startLabel, '→', destLabel);
  currentPath = Pathfinding.findPath(startRoom.room, startRoom.floor, destRoom.room, destRoom.floor, startLabel, destLabel);
  console.log('[app] findPath result:', currentPath);
  if (currentPath) Pathfinding.drawPath(currentPath);
  else { Pathfinding.clearPath(); currentPath = null; }
}

function clearAll() {
  youZone = null; destZone = null; destRoom = null; destRoomFromZone = false; destPerson = null;
  youRoom = null; currentPath = null;
  if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
  document.getElementById("info-panel").classList.remove("visible");
  const instrEl = document.getElementById("path-instructions");
  if (instrEl) { instrEl.style.display = "none"; instrEl.innerHTML = ""; }
  const staffListEl = document.getElementById("zone-staff-list");
  if (staffListEl) { staffListEl.style.display = "none"; staffListEl.innerHTML = ""; }
  clearSearch();
  updateStatus();
  renderMap();
}

// ─── ZOOM ────────────────────────────────────────────────────────────────────
function zoomIn()  { mapScale = Math.min(mapScale*1.5, 5); applyZoom(); }
function zoomOut() { mapScale = Math.max(mapScale/1.5, 1); applyZoom(); }
function resetZoom() { mapScale = 1; applyZoom(); }
function applyZoom() {
  const svg = document.getElementById("overlay-svg");
  if (mapScale === 1) {
    svg.style.width = "";   // let CSS width:100% handle it
  } else {
    const containerW = document.getElementById("map-scroll").clientWidth;
    svg.style.width = Math.round(containerW * mapScale) + "px";
  }
}

window.addEventListener("resize", applyZoom);

// ─── CSV IMPORT ──────────────────────────────────────────────────────────────
function handleCSV(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split("\n").filter(l=>l.trim());
    const hdr = lines[0].toLowerCase().split(",").map(h=>h.trim().replace(/"/g,""));
    const col = k => hdr.indexOf(k);
    const ni=col("name"), ri=col("room"), fi=col("floor"), di=-1, zi=col("zone");
    if (ni===-1||ri===-1) { alert("CSV needs at minimum 'name' and 'room' columns."); return; }
    const out = [];
    for(let i=1;i<lines.length;i++) {
      const c = lines[i].split(",").map(x=>x.trim().replace(/^"|"$/g,""));
      if(!c[ni]) continue;
      const fl = fi!==-1 ? (c[fi]==="1"||c[fi].includes("first") ? 1 : 0) : 0;
      out.push({ name:c[ni], last:c[ni].split(" ").pop(), first:c[ni].split(" ")[0],
        room:c[ri], room_raw:c[ri], role:"", dept:c[di]||"Staff", floor:fl, zone:c[zi]||"ms_rooms_g" });
    }
    staff = out;
    document.getElementById("staff-count").textContent = staff.length + " staff";
    alert("✅ Imported " + out.length + " records.");
    input.value="";
  };
  reader.readAsText(file);
}

// Close dropdown on outside click
document.addEventListener("click", e => {
  if(!e.target.closest(".search-wrap")) document.getElementById("dropdown").classList.remove("open");
});

// Init
updateStatus();
