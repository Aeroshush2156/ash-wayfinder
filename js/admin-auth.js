// ─── ADMIN AUTH ──────────────────────────────────────────────────────────────
// Lightweight client-side gate for admin-only actions: staff CSV import, room
// CSV import, the zone editor (press E in the main app), and the standalone
// room-editor.html / waypoint-editor.html tools.
//
// IMPORTANT — this is NOT real security. ASH Wayfinder is a static site with
// no backend, so there is no way to keep a secret truly hidden from the
// browser: anyone who views this file's source can find ADMIN_HASH below and,
// given enough effort, brute-force or look up the password it hashes. This
// gate only stops a casual visitor from stumbling into admin tools — it will
// not stop someone who deliberately goes looking. Don't rely on it to protect
// anything you can't afford to have guessed.
//
// ── Changing the password ────────────────────────────────────────────────
// Default placeholder password is "changeme" — replace it before this goes
// live. In any browser console, run:
//
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPassword'))
//     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
//
// then paste the printed hash in as ADMIN_HASH below.

const ADMIN_HASH = "057ba03d6c44104863dc7361fe4578965d1887360f90a0895882e58a6248fc86"; // "changeme" — CHANGE THIS

async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Unlock state is per-tab (sessionStorage), so admins aren't asked again on
// every action within the same visit, but a fresh visitor always starts locked.
function isAdminUnlocked() {
  return sessionStorage.getItem('ash_admin_ok') === '1';
}

async function tryAdminUnlock(password) {
  const hash = await _sha256Hex(password || '');
  if (hash === ADMIN_HASH) {
    sessionStorage.setItem('ash_admin_ok', '1');
    return true;
  }
  return false;
}

function lockAdmin() {
  sessionStorage.removeItem('ash_admin_ok');
}

// Prompt-based gate for a single admin action (e.g. a button click).
// Resolves true if already unlocked or just unlocked successfully,
// false if the visitor cancelled or entered the wrong password.
async function requireAdmin(message) {
  if (isAdminUnlocked()) return true;
  const pw = prompt(message || 'Admin password:');
  if (pw === null) return false; // cancelled
  const ok = await tryAdminUnlock(pw);
  if (!ok) alert('Incorrect password.');
  return ok;
}
