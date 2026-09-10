// views/exercise-progress.js — progression for ONE exercise, bucketed per session, week or
// month, with the change against the previous bucket. Used twice: on the Progress tab with an
// exercise picker (so any exercise can be examined, not only your top lifts), and on an
// exercise's own page without one. Written by Claude.
//
// Which numbers are offered depends on the unit: an estimated 1RM is meaningless for a machine
// level, a plank has no reps, and a set of push-ups has no load — so each unit gets the metrics
// that actually describe it.
import { esc, fmtKg, fmtVolume } from '../fmt.js';
import { progressSeries, withDeltas } from '../series.js';
import { lineChart, barChart } from '../charts.js';
import { unitOf, formatLoad } from '../units.js';

export const BUCKETS = [
  { id: 'session', label: 'Session' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/** How far back the chart reaches. 25 by default: enough that a couple of months of training
 *  is on screen at once, few enough that the bars stay wide enough to aim a thumb at. */
export const SPANS = [
  { id: '10', label: 'Last 10' },
  { id: '25', label: 'Last 25' },
  { id: 'all', label: 'All' },
];

/** The tail of a series that the chosen span asks for. */
export function windowFor(series, span) {
  if (!Array.isArray(series)) return [];
  if (span === 'all') return series.slice();
  const n = Number(span);
  if (!Number.isFinite(n) || n <= 0) return series.slice();
  return series.slice(-Math.floor(n));
}

export function metricsFor(exercise) {
  const u = unitOf(exercise);
  switch (u.id) {
    case 'time':
      return [
        { id: 'maxLoad', label: 'Longest hold' },
        { id: 'nativeSum', label: 'Total time' },
        { id: 'sets', label: 'Holds' },
      ];
    case 'cardio':
      return [
        { id: 'nativeSum', label: 'Total minutes' },
        { id: 'maxLoad', label: 'Longest go' },
        { id: 'sets', label: 'Sessions' },
      ];
    case 'body':
      return [
        { id: 'bestReps', label: 'Best set' },
        { id: 'reps', label: 'Total reps' },
        { id: 'sets', label: 'Sets' },
      ];
    case 'stufe':
      return [
        { id: 'maxLoad', label: 'Top level' },
        { id: 'volume', label: 'Volume' },
        { id: 'reps', label: 'Reps' },
        { id: 'sets', label: 'Sets' },
      ];
    default:
      return [
        { id: 'maxLoad', label: 'Top weight' },
        { id: 'best1rm', label: 'Est. 1RM' },
        { id: 'volume', label: 'Volume' },
        { id: 'reps', label: 'Reps' },
      ];
  }
}

export function formatMetric(value, metric, exercise) {
  if (!Number.isFinite(value)) return '—';
  const u = unitOf(exercise);
  switch (metric) {
    case 'maxLoad': return formatLoad(value, exercise);
    case 'best1rm': return `${fmtKg(value)} kg`;
    case 'volume': return fmtVolume(value);
    case 'reps':
    case 'bestReps': return `${Math.round(value)} reps`;
    case 'sets':
      return `${Math.round(value)} ${u.id === 'time' ? 'holds' : u.id === 'cardio' ? 'sessions' : 'sets'}`;
    case 'nativeSum':
      if (u.id === 'time') return `${Math.round(value)} s`;
      if (u.id === 'cardio') return `${Math.round(value)} min`;
      return fmtKg(value);
    default: return String(value);
  }
}

function deltaChip(entry, metric) {
  if (entry.delta === null || entry.delta === 0) return `<span class="delta flat">±0</span>`;
  const up = entry.delta > 0;
  const sign = up ? '+' : '−';
  const abs = Math.abs(entry.delta);
  const shown = (metric === 'reps' || metric === 'sets' || metric === 'bestReps')
    ? Math.round(abs)
    : (Math.round(abs * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const pct = entry.pct === null
    ? ''
    : ` <em>${sign}${Math.abs(entry.pct).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</em>`;
  return `<span class="delta ${up ? 'up' : 'down'}">${sign}${shown}${pct}</span>`;
}

/**
 * @param state    app state
 * @param exercise the exercise to chart (may be undefined when nothing is selected)
 * @param opts     { showPicker }
 */
export function exerciseProgress(state, exercise, opts = {}) {
  const ui = state.ui || {};
  const bucket = BUCKETS.some((b) => b.id === ui.progressBucket) ? ui.progressBucket : 'session';
  const span = SPANS.some((s) => s.id === ui.progressSpan) ? ui.progressSpan : '25';

  let html = `<section class="card"><h2>Exercise progress</h2>`;

  if (opts.showPicker) {
    const sorted = [...state.exercises].sort((a, b) => a.name.localeCompare(b.name));
    html += `<div class="form"><select id="progress-exercise" data-field="progress-exercise" aria-label="Exercise">`
      + (sorted.length === 0 ? `<option value="">No exercises yet</option>` : '')
      + sorted.map((e) => `<option value="${e.id}"${exercise && e.id === exercise.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('')
      + `</select></div>`;
  }

  if (!exercise) {
    return html + `<p class="muted">Pick an exercise to see how it has moved.</p></section>`;
  }

  const metrics = metricsFor(exercise);
  const metric = metrics.some((m) => m.id === ui.progressMetric) ? ui.progressMetric : metrics[0].id;

  html += `<div class="chips seg" role="group" aria-label="Time span">`
    + BUCKETS.map((b) => `<button class="chip${b.id === bucket ? ' on' : ''}" data-act="set-bucket" data-val="${b.id}">${b.label}</button>`).join('')
    + `</div>`
    + `<div class="chips seg" role="group" aria-label="Metric">`
    + metrics.map((m) => `<button class="chip${m.id === metric ? ' on' : ''}" data-act="set-metric" data-val="${m.id}">${m.label}</button>`).join('')
    + `</div>`
    + `<div class="chips seg" role="group" aria-label="How much history">`
    + SPANS.map((s) => `<button class="chip${s.id === span ? ' on' : ''}" data-act="set-span" data-val="${s.id}">${s.label}</button>`).join('')
    + `</div>`;

  const sets = state.sets.filter((s) => s.exerciseId === exercise.id);
  const series = withDeltas(progressSeries(sets, { bucket, metric, sessions: state.sessions }));

  if (series.length === 0) {
    return html + `<p class="muted">Nothing logged for ${esc(exercise.name)} yet.</p></section>`;
  }

  const latest = series[series.length - 1];
  const best = series.reduce((m, x) => (x.value > m.value ? x : m), series[0]);
  const first = series[0];
  const overall = first.value === 0 ? null : Math.round(((latest.value - first.value) / first.value) * 1000) / 10;

  html += `<section class="tiles">`
    + `<div class="tile"><b>${formatMetric(latest.value, metric, exercise)}</b><span>latest</span></div>`
    + `<div class="tile"><b>${deltaChip(latest, metric)}</b><span>vs previous</span></div>`
    + `<div class="tile"><b>${formatMetric(best.value, metric, exercise)}</b><span>best</span></div>`
    + `<div class="tile"><b>${overall === null ? '—' : (overall > 0 ? '+' : '') + overall.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%'}</b><span>since start</span></div>`
    + `</section>`;

  const shown = windowFor(series, span);
  const points = shown.map((p) => ({ key: p.label, value: p.value }));
  const cumulative = metric === 'volume' || metric === 'reps' || metric === 'sets' || metric === 'nativeSum';
  const chartOpts = {
    width: 340, height: 190,
    label: `${metrics.find((m) => m.id === metric).label} per ${bucket}`,
    empty: 'Log a session to start this chart',
  };
  html += `<div class="chart">${cumulative
    ? barChart(points, { ...chartOpts, color: '#38bdf8' })
    : lineChart(points, chartOpts)}</div>`;

  // The list mirrors the chart, newest first, so the chips move both together.
  html += `<ul class="list compact">`;
  for (const entry of shown.slice().reverse()) {
    html += `<li><span class="li-t">${esc(entry.label)}</span>`
      + `<span class="li-s">${formatMetric(entry.value, metric, exercise)} ${deltaChip(entry, metric)}</span></li>`;
  }
  html += `</ul></section>`;

  return html;
}
