// fmt.js — small formatting helpers shared by the views. Written by Claude.
export { esc } from './charts.js';

export function fmtDate(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(ts)) return '—';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
}

export function fmtDateTime(ts) {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return `${fmtDate(ts)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

export function fmtKg(n) {
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtVolume(n) {
  if (!Number.isFinite(n)) return '0 kg';
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`;
  return `${fmtKg(n)} kg`;
}

export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
