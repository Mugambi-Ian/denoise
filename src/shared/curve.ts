import type { CurvePoint, Settings } from './settings';
import { clamp } from './time';

export interface Level {
  failRate: number;
  delayMinMs: number;
  delayMaxMs: number;
  autoplayOff: boolean;
}

export const NO_DEGRADATION: Level = { failRate: 0, delayMinMs: 0, delayMaxMs: 0, autoplayOff: false };

/** Failure rate and typical delay at a fraction of the budget, interpolated along the curve. */
export function pointAt(curve: CurvePoint[], frac: number): { fail: number; delayMs: number } {
  let prev: CurvePoint = { at: 0, fail: 0, delayMs: 0 };
  for (const p of curve) {
    if (frac <= p.at) {
      const t = p.at === prev.at ? 1 : (frac - prev.at) / (p.at - prev.at);
      return { fail: prev.fail + t * (p.fail - prev.fail), delayMs: prev.delayMs + t * (p.delayMs - prev.delayMs) };
    }
    prev = p;
  }
  return { fail: prev.fail, delayMs: prev.delayMs };
}

/** Start of the band above `frac`: the first curve point strictly past it. */
export function nextBandStart(curve: CurvePoint[], frac: number): number {
  return curve.find((p) => p.at > frac)?.at ?? 1;
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'active'; progress: number }
  | { kind: 'cooldown' };

/**
 * Degradation for today's usage and the current phase:
 * - between sessions: the curve at today's usage;
 * - in a session: ramps from there toward the next band as the session nears its end;
 * - in cooldown: the start of the next band;
 * - past the budget: near-total failure.
 */
export function levelFor(settings: Settings, usedMs: number, budgetMs: number, phase: Phase): Level {
  const frac = usedMs / budgetMs;
  if (frac >= 1) {
    return { failRate: settings.pastCapFail, ...delays(pointAt(settings.curve, 1).delayMs), autoplayOff: true };
  }
  const next = nextBandStart(settings.curve, frac);
  let effective = frac;
  if (phase.kind === 'active') effective = frac + clamp(phase.progress, 0, 1) * (next - frac);
  else if (phase.kind === 'cooldown') effective = next;
  const { fail, delayMs } = pointAt(settings.curve, effective);
  return { failRate: fail, ...delays(delayMs), autoplayOff: fail >= settings.autoplayOffAt };
}

/** Per-item delays are drawn around the typical delay. */
function delays(typicalMs: number): { delayMinMs: number; delayMaxMs: number } {
  return { delayMinMs: Math.round(typicalMs * 0.5), delayMaxMs: Math.round(typicalMs * 1.5) };
}
