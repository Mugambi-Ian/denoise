// Degrades images and video on listed sites so failures read as ordinary network flakiness.
// Never adds UI, attributes, classes or console output that would point at the extension.
import { NO_DEGRADATION, type Level } from '../shared/curve';
import { isExemptUrl, matchSite } from '../shared/domains';
import type { Settings } from '../shared/settings';
import type { Request } from '../shared/storage';

declare const __CHANNEL__: string;

let level: Level = NO_DEGRADATION;
let settings: Settings | null = null;

/** The src a given element was last judged for, so each image or video is rolled once. */
const judged = new WeakMap<Element, string>();
/** Original values held back while a delay runs. */
const held = new WeakMap<Element, Record<string, string>>();

// A decoded-nothing JPEG: the browser shows its own broken-image state, with no network request.
const BROKEN = 'data:image/jpeg;base64,/9j/';

function listedHere(): boolean {
  return !!settings && matchSite(location.hostname, settings.sites) !== null;
}

function active(): boolean {
  return listedHere() && !isExemptUrl(location.href, settings!.exemptPaths) && level.failRate > 0;
}

function delayMs(): number {
  return level.delayMinMs + Math.random() * (level.delayMaxMs - level.delayMinMs);
}

/** Attributes that carry the media URL for each kind of element. */
function mediaAttrs(el: Element): string[] {
  switch (el.tagName) {
    case 'IMG': return ['srcset', 'src'];
    case 'SOURCE': return ['srcset', 'src'];
    case 'VIDEO': return (el.getAttribute('src') ?? '').startsWith('blob:') ? ['poster'] : ['poster', 'src'];
    default: return [];
  }
}

function currentKey(el: Element): string {
  if (el instanceof HTMLElement && el.style.backgroundImage.includes('url(')) return el.style.backgroundImage;
  return mediaAttrs(el).map((a) => el.getAttribute(a) ?? '').join('|');
}

function judge(el: Element): void {
  if (held.has(el)) return;
  const key = currentKey(el);
  if (!key.replace(/\|/g, '') || judged.get(el) === key || key.includes(BROKEN)) return;
  judged.set(el, key);

  const roll = Math.random();
  if (roll < level.failRate) fail(el);
  else if (level.delayMaxMs > 0) hold(el, delayMs());
}

function fail(el: Element): void {
  if (el instanceof HTMLElement && el.style.backgroundImage.includes('url(')) {
    el.style.backgroundImage = 'none';
    return;
  }
  // Some failures look broken, others just never finish loading.
  if (Math.random() < 0.3) {
    hold(el, Infinity);
    return;
  }
  for (const attr of mediaAttrs(el)) {
    if (!el.hasAttribute(attr)) continue;
    if (attr === 'src') el.setAttribute('src', BROKEN);
    else el.removeAttribute(attr);
  }
  if (el instanceof HTMLVideoElement) el.load();
  judged.set(el, currentKey(el));
}

/** Withhold the media URL, then put it back after `ms` (or never). */
function hold(el: Element, ms: number): void {
  const saved: Record<string, string> = {};
  if (el instanceof HTMLElement && el.style.backgroundImage.includes('url(')) {
    saved.bg = el.style.backgroundImage;
    el.style.backgroundImage = 'none';
  } else {
    for (const attr of mediaAttrs(el)) {
      const v = el.getAttribute(attr);
      if (v === null) continue;
      saved[attr] = v;
      el.removeAttribute(attr);
    }
  }
  if (!Object.keys(saved).length) return;
  held.set(el, saved);
  if (ms === Infinity) return;
  setTimeout(() => release(el), ms);
}

function release(el: Element): void {
  const saved = held.get(el);
  if (!saved) return;
  held.delete(el);
  if (saved.bg !== undefined && el instanceof HTMLElement) el.style.backgroundImage = saved.bg;
  for (const [attr, v] of Object.entries(saved)) if (attr !== 'bg') el.setAttribute(attr, v);
  judged.set(el, currentKey(el));
  if (el instanceof HTMLVideoElement && saved.src) el.load();
}

function suppressAutoplay(el: Element): void {
  if (el instanceof HTMLVideoElement && el.autoplay) {
    el.autoplay = false;
    el.pause();
  }
}

function scan(root: ParentNode): void {
  if (!active()) return;
  root.querySelectorAll('img, picture source, video source, video, [style*="url("]').forEach((el) => {
    judge(el);
    if (level.autoplayOff) suppressAutoplay(el);
  });
}

function visit(node: Node): void {
  if (!(node instanceof Element)) return;
  // The page swapped in a new URL while we were holding the old one back: forget the old one.
  if (held.has(node) && mediaAttrs(node).some((a) => node.hasAttribute(a))) held.delete(node);
  if (node.matches('img, source, video, [style*="url("]')) judge(node);
  if (level.autoplayOff) suppressAutoplay(node);
  if (node.firstElementChild) scan(node);
}

new MutationObserver((records) => {
  if (!active()) return;
  for (const r of records) {
    if (r.type === 'attributes') visit(r.target);
    else r.addedNodes.forEach(visit);
  }
}).observe(document, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['src', 'srcset', 'poster', 'style'],
});

// Autoplay off: only playback the user started (recent click or key) is allowed.
document.addEventListener('play', (e) => {
  if (!active() || !level.autoplayOff) return;
  if (e.target instanceof HTMLMediaElement && !navigator.userActivation.isActive) e.target.pause();
}, true);

// Video playing in the foreground counts as use even without input.
setInterval(() => {
  if (!listedHere() || document.visibilityState !== 'visible') return;
  const playing = [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && v.readyState > 2);
  if (playing) chrome.runtime.sendMessage({ type: 'mediaPlaying' } satisfies Request).catch(() => {});
}, 15_000);

/** The page-world script degrades video segment requests; hand it the current level. */
function publish(): void {
  window.postMessage({ [__CHANNEL__]: { level, listed: listedHere(), exemptPaths: settings?.exemptPaths ?? [] } }, location.origin);
}

function apply(next: { level?: Level; settings?: Settings }): void {
  if (next.settings) settings = next.settings;
  if (next.level) level = next.level;
  publish();
  scan(document);
}

chrome.storage.local.get(['level', 'settings']).then((v) => apply(v as { level?: Level; settings?: Settings }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.level || changes.settings)) return;
  apply({ level: changes.level?.newValue as Level | undefined, settings: changes.settings?.newValue as Settings | undefined });
});
