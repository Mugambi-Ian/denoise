import type { Level } from '../shared/curve';
import { isExemptUrl } from '../shared/domains';
import type { Settings } from '../shared/settings';

const RULE_ID = 1;
/** At or above this failure rate, a network rule takes over so CSS backgrounds and other media the page layer misses fail too. */
const DNR_THRESHOLD = 0.95;

let lastApplied = '';

/** Block images and video requested by listed sites once degradation is near total. Text and API calls are untouched. */
export async function syncDnr(level: Level, settings: Settings): Promise<void> {
  let rules: chrome.declarativeNetRequest.Rule[] = [];
  if (level.failRate >= DNR_THRESHOLD && settings.sites.length) {
    const tabs = await chrome.tabs.query({});
    const excludedTabIds = tabs
      .filter((t) => t.id !== undefined && isExemptUrl(t.url, settings.exemptPaths))
      .map((t) => t.id!);
    rules = [{
      id: RULE_ID,
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
      condition: {
        initiatorDomains: settings.sites,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.IMAGE,
          chrome.declarativeNetRequest.ResourceType.MEDIA,
        ],
        ...(excludedTabIds.length ? { excludedTabIds } : {}),
      },
    }];
  }
  const key = JSON.stringify(rules);
  if (key === lastApplied) return;
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
  lastApplied = key;
}
