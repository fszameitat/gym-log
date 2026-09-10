// lock.js — one editable block at a time.
//
// Scrolling through a workout on a phone means dragging a finger straight across the weight
// and rep boxes. A stray tap focuses one, the keyboard jumps up, and because v6 selects the
// whole value on focus, the next keystroke wipes a logged set. So every block of inputs is
// LOCKED by default: its fields are disabled, so they cannot take focus and no keyboard can
// appear. Tapping a locked block unlocks it — and locks whichever was open before, because
// you are only ever standing at one machine.
//
// Buttons are deliberately NOT locked. Ticking a set off is the thing you do most during a
// workout, and the rest timer has to stay one tap away.
import { esc } from './charts.js';

export function isUnlocked(state, id) {
  if (typeof id !== 'string' || id === '') return false;
  if (!state || typeof state !== 'object') return false;
  const ui = state.ui;
  if (!ui || typeof ui !== 'object') return false;
  return ui.unlockedId === id;
}

/** Attributes for the element that wraps a set of inputs. Keeps the caller's own classes. */
export function lockAttr(state, id, extra) {
  const own = typeof extra === 'string' && extra.trim() ? `${extra.trim()} ` : '';
  const cls = `${own}lockable ${isUnlocked(state, id) ? 'unlocked' : 'locked'}`;
  return ` class="${cls}" data-lock-id="${esc(id)}"`;
}

/** Disabled inputs cannot be focused at all, which is the whole point — readonly still
 *  opens the keyboard on iOS. */
export function disabledAttr(state, id) {
  return isUnlocked(state, id) ? '' : ' disabled';
}

export function lockButton(state, id) {
  const open = isUnlocked(state, id);
  return `<button class="lockbtn${open ? ' on' : ''}" data-act="toggle-lock" data-val="${esc(id)}"`
    + ` aria-pressed="${open ? 'true' : 'false'}"`
    + ` aria-label="${open ? 'Lock this exercise' : 'Unlock to edit'}">`
    + `${open ? '&#128275; Done' : '&#128274; Edit'}</button>`;
}
