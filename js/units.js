// units.js — how an exercise's "load" is measured and displayed.
//
// A set always stores its NATIVE load in `set.weight`:
//   kg    -> kilograms          (36    -> "36 kg")
//   stufe -> machine level      (2     -> "St. 2")
//   time  -> seconds held       (35    -> "35 s")
//
// Only kg-equivalent load feeds the volume charts, so a Stufe number is
// converted first and a plank contributes no kg volume at all.

export const DEFAULT_KG_PER_STUFE = 5; // 1 Stufe ~ 10 lb ~ 5 kg on this gym's stacks

export const UNITS = {
  kg:    { id: 'kg',    label: 'Kilograms',   noun: 'kilograms',   short: 'kg',  hasReps: true,  step: 0.5, e1rm: true },
  stufe: { id: 'stufe', label: 'Stufe',       noun: 'Stufe',       short: 'St.', hasReps: true,  step: 0.5, e1rm: false },
  time:  { id: 'time',  label: 'Seconds held', noun: 'seconds held', short: 's',  hasReps: false, step: 5,   e1rm: false },
};

export function unitOf(exercise) {
  const id = exercise && exercise.unit;
  return UNITS[id] || UNITS.kg;
}

export function kgPerStufe(exercise) {
  const v = exercise && Number(exercise.kgPerStufe);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_KG_PER_STUFE;
}

/** Native load -> kilogram equivalent, for volume maths. Time exercises give 0. */
export function toKg(weight, exercise) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return 0;
  const u = unitOf(exercise);
  if (u.id === 'kg') return w;
  if (u.id === 'stufe') return Math.round(w * kgPerStufe(exercise) * 100) / 100;
  return 0; // time
}

/** "36 kg" | "St. 2" | "35 s" */
export function formatLoad(weight, exercise) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return '—';
  const u = unitOf(exercise);
  const n = (Math.round(w * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (u.id === 'stufe') return `St. ${n}`;
  if (u.id === 'time') return `${n} s`;
  return `${n} kg`;
}

/** Short suffix shown next to an input box. */
export function loadSuffix(exercise) {
  return unitOf(exercise).short;
}

export function hasReps(exercise) {
  return unitOf(exercise).hasReps;
}

export function supportsE1rm(exercise) {
  return unitOf(exercise).e1rm;
}

/** One set, summarised: "36 kg × 12", "St. 2 × 11", "35 s". */
export function describeSet(set, exercise) {
  const load = formatLoad(set && set.weight, exercise);
  if (!hasReps(exercise)) return load;
  const reps = Number(set && set.reps);
  if (!Number.isFinite(reps) || reps <= 0) return `${load} × –`;
  return `${load} × ${reps}`;
}
