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

// ─── BOTTOM SHEET ────────────────────────────────────────────────────────────
const SHEET_PEEK = 140; // px — height of visible handle in collapsed state

function setSheetState(state) {
  // state: 'hidden' | 'collapsed' | 'expanded'
  const sheet = document.getElementById('bottom-sheet');
  sheet.className = 'bottom-sheet' + (state !== 'hidden' ? ' sheet-' + state : '');
}

// Wire up handle tap and swipe gestures once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const handle    = document.getElementById('sheet-handle');
  const closeBtn  = document.getElementById('sheet-close-btn');
  const sheetBody = document.getElementById('sheet-body');
  let   touchStartY = 0;

  // Tap handle → toggle collapsed ↔ expanded
  handle.addEventListener('click', e => {
    if (e.target.closest('#sheet-close-btn')) return;
    const sheet = document.getElementById('bottom-sheet');
    if (sheet.classList.contains('sheet-collapsed')) setSheetState('expanded');
    else if (sheet.classList.contains('sheet-expanded')) setSheetState('collapsed');
  });

  // ✕ clears everything and hides the sheet
  closeBtn.addEventListener('click', e => { e.stopPropagation(); clearAll(); });

  // Swipe on handle: up → expand, down → collapse
  handle.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  handle.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    const sheet = document.getElementById('bottom-sheet');
    if (dy < -30) setSheetState('expanded');
    else if (dy > 30 && sheet.classList.contains('sheet-expanded')) setSheetState('collapsed');
  }, { passive: true });

  // Swipe down on body when scrolled to top → collapse
  sheetBody.addEventListener('touchstart', e => {
    if (sheetBody.scrollTop === 0) touchStartY = e.touches[0].clientY;
  }, { passive: true });
  sheetBody.addEventListener('touchend', e => {
    if (sheetBody.scrollTop > 0) return;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 50) setSheetState('collapsed');
  }, { passive: true });

  // Banner always starts expanded — show search section immediately (step 1 is active)
  _syncSearchVisibility();
});

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
    initFromQRParam();
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

// ─── QR CODE START LOCATION ─────────────────────────────────────────────────
// A printed QR code encodes a URL like index.html?from=<slug>. On load we look
// that slug up in data/qrpoints.json and, if found, pre-populate the user's
// start location exactly as if they'd tapped that spot on the map — so all
// they have to do is search for where they're going.
async function initFromQRParam() {
  const slug = new URLSearchParams(window.location.search).get("from");
  if (!slug) return;
  try {
    const res = await fetch("data/qrpoints.json");
    if (!res.ok) throw new Error("qrpoints.json fetch failed: " + res.status);
    const points = await res.json();
    const entry = points.find(p => p.id === slug);
    if (!entry) { console.warn("[qr] unrecognized QR slug:", slug); return; }
    console.log("[qr] resolved start location from QR:", slug, "→", entry);
    applyQRStart(entry);
  } catch (e) {
    console.warn("[qr] failed to resolve QR start location:", e);
  }
}

function applyQRStart(entry) {
  youRoom = { room: entry.room, floor: entry.floor, label: entry.label };
  youZone = entry.zone || null;
  if (entry.floor !== currentFloor) switchFloor(entry.floor);
  else { renderMap(); updateStatus(); }
  const search = document.getElementById("search");
  if (search) search.focus();
}

// ─── RENDER MAP ─────────────────────────────────────────────────────────────
function renderMap() {
  if (typeof editMode !== 'undefined' && editMode) { renderEditMap(); return; }
  const layer = document.getElementById("zones-layer");
  const fl = zones.filter(z => z.floor === currentFloor);
  let html = ``;

  fl.forEach(z => {
    let fill, stroke, opacity = 0.45;
    if (z.id === youZone) { fill="#c7d9ff"; stroke="#4f7fff"; opacity=0.72; }
    else if (z.id === destZone && !destRoom) { fill="#ffc7c7"; stroke="#dc2626"; opacity=0.72; }
    else if (z.id === destZone &&  destRoom) { fill="#ffeaea"; stroke="#f87171"; opacity=0.32; }
    else if (z.type === "special") { fill="#fef9c3"; stroke="#ca8a04"; opacity=0.38; }
    else                        { fill="#d1fae5"; stroke="#16a34a"; opacity=0.42; }

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
      const labelColor = isYouRoom ? "#4f7fff" : isTarget ? "#dc2626" : "rgba(60,60,60,0.75)";
      return `<g pointer-events="none">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3"
          fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
          font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
          font-size="${fs}" font-weight="700" fill="${labelColor}">${r.room}</text>
        ${isYouRoom ? `<text x="${cx}" y="${r.y + r.h + 14}" text-anchor="middle"
          font-size="10" fill="#4f7fff" font-family="inherit" font-weight="700">📍 You</text>` : ""}
        ${isTarget ? `<text x="${cx}" y="${r.y + r.h + 14}" text-anchor="middle"
          font-size="10" fill="#dc2626" font-family="inherit" font-weight="700">🎯 Dest</text>` : ""}
      </g>`;
    }).join("");
  }

  // Keep pathfinding path visible on the correct floor after every re-render
  if (typeof Pathfinding !== "undefined") Pathfinding.setFloor(currentFloor);
}

function switchFloor(f) {
  currentFloor = f;
  // Crop the viewBox to show only the active floor's half of the image
  const svg = document.getElementById('overlay-svg');
  if (svg) svg.setAttribute('viewBox', f === 0 ? '0 0 1170 1654' : '1170 0 1169 1654');
  // Reset zoom/scroll so the new floor always comes fully into view
  mapScale = 1;
  applyMapSize();
  const scroll = document.getElementById('map-scroll');
  if (scroll) { scroll.scrollLeft = 0; scroll.scrollTop = 0; }
  renderMap();
  updateStatus();
  updateFloorTabs();
}

// ─── FLOOR TAB STATE ─────────────────────────────────────────────────────────
function updateFloorTabs() {
  const ft0 = document.getElementById('ft0');
  const ft1 = document.getElementById('ft1');
  if (!ft0 || !ft1) return;

  ft0.classList.toggle('active', currentFloor === 0);
  ft1.classList.toggle('active', currentFloor === 1);

  // Show indicator dot on both tabs when the active route spans both floors
  const multiFloor = !!(currentPath && currentPath.floors && currentPath.floors.length > 1);
  ft0.classList.toggle('has-path', multiFloor);
  ft1.classList.toggle('has-path', multiFloor);

  updateStairBanner();
}

function updateStairBanner() {
  const banner = document.getElementById('stair-banner');
  if (!banner) return;

  if (!currentPath || !currentPath.waypoints || currentPath.waypoints.length < 2) {
    banner.classList.remove('visible');
    return;
  }

  // Find the first stairwell transition on the currently-viewed floor
  const wps = currentPath.waypoints;
  let destFloor = null;
  for (let i = 0; i < wps.length - 1; i++) {
    if (wps[i].floor === currentFloor && wps[i + 1].floor !== currentFloor) {
      destFloor = wps[i + 1].floor;
      break;
    }
  }

  if (destFloor === null) { banner.classList.remove('visible'); return; }
  banner.textContent = `🪜 Take stairs to ${destFloor === 0 ? 'Ground' : 'First'} Floor to continue`;
  banner.classList.add('visible');
}

// ─── ZONE CLICK ─────────────────────────────────────────────────────────────
function zoneClick(id) {
  console.log('[zoneClick] clicked:', id, '| youZone:', youZone, '| destZone:', destZone);
  if (typeof editMode !== 'undefined' && editMode) return;
  if (!youZone) {
    console.log('[zoneClick] branch: SET LOCATION (youZone was null)');
    youZone = id;
    updateStatus();
    renderMap();
    document.getElementById("search").focus();
    document.getElementById("search").blur();
    // If destination was already chosen (search-first flow), calculate path now
    if (destZone) {
      recalculatePath();
      const zone = zones.find(z => z.id === destZone);
      if (zone) showInfo(zone, destPerson);
    }
  } else if (id !== youZone) {
    console.log('[zoneClick] branch: SET DESTINATION (youZone already set, id !== youZone)');
    destZone = id;
    destRoom = resolveDestRoom(id);
    destRoomFromZone = true;
    destPerson = null;
    currentPath = null;
    if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
    recalculatePath();
    const zone = zones.find(z => z.id === id);
    showInfo(zone, null);
  } else {
    console.log('[zoneClick] branch: NO-OP (clicked own location zone, id === youZone)');
  }
}

// ─── HOW-TO BANNER ───────────────────────────────────────────────────────────
let _howtoTimer = null;

// Show/hide the inline search section based on banner state + step 1 completion.
function _syncSearchVisibility() {
  const banner = document.getElementById('howto-banner');
  const searchSection = document.getElementById('search-section');
  if (!banner || !searchSection) return;
  const step1Done = !!(destZone || destPerson);
  const show = !step1Done && !banner.classList.contains('howto-collapsed');
  searchSection.classList.toggle('search-open', show);
  if (!show) {
    const dd = document.getElementById('dropdown');
    if (dd) dd.classList.remove('open');
  }
}

function updateHowTo() {
  const banner = document.getElementById('howto-banner');
  if (!banner) return;

  const done = [
    !!(destZone || destPerson),  // step 1: destination selected
    !!youZone,                    // step 2: location tapped
    !!currentPath,                // step 3: directions shown
  ];
  const nextIdx = done.indexOf(false); // first incomplete step (-1 = all done)
  const allDone = nextIdx === -1;
  const doneCount = done.filter(Boolean).length;

  done.forEach((isDone, i) => {
    const step = document.getElementById('hs' + (i + 1));
    const num  = document.getElementById('hn' + (i + 1));
    if (!step) return;
    step.classList.toggle('done',   isDone);
    step.classList.toggle('active', !isDone && i === nextIdx);
    if (num) num.textContent = isDone ? '✓' : String(i + 1);
  });

  const prog = document.getElementById('howto-progress');
  if (prog) {
    prog.textContent = allDone ? 'All done ✓' : `${doneCount}/3 done`;
    prog.className   = 'howto-progress' + (allDone ? ' all-done' : '');
  }

  _syncSearchVisibility();

  // Auto-collapse when all steps are complete
  if (allDone && !banner.classList.contains('howto-collapsed')) {
    clearTimeout(_howtoTimer);
    _howtoTimer = setTimeout(() => {
      banner.classList.add('howto-collapsed');
      _syncSearchVisibility();
    }, 1400);
  }
}

function toggleHowTo() {
  const banner = document.getElementById('howto-banner');
  if (!banner) return;
  banner.classList.toggle('howto-collapsed');
  _syncSearchVisibility();
  // If expanding and step 1 not done, focus the search after the CSS transition
  if (!banner.classList.contains('howto-collapsed') && !(destZone || destPerson)) {
    setTimeout(() => { const inp = document.getElementById('search'); if (inp) inp.focus(); }, 380);
  }
}

// Tapping step 1 expands the banner (if collapsed) and focuses the search input.
function step1Tap() {
  if (destZone || destPerson) return; // step 1 already done — do nothing
  const banner = document.getElementById('howto-banner');
  if (banner && banner.classList.contains('howto-collapsed')) {
    banner.classList.remove('howto-collapsed');
    _syncSearchVisibility();
  }
  setTimeout(() => { const inp = document.getElementById('search'); if (inp) inp.focus(); }, 150);
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
  updateHowTo();
}

// ─── INFO PANEL ─────────────────────────────────────────────────────────────
function showInfo(zone, person) {
  destZone = zone.id;
  destPerson = person;

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
  console.log('[showInfo] currentPath at render time:', currentPath);
  const instrEl = document.getElementById("path-instructions");
  if (instrEl) {
    if (currentPath && currentPath.instructions && currentPath.instructions.length) {
      instrEl.style.display = "";
      instrEl.innerHTML =
        `<div class="steps-header">Step-by-step directions</div>
         <div class="steps-list">` +
        currentPath.instructions.map((step, i) => {
          const isArrive = step.startsWith("Arrive at");
          const isStairs = step.startsWith("Take the stairs");
          const cls  = isArrive ? "step-item step-arrive"
                     : isStairs ? "step-item step-stairs"
                     :             "step-item";
          const icon = isStairs ? "🪜 " : isArrive ? "📍 " : "";
          return `<div class="${cls}">
            <div class="step-num">${i + 1}</div>
            <div class="step-text">${icon}${step}</div>
          </div>`;
        }).join("") +
        `</div>`;
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

  // Populate collapsed-state preview
  const previewDest = document.getElementById('sheet-preview-dest');
  const previewStep = document.getElementById('sheet-preview-step');
  if (previewDest) previewDest.textContent = person ? person.name : zone.label;
  if (previewStep) {
    // Once a route is drawn, don't show the raw first instruction step here —
    // it read as plain info text and people didn't realize tapping it opens
    // the full turn-by-turn list. Show an explicit call-to-action instead.
    const hasRoute = currentPath && currentPath.instructions && currentPath.instructions.length;
    previewStep.textContent = hasRoute
      ? 'Tap to view turn-by-turn directions ›'
      : (youZone ? dir.split('.')[0] : 'Set a start location for directions');
    previewStep.classList.toggle('sheet-preview-step-cta', !!hasRoute);
  }
  setSheetState('collapsed');
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
    // If destination was already chosen (search-first flow), calculate path now
    if (destZone) {
      recalculatePath();
      const zone = zones.find(z => z.id === destZone);
      if (zone) showInfo(zone, destPerson);
    }
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
    updateFloorTabs();
    return;
  }
  const startLabel = youRoom
    ? (youRoom.label || `Room ${startRoom.room}`)
    : (zones.find(z => z.id === youZone)?.label || `Room ${startRoom.room}`);
  const destLabel = destRoomFromZone
    ? (zones.find(z => z.id === destZone)?.label || `Room ${destRoom.room}`)
    : `Room ${destRoom.room}`;
  // ── Detailed diagnostics ───────────────────────────────────────────────────
  const { roomConnections, wpMap, aStarDebug } = Pathfinding.debugData();
  const sConn = roomConnections.find(c => c.room === String(startRoom.room) && c.floor === startRoom.floor);
  const dConn = roomConnections.find(c => c.room === String(destRoom.room)  && c.floor === destRoom.floor);
  console.group('[recalculatePath] diagnostics');
  console.log('Start room:', startRoom.room, '  floor:', startRoom.floor,
    ' → roomConnection:', sConn || 'NOT FOUND',
    ' → waypoint:', sConn ? wpMap[sConn.waypointId] : 'n/a');
  console.log('Dest  room:', destRoom.room,  '  floor:', destRoom.floor,
    ' → roomConnection:', dConn || 'NOT FOUND',
    ' → waypoint:', dConn ? wpMap[dConn.waypointId] : 'n/a');

  if (sConn && dConn) {
    const { path, visited } = aStarDebug(sConn.waypointId, dConn.waypointId);
    if (path) {
      console.log('A* result: PATH FOUND ✓  (' + path.length + ' waypoints)');
    } else {
      console.warn('A* result: NULL — no path found');
      console.log('Visited waypoints before giving up (' + visited.length + '):',
        visited.map(id => ({ id, ...wpMap[id] })));
    }
  } else {
    console.warn('A* not run — missing room connection(s)');
  }
  console.groupEnd();
  // ── End diagnostics ────────────────────────────────────────────────────────

  console.log('[app] calling Pathfinding.findPath:', startRoom.room, startRoom.floor, '→', destRoom.room, destRoom.floor, '| labels:', startLabel, '→', destLabel);
  currentPath = Pathfinding.findPath(startRoom.room, startRoom.floor, destRoom.room, destRoom.floor, startLabel, destLabel);
  console.log('[app] findPath result:', currentPath);
  if (currentPath) Pathfinding.drawPath(currentPath);
  else { Pathfinding.clearPath(); currentPath = null; }
  updateFloorTabs();
  updateHowTo();
}

function clearAll() {
  youZone = null; destZone = null; destRoom = null; destRoomFromZone = false; destPerson = null;
  youRoom = null; currentPath = null;
  if (window.location.search) history.replaceState(null, "", window.location.pathname);
  if (typeof Pathfinding !== "undefined") Pathfinding.clearPath();
  updateFloorTabs();
  setSheetState('hidden');
  const instrEl = document.getElementById("path-instructions");
  if (instrEl) { instrEl.style.display = "none"; instrEl.innerHTML = ""; }
  const staffListEl = document.getElementById("zone-staff-list");
  if (staffListEl) { staffListEl.style.display = "none"; staffListEl.innerHTML = ""; }
  clearSearch();
  // Re-expand the banner so step 1 is visible and the search bar reappears
  const howto = document.getElementById('howto-banner');
  if (howto) howto.classList.remove('howto-collapsed');
  updateStatus();
  renderMap();
}

// ─── ZOOM (width-based — no CSS transform, no blur) ──────────────────────────
// Instead of scaling the container with transform:scale(), we grow the actual
// pixel dimensions of #map-transform.  The browser re-rasterises the SVG and
// floor-plan image at the new size, giving sharp output at every zoom level.
// Panning is handled by the overflow:auto scroll container.

function applyMapSize() {
  const el     = document.getElementById('map-transform');
  const scroll = document.getElementById('map-scroll');
  if (!el || !scroll) return;
  if (mapScale <= 1) {
    // At 1× the element fills the container exactly — let CSS 100% handle it.
    el.style.width  = '';
    el.style.height = '';
  } else {
    el.style.width  = (scroll.clientWidth  * mapScale) + 'px';
    el.style.height = (scroll.clientHeight * mapScale) + 'px';
  }
}

// Zoom to a point expressed in scroll-container-local viewport coordinates.
// The content point currently under (viewportX, viewportY) stays fixed.
function zoomToPoint(newScale, viewportX, viewportY) {
  newScale = Math.max(1, Math.min(5, newScale));
  const scroll = document.getElementById('map-scroll');
  if (!scroll) return;

  const ratio = newScale / mapScale;

  // Pre-compute target scroll (old values × ratio, then shift back by viewport offset)
  const newScrollLeft = (scroll.scrollLeft + viewportX) * ratio - viewportX;
  const newScrollTop  = (scroll.scrollTop  + viewportY) * ratio - viewportY;

  mapScale = newScale;
  applyMapSize();

  scroll.scrollLeft = Math.max(0, newScrollLeft);
  scroll.scrollTop  = Math.max(0, newScrollTop);
}

function zoomIn() {
  const s = document.getElementById('map-scroll');
  if (s) zoomToPoint(mapScale * 1.5, s.clientWidth / 2, s.clientHeight / 2);
}
function zoomOut() {
  const s = document.getElementById('map-scroll');
  if (s) zoomToPoint(mapScale / 1.5, s.clientWidth / 2, s.clientHeight / 2);
}
function resetZoom() {
  mapScale = 1;
  applyMapSize();
  const scroll = document.getElementById('map-scroll');
  if (scroll) { scroll.scrollLeft = 0; scroll.scrollTop = 0; }
}

window.addEventListener('resize', applyMapSize);

// ─── PINCH / PAN TOUCH HANDLER ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const scroll = document.getElementById('map-scroll');

  // Pinch gesture state
  let pinchStartDist    = null;
  let pinchStartMid     = null;   // {x,y} local to scroll viewport
  let gestStartScale    = 1;
  let gestStartScrollL  = 0;
  let gestStartScrollT  = 0;

  // Double-tap state
  let lastTapTime = 0;
  let lastTapLX   = 0;
  let lastTapLY   = 0;

  function localXY(clientX, clientY) {
    const r = scroll.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  function tDist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function tMidLocal(a, b) {
    return localXY((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
  }

  scroll.addEventListener('touchstart', e => {
    const ts = e.touches;
    if (ts.length === 1) {
      const lp  = localXY(ts[0].clientX, ts[0].clientY);
      const now = Date.now();

      // Double-tap → reset zoom
      if (now - lastTapTime < 300 && Math.hypot(lp.x - lastTapLX, lp.y - lastTapLY) < 40) {
        e.preventDefault();
        resetZoom();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now; lastTapLX = lp.x; lastTapLY = lp.y;
      // Single finger: let browser handle scroll natively (touch-action: pan-x pan-y)

    } else if (ts.length >= 2) {
      e.preventDefault();
      pinchStartDist   = tDist(ts[0], ts[1]);
      pinchStartMid    = tMidLocal(ts[0], ts[1]);
      gestStartScale   = mapScale;
      gestStartScrollL = scroll.scrollLeft;
      gestStartScrollT = scroll.scrollTop;
    }
  }, { passive: false });

  scroll.addEventListener('touchmove', e => {
    const ts = e.touches;

    if (ts.length >= 2 && pinchStartDist !== null) {
      e.preventDefault();
      const newDist  = tDist(ts[0], ts[1]);
      const newMid   = tMidLocal(ts[0], ts[1]);
      const newScale = Math.max(1, Math.min(5, gestStartScale * (newDist / pinchStartDist)));
      const ratio    = newScale / gestStartScale;

      // Keep the content point under the original pinch midpoint fixed,
      // then shift by how far the midpoint has moved (translation component).
      const newScrollLeft = (gestStartScrollL + pinchStartMid.x) * ratio - newMid.x;
      const newScrollTop  = (gestStartScrollT + pinchStartMid.y) * ratio - newMid.y;

      mapScale = newScale;
      applyMapSize();
      scroll.scrollLeft = Math.max(0, newScrollLeft);
      scroll.scrollTop  = Math.max(0, newScrollTop);
    }
    // Single finger: browser handles scroll via touch-action: pan-x pan-y
  }, { passive: false });

  scroll.addEventListener('touchend', e => {
    if (e.touches.length < 2) {
      pinchStartDist = null;
    }
  }, { passive: true });
});

// ─── ADMIN GATE FOR CSV IMPORT ─────────────────────────────────────────────
// requireAdmin() lives in js/admin-auth.js. This just fronts the file picker
// with a password prompt so casual visitors don't stumble into importing data.
async function handleImportClick() {
  const ok = await requireAdmin("Enter admin password to import staff CSV:");
  if (ok) document.getElementById("csv-input").click();
}

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
