// Runs in the page's own JavaScript world. Streaming players fetch video in segments, which the DOM layer can't
// see, so segment requests are delayed or fail the way a flaky connection would make them fail.
import { NO_DEGRADATION, type Level } from '../shared/curve';
import { isExemptUrl } from '../shared/domains';

declare const __CHANNEL__: string;

(() => {
  let level: Level = NO_DEGRADATION;
  let listed = false;
  let exemptPaths: string[] = [];

  /** Video segment and progressive-video URLs on the major sites. */
  const MEDIA_URL = [
    /\/\/video\.twimg\.com\//,
    /\/\/v\.redd\.it\//,
    /\.(mp4|m4s|m4v|m4a|webm|ts)(\?|$)/,
    /cdninstagram\.com\/.*\.mp4/,
    /fbcdn\.net\/.*\.mp4/,
    /mime_type=video/,
  ];

  /** A video is many segments, so each segment fails at half the image rate or playback would never start. */
  const SEGMENT_FAIL_FACTOR = 0.5;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object' || !(__CHANNEL__ in e.data)) return;
    ({ level, listed, exemptPaths } = e.data[__CHANNEL__]);
  });

  type Fate = { kind: 'pass' } | { kind: 'fail' } | { kind: 'delay'; ms: number };

  function fateFor(url: string): Fate {
    if (!listed || level.failRate === 0 || isExemptUrl(location.href, exemptPaths)) return { kind: 'pass' };
    if (!MEDIA_URL.some((re) => re.test(url))) return { kind: 'pass' };
    if (Math.random() < level.failRate * SEGMENT_FAIL_FACTOR) return { kind: 'fail' };
    const ms = level.delayMinMs + Math.random() * (level.delayMaxMs - level.delayMinMs);
    return ms > 0 ? { kind: 'delay', ms } : { kind: 'pass' };
  }

  function urlOf(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const origFetch = window.fetch;
  window.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const fate = fateFor(urlOf(input));
    if (fate.kind === 'fail') return sleep(200 + Math.random() * 1500).then(() => Promise.reject(new TypeError('Failed to fetch')));
    if (fate.kind === 'delay') return sleep(fate.ms).then(() => origFetch.call(this, input, init));
    return origFetch.call(this, input, init);
  };

  const urls = new WeakMap<XMLHttpRequest, string>();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    urls.set(this, String(url));
    // @ts-expect-error forwarding the optional async/user/password arguments as given
    return origOpen.call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const fate = fateFor(urls.get(this) ?? '');
    if (fate.kind === 'fail') {
      // Re-point the request at an address Chrome refuses to connect to, so it ends in a real network error.
      origOpen.call(this, 'GET', 'https://0.0.0.0/', true);
      return origSend.call(this);
    }
    if (fate.kind === 'delay') {
      setTimeout(() => origSend.call(this, body), fate.ms);
      return;
    }
    return origSend.call(this, body);
  };

  // Keep the wrapped functions looking native to page code that inspects them.
  const nativeToString = Function.prototype.toString;
  const disguised = new Map<unknown, unknown>([
    [window.fetch, origFetch],
    [XMLHttpRequest.prototype.open, origOpen],
    [XMLHttpRequest.prototype.send, origSend],
  ]);
  Function.prototype.toString = function toString(this: unknown) {
    return nativeToString.call(disguised.get(this) ?? this);
  };
  disguised.set(Function.prototype.toString, nativeToString);
})();
