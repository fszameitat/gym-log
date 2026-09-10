// views/coach-block.js — how a suggestion from coach.js is shown. Presentation only:
// every number here was already decided by the rules in coach.js, which is the module
// with the tests. Written by Claude.
import { esc } from '../fmt.js';
import { unitOf, formatLoad } from '../units.js';

/** "42.5 kg × 8", "St. 3 × 10", "50 s", "15 reps", or null when there is nothing to aim
 *  at yet. Bodyweight work has no load at all, so the rep count IS the whole target —
 *  before v6 this returned null for it and the coach block rendered with no target. */
export function suggestionTarget(sug, ex) {
  if (!sug) return null;
  const u = unitOf(ex);
  const reps = Number(sug.reps);
  if (!u.hasLoad) {
    return Number.isFinite(reps) && reps > 0 ? `${reps} reps` : null;
  }
  if (sug.load === null || sug.load === undefined) return null;
  const load = formatLoad(sug.load, ex);
  if (!u.hasReps) return load;
  if (!Number.isFinite(reps) || reps <= 0) return load;
  return `${load} × ${reps}`;
}

const LABELS = {
  'first-time': 'Coach',
  'add-reps':   'Next: more reps',
  'add-load':   'Next: more load',
  'deload':     'Next: back off',
  'hold':       'Next: match your best',
  'no-reps':    'Coach',
  'add-set':    'Next: another set',
  'per-set':    'Next: set by set',
};

/** "45|10,50|8,55|6" — what the Use button hands back to the app. Compact on purpose: it
 *  rides in a data attribute, and a set with no target keeps its slot as an empty field so
 *  the positions never shift. */
export function encodePerSet(perSet) {
  if (!Array.isArray(perSet)) return '';
  return perSet.map((p) => {
    const l = p && p.load !== null && p.load !== undefined && Number.isFinite(Number(p.load)) ? Number(p.load) : '';
    const r = p && p.reps !== null && p.reps !== undefined && Number.isFinite(Number(p.reps)) ? Number(p.reps) : '';
    return `${l}|${r}`;
  }).join(',');
}

export function decodePerSet(text) {
  if (typeof text !== 'string' || text === '') return [];
  return text.split(',').map((chunk) => {
    const [l, r] = chunk.split('|');
    const load = l === '' || l === undefined ? null : Number(l);
    const reps = r === '' || r === undefined ? null : Number(r);
    return {
      load: Number.isFinite(load) ? load : null,
      reps: Number.isFinite(reps) ? Math.round(reps) : null,
    };
  });
}

/** The headline for a pyramid: the span the targets cover, "42.5 kg – 50 kg". A bare count
 *  of sets would be the one place on the screen that drops the unit, and the unit is the
 *  thing that stops a Stufe exercise being read as kilos. */
function perSetHeadline(perSet, ex) {
  const u = unitOf(ex);
  const loads = perSet
    .map((p) => Number(p.load))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!u.hasLoad || loads.length === 0) {
    return `${perSet.length} set${perSet.length === 1 ? '' : 's'}`;
  }
  const lo = Math.min(...loads);
  const hi = Math.max(...loads);
  if (lo === hi) return formatLoad(lo, ex);
  // "42.5–50 kg", not "42.5 kg – 50 kg": the unit is the same on both ends, and the long
  // form pushes the Use button onto its own line at phone width.
  const n = (v) => (Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (u.id === 'stufe') return `St. ${n(lo)}–${n(hi)}`;
  return `${n(lo)}–${formatLoad(hi, ex)}`;
}

/** One line per set: "2  45 kg × 10", with what that set did last time behind it. */
function perSetList(perSet, ex) {
  const u = unitOf(ex);
  const rows = perSet.map((p, i) => {
    const target = p.load === null || p.load === undefined
      ? (Number.isFinite(Number(p.reps)) ? `${Number(p.reps)} reps` : '—')
      : (u.hasReps && Number.isFinite(Number(p.reps)) && Number(p.reps) > 0
          ? `${formatLoad(p.load, ex)} &times; ${Number(p.reps)}`
          : formatLoad(p.load, ex));
    const was = p.lastLoad === null || p.lastLoad === undefined
      ? ''
      : `<span class="coach-was">was ${formatLoad(p.lastLoad, ex)}`
        + (Number.isFinite(Number(p.lastReps)) ? ` &times; ${Number(p.lastReps)}` : '')
        + `</span>`;
    return `<li><span class="coach-n">${i + 1}</span><b>${target}</b>${was}</li>`;
  }).join('');
  return `<ol class="coach-sets">${rows}</ol>`;
}

/**
 * @param apply  when given, renders a button that writes the target into the open
 *               workout's unfinished sets: { sessionId, exerciseId }
 */
export function coachBlock(sug, ex, apply) {
  if (!sug) return '';
  const target = suggestionTarget(sug, ex);
  const label = LABELS[sug.kind] || 'Coach';

  let html = `<div class="coach coach-${esc(sug.kind)}">`
    + `<div class="coach-head"><span class="coach-label">${esc(label)}</span>`;

  const perSet = sug.kind === 'per-set' && Array.isArray(sug.perSet) ? sug.perSet : [];

  if (target) html += `<b class="coach-target">${esc(target)}</b>`;
  else if (perSet.length) html += `<b class="coach-target">${esc(perSetHeadline(perSet, ex))}</b>`;

  if (apply && (target || perSet.length) && sug.kind !== 'first-time' && sug.kind !== 'no-reps') {
    html += `<button class="ghost coach-apply" data-act="apply-suggestion"`
      + ` data-sid="${esc(apply.sessionId)}" data-eid="${esc(apply.exerciseId)}"`
      + ` data-load="${esc(sug.load)}" data-reps="${sug.reps == null ? '' : esc(sug.reps)}"`
      + ` data-perset="${esc(encodePerSet(perSet))}">Use</button>`;
  }

  html += `</div><p class="coach-why">${esc(sug.reason)}</p>`;
  if (perSet.length) html += perSetList(perSet, ex);
  html += `</div>`;
  return html;
}
