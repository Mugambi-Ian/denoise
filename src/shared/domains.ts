/** Reduce user input like "https://www.X.com/home" to "x.com". Returns null if it isn't a domain. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/** "x.com/messages/" → "x.com/messages". Returns null if the domain part is invalid. */
export function normalizeExemptPath(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '');
  if (!s) return null;
  const slash = s.indexOf('/');
  const domain = normalizeDomain(slash < 0 ? s : s.slice(0, slash));
  if (!domain) return null;
  const path = slash < 0 ? '' : s.slice(slash).replace(/\/+$/, '');
  return domain + path;
}

function hostMatches(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  return h === domain || h.endsWith('.' + domain);
}

/** The listed site a hostname belongs to, counting subdomains (m.facebook.com → facebook.com). */
export function matchSite(hostname: string, sites: readonly string[]): string | null {
  return sites.find((s) => hostMatches(hostname, s)) ?? null;
}

export function isListedUrl(url: string | undefined, sites: readonly string[]): boolean {
  const u = parseHttpUrl(url);
  return !!u && matchSite(u.hostname, sites) !== null;
}

/** True if the URL falls under an exempt entry such as "x.com/messages" (path-prefix match on segment boundaries). */
export function isExemptUrl(url: string | undefined, exemptPaths: readonly string[]): boolean {
  const u = parseHttpUrl(url);
  if (!u) return false;
  const path = u.pathname.toLowerCase();
  return exemptPaths.some((entry) => {
    const slash = entry.indexOf('/');
    const domain = slash < 0 ? entry : entry.slice(0, slash);
    const prefix = slash < 0 ? '' : entry.slice(slash);
    if (!hostMatches(u.hostname, domain)) return false;
    return prefix === '' || path === prefix || path.startsWith(prefix + '/');
  });
}

function parseHttpUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Match patterns covering a domain and all its subdomains. */
export function matchPatterns(domain: string): string[] {
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}
