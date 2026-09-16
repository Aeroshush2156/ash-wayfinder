# ASH Wayfinder

A mobile-first navigation web app for the American School of The Hague. Visitors search for a staff member or room number and get turn-by-turn walking directions overlaid on the floor plan. Built as a static site (vanilla HTML/CSS/JS, no backend) and hosted on GitHub Pages at https://aeroshush2156.github.io/ash-wayfinder.

This README covers local setup and the admin tools used to keep the map, staff list, and QR wayfinding codes up to date.

## Running it locally

From the project root:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html`. That's it — no build step is needed to view or edit the app itself. (`npm start` also works if you prefer the webpack dev server in `package.json`, but the plain Python server above is what's used day to day.)

## Project structure

```
index.html              Main app
room-editor.html         Admin tool: edit room rectangles
waypoint-editor.html     Admin tool: edit the pathfinding network + QR anchors
js/
  app.js                 Main app logic, search-first flow, QR start-location handling
  search.js               Person-first search flow
  pathfinding.js          A* pathfinding over the waypoint graph
  editor.js               In-app zone editor (press E)
  admin-auth.js           Shared admin password gate
  zones.js                Department/area zone definitions
data/
  staff.json              Staff directory (name, room, floor, department, zone)
  rooms.json               Room number → floor-plan rectangle mapping
  waypoints.json           Pathfinding node/edge graph, stairwells, QR anchor tags
  qrpoints.json            Derived list of QR anchor points (id, label, room, floor, zone)
floorplan.jpg             The floor plan image both floors are cropped from
scripts/
  generate_qr_codes.py    Regenerates the printable QR code PDF from data/qrpoints.json
qr-codes/
  ASH_Wayfinder_QR_Codes.pdf   Print-ready QR codes, one per physical anchor point
```

## Admin guide

Everything below is gated by a single shared password, checked client-side in `js/admin-auth.js`. Because this is a static site with no server, **this is not real security** — anyone who reads the JS source can find the password hash and eventually recover the password. It only keeps a casual visitor from stumbling into edit mode; don't use it to protect anything sensitive.

**Changing the admin password:** open any browser console and run

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPassword'))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
```

then paste the printed hash into `ADMIN_HASH` at the top of `js/admin-auth.js`. The default placeholder password is `changeme` — **change it before sharing the URL outside the admin team.**

### Editing zones (department/area boundaries on the map)

1. Open `http://localhost:8080/index.html` and press **E**. Enter the admin password when prompted.
2. Zones become draggable and resizable (drag a zone to move it, use the corner/edge handles to resize). Drag on an empty area of the map to draw a brand-new zone — a popup will ask for its id, label, emoji, and type.
3. Press **E** again to exit edit mode.
4. Click **📋 Export Zones** in the edit banner — this copies the entire updated `zones` array, formatted as ready-to-paste JavaScript, to your clipboard.
5. Paste it over the contents of `js/zones.js` and save.

**Before deleting a zone**, search `data/staff.json` and `data/qrpoints.json` for that zone's id. Both files reference zones by id, and there's currently no validation that catches a dangling reference — a staff member or QR anchor pointing at a deleted zone will fail silently (the person's info card won't populate, or the QR code will leave part of the UI stuck). Reassign any matches to a different zone first.

### Editing room boundaries

1. Open `http://localhost:8080/room-editor.html` locally (same admin password).
2. Draw and adjust room rectangles on the floor plan.
3. Click **📋 Export JSON** to copy the updated rooms list to your clipboard.
4. Paste it into `data/rooms.json`.

### Editing the walking-path network and QR anchor points

1. Open `http://localhost:8080/waypoint-editor.html` locally (same admin password).
2. Add, move, or connect waypoints — this is the node/edge graph `pathfinding.js` runs A* over to generate directions.
3. Right-click a waypoint to tag it:
   - **Mark as Stairwell** — pairs it with a matching waypoint on the other floor (same `stairwellId`) for cross-floor routing.
   - **Mark as QR Anchor** — fill in a QR id, display label, nearest room, and zone. This is what lets a printed QR code at that physical spot pre-fill a visitor's starting location (see below).
4. Click **⬇ Export JSON**. This downloads `waypoints.json` always, and also downloads `qrpoints.json` if at least one waypoint is QR-tagged.
5. Replace `data/waypoints.json` (and `data/qrpoints.json`, if downloaded) with the new files.

### Printing QR wayfinding codes

Each entry in `data/qrpoints.json` becomes a QR code that encodes `index.html?from=<id>`. Scanning it pre-fills that location as the visitor's starting point, so they only need to search for their destination.

To (re)generate the printable PDF after `data/qrpoints.json` changes:

```
pip install qrcode reportlab
python3 scripts/generate_qr_codes.py
```

This writes `qr-codes/ASH_Wayfinder_QR_Codes.pdf` — one A4 page per anchor point, labeled with the floor and location name, sized to scan from a few feet away.

### Updating the staff directory

The **📋 Import CSV** button on the main app (admin gated) is a quick way to preview a CSV in the browser, but it only replaces the in-memory list for that session — it does not write back to `data/staff.json`. To make a permanent update, edit `data/staff.json` directly, following its existing schema:

```json
{ "name": "...", "last": "...", "first": "...", "room": "1.03", "room_raw": "1.03", "role": "...", "dept": "...", "floor": 0, "zone": "central_office" }
```

`zone` must match an id in `js/zones.js`, and `room` should exist in `data/rooms.json` for the room to be found on the map.
