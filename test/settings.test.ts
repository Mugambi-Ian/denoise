import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S, splitChange, validate, withPending, type Settings } from '../src/shared/settings';

const change = (patch: Partial<Settings>) => splitChange(S, { ...structuredClone(S), ...patch });

describe('splitChange', () => {
  it('applies tightening immediately', () => {
    const { apply, pending } = change({ budgetMin: 30, cooldownMin: [15, 40], sessionMin: [1, 3] });
    expect(apply.budgetMin).toBe(30);
    expect(apply.cooldownMin).toEqual([15, 40]);
    expect(apply.sessionMin).toEqual([1, 3]);
    expect(pending).toBeNull();
  });
  it('queues loosening', () => {
    const { apply, pending } = change({ budgetMin: 60 });
    expect(apply.budgetMin).toBe(45);
    expect(pending).toEqual({ budgetMin: 60 });
  });
  it('splits ranges per end', () => {
    const { apply, pending } = change({ sessionMin: [3, 4] });
    expect(apply.sessionMin).toEqual([2, 4]);
    expect(pending?.sessionMin).toEqual([3, 4]);
  });
  it('adds sites now and removes them tomorrow', () => {
    const sites = [...S.sites.filter((s) => s !== 'reddit.com'), 'youtube.com'];
    const { apply, pending } = change({ sites });
    expect(apply.sites).toContain('reddit.com');
    expect(apply.sites).toContain('youtube.com');
    expect(pending?.sites).toEqual(sites);
  });
  it('treats new exemptions as loosening and removed ones as tightening', () => {
    const added = change({ exemptPaths: [...S.exemptPaths, 'reddit.com/chat'] });
    expect(added.apply.exemptPaths).toEqual(S.exemptPaths);
    expect(added.pending?.exemptPaths).toContain('reddit.com/chat');
    const removed = change({ exemptPaths: S.exemptPaths.slice(1) });
    expect(removed.apply.exemptPaths).toEqual(S.exemptPaths.slice(1));
    expect(removed.pending).toBeNull();
  });
  it('queues a curve that softens anywhere', () => {
    const harsher = S.curve.map((p) => ({ ...p, fail: Math.min(1, p.fail + 0.05) }));
    expect(change({ curve: harsher }).pending).toBeNull();
    const softer = S.curve.map((p, i) => (i === 0 ? { ...p, fail: 0.05 } : p));
    expect(change({ curve: softer }).pending?.curve).toEqual(softer);
  });
  it('lands on the target once pending applies', () => {
    const target = { ...structuredClone(S), budgetMin: 60, sessionMin: [3, 4] as [number, number] };
    const { apply, pending } = splitChange(S, target);
    expect(withPending(apply, pending)).toEqual(target);
  });
});

describe('validate', () => {
  it('accepts the defaults', () => expect(validate(S)).toEqual([]));
  it('rejects sessions over 5 minutes', () => {
    expect(validate({ ...S, sessionMin: [2, 6] }).length).toBeGreaterThan(0);
  });
});
