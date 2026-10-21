import type { Day } from './session';
import { MINUTE } from '../shared/time';

declare const __UNINSTALL_URL__: string;

let lastUrl = '';

/** Keep the uninstall page's link current with today's usage. Skipped when no page URL was set at build time. */
export function syncUninstallUrl(day: Day, budgetMin: number): void {
  if (!__UNINSTALL_URL__) return;
  const params = new URLSearchParams({
    used: String(Math.floor(day.usedMs / MINUTE)),
    budget: String(budgetMin),
    date: day.key,
  });
  const url = `${__UNINSTALL_URL__}?${params}`;
  if (url === lastUrl) return;
  lastUrl = url;
  chrome.runtime.setUninstallURL(url).catch(() => {});
}
