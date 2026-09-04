// units.js — how an exercise's "load" is measured and displayed.
//
// A set always stores its NATIVE load in `set.weight`:
//   kg     -> kilograms          (36  -> "36 kg")
//   stufe  -> machine level      (2   -> "St. 2")
//   time   -> seconds held       (35  -> "35 s")
//   cardio -> minutes worked     (10  -> "10 min")
//   body   -> nothing at all; only the rep count is logged
//
// Only kg-equivalent load feeds the volume charts, so a Stufe number is converted
// first and a plank, a row and a set of push-ups contribute no kilograms at all.
//
// v6 added `body` and `cardio`. Before them, a set was only counted if its weight was
// greater than zero, which made a set of fifteen push-ups impossible to log: there is no
// weight to put in the box. `hasLoad: false` marks the units where reps alone are the
// record, and the maths downstream keys off that instead of off a weight being present.

export const DEFAULT_KG_PER_STUFE = 5; // 1 Stufe ~ 10 lb ~ 5 kg on this gym's stacks

export const UNITS = {
  kg:     { id: 'kg',     label: 'Kilograms',     noun: 'kilograms',    short: 'kg',  hasReps: true,  hasLoad: true,  step: 0.5, e1rm: true  },
  stufe:  { id: 'stufe',  label: 'Stufe',         noun: 'Stufe',        short: 'St.', hasReps: true,  hasLoad: true,  step: 0.5, e1rm: false },
  body:   { id: 'body',   label: 'Bodyweight',    noun: 'repetitions',  short: '',    hasReps: true,  hasLoad: false, step: 1,   e1rm: false },
  time:   { id: 'time',   label: 'Seconds held',  noun: 'seconds held', short: 's',   hasReps: false, hasLoad: true,  step: 5,   e1rm: false },
  cardio: { id: 'cardio', label: 'Minutes',       noun: 'minutes',      short: 'min', hasReps: false, hasLoad: true,  step: 1,   e1rm: false },
};

export const UNIT_IDS = Object.keys(UNITS);

export function unitOf(exercise) {
  const id = exercise && exercise.unit;
  return UNITS[id] || UNITS.kg;
}

export function kgPerStufe(exercise) {
  const v = exercise && Number(exercise.kgPerStufe);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_KG_PER_STUFE;
}

/** Native load -> kilogram equivalent, for volume maths. Everything but kg and Stufe gives 0. */
export function toKg(weight, exercise) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return 0;
  const u = unitOf(exercise);
  if (u.id === 'kg') return w;
  if (u.id === 'stufe') return Math.round(w * kgPerStufe(exercise) * 100) / 100;
  return 0; // time, cardio, body
}

/** "36 kg" | "St. 2" | "35 s" | "10 min". Bodyweight has no load to show. */
export function formatLoad(weight, exercise) {
  const u = unitOf(exercise);
  if (!u.hasLoad) return '';
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return '—';
  const n = (Math.round(w * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (u.id === 'stufe') return `St. ${n}`;
  if (u.id === 'time') return `${n} s`;
  if (u.id === 'cardio') return `${n} min`;
  return `${n} kg`;
}

/** Short suffix shown next to an input box. */
export function loadSuffix(exercise) {
  return unitOf(exercise).short;
}

export function hasReps(exercise) {
  return unitOf(exercise).hasReps;
}

/** False for bodyweight work, where the rep count IS the record. */
export function hasLoad(exercise) {
  return unitOf(exercise).hasLoad;
}

export function supportsE1rm(exercise) {
  return unitOf(exercise).e1rm;
}

/** One set, summarised: "36 kg × 12", "St. 2 × 11", "35 s", "10 min", "× 15". */
export function describeSet(set, exercise) {
  const u = unitOf(exercise);
  const load = formatLoad(set && set.weight, exercise);
  if (!u.hasReps) return load;
  const reps = Number(set && set.reps);
  const repText = Number.isFinite(reps) && reps > 0 ? String(reps) : '–';
  if (!u.hasLoad) return `${repText} reps`;
  return `${load} × ${repText}`;
}
