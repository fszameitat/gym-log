// app.js — bootstrap, state, routing and event wiring. Written by Claude.
import * as db from './db.js';
import { createRestTimer } from './timer.js';
import { clock } from './fmt.js';
import { toKg, hasLoad } from './units.js';
import { buildRows, toCsv } from './csv.js';
import { UNIT_IDS } from './units.js';
import { SEED_EXERCISES } from './seed-history.js';
import { CATALOG } from './catalog.js';
import { view as homeView } from './views/home.js';
import { view as routinesView } from './views/routines.js';
import { view as exercisesView } from './views/exercises.js';
import { view as exerciseView } from './views/exercise.js';
import { view as sessionView } from './views/session.js';
import { view as progressView } from './views/progress.js';
import { metricsFor } from './views/exercise-progress.js';


// Which exercise / span / metric the Progress tab is showing. Remembered per device so the
// tab opens where you left it; a failed read must never stop the app booting.
function loadUi() {
  const fallback = { progressExerciseId: null, progressBucket: 'session', progressMetric: 'maxLoad' };
  try {
    const raw = localStorage.getItem('gymlog.ui');
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}

function saveUi() {
  try { localStorage.setItem('gymlog.ui', JSON.stringify(state.ui)); } catch { /* private mode */ }
}

export const state = {
  route: { name: 'home', id: null },
  exercises: [], routines: [], sessions: [], sets: [],
  rest: { running: false, remaining: 0, total: 0 },
  ui: loadUi(),
  editingRoutine: null,   // which routine's exercise picker is open
  catalogQuery: '', catalogGroup: '',
  ready: false,
};

/* ---------- rest: how long, keeping the screen on, and the nudge at zero ---------- */
const DEFAULT_REST_SECONDS = 120;

function restSecondsFor(exerciseId) {
  const ex = state.exercises.find((e) => e.id === exerciseId);
  const v = ex ? Number(ex.restSeconds) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : DEFAULT_REST_SECONDS;
}

// A phone left alone on a bench locks its screen after 30 seconds and the countdown is gone
// when you look back. The lock is held only while the timer runs, never for the whole workout.
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* denied, unsupported, or the tab is hidden — the timer works regardless */ }
}
function releaseWakeLock() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch { /* already gone */ }
}
// Re-acquire after the tab comes back: the browser drops the lock whenever the page hides.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.rest.running) acquireWakeLock();
});

/** A short beep and a buzz when rest is over. No audio file: a PWA that must work offline
 *  should not ship one, and a synthesised tone needs no network and no cache entry. */
function restFinishedCue() {
  try { if (typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200]); } catch { /* iOS */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    setTimeout(() => { try { ctx.close(); } catch { /* closed already */ } }, 900);
  } catch { /* autoplay policy — the vibration and the badge still land */ }
}

// The timer fires every 250ms. Re-rendering the whole screen that often destroys the DOM under
// the user's finger and drops taps mid-workout, so only a running/stopped transition triggers a
// real render; plain ticks just repaint the two clock elements in place.
let lastRestRunning = false;
const restTimer = createRestTimer((s) => {
  const transition = s.running !== lastRestRunning;
  lastRestRunning = s.running;
  state.rest = s;
  if (transition) {
    if (s.running) acquireWakeLock();
    else { releaseWakeLock(); if (s.finished) restFinishedCue(); }
  }
  paintRestBadge();
  const live = document.querySelector('.rest.live b');
  if (live) live.textContent = clock(s.remaining);
  if (transition && state.route.name === 'session') render();
});

/* ---------- helpers ---------- */
const $ = (sel) => document.querySelector(sel);
export const setsFor = (sessionId) => state.sets.filter((s) => s.sessionId === sessionId);
export const setsOfExercise = (exerciseId) => state.sets.filter((s) => s.exerciseId === exerciseId);
export const exerciseById = (id) => state.exercises.find((e) => e.id === id);
export const routineById = (id) => state.routines.find((r) => r.id === id);
export const sessionById = (id) => state.sessions.find((s) => s.id === id);

function num(v, fallback = 0) {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

/* ---------- data loading ---------- */
async function loadAll() {
  const [exercises, routines, sessions, sets] = await Promise.all([
    db.all('exercises'), db.all('routines'), db.all('sessions'), db.all('sets'),
  ]);
  state.exercises = exercises.sort((a, b) => a.name.localeCompare(b.name));
  state.routines = routines.sort((a, b) => (a.order || 0) - (b.order || 0));
  state.sessions = sessions.sort((a, b) => b.startedAt - a.startedAt);
  // Sort by creation order, never by `at`: `at` is updated when a set is ticked off, and sorting
  // on it made completed rows jump position under the user's finger during a workout.
  const ord = (x) => (Number.isFinite(x.createdAt) ? x.createdAt : x.at) || 0;
  state.sets = sets.sort((a, b) => ord(a) - ord(b) || (a.setIndex || 0) - (b.setIndex || 0));

  // Convert every set's native load into kilograms once, so the volume maths downstream
  // never has to know about Stufe or timed holds. Non-enumerable: structured clone skips
  // it, so this derived value is never written back into the database.
  const exById = new Map(state.exercises.map((e) => [e.id, e]));
  for (const st of state.sets) {
    const ex = exById.get(st.exerciseId);
    Object.defineProperty(st, 'kgWeight', {
      value: toKg(st.weight, ex),
      enumerable: false, configurable: true, writable: true,
    });
    // Bodyweight work has no weight to record, so the maths has to be told that a missing
    // weight is expected rather than missing data.
    Object.defineProperty(st, 'loadless', {
      value: !hasLoad(ex),
      enumerable: false, configurable: true, writable: true,
    });
  }
  state.ready = true;
}

const SEEDED_KEY = 'gymlog.seeded';
function markSeeded() { try { localStorage.setItem(SEEDED_KEY, '1'); } catch { /* private mode */ } }
function hasSeeded() { try { return localStorage.getItem(SEEDED_KEY) === '1'; } catch { return false; } }

function newExercise(e, i) {
  return {
    id: db.uid(), name: e.name, muscleGroup: e.muscleGroup,
    defaultSets: e.defaultSets, unit: e.unit, kgPerStufe: 5,
    restSeconds: e.restSeconds || DEFAULT_REST_SECONDS,
    notes: '', createdAt: Date.now() + i,
  };
}

/** The starter library is offered ONCE, on a genuinely new install.
 *  It used to re-seed whenever the exercise store happened to be empty, so deleting your
 *  exercises and reloading brought them all back, and "Reset everything" resurrected them too.
 *  A flag makes a deletion stick; the library can be re-added deliberately from Exercises. */
async function seedIfNeverSeeded() {
  if (hasSeeded()) return;
  const existing = await db.all('exercises');
  if (existing.length) { markSeeded(); return; }   // an older install, already populated
  await db.bulkPut('exercises', SEED_EXERCISES.map(newExercise));
  markSeeded();
}

/** Adds only the starter exercises you do not already have, matched on name. */
async function addStarterLibrary() {
  const have = new Set((await db.all('exercises')).map((e) => String(e.name).toLowerCase()));
  const missing = SEED_EXERCISES.filter((e) => !have.has(e.name.toLowerCase()));
  if (missing.length) await db.bulkPut('exercises', missing.map(newExercise));
  markSeeded();
  return missing.length;
}

/* ---------- routing ---------- */
function parseHash() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home', id: null };
  return { name: parts[0], id: parts[1] || null };
}

const VIEWS = {
  home: homeView, routines: routinesView, exercises: exercisesView,
  exercise: exerciseView, session: sessionView, progress: progressView,
};
const TITLES = {
  home: 'Gym Log', routines: 'Routines', exercises: 'Exercises',
  exercise: 'Exercise', session: 'Workout', progress: 'Progress',
};

/* ---------- rendering ---------- */
function paintRestBadge() {
  const el = $('#restbadge');
  if (!el) return;
  if (state.rest.running) {
    el.hidden = false;
    const m = Math.floor(state.rest.remaining / 60);
    const s = state.rest.remaining % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  } else {
    el.hidden = true;
  }
}

export function render() {
  const fn = VIEWS[state.route.name] || homeView;
  const focusKey = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.focus : null;
  const selStart = document.activeElement && 'selectionStart' in document.activeElement
    ? document.activeElement.selectionStart : null;

  $('#app').innerHTML = fn(state);
  $('#title').textContent = TITLES[state.route.name] || 'Gym Log';
  $('#back').hidden = state.route.name === 'home';
  document.querySelectorAll('#tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === state.route.name);
  });
  paintRestBadge();

  if (focusKey) {
    const again = document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (again) {
      again.focus();
      if (selStart != null && 'setSelectionRange' in again) {
        try { again.setSelectionRange(selStart, selStart); } catch { /* number inputs */ }
      }
    }
  }
}

/* ---------- mutations ---------- */
async function addExercise(name, muscleGroup, defaultSets, unit) {
  name = String(name || '').trim();
  if (!name) return;
  const ex = {
    id: db.uid(), name, muscleGroup: String(muscleGroup || '').trim() || 'Other',
    defaultSets: Math.max(1, Math.round(num(defaultSets, 3))),
    unit: UNIT_IDS.includes(unit) ? unit : 'kg',
    kgPerStufe: 5, notes: '', createdAt: Date.now(),
  };
  await db.put('exercises', ex);
  await loadAll();
}

/** Everything in the database as one JSON file the phone can save. */
async function exportBackup() {
  const [exercises, routines, sessions, sets] = await Promise.all([
    db.all('exercises'), db.all('routines'), db.all('sessions'), db.all('sets'),
  ]);
  const payload = {
    app: 'gym-log', schema: 1, exportedAt: new Date().toISOString(),
    exercises, routines, sessions, sets,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gym-log-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return sessions.length;
}

/** Every set as one spreadsheet row. Semicolon-delimited with a UTF-8 BOM, because that is
 *  what German Excel opens without a five-step import wizard. The JSON backup is for moving
 *  data between installs; this one is for looking at it somewhere else. */
async function exportCsv() {
  const [exercises, routines, sessions, sets] = await Promise.all([
    db.all('exercises'), db.all('routines'), db.all('sessions'), db.all('sets'),
  ]);
  const rows = buildRows({ exercises, routines, sessions, sets });
  const blob = new Blob(['\ufeff' + toCsv(rows, ';')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gym-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return rows.length;
}

/** Adds a routine and any exercises it needs, WITHOUT touching anything already there.
 *  Unlike a backup restore this merges: exercises are matched by name and reused, so
 *  importing a plan twice does not duplicate your library or lose a single logged set. */
async function importRoutine(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.kind !== 'gym-log-routine') throw new Error('That is not a Gym Log routine file.');
  if (!Array.isArray(data.exercises) || !data.exercises.length) throw new Error('That routine has no exercises.');

  const existing = await db.all('exercises');
  const byName = new Map(existing.map((e) => [String(e.name).toLowerCase(), e]));
  const ids = [];
  const created = [];

  for (const spec of data.exercises) {
    const key = String(spec.name || '').toLowerCase();
    if (!key) continue;
    let ex = byName.get(key);
    if (!ex) {
      ex = {
        id: db.uid(), name: spec.name, muscleGroup: spec.group || 'Other',
        defaultSets: Math.max(1, Math.round(num(spec.defaultSets, 3))),
        unit: UNIT_IDS.includes(spec.unit) ? spec.unit : 'kg',
        kgPerStufe: 5, restSeconds: Math.max(5, Math.round(num(spec.restSeconds, DEFAULT_REST_SECONDS))),
        notes: '', createdAt: Date.now() + created.length,
      };
      if (Number(spec.repMin) > 0) ex.repMin = Math.round(Number(spec.repMin));
      if (Number(spec.repMax) > 0) ex.repMax = Math.round(Number(spec.repMax));
      created.push(ex);
      byName.set(key, ex);
    }
    ids.push(ex.id);
  }
  if (created.length) await db.bulkPut('exercises', created);

  await db.put('routines', {
    id: db.uid(), name: String(data.name || 'Imported routine'),
    exerciseIds: ids, order: (await db.all('routines')).length, createdAt: Date.now(),
  });
  markSeeded();
  return { exercises: ids.length, added: created.length };
}

/** Replaces the database with a backup file. This is the ONLY way training data moves
 *  between devices or web addresses — a PWA's storage belongs to one origin and never
 *  follows you, and nothing personal is baked into the app itself. */
async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.app !== 'gym-log') throw new Error('That is not a Gym Log backup file.');
  for (const k of ['exercises', 'routines', 'sessions', 'sets']) {
    if (!Array.isArray(data[k])) throw new Error(`Backup is missing its ${k}.`);
  }
  await db.clearAll();
  await db.bulkPut('exercises', data.exercises);
  await db.bulkPut('routines', data.routines);
  await db.bulkPut('sessions', data.sessions);
  await db.bulkPut('sets', data.sets);
  markSeeded();
  return data.sessions.length;
}

async function startSession(routineId) {
  const routine = routineById(routineId);
  const session = {
    id: db.uid(), routineId: routineId || null,
    routineName: routine ? routine.name : 'Free workout',
    startedAt: Date.now(), endedAt: null, notes: '',
    exerciseIds: routine ? [...routine.exerciseIds] : [],
  };
  await db.put('sessions', session);

  const newSets = [];
  if (routine) {
    for (const eid of routine.exerciseIds) {
      const ex = exerciseById(eid);
      const count = ex ? Math.max(1, ex.defaultSets || 3) : 3;
      for (let i = 0; i < count; i++) {
        newSets.push({
          id: db.uid(), sessionId: session.id, exerciseId: eid, setIndex: i,
          weight: null, reps: null,
          done: false, at: Date.now(), createdAt: Date.now() + i, notes: '',
        });
      }
    }
  }
  if (newSets.length) await db.bulkPut('sets', newSets);
  await loadAll();
  location.hash = `#/session/${session.id}`;
}

async function addSet(sessionId, exerciseId) {
  const existing = setsFor(sessionId).filter((s) => s.exerciseId === exerciseId);
  await db.put('sets', {
    id: db.uid(), sessionId, exerciseId, setIndex: existing.length,
    weight: null, reps: null,
    done: false, at: Date.now(), createdAt: Date.now(), notes: '',
  });
  await loadAll();
}

async function updateSet(id, patch) {
  const s = state.sets.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  await db.put('sets', s);
}

async function addExerciseToSession(sessionId, exerciseId) {
  const session = sessionById(sessionId);
  if (!session) return;
  session.exerciseIds = session.exerciseIds || [];
  if (!session.exerciseIds.includes(exerciseId)) session.exerciseIds.push(exerciseId);
  await db.put('sessions', session);
  const ex = exerciseById(exerciseId);
  const count = ex ? Math.max(1, ex.defaultSets || 3) : 3;
  const newSets = [];
  for (let i = 0; i < count; i++) {
    newSets.push({
      id: db.uid(), sessionId, exerciseId, setIndex: i,
      weight: null, reps: null,
      done: false, at: Date.now(), createdAt: Date.now() + i, notes: '',
    });
  }
  await db.bulkPut('sets', newSets);
  await loadAll();
}

/* ---------- events ---------- */
const ACTIONS = {
  async 'start-routine'(el) { await startSession(el.dataset.id || null); },
  async 'start-empty'() { await startSession(null); },

  async 'add-exercise'() {
    const name = $('#ex-name'), group = $('#ex-group'), sets = $('#ex-sets'), unit = $('#ex-unit');
    await addExercise(name.value, group.value, sets.value, unit ? unit.value : 'kg');
    name.value = '';
    render();
  },
  async 'delete-exercise'(el) {
    await db.del('exercises', el.dataset.id);
    await loadAll(); render();
  },

  async 'add-routine'() {
    const input = $('#routine-name');
    const name = String(input.value || '').trim();
    if (!name) return;
    const id = db.uid();
    await db.put('routines', {
      id, name, exerciseIds: [], order: state.routines.length, createdAt: Date.now(),
    });
    input.value = '';
    state.editingRoutine = id;   // go straight into picking its exercises
    await loadAll(); render();
  },

  'catalog-group'(el) { state.catalogGroup = el.dataset.group || ''; render(); },

  async 'catalog-add'(el) {
    const entry = CATALOG.find((c) => c.name === el.dataset.name);
    if (!entry) return;
    await db.put('exercises', {
      id: db.uid(), name: entry.name, muscleGroup: entry.group,
      defaultSets: 3, unit: entry.unit, kgPerStufe: 5,
      restSeconds: DEFAULT_REST_SECONDS, notes: '', createdAt: Date.now(),
    });
    await loadAll(); render();
  },

  'pick-routine-file'() {
    const input = $('#routine-file');
    if (input) input.click();
  },

  'edit-routine'(el) { state.editingRoutine = el.dataset.id; render(); },
  'done-routine'() { state.editingRoutine = null; render(); },
  async 'delete-routine'(el) {
    if (state.editingRoutine === el.dataset.id) state.editingRoutine = null;
    await db.del('routines', el.dataset.id);
    await loadAll(); render();
  },
  async 'routine-toggle-exercise'(el) {
    const r = routineById(el.dataset.id);
    if (!r) return;
    const eid = el.dataset.eid;
    r.exerciseIds = r.exerciseIds || [];
    const i = r.exerciseIds.indexOf(eid);
    if (i >= 0) r.exerciseIds.splice(i, 1); else r.exerciseIds.push(eid);
    await db.put('routines', r);
    await loadAll(); render();
  },

  async 'add-set'(el) { await addSet(el.dataset.sid, el.dataset.eid); render(); },
  async 'remove-set'(el) {
    await db.del('sets', el.dataset.id);
    await loadAll(); render();
  },
  async 'toggle-done'(el) {
    const s = state.sets.find((x) => x.id === el.dataset.id);
    if (!s) return;
    const nowDone = !s.done;
    await updateSet(s.id, { done: nowDone, at: Date.now() });
    if (nowDone) restTimer.start(restSecondsFor(s.exerciseId));
    await loadAll(); render();
  },
  async 'session-add-exercise'(el) {
    const sel = $('#session-add-select');
    if (!sel || !sel.value) return;
    await addExerciseToSession(el.dataset.sid, sel.value);
    render();
  },
  async 'finish-session'(el) {
    const s = sessionById(el.dataset.id);
    if (s) { s.endedAt = Date.now(); await db.put('sessions', s); }
    restTimer.stop();
    await loadAll();
    location.hash = '#/';
  },
  async 'delete-session'(el) {
    const id = el.dataset.id;
    await db.delMany('sets', setsFor(id).map((s) => s.id));
    await db.del('sessions', id);
    await loadAll(); render();
  },

  /** Writes the coach's target into every set of this exercise you have not ticked off yet.
   *  Deliberately leaves finished sets alone — the log is a record of what happened. */
  async 'apply-suggestion'(el) {
    const sid = el.dataset.sid;
    const eid = el.dataset.eid;
    const loadRaw = el.dataset.load;
    const load = loadRaw === '' || loadRaw == null ? null : Math.max(0, num(loadRaw, 0));
    const repsRaw = el.dataset.reps;
    const reps = repsRaw === '' || repsRaw == null ? null : Math.max(0, Math.round(num(repsRaw, 0)));
    const targets = setsFor(sid).filter((x) => x.exerciseId === eid && !x.done);
    for (const t of targets) {
      if (load !== null) t.weight = load;   // bodyweight work has no load to write
      if (reps !== null) t.reps = reps;
      await db.put('sets', t);
    }
    await loadAll(); render();
  },

  'rest-start'(el) { restTimer.start(num(el.dataset.secs, DEFAULT_REST_SECONDS)); },
  'set-bucket'(el) { state.ui.progressBucket = el.dataset.val; saveUi(); render(); },
  'set-metric'(el) { state.ui.progressMetric = el.dataset.val; saveUi(); render(); },

  'rest-stop'() { restTimer.stop(); render(); },
  'rest-add'(el) { restTimer.addSeconds(num(el.dataset.secs, 30)); },

  async 'export-backup'() {
    const n = await exportBackup();
    window.alert(`Backup downloaded — ${n} sessions.\n\nKeep this file. Your training data lives only in this browser, on this exact web address, so a backup is the only way to move it somewhere else.`);
  },

  async 'export-csv'() {
    const n = await exportCsv();
    window.alert(`Spreadsheet downloaded — ${n} sets.\n\nOpens in Excel, Numbers or LibreOffice. This is a copy to look at; use the JSON backup to move your data to another device.`);
  },

  'pick-backup'() {
    const input = $('#backup-file');
    if (input) input.click();
  },

  async 'reset-all'() {
    if (!confirmish('Delete every workout, routine and exercise?\n\nThis leaves the app completely empty. Your backup file is the only way back.')) return;
    await db.clearAll();
    markSeeded();          // stay empty; do not resurrect the starter library
    await loadAll();
    location.hash = '#/';
    render();
  },

  async 'seed-library'() {
    const n = await addStarterLibrary();
    await loadAll(); render();
    window.alert(n === 0 ? 'You already have all of the starter exercises.' : `Added ${n} starter exercises.`);
  },
};

function confirmish(msg) {
  return typeof window.confirm === 'function' ? window.confirm(msg) : true;
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  try { await fn(el); } catch (err) { console.error('action failed', el.dataset.act, err); }
});

document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-field="catalog-search"]');
  if (!el) return;
  state.catalogQuery = el.value;
  render();
});

document.addEventListener('change', async (ev) => {
  const el = ev.target.closest('[data-field]');
  if (!el) return;
  const field = el.dataset.field;
  if (field === 'weight' || field === 'reps') {
    // An emptied box means "not entered", which is not the same as zero: null keeps the row
    // out of the volume and rep maths instead of logging a genuine 0 kg set.
    const raw = String(el.value).trim();
    const v = raw === ''
      ? null
      : field === 'reps' ? Math.max(0, Math.round(num(raw))) : Math.max(0, num(raw));
    await updateSet(el.dataset.id, { [field]: v });
    await loadAll();
    render();
  } else if (field === 'progress-exercise') {
    state.ui.progressExerciseId = el.value || null;
    // the metric list differs per unit, so drop one the newly picked exercise cannot show
    const allowed = metricsFor(exerciseById(el.value)).map((m) => m.id);
    if (!allowed.includes(state.ui.progressMetric)) state.ui.progressMetric = allowed[0];
    saveUi();
    render();
  } else if (field === 'session-notes') {
    const s = sessionById(el.dataset.id);
    if (s) { s.notes = el.value; await db.put('sessions', s); }
  } else if (field === 'exercise-notes') {
    const e = exerciseById(el.dataset.id);
    if (e) { e.notes = el.value; await db.put('exercises', e); }
  } else if (field === 'backup-file') {
    const file = el.files && el.files[0];
    if (!file) return;
    try {
      const n = await importBackup(file);
      await loadAll();
      render();
      window.alert(`Restored ${n} sessions from the backup.`);
    } catch (err) {
      window.alert(`Could not read that backup: ${err.message}`);
    }
    el.value = '';
  } else if (field === 'routine-file') {
    const file = el.files && el.files[0];
    if (!file) return;
    try {
      const r = await importRoutine(file);
      await loadAll(); render();
      window.alert(`Routine imported — ${r.exercises} exercises, ${r.added} of them new.\n\nNothing already in your library was changed.`);
    } catch (err) {
      window.alert(`Could not read that routine: ${err.message}`);
    }
    el.value = '';
  } else if (field === 'exercise-unit') {
    const e = exerciseById(el.dataset.id);
    if (e) {
      e.unit = UNIT_IDS.includes(el.value) ? el.value : 'kg';
      await db.put('exercises', e);
      await loadAll(); render();
    }
  } else if (field === 'kg-per-stufe') {
    const e = exerciseById(el.dataset.id);
    if (e) {
      e.kgPerStufe = Math.max(0.1, num(el.value, 5));
      await db.put('exercises', e);
      await loadAll(); render();
    }
  } else if (field === 'rest-seconds') {
    const e = exerciseById(el.dataset.id);
    if (e) {
      e.restSeconds = Math.min(600, Math.max(5, Math.round(num(el.value, DEFAULT_REST_SECONDS))));
      await db.put('exercises', e);
      await loadAll(); render();
    }
  } else if (field === 'default-sets') {
    const e = exerciseById(el.dataset.id);
    if (e) { e.defaultSets = Math.max(1, Math.round(num(el.value, 3))); await db.put('exercises', e); }
  }
});

// Tapping a box that already holds a number should let you type over it. Without this the
// caret lands after the existing value and you get 6062.5 instead of 62.5.
//
// Selecting on focus alone is not enough: the click that GAVE focus then places its own
// caret and collapses the selection again. So the element is marked on focus and the
// following mouseup is suppressed, which is what actually keeps the text selected.
let selectOnRelease = null;
const isNumberBox = (el) => el && el.tagName === 'INPUT' && el.type === 'number' && el.value !== '';

document.addEventListener('focusin', (ev) => {
  const el = ev.target;
  if (!isNumberBox(el)) return;
  selectOnRelease = el;
  try { el.select(); } catch { /* some mobile browsers refuse */ }
});

document.addEventListener('mouseup', (ev) => {
  if (!selectOnRelease || ev.target !== selectOnRelease) { selectOnRelease = null; return; }
  ev.preventDefault();
  try { selectOnRelease.select(); } catch { /* ignore */ }
  selectOnRelease = null;
});

// Touch keyboards never fire mouseup before the caret lands, so re-select on the tap end too.
document.addEventListener('touchend', (ev) => {
  const el = ev.target;
  if (!isNumberBox(el)) return;
  setTimeout(() => { try { el.select(); } catch { /* ignore */ } }, 0);
}, { passive: true });

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  const el = ev.target.closest('[data-enter]');
  if (!el) return;
  const btn = document.querySelector(`[data-act="${el.dataset.enter}"]`);
  if (btn) { ev.preventDefault(); btn.click(); }
});

window.addEventListener('hashchange', () => { state.route = parseHash(); render(); });
document.getElementById('back').addEventListener('click', () => history.back());

/* ---------- boot ---------- */
(async function boot() {
  await seedIfNeverSeeded();
  await loadAll();
  state.route = parseHash();
  render();
  document.body.dataset.ready = '1';
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
