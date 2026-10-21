import { levelFor } from '../shared/curve';
import { isListedUrl } from '../shared/domains';
import { DEFAULT_SETTINGS, splitChange, validate, withPending, type Settings } from '../shared/settings';
import { load, save, type Request, type SaveResult, type Status, type Track } from '../shared/storage';
import { MINUTE, dayKey, startOfDay } from '../shared/time';
import { syncDnr } from './dnr';
import { injectIntoOpenTabs, syncContentScripts } from './scripts';
import {
  budgetMs, disablePenaltyMs, newDay, phaseOf, sessionRemainingMs, step, type Day,
} from './session';
import { syncUninstallUrl } from './uninstall';

declare const __FAST__: boolean;

const TICK_ALARM = 'tick';
const SESSION_END_ALARM = 'session-end';
/** Longest stretch credited in one step; anything longer means the machine slept or the worker missed ticks. */
const MAX_CREDIT_MS = 2 * 60_000;
/** Heartbeat gaps shorter than this are ordinary jitter, not the extension being off. */
const HEARTBEAT_GRACE_MS = 2 * 60_000;
/** How long a content script's "video playing" report keeps counting time while there's no input. */
const MEDIA_REPORT_MS = 30_000;

// Every state change runs through this queue so overlapping events can't lose updates.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function emptyTrack(now: number): Track {
  return { since: null, mediaUntil: 0, lastHeartbeat: now };
}

async function isCountingNow(settings: Settings, track: Track, now: number): Promise<boolean> {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win?.focused || win.id === undefined) return false;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!isListedUrl(tab?.url, settings.sites)) return false;
  const idle = await chrome.idle.queryState(settings.idleSec);
  return idle === 'active' || (idle === 'idle' && track.mediaUntil > now);
}

/** Credit time since the last step, advance sessions, then publish the new degradation level. */
function tick(): Promise<{ day: Day; settings: Settings; pending: Partial<Settings> | null }> {
  return serial(async () => {
    const now = Date.now();
    const stored = await load('settings', 'pending', 'day', 'track');
    let settings = stored.settings ?? DEFAULT_SETTINGS;
    let pending = stored.pending ?? null;
    let day = stored.day ?? newDay(now);
    const track = stored.track ?? emptyTrack(now);

    let credit = track.since === null ? 0 : Math.min(Math.max(0, now - track.since), MAX_CREDIT_MS);
    if (day.key !== dayKey(now)) {
      // Midnight: reset the budget and apply loosened settings queued yesterday.
      credit = Math.min(credit, now - startOfDay(now));
      day = newDay(now);
      if (pending) {
        settings = withPending(settings, pending);
        pending = null;
        await afterSettingsChange(settings);
      }
    }

    const counting = await isCountingNow(settings, track, now);
    day = step(day, settings, now, credit, counting, Math.random);
    const level = levelFor(settings, day.usedMs, budgetMs(settings), phaseOf(day));
    await save({ settings, pending, day, level, track: { ...track, since: counting ? now : null, lastHeartbeat: now } });

    await syncDnr(level, settings);
    syncUninstallUrl(day, settings.budgetMin);
    scheduleSessionEnd(day, counting, now);
    return { day, settings, pending };
  });
}

/** Alarms alone could let a session overrun by up to a tick, so end it on time. */
function scheduleSessionEnd(day: Day, counting: boolean, now: number): void {
  const remaining = sessionRemainingMs(day);
  if (!counting || remaining === null) {
    chrome.alarms.clear(SESSION_END_ALARM);
    return;
  }
  chrome.alarms.create(SESSION_END_ALARM, { when: now + remaining + 50 });
  // Alarms fire no sooner than 30 s out; the worker is awake now, so a timer covers shorter waits.
  if (remaining < 30_000) setTimeout(() => void tick(), remaining + 50);
}

async function afterSettingsChange(settings: Settings): Promise<void> {
  chrome.idle.setDetectionInterval(settings.idleSec);
  await syncContentScripts(settings.sites).catch(() => {});
}

async function saveSettings(target: Settings): Promise<SaveResult> {
  const errors = validate(target);
  return serial(async () => {
    const stored = await load('settings', 'pending');
    const current = stored.settings ?? DEFAULT_SETTINGS;
    if (errors.length) return { errors, applied: current, pending: stored.pending ?? null };
    const { apply, pending } = splitChange(current, target);
    await save({ settings: apply, pending });
    await afterSettingsChange(apply);
    return { errors: [], applied: apply, pending };
  }).finally(() => void tick());
}

async function status(): Promise<Status> {
  const { day, settings, pending } = await tick();
  const budget = budgetMs(settings);
  const state = day.usedMs >= budget ? 'spent'
    : day.session.state === 'active' ? 'active'
    : day.session.state === 'cooldown' ? 'cooldown'
    : 'ready';
  return { usedMs: day.usedMs, budgetMs: budget, state, settings, pending };
}

// --- Disable penalty -------------------------------------------------------
// storage.session is cleared when Chrome restarts and when the extension is disabled or reloaded, but survives
// service worker suspension. So a fresh start with neither onStartup nor onInstalled firing means the extension was
// just re-enabled while Chrome was running, and the gap since the last heartbeat is charged as used time.

let excused = false;

chrome.runtime.onStartup.addListener(() => {
  excused = true; // Chrome itself was closed; that gap is free.
});

chrome.runtime.onInstalled.addListener(() => {
  excused = true;
  void serial(async () => {
    const { settings } = await load('settings');
    const s = settings ?? DEFAULT_SETTINGS;
    if (!settings) await save({ settings: s, pending: null });
    await afterSettingsChange(s);
    await injectIntoOpenTabs(s.sites);
  });
});

async function boot(): Promise<void> {
  // Queued synchronously at startup so it reads the old heartbeat before any event's tick overwrites it.
  const fresh = await serial(async () => {
    const { alive } = await chrome.storage.session.get('alive');
    if (alive) return null; // Ordinary worker restart.
    await chrome.storage.session.set({ alive: true });
    const now = Date.now();
    const { track } = await load('track');
    // Drop the stale counting stretch from before the extension stopped.
    await save({ track: { ...(track ?? emptyTrack(now)), since: null } });
    return { lastHeartbeat: track?.lastHeartbeat ?? null };
  });
  if (!fresh) return;
  const { lastHeartbeat } = fresh;

  const settings = (await load('settings')).settings ?? DEFAULT_SETTINGS;
  await afterSettingsChange(settings);

  // onStartup / onInstalled are dispatched right after the worker's first run; give them a moment.
  await new Promise((r) => setTimeout(r, 3000));
  if (excused || lastHeartbeat === null) return;

  await serial(async () => {
    const now = Date.now();
    const stored = await load('day', 'settings');
    const s = stored.settings ?? DEFAULT_SETTINGS;
    let day = stored.day ?? newDay(now);
    if (day.key !== dayKey(now)) day = newDay(now);
    const penalty = disablePenaltyMs(lastHeartbeat, now, s, HEARTBEAT_GRACE_MS);
    if (penalty > 0) await save({ day: { ...day, usedMs: Math.min(day.usedMs + penalty, budgetMs(s)) } });
  });
  await tick();
}

// --- Events ------------------------------------------------------------------

const onEvent = () => void tick();
chrome.tabs.onActivated.addListener(onEvent);
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.status === 'complete') onEvent();
});
chrome.windows.onFocusChanged.addListener(onEvent);
chrome.idle.onStateChanged.addListener(onEvent);
chrome.alarms.onAlarm.addListener(onEvent);

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  if (msg.type === 'status') {
    status().then(sendResponse);
    return true;
  }
  if (msg.type === 'saveSettings') {
    saveSettings(msg.target).then(sendResponse);
    return true;
  }
  if (msg.type === 'mediaPlaying' && sender.tab?.active) {
    void serial(async () => {
      const now = Date.now();
      const { track } = await load('track');
      await save({ track: { ...(track ?? emptyTrack(now)), mediaUntil: now + MEDIA_REPORT_MS } });
    });
  }
  return false;
});

chrome.alarms.get(TICK_ALARM).then((a) => {
  if (!a) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
});
if (__FAST__) setInterval(onEvent, MINUTE / 4);

void boot();
