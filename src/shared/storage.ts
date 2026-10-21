import type { Day } from '../background/session';
import type { Level } from './curve';
import { DEFAULT_SETTINGS, type Settings } from './settings';

/** Everything in chrome.storage.local. Content scripts read `settings` and `level`; only the service worker writes. */
export interface Stored {
  settings: Settings;
  /** Loosened settings waiting for the next local midnight. */
  pending: Partial<Settings> | null;
  day: Day;
  track: Track;
  level: Level;
}

export interface Track {
  /** When the current stretch of counted time began, or null if nothing is being counted. */
  since: number | null;
  /** A content script reported video playing until this time, which counts as activity while the user isn't touching input. */
  mediaUntil: number;
  /** Written on every tick; a large gap on a fresh start means the extension was off. */
  lastHeartbeat: number;
}

export async function load<K extends keyof Stored>(...keys: K[]): Promise<Partial<Pick<Stored, K>>> {
  return (await chrome.storage.local.get(keys)) as Partial<Pick<Stored, K>>;
}

export async function save(values: Partial<Stored>): Promise<void> {
  await chrome.storage.local.set(values);
}

export async function loadSettings(): Promise<Settings> {
  return (await load('settings')).settings ?? DEFAULT_SETTINGS;
}

/** Messages to the service worker. */
export type Request =
  | { type: 'status' }
  | { type: 'saveSettings'; target: Settings }
  | { type: 'mediaPlaying' };

export interface Status {
  usedMs: number;
  budgetMs: number;
  state: 'ready' | 'active' | 'cooldown' | 'spent';
  settings: Settings;
  pending: Partial<Settings> | null;
}

export interface SaveResult {
  errors: string[];
  applied: Settings;
  pending: Partial<Settings> | null;
}
