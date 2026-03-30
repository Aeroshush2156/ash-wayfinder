// ─── SEARCH ─────────────────────────────────────────────────────────────────
function onSearch(val) {
  const dd = document.getElementById("dropdown");
  document.getElementById("search-clear").style.display = val ? "block" : "none";
  if (!val.trim()) { dd.classList.remove("open"); return; }
  const q = val.toLowerCase().trim();
  const results = staff.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.last.toLowerCase().includes(q) ||
    s.first.toLowerCase().includes(q) ||
    s.room.toLowerCase().includes(q) ||
    s.room_raw.toLowerCase().includes(q) ||
    s.dept.toLowerCase().includes(q) ||
    s.role.toLowerCase().includes(q)
  ).slice(0, 9);
  if (!results.length) {
    dd.innerHTML = `<div class="dd-item"><div class="dd-left"><div class="dd-name" style="color:#aaa">No results found</div></div></div>`;
    dd.classList.add("open"); return;
  }
  dd.innerHTML = results.map(s => {
    const floorLabel = s.floor === 0 ? "Ground" : "First";
    return `<div class="dd-item" data-name="${s.name.replace(/"/g, '&quot;')}">
      <div class="dd-left">
        <div class="dd-name">${s.name}</div>
        <div class="dd-role">${s.role}</div>
      </div>
      <div class="dd-badge">${floorLabel} · ${s.room}</div>
    </div>`;
  }).join("");
  dd.classList.add("open");
}

function selectPerson(name) {
  const s = staff.find(x => x.name === name);
  if (!s) return;
  document.getElementById("dropdown").classList.remove("open");
  document.getElementById("search").value = s.name;
  document.getElementById("search-clear").style.display = "block";

  // Prefer a specific room rectangle; fall back to zone highlight
  destRoom = rooms.find(r => r.room === s.room && r.floor === s.floor) || null;

  // Calculate and draw the waypoint path if a starting location is known
  const startRoom = (typeof resolveStartRoom === "function") ? resolveStartRoom() : youRoom;
  if (startRoom && typeof Pathfinding !== "undefined") {
    console.log('[search] calling Pathfinding.findPath:', startRoom.room, startRoom.floor, '→', s.room, s.floor);
    currentPath = Pathfinding.findPath(startRoom.room, startRoom.floor, s.room, s.floor);
    console.log('[search] findPath result:', currentPath);
    currentPath ? Pathfinding.drawPath(currentPath) : Pathfinding.clearPath();
  } else {
    console.log('[search] findPath skipped — startRoom:', startRoom, 'Pathfinding defined:', typeof Pathfinding !== "undefined");
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
    const item = e.target.closest(".dd-item[data-name]");
    if (item) selectPerson(item.dataset.name);
  });
});
