import { describe, expect, it } from 'vitest';
import { isExemptUrl, isListedUrl, matchSite, normalizeDomain, normalizeExemptPath } from '../src/shared/domains';

describe('domains', () => {
  it('normalizes input', () => {
    expect(normalizeDomain('https://www.X.com/home')).toBe('x.com');
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeExemptPath('https://x.com/messages/')).toBe('x.com/messages');
  });
  it('matches subdomains but not lookalikes', () => {
    expect(matchSite('m.facebook.com', ['facebook.com'])).toBe('facebook.com');
    expect(matchSite('notfacebook.com', ['facebook.com'])).toBeNull();
    expect(isListedUrl('chrome://extensions', ['x.com'])).toBe(false);
    expect(isListedUrl('https://en.wikipedia.org/', ['x.com'])).toBe(false);
  });
  it('matches exempt paths on segment boundaries', () => {
    const ex = ['x.com/messages', 'instagram.com/direct'];
    expect(isExemptUrl('https://x.com/messages', ex)).toBe(true);
    expect(isExemptUrl('https://x.com/messages/123-456', ex)).toBe(true);
    expect(isExemptUrl('https://x.com/messagesfoo', ex)).toBe(false);
    expect(isExemptUrl('https://www.instagram.com/direct/inbox/', ex)).toBe(true);
    expect(isExemptUrl('https://x.com/home', ex)).toBe(false);
  });
});
