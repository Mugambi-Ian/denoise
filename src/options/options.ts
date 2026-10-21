import { matchPatterns } from '../shared/domains';
import { cleanExemptPaths, cleanSites, withPending, type Settings } from '../shared/settings';
import type { Request, SaveResult, Status } from '../shared/storage';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($(id).value);
const pct = (x: number) => String(Math.round(x * 1000) / 10);

let current: Settings;

function fill(s: Settings): void {
  $<HTMLTextAreaElement>('sites').value = s.sites.join('\n');
  $<HTMLTextAreaElement>('exempt').value = s.exemptPaths.join('\n');
  $('budget').value = String(s.budgetMin);
  [$('sessLo').value, $('sessHi').value] = s.sessionMin.map(String);
  [$('coolLo').value, $('coolHi').value] = s.cooldownMin.map(String);
  $('idle').value = String(s.idleSec);
  $('pastCap').value = pct(s.pastCapFail);
  $('autoplay').value = pct(s.autoplayOffAt);
  $('curve').replaceChildren(...s.curve.map((p) => {
    const tr = document.createElement('tr');
    for (const [cls, v] of [['at', pct(p.at)], ['fail', pct(p.fail)], ['delay', String(p.delayMs / 1000)]]) {
      const td = document.createElement('td');
      const input = document.createElement('input');
      Object.assign(input, { type: 'number', className: cls, value: v, min: '0', step: cls === 'delay' ? '0.5' : '1' });
      td.append(input);
      tr.append(td);
    }
    return tr;
  }));
}

function read(): Settings {
  const lines = (id: string) => $<HTMLTextAreaElement>(id).value.split('\n');
  return {
    sites: cleanSites(lines('sites')),
    exemptPaths: cleanExemptPaths(lines('exempt')),
    budgetMin: num('budget'),
    sessionMin: [num('sessLo'), num('sessHi')],
    cooldownMin: [num('coolLo'), num('coolHi')],
    idleSec: num('idle'),
    curve: [...$('curve').querySelectorAll('tr')].map((tr) => {
      const v = (cls: string) => Number((tr.querySelector('.' + cls) as HTMLInputElement).value);
      return { at: v('at') / 100, fail: v('fail') / 100, delayMs: v('delay') * 1000 };
    }),
    pastCapFail: num('pastCap') / 100,
    autoplayOffAt: num('autoplay') / 100,
  };
}

const FIELD_NAMES: Record<keyof Settings, string> = {
  sites: 'Site list', exemptPaths: 'Exempt paths', budgetMin: 'Daily budget', sessionMin: 'Session length',
  cooldownMin: 'Cooldown', idleSec: 'Idle threshold', curve: 'Degradation curve',
  pastCapFail: 'Failure past budget', autoplayOffAt: 'Autoplay threshold',
};

function showPending(pending: Partial<Settings> | null): void {
  $('pendingBox').hidden = !pending;
  $('pendingList').replaceChildren(...Object.keys(pending ?? {}).map((k) => {
    const li = document.createElement('li');
    li.textContent = FIELD_NAMES[k as keyof Settings];
    return li;
  }));
}

async function load(): Promise<void> {
  const s: Status = await chrome.runtime.sendMessage({ type: 'status' } satisfies Request);
  current = s.settings;
  fill(withPending(s.settings, s.pending));
  showPending(s.pending);
}

$('save').addEventListener('click', () => {
  const target = read();
  const added = target.sites.filter((d) => !current.sites.includes(d));
  // Ask for access to newly added sites while the click still counts as a user gesture.
  const granted = added.length
    ? chrome.permissions.request({ origins: added.flatMap(matchPatterns) })
    : Promise.resolve(true);
  void granted.then(async (ok) => {
    $('errors').textContent = '';
    $('saved').textContent = '';
    if (!ok) {
      $('errors').textContent = 'Access to the new sites was declined, so they were not added.';
      return;
    }
    const res: SaveResult = await chrome.runtime.sendMessage({ type: 'saveSettings', target } satisfies Request);
    if (res.errors.length) {
      $('errors').replaceChildren(...res.errors.map((e) => Object.assign(document.createElement('p'), { textContent: e })));
      return;
    }
    current = res.applied;
    showPending(res.pending);
    $('saved').textContent = res.pending ? 'Saved. Some changes take effect tomorrow.' : 'Saved.';
  });
});

void load();
