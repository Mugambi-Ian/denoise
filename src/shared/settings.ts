import { normalizeDomain, normalizeExemptPath } from './domains';

/** End of a curve segment. Degradation is interpolated linearly from the previous point (the first starts at 0/0/0). */
export interface CurvePoint {
  /** Fraction of the daily budget used, 0–1. */
  at: number;
  /** Media failure rate reached at this point, 0–1. */
  fail: number;
  /** Typical added delay reached at this point, in ms. */
  delayMs: number;
}

export interface Settings {
  sites: string[];
  /** Entries like "x.com/messages": media is left alone there, but time still counts. */
  exemptPaths: string[];
  budgetMin: number;
  sessionMin: [number, number];
  cooldownMin: [number, number];
  idleSec: number;
  curve: CurvePoint[];
  /** Failure rate once the budget is spent. */
  pastCapFail: number;
  /** Autoplay is disabled once the failure rate reaches this. */
  autoplayOffAt: number;
}

export const MAX_SESSION_MIN = 5;

export const DEFAULT_SETTINGS: Settings = {
  sites: [
    'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com',
    'reddit.com', 'linkedin.com', 'threads.net', 'threads.com', 'bsky.app',
  ],
  exemptPaths: [
    'x.com/messages', 'x.com/i/chat', 'instagram.com/direct', 'facebook.com/messages', 'linkedin.com/messaging',
  ],
  budgetMin: 45,
  sessionMin: [2, 5],
  cooldownMin: [10, 30],
  idleSec: 60,
  curve: [
    { at: 10 / 45, fail: 0.1, delayMs: 1000 },
    { at: 25 / 45, fail: 0.4, delayMs: 3000 },
    { at: 40 / 45, fail: 0.8, delayMs: 8000 },
    { at: 1, fail: 1, delayMs: 12000 },
  ],
  pastCapFail: 0.98,
  autoplayOffAt: 0.4,
};

/** Returns a list of problems; empty means valid. */
export function validate(s: Settings): string[] {
  const errs: string[] = [];
  if (!(s.budgetMin > 0)) errs.push('Daily budget must be more than 0 minutes.');
  const [slo, shi] = s.sessionMin;
  if (!(slo > 0 && slo <= shi)) errs.push('Session range must be positive, with min ≤ max.');
  if (shi > MAX_SESSION_MIN) errs.push(`Sessions can't be longer than ${MAX_SESSION_MIN} minutes.`);
  const [clo, chi] = s.cooldownMin;
  if (!(clo > 0 && clo <= chi)) errs.push('Cooldown range must be positive, with min ≤ max.');
  if (!(s.idleSec >= 15)) errs.push('Idle threshold must be at least 15 seconds.');
  if (s.curve.length === 0) errs.push('The curve needs at least one point.');
  let prev: CurvePoint = { at: 0, fail: 0, delayMs: 0 };
  for (const p of s.curve) {
    if (!(p.at > prev.at && p.at <= 1)) errs.push('Curve points must increase and end at or before 100% of the budget.');
    if (!(p.fail >= prev.fail && p.fail <= 1)) errs.push('Curve failure rates must not decrease and must stay ≤ 100%.');
    if (!(p.delayMs >= prev.delayMs)) errs.push('Curve delays must not decrease.');
    prev = p;
  }
  if (!(s.pastCapFail >= 0 && s.pastCapFail <= 1)) errs.push('Past-cap failure rate must be 0–100%.');
  if (!(s.autoplayOffAt >= 0 && s.autoplayOffAt <= 1)) errs.push('Autoplay threshold must be 0–100%.');
  return [...new Set(errs)];
}

export function cleanSites(lines: string[]): string[] {
  return [...new Set(lines.map(normalizeDomain).filter((d): d is string => !!d))];
}

export function cleanExemptPaths(lines: string[]): string[] {
  return [...new Set(lines.map(normalizeExemptPath).filter((d): d is string => !!d))];
}

/** Which way each number moves to make limits stricter. */
const tighterWhen = {
  budgetMin: 'lower',
  idleSec: 'higher',
  pastCapFail: 'higher',
  autoplayOffAt: 'lower',
} as const;

function isTighter(dir: 'lower' | 'higher', from: number, to: number): boolean {
  return dir === 'lower' ? to <= from : to >= from;
}

/** True if every number in `to` is at least as strict as in `from`. */
function curveIsTighter(from: CurvePoint[], to: CurvePoint[]): boolean {
  if (from.length !== to.length) return false;
  return from.every((p, i) => to[i].at <= p.at && to[i].fail >= p.fail && to[i].delayMs >= p.delayMs);
}

export interface Split {
  /** Settings to use from now on: the current ones plus every tightening in the target. */
  apply: Settings;
  /** Loosened fields, with their target values, to apply at the next local midnight. Null if none. */
  pending: Partial<Settings> | null;
}

/**
 * Split a settings change into what applies now (tightening) and what waits until tomorrow (loosening).
 * Ranges are split per end, and sites/exemptions per entry. A curve that loosens anywhere is queued as a whole.
 */
export function splitChange(current: Settings, target: Settings): Split {
  const apply: Settings = structuredClone(current);
  const pending: Partial<Settings> = {};

  for (const key of Object.keys(tighterWhen) as (keyof typeof tighterWhen)[]) {
    if (target[key] === current[key]) continue;
    if (isTighter(tighterWhen[key], current[key], target[key])) apply[key] = target[key];
    else pending[key] = target[key];
  }

  // Shorter sessions are stricter; longer cooldowns are stricter.
  const ranges = [['sessionMin', 'lower'], ['cooldownMin', 'higher']] as const;
  for (const [key, dir] of ranges) {
    const [flo, fhi] = current[key];
    const [tlo, thi] = target[key];
    if (flo === tlo && fhi === thi) continue;
    const lo = isTighter(dir, flo, tlo);
    const hi = isTighter(dir, fhi, thi);
    apply[key] = [lo ? tlo : flo, hi ? thi : fhi];
    if (!lo || !hi) pending[key] = [tlo, thi];
  }

  // Added sites apply now; removals wait.
  const removed = current.sites.filter((s) => !target.sites.includes(s));
  apply.sites = [...current.sites, ...target.sites.filter((s) => !current.sites.includes(s))];
  if (removed.length) pending.sites = target.sites;

  // Removed exemptions apply now; additions wait.
  const added = target.exemptPaths.filter((p) => !current.exemptPaths.includes(p));
  apply.exemptPaths = current.exemptPaths.filter((p) => target.exemptPaths.includes(p));
  if (added.length) pending.exemptPaths = target.exemptPaths;

  if (JSON.stringify(current.curve) !== JSON.stringify(target.curve)) {
    if (curveIsTighter(current.curve, target.curve)) apply.curve = target.curve;
    else pending.curve = target.curve;
  }

  return { apply, pending: Object.keys(pending).length ? pending : null };
}

/** What the user is aiming for: current settings with queued changes laid on top. */
export function withPending(current: Settings, pending: Partial<Settings> | null): Settings {
  return { ...current, ...(pending ?? {}) };
}
