// Persistence — the web counterpart of AppSettings (UserDefaults) and the SwiftData models.
// Settings, custom exercises and history live in localStorage (small JSON); recordings in IndexedDB.

const SETTINGS_KEY = 'settings.v1';
const EXERCISES_KEY = 'customExercises.v1';
const HISTORY_KEY = 'history.v1';

export function defaultSettings() {
  return {
    sruti: { midiNote: 48, fineTuneCents: 0 },   // C3 — the user's Sa (CLAUDE.md)
    intonation: 'just',
    ragaID: 'mayamalavagowla',
    tolerance: { green: 10, yellow: 25 },
    showHz: true,
    graphRange: 'auto',
    droneOn: true,
    droneVolume: 0.5,
    droneFirstString: 'pa',
    droneOctave: 'traditional',
    echoCancel: true,
    showDiagnostics: false,
    guideNote: false,
    hasSeenGuide: false,
    droneStyle: 'smooth',
    practiceMode: 'guided',
    guidedHoldSeconds: 0.6,
    tempoBPM: 60,
    tempoSpeed: 1,
    strictPlainNotes: false,
    blindMode: false,
    recordSessions: false,
    /** Pitch line and readout: 'calm' (smoothed for the eye) or 'detailed' (every wobble). */
    pitchLine: 'calm',
  };
}

function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

/** Every field falls back to its default, so adding a setting never resets the saved ones (e.g. Sa). */
export function loadSettings() {
  const d = defaultSettings();
  const s = read(SETTINGS_KEY, {});
  const out = { ...d, ...s };
  out.sruti = { ...d.sruti, ...(s.sruti || {}) };
  out.tolerance = { ...d.tolerance, ...(s.tolerance || {}) };
  if (out.droneStyle !== 'plucked') out.droneStyle = 'smooth';
  return out;
}
export const saveSettings = (s) => write(SETTINGS_KEY, s);

export const loadCustomExercises = () => read(EXERCISES_KEY, []);
export const saveCustomExercises = (list) => write(EXERCISES_KEY, list);

export const loadHistory = () => read(HISTORY_KEY, []);
export const saveHistory = (list) => write(HISTORY_KEY, list);

// MARK: Recordings (IndexedDB)

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('sruti-trainer', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('recordings', mode);
    const result = fn(t.objectStore('recordings'));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const Recordings = {
  async add(rec) { return tx('readwrite', (s) => s.put(rec)); },
  async list() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      return (all || []).sort((a, b) => b.date - a.date);
    } catch { return []; }
  },
  async remove(id) { return tx('readwrite', (s) => s.delete(id)); },
};
