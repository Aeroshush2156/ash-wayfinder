// ─── PATHFINDING ─────────────────────────────────────────────────────────────
// A* over the waypoint network exported from the waypoint editor.
// Exposed as a global `Pathfinding` object with public methods:
//   Pathfinding.findPath(startRoom, startFloor, destRoom, destFloor)
//   Pathfinding.drawPath(pathResult)   — render route on the SVG map
//   Pathfinding.clearPath()            — remove drawn route
//   Pathfinding.setFloor(floor)        — show path segments for the given floor
//
// Call `await Pathfinding.ready` before using findPath if you need to be sure
// the data has loaded.

const Pathfinding = (() => {

  // ── Private state ──────────────────────────────────────────────────────────
  let _waypoints       = [];
  let _edges           = [];
  let _roomConnections = [];
  let _graph           = {};   // { wpId: [{ to, cost }] }
  let _wpMap           = {};   // { wpId: waypoint }
  let _loaded          = false;
  let _currentPath     = null; // last result passed to drawPath()

  // Stairwell transitions are valid edges but penalised so A* only uses them
  // when they are genuinely on the shortest path.
  const STAIRWELL_PENALTY = 300;

  // ── Data loading ───────────────────────────────────────────────────────────
  const ready = fetch('data/waypoints.json')
    .then(r => { if (!r.ok) throw new Error('waypoints.json fetch failed'); return r.json(); })
    .then(data => {
      _waypoints       = data.waypoints       || [];
      _edges           = data.edges           || [];
      _roomConnections = data.roomConnections || [];
      _buildGraph();
      _loaded = true;
      console.log('[pathfinding] loaded', _waypoints.length, 'waypoints,',
                  _edges.length, 'edges,', _roomConnections.length, 'room connections');
      console.log('[pathfinding] waypoints array:', JSON.parse(JSON.stringify(_waypoints)));
      console.log('[pathfinding] edges array:', JSON.parse(JSON.stringify(_edges)));
      console.log('[pathfinding] roomConnections array:', JSON.parse(JSON.stringify(_roomConnections)));
    })
    .catch(err => console.error('[pathfinding] failed to load waypoints.json:', err));

  function _buildGraph() {
    _wpMap  = {};
    _graph  = {};
    _waypoints.forEach(w => { _wpMap[w.id] = w; _graph[w.id] = []; });

    _edges.forEach(e => {
      const a = _wpMap[e.from], b = _wpMap[e.to];
      if (!a || !b) return;
      const dist = _euclidean(a, b);
      const cost = e.type === 'stairwell' ? dist + STAIRWELL_PENALTY : dist;
      _graph[e.from].push({ to: e.to,   cost });
      _graph[e.to  ].push({ to: e.from, cost }); // all edges are bidirectional
    });
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────
  function _euclidean(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  // Angle of the vector A→B in radians.
  // SVG coordinate system: x increases right, y increases downward.
  function _heading(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  // Signed angular difference h2 − h1, normalised to (−π, π].
  function _angleDiff(h1, h2) {
    let d = h2 - h1;
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  // Eight-point compass label for a heading (radians).
  function _cardinalDir(h) {
    const deg = ((h * 180 / Math.PI) + 360) % 360;
    if (deg < 22.5  || deg >= 337.5) return 'east';
    if (deg < 67.5)                  return 'south-east';
    if (deg < 112.5)                 return 'south';
    if (deg < 157.5)                 return 'south-west';
    if (deg < 202.5)                 return 'west';
    if (deg < 247.5)                 return 'north-west';
    if (deg < 292.5)                 return 'north';
    return 'north-east';
  }

  // Human-readable turn description, or null when change is < 30° (straight).
  // Positive radians = clockwise = RIGHT in y-down SVG space.
  // Thresholds: < 30° → straight, 30–150° → Turn left/right, > 150° → u-turn variant.
  function _describeTurn(radDiff) {
    const deg = radDiff * 180 / Math.PI;
    const abs = Math.abs(deg);
    if (abs < 30)  return null;                        // Continue straight
    const dir = deg > 0 ? 'right' : 'left';
    if (abs <= 150) return `Turn ${dir}`;
    return `Turn around`;                              // near-180° reversal
  }

  // ── A* search ──────────────────────────────────────────────────────────────
  function _aStar(startId, endId) {
    if (!_wpMap[startId] || !_wpMap[endId]) return null;
    const end = _wpMap[endId];

    const g      = {};   // cost from start
    const f      = {};   // g + heuristic
    const parent = {};

    _waypoints.forEach(w => { g[w.id] = Infinity; f[w.id] = Infinity; });
    g[startId] = 0;
    f[startId] = _euclidean(_wpMap[startId], end);

    const open   = new Set([startId]);
    const closed = new Set();

    while (open.size) {
      // Pop the open-set node with lowest f score
      let current = null, best = Infinity;
      for (const id of open) {
        if (f[id] < best) { best = f[id]; current = id; }
      }

      if (current === endId) {
        // Reconstruct path from parent pointers
        const path = [];
        let c = endId;
        while (c !== undefined) { path.unshift(_wpMap[c]); c = parent[c]; }
        return path;
      }

      open.delete(current);
      closed.add(current);

      for (const { to, cost } of (_graph[current] || [])) {
        if (closed.has(to)) continue;
        const tentativeG = g[current] + cost;
        if (tentativeG < g[to]) {
          parent[to] = current;
          g[to] = tentativeG;
          f[to] = tentativeG + _euclidean(_wpMap[to], end);
          open.add(to);
        }
      }
    }

    return null; // no path found
  }

  // Like _aStar but also returns the closed set on failure (for diagnostics).
  function _aStarDebug(startId, endId) {
    if (!_wpMap[startId] || !_wpMap[endId]) return { path: null, visited: [] };
    const end = _wpMap[endId];
    const g = {}, f = {}, parent = {};
    _waypoints.forEach(w => { g[w.id] = Infinity; f[w.id] = Infinity; });
    g[startId] = 0;
    f[startId] = _euclidean(_wpMap[startId], end);
    const open = new Set([startId]), closed = new Set();
    while (open.size) {
      let current = null, best = Infinity;
      for (const id of open) { if (f[id] < best) { best = f[id]; current = id; } }
      if (current === endId) {
        const path = []; let c = endId;
        while (c !== undefined) { path.unshift(_wpMap[c]); c = parent[c]; }
        return { path, visited: [...closed] };
      }
      open.delete(current); closed.add(current);
      for (const { to, cost } of (_graph[current] || [])) {
        if (closed.has(to)) continue;
        const tg = g[current] + cost;
        if (tg < g[to]) { parent[to] = current; g[to] = tg; f[to] = tg + _euclidean(_wpMap[to], end); open.add(to); }
      }
    }
    return { path: null, visited: [...closed] };
  }

  // ── Instruction generation ─────────────────────────────────────────────────
  function _buildInstructions(path, startLabel, destLabel) {
    if (path.length < 2) return [`Proceed directly to ${destLabel}`];

    const steps = [];

    // First instruction: exit start room, initial heading
    const initialH = _heading(path[0], path[1]);
    steps.push(`Exit ${startLabel} and head ${_cardinalDir(initialH)}`);

    let prevH       = initialH;
    let pendingStraight = false;

    for (let i = 1; i < path.length - 1; i++) {
      const curr = path[i];
      const next = path[i + 1];

      // ── Floor change (stairwell) ────────────────────────────────────────
      if (curr.floor !== next.floor) {
        if (pendingStraight) {
          steps.push('Continue straight');
          pendingStraight = false;
        }
        const goingUp = next.floor > curr.floor;
        steps.push(
          `Take the stairs ${goingUp ? 'up' : 'down'} to the ` +
          `${next.floor === 0 ? 'Ground' : 'First'} Floor`
        );
        // Direction immediately after the stairs
        if (i + 2 < path.length) {
          const afterH = _heading(next, path[i + 2]);
          const turn   = _describeTurn(_angleDiff(prevH, afterH));
          steps.push(turn
            ? `${turn} at the ${goingUp ? 'top' : 'bottom'} of the stairs`
            : `Continue straight from the stairs`);
          prevH = afterH;
          i++; // stairwell-top waypoint consumed
        }
        continue;
      }

      // ── Turn detection ──────────────────────────────────────────────────
      const nextH = _heading(curr, next);
      const diff  = _angleDiff(prevH, nextH);
      const turn  = _describeTurn(diff);   // null = straight (< 30°)

      if (turn) {
        if (pendingStraight) {
          steps.push('Continue straight');
          pendingStraight = false;
        }
        steps.push(turn);
      } else {
        pendingStraight = true;
      }

      prevH = nextH;
    }

    if (pendingStraight) steps.push('Continue straight');

    // Last instruction
    steps.push(`Arrive at ${destLabel}`);
    return steps;
  }

  // ── SVG path drawing ───────────────────────────────────────────────────────

  // Ensure the keyframe animation is injected once.
  function _ensureMarker() {
    if (document.querySelector('style[data-pf-anim]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-pf-anim', '1');
    style.textContent = `@keyframes pfDash { to { stroke-dashoffset: -38; } }`;
    document.head.appendChild(style);
  }

  // Get or create the path-layer group, positioned just above the rooms layer.
  function _getPathLayer(svg) {
    let layer = svg.querySelector('#pf-layer');
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.id = 'pf-layer';
      layer.style.pointerEvents = 'none';
      // Insert after rooms-layer if it exists, otherwise append
      const roomsLayer = svg.querySelector('#rooms-layer');
      if (roomsLayer && roomsLayer.nextSibling) {
        svg.insertBefore(layer, roomsLayer.nextSibling);
      } else {
        svg.appendChild(layer);
      }
    }
    return layer;
  }

  // Build SVG markup for all segments of `path` that lie on `floor`.
  // Returns individual line elements with animated dashes and arrowheads.
  function _buildFloorSegments(path, floor) {
    let html = '';
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (a.floor !== floor || b.floor !== floor) continue;

      html += `<line
        x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
        stroke="#1246c8" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="22 16" opacity="0.92"
        style="animation:pfDash 0.9s linear infinite"/>`;
    }
    return html;
  }

  /**
   * drawPath(pathResult)
   * Renders the route returned by findPath() onto the SVG overlay.
   * Call setFloor(f) whenever the visible floor changes to show that floor's segments.
   * Integrates with renderMap() — add `Pathfinding.setFloor(currentFloor)` at the
   * end of renderMap() in app.js to keep the path visible after re-renders.
   */
  function drawPath(pathResult) {
    _currentPath = pathResult;
    const svg = document.getElementById('overlay-svg');
    if (!svg) return;
    _ensureMarker();

    const layer = _getPathLayer(svg);

    if (!pathResult || !pathResult.waypoints || pathResult.waypoints.length < 2) {
      layer.innerHTML = '';
      return;
    }

    const path   = pathResult.waypoints;
    const floors = pathResult.floors || [...new Set(path.map(w => w.floor))];

    // Build a sub-group per floor so setFloor() can toggle visibility cheaply
    layer.innerHTML = floors.map(f =>
      `<g id="pf-floor-${f}" style="display:none">${_buildFloorSegments(path, f)}</g>`
    ).join('');

    // Show whichever floor is currently active (currentFloor is a global in app.js)
    const activeFloor = (typeof currentFloor !== 'undefined') ? currentFloor : floors[0];
    setFloor(activeFloor);
  }

  /**
   * setFloor(floor)
   * Shows path segments for the given floor, hides all others.
   * Call this from switchFloor() / renderMap() in app.js:
   *   if (typeof Pathfinding !== 'undefined') Pathfinding.setFloor(currentFloor);
   */
  function setFloor(floor) {
    const layer = document.getElementById('pf-layer');
    if (!layer) return;
    layer.querySelectorAll('g[id^="pf-floor-"]').forEach(g => {
      g.style.display = g.id === `pf-floor-${floor}` ? '' : 'none';
    });
  }

  /**
   * clearPath()
   * Removes the drawn route from the SVG.
   */
  function clearPath() {
    _currentPath = null;
    const layer = document.getElementById('pf-layer');
    if (layer) layer.innerHTML = '';
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * findPath(startRoom, startFloor, destRoom, destFloor)
   *
   * Returns:
   *   {
   *     waypoints:    [ { id, x, y, floor, … }, … ],
   *     instructions: [ "Exit Room 1.56 …", … ],
   *     floors:       [ 0 ]   // or [0, 1] if multi-floor
   *   }
   * or null if no path exists or data is not yet loaded.
   */
  function findPath(startRoom, startFloor, destRoom, destFloor, startLabel, destLabel) {
    if (!_loaded) {
      console.warn('[pathfinding] data not yet loaded — await Pathfinding.ready first');
      return null;
    }

    const startConn = _roomConnections.find(
      c => c.room === String(startRoom) && c.floor === startFloor
    );
    const destConn = _roomConnections.find(
      c => c.room === String(destRoom) && c.floor === destFloor
    );

    if (!startConn) {
      console.warn('[pathfinding] no room connection for start room:', startRoom, 'floor', startFloor);
      return null;
    }
    if (!destConn) {
      console.warn('[pathfinding] no room connection for dest room:', destRoom, 'floor', destFloor);
      return null;
    }

    console.log('[pathfinding] startConn:', startConn, '→ waypointId:', startConn.waypointId);
    console.log('[pathfinding] destConn:', destConn, '→ waypointId:', destConn.waypointId);
    console.log('[pathfinding] graph neighbours for start:', _graph[startConn.waypointId]);
    console.log('[pathfinding] graph neighbours for dest:', _graph[destConn.waypointId]);

    const sLabel = startLabel || `Room ${startRoom}`;
    const dLabel = destLabel  || `Room ${destRoom}`;

    if (startConn.waypointId === destConn.waypointId) {
      return {
        waypoints:    [_wpMap[startConn.waypointId]],
        instructions: [`${dLabel} is right here`],
        floors:       [startFloor],
      };
    }

    const path = _aStar(startConn.waypointId, destConn.waypointId);
    console.log('[pathfinding] A* raw result (', path ? path.length : 0, 'waypoints):', path);
    if (!path) {
      console.warn('[pathfinding] A* found no path between',
                   startConn.waypointId, '→', destConn.waypointId);
      return null;
    }

    const floors       = [...new Set(path.map(w => w.floor))];
    const instructions = _buildInstructions(path, sLabel, dLabel);

    return { waypoints: path, instructions, floors };
  }

  function debugData() {
    return { roomConnections: _roomConnections, wpMap: _wpMap, aStarDebug: _aStarDebug };
  }

  return { findPath, drawPath, clearPath, setFloor, ready, debugData };

})();
