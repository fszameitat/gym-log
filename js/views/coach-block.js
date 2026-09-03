// views/coach-block.js — how a suggestion from coach.js is shown. Presentation only:
// every number here was already decided by the rules in coach.js, which is the module
// with the tests. Written by Claude.
import { esc } from '../fmt.js';
import { unitOf, formatLoad } from '../units.js';

/** "42.5 kg × 8", "St. 3 × 10", "50 s", or null when there is nothing to aim at yet. */
export function suggestionTarget(sug, ex) {
  if (!sug || sug.load === null || sug.load === undefined) return null;
  const load = formatLoad(sug.load, ex);
  if (!unitOf(ex).hasReps) return load;
  if (!Number.isFinite(sug.reps) || sug.reps <= 0) return load;
  return `${load} × ${sug.reps}`;
}

const LABELS = {
  'first-time': 'Coach',
  'add-reps':   'Next: more reps',
  'add-load':   'Next: more load',
  'deload':     'Next: back off',
  'hold':       'Next: match your best',
  'no-reps':    'Coach',
};

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

  if (target) html += `<b class="coach-target">${esc(target)}</b>`;

  if (apply && target && sug.kind !== 'first-time' && sug.kind !== 'no-reps') {
    html += `<button class="ghost coach-apply" data-act="apply-suggestion"`
      + ` data-sid="${esc(apply.sessionId)}" data-eid="${esc(apply.exerciseId)}"`
      + ` data-load="${esc(sug.load)}" data-reps="${sug.reps == null ? '' : esc(sug.reps)}">Use</button>`;
  }

  html += `</div><p class="coach-why">${esc(sug.reason)}</p></div>`;
  return html;
}
