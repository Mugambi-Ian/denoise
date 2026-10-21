import type { Phase } from '../shared/curve';
import type { Settings } from '../shared/settings';
import { MINUTE, clamp, dayKey, startOfDay, type Rng } from '../shared/time';

export type Session =
  | { state: 'idle' }
  | { state: 'active'; lengthMs: number; elapsedMs: number; lastActiveAt: number }
  | { state: 'cooldown'; until: number };

export interface Day {
  key: string;
  usedMs: number;
  session: Session;
}

export function newDay(now: number): Day {
  return { key: dayKey(now), usedMs: 0, session: { state: 'idle' } };
}

export function budgetMs(s: Settings): number {
  return s.budgetMin * MINUTE;
}

function drawSessionMs(s: Settings, rng: Rng): number {
  const [lo, hi] = s.sessionMin;
  return (lo + rng() * (hi - lo)) * MINUTE;
}

/** Random cooldown in range, pushed toward the top as the day's budget is used. */
export function drawCooldownMs(s: Settings, usedMs: number, rng: Rng): number {
  const [lo, hi] = s.cooldownMin;
  const w = clamp(usedMs / budgetMs(s), 0, 1);
  return (lo + (w + (1 - w) * rng()) * (hi - lo)) * MINUTE;
}

/**
 * Advance the day by one tracker step.
 * `creditMs` is listed-site active time since the last step; `counting` says whether that is still going on now.
 */
export function step(day: Day, s: Settings, now: number, creditMs: number, counting: boolean, rng: Rng): Day {
  const d: Day = { ...day, session: { ...day.session } };
  let session = d.session;

  if (creditMs > 0) {
    d.usedMs += creditMs;
    if (session.state === 'active') session = { ...session, elapsedMs: session.elapsedMs + creditMs, lastActiveAt: now };
  }

  if (session.state === 'active') {
    if (session.elapsedMs >= session.lengthMs) {
      session = { state: 'cooldown', until: now + drawCooldownMs(s, d.usedMs, rng) };
    } else if (!counting && now - session.lastActiveAt >= s.cooldownMin[0] * MINUTE) {
      // Away long enough to count as a cooldown already.
      session = { state: 'idle' };
    }
  }
  if (session.state === 'cooldown' && now >= session.until) session = { state: 'idle' };
  if (session.state === 'idle' && counting) {
    session = { state: 'active', lengthMs: drawSessionMs(s, rng), elapsedMs: 0, lastActiveAt: now };
  }

  d.session = session;
  return d;
}

/** Time left in the current session while it's being used, so a precise end can be scheduled. Never shown to the user. */
export function sessionRemainingMs(day: Day): number | null {
  return day.session.state === 'active' ? Math.max(0, day.session.lengthMs - day.session.elapsedMs) : null;
}

export function phaseOf(day: Day): Phase {
  const s = day.session;
  if (s.state === 'active') return { kind: 'active', progress: s.elapsedMs / s.lengthMs };
  if (s.state === 'cooldown') return { kind: 'cooldown' };
  return { kind: 'idle' };
}

/**
 * Time charged when the extension was off while Chrome kept running: the part of the gap that falls on today,
 * capped at the budget. Gaps up to `graceMs` are normal heartbeat jitter.
 */
export function disablePenaltyMs(lastHeartbeat: number, now: number, s: Settings, graceMs: number): number {
  const gap = now - lastHeartbeat;
  if (!(gap > graceMs)) return 0;
  const todayGap = now - Math.max(lastHeartbeat, startOfDay(now));
  return clamp(todayGap, 0, budgetMs(s));
}
