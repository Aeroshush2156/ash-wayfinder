// ─── ZONE EDITOR ─────────────────────────────────────────────────────────────
// Toggle with E key. Zones become draggable/resizable. Export button copies
// updated zones array as valid JS ready to paste into zones.js.

let editMode = false;
let editDrag = null;
// { zoneId, action:'move'|'resize', handle, startX, startY, origX, origY, origW, origH }

const HANDLE_R = 7; // half-size of resize handles in SVG units (~2.5px at 1x zoom)
const MIN_DIM  = 20; // minimum zone width/height in SVG units

// ─── TOGGLE ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'e' && e.key !== 'E') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  toggleEditMode();
});

function toggleEditMode() {
  editMode = !editMode;
  document.getElementById('edit-banner').classList.toggle('visible', editMode);
  document.getElementById('map-wrap').classList.toggle('edit-active', editMode);
  if (editMode) {
    renderEditMap();
  } else {
    editDrag = null;
    renderMap();
  }
}

// ─── SVG COORDINATE HELPER ───────────────────────────────────────────────────
function svgPt(e) {
  const svg = document.getElementById('overlay-svg');
  const pt  = svg.createSVGPoint();
  const src = e.touches ? e.touches[0] : e;
  pt.x = src.clientX;
  pt.y = src.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ─── HANDLE POSITIONS ────────────────────────────────────────────────────────
function handlePositions(z) {
  return [
    { id:'nw', x:z.x,         y:z.y,         cur:'nwse-resize' },
    { id:'n',  x:z.x+z.w/2,  y:z.y,         cur:'ns-resize'   },
    { id:'ne', x:z.x+z.w,    y:z.y,         cur:'nesw-resize' },
    { id:'e',  x:z.x+z.w,    y:z.y+z.h/2,   cur:'ew-resize'   },
    { id:'se', x:z.x+z.w,    y:z.y+z.h,     cur:'nwse-resize' },
    { id:'s',  x:z.x+z.w/2,  y:z.y+z.h,     cur:'ns-resize'   },
    { id:'sw', x:z.x,         y:z.y+z.h,     cur:'nesw-resize' },
    { id:'w',  x:z.x,         y:z.y+z.h/2,   cur:'ew-resize'   },
  ];
}

// ─── RENDER (full rebuild) ───────────────────────────────────────────────────
function renderEditMap() {
  const layer = document.getElementById('zones-layer');
  const fl    = zones.filter(z => z.floor === currentFloor);
  layer.innerHTML = fl.map(zoneEditHTML).join('');
}

function zoneEditHTML(z) {
  const fill   = z.type === 'special' ? '#fef3c7' : '#dcfce7';
  const stroke = '#f59e0b';
  const hr     = HANDLE_R;
  const cx = z.x + z.w / 2, cy = z.y + z.h / 2;

  let html = `<rect data-zone="${z.id}" data-action="move"
    x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="7"
    fill="${fill}" stroke="${stroke}" stroke-width="3" opacity="0.75"
    style="cursor:move"/>`;

  html += `<text data-zone="${z.id}" data-part="label"
    x="${cx}" y="${cy - 10}" text-anchor="middle" dominant-baseline="central"
    font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    font-size="13" font-weight="700" fill="#92400e"
    pointer-events="none">${z.label}</text>`;

  html += `<text data-zone="${z.id}" data-part="coords"
    x="${cx}" y="${cy + 14}" text-anchor="middle" dominant-baseline="central"
    font-family="monospace" font-size="10" fill="#b45309"
    pointer-events="none">${z.x},${z.y} ${z.w}×${z.h}</text>`;

  handlePositions(z).forEach(h => {
    html += `<rect data-zone="${z.id}" data-action="resize" data-handle="${h.id}"
      x="${h.x - hr}" y="${h.y - hr}" width="${hr * 2}" height="${hr * 2}" rx="4"
      fill="white" stroke="${stroke}" stroke-width="2.5" opacity="0.9"
      style="cursor:${h.cur}"/>`;
  });

  return html;
}

// ─── IN-PLACE DOM UPDATE (no full re-render during drag) ─────────────────────
function updateZoneDOM(zoneId) {
  const svg = document.getElementById('overlay-svg');
  const z   = zones.find(z => z.id === zoneId);
  const hr  = HANDLE_R;
  const cx  = z.x + z.w / 2, cy = z.y + z.h / 2;

  const body = svg.querySelector(`rect[data-zone="${zoneId}"][data-action="move"]`);
  if (body) {
    body.setAttribute('x', z.x);    body.setAttribute('y', z.y);
    body.setAttribute('width', z.w); body.setAttribute('height', z.h);
  }

  const label = svg.querySelector(`text[data-zone="${zoneId}"][data-part="label"]`);
  if (label) { label.setAttribute('x', cx); label.setAttribute('y', cy - 10); }

  const coords = svg.querySelector(`text[data-zone="${zoneId}"][data-part="coords"]`);
  if (coords) {
    coords.setAttribute('x', cx); coords.setAttribute('y', cy + 14);
    coords.textContent = `${z.x},${z.y} ${z.w}×${z.h}`;
  }

  handlePositions(z).forEach(h => {
    const el = svg.querySelector(`rect[data-zone="${zoneId}"][data-handle="${h.id}"]`);
    if (el) { el.setAttribute('x', h.x - hr); el.setAttribute('y', h.y - hr); }
  });
}

// ─── MOUSE EVENTS (attached to svg + document) ───────────────────────────────
document.getElementById('overlay-svg').addEventListener('mousedown', e => {
  if (!editMode) return;
  const t = e.target;
  const zoneId = t.dataset.zone;
  if (!zoneId) return;

  e.preventDefault();
  e.stopPropagation();

  const z  = zones.find(z => z.id === zoneId);
  const pt = svgPt(e);

  editDrag = {
    zoneId,
    action:  t.dataset.action,
    handle:  t.dataset.handle || null,
    startX:  pt.x,
    startY:  pt.y,
    origX:   z.x,  origY: z.y,
    origW:   z.w,  origH: z.h,
  };
});

document.addEventListener('mousemove', e => {
  if (!editMode || !editDrag) return;
  e.preventDefault();

  const pt = svgPt(e);
  const dx = pt.x - editDrag.startX;
  const dy = pt.y - editDrag.startY;
  const z  = zones.find(z => z.id === editDrag.zoneId);
  const { origX, origY, origW, origH } = editDrag;

  if (editDrag.action === 'move') {
    z.x = Math.round(origX + dx);
    z.y = Math.round(origY + dy);
  } else {
    switch (editDrag.handle) {
      case 'nw':
        z.x = Math.round(origX + dx); z.w = Math.max(MIN_DIM, Math.round(origW - dx));
        z.y = Math.round(origY + dy); z.h = Math.max(MIN_DIM, Math.round(origH - dy)); break;
      case 'n':
        z.y = Math.round(origY + dy); z.h = Math.max(MIN_DIM, Math.round(origH - dy)); break;
      case 'ne':
        z.w = Math.max(MIN_DIM, Math.round(origW + dx));
        z.y = Math.round(origY + dy); z.h = Math.max(MIN_DIM, Math.round(origH - dy)); break;
      case 'e':
        z.w = Math.max(MIN_DIM, Math.round(origW + dx)); break;
      case 'se':
        z.w = Math.max(MIN_DIM, Math.round(origW + dx));
        z.h = Math.max(MIN_DIM, Math.round(origH + dy)); break;
      case 's':
        z.h = Math.max(MIN_DIM, Math.round(origH + dy)); break;
      case 'sw':
        z.x = Math.round(origX + dx); z.w = Math.max(MIN_DIM, Math.round(origW - dx));
        z.h = Math.max(MIN_DIM, Math.round(origH + dy)); break;
      case 'w':
        z.x = Math.round(origX + dx); z.w = Math.max(MIN_DIM, Math.round(origW - dx)); break;
    }
  }

  updateZoneDOM(editDrag.zoneId);
});

document.addEventListener('mouseup', () => { editDrag = null; });

// ─── EXPORT ──────────────────────────────────────────────────────────────────
function exportZones() {
  const ground = zones.filter(z => z.floor === 0);
  const first  = zones.filter(z => z.floor === 1);

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

  const fmt = z => {
    const parts = [
      `id:${JSON.stringify(z.id)}`,
      `floor:${z.floor}`,
      `label:${JSON.stringify(z.label)}`,
      `emoji:${JSON.stringify(z.emoji)}`,
      `type:${JSON.stringify(z.type)}`,
      `x:${z.x}`, `y:${z.y}`, `w:${z.w}`, `h:${z.h}`,
    ];
    return `  {${parts.join(', ')}}`;
  };

  const lines = [
    '// Full image: 2339 x 1654px. Ground floor: ~x 30-1130. First floor: ~x 1195-2310.',
    'const zones = [',
    '  // GROUND FLOOR',
    ...ground.map((z, i) => fmt(z) + ','),
    '',
    '  // FIRST FLOOR',
    ...first.map((z, i) => fmt(z) + (i < first.length - 1 ? ',' : ',')),
    '];',
  ];

  const text = lines.join('\n');

  const btn = document.getElementById('export-zones-btn');

  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    btn.style.background = '#16a34a';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
  }).catch(() => {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    btn.style.background = '#16a34a';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
  });
}
