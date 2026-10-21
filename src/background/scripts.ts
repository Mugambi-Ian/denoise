import { isListedUrl, matchPatterns } from '../shared/domains';

const SCRIPTS = [
  { id: 'isolated', file: 'content/isolated.js', world: 'ISOLATED' },
  { id: 'main', file: 'content/main-world.js', world: 'MAIN' },
] as const;

/** Sites whose host permission has been granted. Sites added in settings ask for it from the options page. */
async function grantedSites(sites: string[]): Promise<string[]> {
  const checks = await Promise.all(sites.map((s) => chrome.permissions.contains({ origins: matchPatterns(s) })));
  return sites.filter((_, i) => checks[i]);
}

/** Register the media-degrading content scripts for exactly the listed sites. */
export async function syncContentScripts(sites: string[]): Promise<void> {
  const matches = (await grantedSites(sites)).flatMap(matchPatterns);
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts(SCRIPTS.map((s) => ({
    id: s.id,
    js: [s.file],
    matches,
    runAt: 'document_start' as const,
    allFrames: true,
    world: s.world as chrome.scripting.ExecutionWorld,
    persistAcrossSessions: true,
  })));
}

/** Registered scripts only reach pages loaded afterwards, so cover tabs that were already open at install. */
export async function injectIntoOpenTabs(sites: string[]): Promise<void> {
  const granted = await grantedSites(sites);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !isListedUrl(tab.url, granted)) continue;
    for (const s of SCRIPTS) {
      await chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: [s.file], world: s.world as chrome.scripting.ExecutionWorld })
        .catch(() => {});
    }
  }
}
