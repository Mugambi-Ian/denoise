import { describe, expect, it } from 'vitest';
import { levelFor, nextBandStart, pointAt } from '../src/shared/curve';
import { DEFAULT_SETTINGS as S } from '../src/shared/settings';

const budget = 45 * 60_000;
const at = (min: number) => min * 60_000;

describe('pointAt', () => {
  it('matches the spec table at band edges', () => {
    expect(pointAt(S.curve, 0)).toEqual({ fail: 0, delayMs: 0 });
    expect(pointAt(S.curve, 10 / 45).fail).toBeCloseTo(0.1);
    expect(pointAt(S.curve, 25 / 45).fail).toBeCloseTo(0.4);
    expect(pointAt(S.curve, 40 / 45).fail).toBeCloseTo(0.8);
    expect(pointAt(S.curve, 1).fail).toBeCloseTo(1);
  });
  it('interpolates inside a band', () => {
    const p = pointAt(S.curve, 17.5 / 45);
    expect(p.fail).toBeCloseTo(0.25);
    expect(p.delayMs).toBeCloseTo(2000);
  });
});

describe('levelFor', () => {
  it('ramps toward the next band during a session', () => {
    const start = levelFor(S, at(12), budget, { kind: 'active', progress: 0 });
    const end = levelFor(S, at(12), budget, { kind: 'active', progress: 1 });
    expect(start.failRate).toBeCloseTo(pointAt(S.curve, 12 / 45).fail);
    expect(end.failRate).toBeCloseTo(0.4);
  });
  it('uses the start of the next band during cooldown', () => {
    expect(nextBandStart(S.curve, 12 / 45)).toBeCloseTo(25 / 45);
    const l = levelFor(S, at(12), budget, { kind: 'cooldown' });
    expect(l.failRate).toBeCloseTo(0.4);
    expect(l.autoplayOff).toBe(true);
  });
  it('is near total past the budget', () => {
    const l = levelFor(S, at(50), budget, { kind: 'idle' });
    expect(l.failRate).toBe(S.pastCapFail);
    expect(l.autoplayOff).toBe(true);
  });
  it('keeps autoplay on early in the day', () => {
    expect(levelFor(S, at(3), budget, { kind: 'idle' }).autoplayOff).toBe(false);
  });
});
