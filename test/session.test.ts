import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S } from '../src/shared/settings';
import { disablePenaltyMs, drawCooldownMs, newDay, step, type Day } from '../src/background/session';

const MIN = 60_000;
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime();

/** Simulate continuous use in 30 s steps; returns the longest stretch of active-session time seen. */
function simulate(minutes: number, rng: () => number) {
  let day: Day = newDay(T0);
  let now = T0;
  let longest = 0;
  let cooldowns = 0;
  day = step(day, S, now, 0, true, rng);
  for (let i = 0; i < minutes * 2; i++) {
    now += 30_000;
    const before: Day["session"]["state"] = day.session.state;
    day = step(day, S, now, 30_000, true, rng);
    if (day.session.state === 'active') longest = Math.max(longest, day.session.elapsedMs);
    if (before !== 'cooldown' && day.session.state === 'cooldown') cooldowns++;
  }
  return { day, longest, cooldowns };
}

describe('session state machine', () => {
  it('starts a session when use begins', () => {
    const d = step(newDay(T0), S, T0, 0, true, () => 0.5);
    expect(d.session.state).toBe('active');
  });
  it('never lets a session run past 5 minutes', () => {
    for (const r of [0, 0.5, 0.999]) {
      const { longest, cooldowns } = simulate(120, () => r);
      expect(longest).toBeLessThan(5 * MIN);
      expect(cooldowns).toBeGreaterThan(0);
    }
  });
  it('counts time during cooldown toward the budget', () => {
    const { day } = simulate(60, () => 0.5);
    expect(day.usedMs).toBe(60 * MIN);
  });
  it('ends an abandoned session after a cooldown-length absence', () => {
    let d = step(newDay(T0), S, T0, 0, true, () => 0.5);
    d = step(d, S, T0 + MIN, MIN, false, () => 0.5);
    expect(d.session.state).toBe('active');
    d = step(d, S, T0 + 12 * MIN, 0, false, () => 0.5);
    expect(d.session.state).toBe('idle');
  });
  it('leaves cooldown once it expires', () => {
    const d: Day = { ...newDay(T0), session: { state: 'cooldown', until: T0 + MIN } };
    expect(step(d, S, T0 + 2 * MIN, 0, false, () => 0.5).session.state).toBe('idle');
    expect(step(d, S, T0 + 2 * MIN, 0, true, () => 0.5).session.state).toBe('active');
  });
  it('lengthens cooldowns as the budget is used', () => {
    expect(drawCooldownMs(S, 0, () => 0)).toBe(10 * MIN);
    expect(drawCooldownMs(S, 45 * MIN, () => 0)).toBe(30 * MIN);
    expect(drawCooldownMs(S, 22.5 * MIN, () => 0)).toBe(20 * MIN);
  });
});

describe('disable penalty', () => {
  it('ignores ordinary heartbeat gaps', () => {
    expect(disablePenaltyMs(T0, T0 + 60_000, S, 2 * MIN)).toBe(0);
  });
  it('charges the gap, capped at the budget', () => {
    expect(disablePenaltyMs(T0, T0 + 20 * MIN, S, 2 * MIN)).toBe(20 * MIN);
    expect(disablePenaltyMs(T0, T0 + 3 * 60 * MIN, S, 2 * MIN)).toBe(45 * MIN);
  });
  it('only charges the part of the gap that falls on today', () => {
    const lateLastNight = new Date(2026, 9, 19, 23, 0).getTime();
    const morning = new Date(2026, 9, 20, 0, 10).getTime();
    expect(disablePenaltyMs(lateLastNight, morning, S, 2 * MIN)).toBe(10 * MIN);
  });
});
