declare const __FAST__: boolean;

/** One "minute" of budget. A fast build (DENOISE_FAST=1) shrinks it to a second for end-to-end testing. */
export const MINUTE = __FAST__ ? 1000 : 60_000;

/** Local calendar day, e.g. "2026-10-20". The budget resets when this changes. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export type Rng = () => number;
